// Zone CSV import: parse and check the file, build the RPC payload, model the preview and write
// the backup CSV. Pure (no Supabase or React), so tests/zoneImport.test.ts runs it directly.
// import_zones (migration 015) re-checks every rule on the server; that check is the one that
// counts. The browser runs the same checks so the admin sees every problem at once, and sends
// values already trimmed and normalised.

import Papa from 'papaparse';
import { csvCell, localDateTime, type Cell } from './routeExport.ts';
import { MAX_CORNERS, anchorList, cornerList, gpsText, type Anchor, type Corner } from './zoneInfo.ts';
import {
  BAD_CHARS, CAPS, CODE_MAX, CODE_PATTERN, checkAnchor, checkCorner, checkCornerSlots, multiLine, nameHasCode,
  nameLooksCoded, normaliseCode, oneLine, parseEstMinutes,
} from './zoneForm.ts';

const CORNER_COLUMNS = Array.from({ length: MAX_CORNERS }, (_, i) => [`corner${i + 1}`, `corner${i + 1}_gps`] as const).flat();

export const IMPORT_COLUMNS = [
  'zone_code', 'zone_name', 'area_type', ...CORNER_COLUMNS, 'anchors', 'focus', 'est_minutes', 'status',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const MAX_ZONES = 500;
export const MAX_FILE_BYTES = 1_000_000;

const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const BOM = String.fromCharCode(0xfeff);

export type ZoneStatus = 'active' | 'retired';

/** One CSV row as import_zones takes it. null = blank cell = "keep what is stored". */
export interface ImportRow {
  row: number;
  zone_code: string;
  zone_name: string | null;
  area_type: string | null;
  /** The whole list (replaces the stored one), or null when every corner cell is blank. */
  corners: Corner[] | null;
  anchors: Anchor[] | null;
  focus: string | null;
  est_minutes: number | null;
  status: ZoneStatus | null;
}

/** A problem or note. row null = the whole file. */
export interface RowIssue {
  row: number | null;
  message: string;
}

export interface ParsedImport {
  /** Rows with no errors, ready for the RPC. */
  rows: ImportRow[];
  /** Number of non-blank data rows in the file. */
  total: number;
  errors: RowIssue[];
  warnings: RowIssue[];
  ignoredColumns: string[];
}

/** "  con   ab-01 " -> "CON AB-01" (the RPC matches and stores codes this way). */
export const normaliseZoneCode = normaliseCode;

/** "Zone Code", "ZONE_CODE" and "zone code" all mean zone_code. */
export const normaliseHeader = (h: string): string => h.trim().toLowerCase().replace(/[\s_]+/g, '_');

/**
 * One cell: a leading apostrophe that routeExport.csvCell added to guard a formula
 * ('=, '+, '-, '@) is removed, so a backup CSV re-imports exactly. Then trimmed.
 */
export function cleanCell(value: string | undefined): string {
  const v = value ?? '';
  return (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v).trim();
}

/** "," unless the header row only has ";" (Excel in some locales). */
export function headerDelimiter(text: string): ',' | ';' {
  const header = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  return !header.includes(',') && header.includes(';') ? ';' : ',';
}

/** Anchors cell -> list of [name, address]. One per line or ";"-separated; "Name | Address". */
export function splitAnchors(cell: string): [string, string][] {
  return cell.split(/[;\r\n]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const bar = part.indexOf('|');
      return bar === -1 ? [part, ''] : [part.slice(0, bar), part.slice(bar + 1)];
    });
}

const EXTRA_CORNER = /^corner(\d+)(_gps)?$/;

/**
 * Parses the file and runs every check that needs no database. Whether a zone is new (and so
 * needs a name, area type and corners) comes from the RPC's dry run.
 */
export function parseZoneCsv(text: string, sizeBytes: number): ParsedImport {
  const result: ParsedImport = { rows: [], total: 0, errors: [], warnings: [], ignoredColumns: [] };
  const fileError = (message: string) => { result.errors.push({ row: null, message }); return result; };

  if (sizeBytes > MAX_FILE_BYTES) return fileError('The file is over 1 MB. Split it into smaller files.');
  if (text.includes(REPLACEMENT_CHAR)) {
    return fileError('The file is not UTF-8. In Excel use Save As > "CSV UTF-8 (Comma delimited)" and upload again.');
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: false,
    delimiter: headerDelimiter(text),
    transformHeader: normaliseHeader,
  });
  const fields = (parsed.meta.fields ?? []).filter((f) => f !== '');
  if (!fields.includes('zone_code')) return fileError('The file has no zone_code column.');
  result.ignoredColumns = fields.filter((f) => !(IMPORT_COLUMNS as readonly string[]).includes(f));
  // corner9, corner10_gps...: more corners than a zone can have. Reported per row if filled.
  const extraCorners = result.ignoredColumns.filter((f) => {
    const m = EXTRA_CORNER.exec(f);
    return m !== null && Number(m[1]) > MAX_CORNERS;
  });

  const isBlank = (r: Record<string, string> | undefined) => !r || Object.values(r).every((v) => (v ?? '').trim() === '');
  const parseErrors = new Map<number, string>();
  for (const e of parsed.errors) {
    if (e.row === undefined || isBlank(parsed.data[e.row])) continue; // a blank line is not a row
    if (e.code === 'TooFewFields') continue; // missing trailing cells are blank cells
    if (!parseErrors.has(e.row)) parseErrors.set(e.row, e.message);
  }

  const data = parsed.data.map((r, i) => ({ row: i + 2, i, r })).filter(({ r }) => !isBlank(r));
  result.total = data.length;
  if (data.length === 0) return fileError('No zones in this file.');
  if (data.length > MAX_ZONES) return fileError(`The file has ${data.length} zones. The limit is ${MAX_ZONES}: split it.`);

  const codeRows = new Map<string, number[]>();
  const candidates: { row: ImportRow; ok: boolean }[] = [];

  for (const { row, i, r } of data) {
    const errs: string[] = [];
    const err = (m: string) => errs.push(m);
    const warn = (m: string) => result.warnings.push({ row, message: m });
    if (parseErrors.has(i)) err(`could not read this row (${parseErrors.get(i)})`);

    const cell = (c: string) => {
      const v = cleanCell(r[c]);
      if (BAD_CHARS.test(v)) err(`${c} contains control or invisible characters`);
      if (/^[=+@]/.test(v)) warn(`${c} starts with "${v[0]}". It is saved and shown as text.`);
      return v;
    };

    const code = normaliseZoneCode(cell('zone_code'));
    if (code === '') err('zone_code is required');
    else if (code.length > CODE_MAX) err(`zone_code is over ${CODE_MAX} characters`);
    else if (!CODE_PATTERN.test(code)) err('zone_code can only use letters, digits, spaces and hyphens');
    if (code) codeRows.set(code, [...(codeRows.get(code) ?? []), row]);

    const name = oneLine(cell('zone_name'));
    if (name.length > CAPS.name) err(`zone_name is over ${CAPS.name} characters`);
    if (name && code && CODE_PATTERN.test(code) && nameHasCode(name, code)) {
      err(`zone_name contains the code ${code}: leave the code out of the name`);
    } else if (name && nameLooksCoded(name)) {
      warn(`zone_name "${name}" starts with something like a code. Codes go in zone_code only.`);
    }

    const area = oneLine(cell('area_type'));
    if (area.length > CAPS.area_type) err(`area_type is over ${CAPS.area_type} characters`);

    const focus = multiLine(cell('focus'));
    if (focus.length > CAPS.focus) err(`focus is over ${CAPS.focus} characters`);

    // Corners: any filled corner cell means the row gives the whole list.
    const slots: (Corner | null | 'bad')[] = [];
    for (let n = 1; n <= MAX_CORNERS; n++) {
      const res = checkCorner(n, cell(`corner${n}`), cell(`corner${n}_gps`));
      res.errors.forEach(err);
      res.warnings.forEach(warn);
      slots.push(res.errors.length ? 'bad' : res.corner);
    }
    for (const c of extraCorners) {
      if (cleanCell(r[c]) !== '') err(`${c} is filled: a zone has at most ${MAX_CORNERS} corners`);
    }
    const anyCorner = slots.some((s) => s !== null);
    checkCornerSlots(slots, false).forEach(err);
    const corners = anyCorner && slots.every((s) => s !== 'bad') ? slots.filter((s): s is Corner => typeof s === 'object' && s !== null) : null;

    let anchors: Anchor[] | null = null;
    const anchorCell = cell('anchors');
    if (anchorCell) {
      const pairs = splitAnchors(anchorCell);
      if (pairs.length > CAPS.anchors) err(`more than ${CAPS.anchors} anchors`);
      const list: Anchor[] = [];
      pairs.forEach(([n, a], k) => {
        const res = checkAnchor(n, a, `anchor ${k + 1}`);
        res.errors.forEach(err);
        if (res.anchor) list.push(res.anchor);
      });
      anchors = list.length ? list : null;
    }

    const est = parseEstMinutes(cell('est_minutes'));
    if (est !== null && typeof est === 'object') err(est.error);

    const statusText = cell('status').toLowerCase();
    let status: ZoneStatus | null = null;
    if (statusText === 'active' || statusText === 'retired') status = statusText;
    else if (statusText !== '') err('status must be active or retired (or blank to keep it)');

    for (const m of errs) result.errors.push({ row, message: m });
    candidates.push({
      ok: errs.length === 0,
      row: {
        row, zone_code: code, zone_name: name || null, area_type: area || null, corners, anchors,
        focus: focus || null, est_minutes: typeof est === 'number' ? est : null, status,
      },
    });
  }

  const dupRows = new Set<number>();
  for (const [code, rows] of codeRows) {
    if (rows.length < 2) continue;
    for (const row of rows) {
      dupRows.add(row);
      result.errors.push({ row, message: `zone_code ${code} is on more than one row (rows ${rows.join(', ')})` });
    }
  }

  result.rows = candidates.filter((c) => c.ok && !dupRows.has(c.row.row)).map((c) => c.row);
  result.errors.sort(byRow);
  result.warnings.sort(byRow);
  return result;
}

const byRow = (a: RowIssue, b: RowIssue) => (a.row ?? 0) - (b.row ?? 0);

// ── Preview (the RPC's answer) ───────────────────────────────────────────────

export type ImportField = 'zone_name' | 'area_type' | 'corners' | 'anchors' | 'focus' | 'est_minutes' | 'status';
export const IMPORT_FIELDS: readonly ImportField[] = ['zone_name', 'area_type', 'corners', 'anchors', 'focus', 'est_minutes', 'status'];
export const LIST_FIELDS: ReadonlySet<ImportField> = new Set(['corners', 'anchors']);

export const FIELD_LABELS: Record<ImportField, string> = {
  zone_name: 'Name', area_type: 'Area type', corners: 'Corners', anchors: 'Anchors', focus: 'Focus',
  est_minutes: 'Estimated time', status: 'Status',
};

export interface FieldChange {
  old: unknown;
  new: unknown;
}

/** A patrol_routes row as the RPC returns it in `before`. */
export interface StoredZone {
  id: string;
  code: string | null;
  name: string;
  area_type: string | null;
  focus: string | null;
  corners: unknown;
  anchors: unknown;
  est_minutes: number | null;
  archived_at: string | null;
  created_at: string | null;
}

export interface PlanZone {
  row: number;
  code: string;
  route_id: string | null;
  action: 'new' | 'update' | 'unchanged';
  changes: Partial<Record<ImportField, FieldChange>>;
  before: StoredZone | null;
}

export interface ImportPlan {
  status: 'preview' | 'applied';
  fingerprint: string;
  created: number;
  updated: number;
  unchanged: number;
  zones: PlanZone[];
}

export type ImportResponse = ImportPlan | { status: 'invalid'; errors: { row: number | null; error: string }[] };

/** Server problems in the browser's shape. */
export const serverIssues = (errors: { row: number | null; error: string }[]): RowIssue[] =>
  errors.map((e) => ({ row: e.row, message: e.error }));

/** Browser and server problems together, one per row and message, by row. */
export function mergeIssues(a: readonly RowIssue[], b: readonly RowIssue[]): RowIssue[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((i) => {
    const k = `${i.row}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort(byRow);
}

/** "Dufferin & Steeles (GPS 43.79,-79.47)" or "... (no GPS)". */
export const cornerLine = (c: Corner): string => `${c.label} (${gpsText(c) ? `GPS ${gpsText(c)}` : 'no GPS'})`;
const anchorLine = (a: Anchor): string => (a.address ? `${a.name}, ${a.address}` : a.name);

/** A field value as lines of text for the preview (lists one item per line). */
export function fieldLines(field: ImportField, value: unknown): string[] {
  if (field === 'corners') return cornerList(value).map(cornerLine);
  if (field === 'anchors') return anchorList(value).map(anchorLine);
  if (field === 'est_minutes') return typeof value === 'number' ? [`${value} min`] : [];
  return typeof value === 'string' && value !== '' ? [value] : [];
}

/** True when the stored value was blank: re-importing the backup can't clear what the import sets. */
export const wasBlank = (field: ImportField, change: FieldChange): boolean => fieldLines(field, change.old).length === 0;

// ── Backup CSV ───────────────────────────────────────────────────────────────

export const BACKUP_COLUMNS = [
  ...IMPORT_COLUMNS, 'action', 'zone_id', 'archived_at', 'created_at', 'corners_json', 'anchors_json',
] as const;
type BackupColumn = (typeof BACKUP_COLUMNS)[number];

// "Name | Address; Name | Address": re-imports as the same list.
const anchorsCell = (anchors: unknown) => {
  const list = anchorList(anchors);
  return list.length ? list.map((a) => (a.address ? `${a.name} | ${a.address}` : a.name)).join('; ') : null;
};
const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const blankRow = (): Record<BackupColumn, Cell> =>
  Object.fromEntries(BACKUP_COLUMNS.map((c) => [c, null])) as Record<BackupColumn, Cell>;

/**
 * The zones an import will change, as they are now (the RPC's `before` rows), plus one line per
 * zone it will create. The import columns re-import as they are (status included); zone ids and
 * the exact stored lists (JSON) are kept for a manual restore.
 */
export function buildBackupCsv(plan: Pick<ImportPlan, 'zones'>): string {
  const rows: Record<BackupColumn, Cell>[] = [];
  for (const z of plan.zones) {
    const row = blankRow();
    if (z.action === 'update' && z.before) {
      const b = z.before;
      Object.assign(row, {
        zone_code: b.code, zone_name: b.name, area_type: b.area_type, anchors: anchorsCell(b.anchors), focus: b.focus,
        est_minutes: b.est_minutes, status: b.archived_at ? 'retired' : 'active',
        action: 'update', zone_id: b.id, archived_at: b.archived_at, created_at: b.created_at,
        corners_json: json(b.corners), anchors_json: json(b.anchors),
      });
      cornerList(b.corners).forEach((c, i) => {
        row[`corner${i + 1}` as BackupColumn] = c.label;
        row[`corner${i + 1}_gps` as BackupColumn] = gpsText(c);
      });
    } else if (z.action === 'new') {
      Object.assign(row, { zone_code: z.code, action: 'new' });
    } else {
      continue;
    }
    rows.push(row);
  }
  const lines = [BACKUP_COLUMNS.join(','), ...rows.map((row) => BACKUP_COLUMNS.map((c) => csvCell(row[c])).join(','))];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** zones-backup-2026-10-03-1432.csv (Toronto time). */
export function backupFileName(nowIso: string): string {
  return `zones-backup-${(localDateTime(nowIso) ?? '').replace(' ', '-').replace(':', '')}.csv`;
}

/** Offered as "Download template" on the import page. Example text only; GPS left blank. */
export const IMPORT_TEMPLATE = `${BOM}${[
  IMPORT_COLUMNS.join(','),
  IMPORT_COLUMNS.map((c) => ({
    zone_code: 'EX-01', zone_name: 'Example zone', area_type: 'Industrial',
    corner1: 'Main St & King St', corner2: 'Main St & Queen St', corner3: 'Park Ave & Queen St', corner4: 'Park Ave & King St',
    anchors: '"Example Plaza | 100 Main St; Example Depot"', focus: 'Faded pylon panels and dark channel letters.',
    est_minutes: '60', status: 'active',
  } as Record<string, string>)[c] ?? '').join(','),
].join('\r\n')}\r\n`;
