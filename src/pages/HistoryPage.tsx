import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Clock3, Play, Zap } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { useResumePatrol } from '../hooks/useResumePatrol';
import { fetchPatrolHistory, fetchQuickCatches, HISTORY_PAGE_SIZE, type QuickCatchRow } from '../lib/patrolApi';
import { formatHMM, minutesBetween, plural, sessionStatus, sessionTotals, type HistorySessionRow } from '../lib/patrolHistory';
import { getOrgId } from '../lib/routesApi';
import { isAdmin } from '../lib/roles';
import { errorMessage } from '../lib/errors';
import Screen from '../components/layout/Screen';
import EmptyState, { LoadError } from '../components/ui/EmptyState';

type View = 'patrols' | 'catches';

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

type Page<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; rows: T[]; total: number };

const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'catches' ? 'catches' : 'patrols';
  const setView = (v: View) => { setParams(v === 'catches' ? { view: 'catches' } : {}, { replace: true }); setPage(0); };

  const currentUser = usePatrolStore((s) => s.currentUser);
  const admin = isAdmin(currentUser?.role);
  const { sessionId: liveSessionId } = usePatrolSession();
  const { resume } = useResumePatrol(false);

  const [page, setPage] = useState(0);
  const [patrols, setPatrols] = useState<Page<HistorySessionRow>>({ status: 'loading' });
  const [catches, setCatches] = useState<Page<QuickCatchRow>>({ status: 'loading' });
  const [resumingId, setResumingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser || currentUser.role === undefined) return; // wait for the role: it picks the scope
    try {
      if (view === 'patrols') {
        setPatrols({ status: 'loading' });
        const scope = admin ? { kind: 'org' as const, orgId: await getOrgId() } : { kind: 'mine' as const, userId: currentUser.id };
        setPatrols({ status: 'ok', ...(await fetchPatrolHistory(scope, page)) });
      } else {
        setCatches({ status: 'loading' });
        setCatches({ status: 'ok', ...(await fetchQuickCatches(await getOrgId(), page)) });
      }
    } catch (e) {
      const message = errorMessage(e, 'Could not load history.');
      if (view === 'patrols') setPatrols({ status: 'error', message });
      else setCatches({ status: 'error', message });
    }
  }, [currentUser, admin, view, page]);

  useEffect(() => { load(); }, [load]);

  const current = view === 'patrols' ? patrols : catches;
  const total = current.status === 'ok' ? current.total : 0;
  const now = Date.now();

  const patrolCard = (s: HistorySessionRow) => {
    const status = sessionStatus(s, currentUser?.id ?? '', now);
    const t = sessionTotals(s);
    const mins = minutesBetween(s.started_at, s.ended_at);
    const isLive = liveSessionId === s.id;
    return (
      <div key={s.id} className="card">
        <div className="flex items-center justify-between gap-2">
          <span className="badge">{s.patrol_routes?.code ?? 'Route'}</span>
          <span className="row-meta">{fmtWhen(s.started_at)}</span>
        </div>
        <div className="row-name mt-1.5">{s.patrol_routes?.name ?? 'Unknown route'}</div>
        <div className="row-meta">
          {s.patroller_name || 'Unknown patroller'},{' '}
          {status === 'finished'
            ? (mins !== null ? `${formatHMM(mins)} h` : 'duration unknown')
            : <span className="font-extrabold text-prix">{status === 'not_finished' ? 'Not finished' : 'In progress'}</span>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5 text-mut text-sm">
          <span><b className="text-tx">{t.businesses}</b> {plural('business', t.businesses, 'businesses')}</span>
          <span><b className="text-tx">{t.signs}</b> {plural('sign', t.signs)}</span>
          <span><b className="text-tx">{t.photos}</b> {plural('photo', t.photos)}</span>
        </div>
        {status === 'resumable' && (isLive || liveSessionId === null) && (
          <button
            className="btn btn-pri btn-sm btn-full mt-3.5"
            disabled={resumingId !== null}
            onClick={async () => {
              if (isLive) return navigate(`/patrol/${s.id}`);
              setResumingId(s.id);
              await resume(s);
              setResumingId(null);
            }}
          >
            {isLive ? <><ArrowRight aria-hidden />Back to patrol</>
              : resumingId === s.id ? <><span className="spin" aria-hidden />Resuming…</>
              : <><Play aria-hidden />Resume patrol</>}
          </button>
        )}
      </div>
    );
  };

  const catchCard = (c: QuickCatchRow) => (
    <div key={c.id} className="card">
      <div className="flex items-center justify-between gap-2">
        <span className="badge">Quick Catch</span>
        <span className="row-meta">{fmtWhen(c.created_at)}</span>
      </div>
      <div className="row-name mt-1.5">{c.business_name || 'Unnamed business'}</div>
      {(c.sign_type || c.sign_category) && <div className="row-meta">{[c.sign_category, c.sign_type].filter(Boolean).join(', ')}</div>}
      {c.address && <div className="row-meta">{c.address}</div>}
      {c.issue_type && (
        <span className="inline-block mt-2.5 text-[13px] font-bold rounded-lg px-2 py-0.5 text-acc bg-accs">{c.issue_type}</span>
      )}
    </div>
  );

  return (
    <Screen nav>
      <h1>History</h1>
      <p className="sub">
        {view === 'patrols'
          ? admin ? "Your organisation's patrols, newest first." : 'Your patrols, newest first.'
          : "Your organisation's Quick Catches, newest first."}
      </p>

      <div className="seg" role="tablist" aria-label="History type">
        {(['patrols', 'catches'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} aria-pressed={view === v} onClick={() => setView(v)}>
            {v === 'patrols' ? 'Patrols' : 'Quick Catches'}
          </button>
        ))}
      </div>

      <div className="grid gap-2.5 mt-3">
        {current.status === 'loading' ? (
          [0, 1, 2].map((i) => <div key={i} className="skeleton h-32" aria-busy="true" />)
        ) : current.status === 'error' ? (
          <LoadError message={current.message} onRetry={load} />
        ) : view === 'patrols' && patrols.status === 'ok' ? (
          patrols.rows.length ? patrols.rows.map(patrolCard) : (
            <EmptyState
              icon={Clock3}
              title="No patrols yet"
              body="Patrols land here with their time, signs and photos once they're started."
              action={{ label: 'Go to routes', onClick: () => navigate('/routes') }}
            />
          )
        ) : catches.status === 'ok' && catches.rows.length ? catches.rows.map(catchCard) : (
          <EmptyState
            icon={Zap}
            title="No Quick Catches yet"
            body="Signs logged with Quick Catch, outside a patrol, show up here."
            action={{ label: 'Log a Quick Catch', onClick: () => navigate('/quick-catch') }}
          />
        )}
      </div>

      {current.status === 'ok' && total > HISTORY_PAGE_SIZE && (
        <nav className="flex items-center justify-between gap-2 mt-3 text-mut text-sm font-bold" aria-label="History pages">
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</button>
          <span className="tabular-nums">
            {page * HISTORY_PAGE_SIZE + 1}–{Math.min(total, (page + 1) * HISTORY_PAGE_SIZE)} of {total}
          </span>
          <button className="btn btn-sm" disabled={(page + 1) * HISTORY_PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Older</button>
        </nav>
      )}
    </Screen>
  );
};

export default HistoryPage;
