-- Rollback for 008_users_lock_role_and_org.sql.
-- Restores the grants and the two policies exactly as captured live on 2026-09-26
-- (PERMISSIVE flag, roles, USING and WITH CHECK).
-- WARNING: this reopens self-promotion to admin (via org_isolation) and cross-organisation
-- admin access to public.users.

BEGIN;

-- ── 1. Grants ────────────────────────────────────────────────────────────────
-- Drop the column-level grant first, then restore the table-level ones.
REVOKE UPDATE (name) ON public.users FROM authenticated;
GRANT INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.users TO anon;

-- ── 2. Policies ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS org_isolation ON public.users;
CREATE POLICY org_isolation ON public.users
  AS PERMISSIVE FOR ALL TO public
  USING (organisation_id = get_user_org_id());

DROP POLICY IF EXISTS users_admin_manage ON public.users;
CREATE POLICY users_admin_manage ON public.users
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT is_current_user_admin() AS is_current_user_admin))
  WITH CHECK ((SELECT is_current_user_admin() AS is_current_user_admin));

COMMIT;
