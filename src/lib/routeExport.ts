// Route export (CSV): the route, every business logged on it and its patrol history.
// Pure: rows and CSV text from already-fetched data, so tests/routeExport.test.ts runs it
// directly. The query lives in routesApi.fetchRouteExport.
//
// One row per logged business ("visit"). A patrol with no businesses still gets a row
// ("patrol_no_businesses"), so every patrol appears. PATROL v1 businesses linked to the
// route without a session are visits with blank session columns.

import { minutesBetween, RESUME_WINDOW_HOURS } from './patrolHistory.ts';
import { formatDurationHHMM } from './routeForm.ts';

export const EXPORT_TIME_ZONE = 'America/Toronto';

export interface ExportSign {
  id: string;
  condition: string[] | null;
  condition_rating: string | null;
  lead_id: string | null;
  inspection_photos: { photo_type: string | null }[];
}

export interface ExportBusiness {
  id: string;
  name: string | null;
  address: string | null;
  lat: number | string | null;
  lng: number | string | null;
  gps_captured_at: string | null;
  date_added: string | null;
  notes: string | null;
  sign_inspections: ExportSign[] | null;
}

export interface ExportSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  is_complete: boolean | null;
  patroller_name: string | null;
  patrol_businesses: ExportBusiness[] | null;
}

export interface ExportRoute {
  id: string;
  code: string | null;
  name: string;
  archived_at: string | null;
}

export const ROUTE_EXPORT_COLUMNS = [
  'route_code',
  'route_name',
  'route_status',
  'row_type',
  'patrol_date',
  'session_id',
  'patroller_name',
  'session_started_at',
  'session_ended_at',
  'session_duration_min',
  'session_duration_hhmm',
  'duration_flag',
  'session_status',
  'business_id',
  'business_name',
  'address',
  'lat',
  'lng',
  'gps_captured_at',
  'logged_at',
  'business_notes',
  'signs_logged',
  'photo_count',
  'sign_photo_count',
  'surrounding_photo_count',
  'issues',
  'worst_condition',
  'lead_ids',
] as const;

export type ExportColumn = (typeof ROUTE_EXPORT_COLUMNS)[number];
export type Cell = string | number | null;
export type ExportRow = Record<ExportColumn, Cell>;

/** Durations above the resume window (12 h) are almost always patrols never ended. */
export const DURATION_FLAG_MINUTES = RESUME_WINDOW_HOURS * 60;

// getSeverity's scale, best to worst.
const CONDITION_RANK = ['excellent', 'good', 'fair', 'poor', 'critical'];

const localParts = (iso: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EXPORT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
};

/** "2026-09-23" in Toronto time, or null. */
export const localDate = (iso: string | null): string | null => (iso ? localParts(iso).date : null);

/** "2026-09-23 19:04" in Toronto time, or null. */
export const localDateTime = (iso: string | null): string | null => {
  if (!iso) return null;
  const p = localParts(iso);
  return `${p.date} ${p.time}`;
};

function worstCondition(signs: readonly ExportSign[]): string | null {
  let worst = -1;
  for (const s of signs) worst = Math.max(worst, CONDITION_RANK.indexOf(s.condition_rating ?? ''));
  return worst >= 0 ? CONDITION_RANK[worst] : null;
}

const distinct = <T>(xs: readonly T[]) => [...new Set(xs)];

function businessCells(b: ExportBusiness): Pick<ExportRow,
  'business_id' | 'business_name' | 'address' | 'lat' | 'lng' | 'gps_captured_at' | 'logged_at' | 'business_notes' |
  'signs_logged' | 'photo_count' | 'sign_photo_count' | 'surrounding_photo_count' | 'issues' | 'worst_condition' | 'lead_ids'> {
  const signs = b.sign_inspections ?? [];
  // Photos are counted through the signs: inspection_photos.business_id is not always set.
  const photos = signs.flatMap((s) => s.inspection_photos ?? []);
  const toNumber = (v: number | string | null) => (v === null || v === '' ? null : Number(v));
  return {
    business_id: b.id,
    business_name: b.name,
    address: b.address,
    lat: toNumber(b.lat),
    lng: toNumber(b.lng),
    gps_captured_at: localDateTime(b.gps_captured_at),
    logged_at: localDateTime(b.date_added),
    business_notes: b.notes,
    signs_logged: signs.length,
    photo_count: photos.length,
    sign_photo_count: photos.filter((p) => p.photo_type === 'sign').length,
    surrounding_photo_count: photos.filter((p) => p.photo_type === 'surrounding').length,
    issues: distinct(signs.flatMap((s) => s.condition ?? [])).join('; ') || null,
    worst_condition: worstCondition(signs),
    lead_ids: distinct(signs.map((s) => s.lead_id).filter((x): x is string => !!x)).join('; ') || null,
  };
}

const EMPTY_BUSINESS = {
  business_id: null, business_name: null, address: null, lat: null, lng: null, gps_captured_at: null,
  logged_at: null, business_notes: null, signs_logged: null, photo_count: null, sign_photo_count: null,
  surrounding_photo_count: null, issues: null, worst_condition: null, lead_ids: null,
} as const;

const EMPTY_SESSION = {
  patrol_date: null, session_id: null, patroller_name: null, session_started_at: null, session_ended_at: null,
  session_duration_min: null, session_duration_hhmm: null, duration_flag: null, session_status: null,
} as const;

function sessionCells(s: ExportSession): Pick<ExportRow, keyof typeof EMPTY_SESSION> {
  const minutes = minutesBetween(s.started_at, s.ended_at);
  return {
    patrol_date: localDate(s.started_at),
    session_id: s.id,
    patroller_name: s.patroller_name,
    session_started_at: localDateTime(s.started_at),
    session_ended_at: localDateTime(s.ended_at),
    session_duration_min: minutes,
    session_duration_hhmm: formatDurationHHMM(s.started_at, s.ended_at),
    duration_flag: minutes !== null && minutes > DURATION_FLAG_MINUTES ? 'over_12h' : null,
    session_status: s.is_complete || s.ended_at ? 'finished' : 'not_finished',
  };
}

const byTime = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '');

/** Export rows, oldest patrol first; businesses in the order they were logged. */
export function buildRouteExportRows(
  route: ExportRoute,
  sessions: readonly ExportSession[],
  routeBusinesses: readonly ExportBusiness[],
): ExportRow[] {
  const routeCells = {
    route_code: route.code,
    route_name: route.name,
    route_status: route.archived_at ? 'archived' : 'active',
  };
  const rows: ExportRow[] = [];
  const seen = new Set<string>();

  for (const s of [...sessions].sort((a, b) => byTime(a.started_at, b.started_at))) {
    const businesses = [...(s.patrol_businesses ?? [])].sort((a, b) => byTime(a.date_added, b.date_added));
    if (businesses.length === 0) {
      rows.push({ ...routeCells, row_type: 'patrol_no_businesses', ...sessionCells(s), ...EMPTY_BUSINESS });
    }
    for (const b of businesses) {
      seen.add(b.id);
      rows.push({ ...routeCells, row_type: 'visit', ...sessionCells(s), ...businessCells(b) });
    }
  }

  for (const b of [...routeBusinesses].sort((x, y) => byTime(x.date_added, y.date_added))) {
    if (seen.has(b.id)) continue;
    rows.push({ ...routeCells, row_type: 'visit', ...EMPTY_SESSION, ...businessCells(b) });
  }
  return rows;
}

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (=, +, -, @, tab, CR at the
 * start) gets a leading apostrophe; numbers are written as numbers (so -79.38 stays a number).
 */
export function csvCell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV text with a UTF-8 BOM (so Excel reads accents) and CRLF line ends. */
export function toCsv(rows: readonly ExportRow[]): string {
  const lines = [ROUTE_EXPORT_COLUMNS.join(','), ...rows.map((r) => ROUTE_EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** zone-CON-01-2026-09-28.csv (Toronto date; anything but letters, digits, - and _ becomes -). */
export function routeExportFileName(code: string | null, nowIso: string): string {
  const safe = (code ?? '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'zone';
  return `zone-${safe}-${localDate(nowIso)}.csv`;
}
