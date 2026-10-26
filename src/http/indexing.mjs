// Which hostnames may be indexed by a search engine (the maintainer, 15 Oct 2026). EXACTLY three names: docustay.app, www.docustay.app and app.docustay.app.
// Every other host (staging, the sandbox, beta, a Railway origin address, sign.docustay.app, a customer's own signing host, localhost) answers
// `X-Robots-Tag: noindex, nofollow` on every response and a disallow-all /robots.txt. A production name is NEVER noindex: that is the line a test pins.
// Pure and import-free so the site server (docustay/web/src/lib/indexing.js is the same logic) and the API server share one rule.
export const DEFAULT_INDEXABLE = Object.freeze(["docustay.app", "www.docustay.app", "app.docustay.app"]);
export const hostOf = (v) => String(v ?? "").toLowerCase().split(",")[0].trim().split(":")[0].replace(/\.$/, "");
export const indexableHosts = (env = process.env) => (env.INDEXABLE_HOSTS ? String(env.INDEXABLE_HOSTS).split(",").map(hostOf).filter(Boolean) : [...DEFAULT_INDEXABLE]);
export const isIndexableHost = (host, env = process.env) => indexableHosts(env).includes(hostOf(host));
export const NOINDEX = "noindex, nofollow";
export const DISALLOW_ALL = "User-agent: *\nDisallow: /\n";
/** Hono middleware: noindex header on every response of a non-indexable host, and a disallow-all robots.txt there. */
export function indexingGuard(env = process.env) {
  return async (c, next) => {
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
    if (isIndexableHost(host, env)) return next();
    if (c.req.path === "/robots.txt") { return new Response(DISALLOW_ALL, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": NOINDEX, "cache-control": "public, max-age=300" } }); }
    await next(); c.res.headers.set("x-robots-tag", NOINDEX);
  };
}
