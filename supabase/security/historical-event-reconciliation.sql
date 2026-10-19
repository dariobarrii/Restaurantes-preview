-- READ ONLY: run only against the dedicated staging project after schema review.
-- Aggregate counts only; no client-level event rows, credentials, or secrets are returned.
-- Run before and after a reviewed staging import.
WITH legacy AS (
  SELECT e.id,e.restaurant,e.event,e.created_at,e.card_id
  FROM public.nfc_events e
  WHERE e.event IN ('nfc_tap','qr_scan')
), resolved AS (
  SELECT l.id,l.event,l.created_at,
         COALESCE(card.business_id,names.business_id) AS business_id,
         CASE WHEN card.business_id IS NOT NULL THEN 'card'
              WHEN names.match_count=1 THEN 'unique_name'
              WHEN names.match_count>1 THEN 'ambiguous_name'
              ELSE 'unmatched' END AS resolution
  FROM legacy l
  LEFT JOIN public.app_business_cards card ON card.id=l.card_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS match_count,
           CASE WHEN count(*)=1 THEN (array_agg(b.id))[1] END AS business_id
    FROM public.app_businesses b
    WHERE lower(trim(b.name))=lower(trim(l.restaurant))
  ) names ON true
)
SELECT resolution,
       event AS channel,
       count(*) FILTER (WHERE created_at IS NULL) AS missing_source_date,
       count(*) FILTER (WHERE created_at IS NOT NULL) AS source_events_with_date
FROM resolved
GROUP BY resolution,event
ORDER BY resolution,event;

-- Side-by-side counts for only the timestamped events with a unique business attribution.
WITH legacy AS (
  SELECT e.id,e.restaurant,e.event,e.created_at,e.card_id
  FROM public.nfc_events e
  WHERE e.event IN ('nfc_tap','qr_scan') AND e.created_at IS NOT NULL
), expected AS (
  SELECT COALESCE(card.business_id,names.business_id) AS business_id,
         l.event AS channel,count(*) AS expected_count
  FROM legacy l
  LEFT JOIN public.app_business_cards card ON card.id=l.card_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)=1 THEN (array_agg(b.id))[1] END AS business_id
    FROM public.app_businesses b
    WHERE lower(trim(b.name))=lower(trim(l.restaurant))
  ) names ON true
  WHERE COALESCE(card.business_id,names.business_id) IS NOT NULL
  GROUP BY COALESCE(card.business_id,names.business_id),l.event
), imported AS (
  SELECT business_id,event_type AS channel,count(*) AS imported_count
  FROM public.app_business_events
  WHERE event_type IN ('nfc_tap','qr_scan') AND source='legacy_nfc_events'
  GROUP BY business_id,event_type
)
SELECT COALESCE(expected.business_id,imported.business_id) AS business_id,
       COALESCE(expected.channel,imported.channel) AS channel,
       COALESCE(expected.expected_count,0) AS expected_count,
       COALESCE(imported.imported_count,0) AS imported_count,
       COALESCE(imported.imported_count,0)-COALESCE(expected.expected_count,0) AS difference
FROM expected
FULL JOIN imported ON imported.business_id=expected.business_id
                  AND imported.channel=expected.channel
ORDER BY business_id,channel;

-- Count imported rows whose attribution, channel, or source timestamp differs from legacy.
WITH legacy AS (
  SELECT e.id,e.restaurant,e.event,e.created_at,e.card_id
  FROM public.nfc_events e
  WHERE e.event IN ('nfc_tap','qr_scan')
), resolved AS (
  SELECT l.*,card.id AS matched_card_id,
         COALESCE(card.business_id,names.business_id) AS expected_business_id
  FROM legacy l
  LEFT JOIN public.app_business_cards card ON card.id=l.card_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)=1 THEN (array_agg(b.id))[1] END AS business_id
    FROM public.app_businesses b
    WHERE lower(trim(b.name))=lower(trim(l.restaurant))
  ) names ON true
)
SELECT count(*) AS imported_attribution_channel_or_date_mismatches
FROM resolved l
JOIN public.app_business_events a ON a.legacy_event_id=l.id
WHERE a.source='legacy_nfc_events'
  AND (a.business_id IS DISTINCT FROM l.expected_business_id
       OR a.event_type IS DISTINCT FROM l.event
       OR a.created_at IS DISTINCT FROM l.created_at);

-- A nonzero duplicate count means the import's unique legacy_event_id preflight must stop.
SELECT count(*) AS duplicate_legacy_event_id_groups
FROM (
  SELECT legacy_event_id
  FROM public.app_business_events
  WHERE legacy_event_id IS NOT NULL
  GROUP BY legacy_event_id
  HAVING count(*)>1
) duplicates;
