import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Map as MapIcon, Search, SearchX, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchLastPatrolled } from '../lib/patrolApi';
import { getOrgId } from '../lib/routesApi';
import { lastPatrolLabel } from '../lib/patrolHistory';
import { cornersBadge } from '../lib/zoneInfo';
import { errorMessage } from '../lib/errors';
import { loadZoneCache, saveZoneCache, savedAtLabel } from '../lib/zoneCache';
import { usePatrolStore } from '../store/patrol.store';
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
  const orgId = usePatrolStore((s) => s.currentUser?.organisation_id) ?? null;
  // Set when the list came from the copy saved on this phone instead of the server.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The organisation id arrives a moment after sign-in, so read it when needed, not when the page opened.
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;
  // The newest list loaded from the server, kept until it has been saved for offline use.
  const unsaved = useRef<PatrolRoute[] | null>(null);

  const fetchRoutes = async () => {
    setLoading(true);
    setError(null);
    try {
      // Retired zones are hidden from patrollers; admins manage them under /admin/routes.
      const { data, error } = await supabase
        .from('patrol_routes')
        .select('*')
        .is('archived_at', null)
        .order('name');
      if (error) throw error;
      const list = (data || []) as PatrolRoute[];
      setRoutes(list);
      setSavedAt(null);
      unsaved.current = list;
      if (orgIdRef.current && saveZoneCache(localStorage, orgIdRef.current, list, new Date().toISOString())) unsaved.current = null;
    } catch (err) {
      // No signal, or the server is down: use the zones saved on this phone, and say so.
      const org = orgIdRef.current;
      const saved = org ? loadZoneCache(localStorage, org) : null;
      if (saved && saved.routes.length > 0) {
        setRoutes(saved.routes);
        setSavedAt(saved.savedAt);
      } else {
        setError(errorMessage(err, 'Failed to load zones'));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRoutes(); }, []);

  // The list loaded before the organisation id was known: save it as soon as the id arrives.
  useEffect(() => {
    if (orgId && unsaved.current && saveZoneCache(localStorage, orgId, unsaved.current, new Date().toISOString())) {
      unsaved.current = null;
    }
  }, [orgId]);

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
    const corners = cornersBadge(r.corners);
    return lastPatrol ? `${corners}, ${lastPatrolLabel(lastPatrol.get(r.id) ?? null, now)}` : corners;
  };

  return (
    <Screen nav>
      <h1>Zones</h1>
      <p className="sub">Pick a zone to start patrolling.</p>

      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-mut" aria-hidden />
        <input
          type="search"
          className="input pl-11"
          placeholder="Search by name or code"
          aria-label="Search zones"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!loading && savedAt && (
        <div className="grid gap-2 mb-4">
          <p className="field-hint mt-0" role="status">
            No connection. Showing the zones saved on this phone ({savedAtLabel(savedAt)}). Last patrol dates are unavailable.
          </p>
          <button className="btn" onClick={fetchRoutes}>Try again</button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-2.5" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[72px]" />)}
        </div>
      ) : error ? (
        <LoadError message={error} onRetry={fetchRoutes} />
      ) : visible.length > 0 ? (
        <div className="grid gap-2.5">
          {!savedAt && lastPatrolError && <p className="field-hint mt-0" role="status">Last patrol dates unavailable: {lastPatrolError}</p>}
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
        <EmptyState icon={SearchX} title="No zones match" body={`Nothing matches "${search.trim()}". Try a code like DT-01.`} />
      ) : (
        <EmptyState icon={MapIcon} title="No zones yet" body="An admin adds zones from the Admin tab. They show up here for everyone." />
      )}

      <button className="btn btn-lg btn-full mt-6" onClick={() => navigate('/quick-catch')}>
        <Zap aria-hidden />Quick Catch
      </button>
      <p className="field-hint text-center">Spotted a sign outside a zone? Log it without starting a patrol.</p>
    </Screen>
  );
};

export default RoutesPage;
