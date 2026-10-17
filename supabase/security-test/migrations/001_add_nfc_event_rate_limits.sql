-- Test-project-only rate limiting for the public NFC event endpoint.
-- This migration is intentionally kept under supabase/security-test/migrations
-- and must not be applied to the restaurant production project without review.

CREATE TABLE IF NOT EXISTS public.nfc_event_rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  request_count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT nfc_event_rate_limits_count_positive CHECK (request_count > 0)
);

ALTER TABLE public.nfc_event_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfc_event_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nfc_event_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_nfc_event_rate_limit(
  p_bucket_key text,
  p_max_requests integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_bucket_key IS NULL
     OR p_bucket_key !~ '^[a-f0-9]{64}$'
     OR p_max_requests IS NULL
     OR p_max_requests < 1
     OR p_max_requests > 10000
     OR p_window_seconds IS NULL
     OR p_window_seconds < 1
     OR p_window_seconds > 86400
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.nfc_event_rate_limits AS current_limit
    (bucket_key, window_started_at, request_count, updated_at)
  VALUES
    (p_bucket_key, v_now, 1, v_now)
  ON CONFLICT (bucket_key) DO UPDATE
    SET window_started_at = CASE
          WHEN current_limit.window_started_at <= v_now - pg_catalog.make_interval(secs => p_window_seconds)
            THEN v_now
          ELSE current_limit.window_started_at
        END,
        request_count = CASE
          WHEN current_limit.window_started_at <= v_now - pg_catalog.make_interval(secs => p_window_seconds)
            THEN 1
          ELSE current_limit.request_count + 1
        END,
        updated_at = v_now
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_max_requests;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_nfc_event_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_nfc_event_rate_limit(text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.consume_nfc_event_rate_limit(text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_nfc_event_rate_limit(text, integer, integer) TO service_role;
