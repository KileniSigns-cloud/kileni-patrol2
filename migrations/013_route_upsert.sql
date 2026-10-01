-- 013: Route upsert from an admin CSV: creates or updates routes, matched by route code.
--
-- No new columns: all eight CSV fields already exist on patrol_routes (checked live 2026-10-01):
--   route_code -> code, route_name -> name, description, area_type, start_point, focus,
--   hotspots -> hotspots (jsonb array of strings), turn_by_turn -> steps (jsonb [{id, label}],
--   the shape PATROL v1's AddRoutePage writes and 15 live routes already use).
-- Directions are read-only: no progress tracking, no step state.
--
-- import_routes(p_rows, p_dry_run, p_fingerprint):
--   * p_dry_run = true (the default): checks every row and returns, per row, NEW / UPDATE /
--     UNCHANGED with old and new values for each changed field, the full stored row of each
--     route it would update (for the backup CSV), and a fingerprint. Writes nothing.
--   * p_dry_run = false: re-runs the same checks and applies, but only if the fingerprint still
--     matches, i.e. the same payload and the same stored values the admin previewed and backed up.
--   Any problem raises and nothing is written (one transaction).
--
-- Rules:
--   * Codes match on upper(collapse-spaces(trim(code))), within the caller's organisation only.
--     New routes are stored with the normalised code ("Grid MIS-01" -> "GRID MIS-01").
--     A code is letters, digits, single spaces and hyphens: ^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$
--     (all 27 live codes pass, checked 2026-10-01).
--   * Existing route: only non-blank fields are written; a blank cell never erases.
--     hotspots / turn_by_turn replace the whole list when given.
--   * An archived route in the file rejects the whole file (every such row is listed).
--   * Routes not in the file are untouched. Nothing is deleted.
--   * 1 to 500 rows, payload at most 2 MB.
--   * Text is stored as plain text and must be rendered as text (React escapes it). Rejected in
--     every text field: C0 controls (except tab/LF/CR), DEL, zero-width and direction marks
--     (U+200B-U+200F), bidi embeddings/overrides/isolates (U+202A-U+202E, U+2066-U+2069),
--     line/paragraph separators (U+2028, U+2029) and BOM/zero-width no-break space (U+FEFF).
--     Line breaks are allowed only in description and focus.
--
-- Why SECURITY DEFINER (same reasoning as 010): matching and the archived check must see every
-- route in the organisation, and the rules live in one place. The function checks the caller
-- itself (signed in, active admin) and scopes every read and write to get_user_org_id().
-- No dynamic SQL: every statement is static, rows are read with jsonb_to_recordset.
-- Work tables are always written pg_temp.<name>: search_path lists public before pg_temp, so an
-- unqualified name could resolve to a same-named table in public.
--
-- Codes are unique per organisation (patrol_routes_org_code_unique UNIQUE (organisation_id, code)).
-- If an insert still collides (e.g. a route created from the form during the import), the error
-- is replaced by a generic message: the key is never echoed back.
--
-- Grants: new functions in public get EXECUTE for anon by default on this project
-- (pg_default_acl, checked 2026-10-01), so it is revoked explicitly below. No table is created.
--
-- Rollback: migrations/013_rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.import_routes(
  p_rows jsonb,
  p_dry_run boolean DEFAULT true,
  p_fingerprint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org     uuid;
  v_count   integer;
  v_errors  jsonb;
  v_fp      text;
  v_result  jsonb;
  -- Characters rejected in every text field (see the header).
  c_bad     constant text := '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Import failed: you are signed out.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Import failed: only admins can import routes.' USING ERRCODE = '42501';
  END IF;
  v_org := public.get_user_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Import failed: your profile has no organisation.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Import failed: expected a list of rows.' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_rows::text) > 2000000 THEN
    RAISE EXCEPTION 'Import failed: the file is too large (over 2 MB of route text).' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count < 1 OR v_count > 500 THEN
    RAISE EXCEPTION 'Import failed: a file must have 1 to 500 routes (it has %).', v_count
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) e WHERE jsonb_typeof(e) <> 'object') THEN
    RAISE EXCEPTION 'Import failed: every row must be an object.' USING ERRCODE = '22023';
  END IF;

  -- One import per organisation at a time (two admins can't both create the same code).
  PERFORM pg_advisory_xact_lock(hashtextextended('import_routes:' || v_org::text, 0));

  DROP TABLE IF EXISTS pg_temp.route_csv_import;
  CREATE TEMP TABLE pg_temp.route_csv_import ON COMMIT DROP AS
  SELECT r."row"                                                         AS row_no,
         upper(regexp_replace(btrim(coalesce(r.route_code, '')), '\s+', ' ', 'g')) AS code,
         nullif(btrim(r.route_name), '')                                 AS name,
         nullif(btrim(r.description), '')                                AS description,
         nullif(btrim(r.area_type), '')                                  AS area_type,
         nullif(btrim(r.start_point), '')                                AS start_point,
         nullif(btrim(r.focus), '')                                      AS focus,
         r.hotspots                                                      AS hotspots_in,
         r.turn_by_turn                                                  AS steps_in,
         NULL::jsonb       AS hotspots,
         NULL::jsonb       AS steps,
         NULL::uuid        AS route_id,
         NULL::timestamp   AS archived_at,
         0                 AS matches
    FROM jsonb_to_recordset(p_rows) AS r("row" integer, route_code text, route_name text,
         description text, area_type text, start_point text, focus text,
         hotspots jsonb, turn_by_turn jsonb);

  -- Match existing routes in the caller's organisation. `matches` > 1 would mean two stored
  -- codes normalise to the same key (none do today); that is reported, never guessed.
  UPDATE pg_temp.route_csv_import i
     SET route_id = m.id, archived_at = m.archived_at, matches = m.n
    FROM (
      SELECT upper(regexp_replace(btrim(r.code), '\s+', ' ', 'g')) AS k,
             min(r.id::text)::uuid AS id, max(r.archived_at) AS archived_at, count(*) AS n
        FROM public.patrol_routes r
       WHERE r.organisation_id = v_org AND r.code IS NOT NULL
       GROUP BY 1
    ) m
   WHERE m.k = i.code;

  -- Every problem, per row (the browser ran the same checks; this is the one that counts).
  SELECT coalesce(jsonb_agg(jsonb_build_object('row', row_no, 'error', msg) ORDER BY row_no NULLS FIRST, msg), '[]'::jsonb)
    INTO v_errors
    FROM (
      SELECT i.row_no, unnest(array_remove(ARRAY[
        CASE WHEN i.row_no IS NULL THEN 'row number missing' END,
        CASE WHEN i.code = ''                                   THEN 'route_code is required'
             WHEN char_length(i.code) > 30                      THEN 'route_code is over 30 characters'
             WHEN i.code !~ '^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$'  THEN 'route_code can only use letters, digits, spaces and hyphens'
        END,
        CASE WHEN i.code <> '' AND (SELECT count(*) FROM pg_temp.route_csv_import d WHERE d.code = i.code) > 1
             THEN 'route_code ' || i.code || ' is on more than one row (rows '
                  || (SELECT string_agg(d.row_no::text, ', ' ORDER BY d.row_no) FROM pg_temp.route_csv_import d WHERE d.code = i.code) || ')'
        END,
        CASE WHEN i.row_no IS NOT NULL AND (SELECT count(*) FROM pg_temp.route_csv_import d WHERE d.row_no = i.row_no) > 1
             THEN 'row number used twice' END,
        CASE WHEN i.matches > 1      THEN 'route_code ' || i.code || ' matches more than one existing route' END,
        CASE WHEN i.archived_at IS NOT NULL
             THEN 'route ' || i.code || ' is archived. Restore it on Manage routes first, or remove it from the file' END,
        CASE WHEN i.route_id IS NULL AND i.code <> '' AND i.name IS NULL THEN 'route_name is required for a new route' END,
        CASE WHEN concat(i.name, i.area_type, i.start_point) ~ '[\r\n\t]'
                                                    THEN 'route_name, area_type and start_point must be one line' END,
        CASE WHEN concat(i.name, i.description, i.area_type, i.start_point, i.focus) ~ c_bad
                                                    THEN 'text contains control or invisible characters' END,
        CASE WHEN char_length(i.name) > 100         THEN 'route_name is over 100 characters' END,
        CASE WHEN char_length(i.description) > 1000 THEN 'description is over 1000 characters' END,
        CASE WHEN char_length(i.area_type) > 200    THEN 'area_type is over 200 characters' END,
        CASE WHEN char_length(i.start_point) > 300  THEN 'start_point is over 300 characters' END,
        CASE WHEN char_length(i.focus) > 1000       THEN 'focus is over 1000 characters' END,
        CASE WHEN i.hotspots_in IS NULL OR jsonb_typeof(i.hotspots_in) = 'null' THEN NULL
             WHEN jsonb_typeof(i.hotspots_in) <> 'array'  THEN 'hotspots must be a list'
             WHEN jsonb_array_length(i.hotspots_in) > 30  THEN 'more than 30 hotspots'
             WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(i.hotspots_in) e
                           WHERE jsonb_typeof(e) <> 'string' OR btrim(e #>> '{}') = '' OR char_length(e #>> '{}') > 150)
                                                          THEN 'each hotspot must be 1 to 150 characters'
             WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(i.hotspots_in) e(x)
                           WHERE x ~ '[\r\n\t]' OR x ~ c_bad)
                                                          THEN 'a hotspot contains a line break, control or invisible character'
        END,
        CASE WHEN i.steps_in IS NULL OR jsonb_typeof(i.steps_in) = 'null' THEN NULL
             WHEN jsonb_typeof(i.steps_in) <> 'array'     THEN 'turn_by_turn must be a list'
             WHEN jsonb_array_length(i.steps_in) > 50     THEN 'more than 50 turn-by-turn steps'
             WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(i.steps_in) e
                           WHERE jsonb_typeof(e) <> 'string' OR btrim(e #>> '{}') = '' OR char_length(e #>> '{}') > 300)
                                                          THEN 'each turn-by-turn step must be 1 to 300 characters'
             WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(i.steps_in) e(x)
                           WHERE x ~ '[\r\n\t]' OR x ~ c_bad)
                                                          THEN 'a turn-by-turn step contains a line break, control or invisible character'
        END
      ], NULL)) AS msg
      FROM pg_temp.route_csv_import i
    ) x;

  IF jsonb_array_length(v_errors) > 0 THEN
    IF p_dry_run THEN
      RETURN jsonb_build_object('status', 'invalid', 'errors', v_errors);
    END IF;
    RAISE EXCEPTION 'Import failed: % problem(s) in the file. Nothing was changed.', jsonb_array_length(v_errors)
      USING ERRCODE = '22023', DETAIL = v_errors::text;
  END IF;

  -- Lists as stored: hotspots ["a","b"], steps [{"id":1,"label":"..."}]. An empty list = blank.
  UPDATE pg_temp.route_csv_import i SET
    hotspots = (SELECT jsonb_agg(btrim(e #>> '{}') ORDER BY o)
                  FROM jsonb_array_elements(i.hotspots_in) WITH ORDINALITY t(e, o)),
    steps    = (SELECT jsonb_agg(jsonb_build_object('id', o, 'label', btrim(e #>> '{}')) ORDER BY o)
                  FROM jsonb_array_elements(i.steps_in) WITH ORDINALITY t(e, o))
   WHERE jsonb_typeof(i.hotspots_in) = 'array' OR jsonb_typeof(i.steps_in) = 'array';

  -- Lock the routes this import touches, then fingerprint exactly what the admin previewed:
  -- the payload plus the stored rows it would overwrite.
  PERFORM 1 FROM public.patrol_routes r
   WHERE r.id IN (SELECT route_id FROM pg_temp.route_csv_import WHERE route_id IS NOT NULL)
   ORDER BY r.id
   FOR UPDATE;

  v_fp := md5(p_rows::text || '|' || coalesce(
            (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)::text
               FROM public.patrol_routes r
              WHERE r.id IN (SELECT route_id FROM pg_temp.route_csv_import WHERE route_id IS NOT NULL)), ''));

  IF NOT p_dry_run AND p_fingerprint IS DISTINCT FROM v_fp THEN
    RAISE EXCEPTION 'Import failed: the routes changed since the preview. Preview again and download a new backup.'
      USING ERRCODE = '40001';
  END IF;

  -- Per-row plan: changed fields only (non-blank and different from what is stored).
  DROP TABLE IF EXISTS pg_temp.route_csv_plan;
  CREATE TEMP TABLE pg_temp.route_csv_plan ON COMMIT DROP AS
  SELECT i.row_no, i.code, i.route_id,
         ch.changes,
         -- The whole stored row before the change: the app writes the backup CSV from it, so
         -- the backup is exactly the state the fingerprint covers.
         CASE WHEN i.route_id IS NOT NULL AND ch.changes <> '{}'::jsonb THEN to_jsonb(r) END AS before,
         CASE WHEN i.route_id IS NULL THEN 'new'
              WHEN ch.changes = '{}'::jsonb THEN 'unchanged'
              ELSE 'update' END AS action
    FROM pg_temp.route_csv_import i
    LEFT JOIN public.patrol_routes r ON r.id = i.route_id
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_object_agg(f, jsonb_build_object('old', o, 'new', n)), '{}'::jsonb) AS changes
        FROM (VALUES
          ('route_name',   to_jsonb(r.name),        to_jsonb(i.name)),
          ('description',  to_jsonb(r.description), to_jsonb(i.description)),
          ('area_type',    to_jsonb(r.area_type),   to_jsonb(i.area_type)),
          ('start_point',  to_jsonb(r.start_point), to_jsonb(i.start_point)),
          ('focus',        to_jsonb(r.focus),       to_jsonb(i.focus)),
          ('hotspots',     r.hotspots,              i.hotspots),
          ('turn_by_turn', r.steps,                 i.steps)
        ) v(f, o, n)
       WHERE n IS NOT NULL AND n IS DISTINCT FROM o
    ) ch;

  IF NOT p_dry_run THEN
    BEGIN
      UPDATE public.patrol_routes r SET
        name        = coalesce(i.name,        r.name),
        description = coalesce(i.description, r.description),
        area_type   = coalesce(i.area_type,   r.area_type),
        start_point = coalesce(i.start_point, r.start_point),
        focus       = coalesce(i.focus,       r.focus),
        hotspots    = coalesce(i.hotspots,    r.hotspots),
        steps       = coalesce(i.steps,       r.steps)
        FROM pg_temp.route_csv_import i
        JOIN pg_temp.route_csv_plan p ON p.row_no = i.row_no
       WHERE r.id = i.route_id
         AND r.organisation_id = v_org
         AND p.action = 'update';

      WITH created AS (
        INSERT INTO public.patrol_routes
          (organisation_id, code, name, description, area_type, start_point, focus, hotspots, steps)
        SELECT v_org, i.code, i.name, i.description, i.area_type, i.start_point, i.focus,
               coalesce(i.hotspots, '[]'::jsonb), i.steps
          FROM pg_temp.route_csv_import i
         WHERE i.route_id IS NULL
         ORDER BY i.row_no
        RETURNING id, code
      )
      UPDATE pg_temp.route_csv_plan p SET route_id = c.id FROM created c WHERE p.code = c.code AND p.action = 'new';
    EXCEPTION WHEN unique_violation THEN
      -- Never pass on the constraint's DETAIL (it would echo the colliding key).
      RAISE EXCEPTION 'Import failed: a route code in the file was taken while importing. Nothing was changed. Preview again.'
        USING ERRCODE = '23505';
    END;
  END IF;

  SELECT jsonb_build_object(
           'status',      CASE WHEN p_dry_run THEN 'preview' ELSE 'applied' END,
           'fingerprint', v_fp,
           'created',     count(*) FILTER (WHERE action = 'new'),
           'updated',     count(*) FILTER (WHERE action = 'update'),
           'unchanged',   count(*) FILTER (WHERE action = 'unchanged'),
           'routes',      jsonb_agg(jsonb_build_object(
                            'row', row_no, 'code', code, 'route_id', route_id,
                            'action', action, 'changes', changes, 'before', before) ORDER BY row_no))
    INTO v_result
    FROM pg_temp.route_csv_plan;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.import_routes(jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_routes(jsonb, boolean, text) TO authenticated;

COMMIT;

-- -- Verify after applying ----------------------------------------------------
--   select proname, prosecdef, proconfig, array_to_string(proacl, ',')
--   from pg_proc where proname = 'import_routes';
--   -> prosecdef = true; search_path=public, pg_temp; EXECUTE for authenticated, no anon, no "=X" (PUBLIC).
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'patrol_routes' order by ordinal_position;
--   -> unchanged (13 columns).
