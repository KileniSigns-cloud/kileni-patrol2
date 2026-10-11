// Zone rules shared by the admin form and the CSV import: text clean-up, GPS parsing, corner
// and anchor checks, the "no code in the name" rule. Values are trimmed and normalised here
// before saving, because the DB (migration 014) rejects untrimmed text.
// Pure (no Supabase or React), so tests/zoneForm.test.ts runs it directly.

import { CODE_MAX, CODE_PATTERN, normaliseCode } from './routeForm.ts';
import { MAX_CORNERS, MIN_CORNERS, cornerList, anchorList, gpsText, type Anchor, type Corner } from './zoneInfo.ts';
import type { PatrolRoute } from '../types/index.ts';

export { CODE_MAX, CODE_PATTERN, normaliseCode };

/** Same caps as the 014 CHECKs and import_zones (015). */
export const CAPS = {
  name: 100, area_type: 200, focus: 1000, corner: 100, anchors: 30, anchor_name: 150, anchor_address: 300, est_minutes: 1440,
} as const;

/** Offered as suggestions; area type is free text. */
export const AREA_TYPE_SUGGESTIONS = ['Industrial', 'Commercial', 'Mixed'] as const;

// Rejected in every text value (014 and 015 reject the same set): C0 controls except tab/LF/CR,
// DEL, zero-width and direction marks, line/paragraph separators, bidi embeddings, overrides and
// isolates, BOM. Plus NUL, which jsonb can't carry.
const BAD_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x2029],
  [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff],
];
const hex4 = (n: number) => n.toString(16).padStart(4, '0');
export const BAD_CHARS = new RegExp(
  `[${BAD_RANGES.map(([a, b]) => (a === b ? `\\u${hex4(a)}` : `\\u${hex4(a)}-\\u${hex4(b)}`)).join('')}]`,
);

/** One-line text: tabs, line breaks and repeated spaces become one space; trimmed. */
export const oneLine = (s: string): string => s.replace(/[ \t\r\n]+/g, ' ').trim();

/** Multi-line text (focus): line ends become \n; trimmed at both ends. */
export const multiLine = (s: string): string => s.replace(/\r\n|\r/g, '\n').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

/**
 * "43.7945, -79.4701" -> {lat, lng}, rounded to 6 decimals. Decimal degrees only, comma between,
 * spaces allowed. Anything else (degrees/minutes, decimal commas, a third number) is an error.
 */
export function parseGps(text: string): { lat: number; lng: number } | { error: string } {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return { error: 'GPS must be "lat,lng" in decimal degrees, e.g. copied from Google Maps' };
  const lat = Number(Number(m[1]).toFixed(6));
  const lng = Number(Number(m[2]).toFixed(6));
  if (lat < -90 || lat > 90) return { error: 'GPS latitude must be between -90 and 90' };
  if (lng < -180 || lng > 180) return { error: 'GPS longitude must be between -180 and 180' };
  return { lat, lng };
}

/**
 * One corner from its two cells: intersection text and optional "lat,lng". Returns the stored
 * shape, or the problems (prefixed "corner N"). Blank text with blank GPS is "no corner" (null).
 */
export function checkCorner(n: number, labelIn: string, gpsIn: string): { corner: Corner | null; errors: string[]; warnings: string[] } {
  const label = oneLine(labelIn);
  const gps = gpsIn.trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (label === '' && gps === '') return { corner: null, errors, warnings };
  if (label === '') errors.push(`corner ${n}: GPS given without the intersection`);
  if (label.length > CAPS.corner) errors.push(`corner ${n}: over ${CAPS.corner} characters`);
  if (label.includes('|')) errors.push(`corner ${n}: "|" is not allowed (Google Maps uses it to separate stops)`);
  if (BAD_CHARS.test(label)) errors.push(`corner ${n}: contains control or invisible characters`);
  let corner: Corner = { label };
  if (gps !== '') {
    const p = parseGps(gps);
    if ('error' in p) errors.push(`corner ${n}: ${p.error}`);
    else {
      corner = { label, lat: p.lat, lng: p.lng };
      if (p.lat === 0 && p.lng === 0) warnings.push(`corner ${n}: GPS is 0,0 (in the ocean off Africa). Check it.`);
    }
  }
  return { corner: errors.length ? null : corner, errors, warnings };
}

/** Corner list rules on top of each corner's own: 4 to 8, no gaps. `given` = per-slot result, null = blank slot. */
export function checkCornerSlots(given: readonly (Corner | null | 'bad')[], required: boolean): string[] {
  const errors: string[] = [];
  const lastFilled = given.reduce((last, c, i) => (c !== null ? i : last), -1);
  const count = lastFilled + 1;
  if (count === 0) return required ? [`at least ${MIN_CORNERS} corners are required`] : [];
  const gaps = given.slice(0, count).map((c, i) => (c === null ? i + 1 : null)).filter((n): n is number => n !== null);
  if (gaps.length) errors.push(`corner ${gaps.join(', ')} ${gaps.length === 1 ? 'is' : 'are'} blank: corners must be filled in order, with no gaps`);
  else if (count < MIN_CORNERS) errors.push(`at least ${MIN_CORNERS} corners are required (found ${count})`);
  if (count > MAX_CORNERS) errors.push(`at most ${MAX_CORNERS} corners`);
  return errors;
}

/** One anchor from "Name | Address" (address optional). */
export function checkAnchor(nameIn: string, addressIn: string, where: string): { anchor: Anchor | null; errors: string[] } {
  const name = oneLine(nameIn);
  const address = oneLine(addressIn);
  const errors: string[] = [];
  if (name === '' && address === '') return { anchor: null, errors };
  if (name === '') errors.push(`${where}: name is required`);
  if (name.length > CAPS.anchor_name) errors.push(`${where}: name is over ${CAPS.anchor_name} characters`);
  if (address.length > CAPS.anchor_address) errors.push(`${where}: address is over ${CAPS.anchor_address} characters`);
  if (BAD_CHARS.test(name) || BAD_CHARS.test(address)) errors.push(`${where}: contains control or invisible characters`);
  return { anchor: errors.length ? null : address ? { name, address } : { name }, errors };
}

/**
 * True when the name holds the zone's own code as a word ("CON-01: Concord", "con 01 Concord").
 * The code is shown beside the name everywhere, so it must not be repeated inside it.
 */
export function nameHasCode(name: string, code: string): boolean {
  const c = normaliseCode(code);
  if (!c || !CODE_PATTERN.test(c)) return false;
  const pattern = c.split(/[ -]+/).join('[ -]*');
  return new RegExp(`(^|[^A-Z0-9])${pattern}($|[^A-Z0-9])`).test(name.toUpperCase());
}

/** Something code-shaped at the start of the name ("MIS-01 Lakeview"): a warning, not an error. */
export const nameLooksCoded = (name: string): boolean => /^[A-Z]{2,}[ -]?\d+\b/i.test(name.trim());

/** est_minutes as typed: blank = null; a whole number 1-1440, or an error. */
export function parseEstMinutes(text: string): number | null | { error: string } {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d{1,4}$/.test(t)) return { error: 'est_minutes must be a whole number of minutes' };
  const n = Number(t);
  if (n < 1 || n > CAPS.est_minutes) return { error: `est_minutes must be between 1 and ${CAPS.est_minutes}` };
  return n;
}

// ── Admin form ───────────────────────────────────────────────────────────────

export interface CornerDraft { label: string; gps: string }
export interface AnchorDraft { name: string; address: string }

export interface ZoneFormValues {
  code: string;
  name: string;
  area_type: string;
  focus: string;
  est_minutes: string;
  corners: CornerDraft[];
  anchors: AnchorDraft[];
}

export interface ZoneFormErrors {
  code?: string;
  name?: string;
  area_type?: string;
  focus?: string;
  est_minutes?: string;
  /** About the list as a whole (count). */
  corners?: string;
  anchors?: string;
  /** Per corner row, by index. */
  cornerRows?: Record<number, string>;
  anchorRows?: Record<number, string>;
}

const blankCorners = (): CornerDraft[] => Array.from({ length: MIN_CORNERS }, () => ({ label: '', gps: '' }));

export const emptyZoneForm = (): ZoneFormValues => ({
  code: '', name: '', area_type: '', focus: '', est_minutes: '', corners: blankCorners(), anchors: [],
});

/** The form for an existing zone. Old rows without corners get 4 blank rows. */
export function zoneFormFrom(route: Pick<PatrolRoute, 'code' | 'name' | 'area_type' | 'focus' | 'est_minutes' | 'corners' | 'anchors'>): ZoneFormValues {
  const corners = cornerList(route.corners).map((c) => ({ label: c.label, gps: gpsText(c) ?? '' }));
  while (corners.length < MIN_CORNERS) corners.push({ label: '', gps: '' });
  return {
    code: route.code ?? '',
    name: route.name,
    area_type: route.area_type ?? '',
    focus: route.focus ?? '',
    est_minutes: route.est_minutes ? String(route.est_minutes) : '',
    corners,
    anchors: anchorList(route.anchors).map((a) => ({ name: a.name, address: a.address ?? '' })),
  };
}

/** The corners the form currently describes, for the live link preview (rows with problems left out). */
export function draftCorners(rows: readonly CornerDraft[]): Corner[] {
  return rows.flatMap((r, i) => checkCorner(i + 1, r.label, r.gps).corner ?? []);
}

const firstLetterUpper = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Field-level validation that needs no database (code uniqueness is checked on save). */
export function validateZoneForm(v: ZoneFormValues): ZoneFormErrors {
  const e: ZoneFormErrors = {};
  const code = normaliseCode(v.code);
  if (!code) e.code = 'Code is required.';
  else if (code.length > CODE_MAX) e.code = `Code must be ${CODE_MAX} characters or fewer.`;
  else if (!CODE_PATTERN.test(code)) {
    e.code = 'Use only letters, numbers, spaces and hyphens, starting and ending with a letter or number (e.g. CON-01).';
  }

  const name = oneLine(v.name);
  if (!name) e.name = 'Name is required.';
  else if (name.length > CAPS.name) e.name = `Name must be ${CAPS.name} characters or fewer.`;
  else if (BAD_CHARS.test(name)) e.name = 'Name contains control or invisible characters.';
  else if (code && nameHasCode(name, code)) e.name = `Leave the code out of the name: ${code} is shown beside it.`;

  const area = oneLine(v.area_type);
  if (!area) e.area_type = 'Area type is required.';
  else if (area.length > CAPS.area_type) e.area_type = `Area type must be ${CAPS.area_type} characters or fewer.`;
  else if (BAD_CHARS.test(area)) e.area_type = 'Area type contains control or invisible characters.';

  const focus = multiLine(v.focus);
  if (focus.length > CAPS.focus) e.focus = `Focus must be ${CAPS.focus} characters or fewer.`;
  else if (BAD_CHARS.test(focus)) e.focus = 'Focus contains control or invisible characters.';

  const est = parseEstMinutes(v.est_minutes);
  if (est !== null && typeof est === 'object') e.est_minutes = `${firstLetterUpper(est.error.replace('est_minutes', 'Estimate'))}.`;

  const cornerRows: Record<number, string> = {};
  v.corners.forEach((r, i) => {
    const res = checkCorner(i + 1, r.label, r.gps);
    if (res.errors.length) cornerRows[i] = `${firstLetterUpper(res.errors.join('; '))}.`;
    else if (!res.corner) cornerRows[i] = `Corner ${i + 1}: enter the intersection, or remove this row.`;
  });
  if (Object.keys(cornerRows).length) e.cornerRows = cornerRows;
  if (v.corners.length < MIN_CORNERS) e.corners = `At least ${MIN_CORNERS} corners are required.`;
  if (v.corners.length > MAX_CORNERS) e.corners = `At most ${MAX_CORNERS} corners.`;

  const anchorRows: Record<number, string> = {};
  if (v.anchors.length > CAPS.anchors) e.anchors = `At most ${CAPS.anchors} anchors.`;
  v.anchors.forEach((a, i) => {
    const res = checkAnchor(a.name, a.address, `Anchor ${i + 1}`);
    if (res.errors.length) anchorRows[i] = `${res.errors.join('; ')}.`;
  });
  if (Object.keys(anchorRows).length) e.anchorRows = anchorRows;
  return e;
}

export const hasErrors = (e: ZoneFormErrors): boolean =>
  Object.entries(e).some(([, v]) => v !== undefined && (typeof v === 'string' || Object.keys(v).length > 0));

/** Row shape written to patrol_routes. Optional text is null, not ''. Old route columns are not written. */
export function toZoneRow(v: ZoneFormValues) {
  const est = parseEstMinutes(v.est_minutes);
  const focus = multiLine(v.focus);
  const anchors = v.anchors.flatMap((a, i) => checkAnchor(a.name, a.address, `Anchor ${i + 1}`).anchor ?? []);
  return {
    code: normaliseCode(v.code),
    name: oneLine(v.name),
    area_type: oneLine(v.area_type),
    focus: focus === '' ? null : focus,
    est_minutes: typeof est === 'number' ? est : null,
    corners: v.corners.flatMap((r, i) => checkCorner(i + 1, r.label, r.gps).corner ?? []),
    anchors: anchors.length ? anchors : null,
  };
}
export type ZoneRow = ReturnType<typeof toZoneRow>;
