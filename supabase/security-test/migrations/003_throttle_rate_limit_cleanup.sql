-- Keep rate-limit cleanup to at most once per hour per limiter.
-- This migration is for the isolated security-test project only.

CREATE TABLE IF NOT EXISTS public.nfc_event_rate_limit_maintenance (
  id smallint PRIMARY KEY CHECK (id = 1),
  last_cleanup_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE public.nfc_event_rate_limit_maintenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfc_event_rate_limit_maintenance FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nfc_event_rate_limit_maintenance TO service_role;
INSERT INTO public.nfc_event_rate_limit_maintenance (id, last_cleanup_at)
VALUES (1, pg_catalog.clock_timestamp())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.app_business_card_rate_limit_maintenance (
  id smallint PRIMARY KEY CHECK (id = 1),
  last_cleanup_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE public.app_business_card_rate_limit_maintenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_business_card_rate_limit_maintenance FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_business_card_rate_limit_maintenance TO service_role;
INSERT INTO public.app_business_card_rate_limit_maintenance (id, last_cleanup_at)
VALUES (1, pg_catalog.clock_timestamp())
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.consume_nfc_event_rate_limit(
  p_bucket_key text, p_max_requests integer, p_window_seconds integer
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
  v_cleanup_id smallint;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_bucket_key IS NULL OR p_bucket_key !~ '^[a-f0-9]{64}$'
     OR p_max_requests IS NULL OR p_max_requests < 1 OR p_max_requests > 10000
     OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RETURN false;
  END IF;

  IF pg_catalog.pg_try_advisory_xact_lock(87423017::bigint) THEN
    UPDATE public.nfc_event_rate_limit_maintenance
       SET last_cleanup_at = v_now
     WHERE id = 1 AND last_cleanup_at < v_now - interval '1 hour'
    RETURNING id INTO v_cleanup_id;
    IF FOUND THEN
      DELETE FROM public.nfc_event_rate_limits WHERE updated_at < v_now - interval '24 hours';
    END IF;
  END IF;

  INSERT INTO public.nfc_event_rate_limits AS current_limit
    (bucket_key, window_started_at, request_count, updated_at)
  VALUES (p_bucket_key, v_now, 1, v_now)
  ON CONFLICT (bucket_key) DO UPDATE
    SET window_started_at = CASE WHEN current_limit.window_started_at <= v_now - pg_catalog.make_interval(secs => p_window_seconds) THEN v_now ELSE current_limit.window_started_at END,
        request_count = CASE WHEN current_limit.window_started_at <= v_now - pg_catalog.make_interval(secs => p_window_seconds) THEN 1 ELSE current_limit.request_count + 1 END,
        updated_at = v_now
  RETURNING request_count INTO v_count;
  RETURN v_count <= p_max_requests;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_business_card_rate_limit(
  p_bucket_key text, p_max_requests integer, p_window_seconds integer
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
  v_cleanup_id smallint;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_bucket_key IS NULL OR p_bucket_key !~ '^[a-f0-9]{64}$'
     OR p_max_requests IS NULL OR p_max_requests < 1 OR p_max_requests > 10000
     OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RETURN false;
  END IF;

  IF pg_catalog.pg_try_advisory_xact_lock(87423018::bigint) THEN
    UPDATE public.app_business_card_rate_limit_maintenance
       SET last_cleanup_at = v_now
     WHERE id = 1 AND last_cleanup_at < v_now - interval '1 hour'
    RETURNING id INTO v_cleanup_id;
    IF FOUND THEN
      DELETE FROM public.app_business_card_rate_limits WHERE updated_at < v_now - interval '24 hours';
    END IF;
  END IF;

  INSERT INTO public.app_business_card_rate_limits AS current_limit
    (bucket_key, window_started_at, request_count, updated_at)
  VALUES (p_bucket_key, v_now, 1, v_now)
  ON CONFLICT (bucket_key) DO UPDATE
    SET window_started_at = CASE WHEN current_limit.window_started_at <= v_now - pg_catalog.make_interval(secs => p_window_seconds) THEN v_now ELSE current_limit.window_started_at END,
        request_count = CASE WHEN current_limit.window_started_at <= v_now - pg_catalog.make_interval(secs => p_window_seconds) THEN 1 ELSE current_limit.request_count + 1 END,
        updated_at = v_now
  RETURNING request_count INTO v_count;
  RETURN v_count <= p_max_requests;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_nfc_event_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_nfc_event_rate_limit(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.consume_business_card_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_business_card_rate_limit(text, integer, integer) TO service_role;
