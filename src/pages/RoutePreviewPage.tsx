import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ChevronLeft, MapPin, Play } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { supabase } from '../lib/supabase';
import type { PatrolRoute } from '../types';
import Screen from '../components/layout/Screen';
import FlowFooter from '../components/flow/FlowFooter';
import { LoadError } from '../components/ui/EmptyState';

const RoutePreviewPage: React.FC = () => {
  const { routeId } = useParams<{ routeId: string }>();
  const navigate = useNavigate();
  const { currentUser, setActiveSession } = usePatrolStore();
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
        if (err || !data) {
          setError('Route not found.');
        } else {
          setRoute(data as PatrolRoute);
        }
        setLoading(false);
      });
  }, [routeId, reload]);

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
        <button className="linkb -ml-1" onClick={() => navigate('/routes')}><ChevronLeft aria-hidden />Routes</button>
        <LoadError message={error ?? 'Route not found.'} onRetry={() => setReload((n) => n + 1)} />
      </Screen>
    );
  }

  const mine = liveSessionId !== null && liveRouteId === route.id;
  const busyElsewhere = liveSessionId !== null && !mine;
  const hotspots = Array.isArray(route.hotspots) ? route.hotspots : [];

  return (
    <Screen
      footer={
        <FlowFooter
          hint={busyElsewhere ? `You're patrolling ${liveRouteCode ?? 'another route'} right now. End that patrol first.` : startError}
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
      <button className="linkb -ml-1" onClick={() => navigate('/routes')}><ChevronLeft aria-hidden />Routes</button>
      <div><span className="badge">{route.code}</span></div>
      <h1>{route.name}</h1>
      {route.description && <p className="sub">{route.description}</p>}

      <div className="grid grid-cols-1 min-[381px]:grid-cols-3 gap-2 my-4">
        {([['Start point', route.start_point], ['Area', route.area_type], ['Focus', route.focus]] as const).map(([k, v]) => (
          <div key={k} className="bg-sf border border-line rounded-[14px] px-3 py-2.5">
            <small className="block text-mut text-[13px]">{k}</small>
            <b className={`text-sm ${k === 'Area' ? 'capitalize' : ''}`}>{v || 'Not set'}</b>
          </div>
        ))}
      </div>

      <h2 className="section-title">Hotspots</h2>
      {hotspots.length > 0 ? (
        <ul className="list-none p-0 m-0 grid gap-2">
          {hotspots.map((spot, i) => (
            <li key={`${spot}-${i}`} className="flex gap-2.5 items-center bg-sf border border-line rounded-[14px] px-3.5 py-3 font-bold">
              <MapPin className="w-5 h-5 text-acc flex-none" aria-hidden />{spot}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sub">No hotspots on this route. Log any sign you spot along the way.</p>
      )}
    </Screen>
  );
};

export default RoutePreviewPage;
