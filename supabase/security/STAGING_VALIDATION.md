# Staging security corrections and verification

These are branch-only proposals. Nothing has been applied to Supabase or deployed. This review did not connect to Supabase or read event rows.

## Worker review

`workers/nq-central-card-gateway/src/index.mjs` now:

- accepts only an allowlisted Origin and POST (with a CORS OPTIONS preflight); Origin is a browser control, not authentication;
- checks JSON content type and reads request/response bodies as bounded streams (2,048 and 4,096 bytes);
- accepts only the exact HTTPS function path on the project hostname derived from `STAGING_PROJECT_REF`; no query, fragment, user info, alternate host, redirects or caller-supplied upstream;
- sends the gateway secret only in a server-to-server request header. It is not logged; response JSON is reconstructed from a small allowlist so an upstream echo cannot return arbitrary fields or the secret to the browser;
- applies a hashed per-client-IP rate key and fails closed when the rate binding or client identity is unavailable.

A source-level test uses a dummy secret to check that the secret is forwarded only upstream and not returned. The key is Cloudflare's `CF-Connecting-IP`, not `X-Forwarded-For`. IPs can group visitors behind shared Wi-Fi, carrier NAT or privacy relays; the operator should assess this during the staging usability test.

### Test configuration and rate limits

`workers/nq-central-card-gateway/wrangler.example.toml` is a template for local/test use only. It declares `RATE_LIMITER` at an initial proposed threshold of **30 requests per IP per 60 seconds**. Replace the sample namespace identifier with a unique positive integer in the test Cloudflare account, and provide only approved staging values through local `.dev.vars` or a separate staging secret store. The gateway secret is intentionally absent from the TOML; never commit it. The template does not provision a binding or deploy anything.

For local work, copy the template to an untracked local config if desired, fill the staging-only non-secret values, and provide a dummy/test gateway secret through local secret storage. Run the Worker in local mode only after Wrangler is already available; local simulations do not prove the deployed binding or upstream configuration. No dependencies were installed and no Wrangler command was run in this review.

Rate controls are distinct:
- **Per client:** Worker binding, proposed 30 per 60 seconds per hashed IP.
- **Global:** the registration Edge Function calls `consume_business_card_rate_limit` with 600 per 60 seconds.
- **Per card/token:** registration RPC cooldown of 2 seconds.

Cloudflare documents Worker rate-limit state as local to a Cloudflare location and eventually consistent, so the per-client limit is an abuse throttle, not an exact global counter or accounting control. Its configured window supports 10 or 60 seconds. [Cloudflare Rate Limiting documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## SQL and function privileges

Migration 016 explicitly revokes EXECUTE on `register_business_card_event_with_token(uuid,text,text)` from PUBLIC, anon and authenticated and grants it to `service_role`. It dynamically applies the same policy to `consume_business_card_rate_limit`, checks effective anon/authenticated/service_role access, and removes other direct grants while retaining the function owner. The Edge Function calls the limiter with a fixed global bucket and 600/60 parameters. The limiter function's body and source migration were not located, so its counter semantics, persistence and concurrency behavior are not verified. The registration RPC is intended to be called through the server Edge Function, which checks the gateway secret and uses its server-side service role.

Migration 016 also removes direct client INSERT on `app_business_events` and `nfc_events`, removes client grants on `app_business_card_tokens`, and grants the token table to `service_role`. This is consistent with the management Edge Function, which authenticates an approved administrator and writes tokens server-side. It must still be checked against the live staging ACL and management flows.

Migration 018 revokes client EXECUTE on the SECURITY DEFINER legacy mirror and removes other explicit grantees except the owner. It replaces the function body but does not create, drop or reattach a trigger. The accessible branch interface did not expose a directory listing, and the expected 004 migration filename was not found at the tested paths. Therefore the exact existing trigger name/attachment and its historical creation migration are **not verified from this review**. The read-only catalog query reports enabled trigger metadata if present. Verify the attachment and run a staging insert-path test before accepting migration 018. The ACL of a trigger function and the trigger's actual firing behavior must be checked separately.

Migration 010's token-table policy references `public.app_is_admin()`. The exact definition and live ACL were not established here. Migration 016/018 do not revoke its EXECUTE permission. The catalog query reports its SECURITY DEFINER flag and effective role permissions without returning its body. Check staging that the policy can still evaluate for legitimate administration and that no unintended client access exists.

RLS policies and table ACLs are separate controls. The updated `registration-privilege-checks.sql` reports effective table privileges for anon, authenticated and service_role, whether RLS is enabled/forced, policy expressions, all public SECURITY DEFINER function metadata/EXECUTE access, and the mirror trigger definition. It includes `app_profiles`, `app_business_members`, cards, businesses, tokens and event tables. The updated historical reconciliation query compares eligible counts side by side by business/channel and reports missing dates, ambiguous/unmatched attribution, pre-existing duplicates, and imported business/channel/date mismatches. Both diagnostic SQL files contain read-only SELECT queries; they do not return function bodies, credentials or event rows. Neither file has been run. It has not been run. Policy text and catalog results alone do not prove two-tenant runtime isolation.

## Historical migration

Migration 017:
- verifies the presence of all source/destination columns used by the migration, then requires non-null source `created_at`;
- attributes from a card's business, or a unique normalized exact name match; ambiguous/unmatched rows remain in legacy storage;
- uses unique partial `legacy_event_id` and `ON CONFLICT` for idempotence;
- does not update existing business, event type/channel or event timestamp on conflict; it only fills missing device/card attribution;
- now aborts with a clear preflight error if duplicate non-null `legacy_event_id` values already exist, rather than attempting to build a conflicting unique index.

No rows were queried and no migration was executed. Run `supabase/security/historical-event-reconciliation.sql` before and after a future staging import, comparing business/channel counts and unmatched/ambiguous totals. Add a staging review of timestamp preservation and existing-row conflicts before any execution. A failed uniqueness preflight requires a separately reviewed reconciliation plan; do not delete or reattribute rows to make the index pass.

## Verification status and blockers

- Source review: completed for Worker, tests, migrations 010/016/017/018, and read-only SQL diagnostics.
- The exact 004 file and trigger attachment: not verified; remote file access available here fetches known paths but did not provide a directory listing.
- Worker automated suite: **9 passed, 0 failed** in the isolated Node runtime against the exact current branch files copied to a temporary directory.
- Static security suite: **7 passed, 0 failed** in the isolated Node runtime against current branch files copied to a temporary directory; only test fixture paths were redirected.
- No local checkout/Git or Node/Deno CLI is available. The tests ran through the available Node REPL, not via command-line execution from a checkout.
- PostgreSQL syntax, effective grants, app_is_admin behavior, RLS, trigger association/firing and historical reconciliation: require the dedicated staging database; none were checked.
- Worker rate binding and Edge Function gateway-secret behavior in a deployed environment: require staging deployment and end-to-end verification; no deployment was performed.
- Two-business isolation: requires two staging users and business fixtures; no runtime test was performed.

## Staging-only checklist for a later authorized validation

1. Inspect the exact 004 migration and current catalog state. Use the read-only privilege SQL first; check RPC access for anon/authenticated/service_role, RLS plus effective table privileges, `app_is_admin()`, rate-limit function ACL, and mirror trigger attachment/enabled state.
2. Confirm the dedicated staging function endpoint and Worker project ref match exactly; provision only a test rate-limit binding with a unique namespace and a staging-only gateway secret.
3. Exercise the Edge Function directly without the gateway secret (must be rejected), then through the Worker with valid/invalid/revoked/rotated tokens and active/paused/archived cards.
4. Verify the Worker rejects wrong origin, method, media type, oversize body, non-staging upstream, and rate-limited calls. Confirm no response/log includes the gateway secret.
5. Sign in as a user for Business A and Business B. Confirm each portal, export and event history returns only its own `business_id`; attempt cross-business reads and writes.
6. Run historical count reconciliation before and after an approved staging import. Compare counts by business/channel, missing-date and ambiguous-name totals, and verify no pre-existing attribution or timestamps changed.
7. Repeat the historical migration in staging only after review to demonstrate idempotence; compare `legacy_event_id` counts and ensure the second run inserts no duplicates.
