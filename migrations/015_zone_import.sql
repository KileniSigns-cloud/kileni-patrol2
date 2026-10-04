-- 015: Zone upsert from an admin CSV: creates or updates zones (patrol_routes rows), matched by
-- zone code. Replaces import_routes (013), which is dropped here: it wrote the old turn-by-turn
-- columns that zones no longer use.
--
-- Requires 014 (the corners / anchors / est_minutes columns and the patrol_zone_* validators).
--
-- import_zones(p_rows, p_dry_run, p_fingerprint):
--   * p_dry_run = true (the default): checks every row and returns, per row, NEW / UPDATE /
--     UNCHANGED with old and new values for each changed field, the full stored row of each zone
--     it would update (for the backup CSV), and a fingerprint. Writes nothing.
--   * p_dry_run = false: re-runs the same checks and applies, but only if the fingerprint still
--     matches, i.e. the same payload and the same stored values the admin previewed and backed up.
--   Any problem raises and nothing is written (one transaction).
--
-- Row keys: row, zone_code, zone_name, area_type, corners, anchors, focus, est_minutes, status.
-- Any other key (organisation_id included) is ignored: only these are read.
--
-- Rules:
--   * Codes match on upper(collapse-spaces(trim(code))), within the caller's organisation only.
--     A code is letters, digits, single spaces and hyphens: ^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$, max 30.
--   * One-line text (name, area type, corner labels, anchor names and addresses) is trimmed and
--     runs of spaces, tabs and line breaks become one space. Focus keeps its line breaks.
--   * A new zone needs zone_name, area_type and 4 to 8 corners.
--   * zone_name may not contain the zone's own code ("CON-01: Concord" is rejected).
--   * Existing zone: only non-blank fields are written; a blank never erases. corners and anchors
--     replace the whole list when given. A retired zone in the file is updated and stays retired
--     unless status says otherwise.
--   * status: 'active' clears archived_at, 'retired' sets it (kept if already set), blank keeps it.
--   * Corners: 4 to 8 objects {label, lat?, lng?}; label 1-100 characters, no "|"; lat and lng
--     both or neither, numbers, -90..90 and -180..180, rounded to 6 decimals. Anchors: up to 30
--     {name, address?}; name 1-150, address up to 300. est_minutes: whole number 1-1440.
--   * Zones not in the file are untouched. Nothing is deleted.
--   * 1 to 500 rows, payload at most 2 MB.
--   * Text is stored as plain text and must be rendered as text (React escapes it). Rejected in
--     every text value: C0 controls (except tab/LF/CR), DEL, zero-width and direction marks
--     (U+200B-U+200F), bidi embeddings/overrides/isolates (U+202A-U+202E, U+2066-U+2069),
--     line/paragraph separators (U+2028, U+2029) and BOM (U+FEFF).
--   * The 014 CHECK constraints still apply to everything written.
--
-- Why SECURITY DEFINER (same reasoning as 010 and 013): matching must see every zone in the
-- organisation, retired ones included, and the rules live in one place. The function checks the
-- caller itself (signed in, active admin) and scopes every read and write to get_user_org_id().
-- No dynamic SQL: every statement is static, rows are read with jsonb_to_recordset.
-- Work tables are always written pg_temp.<name>: search_path lists public before pg_temp, so an
-- unqualified name could resolve to a same-named table in public.
--
-- Codes are unique per organisation (patrol_routes_org_code_unique and, since 014,
-- uq_patrol_routes_org_code_norm). If an insert still collides (a zone created from the form
-- during the import), the error is replaced by a generic message: the key is never echoed back.
--
-- Grants: new functions in public get EXECUTE for anon by default on this project, so it is
-- revoked explicitly below. No table is created or altered.
--
-- Rollback: migrations/015_rollback.sql

BEGIN;

DROP FUNCTION IF EXISTS public.import_routes(jsonb, boolean, text);

CREATE OR REPLACE FUNCTION public.import_zones(
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
  -- Characters rejected in every text value (see the header).
  c_bad     constant text := '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Import failed: you are signed out.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'Import failed: only admins can import zones.' USING ERRCODE = '42501';
  END IF;
  v_org := public.get_user_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Import failed: your profile has no organisation.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Import failed: expected a list of rows.' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_rows::text) > 2000000 THEN
    RAISE EXCEPTION 'Import failed: the file is too large (over 2 MB of zone text).' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count < 1 OR v_count > 500 THEN
    RAISE EXCEPTION 'Import failed: a file must have 1 to 500 zones (it has %).', v_count
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) e WHERE jsonb_typeof(e) <> 'object') THEN
    RAISE EXCEPTION 'Import failed: every row must be an object.' USING ERRCODE = '22023';
  END IF;

  -- One import per organisation at a time (two admins can't both create the same code).
  PERFORM pg_advisory_xact_lock(hashtextextended('import_zones:' || v_org::text, 0));

  -- Rows, with one-line text trimmed and collapsed, focus trimmed, status lower-cased.
  DROP TABLE IF EXISTS pg_temp.zone_csv_import;
  CREATE TEMP TABLE pg_temp.zone_csv_import ON COMMIT DROP AS
  SELECT r."row"                                                                   AS row_no,
         upper(regexp_replace(btrim(coalesce(r.zone_code, '')), '\s+', ' ', 'g'))  AS code,
         nullif(btrim(regexp_replace(coalesce(r.zone_name, ''), '[ \t\r\n]+', ' ', 'g')), '') AS name,
         nullif(btrim(regexp_replace(coalesce(r.area_type, ''), '[ \t\r\n]+', ' ', 'g')), '') AS area_type,
         nullif(btrim(regexp_replace(coalesce(r.focus, ''), '\r\n?', E'\n', 'g'), E' \t\r\n'), '') AS focus,
         nullif(btrim(coalesce(r.est_minutes, '')), '')                            AS est_in,
         nullif(lower(btrim(coalesce(r.status, ''))), '')                          AS status,
         r.corners                                                                 AS corners_in,
         r.anchors                                                                 AS anchors_in,
         NULL::jsonb       AS corners,
         NULL::jsonb       AS anchors,
         NULL::integer     AS est_minutes,
         NULL::uuid        AS route_id,
         NULL::timestamp   AS archived_at,
         0                 AS matches
    FROM jsonb_to_recordset(p_rows) AS r("row" integer, zone_code text, zone_name text, area_type text,
         corners jsonb, anchors jsonb, focus text, est_minutes text, status text);

  -- Match existing zones in the caller's organisation, retired ones included. `matches` > 1 can't
  -- happen since 014 (normalised unique index); it is still reported, never guessed.
  UPDATE pg_temp.zone_csv_import i
     SET route_id = m.id, archived_at = m.archived_at, matches = m.n
    FROM (
      SELECT upper(regexp_replace(btrim(r.code), '\s+', ' ', 'g')) AS k,
             min(r.id::text)::uuid AS id, max(r.archived_at) AS archived_at, count(*) AS n
        FROM public.patrol_routes r
       WHERE r.organisation_id = v_org AND r.code IS NOT NULL
       GROUP BY 1
    ) m
   WHERE m.k = i.code;

  -- Corner and anchor elements, one row each, cleaned. Shape problems are listed per element.
  DROP TABLE IF EXISTS pg_temp.zone_csv_corner;
  CREATE TEMP TABLE pg_temp.zone_csv_corner ON COMMIT DROP AS
  SELECT i.row_no, t.ord::integer AS n, t.e,
         CASE WHEN jsonb_typeof(t.e -> 'label') = 'string'
              THEN btrim(regexp_replace(t.e ->> 'label', '[ \t\r\n]+', ' ', 'g')) END AS label,
         t.e -> 'lat' AS lat, t.e -> 'lng' AS lng
    FROM pg_temp.zone_csv_import i
    CROSS JOIN LATERAL jsonb_array_elements(i.corners_in) WITH ORDINALITY AS t(e, ord)
   WHERE jsonb_typeof(i.corners_in) = 'array';

  DROP TABLE IF EXISTS pg_temp.zone_csv_anchor;
  CREATE TEMP TABLE pg_temp.zone_csv_anchor ON COMMIT DROP AS
  SELECT i.row_no, t.ord::integer AS n, t.e,
         CASE WHEN jsonb_typeof(t.e -> 'name') = 'string'
              THEN btrim(regexp_replace(t.e ->> 'name', '[ \t\r\n]+', ' ', 'g')) END AS name,
         CASE WHEN jsonb_typeof(t.e -> 'address') = 'string'
              THEN nullif(btrim(regexp_replace(t.e ->> 'address', '[ \t\r\n]+', ' ', 'g')), '') END AS address
    FROM pg_temp.zone_csv_import i
    CROSS JOIN LATERAL jsonb_array_elements(i.anchors_in) WITH ORDINALITY AS t(e, ord)
   WHERE jsonb_typeof(i.anchors_in) = 'array';

  -- Every problem, per row (the browser ran the same checks; this is the one that counts).
  SELECT coalesce(jsonb_agg(jsonb_build_object('row', row_no, 'error', msg) ORDER BY row_no NULLS FIRST, msg), '[]'::jsonb)
    INTO v_errors
    FROM (
      SELECT i.row_no, unnest(array_remove(ARRAY[
        CASE WHEN i.row_no IS NULL THEN 'row number missing' END,
        CASE WHEN i.code = ''                                   THEN 'zone_code is required'
             WHEN char_length(i.code) > 30                      THEN 'zone_code is over 30 characters'
             WHEN i.code !~ '^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$'  THEN 'zone_code can only use letters, digits, spaces and hyphens'
        END,
        CASE WHEN i.code <> '' AND (SELECT count(*) FROM pg_temp.zone_csv_import d WHERE d.code = i.code) > 1
             THEN 'zone_code ' || i.code || ' is on more than one row (rows '
                  || (SELECT string_agg(d.row_no::text, ', ' ORDER BY d.row_no) FROM pg_temp.zone_csv_import d WHERE d.code = i.code) || ')'
        END,
        CASE WHEN i.row_no IS NOT NULL AND (SELECT count(*) FROM pg_temp.zone_csv_import d WHERE d.row_no = i.row_no) > 1
             THEN 'row number used twice' END,
        CASE WHEN i.matches > 1 THEN 'zone_code ' || i.code || ' matches more than one existing zone' END,
        CASE WHEN i.route_id IS NULL AND i.code <> '' AND i.name IS NULL      THEN 'zone_name is required for a new zone' END,
        CASE WHEN i.route_id IS NULL AND i.code <> '' AND i.area_type IS NULL THEN 'area_type is required for a new zone' END,
        CASE WHEN i.route_id IS NULL AND i.code <> ''
              AND (i.corners_in IS NULL OR jsonb_typeof(i.corners_in) = 'null') THEN 'corners are required for a new zone (4 to 8)' END,
        CASE WHEN char_length(i.name) > 100       THEN 'zone_name is over 100 characters' END,
        CASE WHEN char_length(i.area_type) > 200  THEN 'area_type is over 200 characters' END,
        CASE WHEN char_length(i.focus) > 1000     THEN 'focus is over 1000 characters' END,
        CASE WHEN concat(i.name, i.area_type, i.focus) ~ c_bad THEN 'text contains control or invisible characters' END,
        -- The name check builds a regex from the code, so it only runs for a validated code
        -- (letters, digits, spaces, hyphens): CASE, unlike AND, guarantees the order.
        CASE WHEN i.name IS NOT NULL AND char_length(i.code) <= 30
              AND i.code ~ '^[A-Z0-9]([A-Z0-9 -]*[A-Z0-9])?$'
             THEN CASE WHEN upper(i.name) ~ ('(^|[^A-Z0-9])' || regexp_replace(i.code, '[ -]+', '[ -]*', 'g') || '($|[^A-Z0-9])')
                       THEN 'zone_name contains the code ' || i.code || ': leave the code out of the name' END
        END,
        CASE WHEN i.est_in IS NULL THEN NULL
             WHEN i.est_in !~ '^[0-9]{1,4}$' THEN 'est_minutes must be a whole number of minutes'
             WHEN i.est_in::integer NOT BETWEEN 1 AND 1440 THEN 'est_minutes must be between 1 and 1440'
        END,
        CASE WHEN i.status IS NOT NULL AND i.status NOT IN ('active', 'retired')
             THEN 'status must be active or retired (or blank to keep it)' END,
        CASE WHEN i.corners_in IS NULL OR jsonb_typeof(i.corners_in) = 'null' THEN NULL
             WHEN jsonb_typeof(i.corners_in) <> 'array' THEN 'corners must be a list'
             WHEN jsonb_array_length(i.corners_in) < 4 THEN 'at least 4 corners are required (found ' || jsonb_array_length(i.corners_in) || ')'
             WHEN jsonb_array_length(i.corners_in) > 8 THEN 'at most 8 corners'
        END,
        CASE WHEN i.anchors_in IS NULL OR jsonb_typeof(i.anchors_in) = 'null' THEN NULL
             WHEN jsonb_typeof(i.anchors_in) <> 'array' THEN 'anchors must be a list'
             WHEN jsonb_array_length(i.anchors_in) > 30 THEN 'more than 30 anchors'
        END
      ], NULL)) AS msg
      FROM pg_temp.zone_csv_import i
      UNION ALL
      SELECT c.row_no, 'corner ' || c.n || ': ' || CASE
               WHEN jsonb_typeof(c.e) <> 'object' THEN 'must be an object'
               WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(c.e) k(key) WHERE k.key NOT IN ('label', 'lat', 'lng'))
                                                                THEN 'only label, lat and lng are allowed'
               WHEN c.label IS NULL OR c.label = ''             THEN 'the intersection is required'
               WHEN char_length(c.label) > 100                  THEN 'over 100 characters'
               WHEN position('|' IN c.label) > 0                THEN '"|" is not allowed (Google Maps uses it to separate stops)'
               WHEN c.label ~ c_bad                             THEN 'contains control or invisible characters'
               WHEN (c.lat IS NULL) <> (c.lng IS NULL)          THEN 'GPS needs both lat and lng'
               WHEN c.lat IS NULL                               THEN NULL
               WHEN jsonb_typeof(c.lat) <> 'number' OR jsonb_typeof(c.lng) <> 'number' THEN 'GPS lat and lng must be numbers'
               WHEN (c.lat #>> '{}')::numeric NOT BETWEEN -90 AND 90    THEN 'GPS latitude must be between -90 and 90'
               WHEN (c.lng #>> '{}')::numeric NOT BETWEEN -180 AND 180  THEN 'GPS longitude must be between -180 and 180'
             END
        FROM pg_temp.zone_csv_corner c
      UNION ALL
      SELECT a.row_no, 'anchor ' || a.n || ': ' || CASE
               WHEN jsonb_typeof(a.e) <> 'object' THEN 'must be an object'
               WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(a.e) k(key) WHERE k.key NOT IN ('name', 'address'))
                                                                THEN 'only name and address are allowed'
               WHEN a.name IS NULL OR a.name = ''               THEN 'name is required'
               WHEN char_length(a.name) > 150                   THEN 'name is over 150 characters'
               WHEN a.e ? 'address' AND jsonb_typeof(a.e -> 'address') NOT IN ('string', 'null') THEN 'address must be text'
               WHEN char_length(a.address) > 300                THEN 'address is over 300 characters'
               WHEN concat(a.name, a.address) ~ c_bad           THEN 'contains control or invisible characters'
             END
        FROM pg_temp.zone_csv_anchor a
    ) x
   WHERE msg IS NOT NULL;

  IF jsonb_array_length(v_errors) > 0 THEN
    IF p_dry_run THEN
      RETURN jsonb_build_object('status', 'invalid', 'errors', v_errors);
    END IF;
    RAISE EXCEPTION 'Import failed: % problem(s) in the file. Nothing was changed.', jsonb_array_length(v_errors)
      USING ERRCODE = '22023', DETAIL = v_errors::text;
  END IF;

  -- Lists as stored: corners [{label, lat?, lng?}] (GPS rounded to 6 decimals), anchors
  -- [{name, address?}]. An empty anchor list = blank. The 014 validators confirm the result.
  UPDATE pg_temp.zone_csv_import i SET
    corners = (SELECT jsonb_agg(
                        CASE WHEN c.lat IS NULL THEN jsonb_build_object('label', c.label)
                             ELSE jsonb_build_object('label', c.label,
                                    'lat', trim_scale(round((c.lat #>> '{}')::numeric, 6)),
                                    'lng', trim_scale(round((c.lng #>> '{}')::numeric, 6)))
                        END ORDER BY c.n)
                 FROM pg_temp.zone_csv_corner c WHERE c.row_no = i.row_no),
    anchors = (SELECT jsonb_agg(
                        CASE WHEN a.address IS NULL THEN jsonb_build_object('name', a.name)
                             ELSE jsonb_build_object('name', a.name, 'address', a.address)
                        END ORDER BY a.n)
                 FROM pg_temp.zone_csv_anchor a WHERE a.row_no = i.row_no),
    est_minutes = i.est_in::integer;

  IF EXISTS (SELECT 1 FROM pg_temp.zone_csv_import i
              WHERE (i.corners IS NOT NULL AND NOT public.patrol_zone_corners_ok(i.corners))
                 OR (i.anchors IS NOT NULL AND NOT public.patrol_zone_anchors_ok(i.anchors))) THEN
    RAISE EXCEPTION 'Import failed: corners or anchors are not valid. Nothing was changed.' USING ERRCODE = '22023';
  END IF;

  -- Lock the zones this import touches, then fingerprint exactly what the admin previewed:
  -- the payload plus the stored rows it would overwrite.
  PERFORM 1 FROM public.patrol_routes r
   WHERE r.id IN (SELECT route_id FROM pg_temp.zone_csv_import WHERE route_id IS NOT NULL)
   ORDER BY r.id
   FOR UPDATE;

  v_fp := md5(p_rows::text || '|' || coalesce(
            (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)::text
               FROM public.patrol_routes r
              WHERE r.id IN (SELECT route_id FROM pg_temp.zone_csv_import WHERE route_id IS NOT NULL)), ''));

  IF NOT p_dry_run AND p_fingerprint IS DISTINCT FROM v_fp THEN
    RAISE EXCEPTION 'Import failed: the zones changed since the preview. Preview again and download a new backup.'
      USING ERRCODE = '40001';
  END IF;

  -- Per-row plan: changed fields only (non-blank and different from what is stored).
  DROP TABLE IF EXISTS pg_temp.zone_csv_plan;
  CREATE TEMP TABLE pg_temp.zone_csv_plan ON COMMIT DROP AS
  SELECT i.row_no, i.code, i.route_id,
         ch.changes,
         -- The whole stored row before the change: the app writes the backup CSV from it, so
         -- the backup is exactly the state the fingerprint covers.
         CASE WHEN i.route_id IS NOT NULL AND ch.changes <> '{}'::jsonb THEN to_jsonb(r) END AS before,
         CASE WHEN i.route_id IS NULL THEN 'new'
              WHEN ch.changes = '{}'::jsonb THEN 'unchanged'
              ELSE 'update' END AS action
    FROM pg_temp.zone_csv_import i
    LEFT JOIN public.patrol_routes r ON r.id = i.route_id
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_object_agg(f, jsonb_build_object('old', o, 'new', n)), '{}'::jsonb) AS changes
        FROM (VALUES
          ('zone_name',   to_jsonb(r.name),        to_jsonb(i.name)),
          ('area_type',   to_jsonb(r.area_type),   to_jsonb(i.area_type)),
          ('corners',     r.corners,               i.corners),
          ('anchors',     r.anchors,               i.anchors),
          ('focus',       to_jsonb(r.focus),       to_jsonb(i.focus)),
          ('est_minutes', to_jsonb(r.est_minutes), to_jsonb(i.est_minutes)),
          ('status',      CASE WHEN i.route_id IS NULL THEN NULL
                               WHEN r.archived_at IS NULL THEN to_jsonb('active'::text)
                               ELSE to_jsonb('retired'::text) END,
                          to_jsonb(i.status))
        ) v(f, o, n)
       WHERE n IS NOT NULL AND n IS DISTINCT FROM o
    ) ch;

  IF NOT p_dry_run THEN
    BEGIN
      UPDATE public.patrol_routes r SET
        name        = coalesce(i.name,        r.name),
        area_type   = coalesce(i.area_type,   r.area_type),
        corners     = coalesce(i.corners,     r.corners),
        anchors     = coalesce(i.anchors,     r.anchors),
        focus       = coalesce(i.focus,       r.focus),
        est_minutes = coalesce(i.est_minutes, r.est_minutes),
        archived_at = CASE i.status
                        WHEN 'retired' THEN coalesce(r.archived_at, now()::timestamp)
                        WHEN 'active'  THEN NULL
                        ELSE r.archived_at
                      END
        FROM pg_temp.zone_csv_import i
        JOIN pg_temp.zone_csv_plan p ON p.row_no = i.row_no
       WHERE r.id = i.route_id
         AND r.organisation_id = v_org
         AND p.action = 'update';

      WITH created AS (
        INSERT INTO public.patrol_routes
          (organisation_id, code, name, area_type, corners, anchors, focus, est_minutes, archived_at)
        SELECT v_org, i.code, i.name, i.area_type, i.corners, i.anchors, i.focus, i.est_minutes,
               CASE WHEN i.status = 'retired' THEN now()::timestamp END
          FROM pg_temp.zone_csv_import i
         WHERE i.route_id IS NULL
         ORDER BY i.row_no
        RETURNING id, code
      )
      UPDATE pg_temp.zone_csv_plan p SET route_id = c.id FROM created c WHERE p.code = c.code AND p.action = 'new';
    EXCEPTION WHEN unique_violation THEN
      -- Never pass on the constraint's DETAIL (it would echo the colliding key).
      RAISE EXCEPTION 'Import failed: a zone code in the file was taken while importing. Nothing was changed. Preview again.'
        USING ERRCODE = '23505';
    END;
  END IF;

  SELECT jsonb_build_object(
           'status',      CASE WHEN p_dry_run THEN 'preview' ELSE 'applied' END,
           'fingerprint', v_fp,
           'created',     count(*) FILTER (WHERE action = 'new'),
           'updated',     count(*) FILTER (WHERE action = 'update'),
           'unchanged',   count(*) FILTER (WHERE action = 'unchanged'),
           'zones',       jsonb_agg(jsonb_build_object(
                            'row', row_no, 'code', code, 'route_id', route_id,
                            'action', action, 'changes', changes, 'before', before) ORDER BY row_no))
    INTO v_result
    FROM pg_temp.zone_csv_plan;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.import_zones(jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_zones(jsonb, boolean, text) TO authenticated;

COMMIT;

-- Verify after applying (SELECT only):
--   select proname, prosecdef, proconfig, array_to_string(proacl, ',') from pg_proc
--    where proname in ('import_zones', 'import_routes');
--   -> one row, import_zones: prosecdef = true; search_path=public, pg_temp;
--      EXECUTE for authenticated, no anon, no "=X" (PUBLIC). No import_routes row.
--   select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'patrol_routes';
--   -> unchanged (16).
