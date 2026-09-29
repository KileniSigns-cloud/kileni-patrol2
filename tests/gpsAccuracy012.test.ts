// Migration 012: GPS accuracy on patrol_businesses and leads, copied by the 005 trigger into
// new PATROL leads. Runs the repo's 005 then 012 against PGlite; the schema is the minimum the
// trigger touches (live columns checked 2026-09-29).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const ORG = '00000000-0000-0000-0000-00000000000a';

const SCHEMA = `
  create table organisations (id uuid primary key);
  insert into organisations values ('${ORG}');
  create table patrol_routes (id uuid primary key default gen_random_uuid(), organisation_id uuid references organisations(id));
  create table patrol_sessions (id uuid primary key default gen_random_uuid(), route_id uuid references patrol_routes(id));
  create table patrol_businesses (
    id uuid primary key default gen_random_uuid(), organisation_id uuid, session_id uuid,
    name text, address text, notes text, lat numeric, lng numeric);
  create table leads (
    id uuid primary key default gen_random_uuid(), source text, source_id uuid, organisation_id uuid,
    business_name text, address text, latitude double precision, longitude double precision, sign_type text,
    sign_category text, issue_type text, notes text, status text, photos jsonb, last_contact_date timestamptz,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table lead_activities (
    id uuid primary key default gen_random_uuid(), lead_id uuid, user_name text, type text, notes text, created_at timestamptz);
  create table sign_inspections (
    id uuid primary key default gen_random_uuid(), business_id uuid, patrol_type text,
    condition text[], sign_type text, sign_category text, notes text, patroller_name text);
  create table inspection_photos (id uuid primary key default gen_random_uuid(), inspection_id uuid, photo_url text);
`;

const read = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8').replace(/\r/g, '');
const m005 = read('005_one_patrol_lead_per_business.sql');
const m012 = read('012_gps_accuracy.sql');
const r012 = read('012_rollback.sql');

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(m005);
  await db.exec(m012);
  return db;
}

async function business(db: PGlite, p: { name: string; lat?: number; lng?: number; acc?: number | null }): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into patrol_businesses (organisation_id, name, lat, lng, gps_accuracy_m) values ($1, $2, $3, $4, $5) returning id`,
    [ORG, p.name, p.lat ?? null, p.lng ?? null, p.acc ?? null]);
  return r.rows[0].id;
}

const sign = (db: PGlite, businessId: string) =>
  db.query(`insert into sign_inspections (business_id, patrol_type, condition) values ($1, 'day', '{Faded}')`, [businessId]);

test('a new PATROL lead gets the business accuracy beside its lat/lng', async () => {
  const db = await freshDb();
  const b = await business(db, { name: 'Ceek', lat: 43.65, lng: -79.38, acc: 12 });
  await sign(db, b);
  const r = await db.query('select latitude, longitude, gps_accuracy_m from leads where source_id = $1', [b]);
  assert.deepEqual(r.rows, [{ latitude: 43.65, longitude: -79.38, gps_accuracy_m: 12 }]);
  await db.close();
});

test('a revisit within 150 m merges into the first lead, which keeps its first location and accuracy', async () => {
  const db = await freshDb();
  await sign(db, await business(db, { name: 'Ceek', lat: 43.65, lng: -79.38, acc: 80 }));
  await sign(db, await business(db, { name: 'CEEK', lat: 43.6501, lng: -79.3801, acc: 5 }));
  const r = await db.query('select latitude, gps_accuracy_m from leads');
  assert.deepEqual(r.rows, [{ latitude: 43.65, gps_accuracy_m: 80 }]);
  await db.close();
});

test('no accuracy recorded stays NULL; negative values are rejected on both tables', async () => {
  const db = await freshDb();
  await sign(db, await business(db, { name: 'NoAcc', lat: 43.65, lng: -79.38 }));
  assert.deepEqual((await db.query('select gps_accuracy_m from leads')).rows, [{ gps_accuracy_m: null }]);
  await assert.rejects(business(db, { name: 'Neg', acc: -1 }), /check constraint/);
  await assert.rejects(db.query(`insert into leads (source, gps_accuracy_m) values ('PATROL_QUICK_CATCH', -5)`), /check constraint/);
  // What QuickCatchPage inserts.
  await db.query(`insert into leads (source, latitude, longitude, gps_accuracy_m) values ('PATROL_QUICK_CATCH', 43.8, -79.4, 7)`);
  await db.close();
});

test('Quick Catch sign rows still skip the trigger', async () => {
  const db = await freshDb();
  await db.query(`insert into sign_inspections (business_id, patrol_type) values (null, 'quick_catch')`);
  assert.deepEqual((await db.query('select count(*)::int as n from leads')).rows, [{ n: 0 }]);
  await db.close();
});

test('rollback: the function is back to 005 first, then the columns go, and sign saves still work', async () => {
  const db = await freshDb();
  await db.exec(r012);
  const cols = await db.query(`select table_name from information_schema.columns where column_name = 'gps_accuracy_m'`);
  assert.deepEqual(cols.rows, []);
  const b = (await db.query<{ id: string }>(
    `insert into patrol_businesses (organisation_id, name, lat, lng) values ($1, 'After', 43.1, -79.1) returning id`, [ORG])).rows[0].id;
  await sign(db, b);
  assert.deepEqual((await db.query('select count(*)::int as n from leads where source_id = $1', [b])).rows, [{ n: 1 }]);
  await db.close();
});

// ── 012 must stay 005 plus the accuracy lines ───────────────────────────────

const fnBody = (sql: string) => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.patrol_lead_for_inspection()');
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
};

test('012 changes the 005 trigger function only by the accuracy lines', () => {
  const before = fnBody(m005).split('\n');
  const after = fnBody(m012).split('\n');
  const added = after.filter((l) => !before.includes(l));
  const removed = before.filter((l) => !after.includes(l));
  assert.deepEqual(added, [
    '  v_acc    integer;',
    '  v_acc  := b.gps_accuracy_m;',
    '      latitude, longitude, gps_accuracy_m, sign_type, sign_category, issue_type, notes, status',
    '      v_lat, v_lng, v_acc,',
  ]);
  assert.deepEqual(removed, [
    '      latitude, longitude, sign_type, sign_category, issue_type, notes, status',
    '      v_lat, v_lng,',
  ]);
});

test('012 rollback restores the exact 005 function', () => {
  assert.equal(fnBody(r012), fnBody(m005));
});
