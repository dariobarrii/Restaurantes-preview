-- Harden token validation so NULL values cannot bypass PL/pgSQL IF checks.
CREATE OR REPLACE FUNCTION public.register_nfc_event_with_token(
  p_card_id uuid,
  p_token_hash text,
  p_device_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_card public.nfc_card_tokens%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_card_id IS NULL
     OR p_token_hash IS NULL
     OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_device_type IS NULL
     OR p_device_type NOT IN ('mobile', 'desktop', 'tablet', 'unknown')
  THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT *
    INTO v_card
    FROM public.nfc_card_tokens
   WHERE card_id = p_card_id
   FOR UPDATE;

  IF NOT FOUND
     OR NOT v_card.active
     OR v_card.token_hash IS NULL
     OR v_card.token_hash <> p_token_hash
  THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_card');
  END IF;

  IF v_card.last_event_at IS NOT NULL
     AND v_card.last_event_at > v_now - interval '2 seconds'
  THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  INSERT INTO public.nfc_events (
    restaurant, event, created_at, device_type, card_id
  )
  VALUES (
    v_card.restaurant, v_card.event, v_now, p_device_type, v_card.card_id
  );

  UPDATE public.nfc_card_tokens
     SET last_event_at = v_now
   WHERE card_id = v_card.card_id;

  RETURN pg_catalog.jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.register_nfc_event_with_token(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_nfc_event_with_token(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.register_nfc_event_with_token(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_nfc_event_with_token(uuid, text, text) TO service_role;
