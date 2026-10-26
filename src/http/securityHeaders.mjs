// Part 30 item 0 — the response headers every Keystone/Docustay API and page response carries.
// ★ Measured 4 Oct 2026: the deployed app answered with NONE of these (only cache-control and content-type), so a browser was never told
//   to refuse plain HTTP (HSTS), to stop guessing content types (nosniff), to withhold the page address when leaving (referrer) or to refuse framing.
// No Content-Security-Policy is set HERE: this server also serves the the platform React screens, which are not touched by this work. The Docustay web app
//   (docustay/web) sets its own CSP, because it owns its markup.
const HSTS = "max-age=63072000; includeSubDomains";
const PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()";

/** Hono middleware. `frameAncestors` paths (the embeddable signing page) are served by docustay/web, never by this server. */
export function securityHeaders() {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    const https = (c.req.header("x-forwarded-proto") || new URL(c.req.url).protocol.replace(":", "")) === "https";
    if (https && !h.has("strict-transport-security")) h.set("strict-transport-security", HSTS);
    if (!h.has("x-content-type-options")) h.set("x-content-type-options", "nosniff");
    if (!h.has("referrer-policy")) h.set("referrer-policy", "strict-origin-when-cross-origin");
    if (!h.has("permissions-policy")) h.set("permissions-policy", PERMISSIONS);
    // a page that names its own frame-ancestors (the embedded signing form, served by docustay/web) already says who may frame it; the older header would override that in some browsers
    if (!h.has("x-frame-options") && !/frame-ancestors/i.test(h.get("content-security-policy") ?? "")) h.set("x-frame-options", "SAMEORIGIN");
    if (!h.has("cross-origin-opener-policy")) h.set("cross-origin-opener-policy", "same-origin");
  };
}
