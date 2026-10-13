-- MIGRACIÓN ADITIVA MULTI-NEGOCIO
-- PREPARAR / REVISAR ANTES DE EJECUTAR. No borra ni modifica las tablas antiguas.
-- Crea tablas genéricas nuevas y copia los datos de app_restaurants/app_events/app_review_snapshots
-- cuando el administrador decida ejecutar esta migración en Supabase.

create table if not exists public.app_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  category text not null default 'other'
    check (category in ('restaurant','hair_salon','barbershop','beauty','gym','retail','clinic','cafe','other')),
  status text not null default 'pending'
    check (status in ('pending','approved','suspended')),
  legacy_restaurant_id uuid unique,
  created_at timestamptz not null default now()
);

create table if not exists public.app_business_members (
  business_id uuid not null references public.app_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'owner' check (member_role in ('owner','manager','viewer')),
  created_at timestamptz not null default now(),
  primary key (business_id,user_id)
);

create table if not exists public.app_business_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.app_businesses(id) on delete cascade,
  event_type text not null check (event_type in ('nfc_tap','qr_scan')),
  created_at timestamptz not null default now(),
  source text not null default 'central_app'
);
create index if not exists app_business_events_business_time_idx
  on public.app_business_events(business_id,created_at desc);

create table if not exists public.app_business_review_snapshots (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.app_businesses(id) on delete cascade,
  platform text not null default 'google',
  review_count integer not null check (review_count >= 0),
  captured_at timestamptz not null default now(),
  source text not null default 'manual'
    check (source in ('manual','verified_import','api'))
);
create index if not exists app_business_reviews_business_time_idx
  on public.app_business_review_snapshots(business_id,captured_at desc);

-- Copia los restaurantes de la plataforma anterior a la nueva tabla genérica.
insert into public.app_businesses (name,slug,category,status,legacy_restaurant_id,created_at)
select r.name,r.slug,'restaurant',r.status,r.id,r.created_at
from public.app_restaurants r
on conflict (slug) do nothing;

-- Copia los eventos que ya estén en las tablas app_* nuevas. Los eventos históricos de nfc_events
-- y otras tablas antiguas NO se copian automáticamente porque primero hay que validar su estructura.
insert into public.app_business_events (business_id,event_type,created_at,source)
select b.id,e.event_type,e.created_at,e.source
from public.app_events e
join public.app_businesses b on b.legacy_restaurant_id=e.restaurant_id
where not exists (
  select 1 from public.app_business_events be
  where be.business_id=b.id and be.event_type=e.event_type and be.created_at=e.created_at and be.source=e.source
);

insert into public.app_business_review_snapshots (business_id,platform,review_count,captured_at,source)
select b.id,'google',s.review_count,s.captured_at,s.source
from public.app_review_snapshots s
join public.app_businesses b on b.legacy_restaurant_id=s.restaurant_id
where not exists (
  select 1 from public.app_business_review_snapshots bs
  where bs.business_id=b.id and bs.platform='google'
    and bs.review_count=s.review_count and bs.captured_at=s.captured_at
);

-- Asignar miembros antiguos a sus negocios correspondientes.
insert into public.app_business_members (business_id,user_id,member_role,created_at)
select b.id,m.user_id,m.member_role,m.created_at
from public.app_restaurant_members m
join public.app_businesses b on b.legacy_restaurant_id=m.restaurant_id
on conflict (business_id,user_id) do nothing;

-- RLS: solo administradores aprobados pueden administrar los datos nuevos.
-- Los usuarios de restaurante solo pueden leer negocios a los que estén asociados y aprobados.
alter table public.app_businesses enable row level security;
alter table public.app_business_members enable row level security;
alter table public.app_business_events enable row level security;
alter table public.app_business_review_snapshots enable row level security;

drop policy if exists app_businesses_select_member_admin on public.app_businesses;
create policy app_businesses_select_member_admin on public.app_businesses for select to authenticated
using (public.app_is_admin() or exists (
  select 1 from public.app_business_members m
  join public.app_profiles p on p.user_id=m.user_id
  where m.business_id=app_businesses.id and m.user_id=(select auth.uid())
    and p.status='approved' and app_businesses.status='approved'
));

drop policy if exists app_businesses_admin_write on public.app_businesses;
create policy app_businesses_admin_write on public.app_businesses for all to authenticated
using (public.app_is_admin()) with check (public.app_is_admin());

drop policy if exists app_business_members_select_member_admin on public.app_business_members;
create policy app_business_members_select_member_admin on public.app_business_members for select to authenticated
using (user_id=(select auth.uid()) or public.app_is_admin());

drop policy if exists app_business_members_admin_write on public.app_business_members;
create policy app_business_members_admin_write on public.app_business_members for all to authenticated
using (public.app_is_admin()) with check (public.app_is_admin());

drop policy if exists app_business_events_select_member_admin on public.app_business_events;
create policy app_business_events_select_member_admin on public.app_business_events for select to authenticated
using (public.app_is_admin() or exists (
  select 1 from public.app_business_members m
  join public.app_profiles p on p.user_id=m.user_id
  join public.app_businesses b on b.id=m.business_id
  where m.business_id=app_business_events.business_id and m.user_id=(select auth.uid())
    and p.status='approved' and b.status='approved'
));

drop policy if exists app_business_events_admin_write on public.app_business_events;
create policy app_business_events_admin_write on public.app_business_events for all to authenticated
using (public.app_is_admin()) with check (public.app_is_admin());

drop policy if exists app_business_reviews_select_member_admin on public.app_business_review_snapshots;
create policy app_business_reviews_select_member_admin on public.app_business_review_snapshots for select to authenticated
using (public.app_is_admin() or exists (
  select 1 from public.app_business_members m
  join public.app_profiles p on p.user_id=m.user_id
  join public.app_businesses b on b.id=m.business_id
  where m.business_id=app_business_review_snapshots.business_id and m.user_id=(select auth.uid())
    and p.status='approved' and b.status='approved'
));

drop policy if exists app_business_reviews_admin_write on public.app_business_review_snapshots;
create policy app_business_reviews_admin_write on public.app_business_review_snapshots for all to authenticated
using (public.app_is_admin()) with check (public.app_is_admin());

grant select,insert,update,delete on public.app_businesses to authenticated;
grant select,insert,update,delete on public.app_business_members to authenticated;
grant select,insert,update,delete on public.app_business_events to authenticated;
grant select,insert,update,delete on public.app_business_review_snapshots to authenticated;
