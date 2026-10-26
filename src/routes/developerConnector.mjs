// src/routes/developerConnector.mjs — the hosted connector (Final Push Stage 8): lets ChatGPT, Claude or any MCP client work on DRAFTS in a workspace after the person signs in and says Allow.
//   POST /mcp                                        MCP over HTTP (JSON). Bearer token = a connector key; a missing or wrong key answers 401 with the OAuth discovery pointer.
//   GET  /.well-known/oauth-protected-resource       and /.well-known/oauth-authorization-server (discovery)
//   POST /api/public/oauth/register                  dynamic client registration (stateless: the client id seals its own name and redirect addresses)
//   POST /api/oauth/approve                          a SIGNED-IN person says Allow → { redirect } carrying a sealed one-time code (2 minutes, PKCE S256 required)
//   POST /api/public/oauth/token                     code + PKCE verifier → a draft-only API key for that person's workspace (90 days; shows in Developers → API keys; revoke it there)
import { randomUUID } from "node:crypto";
import { seal, open, pkceChallenge, newId } from "../developer/connectorSeal.mjs";
import { handleMessage } from "../developer/hostedMcp.mjs";
import { createApiToken } from "../auth/apiToken.mjs";
import { withTenant } from "../db/index.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { forbidden, invalid } from "../http/errors.mjs";
import { effectiveGrants } from "../permissions/resolve.mjs";
import { saveKeyPolicy } from "../documents/frontDoor.mjs";
import { scopesGrantableBy } from "./developer.mjs";

const CONNECTOR_SCOPES = Object.freeze(["documents:read", "documents:write", "templates:read", "plays:read", "drafts:write"]);
const TOKEN_DAYS = 90, CODE_SECONDS = 120;
const used = new Map();   // code id → expiry (per instance): a code works once here; PKCE and the 2-minute life cover the rest
const sweep = () => { const n = Date.now(); for (const [k, v] of used) if (v < n) used.delete(k); };
const redirectOk = (u) => { try { const x = new URL(u); return x.protocol === "https:" || (x.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(x.hostname)); } catch { return false; } };
const origin = (c) => { const h = c.req.header("x-docustay-origin"); if (h) return h.replace(/\/+$/, ""); const u = new URL(c.req.url); return `${c.req.header("x-forwarded-proto") || u.protocol.replace(":", "")}://${c.req.header("x-forwarded-host") || u.host}`; };
const oauthError = (c, status, error, description) => c.json({ error, error_description: description }, status, { "cache-control": "no-store" });

export function registerConnectorPublic(app) {
  const meta = (c) => { const o = origin(c); return { resource: `${o}/mcp`, authorization_servers: [o], bearer_methods_supported: ["header"], scopes_supported: ["drafts"] }; };
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(meta(c)));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(meta(c)));
  app.get("/.well-known/oauth-authorization-server", (c) => { const o = origin(c); return c.json({ issuer: o, authorization_endpoint: `${o}/oauth/authorize`, token_endpoint: `${o}/api/public/oauth/token`, registration_endpoint: `${o}/api/public/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["drafts"] }); });

  app.post("/api/public/oauth/register", async (c) => {
    const b = await c.req.json().catch(() => null);
    const uris = Array.isArray(b?.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 5 || !uris.every(redirectOk)) return oauthError(c, 400, "invalid_redirect_uri", "give 1 to 5 redirect addresses: https, or http only for localhost");
    const name = String(b?.client_name ?? "An AI assistant").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80) || "An AI assistant";
    const client_id = `dsc_${seal("client", { n: name, r: uris }, 365 * 86400)}`;
    return c.json({ client_id, client_name: name, redirect_uris: uris, grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" }, 201, { "cache-control": "no-store" });
  });

  app.post("/api/public/oauth/token", async (c) => {
    sweep();
    const f = Object.fromEntries(new URLSearchParams(await c.req.text()));
    if (f.grant_type !== "authorization_code") return oauthError(c, 400, "unsupported_grant_type", "only authorization_code");
    const code = open("code", f.code);
    if (!code) return oauthError(c, 400, "invalid_grant", "that code is not valid or has expired");
    if (used.has(code.jti)) return oauthError(c, 400, "invalid_grant", "that code was already used");
    if (code.ru !== f.redirect_uri || code.cid !== f.client_id) return oauthError(c, 400, "invalid_grant", "the code was made for a different client or address");
    if (!f.code_verifier || pkceChallenge(f.code_verifier) !== code.ch) return oauthError(c, 400, "invalid_grant", "the code verifier does not match");
    used.set(code.jti, Date.now() + CODE_SECONDS * 1000 + 5000);
    const expiresAt = new Date(Date.now() + TOKEN_DAYS * 86400000);
    const made = await withTenant(code.t, async (db) => {
      const { rows: [prod] } = await db.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [code.t]);
      const k = await createApiToken(db, { environment: "live", tokenClass: "secret", name: `Connector: ${code.n}`.slice(0, 120), scopes: [...CONNECTOR_SCOPES], createdBy: code.u, rankCeiling: code.role, expiresAt: expiresAt.toISOString(), brand: prod?.product === "docustay" ? "dsk" : "gl" });
      await saveKeyPolicy(db, { tenantId: code.t, tokenId: k.tokenId, draftOnly: true, maxDraftsPerDay: 100, maxSendsPerDay: null });
      await emit(db, { tenantId: code.t, topic: "developer.api_key.created", emittedBy: "developer", subjectType: "api_token", subjectId: k.id, actor: userActor(code.u), payload: { purpose: "hosted_connector" } });
      return k;
    }, { userId: code.u });
    return c.json({ access_token: made.presented, token_type: "Bearer", expires_in: TOKEN_DAYS * 86400, scope: "drafts" }, 200, { "cache-control": "no-store", pragma: "no-cache" });
  });

  // MCP over HTTP. GET (a stream) is not offered: answers are plain JSON.
  app.get("/mcp", (c) => c.json({ error: "use POST with a JSON-RPC message" }, 405, { allow: "POST" }));
  app.delete("/mcp", (c) => c.body(null, 405, { allow: "POST" }));
  app.post("/mcp", async (c) => {
    const auth = c.req.header("authorization") ?? "";
    const challenge = { "www-authenticate": `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource"` };
    if (!/^Bearer\s+\S{20,}$/i.test(auth)) return c.json({ error: "sign in required" }, 401, challenge);
    const call = async (method, path, body) => {
      const headers = { authorization: auth, accept: "application/json", ...(c.req.header("x-forwarded-for") ? { "x-forwarded-for": c.req.header("x-forwarded-for") } : {}), ...(method !== "GET" ? { "content-type": "application/json", "idempotency-key": randomUUID() } : {}) };
      const r = await app.request(path, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
      const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { json = { raw: t.slice(0, 500) }; }
      return { status: r.status, json: json?.data ?? json };
    };
    const probe = await call("GET", "/api/v1/documents/templates");
    if (probe.status === 401) return c.json({ error: "that key is not valid" }, 401, challenge);
    let body; try { body = await c.req.json(); } catch { return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "not JSON" } }, 400); }
    if (Array.isArray(body)) { const out = (await Promise.all(body.map((m) => handleMessage(m, call)))).filter(Boolean); return out.length ? c.json(out) : c.body(null, 202); }
    const out = await handleMessage(body, call);
    return out ? c.json(out) : c.body(null, 202);
  });
}

export function registerConnectorSession(app, { runTenantScoped, tenantIsPlatform }) {
  app.post("/api/oauth/approve", (c) => runTenantScoped(c, async ({ db, principal, tenantId }) => {
    const b = await c.req.json().catch(() => ({}));
    const client = open("client", String(b.client_id ?? "").replace(/^dsc_/, ""));
    if (!client) throw invalid("that application is not registered (or its registration expired)", { field: "client_id" });
    if (!client.r.includes(b.redirect_uri)) throw invalid("that return address is not one the application registered", { field: "redirect_uri" });
    if (b.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(String(b.code_challenge ?? ""))) throw invalid("a PKCE S256 challenge is required", { field: "code_challenge" });
    // the person may only hand over what they could mint themselves
    const grants = await effectiveGrants(db, principal?.appUserId ?? null);
    const held = scopesGrantableBy(principal.user, grants, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
    const lack = CONNECTOR_SCOPES.filter((s) => !held.includes(s));
    if (lack.length) throw forbidden(`refused: you cannot grant ${lack.join(", ")}, so you cannot connect an assistant`);
    const { rows: [t] } = await db.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
    const code = seal("code", { t: tenantId, u: principal.appUserId, role: principal.user.staff_role, ch: b.code_challenge, ru: b.redirect_uri, cid: String(b.client_id), n: client.n, jti: newId() }, CODE_SECONDS);
    const u = new URL(b.redirect_uri); u.searchParams.set("code", code); if (b.state) u.searchParams.set("state", String(b.state));
    return { redirect: u.toString(), workspace: t?.name ?? null };
  }, { bucket: "documents" }).then((r) => c.json(r)));
  // what the consent page shows before the person decides: the application's name and where it returns to
  app.post("/api/oauth/preview", (c) => runTenantScoped(c, async ({ db, tenantId }) => {
    const b = await c.req.json().catch(() => ({}));
    const client = open("client", String(b.client_id ?? "").replace(/^dsc_/, ""));
    if (!client || !client.r.includes(b.redirect_uri)) throw invalid("that application is not registered, or its return address is wrong");
    const { rows: [t] } = await db.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
    return { client: client.n, workspace: t?.name ?? null, scopes: CONNECTOR_SCOPES, host: new URL(b.redirect_uri).host };
  }, { bucket: "documents" }).then((r) => c.json(r)));
}
