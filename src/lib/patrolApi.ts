// Read-only queries added by the restyle (approved list, numbered as approved).
// Each returns data or throws an Error with a readable message: supabase-js reports
// failures in `error` rather than throwing, so every call checks it.
//
// Tenant scoping is explicit here. patrol_sessions has no organisation_id and its RLS
// lets any signed-in user read every session, so these queries never rely on RLS.

import { supabase } from './supabase';
import type { LoggedBusiness } from './signFlow';
import { resumeCutoffIso, type HistorySessionRow } from './patrolHistory';

export const HISTORY_PAGE_SIZE = 20;

// patrol_businesses has two identical FKs to sign_inspections, so embeds must name one.
const INSPECTIONS = 'sign_inspections!fk_patrol_business';

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

const rangeFor = (page: number) => [page * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE - 1] as const;

// ── 1. History: patrols ─────────────────────────────────────────────────────

export type HistoryScope = { kind: 'org'; orgId: string } | { kind: 'mine'; userId: string };

/** Newest first, finished and unfinished. Admins: the org's (via the route). Patrollers: their own. */
export async function fetchPatrolHistory(scope: HistoryScope, page: number): Promise<{ rows: HistorySessionRow[]; total: number }> {
  let q = supabase
    .from('patrol_sessions')
    .select(
      `id, route_id, started_at, ended_at, is_complete, patroller_id, patroller_name,
       patrol_routes!inner(code, name, organisation_id),
       patrol_businesses(id, ${INSPECTIONS}(id, inspection_photos(count)))`,
      { count: 'exact' },
    );
  q = scope.kind === 'org' ? q.eq('patrol_routes.organisation_id', scope.orgId) : q.eq('patroller_id', scope.userId);
  const [from, to] = rangeFor(page);
  const { data, error, count } = await q.order('started_at', { ascending: false }).range(from, to);
  if (error) fail('Could not load patrol history', error);
  const rows = (data ?? []) as unknown as HistorySessionRow[];
  return { rows, total: count ?? rows.length };
}

// ── 2. History: Quick Catches ───────────────────────────────────────────────

export interface QuickCatchRow {
  id: string;
  business_name: string | null;
  address: string | null;
  sign_category: string | null;
  sign_type: string | null;
  issue_type: string | null;
  created_at: string;
}

/** The organisation's Quick Catch leads, newest first (explicit organisation_id filter). */
export async function fetchQuickCatches(orgId: string, page: number): Promise<{ rows: QuickCatchRow[]; total: number }> {
  const [from, to] = rangeFor(page);
  const { data, error, count } = await supabase
    .from('leads')
    .select('id, business_name, address, sign_category, sign_type, issue_type, created_at', { count: 'exact' })
    .eq('source', 'PATROL_QUICK_CATCH')
    .eq('organisation_id', orgId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) fail('Could not load Quick Catches', error);
  const rows = (data ?? []) as QuickCatchRow[];
  return { rows, total: count ?? rows.length };
}

// ── 3. Resume lookup ────────────────────────────────────────────────────────

export interface ResumableSession {
  id: string;
  route_id: string;
  started_at: string;
  patrol_routes: { code: string | null; name: string | null } | null;
}

/** The user's newest unfinished session started within the resume window, or null. */
export async function fetchResumableSession(userId: string, nowMs: number): Promise<ResumableSession | null> {
  const { data, error } = await supabase
    .from('patrol_sessions')
    .select('id, route_id, started_at, patrol_routes(code, name)')
    .eq('patroller_id', userId)
    .eq('is_complete', false)
    .gte('started_at', resumeCutoffIso(nowMs))
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) fail('Could not check for an unfinished patrol', error);
  return ((data ?? [])[0] as unknown as ResumableSession | undefined) ?? null;
}

// ── 4. Last patrolled per route ─────────────────────────────────────────────

/** route id -> newest session start (or null). One request: the embed is ordered and limited per route. */
export async function fetchLastPatrolled(orgId: string): Promise<Map<string, string | null>> {
  const { data, error } = await supabase
    .from('patrol_routes')
    .select('id, patrol_sessions(started_at)')
    .eq('organisation_id', orgId)
    .is('archived_at', null)
    .order('started_at', { referencedTable: 'patrol_sessions', ascending: false })
    .limit(1, { referencedTable: 'patrol_sessions' });
  if (error) fail('Could not load last patrol dates', error);
  const rows = (data ?? []) as unknown as { id: string; patrol_sessions: { started_at: string }[] | null }[];
  return new Map(rows.map((r) => [r.id, r.patrol_sessions?.[0]?.started_at ?? null]));
}

// ── 5. Photos on the active patrol ──────────────────────────────────────────

/** Count only (head: true, no rows returned) of photos across the session's businesses. */
export async function countSessionPhotos(businessIds: string[]): Promise<number> {
  if (businessIds.length === 0) return 0;
  const { count, error } = await supabase
    .from('inspection_photos')
    .select('id', { count: 'exact', head: true })
    .in('business_id', businessIds);
  if (error) fail('Could not count photos', error);
  return count ?? 0;
}

// ── 6. Rebuild the business list on resume ──────────────────────────────────

/**
 * Businesses logged on a session with their sign counts. Coordinates come from lat/lng,
 * the pair AddBusinessPage writes (it also writes gps_latitude/gps_longitude, never
 * latitude/longitude).
 */
export async function fetchSessionBusinesses(sessionId: string, orgId: string): Promise<LoggedBusiness[]> {
  const { data, error } = await supabase
    .from('patrol_businesses')
    .select(`id, name, address, lat, lng, ${INSPECTIONS}(count)`)
    .eq('session_id', sessionId)
    .eq('organisation_id', orgId)
    .order('date_added', { ascending: true });
  if (error) fail('Could not load the businesses on this patrol', error);
  const rows = (data ?? []) as unknown as {
    id: string; name: string | null; address: string | null; lat: number | null; lng: number | null;
    sign_inspections: { count: number }[] | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    signs: r.sign_inspections?.[0]?.count ?? 0,
    lastPatrolType: null,
  }));
}
