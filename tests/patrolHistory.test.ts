import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClock, formatHMM, isWithinResumeWindow, lastPatrolLabel, minutesBetween, resumeCutoffIso,
  sessionStatus, sessionTotals,
} from '../src/lib/patrolHistory.ts';
import {
  draftForExistingBusiness, secondsSince, skipsPatrolType, withBusinessAdded, withSignSaved, type LoggedBusiness,
} from '../src/lib/signFlow.ts';

const NOW = Date.parse('2026-09-23T20:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

test('resume is offered only for your own unfinished session from the last 12 hours', () => {
  const mine = { patroller_id: 'me', is_complete: false };
  assert.equal(sessionStatus({ ...mine, started_at: hoursAgo(2) }, 'me', NOW), 'resumable');
  assert.equal(sessionStatus({ ...mine, started_at: hoursAgo(12) }, 'me', NOW), 'resumable', '12 h is inside the window');
  assert.equal(sessionStatus({ ...mine, started_at: hoursAgo(12.01) }, 'me', NOW), 'not_finished');
  assert.equal(sessionStatus({ ...mine, patroller_id: 'someone', started_at: hoursAgo(1) }, 'me', NOW), 'in_progress');
  assert.equal(sessionStatus({ ...mine, is_complete: true, started_at: hoursAgo(1) }, 'me', NOW), 'finished');
});

test('resume cutoff is exactly 12 hours back', () => {
  assert.equal(resumeCutoffIso(NOW), '2026-09-23T08:00:00.000Z');
  assert.equal(isWithinResumeWindow('not a date', NOW), false);
});

test('session totals count businesses, signs and photos from the nested result', () => {
  const totals = sessionTotals({
    patrol_businesses: [
      { id: 'b1', sign_inspections: [
        { id: 's1', inspection_photos: [{ count: 3 }] },
        { id: 's2', inspection_photos: [{ count: 1 }] },
      ] },
      { id: 'b2', sign_inspections: [] },
    ],
  });
  assert.deepEqual(totals, { businesses: 2, signs: 2, photos: 4 });
  assert.deepEqual(sessionTotals({ patrol_businesses: null }), { businesses: 0, signs: 0, photos: 0 });
});

test('durations and clock format', () => {
  assert.equal(formatHMM(84), '1:24');
  assert.equal(formatHMM(5), '0:05');
  assert.equal(minutesBetween(hoursAgo(1.5), new Date(NOW).toISOString()), 90);
  assert.equal(minutesBetween(hoursAgo(1), null), null);
  assert.equal(formatClock(3725), '01:02:05');
  assert.equal(formatClock(-4), '00:00:00');
});

test('last patrol label uses calendar days', () => {
  const localNoon = new Date(2026, 8, 23, 12, 0).getTime();
  assert.equal(lastPatrolLabel(null, localNoon), 'never patrolled');
  assert.equal(lastPatrolLabel(new Date(2026, 8, 23, 7, 0).toISOString(), localNoon), 'last patrol today');
  assert.equal(lastPatrolLabel(new Date(2026, 8, 22, 23, 0).toISOString(), localNoon), 'last patrol yesterday');
  assert.equal(lastPatrolLabel(new Date(2026, 8, 16, 9, 0).toISOString(), localNoon), 'last patrol 7 days ago');
});

const biz = (id: string, patch: Partial<LoggedBusiness> = {}): LoggedBusiness => ({
  id, name: `Biz ${id}`, address: null, lat: 43.7, lng: -79.4, signs: 0, lastPatrolType: null, ...patch,
});

test('business list: add is idempotent, a saved sign bumps its business only', () => {
  let list = withBusinessAdded([], biz('a'));
  list = withBusinessAdded(list, biz('a'));
  list = withBusinessAdded(list, biz('b'));
  assert.deepEqual(list.map((b) => b.id), ['a', 'b']);
  list = withSignSaved(list, 'a', 'night');
  assert.equal(list[0].signs, 1);
  assert.equal(list[0].lastPatrolType, 'night');
  assert.equal(list[1].signs, 0);
});

test('tapping a logged business starts a sign there and skips step 6 only if its patrol type is known', () => {
  const known = draftForExistingBusiness(biz('a', { lastPatrolType: 'day', signs: 2 }));
  assert.equal(known.businessId, 'a');
  assert.equal(known.patrolType, 'day');
  assert.equal(skipsPatrolType(known), true);

  const rebuilt = draftForExistingBusiness(biz('b')); // e.g. rebuilt from the DB after a resume
  assert.equal(rebuilt.businessId, 'b');
  assert.equal(skipsPatrolType(rebuilt), false);
});

test('elapsed seconds come from the start time and never go negative', () => {
  assert.equal(secondsSince(NOW - 90_500, NOW), 90);
  assert.equal(secondsSince(NOW + 5_000, NOW), 0);
});

test('plural picks the singular only for exactly one', async () => {
  const { plural } = await import('../src/lib/patrolHistory.ts');
  assert.equal(plural('business', 1, 'businesses'), 'business');
  assert.equal(plural('business', 0, 'businesses'), 'businesses');
  assert.equal(plural('sign', 2), 'signs');
});
