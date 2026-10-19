# Codex handoff — NQ Central staging reconciliation

Date: 2026-10-19
Target Supabase project: `NQ Central Security Test` (`rxxbmqilnozcnpwguqga`)
Git branch: `security/nq-central-staging-integration`

## Guardrails
- Work only on this branch and the staging Supabase project above.
- Do not query or modify production.
- Do not deploy the website, deploy Edge Functions, merge branches, or change production references.
- Do not print or commit secrets, tokens, or service-role keys.
- Do not run broad schema migrations until the schema/code mismatch below is resolved and preflight checks pass.

## Completed during this session
- Applied staging migration `restrict_anonymous_business_writes`.
- Committed corresponding migration file `supabase/migrations/019_restrict_anonymous_business_writes.sql`.
- Verified effective privileges after migration:
  - `anon`: SELECT true; INSERT/UPDATE/DELETE false on `app_businesses` and `app_business_cards`.
  - `authenticated`: existing DML grants were intentionally left unchanged pending RLS/code reconciliation.
- Supabase security advisor currently reports seven RLS-enabled tables without policies: `app_business_card_rate_limit_maintenance`, `app_business_card_rate_limits`, `app_business_card_tokens`, `nfc_card_tokens`, `nfc_event_rate_limit_maintenance`, `nfc_event_rate_limits`, `nfc_events`. Catalog checks show anon/authenticated have no effective table privileges on these internal tables; verify again after future changes.

## Blocking mismatch discovered
The current `index.html` writes directly from the browser to multiple tables:
- `app_businesses`: insert/update/status update
- `app_business_cards`: insert/update/archive
- `app_profiles`: update full_name and admin changes to status
- `app_business_members`: upsert membership
- `app_business_review_snapshots`: insert review snapshots

But the live staging policy set currently exposes SELECT policies for most of these tables and no write policies for business/card/admin management. Do not solve this by simply granting broad writes or by adding a self-update policy that lets users alter their own role/status.

The live staging schema currently reports these columns:
- `app_businesses`: id, name, slug, status (the dashboard also expects `category`)
- `app_business_cards`: id, business_id, channel, target_url, status, archived_at (the dashboard also expects `label`)
- `app_profiles`: user_id, full_name, role, status, created_at, updated_at, email

## Required next work
1. Compare all migrations in this branch against the actual staging schema and identify the intended baseline/migration order. Do not assume the existing staging schema has applied the branch's full app migrations.
2. Reconcile schema fields (`category`, `label`, and any other missing fields) with the actual UI and Edge Functions.
3. Design least-privilege writes:
   - Keep anonymous roles read-only for approved public business/card lookup.
   - Do not allow a normal authenticated user to promote themselves to admin or change their own approval status.
   - Prefer authenticated Edge Functions with verified admin authorization for admin-only mutations, or rigorously scoped RLS policies plus column-level protections where safe.
   - Restrict review snapshot inserts to an approved member's own business.
   - Restrict membership changes to admins.
4. Review the legacy mirror trigger and historical import idempotency; confirm trigger existence/enabled state and avoid duplicate events.
5. Add automated tests for unauthenticated writes, self-promotion, cross-business reads/writes, token misuse, event replay/rate limiting, and normal client dashboard operations.
6. Return a concise plan and a migration diff for review before applying additional database changes. Keep the work on this branch and staging only.

## Verified live function details
- `private.app_is_admin()` is SECURITY DEFINER with empty search_path; it returns true only for an authenticated UID whose `app_profiles` row has role `admin` and status `approved`.
- `public.register_nfc_event_with_token(uuid,text,text)` is SECURITY DEFINER with empty search_path; execution is denied to anon/authenticated and granted to service_role.
- Rate-limit RPCs are SECURITY DEFINER with empty search_path; execution is denied to anon/authenticated and granted to service_role.
- The above is a staging catalog review only; no function bodies or event rows were changed.

## Acceptance criteria
- All changes are represented as reviewed migrations/code on this branch.
- SQL is preflighted and tested against staging before application.
- Effective grants AND RLS policies are checked together.
- Tests demonstrate both that legitimate dashboard flows work and that unauthorized cross-tenant access/writes fail.
- No production access, deploy, merge, or paid-resource creation.


## 2026-10-19 implementation preparation status

Changes are prepared on `security/nq-central-staging-integration`; none of the new SQL has been executed and no staging data or permissions were changed.

### Prepared
- Migration 020 adds nullable `app_businesses.category` and `app_business_cards.label`; existing rows remain NULL. It does not infer category/label values.
- `created_at` was reviewed: business/card timestamps are not required for the current dashboard after removing card ordering by that field. Profile and event timestamps remain in use and already exist; no historical timestamp is added or backfilled.
- `index.html` uses neutral labels for NULL category/label values and routes admin reads/writes through the authenticated `manage-business-administration` function. Profile self-service remains limited to `full_name`; review capture remains a member-side insert.
- New management function verifies the bearer session with Auth and checks approved admin role from `app_profiles` server-side. It rejects status changes to the caller's own profile, does not accept role changes, checks membership targets, and validates card channels/destinations.
- `supabase/config.toml` requires JWT verification for that function.
- Migration 021 coordinates revocation of browser DML/TRUNCATE/MAINTAIN on businesses/cards with service-role replacements; browser roles do not receive SELECT on cards or target_url. Approved business catalogue reads, self profile-name updates, member event reads, and owner/manager review snapshots remain scoped by RLS. It must not be applied before the function is configured/deployed in staging and acceptance-tested.
- Added catalog-only preflight and manual rollback guidance.

### Verified from staging metadata
- The connected project is NQ Central Security Test. Applied migration history includes the staging fixtures and 019, but not repository migrations 002–018. Treat staging as a partial/manual baseline rather than replaying the repository history.
- Existing app_businesses lacks category/created_at; app_business_cards lacks label/created_at.
- authenticated retains DML and TRUNCATE on app_businesses/cards while current policies are read-focused. This remains live until the reviewed permission migration is applied.
- The expected legacy mirror trigger is absent in staging. Historical reconciliation has eligible legacy rows not yet imported; do not import until the attribution and preflight output are reviewed.
- Product registration Edge Function is not deployed in staging, and its RPC contract remains incompatible with the live RPC until the reviewed registration migration and function are deployed in order.

### Pending before acceptance
1. Review migrations 020/021 and run the read-only dashboard preflight manually against staging; do not apply when required baseline checks fail.
2. Configure `NQ_ADMIN_ALLOWED_ORIGINS` for only the exact staging portal origin, deploy the new admin function to staging, and test every legitimate admin operation.
3. Confirm that the auth/profile status values and table constraints in staging match the code; the function uses only observed UI statuses for profile changes.
4. Reconcile and deploy the product NFC/QR path only after the live RPC/function contract is aligned. Do not use E2E functions.
5. Validate two-business isolation, profile self-service, review role restrictions, token rotation/revocation, rate limits, mirror trigger, and historical reconciliation in staging.
6. Run SQL migrations only after manual SQL review and a passing preflight. No production action is authorized by this checklist.

### Test evidence in this environment
- Existing Worker tests: 9/9 passed from a temporary copy of the branch snapshot.
- Static source assertions: 12/12 passed from a temporary copy of the updated branch snapshot.
- The Node CLI is unavailable in this runtime, so the standard `node --test` command could not be invoked. The tests were evaluated in an isolated Node REPL harness without installing dependencies.
- No Edge Function, database RLS, auth, two-tenant, gateway deployment, or end-to-end acceptance tests have been run.


## 2026-10-19 staging preflight and dashboard follow-up

- The authorized project identity was confirmed as NQ Central Security Test (rxxbmqilnozcnpwguqga). No production project was queried.
- Fixed the admin card-list query to stop requesting app_business_cards.created_at; that column is absent in staging and is not added by migration 020. The UI continues to display a neutral label when label is NULL.
- Added static assertions for the missing timestamp regression, all ten administration actions, action-level input checks, and explicit not-found responses for targeted updates.
- Code-level checks run from an isolated Node REPL against the branch snapshot: 5/5 focused checks passed. The repository node --test and Worker suite were not rerun in this turn because the local checkout is not the GitHub branch and the Node CLI is unavailable. No integration tests are implied by those focused assertions.
- Read-only dashboard preflight results:
  - app_businesses.category and app_business_cards.label are absent; the 020 preflight marks these nullable additions safe. created_at is absent on cards and is intentionally not in 020.
  - authenticated still has direct write, TRUNCATE, TRIGGER, REFERENCES, and MAINTAIN privileges on app_businesses and app_business_cards; anon has SELECT and MAINTAIN. RLS is enabled but not forced. Migration 021 remains unapplied.
  - authenticated currently cannot update app_profiles.full_name; the 021 column grant is required for the self-service profile flow.
  - private.app_is_admin() exists and is executable by authenticated. Registration and rate-limit RPCs are SECURITY DEFINER and executable by service_role only. The mirror trigger query returned no rows.
  - No migration was applied, no staging rows or permissions were changed, and no Edge Function was deployed.
- Read-only historical reconciliation: 64 legacy test events have unique attribution and source timestamps (62 NFC, 2 QR); 0 missing source dates, 0 ambiguous/unmatched events, 0 already imported, 0 attribution/channel/date mismatches, and 0 duplicate legacy ID groups. These counts are staging test data and are not commercial metrics. Historical import remains unapplied.
- Current staging Edge Functions do not include the product register-business-card-event or manage-business-administration function. Thus dashboard writes, token lifecycle, and product NFC/QR acceptance remain blocked on reviewed migrations and staging Edge Function deployment.



## 2026-10-19 latest acceptance-preparation update

### Implemented on the branch
- Fixed an over-escaped bearer-token regex in manage-business-administration; ordinary Authorization: Bearer <JWT> headers now match the intended parser.
- Fixed the HTTPS destination whitespace check. The old character class rejected the letter s, which made normal https:// destinations fail validation.
- Profile-list reads now use the same bounded pagination as the dashboard/card actions; database read failures return a server error instead of being reported as malformed requests.
- business_update and card_update now reject malformed supplied values instead of silently ignoring them. Archived cards cannot be reactivated by changing only their status.
- Added static regression assertions for both parser bugs, pagination, archive behavior, and the staging fixture.
- Added supabase/security-test/staging-acceptance.mjs, a zero-dependency Node fixture. It locks to the staging project ref and HTTPS hostname, uses deterministic fixture IDs/slugs and an Auth metadata marker, uses temporary credentials only in process memory, stores only token hashes, seeds two approved businesses, an owner and a viewer, NFC/QR cards, paused/archived cards, per-tenant events and review snapshots, and cleans only its own exact fixture scope by default. --keep preserves the fixture; --cleanup removes that scope.
- The fixture exercises tenant event/review reads, known NFC/QR counts, self-role/status changes, and direct card-write denial. It explicitly leaves the product token/gateway path pending; it does not call an E2E endpoint.

### Execution status
- No staging rows, permissions, schema, or deployed functions were changed in this follow-up.
- The new offline static suite and staging fixture have not been run with the repository Node CLI in this environment. Local git/node are unavailable and this checkout is not the authorized remote branch. The staged fixture also requires local operator-supplied staging credentials; none were requested or printed.
- The focused source assertions will be reported separately from database/RLS and end-to-end evidence. The fixture's results are not currently available, so tenant isolation and authorization remain unverified by this update.
- Migration 020 and 021 remain unchanged and unapplied. The current staging schema still lacks category and label; the fixture deliberately omits those optional columns so it can target the observed pre-020 schema. Category/label-null UI behavior remains a static-code check.

### Operator commands (PowerShell, from a checkout of this branch)
Use Node.js 20 or newer. Set these variables only in a private local shell or secret manager; do not paste the privileged value into chat or commit it.

~~~powershell
node --version
node --test supabase/security-test/staging-integration-static.mjs
node --test workers/nq-central-card-gateway/src/index.test.mjs

$env:SUPABASE_URL = 'https://rxxbmqilnozcnpwguqga.supabase.co'
$env:SUPABASE_ANON_KEY = '<staging anon key>'
$env:SUPABASE_SERVICE_ROLE_KEY = '<staging service_role key>'
node supabase/security-test/staging-acceptance.mjs --project rxxbmqilnozcnpwguqga --keep
node supabase/security-test/staging-acceptance.mjs --project rxxbmqilnozcnpwguqga --cleanup
~~~

The fixture command changes only its marker-scoped staging test rows and Auth users; by default it cleans them after the run. --keep is intended only when an operator needs to inspect the fixture rows; run the explicit --cleanup command afterward. Do not treat the test as complete until both commands return successfully and the logged checks pass.

### Still blocked
- Product manage-business-administration, manage-business-card-token, and register-business-card-event are not deployed to staging; no full card lifecycle, gateway, rate-limit, replay, or NFC/QR redirect test can pass until a reviewed deployment exists.
- 020/021 remain subject to manual preflight/SQL review and explicit execution authorization. No launch or staging-security completion claim is made.
