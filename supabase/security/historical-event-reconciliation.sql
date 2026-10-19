-- READ ONLY: run only against the dedicated staging project after schema review.
-- Counts only; no customer-level event rows or credentials are returned.
-- Legacy historical counts resolved to business and channel before import.
WITH legacy AS (
 SELECT e.id,e.restaurant,e.event,e.card_id
 FROM public.nfc_events e WHERE e.event IN ('nfc_tap','qr_scan')
), resolved AS (
 SELECT l.event,
   COALESCE(card.business_id,names.business_id) AS business_id
 FROM legacy l
 LEFT JOIN public.app_business_cards card ON card.id=l.card_id
 LEFT JOIN LATERAL (
   SELECT CASE WHEN count(*)=1 THEN (array_agg(b.id))[1] END AS business_id
   FROM public.app_businesses b
   WHERE lower(trim(b.name))=lower(trim(l.restaurant))
 ) names ON true
)
SELECT business_id,event AS channel,count(*) AS legacy_count
FROM resolved GROUP BY business_id,event ORDER BY business_id,event;

-- Events tagged as historical imports, grouped by business and channel.
SELECT business_id,event_type AS channel,count(*) AS imported_count
FROM public.app_business_events
WHERE event_type IN ('nfc_tap','qr_scan') AND source='legacy_nfc_events'
GROUP BY business_id,event_type ORDER BY business_id,event_type;

-- Attribution coverage: card, unique exact name, ambiguous name, or unmatched.
WITH legacy AS (
 SELECT e.id,e.restaurant,e.card_id FROM public.nfc_events e
 WHERE e.event IN ('nfc_tap','qr_scan')
), resolution AS (
 SELECT l.id,
   CASE WHEN card.business_id IS NOT NULL THEN 'card'
        WHEN names.match_count=1 THEN 'unique_name'
        WHEN names.match_count>1 THEN 'ambiguous_name'
        ELSE 'unmatched' END AS resolution
 FROM legacy l
 LEFT JOIN public.app_business_cards card ON card.id=l.card_id
 LEFT JOIN LATERAL (
   SELECT count(*) AS match_count,(array_agg(b.id))[1] AS business_id
   FROM public.app_businesses b
   WHERE lower(trim(b.name))=lower(trim(l.restaurant))
 ) names ON true
)
SELECT resolution,count(*) AS event_count
FROM resolution GROUP BY resolution ORDER BY resolution;

-- Global idempotency reconciliation; run before and after import.
SELECT
 (SELECT count(*) FROM public.nfc_events WHERE event IN ('nfc_tap','qr_scan')) AS legacy_total,
 (SELECT count(*) FROM public.app_business_events
   WHERE event_type IN ('nfc_tap','qr_scan') AND source='legacy_nfc_events'
     AND legacy_event_id IS NOT NULL) AS imported_total,
 (SELECT count(*) FROM public.nfc_events e
   WHERE e.event IN ('nfc_tap','qr_scan')
     AND EXISTS (SELECT 1 FROM public.app_business_events a
                 WHERE a.legacy_event_id=e.id)) AS matched_legacy_total;
