-- 006: Private patrol-media bucket for PATROL photos; close anonymous writes to patrol-photos
-- and anonymous access to sign_inspections / inspection_photos.
--
-- New saves (route signs and Quick Catch) upload to patrol-media first and store the
-- object path in inspection_photos.photo_url and leads.photos. Paths are
-- {org_id}/{patrol|quick-catch}/{owner_id}/{file}; the first folder must be the caller's
-- organisation (same test as the leads RLS policies). BUILT reads them through signed URLs.
--
-- Deploy order: this migration, then BUILT (signed URLs), then patrol2.
-- Rollback: migrations/006_rollback.sql

BEGIN;

-- ── Bucket: private, images only, 5 MB per file ──────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('patrol-media', 'patrol-media', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- ── Org-scoped access (authenticated only) ───────────────────────────────────
CREATE POLICY "patrol-media org read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'patrol-media'
    AND (storage.foldername(name))[1] = (SELECT u.organisation_id::text FROM public.users u WHERE u.id = auth.uid())
  );

CREATE POLICY "patrol-media org upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'patrol-media'
    AND (storage.foldername(name))[1] = (SELECT u.organisation_id::text FROM public.users u WHERE u.id = auth.uid())
  );

-- No UPDATE or DELETE policies: the apps upload with upsert:false and never replace or
-- remove photos. Cleanup runs with the service role.

-- ── patrol-photos: these two were granted to role public, which includes anon ─
-- Authenticated uploads keep working through "Authenticated users can upload patrol photos".
DROP POLICY IF EXISTS "Authenticated Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Updates" ON storage.objects;

-- ── Inspection tables: close anonymous access ────────────────────────────────
-- anon could read every organisation's sign_inspections and insert any inspection_photos
-- row. patrol2 and BUILT only query these tables with a signed-in session, covered by
-- sign_inspections_select_org / sign_inspections_insert_org and inspection_photos_select_org /
-- inspection_photos_insert (both scoped to the caller's organisation).
DROP POLICY IF EXISTS anon_read_inspections ON public.sign_inspections;
DROP POLICY IF EXISTS anon_insert_photos ON public.inspection_photos;

COMMIT;
