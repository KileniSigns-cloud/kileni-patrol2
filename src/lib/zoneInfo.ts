// Pure helpers behind the zone screens (Zone info sheet, zone preview, admin list and form).
// A zone is a patrol_routes row with 4 to 8 corners in perimeter order (migration 014).
// Everything returns plain strings; components render them as React text only, never HTML.
// No Supabase or React here, and no network: the Maps links are built from data already loaded,
// never fetched, stored or logged. tests/zoneInfo.test.ts runs them directly.

/** The one setting for the zone map: true = the loop ends back at corner 1. */
export const ZONE_MAP_CLOSE_LOOP = true;

export const MIN_CORNERS = 4;
export const MAX_CORNERS = 8;
/**
 * Google Maps URLs allow "up to three waypoints ... on mobile browsers, and a maximum of nine
 * waypoints ... otherwise". A closed 4-corner loop has exactly 3, so 4 corners is the size that
 * works everywhere; the admin form warns above it.
 */
export const SUPPORTED_CORNERS = 4;
/** "URLs are limited to 2,048 characters for each request." (Google Maps URLs) */
export const MAPS_URL_MAX = 2048;

const MAPS_DIR = 'https://www.google.com/maps/dir/?api=1';
const MAPS_SEARCH = 'https://www.google.com/maps/search/?api=1';

/** One corner as stored: an intersection, with GPS when known (both or neither). */
export interface Corner {
  label: string;
  lat?: number;
  lng?: number;
}

export interface Anchor {
  name: string;
  address?: string;
}

/** What ZoneInfo shows; a PatrolRoute row fits it. */
export interface ZoneInfoData {
  code: string | null;
  name: string;
  area_type: string | null;
  focus: string | null;
  corners: unknown;
  anchors: unknown;
  est_minutes: number | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Corners from patrol_routes.corners. Anything that isn't a corner is skipped; a non-list is none. */
export function cornerList(corners: unknown): Corner[] {
  if (!Array.isArray(corners)) return [];
  return corners.flatMap((c): Corner[] => {
    if (!c || typeof c !== 'object') return [];
    const { label, lat, lng } = c as Record<string, unknown>;
    if (!isText(label)) return [];
    return isNum(lat) && isNum(lng) ? [{ label: label.trim(), lat, lng }] : [{ label: label.trim() }];
  });
}

/** Anchors from patrol_routes.anchors, same rules. */
export function anchorList(anchors: unknown): Anchor[] {
  if (!Array.isArray(anchors)) return [];
  return anchors.flatMap((a): Anchor[] => {
    if (!a || typeof a !== 'object') return [];
    const { name, address } = a as Record<string, unknown>;
    if (!isText(name)) return [];
    return isText(address) ? [{ name: name.trim(), address: address.trim() }] : [{ name: name.trim() }];
  });
}

export const hasGps = (c: Corner): c is Corner & { lat: number; lng: number } => isNum(c.lat) && isNum(c.lng);

/** 43.7945123,-79.4701 (at most 6 decimals, no trailing zeros). */
export const gpsText = (c: Corner): string | null =>
  hasGps(c) ? `${Number(c.lat.toFixed(6))},${Number(c.lng.toFixed(6))}` : null;

/** What Maps is asked for: the coordinates when known, else the intersection text. */
export const cornerPlace = (c: Corner): string => gpsText(c) ?? c.label.trim();

/**
 * One Google Maps directions link around the zone: origin = corner 1, waypoints = the middle
 * corners, destination = corner 1 (closed loop) or the last corner. Fixed https origin; each
 * place is URL-encoded and waypoints are joined with an encoded "|" (%7C), as Google asks.
 * travelmode=driving and no dir_action, so Maps opens the overview, not navigation.
 * null below 2 corners.
 */
export function zoneMapUrl(corners: readonly Corner[], closeLoop: boolean = ZONE_MAP_CLOSE_LOOP): string | null {
  const places = corners.map(cornerPlace).filter((p) => p !== '');
  if (places.length < 2) return null;
  const destination = closeLoop ? places[0] : places[places.length - 1];
  const waypoints = closeLoop ? places.slice(1) : places.slice(1, -1);
  const parts = [
    `origin=${encodeURIComponent(places[0])}`,
    `destination=${encodeURIComponent(destination)}`,
    ...(waypoints.length ? [`waypoints=${waypoints.map(encodeURIComponent).join('%7C')}`] : []),
    'travelmode=driving',
  ];
  return `${MAPS_DIR}&${parts.join('&')}`;
}

/** Waypoints the zone map link will carry (corners between origin and destination). */
export const waypointCount = (n: number, closeLoop: boolean = ZONE_MAP_CLOSE_LOOP) =>
  Math.max(0, closeLoop ? n - 1 : n - 2);

/** Google Maps search for one corner: coordinates when known, else the intersection text. */
export function cornerMapsUrl(c: Corner): string | null {
  const q = cornerPlace(c);
  return q ? `${MAPS_SEARCH}&query=${encodeURIComponent(q)}` : null;
}

/** Same search for an anchor: its address when given, else its name. */
export function anchorMapsUrl(a: Anchor): string | null {
  const q = (a.address ?? a.name).trim();
  return q ? `${MAPS_SEARCH}&query=${encodeURIComponent(q)}` : null;
}

/** "Loop: 1 → 2 → 3 → 4 → 1" (or "Route: 1 → 2 → 3 → 4" when the loop is open). */
export function loopLabel(n: number, closeLoop: boolean = ZONE_MAP_CLOSE_LOOP): string {
  if (n < 2) return '';
  const stops = Array.from({ length: n }, (_, i) => String(i + 1));
  return closeLoop ? `Loop: ${[...stops, '1'].join(' → ')}` : `Route: ${stops.join(' → ')}`;
}

/** "4 corners", "1 corner" or "No corners" (admin list). */
export function cornersBadge(corners: unknown): string {
  const n = cornerList(corners).length;
  if (n === 0) return 'No corners';
  return `${n} ${n === 1 ? 'corner' : 'corners'}`;
}

/** "About 90 min" for patrollers; null when not set. */
export const estLabel = (minutes: number | null | undefined): string | null =>
  isNum(minutes) && minutes > 0 ? `About ${Math.round(minutes)} min` : null;

/** What the admin should know before relying on the zone map link. */
export function zoneMapWarnings(corners: readonly Corner[], closeLoop: boolean = ZONE_MAP_CLOSE_LOOP): string[] {
  const out: string[] = [];
  const url = zoneMapUrl(corners, closeLoop);
  if (url && url.length > MAPS_URL_MAX) {
    out.push(`The map link is ${url.length} characters; Google Maps allows ${MAPS_URL_MAX}. Shorten the corner names or add GPS.`);
  }
  if (corners.length > SUPPORTED_CORNERS) {
    out.push(`More than ${SUPPORTED_CORNERS} corners: phone browsers show only 3 stops between start and end, so some corners may be left out. ${SUPPORTED_CORNERS} corners works everywhere.`);
  }
  const noGps = corners.map((c, i) => (hasGps(c) ? null : i + 1)).filter((n): n is number => n !== null);
  if (noGps.length > 0) {
    out.push(`${noGps.length === 1 ? 'Corner' : 'Corners'} ${noGps.join(', ')} ${noGps.length === 1 ? 'has' : 'have'} no GPS: Maps will search the text, which can land on the wrong place.`);
  }
  return out;
}
