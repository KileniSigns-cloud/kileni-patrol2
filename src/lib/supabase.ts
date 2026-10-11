import { createClient } from '@supabase/supabase-js';
import { isRecoveryLink, saveRecoveryFlag } from './passwordRecovery';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Note a password-reset link before the client starts: it reads the tokens from the hash,
// clears it, and only emits PASSWORD_RECOVERY a tick later. Recording it here means the very
// first render already knows to keep the user on /reset-password.
if (isRecoveryLink(window.location.hash)) saveRecoveryFlag(true);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
