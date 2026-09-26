-- 007: Scope patrol_sessions to the caller's organisation (through patrol_routes) and close
-- anonymous inserts into patrol_businesses.
--
-- Before 007 (live pg_policies, captured 2026-09-26):
--   patrol_sessions   "All authenticated users"  PERMISSIVE ALL TO public USING (auth.role() = 'authenticated')
--     -> any signed-in user, in any organisation, could read, update and delete every session.
--   patrol_businesses anon_insert_businesses     PERMISSIVE INSERT TO anon WITH CHECK (true)
--     -> anyone holding the public anon key could insert businesses into any organisation.
--
-- patrol_sessions has no organisation_id. Its organisation is its route's, so every policy
-- checks patrol_routes.organisation_id against get_user_org_id() (active public.users row).
-- All 42 live sessions have a route_id; a session without one matches no policy.
-- No DELETE policy: neither patrol2 nor BUILT deletes sessions. PATROL v1 (apps/patrol)
-- does, and those deletes will affect 0 rows after this migration.
-- patrol_lead_for_inspection() reads patrol_sessions as SECURITY DEFINER, so it is unaffected.
--
-- Rollback: migrations/007_rollback.sql

BEGIN;

-- ── patrol_sessions: replace the ALL policy with org-scoped policies ─────────
DROP POLICY IF EXISTS "All authenticated users" ON public.patrol_sessions;

-- Read: every session on a route in the caller's organisation (History, route stats,
-- last patrolled, resume, route history all read other patrollers' sessions in the org).
CREATE POLICY patrol_sessions_select_org ON public.patrol_sessions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patrol_routes r
      WHERE r.id = patrol_sessions.route_id
        AND r.organisation_id = (SELECT public.get_user_org_id())
    )
  );

-- Start: only as yourself, only on a route in your organisation.
CREATE POLICY patrol_sessions_insert_own ON public.patrol_sessions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    patroller_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.patrol_routes r
      WHERE r.id = patrol_sessions.route_id
        AND r.organisation_id = (SELECT public.get_user_org_id())
    )
  );

-- End / edit: your own sessions, or any session in your organisation if you are an admin.
-- The same test applies to the new row, so a session can't be moved to another
-- organisation's route or handed to another patroller by a non-admin.
CREATE POLICY patrol_sessions_update_own_or_admin ON public.patrol_sessions
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patrol_routes r
      WHERE r.id = patrol_sessions.route_id
        AND r.organisation_id = (SELECT public.get_user_org_id())
    )
    AND (patroller_id = (SELECT auth.uid()) OR (SELECT public.is_current_user_admin()))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patrol_routes r
      WHERE r.id = patrol_sessions.route_id
        AND r.organisation_id = (SELECT public.get_user_org_id())
    )
    AND (patroller_id = (SELECT auth.uid()) OR (SELECT public.is_current_user_admin()))
  );

-- ── patrol_businesses: no anonymous inserts ──────────────────────────────────
-- Every patrol2 insert happens signed in and is covered by patrol_businesses_insert_org.
DROP POLICY IF EXISTS anon_insert_businesses ON public.patrol_businesses;

-- ── Record the index that was created by hand in production ─────────────────
-- Already present live (verified 2026-09-26); IF NOT EXISTS makes this a no-op there.
-- Serves "last patrolled" per route and route history (route_id, newest first).
CREATE INDEX IF NOT EXISTS idx_patrol_sessions_route_started
  ON public.patrol_sessions USING btree (route_id, started_at DESC);

COMMIT;

-- ── Verify after applying ────────────────────────────────────────────────────
--   select policyname, cmd, roles from pg_policies
--   where schemaname = 'public' and tablename in ('patrol_sessions', 'patrol_businesses')
--   order by tablename, policyname;
-- Expect on patrol_sessions exactly: patrol_sessions_insert_own (INSERT),
-- patrol_sessions_select_org (SELECT), patrol_sessions_update_own_or_admin (UPDATE).
-- Expect no anon_insert_businesses on patrol_businesses.
