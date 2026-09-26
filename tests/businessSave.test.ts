// Business step: saving, going back from Photos and saving again must keep one business.
// Walks what AddBusinessPage does: buildBusinessWrite decides insert / update / nothing, and
// the Active patrol list is updated with withBusinessAdded / withBusinessUpdated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBusinessWrite, withBusinessAdded, withBusinessUpdated, type BusinessForm, type LoggedBusiness,
} from '../src/lib/signFlow.ts';

const ORG = 'org-1';
const user = { id: 'user-1', email: 'pat@example.com', organisation_id: ORG };
const NOW = '2026-09-26T15:00:00.000Z';
const LATER = '2026-09-26T15:02:00.000Z';
const SESSION = 'session-7';

const form: BusinessForm = { name: 'Ceek', address: '12 King St', notes: '', lat: 43.65, lng: -79.38 };

/** The list entry AddBusinessPage adds after an insert (the DB returns id + saved values). */
const listed = (id: string, f: BusinessForm): LoggedBusiness => ({
  id, name: f.name.trim() || null, address: f.address.trim() || null, lat: f.lat, lng: f.lng,
  notes: f.notes.trim() || null, signs: 0, lastPatrolType: null,
});

test('a new business is inserted with the user\'s organisation and rep_id', () => {
  const w = buildBusinessWrite(form, null, SESSION, user, NOW);
  assert.ok(w.ok && w.mode === 'insert');
  assert.deepEqual(w.row, {
    session_id: SESSION,
    organisation_id: ORG,
    rep_id: 'user-1',
    name: 'Ceek',
    address: '12 King St',
    notes: null,
    lat: 43.65,
    lng: -79.38,
    gps_latitude: 43.65,
    gps_longitude: -79.38,
    gps_captured_at: NOW,
    date_added: NOW,
    type: 'existing',
  });
});

test('a new business without a location saves null coordinates and no capture time', () => {
  const w = buildBusinessWrite({ ...form, lat: null, lng: null }, null, SESSION, user, NOW);
  assert.ok(w.ok && w.mode === 'insert');
  assert.equal(w.row.lat, null);
  assert.equal(w.row.gps_latitude, null);
  assert.equal(w.row.gps_captured_at, null);
});

test('saving a business with no organisation on the account is a readable error', () => {
  const w = buildBusinessWrite(form, null, SESSION, { ...user, organisation_id: '' }, NOW);
  assert.equal(w.ok, false);
  assert.match(!w.ok ? w.error : '', /^Business not saved: your account has no organisation/);
});

test('saving a business while signed out is a readable error', () => {
  const w = buildBusinessWrite(form, null, SESSION, null, NOW);
  assert.equal(w.ok, false);
  assert.match(!w.ok ? w.error : '', /signed out/);
});

test('Back from Photos then Next with no changes writes nothing and keeps one business', () => {
  const list = withBusinessAdded([], listed('biz-1', form));
  const again = buildBusinessWrite(form, list[0], SESSION, user, LATER);
  assert.deepEqual(again, { ok: true, mode: 'unchanged', id: 'biz-1' });
  // Whitespace-only differences are not changes.
  const padded = buildBusinessWrite({ ...form, name: ' Ceek ' }, list[0], SESSION, user, LATER);
  assert.deepEqual(padded, { ok: true, mode: 'unchanged', id: 'biz-1' });
});

test('Back from Photos, edit, save again: the same row is updated, never a second insert', () => {
  let list = withBusinessAdded([], listed('biz-1', form));
  const edited: BusinessForm = { ...form, name: 'Ceek Coffee', notes: 'Corner unit' };
  const w = buildBusinessWrite(edited, list[0], SESSION, user, LATER);
  assert.ok(w.ok && w.mode === 'update');
  assert.equal(w.id, 'biz-1');
  // Only the edited details; session, organisation, rep and date_added stay as inserted.
  assert.deepEqual(w.row, { name: 'Ceek Coffee', address: '12 King St', notes: 'Corner unit' });

  list = withBusinessUpdated(list, { id: 'biz-1', name: 'Ceek Coffee', address: '12 King St', lat: 43.65, lng: -79.38, notes: 'Corner unit' });
  assert.equal(list.length, 1, 'the Active patrol list still shows one business');
  assert.equal(list[0].name, 'Ceek Coffee');
  assert.equal(list[0].notes, 'Corner unit');
});

test('a re-captured location (Redo) is written with a new capture time', () => {
  const existing = listed('biz-1', form);
  const w = buildBusinessWrite({ ...form, lat: 43.66, lng: -79.39 }, existing, SESSION, user, LATER);
  assert.ok(w.ok && w.mode === 'update');
  assert.deepEqual(w.row, {
    name: 'Ceek', address: '12 King St', notes: null,
    lat: 43.66, lng: -79.39, gps_latitude: 43.66, gps_longitude: -79.39, gps_captured_at: LATER,
  });
});

test('an update never changes session, organisation or rep_id', () => {
  const w = buildBusinessWrite({ ...form, address: '14 King St' }, listed('biz-1', form), SESSION, user, LATER);
  assert.ok(w.ok && w.mode === 'update');
  for (const key of ['session_id', 'organisation_id', 'rep_id', 'date_added', 'type']) {
    assert.equal(key in w.row, false, `${key} is not in the update`);
  }
});

test('editing keeps the business\'s sign count and last patrol type', () => {
  const list: LoggedBusiness[] = [
    { ...listed('biz-1', form), signs: 2, lastPatrolType: 'day' },
    listed('biz-2', { ...form, name: 'Other' }),
  ];
  const next = withBusinessUpdated(list, { id: 'biz-1', name: 'Renamed', address: null, lat: null, lng: null, notes: null });
  assert.equal(next[0].signs, 2);
  assert.equal(next[0].lastPatrolType, 'day');
  assert.equal(next[0].name, 'Renamed');
  assert.deepEqual(next[1], list[1], 'other businesses are untouched');
});
