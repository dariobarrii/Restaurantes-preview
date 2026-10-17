-- NQ CENTRAL — AUDITORÍA DE SEGURIDAD DE SOLO LECTURA
-- Ejecutar en Supabase SQL Editor sobre el proyecto correcto.
-- Este archivo NO modifica datos, políticas, roles ni funciones.
-- Los resultados deben revisarse antes de aprobar el PR de seguridad.

-- 1) Confirmar proyecto/entorno y versión PostgreSQL.
select current_database() as database_name, current_user as executing_role,
       current_setting('server_version') as postgres_version;

-- 2) RLS y FORCE RLS de las tablas multi-negocio y de eventos legacy.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','p')
  and c.relname in (
    'app_profiles','app_restaurants','app_restaurant_members',
    'app_events','app_review_snapshots','app_businesses',
    'app_business_members','app_business_events',
    'app_business_review_snapshots','nfc_events',
    'nfc_card_tokens','nfc_stats'
  )
order by c.relname;

-- 3) Todas las políticas existentes en las tablas sensibles.
select schemaname, tablename, policyname, permissive, roles,
       cmd, qual as using_expression, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'app_profiles','app_restaurants','app_restaurant_members',
    'app_events','app_review_snapshots','app_businesses',
    'app_business_members','app_business_events',
    'app_business_review_snapshots','nfc_events',
    'nfc_card_tokens','nfc_stats'
  )
order by tablename, policyname;

-- 4) Privilegios SQL efectivos otorgados a roles de cliente.
select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated','PUBLIC')
  and table_name in (
    'app_profiles','app_restaurants','app_restaurant_members',
    'app_events','app_review_snapshots','app_businesses',
    'app_business_members','app_business_events',
    'app_business_review_snapshots','nfc_events',
    'nfc_card_tokens','nfc_stats'
  )
order by table_name, grantee, privilege_type;

-- 5) Definición y configuración de funciones privilegiadas/seguridad.
-- Revisar en particular app_is_admin() y register_nfc_event_with_token().
-- No asumir que el nombre o SECURITY DEFINER garantizan que estén bien protegidas.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as function_settings,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'app_is_admin',
    'register_nfc_event_with_token',
    'mirror_legacy_nfc_event_to_business'
  )
order by p.proname;

-- 6) EXECUTE grants de las funciones relevantes.
select routine_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'app_is_admin',
    'register_nfc_event_with_token',
    'mirror_legacy_nfc_event_to_business'
  )
order by routine_name, grantee, privilege_type;

-- 7) Triggers activos y función de destino; debe existir el trigger espejo.
select trigger_name, event_manipulation, event_object_table,
       action_timing, action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('nfc_events','app_business_events')
order by event_object_table, trigger_name, event_manipulation;

-- 8) Conteo de eventos por negocio y canal. Detecta huecos visibles,
-- pero comparar contra nfc_events requiere revisar nombres/fechas y la importación.
select b.name, b.slug, e.event_type, e.source, count(*) as total,
       min(e.created_at) as first_event, max(e.created_at) as last_event
from public.app_business_events e
join public.app_businesses b on b.id = e.business_id
group by b.name, b.slug, e.event_type, e.source
order by b.slug, e.event_type, e.source;

-- 9) Eventos legacy sin negocio reconocido por el trigger de sincronización.
select restaurant, event, count(*) as total,
       min(created_at) as first_event, max(created_at) as last_event
from public.nfc_events
where event in ('nfc_tap','qr_scan')
  and lower(trim(restaurant)) not in (
    'tzura steak house','veta steak house','feral steakhouse'
  )
group by restaurant, event
order by restaurant, event;

-- 10) Filas duplicadas en eventos importados desde la tabla legacy.
select legacy_event_id, count(*) as duplicate_count
from public.app_business_events
where legacy_event_id is not null
group by legacy_event_id
having count(*) > 1
order by duplicate_count desc;

-- 11) Estado de la función RPC (existe/no existe y firma exacta).
select p.oid::regprocedure as function_signature,
       p.prosecdef as security_definer,
       p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'register_nfc_event_with_token';

-- 12) Prueba manual necesaria tras la auditoría estática:
-- Con dos cuentas de restaurante reales A y B:
--   a) iniciar sesión como A; consultar app_business_events y snapshots;
--      confirmar que solo aparecen filas de negocios asignados a A.
--   b) intentar seleccionar/insertar/actualizar/borrar una fila del negocio B;
--      debe devolver cero filas o error RLS, sin cambios persistidos.
--   c) repetir al revés con B.
--   d) intentar modificar app_profiles.role/status y membresías desde una cuenta
--      de restaurante; debe ser denegado.
--   e) llamar register_nfc_event_with_token con token válido, inválido,
--      tarjeta pausada, token revocado y dos llamadas seguidas (rate limit).
--   f) comprobar que cada NFC/QR nuevo aparece una sola vez en la tabla legacy
--      y una sola vez en app_business_events.
