// STAGED DRAFT: deploy only after the SQL migration and token provisioning are reviewed.
// Browser requests contain a per-card bearer token; never expose the Supabase service-role key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://dariobarrii.github.io"]);
const allowedDevices = new Set(["iPhone/iPad", "Android", "PC/Mac", "Desconocido"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://dariobarrii.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const cardId = payload.card_id;
  const token = payload.token;
  const deviceType = payload.device_type ?? "Desconocido";
  if (!isUuid(cardId)) return json({ error: "Invalid card" }, 400);
  if (typeof token !== "string" || token.length < 32 || token.length > 256) {
    return json({ error: "Invalid card credential" }, 401);
  }
  if (typeof deviceType !== "string" || !allowedDevices.has(deviceType)) {
    return json({ error: "Invalid device type" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing server-side Supabase configuration");
    return json({ error: "Service temporarily unavailable" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = await sha256Hex(token);
  const { error } = await supabase.rpc("register_nfc_event_with_token", {
    p_card_id: cardId,
    p_token_hash: tokenHash,
    p_device_type: deviceType,
  });

  if (error) {
    if (error.message.includes("event_throttled")) return json({ error: "Please try again shortly" }, 429);
    if (error.message.includes("invalid_or_revoked_card")) return json({ error: "Invalid card credential" }, 401);
    console.error("NFC/QR event registration failed", error.code);
    return json({ error: "Could not register event" }, 500);
  }

  return new Response(null, { status: 204, headers: corsHeaders });
});
