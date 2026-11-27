const corsHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

let jwksCache = null;
let jwksFetchedAt = 0;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
function b64urlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function decodePart(value) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(value)));
}
async function getJwks(issuer) {
  if (jwksCache && Date.now() - jwksFetchedAt < 10 * 60 * 1000) return jwksCache;
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { cf: { cacheTtl: 600 } });
  if (!response.ok) throw new Error("Cannot load Access signing keys");
  jwksCache = await response.json();
  jwksFetchedAt = Date.now();
  return jwksCache;
}
async function verifyAccess(request, env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const audience = String(env.ACCESS_AUD || "");
  if (!team || !audience) return false;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;
  try {
    const [h, p, sig] = token.split(".");
    if (!h || !p || !sig) return false;
    const header = decodePart(h), payload = decodePart(p);
    const issuer = `https://${team}`;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== issuer || !(payload.aud || []).includes(audience)) return false;
    if (payload.exp <= now || (payload.nbf && payload.nbf > now + 60)) return false;
    const keys = await getJwks(issuer);
    const jwk = (keys.keys || []).find(k => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  } catch (_) {
    return false;
  }
}
function safeDocKey(path) {
  const key = decodeURIComponent(path).replace(/^\/+|\/+$/g, "");
  if (!key || key.length > 180 || key.split("/").some(part => !/^[a-zA-Z0-9_.-]{1,80}$/.test(part))) return null;
  return key;
}
async function handleApi(request, env) {
  if (!(await verifyAccess(request, env))) return json({ error: "Unauthorized. Sign in through Cloudflare Access." }, 401);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/doc\/(.+)$/);
  if (!match) return json({ error: "Not found" }, 404);
  const key = safeDocKey(match[1]);
  if (!key) return json({ error: "Invalid document key" }, 400);

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT value, updated_at FROM documents WHERE doc_key = ?").bind(key).first();
    if (!row) return json({ exists: false });
    let data;
    try { data = JSON.parse(row.value); } catch (_) { return json({ error: "Stored document is invalid" }, 500); }
    return json({ exists: true, data, updated_at: row.updated_at });
  }

  if (request.method === "PUT") {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 1_500_000) return json({ error: "Document too large" }, 413);
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
    if (!body || !Object.prototype.hasOwnProperty.call(body, "data")) return json({ error: "Missing data" }, 400);
    const value = JSON.stringify(body.data);
    if (value.length > 1_500_000) return json({ error: "Document too large" }, 413);
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO documents (doc_key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(doc_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind(key, value, now).run();
    return json({ ok: true, updated_at: now });
  }
  return json({ error: "Method not allowed" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(request, env); }
      catch (error) { return json({ error: "Server error", detail: String(error?.message || error) }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
};
