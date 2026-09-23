import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Map as MapIcon, Search, SearchX, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchLastPatrolled } from '../lib/patrolApi';
import { getOrgId } from '../lib/routesApi';
import { lastPatrolLabel } from '../lib/patrolHistory';
import { errorMessage } from '../lib/errors';
import type { PatrolRoute } from '../types';
import Screen from '../components/layout/Screen';
import EmptyState, { LoadError } from '../components/ui/EmptyState';

const RoutesPage: React.FC = () => {
  const navigate = useNavigate();
  const [routes, setRoutes] = useState<PatrolRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // route id -> last session start. Absent until loaded; if it fails, cards just omit it.
  const [lastPatrol, setLastPatrol] = useState<Map<string, string | null> | null>(null);
  const [lastPatrolError, setLastPatrolError] = useState<string | null>(null);

  const fetchRoutes = async () => {
    setLoading(true);
    setError(null);
    try {
      // Archived routes are hidden from patrollers; admins manage them under /admin/routes.
      const { data, error } = await supabase
        .from('patrol_routes')
        .select('*')
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      setRoutes((data || []) as PatrolRoute[]);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load routes'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRoutes(); }, []);

  useEffect(() => {
    let live = true;
    getOrgId()
      .then(fetchLastPatrolled)
      .then((m) => { if (live) setLastPatrol(m); })
      .catch((e) => { if (live) setLastPatrolError(errorMessage(e, 'Last patrol dates are unavailable.')); });
    return () => { live = false; };
  }, []);

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => routes.filter((r) => `${r.name} ${r.code}`.toLowerCase().includes(q)),
    [routes, q],
  );
  const now = Date.now();

  const meta = (r: PatrolRoute) => {
    const n = Array.isArray(r.hotspots) ? r.hotspots.length : 0;
    const hot = `${n} hotspot${n === 1 ? '' : 's'}`;
    return lastPatrol ? `${hot}, ${lastPatrolLabel(lastPatrol.get(r.id) ?? null, now)}` : hot;
  };

  return (
    <Screen nav>
      <h1>Routes</h1>
      <p className="sub">Pick a loop to start patrolling.</p>

      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-mut" aria-hidden />
        <input
          type="search"
          className="input pl-11"
          placeholder="Search by name or code"
          aria-label="Search routes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid gap-2.5" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[72px]" />)}
        </div>
      ) : error ? (
        <LoadError message={error} onRetry={fetchRoutes} />
      ) : visible.length > 0 ? (
        <div className="grid gap-2.5">
          {lastPatrolError && <p className="field-hint mt-0" role="status">Last patrol dates unavailable: {lastPatrolError}</p>}
          {visible.map((r) => (
            <button key={r.id} className="rowcard" onClick={() => navigate(`/route/${r.id}`)}>
              <span className="badge">{r.code}</span>
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="row-name">{r.name}</span>
                <span className="row-meta">{meta(r)}</span>
              </span>
              <ChevronRight className="w-5 h-5 text-mut flex-none" aria-hidden />
            </button>
          ))}
        </div>
      ) : q ? (
        <EmptyState icon={SearchX} title="No routes match" body={`Nothing matches "${search.trim()}". Try a code like DT-01.`} />
      ) : (
        <EmptyState icon={MapIcon} title="No routes yet" body="An admin adds routes from the Admin tab. They show up here for everyone." />
      )}

      <button className="btn btn-lg btn-full mt-6" onClick={() => navigate('/quick-catch')}>
        <Zap aria-hidden />Quick Catch
      </button>
      <p className="field-hint text-center">Spotted a sign off-route? Log it without starting a patrol.</p>
    </Screen>
  );
};

export default RoutesPage;
