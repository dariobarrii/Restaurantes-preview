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

  IF pg_catalog.pg_get_serial_sequence('public.app_business_events','id') IS NULL
     OR pg_catalog.pg_get_serial_sequence('public.app_business_review_snapshots','id') IS NULL THEN
    RAISE EXCEPTION 'Migration 020 must establish managed ID defaults before migration 021';
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

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid='public.app_business_review_snapshots'::regclass
      AND p.polcmd IN ('a','*')
      AND p.polname <> 'nq_central_member_review_insert'
      AND (
        0 = ANY(p.polroles)
        OR 'anon'::regrole::oid = ANY(p.polroles)
        OR 'authenticated'::regrole::oid = ANY(p.polroles)
      )
  ) THEN
    RAISE EXCEPTION 'Existing public/anon/authenticated review INSERT policy must be reviewed before migration 021';
  END IF;

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
    WHERE table_schema='public' AND table_name='app_business_review_snapshots' AND column_name='source'
      AND data_type='text' AND column_default LIKE '%manual%')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_business_review_snapshots' AND column_name='captured_at'
      AND column_default IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_business_review_snapshots' AND column_name='id'
      AND data_type='bigint') THEN
    RAISE EXCEPTION 'One or more required dashboard columns or safe review defaults are missing';
  END IF;
END
$preflight$;

-- Authenticated review inserts rely on the ID default created/verified by 020.
-- Grant only sequence use needed for DEFAULT nextval; browser users cannot set IDs.
DO $dashboard_sequence_acl$
DECLARE
  t text;
  v_sequence text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_business_events','app_business_review_snapshots'
  ] LOOP
    v_sequence := pg_catalog.pg_get_serial_sequence('public.' || t, 'id');
    IF v_sequence IS NULL THEN
      RAISE EXCEPTION 'Migration 020 must establish the public.% ID sequence first', t;
    END IF;
    -- Sequence ACLs are independent of table ACLs. Clear pre-existing direct
    -- and PUBLIC grants on both dashboard ID sequences before adding any need.
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated',
      v_sequence::regclass
    );
    IF t='app_business_review_snapshots' THEN
      EXECUTE pg_catalog.format(
        'GRANT USAGE ON SEQUENCE %s TO authenticated, service_role',
        v_sequence::regclass
      );
    END IF;
  END LOOP;
END
$dashboard_sequence_acl$;

-- Browser clients keep scoped reads; all business/card writes go through the
-- authenticated management Edge Function using its server-side service role.
REVOKE ALL PRIVILEGES ON TABLE public.app_businesses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.app_businesses TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_businesses TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.app_business_cards FROM PUBLIC, anon, authenticated;
-- Browser clients do not need card rows; token validation is the only public lookup.
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_business_cards TO service_role;

-- MAINTAIN exists only on PostgreSQL 17+. Revoke it explicitly when available;
-- older supported staging majors have no such table privilege.
DO $revoke_maintain_acl$
DECLARE
  t text;
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    FOREACH t IN ARRAY ARRAY[
      'app_businesses','app_business_cards','app_profiles','app_business_members',
      'app_business_events','app_business_review_snapshots'
    ] LOOP
      EXECUTE pg_catalog.format(
        'REVOKE MAINTAIN ON TABLE public.%I FROM PUBLIC, anon, authenticated', t
      );
    END LOOP;
  END IF;
END
$revoke_maintain_acl$;

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

-- Table-level REVOKE does not remove earlier column-level ACLs. Clear those
-- direct grants too, then add back only the reviewed profile/review columns.
DO $revoke_column_acl$
DECLARE
  t text;
  c record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_businesses','app_business_cards','app_profiles','app_business_members',
    'app_business_events','app_business_review_snapshots'
  ] LOOP
    FOR c IN
      SELECT a.attname
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=pg_catalog.to_regclass('public.' || t)
        AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        c.attname, t
      );
    END LOOP;
  END LOOP;
END
$revoke_column_acl$;

GRANT SELECT ON TABLE public.app_business_review_snapshots TO authenticated;
-- The client may submit only the tenant, capture kind, and manually observed
-- count. id/captured_at/source are generated or fixed by server-side defaults.
GRANT INSERT (business_id, platform, review_count)
  ON TABLE public.app_business_review_snapshots TO authenticated;
GRANT SELECT ON TABLE public.app_business_review_snapshots TO service_role;

-- Add administrator read access without broadening member rows. Existing
-- approved-public and own-membership SELECT policies remain in place.
DROP POLICY IF EXISTS nq_central_admin_business_select ON public.app_businesses;
CREATE POLICY nq_central_admin_business_select ON public.app_businesses
  FOR SELECT TO authenticated USING ((SELECT private.app_is_admin()));

-- There is intentionally no authenticated card SELECT policy: the portal's card
-- list is served by the authenticated management Edge Function, not PostgREST.

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
    AND review_count >= 0
  );

DO $verify$
BEGIN
  IF NOT pg_catalog.has_table_privilege('anon','public.app_businesses','SELECT')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.app_businesses','SELECT')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.app_business_members','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_members','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_members','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_members','DELETE')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.app_business_events','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_events','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_events','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_events','DELETE')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.app_business_review_snapshots','SELECT')
     OR NOT pg_catalog.has_table_privilege('authenticated','public.app_business_review_snapshots','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_review_snapshots','UPDATE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_review_snapshots','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_review_snapshots','TRUNCATE')
     OR pg_catalog.has_table_privilege('anon','public.app_business_review_snapshots','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_review_snapshots','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.app_profiles','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.app_business_members','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_events','INSERT')
     OR pg_catalog.has_table_privilege('anon','public.app_profiles','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_members','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_events','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','SELECT')
     OR pg_catalog.has_table_privilege('anon','public.app_businesses','INSERT')
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
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','INSERT')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','DELETE')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','TRUNCATE')
     OR pg_catalog.has_column_privilege('authenticated','public.app_profiles','role','UPDATE')
     OR pg_catalog.has_column_privilege('authenticated','public.app_profiles','status','UPDATE')
     OR NOT pg_catalog.has_column_privilege('authenticated','public.app_profiles','full_name','UPDATE')
     OR pg_catalog.has_table_privilege('anon','public.app_businesses','REFERENCES')
     OR pg_catalog.has_table_privilege('anon','public.app_businesses','TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated','public.app_businesses','REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated','public.app_businesses','TRIGGER')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','REFERENCES')
     OR pg_catalog.has_table_privilege('anon','public.app_business_cards','TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','REFERENCES')
     OR pg_catalog.has_table_privilege('authenticated','public.app_business_cards','TRIGGER')
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

DO $verify_column_acl$
DECLARE
  t text;
  r text;
  c record;
  allow_insert boolean;
  allow_update boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_businesses','app_business_cards','app_profiles','app_business_members',
    'app_business_events','app_business_review_snapshots'
  ] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOR c IN
        SELECT a.attname
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=pg_catalog.to_regclass('public.' || t)
          AND a.attnum > 0 AND NOT a.attisdropped
      LOOP
        allow_insert := r='authenticated'
          AND t='app_business_review_snapshots'
          AND c.attname IN ('business_id','platform','review_count');
        allow_update := r='authenticated'
          AND t='app_profiles'
          AND c.attname='full_name';
        IF pg_catalog.has_column_privilege(r,'public.' || t,c.attname,'INSERT') IS DISTINCT FROM allow_insert
           OR pg_catalog.has_column_privilege(r,'public.' || t,c.attname,'UPDATE') IS DISTINCT FROM allow_update
           OR pg_catalog.has_column_privilege(r,'public.' || t,c.attname,'REFERENCES') THEN
          RAISE EXCEPTION 'Unexpected effective column write/reference privilege for % on public.%.%', r, t, c.attname;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$verify_column_acl$;

DO $verify_restricted_acl$
DECLARE
  t text;
  r text;
  p text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_businesses','app_business_cards','app_profiles','app_business_members',
    'app_business_events','app_business_review_snapshots'
  ] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY[
        'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
      ] LOOP
        IF p='MAINTAIN' AND current_setting('server_version_num')::integer < 170000 THEN
          CONTINUE;
        END IF;
        IF pg_catalog.has_table_privilege(r, 'public.' || t, p) THEN
          RAISE EXCEPTION 'Unexpected effective % privilege for % on public.%', p, r, t;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF NOT pg_catalog.has_column_privilege(
       'authenticated','public.app_business_review_snapshots','business_id','INSERT')
     OR NOT pg_catalog.has_column_privilege(
       'authenticated','public.app_business_review_snapshots','platform','INSERT')
     OR NOT pg_catalog.has_column_privilege(
       'authenticated','public.app_business_review_snapshots','review_count','INSERT')
     OR pg_catalog.has_column_privilege(
       'authenticated','public.app_business_review_snapshots','id','INSERT')
     OR pg_catalog.has_column_privilege(
       'authenticated','public.app_business_review_snapshots','captured_at','INSERT')
     OR pg_catalog.has_column_privilege(
       'authenticated','public.app_business_review_snapshots','source','INSERT') THEN
    RAISE EXCEPTION 'Review snapshot INSERT columns do not match the client capture flow';
  END IF;

  IF pg_catalog.has_sequence_privilege(
       'anon', pg_catalog.pg_get_serial_sequence(
         'public.app_business_events','id'), 'USAGE')
     OR pg_catalog.has_sequence_privilege(
       'authenticated', pg_catalog.pg_get_serial_sequence(
         'public.app_business_events','id'), 'USAGE')
     OR pg_catalog.has_sequence_privilege(
       'anon', pg_catalog.pg_get_serial_sequence(
         'public.app_business_events','id'), 'SELECT')
     OR pg_catalog.has_sequence_privilege(
       'anon', pg_catalog.pg_get_serial_sequence(
         'public.app_business_events','id'), 'UPDATE')
     OR pg_catalog.has_sequence_privilege(
       'authenticated', pg_catalog.pg_get_serial_sequence(
         'public.app_business_events','id'), 'SELECT')
     OR pg_catalog.has_sequence_privilege(
       'authenticated', pg_catalog.pg_get_serial_sequence(
         'public.app_business_events','id'), 'UPDATE')
     OR pg_catalog.has_sequence_privilege(
       'anon', pg_catalog.pg_get_serial_sequence(
         'public.app_business_review_snapshots','id'), 'USAGE')
     OR pg_catalog.has_sequence_privilege(
       'anon', pg_catalog.pg_get_serial_sequence(
         'public.app_business_review_snapshots','id'), 'SELECT')
     OR pg_catalog.has_sequence_privilege(
       'anon', pg_catalog.pg_get_serial_sequence(
         'public.app_business_review_snapshots','id'), 'UPDATE')
     OR NOT pg_catalog.has_sequence_privilege(
       'authenticated', pg_catalog.pg_get_serial_sequence(
         'public.app_business_review_snapshots','id'), 'USAGE')
     OR pg_catalog.has_sequence_privilege(
       'authenticated', pg_catalog.pg_get_serial_sequence(
         'public.app_business_review_snapshots','id'), 'SELECT')
     OR pg_catalog.has_sequence_privilege(
       'authenticated', pg_catalog.pg_get_serial_sequence(
         'public.app_business_review_snapshots','id'), 'UPDATE')
     OR NOT pg_catalog.has_sequence_privilege(
       'service_role', pg_catalog.pg_get_serial_sequence(
         'public.app_business_review_snapshots','id'), 'USAGE') THEN
    RAISE EXCEPTION 'Effective dashboard ID sequence privileges do not match the portal flow';
  END IF;
END
$verify_restricted_acl$;

COMMIT;
