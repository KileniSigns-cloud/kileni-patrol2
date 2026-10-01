// Route CSV import, browser side: parsing, row numbers, cell rules, codes, lists, backup CSV.
// The fixture is docs/sample-routes-mis.csv (4 Mississauga routes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKUP_COLUMNS, backupFileName, buildBackupCsv, cleanCell, CODE_PATTERN, IMPORT_TEMPLATE, mergeIssues,
  normaliseRouteCode, parseRouteCsv, splitHotspots, splitSteps, wasBlank, type ImportPlan, type StoredRoute,
} from '../src/lib/routeImport.ts';
import { csvCell } from '../src/lib/routeExport.ts';

const fixture = readFileSync(new URL('../docs/sample-routes-mis.csv', import.meta.url), 'utf8');
const HEADER = 'route_code,route_name,description,area_type,start_point,focus,hotspots,turn_by_turn';
const parse = (text: string) => parseRouteCsv(text, text.length);
const ch = (cp: number) => String.fromCodePoint(cp);

test('fixture: 4 routes on rows 2-5, no problems, steps 6/7/8/8, 4 hotspots each', () => {
  const p = parse(fixture);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.ignoredColumns, []);
  assert.equal(p.total, 4);
  assert.deepEqual(p.rows.map((r) => [r.row, r.route_code]), [[2, 'GRID MIS-01'], [3, 'GRID MIS-02'], [4, 'GRID MIS-03'], [5, 'GRID MIS-04']]);
  assert.deepEqual(p.rows.map((r) => r.turn_by_turn?.length), [6, 7, 8, 8]);
  assert.deepEqual(p.rows.map((r) => r.hotspots?.length), [4, 4, 4, 4]);
  const r = p.rows[0];
  assert.equal(r.route_name, 'Lakeview Commercial & Marina Corridor');
  assert.equal(r.start_point, 'Head West on Lakeshore Rd E at Dixie Rd (City of Toronto / Peel Boundary).');
  assert.equal(r.turn_by_turn?.[0], 'START: Head West on Lakeshore Rd E at Dixie Rd.');
  assert.deepEqual(r.hotspots, ['Waterfront Trail Parking Lots', 'Lakeshore East Commercial Strips', 'Haig Blvd Retail Pocket', 'Lakefront Promenade Park & Marina']);
  assert.ok(p.rows.every((x) => x.focus && x.focus.length <= 1000 && x.description && x.description.length <= 1000));
});

test('fixture gives the same rows with LF-only, CRLF-only and its own mixed line ends', () => {
  const base = parse(fixture).rows;
  assert.deepEqual(parse(fixture.replace(/\r?\n/g, '\n')).rows, base);
  assert.deepEqual(parse(fixture.replace(/\r?\n/g, '\r\n')).rows, base);
});

test('header: case, spaces and underscores; ; delimiter; missing route_code; unknown columns listed', () => {
  const p = parse('Route Code;ROUTE_NAME;Owner\nAB-1;Alpha;x\n');
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.rows.map((r) => [r.route_code, r.route_name]), [['AB-1', 'Alpha']]);
  assert.deepEqual(p.ignoredColumns, ['owner']);
  assert.deepEqual(parse('name,focus\nA,B\n').errors, [{ row: null, message: 'The file has no route_code column.' }]);
});

test('row numbers match the spreadsheet: blank lines and multi-line cells', () => {
  const p = parse(`route_code,turn_by_turn\nA-1,"1. one\n2. two"\n\nB-2,x\n,\n`);
  assert.deepEqual(p.rows.map((r) => r.row), [2, 4]);
  assert.equal(p.total, 2);
  assert.deepEqual(parse('route_code\n\n\n').errors, [{ row: null, message: 'No routes in this file.' }]);
});

test('file caps: over 1 MB, over 500 routes, not UTF-8', () => {
  assert.match(parseRouteCsv(fixture, 1_000_001).errors[0].message, /over 1 MB/);
  const many = `route_code\n${Array.from({ length: 501 }, (_, i) => `R-${i}`).join('\n')}\n`;
  assert.match(parse(many).errors[0].message, /501 routes. The limit is 500/);
  assert.equal(parse(`route_code\n${Array.from({ length: 500 }, (_, i) => `R-${i}`).join('\n')}\n`).rows.length, 500);
  assert.match(parse(`route_code,route_name\nA-1,Caf${ch(0xfffd)}\n`).errors[0].message, /not UTF-8/);
});

test('codes: normalised, letters/digits/spaces/hyphens only, 30 max, duplicates after normalising', () => {
  assert.equal(normaliseRouteCode('  grid   mis-01 '), 'GRID MIS-01');
  for (const ok of ['AUR-01', 'GRID AP-01', 'MARK-001', 'A', '1 2-3']) assert.ok(CODE_PATTERN.test(ok), ok);
  for (const bad of ['-A', 'A-', 'A_B', 'A.B', 'A/B', 'A*B', 'É-1', '']) assert.ok(!CODE_PATTERN.test(bad), bad);
  const p = parse(`${HEADER}\nGrid MIS-05,a\ngrid  mis-05,b\nA_B,c\n,d\n${'X'.repeat(31)},e\n`);
  const errs = p.errors.map((e) => `${e.row}: ${e.message}`);
  assert.deepEqual(errs, [
    '2: route_code GRID MIS-05 is on more than one row (rows 2, 3)',
    '3: route_code GRID MIS-05 is on more than one row (rows 2, 3)',
    '4: route_code can only use letters, digits, spaces and hyphens',
    '5: route_code is required',
    '6: route_code is over 30 characters',
  ]);
  assert.deepEqual(p.rows, []);
});

test('control and invisible characters are errors in every text field', () => {
  const bad = [0x00, 0x07, 0x7f, 0x200b, 0x200d, 0x200f, 0x2028, 0x2029, 0x202e, 0x2066, 0xfeff];
  for (const cp of bad) {
    const p = parse(`route_code,route_name,focus\nA-1,ok,x${ch(cp)}y\n`);
    assert.deepEqual(p.errors, [{ row: 2, message: 'focus contains control or invisible characters' }], cp.toString(16));
  }
  assert.equal(parse(`route_code,route_name\nA${ch(0x200b)}-1,ok\n`).errors[0].message, 'route_code contains control or invisible characters');
  // Tabs and ordinary line breaks are allowed where the field allows them.
  assert.deepEqual(parse('route_code,description\nA-1,"one\ttwo\nthree"\n').errors, []);
});

test('one-line fields fold line breaks; description and focus keep them as \\n', () => {
  const p = parse('route_code,route_name,start_point,description\nA-1,"Two\r\nlines","At\nX","a\r\nb"\n');
  assert.equal(p.rows[0].route_name, 'Two lines');
  assert.equal(p.rows[0].start_point, 'At X');
  assert.equal(p.rows[0].description, 'a\nb');
});

test('length caps', () => {
  const p = parse(`route_code,route_name,area_type,start_point,focus\nA-1,${'n'.repeat(101)},${'a'.repeat(201)},${'s'.repeat(301)},${'f'.repeat(1001)}\n`);
  assert.deepEqual(p.errors.map((e) => e.message).sort(), [
    'area_type is over 200 characters', 'focus is over 1000 characters',
    'route_name is over 100 characters', 'start_point is over 300 characters',
  ]);
});

test('hotspots: commas, or ; and line breaks when present; trailing dot, blanks, case duplicates', () => {
  assert.deepEqual(splitHotspots('A, B, C.'), ['A', 'B', 'C']);
  assert.deepEqual(splitHotspots('Smith, Jones Plaza; Main St\nmain st'), ['Smith, Jones Plaza', 'Main St']);
  assert.deepEqual(splitHotspots(' , ;'), []);
  const p = parse(`route_code,hotspots\nA-1,"${Array.from({ length: 31 }, (_, i) => `H${i}`).join(';')}"\nB-2,${'h'.repeat(151)}\n`);
  assert.deepEqual(p.errors.map((e) => `${e.row}: ${e.message}`), ['2: more than 30 hotspots', '3: each hotspot must be 150 characters or fewer']);
});

test('turn-by-turn: one step per line, numbers stripped, blanks dropped, odd numbering warned', () => {
  assert.deepEqual(splitSteps('1. a\r\n\r\n2) b\n3.\tc\nd').steps, ['a', 'b', 'c', 'd']);
  const p = parse('route_code,turn_by_turn\nA-1,"1. a\n2. b\n4. c"\n');
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, [{ row: 2, message: 'turn_by_turn is numbered 1, 2, 4. Steps are saved in the order they appear.' }]);
  const many = parse(`route_code,turn_by_turn\nA-1,"${Array.from({ length: 51 }, (_, i) => `${i + 1}. s`).join('\n')}"\nB-2,${'s'.repeat(301)}\n`);
  assert.deepEqual(many.errors.map((e) => e.message), ['more than 50 turn-by-turn steps', 'each turn-by-turn step must be 300 characters or fewer']);
});

test('formula-looking cells: warned, kept as text; a backup apostrophe is removed once', () => {
  const p = parse('route_code,route_name,focus\nA-1,=HYPERLINK("x"),@SUM(1)\n');
  assert.equal(p.rows[0].route_name, '=HYPERLINK("x")');
  assert.equal(p.warnings.length, 2);
  assert.equal(cleanCell("'-79.38"), '-79.38');
  assert.equal(cleanCell("'=1"), '=1');
  assert.equal(cleanCell("It's"), "It's");
  // csvCell guards it on the way out, cleanCell undoes exactly that on the way in.
  for (const v of ['-x', '=1+1', '+1', '@a']) assert.equal(cleanCell(JSON.parse(`"${csvCell(v).replace(/^"|"$/g, '')}"`)), v);
});

test('blank cells are null ("keep what is stored"), never empty strings', () => {
  const p = parse(`${HEADER}\nA-1,,,,,,,\n`);
  assert.deepEqual(p.rows[0], {
    row: 2, route_code: 'A-1', route_name: null, description: null, area_type: null, start_point: null,
    focus: null, hotspots: null, turn_by_turn: null,
  });
});

const stored: StoredRoute = {
  id: 'r-1', code: 'GRID AP-01', name: 'Pearson', description: null, area_type: 'Aviation', start_point: '-Dixon Rd',
  focus: '=Old focus', hotspots: ['Skyway, Airway'], steps: [{ id: 1, label: 'North on X' }, { id: 2, label: 'Loop (note)' }],
  archived_at: null, created_at: '2026-04-01T00:00:00Z',
};
const plan: Pick<ImportPlan, 'routes'> = {
  routes: [
    { row: 2, code: 'GRID AP-01', route_id: 'r-1', action: 'update', before: stored,
      changes: { description: { old: null, new: 'New' }, focus: { old: '=Old focus', new: 'F' } } },
    { row: 3, code: 'GRID MIS-01', route_id: null, action: 'new', before: null, changes: { route_name: { old: null, new: 'L' } } },
    { row: 4, code: 'AUR-01', route_id: 'r-2', action: 'unchanged', before: null, changes: {} },
  ],
};

test('backup CSV: updated routes as stored, created codes listed, and it re-imports to the old values', () => {
  const csv = buildBackupCsv(plan);
  assert.ok(csv.startsWith(String.fromCharCode(0xfeff)));
  assert.equal(csv.split('\r\n')[0].replace(/^\W/, ''), BACKUP_COLUMNS.join(','));
  const back = parse(csv);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.ignoredColumns, ['action', 'route_id', 'archived_at', 'created_at', 'hotspots_json', 'steps_json']);
  assert.deepEqual(back.rows[0], {
    row: 2, route_code: 'GRID AP-01', route_name: 'Pearson', description: null, area_type: 'Aviation',
    start_point: '-Dixon Rd', focus: '=Old focus', hotspots: ['Skyway, Airway'], turn_by_turn: ['North on X', 'Loop (note)'],
  });
  assert.deepEqual(back.rows[1], {
    row: 3, route_code: 'GRID MIS-01', route_name: null, description: null, area_type: null, start_point: null,
    focus: null, hotspots: null, turn_by_turn: null,
  });
  assert.equal(back.rows.length, 2);
  assert.ok(csv.includes('"[{""id"":1,""label"":""North on X""},{""id"":2,""label"":""Loop (note)""}]"'));
});

test('wasBlank marks fields the backup cannot clear', () => {
  assert.equal(wasBlank('description', { old: null, new: 'x' }), true);
  assert.equal(wasBlank('hotspots', { old: [], new: ['a'] }), true);
  assert.equal(wasBlank('focus', { old: 'a', new: 'b' }), false);
});

test('backup file name uses Toronto time', () => {
  assert.equal(backupFileName('2026-10-01T18:32:00Z'), 'routes-backup-2026-10-01-1432.csv');
});

test('server and browser problems merge by row without duplicates', () => {
  assert.deepEqual(mergeIssues([{ row: 3, message: 'a' }, { row: null, message: 'f' }], [{ row: 2, message: 'b' }, { row: 3, message: 'a' }]),
    [{ row: null, message: 'f' }, { row: 2, message: 'b' }, { row: 3, message: 'a' }]);
});

test('the template parses with no problems', () => {
  const p = parse(IMPORT_TEMPLATE);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows[0].turn_by_turn?.length, 3);
});
