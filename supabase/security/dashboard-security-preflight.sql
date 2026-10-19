-- Read-only preflight for NQ Central dashboard/schema/security migrations 020 and 021.
-- Run only in the named staging project. Returns schema/catalog metadata, never event/customer rows.

WITH expected(table_name,column_name,expected_type) AS (
  VALUES
    ('app_businesses','id','uuid'),('app_businesses','name','text'),('app_businesses','slug','text'),
    ('app_businesses','status','text'),('app_businesses','category','text'),
    ('app_business_cards','id','uuid'),('app_business_cards','business_id','uuid'),
    ('app_business_cards','channel','text'),('app_business_cards','target_url','text'),
    ('app_business_cards','status','text'),('app_business_cards','archived_at','timestamp with time zone'),
    ('app_business_cards','label','text'),
    ('app_profiles','user_id','uuid'),('app_profiles','full_name','text'),
    ('app_profiles','role','text'),('app_profiles','status','text'),
    ('app_business_members','business_id','uuid'),('app_business_members','user_id','uuid'),
    ('app_business_members','member_role','text'),
    ('app_business_events','business_id','uuid'),('app_business_events','event_type','text'),
    ('app_business_events','created_at','timestamp with time zone'),
    ('app_business_review_snapshots','business_id','uuid'),('app_business_review_snapshots','platform','text'),
    ('app_business_review_snapshots','review_count','integer'),('app_business_review_snapshots','source','text')
)
SELECT e.table_name,e.column_name,e.expected_type,c.data_type AS actual_type,
       (c.column_name IS NOT NULL AND c.data_type=e.expected_type) AS matches
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name
ORDER BY e.table_name,e.column_name;

SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS force_rls,
       has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
       has_table_privilege('anon',c.oid,'INSERT') AS anon_insert,
       has_table_privilege('anon',c.oid,'UPDATE') AS anon_update,
       has_table_privilege('anon',c.oid,'DELETE') AS anon_delete,
       has_table_privilege('anon',c.oid,'TRUNCATE') AS anon_truncate,
       has_table_privilege('authenticated',c.oid,'SELECT') AS auth_select,
       has_table_privilege('authenticated',c.oid,'INSERT') AS auth_insert,
       has_table_privilege('authenticated',c.oid,'UPDATE') AS auth_update,
       has_table_privilege('authenticated',c.oid,'DELETE') AS auth_delete,
       has_table_privilege('authenticated',c.oid,'TRUNCATE') AS auth_truncate,
       has_table_privilege('service_role',c.oid,'SELECT') AS service_select,
       has_table_privilege('service_role',c.oid,'INSERT') AS service_insert,
       has_table_privilege('service_role',c.oid,'UPDATE') AS service_update
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND c.relname IN ('app_businesses','app_business_cards','app_profiles','app_business_members',
                    'app_business_events','app_business_review_snapshots')
ORDER BY c.relname;

SELECT has_column_privilege('authenticated','public.app_profiles','full_name','UPDATE') AS auth_can_update_full_name,
       has_column_privilege('authenticated','public.app_profiles','role','UPDATE') AS auth_can_update_role,
       has_column_privilege('authenticated','public.app_profiles','status','UPDATE') AS auth_can_update_status,
       to_regprocedure('private.app_is_admin()') IS NOT NULL AS admin_helper_exists;

SELECT schemaname,tablename,policyname,cmd,roles
FROM pg_policies WHERE schemaname='public'
  AND tablename IN ('app_businesses','app_business_cards','app_profiles','app_business_members',
                    'app_business_events','app_business_review_snapshots')
ORDER BY tablename,policyname;

SELECT p.oid::regprocedure::text AS function_signature,r.rolname AS owner,p.prosecdef AS security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_execute
FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
WHERE p.oid IN (
  to_regprocedure('private.app_is_admin()'),
  to_regprocedure('public.register_business_card_event_with_token(uuid,text,text)'),
  to_regprocedure('public.consume_business_card_rate_limit(text,integer,integer)')
)
ORDER BY 1;

SELECT t.tgname AS trigger_name,t.tgenabled AS enabled_state,t.tgrelid::regclass::text AS relation,
       p.proname AS function_name,pg_get_triggerdef(t.oid,true) AS trigger_definition_metadata
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND t.tgrelid='public.nfc_events'::regclass
ORDER BY t.tgname;

-- Historical reconciliation is in historical-event-reconciliation.sql.
