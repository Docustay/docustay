// src/mail/destination.mjs — WHERE MAY THE SERVER CONNECT FOR AN ORGANISATION'S OWN SMTP SERVER? (security audit run 5, S-4, 10 Oct 2026.)
//
// An organisation's admin names the SMTP host and port. Without a check the server opens a TCP connection to whatever they type — a cloud metadata address, Railway's private network, localhost, a
// database port — and the test email would read the server's greeting back to them. The rule is the one the outbound webhooks use (src/webhooks/outbound.mjs `assertPublicDestination`): the name must
// not be internal, it is RESOLVED, every address must be public, and the connection goes to the address that was judged (never to a second lookup of the name). The mail module may import nothing from the
// host (db/gates/mail_wall.mjs), so this file carries its own address ranges (node's net.BlockList) instead of importing src/http/trustedIp.mjs; src/http/publicDestination.mjs is the same rule for the
// HTTP side. Keep the two lists of ranges in step (test/r3_sec_destinations.test.mjs checks both against the same addresses).
//
// The ONE exception is a developer's own machine: when KEYSTONE_ENVIRONMENT is exactly "local", LOOPBACK addresses are allowed so the local stack and the tests can use Mailpit on 127.0.0.1. Every other
// private range stays refused there too; in sandbox and production nothing local is allowed.
import dns from "node:dns/promises";
import net from "node:net";

export class DestinationRefused extends Error {
  constructor(message) { super(message); this.name = "DestinationRefused"; this.code = "DESTINATION_REFUSED"; }
}

// `true` = loopback only (KEYSTONE_ENVIRONMENT=local); `"lan"` = loopback plus the private network of a SELF-HOSTED install (KEYSTONE_SELF_HOST=1: its mail server is normally on the same LAN); `false` = hosted.
const localDestinationsAllowed = (env = process.env) => (env?.KEYSTONE_SELF_HOST === "1" ? "lan" : env?.KEYSTONE_ENVIRONMENT === "local");

const BLOCKED = new net.BlockList();
for (const [net4, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) BLOCKED.addSubnet(net4, prefix, "ipv4");
for (const [net6, prefix] of [["::", 128], ["::1", 128], ["::", 96], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["100::", 64], ["2001:db8::", 32], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16]]) BLOCKED.addSubnet(net6, prefix, "ipv6");
const PRIVATE_MESSAGE = "that address is on a private or reserved network, which this service cannot connect to. Use a public mail server.";
const bare = (h) => (h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h);
const INTERNAL_SUFFIXES = [".internal", ".local", ".localdomain", ".lan", ".home.arpa", ".corp", ".intranet", ".private"];

const family = (a) => (net.isIPv4(a) ? "ipv4" : net.isIPv6(a) ? "ipv6" : null);
function isLoopback(a) {
  if (net.isIPv4(a)) return a.startsWith("127.");
  const l = a.toLowerCase();
  return l === "::1" || l === "::ffff:127.0.0.1" || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(l);
}
/** Private LAN ranges of a self-hosted install (RFC 1918, carrier-grade NAT as used by Tailscale, IPv6 unique-local). Link-local (cloud metadata), unspecified, multicast and reserved stay refused everywhere. */
function isLanAddress(a) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (m) { const [o1, o2] = [Number(m[1]), Number(m[2])]; return o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 100 && o2 >= 64 && o2 <= 127); }
  return /^f[cd][0-9a-f]{2}:/.test(a);
}
function isBlockedAddress(raw, { allowLocal = false } = {}) {
  const a = String(raw ?? "").trim().toLowerCase();
  const fam = family(a);
  if (!fam) return true;                                   // not an address at all: never connect to it
  if (allowLocal && isLoopback(a)) return false;
  if (allowLocal === "lan" && isLanAddress(a)) return false;
  return BLOCKED.check(a, fam);                            // BlockList judges an IPv4-mapped IPv6 address by its IPv4 rules
}

/** The name as written, before any lookup. Throws DestinationRefused. An IP literal is judged as an address (node never looks one up). */
function assertAllowedHostName(host, { allowLocal = false } = {}) {
  const h = bare(String(host ?? "").trim().toLowerCase().replace(/\.$/, ""));
  if (!h) throw new DestinationRefused("no address was given");
  if (family(h)) { if (isBlockedAddress(h, { allowLocal })) throw new DestinationRefused(PRIVATE_MESSAGE); return h; }
  if (h === "localhost" || h.endsWith(".localhost")) { if (allowLocal) return h; throw new DestinationRefused(PRIVATE_MESSAGE); }
  if (!h.includes(".") || INTERNAL_SUFFIXES.some((s) => h.endsWith(s))) { if (allowLocal) return h; throw new DestinationRefused(PRIVATE_MESSAGE); }
  return h;
}

/** The as-written check for a host typed into a settings form: null when acceptable, otherwise a sentence. (No lookup.) */
export function staticHostProblem(host, { allowLocal = localDestinationsAllowed() } = {}) {
  try { assertAllowedHostName(host, { allowLocal }); return null; } catch (e) { return e instanceof DestinationRefused ? e.message : "that is not a valid address"; }
}

async function defaultResolve(hostname) {
  if (family(hostname)) return [hostname];
  const found = await dns.lookup(hostname, { all: true, verbatim: true });
  return found.map((r) => r.address);
}

/**
 * Resolve `host` and refuse unless EVERY address is public. Returns the address to CONNECT TO (the one that was judged).
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
  return { host: name, address: addresses[0], addresses: [...addresses], isIp: family(name) !== null };
}
