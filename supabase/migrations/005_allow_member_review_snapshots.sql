-- Permitir que cada usuario aprobado guarde capturas de reseñas
-- únicamente para los negocios a los que pertenece.
-- No desactiva RLS ni concede permisos de escritura globales.

drop policy if exists app_business_reviews_member_insert
  on public.app_business_review_snapshots;

create policy app_business_reviews_member_insert
on public.app_business_review_snapshots
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_business_members m
    join public.app_profiles p on p.user_id = m.user_id
    join public.app_businesses b on b.id = m.business_id
    where m.business_id = app_business_review_snapshots.business_id
      and m.user_id = (select auth.uid())
      and p.status = 'approved'
      and b.status = 'approved'
  )
  and app_business_review_snapshots.platform in ('Google apertura', 'Google cierre')
  and app_business_review_snapshots.source = 'manual'
);

grant insert on public.app_business_review_snapshots to authenticated;
