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
