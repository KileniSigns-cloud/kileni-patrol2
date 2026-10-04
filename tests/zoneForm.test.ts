// Zone rules shared by the admin form and the CSV import: clean-up, GPS, corners, anchors,
// the "no code in the name" rule, and what the form saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAnchor, checkCorner, checkCornerSlots, draftCorners, emptyZoneForm, hasErrors, multiLine, nameHasCode, nameLooksCoded,
  oneLine, parseEstMinutes, parseGps, toZoneRow, validateZoneForm, zoneFormFrom, type ZoneFormValues,
} from '../src/lib/zoneForm.ts';

const ch = (cp: number) => String.fromCodePoint(cp);
const CON01 = ['Dufferin & Steeles, Concord ON', 'Keele & Steeles, Concord ON', 'Keele & Hwy 7, Concord ON', 'Dufferin & Centre Street, Concord ON'];
const form = (patch: Partial<ZoneFormValues> = {}): ZoneFormValues => ({
  ...emptyZoneForm(),
  code: 'CON-01', name: 'Concord, Dufferin to Keele', area_type: 'Mixed',
  corners: CON01.map((label) => ({ label, gps: '' })),
  ...patch,
});

test('GPS: decimal "lat,lng" with optional spaces, rounded to 6 decimals, ranges checked', () => {
  assert.deepEqual(parseGps('43.7945, -79.4701'), { lat: 43.7945, lng: -79.4701 });
  assert.deepEqual(parseGps(' -33.8688197,151.2092956 '), { lat: -33.86882, lng: 151.209296 });
  assert.deepEqual(parseGps('90,180'), { lat: 90, lng: 180 });
  assert.match((parseGps('90.0001,0') as { error: string }).error, /latitude/);
  assert.match((parseGps('0,-180.5') as { error: string }).error, /longitude/);
  for (const bad of ['43.79 -79.47', '43,79;-79,47', `43°47'N, 79°28'W`, '1,2,3', 'abc', '', '1e2,3', '0x1,2', 'Infinity,1', '43.79,']) {
    assert.ok('error' in parseGps(bad), bad);
  }
});

test('one corner: trimmed and collapsed; GPS without text, "|", over 100 and invisible characters rejected', () => {
  assert.deepEqual(checkCorner(1, '  Keele \t&\n Hwy 7  ', ''), { corner: { label: 'Keele & Hwy 7' }, errors: [], warnings: [] });
  assert.deepEqual(checkCorner(2, 'A', '43.7,-79.4').corner, { label: 'A', lat: 43.7, lng: -79.4 });
  assert.deepEqual(checkCorner(3, '', ''), { corner: null, errors: [], warnings: [] });
  assert.deepEqual(checkCorner(3, '', '1,2').errors, ['corner 3: GPS given without the intersection']);
  assert.match(checkCorner(1, 'A | B', '').errors[0], /"\|" is not allowed/);
  assert.match(checkCorner(1, 'x'.repeat(101), '').errors[0], /over 100 characters/);
  assert.match(checkCorner(1, `A${ch(0x202e)}B`, '').errors[0], /invisible/);
  assert.match(checkCorner(1, 'A', '1;2').errors[0], /decimal degrees/);
  assert.match(checkCorner(1, 'A', '0,0').warnings[0], /0,0/);
});

test('corner slots: 4 to 8, in order, no gaps', () => {
  const c = { label: 'x' };
  assert.deepEqual(checkCornerSlots([c, c, c, c, null, null, null, null], true), []);
  assert.deepEqual(checkCornerSlots(Array(8).fill(null), false), []);
  assert.deepEqual(checkCornerSlots(Array(8).fill(null), true), ['at least 4 corners are required']);
  assert.deepEqual(checkCornerSlots([c, c, c, null, null, null, null, null], false), ['at least 4 corners are required (found 3)']);
  assert.deepEqual(checkCornerSlots([c, c, null, c, null, c, null, null], false), ['corner 3, 5 are blank: corners must be filled in order, with no gaps']);
  assert.deepEqual(checkCornerSlots(Array(9).fill(c), false), ['at most 8 corners']);
});

test('anchors: name required, address optional, caps', () => {
  assert.deepEqual(checkAnchor(' Plaza ', '  1 Main St ', 'anchor 1'), { anchor: { name: 'Plaza', address: '1 Main St' }, errors: [] });
  assert.deepEqual(checkAnchor('Plaza', '', 'anchor 1').anchor, { name: 'Plaza' });
  assert.deepEqual(checkAnchor('', '', 'anchor 1'), { anchor: null, errors: [] });
  assert.deepEqual(checkAnchor('', '1 Main', 'anchor 2').errors, ['anchor 2: name is required']);
  assert.match(checkAnchor('n'.repeat(151), '', 'a').errors[0], /over 150/);
  assert.match(checkAnchor('n', 'a'.repeat(301), 'a').errors[0], /over 300/);
});

test('the name must not contain the zone code (as a word, ignoring case, spaces and hyphens)', () => {
  for (const name of ['CON-01: Concord', 'con 01 Concord', 'Concord (CON-01)', 'CON01', 'Zone CON - 01']) assert.equal(nameHasCode(name, 'CON-01'), true, name);
  for (const name of ['Concord, Dufferin to Keele', 'ICON-01 Plaza', 'CON-012', 'Concord']) assert.equal(nameHasCode(name, 'CON-01'), false, name);
  assert.equal(nameHasCode('Anything', ''), false);
  assert.equal(nameLooksCoded('MIS-01 Lakeview'), true);
  assert.equal(nameLooksCoded('Concord, Dufferin to Keele'), false);
});

test('clean-up helpers and est_minutes', () => {
  assert.equal(oneLine('  a \t b\r\n c  '), 'a b c');
  assert.equal(multiLine('\n  line 1\r\nline 2  \n'), 'line 1\nline 2');
  assert.equal(parseEstMinutes(''), null);
  assert.equal(parseEstMinutes(' 90 '), 90);
  for (const bad of ['0', '1441', '1.5', '-5', 'ten']) assert.ok(typeof parseEstMinutes(bad) === 'object', bad);
});

test('CON-01 form is valid and saves trimmed, normalised values; old route columns are not written', () => {
  const v = form({ code: ' con-01 ', name: '  Concord,  Dufferin to Keele ', area_type: ' Mixed', focus: '  ', est_minutes: '' });
  assert.equal(hasErrors(validateZoneForm(v)), false, JSON.stringify(validateZoneForm(v)));
  assert.deepEqual(toZoneRow(v), {
    code: 'CON-01', name: 'Concord, Dufferin to Keele', area_type: 'Mixed', focus: null, est_minutes: null,
    corners: CON01.map((label) => ({ label })), anchors: null,
  });
});

test('form errors: required fields, code in the name, corners, GPS, anchors, estimate', () => {
  const e = validateZoneForm(form({
    code: '', name: '', area_type: '', est_minutes: '0',
    corners: [{ label: 'A', gps: '' }, { label: '', gps: '' }, { label: 'C', gps: '91,0' }, { label: 'D', gps: '' }],
    anchors: [{ name: '', address: '1 Main St' }],
  }));
  assert.equal(e.code, 'Code is required.');
  assert.equal(e.name, 'Name is required.');
  assert.equal(e.area_type, 'Area type is required.');
  assert.equal(e.est_minutes, 'Estimate must be between 1 and 1440.');
  assert.deepEqual(e.cornerRows, {
    1: 'Corner 2: enter the intersection, or remove this row.',
    2: 'Corner 3: GPS latitude must be between -90 and 90.',
  });
  assert.deepEqual(e.anchorRows, { 0: 'Anchor 1: name is required.' });
  assert.equal(validateZoneForm(form({ name: 'CON-01 Concord' })).name, 'Leave the code out of the name: CON-01 is shown beside it.');
  assert.equal(validateZoneForm(form({ corners: form().corners.slice(0, 3) })).corners, 'At least 4 corners are required.');
  assert.equal(validateZoneForm(form({ code: 'con_01' })).code?.startsWith('Use only letters'), true);
});

test('edit: the form round-trips a stored zone; GPS shown as "lat,lng"', () => {
  const stored = {
    code: 'CON-01', name: 'Concord', area_type: 'Mixed', focus: 'Pylons', est_minutes: 90,
    corners: [{ label: 'A', lat: 43.7, lng: -79.4 }, { label: 'B' }, { label: 'C' }, { label: 'D' }, { label: 'E' }],
    anchors: [{ name: 'Plaza', address: '1 Main St' }],
  };
  const v = zoneFormFrom(stored);
  assert.deepEqual(v.corners[0], { label: 'A', gps: '43.7,-79.4' });
  assert.equal(v.corners.length, 5);
  assert.equal(v.est_minutes, '90');
  const row = toZoneRow(v);
  assert.deepEqual(row.corners, stored.corners);
  assert.deepEqual(row.anchors, stored.anchors);
  assert.equal(zoneFormFrom({ ...stored, corners: null, anchors: null }).corners.length, 4);
  assert.deepEqual(draftCorners([{ label: 'A', gps: 'bad' }, { label: 'B', gps: '' }]), [{ label: 'B' }]);
});
