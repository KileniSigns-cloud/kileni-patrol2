-- Rollback for 012_gps_accuracy.sql.
-- The function goes back to its 005 body FIRST: it reads b.gps_accuracy_m, so dropping the
-- column while it still refers to it would make every route-patrol sign save fail.
-- Accuracy values recorded while 012 was live are lost.

BEGIN;

CREATE OR REPLACE FUNCTION public.patrol_lead_for_inspection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b        patrol_businesses%ROWTYPE;
  v_org    uuid;
  v_lead   uuid;
  v_name   text;
  v_addr   text;
  v_lat    double precision;
  v_lng    double precision;
  v_issues text[] := COALESCE(NEW.condition, '{}');
BEGIN
  -- Quick Catch and business-less rows keep their own path.
  IF NEW.business_id IS NULL OR NEW.patrol_type::text = 'quick_catch' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO b FROM patrol_businesses WHERE id = NEW.business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sign not saved: business % not found for CRM lead', NEW.business_id;
  END IF;

  -- Organisation comes from the business, else its session's route. Never hardcoded.
  v_org := COALESCE(
    b.organisation_id,
    (SELECT r.organisation_id
       FROM patrol_sessions s
       JOIN patrol_routes r ON r.id = s.route_id
      WHERE s.id = b.session_id)
  );
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Sign not saved: no organisation for business %', b.id;
  END IF;

  v_name := patrol_normalize(b.name);
  v_addr := patrol_normalize(b.address);
  -- lat/lng: the pair AddBusinessPage writes and the app reads back.
  v_lat  := b.lat;
  v_lng  := b.lng;

  -- Serialise signs for the same business so two concurrent saves can't both insert.
  PERFORM pg_advisory_xact_lock(hashtext(v_org::text || ':' || COALESCE(NULLIF(v_name, ''), b.id::text)));

  -- 1) Open lead already created from this business row (same session).
  SELECT l.id INTO v_lead
    FROM leads l
   WHERE upper(l.source) = 'PATROL'
     AND l.source_id = b.id
     AND lower(l.status) IN ('new', 'contacted', 'quoted')
   ORDER BY l.created_at DESC
   LIMIT 1;

  -- 2) Revisit: open lead for the same business from an earlier session.
  IF v_lead IS NULL AND v_name <> '' THEN
    SELECT l.id INTO v_lead
      FROM leads l
     WHERE upper(l.source) = 'PATROL'
       AND l.organisation_id = v_org
       AND lower(l.status) IN ('new', 'contacted', 'quoted')
       AND patrol_normalize(l.business_name) = v_name
       AND (
             -- within 150 m when both have GPS (equirectangular approximation)
             (v_lat IS NOT NULL AND v_lng IS NOT NULL
              AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
              AND 6371000 * sqrt(
                    power(radians(l.latitude - v_lat), 2) +
                    power(radians(l.longitude - v_lng) * cos(radians((l.latitude + v_lat) / 2)), 2)
                  ) <= 150)
             -- or same normalised address
          OR (v_addr <> '' AND patrol_normalize(l.address) = v_addr)
           )
     ORDER BY l.created_at DESC
     LIMIT 1;
  END IF;

  IF v_lead IS NULL THEN
    -- 3) New lead: first sign at this business, or the previous lead is won/lost.
    INSERT INTO leads (
      source, source_id, organisation_id, business_name, address,
      latitude, longitude, sign_type, sign_category, issue_type, notes, status
    ) VALUES (
      'PATROL', b.id, v_org,
      COALESCE(NULLIF(trim(b.name), ''), 'Unnamed Business'), b.address,
      v_lat, v_lng,
      COALESCE(NEW.sign_type, ''), NEW.sign_category,
      NULLIF(array_to_string(v_issues, ', '), ''),
      b.notes, 'new'
    )
    RETURNING id INTO v_lead;
  ELSE
    -- Merge issues: existing first, then new ones, distinct, order preserved.
    UPDATE leads l SET
      issue_type = NULLIF(array_to_string(ARRAY(
        SELECT t.x FROM (
          SELECT s.x, min(s.o) AS o FROM (
            SELECT trim(u.x) AS x, u.o
              FROM unnest(string_to_array(COALESCE(l.issue_type, ''), ',')) WITH ORDINALITY AS u(x, o)
            UNION ALL
            SELECT trim(n.x), 100000 + n.o
              FROM unnest(v_issues) WITH ORDINALITY AS n(x, o)
          ) s
          WHERE s.x NOT IN ('', 'None')
          GROUP BY s.x
        ) t
        ORDER BY t.o
      ), ', '), ''),
      sign_type         = COALESCE(NULLIF(l.sign_type, ''), NEW.sign_type, ''),
      sign_category     = COALESCE(l.sign_category, NEW.sign_category),
      last_contact_date = NOW(),
      updated_at        = NOW()
    WHERE l.id = v_lead;
  END IF;

  -- Per-sign activity (same text as the old sync_inspection_to_built_crm).
  INSERT INTO lead_activities (lead_id, user_name, type, notes, created_at)
  VALUES (
    v_lead,
    COALESCE(NULLIF(trim(NEW.patroller_name), ''), 'Patroller'),
    'patrol_inspection',
    'Patrol inspection logged'
      || CASE
           WHEN NEW.sign_category IS NOT NULL AND NEW.sign_type IS NOT NULL
             THEN '. Sign: ' || NEW.sign_category || ' › ' || NEW.sign_type
           WHEN NEW.sign_type IS NOT NULL
             THEN '. Sign: ' || NEW.sign_type
           ELSE ''
         END
      || '. Conditions: ' || COALESCE(NULLIF(array_to_string(v_issues, ', '), ''), 'No issues noted')
      || CASE
           WHEN NULLIF(trim(COALESCE(NEW.notes, '')), '') IS NOT NULL
             THEN '. Notes: ' || trim(NEW.notes)
           ELSE ''
         END
      || CASE
           WHEN NEW.patrol_type IS NOT NULL
             THEN ' [' || NEW.patrol_type::text || ']'
           ELSE ''
         END,
    NOW()
  );

  NEW.lead_id := v_lead;
  RETURN NEW;
END;
$$;

ALTER TABLE public.patrol_businesses DROP COLUMN IF EXISTS gps_accuracy_m;
ALTER TABLE public.leads DROP COLUMN IF EXISTS gps_accuracy_m;

COMMIT;
