import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Footprints, Play, Zap } from 'lucide-react';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { useResumePatrol } from '../hooks/useResumePatrol';
import { formatHMM } from '../lib/patrolHistory';
import Screen from '../components/layout/Screen';
import EmptyState, { LoadError } from '../components/ui/EmptyState';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The Patrol tab: the live patrol if one is loaded, otherwise Resume (last 12 h) or an empty state. */
const PatrolTabPage: React.FC = () => {
  const navigate = useNavigate();
  const { sessionId } = usePatrolSession();
  const { lookup, check, resume } = useResumePatrol(sessionId === null);
  const [resuming, setResuming] = useState(false);

  if (sessionId) return <Navigate to={`/patrol/${sessionId}`} replace />;

  return (
    <Screen nav>
      <h1>Patrol</h1>
      <p className="sub">Your live patrol shows here.</p>

      {lookup.status === 'loading' ? (
        <div className="skeleton h-40" aria-busy="true" />
      ) : lookup.status === 'error' ? (
        <LoadError message={lookup.message} onRetry={check} />
      ) : lookup.status === 'found' ? (
        <div className="card">
          <div className="flex items-center justify-between gap-2">
            <span className="badge">{lookup.session.patrol_routes?.code ?? 'Route'}</span>
            <span className="row-meta">Not finished</span>
          </div>
          <div className="row-name mt-1.5">{lookup.session.patrol_routes?.name ?? 'Unknown route'}</div>
          <div className="row-meta">
            Started {fmtTime(lookup.session.started_at)},{' '}
            {formatHMM((Date.now() - Date.parse(lookup.session.started_at)) / 60000)} h ago
          </div>
          <button
            className="btn btn-pri btn-xl btn-full mt-3.5"
            disabled={resuming}
            onClick={async () => { setResuming(true); await resume(lookup.session); }}
          >
            {resuming ? <><span className="spin" aria-hidden />Resuming…</> : <><Play aria-hidden />Resume patrol</>}
          </button>
        </div>
      ) : (
        <EmptyState
          icon={Footprints}
          title="No patrol running"
          body="Start one from Routes. The timer and every sign you log will show up here."
          action={{ label: 'Go to routes', onClick: () => navigate('/routes') }}
        />
      )}

      <button className="btn btn-lg btn-full mt-6" onClick={() => navigate('/quick-catch')}>
        <Zap aria-hidden />Quick Catch
      </button>
    </Screen>
  );
};

export default PatrolTabPage;
