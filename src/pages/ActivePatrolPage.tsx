import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { usePatrolStore } from '../store/patrol.store';
import { supabase } from '../lib/supabase';
import { cls } from '../lib/ui';
import TimerBar from '../components/layout/TimerBar';
import { Plus } from 'lucide-react';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const ActivePatrolPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { elapsedSeconds, endSession } = usePatrolSession();
  const { clearActiveSession, routes, activeRouteId } = usePatrolStore();
  const [showConfirm, setShowConfirm] = useState(false);
  const [signsLogged, setSignsLogged] = useState(0);
  const [issuesFound, setIssuesFound] = useState(0);

  const route = (routes || []).find(r => r.id === activeRouteId);

  useEffect(() => {
    if (!sessionId) return;
    const fetchStats = async () => {
      const { data: bizData } = await supabase
        .from('patrol_businesses')
        .select('id')
        .eq('session_id', sessionId);

      const bizIds = (bizData || []).map((b: { id: string }) => b.id);
      if (bizIds.length === 0) return;

      const { data: inspData } = await supabase
        .from('sign_inspections')
        .select('id, condition_rating')
        .in('business_id', bizIds);

      setSignsLogged((inspData || []).length);
      setIssuesFound(
        (inspData || []).filter(i => i.condition_rating !== 'excellent').length
      );
    };
    fetchStats();
  }, [sessionId, location.key]);

  const handleEndPatrol = async () => {
    await supabase
      .from('patrol_sessions')
      .update({ ended_at: new Date().toISOString(), is_complete: true })
      .eq('id', sessionId);
    endSession();
    clearActiveSession();
    navigate('/routes');
  };

  const stats = [
    { label: 'Signs logged', value: String(signsLogged) },
    { label: 'Issues found', value: String(issuesFound) },
    { label: 'Duration',     value: formatDuration(elapsedSeconds) },
  ];

  return (
    <div className={`min-h-screen bg-[#0A0A0A] flex flex-col`}>
      <TimerBar
        showBack={false}
        showCancel={true}
        onCancel={() => setShowConfirm(true)}
      />

      {/* Header */}
      <div className="px-5 pt-20 pb-2">
        <p className="text-xs tracking-widest text-[#FCCA3B] uppercase mb-1">
          {route?.name ?? 'Active Patrol'}
        </p>
        <h1 className="font-black text-4xl text-white leading-tight">Patrol Active</h1>
        <p className="text-[#8F8F8F] text-sm mt-1">Tap below to inspect a sign</p>
      </div>

      {/* Inspect CTA card */}
      <button
        onClick={() => navigate(`/add-business/${sessionId}`)}
        className="bg-[#1C1C1E] border-2 border-[#2A2A2A] rounded-3xl p-10 mx-5 mt-8 flex flex-col items-center cursor-pointer hover:border-[#FCCA3B] transition-colors active:scale-[0.98]"
      >
        <Plus className="w-16 h-16 text-[#FCCA3B]" strokeWidth={1.5} />
        <p className="text-white font-bold text-xl mt-4">Inspect a Sign</p>
        <p className="text-[#8F8F8F] text-sm mt-1">Log business + photos + issues</p>
      </button>

      {/* Stats row */}
      <div className="flex gap-3 px-5 mt-6">
        {stats.map(stat => (
          <div
            key={stat.label}
            className="flex-1 bg-[#1C1C1E] rounded-2xl p-4 flex flex-col items-center"
          >
            <span className="text-white font-black text-3xl leading-none">{stat.value}</span>
            <span className="text-[#8F8F8F] text-xs tracking-wide uppercase mt-1 text-center leading-tight">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* End patrol confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center px-4 z-50">
          <div className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-3xl p-6 w-full max-w-sm">
            <h2 className="text-white font-black text-xl mb-2">End Patrol?</h2>
            <p className="text-[#8F8F8F] text-sm mb-6">
              Timer will stop and session will be closed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 border border-[#2A2A2A] text-white font-semibold rounded-xl hover:bg-[#2A2A2A] transition-colors"
              >
                Keep Going
              </button>
              <button
                onClick={handleEndPatrol}
                className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition-colors"
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivePatrolPage;
