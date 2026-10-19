-- Proposed staging-only change. Do not apply until the preflight passes.
-- Public scans are recorded directly in app_business_events with stable business_id.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.app_business_cards') IS NULL
     OR pg_catalog.to_regclass('public.app_business_card_tokens') IS NULL
     OR pg_catalog.to_regclass('public.app_business_events') IS NULL
     OR pg_catalog.to_regclass('public.app_businesses') IS NULL
     OR pg_catalog.to_regclass('public.nfc_events') IS NULL THEN
    RAISE EXCEPTION 'Required multi-business card/event tables are missing';
  END IF;
  IF EXISTS (
    SELECT required.table_name, required.column_name
    FROM (VALUES
      ('app_business_cards','id'), ('app_business_cards','business_id'),
      ('app_business_cards','channel'), ('app_business_cards','target_url'),
      ('app_business_cards','status'), ('app_business_cards','archived_at'),
      ('app_business_card_tokens','card_id'), ('app_business_card_tokens','token_hash'),
      ('app_business_card_tokens','active'), ('app_business_card_tokens','last_event_at'),
      ('app_business_events','business_id'), ('app_business_events','event_type'),
      ('app_business_events','created_at'), ('app_business_events','source'),
      ('app_business_events','device_type'), ('app_business_events','legacy_event_id')
    ) AS required(table_name,column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=required.table_name
        AND c.column_name=required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'Required card/token/event columns are missing; inspect staging schema first';
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
  IF p_card_id IS NULL OR p_token_hash IS NULL
     OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_device_type IS NULL
     OR p_device_type NOT IN ('mobile','desktop','tablet','unknown') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_request');
  END IF;

  SELECT * INTO v_token
    FROM public.app_business_card_tokens
   WHERE card_id=p_card_id
   FOR UPDATE;
  IF NOT FOUND OR NOT v_token.active OR v_token.token_hash<>p_token_hash THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_card');
  END IF;

  SELECT * INTO v_card
    FROM public.app_business_cards
   WHERE id=p_card_id AND status='active' AND archived_at IS NULL;
  IF NOT FOUND OR v_card.channel NOT IN ('nfc','qr')
     OR v_card.target_url IS NULL
     OR v_card.target_url !~* '^https://'
     OR v_card.target_url ~ '[[:space:]]' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_card');
  END IF;

  SELECT * INTO v_business
    FROM public.app_businesses
   WHERE id=v_card.business_id AND status='approved';
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_card');
  END IF;

  IF v_token.last_event_at IS NOT NULL
     AND v_token.last_event_at > v_now - interval '2 seconds' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'error','rate_limited');
  END IF;

  v_event := CASE WHEN v_card.channel='qr' THEN 'qr_scan' ELSE 'nfc_tap' END;
  INSERT INTO public.app_business_events
    (business_id,event_type,created_at,source,device_type,card_id)
  VALUES
    (v_card.business_id,v_event,v_now,'public_card',p_device_type,v_card.id);
  UPDATE public.app_business_card_tokens SET last_event_at=v_now WHERE card_id=v_card.id;

  RETURN pg_catalog.jsonb_build_object('ok',true,'target_url',v_card.target_url);
END;
$function$;

-- The Edge Function invokes this RPC with the server-side service_role key.
-- Browser roles must not bypass the gateway by calling the function directly.
REVOKE EXECUTE ON FUNCTION public.register_business_card_event_with_token(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_business_card_event_with_token(uuid, text, text)
  TO service_role;

-- Direct client inserts could bypass the gateway or write through the legacy mirror.
REVOKE INSERT ON TABLE public.app_business_events FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON TABLE public.nfc_events FROM PUBLIC, anon, authenticated;

-- Token management is performed by the authenticated management Edge Function.
REVOKE ALL PRIVILEGES ON TABLE public.app_business_card_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.app_business_card_tokens TO service_role;

-- Discover the exact rate-limit RPC signature from the catalog; do not guess it.
DO $permissions$
DECLARE
  f record;
  found_rate_limit_function boolean := false;
  registration_oid oid := 'public.register_business_card_event_with_token(uuid,text,text)'::regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'consume_business_card_rate_limit'
  LOOP
    found_rate_limit_function := true;
    EXECUTE pg_catalog.format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
    IF pg_catalog.has_function_privilege('anon', f.signature::oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', f.signature::oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', f.signature::oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Rate-limit RPC privileges are not restricted to service_role';
    END IF;
  END LOOP;

  IF NOT found_rate_limit_function THEN
    RAISE EXCEPTION 'SECURITY DEFINER consume_business_card_rate_limit function is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS acl
    WHERE p.oid = registration_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) OR pg_catalog.has_function_privilege('anon', registration_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', registration_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', registration_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Registration RPC privileges are not restricted to service_role';
  END IF;

  IF pg_catalog.has_table_privilege('anon','public.app_business_events','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_events','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.nfc_events','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.nfc_events','INSERT') THEN
    RAISE EXCEPTION 'Client roles retain direct event insertion privileges';
  END IF;

  IF pg_catalog.has_table_privilege('anon','public.app_business_card_tokens','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_card_tokens','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_card_tokens','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.app_business_card_tokens','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_card_tokens','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_card_tokens','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_card_tokens','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_card_tokens','DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_card_tokens','SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_card_tokens','INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_card_tokens','UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_card_tokens','DELETE') THEN
    RAISE EXCEPTION 'Token table privileges do not match server-only access';
  END IF;
END
$permissions$;


-- Remove any additional direct EXECUTE grants retained by earlier versions.
-- The owner remains implicit; service_role is the only non-owner grantee.
DO $acl_sweep$
DECLARE
  f record;
  g record;
  service_role_oid oid := 'service_role'::regrole::oid;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('register_business_card_event_with_token','consume_business_card_rate_limit')
  LOOP
    FOR g IN
      SELECT DISTINCT acl.grantee, pg_catalog.pg_get_userbyid(acl.grantee) AS role_name
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))
      ) acl
      WHERE p.oid=f.signature::oid
        AND acl.privilege_type='EXECUTE'
        AND acl.grantee<>0
        AND acl.grantee<>p.proowner
        AND acl.grantee<>service_role_oid
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION %s FROM %I', f.signature, g.role_name
      );
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))
      ) acl
      WHERE p.oid=f.signature::oid
        AND acl.privilege_type='EXECUTE'
        AND acl.grantee NOT IN (p.proowner,service_role_oid)
    ) THEN
      RAISE EXCEPTION 'Unexpected EXECUTE grantee remains on %', f.signature;
    END IF;
  END LOOP;
END
$acl_sweep$;

COMMIT;
