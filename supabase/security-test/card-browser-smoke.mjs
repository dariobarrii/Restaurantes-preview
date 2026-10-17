import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const html = await readFile(new URL("../../card.html", import.meta.url), "utf8");
const cardId = "33333333-3333-4333-8333-333333333333";
const validToken = "a".repeat(64);
const rotatedToken = "b".repeat(64);
const targetUrl = "https://example.com/test-destination";
const supabaseHost = "https://qcvhxrudzjlgqlhvnkkl.supabase.co";

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const localUrl = `http://127.0.0.1:${address.port}/card.html`;
const browser = await chromium.launch({ headless: true });

async function runScenario({ name, incomingToken, cardStatus = "active", currentToken = validToken, functionResult = { status: 200, body: { ok: true } }, expectedRedirect, expectNoFunction = false }) {
  const page = await browser.newPage();
  let functionCalls = 0;
  let sawFragmentRemovedBeforeNetwork = false;
  await page.route(`${supabaseHost}/**`, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 200, headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "apikey, authorization, content-type, x-client-info",
      }, body: "ok" });
      return;
    }
    if (url.includes("/rest/v1/app_business_cards")) {
      sawFragmentRemovedBeforeNetwork = await page.evaluate(() => location.hash === "");
      const cards = [{ id: cardId, business_id: "22222222-2222-4222-8222-222222222222", channel: "nfc", target_url: targetUrl, status: cardStatus, archived_at: cardStatus === "paused" ? "2026-10-01T00:00:00Z" : null }];
      await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(cards) });
      return;
    }
    if (url.includes("/functions/v1/register-business-card-event")) {
      functionCalls += 1;
      const body = request.postDataJSON();
      assert.equal(body.card_id, cardId, `${name}: correct card id`);
      assert.equal(body.token, incomingToken, `${name}: token passed to function`);
      assert.equal(await page.evaluate(() => location.hash), "", `${name}: token fragment removed before event request`);
      let response = functionResult;
      if (incomingToken !== currentToken) response = { status: 200, body: { ok: false, error: "invalid_card" } };
      await route.fulfill({ status: response.status, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(response.body) });
      return;
    }
    await route.fulfill({ status: 404, body: "not found" });
  });
  await page.route("https://example.com/**", async (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Destination reached</title>" }));

  await page.goto(`${localUrl}?id=${cardId}#token=${incomingToken}`);
  if (expectedRedirect) {
    await page.waitForURL(targetUrl, { timeout: 5000 });
    assert.equal(page.url(), targetUrl, `${name}: destination`);
    assert.equal(sawFragmentRemovedBeforeNetwork, true, `${name}: fragment removed before first API call`);
  } else {
    await page.getByText(/Esta tarjeta está pausada|Esta credencial fue pausada|No pudimos verificar la tarjeta/).waitFor({ timeout: 5000 });
    assert.notEqual(page.url(), targetUrl, `${name}: must not redirect`);
  }
  if (expectNoFunction) assert.equal(functionCalls, 0, `${name}: must not call registration function`);
  if (expectedRedirect) assert.equal(functionCalls, 1, `${name}: exactly one registration request`);
  await page.close();
}

try {
  await runScenario({ name: "valid token", incomingToken: validToken, expectedRedirect: true });
  await runScenario({ name: "rotated old token rejected", incomingToken: validToken, currentToken: rotatedToken, expectedRedirect: false });
  await runScenario({ name: "rotated new token accepted", incomingToken: rotatedToken, currentToken: rotatedToken, expectedRedirect: true });
  await runScenario({ name: "paused card rejected", incomingToken: validToken, cardStatus: "paused", expectedRedirect: false, expectNoFunction: true });
  await runScenario({ name: "revoked token rejected", incomingToken: validToken, functionResult: { status: 200, body: { ok: false, error: "invalid_card" } }, currentToken: rotatedToken, expectedRedirect: false });
  await runScenario({ name: "global limit fails closed", incomingToken: validToken, functionResult: { status: 429, body: { ok: false, error: "global_rate_limited" } }, expectedRedirect: false });
  await runScenario({ name: "validated card cooldown can redirect", incomingToken: validToken, functionResult: { status: 200, body: { ok: false, error: "rate_limited" } }, expectedRedirect: true });
  console.log("Browser smoke tests passed: fragment removal, destination redirect, token rotation/revocation, paused card, and rate-limit fail-closed behavior.");
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
