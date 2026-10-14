# NFC/QR event abuse controls (staged implementation)

## Implemented on the security branch; not deployed

- `supabase/migrations/202610140001_nfc_card_tokens.sql` defines a private per-card token registry and a `SECURITY DEFINER` RPC callable only by `service_role`. The RPC derives restaurant/event from the server-side card record and inserts an event atomically with a short per-card cooldown.
- `supabase/functions/register-nfc-event/index.ts` validates the request shape, hashes the presented token with SHA-256, and calls the RPC using the server-side service-role credential. It does not accept restaurant or event from the browser.

## Important limits

- A token embedded in a static NFC/QR URL is a bearer credential: anyone who scans it can copy it. It can be revoked by setting the corresponding server-side card row inactive or rotating the token, but it is not one-time authentication.
- CORS is not authentication. The current implementation has per-card cooldown only; a global/IP-based rate limiter and monitoring still need design and testing.
- The two-second cooldown can discard a second event from the same physical card within that interval. Confirm this tradeoff is acceptable for the actual usage pattern before rollout.
- The function expects `card_id` as a UUID and `token` as a random high-entropy string. The database stores only the lowercase SHA-256 hex digest of the token.
- Do not put the service-role key or raw token hashes in browser code. Do not log raw tokens.

## Rollout gates

- [ ] Review the migration and function; test SQL and error mapping in a non-production environment.
- [ ] Create a safe server-side provisioning/rotation workflow for card UUIDs and random tokens. Do not hand-create production credentials in a browser or commit them to Git.
- [ ] Update all three NFC and all three QR pages on a separate branch to send `card_id`, `token`, and `device_type`; keep each destination's Google review redirect working.
- [ ] Confirm the function URL and required Supabase secrets are configured before deploying.
- [ ] Test valid, invalid, inactive/revoked, malformed, and rapid-repeat requests for all three restaurants.
- [ ] Migrate dashboard reads and daily review writes to authenticated, membership-checked access.
- [ ] Only after sign-off, deploy the function and apply the reviewed database migration.
- [ ] Remove legacy anonymous permissions only after confirming no active page/dashboard depends on them.

## Production status

This is a staged implementation on `security/nfc-event-hardening` only. It has not been deployed or tested against the live Supabase project. No live policy or published page should be changed as part of this branch work.