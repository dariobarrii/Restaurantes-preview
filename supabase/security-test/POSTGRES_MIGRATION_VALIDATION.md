# Local PostgreSQL validation plan for migrations 020 and 021

## Status

The authorized read-only staging inspection was completed on 2026-10-19. The real server reports PostgreSQL 17.11 (170011). No staging writes or acceptance fixture were executed. Local migration execution is **blocked**: PostgreSQL 17, psql, pg_dump, and a schema-export connection are not available in the inspected environment. No schema-only dump or local database was created. The migration SQL has not yet been validated by PostgreSQL.

See [the validation report](./STAGING_VALIDATION_2026-10-19.md) and [sanitized metadata evidence](./results/2026-10-19-staging-readonly.json). Node source checks and mocked local handler tests are not a substitute for the blocked PostgreSQL validation.

## Compatibility gate

Use the exact PostgreSQL major version reported by the approved staging project. Migration 020 uses pg_sequence, identity metadata, and transactional sequence restart. Migration 021 checks MAINTAIN only when the server is PostgreSQL 17 or newer. Do not infer the staging major from the Supabase CLI or local client version; record the server version separately.

Required tools must already be available locally: psql, pg_dump, and a local PostgreSQL server of the same major version. Do not install tools as part of this validation. If the matching server or any required Supabase extension/schema dependency is unavailable, stop and report the incompatibility rather than substituting mocks.

## Reproducible procedure (local execution authorized; tooling/export still blocked)

Run from PowerShell. Set the staging connection URL only in the current process environment; never echo it or put it in command history or a file.

1. Confirm the selected target in the Supabase dashboard is **NQ Central Security Test**. With explicit approval for read-only staging inspection, retrieve the server version:

   ~~~powershell
   if (-not $env:NQ_STAGING_DB_URL) { throw "Set NQ_STAGING_DB_URL in this process only." }
   $serverVersion = psql -X $env:NQ_STAGING_DB_URL -v ON_ERROR_STOP=1 -Atc "SELECT current_setting('server_version_num')::integer"
   if ($LASTEXITCODE -ne 0) { throw "Could not read the staging PostgreSQL version." }
   $serverMajor = [math]::Floor(([int]$serverVersion) / 10000)
   "Staging PostgreSQL major: $serverMajor"
   ~~~

   The query is read-only. Do not continue if the project identity is uncertain.

2. Confirm local tools and the actual local server major match the recorded staging major:

   ~~~powershell
   psql --version
   pg_dump --version
   $localAdminDb = "postgresql://localhost/postgres"
   $localVersion = psql -X $localAdminDb -v ON_ERROR_STOP=1 -Atc "SELECT current_setting('server_version_num')::integer"
   if ($LASTEXITCODE -ne 0) { throw "Could not read the local PostgreSQL server version." }
   $localMajor = [math]::Floor(([int]$localVersion) / 10000)
   if ($localMajor -ne $serverMajor) { throw "Local PostgreSQL major does not match staging; stop." }
   ~~~

   Use only an already available local PostgreSQL server matching $serverMajor. A client version alone does not prove the server version.

3. After approval for this read-only staging export, create a schema-only dump outside the repository. It contains schema and function definitions; keep it private, do not print it, and do not commit it.

   ~~~powershell
   $env:NQ_SCHEMA_DUMP = Join-Path $env:TEMP "nq-central-staging-schema.sql"
   pg_dump --schema-only --file $env:NQ_SCHEMA_DUMP $env:NQ_STAGING_DB_URL
   if ($LASTEXITCODE -ne 0) { throw "Schema-only export failed; stop." }
   ~~~

   This exports no table rows. Keep ACL statements in the dump: removing privileges would hide pre-existing grants that migration 021 must revoke. If managed Supabase schemas, extensions, or role ownership prevent a faithful restore, stop; do not hand-write substitute definitions and call the result equivalent.

4. Restore that snapshot into a new disposable local database on the matching PostgreSQL major. These commands affect only localhost:

   ~~~powershell
   $localDbName = "nq_central_migration_validation"
   createdb --maintenance-db=$localAdminDb $localDbName
   if ($LASTEXITCODE -ne 0) { throw "Could not create the disposable local database; stop." }
   $localDb = "postgresql://localhost/$localDbName"
   psql -X $localDb -v ON_ERROR_STOP=1 -f $env:NQ_SCHEMA_DUMP
   if ($LASTEXITCODE -ne 0) { throw "Schema restore failed; stop." }
   ~~~

   Before restoring, recreate the required local role attributes and memberships, without copying passwords. A schema-only pg_dump does not export roles. Staging's postgres owner is NOT SUPERUSER and has BYPASSRLS; service_role has BYPASSRLS, while anon/authenticated do not. A default local postgres superuser is therefore not a faithful replacement for that owner. Use an isolated local cluster with a separate bootstrap operator so the staging owner role can be recreated accurately. Keep non-login application roles NOLOGIN. Preserve ownership, default ACLs, grants and role inheritance from the metadata evidence. If the restore reports missing extensions, unsupported managed objects, or role/owner mismatches, stop and record the limitation. Do not strip ACLs or ownership and call the result equivalent.

5. On the disposable local clone only, run each migration twice with stop-on-error. Run 020 twice before 021 twice:

   ~~~powershell
   $localDb = "postgresql://localhost/nq_central_migration_validation"
   psql -X $localDb -U postgres -v ON_ERROR_STOP=1 -f supabase/migrations/020_add_nullable_dashboard_fields.sql
   if ($LASTEXITCODE -ne 0) { throw "020 first pass failed." }
   psql -X $localDb -U postgres -v ON_ERROR_STOP=1 -f supabase/migrations/020_add_nullable_dashboard_fields.sql
   if ($LASTEXITCODE -ne 0) { throw "020 idempotency pass failed." }
   psql -X $localDb -U postgres -v ON_ERROR_STOP=1 -f supabase/migrations/021_restrict_dashboard_mutations.sql
   if ($LASTEXITCODE -ne 0) { throw "021 first pass failed." }
   psql -X $localDb -U postgres -v ON_ERROR_STOP=1 -f supabase/migrations/021_restrict_dashboard_mutations.sql
   if ($LASTEXITCODE -ne 0) { throw "021 idempotency pass failed." }
   ~~~

   Never substitute the staging connection URL for $localDb.

6. Against the disposable local clone, run read-only catalog checks for:
   - category and label being nullable;
   - each ID column default/identity being tied to the owned sequence;
   - a missing default being restored only when the ID column still owns the sequence, while any different existing default remains a fail-closed error;
   - sequence owner matching table owner, increment of 1, non-cycling configuration, range and next value beyond existing IDs;
   - authenticated having only profile full_name UPDATE and review snapshot INSERT on business_id, platform, review_count;
   - no effective browser table-level INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, including inherited role grants;
   - 020 removing browser sequence grants inherited from staging's default ACLs before committing;
   - no browser privileges on the event/legacy NFC ID sequences; only USAGE for authenticated on the review sequence, with service_role review USAGE retained;
   - the full_name UPDATE grant occurring after the final column ACL cleanup and no requirement for table-wide review INSERT;
   - portal card reads coming from manage-business-administration while direct authenticated app_business_cards SELECT stays unavailable.

7. Record the exact PostgreSQL server version, both migration pass results, any warnings, and the generated local catalog outputs. Do not label this SQL validation passed based on source inspection or a nonmatching local server.

## What this local validation does not prove

A schema clone cannot prove live Supabase authorization, deployed Edge Function behavior, RLS isolation between two users/businesses, or Worker/NFC/QR end-to-end behavior. Those require separate staging approval and the real two-business acceptance run. No migration, deployment, fixture, or historical import is authorized by this document.


## Continuation check: 2026-10-19

No server/client/dump/Docker was found on PATH or the standard PostgreSQL installation directory. wsl.exe reports WSL is not installed. No tools were installed and no disposable database could be created. Local PostgreSQL testing is authorized, but no faithful export or runtime is available. Existing metadata is not a substitute for a dump.

Migration passes above now explicitly select the recreated staging owner postgres; do not let an OS-default superuser silently replace the real NOSUPERUSER/BYPASSRLS owner. The restore/bootstrap operator remains separate. Use postgres-clone-snapshot.sql after every pass; it now also captures RLS enabled/forced, function owner/SECURITY DEFINER/effective EXECUTE, trigger enabled state and default ACLs. These additions are prepared SQL, not executed PostgreSQL evidence. Any managed dependency/membership grantor restoration error blocks validation; do not remove it to obtain a green result.
