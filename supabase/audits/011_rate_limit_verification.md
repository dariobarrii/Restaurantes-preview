# Isolated endpoint rate-limit verification

Date: 2026-10-17

## Scope
These changes were applied only to Supabase project `NQ Central Security Test` (`rxxbmqilnozcnpwguqga`). They were not applied to the Tzura production database.

## Implemented
- A private-by-permissions rate-limit table stores SHA-256 bucket identifiers, request counters, and timestamps. Raw IP addresses are not stored.
- A `SECURITY DEFINER` function atomically increments fixed-window counters and rejects malformed bucket keys or invalid limits.
- The function is executable only by `service_role`; `anon` and `authenticated` cannot read the table or execute the function.
- The test Edge Function version 3 applies a global ceiling of 600 POST requests per 60 seconds, and a per-client limit of 40 requests per 60 seconds when the request has a `cf-connecting-ip` header.
- Request bodies are read with a bounded stream; payloads over 2 KB are cancelled and rejected before JSON parsing, even if Content-Length is absent.
- Old hashed bucket rows are deleted after 24 hours; cleanup runs at most once per hour per limiter using a persistent maintenance timestamp plus a transaction-scoped advisory lock.

## Checks completed
- Applied migration `add_nfc_event_rate_limits` and cleanup migration `cleanup_old_nfc_rate_limits` to the isolated test project. Also applied the exact production migration `015_add_business_card_rate_limits.sql` to the isolated test project to validate its DDL before production rollout.
- In a rolled-back SQL transaction, the rate-limit function allowed the first two requests with a limit of two and rejected the third. The transaction was rolled back to leave no test bucket behind.
- Permission checks returned for both test and production-named rate-limit functions: anon cannot read rate-limit rows; authenticated cannot read rate-limit rows; neither role can execute the limiter function; service_role can execute it.
- Deployed Edge Function `register-nfc-event` version 3 with JWT verification disabled for token-based access; it checks rate limits before parsing or processing event registration.
- GitHub Actions run 39 passed Deno type-checking for both Edge Functions, JavaScript syntax/security checks, dependency-free scanner-flow tests, and HTTP smoke tests against the isolated test endpoint: GET → 405, OPTIONS → 200, oversized body → 413, malformed payload → 400 `invalid_request`, and wrong token → 200 `invalid_card`, and a 45-request burst confirmed the hosted per-client limiter returns 429 `rate_limited`.

## Still not verified
- No successful valid-token HTTP registration has been run end-to-end yet. The scanner behavior tests mock the DOM and network; they are not a real browser or physical NFC scan.
- The `cf-connecting-ip` header needs to be confirmed in the hosted Edge Function runtime. The global rate limit is independent of that header; the per-client limit is conditional on its presence.
- Real browser NFC/QR scans on desktop and phone remain pending.
- Production configuration for leaked-password protection and production-grade gateway/IP throttling remain launch blockers.

## Status correction — 2026-10-17, latest deployment read

This section supersedes earlier version references in this file.

- The isolated test endpoint `register-nfc-event` is currently deployed as version 5, not version 3.
- Production `register-business-card-event` remains version 1 and does **not** yet contain the request-body cap or global/per-client rate limiting described for the branch version.
- Production migration `015_add_business_card_rate_limits.sql` has not been applied to the Tzura project. The same migration was exercised in the isolated test project, where the rate-limit table, maintenance table, and limiter function are present.
- The CI burst test confirms HTTP 429 behavior for the isolated endpoint. It does not prove that a valid token can be registered through the production business-card endpoint.
- The per-client header behavior is not yet independently verified against header spoofing. Treat it as conditional throttling, not as a proven trusted identity boundary.
- No production deployment or data change was made during this verification.

## Isolated business-card HTTP end-to-end update — 2026-10-17

- Added a separate `register-business-card-event-e2e` function in the isolated test project using the current branch Edge Function source; production function was not replaced.
- CI run 50 passed: valid token returns `{"ok":true}` and creates the expected isolated `nfc_tap` row; wrong token and inactive/revoked token return `invalid_card`. Run: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39035972534
- The fixture RPC is a test-only implementation matching the production registration contract and constraint behavior. This is a valid isolated HTTP test of the branch handler, not proof that the deployed production function or real browser/phone NFC/QR flow works.
- Remaining launch gates: browser card lifecycle/redirect tests, physical QR/NFC scan, two-account tenant isolation, leaked-password protection, and trusted client-IP/header handling.
