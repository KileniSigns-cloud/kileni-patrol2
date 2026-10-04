// Migration 014 (zones on patrol_routes) in PGlite against the live schema: guard, column
// checks, normalised per-organisation code uniqueness, RLS and the narrowed grants, rollback.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, OTHER_ADMIN, OTHER_ORG, ORG, SALES, nonAscii, readMigration, runAs, zoneDb } from './helpers/zoneDb.ts';

const migration = readMigration('014_zones.sql');
const rollback = readMigration('014_rollback.sql');

const C4 = [{ label: 'Dufferin & Steeles' }, { label: 'Keele & Steeles' }, { label: 'Keele & Hwy 7' }, { label: 'Dufferin & Centre Street' }];

let db: PGlite;
before(async () => { db = await zoneDb('014_zones.sql'); });

const insert = (uid: string, code: string | null, patch: { corners?: unknown; anchors?: unknown; est?: number | null; org?: string; name?: string } = {}) =>
  runAs(db, 'authenticated', uid,
    `insert into patrol_routes (organisation_id, code, name, area_type, corners, anchors, est_minutes)
     values ($1, $2, $3, 'Mixed', $4::jsonb, $5::jsonb, $6) returning id`,
    [patch.org ?? ORG, code, patch.name ?? 'Concord', JSON.stringify(patch.corners ?? C4),
      patch.anchors === undefined ? null : JSON.stringify(patch.anchors), patch.est ?? null]);

const sqlState = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');

test('guard: a row that breaks the rules stops 014 and nothing changes', async () => {
  for (const bad of [`(null, 'Downtown Route')`, `('con-01', 'Lower')`, `('CON  01', 'Two spaces')`]) {
    const d = await zoneDb();
    await d.exec(`insert into patrol_routes (organisation_id, code, name) values ('${ORG}', ${bad.slice(1, -1)})`);
    await assert.rejects(d.exec(migration), /014 stopped/, bad);
    await d.exec('rollback');
    const cols = await d.query<{ n: number }>(`select count(*)::int n from information_schema.columns where table_name = 'patrol_routes' and column_name = 'corners'`);
    assert.equal(cols.rows[0].n, 0, bad);
  }
});

test('re-running 014 is harmless', async () => {
  const d = await zoneDb('014_zones.sql', '014_zones.sql');
  const n = await d.query<{ n: number }>(`select count(*)::int n from pg_constraint where conrelid = 'patrol_routes'::regclass and contype = 'c'`);
  assert.equal(n.rows[0].n, 7);
});

test('valid zones: 4 corners; 8 corners with mixed GPS, a southern-hemisphere point and anchors', async () => {
  assert.equal(await sqlState(insert(ADMIN, 'CON-01')), 'ok');
  assert.equal(await sqlState(insert(ADMIN, 'CON-02', {
    corners: [{ label: 'A', lat: 43.79, lng: -79.47 }, { label: 'B' }, { label: 'C', lat: -33.8, lng: 151.2 }, { label: 'D' },
      { label: 'E' }, { label: 'F' }, { label: 'G' }, { label: 'H' }],
    anchors: [{ name: 'Plaza', address: '1 Main St' }, { name: 'Depot' }],
    est: 90,
  })), 'ok');
});

test('corners: shape, count, ranges and text are checked (23514)', async () => {
  const cases: Record<string, unknown> = {
    '3 corners': C4.slice(0, 3),
    '9 corners': Array.from({ length: 9 }, (_, i) => ({ label: `C${i}` })),
    'lat 91': [{ label: 'A', lat: 91, lng: 0 }, ...C4.slice(1)],
    'lat -90.0001': [{ label: 'A', lat: -90.0001, lng: 0 }, ...C4.slice(1)],
    'lng 180.5': [{ label: 'A', lat: 1, lng: 180.5 }, ...C4.slice(1)],
    'lat without lng': [{ label: 'A', lat: 1 }, ...C4.slice(1)],
    'lat as text': [{ label: 'A', lat: '43.7', lng: -79 }, ...C4.slice(1)],
    'lat null': [{ label: 'A', lat: null, lng: null }, ...C4.slice(1)],
    'extra key': [{ label: 'A', url: 'javascript:alert(1)' }, ...C4.slice(1)],
    'blank label': [{ label: '  ' }, ...C4.slice(1)],
    'untrimmed label': [{ label: ' A' }, ...C4.slice(1)],
    'line break': [{ label: 'A\nB' }, ...C4.slice(1)],
    'bidi override': [{ label: `A${String.fromCodePoint(0x202e)}B` }, ...C4.slice(1)],
    'pipe': [{ label: 'A | B' }, ...C4.slice(1)],
    '101 characters': [{ label: 'x'.repeat(101) }, ...C4.slice(1)],
    'not an object': ['A', ...C4.slice(1)],
    'not a list': { label: 'A' },
  };
  let n = 10;
  for (const [name, corners] of Object.entries(cases)) {
    assert.equal(await sqlState(insert(ADMIN, `BAD-${n++}`, { corners })), '23514', name);
  }
});

test('anchors and est_minutes are checked (23514)', async () => {
  assert.equal(await sqlState(insert(ADMIN, 'BAD-50', { anchors: [{ address: 'no name' }] })), '23514');
  assert.equal(await sqlState(insert(ADMIN, 'BAD-51', { anchors: Array.from({ length: 31 }, (_, i) => ({ name: `A${i}` })) })), '23514');
  assert.equal(await sqlState(insert(ADMIN, 'BAD-52', { anchors: [{ name: 'A', address: `x${String.fromCodePoint(0x200b)}y` }] })), '23514');
  assert.equal(await sqlState(insert(ADMIN, 'BAD-53', { est: 0 })), '23514');
  assert.equal(await sqlState(insert(ADMIN, 'BAD-54', { est: 1441 })), '23514');
});

test('codes: stored normalised only, required, unique per organisation', async () => {
  for (const code of ['con-01', ' CON-01', 'CON  01', 'CON_01', 'X'.repeat(31), '-CON']) {
    assert.equal(await sqlState(insert(ADMIN, code)), '23514', code);
  }
  assert.equal(await sqlState(insert(ADMIN, null)), '23502');
  assert.equal(await sqlState(insert(ADMIN, 'CON-01')), '23505');
  assert.equal(await sqlState(insert(OTHER_ADMIN, 'CON-01', { org: OTHER_ORG })), 'ok');
});

test('normalised index: look-alike codes collide even without the format check', async () => {
  const d = await zoneDb('014_zones.sql');
  await d.exec('alter table patrol_routes drop constraint patrol_routes_code_format');
  await d.exec(`insert into patrol_routes (organisation_id, code, name) values ('${ORG}', ' con  01 ', 'x')`);
  await assert.rejects(d.exec(`insert into patrol_routes (organisation_id, code, name) values ('${ORG}', 'CON 01', 'y')`), /duplicate key/);
});

test('RLS: admins of the organisation only; no moving zones between organisations', async () => {
  assert.equal(await sqlState(insert(SALES, 'CON-09')), '42501');
  assert.equal(await sqlState(insert(ADMIN, 'CON-09', { org: OTHER_ORG })), '42501');
  const seen = await runAs(db, 'authenticated', ADMIN, 'select code from patrol_routes order by code');
  assert.deepEqual(seen.rows.map((r) => r.code), ['CON-01', 'CON-02']);
  assert.equal(await sqlState(runAs(db, 'authenticated', ADMIN, `update patrol_routes set organisation_id = '${OTHER_ORG}' where code = 'CON-01'`)), '42501');
  const retired = await runAs(db, 'authenticated', ADMIN, `update patrol_routes set archived_at = now() where code = 'CON-01' returning id`);
  assert.equal(retired.rows.length, 1);
});

test('grants: anon has nothing; authenticated cannot DELETE or TRUNCATE; anon cannot call the validators', async () => {
  assert.equal(await sqlState(runAs(db, 'anon', null, 'select * from patrol_routes')), '42501');
  assert.equal(await sqlState(runAs(db, 'authenticated', ADMIN, 'delete from patrol_routes')), '42501');
  assert.equal(await sqlState(runAs(db, 'authenticated', ADMIN, 'truncate patrol_routes cascade')), '42501');
  assert.equal(await sqlState(runAs(db, 'anon', null, `select public.patrol_zone_corners_ok('[]'::jsonb)`)), '42501');
  const grants = await db.query<{ g: string; p: string }>(
    `select grantee g, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants
      where table_name = 'patrol_routes' and grantee in ('anon', 'authenticated') group by 1`);
  assert.deepEqual(grants.rows, [{ g: 'authenticated', p: 'INSERT,SELECT,UPDATE' }]);
});

test('014 and its rollback are plain ASCII', () => {
  assert.deepEqual(nonAscii(migration), []);
  assert.deepEqual(nonAscii(rollback), []);
});

test('rollback removes everything 014 added; 014 applies again afterwards', async () => {
  const d = await zoneDb('014_zones.sql');
  await d.exec(rollback);
  const q = async (sql: string) => (await d.query<{ n: number }>(sql)).rows[0].n;
  assert.equal(await q(`select count(*)::int n from information_schema.columns where table_name = 'patrol_routes'`), 13);
  assert.equal(await q(`select count(*)::int n from pg_constraint where conrelid = 'patrol_routes'::regclass and contype = 'c'`), 0);
  assert.equal(await q(`select count(*)::int n from pg_proc where proname like 'patrol_zone_%'`), 0);
  assert.equal(await q(`select count(*)::int n from pg_indexes where indexname = 'uq_patrol_routes_org_code_norm'`), 0);
  await d.exec(migration);
});
