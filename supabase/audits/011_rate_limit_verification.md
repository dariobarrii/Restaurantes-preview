# Isolated endpoint rate-limit verification

Date: 2026-10-17

## Scope
These changes were applied only to Supabase project `NQ Central Security Test` (`rxxbmqilnozcnpwguqga`). They were not applied to the Tzura production database.

## Implemented
- A private-by-permissions rate-limit table stores SHA-256 bucket identifiers, request counters, and timestamps. Raw IP addresses are not stored.
- A `SECURITY DEFINER` function atomically increments fixed-window counters and rejects malformed bucket keys or invalid limits.
- The function is executable only by `service_role`; `anon` and `authenticated` cannot read the table or execute the function.
- The test Edge Function version 3 applies a global ceiling of 600 POST requests per 60 seconds, and a per-client limit of 40 requests per 60 seconds when the request has a `cf-connecting-ip` header.
- Requests with declared content length above 2 KB are rejected before body parsing.
- Old hashed bucket rows are opportunistically deleted after 24 hours using a transaction-scoped advisory lock to avoid concurrent cleanup work on every request.

## Checks completed
- Applied migration `add_nfc_event_rate_limits` and cleanup migration `cleanup_old_nfc_rate_limits` to the isolated test project.
- In a rolled-back SQL transaction, the rate-limit function allowed the first two requests with a limit of two and rejected the third. The transaction was rolled back to leave no test bucket behind.
- Permission checks returned: anon cannot read rate-limit rows; authenticated cannot read rate-limit rows; neither role can execute the limiter function; service_role can execute it.
- Deployed Edge Function `register-nfc-event` version 3 with JWT verification disabled for token-based access; it checks rate limits before parsing or processing event registration.
- GitHub Actions run 11 passed syntax/security checks and HTTP smoke tests against the isolated test endpoint.

## Still not verified
- No successful valid-token HTTP registration has been run end-to-end yet.
- The `cf-connecting-ip` header needs to be confirmed in the hosted Edge Function runtime. The global rate limit is independent of that header; the per-client limit is conditional on its presence.
- Real browser NFC/QR scans on desktop and phone remain pending.
- Production configuration for leaked-password protection and production-grade gateway/IP throttling remain launch blockers.
