# NQ Central security rollout (staged)

This branch is intentionally separate from `main`. No production Supabase policies or published pages have been changed.

## Added on this branch

- `supabase/functions/register-nfc-event/index.ts`: staged write-only Edge Function; hashes the submitted card token and calls a database RPC. It does not accept restaurant or event type from the browser.
- `supabase/migrations/202610140001_nfc_card_tokens.sql`: staged private card-token registry and atomic RPC that validates active card credentials, derives restaurant/event server-side, applies a two-second per-card cooldown, and inserts an event.
- `supabase/security/ABUSE_CONTROLS.md`: current limitations, rollout gates, and test plan.

## Important limitations before production use

- Nothing is deployed by adding these files to GitHub. The SQL migration and Edge Function have not been run or tested against the live Supabase project.
- A token embedded in a public NFC/QR URL is copyable. The current implementation provides server-side validation, revocation, and a short per-card cooldown, but not one-time authentication or global/IP-based rate limiting.
- The two-second cooldown may suppress legitimate repeated scans of the same card within that interval; verify the tradeoff before rollout.
- Configure required Supabase-managed secrets only in the function environment. Never put the service-role key in browser code, HTML, QR content, or GitHub.
- The six existing NFC/QR pages still post directly to `public.nfc_events`. Do not remove their insert policy until all pages have been migrated and smoke-tested.
- Existing dashboards still read `nfc_events` and `veta_daily_review_totals`. Do not revoke their SELECT/UPDATE privileges until their reads and review-count writes have moved to authenticated, membership-checked access.
- `google_review_counts` should be treated as public only if its contents are intentionally public; otherwise migrate its consumers before revoking anonymous SELECT.

## Required rollout sequence

1. Review the migration and function; test them in a non-production environment.
2. Create a safe server-side workflow to provision, rotate, and revoke card credentials. Never commit raw tokens.
3. Update all three NFC and all three QR pages on a separate branch to call the function; verify each event and Google review redirect.
4. Migrate dashboard reads and daily review snapshots to authenticated, membership-checked access.
5. Test the administrator account and the Feral-only test account.
6. Only after sign-off, deploy the function and apply the reviewed SQL migration.
7. Then restrict legacy anonymous permissions after confirming no active consumer depends on them.
8. Verify the trigger mirroring legacy events into `app_business_events` and confirm historical events remain intact.

## Manual smoke tests

- NFC tap for Feral, Tzura, Veta: one `nfc_tap` row, then Google review page opens.
- QR scan for Feral, Tzura, Veta: one `qr_scan` row, then Google review page opens.
- Invalid and revoked card tokens are rejected; rapid duplicate posts receive HTTP 429.
- User assigned only to Feral sees only Feral data in NQ Central.
- Administrator sees all authorized businesses/restaurants.
- After final policy migration, anonymous requests cannot read event histories or modify daily review counts.