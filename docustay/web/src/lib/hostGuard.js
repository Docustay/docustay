// A customer's OWN signing hostname (sign.theircompany.com, through Cloudflare for SaaS) may serve only the public pages — signing, verifying, the public API and assets — never the workspace, a login or settings.
// A self-hosted install (DOCUSTAY_SELF_HOST=1, set by the self-host package) is served on the owner's own address, whatever it is: every hostname is the owner's, none is a customer's own signing hostname, and nothing is sent on to docustay.app.
const SELF = process.env.DOCUSTAY_SELF_HOST === "1";
const OWN = (process.env.DOCUSTAY_PLATFORM_HOSTS ?? "docustay.app,.docustay.app,localhost,127.0.0.1,.localhost,.up.railway.app,.railway.internal").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
export const isPlatformHost = (host, own = OWN) => { if (SELF) return true; const h = String(host ?? "").toLowerCase().split(":")[0].replace(/\.$/, ""); return !h || h === "sveltekit-prerender" || own.some((o) => (o.startsWith(".") ? h.endsWith(o) : h === o)) || /^[\d.]+$/.test(h); };
const PUBLIC = [/^\/sign(\/|$)/, /^\/download(\/|$)/, /^\/verify(\/|$)/, /^\/s\/[^/]+$/, /^\/f\/[^/]+(\/[^/]+)?$/, /^\/api\/public\//, /^\/_app\//, /^\/media\//, /^\/favicon/, /^\/robots\.txt$/, /^\/healthz$/];
export const pathAllowed = (path) => PUBLIC.some((re) => re.test(path));
export const hostMayServe = (host, path, own = OWN) => isPlatformHost(host, own) || pathAllowed(path);

// ── our own three names (the app routes by hostname; nothing else decides) ──
// docustay.app / www → the public site; app.docustay.app → sign-in and the workspace; sign.docustay.app → signing pages (and the fallback origin for customers' own hostnames).
const APP_HOST = (process.env.DOCUSTAY_APP_HOST ?? "app.docustay.app").toLowerCase();
const SITE_HOSTS = (process.env.DOCUSTAY_SITE_HOSTS ?? "docustay.app,www.docustay.app").split(",").map((x) => x.trim().toLowerCase());
const SIGN_HOST = (process.env.DOCUSTAY_SIGN_HOST ?? "sign.docustay.app").toLowerCase();
// /templates/<name> is a public template page on the site host, and on the site host /templates itself is an old address of the template hub (it answers 301 to /free-templates); only the workspace's own template editor (/templates/rich) is sent to the app host.
// The workspace list /templates lives on the app host and must NOT be redirected there (see isAppHost and hooks.server.js).
const WORKSPACE = [/^\/(login|signup|forgot|reset|documents|settings|billing)(\/|$)/, /^\/templates\/rich(\/|$)/];
export const isAppHost = (host) => String(host ?? "").toLowerCase().split(":")[0] === APP_HOST;
export const isSiteHost = (host) => SITE_HOSTS.includes(String(host ?? "").toLowerCase().split(":")[0]);
/** Where a request on one of our own names belongs instead, or null if it is already in the right place. */
export function redirectFor(host, path, { appHost = APP_HOST, siteHosts = SITE_HOSTS, signHost = SIGN_HOST } = {}) {
  if (SELF) return null;
  const h = String(host ?? "").toLowerCase().split(":")[0];
  if (siteHosts.includes(h) && WORKSPACE.some((re) => re.test(path))) return `https://${appHost}${path}`;
  if (siteHosts.includes(h) && h.startsWith("www.") && siteHosts[0] !== h) return `https://${siteHosts[0]}${path}`;   // R8-71: www is one name for the site, not a second copy of it
  if (h === appHost && path === "/") return "/documents";
  if (h === signHost && !pathAllowed(path)) return `https://${siteHosts[0]}${path}`;
  return null;
}
