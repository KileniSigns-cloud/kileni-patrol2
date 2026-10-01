import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Copy, Download, FileUp } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { RouteImportError } from '../lib/routesApi';
import { errorMessage } from '../lib/errors';
import { downloadText } from '../lib/download';
import { plural } from '../lib/patrolHistory';
import {
  backupFileName, buildBackupCsv, FIELD_LABELS, fieldLines, IMPORT_COLUMNS, IMPORT_FIELDS, IMPORT_TEMPLATE, mergeIssues,
  parseRouteCsv, serverIssues, wasBlank,
  type ImportField, type ImportPlan, type ParsedImport, type PlanRoute, type RowIssue,
} from '../lib/routeImport';
import Screen from '../components/layout/Screen';
import AdminHeader from '../components/admin/AdminHeader';
import FlowFooter from '../components/flow/FlowFooter';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/Toast';

const SHOWN_ISSUES = 50;
const LIST_FIELDS = new Set<ImportField>(['hotspots', 'turn_by_turn']);

/** "4 routes", "1 route". */
const count = (n: number, one: string) => `${n} ${plural(one, n)}`;

const issueText = (i: RowIssue) => (i.row === null ? i.message : `Row ${i.row} · ${i.message}`);

/**
 * Admin CSV import: choose a file, preview what changes (dry run, nothing written), download a
 * backup of the routes that will change, then confirm. Upsert by route code; nothing is deleted.
 */
const AdminRouteImportPage: React.FC = () => {
  const navigate = useNavigate();
  const { previewRouteImport, applyRouteImport } = usePatrolStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const reset = () => {
    setParsed(null); setPlan(null); setIssues([]); setCheckError(null);
    setBackedUp(false); setApplyError(null); setConfirmOpen(false);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    setChecking(true);
    try {
      const p = parseRouteCsv(await file.text(), file.size);
      setParsed(p);
      let found = p.errors;
      // The server checks what the browser can't (archived codes, names for new routes) and says
      // NEW / UPDATE per route. Rows with browser errors are left out of that check.
      if (p.rows.length > 0 && !p.errors.some((e) => e.row === null)) {
        const res = await previewRouteImport(p.rows);
        if (res.status === 'invalid') found = mergeIssues(found, serverIssues(res.errors));
        else setPlan(res);
      }
      setIssues(found);
    } catch (e) {
      setCheckError(errorMessage(e, 'Could not check the file.'));
    } finally {
      setChecking(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const downloadBackup = () => {
    if (!plan) return;
    downloadText(backupFileName(new Date().toISOString()), buildBackupCsv(plan), 'text/csv;charset=utf-8');
    setBackedUp(true);
  };

  const apply = async () => {
    if (!plan || !parsed) return;
    setApplying(true);
    setApplyError(null);
    try {
      const done = await applyRouteImport(parsed.rows, plan.fingerprint);
      toast.success(`Imported: ${done.created} new, ${done.updated} updated`);
      navigate('/admin/routes');
    } catch (e) {
      if (e instanceof RouteImportError && e.rowErrors.length > 0) setIssues(mergeIssues([], e.rowErrors));
      setApplyError(`Nothing was changed. ${errorMessage(e, 'Import failed.')}`);
      setConfirmOpen(false);
    } finally {
      setApplying(false);
    }
  };

  const copyIssues = async () => {
    try {
      await navigator.clipboard.writeText(issues.map(issueText).join('\n'));
      toast.success('Problems copied');
    } catch {
      toast.error('Could not copy. Select the list and copy it instead.');
    }
  };

  const changes = plan ? plan.created + plan.updated : 0;
  const blankFields = plan
    ? plan.routes.reduce((n, r) => n + (r.action === 'update'
      ? Object.entries(r.changes).filter(([f, c]) => c && wasBlank(f as ImportField, c)).length : 0), 0)
    : 0;
  const needsBackup = (plan?.updated ?? 0) > 0;
  const canConfirm = plan !== null && issues.length === 0 && changes > 0 && (!needsBackup || backedUp) && !applying;
  const hint = !plan ? null
    : issues.length > 0 ? 'Fix the problems above and upload the file again.'
    : changes === 0 ? 'Nothing to import: every route already matches the file.'
    : needsBackup && !backedUp ? 'Download the backup first.'
    : null;

  return (
    <Screen
      nav={!plan}
      footer={plan ? (
        <FlowFooter hint={hint}>
          <button className="btn btn-pri btn-xl btn-full" disabled={!canConfirm} onClick={() => setConfirmOpen(true)}>
            <Check aria-hidden />Import {count(changes, 'route')}
          </button>
        </FlowFooter>
      ) : undefined}
    >
      <AdminHeader
        back={{ to: '/admin/routes', label: 'Manage routes' }}
        title="Import routes"
        sub="Create or update routes from a CSV file. Matched by route code; nothing is deleted."
      />

      <div className="card">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          id="route-csv"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <label htmlFor="route-csv" className={`btn btn-pri btn-full ${checking ? 'pointer-events-none opacity-60' : ''}`}>
          {checking ? <><span className="spin" aria-hidden />Checking…</> : <><FileUp aria-hidden />{fileName ? 'Choose another file' : 'Choose CSV file'}</>}
        </label>
        {fileName && <p className="field-hint break-all">{fileName}</p>}
        <button className="btn btn-sm btn-full mt-2.5" onClick={() => downloadText('route-import-template.csv', IMPORT_TEMPLATE, 'text/csv;charset=utf-8')}>
          <Download aria-hidden />Download template
        </button>
        <p className="field-hint">
          Columns: {IMPORT_COLUMNS.join(', ')}. Only route_code is required (route_name too for a new route).
          Blank cells keep the current value. Turn-by-turn: one step per line in the cell.
        </p>
      </div>

      {checkError && <p className="field-err" role="alert">{checkError}</p>}

      {parsed && !checking && (
        <>
          <p className="mt-4 mb-2 font-bold" role="status">
            {count(parsed.total, 'route')} in the file
            {plan && <> · {plan.created} new · {plan.updated} {plan.updated === 1 ? 'update' : 'updates'} · {plan.unchanged} unchanged</>}
            {' · '}{count(issues.length, 'problem')}
          </p>

          {issues.length > 0 && (
            <div className="card !border-acc mt-3" role="alert">
              <div className="flex items-center justify-between gap-2">
                <b className="flex items-center gap-2 text-acc"><AlertTriangle className="w-5 h-5" aria-hidden />Fix these rows and upload again</b>
                <button className="btn btn-sm flex-none" onClick={copyIssues}><Copy aria-hidden />Copy</button>
              </div>
              <ul className="mt-2 mb-0 pl-5 grid gap-1">
                {issues.slice(0, SHOWN_ISSUES).map((i, k) => <li key={k}>{issueText(i)}</li>)}
              </ul>
              {issues.length > SHOWN_ISSUES && <p className="field-hint">and {issues.length - SHOWN_ISSUES} more</p>}
            </div>
          )}

          {(parsed.warnings.length > 0 || parsed.ignoredColumns.length > 0) && (
            <div className="card mt-3">
              <b>Notes</b>
              <ul className="mt-2 mb-0 pl-5 grid gap-1 text-mut">
                {parsed.ignoredColumns.length > 0 && <li>Ignored columns: {parsed.ignoredColumns.join(', ')}</li>}
                {parsed.warnings.map((w, k) => <li key={k}>{issueText(w)}</li>)}
              </ul>
            </div>
          )}

          {plan && issues.length === 0 && changes > 0 && (
            <div className="card mt-3">
              {needsBackup ? (
                <>
                  <b>Download a backup first</b>
                  <p className="text-mut mt-1 mb-3">
                    It's the only undo: the free plan has no database backups. Re-importing it puts changed values back.
                    It can't clear fields that were blank before{blankFields > 0 ? ` (${count(blankFields, 'field')} here)` : ''},
                    or remove new routes: delete those on Manage routes.
                  </p>
                  <button className={`btn btn-full ${backedUp ? '' : 'btn-pri'}`} onClick={downloadBackup}>
                    {backedUp ? <><Check aria-hidden />Backup downloaded (download again)</> : <><Download aria-hidden />Download backup ({count(plan.updated, 'route')})</>}
                  </button>
                </>
              ) : (
                <p className="m-0 text-mut">
                  Nothing to back up: {plan.created === 1 ? 'the route is' : `all ${plan.created} routes are`} new.
                  To undo, delete {plan.created === 1 ? 'it' : 'them'} on Manage routes.
                </p>
              )}
            </div>
          )}

          {applyError && <p className="field-err" role="alert">{applyError}</p>}

          {plan && (
            <div className="grid gap-2.5 mt-3">
              {plan.routes.map((r) => <PlanCard key={r.row} route={r} />)}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Import routes?"
        message={plan
          ? `Create ${count(plan.created, 'route')} and update ${count(plan.updated, 'route')}? Patrollers see the changes right away.`
          : ''}
        confirmLabel="Import"
        busy={applying}
        onConfirm={apply}
        onCancel={() => setConfirmOpen(false)}
      />
    </Screen>
  );
};

const ACTION_LABEL = { new: 'NEW', update: 'UPDATE', unchanged: 'UNCHANGED' } as const;

/** One route of the preview: everything a new route gets, or old -> new for each changed field. */
const PlanCard: React.FC<{ route: PlanRoute }> = ({ route: r }) => {
  const fields = IMPORT_FIELDS.filter((f) => r.changes[f]);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`badge ${r.action === 'new' ? '' : r.action === 'update' ? '!bg-sf2 !text-tx' : '!bg-sf2 !text-mut'}`}>
          {ACTION_LABEL[r.action]}
        </span>
        <span className="badge">{r.code}</span>
        <span className="row-meta ml-auto">Row {r.row}</span>
      </div>
      {r.action === 'unchanged' ? (
        <p className="row-meta mt-2 mb-0">No changes: the file matches what is stored.</p>
      ) : (
        <dl className="mt-2 mb-0 grid gap-3">
          {fields.map((f) => {
            const c = r.changes[f]!;
            const now = fieldLines(f, c.old);
            const next = fieldLines(f, c.new);
            return (
              <div key={f}>
                <dt className="text-mut text-[13px] font-bold">
                  {FIELD_LABELS[f]}
                  {r.action === 'update' && wasBlank(f, c) && <span className="tag-opt ml-2">backup can't clear this</span>}
                </dt>
                <dd className="m-0">
                  {r.action === 'new' ? (
                    <Lines lines={next} list={LIST_FIELDS.has(f)} numbered={f === 'turn_by_turn'} />
                  ) : LIST_FIELDS.has(f) ? (
                    <div className="grid grid-cols-1 min-[481px]:grid-cols-2 gap-2 mt-1">
                      <div><small className="text-mut">Now</small><Lines lines={now} list numbered={f === 'turn_by_turn'} muted /></div>
                      <div><small className="text-mut">After import</small><Lines lines={next} list numbered={f === 'turn_by_turn'} /></div>
                    </div>
                  ) : (
                    <>
                      <span className="block text-mut line-through">{now[0] ?? '(blank)'}</span>
                      <span className="block font-bold">{next[0]}</span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
          {r.action === 'update' && <p className="field-hint m-0">Blank cells keep the current value.</p>}
        </dl>
      )}
    </div>
  );
};

const Lines: React.FC<{ lines: string[]; list?: boolean; numbered?: boolean; muted?: boolean }> = ({ lines, list, numbered, muted }) => {
  if (lines.length === 0) return <span className="block text-mut">(blank)</span>;
  if (!list) return <span className="block whitespace-pre-line">{lines[0]}</span>;
  const Tag = numbered ? 'ol' : 'ul';
  return (
    <Tag className={`mt-1 mb-0 pl-5 grid gap-0.5 ${muted ? 'text-mut' : ''}`}>
      {lines.map((l, i) => <li key={i}>{l}</li>)}
    </Tag>
  );
};

export default AdminRouteImportPage;
