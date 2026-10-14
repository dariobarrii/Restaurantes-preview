# NFC/QR event abuse controls (pre-production design)

## Goal

Stop casual forged traffic and limit replay/spam without changing the live NFC/QR pages or legacy table policies until the replacement path is tested.

## Threat model and limits

- A static NFC/QR URL is public to anyone who scans it. A token embedded in that URL is a bearer credential and can be copied; it must not be described as secret or impossible to replay.
- CORS only constrains browsers. It does not authenticate a request.
- A shared restaurant token in JavaScript is extractable and should not be used as the sole protection.
- No service-role key or other Supabase server secret may appear in HTML, QR content, Git history, or browser requests.

## Recommended minimum design

1. Give each physical card/QR placement a unique, high-entropy random token (at least 128 random bits). Use an opaque card ID as the public identifier.
2. Store only a cryptographic hash of the token server-side, with fields for card ID, restaurant, allowed event type(s), active/revoked status, and optional expiry. Never store or log the raw token.
3. The Edge Function validates the card ID + token against the stored hash, then derives the restaurant and allowed event from that server-side record. Do not trust the client-supplied restaurant name.
4. Apply atomic server-side throttling: per-card cooldown/deduplication, plus a global/IP-based limit where a trustworthy platform-provided client IP is available. Treat forwarded IP headers supplied directly by clients as untrusted. Return a generic 429 on throttling.
5. Record a server-generated timestamp and minimal metadata. Avoid storing unnecessary personal data.
6. Keep the existing nfc_events insert policy while the six pages are migrated. Test NFC and QR for Feral, Tzura, and Veta; then migrate dashboard reads and daily-review writes before restricting legacy SELECT/UPDATE permissions.
7. Revoke a card token by disabling its server-side record. A copied token remains usable until disabled or rotated, so rate limits and monitoring remain necessary.

## Rollout gates

- [ ] Create and review the card-token table and indexes in a migration file; do not run it in production yet.
- [ ] Add token verification and atomic rate limiting to the Edge Function.
- [ ] Provide a safe way to provision/rotate card tokens without putting server secrets in the browser.
- [ ] Update all three NFC and all three QR pages on a separate branch.
- [ ] Migrate dashboard reads and daily review writes to authenticated, membership-checked access.
- [ ] Test valid token, invalid token, revoked token, replay/cooldown, malformed payload, all six links, Google review redirect, admin account, and Feral-only test account.
- [ ] Only after sign-off, deploy the function and apply the reviewed database migration.
- [ ] Remove legacy anonymous permissions only after confirming no active page/dashboard depends on them.

## Important

This document is a design checklist, not an implementation or a claim that production is protected. No live Supabase policy or published page should be changed as part of this planning stage.