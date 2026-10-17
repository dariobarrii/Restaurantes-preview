# Manual browser and physical scan checklist

Do not merge PR #2 until this checklist passes. Use only test cards and approved test restaurant accounts.

## Before testing
- Confirm the latest PR commit has a green GitHub Actions run.
- In the admin account, open the test restaurant and generate a new secure card link. Copy it only when the one-time prompt appears.
- Confirm the link includes `?id=<card UUID>#token=<64 hex chars>`. Do not paste the full bearer link into screenshots, issue comments, chat, or logs.

## Desktop browser
- Open the tokenized link in a fresh private/incognito window.
- Confirm the page removes the fragment from the address bar before the network flow completes.
- Confirm the browser redirects to the configured target URL.
- Confirm exactly one accepted event is added for the correct card/business.
- Open the link again immediately: the scanner should still redirect if the card/token are valid, while event registration may return `rate_limited` and not create a duplicate.
- Generate/rotate the card link; confirm the new link works and the old token is rejected.
- Pause or archive the card; confirm it does not register an event or redirect.

## Mobile / NFC and QR
- Open the generated URL through a QR scan on a real phone.
- Program an NFC tag with the same secure URL and tap it on a real phone.
- Confirm both reach the same configured destination and produce the correct event channel.
- Repeat once while signed in to the restaurant portal and once signed out.
- Verify the token fragment is removed from the address bar where the browser exposes it.

## Tenant isolation
- Sign in as approved Restaurant A and verify only A's private events/review snapshots appear.
- Sign in as approved Restaurant B and verify only B's private events/review snapshots appear.
- Confirm neither account can view the other's card-token records or private analytics.
- Sign in with an account without an approved membership; confirm private business/event data is empty or denied.

## Evidence to record
- Test date/time and browser/device model.
- Whether desktop, QR, NFC, signed-in and signed-out cases passed.
- Counts before/after and the card/business IDs (never the bearer token).
- Any failed step and the exact non-secret error response.

## Launch gates

- [x] Branch business-card handler tested over HTTP against the isolated fixture: valid token accepted; wrong and inactive/revoked tokens rejected. This does not mean the production function has been deployed.
- [ ] Desktop browser test: fragment removal, redirect, correct event attribution, token rotation/revocation, and paused-card behavior.
- [ ] Physical mobile QR and NFC scans pass on a real phone.
- [ ] Two-account tenant isolation passes for approved restaurant accounts.
- [ ] Leaked-password protection enabled in Supabase Auth under Authentication → Sign In / Providers → Email (project: Tzura). Direct settings link: https://supabase.com/dashboard/project/qcvhxrudzjlgqlhvnkkl/auth/providers?provider=Email.
- [ ] Confirm caller-supplied `cf-connecting-ip` cannot evade the per-client rate limiter; latest CI adds a spoof-header test against the isolated endpoint.
- [ ] Production migration 015 and matching production Edge Function deployed together only after all preceding gates pass.
