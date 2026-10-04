// Migration 015: import_zones runs against a real Postgres (PGlite, in-process) with 013 and
// 014 applied first, as in production, fed by the real browser parser and docs/sample-zones.csv.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { parseZoneCsv, type ImportRow } from '../src/lib/zoneImport.ts';
import { ADMIN, INACTIVE_ADMIN, OTHER_ADMIN, OTHER_ORG, ORG, SALES, nonAscii, readMigration, zoneDb } from './helpers/zoneDb.ts';

const migration = readMigration('015_zone_import.sql');
const rollback = readMigration('015_rollback.sql');
const fixture = readFileSync(new URL('../docs/sample-zones.csv', import.meta.url), 'utf8');

let db: PGlite;
before(async () => { db = await zoneDb('013_route_upsert.sql', '014_zones.sql', '015_zone_import.sql'); });

type Plan = {
  status: string; fingerprint: string; created: number; updated: number; unchanged: number;
  zones: { row: number; code: string; route_id: string | null; action: string; changes: Record<string, { old: unknown; new: unknown }>; before: Record<string, unknown> | null }[];
  errors?: { row: number | null; error: string }[];
};

const as = (uid: string | null) => db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);
const call = async (rows: unknown, dry = true, fp: string | null = null): Promise<Plan> =>
  (await db.query<{ r: Plan }>('select import_zones($1::jsonb, $2, $3) as r', [JSON.stringify(rows), dry, fp])).rows[0].r;
const preview = (rows: unknown) => call(rows);
const apply = async (rows: unknown) => call(rows, false, (await preview(rows)).fingerprint);
const C4 = [{ label: 'A & 1st' }, { label: 'B & 1st' }, { label: 'B & 2nd' }, { label: 'A & 2nd' }];
const row = (n: number, code: string, patch: Partial<Record<keyof ImportRow, unknown>> = {}) => ({
  row: n, zone_code: code, zone_name: null, area_type: null, corners: null, anchors: null, focus: null,
  est_minutes: null, status: null, ...patch,
});
const newRow = (n: number, code: string, patch: Partial<Record<keyof ImportRow, unknown>> = {}) =>
  row(n, code, { zone_name: `Zone ${n}`, area_type: 'Mixed', corners: C4, ...patch });
const one = async (code: string, org = ORG) =>
  (await db.query<Record<string, unknown>>('select * from patrol_routes where organisation_id = $1 and code = $2', [org, code])).rows[0];
const all = async (org = ORG) =>
  (await db.query('select code, name, area_type, corners, anchors, focus, est_minutes, archived_at from patrol_routes where organisation_id = $1 order by code', [org])).rows;
const errorsOf = (p: Plan) => (p.errors ?? []).map((e) => `${e.row}: ${e.error}`);
const fixtureRows = () => {
  const parsed = parseZoneCsv(fixture, fixture.length);
  assert.deepEqual(parsed.errors, []);
  return parsed.rows;
};

test('015 drops import_routes (013) and creates import_zones for authenticated only', async () => {
  const fns = await db.query<{ proname: string; acl: string; def: boolean; cfg: string[] }>(
    `select proname, array_to_string(proacl, ',') acl, prosecdef def, proconfig cfg from pg_proc where proname in ('import_routes', 'import_zones')`);
  assert.deepEqual(fns.rows.map((f) => f.proname), ['import_zones']);
  const f = fns.rows[0];
  assert.equal(f.def, true);
  assert.deepEqual(f.cfg, ['search_path=public, pg_temp']);
  assert.ok(/authenticated=X/.test(f.acl), f.acl);
  assert.ok(!/anon=/.test(f.acl) && !/(^|,)=X/.test(f.acl), f.acl);
  await db.exec('set role anon');
  try {
    await assert.rejects(db.query(`select import_zones('[]'::jsonb)`), /permission denied/);
  } finally {
    await db.exec('reset role');
  }
});

test('fixture CON-01: dry run NEW with every field, nothing written', async () => {
  await as(ADMIN);
  const p = await preview(fixtureRows());
  assert.equal(p.status, 'preview');
  assert.deepEqual([p.created, p.updated, p.unchanged], [1, 0, 0]);
  assert.deepEqual(p.zones.map((z) => [z.row, z.code, z.action]), [[2, 'CON-01', 'new']]);
  assert.deepEqual(Object.keys(p.zones[0].changes).sort(), ['area_type', 'corners', 'zone_name']);
  assert.deepEqual(await all(), []);
});

test('fixture CON-01 apply: 4 corners, no GPS, active; re-import is UNCHANGED', async () => {
  await as(ADMIN);
  const done = await apply(fixtureRows());
  assert.equal(done.status, 'applied');
  assert.equal(done.created, 1);
  assert.ok(done.zones[0].route_id);
  const z = await one('CON-01');
  assert.equal(z.name, 'Concord, Dufferin to Keele');
  assert.equal(z.area_type, 'Mixed');
  assert.deepEqual(z.corners, [
    { label: 'Dufferin & Steeles, Concord ON' }, { label: 'Keele & Steeles, Concord ON' },
    { label: 'Keele & Hwy 7, Concord ON' }, { label: 'Dufferin & Centre Street, Concord ON' },
  ]);
  assert.equal(z.anchors, null);
  assert.equal(z.archived_at, null);
  assert.deepEqual(z.steps, null);
  assert.deepEqual(z.hotspots, null);
  const again = await preview(fixtureRows());
  assert.deepEqual([again.created, again.updated, again.unchanged], [0, 0, 1]);
});

test('update: blank never erases; corners replace as a unit; GPS rounded to 6 decimals; codes matched loosely', async () => {
  await as(ADMIN);
  await apply([newRow(2, 'UPD-01', { anchors: [{ name: 'Plaza', address: '1 Main St' }], focus: 'Old focus', est_minutes: '45' })]);
  const corners = [
    { label: '  A   &  1st ', lat: 43.12345678, lng: -79.98765432 }, { label: 'B & 1st' }, { label: 'B & 2nd' }, { label: 'A & 2nd' }, { label: 'C & 3rd' },
  ];
  const rows = [row(2, '  upd-01 ', { corners, focus: 'New\r\nfocus  ' })];
  const p = await preview(rows);
  assert.deepEqual(p.zones.map((z) => [z.code, z.action, Object.keys(z.changes).sort()]), [['UPD-01', 'update', ['corners', 'focus']]]);
  assert.equal(p.zones[0].before?.code, 'UPD-01');
  await call(rows, false, p.fingerprint);
  const z = await one('UPD-01');
  assert.deepEqual(z.corners, [{ label: 'A & 1st', lat: 43.123457, lng: -79.987654 }, ...corners.slice(1)]);
  assert.equal(z.focus, 'New\nfocus');
  assert.deepEqual(z.anchors, [{ name: 'Plaza', address: '1 Main St' }]);
  assert.equal(z.est_minutes, 45);
  assert.equal(z.name, 'Zone 2');
});

test('status: retired sets archived_at once, active clears it, blank keeps it; a retired zone can be updated', async () => {
  await as(ADMIN);
  await apply([newRow(2, 'ST-01')]);
  const retire = await preview([row(2, 'ST-01', { status: 'Retired' })]);
  assert.deepEqual(retire.zones[0].changes.status, { old: 'active', new: 'retired' });
  await call([row(2, 'ST-01', { status: 'Retired' })], false, retire.fingerprint);
  const at = (await one('ST-01')).archived_at;
  assert.ok(at);
  await apply([row(2, 'ST-01', { focus: 'still retired' })]);
  assert.deepEqual((await one('ST-01')).archived_at, at);
  assert.deepEqual((await preview([row(2, 'ST-01', { status: 'retired' })])).zones[0].action, 'unchanged');
  await apply([row(2, 'ST-01', { status: 'active' })]);
  assert.equal((await one('ST-01')).archived_at, null);
  await apply([newRow(2, 'ST-02', { status: 'retired' })]);
  assert.ok((await one('ST-02')).archived_at);
});

test('a new zone needs name, area type and 4 corners; name may not contain the code', async () => {
  await as(ADMIN);
  const p = await preview([
    row(2, 'NEW-01'),
    newRow(3, 'NEW-02', { zone_name: 'NEW-02: Concord' }),
    newRow(4, 'NEW-03', { zone_name: 'new 03 Concord' }),
    newRow(5, 'NEW-04', { zone_name: 'Renewed 04 strip' }),
    newRow(6, 'NEW-05', { corners: C4.slice(0, 3) }),
  ]);
  assert.deepEqual(errorsOf(p), [
    '2: area_type is required for a new zone',
    '2: corners are required for a new zone (4 to 8)',
    '2: zone_name is required for a new zone',
    '3: zone_name contains the code NEW-02: leave the code out of the name',
    '4: zone_name contains the code NEW-03: leave the code out of the name',
    '6: at least 4 corners are required (found 3)',
  ]);
});

test('codes with regex characters are reported per row (dry run, status invalid), never an exception', async () => {
  await as(ADMIN);
  const p = await preview([
    newRow(2, 'A(', { zone_name: 'A( Concord' }),
    newRow(3, '(a+)+', { zone_name: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!' }),
    newRow(4, 'A[', { zone_name: 'Zone A[' }),
    newRow(5, 'A\\1', { zone_name: 'Zone' }),
  ]);
  assert.equal(p.status, 'invalid');
  assert.deepEqual(errorsOf(p), [
    '2: zone_code can only use letters, digits, spaces and hyphens',
    '3: zone_code can only use letters, digits, spaces and hyphens',
    '4: zone_code can only use letters, digits, spaces and hyphens',
    '5: zone_code can only use letters, digits, spaces and hyphens',
  ]);
  const src = (await db.query<{ s: string }>(`select prosrc s from pg_proc where proname = 'import_zones'`)).rows[0].s;
  assert.match(src, /THEN CASE WHEN upper\(i\.name\) ~/, 'the name regex is nested under the validated-code CASE');
});

test('corner, anchor, est_minutes and status problems are listed per element', async () => {
  await as(ADMIN);
  const p = await preview([newRow(2, 'BAD-01', {
    corners: [{ label: 'A', lat: 91, lng: 0 }, { label: 'B | C' }, { label: '' }, { label: 'D', lat: 1 },
      { label: 'E', lat: '1', lng: 2 }, { label: 'F', url: 'javascript:alert(1)' }, 'G', { label: 'x'.repeat(101) }],
    anchors: [{ address: 'no name' }, { name: 'n'.repeat(151) }, { name: 'ok', address: 7 }],
    est_minutes: '0', status: 'gone',
  }), newRow(3, 'BAD-02', { corners: Array.from({ length: 9 }, (_, i) => ({ label: `C${i}` })), est_minutes: '1.5' }),
  newRow(4, 'BAD-03', { corners: { label: 'A' }, anchors: 'Plaza' })]);
  assert.deepEqual(errorsOf(p), [
    '2: anchor 1: name is required',
    '2: anchor 2: name is over 150 characters',
    '2: anchor 3: address must be text',
    '2: corner 1: GPS latitude must be between -90 and 90',
    '2: corner 2: "|" is not allowed (Google Maps uses it to separate stops)',
    '2: corner 3: the intersection is required',
    '2: corner 4: GPS needs both lat and lng',
    '2: corner 5: GPS lat and lng must be numbers',
    '2: corner 6: only label, lat and lng are allowed',
    '2: corner 7: must be an object',
    '2: corner 8: over 100 characters',
    '2: est_minutes must be between 1 and 1440',
    '2: status must be active or retired (or blank to keep it)',
    '3: at most 8 corners',
    '3: est_minutes must be a whole number of minutes',
    '4: anchors must be a list',
    '4: corners must be a list',
  ]);
});

test('invisible and control characters are rejected in every text value', async () => {
  await as(ADMIN);
  const rows: unknown[] = [];
  let n = 2;
  for (const cp of [0x200b, 0x200f, 0x2028, 0x2029, 0xfeff, 0x202e, 0x2066, 0x07]) {
    const c = String.fromCodePoint(cp);
    rows.push(newRow(n, `INV-${n++}`, { zone_name: `a${c}b` }));
    rows.push(newRow(n, `INV-${n++}`, { area_type: `a${c}b` }));
    rows.push(newRow(n, `INV-${n++}`, { focus: `a${c}b` }));
    rows.push(newRow(n, `INV-${n++}`, { corners: [{ label: `a${c}b` }, ...C4.slice(1)] }));
    rows.push(newRow(n, `INV-${n++}`, { anchors: [{ name: 'ok', address: `a${c}b` }] }));
  }
  const p = await preview(rows);
  assert.equal(p.status, 'invalid');
  assert.equal(new Set(p.errors?.map((e) => e.row)).size, rows.length, 'every row has an error');
  const ok = await preview([newRow(2, 'OK-1', { zone_name: 'Café & Co <b>', focus: 'a\nb\tc' })]);
  assert.equal(ok.status, 'preview', JSON.stringify(ok.errors));
});

test('one-line text is trimmed and collapsed before saving (the 014 CHECKs reject untrimmed text)', async () => {
  await as(ADMIN);
  await apply([newRow(2, 'TRIM-01', {
    zone_name: '  Two \t spaces\n', area_type: ' Mixed ', corners: [{ label: ' A \n &  1st ' }, ...C4.slice(1)],
    anchors: [{ name: ' Plaza ', address: '  ' }],
  })]);
  const z = await one('TRIM-01');
  assert.equal(z.name, 'Two spaces');
  assert.equal(z.area_type, 'Mixed');
  assert.deepEqual((z.corners as { label: string }[])[0], { label: 'A & 1st' });
  assert.deepEqual(z.anchors, [{ name: 'Plaza' }]);
});

test('duplicates after normalising, codes and caps', async () => {
  await as(ADMIN);
  const p = await preview([
    newRow(2, 'Dup 05'), newRow(3, 'DUP  05'),
    newRow(4, 'A.B'), newRow(5, ''), newRow(6, 'X'.repeat(31)),
    newRow(7, 'LONG-01', { zone_name: 'x'.repeat(101), focus: 'f'.repeat(1001), area_type: 'a'.repeat(201) }),
  ]);
  assert.deepEqual(errorsOf(p), [
    '2: zone_code DUP 05 is on more than one row (rows 2, 3)',
    '3: zone_code DUP 05 is on more than one row (rows 2, 3)',
    '4: zone_code can only use letters, digits, spaces and hyphens',
    '5: zone_code is required',
    '6: zone_code is over 30 characters',
    '7: area_type is over 200 characters',
    '7: focus is over 1000 characters',
    '7: zone_name is over 100 characters',
  ]);
});

test('apply refuses a stale preview, a changed payload, or no fingerprint; problems raise with nothing written', async () => {
  await as(ADMIN);
  await apply([newRow(2, 'FP-01')]);
  const rows = [row(2, 'FP-01', { focus: 'Stale test' })];
  const p = await preview(rows);
  await db.query(`update patrol_routes set focus = 'someone else' where code = 'FP-01'`);
  await assert.rejects(call(rows, false, p.fingerprint), /changed since the preview/);
  await assert.rejects(call(rows, false, null), /changed since the preview/);
  const p2 = await preview(rows);
  await assert.rejects(call([row(2, 'FP-01', { focus: 'Different' })], false, p2.fingerprint), /changed since the preview/);
  assert.equal((await one('FP-01')).focus, 'someone else');
  const before = await all();
  await assert.rejects(call([newRow(2, 'FP-02'), row(3, 'FP-03')], false, 'x'), /Import failed: 3 problem\(s\) in the file\. Nothing was changed\./);
  assert.deepEqual(await all(), before);
});

test('a failure part-way rolls back everything already written', async () => {
  await as(ADMIN);
  await db.exec(`create function boom() returns trigger language plpgsql as $$
    begin if new.code = 'ZZ-02' then raise exception 'boom'; end if; return new; end $$;
    create trigger t_boom before insert on patrol_routes for each row execute function boom();`);
  try {
    await assert.rejects(apply([newRow(2, 'ZZ-01'), newRow(3, 'ZZ-02'), row(4, 'CON-01', { focus: 'should not stick' })]), /boom/);
    assert.equal((await db.query<{ n: number }>(`select count(*)::int n from patrol_routes where code like 'ZZ-%'`)).rows[0].n, 0);
    assert.equal((await one('CON-01')).focus, null);
  } finally {
    await db.exec('drop trigger t_boom on patrol_routes; drop function boom();');
  }
});

test('a code collision on insert never echoes the key', async () => {
  await as(ADMIN);
  await db.exec(`create function collide() returns trigger language plpgsql as $$
    begin raise unique_violation using message = 'duplicate key value violates unique constraint "uq_patrol_routes_org_code_norm"',
      detail = 'Key (organisation_id, code)=(${OTHER_ORG}, SECRET-CODE) already exists.'; end $$;
    create trigger t_collide before insert on patrol_routes for each row execute function collide();`);
  try {
    const err = await apply([newRow(2, 'CLASH-01')]).then(() => null, (e: unknown) => e as { message: string; code?: string });
    assert.ok(err, 'apply should fail');
    assert.equal(err.message, 'Import failed: a zone code in the file was taken while importing. Nothing was changed. Preview again.');
    assert.equal(err.code, '23505');
    assert.ok(!JSON.stringify(err).includes('SECRET-CODE'));
    assert.ok(!JSON.stringify(err).includes(OTHER_ORG));
  } finally {
    await db.exec('drop trigger t_collide on patrol_routes; drop function collide();');
  }
});

test('organisation scoping: the same code elsewhere is a different zone; an organisation_id key is ignored', async () => {
  await as(OTHER_ADMIN);
  const p = await preview([newRow(2, 'CON-01', { zone_name: 'Their zone', organisation_id: ORG })]);
  assert.deepEqual(p.zones.map((z) => z.action), ['new']);
  await call([newRow(2, 'CON-01', { zone_name: 'Their zone', organisation_id: ORG })], false, p.fingerprint);
  assert.equal((await one('CON-01', OTHER_ORG)).name, 'Their zone');
  assert.equal((await one('CON-01')).name, 'Concord, Dufferin to Keele');
  // Their admin can't see or touch ours through the import either.
  const q = await preview([row(2, 'UPD-01', { focus: 'x' })]);
  assert.equal(q.status, 'invalid');
  assert.deepEqual(errorsOf(q), ['2: area_type is required for a new zone', '2: corners are required for a new zone (4 to 8)', '2: zone_name is required for a new zone']);
});

test('same-named tables in public cannot capture the work tables', async () => {
  await db.exec(`create table public.zone_csv_import (row_no integer, code text, route_id uuid);
                 create table public.zone_csv_plan (row_no integer, code text, route_id uuid, action text);
                 create table public.zone_csv_corner (row_no integer); create table public.zone_csv_anchor (row_no integer);`);
  try {
    await as(ADMIN);
    const done = await apply([newRow(2, 'DECOY-01', { anchors: [{ name: 'A' }] }), row(3, 'CON-01', { est_minutes: '30' })]);
    assert.deepEqual([done.created, done.updated], [1, 1]);
    assert.equal((await one('CON-01')).est_minutes, 30);
    const decoys = await db.query<{ n: number }>(`select (select count(*) from public.zone_csv_import) + (select count(*) from public.zone_csv_plan)
      + (select count(*) from public.zone_csv_corner) + (select count(*) from public.zone_csv_anchor) as n`);
    assert.equal(Number(decoys.rows[0].n), 0);
    const src = (await db.query<{ s: string }>(`select prosrc s from pg_proc where proname = 'import_zones'`)).rows[0].s;
    assert.ok(!/(?<!pg_temp\.)\bzone_csv_(import|plan|corner|anchor)\b/.test(src), 'every work-table reference is pg_temp-qualified');
  } finally {
    await db.exec('drop table public.zone_csv_import, public.zone_csv_plan, public.zone_csv_corner, public.zone_csv_anchor;');
  }
});

test('guards: signed out, sales, inactive admin are refused', async () => {
  const rows = [row(2, 'CON-01', { focus: 'nope' })];
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
  await assert.rejects(db.query(`select import_zones('{}'::jsonb)`), /expected a list/);
  await assert.rejects(preview([1]), /must be an object/);
  const many = Array.from({ length: 501 }, (_, i) => newRow(i + 2, `BULK-${i}`));
  await assert.rejects(preview(many), /1 to 500 zones \(it has 501\)/);
  await assert.rejects(preview([newRow(2, 'BIG-01', { focus: 'd'.repeat(2_000_001) })]), /too large/);
  const done = await apply(many.slice(0, 500));
  assert.equal(done.created, 500);
});

test('015 and its rollback are plain ASCII', () => {
  assert.deepEqual(nonAscii(migration), []);
  assert.deepEqual(nonAscii(rollback), []);
});

test('rollback drops import_zones; zones stay', async () => {
  const n = (await db.query<{ n: number }>('select count(*)::int n from patrol_routes')).rows[0].n;
  await db.exec(rollback);
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from pg_proc where proname = 'import_zones'`)).rows[0].n, 0);
  assert.equal((await db.query<{ n: number }>('select count(*)::int n from patrol_routes')).rows[0].n, n);
});
