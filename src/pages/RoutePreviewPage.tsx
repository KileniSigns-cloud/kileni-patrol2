import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePatrolStore } from '../store/patrol.store';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { supabase } from '../lib/supabase';
import { cls } from '../lib/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const RoutePreviewPage: React.FC = () => {
  const { routeId } = useParams<{ routeId: string }>();
  const navigate = useNavigate();
  const { routes, currentUser, setActiveSession } = usePatrolStore();
  const { startSession } = usePatrolSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = (routes || []).find(r => r.id === routeId);

  if (!route) return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-4">
      <p className="text-[#8F8F8F]">Route not found.</p>
      <button onClick={() => navigate('/routes')} className="text-[#FCCA3B] text-sm underline">
        Back to Routes
      </button>
    </div>
  );

  const handleStartPatrol = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
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
      setError('Failed to start patrol. Please try again.');
      setLoading(false);
      return;
    }
    setActiveSession(data.id, route.id);
    startSession(data.id, route.id, route.name);
    navigate(`/patrol/${data.id}`);
  };

  const badge = (route.code ?? route.name ?? '').slice(0, 2).toUpperCase();

  return (
    <div className="bg-[#0A0A0A] min-h-screen pb-32">
      {/* Back button */}
      <button
        onClick={() => navigate('/routes')}
        className="flex items-center gap-1 text-[#8F8F8F] text-sm pt-12 px-5"
      >
        <ChevronLeft className="w-5 h-5" /> Routes
      </button>

      {/* Route badge pill */}
      <span className="bg-[#FCCA3B] text-black font-black text-xs tracking-widest px-4 py-1.5 rounded-full inline-block mt-8 mx-5">
        {badge}
      </span>

      {/* Title */}
      <h1 className="px-5 text-4xl font-black text-white mt-3 leading-tight">{route.name}</h1>

      {/* Description */}
      {route.description && (
        <p className="px-5 text-[#8F8F8F] text-sm mt-2 leading-relaxed">{route.description}</p>
      )}

      {/* Info cards row */}
      <div className="flex gap-3 px-5 mt-6">
        <div className="flex-1 bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-4">
          <p className="text-[#8F8F8F] text-xs tracking-widest uppercase mb-1">Area</p>
          <p className="text-white font-semibold text-sm">{route.area_type || '—'}</p>
        </div>
        <div className="flex-1 bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-4">
          <p className="text-[#8F8F8F] text-xs tracking-widest uppercase mb-1">Focus</p>
          <p className="text-white font-semibold text-sm">{route.focus || '—'}</p>
        </div>
        <div className="flex-1 bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-4">
          <p className="text-[#8F8F8F] text-xs tracking-widest uppercase mb-1">Start</p>
          <p className="text-white font-semibold text-sm truncate">{route.start_point || '—'}</p>
        </div>
      </div>

      {/* Hotspots */}
      {Array.isArray(route.hotspots) && route.hotspots.length > 0 && (
        <div className="mt-6 mx-5 bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-4">
          <p className="text-[#8F8F8F] text-xs tracking-widest uppercase mb-3">Hotspots</p>
          <div className="space-y-2">
            {route.hotspots.map((spot: string, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#FCCA3B] flex-shrink-0" />
                <span className="text-white text-sm">{spot}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="text-red-500 text-sm mt-4 px-5">{error}</p>
      )}

      {/* Start Patrol button */}
      <div className="fixed bottom-6 left-5 right-5">
        <button
          onClick={handleStartPatrol}
          disabled={loading}
          className={cls.btnPrimary}
        >
          {loading ? 'Starting…' : <span className="flex items-center justify-center gap-1.5">Start Patrol <ChevronRight className="w-5 h-5" /></span>}
        </button>
      </div>
    </div>
  );
};

export default RoutePreviewPage;
