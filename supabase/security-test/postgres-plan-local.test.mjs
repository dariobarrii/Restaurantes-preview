// Pure preparation/guard tests. No Docker, SQL, schema simulation, or network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateStagingUrl, rolesSql, requireExtensions, PROJECT_REF, approvedImage, checkRunner, compareRuntime, assertSandbox, compareExtensionState, compareCatalog } from "./postgres-validation.mjs";

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


test("only explicit Codespace authorization and the actual approved checkout pass",()=>{
 const env={CODESPACES:"true",CODESPACE_NAME:"unit-space",GITHUB_REPOSITORY:"dariobarrii/Restaurantes-preview",NQ_PG_VALIDATION_AUTHORIZATION:"APPROVED_CODESPACE_POSTGRES_VALIDATION"};
 const repo={branch:"security/nq-central-staging-integration",origin:"https://github.com/dariobarrii/Restaurantes-preview.git"};
 assert.doesNotThrow(()=>checkRunner(env,repo));
 for(const [e,r] of [[{...env,NQ_PG_VALIDATION_AUTHORIZATION:""},repo],[env,{...repo,branch:"main"}],[env,{...repo,origin:"https://github.com/other/repo.git"}],[{...env,GITHUB_REPOSITORY:"other/repo"},repo]])assert.throws(()=>checkRunner(e,r));
});
test("approved extension image must be from the reviewed distribution and pinned",()=>{
 assert.equal(approvedImage("supabase/postgres@sha256:"+"a".repeat(64)),"supabase/postgres@sha256:"+"a".repeat(64));
 for(const image of ["supabase/postgres:latest","postgres:17.11","other/postgres@sha256:"+"a".repeat(64)])assert.throws(()=>approvedImage(image));
});
test("database settings are recreated only for the local database and unknown settings block",()=>{
 const base={version:170011,inspection_safe:true,roles:[],memberships:[],database:{owner:"postgres"},database_settings:[{role:null,settings:["app.settings.jwt_exp=3600"]},{role:"authenticated",settings:["statement_timeout=10s"]}]};
 const sql=rolesSql(base);assert.match(sql,/ALTER DATABASE "nq_validation" SET "app.settings.jwt_exp"/);assert.match(sql,/ALTER ROLE "authenticated" IN DATABASE "nq_validation"/);assert.match(sql,/OWNER TO "postgres"/);
 assert.throws(()=>rolesSql({...base,unsafe_database_settings:true}));
 assert.throws(()=>rolesSql({...base,database_settings:[{role:null,settings:["app.settings.jwt_exp=unit-not-numeric"]}]}));
 assert.throws(()=>rolesSql({...base,database_settings:[{role:null,settings:["unreviewed.value=unit-placeholder"]}]}));
});
test("same major and extensions alone cannot pass differing locale or preload gates",()=>{
 const source={database:{encoding:"UTF8",collate:"en_US.UTF-8",ctype:"en_US.UTF-8",provider:"i",locale:"en-US",collation_version:"153.121"},preload:{shared_preload_libraries:"pg_stat_statements",session_preload_libraries:"supautils"}};
 assert.doesNotThrow(()=>compareRuntime(source,structuredClone(source)));
 assert.throws(()=>compareRuntime(source,{...source,database:{...source.database,provider:"c"}}));
 assert.throws(()=>compareRuntime(source,{...source,preload:{...source.preload,session_preload_libraries:""}}));
});


test("only a marked sandbox without ports/mounts can be restored offline",()=>{
 const info={Config:{Labels:{"nq.central.validation":"staging-schema-only"}},HostConfig:{PortBindings:{}},Mounts:[],NetworkSettings:{Networks:{}}};
 assert.doesNotThrow(()=>assertSandbox(info,true));
 assert.throws(()=>assertSandbox({...info,Config:{}},true));
 assert.throws(()=>assertSandbox({...info,HostConfig:{PortBindings:{"5432/tcp":[]}}},true));
 assert.throws(()=>assertSandbox({...info,Mounts:[{Type:"bind"}]},true));
 assert.throws(()=>assertSandbox({...info,NetworkSettings:{Networks:{bridge:{}}}},true));
 assert.doesNotThrow(()=>assertSandbox({...info,NetworkSettings:{Networks:{bridge:{}}}},false));
});


test("extension availability cannot hide restored ownership/schema differences",()=>{
 const source=[{name:"plpgsql",version:"1.0",schema:"pg_catalog",owner:"postgres"}];
 assert.doesNotThrow(()=>compareExtensionState(source,structuredClone(source)));
 assert.throws(()=>compareExtensionState(source,[{...source[0],owner:"nq_ci_bootstrap"}]));
 assert.throws(()=>compareExtensionState(source,[{...source[0],schema:"public"}]));
 assert.throws(()=>compareExtensionState(source,[]));
});


test("database ACL preparation preserves grantor and grant options without CREATE DATABASE reconnects",()=>{
 const sql=rolesSql({version:170011,inspection_safe:true,roles:[],memberships:[],database:{owner:"postgres",acl:[{grantor:"postgres",grantee:"PUBLIC",privilege:"CONNECT",is_grantable:false},{grantor:"postgres",grantee:"authenticated",privilege:"TEMPORARY",is_grantable:true}]}});
 assert.match(sql,/REVOKE ALL ON DATABASE "nq_validation" FROM PUBLIC, "nq_ci_bootstrap"/);
 assert.match(sql,/SET ROLE "postgres"/);assert.match(sql,/TO "authenticated" WITH GRANT OPTION/);
 assert.doesNotMatch(sql,/CREATE DATABASE|\\connect/);
});


test("export implementation guards private files and column/schema write privileges",async()=>{
 const source=await readFile("supabase/security-test/postgres-validation.mjs","utf8");
 for(const guard of ["realpathSync(process.env.RUNNER_TEMP)","entry.isSymbolicLink()","entry.mode & 0o077","has_any_column_privilege","has_schema_privilege"]) assert.ok(source.includes(guard));
 assert.doesNotMatch(source,/pg_authid|rolpassword/);
});


test("migrations are blocked until the restored source catalog matches",async()=>{
 assert.doesNotThrow(()=>compareCatalog({rls:true,acl:["unit"]},{rls:true,acl:["unit"]}));
 assert.throws(()=>compareCatalog({rls:true},{rls:false}));
 const script=await readFile("supabase/security-test/postgres-validation.mjs","utf8");
 assert.ok(script.indexOf('compareCatalog(sourceCatalog,')<script.indexOf('for (const migration of ['));
 const snapshot=await readFile("supabase/security-test/postgres-clone-snapshot.sql","utf8");
 assert.ok(snapshot.includes("n.nspname IN ('public','private')"));
 assert.doesNotMatch(snapshot,/ORDER BY p.proname,p.oid/);
});
