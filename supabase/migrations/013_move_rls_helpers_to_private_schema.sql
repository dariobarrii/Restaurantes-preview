-- Move SECURITY DEFINER RLS helper functions out of the exposed public schema.
-- Keep EXECUTE for authenticated because policies invoke the helpers; private schema
-- should remain outside PostgREST's exposed schema list.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

ALTER FUNCTION public.app_is_admin() SET SCHEMA private;
ALTER FUNCTION public.app_is_approved_member(uuid) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.app_is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.app_is_admin() TO authenticated;
REVOKE ALL ON FUNCTION private.app_is_approved_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.app_is_approved_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.app_protect_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) = OLD.user_id AND NOT private.app_is_admin() THEN
    NEW.role := OLD.role;
    NEW.status := OLD.status;
    NEW.email := OLD.email;
  END IF;
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.app_protect_profile_fields() FROM PUBLIC, anon, authenticated;
