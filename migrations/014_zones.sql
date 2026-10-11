-- 014: Zones on patrol_routes. Additive only: new columns, checks, a normalised unique code
-- index and narrower grants. No column is dropped or renamed; the old route columns
-- (description, start_point, hotspots, steps, assigned_rep) stay and the app stops writing them.
--
-- A zone is one patrol_routes row:
--   code         existing column. Now NOT NULL and stored normalised: upper case, single spaces,
--                letters/digits/spaces/hyphens, max 30. Prefixes are chosen per organisation.
--   name         existing column. Now 1-100 characters.
--   area_type    existing column. Now max 200 characters.
--   corners      NEW jsonb, 4 to 8 objects in perimeter order:
--                {"label": "Dufferin & Steeles"} or {"label": "Keele & Steeles", "lat": <number>, "lng": <number>}
--                A label may not contain "|": Google Maps uses it to separate waypoints.
--   anchors      NEW jsonb, 0 to 30 objects {"name": "<text>", "address": "<text>"} (address optional).
--   focus        existing column. Now max 1000 characters.
--   est_minutes  NEW integer, 1-1440.
--   status       no column: active = archived_at IS NULL, retired = archived_at IS NOT NULL.
--
-- corners stays nullable so the app that is live today keeps working until the zone build is
-- deployed. The zone form and import_zones (015) require 4 to 8 corners.
--
-- Pre-condition: the table is empty after the purge (0 rows, checked 2026-10-03). The guard
-- stops the migration, changing nothing, if any existing row breaks the new rules.
--
-- Rollback: migrations/014_rollback.sql

BEGIN;

-- Guard: existing rows must already meet the new rules (always true for an empty table).
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.patrol_routes
   WHERE code IS NULL
      OR char_length(code) > 30
      OR code !~ '^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$'
      OR position('  ' IN code) > 0
      OR char_length(btrim(name)) NOT BETWEEN 1 AND 100
      OR char_length(area_type) > 200
      OR char_length(focus) > 1000;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '014 stopped: % route row(s) do not meet the zone rules. Nothing was changed.', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
    FROM (SELECT 1
            FROM public.patrol_routes
           WHERE code IS NOT NULL
           GROUP BY organisation_id, upper(regexp_replace(btrim(code), '\s+', ' ', 'g'))
          HAVING count(*) > 1) d;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '014 stopped: % code(s) repeat within an organisation. Nothing was changed.', v_bad;
  END IF;
END;
$$;

-- Validators behind the CHECK constraints. Pure (no table reads), IMMUTABLE, fixed search_path.
-- Rejected in every text value: line breaks, tabs, C0 controls, DEL, zero-width and direction
-- marks, line/paragraph separators, bidi embeddings/overrides/isolates and BOM (same set as 013).
CREATE OR REPLACE FUNCTION public.patrol_zone_text_ok(p text, p_max integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT p IS NOT NULL
     AND p = btrim(p)
     AND char_length(p) BETWEEN 1 AND p_max
     AND p !~ '[\x01-\x1F\x7F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]'
$$;

CREATE OR REPLACE FUNCTION public.patrol_zone_corners_ok(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p) IS DISTINCT FROM 'array' THEN false
    WHEN jsonb_array_length(p) NOT BETWEEN 4 AND 8 THEN false
    ELSE NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p) AS e(v)
       WHERE CASE
               WHEN jsonb_typeof(e.v) <> 'object' THEN true
               WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(e.v) AS k(key)
                             WHERE k.key NOT IN ('label', 'lat', 'lng')) THEN true
               WHEN jsonb_typeof(e.v -> 'label') IS DISTINCT FROM 'string' THEN true
               WHEN NOT public.patrol_zone_text_ok(e.v ->> 'label', 100) THEN true
               WHEN position('|' IN e.v ->> 'label') > 0 THEN true
               WHEN (e.v ? 'lat') <> (e.v ? 'lng') THEN true
               WHEN NOT (e.v ? 'lat') THEN false
               WHEN jsonb_typeof(e.v -> 'lat') <> 'number' OR jsonb_typeof(e.v -> 'lng') <> 'number' THEN true
               WHEN (e.v ->> 'lat')::numeric NOT BETWEEN -90 AND 90 THEN true
               WHEN (e.v ->> 'lng')::numeric NOT BETWEEN -180 AND 180 THEN true
               ELSE false
             END
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.patrol_zone_anchors_ok(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p) IS DISTINCT FROM 'array' THEN false
    WHEN jsonb_array_length(p) > 30 THEN false
    ELSE NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p) AS e(v)
       WHERE CASE
               WHEN jsonb_typeof(e.v) <> 'object' THEN true
               WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(e.v) AS k(key)
                             WHERE k.key NOT IN ('name', 'address')) THEN true
               WHEN jsonb_typeof(e.v -> 'name') IS DISTINCT FROM 'string' THEN true
               WHEN NOT public.patrol_zone_text_ok(e.v ->> 'name', 150) THEN true
               WHEN NOT (e.v ? 'address') THEN false
               WHEN jsonb_typeof(e.v -> 'address') IS DISTINCT FROM 'string' THEN true
               WHEN NOT public.patrol_zone_text_ok(e.v ->> 'address', 300) THEN true
               ELSE false
             END
    )
  END
$$;

-- New zone columns.
ALTER TABLE public.patrol_routes
  ADD COLUMN IF NOT EXISTS corners     jsonb,
  ADD COLUMN IF NOT EXISTS anchors     jsonb,
  ADD COLUMN IF NOT EXISTS est_minutes integer;

-- Codes are required.
ALTER TABLE public.patrol_routes ALTER COLUMN code SET NOT NULL;

ALTER TABLE public.patrol_routes
  DROP CONSTRAINT IF EXISTS patrol_routes_code_format,
  DROP CONSTRAINT IF EXISTS patrol_routes_name_len,
  DROP CONSTRAINT IF EXISTS patrol_routes_area_type_len,
  DROP CONSTRAINT IF EXISTS patrol_routes_focus_len,
  DROP CONSTRAINT IF EXISTS patrol_routes_corners_shape,
  DROP CONSTRAINT IF EXISTS patrol_routes_anchors_shape,
  DROP CONSTRAINT IF EXISTS patrol_routes_est_minutes_range;

ALTER TABLE public.patrol_routes
  ADD CONSTRAINT patrol_routes_code_format
    CHECK (char_length(code) <= 30
           AND code ~ '^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$'
           AND position('  ' IN code) = 0),
  ADD CONSTRAINT patrol_routes_name_len
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  ADD CONSTRAINT patrol_routes_area_type_len
    CHECK (area_type IS NULL OR char_length(area_type) <= 200),
  ADD CONSTRAINT patrol_routes_focus_len
    CHECK (focus IS NULL OR char_length(focus) <= 1000),
  ADD CONSTRAINT patrol_routes_corners_shape
    CHECK (corners IS NULL OR public.patrol_zone_corners_ok(corners)),
  ADD CONSTRAINT patrol_routes_anchors_shape
    CHECK (anchors IS NULL OR public.patrol_zone_anchors_ok(anchors)),
  ADD CONSTRAINT patrol_routes_est_minutes_range
    CHECK (est_minutes IS NULL OR est_minutes BETWEEN 1 AND 1440);

-- One code per organisation, ignoring case and spacing. Another organisation may use the same
-- code. The old raw-text constraint patrol_routes_org_code_unique stays; both raise 23505.
CREATE UNIQUE INDEX IF NOT EXISTS uq_patrol_routes_org_code_norm
  ON public.patrol_routes (organisation_id, upper(regexp_replace(btrim(code), '\s+', ' ', 'g')));

-- Validators: signed-in users only. The inserting role needs EXECUTE for the CHECKs to run
-- (checked in PGlite: without it an admin insert fails with 42501), so authenticated keeps it.
REVOKE ALL ON FUNCTION public.patrol_zone_text_ok(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.patrol_zone_corners_ok(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.patrol_zone_anchors_ok(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patrol_zone_text_ok(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patrol_zone_corners_ok(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patrol_zone_anchors_ok(jsonb) TO authenticated;

-- Narrower table grants. RLS already gives anon no rows and has no DELETE policy, but TRUNCATE
-- ignores RLS. Deleting stays possible only through delete_route_if_unused (SECURITY DEFINER).
-- RLS policies are not touched: select_org, insert_admin, update_admin stay organisation-scoped.
REVOKE ALL ON TABLE public.patrol_routes FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.patrol_routes FROM authenticated;

COMMIT;

-- Verify after applying (SELECT only):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'patrol_routes' order by ordinal_position;
--   -> 16 columns; corners jsonb, anchors jsonb, est_minutes integer added; code is_nullable = NO.
--   select conname from pg_constraint where conrelid = 'public.patrol_routes'::regclass and contype = 'c' order by 1;
--   -> 7 rows, all patrol_routes_*.
--   select indexname from pg_indexes where schemaname = 'public' and tablename = 'patrol_routes' order by 1;
--   -> includes uq_patrol_routes_org_code_norm.
--   select grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'patrol_routes' and grantee in ('anon', 'authenticated') group by 1;
--   -> authenticated: INSERT,SELECT,UPDATE. No anon row.
--   select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'patrol_routes' order by 1;
--   -> unchanged: patrol_routes_insert_admin, patrol_routes_select_org, patrol_routes_update_admin.
--
-- Rollback (saved as migrations/014_rollback.sql in the build; shown here commented out).
-- WARNING: dropping the columns deletes every zone's corners, anchors and est_minutes.
-- Export patrol_routes to CSV first. Table grants are deliberately NOT widened again.
--   BEGIN;
--   DROP INDEX IF EXISTS public.uq_patrol_routes_org_code_norm;
--   ALTER TABLE public.patrol_routes
--     DROP CONSTRAINT IF EXISTS patrol_routes_code_format,
--     DROP CONSTRAINT IF EXISTS patrol_routes_name_len,
--     DROP CONSTRAINT IF EXISTS patrol_routes_area_type_len,
--     DROP CONSTRAINT IF EXISTS patrol_routes_focus_len,
--     DROP CONSTRAINT IF EXISTS patrol_routes_corners_shape,
--     DROP CONSTRAINT IF EXISTS patrol_routes_anchors_shape,
--     DROP CONSTRAINT IF EXISTS patrol_routes_est_minutes_range;
--   ALTER TABLE public.patrol_routes ALTER COLUMN code DROP NOT NULL;
--   ALTER TABLE public.patrol_routes
--     DROP COLUMN IF EXISTS corners,
--     DROP COLUMN IF EXISTS anchors,
--     DROP COLUMN IF EXISTS est_minutes;
--   DROP FUNCTION IF EXISTS public.patrol_zone_corners_ok(jsonb);
--   DROP FUNCTION IF EXISTS public.patrol_zone_anchors_ok(jsonb);
--   DROP FUNCTION IF EXISTS public.patrol_zone_text_ok(text, integer);
--   COMMIT;
