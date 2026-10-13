-- MIGRACIÓN ADITIVA: historial NFC/QR de Tzura, VETA y Feral
-- Ejecutar en el SQL Editor del proyecto Supabase qcvhxrudzjlgqlhvnkkl.
-- No modifica ni elimina nfc_events ni ninguna página existente.
-- Es re-ejecutable: cada evento histórico se identifica por su id original.

begin;

-- Columna de trazabilidad para no importar el mismo evento dos veces.
alter table public.app_business_events
  add column if not exists legacy_event_id bigint;

create unique index if not exists app_business_events_legacy_event_id_uidx
  on public.app_business_events (legacy_event_id)
  where legacy_event_id is not null;

-- Crear las fichas solo si aún no existen (no pisa Negocio Demo ni otros negocios).
insert into public.app_businesses (name, slug, category, status)
values
  ('Tzura Steak House', 'tzura-steak-house', 'restaurant', 'approved'),
  ('Veta Steak House', 'veta-steak-house', 'restaurant', 'approved'),
  ('Feral Steakhouse', 'feral-steakhouse', 'restaurant', 'approved')
on conflict (slug) do nothing;

-- Importar los eventos NFC y QR conservando su fecha y su ID original.
-- Se aceptan solo los nombres/eventos conocidos para evitar importar filas ambiguas.
insert into public.app_business_events
  (business_id, event_type, created_at, source, legacy_event_id)
select
  b.id,
  e.event,
  e.created_at,
  'legacy_nfc_events',
  e.id
from public.nfc_events e
join public.app_businesses b
  on (
    (lower(trim(e.restaurant)) = 'tzura steak house' and b.slug = 'tzura-steak-house')
    or (lower(trim(e.restaurant)) = 'veta steak house' and b.slug = 'veta-steak-house')
    or (lower(trim(e.restaurant)) = 'feral steakhouse' and b.slug = 'feral-steakhouse')
  )
where e.event in ('nfc_tap', 'qr_scan')
  and e.created_at is not null
on conflict (legacy_event_id) where legacy_event_id is not null do nothing;

commit;

-- Comprobación: muestra cuántos eventos históricos quedaron por negocio y tipo.
select
  b.name as negocio,
  e.event_type as tipo_evento,
  count(e.id) as eventos_importados,
  min(e.created_at) as primer_evento,
  max(e.created_at) as ultimo_evento
from public.app_businesses b
left join public.app_business_events e
  on e.business_id = b.id
 and e.source = 'legacy_nfc_events'
where b.slug in ('tzura-steak-house', 'veta-steak-house', 'feral-steakhouse')
group by b.name, e.event_type
order by b.name, e.event_type;
