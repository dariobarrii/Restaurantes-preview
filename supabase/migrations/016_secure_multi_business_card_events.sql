-- Proposed staging-only change. Do not apply until the card schema preflight passes.
-- Writes new public scans directly to app_business_events with stable business_id.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.app_business_cards') IS NULL THEN
    RAISE EXCEPTION 'Required table public.app_business_cards is missing';
  END IF;
  IF pg_catalog.to_regclass('public.app_business_card_tokens') IS NULL THEN
    RAISE EXCEPTION 'Required table public.app_business_card_tokens is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_business_events'
      AND column_name='legacy_event_id'
  ) THEN
    RAISE EXCEPTION 'Apply/review event compatibility migration before this migration';
  END IF;
END
$preflight$;

ALTER TABLE public.app_business_events
  ADD COLUMN IF NOT EXISTS card_id uuid;

CREATE OR REPLACE FUNCTION public.register_business_card_event_with_token(
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
  v_token public.app_business_card_tokens%ROWTYPE;
  v_card public.app_business_cards%ROWTYPE;
  v_business public.app_businesses%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_event text;
BEGIN
  IF p_card_id IS NULL
     OR p_token_hash IS NULL
     OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_device_type IS NULL
     OR p_device_type NOT IN ('mobile', 'desktop', 'tablet', 'unknown')
  THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT * INTO v_token
    FROM public.app_business_card_tokens
   WHERE card_id = p_card_id
   FOR UPDATE;

  IF NOT FOUND OR NOT v_token.active OR v_token.token_hash <> p_token_hash THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_card');
  END IF;

  SELECT * INTO v_card
    FROM public.app_business_cards
   WHERE id = p_card_id
     AND status = 'active'
     AND archived_at IS NULL;

  IF NOT FOUND OR v_card.target_url IS NULL OR v_card.target_url !~* '^https://[^[:space:]]+$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_card');
  END IF;

  SELECT * INTO v_business
    FROM public.app_businesses
   WHERE id = v_card.business_id
     AND status = 'approved';

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_card');
  END IF;

  IF v_token.last_event_at IS NOT NULL
     AND v_token.last_event_at > v_now - interval '2 seconds'
  THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  v_event := CASE WHEN v_card.channel = 'qr' THEN 'qr_scan' ELSE 'nfc_tap' END;

  INSERT INTO public.app_business_events
    (business_id, event_type, created_at, source, device_type, card_id)
  VALUES
    (v_card.business_id, v_event, v_now, 'public_card', p_device_type, v_card.id);

  UPDATE public.app_business_card_tokens
     SET last_event_at = v_now
   WHERE card_id = v_card.id;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'target_url', v_card.target_url);
END;
$function$;

COMMIT;
