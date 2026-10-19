import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const categories = new Set(["restaurant","hair_salon","barbershop","beauty","gym","retail","clinic","cafe","other"]);
const statuses = new Set(["pending","approved","suspended"]);
const roles = new Set(["owner","manager","viewer"]);

class PayloadTooLargeError extends Error {}
class ResultLimitError extends Error {}
class AdminReadError extends Error {}

const ADMIN_PAGE_SIZE = 1000;
const MAX_ADMIN_RESULT_ROWS = 50000;

async function readAllRows(buildPage: (from: number, to: number) => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; from < MAX_ADMIN_RESULT_ROWS; from += ADMIN_PAGE_SIZE) {
    const to = Math.min(from + ADMIN_PAGE_SIZE - 1, MAX_ADMIN_RESULT_ROWS - 1);
    let result;
    try { result = await buildPage(from, to); }
    catch { throw new AdminReadError(); }
    const { data, error } = result;
    if (error) throw new AdminReadError();
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < ADMIN_PAGE_SIZE) return rows;
  }
  throw new ResultLimitError();
}

function safeTarget(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !/\s/.test(value) ? u.href : null;
  } catch { return null; }
}
function cleanOrigin(req: Request): string | null {
  const origin = req.headers.get("origin") || "";
  const configured = (Deno.env.get("NQ_ADMIN_ALLOWED_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean);
  return configured.includes(origin) ? origin : null;
}
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get("content-length") || "0");
  if (length > 8192) throw new PayloadTooLargeError();
  const reader = req.body?.getReader();
  if (!reader) throw new Error("invalid_request");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 8192) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_request");
  return body as Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  const origin = cleanOrigin(req);
  if (req.method === "OPTIONS") {
    if (!origin) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    }});
  }
  if (!origin) return json({ error: "origin_not_allowed" }, 403);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "server_configuration_error" }, 500, origin);

    const authorization = req.headers.get("authorization") || "";
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return json({ error: "authentication_required" }, 401, origin);

    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(bearer);
    if (authError || !authData.user) return json({ error: "authentication_required" }, 401, origin);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin.from("app_profiles")
      .select("role,status").eq("user_id", authData.user.id).maybeSingle();
    if (profileError) return json({ error: "authorization_unavailable" }, 503, origin);
    if (profile?.role !== "admin" || profile?.status !== "approved") return json({ error: "forbidden" }, 403, origin);

    const input = await readBody(req);
    const action = input.action;
    if (typeof action !== "string") return json({ error: "invalid_request" }, 400, origin);
    const fieldsByAction: Record<string, string[]> = {
      dashboard: ["action"], profiles: ["action"], cards: ["action"],
      business_create: ["action", "name", "slug", "category"],
      business_update: ["action", "id", "name", "slug"],
      business_status: ["action", "id", "status"],
      profile_status: ["action", "user_id", "status"],
      member_upsert: ["action", "user_id", "business_id", "member_role"],
      card_create: ["action", "business_id", "channel", "label", "target_url"],
      card_update: ["action", "id", "label", "target_url", "status", "archived"],
    };
    const allowedFields = fieldsByAction[action];
    if (!allowedFields) return json({ error: "unknown_action" }, 400, origin);
    if (Object.keys(input).some((field) => !allowedFields.includes(field))) {
      return json({ error: "unexpected_field" }, 400, origin);
    }

    if (action === "profiles") {
      const profiles = await readAllRows((from, to) => admin.from("app_profiles")
        .select("user_id,status,role,created_at,full_name").order("created_at",{ascending:false}).range(from, to));
      return json({ profiles }, 200, origin);
    }
    if (action === "dashboard") {
      const [businesses, events, reviews, profiles] = await Promise.all([
        readAllRows((from, to) => admin.from("app_businesses").select("*").order("name").range(from, to)),
        readAllRows((from, to) => admin.from("app_business_events").select("business_id,event_type,created_at,device_type,source").order("created_at",{ascending:false}).range(from, to)),
        readAllRows((from, to) => admin.from("app_business_review_snapshots").select("business_id,platform,review_count,captured_at").order("captured_at",{ascending:false}).range(from, to)),
        readAllRows((from, to) => admin.from("app_profiles").select("user_id,status,role,created_at,full_name").order("created_at",{ascending:false}).range(from, to)),
      ]);
      return json({ businesses, events, reviews, profiles }, 200, origin);
    }
    if (action === "cards") {
      const [cards, events] = await Promise.all([
        readAllRows((from, to) => admin.from("app_business_cards").select("id,business_id,label,channel,target_url,status,archived_at").order("channel").range(from, to)),
        readAllRows((from, to) => admin.from("app_business_events").select("card_id,created_at").not("card_id","is",null).order("created_at",{ascending:false}).range(from, to)),
      ]);
      return json({ cards, events }, 200, origin);
    }
    if (action === "business_create") {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const slug = typeof input.slug === "string" ? input.slug.trim().toLowerCase() : "";
      const category = typeof input.category === "string" ? input.category : "";
      if (!name || name.length > 120 || !slugPattern.test(slug) || !categories.has(category)) return json({ error: "invalid_business" }, 400, origin);
      const { data, error } = await admin.from("app_businesses").insert({ name, slug, category, status: "approved" }).select("id").single();
      if (error) return json({ error: "business_write_failed" }, 409, origin);
      return json({ ok: true, id: data.id }, 201, origin);
    }
    if (action === "business_update") {
      if (typeof input.id !== "string" || !uuid.test(input.id)) return json({ error: "invalid_business" }, 400, origin);
      const patch: Record<string, string> = {};
      if (input.name !== undefined) {
        if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) return json({ error: "invalid_business" }, 400, origin);
        patch.name = input.name.trim();
      }
      if (input.slug !== undefined) {
        if (typeof input.slug !== "string" || !slugPattern.test(input.slug.trim().toLowerCase())) return json({ error: "invalid_business" }, 400, origin);
        patch.slug = input.slug.trim().toLowerCase();
      }
      if (!Object.keys(patch).length) return json({ error: "invalid_business" }, 400, origin);
      const { data, error } = await admin.from("app_businesses").update(patch).eq("id", input.id).select("id").maybeSingle();
      if (error) return json({ error: "business_write_failed" }, 409, origin);
      if (!data) return json({ error: "business_not_found" }, 404, origin);
      return json({ ok: true }, 200, origin);
    }
    if (action === "business_status") {
      if (typeof input.id !== "string" || !uuid.test(input.id) || typeof input.status !== "string" || !statuses.has(input.status)) return json({ error: "invalid_business" }, 400, origin);
      const { data, error } = await admin.from("app_businesses").update({ status: input.status }).eq("id", input.id).select("id").maybeSingle();
      if (error) return json({ error: "business_write_failed" }, 409, origin);
      if (!data) return json({ error: "business_not_found" }, 404, origin);
      return json({ ok: true }, 200, origin);
    }
    if (action === "profile_status") {
      if (typeof input.user_id !== "string" || !uuid.test(input.user_id) || input.user_id === authData.user.id ||
          typeof input.status !== "string" || !new Set(["pending","approved","rejected"]).has(input.status)) {
        return json({ error: "invalid_profile_change" }, 400, origin);
      }
      const { data, error } = await admin.from("app_profiles").update({ status: input.status }).eq("user_id", input.user_id).select("user_id").maybeSingle();
      if (error) return json({ error: "profile_write_failed" }, 409, origin);
      if (!data) return json({ error: "profile_not_found" }, 404, origin);
      return json({ ok: true }, 200, origin);
    }
    if (action === "member_upsert") {
      if (typeof input.user_id !== "string" || !uuid.test(input.user_id) || typeof input.business_id !== "string" ||
          !uuid.test(input.business_id) || typeof input.member_role !== "string" || !roles.has(input.member_role)) {
        return json({ error: "invalid_membership" }, 400, origin);
      }
      const [target, business] = await Promise.all([
        admin.from("app_profiles").select("status").eq("user_id",input.user_id).maybeSingle(),
        admin.from("app_businesses").select("status").eq("id",input.business_id).maybeSingle(),
      ]);
      if (target.error || business.error) return json({ error: "membership_check_failed" }, 503, origin);
      if (target.data?.status !== "approved" || business.data?.status !== "approved") return json({ error: "membership_target_not_approved" }, 409, origin);
      const { error } = await admin.from("app_business_members").upsert(
        { user_id: input.user_id, business_id: input.business_id, member_role: input.member_role },
        { onConflict: "business_id,user_id" },
      );
      if (error) return json({ error: "membership_write_failed" }, 409, origin);
      return json({ ok: true }, 200, origin);
    }
    if (action === "card_create") {
      if (typeof input.business_id !== "string" || !uuid.test(input.business_id) ||
          typeof input.channel !== "string" || !new Set(["nfc","qr"]).has(input.channel) ||
          typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 120) {
        return json({ error: "invalid_card" }, 400, origin);
      }
      const targetUrl = safeTarget(input.target_url);
      if (!targetUrl) return json({ error: "invalid_destination" }, 400, origin);
      const { data: business, error: businessError } = await admin.from("app_businesses")
        .select("status").eq("id",input.business_id).maybeSingle();
      if (businessError) return json({ error: "business_lookup_failed" }, 503, origin);
      if (business?.status !== "approved") return json({ error: "business_not_approved" }, 409, origin);
      const { data, error } = await admin.from("app_business_cards")
        .insert({ business_id: input.business_id, label: input.label.trim(), channel: input.channel, target_url: targetUrl, status: "active" })
        .select("id").single();
      if (error) return json({ error: "card_write_failed" }, 409, origin);
      return json({ ok: true, id: data.id }, 201, origin);
    }
    if (action === "card_update") {
      if (typeof input.id !== "string" || !uuid.test(input.id)) return json({ error: "invalid_card" }, 400, origin);
      const patch: Record<string, unknown> = {};
      if (input.label !== undefined) {
        if (typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 120) return json({ error: "invalid_card" }, 400, origin);
        patch.label = input.label.trim();
      }
      if (input.target_url !== undefined) {
        const targetUrl = safeTarget(input.target_url);
        if (!targetUrl) return json({ error: "invalid_destination" }, 400, origin);
        patch.target_url = targetUrl;
      }
      if (input.status !== undefined) {
        if (typeof input.status !== "string" || !new Set(["active","paused"]).has(input.status)) return json({ error: "invalid_card_status" }, 400, origin);
        patch.status = input.status;
      }
      if (input.archived !== undefined) {
        if (input.archived !== true) return json({ error: "invalid_card_change" }, 400, origin);
        patch.status = "paused";
        patch.archived_at = new Date().toISOString();
      }
      if (!Object.keys(patch).length) return json({ error: "invalid_card_change" }, 400, origin);
      const { data: existingCard, error: lookupError } = await admin.from("app_business_cards")
        .select("id,archived_at").eq("id", input.id).maybeSingle();
      if (lookupError) return json({ error: "card_lookup_failed" }, 503, origin);
      if (!existingCard) return json({ error: "card_not_found" }, 404, origin);
      if (existingCard.archived_at && patch.status === "active") return json({ error: "card_archived" }, 409, origin);
      const { data, error } = await admin.from("app_business_cards").update(patch).eq("id", input.id).select("id").maybeSingle();
      if (error) return json({ error: "card_write_failed" }, 409, origin);
      if (!data) return json({ error: "card_not_found" }, 404, origin);
      return json({ ok: true }, 200, origin);
    }
    return json({ error: "unknown_action" }, 400, origin);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: "request_too_large" }, 413, cleanOrigin(req) || "");
    if (error instanceof ResultLimitError) return json({ error: "result_limit_exceeded" }, 503, cleanOrigin(req) || "");
    if (error instanceof AdminReadError) return json({ error: "admin_read_failed" }, 503, cleanOrigin(req) || "");
    return json({ error: "invalid_request" }, 400, cleanOrigin(req) || "");
  }
});
