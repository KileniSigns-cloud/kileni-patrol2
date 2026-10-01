-- Rollback for 013_route_upsert.sql.
-- Removes the import function. Routes it created or updated stay as they are; to undo an
-- import, re-import the backup CSV the app downloaded before Confirm (see the plan for its limits).

BEGIN;

DROP FUNCTION IF EXISTS public.import_routes(jsonb, boolean, text);

COMMIT;
