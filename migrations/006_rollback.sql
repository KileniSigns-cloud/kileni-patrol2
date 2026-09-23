-- Rollback for 006_patrol_media_bucket.sql.
-- The four restored policies match the live pg_policies rows captured 2026-09-23 before
-- 006 was applied (same PERMISSIVE flag, roles, USING and WITH CHECK).
-- Photos already uploaded to patrol-media are NOT removed; rows that point at them
-- will stop rendering once the read policy is gone.

BEGIN;

-- ── Restore the patrol-photos policies 006 dropped ───────────────────────────
DROP POLICY IF EXISTS "Authenticated Uploads" ON storage.objects;
CREATE POLICY "Authenticated Uploads" ON storage.objects
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (bucket_id = 'patrol-photos'::text);

DROP POLICY IF EXISTS "Authenticated Updates" ON storage.objects;
CREATE POLICY "Authenticated Updates" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO public
  USING (bucket_id = 'patrol-photos'::text);

-- ── Restore the anonymous inspection-table policies 006 dropped ─────────────
DROP POLICY IF EXISTS anon_read_inspections ON public.sign_inspections;
CREATE POLICY anon_read_inspections ON public.sign_inspections
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS anon_insert_photos ON public.inspection_photos;
CREATE POLICY anon_insert_photos ON public.inspection_photos
  AS PERMISSIVE FOR INSERT TO anon
  WITH CHECK (true);

-- ── Remove the patrol-media policies ─────────────────────────────────────────
DROP POLICY IF EXISTS "patrol-media org read" ON storage.objects;
DROP POLICY IF EXISTS "patrol-media org upload" ON storage.objects;

-- ── Remove the bucket only if it is empty ────────────────────────────────────
-- storage.protect_delete() blocks direct deletes unless storage.allow_delete_query is
-- set for the transaction. A bucket that already holds photos is kept (use the Storage
-- API to empty it first if it really must go).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'patrol-media') THEN
    RAISE NOTICE 'patrol-media is not empty: bucket kept';
  ELSE
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    DELETE FROM storage.buckets WHERE id = 'patrol-media';
  END IF;
END $$;

COMMIT;
