// Docustay's web app talks to ONE backend, server-side, so the browser sees a single origin (no CORS) and no backend hostname ever reaches a customer's browser, email or network tab.
import { hostMayServe, redirectFor, isSiteHost } from "$lib/hostGuard.js";
import { movedTo } from "$lib/site/redirects.js";
import { crossSiteRefused } from "$lib/crossSite.js";
// R13-D569: with no ORIGIN and no X-Forwarded-Proto adapter-node reports every request as https, so on the plain-http quickstart (http://localhost:8080) the same-origin rule refused every signed-in write; fall back to the scheme of KEYSTONE_PUBLIC_URL (http by default)
const FALLBACK_PROTO = String(process.env.KEYSTONE_PUBLIC_URL || "http://localhost").startsWith("https:") ? "https" : "http";
const API = (process.env.DOCUSTAY_API_URL || "http://localhost:8080").replace(/\/+$/, "");
if (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT_NAME) { const h = new URL(API); console.log(`[proxy] API upstream ${h.protocol}//${h.host}`); if (/^(127\.|localhost|\[?::1)/.test(h.hostname) && process.env.RAILWAY_ENVIRONMENT_NAME) console.error(`[proxy] WARNING: DOCUSTAY_API_URL points at ${h.host}, a loopback address, on a hosted service: every /api call will fail`); }
const PASS = ["cookie", "content-type", "idempotency-key", "accept", "user-agent", "x-qa-token", "authorization", "stripe-signature"];

// Part 30 item 0 — the headers every response carries (the app server used to send none of them; measured 4 Oct 2026).
const HSTS = "max-age=63072000; includeSubDomains", PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()";
function hardened(res, event) {
  const h = res.headers, https = (event.request.headers.get("x-forwarded-proto") || FALLBACK_PROTO) === "https";
  try {
    if (https && !h.has("strict-transport-security")) h.set("strict-transport-security", HSTS);
    if (!h.has("x-content-type-options")) h.set("x-content-type-options", "nosniff");
    if (!h.has("referrer-policy")) h.set("referrer-policy", "strict-origin-when-cross-origin");
    if (!h.has("permissions-policy")) h.set("permissions-policy", PERMISSIONS);
    // framing: frame-ancestors decides (none, or the sites a workspace listed for an embedded page). X-Frame-Options DENY is the fallback for browsers that ignore frame-ancestors, so it is
    // sent whenever the page may be framed by nobody — never on an embedded page that lists sites (X-Frame-Options cannot name them, and DENY would override the list in those browsers)
    const fa = /frame-ancestors\s+([^;]*)/i.exec(h.get("content-security-policy") ?? "")?.[1]?.trim();
    if (!h.has("x-frame-options") && (!fa || fa === "'none'")) h.set("x-frame-options", "DENY");
  } catch { /* immutable headers on a redirect response: the proxy path builds its own */ }
  return res;
}

// Pages are server-rendered and the doodles are inline SVG, so a home page is ~100 KB of markup; Brotli takes it to ~15 KB (the adapter compresses static files itself, but not rendered HTML).
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
async function squeeze(res, event) {
  try {
    if (res.status !== 200 || res.headers.has("content-encoding") || !/^text\/html/i.test(res.headers.get("content-type") ?? "") || event.url.pathname.startsWith("/api/")) return res;
    const ae = event.request.headers.get("accept-encoding") ?? ""; const br = /\bbr\b/.test(ae), gz = /\bgzip\b/.test(ae); if (!br && !gz) return res;
    const raw = Buffer.from(await res.arrayBuffer()), body = br ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : gzipSync(raw);
    const h = new Headers(res.headers); h.set("content-encoding", br ? "br" : "gzip"); h.set("content-length", String(body.length)); h.append("vary", "accept-encoding");
    return new Response(body, { status: res.status, headers: h });
  } catch { return res; }
}
// a shared link needs its own title and description: copied from the page's <title> and meta description into Open Graph and Twitter tags (every page already sets those two)
const esc = (x) => x.replace(/"/g, "&quot;");
const social = (html) => { if (html.includes('property="og:title"')) return html; const t = html.match(/<title>([^<]*)<\/title>/)?.[1], d = html.match(/<meta name="description" content="([^"]*)"/)?.[1]; if (!t) return html; return html.replace(/<meta name="twitter:card"[^>]*>/, (m) => `${m}<meta property="og:title" content="${esc(t)}" /><meta name="twitter:title" content="${esc(t)}" />${d ? `<meta property="og:description" content="${d}" /><meta name="twitter:description" content="${d}" />` : ""}`); };
import { surfaceOf, preferenceFrom, serverTheme } from "$lib/theme/surface.js";
import { siteGraph, jsonldScript } from "$lib/site/jsonld.js";
// structured data (Organization, WebSite and the page itself) goes into the <head> of every public-site page, built here from the path, title and description
const structured = (html, event) => { try { if (!event.route?.id?.startsWith("/(site)") || html.includes('"@id":"https://docustay.app/#organization"')) return html; const t = html.match(/<title>([^<]*)<\/title>/)?.[1], d = html.match(/<meta name="description" content="([^"]*)"/)?.[1]; if (!t) return html; const dec = (x) => x.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); return html.replace("</head>", `${jsonldScript(siteGraph({ path: event.url.pathname, title: dec(t), description: dec(d ?? ""), hasCrumbs: html.includes('"BreadcrumbList"') }))}</head>`); } catch { return html; } };
// the look goes on <html> in the server's own HTML: data-theme from the saved Appearance (light by default; "system" is resolved by the pre-paint script in app.html) and data-surface from the route (the marketing site is always dark, the signing page always light and friendly)
const withLang = (event) => {
  let cookie = ""; try { cookie = event.request.headers.get("cookie") ?? ""; } catch { /* prerendering */ }
  const surface = surfaceOf(event.route?.id, event.url.pathname);
  const look = ` data-theme="${serverTheme(preferenceFrom(cookie))}"${surface ? ` data-surface="${surface}"` : ""}`;
  // the website is English only (browsers translate pages for people): <html lang="en"> as the static shell says, plus the look
  return { transformPageChunk: ({ html }) => structured(social(html.replace('<html lang="en">', `<html lang="en"${look}>`)), event) };
};
export async function handle({ event, resolve: baseResolve }) {
  const resolve = (e, opts) => baseResolve(e, opts ?? withLang(e));
  const res = await handleInner({ event, resolve });
  return hardened(await squeeze(event.url.pathname === "/sign/pdf" ? stripeOnSigning(res) : event.url.pathname === "/signup" || event.url.pathname === "/login" ? googleOnEntry(res) : res, event), event);
}

// Run 9 Part 3.7 (R9-l): the signer pays in Stripe's own embedded box, on the signing page and nowhere else — so only this page may load Stripe's script, draw its frames and talk to it.
// Every other page keeps the policy in svelte.config.js unchanged.
const STRIPE_CSP = { "script-src": "https://js.stripe.com", "frame-src": "https://js.stripe.com https://*.stripe.com", "connect-src": "https://api.stripe.com https://*.stripe.com", "img-src": "https://*.stripe.com" };
export function stripeOnSigning(res) {
  const csp = res.headers.get("content-security-policy");
  if (!csp) return res;
  let out = csp;
  for (const [d, add] of Object.entries(STRIPE_CSP)) out = new RegExp(`(^|;)\\s*${d}\\s`, "i").test(out) ? out.replace(new RegExp(`((?:^|;)\\s*${d})([^;]*)`, "i"), (_, k, v) => `${k}${v} ${add}`) : `${out}; ${d} ${add}`;
  const h = new Headers(res.headers); h.set("content-security-policy", out);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Launch step 2: "Continue with Google" lives on the sign-up and sign-in pages only, so only those two may load Google's sign-in script, draw its frame and talk to it. Every other page keeps the policy unchanged.
const GOOGLE_CSP = { "script-src": "https://accounts.google.com/gsi/client", "frame-src": "https://accounts.google.com/gsi/", "connect-src": "https://accounts.google.com/gsi/", "style-src": "https://accounts.google.com/gsi/style", "img-src": "https://*.googleusercontent.com" };
export function googleOnEntry(res) {
  const csp = res.headers.get("content-security-policy");
  if (!csp) return res;
  let out = csp;
  for (const [d, add] of Object.entries(GOOGLE_CSP)) out = new RegExp(`(^|;)\\s*${d}\\s`, "i").test(out) ? out.replace(new RegExp(`((?:^|;)\\s*${d})([^;]*)`, "i"), (_, k, v) => `${k}${v} ${add}`) : `${out}; ${d} ${add}`;
  const h = new Headers(res.headers); h.set("content-security-policy", out);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function handleInner({ event, resolve }) {
  const { pathname } = event.url;
  let search = ""; try { search = event.url.search; } catch { /* prerendering has no query string, and reading it throws */ }
  // R13-D255: a doubled slash (docustay.app//features/) was a 404; a page address with one goes to the same address with single slashes. API calls are left as sent.
  if (pathname.includes("//") && !pathname.startsWith("/api/") && (event.request.method === "GET" || event.request.method === "HEAD")) return new Response(null, { status: 301, headers: { location: pathname.replace(/\/{2,}/g, "/") + search } });
  const moved = redirectFor(event.url.host, pathname); if (moved) return new Response(null, { status: /^www\./i.test(event.url.hostname) || isSiteHost(event.url.host) ? 301 : 302, headers: { location: moved.startsWith("/") ? moved + search : moved + search } });
  // /templates is the workspace list everywhere except the public site address (where it is an old address of the template hub)
  const renamed = pathname === "/templates" && !isSiteHost(event.url.host) ? null : movedTo(pathname); if (renamed) { const [to, hash] = renamed.split("#"); return new Response(null, { status: 301, headers: { location: to + search + (hash ? `#${hash}` : "") } }); }   // an old public address of the marketing site
  // A self-hosted install has no public site and no public sign-up: "/" goes to first-run setup (until the owner exists) or to the workspace, and /signup goes to sign-in.
  if (process.env.DOCUSTAY_SELF_HOST === "1") {
    if (pathname === "/signup" || pathname === "/signup/") return new Response(null, { status: 302, headers: { location: "/login" } });
    if (pathname === "/") {
      let needs = false; try { const r = await fetch(`${API}/api/setup/state`, { headers: { accept: "application/json" } }); needs = Boolean((await r.json())?.needsSetup); } catch { /* the backend is still starting: the workspace page will say so */ }
      return new Response(null, { status: 302, headers: { location: needs ? "/setup" : "/documents" } });
    }
  }
  if (!hostMayServe(event.url.hostname, pathname)) return new Response("Not found", { status: 404 });   // a customer's own hostname answers only the public pages
  if (pathname === "/people" || pathname.startsWith("/people/")) return new Response(null, { status: 301, headers: { location: `/contacts${pathname.slice("/people".length)}${event.url.search}` } });   // People is now Contacts (21 Oct 2026); the old address and any bookmark or email still work
  if (pathname === "/docs" || pathname === "/docs/") return new Response(null, { status: 308, headers: { location: "/docs/index" } });   // a real redirect (the docs index page lives at /docs/index)
  if (pathname === "/sign/pdf" && event.url.searchParams.get("embed") === "1") return embedded(event, resolve);
  if (pathname === "/embed/builder" || pathname === "/embed/scribe") return builderFrame(event, resolve);
  const connector = pathname === "/mcp" || pathname.startsWith("/.well-known/oauth-");   // the hosted connector: MCP and its discovery documents live on the API
  if (!pathname.startsWith("/api/") && !connector) return resolve(event);
  {   // R13-D429: the same-origin rule for anything that rides the session cookie (the API cannot see Origin/Referer: they are not forwarded)
    const rq = event.request.headers, proto = (rq.get("x-forwarded-proto") || "").split(",")[0].trim() || FALLBACK_PROTO;   // no proxy header: the scheme the install is configured for (adapter-node reports https when ORIGIN is unset, which refused every signed-in write on a plain-http quickstart: 26 Oct 2026, found by the VM rehearsal)
    if (crossSiteRefused({ method: event.request.method, origin: rq.get("origin"), referer: rq.get("referer"), cookie: rq.get("cookie"), authorization: rq.get("authorization"), own: `${proto}://${(rq.get("host") || event.url.host).trim().toLowerCase()}` }))   // the Host the browser used: event.url is pinned to one configured origin (adapter-node ORIGIN), so beta2/beta3 were all refused (R13-D429 regression, 23 Oct)
      return new Response(JSON.stringify({ error: { kind: "forbidden", message: "cross-site request refused", retryable: false } }), { status: 403, headers: { "content-type": "application/json" } });
  }
  const headers = new Headers();
  for (const h of PASS) { const v = event.request.headers.get(h); if (v) headers.set(h, v); }
  headers.set("x-forwarded-host", event.url.host);
  // behind a TLS-terminating proxy the app itself sees http: trust the proxy's own word for the scheme, or the backend cannot match a browser's https origin (found 7 Oct 2026: paying while signing said "Cannot tell where to send you back")
  headers.set("x-forwarded-proto", (event.request.headers.get("x-forwarded-proto") || "").split(",")[0].trim() || FALLBACK_PROTO);
  // the address the person is actually on, under a name no edge proxy rewrites (a passkey is tied to it)
  headers.set("x-docustay-origin", `${(headers.get("x-forwarded-proto") || "https")}://${event.url.host}`);
  let ip = null; try { ip = event.getClientAddress(); } catch { /* none */ }
  if (ip) headers.set("x-forwarded-for", ip);
  const hasBody = !["GET", "HEAD"].includes(event.request.method);
  // R13-D401: a 20 MB PDF (27 MB as base64 JSON, under the 25 MB Free cap) came back 502 with no body, because this server's own body cap was 25 MB and it closed
  //   the connection mid-upload. The cap (BODY_SIZE_LIMIT, Dockerfile) now fits the API's biggest file route; every other route is refused here, by its declared
  //   length and before the body is read, at the API's own limits (src/http/app.mjs), so a large body is never held in memory for a route that would refuse it.
  const declared = Number(event.request.headers.get("content-length") || 0);
  const maxBody = /^\/api\/v1\/(templates\/file|documents\/detect-fields)\/?$/.test(pathname) ? Math.ceil((100 * 1024 * 1024 * 4) / 3) + 256 * 1024 : 3 * 1024 * 1024;
  if (hasBody && declared > maxBody) return new Response(JSON.stringify({ error: { kind: "validation", message: "request body too large", retryable: false } }), { status: 413, headers: { "content-type": "application/json" } });
  let upstream;
  let sent = 0;
  try { const payload = hasBody ? Buffer.from(await event.request.arrayBuffer()) : undefined; sent = payload?.length ?? 0; upstream = await fetch(`${API}${pathname}${search}`, { method: event.request.method, headers, body: payload, redirect: "manual" }); }
  catch (e) {
    // never swallow the real reason: a stale or unreachable upstream address failed silently for a day (15 Oct 2026, DOCUSTAY_API_URL=http://127.0.0.1:9). Host and error code only, no path query, no headers.
    console.error(`[proxy] upstream failed: ${event.request.method} ${pathname} -> ${new URL(API).host}: ${e?.cause?.code ?? e?.code ?? e?.name} ${String(e?.cause?.message ?? e?.message ?? "").slice(0, 120)}`);
    // the API answers 413 and closes the connection while a large body is still being sent; the sender then sees a reset, not the answer (measured: a 5 MB JSON body came back 502 in a busy run). Say what happened.
    if (sent > 1_000_000 && /UND_ERR_SOCKET|ECONNRESET|EPIPE/.test(String(e?.cause?.code ?? e?.code ?? ""))) return new Response(JSON.stringify({ error: { kind: "validation", message: "request body too large", retryable: false } }), { status: 413, headers: { "content-type": "application/json" } }); return new Response(JSON.stringify({ error: { kind: "dependency", message: "The service behind this page did not answer. Please try again in a moment.", retryable: true } }), { status: 502, headers: { "content-type": "application/json", "retry-after": "5" } }); }   // a backend that is down is a 502 with a plain message, never an unhandled 500
  const out = new Headers();
  upstream.headers.forEach((v, k) => { if (!["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"].includes(k)) out.set(k, v); });
  for (const c of upstream.headers.getSetCookie?.() ?? []) out.append("set-cookie", c);
  return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
}

// Part 30 item 4 — a signing form shown inside a customer's own page. The page may be framed ONLY by the websites that organisation listed, and only when this person's seat was sent as embedded; anything else keeps frame-ancestors 'none'.
const ORIGIN = /^(https:\/\/[a-z0-9.-]+(:\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/i;
async function embedded(event, resolve) {
  const res = await resolve(event);
  let origins = [];
  try {
    const t = event.url.searchParams.get("t");
    if (t) {
      const r = await fetch(`${API}/api/public/pdf/embed-origins`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `emb-${Date.now()}-${Math.random().toString(36).slice(2)}` }, body: JSON.stringify({ presented: t }) });
      if (r.ok) origins = ((await r.json()).origins ?? []).filter((o) => ORIGIN.test(o));
    }
  } catch { /* keep none */ }
  if (!origins.length) return res;
  const h = new Headers(res.headers), csp = h.get("content-security-policy");
  if (csp) h.set("content-security-policy", csp.replace(/frame-ancestors[^;]*/i, `frame-ancestors ${origins.join(" ")}`));
  h.delete("x-frame-options");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// The embeddable template builder: the page may be framed ONLY by the website its signed link names, and only while that statement is genuine and unexpired (the API checks the signature; nothing here trusts the query).
async function builderFrame(event, resolve) {
  const res = await resolve(event);
  let origin = null;
  try {
    const q = event.url.searchParams;
    const r = await fetch(`${API}/api/public/builder/frame-origin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ o: q.get("o"), e: q.get("e"), s: q.get("s") }) });
    if (r.ok) { const o = (await r.json())?.origin; if (typeof o === "string" && ORIGIN.test(o)) origin = o; }
  } catch { /* none */ }
  const h = new Headers(res.headers), csp = h.get("content-security-policy");
  if (csp) h.set("content-security-policy", csp.replace(/frame-ancestors[^;]*/i, `frame-ancestors ${origin ?? "'none'"}`));
  if (origin) h.delete("x-frame-options");
  h.set("referrer-policy", "no-referrer"); h.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
