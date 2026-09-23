// Photos go to storage first; rows only ever hold storage paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTO_BUCKET, buildInspectionPhotoRows, isStoragePath, photoPath, uploadPhotos, type StorageClient,
} from '../src/lib/photoStorage.ts';

const ORG = 'org-1';
const NOW = '2026-09-23T14:00:00.000Z';
const jpeg = () => new Blob(['x'], { type: 'image/jpeg' });

/** Fake storage that records uploads and fails on the given call (1-based). */
function fakeClient(failOn?: number) {
  const calls: { bucket: string; path: string; upsert: boolean }[] = [];
  const client: StorageClient = {
    storage: {
      from: (bucket) => ({
        upload: async (path, _body, opts) => {
          calls.push({ bucket, path, upsert: opts.upsert });
          return { error: calls.length === failOn ? { message: 'Network request failed' } : null };
        },
      }),
    },
  };
  return { client, calls };
}

test('paths start with the organisation, then kind and owner id', () => {
  assert.equal(photoPath(ORG, 'patrol', 'insp-1', 'sign-1.jpg'), 'org-1/patrol/insp-1/sign-1.jpg');
  assert.equal(photoPath(ORG, 'quick-catch', 'lead-9', 'photo-1.jpg'), 'org-1/quick-catch/lead-9/photo-1.jpg');
});

test('a missing organisation is an error, never a path without one', () => {
  assert.throws(() => photoPath('', 'patrol', 'insp-1', 'a.jpg'), /no organisation/);
});

test('uploads every photo to patrol-media without overwriting and returns paths in order', async () => {
  const { client, calls } = fakeClient();
  const done: number[] = [];
  const paths = await uploadPhotos(client, ORG, 'patrol', 'insp-1',
    [{ name: 'sign-1.jpg', blob: jpeg() }, { name: 'surrounding-1.jpg', blob: jpeg() }], (n) => done.push(n));
  assert.deepEqual(paths, ['org-1/patrol/insp-1/sign-1.jpg', 'org-1/patrol/insp-1/surrounding-1.jpg']);
  assert.ok(calls.every((c) => c.bucket === PHOTO_BUCKET && c.upsert === false));
  assert.deepEqual(done, [1, 2]);
});

test('an upload failure throws a readable error and stops the remaining uploads', async () => {
  const { client, calls } = fakeClient(2);
  await assert.rejects(
    uploadPhotos(client, ORG, 'quick-catch', 'lead-9',
      [{ name: 'a.jpg', blob: jpeg() }, { name: 'b.jpg', blob: jpeg() }, { name: 'c.jpg', blob: jpeg() }]),
    /Photos not uploaded: Network request failed/,
  );
  assert.equal(calls.length, 2);
});

test('only storage paths count as stored photos', () => {
  assert.equal(isStoragePath('org-1/patrol/insp-1/a.jpg'), true);
  assert.equal(isStoragePath('data:image/jpeg;base64,/9j/4AAQ'), false);
  assert.equal(isStoragePath('https://x.supabase.co/storage/v1/object/public/patrol-photos/a.jpg'), false);
  assert.equal(isStoragePath(''), false);
});

test('inspection_photos rows hold paths and the business when there is one', () => {
  const rows = buildInspectionPhotoRows('insp-1', 'biz-42', [
    { path: 'org-1/patrol/insp-1/sign-1.jpg', type: 'sign' },
    { path: 'org-1/patrol/insp-1/surrounding-1.jpg', type: 'surrounding' },
  ], NOW);
  assert.deepEqual(rows, [
    { inspection_id: 'insp-1', business_id: 'biz-42', photo_url: 'org-1/patrol/insp-1/sign-1.jpg', photo_type: 'sign', created_at: NOW },
    { inspection_id: 'insp-1', business_id: 'biz-42', photo_url: 'org-1/patrol/insp-1/surrounding-1.jpg', photo_type: 'surrounding', created_at: NOW },
  ]);
  const qc = buildInspectionPhotoRows('insp-2', null, [{ path: 'org-1/quick-catch/lead-9/photo-1.jpg', type: 'sign' }], NOW);
  assert.equal('business_id' in qc[0], false);
});

test('base64 is refused, so no new row can store it', () => {
  assert.throws(
    () => buildInspectionPhotoRows('insp-1', 'biz-42', [{ path: 'data:image/jpeg;base64,/9j/', type: 'sign' }], NOW),
    /not uploaded to storage/,
  );
});
