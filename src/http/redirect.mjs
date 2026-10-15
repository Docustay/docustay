// src/http/redirect.mjs — a 302 whose headers can still be set.
// ★ `Response.redirect(url, 302)` returns a Response with IMMUTABLE headers; src/http/securityHeaders.mjs (and any other middleware) sets headers on
//   the response after the handler, which throws `TypeError: immutable` — found 7 Oct 2026 as a 500 on GET /api/engagements/calendar/connect/google.
//   Every redirect in a route handler goes through this instead.
export function found(url) {
  return new Response(null, { status: 302, headers: { location: String(url) } });
}

/** The origin the browser is actually on. Behind Railway's proxy the Node server sees plain http, so `new URL(c.req.url).origin` is `http://…` and every OAuth redirect_uri built from it is
 *  refused by Google (redirect_uri_mismatch). The proxy says what the visitor used in `x-forwarded-proto`; localhost keeps its own scheme. */
export function publicOrigin(c) {
  const u = new URL(c.req.url);
  const fwd = (c.req.header("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  const proto = fwd === "https" || fwd === "http" ? fwd : local ? u.protocol.replace(":", "") : (process.env.KEYSTONE_ENVIRONMENT === "local" ? u.protocol.replace(":", "") : "https");
  return `${proto}://${u.host}`;
}
