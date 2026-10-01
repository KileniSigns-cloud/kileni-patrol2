// Migration 013: import_routes runs against a real Postgres (PGlite, in-process), fed by the real
// browser parser and docs/sample-routes-mis.csv. The schema is the live patrol_routes (13 columns,
// checked 2026-10-01) with copies of the live get_user_org_id / is_current_user_admin, and the
// live default privileges (new functions get EXECUTE for anon) that 013 must undo.
// auth.uid() reads the test.uid setting, standing in for the signed-in user's JWT.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { parseRouteCsv, type ImportRow } from '../src/lib/routeImport.ts';

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER_ORG = '00000000-0000-0000-0000-00000000000b';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const SALES = '00000000-0000-0000-0000-0000000000a2';
const INACTIVE_ADMIN = '00000000-0000-0000-0000-0000000000a3';
const OTHER_ADMIN = '00000000-0000-0000-0000-0000000000b1';

// The 27 non-null live codes (2026-10-01).
const LIVE_CODES = [
  'AUR-01', 'BRAM-02', 'BY-01', 'CON-01', 'DUF-01', 'EC-01', 'ETB-01', 'GD-01', 'GRID AP-01', 'GRID REX-01', 'HW-01',
  'LB-01', 'LEA-01', 'LI-01', 'LI-02', 'MARK-001', 'MARK-01', 'MC-01', 'NEW-01', 'NYC-01', 'QW-01', 'RH-01', 'SL-01',
  'STK-01', 'VMC-01', 'WDB-01', 'YN-01',
];

const SCHEMA = `
  create role anon; create role authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

  create table organisations (id uuid primary key);
  create table users (id uuid primary key, organisation_id uuid references organisations(id), role text, active boolean);
  create table patrol_routes (
    id uuid primary key default gen_random_uuid(),
    organisation_id uuid not null references organisations(id),
    name text not null, description text, assigned_rep uuid, created_at timestamptz default now(),
    code text, steps jsonb, hotspots jsonb, start_point text, area_type text, focus text,
    archived_at timestamp,
    constraint patrol_routes_org_code_unique unique (organisation_id, code));

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
  insert into patrol_routes (organisation_id, code, name, description, hotspots, steps, area_type)
    select '${ORG}', c, c || ' route', null, '["x"]', null, null from unnest(array[${LIVE_CODES.map((c) => `'${c}'`).join(', ')}]) c;
  update patrol_routes set description = 'keep me', steps = '[{"id":1,"label":"North on X"}]' where code = 'AUR-01';
  update patrol_routes set hotspots = '["Skyway Business Park, Airway Centre"]', steps = '[{"id":1,"label":"1.\\tNorth on Carlingview"}]',
    area_type = 'Aviation Logistics' where code = 'GRID AP-01';
  insert into patrol_routes (organisation_id, code, name, archived_at) values ('${ORG}', 'OLD-01', 'Old', now());
  insert into patrol_routes (organisation_id, code, name) values ('${ORG}', null, 'Downtown Route');
  insert into patrol_routes (organisation_id, code, name, hotspots) values ('${OTHER_ORG}', 'GRID MIS-01', 'Their route', '[]');
`;

const migration = readFileSync(new URL('../migrations/013_route_upsert.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../migrations/013_rollback.sql', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('../docs/sample-routes-mis.csv', import.meta.url), 'utf8');

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
});

type Plan = {
  status: string; fingerprint: string; created: number; updated: number; unchanged: number;
  routes: { row: number; code: string; route_id: string | null; action: string; changes: Record<string, { old: unknown; new: unknown }>; before: Record<string, unknown> | null }[];
  errors?: { row: number | null; error: string }[];
};

const as = (uid: string | null) => db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);
const call = async (rows: unknown, dry = true, fp: string | null = null): Promise<Plan> =>
  (await db.query<{ r: Plan }>('select import_routes($1::jsonb, $2, $3) as r', [JSON.stringify(rows), dry, fp])).rows[0].r;
const preview = (rows: unknown) => call(rows);
const apply = async (rows: unknown) => call(rows, false, (await preview(rows)).fingerprint);
const row = (n: number, code: string, patch: Partial<ImportRow> = {}): ImportRow => ({
  row: n, route_code: code, route_name: null, description: null, area_type: null, start_point: null,
  focus: null, hotspots: null, turn_by_turn: null, ...patch,
});
const routesOf = async (org = ORG) =>
  (await db.query(`select code, name, description, area_type, start_point, focus, hotspots, steps, archived_at
                   from patrol_routes where organisation_id = $1 order by code nulls first`, [org])).rows;
const one = async (code: string, org = ORG) =>
  (await db.query<Record<string, unknown>>('select * from patrol_routes where organisation_id = $1 and code = $2', [org, code])).rows[0];
const errorsOf = (p: Plan) => (p.errors ?? []).map((e) => `${e.row}: ${e.error}`);

const fixtureRows = () => {
  const parsed = parseRouteCsv(fixture, fixture.length);
  assert.deepEqual(parsed.errors, []);
  return parsed.rows;
};

test('fixture dry run: 4 NEW, every field listed, nothing written, other org ignored', async () => {
  await as(ADMIN);
  const before = await routesOf();
  const p = await preview(fixtureRows());
  assert.equal(p.status, 'preview');
  assert.deepEqual([p.created, p.updated, p.unchanged], [4, 0, 0]);
  assert.deepEqual(p.routes.map((r) => [r.row, r.code, r.action]),
    [[2, 'GRID MIS-01', 'new'], [3, 'GRID MIS-02', 'new'], [4, 'GRID MIS-03', 'new'], [5, 'GRID MIS-04', 'new']]);
  assert.deepEqual(Object.keys(p.routes[0].changes).sort(),
    ['area_type', 'description', 'focus', 'hotspots', 'route_name', 'start_point', 'turn_by_turn']);
  assert.equal(p.routes[0].before, null);
  assert.deepEqual(await routesOf(), before);
});

test('fixture apply: 4 routes with upper-case codes, steps [{id,label}] 6/7/8/8; re-import is UNCHANGED', async () => {
  await as(ADMIN);
  const done = await apply(fixtureRows());
  assert.equal(done.status, 'applied');
  assert.equal(done.created, 4);
  assert.ok(done.routes.every((r) => r.route_id));
  const mis1 = await one('GRID MIS-01');
  assert.equal(mis1.name, 'Lakeview Commercial & Marina Corridor');
  assert.deepEqual((mis1.steps as unknown[])[0], { id: 1, label: 'START: Head West on Lakeshore Rd E at Dixie Rd.' });
  assert.equal((mis1.hotspots as unknown[]).length, 4);
  const counts = await db.query<{ code: string; n: number }>(
    `select code, jsonb_array_length(steps) n from patrol_routes where organisation_id = $1 and code like 'GRID MIS-%' order by code`, [ORG]);
  assert.deepEqual(counts.rows.map((r) => r.n), [6, 7, 8, 8]);
  assert.equal((await one('GRID MIS-01', OTHER_ORG)).name, 'Their route');
  const again = await preview(fixtureRows());
  assert.deepEqual([again.created, again.updated, again.unchanged], [0, 0, 4]);
});

test('update: blank never erases, only changed fields written, codes matched ignoring case and spaces', async () => {
  await as(ADMIN);
  const mis1 = await one('GRID MIS-01');
  const rows = [
    row(2, '  grid   mis-01 ', { focus: 'New focus' }),
    row(3, 'Grid ap-01', { description: 'Added desc', hotspots: [], turn_by_turn: ['West on Belfield Rd'] }),
  ];
  const p = await preview(rows);
  assert.deepEqual(p.routes.map((r) => [r.code, r.action, Object.keys(r.changes).sort()]),
    [['GRID MIS-01', 'update', ['focus']], ['GRID AP-01', 'update', ['description', 'turn_by_turn']]]);
  assert.equal(p.routes[1].changes.description.old, null);
  assert.equal(p.routes[1].before?.code, 'GRID AP-01');
  await call(rows, false, p.fingerprint);
  const ap = await one('GRID AP-01');
  assert.equal(ap.area_type, 'Aviation Logistics');
  assert.deepEqual(ap.hotspots, ['Skyway Business Park, Airway Centre']);
  assert.deepEqual(ap.steps, [{ id: 1, label: 'West on Belfield Rd' }]);
  const m = await one('GRID MIS-01');
  assert.equal(m.focus, 'New focus');
  assert.equal(m.name, mis1.name);
  assert.deepEqual(m.steps, mis1.steps);
});

test('item 1: all 27 live codes pass the code rule and match their routes', async () => {
  await as(ADMIN);
  const p = await preview(LIVE_CODES.map((c, i) => row(i + 2, c.toLowerCase(), { focus: 'f' })));
  assert.equal(p.status, 'preview', JSON.stringify(p.errors));
  assert.equal(p.created, 0);
  assert.equal(p.updated + p.unchanged, 27);
});

test('item 1: codes are letters, digits, spaces and hyphens only', async () => {
  await as(ADMIN);
  const bad = ['A.B', 'A/B', 'A_B', 'A*B', '-AB', 'AB-', 'CAFÉ-1', 'X'.repeat(31), ''];
  const p = await preview(bad.map((c, i) => row(i + 2, c, { route_name: 'n' })));
  assert.equal(p.status, 'invalid');
  assert.deepEqual(errorsOf(p), [
    '2: route_code can only use letters, digits, spaces and hyphens',
    '3: route_code can only use letters, digits, spaces and hyphens',
    '4: route_code can only use letters, digits, spaces and hyphens',
    '5: route_code can only use letters, digits, spaces and hyphens',
    '6: route_code can only use letters, digits, spaces and hyphens',
    '7: route_code can only use letters, digits, spaces and hyphens',
    '8: route_code can only use letters, digits, spaces and hyphens',
    '9: route_code is over 30 characters',
    '10: route_code is required',
  ]);
  const ok = await preview([row(2, 'new  route-9', { route_name: 'n' })]);
  assert.deepEqual(ok.routes.map((r) => [r.code, r.action]), [['NEW ROUTE-9', 'new']]);
});

test('archived code rejects the whole file, every row listed, nothing written', async () => {
  await as(ADMIN);
  const rows = [row(2, 'NEW-99', { route_name: 'Brand new' }), row(3, 'old-01', { focus: 'x' }), row(7, 'OLD-01 ', { focus: 'y' })];
  const p = await preview(rows);
  assert.equal(p.status, 'invalid');
  assert.deepEqual(errorsOf(p), [
    '3: route OLD-01 is archived. Restore it on Manage routes first, or remove it from the file',
    '3: route_code OLD-01 is on more than one row (rows 3, 7)',
    '7: route OLD-01 is archived. Restore it on Manage routes first, or remove it from the file',
    '7: route_code OLD-01 is on more than one row (rows 3, 7)',
  ]);
  const before = await routesOf();
  await assert.rejects(call(rows, false, 'x'), /Import failed: 4 problem\(s\) in the file\. Nothing was changed\./);
  assert.deepEqual(await routesOf(), before);
});

test('every row problem at once: duplicates after normalising, new route without name, caps', async () => {
  await as(ADMIN);
  const p = await preview([
    row(2, 'Grid MIS-05', { route_name: 'A' }),
    row(3, 'GRID  mis-05', { route_name: 'B' }),
    row(4, 'NEW-77'),
    row(8, 'LONG-01', { route_name: 'x'.repeat(101), focus: 'f'.repeat(1001), hotspots: ['h'.repeat(151)], turn_by_turn: Array(51).fill('s') }),
  ]);
  assert.deepEqual(errorsOf(p), [
    '2: route_code GRID MIS-05 is on more than one row (rows 2, 3)',
    '3: route_code GRID MIS-05 is on more than one row (rows 2, 3)',
    '4: route_name is required for a new route',
    '8: each hotspot must be 1 to 150 characters',
    '8: focus is over 1000 characters',
    '8: more than 50 turn-by-turn steps',
    '8: route_name is over 100 characters',
  ]);
});

test('item 4: zero-width, direction marks, separators and BOM are rejected in every text field', async () => {
  await as(ADMIN);
  const cps = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0xfeff, 0x202e, 0x2066, 0x07];
  const rows: ImportRow[] = [];
  let n = 2;
  for (const cp of cps) {
    const c = String.fromCodePoint(cp);
    rows.push(row(n++, `INV-${n}`, { route_name: `a${c}b` }));
    rows.push(row(n++, `INV-${n}`, { route_name: 'ok', description: `a${c}b` }));
    rows.push(row(n++, `INV-${n}`, { route_name: 'ok', hotspots: [`a${c}b`] }));
    rows.push(row(n++, `INV-${n}`, { route_name: 'ok', turn_by_turn: [`a${c}b`] }));
  }
  const p = await preview(rows);
  assert.equal(p.status, 'invalid');
  const byRow = new Map<number, string[]>();
  for (const e of p.errors ?? []) byRow.set(e.row as number, [...(byRow.get(e.row as number) ?? []), e.error]);
  assert.equal(byRow.size, rows.length, 'every row has an error');
  for (const [r, errs] of byRow) assert.equal(errs.length, 1, `row ${r}: ${errs.join(' | ')}`);
  // Allowed: line breaks in description/focus, a tab in focus, ordinary accents and symbols.
  const ok = await preview([row(2, 'OK-1', { route_name: 'Café & Co <b>', description: 'a\nb', focus: 'tab\there' })]);
  assert.equal(ok.status, 'preview', JSON.stringify(ok.errors));
});

test('line breaks rejected in one-line fields, hotspots and steps', async () => {
  await as(ADMIN);
  const p = await preview([
    row(2, 'LB-2', { route_name: 'two\nlines' }),
    row(3, 'LB-3', { route_name: 'ok', start_point: 'a\rb' }),
    row(4, 'LB-4', { route_name: 'ok', hotspots: ['a\nb'] }),
    row(5, 'LB-5', { route_name: 'ok', turn_by_turn: ['a\nb'] }),
  ]);
  assert.deepEqual(p.errors?.map((e) => e.row), [2, 3, 4, 5]);
});

test('plain text is stored verbatim ("&", "<b>", <script>)', async () => {
  await as(ADMIN);
  await apply([row(2, 'SEC-01', { route_name: 'Tim & Co <b>bold</b>', focus: 'Signs & <script>alert(1)</script>', hotspots: ['Plaza & <b>Mall</b>'], turn_by_turn: ['Turn <b>LEFT</b> & go'] })]);
  const r = await one('SEC-01');
  assert.equal(r.name, 'Tim & Co <b>bold</b>');
  assert.equal(r.focus, 'Signs & <script>alert(1)</script>');
  assert.deepEqual(r.hotspots, ['Plaza & <b>Mall</b>']);
  assert.deepEqual(r.steps, [{ id: 1, label: 'Turn <b>LEFT</b> & go' }]);
});

test('apply refuses a stale preview, a changed payload, or no fingerprint', async () => {
  await as(ADMIN);
  const rows = [row(2, 'GRID AP-01', { focus: 'Stale test' })];
  const p = await preview(rows);
  await db.query(`update patrol_routes set focus = 'someone else' where code = 'GRID AP-01'`);
  await assert.rejects(call(rows, false, p.fingerprint), /changed since the preview/);
  await assert.rejects(call(rows, false, null), /changed since the preview/);
  const p2 = await preview(rows);
  await assert.rejects(call([row(2, 'GRID AP-01', { focus: 'Different' })], false, p2.fingerprint), /changed since the preview/);
  assert.equal((await one('GRID AP-01')).focus, 'someone else');
});

test('a failure part-way rolls back everything already written', async () => {
  await as(ADMIN);
  await db.exec(`create function boom() returns trigger language plpgsql as $$
    begin if new.code = 'ZZ-02' then raise exception 'boom'; end if; return new; end $$;
    create trigger t_boom before insert on patrol_routes for each row execute function boom();`);
  try {
    const rows = [row(2, 'ZZ-01', { route_name: 'a' }), row(3, 'ZZ-02', { route_name: 'b' }), row(4, 'AUR-01', { focus: 'should not stick' })];
    await assert.rejects(apply(rows), /boom/);
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from patrol_routes where code like 'ZZ-%'`)).rows[0].n, 0);
    assert.equal((await one('AUR-01')).focus, null);
  } finally {
    await db.exec('drop trigger t_boom on patrol_routes; drop function boom();');
  }
});

test('item 2: a code collision on insert never echoes the key', async () => {
  await as(ADMIN);
  // Stands in for a route created from the form between the preview and the insert.
  await db.exec(`create function collide() returns trigger language plpgsql as $$
    begin raise unique_violation using message = 'duplicate key value violates unique constraint "patrol_routes_org_code_unique"',
      detail = 'Key (organisation_id, code)=(${OTHER_ORG}, SECRET-CODE) already exists.'; end $$;
    create trigger t_collide before insert on patrol_routes for each row execute function collide();`);
  try {
    const err = await apply([row(2, 'CLASH-01', { route_name: 'x' })]).then(() => null, (e: unknown) => e as { message: string; code?: string; detail?: string });
    assert.ok(err, 'apply should fail');
    assert.equal(err.message, 'Import failed: a route code in the file was taken while importing. Nothing was changed. Preview again.');
    assert.equal(err.code, '23505');
    assert.ok(!JSON.stringify(err).includes('SECRET-CODE'));
    assert.ok(!JSON.stringify(err).includes(OTHER_ORG));
  } finally {
    await db.exec('drop trigger t_collide on patrol_routes; drop function collide();');
  }
});

test('item 2: codes are unique per organisation, so another org with the same code is a different route', async () => {
  await as(OTHER_ADMIN);
  const p = await preview([row(2, 'AUR-01', { route_name: 'Their AUR' })]);
  assert.deepEqual(p.routes.map((r) => r.action), ['new']);
  await call([row(2, 'AUR-01', { route_name: 'Their AUR' })], false, p.fingerprint);
  assert.equal((await one('AUR-01', OTHER_ORG)).name, 'Their AUR');
  assert.equal((await one('AUR-01')).name, 'AUR-01 route');
});

test('item 3: same-named tables in public cannot capture the work tables', async () => {
  await db.exec(`create table public.route_csv_import (row_no integer, code text, route_id uuid);
                 create table public.route_csv_plan (row_no integer, code text, route_id uuid, action text);`);
  try {
    await as(ADMIN);
    const done = await apply([row(2, 'DECOY-01', { route_name: 'Decoy test' }), row(3, 'AUR-01', { area_type: 'Industrial' })]);
    assert.deepEqual([done.created, done.updated], [1, 1]);
    assert.equal((await one('DECOY-01')).name, 'Decoy test');
    assert.equal((await one('AUR-01')).area_type, 'Industrial');
    const decoys = await db.query<{ n: number }>('select (select count(*) from public.route_csv_import) + (select count(*) from public.route_csv_plan) as n');
    assert.equal(Number(decoys.rows[0].n), 0);
    const src = (await db.query<{ s: string }>(`select prosrc s from pg_proc where proname = 'import_routes'`)).rows[0].s;
    assert.ok(!/(?<!pg_temp\.)\broute_csv_(import|plan)\b/.test(src), 'every work-table reference is pg_temp-qualified');
  } finally {
    await db.exec('drop table public.route_csv_import; drop table public.route_csv_plan;');
  }
});

test('guards: signed out, sales, inactive admin are refused', async () => {
  const rows = [row(2, 'AUR-01', { focus: 'nope' })];
  await as(null);
  await assert.rejects(preview(rows), /signed out/);
  await as(SALES);
  await assert.rejects(preview(rows), /only admins/);
  await as(INACTIVE_ADMIN);
  await assert.rejects(preview(rows), /only admins/);
  await as(ADMIN);
});

test('shape and caps: [], {}, non-object rows, 501 rows, 2 MB; 500 rows work', async () => {
  await as(ADMIN);
  await assert.rejects(preview([]), /1 to 500/);
  await assert.rejects(db.query(`select import_routes('{}'::jsonb)`), /expected a list/);
  await assert.rejects(preview([1]), /must be an object/);
  const many = Array.from({ length: 501 }, (_, i) => row(i + 2, `BULK-${i}`, { route_name: 'n' }));
  await assert.rejects(preview(many), /1 to 500 routes \(it has 501\)/);
  await assert.rejects(preview([row(2, 'BIG-01', { route_name: 'x', description: 'd'.repeat(2_000_001) })]), /too large/);
  const done = await apply(many.slice(0, 500));
  assert.equal(done.created, 500);
});

test('EXECUTE: authenticated only, despite the default privileges', async () => {
  const acl = (await db.query<{ a: string }>(`select array_to_string(proacl, ',') a from pg_proc where proname = 'import_routes'`)).rows[0].a;
  assert.ok(/authenticated=X/.test(acl), acl);
  assert.ok(!/anon=/.test(acl) && !/(^|,)=X/.test(acl), acl);
  await db.exec('set role anon');
  try {
    await assert.rejects(db.query(`select import_routes('[]'::jsonb)`), /permission denied/);
  } finally {
    await db.exec('reset role');
  }
});

test('013 is plain ASCII (no invisible characters in the migration itself)', () => {
  // Tab, LF and CR (a Windows checkout with core.autocrlf) are fine; nothing else outside ASCII.
  const odd = [...migration].filter((c) => c !== '\t' && c !== '\n' && c !== '\r' && (c < ' ' || c > '~'));
  assert.deepEqual(odd, []);
});

test('rollback drops the function; routes stay', async () => {
  const n = (await db.query<{ n: number }>('select count(*)::int n from patrol_routes')).rows[0].n;
  await db.exec(rollback);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from pg_proc where proname = 'import_routes'`)).rows[0].n, 0);
  assert.equal((await db.query<{ n: number }>('select count(*)::int n from patrol_routes')).rows[0].n, n);
});
