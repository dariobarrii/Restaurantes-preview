import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

function isHexToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  try {
    const body = await req.json();
    const cardId = body?.card_id;
    const rawToken = body?.token;
    const deviceType = body?.device_type ?? "unknown";
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
      typeof cardId !== "string" ||
      !uuidPattern.test(cardId) ||
      !isHexToken(rawToken) ||
      !["mobile", "desktop", "tablet", "unknown"].includes(deviceType)
    ) {
      return jsonResponse({ ok: false, error: "invalid_request" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing server configuration");
      return jsonResponse({ ok: false, error: "server_configuration_error" }, 500);
    }

    const tokenHash = await sha256Hex(rawToken);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc(
      "register_business_card_event_with_token",
      {
        p_card_id: cardId,
        p_token_hash: tokenHash,
        p_device_type: deviceType,
      },
    );

    if (error) {
      console.error("Event registration failed:", error.message);
      return jsonResponse({ ok: false, error: "registration_failed" }, 500);
    }

    const result = data as { ok?: boolean; error?: string };
    if (result?.ok === true) return jsonResponse({ ok: true });
    if (
      result?.error === "invalid_card" ||
      result?.error === "rate_limited" ||
      result?.error === "invalid_request"
    ) return jsonResponse(result);

    return jsonResponse({ ok: false, error: "registration_failed" }, 500);
  } catch {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }
});
