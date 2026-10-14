# Test plan: manage-nfc-card (staged only)

Do not run these tests against production until the SQL migration and both Edge Functions have been reviewed and a safe test card/account are available.

## Authorization tests

1. No Authorization header: expect HTTP 401.
2. Malformed, expired, or invalid access token: expect HTTP 401.
3. Signed-in user with an unapproved profile: expect HTTP 403.
4. Signed-in approved non-admin: expect HTTP 403.
5. Signed-in approved admin: operations may proceed only after the server-side profile check.
6. Send `user_id`, `role`, or `restaurant` fields intended to impersonate another user: these must not affect the identity or permissions derived from the verified session.

## Input validation tests

1. Unknown operation: HTTP 400.
2. `create` with a restaurant outside the exact allowlist: HTTP 400.
3. `create` with an event other than `nfc_tap` or `qr_scan`: HTTP 400.
4. `revoke` / `rotate` with malformed card ID: HTTP 400.
5. Revoke a nonexistent card: HTTP 404.
6. Rotate a nonexistent or revoked card: HTTP 404; a revoked card must not become active.

## Credential lifecycle tests

1. Create one test card. Confirm the raw token is returned once and is 64 lowercase hex characters.
2. Inspect the database as a privileged tester: only the SHA-256 hash is stored; it must not equal the raw token.
3. List cards. Confirm no token or token hash appears in the response.
4. Register an event with the new token using the staged `register-nfc-event` function. Confirm restaurant and event are derived from the card record, not caller-supplied fields.
5. Rotate the card. Confirm the new token works and the old token immediately fails.
6. Revoke the card. Confirm event registration fails immediately.
7. Confirm rapid repeat event registration is throttled by the database function.
8. Confirm the raw token never appears in function logs or committed files.

## Operational checks

- Configure required Supabase function secrets only in the Supabase dashboard; never in GitHub Pages or source files.
- Verify `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`), and `SUPABASE_SERVICE_ROLE_KEY` are present in the function environment.
- Verify calls from the deployed GitHub Pages origin work, while an unrelated browser origin is rejected. Remember that CORS is not a substitute for authentication.
- Keep existing legacy policies unchanged until all six public NFC/QR pages and every dashboard read/write have been migrated and tested.
- Do not merge or deploy this staged code based only on static review; run the tests in an isolated environment first.
