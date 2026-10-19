// Offline source-level checks. Run from repository root: node --test supabase/security-test/staging-integration-static.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [index, card, rpc, issuer, adminFunction, schemaMigration, dashboardMigration, eventMigration, mirrorMigration, historyMigration, worker, privilegeSql, wranglerExample, reconciliationSql, dashboardPreflight, rollbackPlan, stagingFixture, pgValidationPlan] = await Promise.all([
  readFile("index.html","utf8"),
  readFile("card.html","utf8"),
  readFile("supabase/functions/register-business-card-event/index.ts","utf8"),
  readFile("supabase/functions/manage-business-card-token/index.ts","utf8"),
  readFile("supabase/functions/manage-business-administration/index.ts","utf8"),
  readFile("supabase/migrations/020_add_nullable_dashboard_fields.sql","utf8"),
  readFile("supabase/migrations/021_restrict_dashboard_mutations.sql","utf8"),
  readFile("supabase/migrations/016_secure_multi_business_card_events.sql","utf8"),
  readFile("supabase/migrations/018_generalize_legacy_event_mirror.sql","utf8"),
  readFile("supabase/migrations/017_import_legacy_events_idempotently.sql","utf8"),
  readFile("workers/nq-central-card-gateway/src/index.mjs","utf8"),
  readFile("supabase/security/registration-privilege-checks.sql","utf8"),
  readFile("workers/nq-central-card-gateway/wrangler.example.toml","utf8"),
  readFile("supabase/security/historical-event-reconciliation.sql","utf8"),
  readFile("supabase/security/dashboard-security-preflight.sql","utf8"),
  readFile("supabase/security/DASHBOARD_SECURITY_ROLLBACK.md","utf8"),
  readFile("supabase/security-test/staging-acceptance.mjs","utf8"),
  readFile("supabase/security-test/POSTGRES_MIGRATION_VALIDATION.md","utf8"),
]);

test("portal and card use business filtering and server gateway paths", () => {
  assert.match(index,/\.eq\(['"]business_id['"],\s*businessId\)/);
  assert.match(index,/manage-business-card-token/);
  assert.doesNotMatch(index,/\.from\(['"]app_business_card_tokens['"]\)/);
  assert.doesNotMatch(index,/\.from\(['"]nfc_events['"]\)\.insert/);
  assert.match(card,/eventGatewayUrl/);
  assert.match(card,/credentials:\s*['"]omit['"]/);
  assert.doesNotMatch(card,/https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1/i);
});

test("registration and rate-limit RPC privileges are restricted in the migration", () => {
  assert.match(eventMigration,/REVOKE EXECUTE ON FUNCTION public\.register_business_card_event_with_token\(uuid, text, text\)\s+FROM PUBLIC, anon, authenticated/i);
  assert.match(eventMigration,/GRANT EXECUTE ON FUNCTION public\.register_business_card_event_with_token\(uuid, text, text\)\s+TO service_role/i);
  assert.match(eventMigration,/consume_business_card_rate_limit/);
  assert.match(eventMigration,/REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
  assert.match(eventMigration,/GRANT EXECUTE ON FUNCTION %s TO service_role/);
  assert.match(eventMigration,/has_function_privilege/);
  assert.match(eventMigration,/Token table privileges do not match server-only access/);
  assert.match(eventMigration,/acl_sweep/);
  assert.match(eventMigration,/aclexplode/);
  assert.match(eventMigration,/DO \$acl_sweep\$/);
  assert.match(eventMigration,/acl\.grantee NOT IN \(p\.proowner,service_role_oid\)/);
  assert.match(eventMigration,/REVOKE INSERT ON TABLE public\.app_business_events FROM PUBLIC, anon, authenticated/i);
  assert.match(eventMigration,/REVOKE INSERT ON TABLE public\.nfc_events FROM PUBLIC, anon, authenticated/i);
  assert.match(eventMigration,/REVOKE ALL PRIVILEGES ON TABLE public\.app_business_card_tokens FROM PUBLIC, anon, authenticated/i);
  assert.match(mirrorMigration,/REVOKE EXECUTE ON FUNCTION public\.mirror_legacy_nfc_event_to_business\(\)/);
  assert.match(mirrorMigration,/DO \$acl_sweep\$/);
  assert.match(privilegeSql,/has_function_privilege/);
  assert.match(privilegeSql,/has_table_privilege/);
  assert.match(privilegeSql,/service_role_delete/);
  assert.match(privilegeSql,/authenticated_delete/);
  assert.match(privilegeSql,/pg_get_triggerdef/);
  assert.match(privilegeSql,/app_is_admin/);
  assert.match(privilegeSql,/function_owner/);
  assert.match(privilegeSql,/direct_acl_entries/);
  assert.match(privilegeSql,/app_profiles/);
  assert.match(privilegeSql,/app_business_members/);
  assert.match(privilegeSql,/relforcerowsecurity/);
  assert.doesNotMatch(privilegeSql,/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/im);
});

test("gateway applies per-client rate limits before forwarding and fails closed", () => {
  assert.match(rpc,/x-nq-gateway-secret/);
  assert.match(rpc,/consume_business_card_rate_limit/);
  assert.match(worker,/RATE_LIMITER\.limit\(/);
  assert.match(worker,/CF-Connecting-IP/);
  assert.match(worker,/STAGING_PROJECT_REF/);
  assert.match(worker,/url\.hostname !== expectedProjectRef/);
  assert.doesNotMatch(worker,/x-forwarded-for/i);
  assert.match(worker,/client_rate_limit_unavailable/);
});

test("token and historical mapping checks stay server-side and ambiguity-safe", () => {
  assert.match(issuer,/crypto\.getRandomValues/);
  assert.match(issuer,/SHA-256/);
  assert.match(eventMigration,/INSERT INTO public\.app_business_events/);
  assert.match(eventMigration,/v_card\.business_id/);
  assert.doesNotMatch(eventMigration,/INSERT INTO public\.nfc_events/i);
  assert.match(historyMigration,/count\(\*\) = 1/);
  assert.match(historyMigration,/e\.created_at IS NOT NULL/);
  assert.doesNotMatch(historyMigration,/created_at\s*=\s*EXCLUDED\.created_at/i);
  assert.match(mirrorMigration,/name_match_count <> 1/);
  assert.doesNotMatch(mirrorMigration,/Veta|Tzura|Feral/);
});

test("gateway body and response handling is bounded and secret-safe", () => {
  assert.match(worker,/readBounded\(request, 2048\)/);
  assert.match(worker,/readBounded\(response, 4096\)/);
  assert.match(worker,/publicUpstreamResult/);
  assert.match(worker,/target\.href\.includes\(gatewaySecret\)/);
  assert.match(worker,/url\.pathname !== ["']\/functions\/v1\/register-business-card-event/);
  assert.match(worker,/redirect:\s*["']manual["']/);
  assert.match(wranglerExample,/name = ["']RATE_LIMITER["']/);
  assert.match(wranglerExample,/limit = 30/);
  assert.match(wranglerExample,/period = 60/);
  assert.doesNotMatch(wranglerExample,/NQ_GATEWAY_SHARED_SECRET\s*=/);
  assert.match(wranglerExample,/staging-project-ref/);
});

test("historical import is idempotent and does not rewrite attribution or event time", () => {
  assert.match(historyMigration,/duplicate_preflight/);
  assert.match(historyMigration,/CREATE UNIQUE INDEX IF NOT EXISTS app_business_events_legacy_event_id_uidx/);
  assert.match(historyMigration,/e\.created_at IS NOT NULL/);
  assert.match(historyMigration,/ON CONFLICT \(legacy_event_id\) WHERE legacy_event_id IS NOT NULL/);
  const conflictUpdate = historyMigration.match(/DO UPDATE SET([\s\S]*?);/i)?.[1] || "";
  assert.match(conflictUpdate,/device_type/);
  assert.match(conflictUpdate,/card_id/);
  assert.doesNotMatch(conflictUpdate,/business_id|event_type|created_at|legacy_event_id/);
  assert.match(historyMigration,/count\(\*\) = 1/);
  assert.doesNotMatch(historyMigration,/Veta|Tzura|Feral/);
});

test("staging diagnostics are read-only and compare history by tenant/channel", () => {
  assert.doesNotMatch(privilegeSql,/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/im);
  assert.doesNotMatch(privilegeSql,/pg_get_functiondef|\bprosrc\b/i);
  assert.match(privilegeSql,/app_profiles/);
  assert.match(privilegeSql,/app_business_members/);
  assert.match(privilegeSql,/qual,with_check/);
  assert.match(privilegeSql,/public.*mirror_legacy_nfc_event_to_business/);
  assert.doesNotMatch(reconciliationSql,/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/im);
  assert.match(reconciliationSql,/FULL JOIN imported/);
  assert.match(reconciliationSql,/imported_attribution_channel_or_date_mismatches/);
  assert.match(reconciliationSql,/duplicate_legacy_event_id_groups/);
});

test("nullable schema fields and panel fallbacks preserve unknown legacy values", () => {
  assert.ok(schemaMigration.includes("ADD COLUMN IF NOT EXISTS category text"));
  assert.ok(schemaMigration.includes("ADD COLUMN IF NOT EXISTS label text"));
  assert.ok(!schemaMigration.includes("UPDATE public."));
  assert.ok(schemaMigration.includes("ALTER COLUMN id SET DEFAULT nextval"));
  assert.ok(schemaMigration.includes("'app_business_events','app_business_review_snapshots'"));
  assert.ok(!schemaMigration.includes("created_at"));
  assert.ok(index.includes("categoryNames[x.category]||x.category||'Sin categoría'"));
  assert.ok(index.includes("x.label||'Tarjeta sin nombre'"));
  assert.ok(!index.includes("target_url,status,created_at"));
  assert.match(adminFunction,/from\("app_business_cards"\)\.select\("id,business_id,label,channel,target_url,status,archived_at", \{ count: "exact" \}\)/);
  assert.doesNotMatch(adminFunction,/from\("app_business_cards"\)\.select\("[^"]*created_at/);
});

test("dashboard mutations are server-authorized and client roles cannot promote themselves", () => {
  assert.ok(index.includes("functions.invoke('manage-business-administration'"));
  for (const directWrite of [
    ".from('app_businesses').insert", ".from('app_businesses').update",
    ".from('app_business_cards').insert", ".from('app_business_cards').update",
    ".from('app_business_members').upsert", ".from('app_profiles').update({status",
  ]) assert.ok(!index.includes(directWrite), directWrite);
  assert.ok(adminFunction.includes("auth.getUser(bearer)"));
  assert.ok(adminFunction.includes('profile?.role !== "admin"'));
  assert.ok(adminFunction.includes('profile?.status !== "approved"'));
  assert.ok(adminFunction.includes("input.user_id === authData.user.id"));
  assert.ok(!adminFunction.includes("update({ role:"));
  for (const action of ["dashboard","profiles","cards","business_create","business_update","business_status","profile_status","member_upsert","card_create","card_update"]) {
    assert.ok(adminFunction.includes(action), action);
  }
});


test("each dashboard mutation validates identifiers, allowed fields, and authorization", () => {
  for (const validation of [
    "typeof input.name === \"string\"",
    "!slugPattern.test(slug)",
    "!categories.has(category)",
    "!uuid.test(input.id)",
    "!statuses.has(input.status)",
    "input.user_id === authData.user.id",
    "!roles.has(input.member_role)",
    "!new Set([\"nfc\",\"qr\"]).has(input.channel)",
    "safeTarget(input.target_url)",
    "!new Set([\"active\",\"paused\"]).has(input.status)",
    "unknown_action",
  ]) assert.ok(adminFunction.includes(validation), validation);
  assert.ok(adminFunction.includes("const patch: Record<string, string> = {}"));
  assert.ok(adminFunction.includes("business.data?.status !== \"approved\""));
  assert.ok(adminFunction.includes("business?.status !== \"approved\""));
  assert.ok(adminFunction.includes("card_write_failed"));
  assert.ok(adminFunction.includes("business_write_failed"));
  assert.ok(adminFunction.includes("membership_write_failed"));
  assert.ok(adminFunction.includes("business_not_found"));
  assert.ok(adminFunction.includes("profile_not_found"));
  assert.ok(adminFunction.includes("card_not_found"));
  assert.ok(adminFunction.includes(".select(\"id\").maybeSingle()"));
});


test("profile reads use bounded pagination and archived cards cannot be reactivated", () => {
  assert.ok(adminFunction.includes(`select("user_id,status,role,created_at,full_name", { count: "exact" }).order("created_at",{ascending:false}).order("user_id").range(from, to)`));
  assert.ok(adminFunction.includes(`select("id,archived_at").eq("id", input.id).maybeSingle()`));
  assert.ok(adminFunction.includes(`error: "card_archived"`));
  assert.ok(adminFunction.includes(`error: "admin_read_failed"`));
});

test("admin read actions page every dataset and fail instead of silently truncating", () => {
  assert.ok(adminFunction.includes("const ADMIN_PAGE_SIZE = 1000"));
  assert.ok(adminFunction.includes("const MAX_ADMIN_RESULT_ROWS = 50000"));
  assert.ok(adminFunction.includes("async function readAllRows"));
  assert.ok(adminFunction.includes("throw new ResultLimitError()"));
  assert.ok(adminFunction.includes('error: "result_limit_exceeded"'));
  assert.ok(adminFunction.includes(".range(from, to)"));
  assert.ok(!adminFunction.includes(".limit(10000)"));
  assert.ok(!adminFunction.includes(".limit(5000)"));
});

test("admin bearer parsing accepts normal Authorization headers and HTTPS targets", () => {
  assert.ok(adminFunction.includes(String.raw`authorization.match(/^Bearer\s+(.+)$/i)`));
  assert.ok(!adminFunction.includes(String.raw`/^Bearer\\s+(.+)$/i`));
  assert.ok(adminFunction.includes(String.raw`! /\s/.test(value)`) || adminFunction.includes(String.raw`!/\s/.test(value)`));
  assert.ok(!adminFunction.includes(String.raw`/[\\s]/.test(value)`));
});

test("admin action allowlists reject unexpected request fields", () => {
  assert.ok(adminFunction.includes("const fieldsByAction"));
  assert.ok(adminFunction.includes('return json({ error: "unexpected_field" }, 400, origin)'));
  for (const action of [
    "dashboard: [\"action\"]", "profiles: [\"action\"]", "cards: [\"action\"]",
    "business_create: [\"action\", \"name\", \"slug\", \"category\"]",
    "business_update: [\"action\", \"id\", \"name\", \"slug\"]",
    "business_status: [\"action\", \"id\", \"status\"]",
    "profile_status: [\"action\", \"user_id\", \"status\"]",
    "member_upsert: [\"action\", \"user_id\", \"business_id\", \"member_role\"]",
    "card_create: [\"action\", \"business_id\", \"channel\", \"label\", \"target_url\"]",
    "card_update: [\"action\", \"id\", \"label\", \"target_url\", \"status\", \"archived\"]",
  ]) assert.ok(adminFunction.includes(action), action);
});

test("dashboard permissions revoke direct writes alongside server replacement operations", () => {
  for (const sql of [
    "REVOKE ALL PRIVILEGES ON TABLE public.app_businesses FROM PUBLIC, anon, authenticated",
    "REVOKE MAINTAIN ON TABLE public.%I FROM PUBLIC, anon, authenticated",
    "REVOKE ALL PRIVILEGES ON TABLE public.app_business_cards FROM PUBLIC, anon, authenticated",
    "GRANT UPDATE (full_name) ON TABLE public.app_profiles TO authenticated",
    "GRANT INSERT (business_id, platform, review_count)",
    "REVOKE ALL ON SEQUENCE",
    "DO $dashboard_sequence_acl$", "app_business_events','id')", "has_sequence_privilege",
    "REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated",
    "has_table_privilege('authenticated','public.app_business_cards','SELECT')",
    "nq_central_profile_name_self_update","nq_central_member_review_insert",
    "p.status='approved'","b.status='approved'","review_count >= 0",
    "'TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'",
    "'captured_at','INSERT'","'source','INSERT'","has_column_privilege",
  ]) assert.ok(dashboardMigration.includes(sql), sql);
  assert.ok(!dashboardMigration.includes("GRANT SELECT ON TABLE public.app_business_cards TO anon"));
  assert.ok(!dashboardMigration.includes("GRANT SELECT ON TABLE public.app_business_cards TO authenticated"));
});

test("profile column grant survives the last column ACL cleanup", () => {
  const cleanupEnd = dashboardMigration.indexOf("$revoke_column_acl$;");
  const grant = "GRANT UPDATE (full_name) ON TABLE public.app_profiles TO authenticated";
  const grantAt = dashboardMigration.indexOf(grant);
  assert.ok(cleanupEnd >= 0, "column ACL cleanup must be explicit");
  assert.ok(grantAt > cleanupEnd, "full_name grant must follow the cleanup that revokes column ACLs");
  assert.equal(dashboardMigration.indexOf(grant, grantAt + 1), -1, "keep one final profile grant");
  assert.ok(grantAt < dashboardMigration.indexOf("DO $verify$"), "grant must precede effective privilege verification");
});

test("legacy NFC sequence writes cannot survive the dashboard privilege migration", () => {
  const sequenceBlock = dashboardMigration.match(/DO \$dashboard_sequence_acl\$([\s\S]*?)\$dashboard_sequence_acl\$;/)?.[1] || "";
  assert.match(sequenceBlock, /'nfc_events'/);
  assert.match(sequenceBlock, /REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated/);
  assert.match(dashboardMigration, /has_sequence_privilege\('anon',v_legacy_sequence,'USAGE,SELECT,UPDATE'\)/);
  assert.match(dashboardMigration, /has_sequence_privilege\('authenticated',v_legacy_sequence,'USAGE,SELECT,UPDATE'\)/);
});

test("020 clears inherited default sequence ACLs before it commits", () => {
  const revokeAt = schemaMigration.indexOf("REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated");
  assert.ok(revokeAt >= 0, "Supabase default ACLs must not expose newly created sequences between 020 and 021");
  assert.ok(revokeAt < schemaMigration.indexOf("ALTER SEQUENCE %s RESTART WITH %s"));
  assert.match(schemaMigration, /has_sequence_privilege\('anon',v_sequence,'USAGE,SELECT,UPDATE'\)/);
  assert.match(schemaMigration, /has_sequence_privilege\('authenticated',v_sequence,'USAGE,SELECT,UPDATE'\)/);
});

test("review verification requires allowed columns without a table-wide INSERT grant", () => {
  assert.doesNotMatch(dashboardMigration, /NOT\s+pg_catalog\.has_table_privilege\('authenticated','public\.app_business_review_snapshots','INSERT'\)/);
  assert.match(dashboardMigration, /OR pg_catalog\.has_table_privilege\('authenticated','public\.app_business_review_snapshots','INSERT'\)/);
  assert.match(dashboardMigration, /has_column_privilege\([\s\S]*'authenticated','public\.app_business_review_snapshots','business_id','INSERT'/);
});

test("dashboard preflight is catalog-only and contains a staged rollback plan", () => {
  for (const forbidden of ["INSERT ","UPDATE ","DELETE ","ALTER ","CREATE ","DROP ","TRUNCATE "]) {
    assert.ok(!dashboardPreflight.toUpperCase().includes(forbidden));
  }
  for (const catalog of ["information_schema.columns","pg_policies","has_table_privilege","has_column_privilege","pg_get_triggerdef","safe_for_020_preflight"]) {
    assert.ok(dashboardPreflight.includes(catalog), catalog);
  }
  assert.ok(!dashboardPreflight.includes("pg_get_functiondef"));
  assert.ok(!dashboardPreflight.includes("FROM public.nfc_events"));
  assert.ok(!dashboardPreflight.includes("FROM public.app_business_events"));
  assert.ok(rollbackPlan.includes("Do not drop columns automatically"));
  assert.ok(rollbackPlan.includes("do not restore blanket authenticated grants"));
  assert.ok(dashboardMigration.includes("m.member_role IN ('owner','manager')"));
});

test("staging acceptance fixture is project-locked, scoped, and secret-free", () => {
  assert.ok(stagingFixture.includes('const PROJECT_REF = "rxxbmqilnozcnpwguqga"'));
  assert.ok(stagingFixture.includes('process.argv[projectArg + 1] !== PROJECT_REF'));
  assert.ok(stagingFixture.includes('base.hostname !== PROJECT_REF + ".supabase.co"'));
  assert.ok(stagingFixture.includes('const SOURCE = "nq_central_acceptance_fixture_v1"'));
  assert.ok(stagingFixture.includes('app_metadata?.nq_central_fixture === FIXTURE'));
  assert.ok(stagingFixture.includes("if (!allPassed)"));
  assert.ok(stagingFixture.includes("automatic cleanup is disabled after any setup/test failure"));
  assert.ok(stagingFixture.includes('id=in.('));
  assert.ok(stagingFixture.includes('business_id: BUSINESS[tenant].id'));
  assert.ok(stagingFixture.includes('token_hash: digest(raw)'));
  assert.ok(stagingFixture.includes('page <= 50'));
  assert.ok(stagingFixture.includes("const businessIds = Object.values(BUSINESS)"));
  assert.ok(stagingFixture.includes('" + businessIds + ")'));
  assert.ok(stagingFixture.includes('owner cannot capture reviews for another business'));
  assert.ok(stagingFixture.includes('viewer role cannot capture reviews for own business'));
  assert.ok(stagingFixture.includes('eventExpectation(row.id)'));
  assert.ok(stagingFixture.includes('&event_type=eq.'));
  assert.ok(stagingFixture.includes('"id=eq." + row.id + "&slug=eq." + encodeURIComponent(row.slug)'));
  assert.ok(stagingFixture.includes('body: [{ business_id: businessId, platform: "Google apertura", review_count: probeCount }]'));
  assert.ok(!stagingFixture.includes('REVIEW_PROBE_IDS'));
  assert.ok(!stagingFixture.includes('captured_at: new Date().toISOString(), source: "manual"'));
  assert.ok(!stagingFixture.includes("service_role_key ="));
  assert.ok(!stagingFixture.includes("console.log("));
});

test("product NFC/QR contract validates card state and keeps destinations behind token flow", () => {
  assert.ok(eventMigration.includes("v_card.channel='qr'"));
  assert.ok(eventMigration.includes("status='active' AND archived_at IS NULL"));
  assert.ok(eventMigration.includes("v_token.active"));
  assert.ok(eventMigration.includes("'target_url',v_card.target_url"));
  assert.ok(eventMigration.includes("'rate_limited'"));
  assert.ok(rpc.includes("result.target_url"));
  assert.ok(rpc.includes("consume_business_card_rate_limit"));
  assert.ok(!dashboardMigration.includes("GRANT SELECT ON TABLE public.app_business_cards TO anon"));
  assert.ok(dashboardMigration.includes("has_table_privilege('anon','public.app_business_cards','SELECT')"));
  assert.ok(adminFunction.includes("getReader()"));
  assert.ok(adminFunction.includes("total > 8192"));
});


test("fixture checks HTTP and final state, isolates authorization probes, and fails closed on cleanup", () => {
  assert.match(stagingFixture,/expectedStatus/);
  assert.match(stagingFixture,/readRows\("app_businesses"/);
  assert.match(stagingFixture,/readRows\("app_business_cards"/);
  assert.match(stagingFixture,/readRows\("app_business_card_tokens"/);
  assert.match(stagingFixture,/readRows\("app_business_events"/);
  assert.match(stagingFixture,/readRows\("app_business_review_snapshots"/);
  assert.match(stagingFixture,/CRITICAL:.*restoration failed/);
  assert.match(stagingFixture,/fixture is preserved and no broad cleanup was started/);
  assert.match(stagingFixture,/Cleanup stopped: event full signature mismatch/);
  assert.match(stagingFixture,/device_type=eq\.mobile&created_at=eq\./);
  assert.match(stagingFixture,/captured_at=eq\./);
  assert.match(stagingFixture,/token_hash=eq\./);
  assert.match(stagingFixture,/HTTP .* but matching rows remain/);
  assert.match(stagingFixture,/viewer role cannot capture reviews for own business/);
  assert.match(stagingFixture,/user cannot self-assign administrator/);
  assert.match(stagingFixture,/user cannot self-approve/);
  assert.match(stagingFixture,/owner cannot capture reviews for another business/);
  assert.match(stagingFixture,/cannot read the other tenant/);
  assert.doesNotMatch(stagingFixture,/if \(!keep\) await cleanup\(\)/);
});

test("card portal reads remain behind the admin function and SQL ACLs cover column grants", () => {
  assert.match(index,/adminRequest\(['"]cards['"]\)/);
  assert.doesNotMatch(index,/\.from\(['"]app_business_cards['"]\)/);
  assert.match(dashboardMigration,/REVOKE ALL \(%I\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(dashboardMigration,/DO \$verify_column_acl\$/);
  assert.match(dashboardMigration,/has_column_privilege\(r,'public\.' \|\| t,c\.attname,'REFERENCES'\)/);
  assert.match(dashboardMigration,/allow_insert := r='authenticated'/);
  assert.match(dashboardMigration,/allow_update := r='authenticated'/);
  assert.doesNotMatch(dashboardMigration,/nq_central_admin_card_select/);
  assert.match(schemaMigration,/LOCK TABLE public\.%I IN ACCESS EXCLUSIVE MODE/);
  assert.match(schemaMigration,/pg_get_serial_sequence/);
  assert.match(schemaMigration,/If the sequence is still owned by this ID column but its DEFAULT was/);
  assert.ok(schemaMigration.includes("IF v_default IS NULL THEN"));
  assert.ok(schemaMigration.includes("'ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT nextval(%L::regclass)'"));
  assert.match(schemaMigration,/pg_depend/);
  assert.match(schemaMigration,/v_sequence_owner IS DISTINCT FROM v_table_owner/);
  assert.match(schemaMigration,/seqmin, seqmax, seqcycle/);
  assert.match(schemaMigration,/seqincrement/);
  assert.match(schemaMigration,/ID sequence must increment by 1/);
  assert.match(schemaMigration,/v_max_id = 9223372036854775807/);
  assert.match(schemaMigration,/ALTER SEQUENCE %s RESTART WITH %s/);
  assert.match(schemaMigration,/ALTER COLUMN category DROP NOT NULL/);
  assert.match(schemaMigration,/ALTER COLUMN label DROP NOT NULL/);
  assert.match(pgValidationPlan,/exact PostgreSQL major version/);
  assert.match(pgValidationPlan,/not yet been validated/);
});
