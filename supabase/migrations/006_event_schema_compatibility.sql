-- SECURITY / SCHEMA CONSISTENCY PATCH
-- Makes the event schema consumed by the portal and mirror trigger reproducible.
-- Safe to rerun: only adds missing columns/index; does not delete or rewrite historical rows.
begin;

alter table public.app_business_events
  add column if not exists device_type text;

alter table public.app_business_events
  add column if not exists legacy_event_id bigint;

create unique index if not exists app_business_events_legacy_event_id_uidx
  on public.app_business_events (legacy_event_id)
  where legacy_event_id is not null;

commit;

-- Read-only verification. Expected: both columns present and RLS enabled.
select
  c.column_name,
  c.data_type
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'app_business_events'
  and c.column_name in ('device_type', 'legacy_event_id')
order by c.column_name;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'app_businesses',
    'app_business_members',
    'app_business_events',
    'app_business_review_snapshots'
  )
order by c.relname;
