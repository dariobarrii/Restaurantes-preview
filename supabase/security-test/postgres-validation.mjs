// Prepared orchestration, NOT an executed PostgreSQL validation.
// export issues only metadata SELECT and pg_dump --schema-only against staging.
// validate passes every SQL write to a fixed local Docker DB/user, never to a URL.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

export const PROJECT_REF = "rxxbmqilnozcnpwguqga";
const BOOTSTRAP = "nq_ci_bootstrap";
const DATABASE = "nq_validation";
class Blocked extends Error {}
const safeSettings = new Set(["search_path", "statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout", "default_transaction_read_only", "default_transaction_isolation"]);
const ident = (v) => '"' + String(v).replaceAll('"', '""') + '"';
const literal = (v) => "'" + String(v).replaceAll("'", "''") + "'";

export function validateStagingUrl(value) {
  const u = new URL(value);
  const user = decodeURIComponent(u.username);
  const direct = u.hostname === `db.${PROJECT_REF}.supabase.co`;
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) && user.endsWith(`.${PROJECT_REF}`);
  if (!["postgres:", "postgresql:"].includes(u.protocol) || (!direct && !pooler) ||
      (u.port && u.port !== "5432") || u.pathname !== "/postgres" || u.hash ||
      u.searchParams.get("sslmode") !== "verify-full" ||
      !user || !u.password || (direct ? user : user.slice(0, -(PROJECT_REF.length + 1))) === "postgres") {
    throw new Blocked("Use the approved staging session/direct URL with a dedicated read-only role and verified TLS.");
  }
  const allowed = new Set(["sslmode"]);
  if ([...u.searchParams.keys()].some((key) => !allowed.has(key))) throw new Blocked("Unexpected connection option.");
  return u;
}

export function checkRunner(env, repository = {}) {
  const repo = "dariobarrii/Restaurantes-preview";
  const branch = "security/nq-central-staging-integration";
  if (env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === repo && env.GITHUB_REF === "refs/heads/" + branch) return;
  const origins = ["https://github.com/" + repo + ".git", "git@github.com:" + repo + ".git"];
  if (env.CODESPACES === "true" && env.CODESPACE_NAME && env.GITHUB_REPOSITORY === repo &&
      env.NQ_PG_VALIDATION_AUTHORIZATION === "APPROVED_CODESPACE_POSTGRES_VALIDATION" &&
      repository.branch === branch && origins.includes(repository.origin)) return;
  throw new Blocked("Only the approved Actions branch or explicitly authorized Codespace may run this procedure.");
}

export function assertSandbox(info, isolated = false) {
  if (info?.Config?.Labels?.["nq.central.validation"] !== "staging-schema-only") throw new Blocked("Container is not marked as the disposable validation sandbox.");
  if ((info.HostConfig?.PortBindings && Object.keys(info.HostConfig.PortBindings).length) || (info.Mounts || []).some(m => m.Type === "bind")) throw new Blocked("Sandbox has exposed ports or host bind mounts.");
  const networks = Object.keys(info.NetworkSettings?.Networks || {});
  if (isolated && networks.some(n => n !== "none")) throw new Blocked("Disconnect sandbox networking before local SQL restoration.");
}

export function compareRuntime(source, target) {
  for (const key of ["encoding","collate","ctype","provider","locale","collation_version"]) {
    if (!source.database || source.database[key] !== target.database?.[key]) throw new Blocked("Database locale/encoding differs from staging; faithful restore blocked.");
  }
  for (const key of ["shared_preload_libraries","session_preload_libraries"]) {
    if (typeof source.preload?.[key] !== "string" || source.preload[key] !== target.preload?.[key]) throw new Blocked("Preloaded libraries differ from staging; faithful restore blocked.");
  }
}

export function approvedImage(value) {
  if (!/^(?:postgres|supabase\/postgres)@sha256:[a-f0-9]{64}$/.test(value || "")) throw new Blocked("Use an owner-reviewed postgres or supabase/postgres image pinned by digest.");
  return value;
}

export function rolesSql(metadata) {
  if (metadata.version < 170000 || metadata.version >= 180000 || !metadata.inspection_safe) throw new Blocked("Staging version/read-only inspection role gate failed.");
  if (metadata.unsafe_settings || metadata.unsafe_database_settings) throw new Blocked("Role settings need private review before a faithful export; no settings were exported.");
  const sql = [];
  for (const role of metadata.roles) {
    if (role.rolname === BOOTSTRAP) throw new Blocked("Source role collides with local bootstrap.");
    if (role.rolname.startsWith("pg_")) continue;
    const flags = [["rolsuper","SUPERUSER"],["rolinherit","INHERIT"],["rolcreaterole","CREATEROLE"],["rolcreatedb","CREATEDB"],["rolcanlogin","LOGIN"],["rolreplication","REPLICATION"],["rolbypassrls","BYPASSRLS"]].map(([key, word]) => (role[key] ? "" : "NO") + word);
    sql.push(`CREATE ROLE ${ident(role.rolname)} WITH ${flags.join(" ")} CONNECTION LIMIT ${Number(role.rolconnlimit)};`);
    for (const setting of role.rolconfig || []) {
      const eq = setting.indexOf("="); const key = setting.slice(0, eq);
      if (!safeSettings.has(key)) throw new Blocked("Unreviewed role configuration.");
      sql.push(`ALTER ROLE ${ident(role.rolname)} SET ${ident(key)} TO ${literal(setting.slice(eq + 1))};`);
    }
  }
  for (const m of metadata.memberships) {
    sql.push(`GRANT ${ident(m.parent)} TO ${ident(m.member)} WITH ADMIN ${m.admin_option ? "TRUE" : "FALSE"}, INHERIT ${m.inherit_option ? "TRUE" : "FALSE"}, SET ${m.set_option ? "TRUE" : "FALSE"} GRANTED BY ${ident(m.grantor)};`);
  }
  for (const row of metadata.database_settings || []) {
    const prefix = row.role ? `ALTER ROLE ${ident(row.role)} IN DATABASE ${ident(DATABASE)}` : `ALTER DATABASE ${ident(DATABASE)}`;
    for (const setting of row.settings || []) {
      const eq = setting.indexOf("="); const key = setting.slice(0, eq); const value = setting.slice(eq + 1);
      if (!safeSettings.has(key) && !(key === "app.settings.jwt_exp" && /^[0-9]{1,7}$/.test(value))) throw new Blocked("Unreviewed database role setting.");
      sql.push(`${prefix} SET ${ident(key)} TO ${literal(value)};`);
    }
  }
  if (metadata.database?.owner) sql.push(`ALTER DATABASE ${ident(DATABASE)} OWNER TO ${ident(metadata.database.owner)};`);
  if (metadata.database?.acl) {
    sql.push(`REVOKE ALL ON DATABASE ${ident(DATABASE)} FROM PUBLIC, ${ident(BOOTSTRAP)};`);
    for (const acl of metadata.database.acl) {
      if (!["CONNECT","CREATE","TEMPORARY"].includes(acl.privilege)) throw new Blocked("Unreviewed database privilege.");
      const grantee = acl.grantee === "PUBLIC" ? "PUBLIC" : ident(acl.grantee);
      sql.push(`SET ROLE ${ident(acl.grantor)};`);
      sql.push(`GRANT ${acl.privilege} ON DATABASE ${ident(DATABASE)} TO ${grantee}${acl.is_grantable ? " WITH GRANT OPTION" : ""};`);
      sql.push("RESET ROLE;");
    }
  }
  return sql.join("\n");
}

export function compareExtensionState(source, restored) {
  if (source.length !== restored.length) throw new Blocked("Restored extension inventory differs from staging.");
  for (const ext of source) if (!restored.some(x => ["name","version","schema","owner"].every(k => x[k] === ext[k]))) throw new Blocked("Restored extension ownership/schema differs from staging.");
}

export function requireExtensions(source, available) {
  for (const ext of source) if (!available.some((x) => x.name === ext.name && x.version === ext.version)) throw new Blocked("Required extension/version is not available in the local image; faithful restore blocked.");
}

const metadataSql = `SELECT jsonb_build_object(
 'version',current_setting('server_version_num')::integer,
 'database',(SELECT jsonb_build_object('acl',(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,'privilege',x.privilege_type,'is_grantable',x.is_grantable) ORDER BY x.grantor,x.grantee,x.privilege_type) FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) x),'owner',pg_get_userbyid(datdba),'encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,'provider',to_jsonb(d)->>'datlocprovider','locale',to_jsonb(d)->>'datlocale','collation_version',to_jsonb(d)->>'datcollversion') FROM pg_database d WHERE datname=current_database()),
 'preload',jsonb_build_object('shared_preload_libraries',current_setting('shared_preload_libraries'),'session_preload_libraries',current_setting('session_preload_libraries')),
 'unsafe_database_settings',EXISTS(SELECT 1 FROM pg_db_role_setting d CROSS JOIN LATERAL unnest(d.setconfig) x WHERE d.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND split_part(x,'=',1) NOT IN ('search_path','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','default_transaction_read_only','default_transaction_isolation','app.settings.jwt_exp')),
 'database_settings',(SELECT COALESCE(jsonb_agg(jsonb_build_object('role',CASE WHEN d.setrole=0 THEN NULL ELSE pg_get_userbyid(d.setrole) END,'settings',ARRAY(SELECT x FROM unnest(d.setconfig) x WHERE split_part(x,'=',1) IN ('search_path','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','default_transaction_read_only','default_transaction_isolation','app.settings.jwt_exp'))) ORDER BY d.setrole),'[]') FROM pg_db_role_setting d WHERE d.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())),
 'inspection_safe',NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb))
   AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p') AND (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES')))
   AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' AND has_schema_privilege(current_user,oid,'CREATE'))
   AND NOT has_database_privilege(current_user,current_database(),'CREATE')
   AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE')),
 'unsafe_settings',EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN LATERAL unnest(r.rolconfig) s WHERE split_part(s,'=',1) NOT IN ('search_path','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','default_transaction_read_only','default_transaction_isolation')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('rolname',rolname,'rolsuper',rolsuper,'rolinherit',rolinherit,'rolcreaterole',rolcreaterole,'rolcreatedb',rolcreatedb,'rolcanlogin',rolcanlogin,'rolreplication',rolreplication,'rolbypassrls',rolbypassrls,'rolconnlimit',rolconnlimit,'rolconfig',CASE WHEN NOT EXISTS(SELECT 1 FROM unnest(r.rolconfig) s WHERE split_part(s,'=',1) NOT IN ('search_path','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','default_transaction_read_only','default_transaction_isolation')) THEN r.rolconfig ELSE NULL END) ORDER BY rolname) FROM pg_roles r),
 'memberships',(SELECT COALESCE(jsonb_agg(jsonb_build_object('parent',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin_option',admin_option,'inherit_option',inherit_option,'set_option',set_option) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace));`;

function context() {
  let repository = {};
  if (process.env.CODESPACES === "true") {
    const branch = spawnSync("git", ["branch","--show-current"], {encoding:"utf8"});
    const origin = spawnSync("git", ["remote","get-url","origin"], {encoding:"utf8"});
    if (branch.status !== 0 || origin.status !== 0) throw new Blocked("Cannot verify Codespace checkout.");
    repository = {branch:branch.stdout.trim(),origin:origin.stdout.trim()};
  }
  checkRunner(process.env,repository);
  const container = process.env.NQ_PG_CONTAINER || "";
  if (!/^[a-f0-9]{12,64}$/.test(container)) throw new Blocked("Missing local service container ID.");
  const root = resolve(process.env.RUNNER_TEMP || "");
  const dir = resolve(root, "nq-postgres-validation");
  if (!process.env.RUNNER_TEMP || !dir.startsWith(root + sep)) throw new Blocked("Invalid private temporary directory.");
  return { container, dir };
}
function docker(c, args, input, name, remoteEnv = {}) {
  const argsEnv = Object.keys(remoteEnv).flatMap((key) => ["-e", key]);
  const result = spawnSync("docker", ["exec", "-i", ...argsEnv, c.container, ...args], { input, env: { ...process.env, ...remoteEnv }, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(c.dir, name + ".private.log"), Buffer.concat([result.stdout || Buffer.alloc(0), result.stderr || Buffer.alloc(0)]), { mode: 0o600 });
  if (result.status !== 0 || result.error) throw new Blocked(`${name} failed; raw SQL/provider output withheld.`);
  return result.stdout.toString("utf8");
}
function localSql(c, sql, name, owner = BOOTSTRAP) {
  return docker(c, ["psql","-X","-qAt","-v","ON_ERROR_STOP=1","-h","/var/run/postgresql","-U",owner,"-d",DATABASE], sql, name);
}
export async function main(mode) {
  const c = context();
  if (mode === "cleanup") { rmSync(c.dir, { recursive: true, force: true }); return; }
  mkdirSync(c.dir, { recursive: true, mode: 0o700 });
  const inspection = spawnSync("docker",["inspect",c.container],{encoding:"utf8"});
  if (inspection.status !== 0) throw new Blocked("Cannot inspect validation sandbox.");
  const info = JSON.parse(inspection.stdout)[0];
  assertSandbox(info,mode === "validate");
  if (mode === "isolate") {
    for (const name of Object.keys(info.NetworkSettings?.Networks || {})) {
      if (name === "none") continue;
      const result = spawnSync("docker",["network","disconnect",name,c.container],{encoding:"utf8"});
      if (result.status !== 0) throw new Blocked("Sandbox network isolation failed.");
    }
    return;
  }
  if (mode === "precheck") {
    const pinned = approvedImage(process.env.NQ_APPROVED_POSTGRES_IMAGE || "postgres@" + (process.env.NQ_APPROVED_POSTGRES_DIGEST || ""));
    const expected = pinned.split("@")[1];
    if (!/^sha256:[a-f0-9]{64}$/.test(expected)) throw new Blocked("An owner-reviewed official Postgres image digest is required.");
    const image = spawnSync("docker", ["inspect","--format={{.Image}}",c.container], { encoding: "utf8" });
    if (image.status !== 0) throw new Blocked("Cannot inspect local container image.");
    const digests = spawnSync("docker", ["image","inspect","--format={{json .RepoDigests}}",image.stdout.trim()], { encoding: "utf8" });
    if (digests.status !== 0 || !JSON.parse(digests.stdout).some((d) => d === pinned || d === "docker.io/" + (pinned.startsWith("postgres@") ? "library/" : "") + pinned)) throw new Blocked("Container image differs from the approved digest.");
    const version = Number(localSql(c, "SELECT current_setting('server_version_num');", "local-version"));
    if (version !== 170011) throw new Blocked("PostgreSQL 17.11 is required.");
    return;
  }
  if (mode === "export") {
    validateStagingUrl(process.env.NQ_STAGING_READONLY_DB_URL);
    if (!process.env.NQ_STAGING_CA_PEM?.includes("-----BEGIN CERTIFICATE-----")) throw new Blocked("Staging CA certificate required for verified TLS.");
    const ca = join(c.dir, "staging-ca.pem"); writeFileSync(ca, process.env.NQ_STAGING_CA_PEM, { mode: 0o600 });
    const copy = spawnSync("docker", ["cp",ca,c.container + ":/tmp/nq-staging-ca.pem"]);
    if (copy.status !== 0) throw new Blocked("Cannot prepare verified TLS certificate.");
    const env = { PGDATABASE: process.env.NQ_STAGING_READONLY_DB_URL, PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=120000", PGSSLROOTCERT: "/tmp/nq-staging-ca.pem" };
    const metadata = JSON.parse(docker(c, ["psql","-X","-qAt","-v","ON_ERROR_STOP=1"], metadataSql, "staging-metadata", env));
    writeFileSync(join(c.dir,"roles.sql"),rolesSql(metadata),{mode:0o600});
    writeFileSync(join(c.dir,"metadata.json"),JSON.stringify(metadata),{mode:0o600});
    const schema = docker(c, ["pg_dump","--schema-only","--format=plain","--lock-wait-timeout=10000"], undefined, "schema-export", env);
    writeFileSync(join(c.dir,"schema.sql"),schema,{mode:0o600});
    return;
  }
  if (mode !== "validate") throw new Blocked("Unknown mode.");
  if (process.env.NQ_STAGING_READONLY_DB_URL || process.env.PGDATABASE || process.env.PGHOST || process.env.PGSERVICE) throw new Blocked("Remove remote connection environment before local SQL writes.");
  const metadata = JSON.parse(readFileSync(join(c.dir,"metadata.json"),"utf8"));
  const available = JSON.parse(localSql(c,"SELECT json_agg(json_build_object('name',name,'version',version)) FROM pg_available_extension_versions;","extensions"));
  requireExtensions(metadata.extensions,available);
  const runtimeSql = "SELECT json_build_object('database',(SELECT json_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,'provider',to_jsonb(d)->>'datlocprovider','locale',to_jsonb(d)->>'datlocale','collation_version',to_jsonb(d)->>'datcollversion') FROM pg_database d WHERE datname=current_database()),'preload',json_build_object('shared_preload_libraries',current_setting('shared_preload_libraries'),'session_preload_libraries',current_setting('session_preload_libraries')));";
  compareRuntime(metadata,JSON.parse(localSql(c,runtimeSql,"runtime-properties")));
  localSql(c,readFileSync(join(c.dir,"roles.sql")),"roles-restore");
  localSql(c,readFileSync(join(c.dir,"schema.sql")),"schema-restore");
  const restoredExtensions = JSON.parse(localSql(c,"SELECT json_agg(json_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace;","restored-extensions"));
  compareExtensionState(metadata.extensions,restoredExtensions);
  const snapshotSql = readFileSync("supabase/security-test/postgres-clone-snapshot.sql","utf8");
  for (const migration of ["020_add_nullable_dashboard_fields.sql","021_restrict_dashboard_mutations.sql"]) {
    const sql = readFileSync("supabase/migrations/" + migration);
    localSql(c,sql,migration + "-first","postgres");
    const first = localSql(c,snapshotSql,migration + "-snapshot-first");
    localSql(c,sql,migration + "-second","postgres");
    const second = localSql(c,snapshotSql,migration + "-snapshot-second");
    if (first !== second) throw new Blocked("Catalog/privilege idempotency check failed.");
  }
  const final = localSql(c,snapshotSql,"final-snapshot");
  const summary = "PostgreSQL 17.11 faithful schema restore and 020/021 twice: passed. Source commit: " + process.env.GITHUB_SHA + ". Catalog fingerprint: " + createHash("sha256").update(final).digest("hex") + ". No staging writes; functional RLS/NFC acceptance still pending.\n";
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
  process.stdout.write(summary);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv[2]).catch((error) => { process.stderr.write("BLOCKED: " + (error instanceof Blocked ? error.message : "Unexpected local validation failure; provider output withheld.") + "\n"); process.exitCode = 1; });
}
