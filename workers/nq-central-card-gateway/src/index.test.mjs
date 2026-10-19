import test from "node:test";
import assert from "node:assert/strict";
import worker from "./index.mjs";

const origin = "https://staging.example.invalid";
const gatewaySecret = "test-only-secret";
const upstream = "https://stage-project.supabase.co/functions/v1/register-business-card-event";
const makeEnv = (overrides = {}) => ({
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  SUPABASE_FUNCTION_URL: upstream,
  STAGING_PROJECT_REF: "stage-project",
  NQ_GATEWAY_SHARED_SECRET: gatewaySecret,
  ALLOWED_ORIGINS: origin,
  ...overrides,
});
const request = (options = {}) => new Request("https://gateway.example.invalid/event", {
  method: options.method || "POST",
  headers: {
    origin: options.origin ?? origin,
    "CF-Connecting-IP": options.ip ?? "192.0.2.10",
    "content-type": options.contentType ?? "application/json",
    ...(options.headers || {}),
  },
  body: options.body ?? JSON.stringify({ card_id: "staging-card", token: "test-token", device_type: "mobile" }),
});

test("forwards only to configured staging and returns allowlisted public fields", async () => {
  let key = "";
  let forwarded;
  const env = makeEnv({ RATE_LIMITER: { limit: async ({ key: value }) => { key = value; return { success: true }; } } });
  globalThis.fetch = async (url, init) => {
    forwarded = { url, init };
    return Response.json({ ok: true, target_url: "https://example.invalid/", leaked: gatewaySecret });
  };
  const response = await worker.fetch(request(), env);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(key, /^nq-card-client:[a-f0-9]{64}$/);
  assert.equal(key.includes("192.0.2.10"), false);
  assert.equal(forwarded.url, upstream);
  assert.equal(forwarded.init.headers["x-nq-gateway-secret"], gatewaySecret);
  assert.equal(forwarded.init.headers["cf-connecting-ip"], undefined);
  assert.equal(body.includes(gatewaySecret), false);
  assert.equal(body.includes("leaked"), false);
  assert.equal(body.includes("target_url"), true);
});

test("rejects disallowed origin and non-POST methods", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({ ok: true }); };
  const badOrigin = await worker.fetch(request({ origin: "https://attacker.invalid" }), makeEnv());
  const method = await worker.fetch(request({ method: "PUT" }), makeEnv());
  assert.equal(badOrigin.status, 403);
  assert.equal(method.status, 405);
  assert.equal(called, false);
});

test("rejects wrong media type and oversized streamed body before forwarding", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({ ok: true }); };
  const media = await worker.fetch(request({ contentType: "text/plain" }), makeEnv());
  const large = await worker.fetch(request({ body: "x".repeat(2049) }), makeEnv());
  assert.equal(media.status, 415);
  assert.equal(large.status, 413);
  assert.equal(called, false);
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
  globalThis.fetch = async () => Response.json({ ok: true, target_url: "https://example.invalid/" });
  await worker.fetch(request({ ip: "192.0.2.10" }), env);
  await worker.fetch(request({ ip: "192.0.2.11" }), env);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test("fails closed when client identity or limiter is unavailable", async () => {
  const noIp = await worker.fetch(request({ ip: "" }), makeEnv());
  const unavailable = await worker.fetch(request(), makeEnv({
    RATE_LIMITER: { limit: async () => { throw new Error("offline"); } },
  }));
  assert.equal(noIp.status, 400);
  assert.equal(unavailable.status, 503);
});

test("rejects unsafe or non-staging upstream configuration", async () => {
  const wrongHost = await worker.fetch(request(), makeEnv({
    SUPABASE_FUNCTION_URL: "https://production.example.invalid/functions/v1/register-business-card-event",
  }));
  const wrongPath = await worker.fetch(request(), makeEnv({
    SUPABASE_FUNCTION_URL: "https://stage-project.supabase.co/functions/v1/other",
  }));
  assert.equal(wrongHost.status, 503);
  assert.equal(wrongPath.status, 503);
});

test("sanitizes malformed and unexpected upstream responses", async () => {
  globalThis.fetch = async () => Response.json({ ok: false, error: "private detail", secret: gatewaySecret });
  const response = await worker.fetch(request(), makeEnv());
  const body = await response.text();
  assert.equal(response.status, 400);
  assert.equal(body.includes(gatewaySecret), false);
  assert.equal(body.includes("private detail"), false);
  assert.equal(body.includes("event_registration_failed"), true);
});
