-- Rollback for 007_patrol_sessions_org_rls.sql.
-- The two restored policies match the live pg_policies rows captured 2026-09-26 before
-- 007 was applied (same PERMISSIVE flag, roles, USING and WITH CHECK).
-- WARNING: this reopens cross-organisation read/write/delete on patrol_sessions and
-- anonymous inserts into patrol_businesses.
-- idx_patrol_sessions_route_started is NOT dropped: it existed before 007.

BEGIN;

-- ── patrol_sessions: back to the single ALL policy ───────────────────────────
DROP POLICY IF EXISTS patrol_sessions_select_org ON public.patrol_sessions;
DROP POLICY IF EXISTS patrol_sessions_insert_own ON public.patrol_sessions;
DROP POLICY IF EXISTS patrol_sessions_update_own_or_admin ON public.patrol_sessions;

DROP POLICY IF EXISTS "All authenticated users" ON public.patrol_sessions;
CREATE POLICY "All authenticated users" ON public.patrol_sessions
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'authenticated'::text);

-- ── patrol_businesses: restore the anonymous insert policy ───────────────────
DROP POLICY IF EXISTS anon_insert_businesses ON public.patrol_businesses;
CREATE POLICY anon_insert_businesses ON public.patrol_businesses
  AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK (true);

COMMIT;
