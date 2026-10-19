# NQ Central staging migration rollback plan (review only)

No rollback SQL has been executed or prepared as an automatic destructive script.

## Order and gates

1. Review migration 020 and the read-only dashboard preflight first.
2. Apply neither migration until the staging-only preflight shows all baseline columns and RLS conditions expected by the migration.
3. Deploy the authenticated management Edge Function to staging only, configure its allowed browser origins, and verify legitimate admin reads and writes before applying 021.
4. Apply 021 only after the replacement routes and review/member policies pass staging acceptance tests.
5. Keep migrations 020 and 021 separate so schema and permission failures can be isolated.

## PostgreSQL validation gate

The exact-major local validation procedure is documented in [POSTGRES_MIGRATION_VALIDATION.md](../security-test/POSTGRES_MIGRATION_VALIDATION.md). It has not been run. It requires a separately approved read-only schema export from the named staging project and a local PostgreSQL server with the same major version. No staging SQL, migration, or fixture is run by that procedure until its specific approval is given.

Migration 020 uses transactional ALTER SEQUENCE RESTART rather than setval so a later migration error can roll back the sequence change. It also locks the target tables while aligning IDs and fails closed if sequence ownership, default dependency, range, or cycle settings differ from expectations.

## Recovery approach

- If migration 020 fails, its transaction rolls back. It adds nullable columns only and performs no backfill. Do not drop columns automatically: once entered, category/label values may be in use.
- If the Edge Function is not ready, do not apply 021. The browser code expects the function, so restore the web source to the prior commit before relying on the old direct-write workflow.
- Migration 020 establishes/aligns managed ID defaults for business events and review snapshots. Migration 021 restricts review sequence privileges to the portal insert flow. If applied, preserve those defaults and sequences during recovery; do not drop or rewind them while event registration or review capture can run.
- If 021 has been applied and the Edge Function has a defect, do not restore blanket authenticated grants or TRUNCATE. Repair the function or prepare a narrowly scoped forward migration after inspecting effective ACLs and RLS in staging.
- Never reverse profile role/status protections, tenant policies, token privileges, or historic event attribution without a separate reviewed plan.
- No recovery action authorizes changes in production. Confirm the staging target before any manual recovery.
