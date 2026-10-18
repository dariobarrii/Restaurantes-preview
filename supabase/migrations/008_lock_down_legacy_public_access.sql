-- NQ Central: lock down legacy public data surfaces and SECURITY DEFINER helpers.
-- Public clients should read only explicitly public catalog surfaces.
-- Event ingestion and review snapshots must go through authenticated/app-authorized paths.

DROP POLICY IF EXISTS "Allow NFC events" ON public.nfc_events;
DROP POLICY IF EXISTS "Allow dashboard read" ON public.nfc_events;
DROP POLICY IF EXISTS "Allow NFC tap" ON public.nfc_stats;
DROP POLICY IF EXISTS "Public insert VETA daily totals" ON public.veta_daily_review_totals;
DROP POLICY IF EXISTS "Public insert daily review totals" ON public.veta_daily_review_totals;
DROP POLICY IF EXISTS "Public read VETA daily totals" ON public.veta_daily_review_totals;
DROP POLICY IF EXISTS "Public read daily review totals" ON public.veta_daily_review_totals;
DROP POLICY IF EXISTS "Public update VETA daily totals" ON public.veta_daily_review_totals;
DROP POLICY IF EXISTS "Public update daily review totals" ON public.veta_daily_review_totals;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON public.app_businesses TO anon;
GRANT SELECT ON public.app_business_cards TO anon;
GRANT SELECT ON public.google_review_counts TO anon;

REVOKE ALL PRIVILEGES ON TABLE public.nfc_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.nfc_stats FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.veta_daily_review_totals FROM anon, authenticated;

-- These helpers are used by authenticated RLS policies, not by anonymous clients.
REVOKE ALL ON FUNCTION public.app_is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_is_admin() TO authenticated;
REVOKE ALL ON FUNCTION public.app_is_approved_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_is_approved_member(uuid) TO authenticated;

-- Trigger-only functions should not be callable through PostgREST RPC.
REVOKE ALL ON FUNCTION public.app_handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_mirror_nfc_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_protect_profile_fields() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirror_legacy_nfc_event_to_business() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_nfc_event_device_type() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mirror_legacy_nfc_event_to_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  target_slug text;
  target_business_id uuid;
BEGIN
  IF NEW.event NOT IN ('nfc_tap', 'qr_scan') THEN
    RETURN NEW;
  END IF;

  target_slug := CASE lower(trim(NEW.restaurant))
    WHEN 'tzura steak house' THEN 'tzura-steak-house'
    WHEN 'veta steak house' THEN 'veta-steak-house'
    WHEN 'feral steakhouse' THEN 'feral-steakhouse'
    ELSE NULL
  END;

  IF target_slug IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id
    INTO target_business_id
  FROM public.app_businesses
  WHERE slug = target_slug
  LIMIT 1;

  IF target_business_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.app_business_events
    (business_id, event_type, created_at, source, legacy_event_id)
  VALUES
    (target_business_id, NEW.event, coalesce(NEW.created_at, pg_catalog.now()),
     'legacy_nfc_events', NEW.id)
  ON CONFLICT (legacy_event_id) WHERE legacy_event_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_nfc_event_device_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.app_business_events
  SET device_type = NEW.device_type
  WHERE legacy_event_id = NEW.id;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.mirror_legacy_nfc_event_to_business() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_nfc_event_device_type() FROM PUBLIC, anon, authenticated;
