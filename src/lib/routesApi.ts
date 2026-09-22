// Supabase calls for admin route management. Every function returns data or throws an
// Error with a readable message: supabase-js reports failures in `error` rather than
// throwing, so each call checks it explicitly.

import { supabase } from './supabase';
import type { PatrolRoute } from '../types';
import { formatDurationHHMM, isCodeTaken, toRouteInsert, type RouteFormValues } from './routeForm';

export const HISTORY_PAGE_SIZE = 10;
const STATS_DAYS = 30;
const PAGE = 1000; // PostgREST's default max rows per request

// patrol_businesses has two identical FKs to sign_inspections, so the embed must name one.
const INSPECTIONS = 'sign_inspections!fk_patrol_business';

export interface RouteWithStats extends PatrolRoute {
  patrols30d: number;
  inspections30d: number;
}

export interface RouteHistoryRow {
  id: string;
  startedAt: string;
  patrollerName: string;
  /** HH:MM, or null while the patrol is still running. */
  duration: string | null;
  inspections: number;
  photos: number;
}

export interface RouteHistoryPage {
  rows: RouteHistoryRow[];
  total: number;
}

export class DuplicateCodeError extends Error {
  constructor(code: string) {
    super(`Code "${code.trim()}" is already used by another route.`);
    this.name = 'DuplicateCodeError';
  }
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/** The signed-in user's organisation, read from public.users (not user_metadata). */
export async function getOrgId(): Promise<string> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('You are signed out. Sign in again.');
  const { data, error } = await supabase
    .from('users')
    .select('organisation_id')
    .eq('id', auth.user.id)
    .single();
  if (error) fail('Could not load your profile', error);
  if (!data?.organisation_id) throw new Error('Your profile has no organisation.');
  return data.organisation_id as string;
}

async function fetchRoutes(orgId: string, archived: boolean): Promise<PatrolRoute[]> {
  let q = supabase.from('patrol_routes').select('*').eq('organisation_id', orgId);
  q = archived
    ? q.not('archived_at', 'is', null).order('archived_at', { ascending: false })
    : q.is('archived_at', null).order('name');
  const { data, error } = await q;
  if (error) fail('Could not load routes', error);
  return (data ?? []) as PatrolRoute[];
}

export const fetchArchivedRoutes = (orgId: string) => fetchRoutes(orgId, true);

/** Active routes with patrol and inspection counts for the last 30 days. */
export async function fetchActiveRoutesWithStats(orgId: string): Promise<RouteWithStats[]> {
  const routes = await fetchRoutes(orgId, false);
  if (routes.length === 0) return [];

  const since = new Date(Date.now() - STATS_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const patrols = new Map<string, number>();
  const inspections = new Map<string, number>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('patrol_sessions')
      .select(`route_id, patrol_businesses(${INSPECTIONS}(count))`)
      .in('route_id', routes.map((r) => r.id))
      .gte('started_at', since)
      .order('started_at')
      .range(from, from + PAGE - 1);
    if (error) fail('Could not load route activity', error);
    const rows = (data ?? []) as unknown as {
      route_id: string;
      patrol_businesses: { sign_inspections: { count: number }[] }[] | null;
    }[];
    for (const s of rows) {
      patrols.set(s.route_id, (patrols.get(s.route_id) ?? 0) + 1);
      const n = (s.patrol_businesses ?? []).reduce((sum, b) => sum + (b.sign_inspections[0]?.count ?? 0), 0);
      inspections.set(s.route_id, (inspections.get(s.route_id) ?? 0) + n);
    }
    if (rows.length < PAGE) break;
  }

  return routes.map((r) => ({
    ...r,
    patrols30d: patrols.get(r.id) ?? 0,
    inspections30d: inspections.get(r.id) ?? 0,
  }));
}

export async function fetchRoute(routeId: string): Promise<PatrolRoute> {
  const { data, error } = await supabase.from('patrol_routes').select('*').eq('id', routeId).single();
  if (error) fail('Could not load route', error);
  return data as PatrolRoute;
}

/** All codes in the org, archived routes included, for the uniqueness check. */
export async function fetchRouteCodes(orgId: string): Promise<string[]> {
  const { data, error } = await supabase.from('patrol_routes').select('code').eq('organisation_id', orgId);
  if (error) fail('Could not check route codes', error);
  return (data ?? []).map((r: { code: string | null }) => r.code ?? '');
}

export async function createRoute(values: RouteFormValues): Promise<PatrolRoute> {
  const orgId = await getOrgId();
  if (isCodeTaken(values.code, await fetchRouteCodes(orgId))) throw new DuplicateCodeError(values.code);

  const { data, error } = await supabase
    .from('patrol_routes')
    .insert(toRouteInsert(values, orgId))
    .select()
    .single();
  if (error) {
    // A unique index on code (if present) catches a race with another admin.
    if (error.code === '23505') throw new DuplicateCodeError(values.code);
    fail('Could not create route', error);
  }
  return data as PatrolRoute;
}

async function setArchivedAt(routeId: string, archivedAt: string | null, what: string): Promise<void> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('patrol_routes')
    .update({ archived_at: archivedAt })
    .eq('id', routeId)
    .eq('organisation_id', orgId)
    .select('id');
  if (error) fail(`Could not ${what} route`, error);
  // RLS can silently filter an UPDATE to zero rows; don't report that as success.
  if (!data || data.length === 0) throw new Error(`Could not ${what} route: you don't have permission, or it no longer exists.`);
}

export const archiveRoute = (routeId: string) => setArchivedAt(routeId, new Date().toISOString(), 'archive');
export const restoreRoute = (routeId: string) => setArchivedAt(routeId, null, 'restore');

/** One page of a route's patrols, most recent first. `page` is 0-based. */
export async function fetchRouteHistory(routeId: string, page: number): Promise<RouteHistoryPage> {
  const from = page * HISTORY_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from('patrol_sessions')
    .select(
      `id, started_at, ended_at, patroller_name, patrol_businesses(${INSPECTIONS}(id, inspection_photos(count)))`,
      { count: 'exact' },
    )
    .eq('route_id', routeId)
    .order('started_at', { ascending: false })
    .range(from, from + HISTORY_PAGE_SIZE - 1);
  if (error) fail('Could not load patrol history', error);

  const rows = (data ?? []) as unknown as {
    id: string;
    started_at: string;
    ended_at: string | null;
    patroller_name: string | null;
    patrol_businesses: { sign_inspections: { id: string; inspection_photos: { count: number }[] }[] }[] | null;
  }[];

  return {
    total: count ?? rows.length,
    rows: rows.map((s) => {
      const inspections = (s.patrol_businesses ?? []).flatMap((b) => b.sign_inspections);
      return {
        id: s.id,
        startedAt: s.started_at,
        patrollerName: s.patroller_name || 'Unknown',
        duration: formatDurationHHMM(s.started_at, s.ended_at),
        inspections: inspections.length,
        photos: inspections.reduce((sum, i) => sum + (i.inspection_photos[0]?.count ?? 0), 0),
      };
    }),
  };
}
