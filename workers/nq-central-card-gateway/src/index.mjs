// Staging candidate gateway. Do not deploy until an actual Cloudflare Rate Limiting binding
// and staging-only upstream/origin values are configured and reviewed.
const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "vary": "Origin",
    },
  });

async function hashedClientKey(ip) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("nq-central-client-rate-v1:" + ip),
  );
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function validUpstream(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        !url.pathname.endsWith("/functions/v1/register-business-card-event")) return null;
    return url;
  } catch {
    return null;
  }
}

async function readBounded(request, limit) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > limit) return null;
  const body = await request.text();
  return new TextEncoder().encode(body).byteLength <= limit ? body : null;
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ ok: false, error: "origin_not_allowed" }, 403, "null");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        "vary": "Origin",
      }});
    }
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);
    if (!env.RATE_LIMITER || !env.NQ_GATEWAY_SHARED_SECRET || !env.ALLOWED_ORIGINS) {
      return json({ ok: false, error: "gateway_configuration_error" }, 503, origin);
    }

    // Cloudflare supplies CF-Connecting-IP at the edge. Never key from caller-controlled XFF.
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (!clientIp || clientIp.length > 128) return json({ ok: false, error: "client_identity_unavailable" }, 400, origin);
    let limitResult;
    try {
      const clientKey = await hashedClientKey(clientIp);
      limitResult = await env.RATE_LIMITER.limit({ key: "nq-card-client:" + clientKey });
    } catch {
      return json({ ok: false, error: "client_rate_limit_unavailable" }, 503, origin);
    }
    if (!limitResult.success) return json({ ok: false, error: "client_rate_limited" }, 429, origin);

    const upstream = validUpstream(env.SUPABASE_FUNCTION_URL || "");
    if (!upstream || !env.NQ_GATEWAY_SHARED_SECRET) {
      return json({ ok: false, error: "gateway_configuration_error" }, 503, origin);
    }
    if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
      return json({ ok: false, error: "unsupported_media_type" }, 415, origin);
    }
    const body = await readBounded(request, 2048);
    if (body === null) return json({ ok: false, error: "request_too_large" }, 413, origin);

    try {
      const response = await fetch(upstream.href, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nq-gateway-secret": env.NQ_GATEWAY_SHARED_SECRET,
        },
        body,
        redirect: "manual",
        cache: "no-store",
      });
      const responseBody = await response.text();
      return new Response(responseBody, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") || "application/json",
          "cache-control": "no-store",
          "access-control-allow-origin": origin,
          "vary": "Origin",
        },
      });
    } catch {
      return json({ ok: false, error: "event_gateway_unavailable" }, 502, origin);
    }
  },
};
