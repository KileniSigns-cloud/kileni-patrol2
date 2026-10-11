import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, Download, FileUp, History, Map as MapIcon, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import type { RouteWithStats } from '../lib/routesApi';
import type { PatrolRoute } from '../types';
import { errorMessage } from '../lib/errors';
import { plural } from '../lib/patrolHistory';
import { buildRouteExportRows, routeExportFileName, toCsv } from '../lib/routeExport';
import { routeDeleteDialog, type RouteDeleteCheck } from '../lib/routeDelete';
import { cornerList, cornersBadge, hasGps } from '../lib/zoneInfo';
import { downloadText } from '../lib/download';
import Screen from '../components/layout/Screen';
import AdminHeader from '../components/admin/AdminHeader';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState, { LoadError } from '../components/ui/EmptyState';
import { toast } from '../components/ui/Toast';

type Tab = 'active' | 'retired';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

/** Code, "4 corners" (muted "No corners" for an old row) and "No GPS" when a corner lacks it. */
const ZoneBadges: React.FC<{ zone: PatrolRoute }> = ({ zone }) => {
  const corners = cornerList(zone.corners);
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="badge">{zone.code}</span>
      <span className={`badge ${corners.length === 0 ? '!bg-sf2 !text-mut' : ''}`}>{cornersBadge(zone.corners)}</span>
      {corners.some((c) => !hasGps(c)) && <span className="badge !bg-sf2 !text-tx">No GPS</span>}
    </div>
  );
};

const AdminRoutesPage: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'retired' || params.get('tab') === 'archived' ? 'retired' : 'active';
  const setTab = (t: Tab) => setParams(t === 'retired' ? { tab: 'retired' } : {}, { replace: true });

  const {
    getActiveRoutes, getArchivedRoutes, archiveRoute, restoreRoute, checkRouteDelete, deleteRoute, getRouteExport,
  } = usePatrolStore();
  const [active, setActive] = useState<RouteWithStats[]>([]);
  const [retired, setRetired] = useState<PatrolRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toRetire, setToRetire] = useState<RouteWithStats | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  // Delete: the DB decides (migration 010). check is its dry-run answer, shown before anything changes.
  // Only a never-used zone can be deleted; a zone with history is retired instead.
  const [toDelete, setToDelete] = useState<{ route: PatrolRoute; check: RouteDeleteCheck } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([getActiveRoutes(), getArchivedRoutes()]);
      setActive(a);
      setRetired(b);
    } catch (e) {
      setError(errorMessage(e, 'Could not load zones.'));
    } finally {
      setLoading(false);
    }
  }, [getActiveRoutes, getArchivedRoutes]);

  useEffect(() => { load(); }, [load]);

  const confirmRetire = async () => {
    if (!toRetire) return;
    setBusyId(toRetire.id);
    try {
      await archiveRoute(toRetire.id);
      toast.success(`Retired ${toRetire.code}`);
      setToRetire(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not retire the zone.'));
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (route: PatrolRoute) => {
    setBusyId(route.id);
    try {
      await restoreRoute(route.id);
      toast.success(`Restored ${route.code}`);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not restore the zone.'));
    } finally {
      setBusyId(null);
    }
  };

  const exportCsv = async (route: PatrolRoute) => {
    setExportingId(route.id);
    try {
      const { route: r, sessions, routeBusinesses } = await getRouteExport(route.id);
      const rows = buildRouteExportRows(r, sessions, routeBusinesses);
      downloadText(routeExportFileName(r.code, new Date().toISOString()), toCsv(rows), 'text/csv;charset=utf-8');
      toast.success(`Exported ${r.code || r.name}: ${rows.length} ${plural('row', rows.length)}`);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not export the zone.'));
    } finally {
      setExportingId(null);
    }
  };

  const startDelete = async (route: PatrolRoute) => {
    setCheckingId(route.id);
    try {
      setToDelete({ route, check: await checkRouteDelete(route.id) });
    } catch (e) {
      toast.error(errorMessage(e, 'Could not check whether the zone can be deleted.'));
    } finally {
      setCheckingId(null);
    }
  };

  const deleteDialog = toDelete ? routeDeleteDialog(toDelete.route, toDelete.check) : null;

  const confirmDelete = async () => {
    if (!toDelete || !deleteDialog) return;
    const { route } = toDelete;
    setDeleting(true);
    try {
      if (deleteDialog.action === 'archive') {
        await archiveRoute(route.id);
        toast.success(`Retired ${route.code}`);
      } else {
        const result = await deleteRoute(route.id);
        // Used since the check (e.g. a patrol just started): show why instead of deleting.
        if (result.status === 'in_use') { setToDelete({ route, check: result }); return; }
        toast.success(`Deleted ${route.code}`);
      }
      setToDelete(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not delete the zone.'));
    } finally {
      setDeleting(false);
    }
  };

  // Swipe left/right on the list to switch tabs.
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx < -60 && tab === 'active') setTab('retired');
    if (dx > 60 && tab === 'retired') setTab('active');
  };

  const openCreate = () => navigate('/admin/routes/create');

  return (
    <Screen nav>
      <AdminHeader
        title="Manage zones"
        sub="Create, edit, retire and review patrol zones."
        action={
          <div className="flex gap-2 flex-none">
            <button className="btn btn-sm" onClick={() => navigate('/admin/routes/import')}><FileUp aria-hidden />Import CSV</button>
            <button className="btn btn-pri btn-sm" onClick={openCreate}><Plus aria-hidden />New zone</button>
          </div>
        }
      />

      <div className="seg" role="tablist" aria-label="Zone status">
        {(['active', 'retired'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            aria-pressed={tab === t}
            aria-controls="routes-panel"
            onClick={() => setTab(t)}
          >
            {t === 'active' ? 'Active' : 'Retired'}
            <span className="text-mut ml-1">{loading ? '–' : t === 'active' ? active.length : retired.length}</span>
          </button>
        ))}
      </div>

      <div id="routes-panel" role="tabpanel" className="grid gap-2.5 mt-3" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {loading ? (
          [0, 1, 2].map((i) => <div key={i} className="skeleton h-40" aria-busy="true" />)
        ) : error ? (
          <LoadError message={error} onRetry={load} />
        ) : tab === 'active' ? (
          active.length === 0 ? (
            <EmptyState
              icon={MapIcon}
              title="No active zones"
              body="A zone is the grid inside 4 corners that your team patrols. Create one, or import a CSV, and it shows up for every patroller."
              action={{ label: 'Create first zone', onClick: openCreate }}
            />
          ) : active.map((r) => (
            <div key={r.id} className="card">
              <ZoneBadges zone={r} />
              <div className="row-name mt-1.5">{r.name}</div>
              {r.area_type && <div className="row-meta">{r.area_type}</div>}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5 text-mut text-sm">
                <span><b className="text-tx">{r.patrols30d}</b> {plural('patrol', r.patrols30d)}, 30 days</span>
                <span><b className="text-tx">{r.inspections30d}</b> {plural('inspection', r.inspections30d)}, 30 days</span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3.5 [&>.btn]:flex-1 [&>.btn]:min-w-[92px]">
                <button className="btn btn-sm" onClick={() => navigate(`/admin/routes/${r.id}/preview`)}><MapIcon aria-hidden />Preview</button>
                <button className="btn btn-sm" onClick={() => navigate(`/admin/routes/${r.id}/edit`)}><Pencil aria-hidden />Edit</button>
                <button className="btn btn-sm" onClick={() => navigate(`/admin/routes/${r.id}/history`)}><History aria-hidden />History</button>
                <button className="btn btn-sm" onClick={() => exportCsv(r)} disabled={exportingId === r.id}>
                  {exportingId === r.id ? <><span className="spin" aria-hidden />Exporting…</> : <><Download aria-hidden />Export</>}
                </button>
                <button className="btn btn-sm btn-dt" onClick={() => setToRetire(r)} disabled={busyId === r.id}><Archive aria-hidden />Retire</button>
                <button className="btn btn-sm btn-dt" onClick={() => startDelete(r)} disabled={busyId === r.id || checkingId === r.id}>
                  {checkingId === r.id ? <><span className="spin" aria-hidden />Checking…</> : <><Trash2 aria-hidden />Delete</>}
                </button>
              </div>
            </div>
          ))
        ) : retired.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="Nothing retired"
            body="Retired zones land here. Their patrol history stays viewable and you can restore them anytime."
          />
        ) : retired.map((r) => (
          <div key={r.id} className="card">
            <div className="flex items-center justify-between gap-2">
              <ZoneBadges zone={r} />
              {r.archived_at && <span className="row-meta">Retired {fmtDate(r.archived_at)}</span>}
            </div>
            <div className="row-name mt-1.5">{r.name}</div>
            {r.area_type && <div className="row-meta">{r.area_type}</div>}
            <div className="flex flex-wrap gap-2 mt-3.5 [&>.btn]:flex-1 [&>.btn]:min-w-[92px]">
              <button className="btn btn-sm" onClick={() => navigate(`/admin/routes/${r.id}/history`)}><History aria-hidden />History</button>
              <button className="btn btn-sm" onClick={() => navigate(`/admin/routes/${r.id}/edit`)}><Pencil aria-hidden />Edit</button>
              <button className="btn btn-sm" onClick={() => restore(r)} disabled={busyId === r.id}>
                {busyId === r.id ? <><span className="spin" aria-hidden />Restoring…</> : <><Undo2 aria-hidden />Restore</>}
              </button>
              <button className="btn btn-sm" onClick={() => exportCsv(r)} disabled={exportingId === r.id}>
                {exportingId === r.id ? <><span className="spin" aria-hidden />Exporting…</> : <><Download aria-hidden />Export</>}
              </button>
              <button className="btn btn-sm btn-dt" onClick={() => startDelete(r)} disabled={busyId === r.id || checkingId === r.id}>
                {checkingId === r.id ? <><span className="spin" aria-hidden />Checking…</> : <><Trash2 aria-hidden />Delete</>}
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={toRetire !== null}
        danger
        title="Retire zone?"
        message={`Retire ${toRetire?.code ?? ''} ${toRetire?.name ?? ''}? Patrollers stop seeing it. Its patrols stay viewable and you can restore it anytime.`}
        confirmLabel="Retire"
        busy={busyId !== null && busyId === toRetire?.id}
        onConfirm={confirmRetire}
        onCancel={() => setToRetire(null)}
      />

      <ConfirmDialog
        open={deleteDialog !== null}
        danger
        title={deleteDialog?.title ?? ''}
        message={deleteDialog?.message ?? ''}
        confirmLabel={deleteDialog?.action === 'archive' ? 'Retire instead' : 'Delete zone'}
        hideConfirm={deleteDialog?.action === 'none'}
        busy={deleting}
        secondary={toDelete ? {
          label: 'Export CSV first',
          onClick: () => exportCsv(toDelete.route),
          busy: exportingId === toDelete.route.id,
        } : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </Screen>
  );
};

export default AdminRoutesPage;
