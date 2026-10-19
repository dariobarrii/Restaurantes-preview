#!/usr/bin/env node
/**
 * Isolated staging acceptance fixture. Requires Node 20+ and no npm packages.
 * Creates only records carrying this fixture's deterministic IDs/slugs/source marker
 * and Auth users carrying the exact app_metadata marker. Default run cleans up in finally.
 *
 * Required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Required explicit guard: --project rxxbmqilnozcnpwguqga
 * Optional: --keep preserves only this fixture for manual follow-up; --cleanup removes it.
 */
import { createHash, randomBytes } from "node:crypto";

const PROJECT_REF = "rxxbmqilnozcnpwguqga";
const FIXTURE = "nq_central_acceptance_v1";
const SOURCE = "nq_central_acceptance_fixture_v1";
const BUSINESS = {
  a: { id: "a1000000-0000-4000-8000-000000000001", slug: "nq-test-fixture-a", name: "NQ Staging Fixture A" },
  b: { id: "b1000000-0000-4000-8000-000000000002", slug: "nq-test-fixture-b", name: "NQ Staging Fixture B" },
};
const CARD_IDS = {
  a_nfc: "a2000000-0000-4000-8000-000000000001", a_qr: "a2000000-0000-4000-8000-000000000002",
  a_paused: "a2000000-0000-4000-8000-000000000003", a_archived: "a2000000-0000-4000-8000-000000000004",
  b_nfc: "b2000000-0000-4000-8000-000000000001", b_qr: "b2000000-0000-4000-8000-000000000002",
  b_paused: "b2000000-0000-4000-8000-000000000003", b_archived: "b2000000-0000-4000-8000-000000000004",
};
const emails = {
  owner: "nq-central-fixture-owner@example.invalid",
  viewer: "nq-central-fixture-viewer@example.invalid",
};
const keep = process.argv.includes("--keep");
const cleanupOnly = process.argv.includes("--cleanup");
const projectArg = process.argv.indexOf("--project");
if (projectArg < 0 || process.argv[projectArg + 1] !== PROJECT_REF) {
  throw new Error("Refusing to run: pass the exact approved staging project with --project rxxbmqilnozcnpwguqga");
}
const rawUrl = process.env.SUPABASE_URL || "";
const anonKey = process.env.SUPABASE_ANON_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!rawUrl || !anonKey || !serviceKey) throw new Error("Set the staging URL, anon key, and service-role key in the local environment.");
const base = new URL(rawUrl);
if (base.protocol !== "https:" || base.hostname !== PROJECT_REF + ".supabase.co") {
  throw new Error("Refusing to run: SUPABASE_URL does not match the approved staging project.");
}
const rest = new URL("/rest/v1/", base);
const auth = new URL("/auth/v1/", base);

const outcomes = [];
const credentials = new Map();
const fixtureUserIds = new Set();
const cardById = new Map(Object.entries(CARD_IDS).map(([k, id]) => [id, k]));

function note(name, ok, detail) {
  outcomes.push({ name, ok, detail });
  process.stdout.write((ok ? "PASS " : "FAIL ") + name + (detail ? ": " + detail : "") + "\n");
}
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
function randomToken() {
  return randomBytes(32).toString("hex");
}
async function request(url, { method = "GET", key = serviceKey, bearer = key, body, prefer, allowError = false } = {}) {
  const headers = { apikey: key, Authorization: "Bearer " + bearer };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok && !allowError) {
    // Do not include provider response bodies; they may contain row or credential data.
    throw new Error("Staging API request failed (" + response.status + ").");
  }
  return { response, data };
}
function table(name, query = "") {
  const url = new URL(name, rest);
  if (query) url.search = query;
  return url;
}
async function upsert(name, rows, onConflict) {
  return request(table(name, "on_conflict=" + encodeURIComponent(onConflict)), {
    method: "POST", body: rows, prefer: "resolution=merge-duplicates,return=representation",
  });
}
async function remove(name, query) {
  await request(table(name, query), { method: "DELETE", prefer: "return=minimal" });
}
async function get(name, query, bearer = serviceKey) {
  return request(table(name, query), { bearer });
}
async function listAuthUsers() {
  const { data } = await request(new URL("admin/users?page=1&per_page=1000", auth));
  return Array.isArray(data?.users) ? data.users : [];
}
async function ensureUser(label) {
  const email = emails[label];
  const users = await listAuthUsers();
  let user = users.find((candidate) => candidate.email?.toLowerCase() === email);
  const password = randomBytes(32).toString("base64url") + "aA1!";
  if (user) {
    if (user.app_metadata?.nq_central_fixture !== FIXTURE) {
      throw new Error("Fixture email is already used by an unmarked account; refusing to modify it.");
    }
    const { data } = await request(new URL("admin/users/" + encodeURIComponent(user.id), auth), {
      method: "PUT",
      body: { password, email_confirm: true, app_metadata: { ...(user.app_metadata || {}), nq_central_fixture: FIXTURE } },
    });
    user = data?.user || data;
  } else {
    const { data } = await request(new URL("admin/users", auth), {
      method: "POST",
      body: { email, password, email_confirm: true, app_metadata: { nq_central_fixture: FIXTURE } },
    });
    user = data?.user || data;
  }
  if (!user?.id) throw new Error("Auth fixture user creation failed.");
  fixtureUserIds.add(user.id);
  const userName = label === "owner" ? "Fixture Owner" : "Fixture Viewer";
  await upsert("app_profiles", [{
    user_id: user.id, full_name: userName, role: "restaurant", status: "approved", email,
  }], "user_id");
  credentials.set(label, { email, password, id: user.id });
  return user.id;
}
async function signIn(label) {
  const item = credentials.get(label);
  const { data } = await request(new URL("token?grant_type=password", auth), {
    method: "POST", key: anonKey, bearer: anonKey, body: { email: item.email, password: item.password },
  });
  if (!data?.access_token) throw new Error("Fixture user sign-in failed.");
  return data.access_token;
}
function ownsCard(cardKey, tenant) {
  return cardKey.startsWith(tenant + "_");
}
async function prepareBusinessRows() {
  for (const b of Object.values(BUSINESS)) {
    const existing = await get("app_businesses", "select=id,slug,name&id=eq." + b.id);
    const row = existing.data?.[0];
    if (row && (row.slug !== b.slug || row.name !== b.name)) throw new Error("Fixture business ID collides with a non-fixture row.");
  }
  await upsert("app_businesses", Object.values(BUSINESS).map((b) => ({
    id: b.id, name: b.name, slug: b.slug, status: "approved",
  })), "id");
}
async function prepareCards() {
  for (const [key, id] of Object.entries(CARD_IDS)) {
    const existing = await get("app_business_cards", "select=id,business_id,target_url&id=eq." + id);
    const row = existing.data?.[0];
    const tenant = key.startsWith("a_") ? "a" : "b";
    if (row && (row.business_id !== BUSINESS[tenant].id || !String(row.target_url).includes("/nq-fixture/" + tenant + "/"))) {
      throw new Error("Fixture card ID collides with a non-fixture row.");
    }
  }
  const rows = Object.entries(CARD_IDS).map(([key, id]) => {
    const tenant = key.startsWith("a_") ? "a" : "b";
    const channel = key.endsWith("_qr") ? "qr" : "nfc";
    const status = key.endsWith("_paused") || key.endsWith("_archived") ? "paused" : "active";
    return {
      id, business_id: BUSINESS[tenant].id, channel,
      target_url: "https://example.invalid/nq-fixture/" + tenant + "/" + key,
      status, archived_at: key.endsWith("_archived") ? new Date().toISOString() : null,
    };
  });
  await upsert("app_business_cards", rows, "id");
}
async function prepareMembershipsAndTokens() {
  const ownerId = credentials.get("owner").id;
  const viewerId = credentials.get("viewer").id;
  await upsert("app_business_members", [
    { business_id: BUSINESS.a.id, user_id: ownerId, member_role: "owner" },
    { business_id: BUSINESS.b.id, user_id: viewerId, member_role: "viewer" },
  ], "business_id,user_id");
  const tokens = Object.entries(CARD_IDS).map(([key, card_id]) => {
    const raw = randomToken();
    return { card_id, token_hash: digest(raw), active: !key.endsWith("_archived"), last_event_at: null };
  });
  await upsert("app_business_card_tokens", tokens, "card_id");
}
async function prepareEvents() {
  const businessIds = Object.values(BUSINESS).map((b) => b.id).join(",");
  await remove("app_business_events",
    "business_id=in.(" + businessIds + ")&source=eq." + encodeURIComponent(SOURCE));
  await remove("app_business_review_snapshots", "business_id=in.(" + businessIds + ")&source=eq.manual");
  const now = Date.now();
  const rows = [];
  for (const tenant of ["a", "b"]) {
    for (const [event_type, cardKey, daysAgo] of [
      ["nfc_tap", tenant + "_nfc", 0], ["nfc_tap", tenant + "_nfc", 3],
      ["qr_scan", tenant + "_qr", 0], ["qr_scan", tenant + "_qr", 10],
    ]) {
      rows.push({
        business_id: BUSINESS[tenant].id, event_type,
        created_at: new Date(now - daysAgo * 86400000).toISOString(),
        source: SOURCE, device_type: "mobile", card_id: CARD_IDS[cardKey],
      });
    }
  }
  await request(table("app_business_events"), { method: "POST", body: rows, prefer: "return=minimal" });
  await request(table("app_business_review_snapshots"), {
    method: "POST",
    body: Object.values(BUSINESS).map((b) => ({ business_id: b.id, platform: "Google apertura", review_count: 7, captured_at: new Date(now).toISOString(), source: "manual" })),
    prefer: "return=minimal",
  });
}
async function inspectTenant(label, bearer, expectedBusiness, otherBusiness) {
  const result = await get("app_business_events", "select=business_id,event_type,created_at&order=created_at.asc", bearer);
  const rows = Array.isArray(result.data) ? result.data : [];
  if (!result.response.ok) {
    note(label + " can read tenant events", false, "HTTP " + result.response.status);
    return { rows: [], mine: [] };
  }
  const leaks = rows.some((row) => row.business_id === otherBusiness);
  const mine = rows.filter((row) => row.business_id === expectedBusiness);
  const nfc = mine.filter((row) => row.event_type === "nfc_tap").length;
  const qr = mine.filter((row) => row.event_type === "qr_scan").length;
  note(label + " reads own tenant events", mine.length === 4, "rows=" + mine.length);
  note(label + " cannot read the other tenant", !leaks, leaks ? "cross-business row exposed" : "no foreign rows");
  note(label + " sees known channel totals", nfc === 2 && qr === 2, "nfc=" + nfc + ", qr=" + qr);
  return { rows, mine };
}
async function checkReviewIsolation(bearer, expectedBusiness, otherBusiness, label) {
  const result = await get("app_business_review_snapshots", "select=business_id,platform,review_count&source=eq.manual", bearer);
  if (!result.response.ok) {
    note(label + " review snapshot access", false, "HTTP " + result.response.status);
    return;
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  note(label + " reads own review snapshot", rows.some((row) => row.business_id === expectedBusiness), "own business only expected");
  note(label + " cannot read foreign review snapshot", !rows.some((row) => row.business_id === otherBusiness), "foreign business not visible");
}
async function checkSelfElevation(bearer, userId) {
  const attempt = await request(table("app_profiles", "user_id=eq." + userId), {
    method: "PATCH", key: anonKey, bearer, body: { role: "admin" }, allowError: true, prefer: "return=minimal",
  });
  if (attempt.response.ok) {
    await request(table("app_profiles", "user_id=eq." + userId), { method: "PATCH", body: { role: "restaurant" }, prefer: "return=minimal" });
  }
  note("user cannot self-assign administrator", !attempt.response.ok, "HTTP " + attempt.response.status);
}
async function checkSelfApproval(bearer, userId) {
  await request(table("app_profiles", "user_id=eq." + userId), { method: "PATCH", body: { status: "pending" }, prefer: "return=minimal" });
  const attempt = await request(table("app_profiles", "user_id=eq." + userId), {
    method: "PATCH", key: anonKey, bearer, body: { status: "approved" }, allowError: true, prefer: "return=minimal",
  });
  await request(table("app_profiles", "user_id=eq." + userId), { method: "PATCH", body: { status: "approved" }, prefer: "return=minimal" });
  note("user cannot self-approve", !attempt.response.ok, "HTTP " + attempt.response.status);
}
async function checkDirectWriteRejected(bearer) {
  const cardId = CARD_IDS.a_nfc;
  const before = await get("app_business_cards", "select=id,status&id=eq." + cardId);
  const oldStatus = before.data?.[0]?.status || "active";
  const attempt = await request(table("app_business_cards", "id=eq." + cardId), {
    method: "PATCH", key: anonKey, bearer, body: { status: "paused" }, allowError: true,
    prefer: "return=minimal",
  });
  const denied = !attempt.response.ok;
  if (!denied) {
    // Undo only the exact fixture card, even when the assertion fails.
    await request(table("app_business_cards", "id=eq." + cardId), {
      method: "PATCH", body: { status: oldStatus }, prefer: "return=minimal",
    });
  }
  note("authenticated direct card write denied", denied, "HTTP " + attempt.response.status);
}
async function cleanup() {
  const businessIds = Object.values(BUSINESS).map((b) => b.id).join(",");
  const cardIds = Object.values(CARD_IDS).join(",");
  await remove("app_business_events", "business_id=in.(" + businessIds + ")&source=eq." + encodeURIComponent(SOURCE));
  await remove("app_business_review_snapshots", "business_id=in.(" + businessIds + ")&source=eq.manual");
  await remove("app_business_card_tokens", "card_id=in.(" + cardIds + ")");
  await remove("app_business_cards", "id=in.(" + cardIds + ")");
  const authUsers = await listAuthUsers();
  const ownedIds = authUsers.filter((u) => u.app_metadata?.nq_central_fixture === FIXTURE && Object.values(emails).includes(u.email?.toLowerCase())).map((u) => u.id);
  if (ownedIds.length) {
    const idFilter = ownedIds.join(",");
    await remove("app_business_members", "user_id=in.(" + idFilter + ")");
    await remove("app_profiles", "user_id=in.(" + idFilter + ")");
  }
  await remove("app_businesses", "id=in.(" + Object.values(BUSINESS).map((b) => b.id).join(",") + ")");
  for (const id of ownedIds) {
    await request(new URL("admin/users/" + encodeURIComponent(id), auth), { method: "DELETE" });
  }
}
async function main() {
  if (cleanupOnly) {
    await cleanup();
    process.stdout.write("Fixture cleanup completed for exact marker and IDs.\n");
    return;
  }
  try {
    await ensureUser("owner");
    await ensureUser("viewer");
    await prepareBusinessRows();
    await prepareCards();
    await prepareMembershipsAndTokens();
    await prepareEvents();
    const ownerToken = await signIn("owner");
    const viewerToken = await signIn("viewer");
    await inspectTenant("owner/business A", ownerToken, BUSINESS.a.id, BUSINESS.b.id);
    await inspectTenant("viewer/business B", viewerToken, BUSINESS.b.id, BUSINESS.a.id);
    await checkReviewIsolation(ownerToken, BUSINESS.a.id, BUSINESS.b.id, "owner");
    await checkReviewIsolation(viewerToken, BUSINESS.b.id, BUSINESS.a.id, "viewer");
    await checkSelfElevation(ownerToken, credentials.get("owner").id);
    await checkSelfApproval(viewerToken, credentials.get("viewer").id);
    await checkDirectWriteRejected(ownerToken);
    const allPassed = outcomes.every((item) => item.ok);
    note("product token/gateway flow", false, "pending: product Edge Functions and Worker are not part of this fixture run");
    process.stdout.write("Integration results are limited to the staging REST/RLS checks above; NFC/QR end-to-end remains pending.\n");
    if (!keep) await cleanup();
    if (!allPassed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write("Fixture run stopped safely: " + (error instanceof Error ? error.message : "unknown error") + "\n");
    process.exitCode = 1;
    if (!keep) {
      try { await cleanup(); }
      catch { process.stderr.write("Scoped cleanup also failed; use --cleanup after inspecting exact fixture markers.\n"); }
    }
  }
}
await main();
