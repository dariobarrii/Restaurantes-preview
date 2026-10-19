-- Proposed idempotent historical import. Review the read-only reconciliation
-- queries in supabase/security/historical-event-reconciliation.sql first.
-- Rows without a unique business match or source timestamp remain in nfc_events.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.nfc_events') IS NULL
     OR pg_catalog.to_regclass('public.app_business_events') IS NULL
     OR pg_catalog.to_regclass('public.app_businesses') IS NULL
     OR pg_catalog.to_regclass('public.app_business_cards') IS NULL THEN
    RAISE EXCEPTION 'Required event/business tables are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='nfc_events' AND column_name='restaurant'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='nfc_events' AND column_name='event'
  ) THEN
    RAISE EXCEPTION 'Legacy event columns do not match the reviewed source schema';
  END IF;
  IF EXISTS (
    SELECT required.table_name, required.column_name
    FROM (VALUES
      ('nfc_events', 'device_type'),
      ('nfc_events', 'card_id'),
      ('app_business_events', 'legacy_event_id'),
      ('app_business_events', 'device_type'),
      ('app_business_events', 'card_id')
    ) AS required(table_name, column_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns AS c
      WHERE c.table_schema='public'
        AND c.table_name=required.table_name
        AND c.column_name=required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'Required device/card/legacy event columns are missing';
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS app_business_events_legacy_event_id_uidx
  ON public.app_business_events (legacy_event_id)
  WHERE legacy_event_id IS NOT NULL;

WITH source_events AS (
  SELECT
    e.id AS legacy_id,
    e.restaurant,
    e.event,
    e.created_at,
    e.device_type,
    e.card_id AS legacy_card_id,
    card.business_id AS card_business_id,
    card.id AS matched_card_id,
    name_match.business_id AS name_business_id
  FROM public.nfc_events AS e
  LEFT JOIN public.app_business_cards AS card
    ON card.id = e.card_id
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN pg_catalog.count(*) = 1 THEN (pg_catalog.array_agg(b.id))[1] ELSE NULL END AS business_id
    FROM public.app_businesses AS b
    WHERE pg_catalog.lower(pg_catalog.trim(b.name)) =
          pg_catalog.lower(pg_catalog.trim(e.restaurant))
  ) AS name_match ON true
  WHERE e.event IN ('nfc_tap', 'qr_scan')
    AND e.created_at IS NOT NULL
),
resolved AS (
  SELECT
    legacy_id,
    COALESCE(card_business_id, name_business_id) AS business_id,
    event AS event_type,
    COALESCE(created_at, pg_catalog.now()) AS created_at,
    'legacy_nfc_events'::text AS source,
    device_type,
    matched_card_id AS card_id
  FROM source_events
  WHERE COALESCE(card_business_id, name_business_id) IS NOT NULL
)
INSERT INTO public.app_business_events AS existing
  (business_id, event_type, created_at, source, device_type, legacy_event_id, card_id)
SELECT business_id, event_type, created_at, source, device_type, legacy_id, card_id
FROM resolved
ON CONFLICT (legacy_event_id) WHERE legacy_event_id IS NOT NULL
DO UPDATE SET
  device_type = COALESCE(existing.device_type, EXCLUDED.device_type),
  card_id = COALESCE(existing.card_id, EXCLUDED.card_id);

COMMIT;
