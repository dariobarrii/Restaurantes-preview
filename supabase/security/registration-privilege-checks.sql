-- READ ONLY: run manually only against the dedicated staging project.
-- Reports function metadata/ACLs and effective table privileges; no function bodies or table rows.
WITH target_functions AS (
  SELECT p.oid,p.proname,p.prosecdef,p.proacl,
         p.oid::regprocedure::text AS identity
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND (p.proname IN (
      'register_business_card_event_with_token',
      'consume_business_card_rate_limit',
      'mirror_legacy_nfc_event_to_business',\n      'app_is_admin'
    ) OR p.prosecdef)
)
SELECT f.identity,
       f.prosecdef AS security_definer,
       EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(f.proacl,pg_catalog.acldefault('f',p.proowner))
         ) acl
         WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
       ) AS public_execute_acl,
       pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE') AS anon_can_execute,
       pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE') AS authenticated_can_execute,
       pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE') AS service_role_can_execute
FROM target_functions f
JOIN pg_catalog.pg_proc p ON p.oid=f.oid
ORDER BY f.identity;

SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       pg_catalog.has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
       pg_catalog.has_table_privilege('anon',c.oid,'INSERT') AS anon_insert,
       pg_catalog.has_table_privilege('anon',c.oid,'UPDATE') AS anon_update,
       pg_catalog.has_table_privilege('anon',c.oid,'DELETE') AS anon_delete,
       pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
       pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT') AS authenticated_insert,
       pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE') AS authenticated_update,
       pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE') AS authenticated_delete,
       pg_catalog.has_table_privilege('service_role',c.oid,'SELECT') AS service_role_select,
       pg_catalog.has_table_privilege('service_role',c.oid,'INSERT') AS service_role_insert,
       pg_catalog.has_table_privilege('service_role',c.oid,'UPDATE') AS service_role_update,
       pg_catalog.has_table_privilege('service_role',c.oid,'DELETE') AS service_role_delete
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN (
    'app_business_card_tokens','app_business_events','nfc_events',
    'app_business_cards','app_businesses','app_profiles','app_business_members'
  )
  AND c.relkind IN ('r','p')
ORDER BY c.relname;

SELECT schemaname,tablename,policyname,cmd,roles,qual,with_check
FROM pg_catalog.pg_policies
WHERE schemaname='public'
  AND tablename IN (
    'app_business_card_tokens','app_business_events','nfc_events',
    'app_business_cards','app_businesses','app_profiles','app_business_members'
  )
ORDER BY tablename,policyname;

-- Trigger metadata for the legacy mirror; no function body or event rows are returned.
SELECT tbl.relname AS source_table,
       t.tgname AS trigger_name,
       t.tgenabled AS enabled_state,
       t.tgisinternal AS internal_trigger,
       t.tgfoid::regprocedure::text AS trigger_function,
       pg_catalog.pg_get_triggerdef(t.oid,true) AS trigger_definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class tbl ON tbl.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=tbl.relnamespace
JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid
JOIN pg_catalog.pg_namespace fn ON fn.oid=f.pronamespace
WHERE n.nspname='public' AND tbl.relname='nfc_events'
  AND fn.nspname='public' AND f.proname='mirror_legacy_nfc_event_to_business'
ORDER BY t.tgname;
