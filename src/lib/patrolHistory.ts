// Pure helpers for History, Resume and route cards. No Supabase or React here, so
// tests/patrolHistory.test.ts can run them directly.

export const RESUME_WINDOW_HOURS = 12;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A patrol_sessions row as the History query returns it. */
export interface HistorySessionRow {
  id: string;
  route_id: string;
  started_at: string;
  ended_at: string | null;
  is_complete: boolean | null;
  patroller_id: string | null;
  patroller_name: string | null;
  patrol_routes: { code: string | null; name: string | null } | null;
  patrol_businesses: { id: string; sign_inspections: { id: string; inspection_photos: { count: number }[] }[] }[] | null;
}

export type SessionStatus = 'finished' | 'resumable' | 'in_progress' | 'not_finished';

/**
 * finished: completed. resumable: yours, unfinished, started within the resume window.
 * in_progress: someone else's, unfinished, within the window. not_finished: unfinished
 * and older than the window (never offered for resume).
 */
export function sessionStatus(
  s: Pick<HistorySessionRow, 'is_complete' | 'started_at' | 'patroller_id'>,
  userId: string,
  nowMs: number,
): SessionStatus {
  if (s.is_complete) return 'finished';
  if (!isWithinResumeWindow(s.started_at, nowMs)) return 'not_finished';
  return s.patroller_id === userId ? 'resumable' : 'in_progress';
}

export function isWithinResumeWindow(startedAt: string, nowMs: number): boolean {
  const t = Date.parse(startedAt);
  return Number.isFinite(t) && nowMs - t <= RESUME_WINDOW_HOURS * HOUR_MS;
}

export const resumeCutoffIso = (nowMs: number) => new Date(nowMs - RESUME_WINDOW_HOURS * HOUR_MS).toISOString();

export interface SessionTotals {
  businesses: number;
  signs: number;
  photos: number;
}

export function sessionTotals(s: Pick<HistorySessionRow, 'patrol_businesses'>): SessionTotals {
  const biz = s.patrol_businesses ?? [];
  const signs = biz.flatMap((b) => b.sign_inspections ?? []);
  return {
    businesses: biz.length,
    signs: signs.length,
    photos: signs.reduce((n, i) => n + (i.inspection_photos?.[0]?.count ?? 0), 0),
  };
}

/** The noun for a count: plural('business', 1) -> "business", plural('business', 2, 'businesses'). */
export const plural = (one: string, n: number, many = `${one}s`) => (n === 1 ? one : many);

/** Minutes as h:mm, e.g. 84 -> "1:24". */
export function formatHMM(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes between two ISO timestamps, or null if the end is missing. */
export function minutesBetween(startIso: string, endIso: string | null): number | null {
  if (!endIso) return null;
  const d = Date.parse(endIso) - Date.parse(startIso);
  return Number.isFinite(d) ? Math.max(0, Math.round(d / 60000)) : null;
}

/** Seconds as HH:MM:SS for the live timer bar. */
export function formatClock(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map((v) => String(v).padStart(2, '0')).join(':');
}

/** "never patrolled" / "last patrol today" / "yesterday" / "N days ago" (calendar days). */
export function lastPatrolLabel(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return 'never patrolled';
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return 'never patrolled';
  const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOfDay(nowMs) - startOfDay(t)) / DAY_MS);
  if (days <= 0) return 'last patrol today';
  if (days === 1) return 'last patrol yesterday';
  return `last patrol ${days} days ago`;
}
