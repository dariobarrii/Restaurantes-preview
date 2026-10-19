# NQ Central staging migration rollback plan (review only)

No rollback SQL has been executed or prepared as an automatic destructive script.

## Order and gates

1. Review migration 020 and the read-only dashboard preflight first.
2. Apply neither migration until the staging-only preflight shows all baseline columns and RLS conditions expected by the migration.
3. Deploy the authenticated management Edge Function to staging only, configure its allowed browser origins, and verify legitimate admin reads and writes before applying 021.
4. Apply 021 only after the replacement routes and review/member policies pass staging acceptance tests.
5. Keep migrations 020 and 021 separate so schema and permission failures can be isolated.

## Recovery approach

- If migration 020 fails, its transaction rolls back. It adds nullable columns only and performs no backfill. Do not drop columns automatically: once entered, category/label values may be in use.
- If the Edge Function is not ready, do not apply 021. The browser code expects the function, so restore the web source to the prior commit before relying on the old direct-write workflow.
- Migration 021 also establishes/aligns the review snapshot ID sequence only when the column has no managed default. If 021 has been applied, preserve that default and sequence during recovery; do not drop or rewind it while the portal can insert review captures.
- If 021 has been applied and the Edge Function has a defect, do not restore blanket authenticated grants or TRUNCATE. Repair the function or prepare a narrowly scoped forward migration after inspecting effective ACLs and RLS in staging.
- Never reverse profile role/status protections, tenant policies, token privileges, or historic event attribution without a separate reviewed plan.
- No recovery action authorizes changes in production. Confirm the staging target before any manual recovery.
