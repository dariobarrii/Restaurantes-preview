# Card credential provisioning design (staged; not deployed)

## Existing NQ Central authentication boundary

- The web app signs users in through Supabase Auth and loads `app_profiles` to determine whether the profile is approved and whether its role is `admin`.
- The admin UI is browser code. Hiding a tab or checking `role === 'admin'` in JavaScript is not a security boundary; database RLS and server-side authorization must enforce every privileged operation.
- The existing app must continue using its current Auth flow. Do not put the service-role key, a shared admin password, or a permanent provisioning secret in `index.html` or any GitHub Pages asset.

## Proposed provisioning API

Use a separate Supabase Edge Function for privileged card management, for example `manage-nfc-card`.

### Authentication and authorization

1. Require a valid Supabase Auth access token in the `Authorization: Bearer` header.
2. Verify the user server-side using Supabase Auth; do not trust a user ID, role, or restaurant sent in the JSON body.
3. Read the caller's `app_profiles` row server-side and require both `role = 'admin'` and `status = 'approved'`.
4. Only after authorization, use a server-side service-role client to create/update the private `nfc_card_tokens` table.
5. Reject every unsupported operation and validate restaurant/event against the server-side allowlist.

### Operations

- `create`: generate a UUID card ID and a cryptographically random token with at least 32 random bytes. Store only the lowercase SHA-256 hex digest. Return the raw token once to the authorized admin so it can be programmed into the card/QR destination; never log it or store it in Git.
- `revoke`: set the card's `active` flag to false. A revoked credential must fail immediately.
- `rotate`: generate a new random token and replace the stored hash. Return the new token once; the previous token must stop working immediately.
- `list`: return only card ID, restaurant, event, active status, creation date, and last event timestamp. Never return the stored hash or raw token.

## Important deployment checks

- The function must verify the Supabase JWT server-side; browser-only role checks are insufficient.
- Configure only the necessary server-side secrets in Supabase function secrets.
- A token embedded in a public NFC/QR URL is copyable. Provisioning and revocation reduce risk but do not make the URL non-copyable; use cooldowns, monitoring, and token rotation.
- Do not deploy the management function until its authorization and validation are reviewed and tested with an admin and a non-admin account.
- Do not change the live `app_profiles` policies or current login flow as part of this design document.