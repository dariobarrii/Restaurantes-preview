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
- Moved `app_is_admin()` and `app_is_approved_member(uuid)` into the non-public `private` schema, retained only the permissions required for RLS evaluation, and updated the profile-protection trigger. The two SECURITY DEFINER RPC warnings disappeared from Supabase Security Advisor.
- Active card metadata remains publicly readable to support scanning; token hashes are private and admin-managed.
- The legacy event mirror now copies `card_id` and `device_type` into `app_business_events`, preserving per-card analytics.
- Public catalog policies expose only approved businesses and active, unarchived cards belonging to approved businesses. Anonymous and already-signed-in scanner reads were verified.
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
- GitHub Actions passed JavaScript syntax/security invariants and made real HTTP POSTs to the deployed `register-business-card-event` endpoint: malformed input returned HTTP 400 `invalid_request`, and a syntactically valid request with a wrong token returned HTTP 200 `invalid_card` through the database RPC. Valid-token, revoked-token, and rate-limit behavior were verified at the SQL RPC layer; full valid-token HTTP and browser scan remain pending.
- Browser-test card creation, token rotation, and a complete QR/NFC scan on desktop and phone. Static code checks passed, but the browser flow has not yet been executed end-to-end. The card scanner no longer loads a third-party JavaScript bundle; it uses native fetch calls, keeps the token in the URL fragment, and removes it from the address bar.
- Configure Supabase Auth leaked-password protection in project settings; it is currently disabled in Tzura SteakHouse.
- Add an IP/global abuse throttle or gateway protection before public launch; current rate limit is per card (one accepted event per two seconds per card).
- Run the two-account browser test with a second approved restaurant user before merge/deploy.
- Deno type-checking for both Edge Functions, dependency-free scanner-flow behavior tests, and additional HTTP checks (GET 405, OPTIONS 200, oversized body 413) now pass in GitHub Actions run 39. These are not a substitute for a real browser/NFC test.
- Keep PR #2 in draft until these checks pass.

No service-role key or raw test token is committed to the repository. No production release or PR merge was performed.


## Status correction — 2026-10-17, latest read-only verification

This addendum supersedes any conflicting version numbers or deployment statements above.

- **Production project qcvhxrudzjlgqlhvnkkl:** migrations 008–014 are recorded. Migration 015 is not recorded and has not been applied. The active register-business-card-event Edge Function is still version 1; its deployed SHA is 7c254e8851c98fd47610130c2dc042881a086c9428b00e3c98e54c7cf224c6d8. Do not treat the newer rate-limit code in the PR as deployed to production.
- **Isolated security-test project rxxbmqilnozcnpwguqga:** register-nfc-event is active at version 7 with verify_jwt=false. The rate-limit tables and functions are present; limiter RPC execution is granted to service_role (plus the database owner). HTTP smoke tests cover method handling, malformed input, oversized bodies, and wrong-token rejection. The isolated business-card handler also passed a valid-token HTTP E2E test and rejected wrong/inactive tokens. Per-client throttling was removed because caller-supplied IP headers could be varied or were not reliably present; only the global request ceiling is enforced by the branch handlers.
- **Production Auth advisor:** leaked-password protection is still disabled. This is a launch blocker requiring a project setting change.
- **Production security advisor:** it reports three informational RLS-enabled/no-policy findings for legacy nfc_events, nfc_stats, and veta_daily_review_totals. These need contextual review because the legacy tables were intentionally locked down; do not add permissive policies merely to silence the advisor.
- **Current release gate:** keep PR #2 in draft and do not deploy migration 015 or replace the production Edge Function until browser token rotation/revocation, real QR/NFC phone scan, and two-account tenant isolation are verified. No production data was changed during this read-only verification.

## Isolated business-card HTTP end-to-end test — 2026-10-17

- Added test-only fixture migration `supabase/security-test/migrations/004_isolated_business_card_http_e2e_fixture.sql` and deployed the branch Edge Function source as `register-business-card-event-e2e` in the isolated project only.
- GitHub Actions run 50 passed the HTTP flow: valid test token → HTTP 200 `{"ok":true}`; wrong token → HTTP 200 `invalid_card`; inactive/revoked token → HTTP 200 `invalid_card`. Existing input-validation and rate-limit tests also passed in the same run.
- The valid request inserted one test event for the fixture card. The test-only RPC mirrors the production registration checks but is not the production RPC deployment; this proves the branch Edge Function can complete the HTTP path in an isolated fixture, not that production has been deployed or browser/NFC behavior has passed.
- Production remains unchanged: migration 015 is unapplied, production Edge Function remains version 1, leaked-password protection remains disabled. Keep PR #2 in draft pending browser, physical QR/NFC, tenant-isolation, and Auth-setting gates.


## Rate-limit identity correction — 2026-10-17

- An HTTP spoof test demonstrated that varying the caller-supplied `cf-connecting-ip` value could avoid the prior per-client bucket. The hosted runtime did not provide a reliably verified, non-spoofable identity via the tested headers.
- To avoid a false security guarantee, the branch production handler and isolated test handler no longer use `cf-connecting-ip` or `x-real-ip` for identity. They retain the global 600-request/60-second ceiling, 2 KB body cap, server-side token hashing, and database per-card cooldown. This global ceiling can still be exhausted by a distributed or concentrated caller; it is not a substitute for gateway/WAF rate limiting.
- Production remains unchanged: migration 015 is unapplied and production `register-business-card-event` remains version 1. Do not merge or deploy until a gateway-level abuse-control plan and remaining browser/phone/tenant tests are complete.
