// MS-18.2 — THE HOST HEADER → A TENANT SLUG.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NOTHING IN THIS PROJECT READ THE HOST HEADER BEFORE THIS FILE. [MEASURED 2026-09-15] zero
//     hits for `header("host")` anywhere in src/. Tenancy arrived one way only — from the Firebase
//     uid, through `resolve_tenants_by_firebase_uid`, at login. That stays true. This file adds a
//     SECOND, STRICTLY WEAKER signal used for ONE purpose: which logo to paint before anyone has
//     signed in.
//
// ★★★ THE HOST HEADER IS ATTACKER-CONTROLLED. A client sends whatever it likes. So the rule that
//     governs every line below:
//
//         ▸ THE HOST MAY DECIDE WHAT THE LOGIN SCREEN *LOOKS LIKE*.
//         ▸ THE HOST MAY NEVER DECIDE WHAT ANYONE *MAY SEE*.
//
//     Forging `Host: rival-practice.example.com` gets you that practice's public name and
//     logo — the same two things anyone gets by typing the address into a browser, which is the
//     entire point of a branded login page. It gets you nothing else, because the slug this module
//     produces is never an authorisation input.
//   ★★ AND WHEN IT *IS* PASSED TO LOGIN, IT STILL GRANTS NOTHING — by a property login.mjs already
//      proves rather than one this file asserts. `login()` computes the membership set from OUR
//      table, keyed on a uid Google vouched for, BEFORE any slug is read; a slug can only FILTER
//      that set (`src/auth/login.mjs:32-41`, :86-90). A forged host naming a practice the identity
//      does not belong to matches nothing and is refused. It cannot admit.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE VALIDATOR IS NOT REWRITTEN HERE. `validateSubdomain` (src/provisioning/subdomain.mjs) is
//    the INTERSECTION of every downstream system's rules plus the reserved list, and it is what
//    PROVISIONING uses to decide a slug is allowable in the first place. A second, looser parser on
//    the read side would accept hostnames provisioning can never mint — two answers to one question,
//    which is the defect class this project has met repeatedly. One validator, both directions.
//  ★ So `auth`, `www`, `app`, `api` and the rest of RESERVED resolve to null here for free: they
//    are platform hosts, no tenant can ever hold one, and the generic Keystone sign-in is correct
//    for all of them.

import { validateSubdomain } from "../provisioning/subdomain.mjs";

/**
 * The domain tenant subdomains hang off — e.g. `example.com`.
 *
 * ★★★ NO DEFAULT, AND THE ABSENCE IS THE FEATURE. CLAUDE.md §2.3's fail-loud rule, applied to a
 *     value that is not a secret but is just as dangerous to guess. If this were to default to
 *     `example.com`, then a staging deployment on some other domain would silently parse
 *     `acme.staging.example.com` against the wrong suffix and hand a REAL tenant's branding to a
 *     host that has nothing to do with it. An unset variable must produce "no tenant", loudly and
 *     everywhere, not a plausible-looking wrong answer.
 */
export const APP_DOMAIN_VAR = "KEYSTONE_APP_DOMAIN";

/**
 * Strip the port and normalise. Hosts are case-insensitive (RFC 4343); slugs are stored lowercase
 * and compared with lower() (subdomain.mjs:37-40), so the two only agree if this lowercases.
 *
 * ★ IPv6 literals (`[::1]:8080`) carry colons INSIDE brackets, so a naive split on ":" truncates
 *   them into nonsense. They can never be a tenant host, so they are rejected outright rather than
 *   mangled into something that might accidentally validate.
 */
function normaliseHost(rawHost) {
  if (typeof rawHost !== "string") return null;
  const host = rawHost.trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith("[")) return null;            // IPv6 literal — never a tenant
  const withoutPort = host.split(":")[0];
  // ★ A trailing dot is a legal fully-qualified hostname (`acme.example.com.`) and browsers do send
  //   it. Without this, the suffix match below fails and a real tenant renders unbranded.
  return withoutPort.replace(/\.$/, "") || null;
}

/**
 * @param {string|null|undefined} rawHost   the Host header, verbatim
 * @param {{ appDomain?: string|null }} opts
 * @returns {string|null} a slug that PROVISIONING would also accept, or null
 *
 * ★★ RETURNS null — NEVER THROWS, AND NEVER RETURNS A REASON. Every rejected case collapses to the
 *    same value: no Host, an unset app domain, the apex itself, a host on some other domain, a
 *    nested label, a reserved name, a syntactically invalid one. The CALLER cannot tell them apart,
 *    so it cannot leak them apart. See the route for why that matters.
 *  ★ Syntactic and reserved rejections are computable offline by anyone (the rules are in this
 *    repo, which is public), so collapsing them costs nothing and removes a whole class of "why is
 *    this one different" from the surface.
 */
export function subdomainFromHost(rawHost, { appDomain = process.env[APP_DOMAIN_VAR] } = {}) {
  const host = normaliseHost(rawHost);
  const base = normaliseHost(appDomain);
  if (!host || !base) return null;

  // ★ The apex itself, and `www` and friends, are not tenants. The apex is caught here; the
  //   reserved names fall out of validateSubdomain below.
  if (host === base) return null;

  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;

  const label = host.slice(0, -suffix.length);

  // ★★ A NESTED LABEL IS NOT A TENANT. `a.b.example.com` leaves `a.b`, and the `tls-certificate`
  //    rule in subdomain.mjs refuses an embedded dot for the exact reason that matters here: the
  //    wildcard certificate covers ONE label. Left unchecked, `evil.acme` would be read as the
  //    tenant `evil.acme` rather than refused. validateSubdomain catches it; this comment says why
  //    it must not be "helpfully" relaxed later.
  const verdict = validateSubdomain(label);
  return verdict.ok ? verdict.slug : null;
}

/**
 * Hono-flavoured convenience: the Host header this request actually arrived with.
 *
 * ★★★ `Host`, NOT `X-Forwarded-Host`. Behind Railway's edge both are usually present and equal, and
 *     preferring the forwarded one looks more "correct" — but X-Forwarded-Host is a header ANY
 *     client can set on a direct request, whereas Host is the one the edge itself rewrites. Reading
 *     the forwarded header first would mean a request could choose its own branding while bypassing
 *     the routing that is supposed to determine it. The difference is immaterial today (branding
 *     only) and would stop being immaterial the moment somebody reuses this helper for anything
 *     else, which is precisely when nobody re-reads the comment.
 */
export function subdomainFromRequest(c, opts = {}) {
  return subdomainFromHost(c.req.header("host"), opts);
}
