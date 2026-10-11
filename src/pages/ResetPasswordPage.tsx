import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LinkIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePatrolStore } from '../store/patrol.store';
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordError } from '../lib/passwordRules';
import {
  FORGOT_PASSWORD_PATH, RECOVERY_WAIT_MS, linkErrorCode, resetPageState, updatePasswordMessage,
} from '../lib/passwordRecovery';
import AuthLayout from '../components/layout/AuthLayout';
import { toast } from '../components/ui/Toast';

/**
 * Landing screen for the password-reset email link. The app-wide auth listener (App.tsx)
 * turns recovery mode on; this screen shows the form only while that recovery session exists.
 */
const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const signedIn = usePatrolStore(s => s.currentUser !== null);
  const recovering = usePatrolStore(s => s.passwordRecovery);
  const setPasswordRecovery = usePatrolStore(s => s.setPasswordRecovery);
  const logout = usePatrolStore(s => s.logout);

  // Read once: Supabase leaves the error in the URL when the link is expired or already used.
  const [linkError] = useState(() => linkErrorCode(window.location.hash, window.location.search));
  const [waitedOut, setWaitedOut] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (linkError) console.error('Password reset link rejected:', linkError);
    const timer = setTimeout(() => setWaitedOut(true), RECOVERY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [linkError]);

  const state = resetPageState({ linkError, recovering, signedIn, waitedOut });

  // A dead link ends recovery mode, otherwise the app-wide guard would bounce
  // "Request a new link" straight back here.
  useEffect(() => {
    if (state === 'expired' && recovering) setPasswordRecovery(false);
  }, [state, recovering, setPasswordRecovery]);

  const handleSave = async () => {
    const problem = passwordError(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    let failure: unknown = null;
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      failure = updateError;
    } catch (e) {
      failure = e;
    }
    if (failure) {
      console.error('Password update failed:', failure);
      setError(updatePasswordMessage(failure, navigator.onLine));
      setSaving(false);
      return;
    }
    setPasswordRecovery(false);
    toast.success('Password updated.');
    navigate('/routes', { replace: true });
  };

  const handleCancel = async () => {
    try {
      await logout();
    } catch (e) {
      console.error('Sign-out after cancelling the password reset failed:', e);
    }
    navigate('/login', { replace: true });
  };

  if (state === 'checking') {
    return (
      <AuthLayout>
        <p className="text-mut font-bold flex items-center gap-2" role="status">
          <span className="spin" aria-hidden />Checking your reset link…
        </p>
      </AuthLayout>
    );
  }

  if (state === 'expired') {
    return (
      <AuthLayout>
        <div role="alert">
          <LinkIcon className="w-10 h-10 text-acc mb-4" aria-hidden />
          <h1>Link expired</h1>
          <p className="sub">This reset link has expired or was already used. Each link works once. Request a new one and use the newest email.</p>
        </div>
        <Link to={FORGOT_PASSWORD_PATH} className="btn btn-pri btn-lg btn-full mt-8">Request a new link</Link>
        <div className="flex justify-center mt-4">
          <Link to="/login" className="linkb">Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  const inputType = showPassword ? 'text' : 'password';
  return (
    <AuthLayout>
      <form onSubmit={(e) => { e.preventDefault(); if (!saving) handleSave(); }} noValidate>
        <h1>Set a new password</h1>
        <p className="sub">Choose a new password for your Patrol account.</p>

        <label className="field-label" htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type={inputType}
          className="input"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={e => setPassword(e.target.value)}
          aria-describedby="new-password-hint"
        />
        <p id="new-password-hint" className="field-hint">{PASSWORD_HINT}</p>

        <label className="field-label" htmlFor="confirm-password">Confirm password</label>
        <input
          id="confirm-password"
          type={inputType}
          className="input"
          autoComplete="new-password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
        />

        <button type="button" className="linkb mt-2" onClick={() => setShowPassword(v => !v)} aria-pressed={showPassword}>
          {showPassword ? <><EyeOff aria-hidden />Hide passwords</> : <><Eye aria-hidden />Show passwords</>}
        </button>

        {error && <p className="field-err" role="alert">{error}</p>}

        <button type="submit" className="btn btn-pri btn-lg btn-full mt-8" disabled={saving || !password || !confirm}>
          {saving ? <><span className="spin" aria-hidden />Saving…</> : 'Save new password'}
        </button>

        <div className="flex justify-center mt-4">
          <button type="button" className="linkb" onClick={handleCancel} disabled={saving}>Cancel and sign out</button>
        </div>
      </form>
    </AuthLayout>
  );
};

export default ResetPasswordPage;
