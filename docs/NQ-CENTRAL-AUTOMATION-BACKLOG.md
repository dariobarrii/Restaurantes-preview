# NQ Central — mobile automation and UX backlog

Date: 2026-10-17  
Status: backlog only; no production behavior changed.

This backlog prioritizes changes that can be prepared without Cloudflare setup or production access. Items marked as blockers must be resolved before the tokenized scanner is released.

## P0 — Scanner correctness and security
- [ ] **Fix rate-limit bypass in `card.html`:** current scanner treats `{ ok: false, error: "rate_limited" }` as a successful validation and redirects to the target. This may be intentional cooldown behavior only if the server contract guarantees the token was already validated, but the current Edge Function performs the global rate limit before validating the token and can return rate-limit errors before token validation. Fail closed on any non-`ok:true` result until the backend provides an explicit, tested response proving validation succeeded. Update browser smoke test `validated card cooldown can redirect` to expect no redirect, or redesign a separate signed validation receipt.
- [ ] **Connect scanner to gateway:** the current `card.html` calls the production Supabase function directly. Do not switch to the Worker until an isolated Worker URL and matching isolated Edge Function secret are configured and verified.
- [ ] **Validate destination URLs server-side:** ensure card creation and rotation only accept intended HTTPS destinations and cannot be changed by non-admin users.
- [ ] **Verify public card lookup RLS:** `card.html` queries `app_business_cards`; test that anon can read only fields/rows required for active public cards, never administrative or private data.
- [ ] **Avoid token leakage:** preserve fragment-based token transport and immediate URL cleanup; never log tokens or expose them in analytics/referrers.

## P1 — Reliable dashboard refresh
- [ ] Replace unconditional 30-second polling with visibility-aware refresh: pause while tab/app is backgrounded, resume with one refresh when visible.
- [ ] Prevent overlapping `loadClient` / `load` requests so slow network responses cannot race and overwrite newer state.
- [ ] Add visible last-updated timestamp and a recoverable stale-data/error indicator.
- [ ] Keep refresh manual control available and show a spinner/disabled state while a refresh is running.
- [ ] Clear timers and cached user-specific state on logout; never refresh a previous user's view after session change.
- [ ] Keep all restaurant data queries tenant-scoped and let RLS enforce access; never rely on client-side filtering as a security boundary.

## P1 — Operational automation
- [ ] Add a reusable CI test that checks every scanner error response fails closed and never redirects unless the response is exactly `{ ok: true }`.
- [ ] Add a CI test for target URL scheme and origin validation.
- [ ] Add a release-gate workflow/checklist for isolated gateway tests, tenant isolation, and physical scan sign-off. CI must not deploy production automatically.
- [ ] Add a schema/migration drift check before production release; never auto-apply migrations to production.
- [ ] Add a privacy-safe operational status section (last successful refresh, API error state, data source) without exposing secrets or personal data.

## P2 — Admin efficiency
- [ ] CSV export must quote/escape fields correctly and protect against spreadsheet formula injection (cells beginning with =, +, -, or @).
- [ ] Use deterministic date/time handling and explicit timezone labels for daily review snapshots and reports.
- [ ] Add confirmation before destructive actions (pause, archive, token rotation); show one-time token links only once.
- [ ] Add pagination or bounded queries to large event tables; avoid downloading all events on every refresh.
- [ ] Add empty states and actionable errors for missing business cards, memberships, or permissions.

## Safe implementation sequence
1. Fix and test scanner fail-closed behavior in the security branch.
2. Inspect and fix URL validation and public card lookup policies.
3. Improve refresh lifecycle and logout state cleanup.
4. Harden CSV export and bound query sizes.
5. Re-run static checks, gateway tests, browser smoke tests, and tenant tests.
6. Complete real gateway/phone tests from the PC before any release.
7. Keep PR #2 draft and production unchanged until all gates pass and the owner authorizes release.

## Constraints
No domain purchases, plan upgrades, new paid services, production secrets, production migrations, production deployments, or production auth setting changes are authorized by this backlog.
