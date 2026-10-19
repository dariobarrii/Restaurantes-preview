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


class PayloadTooLargeError extends Error {}

async function readJsonBodyLimited(req: Request, maxBytes: number): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("empty_body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeHttpsTarget(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const target = new URL(value);
    return target.protocol === "https:" && !target.username && !target.password ? target.href : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Defense in depth: only the trusted gateway may call this public endpoint.
  // Configure NQ_GATEWAY_SHARED_SECRET in Edge Function secrets before deployment.
  // The secret must never be included in browser code or logs.
  const expectedGatewaySecret = Deno.env.get("NQ_GATEWAY_SHARED_SECRET");
  const suppliedGatewaySecret = req.headers.get("x-nq-gateway-secret");
  if (!expectedGatewaySecret || !suppliedGatewaySecret || suppliedGatewaySecret !== expectedGatewaySecret) {
    return jsonResponse({ ok: false, error: "gateway_required" }, 403);
  }

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

    // The global ceiling applies even when the platform does not provide a client-IP header.
    const globalBucket = await sha256Hex("nq-central-rate-limit-v1:business-card:global");
    const { data: globalAllowed, error: globalError } = await supabase.rpc("consume_business_card_rate_limit", {
      p_bucket_key: globalBucket, p_max_requests: 600, p_window_seconds: 60,
    });
    if (globalError || globalAllowed !== true) {
      if (globalError) console.error("Global rate-limit check failed:", globalError.message);
      return jsonResponse({ ok: false, error: globalError ? "rate_limit_unavailable" : "global_rate_limited" }, globalError ? 503 : 429);
    }

    // Do not trust caller-controlled IP headers for rate-limit identity. The global ceiling remains active.

    const body = await readJsonBodyLimited(req, 2048) as { card_id?: unknown; token?: unknown; device_type?: unknown } | null;
    const cardId = body?.card_id;
    const rawToken = body?.token;
    const deviceType = body?.device_type ?? "unknown";
    if (typeof cardId !== "string" || !uuidPattern.test(cardId) || !isHexToken(rawToken) ||
        typeof deviceType !== "string" || !["mobile", "desktop", "tablet", "unknown"].includes(deviceType)) {
      return jsonResponse({ ok: false, error: "invalid_request" }, 400);
    }

    const tokenHash = await sha256Hex(rawToken);
    const { data, error } = await supabase.rpc("register_business_card_event_with_token", {
      p_card_id: cardId, p_token_hash: tokenHash, p_device_type: deviceType,
    });
    if (error) {
      console.error("Event registration failed:", error.message);
      return jsonResponse({ ok: false, error: "registration_failed" }, 500);
    }
    const result = data as { ok?: boolean; error?: string; target_url?: unknown };
    if (result?.ok === true) {
      const targetUrl = safeHttpsTarget(result.target_url);
      if (!targetUrl) return jsonResponse({ ok: false, error: "invalid_destination" }, 500);
      return jsonResponse({ ok: true, target_url: targetUrl });
    }
    if (["invalid_card", "rate_limited", "invalid_request"].includes(result?.error || "")) return jsonResponse(result);
    return jsonResponse({ ok: false, error: "registration_failed" }, 500);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return jsonResponse({ ok: false, error: "request_too_large" }, 413);
    }
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }
});
