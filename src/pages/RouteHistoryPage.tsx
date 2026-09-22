import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { fetchRoute, HISTORY_PAGE_SIZE, type RouteHistoryPage as HistoryPage } from '../lib/routesApi';
import type { PatrolRoute } from '../types';
import AdminHeader from '../components/admin/AdminHeader';

const focusRing = 'active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FCCA3B]';
const pagerBtn = `min-h-12 min-w-12 px-3 inline-flex items-center justify-center gap-1 rounded-xl border border-[#2A2A2A] text-sm font-semibold text-white hover:border-[#8F8F8F] disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${focusRing}`;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const RouteHistoryPage: React.FC = () => {
  const { routeId = '' } = useParams<{ routeId: string }>();
  const getRouteHistory = usePatrolStore((s) => s.getRouteHistory);

  const [route, setRoute] = useState<PatrolRoute | null>(null);
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchRoute(routeId).then((r) => { if (live) setRoute(r); }).catch(() => { /* header falls back to "Route" */ });
    return () => { live = false; };
  }, [routeId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await getRouteHistory(routeId, page));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load patrol history.');
    } finally {
      setLoading(false);
    }
  }, [getRouteHistory, routeId, page]);

  useEffect(() => { load(); }, [load]);

  const total = history?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const firstRow = total === 0 ? 0 : page * HISTORY_PAGE_SIZE + 1;
  const lastRow = Math.min(total, (page + 1) * HISTORY_PAGE_SIZE);

  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-12">
      <div className="max-w-4xl mx-auto">
        <AdminHeader
          eyebrow={route ? `Route ${route.code}` : 'Route'}
          title={route?.name ?? 'Patrol history'}
          backTo={route?.archived_at ? '/admin/routes?tab=archived' : '/admin/routes'}
        />

        {route && <RouteDetails route={route} />}

        <section className="px-4 sm:px-6" aria-labelledby="history-heading">
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <h2 id="history-heading" className="text-lg font-black text-white">Patrol history</h2>
            {!loading && !error && total > 0 && (
              <p className="text-xs text-[#8F8F8F] tabular-nums">{firstRow}–{lastRow} of {total}</p>
            )}
          </div>

          {error ? (
            <div className="py-12 flex flex-col items-center gap-4 text-center">
              <p className="text-red-400 text-sm max-w-sm">{error}</p>
              <button onClick={load} className={pagerBtn}><RefreshCw className="w-4 h-4" aria-hidden /> Try again</button>
            </div>
          ) : !loading && total === 0 ? (
            <p className="py-12 text-center text-sm text-[#8F8F8F]">No patrols on this route yet.</p>
          ) : (
            <div className="rounded-2xl border border-[#2A2A2A] overflow-x-auto" aria-busy={loading}>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-[#8F8F8F] border-b border-[#2A2A2A]">
                    <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Start</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Patroller</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Duration</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Inspections</th>
                    <th scope="col" className="px-4 py-3 font-semibold text-right">Photos</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 5 }, (_, i) => (
                        <tr key={i} className={i % 2 ? 'bg-[#1C1C1E]' : 'bg-[#0A0A0A]'}>
                          <td colSpan={6} className="px-4 py-3"><div className="h-5 rounded bg-[#2A2A2A]/60 animate-pulse motion-reduce:animate-none" /></td>
                        </tr>
                      ))
                    : history?.rows.map((r, i) => (
                        <tr
                          key={r.id}
                          className={`${i % 2 ? 'bg-[#1C1C1E]' : 'bg-[#0A0A0A]'} hover:bg-[#FCCA3B]/10 transition-colors`}
                        >
                          <td className="px-4 py-3 text-white whitespace-nowrap">{fmtDate(r.startedAt)}</td>
                          <td className="px-4 py-3 text-white whitespace-nowrap tabular-nums">{fmtTime(r.startedAt)}</td>
                          <td className="px-4 py-3 text-white">{r.patrollerName}</td>
                          <td className="px-4 py-3 text-right text-white whitespace-nowrap tabular-nums">
                            {r.duration ?? <span className="text-[#8F8F8F]">In progress</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-white tabular-nums">{r.inspections}</td>
                          <td className="px-4 py-3 text-right text-white tabular-nums">{r.photos}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}

          {!error && total > HISTORY_PAGE_SIZE && (
            <nav className="mt-4 flex items-center justify-between gap-3" aria-label="History pages">
              <button onClick={() => setPage((p) => p - 1)} disabled={page === 0 || loading} className={pagerBtn}>
                <ChevronLeft className="w-4 h-4" aria-hidden /> Newer
              </button>
              <span className="text-sm text-[#8F8F8F] tabular-nums">Page {page + 1} of {pageCount}</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={page >= pageCount - 1 || loading} className={pagerBtn}>
                Older <ChevronRight className="w-4 h-4" aria-hidden />
              </button>
            </nav>
          )}
        </section>
      </div>
    </div>
  );
};

/** Route metadata shown above the history table. */
const RouteDetails: React.FC<{ route: PatrolRoute }> = ({ route }) => {
  const items: [string, React.ReactNode][] = [
    ['Area type', route.area_type ? <span className="capitalize">{route.area_type}</span> : null],
    ['Focus', route.focus || null],
    ['Start point', route.start_point || null],
  ];
  const hotspots = Array.isArray(route.hotspots) ? route.hotspots : [];
  return (
    <section className="px-4 sm:px-6 mb-8" aria-label="Route details">
      {route.archived_at && (
        <p className="mb-3 inline-flex rounded-full border border-[#2A2A2A] px-3 py-1 text-xs font-semibold text-[#8F8F8F]">
          Archived {new Date(route.archived_at).toLocaleDateString()}
        </p>
      )}
      {route.description && <p className="text-sm text-[#8F8F8F] leading-relaxed mb-4">{route.description}</p>}
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-[#1C1C1E] border border-[#2A2A2A] px-4 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-[#8F8F8F]">{label}</dt>
            <dd className="mt-1 text-sm text-white">{value ?? <span className="text-[#8F8F8F]">Not set</span>}</dd>
          </div>
        ))}
      </dl>
      {hotspots.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8F8F8F] mb-2">Hotspots</p>
          <ul className="flex flex-wrap gap-2">
            {hotspots.map((h) => (
              <li key={h} className="rounded-full border border-[#2A2A2A] px-3 py-1.5 text-sm text-white">{h}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default RouteHistoryPage;
