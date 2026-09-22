-- Route archive support for admin route management.
-- Idempotent: patrol_routes.archived_at already exists in production (checked 2026-09-22);
-- this file documents it and adds the supporting indexes.

alter table public.patrol_routes
  add column if not exists archived_at timestamptz null;

-- Active-route lookups (RoutesPage, admin Active tab) filter on archived_at is null.
create index if not exists idx_patrol_routes_org_active
  on public.patrol_routes (organisation_id)
  where archived_at is null;

-- Route codes must be unique per organisation (case-insensitive). The app checks this
-- before insert; this index closes the race between two admins. It is only created when
-- the existing data has no duplicates, otherwise it raises a notice listing them.
do $$
declare
  dups text;
begin
  select string_agg(organisation_id::text || ':' || lower(code), ', ')
    into dups
  from (
    select organisation_id, lower(code) as code
    from public.patrol_routes
    group by organisation_id, lower(code)
    having count(*) > 1
  ) d;

  if dups is null then
    create unique index if not exists uq_patrol_routes_org_code
      on public.patrol_routes (organisation_id, lower(code));
  else
    raise notice 'uq_patrol_routes_org_code NOT created, duplicate codes: %', dups;
  end if;
end $$;
