/** Readable message from anything thrown, including supabase-js error objects. */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown; details?: unknown }).message ?? (e as { details?: unknown }).details;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}
