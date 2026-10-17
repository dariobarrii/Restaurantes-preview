# Audit 013 — launch blockers and isolated tenant verification

Date: 2026-10-17

## Migration 009 discrepancy resolved

The prior `009_harden_nfc_token_validation.sql` targeted the legacy relation
`public.nfc_card_tokens` and function `public.register_nfc_event_with_token`.
Read-only inspection of production confirmed neither object exists. The live
business-card path uses `public.app_business_card_tokens` and
`public.register_business_card_event_with_token`, established by migration 010.
The 009 file is now intentionally a comment-only no-op to preserve historical
numbering without recreating the retired API. It has not been applied to
production.

## Isolated tenant RLS verification

The isolated project `rxxbmqilnozcnpwguqga` now contains synthetic Restaurant A
and Restaurant B identities, memberships, events, and review snapshots. SQL
requests executed as PostgreSQL role `authenticated` with each synthetic
`auth.uid()` claim returned only that tenant's event and review row:

- Tenant A UUID `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`: event 90001 and review 90001 only.
- Tenant B UUID `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`: event 90002 and review 90002 only.
- Unapproved synthetic identity `cccccccc-cccc-4ccc-8ccc-cccccccccccc`: zero events and zero review snapshots visible.
- `has_table_privilege(authenticated, app_business_card_tokens, SELECT)` was false.

This is a real PostgreSQL RLS check under the authenticated database role, not
a browser/session test. Browser login isolation still requires a browser test
with actual approved Auth users. No production memberships or data were changed.

## Remaining external / physical launch gates

- Supabase Auth leaked-password protection: the available Supabase connector
  exposes database/functions operations but no Auth-provider setting mutation.
  It remains a dashboard-only manual action in Tzura.
- Physical NFC and QR: a real phone/tag are required.
- Browser account integration: SQL RLS simulation is verified; a real browser/Auth-session check with two approved test accounts is still required.
- Per-client abuse protection: the direct Supabase endpoint does not expose a
  trustworthy client identity to the function. Do not trust client-supplied IP
  headers. A proxy/WAF with non-spoofable client identity, plus a protected
  origin route, requires external account/domain/DNS configuration and secrets.
  The 600/minute global ceiling is only a fallback, not per-client protection.
- Production migration 015 and matching function deployment remain gated until
  the manual gates above pass. Production data/settings remain unchanged.
