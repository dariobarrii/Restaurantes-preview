// Pure preparation/guard tests. No Docker, SQL, schema simulation, or network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateStagingUrl, rolesSql, requireExtensions, PROJECT_REF } from "./postgres-validation.mjs";

test("export target is restricted to staging, session connections and verified TLS", () => {
  assert.equal(validateStagingUrl(`postgresql://readonly:unit-placeholder@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`).hostname, `db.${PROJECT_REF}.supabase.co`);
  assert.doesNotThrow(() => validateStagingUrl(`postgresql://readonly.${PROJECT_REF}:unit-placeholder@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`));
  for (const value of [
    "postgresql://readonly:unit-placeholder@db.other.supabase.co/postgres?sslmode=verify-full",
    `postgresql://postgres:unit-placeholder@db.${PROJECT_REF}.supabase.co/postgres?sslmode=verify-full`,
    `postgresql://readonly:unit-placeholder@db.${PROJECT_REF}.supabase.co/postgres?sslmode=require`,
    `postgresql://readonly.${PROJECT_REF}:unit-placeholder@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
    `postgresql://readonly:unit-placeholder@db.${PROJECT_REF}.supabase.co/postgres?sslmode=verify-full&host=other.invalid`,
  ]) assert.throws(() => validateStagingUrl(value));
});

test("role preparation preserves owner attributes and refuses sensitive settings", () => {
  const metadata = { version: 170011, inspection_safe: true, unsafe_settings: false, roles: [{ rolname: "postgres", rolsuper: false, rolinherit: true, rolcreaterole: true, rolcreatedb: true, rolcanlogin: true, rolreplication: true, rolbypassrls: true, rolconnlimit: -1, rolconfig: [] }], memberships: [] };
  const sql = rolesSql(metadata);
  assert.match(sql, /CREATE ROLE "postgres" WITH NOSUPERUSER/);
  assert.match(sql, /BYPASSRLS/);
  assert.doesNotMatch(sql, /PASSWORD/);
  assert.throws(() => rolesSql({ ...metadata, inspection_safe: false }));
  assert.throws(() => rolesSql({ ...metadata, unsafe_settings: true }));
  assert.throws(() => rolesSql({ ...metadata, roles: [{ ...metadata.roles[0], rolconfig: ["unreviewed.setting=unit-placeholder"] }] }));
});

test("missing extension versions block faithful restoration", () => {
  assert.doesNotThrow(() => requireExtensions([{ name: "plpgsql", version: "1.0" }], [{ name: "plpgsql", version: "1.0" }]));
  assert.throws(() => requireExtensions([{ name: "managed_extension", version: "1" }], []));
  assert.throws(() => requireExtensions([{ name: "plpgsql", version: "2" }], [{ name: "plpgsql", version: "1" }]));
});

test("workflow is manual-only, fixed to integration and never uploads dumps", async () => {
  const workflow = await readFile(".github/workflows/postgres-staging-validation.yml", "utf8");
  // JSON is a valid YAML subset; parse without installing a YAML dependency.
  const parsed = JSON.parse(workflow);
  assert.deepEqual(Object.keys(parsed.on), ["workflow_dispatch"]);
  assert.match(parsed.jobs.validate.if, /refs\/heads\/security\/nq-central-staging-integration/);
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.jobs.validate.services.postgres.ports, undefined);
  assert.doesNotMatch(workflow, /upload-artifact|pull_request_target/);
  const localStep = parsed.jobs.validate.steps.find(s => s.run?.endsWith(" validate"));
  assert.equal(localStep.env, undefined);
  assert.equal(parsed.jobs.validate.steps.at(-1).if, "always()");
});


test("prepared idempotency snapshots include RLS, functions, triggers and default ACLs",async()=>{
 const sql=await readFile("supabase/security-test/postgres-clone-snapshot.sql","utf8");
 for(const item of ["relrowsecurity","relforcerowsecurity","has_function_privilege","pg_trigger","pg_default_acl"]) assert.ok(sql.includes(item));
 assert.doesNotMatch(sql,/pg_get_functiondef|SELECT \* FROM public\./i);
});
