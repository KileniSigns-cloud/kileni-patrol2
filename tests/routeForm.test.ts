// Run with: npm test  (Node's built-in runner; Node 22.6+ strips the TypeScript types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_ROUTE_FORM, NAME_MAX, addHotspot, formatDurationHHMM, isCodeTaken, toRouteInsert, validateRouteForm,
} from '../src/lib/routeForm.ts';

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

test('code with spaces is rejected', () => {
  assert.equal(validateRouteForm(form({ code: 'DT 01' })).code, 'Code cannot contain spaces.');
});

test('code uniqueness ignores case and surrounding whitespace, and includes archived codes', () => {
  assert.equal(isCodeTaken(' dt-01 ', ['DT-01', 'UP-02']), true);
  assert.equal(isCodeTaken('DT-02', ['DT-01', null]), false);
});

test('hotspots: blanks and case-insensitive duplicates are skipped', () => {
  assert.deepEqual(addHotspot(['Yonge & Bloor'], '  '), ['Yonge & Bloor']);
  assert.deepEqual(addHotspot(['Yonge & Bloor'], 'yonge & bloor'), ['Yonge & Bloor']);
  assert.deepEqual(addHotspot([], ' Union Station '), ['Union Station']);
});

test('insert row trims values and stores empty optional fields as null', () => {
  assert.deepEqual(toRouteInsert(form({ code: ' dt-01 ', description: '  ', focus: 'Plazas' }), 'org-1'), {
    organisation_id: 'org-1',
    name: 'Downtown Core',
    code: 'dt-01',
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
