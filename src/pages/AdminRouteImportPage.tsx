import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Copy, Download, FileUp } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { ZoneImportError } from '../lib/routesApi';
import { errorMessage } from '../lib/errors';
import { downloadText } from '../lib/download';
import { plural } from '../lib/patrolHistory';
import {
  backupFileName, buildBackupCsv, FIELD_LABELS, fieldLines, IMPORT_FIELDS, IMPORT_TEMPLATE, LIST_FIELDS, mergeIssues,
  parseZoneCsv, serverIssues, wasBlank,
  type ImportPlan, type ParsedImport, type PlanZone, type RowIssue,
} from '../lib/zoneImport';
import Screen from '../components/layout/Screen';
import AdminHeader from '../components/admin/AdminHeader';
import FlowFooter from '../components/flow/FlowFooter';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/Toast';

const SHOWN_ISSUES = 50;

/** "4 zones", "1 zone". */
const count = (n: number, one: string) => `${n} ${plural(one, n)}`;

const issueText = (i: RowIssue) => (i.row === null ? i.message : `Row ${i.row} · ${i.message}`);

/**
 * Admin CSV import: choose a file, preview what changes (dry run, nothing written), download a
 * backup of the zones that will change, then confirm. Upsert by zone code; nothing is deleted.
 */
const AdminRouteImportPage: React.FC = () => {
  const navigate = useNavigate();
  const { previewZoneImport, applyZoneImport } = usePatrolStore();
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
      const p = parseZoneCsv(await file.text(), file.size);
      setParsed(p);
      let found = p.errors;
      // The server checks what the browser can't (which zones are new and need a name, area type
      // and corners) and says NEW / UPDATE per zone. Rows with browser errors are left out of that check.
      if (p.rows.length > 0 && !p.errors.some((e) => e.row === null)) {
        const res = await previewZoneImport(p.rows);
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
      const done = await applyZoneImport(parsed.rows, plan.fingerprint);
      toast.success(`Imported: ${done.created} new, ${done.updated} updated`);
      navigate('/admin/routes');
    } catch (e) {
      if (e instanceof ZoneImportError && e.rowErrors.length > 0) setIssues(mergeIssues([], e.rowErrors));
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
    ? plan.zones.reduce((n, z) => n + (z.action === 'update'
      ? IMPORT_FIELDS.filter((f) => z.changes[f] && wasBlank(f, z.changes[f]!)).length : 0), 0)
    : 0;
  const needsBackup = (plan?.updated ?? 0) > 0;
  const canConfirm = plan !== null && issues.length === 0 && changes > 0 && (!needsBackup || backedUp) && !applying;
  const hint = !plan ? null
    : issues.length > 0 ? 'Fix the problems above and upload the file again.'
    : changes === 0 ? 'Nothing to import: every zone already matches the file.'
    : needsBackup && !backedUp ? 'Download the backup first.'
    : null;

  return (
    <Screen
      nav={!plan}
      footer={plan ? (
        <FlowFooter hint={hint}>
          <button className="btn btn-pri btn-xl btn-full" disabled={!canConfirm} onClick={() => setConfirmOpen(true)}>
            <Check aria-hidden />Import {count(changes, 'zone')}
          </button>
        </FlowFooter>
      ) : undefined}
    >
      <AdminHeader
        back={{ to: '/admin/routes', label: 'Manage zones' }}
        title="Import zones"
        sub="Create or update zones from a CSV file. Matched by zone code; nothing is deleted."
      />

      <div className="card">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          id="zone-csv"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <label htmlFor="zone-csv" className={`btn btn-pri btn-full ${checking ? 'pointer-events-none opacity-60' : ''}`}>
          {checking ? <><span className="spin" aria-hidden />Checking…</> : <><FileUp aria-hidden />{fileName ? 'Choose another file' : 'Choose CSV file'}</>}
        </label>
        {fileName && <p className="field-hint break-all">{fileName}</p>}
        <button className="btn btn-sm btn-full mt-2.5" onClick={() => downloadText('zone-import-template.csv', IMPORT_TEMPLATE, 'text/csv;charset=utf-8')}>
          <Download aria-hidden />Download template
        </button>
        <p className="field-hint">
          One row per zone: zone_code, zone_name, area_type, corner1 to corner8 (intersections in order around the edge)
          with corner1_gps to corner8_gps ("lat,lng", optional), anchors ("Name | Address", one per line or separated by ;),
          focus, est_minutes, status (active or retired). A new zone needs a name, area type and at least 4 corners.
          Blank cells keep the current value; filling any corner replaces all of the zone's corners.
        </p>
      </div>

      {checkError && <p className="field-err" role="alert">{checkError}</p>}

      {parsed && !checking && (
        <>
          <p className="mt-4 mb-2 font-bold" role="status">
            {count(parsed.total, 'zone')} in the file
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
                    or remove new zones: delete those on Manage zones.
                  </p>
                  <button className={`btn btn-full ${backedUp ? '' : 'btn-pri'}`} onClick={downloadBackup}>
                    {backedUp ? <><Check aria-hidden />Backup downloaded (download again)</> : <><Download aria-hidden />Download backup ({count(plan.updated, 'zone')})</>}
                  </button>
                </>
              ) : (
                <p className="m-0 text-mut">
                  Nothing to back up: {plan.created === 1 ? 'the zone is' : `all ${plan.created} zones are`} new.
                  To undo, delete {plan.created === 1 ? 'it' : 'them'} on Manage zones.
                </p>
              )}
            </div>
          )}

          {applyError && <p className="field-err" role="alert">{applyError}</p>}

          {plan && (
            <div className="grid gap-2.5 mt-3">
              {plan.zones.map((z) => <PlanCard key={z.row} zone={z} />)}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Import zones?"
        message={plan
          ? `Create ${count(plan.created, 'zone')} and update ${count(plan.updated, 'zone')}? Patrollers see the changes right away.`
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

/** One zone of the preview: everything a new zone gets, or old -> new for each changed field. */
const PlanCard: React.FC<{ zone: PlanZone }> = ({ zone: z }) => {
  const fields = IMPORT_FIELDS.filter((f) => z.changes[f]);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`badge ${z.action === 'new' ? '' : z.action === 'update' ? '!bg-sf2 !text-tx' : '!bg-sf2 !text-mut'}`}>
          {ACTION_LABEL[z.action]}
        </span>
        <span className="badge">{z.code}</span>
        <span className="row-meta ml-auto">Row {z.row}</span>
      </div>
      {z.action === 'unchanged' ? (
        <p className="row-meta mt-2 mb-0">No changes: the file matches what is stored.</p>
      ) : (
        <dl className="mt-2 mb-0 grid gap-3">
          {fields.map((f) => {
            const c = z.changes[f]!;
            const now = fieldLines(f, c.old);
            const next = fieldLines(f, c.new);
            const list = LIST_FIELDS.has(f);
            return (
              <div key={f}>
                <dt className="text-mut text-[13px] font-bold">
                  {FIELD_LABELS[f]}
                  {z.action === 'update' && wasBlank(f, c) && <span className="tag-opt ml-2">backup can't clear this</span>}
                </dt>
                <dd className="m-0">
                  {z.action === 'new' ? (
                    <Lines lines={next} list={list} numbered={f === 'corners'} />
                  ) : list ? (
                    <div className="grid grid-cols-1 min-[481px]:grid-cols-2 gap-2 mt-1">
                      <div><small className="text-mut">Now</small><Lines lines={now} list numbered={f === 'corners'} muted /></div>
                      <div><small className="text-mut">After import</small><Lines lines={next} list numbered={f === 'corners'} /></div>
                    </div>
                  ) : (
                    <>
                      <span className="block text-mut line-through">{now[0] ?? '(blank)'}</span>
                      <span className="block font-bold whitespace-pre-line">{next[0]}</span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
          {z.action === 'update' && <p className="field-hint m-0">Blank cells keep the current value.</p>}
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
