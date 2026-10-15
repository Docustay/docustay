// Framing guard for EVERY answer of the web server (loaded first: node --import ./frame-guard.mjs build). SvelteKit's hooks give rendered pages their CSP (frame-ancestors 'none', or the
// sites a workspace listed for an embedded page, hooks.server.js), but prerendered pages and static files are served before the hooks run and carried neither header (MEASURED on live,
// 11 Oct 2026: docustay.app/trust had no CSP and no X-Frame-Options). Any answer that sets NEITHER gets frame-ancestors 'none' and X-Frame-Options DENY, so no other site can frame it.
// An answer that already decided (a CSP of its own, or an X-Frame-Options) is never changed — that is how an embedded signing page stays framable by its listed sites only.
import http from "node:http";
const lower = (o) => Object.keys(o ?? {}).map((k) => k.toLowerCase());
const original = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (status, ...rest) {
  try {
    const inline = rest.find((x) => x && typeof x === "object" && !Array.isArray(x)) ?? null;
    const names = new Set([...this.getHeaderNames(), ...lower(inline)]);
    if (!names.has("content-security-policy") && !names.has("x-frame-options")) {
      if (inline) { inline["Content-Security-Policy"] = "frame-ancestors 'none'"; inline["X-Frame-Options"] = "DENY"; }
      else if (!this.headersSent) { this.setHeader("content-security-policy", "frame-ancestors 'none'"); this.setHeader("x-frame-options", "DENY"); }
    }
  } catch { /* never block an answer over a header */ }
  return original.call(this, status, ...rest);
};

// TRACE is never served. SvelteKit's request layer cannot build a Request for it (the Fetch standard forbids the method), so it used to answer a bare 400; the right answer for a method the site does not support is 405 with an Allow header (Schemathesis, OI-010, 15 Oct 2026).
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, res, ...rest) {
  if (event === "request" && req?.method === "TRACE" && res && !res.headersSent) { res.statusCode = 405; res.setHeader("allow", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"); res.setHeader("content-length", "0"); res.end(); return true; }
  return emit.call(this, event, req, res, ...rest);
};
