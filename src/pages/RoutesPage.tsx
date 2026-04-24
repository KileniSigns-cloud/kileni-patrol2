import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { usePatrolStore } from '../store/patrol.store';
import BottomNav from '../components/layout/BottomNav';

const todayLabel = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

const RoutesPage: React.FC = () => {
  const navigate = useNavigate();
  const { logout } = usePatrolStore();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchRoutes = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('patrol_routes')
        .select('*')
        .order('name');
      if (error) throw error;
      setRoutes(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load routes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRoutes(); }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const q = search.toLowerCase();

  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-20">

      {/* Header */}
      <div className="relative px-5 pt-12 pb-6">
        <p className="text-xs tracking-widest text-[#FCCA3B]">KILENI SIGNS</p>
        <h1 className="text-4xl font-black text-white mt-1">Your Routes</h1>
        <p className="text-sm text-[#8F8F8F] mt-1">{todayLabel}</p>
        <button
          onClick={handleLogout}
          className="absolute top-12 right-5 border border-[#2A2A2A] rounded-full px-3 py-1 text-xs text-[#8F8F8F]"
        >
          Sign out
        </button>
      </div>

      {/* Search */}
      <div className="mb-5 mx-5">
        <div className="flex items-center gap-3 bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl px-4 py-3 focus-within:border-[#FCCA3B] transition-colors">
          <span className="text-base leading-none flex-shrink-0">🔍</span>
          <input
            type="text"
            placeholder="Search routes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-white text-sm placeholder-[#8F8F8F] outline-none"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-[#1C1C1E] animate-pulse rounded-2xl h-20 mx-5" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center mt-20 gap-3">
          <p className="text-red-400 text-sm text-center px-5">{error}</p>
          <button onClick={fetchRoutes} className="text-[#FCCA3B] text-sm underline">
            Retry
          </button>
        </div>
      ) : (routes || []).length === 0 ? (
        <div className="flex flex-col items-center mt-20">
          <span className="text-4xl">📍</span>
          <p className="text-white font-bold mt-4">No routes found</p>
          <p className="text-[#8F8F8F] text-sm mt-2">Contact your administrator</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(routes || [])
            .filter(r =>
              r.name.toLowerCase().includes(q) ||
              r.code.toLowerCase().includes(q)
            )
            .map(route => {
              const badge = (route.code ?? route.name ?? '').slice(0, 2).toUpperCase();
              return (
                <button
                  key={route.id}
                  onClick={() => navigate(`/route/${route.id}`)}
                  className="w-full bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-5 flex items-center gap-4 mx-5 hover:bg-[#242424] active:scale-[0.98] transition-all"
                  style={{ width: 'calc(100% - 2.5rem)' }}
                >
                  {/* Badge */}
                  <div className="bg-[#FCCA3B] rounded-xl w-12 h-12 flex items-center justify-center flex-shrink-0">
                    <span className="text-black font-black text-sm leading-none">{badge}</span>
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-white font-semibold text-sm leading-tight truncate">{route.name}</p>
                    {route.area_type && (
                      <p className="text-[#8F8F8F] text-xs mt-0.5">{route.area_type}</p>
                    )}
                  </div>

                  {/* Chevron */}
                  <span className="text-[#8F8F8F] text-lg leading-none flex-shrink-0">›</span>
                </button>
              );
            })}
        </div>
      )}

      <BottomNav />
    </div>
  );
};

export default RoutesPage;
