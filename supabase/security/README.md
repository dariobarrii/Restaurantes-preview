# NQ Central security work

Security work in this folder is staged for review and must not be treated as production-ready merely because it exists in GitHub.

- `ROLLOUT.md`: sequence and dependencies for migrating the legacy NFC/QR flow.
- `ABUSE_CONTROLS.md`: threat model and proposed controls for forged events, copied bearer tokens, and replay.

## Current state

- Existing public NFC/QR pages still write directly to the legacy `nfc_events` table.
- The `register-nfc-event` Edge Function is only a draft; it is not deployed and is not sufficiently protected against abuse.
- Legacy table policies must remain in place until all pages and dashboard consumers have been migrated and tested.
- Do not merge or deploy based solely on these documents. The implementation, database migration, provisioning process, and tests still need review.

## Next implementation milestone

Prepare a reviewed database migration and server-side event registration path that validates per-card credentials, rejects revoked cards, and applies atomic cooldown/rate limits. Then update the six NFC/QR pages on a separate branch and test them before changing production policies.