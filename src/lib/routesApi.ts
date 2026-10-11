// Supabase calls for admin zone management (a zone is a patrol_routes row). Every function
// returns data or throws an Error with a readable message: supabase-js reports failures in
// `error` rather than throwing, so each call checks it explicitly.

import { supabase } from './supabase';
import type { PatrolRoute } from '../types';
import { formatDurationHHMM, isCodeTaken, normaliseCode } from './routeForm';
import type { ZoneRow } from './zoneForm';
import type { RouteDeleteCheck } from './routeDelete';
import type { ExportBusiness, ExportRoute, ExportSession } from './routeExport';
import { serverIssues, type ImportPlan, type ImportResponse, type ImportRow, type RowIssue } from './zoneImport';
import type { ZoneInfoData } from './zoneInfo';

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
    super(`Code "${normaliseCode(code)}" is already used in your organisation (retired zones included).`);
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
  if (error) fail('Could not load zones', error);
  return (data ?? []) as PatrolRoute[];
}

export const fetchArchivedRoutes = (orgId: string) => fetchRoutes(orgId, true);

/** Active zones with patrol and inspection counts for the last 30 days. */
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
    if (error) fail('Could not load zone activity', error);
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
  if (error) fail('Could not load zone', error);
  return data as PatrolRoute;
}

/** All codes in the org, retired zones included, for the uniqueness check. */
export async function fetchRouteCodes(orgId: string): Promise<string[]> {
  const { data, error } = await supabase.from('patrol_routes').select('code').eq('organisation_id', orgId);
  if (error) fail('Could not check zone codes', error);
  return (data ?? []).map((r: { code: string | null }) => r.code ?? '');
}

/** Creates a zone from the form's cleaned values (zoneForm.toZoneRow). */
export async function createZone(row: ZoneRow): Promise<PatrolRoute> {
  const orgId = await getOrgId();
  if (isCodeTaken(row.code, await fetchRouteCodes(orgId))) throw new DuplicateCodeError(row.code);

  const { data, error } = await supabase
    .from('patrol_routes')
    .insert({ ...row, organisation_id: orgId })
    .select()
    .single();
  if (error) {
    // The unique indexes (014) catch a race with another admin.
    if (error.code === '23505') throw new DuplicateCodeError(row.code);
    fail('Could not create zone', error);
  }
  return data as PatrolRoute;
}

/** Saves the form over an existing zone of the caller's organisation. */
export async function updateZone(routeId: string, row: ZoneRow): Promise<PatrolRoute> {
  const orgId = await getOrgId();
  const others = await supabase.from('patrol_routes').select('code').eq('organisation_id', orgId).neq('id', routeId);
  if (others.error) fail('Could not check zone codes', others.error);
  if (isCodeTaken(row.code, (others.data ?? []).map((r: { code: string | null }) => r.code))) throw new DuplicateCodeError(row.code);

  const { data, error } = await supabase
    .from('patrol_routes')
    .update(row)
    .eq('id', routeId)
    .eq('organisation_id', orgId)
    .select();
  if (error) {
    if (error.code === '23505') throw new DuplicateCodeError(row.code);
    fail('Could not save zone', error);
  }
  // RLS can silently filter an UPDATE to zero rows; don't report that as success.
  if (!data || data.length === 0) throw new Error("Could not save zone: you don't have permission, or it no longer exists.");
  return data[0] as PatrolRoute;
}

async function setArchivedAt(routeId: string, archivedAt: string | null, what: string): Promise<void> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('patrol_routes')
    .update({ archived_at: archivedAt })
    .eq('id', routeId)
    .eq('organisation_id', orgId)
    .select('id');
  if (error) fail(`Could not ${what} zone`, error);
  // RLS can silently filter an UPDATE to zero rows; don't report that as success.
  if (!data || data.length === 0) throw new Error(`Could not ${what} zone: you don't have permission, or it no longer exists.`);
}

/** Retire = archived_at set (hidden from patrollers, history kept). */
export const archiveRoute = (routeId: string) => setArchivedAt(routeId, new Date().toISOString(), 'retire');
export const restoreRoute = (routeId: string) => setArchivedAt(routeId, null, 'restore');

/** One page of a zone's patrols, most recent first. `page` is 0-based. */
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

// ── Delete (migration 010) ──────────────────────────────────────────────────

async function callDeleteRoute(routeId: string, dryRun: boolean): Promise<RouteDeleteCheck> {
  const { data, error } = await supabase.rpc('delete_route_if_unused', { p_route_id: routeId, p_dry_run: dryRun });
  if (error) throw new Error(error.message);
  return data as RouteDeleteCheck;
}

/** Can this zone be hard-deleted? Nothing is changed. */
export const checkRouteDelete = (routeId: string) => callDeleteRoute(routeId, true);

/** Deletes the zone if nothing uses it; otherwise returns status 'in_use' and changes nothing. */
export const deleteRouteIfUnused = (routeId: string) => callDeleteRoute(routeId, false);

// ── Export ──────────────────────────────────────────────────────────────────

const EXPORT_BUSINESS = `id, name, address, lat, lng, gps_captured_at, date_added, notes,
  ${INSPECTIONS}(id, condition, condition_rating, lead_id, inspection_photos(photo_type))`;

export interface RouteExportData {
  route: ExportRoute;
  sessions: ExportSession[];
  /** Businesses linked to the zone itself (PATROL v1), not to a session. */
  routeBusinesses: ExportBusiness[];
}

/** Everything the zone CSV needs (RLS keeps it to the caller's organisation). */
export async function fetchRouteExport(routeId: string): Promise<RouteExportData> {
  const { data: route, error: routeError } = await supabase
    .from('patrol_routes')
    .select('id, code, name, archived_at')
    .eq('id', routeId)
    .single();
  if (routeError) fail('Could not load the zone', routeError);

  const sessions: ExportSession[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('patrol_sessions')
      .select(`id, started_at, ended_at, is_complete, patroller_name, patrol_businesses(${EXPORT_BUSINESS})`)
      .eq('route_id', routeId)
      .order('started_at')
      .range(from, from + PAGE - 1);
    if (error) fail('Could not load the zone\'s patrols', error);
    const rows = (data ?? []) as unknown as ExportSession[];
    sessions.push(...rows);
    if (rows.length < PAGE) break;
  }

  const { data: businesses, error: bizError } = await supabase
    .from('patrol_businesses')
    .select(EXPORT_BUSINESS)
    .eq('route_id', routeId)
    .is('session_id', null);
  if (bizError) fail('Could not load the zone\'s businesses', bizError);

  return {
    route: route as ExportRoute,
    sessions,
    routeBusinesses: (businesses ?? []) as unknown as ExportBusiness[],
  };
}

// ── Zone info (Zone info sheet on Active patrol) ────────────────────────────

export async function fetchZoneInfo(routeId: string): Promise<ZoneInfoData> {
  const { data, error } = await supabase
    .from('patrol_routes')
    .select('code, name, area_type, focus, corners, anchors, est_minutes')
    .eq('id', routeId)
    .single();
  if (error) fail('Could not load zone info', error);
  return data as ZoneInfoData;
}

// ── CSV import (migration 015) ──────────────────────────────────────────────

/** import_zones refused the file. rowErrors holds its per-row list when it sent one. */
export class ZoneImportError extends Error {
  rowErrors: RowIssue[];
  constructor(message: string, rowErrors: RowIssue[]) {
    super(message);
    this.name = 'ZoneImportError';
    this.rowErrors = rowErrors;
  }
}

function importFailure(error: { message: string; details?: string | null }): ZoneImportError {
  let rows: RowIssue[] = [];
  try {
    const parsed: unknown = JSON.parse(error.details ?? '');
    if (Array.isArray(parsed)) rows = serverIssues(parsed);
  } catch {
    // details is not the row list (a different error); the message says enough.
  }
  return new ZoneImportError(error.message, rows);
}

/** Dry run: what the import would do. Nothing is written. */
export async function previewZoneImport(rows: ImportRow[]): Promise<ImportResponse> {
  const { data, error } = await supabase.rpc('import_zones', { p_rows: rows, p_dry_run: true });
  if (error) throw importFailure(error);
  return data as ImportResponse;
}

/** Applies exactly what was previewed (same rows, same fingerprint), or changes nothing and throws. */
export async function applyZoneImport(rows: ImportRow[], fingerprint: string): Promise<ImportPlan> {
  const { data, error } = await supabase.rpc('import_zones', { p_rows: rows, p_dry_run: false, p_fingerprint: fingerprint });
  if (error) throw importFailure(error);
  return data as ImportPlan;
}
