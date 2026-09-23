-- Rollback for 005_one_patrol_lead_per_business.sql.
-- Function bodies are the live definitions (pg_get_functiondef) captured 2026-09-23
-- before 005 was applied; only CRLF line endings were normalised to LF.
-- Restores: on_patrol_business_added (lead per business row), the AFTER INSERT
-- on_patrol_inspection_saved (activity only), and the original photo function.
-- Leads, lead_activities and photos written while 005 was live are NOT removed.

BEGIN;

-- ── sign_inspections: back to the AFTER INSERT activity-only trigger ─────────
DROP TRIGGER IF EXISTS on_patrol_inspection_saved ON public.sign_inspections;

CREATE OR REPLACE FUNCTION public.sync_inspection_to_built_crm()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_lead_id         uuid;
  v_condition_text  text;
  v_activity_notes  text;
BEGIN
  -- ── Look up matching lead ────────────────────────────────────────────────
  SELECT id INTO v_lead_id
  FROM leads
  WHERE source = 'PATROL' AND source_id = NEW.business_id
  LIMIT 1;

  -- No lead for this business yet — nothing to update
  IF v_lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ── Build condition summary from text[] array ────────────────────────────
  v_condition_text := COALESCE(
    NULLIF(array_to_string(NEW.condition, ', '), ''),
    'No issues noted'
  );

  -- ── Compose activity note ────────────────────────────────────────────────
  v_activity_notes :=
    'Patrol inspection logged'
    -- Sign detail (sign_category › sign_type when both present)
    || CASE
         WHEN NEW.sign_category IS NOT NULL AND NEW.sign_type IS NOT NULL
           THEN '. Sign: ' || NEW.sign_category || ' › ' || NEW.sign_type
         WHEN NEW.sign_type IS NOT NULL
           THEN '. Sign: ' || NEW.sign_type
         ELSE ''
       END
    -- Conditions
    || '. Conditions: ' || v_condition_text
    -- Free-text notes (optional)
    || CASE
         WHEN NULLIF(trim(COALESCE(NEW.notes, '')), '') IS NOT NULL
           THEN '. Notes: ' || trim(NEW.notes)
         ELSE ''
       END
    -- Patrol type context
    || CASE
         WHEN NEW.patrol_type IS NOT NULL
           THEN ' [' || NEW.patrol_type::text || ']'
         ELSE ''
       END;

  -- ── a) Update lead recency + sign details ────────────────────────────────
  UPDATE leads SET
    last_contact_date = NOW(),
    -- Only backfill sign fields if the lead doesn't have them yet
    sign_type     = COALESCE(leads.sign_type,     NEW.sign_type),
    sign_category = COALESCE(leads.sign_category, NEW.sign_category),
    updated_at    = NOW()
  WHERE id = v_lead_id;

  -- ── b) Insert activity log entry ─────────────────────────────────────────
  INSERT INTO lead_activities (
    lead_id,
    user_name,
    type,
    notes,
    created_at
  ) VALUES (
    v_lead_id,
    COALESCE(NULLIF(trim(NEW.patroller_name), ''), 'Patroller'),
    'patrol_inspection',
    v_activity_notes,
    NOW()
  );

  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_patrol_inspection_saved AFTER INSERT ON public.sign_inspections FOR EACH ROW EXECUTE FUNCTION sync_inspection_to_built_crm();

-- ── patrol_businesses: lead per business row ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_lead_from_patrol_business()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Skip duplicate: one lead per patrol business, keyed by source_id
  IF EXISTS (
    SELECT 1 FROM leads
    WHERE source = 'PATROL' AND source_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO leads (
    source,
    source_id,
    business_name,
    address,
    latitude,
    longitude,
    notes,
    status,
    created_at,
    updated_at
  ) VALUES (
    'PATROL',
    NEW.id,
    -- name may be NULL (nullable after restructure migration); fall back gracefully
    COALESCE(NULLIF(trim(NEW.name), ''), 'Unnamed Business'),
    NEW.address,
    -- Prefer GPS-captured coords; fall back to manually entered lat/long
    COALESCE(NEW.gps_latitude::float,  NEW.latitude),
    COALESCE(NEW.gps_longitude::float, NEW.longitude),
    NEW.notes,   -- maps to leads.notes (description equivalent)
    'new',
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_patrol_business_added ON public.patrol_businesses;
CREATE TRIGGER on_patrol_business_added AFTER INSERT ON public.patrol_businesses FOR EACH ROW EXECUTE FUNCTION create_lead_from_patrol_business();

-- ── inspection_photos: original function (SECURITY INVOKER, no search_path) ─
-- Trigger on_inspection_photo_added was never changed, so only the function is restored.
CREATE OR REPLACE FUNCTION public.sync_inspection_photo_to_lead()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_business_id uuid;
  v_lead_id uuid;
  v_current_photos jsonb;
BEGIN
  -- Get the business this inspection belongs to
  SELECT business_id INTO v_business_id
  FROM sign_inspections
  WHERE id = NEW.inspection_id;

  IF v_business_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the corresponding lead
  SELECT id, COALESCE(photos, '[]'::jsonb) 
  INTO v_lead_id, v_current_photos
  FROM leads
  WHERE source = 'patrol' AND source_id = v_business_id
  LIMIT 1;

  IF v_lead_id IS NOT NULL AND NEW.photo_url IS NOT NULL THEN
    UPDATE leads
    SET photos = v_current_photos || jsonb_build_array(NEW.photo_url)
    WHERE id = v_lead_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Objects added by 005 ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.patrol_lead_for_inspection();
DROP FUNCTION IF EXISTS public.patrol_normalize(text);
ALTER TABLE public.sign_inspections DROP COLUMN IF EXISTS lead_id;

COMMIT;
