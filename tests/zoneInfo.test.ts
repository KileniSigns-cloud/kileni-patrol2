// Zone helpers: reading corners and anchors, the zone map link (closed loop, encoding, limits),
// per-corner links, badges and the admin warnings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAPS_URL_MAX, ZONE_MAP_CLOSE_LOOP, anchorList, anchorMapsUrl, cornerList, cornerMapsUrl, cornersBadge, estLabel, gpsText,
  loopLabel, waypointCount, zoneMapUrl, zoneMapWarnings, type Corner,
} from '../src/lib/zoneInfo.ts';

const CON01: Corner[] = [
  { label: 'Dufferin & Steeles, Concord ON' }, { label: 'Keele & Steeles, Concord ON' },
  { label: 'Keele & Hwy 7, Concord ON' }, { label: 'Dufferin & Centre Street, Concord ON' },
];
const params = (url: string) => new URL(url).searchParams;

test('the loop is closed by default (the single setting)', () => {
  assert.equal(ZONE_MAP_CLOSE_LOOP, true);
});

test('CON-01: origin = destination = corner 1, waypoints = corners 2-4 in order, driving, no navigation', () => {
  const url = zoneMapUrl(CON01)!;
  assert.equal(url,
    'https://www.google.com/maps/dir/?api=1'
    + '&origin=Dufferin%20%26%20Steeles%2C%20Concord%20ON'
    + '&destination=Dufferin%20%26%20Steeles%2C%20Concord%20ON'
    + '&waypoints=Keele%20%26%20Steeles%2C%20Concord%20ON%7CKeele%20%26%20Hwy%207%2C%20Concord%20ON%7CDufferin%20%26%20Centre%20Street%2C%20Concord%20ON'
    + '&travelmode=driving');
  const p = params(url);
  assert.equal(p.get('origin'), 'Dufferin & Steeles, Concord ON');
  assert.equal(p.get('destination'), 'Dufferin & Steeles, Concord ON');
  assert.deepEqual(p.get('waypoints')!.split('|'), ['Keele & Steeles, Concord ON', 'Keele & Hwy 7, Concord ON', 'Dufferin & Centre Street, Concord ON']);
  assert.equal(p.get('dir_action'), null);
  assert.equal(waypointCount(4), 3);
});

test('open loop: destination is the last corner, one waypoint fewer', () => {
  const p = params(zoneMapUrl(CON01, false)!);
  assert.equal(p.get('destination'), 'Dufferin & Centre Street, Concord ON');
  assert.deepEqual(p.get('waypoints')!.split('|'), ['Keele & Steeles, Concord ON', 'Keele & Hwy 7, Concord ON']);
  assert.equal(waypointCount(4, false), 2);
});

test('GPS is used when present (6 decimals, no trailing zeros); text otherwise', () => {
  const corners: Corner[] = [{ label: 'A', lat: 10.5, lng: -20.25 }, { label: 'B' }, { label: 'C', lat: -33.123456789, lng: 151 }, { label: 'D' }];
  const p = params(zoneMapUrl(corners)!);
  assert.equal(p.get('origin'), '10.5,-20.25');
  assert.deepEqual(p.get('waypoints')!.split('|'), ['B', '-33.123457,151', 'D']);
  assert.ok(zoneMapUrl(corners)!.includes('origin=10.5%2C-20.25'));
});

test('every input stays inside its parameter: & # ? = % + / , | < > and unicode are encoded', () => {
  const nasty: Corner[] = [
    { label: 'javascript:alert(1)//' }, { label: 'a&destination=evil.example' }, { label: 'x#y?z=1%+/' }, { label: 'Café <b>' },
  ];
  const url = zoneMapUrl(nasty)!;
  assert.ok(url.startsWith('https://www.google.com/maps/dir/?api=1&origin='));
  assert.ok(!/[#<> ]/.test(url), url);
  const p = params(url);
  assert.deepEqual([...p.keys()], ['api', 'origin', 'destination', 'waypoints', 'travelmode']);
  assert.equal(p.get('origin'), 'javascript:alert(1)//');
  assert.deepEqual(p.get('waypoints')!.split('|'), ['a&destination=evil.example', 'x#y?z=1%+/', 'Café <b>']);
  assert.equal(new URL(url).host, 'www.google.com');
});

test('fewer than 2 corners: no link', () => {
  assert.equal(zoneMapUrl([]), null);
  assert.equal(zoneMapUrl([{ label: 'A' }]), null);
});

test('per-corner and per-anchor search links', () => {
  assert.equal(cornerMapsUrl({ label: 'Keele & Hwy 7, Concord ON' }),
    'https://www.google.com/maps/search/?api=1&query=Keele%20%26%20Hwy%207%2C%20Concord%20ON');
  assert.equal(cornerMapsUrl({ label: 'A', lat: 43.7, lng: -79.4 }), 'https://www.google.com/maps/search/?api=1&query=43.7%2C-79.4');
  assert.equal(anchorMapsUrl({ name: 'Plaza', address: '1 Main St' }), 'https://www.google.com/maps/search/?api=1&query=1%20Main%20St');
  assert.equal(anchorMapsUrl({ name: 'Plaza' }), 'https://www.google.com/maps/search/?api=1&query=Plaza');
});

test('cornerList / anchorList read stored jsonb safely', () => {
  assert.deepEqual(cornerList([{ label: ' A ', lat: 1, lng: 2 }, { label: 'B', lat: 1 }, { label: '' }, 'C', null, { lat: 1, lng: 2 }]),
    [{ label: 'A', lat: 1, lng: 2 }, { label: 'B' }]);
  for (const nothing of [null, undefined, 'x', {}, 5]) assert.deepEqual(cornerList(nothing), []);
  assert.deepEqual(anchorList([{ name: 'P', address: ' 1 Main ' }, { name: 'Q', address: '' }, { address: 'x' }]),
    [{ name: 'P', address: '1 Main' }, { name: 'Q' }]);
  assert.equal(gpsText({ label: 'x' }), null);
});

test('badges, estimate and loop label', () => {
  assert.equal(cornersBadge(CON01), '4 corners');
  assert.equal(cornersBadge([{ label: 'A' }]), '1 corner');
  assert.equal(cornersBadge(null), 'No corners');
  assert.equal(estLabel(90), 'About 90 min');
  assert.equal(estLabel(null), null);
  assert.equal(estLabel(0), null);
  assert.equal(loopLabel(4), 'Loop: 1 → 2 → 3 → 4 → 1');
  assert.equal(loopLabel(4, false), 'Route: 1 → 2 → 3 → 4');
});

test('warnings: no GPS, more than 4 corners, link over 2,048 characters', () => {
  assert.deepEqual(zoneMapWarnings(CON01.map((c, i) => ({ ...c, lat: i, lng: i }))), []);
  const noGps = zoneMapWarnings(CON01);
  assert.equal(noGps.length, 1);
  assert.match(noGps[0], /^Corners 1, 2, 3, 4 have no GPS/);
  assert.match(zoneMapWarnings([{ label: 'A', lat: 1, lng: 1 }, { label: 'B' }, { label: 'C', lat: 1, lng: 1 }, { label: 'D', lat: 1, lng: 1 }])[0], /^Corner 2 has no GPS/);
  const five = [...CON01, { label: 'E' }].map((c) => ({ ...c, lat: 1, lng: 1 }));
  assert.match(zoneMapWarnings(five)[0], /More than 4 corners: phone browsers show only 3 stops/);
  const long = Array.from({ length: 8 }, () => ({ label: 'é'.repeat(100), lat: undefined }));
  const w = zoneMapWarnings(long);
  assert.ok(zoneMapUrl(long)!.length > MAPS_URL_MAX);
  assert.match(w[0], /Google Maps allows 2048/);
});
