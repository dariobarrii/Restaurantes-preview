# Staging integration verification checklist

All checks below are **pending**. No staging database, browser, Worker, or live endpoint checks have been run.

## Required staging configuration
- [ ] Confirm approved staging project and schema; verify app_business_cards and token table definitions against migration preflights.
- [ ] Configure blank staging-only public URL/key and Worker gateway URL in nq-central-staging-config.js.
- [ ] Configure server-only gateway binding, allowed admin origins, Edge Function env and a real rate-limit binding; do not put secrets in browser code.
- [ ] Verify direct-origin calls fail closed before testing public card scans.

## Card/token lifecycle
- [ ] Issue a token for an active card; verify raw token is returned only once and only hash is persisted.
- [ ] Reject malformed/unknown token; do not record an event.
- [ ] Revoke token and verify previous URL fails without an event.
- [ ] Rotate token; verify old token fails and new token succeeds.
- [ ] Test active, paused, archived card, and unapproved business; only active/unarchived card for approved business may record.
- [ ] Confirm target rejects non-HTTPS, credential-bearing, or malformed destinations.

## Public event path
- [ ] Submit NFC and QR scans for cards owned by two staging businesses; verify event channel and business_id match the card.
- [ ] Directly call the protected Edge endpoint without gateway header; expect rejection and zero event rows.
- [ ] Verify browser can call only the configured Worker, never Supabase Edge Function origin.
- [ ] Exercise per-card and Worker rate limits; confirm fail-closed behavior when limiter or gateway is unavailable.
- [ ] Confirm redirects occur only after a successful registration and valid HTTPS target.

## Isolation and historical metrics
- [ ] Sign in as a member of Restaurant A; verify its portal query returns only A events and reports/CSV agree.
- [ ] Attempt selecting Restaurant B while authenticated only to A; verify RLS denies access and no B rows appear.
- [ ] Repeat with an independent account for Restaurant B.
- [ ] Capture read-only reconciliation counts before import.
- [ ] Apply reviewed migration only in staging, then rerun counts; verify totals/channel/device/date/card/business attribution and zero duplicate legacy IDs.
- [ ] Rerun migration in disposable staging to demonstrate idempotency; compare counts again.
- [ ] Manually resolve unmatched/ambiguous legacy labels before further import; do not guess mappings.
