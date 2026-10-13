-- CONEXIÓN AUTOMÁTICA DE NUEVAS LECTURAS NFC/QR
-- Requiere haber ejecutado 003_import_legacy_nfc_qr.sql.
-- No cambia el HTML de las páginas existentes ni elimina datos históricos.
-- Cada nuevo INSERT en public.nfc_events se refleja en app_business_events.

begin;

create or replace function public.mirror_legacy_nfc_event_to_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_slug text;
  target_business_id uuid;
begin
  if new.event not in ('nfc_tap', 'qr_scan') then
    return new;
  end if;

  target_slug := case lower(trim(new.restaurant))
    when 'tzura steak house' then 'tzura-steak-house'
    when 'veta steak house' then 'veta-steak-house'
    when 'feral steakhouse' then 'feral-steakhouse'
    else null
  end;

  if target_slug is null then
    return new;
  end if;

  select id
    into target_business_id
  from public.app_businesses
  where slug = target_slug
  limit 1;

  if target_business_id is null then
    return new;
  end if;

  insert into public.app_business_events
    (business_id, event_type, created_at, source, legacy_event_id)
  values
    (target_business_id, new.event, coalesce(new.created_at, now()),
     'legacy_nfc_events', new.id)
  on conflict (legacy_event_id) where legacy_event_id is not null do nothing;

  return new;
end;
$$;

drop trigger if exists mirror_legacy_nfc_event_to_business_trigger
  on public.nfc_events;

create trigger mirror_legacy_nfc_event_to_business_trigger
after insert on public.nfc_events
for each row
execute function public.mirror_legacy_nfc_event_to_business();

commit;

-- Verificación: después de ejecutar, esta consulta muestra la hora del evento más reciente
-- en la tabla antigua y en el panel central. No genera eventos de prueba.
select
  restaurant,
  event,
  max(created_at) as ultimo_evento_en_tabla_original
from public.nfc_events
where lower(trim(restaurant)) in ('tzura steak house','veta steak house','feral steakhouse')
  and event in ('nfc_tap','qr_scan')
group by restaurant, event
order by restaurant, event;
