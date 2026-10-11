import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  OFFLINE_MESSAGE, RESET_PASSWORD_PATH, RESET_RATE_LIMIT_MESSAGE, RESET_SENT_MESSAGE, resetRequestResult,
} from '../lib/passwordRecovery';
import AuthLayout from '../components/layout/AuthLayout';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends a password-reset email. Success always shows the same message, whether or not the
 * email has an account; only rate limits and connection failures show an error.
 */
const ForgotPasswordPage: React.FC = () => {
  const location = useLocation();
  const initialEmail = (location.state as { email?: string } | null)?.email ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setError('Enter a valid email address.');
      return;
    }
    setSending(true);
    setError(null);
    let failure: unknown = null;
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
      });
      failure = resetError;
    } catch (e) {
      failure = e;
    }
    const result = resetRequestResult(failure, navigator.onLine);
    if (failure) console.error('Password reset request failed:', failure);
    setSending(false);
    if (result === 'rate_limited') setError(RESET_RATE_LIMIT_MESSAGE);
    else if (result === 'offline') setError(OFFLINE_MESSAGE);
    else setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout>
        <div role="status">
          <MailCheck className="w-10 h-10 text-pri mb-4" aria-hidden />
          <h1>Check your email</h1>
          <p className="sub">{RESET_SENT_MESSAGE}</p>
          <p className="field-hint">The link works once and expires after a while. Check your spam folder if it does not arrive in a few minutes.</p>
        </div>
        <Link to="/login" className="btn btn-pri btn-lg btn-full mt-8">Back to sign in</Link>
        <div className="flex justify-center mt-4">
          <button type="button" className="linkb" onClick={() => setSent(false)}>Use a different email</button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form onSubmit={(e) => { e.preventDefault(); if (email && !sending) handleSend(); }} noValidate>
        <h1>Forgot password</h1>
        <p className="sub">Enter the email you sign in with. We will send you a link to set a new password.</p>

        <label className="field-label" htmlFor="reset-email">Email</label>
        <input
          id="reset-email"
          type="email"
          inputMode="email"
          className="input"
          autoComplete="email"
          autoCapitalize="none"
          value={email}
          onChange={e => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'reset-email-err' : undefined}
        />

        {error && <p id="reset-email-err" className="field-err" role="alert">{error}</p>}

        <button type="submit" className="btn btn-pri btn-lg btn-full mt-8" disabled={sending || !email}>
          {sending ? <><span className="spin" aria-hidden />Sending…</> : 'Send reset link'}
        </button>

        <div className="flex justify-center mt-4">
          <Link to="/login" className="linkb">Back to sign in</Link>
        </div>
      </form>
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
