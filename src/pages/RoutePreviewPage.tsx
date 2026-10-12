import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft, Play } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { supabase } from '../lib/supabase';
import { findCachedZone } from '../lib/zoneCache';
import type { PatrolRoute } from '../types';
import Screen from '../components/layout/Screen';
import FlowFooter from '../components/flow/FlowFooter';
import { LoadError } from '../components/ui/EmptyState';
import ZoneInfo from '../components/zone/ZoneInfo';

const RoutePreviewPage: React.FC = () => {
  const { routeId } = useParams<{ routeId: string }>();
  const navigate = useNavigate();
  const { currentUser, setActiveSession } = usePatrolStore();
  const orgId = currentUser?.organisation_id ?? null;
  const { startSession, sessionId: liveSessionId, routeId: liveRouteId, routeCode: liveRouteCode } = usePatrolSession();

  const [route, setRoute] = useState<PatrolRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!routeId) return;
    setLoading(true);
    setError(null);
    supabase
      .from('patrol_routes')
      .select('*')
      .eq('id', routeId)
      .single()
      .then(({ data, error: err }) => {
        if (data && !err) {
          setRoute(data as PatrolRoute);
        } else {
          // PGRST116: the zone no longer exists. Any other failure is a connection problem,
          // so use the copy saved when the Zones list last loaded.
          const gone = !err || err.code === 'PGRST116';
          const saved = !gone && orgId ? findCachedZone(localStorage, orgId, routeId) : null;
          if (saved) setRoute(saved);
          else setError(gone ? 'Zone not found.' : 'No connection, and this zone is not saved on this phone yet. Open the Zones list once with a connection.');
        }
        setLoading(false);
      });
  }, [routeId, reload, orgId]);

  const handleStartPatrol = async () => {
    if (!currentUser || !route) return;
    setStarting(true);
    setStartError(null);
    const { data, error: dbError } = await supabase
      .from('patrol_sessions')
      .insert({
        route_id: route.id,
        patroller_id: currentUser.id,
        patroller_name: currentUser.name ?? currentUser.email,
        started_at: new Date().toISOString(),
        is_complete: false,
      })
      .select()
      .single();

    if (dbError || !data) {
      setStartError('Failed to start patrol. Please try again.');
      setStarting(false);
      return;
    }
    setActiveSession(data.id, route.id);
    startSession(data.id, route.id, route.name, { routeCode: route.code, startedAt: data.started_at });
    navigate(`/patrol/${data.id}`);
  };

  if (loading) {
    return (
      <Screen>
        <div className="skeleton h-8 w-24 mt-4" />
        <div className="skeleton h-10 mt-3" />
        <div className="skeleton h-24 mt-4" />
      </Screen>
    );
  }

  if (error || !route) {
    return (
      <Screen nav>
        <button className="linkb -ml-1" onClick={() => navigate('/routes')}><ChevronLeft aria-hidden />Zones</button>
        <LoadError message={error ?? 'Zone not found.'} onRetry={() => setReload((n) => n + 1)} />
      </Screen>
    );
  }

  const mine = liveSessionId !== null && liveRouteId === route.id;
  const busyElsewhere = liveSessionId !== null && !mine;

  return (
    <Screen
      footer={
        <FlowFooter
          hint={busyElsewhere ? `You're patrolling ${liveRouteCode ?? 'another zone'} right now. End that patrol first.` : startError}
        >
          <button
            className="btn btn-pri btn-xl btn-full"
            disabled={busyElsewhere || starting}
            onClick={mine ? () => navigate(`/patrol/${liveSessionId}`) : handleStartPatrol}
          >
            {starting ? <><span className="spin" aria-hidden />Starting…</>
              : mine ? <><ArrowRight aria-hidden />Back to patrol</>
              : <><Play aria-hidden />Start patrol</>}
          </button>
        </FlowFooter>
      }
    >
      <button className="linkb -ml-1" onClick={() => navigate('/routes')}><ChevronLeft aria-hidden />Zones</button>
      <ZoneInfo zone={route} titleAs="h1" />
    </Screen>
  );
};

export default RoutePreviewPage;
