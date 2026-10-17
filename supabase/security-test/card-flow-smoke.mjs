import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("card.html", "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(match, "card.html must contain an inline scanner script");
const source = match[1].replace(/\nrun\(\);\s*$/, "\nglobalThis.__runPromise = run();");
assert.notEqual(source, match[1], "test harness must capture the scanner promise");

const CARD_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(64);
const TARGET = "https://maps.google.com/?cid=test";

async function runCase({ search = "?id=" + CARD_ID, hash = "#token=" + TOKEN, responses = [] } = {}) {
  const elements = {
    title: { textContent: "" },
    message: { textContent: "" },
    manual: { hidden: true },
    target: { href: "" },
  };
  const calls = [];
  const historyCalls = [];
  const location = {
    pathname: "/card.html",
    search,
    hash,
    redirects: [],
    replace(url) { this.redirects.push(url); },
  };
  const context = {
    URLSearchParams,
    encodeURIComponent,
    navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155 Safari/537.36" },
    document: { getElementById: (id) => elements[id] },
    location,
    history: {
      replaceState(_state, _title, url) {
        historyCalls.push(url);
        const parsed = new URL(url, "https://example.test");
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.hash = parsed.hash;
      },
    },
    console: { error() {} },
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const next = responses.shift();
      if (!next) throw new Error("Unexpected fetch call");
      return { ok: next.ok, status: next.status || (next.ok ? 200 : 400), json: async () => next.body };
    },
  };
  vm.runInNewContext(source, context, { timeout: 1000 });
  await context.__runPromise;
  return { elements, calls, historyCalls, location };
}

const valid = await runCase({
  responses: [
    { ok: true, body: [{ id: CARD_ID, business_id: "business-test", channel: "nfc", target_url: TARGET, status: "active", archived_at: null }] },
    { ok: true, body: { ok: true } },
  ],
});
assert.equal(valid.historyCalls.length, 1, "valid token URL must be scrubbed");
assert.equal(valid.location.hash, "", "token fragment must be removed from the address");
assert.equal(valid.calls.length, 2, "valid scan must read card metadata and call the event endpoint");
assert.match(valid.calls[1].url, /functions\/v1\/register-business-card-event$/);
assert.equal(JSON.parse(valid.calls[1].options.body).token, TOKEN, "raw token must be sent only in the POST body");
assert.deepEqual(valid.location.redirects, [TARGET], "valid scan must redirect to the stored destination");

const malformed = await runCase({ hash: "#token=not-a-token", responses: [] });
assert.equal(malformed.calls.length, 0, "malformed token must not call Supabase");
assert.equal(malformed.location.redirects.length, 0, "malformed token must not redirect");
assert.match(malformed.elements.message.textContent, /credencial válida/);

const paused = await runCase({
  responses: [
    { ok: true, body: [{ id: CARD_ID, target_url: TARGET, status: "paused", archived_at: null }] },
  ],
});
assert.equal(paused.historyCalls.length, 1);
assert.equal(paused.calls.length, 1, "paused card must not register an event");
assert.equal(paused.location.redirects.length, 0, "paused card must not redirect");

const invalidToken = await runCase({
  responses: [
    { ok: true, body: [{ id: CARD_ID, target_url: TARGET, status: "active", archived_at: null }] },
    { ok: true, body: { ok: false, error: "invalid_card" } },
  ],
});
assert.equal(invalidToken.location.redirects.length, 0, "revoked/invalid token must fail closed");
assert.match(invalidToken.elements.message.textContent, /no es válida/);

const rateLimited = await runCase({
  responses: [
    { ok: true, body: [{ id: CARD_ID, target_url: TARGET, status: "active", archived_at: null }] },
    { ok: false, status: 429, body: { ok: false, error: "rate_limited" } },
  ],
});
assert.deepEqual(rateLimited.location.redirects, [TARGET], "rate limiting should not prevent a valid card from opening its destination");

console.log("Card scanner behavior tests passed: valid, malformed, paused, invalid/revoked, and rate-limited flows.");
