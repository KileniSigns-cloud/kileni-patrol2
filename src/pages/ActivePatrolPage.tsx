import React, { useState, useEffect } from 'react';
import { Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Plus, Square, Store, Zap } from 'lucide-react';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { usePatrolStore } from '../store/patrol.store';
import { supabase } from '../lib/supabase';
import { countSessionPhotos } from '../lib/patrolApi';
import { errorMessage } from '../lib/errors';
import type { LoggedBusiness } from '../lib/signFlow';
import Screen from '../components/layout/Screen';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/Toast';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const coords = (b: LoggedBusiness) =>
  b.lat !== null && b.lng !== null ? `${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}` : 'No location';

const ActivePatrolPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    sessionId: liveSessionId, routeName, routeCode, sessionStartedAt,
    loggedBusinesses, startSignAtBusiness, resetInspection, endSession,
  } = usePatrolSession();
  const { clearActiveSession } = usePatrolStore();
  const [showConfirm, setShowConfirm] = useState(false);
  const [ending, setEnding] = useState(false);
  const [stats, setStats] = useState<{ businesses: number; signs: number; photos: number } | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || liveSessionId !== sessionId) return;
    const fetchStats = async () => {
      setStatsError(null);
      try {
        const { data: bizData, error: bizError } = await supabase
          .from('patrol_businesses')
          .select('id')
          .eq('session_id', sessionId);
        if (bizError) throw bizError;

        const bizIds = (bizData || []).map((b: { id: string }) => b.id);
        if (bizIds.length === 0) { setStats({ businesses: 0, signs: 0, photos: 0 }); return; }

        const { data: inspData, error: inspError } = await supabase
          .from('sign_inspections')
          .select('id, condition_rating')
          .in('business_id', bizIds);
        if (inspError) throw inspError;

        const photos = await countSessionPhotos(bizIds);
        setStats({ businesses: bizIds.length, signs: (inspData || []).length, photos });
      } catch (e) {
        setStatsError(errorMessage(e, 'Could not load patrol totals.'));
      }
    };
    fetchStats();
  }, [sessionId, liveSessionId, location.key]);

  // Reached by URL without the session loaded (e.g. after a refresh): the Patrol tab offers Resume.
  if (!sessionId || liveSessionId !== sessionId) return <Navigate to="/patrol" replace />;

  const handleEndPatrol = async () => {
    setEnding(true);
    const { error } = await supabase
      .from('patrol_sessions')
      .update({ ended_at: new Date().toISOString(), is_complete: true })
      .eq('id', sessionId);
    if (error) {
      toast.error(`Could not end the patrol: ${error.message}`);
      setEnding(false);
      return;
    }
    endSession();
    clearActiveSession();
    toast.success('Patrol saved to History');
    navigate('/history');
  };

  const logAt = (b: LoggedBusiness) => {
    startSignAtBusiness(b);
    navigate(`/photos/${sessionId}`);
  };

  // A new business starts clean: the previous sign's issues, notes and sign type don't carry over.
  const addBusiness = () => {
    resetInspection();
    navigate(`/add-business/${sessionId}`);
  };

  const signs = stats?.signs ?? 0;
  const biz = stats?.businesses ?? 0;

  return (
    <Screen nav>
      <span className="badge">{routeCode ?? 'Route'}</span>
      <h1>{routeName ?? 'Active patrol'}</h1>
      {sessionStartedAt && (
        <p className="sub">Started at {new Date(sessionStartedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
      )}

      <div className="grid grid-cols-3 gap-2 my-4" aria-busy={stats === null && !statsError}>
        {([['Businesses', stats?.businesses], ['Signs', stats?.signs], ['Photos', stats?.photos]] as const).map(([label, n]) => (
          <div key={label} className="stat"><b>{n ?? '–'}</b><small>{label}</small></div>
        ))}
      </div>
      {statsError && <p className="field-err -mt-2 mb-3" role="alert">{statsError}</p>}

      <button className="btn btn-pri btn-xl btn-full" onClick={addBusiness}>
        <Plus aria-hidden />Add business
      </button>

      <h2 className="section-title">Logged on this patrol</h2>
      {loggedBusinesses.length > 0 ? (
        <>
          <div className="grid gap-2.5">
            {loggedBusinesses.map((b) => (
              <button key={b.id} className="rowcard" onClick={() => logAt(b)} aria-label={`Log another sign at ${b.name || 'unnamed business'}`}>
                <span className="icon-tile"><Store aria-hidden /></span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="row-name truncate">{b.name || 'Unnamed business'}</span>
                  <span className="row-meta">{b.address || coords(b)}, {plural(b.signs, 'sign')}</span>
                </span>
                <Plus className="w-[22px] h-[22px] text-prix flex-none" aria-hidden />
              </button>
            ))}
          </div>
          <p className="field-hint">Tap a business to log another sign there.</p>
        </>
      ) : (
        <EmptyState icon={Store} title="No businesses yet" body="Tap Add business when you reach a sign worth logging." />
      )}

      <button className="btn btn-lg btn-full mt-6" onClick={() => navigate('/quick-catch')}>
        <Zap aria-hidden />Quick Catch
      </button>
      <button className="btn btn-dt btn-full mt-3" onClick={() => setShowConfirm(true)}>
        <Square aria-hidden />End patrol
      </button>

      <ConfirmDialog
        open={showConfirm}
        danger
        busy={ending}
        title="End patrol?"
        message={`You logged ${plural(signs, 'sign')} at ${plural(biz, 'business', 'businesses')}. The timer stops and the patrol moves to History.`}
        confirmLabel="End patrol"
        onConfirm={handleEndPatrol}
        onCancel={() => setShowConfirm(false)}
      />
    </Screen>
  );
};

export default ActivePatrolPage;
