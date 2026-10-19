-- Additive compatibility for fields read by the NQ Central dashboard.
-- Existing rows remain NULL; no categories, labels, or historical timestamps are inferred.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.app_businesses') IS NULL
     OR pg_catalog.to_regclass('public.app_business_cards') IS NULL THEN
    RAISE EXCEPTION 'Required multi-business tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_businesses'
      AND column_name IN ('id','name','slug','status')
    GROUP BY table_name
    HAVING count(*)=4
  ) THEN
    RAISE EXCEPTION 'app_businesses baseline columns do not match the expected staging schema';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_business_cards'
      AND column_name IN ('id','business_id','channel','target_url','status','archived_at')
    GROUP BY table_name
    HAVING count(*)=6
  ) THEN
    RAISE EXCEPTION 'app_business_cards baseline columns do not match the expected staging schema';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND (
      (table_name='app_businesses' AND column_name='category' AND data_type <> 'text')
      OR (table_name='app_business_cards' AND column_name='label' AND data_type <> 'text')
    )
  ) THEN
    RAISE EXCEPTION 'Existing category/label column has an unexpected type';
  END IF;
END
$preflight$;

ALTER TABLE public.app_businesses
  ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.app_business_cards
  ADD COLUMN IF NOT EXISTS label text;

COMMIT;
