// STAGED DRAFT: do not deploy until reviewed and tested with admin + non-admin accounts.
// This endpoint provisions per-card credentials. It never returns stored token hashes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://dariobarrii.github.io"]);
const restaurants = new Set(["Feral Steakhouse", "Tzura Steak House", "Veta Steak House"]);
const events = new Set(["nfc_tap", "qr_scan"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://dariobarrii.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

type Operation = "create" | "revoke" | "rotate" | "list";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function randomToken(): string {
  // 32 cryptographically random bytes encoded as 64 lowercase hex characters.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "Authentication required" }, 401);
  const accessToken = match[1].trim();
  if (!accessToken || accessToken.length > 8192) return json({ error: "Authentication required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publicKey || !serviceRoleKey) {
    console.error("Missing server-side Supabase configuration for manage-nfc-card");
    return json({ error: "Service temporarily unavailable" }, 503);
  }

  // Validate the access token against Supabase Auth; never trust a user ID/role from the request body.
  const authClient = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) return json({ error: "Invalid or expired session" }, 401);

  // The caller's role/status are read from the database, not from browser state or JWT metadata.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await adminClient
    .from("app_profiles")
    .select("role,status")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Admin profile lookup failed", profileError.code);
    return json({ error: "Could not verify administrator permissions" }, 500);
  }
  if (!profile || profile.role !== "admin" || profile.status !== "approved") {
    return json({ error: "Administrator approval required" }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const operation = payload.operation as Operation;
  if (!["create", "revoke", "rotate", "list"].includes(operation)) {
    return json({ error: "Unsupported operation" }, 400);
  }

  if (operation === "list") {
    const { data, error } = await adminClient
      .from("nfc_card_tokens")
      .select("card_id,restaurant,event,active,created_at,last_event_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("Card list failed", error.code);
      return json({ error: "Could not list cards" }, 500);
    }
    return json({ cards: data ?? [] });
  }

  if (operation === "create") {
    const restaurant = payload.restaurant;
    const event = payload.event;
    if (typeof restaurant !== "string" || !restaurants.has(restaurant)) {
      return json({ error: "Invalid restaurant" }, 400);
    }
    if (typeof event !== "string" || !events.has(event)) {
      return json({ error: "Invalid event" }, 400);
    }

    const cardId = crypto.randomUUID();
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const { data, error } = await adminClient
      .from("nfc_card_tokens")
      .insert({ card_id: cardId, token_hash: tokenHash, restaurant, event, active: true })
      .select("card_id,restaurant,event,active,created_at,last_event_at")
      .single();

    if (error || !data) {
      console.error("Card creation failed", error?.code);
      return json({ error: "Could not create card" }, 500);
    }
    // Raw token is returned exactly once and is deliberately never logged.
    return json({ card: data, token }, 201);
  }

  const cardId = payload.card_id;
  if (!isUuid(cardId)) return json({ error: "Invalid card ID" }, 400);

  if (operation === "revoke") {
    const { data, error } = await adminClient
      .from("nfc_card_tokens")
      .update({ active: false })
      .eq("card_id", cardId)
      .select("card_id,restaurant,event,active,created_at,last_event_at")
      .maybeSingle();
    if (error) {
      console.error("Card revocation failed", error.code);
      return json({ error: "Could not revoke card" }, 500);
    }
    if (!data) return json({ error: "Card not found" }, 404);
    return json({ card: data });
  }

  // Rotation applies only to active cards; it does not silently reactivate a revoked credential.
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const { data, error } = await adminClient
    .from("nfc_card_tokens")
    .update({ token_hash: tokenHash, last_event_at: null })
    .eq("card_id", cardId)
    .eq("active", true)
    .select("card_id,restaurant,event,active,created_at,last_event_at")
    .maybeSingle();

  if (error) {
    console.error("Card rotation failed", error.code);
    return json({ error: "Could not rotate card" }, 500);
  }
  if (!data) return json({ error: "Active card not found" }, 404);
  // The previous token becomes invalid as soon as the hash update commits.
  return json({ card: data, token });
});
