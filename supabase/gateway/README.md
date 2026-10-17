# NQ Central gateway deployment runbook

This Worker is **not deployed** by this repository. Do not point production NFC/QR links at it until the isolated validation checklist below passes.

## Required environment

Configure these values in the Cloudflare Worker environment; never commit real values:

- `SUPABASE_FUNCTION_URL`: exact URL of the intended Supabase Edge Function.
- `GATEWAY_SHARED_SECRET`: high-entropy random secret, configured as a Worker secret (not a plain-text checked-in variable).
- `ALLOWED_ORIGINS`: comma-separated exact origins for the real scanner frontend(s), including scheme and port when applicable. Wildcards and missing values are rejected.
- `RATE_LIMITER`: Cloudflare Rate Limiting binding named exactly `RATE_LIMITER`, configured to a threshold suitable for shared restaurant Wi-Fi and mobile carrier NAT. Confirm the actual Cloudflare plan and binding configuration before deployment.

In Supabase, configure Edge Function secret `NQ_GATEWAY_SHARED_SECRET` to the same secret value. The secret must not appear in client JavaScript, HTML, Git history, browser requests, logs, or screenshots. Use separate values for isolated test and production environments.

## Request path

Scanner frontend -> Cloudflare Worker custom hostname -> Supabase Edge Function -> server-side token validation and event registration RPC.

The Worker creates the `x-nq-gateway-secret` header itself. Do not add this header to browser code. The Edge Function must reject missing or incorrect secret values before reading request data or consuming the database rate-limit bucket.

## Local/unit tests

Requires Node.js 22 or later:

```sh
node --test supabase/gateway/cloudflare-worker.test.mjs
```

GitHub Actions also runs this command for changes to this directory.

## Isolated cutover checklist

- [ ] Use an isolated Supabase project and a non-production hostname.
- [ ] Set a new random shared secret in both environments using secret-management controls.
- [ ] Configure the exact scanner origin allowlist; test missing and disallowed origins.
- [ ] Configure the real Cloudflare Rate Limiting binding and verify it blocks repeated requests. Unit mocks do not prove the deployed binding works.
- [ ] Deploy the Edge Function to the isolated project only after its secret is configured.
- [ ] Deploy the Worker to the isolated hostname.
- [ ] Send a request to the native Supabase function URL without the gateway secret; it must return 403 and create no event.
- [ ] Send a valid request through the Worker; confirm the token validates and exactly one expected event is recorded.
- [ ] Test invalid, paused, archived, and revoked cards; none may create an event.
- [ ] Test OPTIONS, allowed/disallowed origins, malformed JSON, missing headers, oversized bodies, rate-limit exhaustion, and upstream outage.
- [ ] Scan a real QR code and NFC tag with an iPhone and an Android device if available; verify the expected destination and event count.
- [ ] Confirm rollback steps and monitor logs for false positives before any production cutover.

## Production release ordering

Production release is a coordinated change and must not be performed piecemeal:

1. Review and approve the branch and migration 015.
2. Set the production Edge Function secret and Worker secret securely, without printing either value.
3. Apply migration 015 and deploy the matching Edge Function as a controlled release.
4. Verify direct-origin requests fail closed.
5. Configure/verify the production Worker, custom hostname, exact allowlist, and rate limiter.
6. Cut over the scanner frontend only after end-to-end tests pass.
7. Test a valid scan, a revoked token, and event mirror consistency; keep rollback ready.

Do not apply migration 015 or deploy the branch Edge Function to production while the Worker and secret are unconfigured. Do not rotate or replace existing production card tokens as part of this gateway deployment.
