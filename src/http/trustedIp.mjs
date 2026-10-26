// P12.8 / U28 — THE CLIENT IP, DERIVED FROM A TRUSTED FORWARDING HEADER.
//
// ★★★ WHY THIS FILE EXISTS AT ALL. `checkIpLimit` (rateLimit.mjs:23) allows 120 requests per
// minute PER IP, and it is the ONLY limiter that runs before authentication — per-tenant limiting
// cannot help an unauthenticated flood, because a flood never gets as far as having a tenant.
// Behind Railway or Cloudflare, `req.socket.remoteAddress` is THE PROXY'S address for every
// request that has ever arrived. So the naive implementation gives the ENTIRE PLATFORM one
// shared bucket of 120/min: the first busy tenant exhausts it and everybody else is rate-limited
// by traffic that is not theirs. ★ And it fails in the other direction too — an actual attacker
// is indistinguishable from every legitimate user, so the limiter can never be tightened.
//
// ★★ NEITHER HTTP CANDIDATE SUPPLIES THIS. Express has `trust proxy`; Hono and node:http have
// nothing equivalent, and §D1's comparison table records XFF trust as "hand-write either way".
// This is that hand-writing, and it is the whole reason the item exists.
//
// ★★★ AND THE NAIVE FIX IS WORSE THAN THE BUG. `xff.split(',')[0]` — the form found in most
// snippets — reads the LEFTMOST value, which is entirely attacker-supplied: anyone may send
// `X-Forwarded-For: 1.2.3.4` and be counted as a different client on every request, which
// removes the limiter rather than fixing it. The only sound rule is to walk from the RIGHT
// (the hop nearest us, which our own proxy appended and a client cannot forge) and skip exactly
// as many hops as we actually trust.

/** Private / loopback / link-local / CGNAT ranges — never a real client address on the internet. */
const PRIVATE_V4 =
  /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

const v4FromGroups = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * ★ Strip an IPv6-mapped IPv4 prefix, and a :port suffix on a bare v4 address.
 * ★ Exported (Stage 9 Task 9.7 / CT-074) so `src/webhooks/outbound.mjs`'s SSRF guard can normalise a
 *   resolved DNS address the same way an inbound XFF hop is normalised, before checking it against
 *   `isPrivateAddress` — behaviour unchanged, only the export keyword is new.
 */
export function normalise(raw) {
  let ip = String(raw ?? "").trim();
  if (!ip) return null;
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") === -1 ? undefined : ip.indexOf("]"));
  if (/^::ffff:/i.test(ip)) {
    // ★ IPv4-mapped IPv6 in BOTH spellings: dotted (::ffff:127.0.0.1) and hex (::ffff:7f00:1 — what a resolver or URL parser may hand back). Both become the plain dotted v4 address.
    const rest = ip.slice(7);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
    ip = hex ? v4FromGroups(parseInt(hex[1], 16), parseInt(hex[2], 16)) : rest;
  }
  // ★ Only strip a port from IPv4 — a bare IPv6 address is full of colons and would be destroyed.
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  return ip || null;
}

const isV4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split(".").every((o) => Number(o) <= 255);
const isV6 = (ip) => /^[0-9a-f:]+$/i.test(ip) && ip.includes(":");
export const isValidIp = (ip) => !!ip && (isV4(ip) || isV6(ip));

/** ★ Not a public unicast IPv4 address: private, loopback, link-local, CGNAT, "this network" (0/8), benchmarking (198.18/15), IETF protocol assignments (192.0.0/24), multicast (224/4) and reserved/broadcast (240/4). */
function isNonPublicV4(ip) {
  if (PRIVATE_V4.test(ip)) return true;
  const o = ip.split(".").map(Number);
  return o[0] === 0 || o[0] >= 224 || (o[0] === 198 && (o[1] === 18 || o[1] === 19)) || (o[0] === 192 && o[1] === 0 && o[2] === 0);
}

/** Parse an IPv6 address (any spelling: :: compression, an embedded dotted v4 tail, a zone id) into eight 16-bit numbers, or null when it is not one. */
function parseV6(raw) {
  let s = String(raw).toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    if (!isV4(tail[2])) return null;
    const o = tail[2].split(".").map(Number);
    s = `${tail[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parts = (h) => (h === "" ? [] : h.split(":"));
  const head = parts(halves[0]);
  const rest = halves.length === 2 ? parts(halves[1]) : [];
  if (halves.length === 1 ? head.length !== 8 : head.length + rest.length > 7) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * ★ Exported for the gate: is this an address that can never be a real remote client (and must never be a webhook destination)?
 *   IPv4: private / loopback / link-local / CGNAT / 0/8 / 198.18/15 / 192.0.0/24 / 224/4 / 240/4.
 *   IPv6: loopback, unspecified, unique-local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8, discard 100::/64,
 *   the IPv4-compatible block ::/96, IPv4-mapped ::ffff:0:0/96 (dotted AND hex spelling), NAT64 64:ff9b::/96 (and 64:ff9b:1::/48) and 6to4 2002::/16 — the last four judged by the IPv4 address they carry.
 */
export function isPrivateAddress(ip) {
  if (!ip) return true;
  if (isV4(ip)) return isNonPublicV4(ip);
  const l = ip.toLowerCase();
  const g = parseV6(l);
  if (!g) return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("fec");   // not parseable: the old prefix rules, nothing more
  const embedded = (hi, lo) => isNonPublicV4(v4FromGroups(hi, lo));
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]);                    // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return true;                                                      // ::, ::1 and the IPv4-compatible block
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 1 || (g.slice(2, 6).every((x) => x === 0) && embedded(g[6], g[7]));   // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]);                                                          // 6to4
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;                                 // discard-only
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}

/**
 * Resolve the client address.
 *
 * @param headers        a plain object or a Headers-like with .get()
 * @param socketAddress  the transport-level peer address
 * @param trustedHops    how many proxies WE operate, in front of this process.
 *
 * ★★★ `trustedHops` IS THE ENTIRE SECURITY PROPERTY AND IT DEFAULTS TO 0.
 *   0  → no proxy is trusted, the socket address is used, `X-Forwarded-For` is IGNORED ENTIRELY.
 *        This is correct for a process reached directly and is the ONLY safe default: a default
 *        of 1 on a directly-reachable process lets any client name its own address.
 *   1  → one proxy we operate (Railway's edge). The LAST value in XFF was written BY THAT PROXY
 *        and is the address it saw. Everything to its left is client-supplied and is discarded.
 *   n  → n proxies (e.g. Cloudflare in front of Railway): skip n-1 from the right, take the next.
 *
 * ★★ It is read from KEYSTONE_TRUSTED_PROXY_HOPS so it is a DEPLOYMENT fact, set once per
 * environment, rather than a constant a future refactor can quietly change for every environment
 * at the same time.
 */
export function trustedClientIp(headers, socketAddress, trustedHops = defaultTrustedHops()) {
  const get = (n) =>
    typeof headers?.get === "function"
      ? headers.get(n)
      : headers?.[n] ?? headers?.[n.toLowerCase()] ?? headers?.[n.toUpperCase()];

  const socket = normalise(socketAddress);

  // ★ hops = 0: the header is not merely un-preferred, it is NOT CONSULTED. A branch that reads
  //   it "only as a fallback" is the hole, because a request with no socket address is exactly
  //   what an attacker can arrange.
  if (!Number.isInteger(trustedHops) || trustedHops <= 0) return socket;

  const raw = get("x-forwarded-for");
  if (!raw) return socket;

  const hops = String(raw)
    .split(",")
    .map(normalise)
    .filter(isValidIp);
  if (hops.length === 0) return socket;

  // ★★★ FROM THE RIGHT. hops[len-1] was appended by the proxy nearest us. Skipping
  //   (trustedHops - 1) from the right lands on the address the OUTERMOST TRUSTED proxy saw.
  const idx = hops.length - trustedHops;
  if (idx < 0) {
    // ★ FEWER HOPS THAN WE TRUST. Something is misconfigured — the proxy chain is shorter than
    //   declared. FAIL CLOSED to the socket address rather than reaching further left into
    //   client-controlled values. A short chain must never be an opportunity.
    return socket;
  }
  return hops[idx] ?? socket;
}

export function defaultTrustedHops() {
  const raw = process.env.KEYSTONE_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  // ★ A non-numeric value is 0, not NaN-treated-as-truthy. Fail closed.
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * ★ A BOOT-TIME WARNING FOR THE MISCONFIGURATION THAT SHIPPED. [MEASURED 2 Oct 2026] KEYSTONE_TRUSTED_PROXY_HOPS
 *   was never set on Railway, so hops defaulted to 0 and EVERY visitor resolved to Railway's proxy address —
 *   every IP rate limit (sign-in, public booking, leads, …) was one bucket shared by the whole internet.
 *   Returns the warning text when we are on Railway (it always fronts us with exactly one edge proxy) and the
 *   hops are unset/0; null otherwise. The default stays 0 — the only safe default off Railway.
 */
export function trustedProxyWarning(env = process.env) {
  if (!env.RAILWAY_ENVIRONMENT && !env.RAILWAY_PROJECT_ID) return null;
  const n = Number(env.KEYSTONE_TRUSTED_PROXY_HOPS);
  if (Number.isInteger(n) && n >= 1) return null;
  return "KEYSTONE_TRUSTED_PROXY_HOPS is unset/0 on Railway: every visitor shares ONE rate-limit bucket (the proxy's address). Set it to 1.";
}
