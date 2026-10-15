// src/http/publicDestination.mjs — WHERE MAY THE SERVER CONNECT ON AN ORGANISATION'S BEHALF? (security audit run 5, 10 Oct 2026: S-4 and S-5.)
//
// An organisation's admin can name a host the server then connects to: its own SMTP server (src/mail/send.mjs) and its own AI endpoint (src/http/outside.mjs's `guard`).
// Without a check, that is a blind request from inside our network to anything the admin names — a cloud metadata address (169.254.169.254), Railway's private network,
// localhost, a database port — with the connection result (and a server's greeting banner) coming back in the error. This module is the same destination rule the outbound
// webhooks use (`assertPublicDestination`, src/webhooks/outbound.mjs; the address judgement is the same `isPrivateAddress`), made reusable for a host + any port:
//
//   · the name is checked as written (no `localhost`, `*.internal`, `*.local`, single-label names), and an IP literal is judged as an address;
//   · the name is RESOLVED, and every address it resolves to must be public — one private address refuses the lot;
//   · the connection is made to the address that was checked, never to a second lookup of the name (`resolvePublicHost` returns it; `pinnedLookup` hands it to node:net
//     so the socket that opens is the one that was judged — a DNS answer that changes between "check" and "connect" cannot move it);
//   · the ONE exception is a developer's own machine: when KEYSTONE_ENVIRONMENT is exactly "local", LOOPBACK addresses (127.0.0.0/8, ::1) are allowed so the local stack
//     and the tests can use Mailpit on 127.0.0.1. Every other private range stays refused there too. In sandbox and production nothing local is allowed.
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isPrivateAddress, isValidIp, normalise } from "./trustedIp.mjs";

class DestinationRefused extends Error {
  constructor(message) { super(message); this.name = "DestinationRefused"; this.code = "DESTINATION_REFUSED"; }
}

/**
 * What a "local" destination means here: `true` = loopback only (a developer's own machine, KEYSTONE_ENVIRONMENT=local); `"lan"` = loopback plus the install's own private network (a SELF-HOSTED install, KEYSTONE_SELF_HOST=1:
 * its mail server, webhook receiver and AI server normally live on the same LAN, and the people who run it own that network); `false` = a hosted service (sandbox, production) where nothing private is reachable.
 */
export const localDestinationsAllowed = (env = process.env) => (env?.KEYSTONE_SELF_HOST === "1" ? "lan" : env?.KEYSTONE_ENVIRONMENT === "local");

const UNSPECIFIED = new Set(["0.0.0.0", "::"]);
const PRIVATE_MESSAGE = "that address is on a private or reserved network, which this service cannot connect to. Use a public address.";
const bareHostname = (h) => (h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h);
const isLoopback = (a) => a === "::1" || /^127\./.test(a) || a === "::ffff:127.0.0.1";
/** Private LAN ranges a self-hosted install's own network uses (RFC 1918, carrier-grade NAT as used by Tailscale, IPv6 unique-local). Link-local (169.254.0.0/16: cloud metadata), unspecified, multicast and reserved stay refused everywhere. */
function isLanAddress(a) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (m) { const [o1, o2] = [Number(m[1]), Number(m[2])]; return o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 100 && o2 >= 64 && o2 <= 127); }
  return /^f[cd][0-9a-f]{2}:/.test(a);
}


/** Is this resolved address one we must not connect to? (Loopback is let through only when `allowLocal`.) */
function isBlockedAddress(raw, { allowLocal = false } = {}) {
  const address = (normalise(raw) ?? String(raw ?? "")).toLowerCase();
  if (allowLocal && isLoopback(address)) return false;
  if (allowLocal === "lan" && isLanAddress(address)) return false;
  return isPrivateAddress(address) || UNSPECIFIED.has(address);
}

const INTERNAL_SUFFIXES = [".internal", ".local", ".localdomain", ".lan", ".home.arpa", ".corp", ".intranet", ".private"];

/** The name as written, before any lookup. Throws DestinationRefused. (An IP literal is left to the address check.) */
function assertAllowedHostName(host, { allowLocal = false } = {}) {
  const h = bareHostname(String(host ?? "").trim().toLowerCase().replace(/\.$/, ""));
  if (!h) throw new DestinationRefused("no address was given");
  // an IP literal is never looked up (node:net connects straight to it), so it is judged here
  if (isValidIp(h)) { if (isBlockedAddress(h, { allowLocal })) throw new DestinationRefused(PRIVATE_MESSAGE); return h; }
  const local = h === "localhost" || h.endsWith(".localhost");
  if (local) { if (allowLocal) return h; throw new DestinationRefused(PRIVATE_MESSAGE); }
  if (!h.includes(".") || INTERNAL_SUFFIXES.some((s) => h.endsWith(s))) { if (allowLocal) return h; throw new DestinationRefused(PRIVATE_MESSAGE); }
  return h;
}

/** A URL as written: https (http only on a developer's machine), no credentials in it, an allowed name. Throws DestinationRefused. */
export function assertAllowedUrl(url, { allowLocal = false } = {}) {
  let u;
  try { u = url instanceof URL ? url : new URL(String(url ?? "")); } catch { throw new DestinationRefused("that is not a valid address"); }
  if (u.protocol !== "https:" && !(allowLocal && u.protocol === "http:")) throw new DestinationRefused("the address must start with https://");
  if (u.username || u.password) throw new DestinationRefused("the address must not contain a username or password");
  assertAllowedHostName(u.hostname, { allowLocal });
  return u;
}

async function defaultResolve(hostname) {
  if (isValidIp(hostname)) return [hostname];
  const found = await dns.lookup(hostname, { all: true, verbatim: true });
  return found.map((r) => r.address);
}

/**
 * Resolve `host` and refuse unless every address is public. Returns the address to CONNECT TO (the one that was judged).
 * @param {string} host  a name or an IP literal (brackets tolerated)
 * @param {{ allowLocal?: boolean, resolve?: (h: string) => Promise<string[]> }} [opts]  `resolve` is a test seam
 * @returns {Promise<{ host: string, address: string, addresses: string[], isIp: boolean }>}
 */
export async function resolvePublicHost(host, { allowLocal = localDestinationsAllowed(), resolve = defaultResolve } = {}) {
  const name = assertAllowedHostName(host, { allowLocal });
  let addresses;
  try { addresses = await resolve(name); } catch { addresses = []; }
  if (!Array.isArray(addresses) || addresses.length === 0) throw new DestinationRefused("that name could not be found");
  for (const a of addresses) if (isBlockedAddress(a, { allowLocal })) throw new DestinationRefused(PRIVATE_MESSAGE);
  return { host: name, address: addresses[0], addresses: [...addresses], isIp: isValidIp(name) };
}

/** A `lookup` for node:http / node:https / node:net that resolves AND judges in the same step, so the socket opens to a judged address. */
function pinnedLookup({ allowLocal = localDestinationsAllowed(), resolve = defaultResolve } = {}) {
  return (hostname, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : (options ?? {});
    resolvePublicHost(hostname, { allowLocal, resolve }).then(({ addresses }) => {
      const list = addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
      if (opts.all) cb(null, list); else cb(null, list[0].address, list[0].family);
    }, (err) => cb(err));
  };
}

const NULL_BODY_STATUS = new Set([204, 205, 304]);

/**
 * A fetch-shaped function for `callOutside` that (1) refuses a destination that is not public, at CONNECT time, (2) never follows a redirect (the 3xx is simply returned), and
 * (3) stops reading after `maxBytes`. It speaks node:http(s) directly because the global fetch cannot be told which address to connect to.
 */
export function makeGuardedFetch({ allowLocal = localDestinationsAllowed(), maxBytes = 2 * 1024 * 1024, resolve = defaultResolve } = {}) {
  const lookup = pinnedLookup({ allowLocal, resolve });
  return (url, init = {}) => new Promise((resolveFetch, reject) => {
    let u;
    try { u = assertAllowedUrl(url, { allowLocal }); } catch (e) { reject(e); return; }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method: init.method ?? "GET", headers: init.headers ?? {}, lookup, signal: init.signal }, (res) => {
      const chunks = []; let total = 0;
      res.on("data", (c) => {
        total += c.length;
        if (total > maxBytes) { res.destroy(new Error("the response was larger than allowed")); return; }
        chunks.push(c);
      });
      res.on("error", reject);
      res.on("close", () => { if (!res.complete) reject(new Error("the connection closed before the response was complete")); });
      res.on("end", () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) { for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) headers.append(k, String(one)); }
        const status = res.statusCode ?? 0;
        resolveFetch(new Response(NULL_BODY_STATUS.has(status) || status < 200 ? null : Buffer.concat(chunks), { status: status < 200 ? 502 : status, headers }));
      });
    });
    req.on("error", reject);
    if (init.body !== undefined && init.body !== null) req.write(init.body);
    req.end();
  });
}
