import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Cache-Control": "no-store",
};

function response(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin, "Content-Type": "application/json" },
  });
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > 4096) return null;
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > 4096) return null;
  const value: unknown = JSON.parse(text);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = (Deno.env.get("ADMIN_ALLOWED_ORIGINS") || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!origin || !allowedOrigins.includes(origin)) return response({ error: "origin_not_allowed" }, 403, "null");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin } });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405, origin);
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get("content-type") || "")) {
    return response({ error: "unsupported_media_type" }, 415, origin);
  }

  try {
    const body = await readBody(req);
    if (!body) return response({ error: "invalid_request" }, 400, origin);
    const operation = body.operation;
    const cardId = body.card_id;
    if (!["issue", "rotate", "revoke"].includes(String(operation)) || typeof cardId !== "string" || !UUID.test(cardId)) {
      return response({ error: "invalid_request" }, 400, origin);
    }

    const authorization = req.headers.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1].length > 8192) return response({ error: "authentication_required" }, 401, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return response({ error: "server_configuration_error" }, 503, origin);

    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(match[1]);
    if (authError || !authData.user) return response({ error: "invalid_session" }, 401, origin);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin
      .from("app_profiles")
      .select("role,status")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (profileError) return response({ error: "authorization_check_failed" }, 503, origin);
    if (!profile || profile.role !== "admin" || profile.status !== "approved") {
      return response({ error: "administrator_required" }, 403, origin);
    }

    if (operation === "revoke") {
      const { data, error } = await admin
        .from("app_business_card_tokens")
        .update({ active: false })
        .eq("card_id", cardId)
        .select("card_id,active")
        .maybeSingle();
      if (error) return response({ error: "credential_update_failed" }, 503, origin);
      return response({ ok: true, card_id: cardId, revoked: Boolean(data) }, 200, origin);
    }

    const { data: card, error: cardError } = await admin
      .from("app_business_cards")
      .select("id,business_id,status,archived_at")
      .eq("id", cardId)
      .maybeSingle();
    if (cardError) return response({ error: "card_lookup_failed" }, 503, origin);
    if (!card || card.status !== "active" || card.archived_at) return response({ error: "invalid_card" }, 404, origin);

    const { data: business, error: businessError } = await admin
      .from("app_businesses")
      .select("status")
      .eq("id", card.business_id)
      .maybeSingle();
    if (businessError) return response({ error: "business_lookup_failed" }, 503, origin);
    if (!business || business.status !== "approved") return response({ error: "business_not_approved" }, 409, origin);

    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const { error: tokenError } = await admin
      .from("app_business_card_tokens")
      .upsert({ card_id: card.id, token_hash: tokenHash, active: true, last_event_at: null }, { onConflict: "card_id" });
    if (tokenError) return response({ error: "credential_issue_failed" }, 503, origin);

    // The raw bearer token is returned only to the authenticated administrator and is never logged.
    return response({ ok: true, card_id: card.id, token }, 201, origin);
  } catch {
    return response({ error: "invalid_request" }, 400, origin);
  }
});
