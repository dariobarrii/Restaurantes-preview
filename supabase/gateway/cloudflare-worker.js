/**
 * Cloudflare Worker gateway for NQ Central business-card events.
 *
 * Deploy only after configuring SUPABASE_FUNCTION_URL, GATEWAY_SHARED_SECRET,
 * and a Cloudflare Rate Limiting binding named RATE_LIMITER. This file is not
 * wired into DNS and must not be considered active until deployed and tested.
 */
const MAX_BODY_BYTES = 2048;
const ALLOWED_METHODS = "POST, OPTIONS";
const ALLOWED_HEADERS = "content-type";

function json(body, status = 200, origin = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": ALLOWED_METHODS,
      "access-control-allow-headers": ALLOWED_HEADERS,
      "vary": "Origin",
    },
  });
}

function validOrigin(origin, configured) {
  // Fail closed: deployment must explicitly configure the frontend origin allowlist.
  if (!configured) return null;
  const allowed = configured.split(",").map((v) => v.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const corsOrigin = validOrigin(origin, env.ALLOWED_ORIGINS || "");
    if (corsOrigin === null) return json({ ok: false, error: "origin_not_allowed" }, 403, "null");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": corsOrigin,
          "access-control-allow-methods": ALLOWED_METHODS,
          "access-control-allow-headers": ALLOWED_HEADERS,
          "access-control-max-age": "600",
          "cache-control": "no-store",
          "vary": "Origin",
        },
      });
    }
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, corsOrigin);

    if (!env.SUPABASE_FUNCTION_URL || !env.GATEWAY_SHARED_SECRET || !env.RATE_LIMITER) {
      return json({ ok: false, error: "gateway_not_configured" }, 503, corsOrigin);
    }

    const contentType = request.headers.get("content-type") || "";
    if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
      return json({ ok: false, error: "unsupported_media_type" }, 415, corsOrigin);
    }

    const declaredLength = Number(request.headers.get("content-length") || "0");
    if (declaredLength > MAX_BODY_BYTES) return json({ ok: false, error: "request_too_large" }, 413, corsOrigin);

    // Cloudflare supplies this value at its edge. Never accept an IP identity from a caller header.
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (!clientIp || clientIp.length > 64) return json({ ok: false, error: "client_identity_unavailable" }, 503, corsOrigin);

    let rateResult;
    try {
      rateResult = await env.RATE_LIMITER.limit({ key: clientIp });
    } catch {
      return json({ ok: false, error: "rate_limit_unavailable" }, 503, corsOrigin);
    }
    if (!rateResult?.success) return json({ ok: false, error: "rate_limited" }, 429, corsOrigin);

    let body;
    try {
      body = await request.arrayBuffer();
    } catch {
      return json({ ok: false, error: "invalid_request" }, 400, corsOrigin);
    }
    if (body.byteLength > MAX_BODY_BYTES) return json({ ok: false, error: "request_too_large" }, 413, corsOrigin);

    let upstream;
    try {
      const headers = new Headers({
        "content-type": request.headers.get("content-type") || "application/json",
        "x-nq-gateway-secret": env.GATEWAY_SHARED_SECRET,
      });
      // The browser never supplies the gateway secret; this Worker creates the header.
      upstream = await fetch(env.SUPABASE_FUNCTION_URL, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
      });
    } catch {
      return json({ ok: false, error: "upstream_unavailable" }, 502, corsOrigin);
    }

    let responseBody;
    try {
      responseBody = await upstream.arrayBuffer();
    } catch {
      return json({ ok: false, error: "upstream_unavailable" }, 502, corsOrigin);
    }
    const headers = new Headers({
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": corsOrigin,
      "access-control-allow-methods": ALLOWED_METHODS,
      "access-control-allow-headers": ALLOWED_HEADERS,
      "vary": "Origin",
    });
    return new Response(responseBody, { status: upstream.status, headers });
  },
};
