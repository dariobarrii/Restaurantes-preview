# NQ Central — static integration review

Date: 2026-10-17  
Scope: read-only review of the security branch; no deployment or production changes.

## Findings

### Blocker 1 — Scanner frontend is not yet routed through the gateway
The current `card.html` calls `/functions/v1/register-business-card-event` directly on the production Supabase project `qcvhxrudzjlgqlhvnkkl`. It does not call the Cloudflare Worker. The protected Edge Function source on this branch requires `NQ_GATEWAY_SHARED_SECRET`, which must never be sent by browser code. Therefore, the scanner frontend, Worker URL, and protected function are not yet integrated as a complete deployable path.

**Required action:** in the isolated environment, change/configure the scanner to call the deployed test Worker URL (not the production Supabase URL), then prove valid and invalid flows end-to-end. Do not put the gateway secret in `card.html`. Only after isolated validation should the production frontend route be changed in a separately approved release.

### Blocker 2 — Direct-origin protection is not proven
The Worker is only useful as a perimeter if the native Edge Function URL rejects direct calls without the secret. Unit tests and source inspection do not prove the deployed function has the secret configured or rejects direct requests.

**Required action:** with isolated resources, test direct requests with no secret and a wrong secret; both must return 403 and create no event. Then test a valid request through the Worker and confirm exactly one expected event.

### Blocker 3 — Rate limiting is only mocked in unit tests
The Worker unit tests use a mock `RATE_LIMITER`. They do not prove the real Cloudflare binding exists, is configured, or rejects traffic. Per-IP limits can also affect multiple guests on shared restaurant Wi-Fi or mobile carrier NAT.

**Required action:** configure the actual binding in the test Worker and verify deployed behavior with a conservative test threshold before choosing production limits.

### Verification needed — Public card metadata lookup
`card.html` reads `app_business_cards` using a publishable Supabase key before event registration. Verify that the public/anon policy exposes only the minimum fields for active cards and does not expose private card metadata or administrative data. Do not weaken RLS to make this query work.

### Verification needed — Destination URL policy
The scanner redirects to the database-provided `target_url`. Verify that card creation/rotation validates allowed URL schemes and expected destinations (e.g. HTTPS for public review URLs), and that untrusted users cannot change destinations. Do not add arbitrary redirect targets.

## Safe status
- No production resources were changed by this review.
- PR #2 should remain draft and unmerged.
- Do not deploy the branch Edge Function or point production scanner links at a Worker until the isolated end-to-end path passes.
- No domain purchase or paid-plan upgrade is required or authorized by this review.

## Next execution order
1. On a PC, configure the isolated Worker and secrets through the provider dashboards.
2. Deploy the matching protected Edge Function only to the isolated Supabase project.
3. Configure the Worker URL in the isolated scanner page and test direct-origin rejection.
4. Verify rate-limit binding, CORS/origin allowlist, active/revoked/paused cards, event count, and destination redirects.
5. Test two real browser Auth sessions and physical QR/NFC scans.
6. Only then prepare a production release for explicit approval.
