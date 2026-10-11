// Route CSV export: columns, row types, photo counts through signs, durations and escaping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRouteExportRows, csvCell, localDate, localDateTime, ROUTE_EXPORT_COLUMNS, routeExportFileName, toCsv,
  type ExportBusiness, type ExportSession, type ExportSign,
} from '../src/lib/routeExport.ts';

const route = { id: 'r1', code: 'AUR-01', name: 'Aurora loop', archived_at: null };

const sign = (patch: Partial<ExportSign> = {}): ExportSign => ({
  id: 's', condition: [], condition_rating: 'excellent', lead_id: null, inspection_photos: [], ...patch,
});

const biz = (id: string, patch: Partial<ExportBusiness> = {}): ExportBusiness => ({
  id, name: `Biz ${id}`, address: '1 Main St', lat: 43.9, lng: -79.45, gps_captured_at: '2026-09-23T14:00:00Z',
  date_added: '2026-09-23T14:00:00Z', notes: null, sign_inspections: [], ...patch,
});

// 2026-09-23 14:00 UTC = 10:00 in Toronto (EDT, UTC-4).
const session = (id: string, patch: Partial<ExportSession> = {}): ExportSession => ({
  id, started_at: '2026-09-23T14:00:00Z', ended_at: '2026-09-23T15:24:00Z', is_complete: true,
  patroller_name: 'pat@example.com', patrol_businesses: [], ...patch,
});

test('the column list is the agreed export format, in order', () => {
  assert.deepEqual([...ROUTE_EXPORT_COLUMNS], [
    'route_code', 'route_name', 'route_status', 'row_type', 'patrol_date', 'session_id', 'patroller_name',
    'session_started_at', 'session_ended_at', 'session_duration_min', 'session_duration_hhmm', 'duration_flag',
    'session_status', 'business_id', 'business_name', 'address', 'lat', 'lng', 'gps_captured_at', 'logged_at',
    'business_notes', 'signs_logged', 'photo_count', 'sign_photo_count', 'surrounding_photo_count', 'issues',
    'worst_condition', 'lead_ids',
  ]);
});

test('a visit row: route, patrol, business and sign totals', () => {
  const b = biz('b1', {
    notes: 'Corner unit',
    sign_inspections: [
      sign({ id: 'i1', condition: ['Partially lit', 'Faded'], condition_rating: 'good', lead_id: 'L1',
        inspection_photos: [{ photo_type: 'sign' }, { photo_type: 'sign' }, { photo_type: 'surrounding' }] }),
      sign({ id: 'i2', condition: ['Faded', 'Damaged'], condition_rating: 'fair', lead_id: 'L1',
        inspection_photos: [{ photo_type: 'sign' }] }),
    ],
  });
  const [row] = buildRouteExportRows(route, [session('s1', { patrol_businesses: [b] })], []);
  assert.deepEqual(row, {
    route_code: 'AUR-01',
    route_name: 'Aurora loop',
    route_status: 'active',
    row_type: 'visit',
    patrol_date: '2026-09-23',
    session_id: 's1',
    patroller_name: 'pat@example.com',
    session_started_at: '2026-09-23 10:00',
    session_ended_at: '2026-09-23 11:24',
    session_duration_min: 84,
    session_duration_hhmm: '01:24',
    duration_flag: null,
    session_status: 'finished',
    business_id: 'b1',
    business_name: 'Biz b1',
    address: '1 Main St',
    lat: 43.9,
    lng: -79.45,
    gps_captured_at: '2026-09-23 10:00',
    logged_at: '2026-09-23 10:00',
    business_notes: 'Corner unit',
    signs_logged: 2,
    photo_count: 4,
    sign_photo_count: 3,
    surrounding_photo_count: 1,
    issues: 'Partially lit; Faded; Damaged',
    worst_condition: 'fair',
    lead_ids: 'L1',
  });
});

test('photos are counted through the signs, never from the business itself', () => {
  // inspection_photos.business_id is missing on some live rows, so the export never reads it.
  const b = biz('b1', { sign_inspections: [sign({ inspection_photos: [{ photo_type: 'sign' }, { photo_type: null }] })] });
  const [row] = buildRouteExportRows(route, [session('s1', { patrol_businesses: [b] })], []);
  assert.equal(row.photo_count, 2);
  assert.equal(row.sign_photo_count, 1);
  assert.equal(row.surrounding_photo_count, 0);
});

test('a business with no signs has zero counts and no condition', () => {
  const [row] = buildRouteExportRows(route, [session('s1', { patrol_businesses: [biz('b1', { sign_inspections: null })] })], []);
  assert.equal(row.signs_logged, 0);
  assert.equal(row.photo_count, 0);
  assert.equal(row.issues, null);
  assert.equal(row.worst_condition, null);
  assert.equal(row.lead_ids, null);
});

test('durations over 12 hours are flagged; unfinished patrols have no duration', () => {
  const rows = buildRouteExportRows(route, [
    session('ok', { started_at: '2026-09-01T12:00:00Z', ended_at: '2026-09-01T23:59:00Z' }), // 11:59
    session('long', { started_at: '2026-09-02T12:00:00Z', ended_at: '2026-10-08T00:00:00Z' }), // never ended properly
    session('open', { started_at: '2026-09-03T12:00:00Z', ended_at: null, is_complete: false }),
  ], []);
  const byId = Object.fromEntries(rows.map((r) => [r.session_id, r]));
  assert.equal(byId.ok.duration_flag, null);
  assert.equal(byId.ok.session_duration_min, 719);
  assert.equal(byId.long.duration_flag, 'over_12h');
  assert.equal(byId.long.session_duration_min, 51120);
  assert.equal(byId.open.session_duration_min, null);
  assert.equal(byId.open.session_duration_hhmm, null);
  assert.equal(byId.open.duration_flag, null);
  assert.equal(byId.open.session_status, 'not_finished');
});

test('every patrol appears: one with no businesses gets its own row', () => {
  const rows = buildRouteExportRows(route, [session('empty')], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row_type, 'patrol_no_businesses');
  assert.equal(rows[0].session_id, 'empty');
  assert.equal(rows[0].business_id, null);
  assert.equal(rows[0].photo_count, null);
});

test('PATROL v1 businesses on the route (no session) are visits with blank session columns', () => {
  const rows = buildRouteExportRows(route, [], [biz('v1')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row_type, 'visit');
  assert.equal(rows[0].business_id, 'v1');
  assert.equal(rows[0].session_id, null);
  assert.equal(rows[0].patrol_date, null);
  assert.equal(rows[0].session_status, null);
});

test('rows are oldest patrol first, businesses in logging order; a business is never listed twice', () => {
  const later = session('s2', { started_at: '2026-09-24T14:00:00Z', patrol_businesses: [
    biz('b3', { date_added: '2026-09-24T15:00:00Z' }), biz('b2', { date_added: '2026-09-24T14:30:00Z' }),
  ] });
  const earlier = session('s1', { patrol_businesses: [biz('b1')] });
  const rows = buildRouteExportRows(route, [later, earlier], [biz('b2')]);
  assert.deepEqual(rows.map((r) => r.business_id), ['b1', 'b2', 'b3']);
});

test('an archived route is marked archived', () => {
  const [row] = buildRouteExportRows({ ...route, archived_at: '2026-09-20T10:00:00' }, [session('s1')], []);
  assert.equal(row.route_status, 'archived');
});

test('dates and times are Toronto local time, across the UTC date line and DST', () => {
  assert.equal(localDate('2026-09-24T02:30:00Z'), '2026-09-23', '22:30 the evening before in Toronto');
  assert.equal(localDateTime('2026-01-15T17:05:00Z'), '2026-01-15 12:05', 'EST in winter');
  assert.equal(localDateTime(null), null);
});

test('CSV cells: quoting, formula guard for text, numbers left as numbers', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(-79.38), '-79.38', 'a negative longitude is a number, not a formula');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell('Tim Hortons'), 'Tim Hortons');
  assert.equal(csvCell('Smith, Jones & Co'), '"Smith, Jones & Co"');
  assert.equal(csvCell('The "Big" Sign'), '"The ""Big"" Sign"');
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+1 416 555 0100'), "'+1 416 555 0100");
  assert.equal(csvCell('-sale'), "'-sale");
  assert.equal(csvCell('@home'), "'@home");
  assert.equal(csvCell(' padded'), '" padded"');
});

test('the CSV has a BOM, a header row matching the columns, and CRLF lines', () => {
  const csv = toCsv(buildRouteExportRows(route, [session('s1')], []));
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], ROUTE_EXPORT_COLUMNS.join(','));
  assert.equal(lines.length, 3, 'header, one row, trailing newline');
  assert.equal(lines[1].split(',').length, ROUTE_EXPORT_COLUMNS.length);
  assert.equal(lines[2], '');
});

test('file name: zone code made safe, Toronto date', () => {
  assert.equal(routeExportFileName('AUR-01', '2026-09-28T16:30:00Z'), 'zone-AUR-01-2026-09-28.csv');
  assert.equal(routeExportFileName('GRID REX-01', '2026-09-29T02:00:00Z'), 'zone-GRID-REX-01-2026-09-28.csv');
  assert.equal(routeExportFileName(null, '2026-09-28T16:30:00Z'), 'zone-zone-2026-09-28.csv');
});
