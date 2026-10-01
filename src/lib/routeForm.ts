// Pure helpers for the admin route screens: form validation and display formatting.
// No Supabase or React here, so tests/routeForm.test.ts can run them directly.

export const AREA_TYPES = ['commercial', 'mixed', 'residential'] as const;
export type AreaType = (typeof AREA_TYPES)[number];

export const NAME_MAX = 100;
export const CODE_MAX = 30;

/**
 * Route codes: letters, digits, single spaces and hyphens, starting and ending with a letter or
 * digit. The same rule as the CSV import and import_routes (migration 013).
 */
export const CODE_PATTERN = /^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$/;

export interface RouteFormValues {
  name: string;
  code: string;
  description: string;
  area_type: AreaType | '';
  focus: string;
  start_point: string;
  hotspots: string[];
}

export type RouteFormErrors = Partial<Record<keyof RouteFormValues, string>>;

export const EMPTY_ROUTE_FORM: RouteFormValues = {
  name: '',
  code: '',
  description: '',
  area_type: '',
  focus: '',
  start_point: '',
  hotspots: [],
};

/** "  grid   mis-01 " -> "GRID MIS-01": trimmed, repeated spaces collapsed, upper case. Codes are stored this way. */
export const normaliseCode = (code: string): string => code.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Field-level validation that needs no database. Code uniqueness is checked separately
 * against the org's existing codes (see isCodeTaken).
 */
export function validateRouteForm(values: RouteFormValues): RouteFormErrors {
  const errors: RouteFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Name is required.';
  else if (name.length > NAME_MAX) errors.name = `Name must be ${NAME_MAX} characters or fewer.`;

  const code = normaliseCode(values.code);
  if (!code) errors.code = 'Code is required.';
  else if (code.length > CODE_MAX) errors.code = `Code must be ${CODE_MAX} characters or fewer.`;
  else if (!CODE_PATTERN.test(code)) {
    errors.code = 'Use only letters, numbers, spaces and hyphens, starting and ending with a letter or number (e.g. GRID MIS-01).';
  }

  if (values.area_type !== '' && !AREA_TYPES.includes(values.area_type)) {
    errors.area_type = 'Choose commercial, mixed or residential.';
  }
  return errors;
}

/** True when `code` matches any existing code (archived routes included), ignoring case and spacing. */
export function isCodeTaken(code: string, existingCodes: readonly (string | null)[]): boolean {
  const wanted = normaliseCode(code);
  return existingCodes.some((c) => c !== null && normaliseCode(c) === wanted);
}

/** Adds a hotspot unless it is blank or already listed (case-insensitive). */
export function addHotspot(hotspots: readonly string[], value: string): string[] {
  const v = value.trim();
  if (!v || hotspots.some((h) => h.toLowerCase() === v.toLowerCase())) return [...hotspots];
  return [...hotspots, v];
}

/** Row shape written to patrol_routes. Optional text fields are stored as null, not ''. */
export function toRouteInsert(values: RouteFormValues, organisationId: string) {
  const orNull = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    organisation_id: organisationId,
    name: values.name.trim(),
    code: normaliseCode(values.code),
    description: orNull(values.description),
    area_type: values.area_type === '' ? null : values.area_type,
    focus: orNull(values.focus),
    start_point: orNull(values.start_point),
    hotspots: values.hotspots,
  };
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
