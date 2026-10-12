// The organisation id must survive an app start with no signal, or the saved zones (keyed by it) are lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionOrgId } from '../src/lib/session.ts';
import type { User } from '../src/types/index.ts';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
const UID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const user = (over: Partial<User> = {}): User =>
  ({ id: UID, email: 'p@example.com', organisation_id: ORG, ...over });

test('sessionOrgId: the auth metadata id wins when it is there', () => {
  assert.equal(sessionOrgId(OTHER_ORG, user(), UID), OTHER_ORG);
});

test('sessionOrgId: keeps the id already known for the same user when the metadata has none', () => {
  // The offline reload case: metadata carries no organisation, the users table is unreachable.
  for (const missing of [undefined, null, '', '   ', 42, {}]) {
    assert.equal(sessionOrgId(missing, user(), UID), ORG, `metadata ${JSON.stringify(missing)}`);
  }
});

test('sessionOrgId: never carries an id across a different user or a signed-out store', () => {
  assert.equal(sessionOrgId(undefined, user({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }), UID), '');
  assert.equal(sessionOrgId(undefined, null, UID), '');
});

test('sessionOrgId: a blank saved id stays blank rather than being trusted', () => {
  assert.equal(sessionOrgId(undefined, user({ organisation_id: '' }), UID), '');
});

test('sessionOrgId: trims a padded metadata id', () => {
  assert.equal(sessionOrgId(`  ${OTHER_ORG}  `, user(), UID), OTHER_ORG);
});
