// Quick Catch location: which GPS reading a lead gets, and whether it may be saved.
// Pure (no React, no Supabase), so tests/gpsFix.test.ts runs it with a fake geolocation.
//
// A reading is taken when the page opens, again at the first photo, and at submit when the
// newest one isn't recent and precise enough. Only readings taken since the current form
// started count, so "Log another" can never reuse the previous catch's location.

/** Above this radius (metres) the location is shown as approximate. It never blocks a save. */
export const ACCURACY_WARN_M = 50;
/** A good reading this recent is used at submit without asking again. */
export const FRESH_MS = 60_000;
/** Longest submit waits for a fresh reading before falling back. */
export const SUBMIT_WAIT_MS = 8_000;
/** Page-open and first-photo readings. */
export const BACKGROUND_TIMEOUT_MS = 10_000;

export interface Fix {
  lat: number;
  lng: number;
  /** Metres (95% radius), rounded; null when the browser doesn't report it. */
  accuracy: number | null;
  /** When the reading reached the app (Date.now()), not the device's own timestamp. */
  at: number;
}

/** 1 permission denied, 2 position unavailable, 3 timeout (the Geolocation API codes). */
export type GpsErrorCode = 1 | 2 | 3;

export class GpsError extends Error {
  code: GpsErrorCode;
  constructor(code: GpsErrorCode) {
    super(gpsErrorText(code));
    this.name = 'GpsError';
    this.code = code;
  }
}

/** The part of navigator.geolocation that is used. */
export interface GeoLike {
  getCurrentPosition(
    success: (pos: { coords: { latitude: number; longitude: number; accuracy?: number | null } }) => void,
    error?: (err: { code: number }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
}

export function gpsErrorText(code: GpsErrorCode): string {
  if (code === 1) return 'Location is blocked for this site. Allow it in your browser or phone settings, or type the address.';
  if (code === 3) return 'No GPS fix yet. Step outside or wait, then tap Retry.';
  return 'Location unavailable. Step outside and tap Retry.';
}

const toCode = (code: number): GpsErrorCode => (code === 1 || code === 3 ? code : 2);

/**
 * One fresh reading. Settles exactly once: with the reading, with the browser's error, or
 * with a timeout from our own timer (some browsers never call back at all).
 */
export function requestFix(
  geo: GeoLike | undefined,
  opts: { timeoutMs: number; now?: () => number },
): Promise<Fix> {
  const now = opts.now ?? Date.now;
  return new Promise<Fix>((resolve, reject) => {
    if (!geo) { reject(new GpsError(2)); return; }
    let done = false;
    const settle = (f: () => void) => { if (!done) { done = true; clearTimeout(timer); f(); } };
    const timer = setTimeout(() => settle(() => reject(new GpsError(3))), opts.timeoutMs);
    try {
      geo.getCurrentPosition(
        (pos) => settle(() => {
          const acc = pos.coords.accuracy;
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: typeof acc === 'number' && Number.isFinite(acc) ? Math.round(acc) : null,
            at: now(),
          });
        }),
        (err) => settle(() => reject(new GpsError(toCode(err.code)))),
        { enableHighAccuracy: true, timeout: opts.timeoutMs, maximumAge: 0 },
      );
    } catch {
      settle(() => reject(new GpsError(2)));
    }
  });
}

/** `promise`, or `fallback` once `ms` have passed (the promise keeps running). */
export function withTimeout<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise<T | F>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

/** Readings from before the current form started belong to an earlier catch. */
export const isFromForm = (fix: Fix | null, formStartedAt: number): fix is Fix =>
  fix !== null && fix.at >= formStartedAt;

export const isApproximate = (fix: Fix): boolean => fix.accuracy !== null && fix.accuracy > ACCURACY_WARN_M;

/** Recent and precise enough to save without asking the GPS again. */
export const isGoodFix = (fix: Fix, now: number): boolean =>
  now - fix.at <= FRESH_MS && fix.accuracy !== null && fix.accuracy <= ACCURACY_WARN_M;

/** The newest reading from this form, or null. */
export function chooseFix(candidates: readonly (Fix | null)[], formStartedAt: number): Fix | null {
  let best: Fix | null = null;
  for (const c of candidates) {
    if (isFromForm(c, formStartedAt) && (best === null || c.at > best.at)) best = c;
  }
  return best;
}

/**
 * The reading a Quick Catch is saved with. A good recent one is used at once; otherwise a
 * fresh reading is awaited for up to `waitMs` (onWait gets the deadline, for the countdown)
 * and, failing that, the newest earlier reading from this form is used.
 */
export async function resolveSubmitFix(o: {
  current: Fix | null;
  formStartedAt: number;
  now: () => number;
  refresh: (timeoutMs: number) => Promise<Fix | null>;
  waitMs?: number;
  onWait?: (deadline: number) => void;
}): Promise<Fix | null> {
  const waitMs = o.waitMs ?? SUBMIT_WAIT_MS;
  const current = isFromForm(o.current, o.formStartedAt) ? o.current : null;
  if (current && isGoodFix(current, o.now())) return current;
  o.onWait?.(o.now() + waitMs);
  const fresh = await withTimeout(o.refresh(waitMs), waitMs, null);
  return chooseFix([fresh, current], o.formStartedAt);
}

export type LocationCheck =
  | { ok: true; warning: string | null }
  | { ok: false; error: string };

/** A Quick Catch needs a GPS reading or an address. Poor accuracy only warns. */
export function quickCatchLocationCheck(fix: Fix | null, address: string): LocationCheck {
  if (fix) {
    return { ok: true, warning: isApproximate(fix) ? `Saved with an approximate location (± ${fix.accuracy} m).` : null };
  }
  if (address.trim()) return { ok: true, warning: null };
  return { ok: false, error: 'No location. Type the address, or tap Retry location.' };
}

/** Whole seconds left until `deadline`, for the Save button countdown. */
export const secondsLeft = (deadline: number, now: number): number => Math.max(0, Math.ceil((deadline - now) / 1000));

/**
 * Lets one submit run at a time. A second tap while the first is still running gets the
 * same promise back and does not start another save.
 */
export function createSubmitGate() {
  let pending: Promise<void> | null = null;
  return {
    get busy() { return pending !== null; },
    run(fn: () => Promise<void>): Promise<void> {
      if (pending) return pending;
      const p = (async () => { try { await fn(); } finally { pending = null; } })();
      pending = p;
      return p;
    },
  };
}
