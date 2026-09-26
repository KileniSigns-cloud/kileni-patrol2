-- 008: Stop signed-in users from changing their own (or anyone's) role / organisation
-- through the API, and scope admin access on public.users to the admin's organisation.
--
-- Before 008 (live, captured 2026-09-26):
--   org_isolation       PERMISSIVE ALL TO public        USING (organisation_id = get_user_org_id())   (no WITH CHECK)
--   users_admin_manage  PERMISSIVE ALL TO authenticated USING/CHECK ((SELECT is_current_user_admin()))
--   users_read_own      PERMISSIVE SELECT TO authenticated USING (id = (SELECT auth.uid()))
--   users_read_same_org PERMISSIVE SELECT TO authenticated USING (organisation_id = (SELECT get_user_org_id()))
--   users_self_update   PERMISSIVE UPDATE TO authenticated USING (id = auth.uid())
--                       WITH CHECK (id = auth.uid() AND organisation_id = get_user_org_id() AND role = get_user_role())
--   Table grants: anon and authenticated both have INSERT, SELECT, UPDATE, DELETE (all columns).
--
-- The hole: permissive policies are OR'd. users_self_update pins role, but org_isolation also
-- matches the UPDATE and has no WITH CHECK (so its USING is reused as the check, and that only
-- tests organisation_id). Any active member can therefore UPDATE role = 'admin' on their own
-- row or on anyone in their organisation, INSERT extra rows in their organisation with any
-- role, and DELETE other members' rows. users_admin_manage has no organisation test, so an
-- admin of one organisation can read, change and delete users of every organisation.
--
-- Fix, in two independent layers:
--   1. Grants (primary). authenticated keeps SELECT and may UPDATE only `name`; INSERT and
--      DELETE are revoked. anon loses INSERT/UPDATE/DELETE. Grants apply whatever policies
--      exist, so a later broad policy can't reopen role/organisation changes.
--   2. Policies. org_isolation is dropped (SELECT is already covered by users_read_own and
--      users_read_same_org). users_admin_manage is limited to the admin's own organisation.
--
-- Nothing in patrol2, PATROL v1, BUILT, the send-invite edge function or api/send-quote.ts
-- writes public.users through the API (verified by grep 2026-09-26). The only writer is
-- claim_invite(), SECURITY DEFINER owned by postgres, which bypasses both layers.
-- Role and organisation changes for existing users go through claim_invite() or the SQL
-- editor / service role.
--
-- Independent of 007; may be applied before it.
-- Rollback: migrations/008_rollback.sql

BEGIN;

-- ── 1. Grants ────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon;

-- Table-level UPDATE implies every column, so revoke it and grant back only `name`.
REVOKE INSERT, UPDATE, DELETE ON public.users FROM authenticated;
GRANT UPDATE (name) ON public.users TO authenticated;

-- ── 2. Policies ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS org_isolation ON public.users;

DROP POLICY IF EXISTS users_admin_manage ON public.users;
CREATE POLICY users_admin_manage ON public.users
  AS PERMISSIVE FOR ALL TO authenticated
  USING (
    (SELECT public.is_current_user_admin())
    AND organisation_id = (SELECT public.get_user_org_id())
  )
  WITH CHECK (
    (SELECT public.is_current_user_admin())
    AND organisation_id = (SELECT public.get_user_org_id())
  );

-- users_read_own, users_read_same_org and users_self_update are kept unchanged.

COMMIT;

-- ── Verify after applying ────────────────────────────────────────────────────
--   select policyname, cmd, roles from pg_policies
--   where schemaname = 'public' and tablename = 'users' order by policyname;
--   -> users_admin_manage (ALL), users_read_own (SELECT), users_read_same_org (SELECT),
--      users_self_update (UPDATE). No org_isolation.
--
--   select grantee, privilege_type, column_name from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'users'
--     and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
--   order by grantee, privilege_type, column_name;
--   -> REFERENCES rows, plus exactly one UPDATE row: authenticated / name.
