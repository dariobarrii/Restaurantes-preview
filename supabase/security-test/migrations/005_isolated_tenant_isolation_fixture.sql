-- Isolated tenant-isolation fixture only. Never apply to production.
-- Creates two synthetic restaurant tenants and policies that mirror the
-- production private-event/review read predicates. No auth.users or production
-- records are touched; test identities are fixed synthetic UUIDs.

CREATE TABLE IF NOT EXISTS public.app_profiles (
  user_id uuid PRIMARY KEY,
  full_name text,
  role text NOT NULL DEFAULT 'restaurant',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  email text
);
CREATE TABLE IF NOT EXISTS public.app_business_members (
  business_id uuid NOT NULL REFERENCES public.app_businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  member_role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.app_business_events (
  id bigint PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.app_businesses(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'central_app',
  legacy_event_id bigint,
  device_type text,
  card_id uuid
);
CREATE TABLE IF NOT EXISTS public.app_business_review_snapshots (
  id bigint PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.app_businesses(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'google',
  review_count integer NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual'
);

ALTER TABLE public.app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_business_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_business_review_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_profiles, public.app_business_members,
  public.app_business_events, public.app_business_review_snapshots
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_business_events, public.app_business_review_snapshots TO authenticated;

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.app_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_profiles p
    WHERE p.user_id = (SELECT auth.uid())
      AND p.role = 'admin' AND p.status = 'approved'
  );
$function$;
REVOKE ALL ON FUNCTION private.app_is_admin() FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.app_is_admin() TO authenticated;

DROP POLICY IF EXISTS app_business_events_select_member_admin ON public.app_business_events;
CREATE POLICY app_business_events_select_member_admin
ON public.app_business_events FOR SELECT TO authenticated
USING (
  private.app_is_admin() OR EXISTS (
    SELECT 1
    FROM public.app_business_members m
    JOIN public.app_profiles p ON p.user_id = m.user_id
    JOIN public.app_businesses b ON b.id = m.business_id
    WHERE m.business_id = app_business_events.business_id
      AND m.user_id = (SELECT auth.uid())
      AND p.status = 'approved'
      AND b.status = 'approved'
  )
);

DROP POLICY IF EXISTS app_business_reviews_select_member_admin ON public.app_business_review_snapshots;
CREATE POLICY app_business_reviews_select_member_admin
ON public.app_business_review_snapshots FOR SELECT TO authenticated
USING (
  private.app_is_admin() OR EXISTS (
    SELECT 1
    FROM public.app_business_members m
    JOIN public.app_profiles p ON p.user_id = m.user_id
    JOIN public.app_businesses b ON b.id = m.business_id
    WHERE m.business_id = app_business_review_snapshots.business_id
      AND m.user_id = (SELECT auth.uid())
      AND p.status = 'approved'
      AND b.status = 'approved'
  )
);

INSERT INTO public.app_businesses (id,name,slug,status)
VALUES ('55555555-5555-4555-8555-555555555555','NQ Test Restaurant B','nq-central-tenant-b','approved')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, status=EXCLUDED.status;

INSERT INTO public.app_profiles (user_id,full_name,role,status,email)
VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','NQ Test Restaurant A','restaurant','approved','tenant-a@example.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','NQ Test Restaurant B','restaurant','approved','tenant-b@example.invalid')
ON CONFLICT (user_id) DO UPDATE SET full_name=EXCLUDED.full_name, role=EXCLUDED.role, status=EXCLUDED.status, email=EXCLUDED.email;

INSERT INTO public.app_business_members (business_id,user_id,member_role)
VALUES
 ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner'),
 ('55555555-5555-4555-8555-555555555555','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','owner')
ON CONFLICT (business_id,user_id) DO UPDATE SET member_role=EXCLUDED.member_role;

INSERT INTO public.app_business_events (id,business_id,event_type,source,device_type)
VALUES
 (90001,'22222222-2222-4222-8222-222222222222','nfc_tap','tenant_isolation_test','mobile'),
 (90002,'55555555-5555-4555-8555-555555555555','qr_scan','tenant_isolation_test','mobile')
ON CONFLICT (id) DO UPDATE SET business_id=EXCLUDED.business_id,event_type=EXCLUDED.event_type,source=EXCLUDED.source,device_type=EXCLUDED.device_type;

INSERT INTO public.app_business_review_snapshots (id,business_id,platform,review_count,source)
VALUES
 (90001,'22222222-2222-4222-8222-222222222222','Google apertura',100,'manual'),
 (90002,'55555555-5555-4555-8555-555555555555','Google apertura',200,'manual')
ON CONFLICT (id) DO UPDATE SET business_id=EXCLUDED.business_id,platform=EXCLUDED.platform,review_count=EXCLUDED.review_count,source=EXCLUDED.source;
