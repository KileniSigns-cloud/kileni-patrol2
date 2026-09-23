import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScanEye } from 'lucide-react';
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
    <div className="min-h-screen bg-bg text-tx flex">
      {/* Brand panel — wide screens only */}
      <div className="hidden md:flex w-1/2 bg-pri text-prit flex-col justify-between p-12">
        <span className="text-xs font-bold tracking-[0.4em] opacity-80">KILENI SIGNS</span>
        <h1 className="font-extrabold leading-none m-0" style={{ fontSize: 'clamp(80px, 12vw, 140px)' }}>PATROL</h1>
        <p className="text-xl opacity-80 m-0">Eyes on every sign.</p>
      </div>

      <div className="w-full md:w-1/2 flex items-center justify-center px-6 py-12">
        <form
          className="w-full max-w-sm"
          onSubmit={(e) => { e.preventDefault(); if (email && password && !loading) handleLogin(); }}
        >
          <div className="flex items-center gap-2 font-extrabold text-[19px] mb-8 md:hidden">
            <span className="w-[34px] h-[34px] rounded-[10px] bg-pri text-prit grid place-items-center">
              <ScanEye className="w-5 h-5" aria-hidden />
            </span>
            Patrol
          </div>
          <h1>Welcome back</h1>
          <p className="sub">Sign in to Patrol.</p>

          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" type="email" className="input" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />

          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />

          {error && <p className="field-err" role="alert">{error}</p>}

          <button type="submit" className="btn btn-pri btn-lg btn-full mt-8" disabled={loading || !email || !password}>
            {loading ? <><span className="spin" aria-hidden />Signing in…</> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
