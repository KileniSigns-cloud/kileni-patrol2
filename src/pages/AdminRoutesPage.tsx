import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, History, Map as MapIcon, Pencil, Plus, Undo2 } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import type { RouteWithStats } from '../lib/routesApi';
import type { PatrolRoute } from '../types';
import { errorMessage } from '../lib/errors';
import { plural } from '../lib/patrolHistory';
import Screen from '../components/layout/Screen';
import AdminHeader from '../components/admin/AdminHeader';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState, { LoadError } from '../components/ui/EmptyState';
import { toast } from '../components/ui/Toast';

type Tab = 'active' | 'archived';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

const AdminRoutesPage: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'archived' ? 'archived' : 'active';
  const setTab = (t: Tab) => setParams(t === 'archived' ? { tab: 'archived' } : {}, { replace: true });

  const { getActiveRoutes, getArchivedRoutes, archiveRoute, restoreRoute } = usePatrolStore();
  const [active, setActive] = useState<RouteWithStats[]>([]);
  const [archived, setArchived] = useState<PatrolRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toArchive, setToArchive] = useState<RouteWithStats | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([getActiveRoutes(), getArchivedRoutes()]);
      setActive(a);
      setArchived(b);
    } catch (e) {
      setError(errorMessage(e, 'Could not load routes.'));
    } finally {
      setLoading(false);
    }
  }, [getActiveRoutes, getArchivedRoutes]);

  useEffect(() => { load(); }, [load]);

  const confirmArchive = async () => {
    if (!toArchive) return;
    setBusyId(toArchive.id);
    try {
      await archiveRoute(toArchive.id);
      toast.success(`Archived ${toArchive.name}`);
      setToArchive(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not archive route.'));
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (route: PatrolRoute) => {
    setBusyId(route.id);
    try {
      await restoreRoute(route.id);
      toast.success(`Restored ${route.name}`);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not restore route.'));
    } finally {
      setBusyId(null);
    }
  };

  // Swipe left/right on the list to switch tabs.
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx < -60 && tab === 'active') setTab('archived');
    if (dx > 60 && tab === 'archived') setTab('active');
  };

  const openCreate = () => navigate('/admin/routes/create');

  return (
    <Screen nav>
      <AdminHeader
        title="Manage routes"
        sub="Create, archive and review patrol loops."
        action={<button className="btn btn-pri btn-sm flex-none" onClick={openCreate}><Plus aria-hidden />New route</button>}
      />

      <div className="seg" role="tablist" aria-label="Route status">
        {(['active', 'archived'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            aria-pressed={tab === t}
            aria-controls="routes-panel"
            onClick={() => setTab(t)}
          >
            {t === 'active' ? 'Active' : 'Archived'}
            <span className="text-mut ml-1">{loading ? '–' : t === 'active' ? active.length : archived.length}</span>
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
              title="No active routes"
              body="Routes are the loops your team patrols. Create one and it shows up for every patroller."
              action={{ label: 'Create first route', onClick: openCreate }}
            />
          ) : active.map((r) => (
            <div key={r.id} className="card">
              <span className="badge">{r.code}</span>
              <div className="row-name mt-1.5">{r.name}</div>
              {r.description && <div className="row-meta">{r.description}</div>}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5 text-mut text-sm">
                <span><b className="text-tx">{r.patrols30d}</b> {plural('patrol', r.patrols30d)}, 30 days</span>
                <span><b className="text-tx">{r.inspections30d}</b> {plural('inspection', r.inspections30d)}, 30 days</span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3.5 [&>.btn]:flex-1 [&>.btn]:min-w-[92px]">
                <button className="btn btn-sm" onClick={() => navigate(`/admin/routes/${r.id}/history`)}><History aria-hidden />History</button>
                <button className="btn btn-sm" disabled title="Editing is coming in a later release"><Pencil aria-hidden />Edit</button>
                <button className="btn btn-sm btn-dt" onClick={() => setToArchive(r)} disabled={busyId === r.id}><Archive aria-hidden />Archive</button>
              </div>
            </div>
          ))
        ) : archived.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="Nothing archived"
            body="Archived routes land here. Their patrol history stays viewable and you can restore them anytime."
          />
        ) : archived.map((r) => (
          <div key={r.id} className="card">
            <div className="flex items-center justify-between gap-2">
              <span className="badge">{r.code}</span>
              {r.archived_at && <span className="row-meta">Archived {fmtDate(r.archived_at)}</span>}
            </div>
            <div className="row-name mt-1.5">{r.name}</div>
            {r.description && <div className="row-meta">{r.description}</div>}
            <div className="flex flex-wrap gap-2 mt-3.5 [&>.btn]:flex-1 [&>.btn]:min-w-[92px]">
              <button className="btn btn-sm" onClick={() => navigate(`/admin/routes/${r.id}/history`)}><History aria-hidden />History</button>
              <button className="btn btn-sm" onClick={() => restore(r)} disabled={busyId === r.id}>
                {busyId === r.id ? <><span className="spin" aria-hidden />Restoring…</> : <><Undo2 aria-hidden />Restore</>}
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={toArchive !== null}
        danger
        title="Archive route?"
        message={`Archive route '${toArchive?.name ?? ''}'? Patrols using this route can still be viewed, but it won't appear in the active routes list.`}
        confirmLabel="Archive"
        busy={busyId !== null && busyId === toArchive?.id}
        onConfirm={confirmArchive}
        onCancel={() => setToArchive(null)}
      />
    </Screen>
  );
};

export default AdminRoutesPage;
