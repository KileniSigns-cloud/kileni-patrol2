// Recovery-event routing for the forgot / reset password flow: a reset link must hold the user
// on /reset-password until the new password is saved, and never let /routes render first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import {
  OFFLINE_MESSAGE, RESET_PASSWORD_PATH, isRecoveryLink, linkErrorCode, loadRecoveryFlag, nextRecoveryFlag,
  recoveryRedirect, resetPageState, resetRequestResult, saveRecoveryFlag, updatePasswordMessage,
} from '../src/lib/passwordRecovery.ts';

test('reset path is /reset-password', () => {
  assert.equal(RESET_PASSWORD_PATH, '/reset-password');
});

test('isRecoveryLink: only a recovery hash that still has its access token', () => {
  assert.equal(isRecoveryLink('#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery'), true);
  assert.equal(isRecoveryLink('access_token=abc&type=recovery'), true);
  assert.equal(isRecoveryLink('#access_token=abc&type=signup'), false);
  assert.equal(isRecoveryLink('#access_token=abc&type=magiclink'), false);
  assert.equal(isRecoveryLink('#type=recovery'), false);
  assert.equal(isRecoveryLink('#error=access_denied&error_code=otp_expired'), false);
  assert.equal(isRecoveryLink(''), false);
});

test('linkErrorCode: reads error_code (then error) from the hash or the query string', () => {
  const expired = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  assert.equal(linkErrorCode(expired, ''), 'otp_expired');
  assert.equal(linkErrorCode('', '?error=access_denied&error_code=otp_expired'), 'otp_expired');
  assert.equal(linkErrorCode('#error=server_error', ''), 'server_error');
  assert.equal(linkErrorCode('', ''), null);
  assert.equal(linkErrorCode('#access_token=abc&type=recovery', '?foo=1'), null);
});

test('nextRecoveryFlag: PASSWORD_RECOVERY turns on, SIGNED_OUT turns off, others keep the value', () => {
  const cases: [AuthChangeEvent, boolean, boolean][] = [
    ['PASSWORD_RECOVERY', false, true],
    ['PASSWORD_RECOVERY', true, true],
    ['SIGNED_OUT', true, false],
    ['SIGNED_OUT', false, false],
    ['INITIAL_SESSION', true, true],
    ['INITIAL_SESSION', false, false],
    ['SIGNED_IN', true, true],
    ['SIGNED_IN', false, false],
    ['TOKEN_REFRESHED', true, true],
    ['USER_UPDATED', true, true],
  ];
  for (const [event, current, expected] of cases) {
    assert.equal(nextRecoveryFlag(event, current), expected, `${event} from ${current}`);
  }
});

test('recoveryRedirect: recovering + signed in goes to /reset-password from anywhere else', () => {
  for (const path of ['/', '/routes', '/login', '/forgot-password', '/history', '/admin/routes', '/patrol/abc']) {
    assert.equal(recoveryRedirect(path, true, true), '/reset-password', path);
  }
  assert.equal(recoveryRedirect('/reset-password', true, true), null);
});

test('recoveryRedirect: no redirect when not recovering or not signed in', () => {
  assert.equal(recoveryRedirect('/routes', false, true), null);
  assert.equal(recoveryRedirect('/', false, false), null);
  assert.equal(recoveryRedirect('/routes', true, false), null);
  assert.equal(recoveryRedirect('/login', true, false), null);
});

test('resetPageState: link error wins, then recovery session, then wait / expire', () => {
  const base = { linkError: null, recovering: false, signedIn: false, waitedOut: false };
  assert.equal(resetPageState(base), 'checking');
  assert.equal(resetPageState({ ...base, waitedOut: true }), 'expired');
  assert.equal(resetPageState({ ...base, recovering: true, signedIn: true }), 'ready');
  assert.equal(resetPageState({ ...base, recovering: true, signedIn: true, waitedOut: true }), 'ready');
  assert.equal(resetPageState({ ...base, linkError: 'otp_expired', recovering: true, signedIn: true }), 'expired');
  // Recovery flag left over but the session is gone: not usable.
  assert.equal(resetPageState({ ...base, recovering: true, waitedOut: true }), 'expired');
  // Normal signed-in user who types /reset-password: no recovery session, so no form.
  assert.equal(resetPageState({ ...base, signedIn: true, waitedOut: true }), 'expired');
});

// Mirrors App.tsx: the auth listener updates the flag, then AppLayout asks where to go.
function routeAfter(events: AuthChangeEvent[], start: { recovering: boolean; signedIn: boolean; path: string }) {
  let recovering = start.recovering;
  let signedIn = start.signedIn;
  for (const event of events) {
    recovering = nextRecoveryFlag(event, recovering);
    signedIn = event !== 'SIGNED_OUT';
  }
  return { recovering, redirect: recoveryRedirect(start.path, recovering, signedIn) };
}

test('scenario: link lands on / (Site URL fallback) and is held on /reset-password', () => {
  // supabase.ts saw #type=recovery before the client started, so the flag is on at first render.
  assert.deepEqual(routeAfter(['INITIAL_SESSION'], { recovering: true, signedIn: true, path: '/' }),
    { recovering: true, redirect: '/reset-password' });
  assert.deepEqual(routeAfter(['INITIAL_SESSION', 'PASSWORD_RECOVERY'], { recovering: true, signedIn: true, path: '/routes' }),
    { recovering: true, redirect: '/reset-password' });
});

test('scenario: event arrives without the hash flag (fallback) and still redirects', () => {
  assert.deepEqual(routeAfter(['SIGNED_IN', 'PASSWORD_RECOVERY'], { recovering: false, signedIn: true, path: '/routes' }),
    { recovering: true, redirect: '/reset-password' });
});

test('scenario: USER_UPDATED alone does not end recovery; the page clears it after saving', () => {
  assert.deepEqual(routeAfter(['PASSWORD_RECOVERY', 'USER_UPDATED'], { recovering: false, signedIn: true, path: '/routes' }),
    { recovering: true, redirect: '/reset-password' });
  // After the page calls setPasswordRecovery(false):
  assert.equal(recoveryRedirect('/routes', false, true), null);
});

test('scenario: signing out ends recovery and frees /login', () => {
  assert.deepEqual(routeAfter(['PASSWORD_RECOVERY', 'SIGNED_OUT'], { recovering: false, signedIn: true, path: '/login' }),
    { recovering: false, redirect: null });
});

test('scenario: normal sign-in never redirects to the reset screen', () => {
  assert.deepEqual(routeAfter(['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'], { recovering: false, signedIn: true, path: '/routes' }),
    { recovering: false, redirect: null });
});

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() { return data.size; },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

test('recovery flag round-trips through storage and clears', () => {
  const s = memoryStorage();
  assert.equal(loadRecoveryFlag(s), false);
  saveRecoveryFlag(true, s);
  assert.equal(loadRecoveryFlag(s), true);
  assert.deepEqual([...s.data.entries()], [['patrol-password-recovery', '1']]);
  saveRecoveryFlag(false, s);
  assert.equal(loadRecoveryFlag(s), false);
  assert.equal(s.data.size, 0);
});

test('recovery flag: missing or broken storage reads as off and does not throw', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const broken = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  assert.equal(loadRecoveryFlag(null), false);
  assert.doesNotThrow(() => saveRecoveryFlag(true, null));
  assert.equal(loadRecoveryFlag(broken), false);
  assert.doesNotThrow(() => saveRecoveryFlag(true, broken));
  assert.equal(warn.mock.callCount(), 2);
});

test('resetRequestResult: only rate limits and connection failures are errors', () => {
  const online = true;
  assert.equal(resetRequestResult(null, online), 'sent');
  assert.equal(resetRequestResult({ name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit' }, online), 'rate_limited');
  assert.equal(resetRequestResult({ name: 'AuthApiError', status: 429 }, online), 'rate_limited');
  assert.equal(resetRequestResult({ name: 'AuthApiError', status: 400, code: 'over_request_rate_limit' }, online), 'rate_limited');
  assert.equal(resetRequestResult({ name: 'AuthRetryableFetchError', status: 0 }, online), 'offline');
  assert.equal(resetRequestResult({ name: 'AuthRetryableFetchError', status: 503 }, online), 'offline');
  assert.equal(resetRequestResult(new TypeError('Failed to fetch'), online), 'offline');
  assert.equal(resetRequestResult({ name: 'AuthApiError', status: 500 }, false), 'offline');
  // Never reveal whether an account exists: these all look like success.
  assert.equal(resetRequestResult({ name: 'AuthApiError', status: 400, code: 'user_not_found' }, online), 'sent');
  assert.equal(resetRequestResult({ name: 'AuthApiError', status: 400, code: 'email_address_not_authorized' }, online), 'sent');
  assert.equal(resetRequestResult({ name: 'AuthApiError', status: 500, code: 'unexpected_failure' }, online), 'sent');
});

test('updatePasswordMessage: readable text for each failure', () => {
  const online = true;
  assert.equal(updatePasswordMessage({ name: 'AuthRetryableFetchError', status: 0 }, online), OFFLINE_MESSAGE);
  assert.equal(updatePasswordMessage({ name: 'AuthApiError', status: 422 }, false), OFFLINE_MESSAGE);
  assert.equal(updatePasswordMessage({ name: 'AuthApiError', status: 429 }, online), 'Too many attempts. Wait a few minutes, then try again.');
  assert.equal(updatePasswordMessage({ name: 'AuthApiError', status: 422, code: 'same_password', message: 'x' }, online),
    'Choose a password different from your old one.');
  assert.equal(updatePasswordMessage({ name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' }, online),
    'Your reset link has expired. Request a new link.');
  assert.equal(updatePasswordMessage({ name: 'AuthWeakPasswordError', status: 422, code: 'weak_password', message: 'Password is known to be weak and easy to guess' }, online),
    'Password is known to be weak and easy to guess');
  assert.equal(updatePasswordMessage({}, online), 'Could not save your new password. Try again.');
});
