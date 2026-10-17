import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const isHexToken = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 2048) return jsonResponse({ ok: false, error: "request_too_large" }, 413);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing server configuration");
      return jsonResponse({ ok: false, error: "server_configuration_error" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Apply a global ceiling plus a per-client limit before parsing or processing the body.
    // Store only SHA-256 bucket identifiers, never raw IP addresses.
    const globalBucket = await sha256Hex("nq-central-rate-limit-v1:global");
    const { data: globalAllowed, error: globalError } = await supabase.rpc("consume_nfc_event_rate_limit", {
      p_bucket_key: globalBucket, p_max_requests: 600, p_window_seconds: 60,
    });
    if (globalError || globalAllowed !== true) {
      if (globalError) console.error("Global rate-limit check failed:", globalError.message);
      return jsonResponse({ ok: false, error: globalError ? "rate_limit_unavailable" : "rate_limited" }, globalError ? 503 : 429);
    }

    const clientIp = req.headers.get("cf-connecting-ip")?.trim();
    if (clientIp) {
      const clientBucket = await sha256Hex("nq-central-rate-limit-v1:ip:" + clientIp);
      const { data: clientAllowed, error: clientError } = await supabase.rpc("consume_nfc_event_rate_limit", {
        p_bucket_key: clientBucket, p_max_requests: 40, p_window_seconds: 60,
      });
      if (clientError || clientAllowed !== true) {
        if (clientError) console.error("Client rate-limit check failed:", clientError.message);
        return jsonResponse({ ok: false, error: clientError ? "rate_limit_unavailable" : "rate_limited" }, clientError ? 503 : 429);
      }
    }

    const body = await req.json();
    const cardId = body?.card_id;
    const rawToken = body?.token;
    const deviceType = body?.device_type ?? "unknown";
    if (typeof cardId !== "string" || !uuidPattern.test(cardId) || !isHexToken(rawToken) ||
        !["mobile", "desktop", "tablet", "unknown"].includes(deviceType)) {
      return jsonResponse({ ok: false, error: "invalid_request" }, 400);
    }

    const tokenHash = await sha256Hex(rawToken);
    const { data, error } = await supabase.rpc("register_nfc_event_with_token", {
      p_card_id: cardId, p_token_hash: tokenHash, p_device_type: deviceType,
    });
    if (error) {
      console.error("Event registration failed:", error.message);
      return jsonResponse({ ok: false, error: "registration_failed" }, 500);
    }
    const result = data as { ok?: boolean; error?: string };
    if (result?.ok === true) return jsonResponse({ ok: true });
    if (["invalid_card", "rate_limited", "invalid_request"].includes(result?.error || "")) return jsonResponse(result);
    return jsonResponse({ ok: false, error: "registration_failed" }, 500);
  } catch {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }
});
