# NQ Central security verification — 2026-10-17

## Applied to Supabase

### NQ Central Security Test
- Deployed `register-nfc-event` version 2 with `verify_jwt=false`.
- Endpoint now accepts a raw per-card 256-bit hex bearer token, hashes it with SHA-256 server-side, and sends only the digest to the RPC.
- The RPC `register_nfc_event_with_token` is executable only by `service_role`.
- `anon` and `authenticated` have no direct table access to `nfc_card_tokens` or `nfc_events`.

### Tzura SteakHouse / NQ Central app database
- Applied token-gated card registration: `app_business_card_tokens`, `register_business_card_event_with_token`, and Edge Function `register-business-card-event` version 1.
- Public direct read/write access to legacy event tables remains revoked.
- Active card metadata remains publicly readable to support scanning; token hashes are private and admin-managed.
- The legacy event mirror now copies `card_id` and `device_type` into `app_business_events`, preserving per-card analytics.
- Admin card usage reads from `app_business_events`, not the locked-down `nfc_events` table.
- Admin card creation/rotation generates a cryptographically random 256-bit token, stores only its SHA-256 hash, and shows the tokenized URL once. Regenerating a link invalidates the previous token. The bearer token is carried in the URL fragment (not sent to the static host in the HTTP request) and is removed from the browser address bar on load.

## Database tests performed

### Token RPC in NQ Central Security Test
- Correct active card + correct hash: `ok=true`; event count increased by one (12 → 13).
- Immediate repeat: `rate_limited`; no extra event.
- Wrong hash: `invalid_card`.
- Revoked card: `invalid_card`.
- Null token, null device type, invalid device type: all `invalid_request`.

### Token RPC in Tzura app database
- Correct active card + correct hash: `ok=true`; mirrored event counts incremented together (102 → 103 in `nfc_events`, `app_events`, and `app_business_events`).
- Immediate repeat: `rate_limited`.
- Wrong hash: `invalid_card`.
- Paused card: `invalid_card`; card status was restored after the test.
- Event mirror now preserves the originating card ID.
- Public/anonymous and authenticated direct inserts to `nfc_events` are not granted.

### Tenant isolation and profile protections
Using the approved Feral restaurant account in a transaction under the `authenticated` role:
- Only its assigned business was visible (1 business).
- It could read its 46 business events and its own review snapshots.
- It could not insert a review snapshot for Tzura; RLS rejected it.
- It could not insert an event for Tzura; RLS rejected it.
- A self-update attempt to change its role to admin, status, and email was neutralized by the profile-protection trigger; role stayed `restaurant`, status stayed `approved`, and email stayed unchanged.
- A member can read active public card metadata (3 active cards in the current test data), including when already signed in, so the scanner does not break for logged-in users.
- An unrelated authenticated identity with no profile/membership sees 0 businesses, 0 events, 0 review snapshots, 0 memberships, and 0 token rows.
- Admin-only token rotation policy was exercised under the authenticated admin role; the upsert succeeded inside a rolled-back test transaction. The restaurant member sees 0 token rows.
- The admin profile could see all 4 businesses and 102 pre-test events.

## Remaining before launch
- Invoke both Edge Function endpoints over HTTP with valid, invalid, revoked, and malformed payloads. The Supabase integration can deploy/read functions but exposes no direct invocation action in this session; SQL RPC behavior was tested independently. The Edge Function deployment succeeded and the active version is confirmed.
- Browser-test card creation, token rotation, and a complete QR/NFC scan on desktop and phone. Static code checks passed, but the browser flow has not yet been executed end-to-end. The card scanner no longer loads a third-party JavaScript bundle; it uses native fetch calls, keeps the token in the URL fragment, and removes it from the address bar.
- Configure Supabase Auth leaked-password protection in project settings; it is currently disabled in Tzura SteakHouse.
- Add an IP/global abuse throttle or gateway protection before public launch; current rate limit is per card (one accepted event per two seconds per card).
- Run the two-account browser test with a second approved restaurant user before merge/deploy.
- Keep PR #2 in draft until these checks pass.

No service-role key or raw test token is committed to the repository. No production release or PR merge was performed.
