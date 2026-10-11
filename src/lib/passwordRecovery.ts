// Pure rules for the forgot / reset password flow. No React or Supabase runtime here, so
// tests/passwordRecovery.test.ts can exercise them directly.
//
// How a reset link arrives (supabase-js implicit flow, the default PATROL uses):
// the email link lands on /reset-password#access_token=...&type=recovery. The client reads the
// tokens, signs the user in, clears the hash and then emits PASSWORD_RECOVERY. An expired or
// used link lands with #error=...&error_code=otp_expired instead, and no session.
import type { AuthChangeEvent } from '@supabase/supabase-js';
import { errorMessage } from './errors.ts';

export const FORGOT_PASSWORD_PATH = '/forgot-password';
export const RESET_PASSWORD_PATH = '/reset-password';

/** How long the reset screen waits for the recovery session before calling the link expired. */
export const RECOVERY_WAIT_MS = 8000;

/** True when the URL hash is a Supabase recovery link that still carries its tokens. */
export function isRecoveryLink(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get('type') === 'recovery' && !!params.get('access_token');
}

/** The error code Supabase puts on an expired or already-used link (hash or query), or null. */
export function linkErrorCode(hash: string, search: string): string | null {
  for (const part of [hash.replace(/^#/, ''), search.replace(/^\?/, '')]) {
    const params = new URLSearchParams(part);
    const code = params.get('error_code') || params.get('error');
    if (code) return code;
  }
  return null;
}

/** Recovery mode starts on PASSWORD_RECOVERY and ends on sign-out; other events keep it as is. */
export function nextRecoveryFlag(event: AuthChangeEvent, current: boolean): boolean {
  if (event === 'PASSWORD_RECOVERY') return true;
  if (event === 'SIGNED_OUT') return false;
  return current;
}

/**
 * Where to send a user who opened a reset link, or null to let the route render.
 * A recovery link signs the user in, so without this they could reach /routes
 * (or any screen) without ever setting the new password.
 */
export function recoveryRedirect(pathname: string, recovering: boolean, signedIn: boolean): string | null {
  return recovering && signedIn && pathname !== RESET_PASSWORD_PATH ? RESET_PASSWORD_PATH : null;
}

export type ResetPageState = 'checking' | 'expired' | 'ready';

export function resetPageState(s: {
  linkError: string | null;
  recovering: boolean;
  signedIn: boolean;
  waitedOut: boolean;
}): ResetPageState {
  if (s.linkError) return 'expired';
  if (s.recovering && s.signedIn) return 'ready';
  return s.waitedOut ? 'expired' : 'checking';
}

// The recovery flag lives in sessionStorage as well as memory: phones often reload a tab
// that was in the background, and the hash is gone by then. It is per tab and cleared on
// success or sign-out.
const RECOVERY_KEY = 'patrol-password-recovery';

type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function tabStorage(): FlagStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch (e) {
    console.warn('sessionStorage is not available; the reset screen will not survive a reload.', e);
    return null;
  }
}

export function loadRecoveryFlag(storage: FlagStorage | null = tabStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(RECOVERY_KEY) === '1';
  } catch (e) {
    console.warn('Could not read the password-reset flag.', e);
    return false;
  }
}

export function saveRecoveryFlag(on: boolean, storage: FlagStorage | null = tabStorage()): void {
  if (!storage) return;
  try {
    if (on) storage.setItem(RECOVERY_KEY, '1');
    else storage.removeItem(RECOVERY_KEY);
  } catch (e) {
    console.warn('Could not save the password-reset flag.', e);
  }
}

// Forgot-password request. Only rate limits and connection failures are shown as errors.
// Every other outcome shows the same neutral message, so the screen never reveals whether
// an email has an account.
export const RESET_SENT_MESSAGE = 'If that email has an account, a reset link is on its way.';
export const RESET_RATE_LIMIT_MESSAGE = 'Too many reset requests. Wait a few minutes, then try again.';
export const OFFLINE_MESSAGE = 'Could not reach the server. Check your signal and try again.';

export type ResetRequestResult = 'sent' | 'rate_limited' | 'offline';

interface ErrorLike { name?: unknown; status?: unknown; code?: unknown }

function isRateLimited(e: ErrorLike): boolean {
  return e.status === 429 || (typeof e.code === 'string' && e.code.includes('rate_limit'));
}

/** Network failures: no connection, fetch rejected, or a 502/503/504-type gateway error. */
function isConnectionFailure(error: unknown, online: boolean): boolean {
  if (!online) return true;
  if (error instanceof TypeError) return true;
  return (error as ErrorLike).name === 'AuthRetryableFetchError';
}

export function resetRequestResult(error: unknown, online: boolean): ResetRequestResult {
  if (!error) return 'sent';
  if (isRateLimited(error as ErrorLike)) return 'rate_limited';
  if (isConnectionFailure(error, online)) return 'offline';
  return 'sent';
}

/** Readable message for a failed updateUser({ password }). */
export function updatePasswordMessage(error: unknown, online: boolean): string {
  if (isConnectionFailure(error, online)) return OFFLINE_MESSAGE;
  const e = error as ErrorLike;
  if (isRateLimited(e)) return 'Too many attempts. Wait a few minutes, then try again.';
  if (e.code === 'same_password') return 'Choose a password different from your old one.';
  if (e.name === 'AuthSessionMissingError' || e.code === 'session_not_found' || e.code === 'session_expired') {
    return 'Your reset link has expired. Request a new link.';
  }
  return errorMessage(error, 'Could not save your new password. Try again.');
}
