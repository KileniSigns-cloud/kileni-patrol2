// Moves base64 photos out of inspection_photos.photo_url and leads.photos into the private
// patrol-media bucket and replaces them with storage paths.
//
//   node scripts/backfill-photos-to-storage.mjs            # dry run (default): backup + plan only
//   node scripts/backfill-photos-to-storage.mjs --apply    # backup, upload, then update rows
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role: bypasses RLS; never ship it).
// Step 0 always writes every affected row, untouched, to backups/photos-backup-<ts>.json and
// reads the file back before anything else runs. With --apply, a row is updated only after
// its objects are uploaded and read back. Re-running skips values that are already paths.
// Requires migration 006 (bucket patrol-media).

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'patrol-media';
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

// ── Read affected rows ───────────────────────────────────────────────────────
const { data: ips, error: e1 } = await sb
  .from('inspection_photos')
  .select('id, inspection_id, business_id, photo_url, sign_inspections!inner(organisation_id)')
  .like('photo_url', 'data:%');
if (e1) fail('read inspection_photos', e1);

const { data: allLeads, error: e2 } = await sb
  .from('leads')
  .select('id, source, organisation_id, photos')
  .not('photos', 'is', null);
if (e2) fail('read leads', e2);
const leads = allLeads.filter((l) => Array.isArray(l.photos) && l.photos.some(isData));

// ── Step 0: local JSON backup of every affected row, before any write ───────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.resolve('backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `photos-backup-${stamp}.json`);
const backup = {
  created_at: new Date().toISOString(),
  supabase_url: SUPABASE_URL,
  inspection_photos: ips.map(({ id, inspection_id, business_id, photo_url }) => ({ id, inspection_id, business_id, photo_url })),
  leads: leads.map(({ id, source, organisation_id, photos }) => ({ id, source, organisation_id, photos })),
};
fs.writeFileSync(backupFile, JSON.stringify(backup));
const check = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
if (check.inspection_photos.length !== ips.length || check.leads.length !== leads.length) {
  throw new Error(`backup ${backupFile} did not read back complete; stopping before any write`);
}
console.log(`backup: ${backupFile} (${ips.length} inspection_photos, ${leads.length} leads, ${(fs.statSync(backupFile).size / 1048576).toFixed(1)} MB)`);

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
const byHash = new Map(); // md5(base64) → path, so identical lead photos reuse the object
for (const r of ips) {
  const org = r.sign_inspections?.organisation_id;
  if (!org) { console.warn('skip inspection_photo without org', r.id); continue; }
  const objectPath = `${org}/patrol/${r.inspection_id}/${r.id}.jpg`;
  await put(objectPath, r.photo_url);
  byHash.set(md5(r.photo_url), objectPath);
  if (APPLY) {
    const { error } = await sb.from('inspection_photos').update({ photo_url: objectPath })
      .eq('id', r.id).like('photo_url', 'data:%');
    if (error) fail(`update inspection_photos ${r.id}`, error);
  }
}

// ── 2) leads.photos: base64 entries → paths, other entries kept in place ────
for (const l of leads) {
  if (!l.organisation_id) { console.warn('skip lead without org', l.id); continue; }
  const kind = /QUICK_CATCH$/i.test(l.source ?? '') ? 'quick-catch' : 'lead';
  const next = [];
  for (const [i, p] of l.photos.entries()) {
    if (!isData(p)) { next.push(p); continue; }
    let objectPath = byHash.get(md5(p));
    if (!objectPath) {
      objectPath = `${l.organisation_id}/${kind}/${l.id}/${i + 1}.jpg`;
      await put(objectPath, p);
    }
    next.push(objectPath);
  }
  console.log(`${APPLY ? 'update' : '[dry] update'} lead ${l.id}: ${l.photos.length} photos`);
  if (APPLY) {
    const { error } = await sb.from('leads').update({ photos: next }).eq('id', l.id);
    if (error) fail(`update lead ${l.id}`, error);
  }
}

console.log(APPLY ? 'done' : 'dry run only: nothing uploaded or updated. Re-run with --apply.');
