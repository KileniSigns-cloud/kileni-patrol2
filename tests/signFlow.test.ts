// "Log another sign here": two signs at one business must both save against that business.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSignInspectionInsert, draftForNewBusiness, resetForNextSign, skipsPatrolType, type SignDraft,
} from '../src/lib/signFlow.ts';

const ORG = 'org-1';
const user = { id: 'user-1', email: 'pat@example.com', organisation_id: ORG };
const NOW = '2026-09-23T14:00:00.000Z';

const firstSign: SignDraft = {
  businessId: 'biz-42',
  businessName: 'Tim Hortons',
  patrolType: 'night',
  signCategory: 'Illuminated',
  signType: 'Channel Letters',
  inspectionId: 'insp-1',
  signPhotoUrls: ['data:sign-1'],
  surroundingPhotoUrls: ['data:surr-1'],
  currentIssues: ['Partially lit'],
  currentNotes: 'Two letters out',
  reusingBusiness: false,
};

test('two signs at the same business are both saved with the same business_id', () => {
  const first = buildSignInspectionInsert(firstSign, user, firstSign.currentNotes, NOW);

  // Success -> "Log another sign here" -> photos -> sign type -> issues -> save
  const second: SignDraft = {
    ...resetForNextSign(firstSign),
    inspectionId: 'insp-2', // assigned again on the Photos step
    signPhotoUrls: ['data:sign-2'],
    signCategory: 'Non-Illuminated',
    signType: 'Window Graphics',
    currentIssues: [],
  };
  const secondInsert = buildSignInspectionInsert(second, user, '', NOW);

  assert.ok(first.ok && secondInsert.ok);
  assert.equal(first.row.business_id, 'biz-42');
  assert.equal(secondInsert.row.business_id, 'biz-42');
  assert.equal(secondInsert.row.business_name, 'Tim Hortons');
  assert.equal(secondInsert.row.patrol_type, 'night', 'patrol type is kept from the first sign');
  assert.equal(secondInsert.row.sign_type, 'Window Graphics');
  assert.deepEqual(secondInsert.row.condition, [], 'issues from the first sign do not leak into the second');
});

test('reset keeps business and patrol type, clears the previous sign', () => {
  const next = resetForNextSign(firstSign);
  assert.equal(next.businessId, 'biz-42');
  assert.equal(next.patrolType, 'night');
  assert.equal(next.signCategory, null);
  assert.equal(next.signType, null);
  assert.equal(next.inspectionId, null);
  assert.deepEqual(next.signPhotoUrls, []);
  assert.deepEqual(next.surroundingPhotoUrls, []);
  assert.deepEqual(next.currentIssues, []);
  assert.equal(next.currentNotes, '');
  assert.equal(next.reusingBusiness, true);
});

test('step 6 (patrol type) is skipped only when reusing a business with a kept patrol type', () => {
  assert.equal(skipsPatrolType(resetForNextSign(firstSign)), true);
  assert.equal(skipsPatrolType(firstSign), false, 'first sign at a business shows step 6');
  assert.equal(skipsPatrolType(resetForNextSign({ ...firstSign, patrolType: null })), false);
});

test('saving without a business is a readable error, never a silent no-op', () => {
  const r = buildSignInspectionInsert({ ...firstSign, businessId: null }, user, '', NOW);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /no business attached/);
});

test('saving while signed out is a readable error', () => {
  const r = buildSignInspectionInsert(firstSign, null, '', NOW);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /signed out/);
});

test('saving before the photos were uploaded is a readable error', () => {
  for (const draft of [{ ...firstSign, inspectionId: null }, { ...firstSign, signPhotoUrls: [] }]) {
    const r = buildSignInspectionInsert(draft, user, '', NOW);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /photos were not uploaded/);
  }
});

test('insert payload is the original IssuesPage insert plus the photos\' inspection id', () => {
  const r = buildSignInspectionInsert(firstSign, user, 'Two letters out', NOW);
  assert.ok(r.ok);
  assert.equal(r.inspectionId, 'insp-1');
  assert.deepEqual(r.row, {
    id: 'insp-1',
    business_id: 'biz-42',
    organisation_id: ORG,
    business_name: 'Tim Hortons',
    sign_category: 'Illuminated',
    sign_type: 'Channel Letters',
    patrol_type: 'night',
    condition: ['Partially lit'],
    condition_rating: 'good',
    is_compliant: false,
    non_compliance_reason: 'Partially lit',
    notes: 'Two letters out',
    status: 'completed',
    inspected_by: 'user-1',
    patroller_name: 'pat@example.com',
    inspected_at: NOW,
    date_logged: NOW,
  });
});

// ── Organisation comes from the signed-in user, never a hardcoded id ─────────

test('the sign is saved under the signed-in user\'s organisation', () => {
  const r = buildSignInspectionInsert(firstSign, { ...user, organisation_id: 'org-2' }, '', NOW);
  assert.ok(r.ok);
  assert.equal(r.row.organisation_id, 'org-2');
});

test('saving a sign with no organisation on the account is a readable error', () => {
  const r = buildSignInspectionInsert(firstSign, { ...user, organisation_id: '' }, '', NOW);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /^Sign not saved: your account has no organisation/);
});

// ── Add business after a saved sign starts clean ────────────────────────────

test('a new business carries over none of the previous sign, only the patrol type', () => {
  // Success -> Done -> Active patrol -> Add business.
  const next = draftForNewBusiness(firstSign.patrolType);
  assert.deepEqual(next, {
    businessId: null,
    businessName: null,
    patrolType: 'night',
    signCategory: null,
    signType: null,
    inspectionId: null,
    signPhotoUrls: [],
    surroundingPhotoUrls: [],
    currentIssues: [],
    currentNotes: '',
    reusingBusiness: false,
  });
});

test('the first sign at a new business is saved without the previous business\'s issues', () => {
  const draft: SignDraft = {
    ...draftForNewBusiness(firstSign.patrolType),
    businessId: 'biz-43', inspectionId: 'insp-9', signPhotoUrls: ['org-1/patrol/insp-9/sign-1.jpg'],
  };
  const r = buildSignInspectionInsert(draft, user, draft.currentNotes, NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.row.condition, []);
  assert.equal(r.row.non_compliance_reason, null);
  assert.equal(r.row.notes, null);
  assert.equal(r.row.sign_type, null);
});
