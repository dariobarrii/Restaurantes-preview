# NQ Central — launch readiness checklist

Date: 2026-10-17  
Status: planning / pre-launch. This checklist does not authorize production changes.

## Non-negotiable constraints
- [ ] No production migration, Edge Function deployment, Auth setting change, token rotation, DNS cutover, or PR merge before all required gates pass and the owner explicitly authorizes the production release.
- [ ] No domain purchase, paid-plan upgrade, or paid service without explicit owner authorization.
- [ ] Use only the isolated Supabase project for gateway end-to-end testing. Use separate test secrets from any future production secret.
- [ ] Never put secrets in Git, HTML, browser JavaScript, URLs, screenshots, or logs.

## Gate 1 — repository and CI
- [x] Gateway unit tests and static security checks passed in the latest recorded CI runs on 2026-10-17.
- [ ] Re-check CI on the final candidate commit before any release.
- [ ] Review all outstanding PR conversations and code changes.
- [ ] Keep PR #2 in draft until all external and end-to-end gates pass.

## Gate 2 — isolated gateway configuration
- [ ] Configure `SUPABASE_FUNCTION_URL` to the isolated Supabase Edge Function.
- [ ] Set a high-entropy `GATEWAY_SHARED_SECRET` as a Cloudflare Worker secret.
- [ ] Set the same test value as Supabase Edge Function secret `NQ_GATEWAY_SHARED_SECRET`; do not print or commit it.
- [ ] Set exact `ALLOWED_ORIGINS` values for the test frontend; do not use wildcard origins.
- [ ] Configure the `RATE_LIMITER` binding and verify the deployed binding, not just mocked unit tests.
- [ ] Deploy the matching protected Edge Function and Worker only to isolated test resources.

## Gate 3 — negative and positive HTTP tests
- [ ] Direct call to the isolated Supabase function without the secret returns 403 and creates no event.
- [ ] Direct call with an incorrect secret returns 403 and creates no event.
- [ ] Valid request through the Worker returns the expected result and creates exactly one event.
- [ ] Invalid, revoked, paused, and archived card/token cases are rejected without creating an event.
- [ ] Disallowed origin, unsupported method/media type, malformed JSON, oversized body, missing client identity, and limiter exhaustion fail safely.
- [ ] Worker does not forward a caller-supplied gateway-secret header; it injects its own secret.
- [ ] Upstream outage and limiter outage fail closed with generic responses.

## Gate 4 — real app and tenant isolation
- [ ] Test with two distinct approved test restaurant accounts and real browser Auth sessions.
- [ ] Verify each account can see only its own cards, events, and review snapshots.
- [ ] Verify unapproved identities see no restaurant data.
- [ ] Confirm no client-facing code reads global legacy event data or writes directly to event tables.

## Gate 5 — physical QR/NFC and business readiness
- [ ] Scan real QR and NFC tags from a phone and verify the final destination.
- [ ] Confirm each scan records exactly one event with the correct restaurant, card, event type, and device type.
- [ ] Test invalid/revoked token and paused-card behavior on a real device.
- [ ] Review/provision tokenized cards and target URLs for each restaurant that will launch.
- [ ] Confirm review-count/dashboard behavior and NFC/QR chart separation.

## Gate 6 — production security and controlled release
- [ ] Resolve and document the leaked-password protection blocker in Supabase Auth; do not change plan or enable paid features without authorization.
- [ ] Review migration 015 and the exact matching Edge Function as one coordinated release.
- [ ] Confirm rollback instructions and event-mirror consistency checks.
- [ ] Obtain explicit owner authorization for production changes.
- [ ] Set production secret securely; deploy matching function/migration only after all gates pass.
- [ ] Verify direct-origin requests fail closed before any scanner cutover.
- [ ] Configure production gateway/rate limiting and hostname only after confirming cost and obtaining authorization where applicable.
- [ ] Cut over scanner frontend only after end-to-end tests pass; perform post-release positive and negative scans.

## Current known blockers
- Real Cloudflare Worker and rate-limiter binding are not yet deployed/verified.
- Direct-origin secret rejection has not been proven over HTTP in the isolated environment.
- Real browser Auth-session tenant isolation is still pending.
- Physical phone, QR, and NFC end-to-end tests are pending.
- Production leaked-password protection was previously observed disabled and remains a launch blocker.
- Production migration 015 and the matching production Edge Function have not been deployed.

## Safe next action
Continue with read-only/mobile review until a PC is available to configure and test the isolated Worker. Do not treat this document or passing unit tests as proof that the deployed gateway is protected.
