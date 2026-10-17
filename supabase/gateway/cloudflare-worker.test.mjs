import test from "node:test";
import assert from "node:assert/strict";
import worker from "./cloudflare-worker.js";

function env(overrides = {}) {
  return {
    SUPABASE_FUNCTION_URL: "https://example.invalid/functions/v1/register-business-card-event",
    GATEWAY_SHARED_SECRET: "test-secret-only",
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

function request({ method = "POST", headers = {}, body = '{"card_id":"x"}' } = {}) {
  return new Request("https://gateway.example.test/events", {
    method,
    headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.10", ...headers },
    body: method === "POST" ? body : undefined,
  });
}

test("fails closed when gateway secrets or limiter are missing", async () => {
  const response = await worker.fetch(request(), env({ GATEWAY_SHARED_SECRET: "" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "gateway_not_configured");
});

test("rejects a request without edge-provided client identity", async () => {
  const req = request();
  req.headers.delete("CF-Connecting-IP");
  const response = await worker.fetch(req, env());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "client_identity_unavailable");
});

test("rejects a request when rate limiter blocks it and never calls origin", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("origin must not be called"); };
  try {
    const response = await worker.fetch(request(), env({ RATE_LIMITER: { limit: async () => ({ success: false }) } }));
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, "rate_limited");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("injects gateway secret itself and does not forward caller-supplied secret", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(request({ headers: { "x-nq-gateway-secret": "attacker-value" } }), env());
    assert.equal(response.status, 200);
    assert.equal(captured.headers.get("x-nq-gateway-secret"), "test-secret-only");
    assert.equal(captured.headers.get("CF-Connecting-IP"), null);
    assert.equal(await response.text(), '{"ok":true}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects disallowed origins when an allowlist is configured", async () => {
  const response = await worker.fetch(request({ headers: { origin: "https://evil.example" } }), env({ ALLOWED_ORIGINS: "https://app.example" }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "origin_not_allowed");
});

test("enforces request body size even without content-length", async () => {
  const body = "x".repeat(2049);
  const response = await worker.fetch(request({ body }), env());
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "request_too_large");
});
