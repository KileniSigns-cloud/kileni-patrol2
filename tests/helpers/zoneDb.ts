// A PGlite database shaped like live patrol_routes before 014 (checked 2026-10-03): the 13
// columns, the raw-text unique constraint, the 3 RLS policies, the live helper functions and the
// live grants (every table privilege for anon and authenticated, EXECUTE on new functions for
// anon by default). auth.uid() reads the test.uid setting, standing in for the user's JWT.
// Shared by the 014 and 015 tests.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const ORG = '00000000-0000-0000-0000-00000000000a';
export const OTHER_ORG = '00000000-0000-0000-0000-00000000000b';
export const ADMIN = '00000000-0000-0000-0000-0000000000a1';
export const SALES = '00000000-0000-0000-0000-0000000000a2';
export const INACTIVE_ADMIN = '00000000-0000-0000-0000-0000000000a3';
export const OTHER_ADMIN = '00000000-0000-0000-0000-0000000000b1';

export const SCHEMA = `
  create role anon; create role authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

  create table organisations (id uuid primary key);
  create table users (id uuid primary key, organisation_id uuid references organisations(id), role text, active boolean);
  grant select on users to anon, authenticated;
  create table patrol_routes (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references organisations(id),
    name text not null, description text, assigned_rep uuid references users(id), created_at timestamptz default now(),
    code text, steps jsonb, hotspots jsonb, start_point text, area_type text, focus text,
    archived_at timestamp,
    constraint patrol_routes_org_code_unique unique (organisation_id, code));
  create table patrol_sessions (id uuid primary key default gen_random_uuid(),
    route_id uuid references patrol_routes(id) on delete cascade);
  grant all on patrol_routes to anon, authenticated;

  create function get_user_org_id() returns uuid language sql stable security definer set search_path to 'public'
    as $$ select organisation_id from public.users where id = (select auth.uid()) and active = true limit 1; $$;
  create function is_current_user_admin() returns boolean language sql stable security definer set search_path to 'public'
    as $$ select exists (select 1 from public.users where id = (select auth.uid()) and active = true and role = 'admin'); $$;

  alter table patrol_routes enable row level security;
  create policy patrol_routes_select_org on patrol_routes for select to authenticated
    using (organisation_id = (select get_user_org_id()));
  create policy patrol_routes_insert_admin on patrol_routes for insert to authenticated
    with check ((organisation_id = (select get_user_org_id())) and (select is_current_user_admin()));
  create policy patrol_routes_update_admin on patrol_routes for update to authenticated
    using ((organisation_id = (select get_user_org_id())) and (select is_current_user_admin()))
    with check ((organisation_id = (select get_user_org_id())) and (select is_current_user_admin()));

  insert into organisations values ('${ORG}'), ('${OTHER_ORG}');
  insert into users values
    ('${ADMIN}', '${ORG}', 'admin', true),
    ('${SALES}', '${ORG}', 'sales', true),
    ('${INACTIVE_ADMIN}', '${ORG}', 'admin', false),
    ('${OTHER_ADMIN}', '${OTHER_ORG}', 'admin', true);
`;

export const readMigration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');

/** A fresh database with the live schema, plus the given migration files applied in order. */
export async function zoneDb(...migrations: string[]): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  for (const m of migrations) await db.exec(readMigration(m));
  return db;
}

/** Runs one statement as `role` (none = table owner) with auth.uid() = uid. */
export async function runAs(db: PGlite, role: 'anon' | 'authenticated' | null, uid: string | null, sql: string, params: unknown[] = []) {
  await db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);
  if (role) await db.exec(`set role ${role}`);
  try {
    return await db.query<Record<string, unknown>>(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

/** Tab, LF and CR are fine; nothing else outside printable ASCII. */
export const nonAscii = (text: string) => [...text].filter((c) => c !== '\t' && c !== '\n' && c !== '\r' && (c < ' ' || c > '~'));
