-- Secure public NFC/QR card events with per-card bearer tokens.
CREATE TABLE IF NOT EXISTS public.app_business_card_tokens (
  card_id uuid PRIMARY KEY REFERENCES public.app_business_cards(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  active boolean NOT NULL DEFAULT true,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.app_business_card_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_business_card_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_business_card_tokens TO authenticated;
GRANT ALL ON TABLE public.app_business_card_tokens TO service_role;

DROP POLICY IF EXISTS app_business_card_tokens_admin_all ON public.app_business_card_tokens;
CREATE POLICY app_business_card_tokens_admin_all
ON public.app_business_card_tokens
FOR ALL TO authenticated
USING (public.app_is_admin())
WITH CHECK (public.app_is_admin());

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

  SELECT *
    INTO v_token
    FROM public.app_business_card_tokens
   WHERE card_id = p_card_id
   FOR UPDATE;

  IF NOT FOUND
     OR NOT v_token.active
     OR v_token.token_hash IS NULL
     OR v_token.token_hash <> p_token_hash
  THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_card');
  END IF;

  SELECT *
    INTO v_card
    FROM public.app_business_cards
   WHERE id = p_card_id
     AND status = 'active'
     AND archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_card');
  END IF;

  SELECT *
    INTO v_business
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

  INSERT INTO public.nfc_events (
    restaurant, event, created_at, device_type, card_id
  )
  VALUES (
    v_business.name, v_event, v_now, p_device_type, v_card.id
  );

  UPDATE public.app_business_card_tokens
     SET last_event_at = v_now
   WHERE card_id = v_card.id;

  RETURN pg_catalog.jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.register_business_card_event_with_token(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_business_card_event_with_token(uuid, text, text) TO service_role;
