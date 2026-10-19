#!/usr/bin/env node
/**
 * Isolated staging acceptance fixture. Requires Node 20+ and no npm packages.
 * Creates only records carrying this fixture's deterministic IDs/slugs/source marker
 * and Auth users carrying the exact app_metadata marker. Cleanup runs only after a fully passing suite.
 *
 * Required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Required explicit guard: --project rxxbmqilnozcnpwguqga
 * Optional: --keep preserves only this fixture for manual follow-up; --cleanup removes it.
 */
import { createHash, randomBytes } from "node:crypto";

const PROJECT_REF = "rxxbmqilnozcnpwguqga";
const FIXTURE = "nq_central_acceptance_v1";
const SOURCE = "nq_central_acceptance_fixture_v1";
const EVENT_IDS = [991000001,991000002,991000003,991000004,992000001,992000002,992000003,992000004];
const REVIEW_IDS = [993000001,993000002];
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
async function request(url, { method = "GET", key = serviceKey, bearer = key, body, prefer, allowError = false, expectedStatus } = {}) {
  const headers = { apikey: key, Authorization: "Bearer " + bearer };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (expectedStatus && !expectedStatus.includes(response.status)) {
    throw new Error("Staging API request returned unexpected HTTP " + response.status + "; expected " + expectedStatus.join(" or ") + ".");
  }
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
    method: "POST", body: rows, prefer: "resolution=merge-duplicates,return=representation", expectedStatus: [200, 201],
  });
}
async function get(name, query, bearer = serviceKey) {
  const key = bearer === serviceKey ? serviceKey : anonKey;
  return request(table(name, query), { key, bearer, expectedStatus: [200] });
}
async function readRows(name, query, bearer = serviceKey) {
  const result = await get(name, query, bearer);
  if (!Array.isArray(result.data)) throw new Error("Expected row array from " + name + ".");
  return result.data;
}
async function remove(name, query) {
  const deleted = await request(table(name, query), { method: "DELETE", prefer: "return=representation", expectedStatus: [200] });
  if (!Array.isArray(deleted.data) || deleted.data.length !== 1) {
    throw new Error("CRITICAL: cleanup DELETE on " + name + " returned HTTP " + deleted.response.status + " but did not delete exactly one signature-matched row.");
  }
  const filters = query.split("&").filter((part) => !part.startsWith("select=")).join("&");
  const remaining = await readRows(name, "select=id" + (filters ? "&" + filters : ""));
  if (remaining.length) throw new Error("CRITICAL: cleanup of " + name + " returned HTTP " + deleted.response.status + " but matching rows remain.");
  return deleted.response.status;
}
async function listAuthUsers() {
  const users = [];
  const pageSize = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data } = await request(new URL("admin/users?page=" + page + "&per_page=" + pageSize, auth));
    if (!Array.isArray(data?.users)) throw new Error("Auth user listing returned an invalid response shape.");
    const batch = data.users;
    users.push(...batch);
    if (batch.length < pageSize) return users;
  }
  throw new Error("Auth fixture lookup reached its 50,000-user safety limit; refusing to assume deterministic emails are unused.");
}
async function ensureUser(label) {
  const email = emails[label];
  const users = await listAuthUsers();
  let user = users.find((candidate) => candidate.email?.toLowerCase() === email);
  const wasExisting = Boolean(user);
  const password = randomBytes(32).toString("base64url") + "aA1!";
  if (user) {
    if (user.app_metadata?.nq_central_fixture !== FIXTURE) {
      throw new Error("Fixture email is already used by an unmarked account; refusing to modify it.");
    }
    const { data } = await request(new URL("admin/users/" + encodeURIComponent(user.id), auth), {
      method: "PUT",
      body: { password, email_confirm: true, app_metadata: { ...(user.app_metadata || {}), nq_central_fixture: FIXTURE } },
      expectedStatus: [200, 201],
    });
    user = data?.user || data;
  } else {
    const { data } = await request(new URL("admin/users", auth), {
      method: "POST",
      body: { email, password, email_confirm: true, app_metadata: { nq_central_fixture: FIXTURE } },
      expectedStatus: [200, 201],
    });
    user = data?.user || data;
  }
  if (!user?.id) throw new Error("Auth fixture user creation failed.");
  const confirmed = await request(new URL("admin/users/" + encodeURIComponent(user.id), auth), { expectedStatus: [200] });
  const confirmedUser = confirmed.data?.user || confirmed.data;
  if (confirmedUser?.id !== user.id || confirmedUser?.email?.toLowerCase() !== email || confirmedUser?.app_metadata?.nq_central_fixture !== FIXTURE || !confirmedUser?.email_confirmed_at) {
    throw new Error("Auth fixture user final state does not match the exact fixture marker and confirmed identity.");
  }
  fixtureUserIds.add(user.id);
  const userName = label === "owner" ? "Fixture Owner" : "Fixture Viewer";
  const priorProfile = await readRows("app_profiles", "select=user_id,full_name,role,status,email&user_id=eq." + user.id);
  if (priorProfile.length > 1 || (priorProfile.length === 1 && (
      (wasExisting && (priorProfile[0].full_name !== userName || priorProfile[0].role !== "restaurant" || priorProfile[0].status !== "approved" || priorProfile[0].email?.toLowerCase() !== email)) ||
      (!wasExisting && (priorProfile[0].role !== "restaurant" || !["pending","approved"].includes(priorProfile[0].status) || priorProfile[0].email?.toLowerCase() !== email)))) {
    throw new Error("Fixture profile precondition mismatch; refusing to overwrite a changed or unrelated profile.");
  }
  await upsert("app_profiles", [{
    user_id: user.id, full_name: userName, role: "restaurant", status: "approved", email,
  }], "user_id");
  const profile = await readRows("app_profiles", "select=user_id,full_name,role,status,email&user_id=eq." + user.id);
  if (profile.length !== 1 || profile[0].full_name !== userName || profile[0].role !== "restaurant" || profile[0].status !== "approved" || profile[0].email?.toLowerCase() !== email) {
    throw new Error("Auth fixture profile final state does not match the requested setup.");
  }
  credentials.set(label, { email, password, id: user.id });
  return user.id;
}
async function signIn(label) {
  const item = credentials.get(label);
  const { data } = await request(new URL("token?grant_type=password", auth), {
    method: "POST", key: anonKey, bearer: anonKey, body: { email: item.email, password: item.password },
  });
  if (!data?.access_token || data?.user?.id !== item.id) throw new Error("Fixture user sign-in failed.");
  const identity = await request(new URL("user", auth), { key: anonKey, bearer: data.access_token, expectedStatus: [200] });
  if (identity.data?.id !== item.id || identity.data?.email?.toLowerCase() !== item.email) throw new Error("Fixture sign-in identity verification failed.");
  return data.access_token;
}
function ownsCard(cardKey, tenant) {
  return cardKey.startsWith(tenant + "_");
}
function eventExpectation(id) {
  const index = EVENT_IDS.indexOf(Number(id));
  if (index < 0) return null;
  const tenant = index < 4 ? "a" : "b";
  const position = index % 4;
  const channel = position < 2 ? "nfc" : "qr";
  return {
    business_id: BUSINESS[tenant].id,
    event_type: channel === "nfc" ? "nfc_tap" : "qr_scan",
    card_id: CARD_IDS[tenant + "_" + channel],
  };
}
async function prepareBusinessRows() {
  for (const b of Object.values(BUSINESS)) {
    const existing = await readRows("app_businesses", "select=id,slug,name,status&id=eq." + b.id);
    const row = existing[0];
    if (row && (row.slug !== b.slug || row.name !== b.name || row.status !== "approved")) throw new Error("Fixture business ID or final state collides with a non-fixture/changed row.");
  }
  await upsert("app_businesses", Object.values(BUSINESS).map((b) => ({
    id: b.id, name: b.name, slug: b.slug, status: "approved",
  })), "id");
  const finalRows = await readRows("app_businesses", "select=id,slug,name,status&id=in.(" + Object.values(BUSINESS).map((b) => b.id).join(",") + ")");
  if (finalRows.length !== 2 || Object.values(BUSINESS).some((b) => !finalRows.some((r) => r.id === b.id && r.slug === b.slug && r.name === b.name && r.status === "approved"))) throw new Error("Business fixture setup final-state verification failed.");
}
async function prepareCards() {
  for (const [key, id] of Object.entries(CARD_IDS)) {
    const existing = await readRows("app_business_cards", "select=id,business_id,target_url,channel,status,archived_at&id=eq." + id);
    const row = existing[0];
    const tenant = key.startsWith("a_") ? "a" : "b";
    const expectedChannel = key.endsWith("_qr") ? "qr" : "nfc";
    const expectedStatus = key.endsWith("_paused") || key.endsWith("_archived") ? "paused" : "active";
    if (row && (row.business_id !== BUSINESS[tenant].id ||
        row.target_url !== "https://example.invalid/nq-fixture/" + tenant + "/" + key ||
        row.channel !== expectedChannel || row.status !== expectedStatus ||
        (key.endsWith("_archived") ? !Number.isFinite(Date.parse(row.archived_at)) : row.archived_at !== null))) {
      throw new Error("Fixture card full signature mismatch; refusing to overwrite it.");
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
  const finalRows = await readRows("app_business_cards", "select=id,business_id,target_url,channel,status,archived_at&id=in.(" + Object.values(CARD_IDS).join(",") + ")");
  if (finalRows.length !== 8 || rows.some((expected) => !finalRows.some((actual) => actual.id === expected.id && actual.business_id === expected.business_id && actual.target_url === expected.target_url && actual.channel === expected.channel && actual.status === expected.status && ((expected.archived_at === null && actual.archived_at === null) || (expected.archived_at !== null && Number.isFinite(Date.parse(actual.archived_at))))))) throw new Error("Card fixture setup final-state verification failed.");
}
async function prepareMembershipsAndTokens() {
  const ownerId = credentials.get("owner").id;
  const viewerId = credentials.get("viewer").id;
  const priorMembers = await readRows("app_business_members", "select=business_id,user_id,member_role&business_id=in.(" + BUSINESS.a.id + "," + BUSINESS.b.id + ")&user_id=in.(" + ownerId + "," + viewerId + ")");
  for (const row of priorMembers) {
    const expected = row.business_id === BUSINESS.a.id && row.user_id === ownerId ? "owner" :
      row.business_id === BUSINESS.b.id && row.user_id === viewerId ? "viewer" : null;
    if (!expected || row.member_role !== expected) throw new Error("Fixture membership signature mismatch; refusing to overwrite it.");
  }
  await upsert("app_business_members", [
    { business_id: BUSINESS.a.id, user_id: ownerId, member_role: "owner" },
    { business_id: BUSINESS.b.id, user_id: viewerId, member_role: "viewer" },
  ], "business_id,user_id");
  const memberships = await readRows("app_business_members", "select=business_id,user_id,member_role&business_id=in.(" + BUSINESS.a.id + "," + BUSINESS.b.id + ")&user_id=in.(" + ownerId + "," + viewerId + ")");
  if (memberships.length !== 2 || !memberships.some((m) => m.business_id === BUSINESS.a.id && m.user_id === ownerId && m.member_role === "owner") || !memberships.some((m) => m.business_id === BUSINESS.b.id && m.user_id === viewerId && m.member_role === "viewer")) throw new Error("Membership fixture setup final-state verification failed.");
  const priorTokens = await readRows("app_business_card_tokens", "select=card_id,token_hash,active,last_event_at&card_id=in.(" + Object.values(CARD_IDS).join(",") + ")");
  for (const row of priorTokens) {
    const key = cardById.get(row.card_id);
    if (!key || !/^[a-f0-9]{64}$/.test(row.token_hash) || row.active !== !key.endsWith("_archived") || row.last_event_at !== null) throw new Error("Fixture token signature mismatch; refusing to replace it.");
  }
  const tokens = Object.entries(CARD_IDS).map(([key, card_id]) => {
    const raw = randomToken();
    return { card_id, token_hash: digest(raw), active: !key.endsWith("_archived"), last_event_at: null };
  });
  await upsert("app_business_card_tokens", tokens, "card_id");
  const finalTokens = await readRows("app_business_card_tokens", "select=card_id,token_hash,active,last_event_at&card_id=in.(" + Object.values(CARD_IDS).join(",") + ")");
  if (finalTokens.length !== 8 || tokens.some((expected) => !finalTokens.some((actual) => actual.card_id === expected.card_id && actual.token_hash === expected.token_hash && actual.active === expected.active && actual.last_event_at === null))) throw new Error("Token fixture setup final-state verification failed.");
}
async function prepareEvents() {
  const businessIds = Object.values(BUSINESS).map((b) => b.id).join(",");
  const eventIds = EVENT_IDS.join(",");
  const oldEvents = await readRows("app_business_events", "select=id,business_id,event_type,card_id,source,device_type,created_at&id=in.(" + eventIds + ")");
  if (new Set(oldEvents.map((row) => Number(row.id))).size !== oldEvents.length) throw new Error("Fixture event IDs are duplicated; refusing cleanup.");
  for (const row of oldEvents) {
    const expected = eventExpectation(row.id);
    if (!expected || row.source !== SOURCE || row.business_id !== expected.business_id ||
        row.event_type !== expected.event_type || row.card_id !== expected.card_id || row.device_type !== "mobile" || !Number.isFinite(Date.parse(row.created_at))) {
      throw new Error("Fixture event ID collides with a row outside the exact fixture signature.");
    }
  }
  const oldReviews = await readRows("app_business_review_snapshots", "select=id,business_id,platform,review_count,source,captured_at&id=in.(" + REVIEW_IDS.join(",") + ")");
  if (new Set(oldReviews.map((row) => Number(row.id))).size !== oldReviews.length) throw new Error("Fixture review IDs are duplicated; refusing cleanup.");
  for (const row of oldReviews) {
    const index = REVIEW_IDS.indexOf(Number(row.id));
    if (index < 0 || row.business_id !== BUSINESS[index === 0 ? "a" : "b"].id || row.platform !== "Google apertura" || row.review_count !== 7 || row.source !== "manual" || !Number.isFinite(Date.parse(row.captured_at))) {
      throw new Error("Fixture review ID collides with a non-fixture row.");
    }
  }
  for (const row of oldEvents) {
    const expected = eventExpectation(row.id);
    await remove("app_business_events",
      "id=eq." + row.id + "&business_id=eq." + expected.business_id +
      "&source=eq." + encodeURIComponent(SOURCE) + "&event_type=eq." + expected.event_type +
      "&card_id=eq." + expected.card_id + "&device_type=eq.mobile&created_at=eq." + encodeURIComponent(row.created_at));
  }
  for (const row of oldReviews) {
    await remove("app_business_review_snapshots",
      "id=eq." + row.id + "&business_id=eq." + row.business_id +
      "&platform=eq." + encodeURIComponent(row.platform) + "&review_count=eq.7&source=eq.manual" +
      "&captured_at=eq." + encodeURIComponent(row.captured_at));
  }
  const now = Date.now();
  const rows = [];
  let eventIndex = 0;
  for (const tenant of ["a", "b"]) {
    for (const [event_type, cardKey, daysAgo] of [
      ["nfc_tap", tenant + "_nfc", 0], ["nfc_tap", tenant + "_nfc", 3],
      ["qr_scan", tenant + "_qr", 0], ["qr_scan", tenant + "_qr", 10],
    ]) {
      rows.push({
        id: EVENT_IDS[eventIndex++], business_id: BUSINESS[tenant].id, event_type,
        created_at: new Date(now - daysAgo * 86400000).toISOString(),
        source: SOURCE, device_type: "mobile", card_id: CARD_IDS[cardKey],
      });
    }
  }
  await request(table("app_business_events"), { method: "POST", body: rows, prefer: "return=minimal", expectedStatus: [201] });
  const seededEvents = await readRows("app_business_events", "select=id,business_id,event_type,card_id,source,device_type,created_at&id=in.(" + EVENT_IDS.join(",") + ")");
  if (seededEvents.length !== EVENT_IDS.length || rows.some((expected) => !seededEvents.some((actual) => actual.id === expected.id && actual.business_id === expected.business_id && actual.event_type === expected.event_type && actual.card_id === expected.card_id && actual.source === expected.source && actual.device_type === expected.device_type && Date.parse(actual.created_at) === Date.parse(expected.created_at)))) throw new Error("Event fixture setup final-state verification failed.");
  await request(table("app_business_review_snapshots"), {
    method: "POST",
    body: Object.values(BUSINESS).map((b, index) => ({ id: REVIEW_IDS[index], business_id: b.id, platform: "Google apertura", review_count: 7, captured_at: new Date(now).toISOString(), source: "manual" })),
    prefer: "return=minimal", expectedStatus: [201],
  });
  const seededReviews = await readRows("app_business_review_snapshots", "select=id,business_id,platform,review_count,source,captured_at&id=in.(" + REVIEW_IDS.join(",") + ")");
  if (seededReviews.length !== 2 || Object.values(BUSINESS).some((b, index) => !seededReviews.some((r) => r.id === REVIEW_IDS[index] && r.business_id === b.id && r.platform === "Google apertura" && r.review_count === 7 && r.source === "manual" && Number.isFinite(Date.parse(r.captured_at))))) throw new Error("Review fixture setup final-state verification failed.");
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
  const now = Date.now();
  const within = (row, days) => now - Date.parse(row.created_at) <= days * 86400000;
  const daily = mine.filter((row) => within(row, 1)).length;
  const weeklyNfc = mine.filter((row) => row.event_type === "nfc_tap" && within(row, 7)).length;
  const weeklyQr = mine.filter((row) => row.event_type === "qr_scan" && within(row, 7)).length;
  const monthly = mine.filter((row) => within(row, 30)).length;
  note(label + " reads own tenant events", mine.length === 4, "rows=" + mine.length);
  note(label + " cannot read the other tenant", !leaks, leaks ? "cross-business row exposed" : "no foreign rows");
  note(label + " sees known channel totals", nfc === 2 && qr === 2, "nfc=" + nfc + ", qr=" + qr);
  note(label + " daily total matches", daily === 2, "total=" + daily);
  note(label + " weekly NFC/QR totals match", weeklyNfc === 2 && weeklyQr === 1, "nfc=" + weeklyNfc + ", qr=" + weeklyQr);
  note(label + " monthly total matches", monthly === 4, "total=" + monthly);
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
async function checkReviewCapture(label, bearer, business, shouldSucceed) {
  const probeCount = 2_000_000_000 + (randomBytes(4).readUInt32BE(0) % 100_000_000);
  const businessId = business.id;
  const query = "select=id,business_id,platform,review_count,source,captured_at&business_id=eq." + businessId +
    "&platform=eq." + encodeURIComponent("Google apertura") +
    "&review_count=eq." + probeCount + "&source=eq.manual";
  const before = await readRows("app_business_review_snapshots", query);
  if (before.length !== 0) throw new Error("Review probe sentinel collides with existing data; refusing this isolated test.");
  let attempt;
  let verified = false;
  try {
    attempt = await request(table("app_business_review_snapshots"), {
      method: "POST", key: anonKey, bearer,
      body: [{ business_id: businessId, platform: "Google apertura", review_count: probeCount }],
      allowError: true, prefer: "return=representation",
      expectedStatus: [201, 400, 401, 403, 404, 409],
    });
    const rows = await readRows("app_business_review_snapshots", query);
    const exact = rows.every((row) => row.business_id === businessId &&
      row.platform === "Google apertura" && row.review_count === probeCount &&
      row.source === "manual" && Number.isFinite(Date.parse(row.captured_at)) && Number.isFinite(Number(row.id)));
    const outcome = shouldSucceed
      ? attempt.response.status === 201 && rows.length === 1 && exact
      : [400, 401, 403, 404, 409].includes(attempt.response.status) && rows.length === 0;
    verified = outcome;
    note(label, outcome, "HTTP " + attempt.response.status + "; matching rows=" + rows.length);
  } finally {
    // Clean only exact rows created with this isolated random sentinel. A mismatch aborts deletion.
    const created = await readRows("app_business_review_snapshots", query);
    for (const row of created) {
      if (row.business_id !== businessId || row.platform !== "Google apertura" ||
          row.review_count !== probeCount || row.source !== "manual" ||
          !Number.isFinite(Date.parse(row.captured_at)) || !Number.isFinite(Number(row.id))) {
        throw new Error("CRITICAL: review probe cleanup signature mismatch; no row was deleted.");
      }
    }
    for (const row of created) {
      await remove("app_business_review_snapshots",
        "id=eq." + encodeURIComponent(row.id) + "&business_id=eq." + businessId +
        "&platform=eq." + encodeURIComponent("Google apertura") + "&review_count=eq." + probeCount + "&source=eq.manual" +
        "&captured_at=eq." + encodeURIComponent(row.captured_at));
    }
    if (!verified) {
      const residual = await readRows("app_business_review_snapshots", query);
      if (residual.length) throw new Error("CRITICAL: failed review permission test left its exact probe row behind.");
    }
  }
}
async function restoreProfileAndVerify(userId, expected, reason) {
  const restored = await request(table("app_profiles", "user_id=eq." + userId), {
    method: "PATCH", body: expected, prefer: "return=minimal", expectedStatus: [200, 204],
  });
  const rows = await readRows("app_profiles", "select=user_id,role,status,full_name,email&user_id=eq." + userId);
  if (rows.length !== 1 || rows[0].role !== expected.role || rows[0].status !== expected.status ||
      rows[0].full_name !== expected.full_name || rows[0].email?.toLowerCase() !== expected.email.toLowerCase()) {
    throw new Error("CRITICAL: " + reason + " restoration failed after HTTP " + restored.response.status + "; final profile state mismatch.");
  }
}
async function checkSelfElevation(bearer, userId) {
  const before = await readRows("app_profiles", "select=user_id,role,status,full_name,email&user_id=eq." + userId);
  if (before.length !== 1 || before[0].role !== "restaurant" || before[0].status !== "approved") {
    throw new Error("Self-role test precondition failed; fixture profile is not the expected approved restaurant.");
  }
  const original = before[0];
  const attempt = await request(table("app_profiles", "user_id=eq." + userId), {
    method: "PATCH", key: anonKey, bearer, body: { role: "admin" }, allowError: true, prefer: "return=minimal",
  });
  let after = await readRows("app_profiles", "select=user_id,role,status,full_name,email&user_id=eq." + userId);
  if (after.length !== 1) throw new Error("Could not verify profile after self-role attempt.");
  if (after[0].role !== original.role || after[0].status !== original.status) {
    await restoreProfileAndVerify(userId, original, "self-role attempt");
    after = await readRows("app_profiles", "select=user_id,role,status,full_name,email&user_id=eq." + userId);
  }
  const denied = [400, 401, 403, 404].includes(attempt.response.status) &&
    after.length === 1 && after[0].role === original.role && after[0].status === original.status;
  note("user cannot self-assign administrator", denied, "HTTP " + attempt.response.status + "; role/status unchanged=" + (after[0]?.role === original.role && after[0]?.status === original.status));
}
async function checkSelfApproval(bearer, userId) {
  const before = await readRows("app_profiles", "select=user_id,role,status,full_name,email&user_id=eq." + userId);
  if (before.length !== 1 || before[0].role !== "restaurant" || before[0].status !== "approved") {
    throw new Error("Self-approval test precondition failed; fixture profile is not approved.");
  }
  const original = before[0];
  const changed = await request(table("app_profiles", "user_id=eq." + userId), {
    method: "PATCH", body: { status: "pending" }, prefer: "return=minimal", expectedStatus: [200, 204],
  });
  const pending = await readRows("app_profiles", "select=user_id,role,status,full_name,email&user_id=eq." + userId);
  if (pending.length !== 1 || pending[0].status !== "pending" || pending[0].role !== original.role) {
    throw new Error("Temporary approval-state change did not reach its verified pending state after HTTP " + changed.response.status + ".");
  }
  let attempt;
  let finalRows;
  try {
    attempt = await request(table("app_profiles", "user_id=eq." + userId), {
      method: "PATCH", key: anonKey, bearer, body: { status: "approved" }, allowError: true, prefer: "return=minimal",
    });
  } finally {
    await restoreProfileAndVerify(userId, original, "self-approval test");
    finalRows = await readRows("app_profiles", "select=user_id,role,status,full_name,email&user_id=eq." + userId);
  }
  const denied = !!attempt && [400, 401, 403, 404].includes(attempt.response.status) &&
    finalRows.length === 1 && finalRows[0].status === original.status && finalRows[0].role === original.role;
  note("user cannot self-approve", denied, "HTTP " + (attempt?.response.status ?? "no response") + "; original approved state restored and verified");
}
async function checkDirectWriteRejected(bearer) {
  const cardId = CARD_IDS.a_nfc;
  const before = await readRows("app_business_cards", "select=id,business_id,target_url,channel,status,archived_at&id=eq." + cardId);
  if (before.length !== 1 || before[0].business_id !== BUSINESS.a.id || before[0].channel !== "nfc" ||
      before[0].target_url !== "https://example.invalid/nq-fixture/a/a_nfc" || before[0].status !== "active" || before[0].archived_at !== null) {
    throw new Error("Direct card-write test precondition signature mismatch.");
  }
  const original = before[0];
  const attempt = await request(table("app_business_cards", "id=eq." + cardId), {
    method: "PATCH", key: anonKey, bearer, body: { status: "paused" }, allowError: true, prefer: "return=minimal",
  });
  let after = await readRows("app_business_cards", "select=id,business_id,target_url,channel,status,archived_at&id=eq." + cardId);
  const unchanged = after.length === 1 && after[0].business_id === original.business_id &&
    after[0].target_url === original.target_url && after[0].channel === original.channel &&
    after[0].status === original.status && after[0].archived_at === original.archived_at;
  if (!unchanged) {
    const restored = await request(table("app_business_cards", "id=eq." + cardId), {
      method: "PATCH", body: { status: original.status, archived_at: original.archived_at },
      prefer: "return=minimal", expectedStatus: [200, 204],
    });
    after = await readRows("app_business_cards", "select=id,business_id,target_url,channel,status,archived_at&id=eq." + cardId);
    if (after.length !== 1 || after[0].business_id !== original.business_id || after[0].target_url !== original.target_url ||
        after[0].channel !== original.channel || after[0].status !== original.status || after[0].archived_at !== original.archived_at) {
      throw new Error("CRITICAL: direct card-write restoration failed after HTTP " + restored.response.status + ".");
    }
  }
  const denied = [400, 401, 403, 404].includes(attempt.response.status) && unchanged;
  note("authenticated direct card write denied", denied, "HTTP " + attempt.response.status + "; card state unchanged=" + unchanged);
}
async function cleanup() {
  // Validate every candidate before the first DELETE. Any mismatch aborts the whole cleanup.
  const businessIds = Object.values(BUSINESS).map((b) => b.id).join(",");
  const cardIds = Object.values(CARD_IDS).join(",");
  const authUsers = await listAuthUsers();
  const ownedUsers = authUsers.filter((u) =>
    u.app_metadata?.nq_central_fixture === FIXTURE &&
    Object.values(emails).includes(u.email?.toLowerCase()));
  const userByLabel = new Map(ownedUsers.map((u) => [u.email.toLowerCase(), u]));
  const ownedIds = ownedUsers.map((u) => u.id);

  const existingBusinesses = await readRows("app_businesses", "select=id,slug,name,status&id=in.(" + businessIds + ")");
  for (const row of existingBusinesses) {
    const expected = Object.values(BUSINESS).find((item) => item.id === row.id);
    if (!expected || row.slug !== expected.slug || row.name !== expected.name || row.status !== "approved") {
      throw new Error("Cleanup stopped: business signature mismatch; no rows were deleted.");
    }
  }

  const existingCards = await readRows("app_business_cards", "select=id,business_id,target_url,channel,status,archived_at&id=in.(" + cardIds + ")");
  for (const row of existingCards) {
    const cardKey = cardById.get(row.id);
    const tenant = cardKey?.startsWith("a_") ? "a" : "b";
    const expectedChannel = cardKey?.endsWith("_qr") ? "qr" : "nfc";
    const expectedStatus = cardKey?.endsWith("_paused") || cardKey?.endsWith("_archived") ? "paused" : "active";
    if (!cardKey || row.business_id !== BUSINESS[tenant].id ||
        row.target_url !== "https://example.invalid/nq-fixture/" + tenant + "/" + cardKey ||
        row.channel !== expectedChannel || row.status !== expectedStatus ||
        (cardKey.endsWith("_archived") ? !Number.isFinite(Date.parse(row.archived_at)) : row.archived_at !== null)) {
      throw new Error("Cleanup stopped: card signature mismatch; no rows were deleted.");
    }
  }

  const existingTokens = await readRows("app_business_card_tokens", "select=card_id,token_hash,active,last_event_at&card_id=in.(" + cardIds + ")");
  for (const row of existingTokens) {
    const cardKey = cardById.get(row.card_id);
    if (!cardKey || !/^[a-f0-9]{64}$/.test(row.token_hash) ||
        row.active !== !cardKey.endsWith("_archived") || row.last_event_at !== null) {
      throw new Error("Cleanup stopped: token signature mismatch; no rows were deleted.");
    }
  }

  const oldEvents = await readRows("app_business_events", "select=id,business_id,event_type,card_id,source,device_type,created_at&id=in.(" + EVENT_IDS.join(",") + ")");
  const eventCounts = new Map();
  for (const row of oldEvents) {
    const expected = eventExpectation(row.id);
    if (!expected || row.source !== SOURCE || row.business_id !== expected.business_id ||
        row.event_type !== expected.event_type || row.card_id !== expected.card_id ||
        row.device_type !== "mobile" || !Number.isFinite(Date.parse(row.created_at))) {
      throw new Error("Cleanup stopped: event full signature mismatch; no rows were deleted.");
    }
    eventCounts.set(Number(row.id), (eventCounts.get(Number(row.id)) || 0) + 1);
  }
  for (const [id, count] of eventCounts) {
    if (count !== 1) throw new Error("Cleanup stopped: duplicate fixture event ID signature; no rows were deleted.");
  }

  const oldReviews = await readRows("app_business_review_snapshots", "select=id,business_id,platform,review_count,source,captured_at&id=in.(" + REVIEW_IDS.join(",") + ")");
  for (const row of oldReviews) {
    const index = REVIEW_IDS.indexOf(Number(row.id));
    if (index < 0 || row.business_id !== BUSINESS[index === 0 ? "a" : "b"].id ||
        row.platform !== "Google apertura" || row.review_count !== 7 || row.source !== "manual" ||
        !Number.isFinite(Date.parse(row.captured_at))) {
      throw new Error("Cleanup stopped: review full signature mismatch; no rows were deleted.");
    }
  }

  const memberships = ownedIds.length
    ? await readRows("app_business_members", "select=business_id,user_id,member_role&business_id=in.(" + businessIds + ")&user_id=in.(" + ownedIds.join(",") + ")")
    : [];
  for (const row of memberships) {
    const owner = userByLabel.get(emails.owner);
    const viewer = userByLabel.get(emails.viewer);
    const valid = (row.business_id === BUSINESS.a.id && row.member_role === "owner" && row.user_id === owner?.id) ||
      (row.business_id === BUSINESS.b.id && row.member_role === "viewer" && row.user_id === viewer?.id);
    if (!valid) throw new Error("Cleanup stopped: membership signature mismatch; no rows were deleted.");
  }

  const profiles = ownedIds.length
    ? await readRows("app_profiles", "select=user_id,email,full_name,role,status&user_id=in.(" + ownedIds.join(",") + ")")
    : [];
  for (const row of profiles) {
    const entry = Object.entries(emails).find(([, email]) => email.toLowerCase() === row.email?.toLowerCase());
    const expectedName = entry?.[0] === "owner" ? "Fixture Owner" : "Fixture Viewer";
    const authUser = entry ? userByLabel.get(entry[1]) : null;
    if (!entry || !authUser || row.user_id !== authUser.id || row.full_name !== expectedName ||
        row.role !== "restaurant" || row.status !== "approved") {
      throw new Error("Cleanup stopped: profile signature mismatch; no rows were deleted.");
    }
  }

  for (const row of oldEvents) {
    const expected = eventExpectation(row.id);
    await remove("app_business_events",
      "id=eq." + row.id + "&business_id=eq." + expected.business_id +
      "&source=eq." + encodeURIComponent(SOURCE) + "&event_type=eq." + expected.event_type +
      "&card_id=eq." + expected.card_id + "&device_type=eq.mobile&created_at=eq." + encodeURIComponent(row.created_at));
  }
  for (const row of oldReviews) {
    await remove("app_business_review_snapshots",
      "id=eq." + row.id + "&business_id=eq." + row.business_id +
      "&platform=eq." + encodeURIComponent(row.platform) + "&review_count=eq.7&source=eq.manual" +
      "&captured_at=eq." + encodeURIComponent(row.captured_at));
  }
  for (const row of existingTokens) {
    await remove("app_business_card_tokens", "card_id=eq." + row.card_id +
      "&token_hash=eq." + row.token_hash + "&active=eq." + row.active + "&last_event_at=is.null");
  }
  for (const row of existingCards) {
    const filters = "id=eq." + row.id + "&business_id=eq." + row.business_id +
      "&target_url=eq." + encodeURIComponent(row.target_url) + "&channel=eq." + row.channel +
      "&status=eq." + row.status + (row.archived_at === null ? "&archived_at=is.null" : "&archived_at=eq." + encodeURIComponent(row.archived_at));
    await remove("app_business_cards", filters);
  }
  for (const row of memberships) {
    await remove("app_business_members", "business_id=eq." + row.business_id +
      "&user_id=eq." + row.user_id + "&member_role=eq." + row.member_role);
  }
  for (const row of profiles) {
    await remove("app_profiles", "user_id=eq." + row.user_id + "&email=eq." + encodeURIComponent(row.email) +
      "&full_name=eq." + encodeURIComponent(row.full_name) + "&role=eq.restaurant&status=eq.approved");
  }
  for (const row of existingBusinesses) {
    await remove("app_businesses", "id=eq." + row.id + "&slug=eq." + encodeURIComponent(row.slug) +
      "&name=eq." + encodeURIComponent(row.name) + "&status=eq.approved");
  }
  for (const user of ownedUsers) {
    const current = await request(new URL("admin/users/" + encodeURIComponent(user.id), auth), { expectedStatus: [200] });
    const currentUser = current.data?.user || current.data;
    if (currentUser?.id !== user.id || currentUser?.email?.toLowerCase() !== user.email?.toLowerCase() ||
        currentUser?.app_metadata?.nq_central_fixture !== FIXTURE) {
      throw new Error("Cleanup stopped: Auth user marker changed before deletion.");
    }
    const deleted = await request(new URL("admin/users/" + encodeURIComponent(user.id), auth), {
      method: "DELETE", expectedStatus: [200, 204],
    });
    const remaining = await listAuthUsers();
    if (remaining.some((candidate) => candidate.id === user.id)) {
      throw new Error("CRITICAL: Auth fixture user cleanup returned HTTP " + deleted.response.status + " but the user remains.");
    }
  }
}
async function main() {
  if (cleanupOnly) {
    try {
      await cleanup();
      process.stdout.write("Fixture cleanup completed; HTTP responses and final absence were verified for every exact signature.\n");
    } catch (error) {
      process.stderr.write("CRITICAL cleanup failure: " + (error instanceof Error ? error.message : "unknown error") + "\n");
      process.exitCode = 1;
    }
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
    await checkReviewCapture("owner can capture reviews for own business", ownerToken, BUSINESS.a, true);
    await checkReviewCapture("viewer role cannot capture reviews for own business", viewerToken, BUSINESS.b, false);
    await checkReviewCapture("owner cannot capture reviews for another business", ownerToken, BUSINESS.b, false);
    await checkSelfElevation(ownerToken, credentials.get("owner").id);
    await checkSelfApproval(viewerToken, credentials.get("viewer").id);
    await checkDirectWriteRejected(ownerToken);
    const allPassed = outcomes.every((item) => item.ok);
    process.stdout.write("BLOCKED product token/gateway/card lifecycle: product Edge Functions and Worker are not part of this fixture run.\n");
    process.stdout.write("BLOCKED durable replay/idempotency and frequency limits: no deployed product registration path is available to exercise.\n");
    process.stdout.write("Integration results are limited to the staging REST/RLS checks above; NFC/QR end-to-end remains pending.\n");
    if (!allPassed) {
      process.stderr.write("CRITICAL: one or more acceptance assertions failed; the fixture is preserved and no broad cleanup was started. Inspect signatures before a separately authorized --cleanup run.\n");
      process.exitCode = 1;
      return;
    }
    if (!keep) {
      try {
        await cleanup();
        process.stdout.write("Fixture cleanup completed after passing assertions; every DELETE and final absence was verified.\n");
      } catch (error) {
        process.stderr.write("CRITICAL cleanup/restoration failure: " + (error instanceof Error ? error.message : "unknown error") + "\n");
        process.exitCode = 1;
      }
    }
  } catch (error) {
    process.stderr.write("Fixture run stopped safely: " + (error instanceof Error ? error.message : "unknown error") + "\n");
    process.stderr.write("CRITICAL: automatic cleanup is disabled after any setup/test failure; preserve the fixture and inspect exact signatures before using --cleanup.\n");
    process.exitCode = 1;
  }
}
await main();
