// "Log another sign here" at one business: each sign gets its own inspection id, its own
// sign_inspections row, and its photos filed under that id. Walks the same steps the pages
// run: PhotoUploadPage (id + upload) -> IssuesPage (sign row + photo rows) -> SuccessPage
// ("Log another sign here" = resetForNextSign) -> PhotoUploadPage -> IssuesPage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignInspectionInsert, ensureInspectionId, resetForNextSign, type SignDraft } from '../src/lib/signFlow.ts';
import { buildInspectionPhotoRows, uploadPhotos, type StorageClient } from '../src/lib/photoStorage.ts';

const ORG = 'org-1';
const user = { id: 'user-1', email: 'pat@example.com', organisation_id: ORG };
const NOW = '2026-09-23T14:00:00.000Z';
const jpeg = () => new Blob(['x'], { type: 'image/jpeg' });

const uploaded: string[] = [];
const storage: StorageClient = {
  storage: { from: () => ({ upload: async (path) => { uploaded.push(path); return { error: null }; } }) },
};
let n = 0;
const newId = () => `insp-${++n}`;

/** PhotoUploadPage.handleContinue: fix the sign's id, upload, keep the paths in the draft. */
async function photosStep(d: SignDraft, signCount: number): Promise<SignDraft> {
  const id = ensureInspectionId(d.inspectionId, newId);
  const paths = await uploadPhotos(storage, ORG, 'patrol', id,
    Array.from({ length: signCount }, (_, i) => ({ name: `sign-${i + 1}.jpg`, blob: jpeg() })));
  return { ...d, inspectionId: id, signPhotoUrls: paths, surroundingPhotoUrls: [] };
}

/** IssuesPage.handleSubmit: the sign row and its photo rows. */
function saveStep(d: SignDraft) {
  const insert = buildSignInspectionInsert(d, user, d.currentNotes, NOW);
  assert.ok(insert.ok, !insert.ok ? insert.error : '');
  const photos = buildInspectionPhotoRows(insert.inspectionId, d.businessId,
    d.signPhotoUrls.map((path) => ({ path, type: 'sign' as const })), NOW);
  return { sign: insert.row, photos };
}

test('two signs at one business: 2 inspection ids, 2 sign rows, photos filed under each', async () => {
  // First sign at a newly added business (the context clears the id for a new business).
  let draft: SignDraft = {
    businessId: 'biz-42', businessName: 'Ceek', patrolType: 'day', signCategory: 'Illuminated',
    signType: 'Channel Letters', inspectionId: null, signPhotoUrls: [], surroundingPhotoUrls: [],
    currentIssues: ['Peeling graphics'], currentNotes: '', reusingBusiness: false,
  };
  draft = await photosStep(draft, 2);
  const first = saveStep(draft);

  // Success -> "Log another sign here".
  draft = resetForNextSign(draft);
  assert.equal(draft.inspectionId, null, 'inspection id is cleared for the next sign');
  assert.deepEqual(draft.signPhotoUrls, [], 'sign photos are cleared for the next sign');
  assert.deepEqual(draft.surroundingPhotoUrls, [], 'surrounding photos are cleared for the next sign');

  draft = await photosStep({ ...draft, signType: 'ACP Panel Signs', currentIssues: ['Damaged / Impact damage'] }, 1);
  const second = saveStep(draft);

  // 2 inspection ids, 2 sign rows, same business.
  assert.equal(first.sign.id, 'insp-1');
  assert.equal(second.sign.id, 'insp-2');
  assert.notEqual(first.sign.id, second.sign.id);
  assert.equal(first.sign.business_id, 'biz-42');
  assert.equal(second.sign.business_id, 'biz-42');
  assert.equal(first.sign.organisation_id, ORG, 'sign rows use the same organisation as the photo paths');
  assert.equal(second.sign.organisation_id, ORG);

  // Photos filed under each sign's own id, in storage and in inspection_photos.
  assert.deepEqual(first.photos.map((p) => p.photo_url), [
    `${ORG}/patrol/insp-1/sign-1.jpg`, `${ORG}/patrol/insp-1/sign-2.jpg`,
  ]);
  assert.deepEqual(second.photos.map((p) => p.photo_url), [`${ORG}/patrol/insp-2/sign-1.jpg`]);
  assert.ok(first.photos.every((p) => p.inspection_id === 'insp-1'));
  assert.ok(second.photos.every((p) => p.inspection_id === 'insp-2'));
  assert.deepEqual(uploaded, [...first.photos, ...second.photos].map((p) => p.photo_url));

  // IssuesPage only skips the sign insert when savedSignRef equals the current id; the
  // second sign's id differs from the first, so it is always inserted.
  const savedSignRef = first.sign.id;
  assert.notEqual(savedSignRef, second.sign.id);
});

test('retaking photos for the same sign keeps its inspection id', () => {
  assert.equal(ensureInspectionId('insp-7', newId), 'insp-7');
});
