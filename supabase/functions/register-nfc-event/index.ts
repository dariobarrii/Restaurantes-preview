// Supabase Edge Function: register-nfc-event
// Deploy only after setting SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets.
// This endpoint accepts event writes only; it never exposes event reads.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://dariobarrii.github.io",
]);

const allowedRestaurants = new Set([
  "Feral Steakhouse",
  "Tzura Steak House",
  "Veta Steak House",
]);

const allowedEvents = new Set(["nfc_tap", "qr_scan"]);
const allowedDevices = new Set([
  "iPhone/iPad",
  "Android",
  "PC/Mac",
  "Desconocido",
]);

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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (origin && !allowedOrigins.has(origin)) {
    return json({ error: "Origin not allowed" }, 403);
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const restaurant = payload.restaurant;
  const event = payload.event;
  const deviceType = payload.device_type ?? "Desconocido";

  if (typeof restaurant !== "string" || !allowedRestaurants.has(restaurant)) {
    return json({ error: "Invalid restaurant" }, 400);
  }
  if (typeof event !== "string" || !allowedEvents.has(event)) {
    return json({ error: "Invalid event" }, 400);
  }
  if (typeof deviceType !== "string" || !allowedDevices.has(deviceType)) {
    return json({ error: "Invalid device_type" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase function secrets");
    return json({ error: "Service temporarily unavailable" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.from("nfc_events").insert({
    restaurant,
    event,
    device_type: deviceType,
  });

  if (error) {
    console.error("Event insert failed", error.code, error.message);
    return json({ error: "Could not register event" }, 500);
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
});
