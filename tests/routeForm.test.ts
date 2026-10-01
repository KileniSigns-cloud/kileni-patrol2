// Run with: npm test  (Node's built-in runner; Node 22.6+ strips the TypeScript types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_MAX, CODE_PATTERN, EMPTY_ROUTE_FORM, NAME_MAX, addHotspot, formatDurationHHMM, isCodeTaken, normaliseCode, toRouteInsert,
  validateRouteForm,
} from '../src/lib/routeForm.ts';
import { CODE_PATTERN as IMPORT_CODE_PATTERN, normaliseRouteCode } from '../src/lib/routeImport.ts';

const form = (patch = {}) => ({ ...EMPTY_ROUTE_FORM, name: 'Downtown Core', code: 'DT-01', ...patch });

test('valid form has no errors', () => {
  assert.deepEqual(validateRouteForm(form()), {});
});

test('name and code are required', () => {
  const errors = validateRouteForm(form({ name: '   ', code: '' }));
  assert.equal(errors.name, 'Name is required.');
  assert.equal(errors.code, 'Code is required.');
});

test(`name longer than ${NAME_MAX} characters is rejected`, () => {
  assert.match(validateRouteForm(form({ name: 'x'.repeat(NAME_MAX + 1) })).name ?? '', /100 characters/);
  assert.equal(validateRouteForm(form({ name: 'x'.repeat(NAME_MAX) })).name, undefined);
});

const CODE_RULE = 'Use only letters, numbers, spaces and hyphens, starting and ending with a letter or number (e.g. GRID MIS-01).';

test('code rule matches the CSV import: letters, digits, spaces and hyphens, upper case, spaces collapsed', () => {
  for (const ok of ['DT-01', 'dt-01', 'GRID MIS-01', '  grid   mis-01 ', 'MARK-001', 'A', '1 2-3']) {
    assert.equal(validateRouteForm(form({ code: ok })).code, undefined, ok);
  }
  for (const bad of ['A.B', 'A/B', 'A_B', 'A*B', '-AB', 'AB-', 'CAFÉ-1', 'A- ', '#1']) {
    assert.equal(validateRouteForm(form({ code: bad })).code, CODE_RULE, bad);
  }
  assert.equal(validateRouteForm(form({ code: 'X'.repeat(CODE_MAX + 1) })).code, 'Code must be 30 characters or fewer.');
  assert.equal(validateRouteForm(form({ code: '   ' })).code, 'Code is required.');
  // One rule in one place: the import uses the form's pattern and normaliser.
  assert.equal(IMPORT_CODE_PATTERN, CODE_PATTERN);
  assert.equal(normaliseRouteCode, normaliseCode);
});

test('codes are normalised: trimmed, repeated spaces collapsed, upper case', () => {
  assert.equal(normaliseCode('  grid   mis-01 '), 'GRID MIS-01');
  assert.equal(normaliseCode('dt-01'), 'DT-01');
});

test('every live code (2026-10-01) passes the form rule unchanged', () => {
  const live = ['AUR-01', 'BRAM-02', 'BY-01', 'CON-01', 'DUF-01', 'EC-01', 'ETB-01', 'GD-01', 'GRID AP-01', 'GRID REX-01',
    'HW-01', 'LB-01', 'LEA-01', 'LI-01', 'LI-02', 'MARK-001', 'MARK-01', 'MC-01', 'NEW-01', 'NYC-01', 'QW-01', 'RH-01',
    'SL-01', 'STK-01', 'VMC-01', 'WDB-01', 'YN-01'];
  for (const c of live) {
    assert.equal(validateRouteForm(form({ code: c })).code, undefined, c);
    assert.equal(normaliseCode(c), c);
  }
});

test('code uniqueness ignores case and spacing, and includes archived codes', () => {
  assert.equal(isCodeTaken(' dt-01 ', ['DT-01', 'UP-02']), true);
  assert.equal(isCodeTaken('grid  ap-01', ['GRID AP-01']), true);
  assert.equal(isCodeTaken('DT-02', ['DT-01', null]), false);
});

test('hotspots: blanks and case-insensitive duplicates are skipped', () => {
  assert.deepEqual(addHotspot(['Yonge & Bloor'], '  '), ['Yonge & Bloor']);
  assert.deepEqual(addHotspot(['Yonge & Bloor'], 'yonge & bloor'), ['Yonge & Bloor']);
  assert.deepEqual(addHotspot([], ' Union Station '), ['Union Station']);
});

test('insert row trims values, stores the normalised code and empty optional fields as null', () => {
  assert.deepEqual(toRouteInsert(form({ code: ' grid   dt-01 ', description: '  ', focus: 'Plazas' }), 'org-1'), {
    organisation_id: 'org-1',
    name: 'Downtown Core',
    code: 'GRID DT-01',
    description: null,
    area_type: null,
    focus: 'Plazas',
    start_point: null,
    hotspots: [],
  });
});

test('duration is HH:MM, null while the patrol is running', () => {
  assert.equal(formatDurationHHMM('2026-09-22T09:00:00Z', '2026-09-22T10:05:00Z'), '01:05');
  assert.equal(formatDurationHHMM('2026-09-22T09:00:00Z', '2026-09-22T09:00:29Z'), '00:00');
  assert.equal(formatDurationHHMM('2026-09-22T09:00:00Z', '2026-09-22T21:30:00Z'), '12:30');
  assert.equal(formatDurationHHMM('2026-09-22T09:00:00Z', null), null);
});
