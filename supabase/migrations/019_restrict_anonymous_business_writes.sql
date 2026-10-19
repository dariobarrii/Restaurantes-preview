-- Staging-only hardening: public/anonymous users must never mutate tenant metadata.
-- Authenticated admin write paths are handled separately after RLS policies are reconciled.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.app_businesses') IS NULL
     OR pg_catalog.to_regclass('public.app_business_cards') IS NULL THEN
    RAISE EXCEPTION 'Required multi-business tables are missing';
  END IF;
END
$preflight$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.app_businesses FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.app_business_cards FROM PUBLIC, anon;

-- Public card lookups remain read-only; RLS still limits visible rows.
GRANT SELECT ON TABLE public.app_businesses TO anon;
GRANT SELECT ON TABLE public.app_business_cards TO anon;

DO $verify$
BEGIN
  IF pg_catalog.has_table_privilege('anon','public.app_businesses','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.app_businesses','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.app_businesses','DELETE')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','DELETE') THEN
    RAISE EXCEPTION 'Anonymous mutation privileges remain on business metadata';
  END IF;
  IF NOT pg_catalog.has_table_privilege('anon','public.app_businesses','SELECT')
     OR NOT pg_catalog.has_table_privilege('anon','public.app_business_cards','SELECT') THEN
    RAISE EXCEPTION 'Anonymous read access required for public card lookups was lost';
  END IF;
END
$verify$;

COMMIT;
