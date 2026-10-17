# Manual browser and physical scan checklist

Do not merge PR #2 until all launch gates pass. Use only test cards and approved test restaurant accounts.

## Automated checks

- [x] Branch business-card handler tested over HTTP against the isolated fixture: valid token accepted; wrong and inactive/revoked tokens rejected. This does not mean the production function has been deployed.
- [x] SQL tenant-isolation test in NQ Central Security Test: two synthetic authenticated identities see only their own business events and review snapshots; neither can SELECT token hashes.
- [x] Chromium browser smoke test in CI passed on run 71: fragment removal before API call, destination redirect, token rotation/revocation, paused-card behavior, and rate-limit handling. This is a mocked-backend browser test, not a physical-device test. Run: https://github.com/dariobarrii/Restaurantes-preview/actions/runs/39038199423
- [x] Production event mirror audit: 103 legacy events, 103 mirrors, zero missing mirrors and zero orphan mirrors.
- [x] Migration 009 discrepancy resolved in branch: the file is now a comment-only no-op because its legacy table/function do not exist in production. It has not been applied to production.
- [x] Production RLS/privilege audit: `anon` and `authenticated` have no direct SELECT/INSERT privileges on `nfc_events`, `nfc_stats`, or `veta_daily_review_totals`; all three tables have RLS enabled and no policies. This is deny-by-default; do not add policies unless a reviewed feature requires them.
- [x] Production card-token policy inspected: `app_business_card_tokens` operations for `authenticated` are guarded by `private.app_is_admin()` for approved admins.

## Manual desktop browser

- Confirm the latest PR commit has a green GitHub Actions run.
- In the admin account, open the test restaurant and generate a new secure card link. Copy it only when the one-time prompt appears.
- Confirm the link includes `?id=<card UUID>#token=<64 hex chars>`. Do not paste the full bearer link into screenshots, issue comments, chat, or logs.
- Open the tokenized link in a fresh private/incognito window.
- Confirm the page removes the fragment from the address bar before the network flow completes.
- Confirm the browser redirects to the configured target URL.
- Confirm exactly one accepted event is added for the correct card/business.
- Open the link again immediately: the scanner should still redirect if the card/token are valid, while event registration may return `rate_limited` and not create a duplicate.
- Generate/rotate the card link; confirm the new link works and the old token is rejected.
- Pause or archive the card; confirm it does not register an event or redirect.

## Manual mobile / NFC and QR

- Open the generated URL through a QR scan on a real phone.
- Program an NFC tag with the same secure URL and tap it on a real phone.
- Confirm both reach the same configured destination and produce the correct event channel.
- Repeat once while signed in to the restaurant portal and once signed out.
- Verify the token fragment is removed from the address bar where the browser exposes it.

## Manual tenant isolation

- SQL RLS behavior is verified with synthetic authenticated identities in the isolated project; this does not replace a real Auth-session/browser check.
- Sign in as approved Restaurant A and verify only A's private events/review snapshots appear.
- Sign in as approved Restaurant B and verify only B's private events/review snapshots appear.
- Confirm neither account can view the other's card-token records or private analytics.
- Sign in with an account without an approved membership; confirm private business/event data is empty or denied.

## External setup / launch gates

- [ ] Enable leaked-password protection in Supabase Auth under Authentication → Sign In / Providers → Email (project: Tzura). Direct settings link: https://supabase.com/dashboard/project/qcvhxrudzjlgqlhvnkkl/auth/providers?provider=Email. Latest production security advisor still reports this setting disabled. This setting is not exposed by the connected Supabase management tools and must be enabled in the dashboard.
- [ ] Implement gateway/WAF-level abuse protection with non-spoofable client identity and protect the origin endpoint. Caller-supplied IP headers must not be trusted. The global request ceiling is not per-client protection; this needs proxy/domain/DNS configuration and secret management.
- [ ] After all preceding gates pass, apply production migration 015 and deploy the matching production Edge Function together.

## Evidence to record

- Test date/time and browser/device model.
- Whether desktop, QR, NFC, signed-in and signed-out cases passed.
- Counts before/after and the card/business IDs (never the bearer token).
- Any failed step and the exact non-secret error response.

## Additional isolated rate-limit verification (2026-10-17)

- [x] Exercised `public.consume_business_card_rate_limit` in the isolated NQ Central Security Test project with a synthetic bucket and a limit of two requests per 60-second window. The first and second calls returned `true`; the third returned `false`. This verifies the database counter's basic threshold behavior only; it is not per-client protection for the public endpoint and does not authorize production migration 015.
