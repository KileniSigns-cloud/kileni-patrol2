// Zone CSV import, browser side: parsing, row numbers, cell rules, corners and GPS, anchors,
// CSV injection guards and the backup CSV. The fixture is docs/sample-zones.csv (CON-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKUP_COLUMNS, IMPORT_COLUMNS, IMPORT_TEMPLATE, backupFileName, buildBackupCsv, cleanCell, fieldLines, mergeIssues,
  parseZoneCsv, splitAnchors, wasBlank, type ImportPlan, type StoredZone,
} from '../src/lib/zoneImport.ts';
import { csvCell } from '../src/lib/routeExport.ts';

const fixture = readFileSync(new URL('../docs/sample-zones.csv', import.meta.url), 'utf8');
const parse = (text: string) => parseZoneCsv(text, text.length);
const ch = (cp: number) => String.fromCodePoint(cp);
const CORNERS4 = 'corner1,corner2,corner3,corner4';
const errs = (text: string) => parse(text).errors.map((e) => `${e.row}: ${e.message}`);

test('columns: zone_code, zone_name, area_type, corner1..8 with _gps, anchors, focus, est_minutes, status', () => {
  assert.equal(IMPORT_COLUMNS.length, 23);
  assert.deepEqual(IMPORT_COLUMNS.slice(0, 5), ['zone_code', 'zone_name', 'area_type', 'corner1', 'corner1_gps']);
  assert.deepEqual(IMPORT_COLUMNS.slice(-6), ['corner8', 'corner8_gps', 'anchors', 'focus', 'est_minutes', 'status']);
});

test('fixture: CON-01 exactly as decided, GPS blank, nothing else filled', () => {
  const p = parse(fixture);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.ignoredColumns, []);
  assert.deepEqual(p.rows, [{
    row: 2, zone_code: 'CON-01', zone_name: 'Concord, Dufferin to Keele', area_type: 'Mixed',
    corners: [
      { label: 'Dufferin & Steeles, Concord ON' }, { label: 'Keele & Steeles, Concord ON' },
      { label: 'Keele & Hwy 7, Concord ON' }, { label: 'Dufferin & Centre Street, Concord ON' },
    ],
    anchors: null, focus: null, est_minutes: null, status: null,
  }]);
  assert.ok(!/\d+\.\d+\s*,\s*-?\d+\.\d+/.test(fixture), 'no coordinates in the fixture');
});

test('the fixture parses the same with LF and CRLF line ends', () => {
  const base = parse(fixture).rows;
  assert.deepEqual(parse(fixture.replace(/\r?\n/g, '\n')).rows, base);
  assert.deepEqual(parse(fixture.replace(/\r?\n/g, '\r\n')).rows, base);
});

test('header: case, spaces and underscores; ; delimiter; missing zone_code; unknown columns listed', () => {
  const p = parse('Zone Code;ZONE_NAME;Owner\nAB-1;Alpha;x\n');
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.rows.map((r) => [r.zone_code, r.zone_name]), [['AB-1', 'Alpha']]);
  assert.deepEqual(p.ignoredColumns, ['owner']);
  assert.deepEqual(parse('route_code,name\nA,B\n').errors, [{ row: null, message: 'The file has no zone_code column.' }]);
});

test('row numbers match the spreadsheet; file caps', () => {
  const p = parse('zone_code,focus\nA-1,"one\ntwo"\n\nB-2,x\n,\n');
  assert.deepEqual(p.rows.map((r) => r.row), [2, 4]);
  assert.deepEqual(parse('zone_code\n\n\n').errors, [{ row: null, message: 'No zones in this file.' }]);
  assert.match(parseZoneCsv(fixture, 1_000_001).errors[0].message, /over 1 MB/);
  assert.match(parse(`zone_code\n${Array.from({ length: 501 }, (_, i) => `R-${i}`).join('\n')}\n`).errors[0].message, /501 zones. The limit is 500/);
  assert.match(parse(`zone_code,zone_name\nA-1,Caf${ch(0xfffd)}\n`).errors[0].message, /not UTF-8/);
});

test('codes: normalised, charset, 30 max, duplicates after normalising', () => {
  assert.deepEqual(errs(`zone_code,zone_name\nCon 05,a\ncon  05,b\nA_B,c\n,d\n${'X'.repeat(31)},e\n`), [
    '2: zone_code CON 05 is on more than one row (rows 2, 3)',
    '3: zone_code CON 05 is on more than one row (rows 2, 3)',
    '4: zone_code can only use letters, digits, spaces and hyphens',
    '5: zone_code is required',
    '6: zone_code is over 30 characters',
  ]);
  assert.equal(parse('zone_code\n  con   ab-01 \n').rows[0].zone_code, 'CON AB-01');
});

test('name: code inside is an error, code-like start is a warning; one-line fields are trimmed and collapsed', () => {
  assert.deepEqual(errs('zone_code,zone_name\nCON-01,"CON-01: Concord"\n'), ['2: zone_name contains the code CON-01: leave the code out of the name']);
  const w = parse('zone_code,zone_name,area_type\nCON-01,"MIS-02 Concord","  Mixed \n use "\n');
  assert.deepEqual(w.errors, []);
  assert.match(w.warnings[0].message, /starts with something like a code/);
  assert.equal(w.rows[0].area_type, 'Mixed use');
});

test('corners: any filled cell gives the whole list; 4 minimum, no gaps, at most 8, GPS checked', () => {
  const one = parse(`zone_code,${CORNERS4},corner2_gps\nA-1, A & 1st ,B & 1st,B & 2nd,A & 2nd," 43.7 , -79.4 "\n`).rows[0];
  assert.deepEqual(one.corners, [{ label: 'A & 1st' }, { label: 'B & 1st', lat: 43.7, lng: -79.4 }, { label: 'B & 2nd' }, { label: 'A & 2nd' }]);
  assert.equal(parse('zone_code,focus\nA-1,x\n').rows[0].corners, null, 'no corner cells: keep stored corners');
  assert.deepEqual(errs('zone_code,corner1,corner2,corner3\nA-1,a,b,c\n'), ['2: at least 4 corners are required (found 3)']);
  assert.deepEqual(errs('zone_code,corner1,corner2,corner3,corner4,corner5,corner6\nA-1,a,b,,d,,f\n'),
    ['2: corner 3, 5 are blank: corners must be filled in order, with no gaps']);
  assert.deepEqual(errs(`zone_code,${CORNERS4},corner3_gps,corner5_gps\nA-1,a,b,c,d,"91,0","1,2"\n`), [
    '2: corner 3: GPS latitude must be between -90 and 90',
    '2: corner 5: GPS given without the intersection',
  ]);
  assert.deepEqual(errs(`zone_code,${CORNERS4},corner1_gps\nA-1,a,b,c,d,43.7 -79.4\n`),
    ['2: corner 1: GPS must be "lat,lng" in decimal degrees, e.g. copied from Google Maps']);
  assert.deepEqual(errs(`zone_code,${CORNERS4},corner9\nA-1,a | x,b,c,d,e\n`), [
    '2: corner 1: "|" is not allowed (Google Maps uses it to separate stops)',
    '2: corner9 is filled: a zone has at most 8 corners',
  ]);
  assert.deepEqual(parse(`zone_code,${CORNERS4},corner9\nA-1,a,b,c,d,\n`).ignoredColumns, ['corner9']);
});

test('anchors: "Name | Address" per line or ";"; address optional; caps', () => {
  assert.deepEqual(splitAnchors('Plaza | 1 Main St; Depot\nMall|  2 King St  '), [['Plaza ', ' 1 Main St'], ['Depot', ''], ['Mall', '  2 King St']]);
  const p = parse('zone_code,anchors\nA-1,"Plaza | 1 Main St; Depot"\n');
  assert.deepEqual(p.rows[0].anchors, [{ name: 'Plaza', address: '1 Main St' }, { name: 'Depot' }]);
  assert.deepEqual(errs('zone_code,anchors\nA-1,"| 1 Main St"\n'), ['2: anchor 1: name is required']);
  assert.deepEqual(errs(`zone_code,anchors\nA-1,"${Array.from({ length: 31 }, (_, i) => `A${i}`).join(';')}"\n`), ['2: more than 30 anchors']);
});

test('est_minutes and status', () => {
  const p = parse('zone_code,est_minutes,status\nA-1,90,Retired\nB-2,,ACTIVE\nC-3,,\n');
  assert.deepEqual(p.rows.map((r) => [r.est_minutes, r.status]), [[90, 'retired'], [null, 'active'], [null, null]]);
  assert.deepEqual(errs('zone_code,est_minutes,status\nA-1,1.5,\nB-2,0,\nC-3,,deleted\n'), [
    '2: est_minutes must be a whole number of minutes',
    '3: est_minutes must be between 1 and 1440',
    '4: status must be active or retired (or blank to keep it)',
  ]);
});

test('control and invisible characters are errors in every cell', () => {
  for (const cp of [0x00, 0x07, 0x7f, 0x200b, 0x200f, 0x2028, 0x202e, 0x2066, 0xfeff]) {
    assert.deepEqual(parse(`zone_code,focus\nA-1,x${ch(cp)}y\n`).errors, [{ row: 2, message: 'focus contains control or invisible characters' }], cp.toString(16));
  }
  assert.ok(errs(`zone_code,${CORNERS4}\nA-1,a${ch(0x200b)}b,b,c,d\n`).includes('2: corner1 contains control or invisible characters'));
});

test('CSV injection: formula-looking cells are warned and kept as text; a backup apostrophe is removed once', () => {
  const p = parse('zone_code,zone_name,focus\nA-1,=HYPERLINK("x"),@SUM(1)\n');
  assert.equal(p.rows[0].zone_name, '=HYPERLINK("x")');
  assert.equal(p.warnings.length, 2);
  assert.equal(cleanCell("'-33.8,151.2"), '-33.8,151.2');
  assert.equal(cleanCell("'=1"), '=1');
  assert.equal(cleanCell("It's"), "It's");
  for (const v of ['-x', '=1+1', '+1', '@a', '-33.8,151.2']) assert.equal(cleanCell(JSON.parse(`"${csvCell(v).replace(/^"|"$/g, '')}"`)), v);
});

const stored: StoredZone = {
  id: 'z-1', code: 'CON-01', name: '=Concord', area_type: 'Mixed', focus: '-Old focus',
  corners: [{ label: 'A & 1st', lat: -33.8, lng: 151.2 }, { label: 'B & 1st' }, { label: 'B & 2nd' }, { label: '+A & 2nd' }, { label: 'C' }],
  anchors: [{ name: 'Plaza', address: '1 Main St' }, { name: '@Depot' }],
  est_minutes: 90, archived_at: '2026-10-01T10:00:00', created_at: '2026-10-01T09:00:00Z',
};
const plan: Pick<ImportPlan, 'zones'> = {
  zones: [
    { row: 2, code: 'CON-01', route_id: 'z-1', action: 'update', before: stored, changes: { focus: { old: '-Old focus', new: 'F' } } },
    { row: 3, code: 'CON-02', route_id: null, action: 'new', before: null, changes: { zone_name: { old: null, new: 'N' } } },
    { row: 4, code: 'CON-03', route_id: 'z-3', action: 'unchanged', before: null, changes: {} },
  ],
};

test('backup CSV: formula cells guarded, and it re-imports to exactly the stored values (status included)', () => {
  const csv = buildBackupCsv(plan);
  assert.ok(csv.startsWith(String.fromCharCode(0xfeff)));
  assert.equal(csv.split('\r\n')[0].replace(/^\W/, ''), BACKUP_COLUMNS.join(','));
  for (const guarded of [`'=Concord`, `"'-33.8,151.2"`, `'+A & 2nd`, `'-Old focus`]) assert.ok(csv.includes(guarded), guarded);
  const back = parse(csv);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.ignoredColumns, ['action', 'zone_id', 'archived_at', 'created_at', 'corners_json', 'anchors_json']);
  assert.deepEqual(back.rows[0], {
    row: 2, zone_code: 'CON-01', zone_name: '=Concord', area_type: 'Mixed', corners: stored.corners,
    anchors: [{ name: 'Plaza', address: '1 Main St' }, { name: '@Depot' }], focus: '-Old focus', est_minutes: 90, status: 'retired',
  });
  assert.equal(back.rows[1].zone_code, 'CON-02');
  assert.equal(back.rows.length, 2);
});

test('preview lines, wasBlank, file name, merged problems', () => {
  assert.deepEqual(fieldLines('corners', stored.corners).slice(0, 2), ['A & 1st (GPS -33.8,151.2)', 'B & 1st (no GPS)']);
  assert.deepEqual(fieldLines('anchors', stored.anchors), ['Plaza, 1 Main St', '@Depot']);
  assert.deepEqual(fieldLines('est_minutes', 90), ['90 min']);
  assert.equal(wasBlank('focus', { old: null, new: 'x' }), true);
  assert.equal(wasBlank('corners', { old: [], new: [] }), true);
  assert.equal(wasBlank('focus', { old: 'a', new: 'b' }), false);
  assert.equal(backupFileName('2026-10-03T18:32:00Z'), 'zones-backup-2026-10-03-1432.csv');
  assert.deepEqual(mergeIssues([{ row: 3, message: 'a' }, { row: null, message: 'f' }], [{ row: 2, message: 'b' }, { row: 3, message: 'a' }]),
    [{ row: null, message: 'f' }, { row: 2, message: 'b' }, { row: 3, message: 'a' }]);
});

test('the template parses with no problems and no coordinates', () => {
  const p = parse(IMPORT_TEMPLATE);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.rows[0].corners?.length, 4);
  assert.deepEqual(p.rows[0].anchors, [{ name: 'Example Plaza', address: '100 Main St' }, { name: 'Example Depot' }]);
  assert.ok(p.rows[0].corners?.every((c) => c.lat === undefined));
});
