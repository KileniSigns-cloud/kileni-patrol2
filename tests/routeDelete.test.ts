// Migration 010: delete_route_if_unused runs against a real Postgres (PGlite, in-process).
// The schema below is the minimum the function touches, with the live FKs and cascades
// (checked 2026-09-28) and copies of the live get_user_org_id / is_current_user_admin.
// auth.uid() reads the test.uid setting, standing in for the signed-in user's JWT.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER_ORG = '00000000-0000-0000-0000-00000000000b';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const SALES = '00000000-0000-0000-0000-0000000000a2';
const OTHER_ADMIN = '00000000-0000-0000-0000-0000000000b1';
const INACTIVE_ADMIN = '00000000-0000-0000-0000-0000000000a3';

const SCHEMA = `
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

  create table organisations (id uuid primary key);
  create table users (id uuid primary key, organisation_id uuid references organisations(id), role text, active boolean);
  create table patrol_routes (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references organisations(id),
    name text not null, code text, archived_at timestamp);
  create table patrol_sessions (
    id uuid primary key default gen_random_uuid(),
    route_id uuid references patrol_routes(id) on delete cascade);
  create table patrol_businesses (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references organisations(id),
    route_id uuid references patrol_routes(id) on delete cascade,
    session_id uuid references patrol_sessions(id) on delete set null);
  create table sign_inspections (
    id uuid primary key default gen_random_uuid(),
    business_id uuid references patrol_businesses(id) on delete cascade,
    patrol_route_id uuid references patrol_routes(id));
  create table inspection_photos (
    id uuid primary key default gen_random_uuid(),
    inspection_id uuid references sign_inspections(id) on delete cascade);

  create function get_user_org_id() returns uuid language sql stable security definer set search_path to 'public'
    as $$ select organisation_id from public.users where id = (select auth.uid()) and active = true limit 1; $$;
  create function is_current_user_admin() returns boolean language sql stable security definer set search_path to 'public'
    as $$ select exists (select 1 from public.users where id = (select auth.uid()) and active = true and role = 'admin'); $$;

  insert into organisations values ('${ORG}'), ('${OTHER_ORG}');
  insert into users values
    ('${ADMIN}', '${ORG}', 'admin', true),
    ('${SALES}', '${ORG}', 'sales', true),
    ('${INACTIVE_ADMIN}', '${ORG}', 'admin', false),
    ('${OTHER_ADMIN}', '${OTHER_ORG}', 'admin', true);
`;

const migration = readFileSync(new URL('../migrations/010_route_safe_delete.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../migrations/010_rollback.sql', import.meta.url), 'utf8');

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
});

const as = (uid: string | null) => db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);

async function route(code: string, org = ORG): Promise<string> {
  const r = await db.query<{ id: string }>(
    'insert into patrol_routes (organisation_id, name, code) values ($1, $2, $2) returning id', [org, code]);
  return r.rows[0].id;
}

async function deleteRoute(id: string, dryRun = false) {
  const r = await db.query<{ r: { status: string; sessions: number; businesses: number; signs: number } }>(
    'select delete_route_if_unused($1, $2) as r', [id, dryRun]);
  return r.rows[0].r;
}

const exists = async (id: string) =>
  (await db.query('select 1 from patrol_routes where id = $1', [id])).rows.length === 1;

test('a route with patrols is not deleted; the counts explain why', async () => {
  await as(ADMIN);
  const id = await route('AUR-01');
  const s = await db.query<{ id: string }>('insert into patrol_sessions (route_id) values ($1) returning id', [id]);
  const b = await db.query<{ id: string }>(
    'insert into patrol_businesses (organisation_id, session_id) values ($1, $2) returning id', [ORG, s.rows[0].id]);
  await db.query('insert into sign_inspections (business_id) values ($1)', [b.rows[0].id]);

  assert.deepEqual(await deleteRoute(id), { status: 'in_use', sessions: 1, businesses: 1, signs: 1 });
  assert.equal(await exists(id), true);
});

test('a route with no patrols but a PATROL v1 business (route_id) is not deleted', async () => {
  await as(ADMIN);
  const id = await route('BRAM-02');
  const b = await db.query<{ id: string }>(
    'insert into patrol_businesses (organisation_id, route_id) values ($1, $2) returning id', [ORG, id]);
  await db.query('insert into sign_inspections (business_id) values ($1)', [b.rows[0].id]);

  assert.deepEqual(await deleteRoute(id), { status: 'in_use', sessions: 0, businesses: 1, signs: 1 });
  assert.equal(await exists(id), true, 'the cascade would have taken the business and its signs');
});

test('a route referenced only by a sign record (patrol_route_id) is not deleted', async () => {
  await as(ADMIN);
  const id = await route('SIGN-ONLY');
  await db.query('insert into sign_inspections (patrol_route_id) values ($1)', [id]);

  assert.deepEqual(await deleteRoute(id), { status: 'in_use', sessions: 0, businesses: 0, signs: 1 });
  assert.equal(await exists(id), true);
});

test('a route with no patrols, businesses or signs: dry run keeps it, delete removes it', async () => {
  await as(ADMIN);
  const id = await route('NYC-01');

  assert.deepEqual(await deleteRoute(id, true), { status: 'deletable', sessions: 0, businesses: 0, signs: 0 });
  assert.equal(await exists(id), true, 'dry run never deletes');

  assert.deepEqual(await deleteRoute(id), { status: 'deleted', sessions: 0, businesses: 0, signs: 0 });
  assert.equal(await exists(id), false);
});

test('an archived unused route can be deleted too', async () => {
  await as(ADMIN);
  const id = await route('OLD-01');
  await db.query('update patrol_routes set archived_at = now() where id = $1', [id]);
  assert.equal((await deleteRoute(id)).status, 'deleted');
});

test('only an active admin of the route\'s organisation can delete it', async () => {
  const id = await route('GUARD-01');

  await as(SALES);
  await assert.rejects(deleteRoute(id), /only admins can delete routes/);
  await as(INACTIVE_ADMIN);
  await assert.rejects(deleteRoute(id), /only admins can delete routes/);
  await as(null);
  await assert.rejects(deleteRoute(id), /signed out/);
  await as(OTHER_ADMIN);
  await assert.rejects(deleteRoute(id), /not found in your organisation/);

  assert.equal(await exists(id), true);
});

test('an unknown route id is a readable error', async () => {
  await as(ADMIN);
  await assert.rejects(deleteRoute('00000000-0000-0000-0000-00000000ffff'), /not found in your organisation/);
});

test('anon cannot execute the function; authenticated can', async () => {
  const acl = await db.query<{ anon: boolean; authed: boolean; pub: boolean }>(`
    select has_function_privilege('anon', 'public.delete_route_if_unused(uuid, boolean)', 'execute') as anon,
           has_function_privilege('authenticated', 'public.delete_route_if_unused(uuid, boolean)', 'execute') as authed,
           has_function_privilege('public', 'public.delete_route_if_unused(uuid, boolean)', 'execute') as pub`);
  assert.deepEqual(acl.rows[0], { anon: false, authed: true, pub: false });
});

test('the rollback removes the function', async () => {
  const fresh = new PGlite();
  await fresh.exec(SCHEMA);
  await fresh.exec(migration);
  await fresh.exec(rollback);
  const r = await fresh.query(`select to_regprocedure('public.delete_route_if_unused(uuid, boolean)') as f`);
  assert.deepEqual(r.rows, [{ f: null }]);
  await fresh.close();
});

// ── What the admin reads (src/lib/routeDelete.ts) ───────────────────────────
import { describeRouteUse, routeDeleteDialog } from '../src/lib/routeDelete.ts';

const activeRoute = { code: 'AUR-01', name: 'Aurora loop', archived_at: null };

test('an unused route offers a permanent delete', () => {
  const d = routeDeleteDialog(activeRoute, { status: 'deletable', sessions: 0, businesses: 0, signs: 0 });
  assert.equal(d.action, 'delete');
  assert.equal(d.title, 'Delete AUR-01?');
  assert.match(d.message, /can't be undone/);
});

test('a route with data explains why and offers Archive instead', () => {
  const d = routeDeleteDialog(activeRoute, { status: 'in_use', sessions: 31, businesses: 3, signs: 5 });
  assert.equal(d.action, 'archive');
  assert.equal(d.title, "AUR-01 can't be deleted");
  assert.match(d.message, /^AUR-01 has 31 patrols, 3 businesses and 5 sign records, so it can't be deleted/);
  assert.match(d.message, /Archive it instead/);
});

test('an archived route with data only explains (nothing to confirm)', () => {
  const d = routeDeleteDialog({ ...activeRoute, archived_at: '2026-09-20T10:00:00' }, { status: 'in_use', sessions: 1, businesses: 0, signs: 0 });
  assert.equal(d.action, 'none');
  assert.match(d.message, /has 1 patrol, so/);
  assert.match(d.message, /already archived/);
});

test('usage text lists only non-zero counts with correct plurals', () => {
  assert.equal(describeRouteUse({ sessions: 0, businesses: 1, signs: 1 }), '1 business and 1 sign record');
  assert.equal(describeRouteUse({ sessions: 2, businesses: 0, signs: 0 }), '2 patrols');
});
