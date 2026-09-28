-- Rollback for 010_route_safe_delete.sql.
-- Removes the function; routes can then no longer be deleted from the app (as before 010).
-- Routes already deleted through it are not restored.

BEGIN;

DROP FUNCTION IF EXISTS public.delete_route_if_unused(uuid, boolean);

COMMIT;
