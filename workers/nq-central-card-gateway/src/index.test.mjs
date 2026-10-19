import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.mjs";

const origin = "https://staging.example.invalid";
const upstream = "https://stage-project.supabase.co/functions/v1/register-business-card-event";
const makeEnv = (overrides = {}) => ({
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  SUPABASE_FUNCTION_URL: upstream,
  NQ_GATEWAY_SHARED_SECRET: "test-only-secret",
  ALLOWED_ORIGINS: origin,
  ...overrides,
});
const request = (ip = "192.0.2.10") => new Request("https://gateway.example.invalid/event", {
  method: "POST",
  headers: { origin, "CF-Connecting-IP": ip, "content-type": "application/json" },
  body: JSON.stringify({ card_id: "staging-card", token: "test-token", device_type: "mobile" }),
});

test("limits requests by a hashed Cloudflare client IP and forwards only after allowance", async () => {
  let key = "";
  let forwarded;
  const env = makeEnv({ RATE_LIMITER: { limit: async ({ key: value }) => { key = value; return { success: true }; } } });
  globalThis.fetch = async (url, init) => {
    forwarded = { url, init };
    return Response.json({ ok: true, target_url: "https://example.invalid/" });
  };
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.match(key, /^nq-card-client:[a-f0-9]{64}$/);
  assert.equal(key.includes("192.0.2.10"), false);
  assert.equal(forwarded.init.headers["x-nq-gateway-secret"], "test-only-secret");
  assert.equal(forwarded.init.headers["cf-connecting-ip"], undefined);
});

test("rejects a client over its limit without calling the event function", async () => {
  let called = false;
  const env = makeEnv({ RATE_LIMITER: { limit: async () => ({ success: false }) } });
  globalThis.fetch = async () => { called = true; return Response.json({ ok: true }); };
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 429);
  assert.equal(called, false);
});

test("uses separate keys for separate client IPs", async () => {
  const keys = [];
  const env = makeEnv({ RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: true }; } } });
  globalThis.fetch = async () => Response.json({ ok: true });
  await worker.fetch(request("192.0.2.10"), env);
  await worker.fetch(request("192.0.2.11"), env);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test("fails closed when client identity or limiter is unavailable", async () => {
  const noIp = await worker.fetch(request(""), makeEnv());
  assert.equal(noIp.status, 400);
  const unavailable = await worker.fetch(request(), makeEnv({
    RATE_LIMITER: { limit: async () => { throw new Error("offline"); } },
  }));
  assert.equal(unavailable.status, 503);
});

test("rejects unsafe or wrong upstream configuration", async () => {
  const response = await worker.fetch(request(), makeEnv({
    SUPABASE_FUNCTION_URL: "https://production.example.invalid/functions/v1/unrelated",
  }));
  assert.equal(response.status, 503);
});
