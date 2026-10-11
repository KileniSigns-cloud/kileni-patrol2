-- Rollback for 014_zones.sql.
--
-- WARNING: dropping the columns deletes every zone's corners, anchors and est_minutes.
-- Export patrol_routes to CSV first (Manage zones, or the SQL Editor). Apply 015_rollback.sql
-- first if 015 is applied: import_zones uses the validators dropped here.
-- Table grants are deliberately NOT widened again.

BEGIN;
DROP INDEX IF EXISTS public.uq_patrol_routes_org_code_norm;
ALTER TABLE public.patrol_routes
  DROP CONSTRAINT IF EXISTS patrol_routes_code_format,
  DROP CONSTRAINT IF EXISTS patrol_routes_name_len,
  DROP CONSTRAINT IF EXISTS patrol_routes_area_type_len,
  DROP CONSTRAINT IF EXISTS patrol_routes_focus_len,
  DROP CONSTRAINT IF EXISTS patrol_routes_corners_shape,
  DROP CONSTRAINT IF EXISTS patrol_routes_anchors_shape,
  DROP CONSTRAINT IF EXISTS patrol_routes_est_minutes_range;
ALTER TABLE public.patrol_routes ALTER COLUMN code DROP NOT NULL;
ALTER TABLE public.patrol_routes
  DROP COLUMN IF EXISTS corners,
  DROP COLUMN IF EXISTS anchors,
  DROP COLUMN IF EXISTS est_minutes;
DROP FUNCTION IF EXISTS public.patrol_zone_corners_ok(jsonb);
DROP FUNCTION IF EXISTS public.patrol_zone_anchors_ok(jsonb);
DROP FUNCTION IF EXISTS public.patrol_zone_text_ok(text, integer);
COMMIT;
