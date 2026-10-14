# NQ Central security work

Security work in this folder is staged for review and must not be treated as production-ready merely because it exists in GitHub.

- `ROLLOUT.md`: sequence and dependencies for migrating the legacy NFC/QR flow.
- `ABUSE_CONTROLS.md`: threat model, current implementation, limitations, and test gates.
- `CARD_CREDENTIAL_MANAGEMENT.md`: credential provisioning design and authorization boundary.
- `../functions/manage-nfc-card/index.ts`: staged admin-only card management endpoint.
- `../functions/register-nfc-event/index.ts` and `../migrations/202610140001_nfc_card_tokens.sql`: staged event-registration path and its database migration.

## Current state

- Existing public NFC/QR pages still write directly to the legacy `nfc_events` table.
- The new Edge Functions and card-token SQL migration exist only on `security/nfc-event-hardening`; none has been deployed or tested against live Supabase.
- Legacy table policies must remain in place until all pages and dashboard consumers have been migrated and tested.
- Do not merge or deploy until authorization, credential provisioning, migration, end-to-end tests, and dashboard migration are reviewed.

## Management endpoint behavior

- Requires a valid Supabase Auth access token and independently checks that `app_profiles` has `role = 'admin'` and `status = 'approved'`.
- Supports `create`, `revoke`, `rotate`, and `list`.
- Returns a raw token only in the successful `create` or `rotate` response; never returns the stored hash and never logs the raw token.
- Rotation only affects active cards; it does not silently reactivate a revoked card.
- CORS is limited to the current GitHub Pages origin, but CORS is not authorization; the server-side checks are mandatory.

## Next milestone

Review the staged code, then test with a real approved admin and a non-admin account in a non-production Supabase project or isolated test setup. Only after the function and migration pass tests should the six NFC/QR pages be migrated. Do not change live policies until all pages and dashboards are migrated and verified.
