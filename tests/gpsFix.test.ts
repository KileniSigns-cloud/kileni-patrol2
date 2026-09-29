// Quick Catch location: fresh readings, which reading a lead is saved with, the GPS-or-address
// rule, the Save countdown and the one-submit-at-a-time gate (src/lib/gpsFix.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCURACY_WARN_M, FRESH_MS, GpsError, SUBMIT_WAIT_MS, chooseFix, createSubmitGate, gpsErrorText, isGoodFix,
  quickCatchLocationCheck, requestFix, resolveSubmitFix, secondsLeft, withTimeout, type Fix, type GeoLike,
} from '../src/lib/gpsFix.ts';

const T0 = 1_800_000_000_000;
const fix = (at: number, accuracy: number | null = 10, lat = 43.8672, lng = -79.4575): Fix => ({ lat, lng, accuracy, at });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A geolocation that answers with `answer` after `delayMs`, or never when answer is 'never'. */
function fakeGeo(answer: { lat: number; lng: number; accuracy?: number } | { code: number } | 'never', delayMs = 0) {
  const calls: { timeout?: number; maximumAge?: number; enableHighAccuracy?: boolean }[] = [];
  const geo: GeoLike = {
    getCurrentPosition(ok, fail, options) {
      calls.push(options ?? {});
      if (answer === 'never') return;
      setTimeout(() => {
        if ('code' in answer) fail?.({ code: answer.code });
        else ok({ coords: { latitude: answer.lat, longitude: answer.lng, accuracy: answer.accuracy } });
      }, delayMs);
    },
  };
  return { geo, calls };
}

// ── requestFix ──────────────────────────────────────────────────────────────

test('requestFix: a fresh, high-accuracy reading, stamped when it arrives, accuracy rounded', async () => {
  const { geo, calls } = fakeGeo({ lat: 43.8671929, lng: -79.4574547, accuracy: 12.6 });
  const f = await requestFix(geo, { timeoutMs: 1000, now: () => T0 });
  assert.deepEqual(f, { lat: 43.8671929, lng: -79.4574547, accuracy: 13, at: T0 });
  assert.deepEqual(calls, [{ enableHighAccuracy: true, timeout: 1000, maximumAge: 0 }], 'never a cached position');
});

test('requestFix: missing accuracy is null, not 0', async () => {
  const { geo } = fakeGeo({ lat: 1, lng: 2 });
  assert.equal((await requestFix(geo, { timeoutMs: 1000 })).accuracy, null);
});

test('requestFix: browser errors keep their code (denied 1, unavailable 2, timeout 3)', async () => {
  for (const code of [1, 2, 3] as const) {
    await assert.rejects(requestFix(fakeGeo({ code }).geo, { timeoutMs: 1000 }),
      (e: unknown) => e instanceof GpsError && e.code === code);
  }
  await assert.rejects(requestFix(fakeGeo({ code: 99 }).geo, { timeoutMs: 1000 }),
    (e: unknown) => e instanceof GpsError && e.code === 2, 'unknown codes count as unavailable');
});

test('requestFix: our own timer ends a browser that never answers', async () => {
  await assert.rejects(requestFix(fakeGeo('never').geo, { timeoutMs: 30 }),
    (e: unknown) => e instanceof GpsError && e.code === 3);
});

test('requestFix: no geolocation on the device is "unavailable"', async () => {
  await assert.rejects(requestFix(undefined, { timeoutMs: 30 }), (e: unknown) => e instanceof GpsError && e.code === 2);
});

test('error texts: denied tells the patroller what to do', () => {
  assert.match(gpsErrorText(1), /blocked.*settings.*address/);
  assert.match(gpsErrorText(3), /No GPS fix yet/);
  assert.match(gpsErrorText(2), /unavailable/);
});

test('withTimeout: value if in time, fallback if late or failed', async () => {
  assert.equal(await withTimeout(Promise.resolve('a'), 50, null), 'a');
  assert.equal(await withTimeout(sleep(100).then(() => 'late'), 20, null), null);
  assert.equal(await withTimeout(Promise.reject(new Error('x')), 50, null), null);
});

// ── Which reading ───────────────────────────────────────────────────────────

test('good = at most 60 s old and at most 50 m', () => {
  assert.equal(isGoodFix(fix(T0, ACCURACY_WARN_M), T0 + FRESH_MS), true);
  assert.equal(isGoodFix(fix(T0, ACCURACY_WARN_M + 1), T0), false);
  assert.equal(isGoodFix(fix(T0, 5), T0 + FRESH_MS + 1), false);
  assert.equal(isGoodFix(fix(T0, null), T0), false, 'unknown accuracy is not good enough to skip a fresh reading');
});

test('chooseFix: newest reading from this form; readings from the previous catch never count', () => {
  const formStartedAt = T0;
  const previousCatch = fix(T0 - 1, 5);
  const pageOpen = fix(T0 + 1_000, 30);
  const firstPhoto = fix(T0 + 20_000, 80);
  assert.equal(chooseFix([pageOpen, firstPhoto, null], formStartedAt), firstPhoto);
  assert.equal(chooseFix([previousCatch], formStartedAt), null, 'Log another must not reuse the last location');
  assert.equal(chooseFix([null, null], formStartedAt), null);
});

test('submit with a good recent reading uses it at once: no wait, no new request', async () => {
  const current = fix(T0, 8);
  let refreshed = 0;
  let waited = false;
  const r = await resolveSubmitFix({
    current, formStartedAt: T0 - 5, now: () => T0 + 30_000,
    refresh: async () => { refreshed += 1; return null; }, onWait: () => { waited = true; },
  });
  assert.equal(r, current);
  assert.equal(refreshed, 0);
  assert.equal(waited, false);
});

test('submit with an old or approximate reading waits for a fresh one and reports the deadline', async () => {
  const fresh = fix(T0 + 61_000, 6, 43.9, -79.5);
  const deadlines: number[] = [];
  const asked: number[] = [];
  const r = await resolveSubmitFix({
    current: fix(T0, 8), formStartedAt: T0, now: () => T0 + 61_000,
    refresh: async (ms) => { asked.push(ms); return fresh; }, onWait: (d) => deadlines.push(d),
  });
  assert.equal(r, fresh);
  assert.deepEqual(asked, [SUBMIT_WAIT_MS]);
  assert.deepEqual(deadlines, [T0 + 61_000 + SUBMIT_WAIT_MS]);
});

test('slow fix: after the wait, submit falls back to the newest earlier reading from this form', async () => {
  const earlier = fix(T0 + 1_000, 140);
  const r = await resolveSubmitFix({
    current: earlier, formStartedAt: T0, now: () => T0 + 5_000,
    refresh: () => sleep(200).then(() => fix(T0 + 9_000)), waitMs: 20,
  });
  assert.equal(r, earlier, 'the 8 s cap wins; the late reading is not waited for');
});

test('timeout or denied with no earlier reading: no location', async () => {
  const r = await resolveSubmitFix({ current: null, formStartedAt: T0, now: () => T0, refresh: async () => null, waitMs: 20 });
  assert.equal(r, null);
});

test('a reading from the previous catch is ignored at submit, even if it is still in memory', async () => {
  const stale = fix(T0 - 10, 5);
  const r = await resolveSubmitFix({ current: stale, formStartedAt: T0, now: () => T0 + 1, refresh: async () => null, waitMs: 20 });
  assert.equal(r, null);
});

// ── GPS or address; accuracy only warns ─────────────────────────────────────

test('a reading within 50 m saves with no warning (50 m exactly included)', () => {
  assert.deepEqual(quickCatchLocationCheck(fix(T0, 50), ''), { ok: true, warning: null });
  assert.deepEqual(quickCatchLocationCheck(fix(T0, null), ''), { ok: true, warning: null });
});

test('a reading worse than 50 m saves with a warning, never a block', () => {
  assert.deepEqual(quickCatchLocationCheck(fix(T0, 51), ''), { ok: true, warning: 'Saved with an approximate location (± 51 m).' });
  assert.equal(quickCatchLocationCheck(fix(T0, 900), '').ok, true);
});

test('no reading but an address: saves', () => {
  assert.deepEqual(quickCatchLocationCheck(null, ' 1 Main St '), { ok: true, warning: null });
});

test('no reading and no address (blank or spaces): blocked with what to do', () => {
  for (const address of ['', '   ']) {
    assert.deepEqual(quickCatchLocationCheck(null, address), {
      ok: false, error: 'No location. Type the address, or tap Retry location.',
    });
  }
});

// ── Countdown and double tap ────────────────────────────────────────────────

test('countdown shows whole seconds left, never below 0', () => {
  const deadline = T0 + SUBMIT_WAIT_MS;
  assert.equal(secondsLeft(deadline, T0), 8);
  assert.equal(secondsLeft(deadline, T0 + 7_001), 1);
  assert.equal(secondsLeft(deadline, T0 + 7_999), 1);
  assert.equal(secondsLeft(deadline, T0 + 8_000), 0);
  assert.equal(secondsLeft(deadline, T0 + 9_000), 0);
});

test('a second tap while submit waits for the location does not submit twice', async () => {
  // The page's handleSubmit is gate.run(submit); submit waits for a fresh reading, then saves.
  const gate = createSubmitGate();
  let saves = 0;
  let refreshes = 0;
  const submit = async () => {
    await resolveSubmitFix({
      current: null, formStartedAt: T0, now: () => T0,
      refresh: async () => { refreshes += 1; await sleep(30); return fix(T0 + 1); }, waitMs: 1000,
    });
    saves += 1;
  };
  const first = gate.run(submit);
  const second = gate.run(submit); // tapped again during the wait
  const third = gate.run(submit);
  assert.equal(gate.busy, true);
  assert.equal(second, first, 'the second tap gets the running submit back');
  assert.equal(third, first);
  await Promise.all([first, second, third]);
  assert.equal(saves, 1);
  assert.equal(refreshes, 1);
  assert.equal(gate.busy, false);
});

test('after a submit finishes (or fails), the next tap submits again', async () => {
  const gate = createSubmitGate();
  let runs = 0;
  await gate.run(async () => { runs += 1; });
  await gate.run(async () => { runs += 1; throw new Error('network'); }).catch(() => {});
  await gate.run(async () => { runs += 1; });
  assert.equal(runs, 3);
  assert.equal(gate.busy, false);
});
