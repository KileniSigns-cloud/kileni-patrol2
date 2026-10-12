// A copy of the organisation's zones kept on the phone, so the Zones list, the zone preview and
// the Zone info sheet still open with no signal. Zones are org-shared data every patroller already
// reads. The copy is keyed by organisation id and re-checked on read, so another company's
// account on the same phone never sees it.
// No React and no network: tests/zoneCache.test.ts runs it with a fake storage.

import type { PatrolRoute } from '../types';
import type { ZoneInfoData } from './zoneInfo';

/** The slice of localStorage this file uses (lets tests pass a fake). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ZoneCache {
  /** ISO time the list was last loaded from the server. */
  savedAt: string;
  routes: PatrolRoute[];
}

export const zoneCacheKey = (orgId: string) => `patrol-zone-cache:v1:${orgId}`;

function looksLikeCache(v: unknown): v is { savedAt: string; routes: PatrolRoute[] } {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as { savedAt?: unknown; routes?: unknown };
  return typeof c.savedAt === 'string' && Array.isArray(c.routes);
}

const looksLikeRoute = (r: unknown): r is PatrolRoute => {
  if (typeof r !== 'object' || r === null) return false;
  const x = r as Record<string, unknown>;
  return typeof x.id === 'string' && typeof x.organisation_id === 'string' && typeof x.name === 'string';
};

/** Saves the list. Returns false (and warns) if the phone refused, so a save is never blocked by it. */
export function saveZoneCache(storage: KeyValueStorage, orgId: string, routes: PatrolRoute[], nowIso: string): boolean {
  if (!orgId) return false;
  try {
    storage.setItem(zoneCacheKey(orgId), JSON.stringify({ savedAt: nowIso, routes }));
    return true;
  } catch (err) {
    console.warn('Zones were not saved for offline use:', err);
    return false;
  }
}

/** The saved list for this organisation, or null. Only this organisation's open zones come back. */
export function loadZoneCache(storage: KeyValueStorage, orgId: string): ZoneCache | null {
  if (!orgId) return null;
  try {
    const raw = storage.getItem(zoneCacheKey(orgId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!looksLikeCache(parsed)) return null;
    const routes = parsed.routes.filter((r) => looksLikeRoute(r) && r.organisation_id === orgId && !r.archived_at);
    return { savedAt: parsed.savedAt, routes };
  } catch (err) {
    console.warn('Saved zones could not be read and were ignored:', err);
    return null;
  }
}

/** One saved zone by id, or null. */
export function findCachedZone(storage: KeyValueStorage, orgId: string, routeId: string): PatrolRoute | null {
  return loadZoneCache(storage, orgId)?.routes.find((r) => r.id === routeId) ?? null;
}

/** The fields the Zone info sheet shows, from a full zone row. */
export function zoneInfoOf(r: PatrolRoute): ZoneInfoData {
  return {
    code: r.code, name: r.name, area_type: r.area_type, focus: r.focus,
    corners: r.corners, anchors: r.anchors, est_minutes: r.est_minutes,
  };
}

/** "Mar 5, 2026, 2:15 PM" in the phone's language, or "earlier" if the saved time is unreadable. */
export function savedAtLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'earlier' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
