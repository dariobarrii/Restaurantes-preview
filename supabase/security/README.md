# NQ Central security work

Security work in this folder is staged for review and must not be treated as production-ready merely because it exists in GitHub.

- `ROLLOUT.md`: sequence and dependencies for migrating the legacy NFC/QR flow.
- `ABUSE_CONTROLS.md`: threat model, current implementation, limitations, and test gates.

## Current state

- Existing public NFC/QR pages still write directly to the legacy `nfc_events` table.
- The new Edge Function and card-token SQL migration exist only on `security/nfc-event-hardening`; neither has been deployed or tested against live Supabase.
- Legacy table policies must remain in place until all pages and dashboard consumers have been migrated and tested.
- Do not merge or deploy until credential provisioning, migration, end-to-end tests, and dashboard migration are reviewed.

## Next implementation milestone

Design safe server-side token provisioning, then update the six NFC/QR pages on a separate branch. Test all six links and dashboards before any production policy changes.