// Pure helpers shared by the admin zone screens: the code rule and display formatting.
// (Zones are patrol_routes rows; the zone form itself is in zoneForm.ts.)
// No Supabase or React here, so tests/routeForm.test.ts can run them directly.

export const CODE_MAX = 30;

/**
 * Zone codes: letters, digits, single spaces and hyphens, starting and ending with a letter or
 * digit. The same rule as the CSV import, import_zones (015) and the 014 CHECK.
 */
export const CODE_PATTERN = /^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$/;

/** "  con   ab-01 " -> "CON AB-01": trimmed, repeated spaces collapsed, upper case. Codes are stored this way. */
export const normaliseCode = (code: string): string => code.trim().replace(/\s+/g, ' ').toUpperCase();

/** True when `code` matches any existing code (retired zones included), ignoring case and spacing. */
export function isCodeTaken(code: string, existingCodes: readonly (string | null)[]): boolean {
  const wanted = normaliseCode(code);
  return existingCodes.some((c) => c !== null && normaliseCode(c) === wanted);
}

/** Minutes between two ISO timestamps as HH:MM, or null when the patrol hasn't ended. */
export function formatDurationHHMM(startedAt: string, endedAt: string | null): string | null {
  if (!endedAt) return null;
  const mins = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000));
  if (!Number.isFinite(mins)) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
