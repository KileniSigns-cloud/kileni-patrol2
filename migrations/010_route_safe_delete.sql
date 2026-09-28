-- 010: Safe route delete for admins.
--
-- delete_route_if_unused(route, dry_run) hard-deletes a route only when nothing refers to it:
--   0 patrol_sessions on the route,
--   0 patrol_businesses on the route (by route_id, PATROL v1) or on its sessions,
--   0 sign_inspections on the route (by patrol_route_id) or on those businesses.
-- Otherwise it deletes nothing and returns the counts; the app then offers Archive
-- (the existing archive/restore update, unchanged).
-- "0 sessions" alone is not enough: BRAM-02 has 0 sessions but 1 PATROL v1 business, and
-- the route_id FK is ON DELETE CASCADE (business -> signs -> photo rows would go with it).
--
-- Why SECURITY DEFINER and no DELETE policy on patrol_routes:
--   * A DELETE policy would let an admin call DELETE /patrol_routes directly and skip this
--     guard, so the function is the only way to delete a route.
--   * The counts must see every referring row. Under the caller's RLS a row the caller
--     can't see would count as 0 and then be removed by the cascade anyway.
--   The function therefore checks the caller itself: signed in, active admin, and the route
--   belongs to the caller's organisation (get_user_org_id / is_current_user_admin, the
--   helpers every patrol policy uses).
--
-- Races: the route row is locked FOR UPDATE before counting. Inserting a session or
-- business that references the route needs a key-share lock on that row, so it waits
-- until this transaction ends and then fails its FK if the route was deleted.
--
-- Rollback: migrations/010_rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_route_if_unused(p_route_id uuid, p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_sessions integer;
  v_businesses integer;
  v_signs integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Route not deleted: you are signed out.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Route not deleted: only admins can delete routes.' USING ERRCODE = '42501';
  END IF;
  v_org := public.get_user_org_id();

  PERFORM 1 FROM public.patrol_routes
   WHERE id = p_route_id AND organisation_id = v_org
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Route not deleted: it was not found in your organisation.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_sessions
    FROM public.patrol_sessions s
   WHERE s.route_id = p_route_id;

  SELECT count(*) INTO v_businesses
    FROM public.patrol_businesses b
   WHERE b.route_id = p_route_id
      OR b.session_id IN (SELECT s.id FROM public.patrol_sessions s WHERE s.route_id = p_route_id);

  SELECT count(*) INTO v_signs
    FROM public.sign_inspections i
   WHERE i.patrol_route_id = p_route_id
      OR i.business_id IN (
           SELECT b.id FROM public.patrol_businesses b
            WHERE b.route_id = p_route_id
               OR b.session_id IN (SELECT s.id FROM public.patrol_sessions s WHERE s.route_id = p_route_id));

  IF v_sessions > 0 OR v_businesses > 0 OR v_signs > 0 THEN
    RETURN jsonb_build_object('status', 'in_use',
      'sessions', v_sessions, 'businesses', v_businesses, 'signs', v_signs);
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('status', 'deletable', 'sessions', 0, 'businesses', 0, 'signs', 0);
  END IF;

  DELETE FROM public.patrol_routes WHERE id = p_route_id;
  RETURN jsonb_build_object('status', 'deleted', 'sessions', 0, 'businesses', 0, 'signs', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_route_if_unused(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_route_if_unused(uuid, boolean) TO authenticated;

COMMIT;

-- ── Verify after applying ────────────────────────────────────────────────────
--   select proname, prosecdef, proconfig, array_to_string(proacl, ',')
--   from pg_proc where proname = 'delete_route_if_unused';
--   -> prosecdef = true, search_path=public, pg_temp; EXECUTE for authenticated (no anon).
--   select policyname, cmd from pg_policies where tablename = 'patrol_routes';
--   -> still no DELETE policy.
