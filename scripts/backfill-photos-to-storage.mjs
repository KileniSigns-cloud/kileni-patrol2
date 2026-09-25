// Moves base64 photos out of inspection_photos.photo_url and leads.photos into the private
// patrol-media bucket and replaces them with storage paths.
//
//   node scripts/backfill-photos-to-storage.mjs            # dry run (default): backup + plan only
//   node scripts/backfill-photos-to-storage.mjs --apply    # backup, upload, then update rows
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role: bypasses RLS; never ship it).
// Rows are read in small batches (20 inspection_photos, 5 leads): the first queries fetch ids
// only, never the photo columns, so no single statement carries every photo at once.
// Per batch: fetch the rows, append them untouched to backups/photos-backup-<ts>.jsonl and read
// the appended bytes back, then (with --apply) upload, read each object back, and update the
// rows. A crash mid-run keeps every batch already backed up. Re-running is safe: rows whose
// photos are already storage paths are skipped. Requires migration 006 (bucket patrol-media).

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'patrol-media';
const IP_BATCH = 20;
const LEAD_BATCH = 5;
const PAGE = 1000; // PostgREST max rows per request
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const isData = (v) => typeof v === 'string' && v.startsWith('data:');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
function decode(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('not a base64 data URL');
  return { type: m[1], bytes: Buffer.from(m[2], 'base64') };
}
const fail = (what, error) => { throw new Error(`${what}: ${error.message ?? error}`); };
const chunk = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/** Every id in `table` matching `filter`, paged. Selects `id` only. */
async function fetchIds(table, filter) {
  const ids = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(sb.from(table).select('id')).order('id').range(from, from + PAGE - 1);
    if (error) fail(`read ${table} ids`, error);
    ids.push(...data.map((r) => r.id));
    if (data.length < PAGE) return ids;
  }
}

// ── Backup: JSON Lines, appended per batch, each append read back ───────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.resolve('backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `photos-backup-${stamp}.jsonl`);
const backupFd = fs.openSync(backupFile, 'wx');
let backupBytes = 0;

function backup(records) {
  const buf = Buffer.from(records.map((r) => JSON.stringify(r) + '\n').join(''));
  fs.writeSync(backupFd, buf, 0, buf.length, backupBytes);
  fs.fsyncSync(backupFd);
  const back = Buffer.alloc(buf.length);
  const fd = fs.openSync(backupFile, 'r');
  try { fs.readSync(fd, back, 0, buf.length, backupBytes); } finally { fs.closeSync(fd); }
  if (!back.equals(buf)) throw new Error(`backup ${backupFile} did not read back; stopping before any write`);
  backupBytes += buf.length;
}
backup([{ created_at: new Date().toISOString(), supabase_url: SUPABASE_URL }]);

// ── Upload helper ────────────────────────────────────────────────────────────
async function put(objectPath, dataUrl) {
  const { type, bytes } = decode(dataUrl);
  if (!APPLY) { console.log(`[dry] upload ${objectPath} (${(bytes.length / 1024).toFixed(0)} KB)`); return; }
  const { error } = await sb.storage.from(BUCKET).upload(objectPath, bytes, { contentType: type, upsert: true });
  if (error) fail(`upload ${objectPath}`, error);
  const { data, error: dlErr } = await sb.storage.from(BUCKET).download(objectPath);
  if (dlErr || data.size !== bytes.length) fail(`verify ${objectPath}`, dlErr ?? 'size mismatch');
}

// ── 1) inspection_photos → {org}/patrol/{inspection_id}/{photo_id}.jpg ──────
// md5(base64) → path, so lead photos copied from an inspection photo reuse its object.
// Only filled for rows converted in this run; after a resume, such lead photos upload again.
const byHash = new Map();
const ipIds = await fetchIds('inspection_photos', (q) => q.like('photo_url', 'data:%'));
const ipBatches = chunk(ipIds, IP_BATCH);
let ipDone = 0;
for (const [b, ids] of ipBatches.entries()) {
  const { data: rows, error } = await sb
    .from('inspection_photos')
    .select('id, inspection_id, business_id, photo_url, sign_inspections!inner(organisation_id)')
    .in('id', ids)
    .like('photo_url', 'data:%'); // rows converted since the id query drop out here
  if (error) fail('read inspection_photos batch', error);
  backup(rows.map(({ id, inspection_id, business_id, photo_url }) =>
    ({ table: 'inspection_photos', id, inspection_id, business_id, photo_url })));

  for (const r of rows) {
    const org = r.sign_inspections?.organisation_id;
    if (!org) { console.warn('skip inspection_photo without org', r.id); continue; }
    const objectPath = `${org}/patrol/${r.inspection_id}/${r.id}.jpg`;
    await put(objectPath, r.photo_url);
    byHash.set(md5(r.photo_url), objectPath);
    if (APPLY) {
      const { error: upErr } = await sb.from('inspection_photos').update({ photo_url: objectPath })
        .eq('id', r.id).like('photo_url', 'data:%');
      if (upErr) fail(`update inspection_photos ${r.id}`, upErr);
    }
  }
  ipDone += rows.length;
  console.log(`batch ${b + 1}/${ipBatches.length} — ${rows.length} inspection_photos`);
}

// ── 2) leads.photos: base64 entries → paths, other entries kept in place ────
// PostgREST cannot match inside a jsonb array without selecting it, so the id query takes
// every lead with photos; each batch then skips leads that hold no base64 (already paths).
const leadIds = await fetchIds('leads', (q) => q.not('photos', 'is', null));
const leadBatches = chunk(leadIds, LEAD_BATCH);
let leadsDone = 0;
let leadPhotos = 0;
for (const [b, ids] of leadBatches.entries()) {
  const { data: rows, error } = await sb
    .from('leads')
    .select('id, source, organisation_id, photos')
    .in('id', ids);
  if (error) fail('read leads batch', error);
  const todo = rows.filter((l) => Array.isArray(l.photos) && l.photos.some(isData));
  backup(todo.map(({ id, source, organisation_id, photos }) => ({ table: 'leads', id, source, organisation_id, photos })));

  let photos = 0;
  for (const l of todo) {
    if (!l.organisation_id) { console.warn('skip lead without org', l.id); continue; }
    const kind = /QUICK_CATCH$/i.test(l.source ?? '') ? 'quick-catch' : 'lead';
    const next = [];
    for (const [i, p] of l.photos.entries()) {
      if (!isData(p)) { next.push(p); continue; }
      photos++;
      let objectPath = byHash.get(md5(p));
      if (!objectPath) {
        objectPath = `${l.organisation_id}/${kind}/${l.id}/${i + 1}.jpg`;
        await put(objectPath, p);
      }
      next.push(objectPath);
    }
    if (APPLY) {
      const { error: upErr } = await sb.from('leads').update({ photos: next }).eq('id', l.id);
      if (upErr) fail(`update lead ${l.id}`, upErr);
    }
  }
  leadsDone += todo.length;
  leadPhotos += photos;
  const skipped = rows.length - todo.length;
  console.log(`batch ${b + 1}/${leadBatches.length} — ${todo.length} leads, ${photos} photos${skipped ? ` (${skipped} skipped, no base64)` : ''}`);
}

fs.closeSync(backupFd);
console.log(`backup: ${backupFile} (${ipDone} inspection_photos, ${leadsDone} leads, ${(backupBytes / 1048576).toFixed(1)} MB)`);
console.log(APPLY
  ? `done: ${ipDone} inspection_photos, ${leadsDone} leads, ${leadPhotos} lead photos`
  : 'dry run only: nothing uploaded or updated. Re-run with --apply.');
