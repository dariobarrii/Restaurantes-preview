# NQ Central security rollout (staged)

This branch is intentionally separate from `main`. No production Supabase policies or published pages have been changed.

## Added on this branch

- `supabase/functions/register-nfc-event/index.ts`: staged event endpoint; hashes the submitted card token and calls a database RPC. It does not accept restaurant or event type from the browser.
- `supabase/functions/manage-nfc-card/index.ts`: staged admin-only credential management endpoint. It verifies the Supabase Auth access token and checks the caller's approved admin profile server-side.
- `supabase/migrations/202610140001_nfc_card_tokens.sql`: staged private card-token registry and atomic RPC that validates active card credentials, derives restaurant/event server-side, applies a two-second per-card cooldown, and inserts an event.
- `supabase/security/CARD_CREDENTIAL_MANAGEMENT.md` and `supabase/security/MANAGE_NFC_CARD_TESTS.md`: credential lifecycle design and security test plan.

## Important limitations before production use

- Nothing is deployed by adding these files to GitHub. The SQL migration and Edge Functions have not been run or tested against the live Supabase project.
- **Deployment JWT settings differ by function:** `register-nfc-event` uses the per-card token in its JSON body rather than a Supabase user JWT, so the Supabase Edge gateway must not enforce its normal JWT check for that function (deploy it with `--no-verify-jwt`). The function itself validates the card token through the database RPC. Keep JWT verification enabled for `manage-nfc-card`; it also independently calls Supabase Auth `getUser` and checks the approved admin profile server-side.
- A token embedded in a public NFC/QR URL is copyable. The current implementation provides server-side validation, revocation, and a short per-card cooldown, but not one-time authentication or global/IP-based rate limiting.
- The two-second cooldown may suppress legitimate repeated scans of the same card within that interval; verify the tradeoff before rollout.
- Configure required Supabase-managed secrets only in the function environment. Never put the service-role key in browser code, HTML, QR content, or GitHub.
- The six existing NFC/QR pages still post directly to `public.nfc_events`. Do not remove their insert policy until all pages have been migrated and smoke-tested.
- Existing dashboards still read `nfc_events` and `veta_daily_review_totals`. Do not revoke their SELECT/UPDATE privileges until their reads and review-count writes have moved to authenticated, membership-checked access.
- `google_review_counts` should be treated as public only if its contents are intentionally public; otherwise migrate its consumers before revoking anonymous SELECT.

## Required rollout sequence

1. Review the migration and both functions; test them in a non-production environment.
2. Provision a test card only after the migration is applied to that isolated environment.
3. Update all three NFC and all three QR pages on a separate branch to call the event endpoint; verify each event and Google review redirect.
4. Migrate dashboard reads and daily review snapshots to authenticated, membership-checked access.
5. Test the administrator account and the Feral-only test account.
6. Only after sign-off, deploy with the correct per-function JWT settings and apply the reviewed SQL migration.
7. Then restrict legacy anonymous permissions after confirming no active consumer depends on them.
8. Verify the trigger mirroring legacy events into `app_business_events` and confirm historical events remain intact.

## Manual smoke tests

- NFC tap for Feral, Tzura, Veta: one `nfc_tap` row, then Google review page opens.
- QR scan for Feral, Tzura, Veta: one `qr_scan` row, then Google review page opens.
- Invalid and revoked card tokens are rejected; rapid duplicate posts receive HTTP 429.
- Non-admin users cannot create, list, rotate, or revoke cards.
- User assigned only to Feral sees only Feral data in NQ Central.
- Administrator sees all authorized businesses/restaurants.
- After final policy migration, anonymous requests cannot read event histories or modify daily review counts.
