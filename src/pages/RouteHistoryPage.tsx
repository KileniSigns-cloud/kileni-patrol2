import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Footprints } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { fetchRoute, HISTORY_PAGE_SIZE, type RouteHistoryPage as HistoryPage } from '../lib/routesApi';
import type { PatrolRoute } from '../types';
import { errorMessage } from '../lib/errors';
import Screen from '../components/layout/Screen';
import AdminHeader from '../components/admin/AdminHeader';
import EmptyState, { LoadError } from '../components/ui/EmptyState';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const cell = 'px-3.5 py-3 border-b border-line text-left whitespace-nowrap';
const num = `${cell} text-right tabular-nums`;

const RouteHistoryPage: React.FC = () => {
  const { routeId = '' } = useParams<{ routeId: string }>();
  const getRouteHistory = usePatrolStore((s) => s.getRouteHistory);

  const [route, setRoute] = useState<PatrolRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRouteError(null);
    fetchRoute(routeId)
      .then((r) => { if (live) setRoute(r); })
      .catch((e) => { if (live) setRouteError(errorMessage(e, 'Could not load route details.')); });
    return () => { live = false; };
  }, [routeId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await getRouteHistory(routeId, page));
    } catch (e) {
      setError(errorMessage(e, 'Could not load patrol history.'));
    } finally {
      setLoading(false);
    }
  }, [getRouteHistory, routeId, page]);

  useEffect(() => { load(); }, [load]);

  const total = history?.total ?? 0;
  const firstRow = total === 0 ? 0 : page * HISTORY_PAGE_SIZE + 1;
  const lastRow = Math.min(total, (page + 1) * HISTORY_PAGE_SIZE);

  return (
    <Screen nav>
      <AdminHeader
        back={{ to: route?.archived_at ? '/admin/routes?tab=archived' : '/admin/routes', label: 'Manage routes' }}
        badge={route?.code}
        title={route?.name ?? 'Route'}
        sub="Patrol history"
      />
      {routeError && <p className="field-err mt-0 mb-3" role="alert">{routeError}</p>}
      {route && <RouteDetails route={route} />}

      {error ? (
        <LoadError message={error} onRetry={load} />
      ) : !loading && total === 0 ? (
        <EmptyState icon={Footprints} title="No patrols yet" body="Patrols appear here once someone starts this route from the Routes list." />
      ) : (
        <>
          <div className="overflow-x-auto border border-line rounded-2xl bg-sf" aria-busy={loading}>
            <table className="w-full min-w-[560px] border-collapse text-[15px]">
              <thead>
                <tr className="[&>th]:bg-sf2 [&>th]:text-[13px] [&>th]:text-mut [&>th]:font-extrabold">
                  <th scope="col" className={cell}>Date</th>
                  <th scope="col" className={cell}>Start</th>
                  <th scope="col" className={cell}>Patroller</th>
                  <th scope="col" className={num}>Duration (HH:MM)</th>
                  <th scope="col" className={num}>Inspections</th>
                  <th scope="col" className={num}>Photos</th>
                </tr>
              </thead>
              <tbody className="[&>tr:last-child>td]:border-b-0">
                {loading
                  ? Array.from({ length: 5 }, (_, i) => (
                      <tr key={i}><td colSpan={6} className={cell}><div className="skeleton h-5 rounded" /></td></tr>
                    ))
                  : history?.rows.map((r) => (
                      <tr key={r.id}>
                        <td className={cell}>{fmtDate(r.startedAt)}</td>
                        <td className={cell}>{fmtTime(r.startedAt)}</td>
                        <td className={cell}>{r.patrollerName}</td>
                        <td className={num}>{r.duration ?? <span className="text-prix font-extrabold">In progress</span>}</td>
                        <td className={num}>{r.inspections}</td>
                        <td className={num}>{r.photos}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>

          {total > HISTORY_PAGE_SIZE && (
            <nav className="flex items-center justify-between gap-2 mt-3 text-mut text-sm font-bold" aria-label="History pages">
              <button className="btn btn-sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0 || loading}>Newer</button>
              <span className="tabular-nums">{firstRow}–{lastRow} of {total}</span>
              <button className="btn btn-sm" onClick={() => setPage((p) => p + 1)} disabled={lastRow >= total || loading}>Older</button>
            </nav>
          )}
        </>
      )}
    </Screen>
  );
};

/** Route metadata shown above the history table. */
const RouteDetails: React.FC<{ route: PatrolRoute }> = ({ route }) => {
  const hotspots = Array.isArray(route.hotspots) ? route.hotspots : [];
  return (
    <section className="mb-6" aria-label="Route details">
      {route.archived_at && (
        <p className="badge mb-3">Archived {new Date(route.archived_at).toLocaleDateString()}</p>
      )}
      {route.description && <p className="sub">{route.description}</p>}
      <div className="grid grid-cols-1 min-[381px]:grid-cols-3 gap-2">
        {([['Area type', route.area_type], ['Focus', route.focus], ['Start point', route.start_point]] as const).map(([k, v]) => (
          <div key={k} className="bg-sf border border-line rounded-[14px] px-3 py-2.5">
            <small className="block text-mut text-[13px]">{k}</small>
            <b className={`text-sm ${k === 'Area type' ? 'capitalize' : ''}`}>{v || 'Not set'}</b>
          </div>
        ))}
      </div>
      {hotspots.length > 0 && (
        <div className="chips flex flex-wrap gap-2 mt-3">
          {hotspots.map((h) => <span key={h} className="chip pr-3">{h}</span>)}
        </div>
      )}
    </section>
  );
};

export default RouteHistoryPage;
