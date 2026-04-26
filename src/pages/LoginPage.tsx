import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { usePatrolStore } from '../store/patrol.store';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const setUser = usePatrolStore(s => s.setUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }
    if (data.user) {
      setUser({
        id: data.user.id,
        email: data.user.email ?? '',
        name: data.user.user_metadata?.name,
        organisation_id: data.user.user_metadata?.organisation_id ?? '',
      });
      navigate('/routes');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen">
      {/* Left panel — hidden on mobile */}
      <div className="hidden md:flex w-1/2 bg-[#FCCA3B] h-screen flex-col justify-between p-12">
        <span className="text-xs font-bold tracking-[0.4em] text-black/50">KILENI SIGNS</span>
        <h1 className="font-black leading-none text-black" style={{ fontSize: 'clamp(80px, 12vw, 140px)' }}>PATROL</h1>
        <p className="text-xl italic text-black/60">Eyes on every sign.</p>
      </div>

      {/* Right panel — always light regardless of app theme */}
      <div className="w-full md:w-1/2 bg-white h-screen flex items-center justify-center px-8" style={{ colorScheme: 'light' }}>
        <div className="w-full max-w-sm">
          <h2 className="text-3xl font-black text-gray-900">Welcome back</h2>
          <p className="text-sm text-gray-400 mt-1 mb-10">Sign in to PATROL</p>

          {/* Email */}
          <div className="mb-4">
            <label className="block text-xs font-bold tracking-widest text-gray-400 mb-2">EMAIL</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-gray-900 placeholder-gray-400 focus:border-[#FCCA3B] focus:outline-none transition-colors"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-bold tracking-widest text-gray-400 mb-2">PASSWORD</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-gray-900 placeholder-gray-400 focus:border-[#FCCA3B] focus:outline-none transition-colors"
            />
          </div>

          <button
            onClick={handleLogin}
            disabled={loading || !email || !password}
            className="bg-[#FCCA3B] text-black font-bold py-4 rounded-2xl w-full mt-8 text-base tracking-wide active:scale-95 transition-transform disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          {error && (
            <p className="text-red-500 text-sm mt-4 text-center">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
