// Run with: npm test  (Node's built-in runner; Node 22.6+ strips the TypeScript types)
// The code rule, uniqueness and duration helpers shared by the admin zone screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_MAX, CODE_PATTERN, formatDurationHHMM, isCodeTaken, normaliseCode } from '../src/lib/routeForm.ts';
import { CODE_PATTERN as FORM_CODE_PATTERN, normaliseCode as formNormaliseCode } from '../src/lib/zoneForm.ts';
import { normaliseZoneCode } from '../src/lib/zoneImport.ts';

test('code rule: letters, digits, single spaces and hyphens, starting and ending with a letter or digit', () => {
  for (const ok of ['CON-01', 'GRID MIS-01', 'MARK-001', 'A', '1 2-3']) assert.ok(CODE_PATTERN.test(ok), ok);
  for (const bad of ['A.B', 'A/B', 'A_B', 'A*B', '-AB', 'AB-', 'CAFÉ-1', '#1', 'con-01']) assert.ok(!CODE_PATTERN.test(bad), bad);
  assert.equal(CODE_MAX, 30);
  // One rule in one place: the zone form and the import use these.
  assert.equal(FORM_CODE_PATTERN, CODE_PATTERN);
  assert.equal(formNormaliseCode, normaliseCode);
  assert.equal(normaliseZoneCode, normaliseCode);
});

test('codes are normalised: trimmed, repeated spaces collapsed, upper case', () => {
  assert.equal(normaliseCode('  grid   mis-01 '), 'GRID MIS-01');
  assert.equal(normaliseCode('con-01'), 'CON-01');
  assert.equal(normaliseCode('a\tb'), 'A B');
});

test('code uniqueness ignores case and spacing, and includes retired codes', () => {
  assert.equal(isCodeTaken(' con-01 ', ['CON-01', 'UP-02']), true);
  assert.equal(isCodeTaken('grid  ap-01', ['GRID AP-01']), true);
  assert.equal(isCodeTaken('CON-02', ['CON-01', null]), false);
});

test('duration is HH:MM, null while the patrol is running', () => {
  assert.equal(formatDurationHHMM('2026-09-22T09:00:00Z', '2026-09-22T10:05:00Z'), '01:05');
  assert.equal(formatDurationHHMM('2026-09-22T09:00:00Z', '2026-09-22T09:00:29Z'), '00:00');
  assert.equal(formatDurationHHMM('2026-09-22T09:00:00Z', '2026-09-22T21:30:00Z'), '12:30');
  assert.equal(formatDurationHHMM('2026-09-22T09:00:00Z', null), null);
});
