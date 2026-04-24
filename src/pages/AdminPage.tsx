import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { usePatrolStore } from '../store/patrol.store';
import { cls } from '../lib/ui';
import BottomNav from '../components/layout/BottomNav';

type TabType = 'sessions' | 'catches';
type DateFilter = 'today' | 'week' | 'all';

interface Session {
  id: string;
  patroller_name: string;
  started_at: string;
  ended_at: string | null;
  is_complete: boolean;
  patrol_routes: { name: string } | null;
}

interface QuickCatch {
  id: string;
  business_name: string;
  sign_type: string | null;
  issue_type: string | null;
  created_at: string;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function applyDateFilter<T extends { started_at?: string; created_at?: string }>(
  items: T[],
  key: 'started_at' | 'created_at',
  filter: DateFilter,
): T[] {
  if (filter === 'all') return items;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return items.filter(item => {
    const d = new Date(item[key] as string);
    if (filter === 'today') return d.toDateString() === now.toDateString();
    return d >= weekAgo;
  });
}

const AdminPage: React.FC = () => {
  const { currentUser } = usePatrolStore();
  const [activeTab, setActiveTab] = useState<TabType>('sessions');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [catches, setCatches] = useState<QuickCatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const [sessRes, catchRes] = await Promise.all([
        supabase
          .from('patrol_sessions')
          .select('id, patroller_name, started_at, ended_at, is_complete, patrol_routes(name)')
          .eq('patroller_id', currentUser.id)
          .order('started_at', { ascending: false })
          .limit(50),
        supabase
          .from('leads')
          .select('id, business_name, sign_type, issue_type, created_at')
          .eq('source', 'PATROL_QUICK_CATCH')
          .eq('organisation_id', currentUser.organisation_id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (sessRes.error) throw sessRes.error;
      if (catchRes.error) throw catchRes.error;
      setSessions((sessRes.data ?? []) as Session[]);
      setCatches(catchRes.data ?? []);
    } catch (e: any) {
      setError(e?.message ?? e?.details ?? JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { load(); }, [load]);

  const filteredSessions = applyDateFilter(sessions, 'started_at', dateFilter);
  const filteredCatches = applyDateFilter(catches, 'created_at', dateFilter);

  const tabTitle = activeTab === 'sessions' ? 'Sessions' : 'Quick Catches';

  // ── Tab button ──────────────────────────────────────────────────────────────
  const TabBtn = ({ tab, label }: { tab: TabType; label: string }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors ${
        activeTab === tab
          ? 'bg-[#FCCA3B] text-black'
          : 'border border-[#2A2A2A] text-[#8F8F8F] hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  // ── Date pill ───────────────────────────────────────────────────────────────
  const DatePill = ({ v, label }: { v: DateFilter; label: string }) => (
    <button
      onClick={() => setDateFilter(v)}
      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
        dateFilter === v
          ? 'bg-[#FCCA3B] text-black'
          : 'border border-[#2A2A2A] text-[#8F8F8F] hover:text-white'
      }`}
    >
      {label}
    </button>
  );

  // ── Loading skeletons ───────────────────────────────────────────────────────
  const Skeletons = () => (
    <div className="px-5 flex flex-col gap-3">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-20 bg-[#1C1C1E] rounded-2xl animate-pulse" />
      ))}
    </div>
  );

  // ── Empty state ─────────────────────────────────────────────────────────────
  const EmptyState = ({ icon, message }: { icon: string; message: string }) => (
    <div className="flex flex-col items-center justify-center py-24 px-8 text-center gap-4">
      <span className="text-5xl">{icon}</span>
      <p className="text-white font-black text-xl">No {message} found</p>
      <p className={cls.muted}>
        {message === 'sessions'
          ? 'Your patrol sessions will appear here.'
          : 'Quick Catch leads will appear here.'}
      </p>
    </div>
  );

  return (
    <div className="bg-[#0A0A0A] min-h-screen pb-20">

      {/* Header */}
      <div className="px-5 pt-14 pb-5 flex items-end justify-between">
        <div>
          <p className={`${cls.stepHeader} mb-1`}>Admin</p>
          <h1 className="text-3xl font-black text-white">{tabTitle}</h1>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="w-10 h-10 flex items-center justify-center text-[#8F8F8F] hover:text-white transition-colors rounded-full hover:bg-[#1C1C1E]"
        >
          <span className={loading ? 'animate-spin inline-block text-lg' : 'text-lg'}>↻</span>
        </button>
      </div>

      {/* Tab row */}
      <div className="px-5 pb-5 flex gap-2">
        <TabBtn tab="sessions" label="Sessions" />
        <TabBtn tab="catches" label="Quick Catches" />
      </div>

      {/* Date filter — sessions only */}
      {activeTab === 'sessions' && (
        <div className="px-5 pb-5 flex gap-2">
          <DatePill v="today" label="Today" />
          <DatePill v="week" label="This week" />
          <DatePill v="all" label="All time" />
        </div>
      )}

      {error && (
        <div className="mx-5 mb-4 bg-red-900/30 border border-red-500/40 text-red-400 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Sessions tab ──────────────────────────────────────────────────── */}
      {activeTab === 'sessions' && (
        <>
          {loading && <Skeletons />}

          {!loading && filteredSessions.length === 0 && (
            <EmptyState icon="🗺" message="sessions" />
          )}

          {!loading && filteredSessions.length > 0 && (
            <div className="px-5 flex flex-col gap-3">
              {filteredSessions.map(sess => {
                const routeName = sess.patrol_routes?.name ?? 'Unknown Route';
                return (
                  <div key={sess.id} className={`${cls.card} p-4`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <p className="text-white font-black text-sm leading-snug flex-1 truncate">
                        {routeName}
                      </p>
                      {sess.is_complete ? (
                        <span className="flex-shrink-0 text-[10px] font-black tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">
                          Completed
                        </span>
                      ) : (
                        <span className="flex-shrink-0 flex items-center gap-1 text-[10px] font-black tracking-widest px-2.5 py-1 rounded-full bg-[#FCCA3B]/10 text-[#FCCA3B] border border-[#FCCA3B]/20 uppercase">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#FCCA3B] animate-pulse" />
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={cls.muted}>{fmtDateTime(sess.started_at)}</span>
                      <span className={`${cls.muted} font-semibold`}>
                        {fmtDuration(sess.started_at, sess.ended_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Quick Catches tab ─────────────────────────────────────────────── */}
      {activeTab === 'catches' && (
        <>
          {loading && <Skeletons />}

          {!loading && filteredCatches.length === 0 && (
            <EmptyState icon="⚡" message="quick catches" />
          )}

          {!loading && filteredCatches.length > 0 && (
            <div className="px-5 flex flex-col gap-3">
              {filteredCatches.map(c => (
                <div key={c.id} className={`${cls.card} p-4`}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-black text-sm truncate">{c.business_name || '—'}</p>
                      {c.sign_type && (
                        <p className={`${cls.muted} mt-0.5`}>{c.sign_type}</p>
                      )}
                    </div>
                    {c.issue_type && (
                      <span className="flex-shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#FCCA3B]/10 text-[#FCCA3B] border border-[#FCCA3B]/20 text-right max-w-[120px] truncate">
                        {c.issue_type}
                      </span>
                    )}
                  </div>
                  <span className={cls.muted}>{fmtDateTime(c.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <BottomNav />
    </div>
  );
};

export default AdminPage;
