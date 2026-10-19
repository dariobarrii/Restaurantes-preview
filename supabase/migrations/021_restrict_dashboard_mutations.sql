-- Coordinated least-privilege policy for NQ Central dashboard access.
-- Requires the authenticated management Edge Function to be deployed before application.
-- This file is prepared for review only; it has not been executed.
BEGIN;

DO $preflight$
DECLARE
  t text;
BEGIN
  IF pg_catalog.to_regprocedure('private.app_is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Required private.app_is_admin() helper is missing';
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'app_businesses','app_business_cards','app_profiles','app_business_members',
    'app_business_events','app_business_review_snapshots'
  ] LOOP
    IF pg_catalog.to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Required table public.% is missing', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid=pg_catalog.to_regclass('public.' || t) AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS must be enabled on public.% before this migration', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_businesses' AND column_name='category' AND data_type='text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_business_cards' AND column_name='label' AND data_type='text') THEN
    RAISE EXCEPTION 'Migration 020 nullable dashboard columns must be applied first';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_profiles' AND column_name='full_name')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_profiles' AND column_name='status')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_business_members' AND column_name='member_role')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_business_review_snapshots' AND column_name='source') THEN
    RAISE EXCEPTION 'One or more required dashboard columns are missing';
  END IF;
END
$preflight$;

-- Browser clients keep scoped reads; all business/card writes go through the
-- authenticated management Edge Function using its server-side service role.
REVOKE ALL PRIVILEGES ON TABLE public.app_businesses FROM PUBLIC, anon, authenticated;
REVOKE MAINTAIN ON TABLE public.app_businesses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.app_businesses TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_businesses TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.app_business_cards FROM PUBLIC, anon, authenticated;
REVOKE MAINTAIN ON TABLE public.app_business_cards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.app_business_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_business_cards TO service_role;

-- Profile self-service may change only full_name. Role and approval status are
-- never writable by a browser client.
REVOKE ALL PRIVILEGES ON TABLE public.app_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.app_profiles TO authenticated;
GRANT UPDATE (full_name) ON TABLE public.app_profiles TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.app_profiles TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.app_business_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.app_business_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_business_members TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.app_business_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.app_business_events TO authenticated;
GRANT SELECT ON TABLE public.app_business_events TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.app_business_review_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.app_business_review_snapshots TO authenticated;
GRANT SELECT ON TABLE public.app_business_review_snapshots TO service_role;

-- Add administrator read access without broadening member rows. Existing
-- approved-public and own-membership SELECT policies remain in place.
DROP POLICY IF EXISTS nq_central_admin_business_select ON public.app_businesses;
CREATE POLICY nq_central_admin_business_select ON public.app_businesses
  FOR SELECT TO authenticated USING ((SELECT private.app_is_admin()));

DROP POLICY IF EXISTS nq_central_admin_card_select ON public.app_business_cards;
CREATE POLICY nq_central_admin_card_select ON public.app_business_cards
  FOR SELECT TO authenticated USING ((SELECT private.app_is_admin()));

DROP POLICY IF EXISTS nq_central_admin_profile_select ON public.app_profiles;
CREATE POLICY nq_central_admin_profile_select ON public.app_profiles
  FOR SELECT TO authenticated USING ((SELECT private.app_is_admin()));

DROP POLICY IF EXISTS nq_central_profile_name_self_update ON public.app_profiles;
CREATE POLICY nq_central_profile_name_self_update ON public.app_profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS nq_central_admin_membership_select ON public.app_business_members;
CREATE POLICY nq_central_admin_membership_select ON public.app_business_members
  FOR SELECT TO authenticated USING ((SELECT private.app_is_admin()));

DROP POLICY IF EXISTS nq_central_admin_events_select ON public.app_business_events;
CREATE POLICY nq_central_admin_events_select ON public.app_business_events
  FOR SELECT TO authenticated USING ((SELECT private.app_is_admin()));

DROP POLICY IF EXISTS nq_central_admin_reviews_select ON public.app_business_review_snapshots;
CREATE POLICY nq_central_admin_reviews_select ON public.app_business_review_snapshots
  FOR SELECT TO authenticated USING ((SELECT private.app_is_admin()));

DROP POLICY IF EXISTS nq_central_member_review_insert ON public.app_business_review_snapshots;
CREATE POLICY nq_central_member_review_insert ON public.app_business_review_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_business_members m
      JOIN public.app_profiles p ON p.user_id=m.user_id
      JOIN public.app_businesses b ON b.id=m.business_id
      WHERE m.business_id=app_business_review_snapshots.business_id
        AND m.user_id=(SELECT auth.uid())
        AND p.status='approved'
        AND b.status='approved'
        AND m.member_role IN ('owner','manager')
    )
    AND platform IN ('Google apertura','Google cierre')
    AND source='manual'
  );

DO $verify$
BEGIN
  IF pg_catalog.has_table_privilege('anon','public.app_businesses','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.app_businesses','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.app_businesses','DELETE')
     OR pg_catalog.has_table_privilege('anon','public.app_businesses','TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_businesses','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_businesses','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_businesses','TRUNCATE')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','DELETE')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','TRUNCATE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','TRUNCATE')
     OR pg_catalog.has_column_privilege('authenticated','public.app_profiles','role','UPDATE')
     OR pg_catalog.has_column_privilege('authenticated','public.app_profiles','status','UPDATE')
     OR NOT pg_catalog.has_column_privilege('authenticated','public.app_profiles','full_name','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_businesses','INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_businesses','UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_cards','INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_cards','UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_profiles','UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_members','INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_members','UPDATE')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_review_snapshots','SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role','public.app_business_events','SELECT') THEN
    RAISE EXCEPTION 'Post-migration privilege verification failed';
  END IF;
END
$verify$;

COMMIT;
