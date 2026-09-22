import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, History, Pencil, Plus, RefreshCw } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import type { RouteWithStats } from '../lib/routesApi';
import type { PatrolRoute } from '../types';
import AdminHeader from '../components/admin/AdminHeader';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/Toast';
import BottomNav from '../components/layout/BottomNav';

type Tab = 'active' | 'archived';

const focusRing = 'active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FCCA3B]';
const actionBtn = `min-h-12 px-4 inline-flex items-center justify-center gap-2 rounded-xl border border-[#2A2A2A] text-sm font-semibold text-white hover:border-[#8F8F8F] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`;

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
      setError(e instanceof Error ? e.message : 'Could not load routes.');
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
      toast.success(`Archived "${toArchive.name}".`);
      setToArchive(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not archive route.');
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (route: PatrolRoute) => {
    setBusyId(route.id);
    try {
      await restoreRoute(route.id);
      toast.success(`Restored "${route.name}".`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not restore route.');
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
    if (dx < -70 && tab === 'active') setTab('archived');
    if (dx > 70 && tab === 'archived') setTab('active');
  };

  const TabButton = ({ value, label, count }: { value: Tab; label: string; count: number }) => {
    const selected = tab === value;
    return (
      <button
        role="tab"
        aria-selected={selected}
        aria-controls="routes-panel"
        onClick={() => setTab(value)}
        className={`relative min-h-12 px-1 mr-6 text-sm font-bold transition-colors ${selected ? 'text-white' : 'text-[#8F8F8F] hover:text-white'} ${focusRing}`}
      >
        {label}
        <span className="ml-2 text-xs font-semibold text-[#8F8F8F]">{loading ? '–' : count}</span>
        <span
          aria-hidden
          className={`absolute left-0 right-0 -bottom-px h-[3px] rounded-full bg-[#FCCA3B] transition-opacity duration-200 ${selected ? 'opacity-100' : 'opacity-0'}`}
        />
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-24">
      <div className="max-w-3xl mx-auto">
        <AdminHeader
          eyebrow="Admin"
          title="Routes"
          backTo="/admin"
          action={
            <button
              onClick={() => navigate('/admin/routes/create')}
              className={`min-h-12 px-4 flex-shrink-0 inline-flex items-center gap-2 rounded-xl bg-[#FCCA3B] text-black font-black hover:brightness-110 transition ${focusRing}`}
            >
              <Plus className="w-5 h-5" aria-hidden />
              <span>Create<span className="hidden sm:inline"> route</span></span>
            </button>
          }
        />

        <div role="tablist" aria-label="Route status" className="px-4 sm:px-6 border-b border-[#2A2A2A] flex">
          <TabButton value="active" label="Active" count={active.length} />
          <TabButton value="archived" label="Archived" count={archived.length} />
        </div>

        <div id="routes-panel" role="tabpanel" className="px-4 sm:px-6 pt-4" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {loading ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 bg-[#1C1C1E] rounded-2xl animate-pulse motion-reduce:animate-none" />)}
            </div>
          ) : error ? (
            <div className="py-16 flex flex-col items-center gap-4 text-center">
              <p className="text-red-400 text-sm max-w-sm">{error}</p>
              <button onClick={load} className={actionBtn}>
                <RefreshCw className="w-4 h-4" aria-hidden /> Try again
              </button>
            </div>
          ) : tab === 'active' ? (
            active.length === 0 ? (
              <Empty title="No active routes" body="Create a route to make it available to patrollers." />
            ) : (
              <ul className="flex flex-col gap-3">
                {active.map((r) => (
                  <li key={r.id} className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-4">
                    <button
                      onClick={() => navigate(`/admin/routes/${r.id}/history`)}
                      className={`w-full text-left rounded-lg ${focusRing}`}
                    >
                      <div className="flex items-start gap-3">
                        <CodeBadge code={r.code} />
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-bold leading-snug">{r.name}</p>
                          <p className="text-[#8F8F8F] text-sm mt-0.5 capitalize">{r.area_type || 'No area type'}</p>
                        </div>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3">
                        <Stat label="Patrols · 30d" value={r.patrols30d} />
                        <Stat label="Inspections · 30d" value={r.inspections30d} />
                      </dl>
                    </button>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <button onClick={() => navigate(`/admin/routes/${r.id}/history`)} className={actionBtn}>
                        <History className="w-4 h-4" aria-hidden /> History
                      </button>
                      <button onClick={() => setToArchive(r)} disabled={busyId === r.id} className={actionBtn}>
                        <Archive className="w-4 h-4" aria-hidden /> Archive
                      </button>
                      <button disabled title="Editing is coming in a later release" className={actionBtn}>
                        <Pencil className="w-4 h-4" aria-hidden /> Edit
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : archived.length === 0 ? (
            <Empty title="No archived routes" body="Archived routes are hidden from patrollers and listed here." />
          ) : (
            <ul className="flex flex-col gap-3">
              {archived.map((r) => (
                <li key={r.id} className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    <CodeBadge code={r.code} muted />
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-bold leading-snug">{r.name}</p>
                      <p className="text-[#8F8F8F] text-sm mt-0.5">
                        Archived {r.archived_at ? fmtDate(r.archived_at) : ''}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button onClick={() => restore(r)} disabled={busyId === r.id} className={actionBtn}>
                      <ArchiveRestore className="w-4 h-4" aria-hidden /> {busyId === r.id ? 'Restoring…' : 'Restore'}
                    </button>
                    <button onClick={() => navigate(`/admin/routes/${r.id}/history`)} className={actionBtn}>
                      <History className="w-4 h-4" aria-hidden /> Details
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={toArchive !== null}
        title="Archive route?"
        message={`Archive route '${toArchive?.name ?? ''}'? Patrols using this route can still be viewed, but it won't appear in the active routes list.`}
        confirmLabel="Archive"
        busy={busyId !== null && busyId === toArchive?.id}
        onConfirm={confirmArchive}
        onCancel={() => setToArchive(null)}
      />

      <BottomNav />
    </div>
  );
};

const CodeBadge: React.FC<{ code: string; muted?: boolean }> = ({ code, muted = false }) => (
  <span
    className={`flex-shrink-0 min-w-12 h-12 px-2 rounded-xl flex items-center justify-center text-xs font-black tracking-wide ${
      muted ? 'border border-[#2A2A2A] text-[#8F8F8F]' : 'bg-[#FCCA3B] text-black'
    }`}
  >
    {code}
  </span>
);

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl border border-[#2A2A2A] px-3 py-2">
    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#8F8F8F]">{label}</dt>
    <dd className="text-xl font-black text-white tabular-nums">{value}</dd>
  </div>
);

const Empty: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="py-16 flex flex-col items-center gap-2 text-center">
    <p className="text-white font-black text-lg">{title}</p>
    <p className="text-[#8F8F8F] text-sm max-w-xs">{body}</p>
  </div>
);

export default AdminRoutesPage;
