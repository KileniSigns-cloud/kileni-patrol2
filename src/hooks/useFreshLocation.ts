import { useCallback, useEffect, useRef, useState } from 'react';
import { BACKGROUND_TIMEOUT_MS, GpsError, requestFix, type Fix, type GpsErrorCode } from '../lib/gpsFix';

/**
 * Quick Catch location. Separate from useGPS (route patrol) so that hook stays exactly as it is.
 *
 * - Reads once on mount, then whenever refresh() is called (first photo, Retry, submit).
 * - A refresh while one is running joins it instead of starting a second reading.
 * - clear() (Log another) forgets the reading and ignores any reading still on its way,
 *   so the next catch can never be saved with the previous one's location.
 * - fixRef always holds the newest reading, for code that awaits (submit) and can't wait
 *   for a re-render.
 */
export function useFreshLocation() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState<'idle' | 'capturing' | 'success' | 'error'>('idle');
  const [errorCode, setErrorCode] = useState<GpsErrorCode | null>(null);
  const fixRef = useRef<Fix | null>(null);
  const generation = useRef(0);
  const inFlight = useRef<Promise<Fix | null> | null>(null);

  const refresh = useCallback((timeoutMs: number = BACKGROUND_TIMEOUT_MS): Promise<Fix | null> => {
    if (inFlight.current) return inFlight.current;
    const gen = generation.current;
    setStatus('capturing');
    setErrorCode(null);
    const p = requestFix(typeof navigator !== 'undefined' ? navigator.geolocation : undefined, { timeoutMs })
      .then((f) => {
        if (gen !== generation.current) return null;
        fixRef.current = f;
        setFix(f);
        setStatus('success');
        return f;
      }, (e: unknown) => {
        if (gen !== generation.current) return null;
        setErrorCode(e instanceof GpsError ? e.code : 2);
        // Keep an earlier reading from this form usable; only the card shows the error.
        setStatus(fixRef.current ? 'success' : 'error');
        return null;
      })
      .finally(() => { if (inFlight.current === p) inFlight.current = null; });
    inFlight.current = p;
    return p;
  }, []);

  const clear = useCallback(() => {
    generation.current += 1;
    inFlight.current = null;
    fixRef.current = null;
    setFix(null);
    setStatus('idle');
    setErrorCode(null);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { fix, fixRef, status, errorCode, refresh, clear };
}
