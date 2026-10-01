// Route CSV import: parse and check the file, build the RPC payload, model the preview and
// write the backup CSV. Pure (no Supabase or React), so tests/routeImport.test.ts runs it
// directly. import_routes (migration 013) re-checks every rule on the server; that check is
// the one that counts. The browser runs the same checks so the admin sees every problem at once.

import Papa from 'papaparse';
import { csvCell, localDateTime, type Cell } from './routeExport.ts';
import { STEP_NUMBER, stepLabels, hotspotList } from './routeInfo.ts';
import { CODE_MAX, CODE_PATTERN, normaliseCode } from './routeForm.ts';

export const IMPORT_COLUMNS = [
  'route_code', 'route_name', 'description', 'area_type', 'start_point', 'focus', 'hotspots', 'turn_by_turn',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const MAX_ROUTES = 500;
export const MAX_FILE_BYTES = 1_000_000;

/** Same caps as import_routes. */
export const CAPS = {
  route_code: CODE_MAX, route_name: 100, description: 1000, area_type: 200, start_point: 300, focus: 1000,
  hotspot: 150, hotspots: 30, step: 300, steps: 50,
} as const;

/** Letters, digits, single spaces and hyphens (after normalising); shared with the create form. */
export { CODE_PATTERN };

// Same set import_routes rejects, plus NUL (jsonb can't carry it): C0 controls except tab/LF/CR,
// DEL, zero-width and direction marks, line/paragraph separators, bidi embeddings, overrides and
// isolates, and BOM / zero-width no-break space.
const BAD_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x2029],
  [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff],
];
const hex4 = (n: number) => n.toString(16).padStart(4, '0');
export const BAD_CHARS = new RegExp(
  `[${BAD_RANGES.map(([a, b]) => (a === b ? `\\u${hex4(a)}` : `\\u${hex4(a)}-\\u${hex4(b)}`)).join('')}]`,
);
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const BOM = String.fromCharCode(0xfeff);

/** One CSV row as import_routes takes it. Blank = null ("keep what is stored"). */
export interface ImportRow {
  row: number;
  route_code: string;
  route_name: string | null;
  description: string | null;
  area_type: string | null;
  start_point: string | null;
  focus: string | null;
  hotspots: string[] | null;
  turn_by_turn: string[] | null;
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

/** "  grid   mis-01 " -> "GRID MIS-01" (the RPC matches and stores codes this way). */
export const normaliseRouteCode = normaliseCode;

/** "Route Code", "ROUTE_CODE" and "route code" all mean route_code. */
export const normaliseHeader = (h: string): string => h.trim().toLowerCase().replace(/[\s_]+/g, '_');

/**
 * One cell: a leading apostrophe that routeExport.csvCell added to guard a formula
 * ('=, '+, '-, '@) is removed, so a backup CSV re-imports exactly. Then trimmed.
 */
export function cleanCell(value: string | undefined): string {
  const v = value ?? '';
  return (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v).trim();
}

/**
 * "," unless the header row only has ";" (Excel in some locales). Decided from the header row:
 * papaparse's own guess can pick ";" when cells hold "a; b; c" hotspot lists.
 */
export function headerDelimiter(text: string): ',' | ';' {
  const header = text.split(/\r\n|\r|\n/, 1)[0] ?? '';
  return !header.includes(',') && header.includes(';') ? ';' : ',';
}

/** Line breaks become spaces (route_name, area_type, start_point are one line). */
const oneLine = (s: string) => s.replace(/\s*(\r\n|\r|\n)\s*/g, ' ');
const unixLines = (s: string) => s.replace(/\r\n|\r/g, '\n');

/**
 * Hotspots cell -> list. Split on ";" or line breaks when the cell has any, else on commas
 * (so a name with a comma needs ";" or one per line). Trailing "." dropped, blanks dropped,
 * duplicates (ignoring case) dropped.
 */
export function splitHotspots(cell: string): string[] {
  const sep = /[;\r\n]/.test(cell) ? /[;\r\n]+/ : /,/;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of cell.split(sep)) {
    const h = part.trim().replace(/\.$/, '').trim();
    const key = h.toLowerCase();
    if (!/[\p{L}\p{N}]/u.test(h) || seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/** Turn-by-turn cell -> one step per line, number prefixes ("1.", "2)") removed, blank lines dropped. */
export function splitSteps(cell: string): { steps: string[]; numbers: (number | null)[] } {
  const lines = cell.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l !== '');
  return {
    steps: lines.map((l) => l.replace(STEP_NUMBER, '').trim()).filter((l) => l !== ''),
    numbers: lines.map((l) => (STEP_NUMBER.test(l) ? Number.parseInt(l, 10) : null)),
  };
}

const ONE_LINE = new Set<ImportColumn>(['route_name', 'area_type', 'start_point']);
const TEXT_FIELDS = ['route_name', 'description', 'area_type', 'start_point', 'focus'] as const;

/**
 * Parses the file and runs every check that needs no database. Archived codes and missing names
 * for new routes need the stored routes, so they come from the RPC's dry run.
 */
export function parseRouteCsv(text: string, sizeBytes: number): ParsedImport {
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
  if (!fields.includes('route_code')) return fileError('The file has no route_code column.');
  result.ignoredColumns = fields.filter((f) => !(IMPORT_COLUMNS as readonly string[]).includes(f));

  const isBlank = (r: Record<string, string> | undefined) => !r || Object.values(r).every((v) => (v ?? '').trim() === '');
  const parseErrors = new Map<number, string>();
  for (const e of parsed.errors) {
    if (e.row === undefined || isBlank(parsed.data[e.row])) continue; // a blank line is not a row
    if (e.code === 'TooFewFields') continue; // missing trailing cells are blank cells
    if (!parseErrors.has(e.row)) parseErrors.set(e.row, e.message);
  }

  const data = parsed.data.map((r, i) => ({ row: i + 2, i, r })).filter(({ r }) => !isBlank(r));
  result.total = data.length;
  if (data.length === 0) return fileError('No routes in this file.');
  if (data.length > MAX_ROUTES) return fileError(`The file has ${data.length} routes. The limit is ${MAX_ROUTES}: split it.`);

  const codeRows = new Map<string, number[]>();
  const candidates: { row: ImportRow; ok: boolean }[] = [];

  for (const { row, i, r } of data) {
    const errs: string[] = [];
    const err = (m: string) => errs.push(m);
    const warn = (m: string) => result.warnings.push({ row, message: m });
    if (parseErrors.has(i)) err(`could not read this row (${parseErrors.get(i)})`);

    const cell = (c: ImportColumn) => {
      const v = cleanCell(r[c]);
      if (BAD_CHARS.test(v)) err(`${c} contains control or invisible characters`);
      if (/^[=+@]/.test(v)) warn(`${c} starts with "${v[0]}". It is saved and shown as text.`);
      return v;
    };

    const code = normaliseRouteCode(cell('route_code'));
    if (code === '') err('route_code is required');
    else if (code.length > CAPS.route_code) err(`route_code is over ${CAPS.route_code} characters`);
    else if (!CODE_PATTERN.test(code)) err('route_code can only use letters, digits, spaces and hyphens');
    if (code) codeRows.set(code, [...(codeRows.get(code) ?? []), row]);

    const text: Record<(typeof TEXT_FIELDS)[number], string | null> = {
      route_name: null, description: null, area_type: null, start_point: null, focus: null,
    };
    for (const f of TEXT_FIELDS) {
      const raw = cell(f);
      const v = ONE_LINE.has(f) ? oneLine(raw) : unixLines(raw);
      if (v.length > CAPS[f]) err(`${f} is over ${CAPS[f]} characters`);
      text[f] = v === '' ? null : v;
    }

    let hotspots: string[] | null = null;
    const hotCell = cell('hotspots');
    if (hotCell) {
      hotspots = splitHotspots(hotCell);
      if (hotspots.length > CAPS.hotspots) err(`more than ${CAPS.hotspots} hotspots`);
      if (hotspots.some((h) => h.length > CAPS.hotspot)) err(`each hotspot must be ${CAPS.hotspot} characters or fewer`);
      if (hotspots.length === 0) hotspots = null;
    }

    let steps: string[] | null = null;
    const stepCell = cell('turn_by_turn');
    if (stepCell) {
      const split = splitSteps(stepCell);
      steps = split.steps.length ? split.steps : null;
      if (split.steps.length > CAPS.steps) err(`more than ${CAPS.steps} turn-by-turn steps`);
      if (split.steps.some((s) => s.length > CAPS.step)) err(`each turn-by-turn step must be ${CAPS.step} characters or fewer`);
      const given = split.numbers.filter((n): n is number => n !== null);
      if (given.length > 0 && given.some((n, k) => n !== k + 1)) {
        warn(`turn_by_turn is numbered ${given.join(', ')}. Steps are saved in the order they appear.`);
      }
    }

    for (const m of errs) result.errors.push({ row, message: m });
    candidates.push({
      ok: errs.length === 0,
      row: { row, route_code: code, ...text, hotspots, turn_by_turn: steps },
    });
  }

  const dupRows = new Set<number>();
  for (const [code, rows] of codeRows) {
    if (rows.length < 2) continue;
    for (const row of rows) {
      dupRows.add(row);
      result.errors.push({ row, message: `route_code ${code} is on more than one row (rows ${rows.join(', ')})` });
    }
  }

  result.rows = candidates.filter((c) => c.ok && !dupRows.has(c.row.row)).map((c) => c.row);
  result.errors.sort(byRow);
  result.warnings.sort(byRow);
  return result;
}

const byRow = (a: RowIssue, b: RowIssue) => (a.row ?? 0) - (b.row ?? 0);

// ── Preview (the RPC's answer) ───────────────────────────────────────────────

export type ImportField = 'route_name' | 'description' | 'area_type' | 'start_point' | 'focus' | 'hotspots' | 'turn_by_turn';
export const IMPORT_FIELDS: readonly ImportField[] = [
  'route_name', 'description', 'area_type', 'start_point', 'focus', 'hotspots', 'turn_by_turn',
];

export const FIELD_LABELS: Record<ImportField, string> = {
  route_name: 'Name', description: 'Description', area_type: 'Area type', start_point: 'Start point',
  focus: 'Focus', hotspots: 'Hotspots', turn_by_turn: 'Turn-by-turn',
};

export interface FieldChange {
  old: unknown;
  new: unknown;
}

/** A patrol_routes row as the RPC returns it in `before`. */
export interface StoredRoute {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  area_type: string | null;
  start_point: string | null;
  focus: string | null;
  hotspots: unknown;
  steps: unknown;
  archived_at: string | null;
  created_at: string | null;
}

export interface PlanRoute {
  row: number;
  code: string;
  route_id: string | null;
  action: 'new' | 'update' | 'unchanged';
  changes: Partial<Record<ImportField, FieldChange>>;
  before: StoredRoute | null;
}

export interface ImportPlan {
  status: 'preview' | 'applied';
  fingerprint: string;
  created: number;
  updated: number;
  unchanged: number;
  routes: PlanRoute[];
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

/** A field value as lines of text for the preview (lists one item per line). */
export function fieldLines(field: ImportField, value: unknown): string[] {
  if (field === 'hotspots') return hotspotList(value);
  if (field === 'turn_by_turn') return stepLabels(value);
  return typeof value === 'string' && value !== '' ? [value] : [];
}

/** True when the stored value was blank: re-importing the backup can't clear what the import sets. */
export const wasBlank = (field: ImportField, change: FieldChange): boolean => fieldLines(field, change.old).length === 0;

// ── Backup CSV ───────────────────────────────────────────────────────────────

export const BACKUP_COLUMNS = [
  ...IMPORT_COLUMNS, 'action', 'route_id', 'archived_at', 'created_at', 'hotspots_json', 'steps_json',
] as const;

const stepsCell = (steps: unknown) => {
  const labels = stepLabels(steps);
  return labels.length ? labels.map((l, i) => `${i + 1}. ${l}`).join('\n') : null;
};
// Joined with "; " so names with commas survive a re-import; a single name gets a trailing ";".
const hotspotsCell = (hotspots: unknown) => {
  const list = hotspotList(hotspots);
  if (list.length === 0) return null;
  return list.length === 1 ? `${list[0]};` : list.join('; ');
};
const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

/**
 * The routes an import will change, as they are now (the RPC's `before` rows), plus one line per
 * route it will create. The first eight columns re-import as they are; route ids and the exact
 * stored lists (JSON) are kept for a manual restore.
 */
export function buildBackupCsv(plan: Pick<ImportPlan, 'routes'>): string {
  const rows: Record<(typeof BACKUP_COLUMNS)[number], Cell>[] = [];
  for (const r of plan.routes) {
    if (r.action === 'update' && r.before) {
      const b = r.before;
      rows.push({
        route_code: b.code, route_name: b.name, description: b.description, area_type: b.area_type,
        start_point: b.start_point, focus: b.focus, hotspots: hotspotsCell(b.hotspots), turn_by_turn: stepsCell(b.steps),
        action: 'update', route_id: b.id, archived_at: b.archived_at, created_at: b.created_at,
        hotspots_json: json(b.hotspots), steps_json: json(b.steps),
      });
    } else if (r.action === 'new') {
      rows.push({
        route_code: r.code, route_name: null, description: null, area_type: null, start_point: null, focus: null,
        hotspots: null, turn_by_turn: null, action: 'new', route_id: null, archived_at: null, created_at: null,
        hotspots_json: null, steps_json: null,
      });
    }
  }
  const lines = [BACKUP_COLUMNS.join(','), ...rows.map((row) => BACKUP_COLUMNS.map((c) => csvCell(row[c])).join(','))];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** routes-backup-2026-10-01-1432.csv (Toronto time). */
export function backupFileName(nowIso: string): string {
  return `routes-backup-${(localDateTime(nowIso) ?? '').replace(' ', '-').replace(':', '')}.csv`;
}

/** Offered as "Download template" on the import page. */
export const IMPORT_TEMPLATE = `${[
  IMPORT_COLUMNS.join(','),
  [
    'MIS-99', 'Example Corridor', 'What this loop covers.', '"Retail Strips, Plazas"',
    'Head West on Main St at King St.', 'Faded pylon panels and dark channel letters.',
    '"Main St Plaza, King St Strip"', '"1. START: Head West on Main St at King St.\n2. Turn RIGHT onto Queen St.\n3. END: North on Queen St to Park Ave."',
  ].join(','),
].join('\r\n')}\r\n`;
