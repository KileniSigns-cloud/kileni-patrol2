-- Rollback for 015_zone_import.sql.
-- Removes the zone import function. Zones it created or updated stay as they are; to undo an
-- import, re-import the backup CSV the app downloaded before Confirm.
-- import_routes (013) is not recreated: it writes the old turn-by-turn columns. If ever needed,
-- re-run migrations/013_route_upsert.sql.

BEGIN;

DROP FUNCTION IF EXISTS public.import_zones(jsonb, boolean, text);

COMMIT;
