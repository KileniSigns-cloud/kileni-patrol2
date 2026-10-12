// The offline copy of the zone list: saved per organisation, never read across organisations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCachedZone, loadZoneCache, saveZoneCache, savedAtLabel, zoneCacheKey, zoneInfoOf, type KeyValueStorage,
} from '../src/lib/zoneCache.ts';
import type { PatrolRoute } from '../src/types/index.ts';

const NOW = '2026-10-12T16:00:00.000Z';

function fakeStorage(opts: { failSet?: boolean } = {}) {
  const data = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.failSet) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
  };
  return { storage, data };
}

const zone = (over: Partial<PatrolRoute> = {}): PatrolRoute => ({
  id: 'r1', organisation_id: 'org-1', name: 'Airport Road', code: 'MIS-06', area_type: 'industrial',
  focus: 'plazas', corners: [{ label: 'A & B' }], anchors: [{ name: 'Cargo Hub' }], est_minutes: 90,
  created_at: '2026-10-01T00:00:00.000Z', archived_at: null, ...over,
});

test('what is saved comes back, with the time it was saved', () => {
  const { storage } = fakeStorage();
  assert.equal(saveZoneCache(storage, 'org-1', [zone(), zone({ id: 'r2', code: 'MIS-04' })], NOW), true);
  const got = loadZoneCache(storage, 'org-1');
  assert.equal(got?.savedAt, NOW);
  assert.deepEqual(got?.routes.map((r) => r.id), ['r1', 'r2']);
});

test('nothing saved is null, not an empty list', () => {
  assert.equal(loadZoneCache(fakeStorage().storage, 'org-1'), null);
});

test('another organisation never reads this organisation\'s copy', () => {
  const { storage } = fakeStorage();
  saveZoneCache(storage, 'org-1', [zone()], NOW);
  assert.equal(loadZoneCache(storage, 'org-2'), null);
});

test('a copy filed under the wrong organisation key still returns nothing for rows of another org', () => {
  const { storage, data } = fakeStorage();
  data.set(zoneCacheKey('org-2'), JSON.stringify({ savedAt: NOW, routes: [zone({ organisation_id: 'org-1' })] }));
  assert.deepEqual(loadZoneCache(storage, 'org-2')?.routes, []);
});

test('retired zones are never returned', () => {
  const { storage } = fakeStorage();
  saveZoneCache(storage, 'org-1', [zone(), zone({ id: 'r2', archived_at: '2026-10-10T00:00:00.000Z' })], NOW);
  assert.deepEqual(loadZoneCache(storage, 'org-1')?.routes.map((r) => r.id), ['r1']);
});

test('an empty organisation id saves and loads nothing', () => {
  const { storage, data } = fakeStorage();
  assert.equal(saveZoneCache(storage, '', [zone()], NOW), false);
  assert.equal(loadZoneCache(storage, ''), null);
  assert.equal(data.size, 0);
});

test('a phone that refuses the write does not throw', () => {
  const { storage } = fakeStorage({ failSet: true });
  assert.equal(saveZoneCache(storage, 'org-1', [zone()], NOW), false);
});

test('unreadable or wrong-shaped saved data is ignored', () => {
  const { storage, data } = fakeStorage();
  data.set(zoneCacheKey('org-1'), '{not json');
  assert.equal(loadZoneCache(storage, 'org-1'), null);
  data.set(zoneCacheKey('org-1'), JSON.stringify({ savedAt: NOW, routes: 'nope' }));
  assert.equal(loadZoneCache(storage, 'org-1'), null);
  data.set(zoneCacheKey('org-1'), JSON.stringify({ savedAt: NOW, routes: [{ id: 5 }, null, zone()] }));
  assert.deepEqual(loadZoneCache(storage, 'org-1')?.routes.map((r) => r.id), ['r1']);
});

test('findCachedZone returns one zone by id, or null', () => {
  const { storage } = fakeStorage();
  saveZoneCache(storage, 'org-1', [zone(), zone({ id: 'r2', name: 'Clarkson' })], NOW);
  assert.equal(findCachedZone(storage, 'org-1', 'r2')?.name, 'Clarkson');
  assert.equal(findCachedZone(storage, 'org-1', 'missing'), null);
  assert.equal(findCachedZone(storage, 'org-2', 'r2'), null);
});

test('zoneInfoOf keeps only what the Zone info sheet shows', () => {
  assert.deepEqual(zoneInfoOf(zone()), {
    code: 'MIS-06', name: 'Airport Road', area_type: 'industrial', focus: 'plazas',
    corners: [{ label: 'A & B' }], anchors: [{ name: 'Cargo Hub' }], est_minutes: 90,
  });
});

test('an unreadable saved time reads "earlier"', () => {
  assert.equal(savedAtLabel('not a date'), 'earlier');
  assert.notEqual(savedAtLabel(NOW), 'earlier');
});
