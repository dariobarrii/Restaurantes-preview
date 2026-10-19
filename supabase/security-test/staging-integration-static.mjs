// Offline source-level checks. Run from repository root: node --test supabase/security-test/staging-integration-static.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [index, card, rpc, issuer, eventMigration, mirrorMigration, historyMigration, worker, privilegeSql, wranglerExample, reconciliationSql] = await Promise.all([
  readFile("index.html","utf8"),
  readFile("card.html","utf8"),
  readFile("supabase/functions/register-business-card-event/index.ts","utf8"),
  readFile("supabase/functions/manage-business-card-token/index.ts","utf8"),
  readFile("supabase/migrations/016_secure_multi_business_card_events.sql","utf8"),
  readFile("supabase/migrations/018_generalize_legacy_event_mirror.sql","utf8"),
  readFile("supabase/migrations/017_import_legacy_events_idempotently.sql","utf8"),
  readFile("workers/nq-central-card-gateway/src/index.mjs","utf8"),
  readFile("supabase/security/registration-privilege-checks.sql","utf8"),
  readFile("workers/nq-central-card-gateway/wrangler.example.toml","utf8"),
  readFile("supabase/security/historical-event-reconciliation.sql","utf8"),
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
