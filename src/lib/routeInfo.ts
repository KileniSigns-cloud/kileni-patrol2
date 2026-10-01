// Pure helpers behind RouteInfo (route preview, Route info sheet, admin badge).
// Everything returns plain strings; components render them as React text only, never HTML.
// No Supabase or React here, so tests/routeInfo.test.ts can run them directly.

/** What RouteInfo shows; a PatrolRoute row fits it. */
export interface RouteInfoData {
  code: string | null;
  name: string;
  description?: string | null;
  area_type: string | null;
  start_point: string | null;
  focus: string | null;
  hotspots: unknown;
  steps?: unknown;
}

/** A leading step number as typed in a spreadsheet or stored by PATROL v1: "1.", "1)", "1.<tab>". */
export const STEP_NUMBER = /^\s*\d+\s*[.)]\s*/;

/**
 * Step labels from patrol_routes.steps: [{id, label}] (PATROL v1 and the CSV import) or plain
 * strings. Anything else counts as no steps. Leading numbers are stripped; <ol> numbers them.
 */
export function stepLabels(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => {
      if (typeof s === 'string') return s;
      const label = s && typeof s === 'object' ? (s as { label?: unknown }).label : undefined;
      return typeof label === 'string' ? label : '';
    })
    .map((l) => l.replace(STEP_NUMBER, '').trim())
    .filter((l) => l !== '');
}

const COMPASS = /^(north|south|east|west|[nsew]|ne|nw|se|sw)(bound)?$/i;

/**
 * "Turn LEFT (South) onto Haig Blvd (Drive park access perimeter)." becomes the step text plus a
 * note shown as a lighter second line. Brackets mid-sentence, or holding only a compass
 * direction ("(South)"), stay part of the text.
 */
export function splitStepNote(label: string): { text: string; note: string | null } {
  const m = /^(.*\S)\s*\(([^()]+)\)\s*\.?$/.exec(label);
  if (!m || COMPASS.test(m[2].trim())) return { text: label, note: null };
  return { text: m[1].trim(), note: m[2].trim() };
}

/** "4 steps", "1 step" or "No directions" (admin route list). */
export function stepsBadge(steps: unknown): string {
  const n = stepLabels(steps).length;
  if (n === 0) return 'No directions';
  return `${n} ${n === 1 ? 'step' : 'steps'}`;
}

/** Hotspot names as stored (jsonb array of strings); anything else counts as none. */
export function hotspotList(hotspots: unknown): string[] {
  if (!Array.isArray(hotspots)) return [];
  return hotspots.filter((h): h is string => typeof h === 'string' && h.trim() !== '').map((h) => h.trim());
}

const LEADING_DIRECTION = /^(head|start|go|drive|travel)\s+(north|south|east|west)(bound)?\s+(on|along)\s+/i;

/**
 * Search text for Maps. "Head West on Lakeshore Rd E at Dixie Rd (City of Toronto / Peel Boundary)."
 * becomes "Lakeshore Rd E & Dixie Rd". When there is no "X at Y" the start point is used as typed.
 * No region is added.
 */
export function mapsQuery(startPoint: string): string {
  const raw = startPoint.trim();
  const cleaned = raw
    .replace(/\s*\([^()]*\)\s*\.?$/, '')
    .replace(/\.$/, '')
    .replace(LEADING_DIRECTION, '')
    .trim();
  const at = /^(.+?)\s+at\s+(.+)$/i.exec(cleaned);
  return at ? `${at[1].trim()} & ${at[2].trim()}` : raw;
}

/** Google Maps search URL: fixed https origin, the query is the only variable part (URL-encoded). */
export function mapsUrl(startPoint: string | null | undefined): string | null {
  const q = startPoint ? mapsQuery(startPoint) : '';
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
