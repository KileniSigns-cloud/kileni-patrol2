// Password rule shared by every screen that sets a password. 8 characters matches BUILT's
// invite sign-up form (InviteAcceptancePage), which is where PATROL accounts are created.
// This is a client check only: Supabase enforces its own minimum (Auth > Providers > Email).

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

/** The first problem with a new password and its confirmation, or null when both are fine. */
export function passwordError(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}
