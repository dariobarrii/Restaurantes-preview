// Staging candidate gateway. Do not deploy until staging values and bindings are reviewed.
const json = (body, status, origin) => new Response(JSON.stringify(body), {
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

function validUpstream(value, expectedProjectRef) {
  try {
    const url = new URL(value);
    if (!expectedProjectRef || url.hostname !== expectedProjectRef + ".supabase.co" ||
        url.protocol !== "https:" || url.username || url.password ||
        url.pathname !== "/functions/v1/register-business-card-event" ||
        url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

async function readBounded(request, limit) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function publicUpstreamResult(responseBody, upstreamStatus, origin) {
  let result;
  try {
    result = JSON.parse(responseBody);
  } catch {
    return json({ ok: false, error: "event_gateway_unavailable" }, 502, origin);
  }
  if (result && result.ok === true && typeof result.target_url === "string") {
    try {
      const target = new URL(result.target_url);
      if (target.protocol === "https:" && !target.username && !target.password && target.href.length <= 2048) {
        return json({ ok: true, target_url: target.href }, upstreamStatus, origin);
      }
    } catch {}
    return json({ ok: false, error: "invalid_destination" }, 502, origin);
  }
  const safeErrors = new Set([
    "invalid_request", "invalid_card", "rate_limited", "gateway_required",
    "global_rate_limited", "global_rate_limit_unavailable", "request_too_large",
  ]);
  const error = result && safeErrors.has(result.error) ? result.error : "event_registration_failed";
  return json({ ok: false, error }, upstreamStatus >= 400 ? upstreamStatus : 400, origin);
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
    const upstream = validUpstream(env.SUPABASE_FUNCTION_URL || "", env.STAGING_PROJECT_REF || "");
    if (!upstream) return json({ ok: false, error: "gateway_configuration_error" }, 503, origin);
    if (!(request.headers.get("content-type") || "").toLowerCase().match(/^application\/json(?:\s*;|\s*$)/)) {
      return json({ ok: false, error: "unsupported_media_type" }, 415, origin);
    }

    // Bound the stream before buffering it; Content-Length alone is caller-controlled.
    let body;
    try {
      body = await readBounded(request, 2048);
    } catch {
      return json({ ok: false, error: "invalid_request" }, 400, origin);
    }
    if (body === null) return json({ ok: false, error: "request_too_large" }, 413, origin);

    // CF-Connecting-IP is supplied by Cloudflare; never key from caller-controlled XFF.
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
      // Bound and allowlist the response: even an upstream error cannot echo headers or secrets.
      const responseBody = await readBounded(response, 4096);
      if (responseBody === null) return json({ ok: false, error: "event_gateway_unavailable" }, 502, origin);
      return publicUpstreamResult(responseBody, response.status, origin);
    } catch {
      return json({ ok: false, error: "event_gateway_unavailable" }, 502, origin);
    }
  },
};
