# NQ Central security rollout (staged)

This branch is intentionally separate from `main`. No production Supabase policies have been changed.

## Added

- `supabase/functions/register-nfc-event/index.ts`: a write-only Edge Function for NFC/QR events. It validates the allowed restaurant names and event types and never returns event data.

## Important limitations before production use

- The function is not deployed by adding this file to GitHub. Deploy it to the existing Supabase project first.
- Configure the Supabase-managed `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets in the function environment. Never put the service-role key in browser code or GitHub.
- The current static NFC/QR pages still post directly to `public.nfc_events`. Do not remove their insert policy until all three NFC pages and all three QR pages have been changed to call the deployed function and smoke-tested.
- CORS is a browser control, not authentication. Anyone can make server-to-server requests to a public function. Before calling this hardened, add abuse controls (rate limits and/or one-time signed card tokens) appropriate to physical cards.
- Existing public dashboards still read `nfc_events` and `veta_daily_review_totals`. Do not revoke their SELECT/UPDATE privileges until their reads and review-count writes have moved to an authenticated, membership-checked API. Otherwise existing dashboards will break.
- `google_review_counts` should be treated as public only if its contents are intentionally public; otherwise migrate its consumers before revoking anonymous SELECT.

## Required rollout sequence

1. Deploy the function to the existing Supabase project without changing RLS policies.
2. Update the three NFC pages and three QR pages to call the function; test each link and confirm one event is recorded and the Google review screen still opens.
3. Migrate the old dashboards' reads and daily review snapshots to the authenticated NQ Central API (or a separate, access-controlled Edge Function).
4. Test the administrator account and the Feral-only test account against every restaurant.
5. Only after those tests, apply a reviewed SQL migration to remove anonymous reads and updates from legacy tables while preserving the minimum unauthenticated event-write path needed by cards.
6. Verify that the trigger mirroring legacy events into `app_business_events` still works and that old events remain intact.

## Manual smoke tests

- NFC tap for Feral, Tzura, Veta: one `nfc_tap` row, then Google review page opens.
- QR scan for Feral, Tzura, Veta: one `qr_scan` row, then Google review page opens.
- User assigned only to Feral: sees only Feral data in NQ Central.
- Administrator: sees all assigned businesses/restaurants.
- Anonymous requests cannot read event histories or modify daily review counts after final policy migration.
