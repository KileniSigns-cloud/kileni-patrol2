// Which organisation id survives when an auth session is applied at app start.
// No React and no network: tests/session.test.ts runs it with plain values.

import type { User } from '../types';

/**
 * The organisation id to keep when a session is applied.
 *
 * The auth session is stored on the phone, so it is readable with no signal, but the
 * organisation id normally comes from `public.users`, which needs the network. With no
 * signal that read fails, so anything keyed by the organisation id — the zones saved for
 * offline use among them — would be lost if the id were blanked on every app start.
 *
 * Order: the id in the auth metadata, else the one already known for this same user,
 * else '' (not known yet).
 */
export function sessionOrgId(metadataOrgId: unknown, prev: User | null, authUserId: string): string {
  const fromMetadata = typeof metadataOrgId === 'string' ? metadataOrgId.trim() : '';
  if (fromMetadata) return fromMetadata;
  if (prev && prev.id === authUserId && prev.organisation_id) return prev.organisation_id;
  return '';
}
