-- Tenant-isolation test grants and self-scope policies, isolated test project only.
GRANT SELECT ON public.app_profiles, public.app_business_members, public.app_businesses TO authenticated;
DROP POLICY IF EXISTS nq_test_profile_self_select ON public.app_profiles;
CREATE POLICY nq_test_profile_self_select ON public.app_profiles
FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS nq_test_membership_self_select ON public.app_business_members;
CREATE POLICY nq_test_membership_self_select ON public.app_business_members
FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
