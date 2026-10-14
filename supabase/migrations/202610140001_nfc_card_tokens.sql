-- STAGED ONLY: review before applying to Supabase production.
-- Per-card bearer tokens are copyable if embedded in public NFC/QR URLs; combine with monitoring and rotation.

create table if not exists public.nfc_card_tokens (
  card_id uuid primary key,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  restaurant text not null check (restaurant in ('Feral Steakhouse', 'Tzura Steak House', 'Veta Steak House')),
  event text not null check (event in ('nfc_tap', 'qr_scan')),
  active boolean not null default true,
  last_event_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.nfc_card_tokens enable row level security;
revoke all on table public.nfc_card_tokens from anon, authenticated;
grant all on public.nfc_card_tokens to service_role;

create or replace function public.register_nfc_event_with_token(
  p_card_id uuid,
  p_token_hash text,
  p_device_type text default 'Desconocido'
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_card public.nfc_card_tokens%rowtype;
begin
  if p_card_id is null then
    raise exception using errcode = '22023', message = 'invalid_card';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_token';
  end if;
  if p_device_type is null or p_device_type not in ('iPhone/iPad', 'Android', 'PC/Mac', 'Desconocido') then
    raise exception using errcode = '22023', message = 'invalid_device';
  end if;

  select * into v_card
  from public.nfc_card_tokens
  where card_id = p_card_id
  for update;

  if not found or not v_card.active or v_card.token_hash <> p_token_hash then
    raise exception using errcode = '28000', message = 'invalid_or_revoked_card';
  end if;

-- Short per-card cooldown limits rapid duplicate posts without suppressing a card for tens of seconds.
  if v_card.last_event_at is not null and v_card.last_event_at > now() - interval '2 seconds' then
    raise exception using errcode = 'P0001', message = 'event_throttled';
  end if;

  update public.nfc_card_tokens set last_event_at = now() where card_id = p_card_id;
  insert into public.nfc_events (restaurant, event, device_type, card_id)
  values (v_card.restaurant, v_card.event, p_device_type, v_card.card_id);
  return true;
end;
$function$;

revoke all on function public.register_nfc_event_with_token(uuid, text, text) from public, anon, authenticated;
grant execute on function public.register_nfc_event_with_token(uuid, text, text) to service_role;

-- Provisioning must be done server-side by an administrator. Store SHA-256(token) in token_hash;
-- never store the raw token here. Test with a non-production card first.