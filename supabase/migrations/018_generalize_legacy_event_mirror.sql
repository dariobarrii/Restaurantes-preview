-- Replace the legacy mirror's fixed three-name allowlist with card attribution
-- or a unique exact-name match. Ambiguous/unmatched legacy events remain unassigned.
CREATE OR REPLACE FUNCTION public.mirror_legacy_nfc_event_to_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  target_business_id uuid;
  matched_card_id uuid;
  name_match_count bigint;
BEGIN
  IF NEW.event NOT IN ('nfc_tap', 'qr_scan') OR NEW.created_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.card_id IS NOT NULL THEN
    SELECT c.business_id, c.id
      INTO target_business_id, matched_card_id
      FROM public.app_business_cards AS c
     WHERE c.id = NEW.card_id;
  END IF;

  IF target_business_id IS NULL THEN
    SELECT pg_catalog.count(*), (pg_catalog.array_agg(b.id))[1]
      INTO name_match_count, target_business_id
      FROM public.app_businesses AS b
     WHERE pg_catalog.lower(pg_catalog.trim(b.name)) =
           pg_catalog.lower(pg_catalog.trim(NEW.restaurant));

    IF name_match_count <> 1 THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.app_business_events
    (business_id, event_type, created_at, source, device_type, legacy_event_id, card_id)
  VALUES
    (target_business_id, NEW.event, NEW.created_at,
     'legacy_nfc_events', NEW.device_type, NEW.id, matched_card_id)
  ON CONFLICT (legacy_event_id) WHERE legacy_event_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$function$;

-- This trigger function is internal; client roles must not call it as an RPC.
REVOKE EXECUTE ON FUNCTION public.mirror_legacy_nfc_event_to_business()
  FROM PUBLIC, anon, authenticated;
DO $verify_acl$
BEGIN
  IF pg_catalog.has_function_privilege('anon','public.mirror_legacy_nfc_event_to_business()','EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated','public.mirror_legacy_nfc_event_to_business()','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy mirror trigger function remains executable by client roles';
  END IF;
END
$verify_acl$;
