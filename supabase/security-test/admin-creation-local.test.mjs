// Local handler contract tests. Supabase is replaced by an in-memory client;
// these tests do not execute SQL, prove RLS, or contact a deployed function.
// Requires Node 22.13+ (node:module stripTypeScriptTypes).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { Script } from "node:vm";

const source = await readFile("supabase/functions/manage-business-administration/index.ts", "utf8");
const javascript = stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, ""));
const businessId = "11111111-1111-4111-8111-111111111111";
const generatedId = "22222222-2222-4222-8222-222222222222";

function handlerFor({ profile = { role: "admin", status: "approved" }, databaseError = false } = {}) {
  const inserts = [];
  let handler;
  const admin = {
    from(table) {
      let payload;
      const query = {
        select() { return query; },
        eq() { return query; },
        insert(value) { payload = value; inserts.push({ table, payload: value }); return query; },
        async maybeSingle() {
          return { data: table === "app_profiles" ? profile : { status: "approved" }, error: null };
        },
        async single() {
          // Staging has NOT NULL UUID keys without defaults. Model that
          // documented contract, rather than silently generating a missing ID.
          return databaseError || !payload?.id
            ? { data: null, error: { code: "23502" } }
            : { data: { id: payload.id }, error: null };
        },
      };
      return query;
    },
  };
  const env = {
    NQ_ADMIN_ALLOWED_ORIGINS: "https://unit.invalid",
    SUPABASE_URL: "https://unit.invalid",
    SUPABASE_ANON_KEY: "unit-client-placeholder",
    SUPABASE_SERVICE_ROLE_KEY: "unit-server-placeholder",
  };
  new Script(javascript, { filename: "manage-business-administration.local.js" }).runInNewContext({
    Deno: { env: { get: (name) => env[name] }, serve: (callback) => { handler = callback; } },
    createClient: (_url, key) => key === env.SUPABASE_ANON_KEY
      ? { auth: { getUser: async () => ({ data: { user: { id: businessId } }, error: null }) } }
      : admin,
    Request, Response, URL, TextDecoder, Uint8Array,
    crypto: { randomUUID: () => generatedId },
  });
  return {
    inserts,
    async invoke(body) {
      const response = await handler(new Request("https://unit.invalid/admin", {
        method: "POST",
        headers: { origin: "https://unit.invalid", authorization: "Bearer unit-user-placeholder", "content-type": "application/json" },
        body: JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

const businessInput = { action: "business_create", name: "Local test", slug: "local-test", category: "restaurant" };
const cardInput = { action: "card_create", business_id: businessId, channel: "nfc", label: "Local card", target_url: "https://example.invalid/card" };

test("business creation supplies a server UUID without a database default", async () => {
  const fixture = handlerFor();
  const result = await fixture.invoke(businessInput);
  assert.equal(result.status, 201);
  assert.equal(result.body.id, generatedId);
  assert.equal(fixture.inserts[0].table, "app_businesses");
  assert.equal(fixture.inserts[0].payload.id, generatedId);
});

test("card creation supplies a server UUID and preserves the approved business", async () => {
  const fixture = handlerFor();
  const result = await fixture.invoke(cardInput);
  assert.equal(result.status, 201);
  assert.equal(result.body.id, generatedId);
  assert.equal(fixture.inserts[0].table, "app_business_cards");
  assert.equal(fixture.inserts[0].payload.id, generatedId);
  assert.equal(fixture.inserts[0].payload.business_id, businessId);
  assert.equal(fixture.inserts[0].payload.channel, "nfc");
});

test("creation rejects caller-supplied primary keys", async () => {
  for (const input of [businessInput, cardInput]) {
    const fixture = handlerFor();
    const result = await fixture.invoke({ ...input, id: generatedId });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "unexpected_field");
    assert.equal(fixture.inserts.length, 0);
  }
});

test("unapproved or non-admin profiles cannot reach creation writes", async () => {
  for (const profile of [{ role: "restaurant", status: "approved" }, { role: "admin", status: "pending" }]) {
    const fixture = handlerFor({ profile });
    const result = await fixture.invoke(businessInput);
    assert.equal(result.status, 403);
    assert.equal(fixture.inserts.length, 0);
  }
});

test("database insert failures are not reported as creation successes", async () => {
  for (const input of [businessInput, cardInput]) {
    const fixture = handlerFor({ databaseError: true });
    const result = await fixture.invoke(input);
    assert.equal(result.status, 409);
    assert.equal(result.body.ok, undefined);
  }
});

test("streamed administrative bodies over 8192 bytes return HTTP 413", async () => {
  const fixture = handlerFor();
  const result = await fixture.invoke({ action: "dashboard", padding: "x".repeat(8193) });
  assert.equal(result.status, 413);
  assert.equal(result.body.error, "request_too_large");
  assert.equal(fixture.inserts.length, 0);
});


test("every administrative action denies unapproved and non-admin users before data access", async () => {
  for (const action of ["dashboard","profiles","business_create","business_update","business_status","profile_status","member_upsert","card_create","card_update","cards"]) {
    for (const profile of [{role:"restaurant",status:"approved"},{role:"admin",status:"pending"}]) {
      const f=handlerFor({profile});const result=await f.invoke({action});
      assert.equal(result.status,403,action);assert.equal(f.inserts.length,0);
    }
  }
});

test("self-approval and role promotion are rejected by the real admin handler", async () => {
  const f=handlerFor();
  assert.equal((await f.invoke({action:"profile_status",user_id:businessId,status:"approved"})).status,400);
  assert.equal((await f.invoke({action:"profile_status",user_id:generatedId,status:"approved",role:"admin"})).status,400);
});

function reader() {
  const context={};new Script(javascript.slice(0,javascript.indexOf("Deno.serve"))).runInNewContext(context);
  return context.readAllRows;
}
test("administrative reads do not truncate when the API cap is below 1000", async () => {
  const all=Array.from({length:1201},(_,id)=>({id}));const offsets=[];
  const rows=await reader()(async from=>{offsets.push(from);return{data:all.slice(from,from+200),count:all.length,error:null}});
  assert.equal(rows.length,1201);assert.deepEqual(offsets,[0,200,400,600,800,1000,1200]);
});
test("administrative reads reject missing counts, truncation, duplicates and count changes",async()=>{
  for(const response of [{data:[],count:2},{data:[{id:1}],count:null},{data:[{id:1},{id:1}],count:2},{data:[],count:50001}]) await assert.rejects(reader()(async()=>response));
  let page=0;await assert.rejects(reader()(async()=>++page===1?{data:[{id:1}],count:2}:{data:[{id:2}],count:3}));
});
