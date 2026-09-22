-- Admin-only writes on patrol_routes.
--
-- REVIEW BEFORE APPLYING. The current policies on patrol_routes are not in any repo.
-- Postgres ORs permissive policies together, so if an existing policy already lets every
-- authenticated user INSERT/UPDATE, adding these changes nothing until that one is dropped.
-- List what is there first:
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public' and tablename = 'patrol_routes';
--
-- Then drop any permissive INSERT/UPDATE/ALL policy that isn't admin-scoped, and apply this.
-- SELECT is left as it is: patrollers read routes through the existing policy.

alter table public.patrol_routes enable row level security;

drop policy if exists "Admins can create routes in their org" on public.patrol_routes;
create policy "Admins can create routes in their org"
  on public.patrol_routes for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'admin'
        and u.organisation_id = patrol_routes.organisation_id
    )
  );

drop policy if exists "Admins can update routes in their org" on public.patrol_routes;
create policy "Admins can update routes in their org"
  on public.patrol_routes for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'admin'
        and u.organisation_id = patrol_routes.organisation_id
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'admin'
        and u.organisation_id = patrol_routes.organisation_id
    )
  );

-- No DELETE policy: with RLS enabled, deletes are denied. Routes are archived, never
-- deleted, so patrol_sessions.route_id history stays intact.
