-- READ ONLY: run manually only against the dedicated staging project.
-- Reports function metadata/ACLs and effective table privileges; never returns function bodies or table rows.
WITH target_functions AS (
  SELECT p.oid,p.proname,p.prosecdef,p.proacl,
         p.oid::regprocedure::text AS identity
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND (p.proname IN (
      'register_business_card_event_with_token',
      'consume_business_card_rate_limit',
      'mirror_legacy_nfc_event_to_business'
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
       pg_catalog.has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
       pg_catalog.has_table_privilege('anon',c.oid,'INSERT') AS anon_insert,
       pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
       pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT') AS authenticated_insert,
       pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE') AS authenticated_update,
       pg_catalog.has_table_privilege('service_role',c.oid,'INSERT') AS service_role_insert
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN (
    'app_business_card_tokens','app_business_events','nfc_events',
    'app_business_cards','app_businesses'
  )
  AND c.relkind IN ('r','p')
ORDER BY c.relname;

SELECT schemaname,tablename,policyname,cmd,roles
FROM pg_catalog.pg_policies
WHERE schemaname='public'
  AND tablename IN (
    'app_business_card_tokens','app_business_events','nfc_events',
    'app_business_cards','app_businesses'
  )
ORDER BY tablename,policyname;
