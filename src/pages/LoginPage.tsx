import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { FORGOT_PASSWORD_PATH } from '../lib/passwordRecovery';
import { usePatrolStore } from '../store/patrol.store';
import AuthLayout from '../components/layout/AuthLayout';

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
    <AuthLayout>
      <form onSubmit={(e) => { e.preventDefault(); if (email && password && !loading) handleLogin(); }}>
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

        <div className="flex justify-center mt-4">
          <Link to={FORGOT_PASSWORD_PATH} state={{ email }} className="linkb">Forgot password?</Link>
        </div>
      </form>
    </AuthLayout>
  );
};

export default LoginPage;
