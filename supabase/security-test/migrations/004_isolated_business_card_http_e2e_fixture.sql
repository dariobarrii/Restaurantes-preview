-- Isolated NQ Central security-test fixture only. Never apply to production.
-- Bearer tokens are derived inside CI from test-only seeds; only SHA-256 hashes are stored here.
CREATE TABLE IF NOT EXISTS public.app_businesses (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.app_business_cards (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.app_businesses(id),
  channel text NOT NULL CHECK (channel IN ('nfc','qr')),
  target_url text NOT NULL,
  status text NOT NULL,
  archived_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.app_business_card_tokens (
  card_id uuid PRIMARY KEY REFERENCES public.app_business_cards(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  active boolean NOT NULL DEFAULT true,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.app_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_business_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_business_card_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_business_card_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_businesses, public.app_business_cards, public.app_business_card_tokens TO service_role;
GRANT SELECT ON TABLE public.app_businesses, public.app_business_cards TO anon, authenticated;
DROP POLICY IF EXISTS nq_test_approved_business_select ON public.app_businesses;
CREATE POLICY nq_test_approved_business_select ON public.app_businesses FOR SELECT TO anon, authenticated USING (status = 'approved');
DROP POLICY IF EXISTS nq_test_active_card_select ON public.app_business_cards;
CREATE POLICY nq_test_active_card_select ON public.app_business_cards FOR SELECT TO anon, authenticated USING (
  status = 'active' AND archived_at IS NULL AND EXISTS (
    SELECT 1 FROM public.app_businesses b WHERE b.id = app_business_cards.business_id AND b.status = 'approved'
  )
);
INSERT INTO public.app_businesses (id,name,slug,status)
VALUES ('22222222-2222-4222-8222-222222222222','Feral Steakhouse','nq-central-security-test','approved')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, status = EXCLUDED.status;
INSERT INTO public.app_business_cards (id,business_id,channel,target_url,status,archived_at)
VALUES
 ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','nfc','https://example.com/test-destination','active',NULL),
 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','qr','https://example.com/revoked-test-destination','active',NULL)
ON CONFLICT (id) DO UPDATE SET business_id=EXCLUDED.business_id, channel=EXCLUDED.channel, target_url=EXCLUDED.target_url, status=EXCLUDED.status, archived_at=EXCLUDED.archived_at;
INSERT INTO public.app_business_card_tokens (card_id,token_hash,active,last_event_at)
VALUES
 ('33333333-3333-4333-8333-333333333333','53e05a279b038d35e1ff2ff79e7a57d7ab77c26e8cde5ea685ea264497ce96a5',true,NULL),
 ('44444444-4444-4444-8444-444444444444','2941f678f4daab4a11cbc86f664aa2d8d148cfe708128309aed3fe4c37a9bd1e',false,NULL)
ON CONFLICT (card_id) DO UPDATE SET token_hash=EXCLUDED.token_hash, active=EXCLUDED.active, last_event_at=NULL;

CREATE OR REPLACE FUNCTION public.register_business_card_event_with_token(
  p_card_id uuid, p_token_hash text, p_device_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_token public.app_business_card_tokens%ROWTYPE;
  v_card public.app_business_cards%ROWTYPE;
  v_business public.app_businesses%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_event text;
BEGIN
  IF p_card_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_device_type IS NULL OR p_device_type NOT IN ('mobile','desktop','tablet','unknown') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_request');
  END IF;
  SELECT * INTO v_token FROM public.app_business_card_tokens WHERE card_id=p_card_id FOR UPDATE;
  IF NOT FOUND OR NOT v_token.active OR v_token.token_hash IS NULL OR v_token.token_hash <> p_token_hash THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_card');
  END IF;
  SELECT * INTO v_card FROM public.app_business_cards WHERE id=p_card_id AND status='active' AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_card'); END IF;
  SELECT * INTO v_business FROM public.app_businesses WHERE id=v_card.business_id AND status='approved';
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_card'); END IF;
  IF v_token.last_event_at IS NOT NULL AND v_token.last_event_at > v_now - interval '2 seconds' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','rate_limited');
  END IF;
  v_event := CASE WHEN v_card.channel='qr' THEN 'qr_scan' ELSE 'nfc_tap' END;
  INSERT INTO public.nfc_events (restaurant,event,created_at,device_type,card_id)
  VALUES (v_business.name,v_event,v_now,p_device_type,v_card.id);
  UPDATE public.app_business_card_tokens SET last_event_at=v_now WHERE card_id=v_card.id;
  RETURN pg_catalog.jsonb_build_object('ok',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.register_business_card_event_with_token(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_business_card_event_with_token(uuid,text,text) TO service_role;