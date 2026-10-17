-- Preserve card-level attribution when mirroring legacy NFC/QR events.
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

  SELECT id INTO target_business_id
  FROM public.app_businesses
  WHERE slug = target_slug
  LIMIT 1;

  IF target_business_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.app_business_events
    (business_id, event_type, created_at, source, device_type, legacy_event_id, card_id)
  VALUES
    (target_business_id, NEW.event, coalesce(NEW.created_at, pg_catalog.now()),
     'legacy_nfc_events', NEW.device_type, NEW.id, NEW.card_id)
  ON CONFLICT (legacy_event_id) WHERE legacy_event_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.mirror_legacy_nfc_event_to_business() FROM PUBLIC, anon, authenticated;

UPDATE public.app_business_events AS be
SET card_id = ne.card_id,
    device_type = coalesce(be.device_type, ne.device_type)
FROM public.nfc_events AS ne
WHERE be.legacy_event_id = ne.id
  AND ne.card_id IS NOT NULL
  AND be.card_id IS DISTINCT FROM ne.card_id;
