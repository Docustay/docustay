// src/http/customHost.mjs — A WORKSPACE'S OWN HOSTNAME SERVES ONLY THE PUBLIC PAGES (QUEUE §25.4).
// A request whose Host is not the platform's own (and not localhost / an IP / the hosting provider's address) must be a hostname a workspace attached; anything else is a plain 404. For an attached hostname only the
// signing / verify pages, the public API and the static assets are served — never the app, a login or any staff API — so a customer's domain can never become a second front door.
// The Host header is attacker-controlled, so it decides NOTHING about who may see what: tokens do that. This only narrows which paths a hostname will answer.
import { withCredentialLookup } from "../db/index.mjs";

const ALLOWED = [/^\/sign(\/|$)/, /^\/verify(\/|$)/, /^\/s\/[^/]+$/, /^\/api\/public\//, /^\/api\/telemetry$/, /^\/webapp\//, /^\/fonts\//, /^\/embed\//, /^\/favicon/, /^\/robots\.txt$/, /^\/readyz$/, /^\/healthz$/, /^\/tools\//];
const cache = new Map();           // host -> { at, status }
const TTL_MS = 30_000;

export const isPlatformHost = (host, appDomain = process.env.KEYSTONE_APP_DOMAIN) => {
  if (!host) return true;
  // a self-hosted install is served on the owner's own addresses (and reached by its web container as "app"): every host is the owner's, none is a customer's own signing hostname
  if (process.env.KEYSTONE_SELF_HOST === "1") return true;
  const h = host.toLowerCase().split(":")[0].replace(/\.$/, "");
  const base = String(appDomain ?? "").toLowerCase().replace(/\.$/, "");
  return h === "localhost" || /^[\d.]+$/.test(h) || h.startsWith("[") || h.endsWith(".railway.internal") || h.endsWith(".up.railway.app") || h === "healthcheck.railway.app" || h.endsWith(".localhost")
    || (base && (h === base || h.endsWith(`.${base}`)));
};

async function statusOfHost(host, lookup = defaultLookup) {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.status;
  const status = await lookup(host).catch(() => null);
  cache.set(host, { at: Date.now(), status });
  if (cache.size > 500) cache.clear();
  return status;
}
const defaultLookup = async (host) => (await withCredentialLookup((db) => db.query(`SELECT keystone.custom_domain_host_status($1) AS s`, [host]))).rows[0]?.s ?? null;
export const forgetHost = (host) => cache.delete(host);

/** The workspace behind a LIVE custom hostname (null for anything else) — how a public page on a workspace's own domain finds its workspace. */
export async function tenantForCustomHost(rawHost) {
  const host = String(rawHost ?? "").toLowerCase().split(":")[0].replace(/\.$/, "");
  if (!host) return null;
  const { rows } = await withCredentialLookup((db) => db.query(`SELECT keystone.custom_domain_host_tenant($1) AS id`, [host]));
  return rows[0]?.id ?? null;
}

const pathAllowedOnCustomHost = (path) => ALLOWED.some((re) => re.test(path));

/** Hono middleware: mount before the routes. */
export function customHostGuard({ lookup } = {}) {
  return async (c, next) => {
    const host = (c.req.header("host") ?? "").toLowerCase().split(":")[0].replace(/\.$/, "");
    if (isPlatformHost(host)) return next();
    const status = await statusOfHost(host, lookup);
    if (!status) return c.text("Not found", 404);
    if (!pathAllowedOnCustomHost(new URL(c.req.url).pathname)) return c.text("Not found", 404);
    return next();
  };
}
