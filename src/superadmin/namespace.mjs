// P2.16 — SUPER ADMIN 1: ITS OWN ROUTE NAMESPACE, CHECKED SERVER-SIDE.
//
// ★★★ NOT PERMISSION-HIDDEN INSIDE THE TENANT APP. §K3 states the rule this file exists to obey:
// "CLIENT-SIDE ROLE GATING IS NOT A SECURITY BOUNDARY. Hiding a tab renders nothing unreachable.
// The server decides, every time, on every request."
//
// One bundle serves staff and clients (§K2), so staff code ships to a client's device. A
// super-admin surface implemented as a hidden route in that bundle is therefore:
//   - discoverable by reading the shipped JavaScript,
//   - reachable by typing the URL,
//   - and protected only by whatever the SERVER does when the request arrives.
// So the server check is the ONLY thing that matters, and it lives here.
//
// ★★ SUPER ADMIN 1 IS NOT A ROLE ON A TENANT USER. It is a separate principal list. Modelling it
// as `role = 'super_admin'` on `app_user` would put it inside the tenant tables, which means one
// mistaken UPDATE — or one tenant admin who can edit users — escalates to the whole platform.
// ★ "the maintainer and Grant, entire system. No tenant ever gets it."
//
// ★ It is also NOT a fifth render mode of the tenant app (§K3, final bullet).

import { forbidden, unauthenticated } from "../http/errors.mjs";

/** ★ The namespace is a distinct URL prefix, not a flag on a tenant route. */
export const SUPER_ADMIN_PREFIX = "/platform";

/**
 * ★★★ 11.1 — THE BOOTSTRAP EXEMPTION. Exactly one route: the request that asks for elevation
 * cannot itself require the elevation it grants. `isElevationRequest` demands EXACT equality on
 * both method and normalised path — never `startsWith`, never a regex, never a prefix — because a
 * pattern here is the thing that widens quietly later. Nothing is weakened by the exemption: the
 * route's own gate (`openPlatformSession`, `src/auth/operatorSession.mjs:92-95`) is what secures
 * it, unchanged. This does NOT make the two-step request/approve flow available — that path is
 * not built (F740).
 */
export const ELEVATION_ROUTE = Object.freeze({ method: "POST", path: "/platform/session" });

export function isElevationRequest(method, path) {
  return String(method).toUpperCase() === ELEVATION_ROUTE.method &&
    normalisePath(path) === ELEVATION_ROUTE.path;
}

/**
 * The principal list. Sourced from configuration, NOT from a tenant-writable table.
 * ★ Empty by default: a bug that fails to load the list must LOCK EVERYONE OUT, never let
 * everyone in.
 */
export function loadSuperAdmins(env = process.env) {
  const raw = env.KEYSTONE_SUPER_ADMIN_SUBJECTS;
  if (!raw) return new Set();
  return new Set(
    String(raw).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
}

export function isSuperAdminRoute(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  // ★ Normalise before comparing. `/platform/../tenant` and `//platform` must not slip past, and
  // `/platformer` must not be treated as inside the namespace.
  const norm = normalisePath(path);
  return norm === SUPER_ADMIN_PREFIX || norm.startsWith(SUPER_ADMIN_PREFIX + "/");
}

export function normalisePath(path) {
  let p = String(path).split("?")[0].split("#")[0];
  try { p = decodeURIComponent(p); } catch { /* keep the raw form if it will not decode */ }
  p = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return "/" + out.join("/");
}

/**
 * ★★ THE SERVER-SIDE CHECK. Called for EVERY request into the namespace, before any handler.
 * Returns the principal, or throws. It never returns a "denied" object a caller might ignore.
 */
export function authoriseSuperAdminRequest({ path, principal, operatorGrantId = null, tenantless = false }, { superAdmins } = {}) {
  if (!isSuperAdminRoute(path)) {
    throw new Error("authoriseSuperAdminRequest called for a non-platform route — check the wiring");
  }
  const allowed = superAdmins ?? loadSuperAdmins();

  if (!principal || !principal.subject) throw unauthenticated("not authenticated");

  // ★ A tenant session is NOT a platform session, no matter whose it is. Even if the maintainer is signed in
  // as a tenant user, that session does not carry platform authority — otherwise a compromised
  // tenant session would be a compromised platform.
  //
  // ★★★ `tokenId` IS CHECKED TOO, AND WITHOUT IT THIS RULE WAS UNREACHABLE IN PRODUCTION — D-17.29.
  //     [MEASURED 2026-09-13, src/auth/install.mjs:39-54] the REAL resolver returns
  //     `{ sessionId, tokenId, secretHash, subject }` and **NO `tenantId`** — deliberately, because
  //     "a principal carrying a caller-supplied tenantId would be tenant selection by the caller".
  //     So `principal.tenantId` was ALWAYS undefined for a real browser session and this branch
  //     NEVER RAN. A tenant session reaching /platform fell through to the allow-list instead and
  //     was refused only because `ks_<tokenId>` happens not to be listed.
  //     ★★ WHICH MEANT THE REFUSAL DEPENDED ON THE WRONG THING. Add that subject to
  //        KEYSTONE_SUPER_ADMIN_SUBJECTS — the one operation the list exists for — and an ORDINARY
  //        TENANT SESSION would have been admitted to the platform namespace. The rule that was
  //        supposed to stop that was dead code.
  //     ★★★ IT LOOKED PROVEN. `db/gates/p12_server.mjs` asserts this exact 403 and passes — because
  //         its stub principal SETS `tenantId`, which the real resolver never does. The fixture was
  //         more generous than reality, so the guard tested a shape that does not occur. That is why
  //         the stub has been changed to match `install.mjs` rather than this check being loosened.
  //     ★ `tokenId` is the discriminator that actually exists: a browser/tenant session is resolved
  //       from a session token and always has one; a platform principal has `platformTenantId` and
  //       no session token at all. Both are checked, so neither shape can slip through.
  //
  // ★★★ 11.1 — A LIVE OPERATOR GRANT IS THE IDENTITY FACT (0186), BUT THE GRANT ALONE IS NOT THE
  //     ADMISSION TEST. `resolve_session` finds the grant from the person's `firebase_uid` with no
  //     predicate on the session's kind or practice (0368, M), so a grant-holder's ORDINARY,
  //     day-to-day practice session carries an `operatorGrantId` too — admitting on the grant alone
  //     would let the four platform reads skip the operator session entirely. Hence `tenantless` is
  //     ANDed in below, and R1 names that case out loud rather than silently refusing it as an
  //     ordinary tenant session (which it is not).
  if (principal.tenantId || principal.tokenId) {
    const hasGrant = typeof operatorGrantId === "string" && operatorGrantId.length > 0;

    // R1 — a grant-holder using their ORDINARY practice session. The whole point of 11-B1: the
    // NARROW door admits only a tenantless operator session, never a grant plus any session.
    if (hasGrant && tenantless !== true) {
      throw forbidden("Open Platform from this sign-in first.");
    }
    // R2 — a tenantless (operator) session whose grant has expired or been revoked. Word-for-word
    // 11.19's PlatformGrantRequired sentence, so the door and the chain never describe the same
    // fact two ways.
    if (!hasGrant && tenantless === true) {
      throw forbidden("This session does not hold a live operator grant.");
    }
    // R3 — the ordinary tenant session, unchanged from before this task.
    if (!hasGrant && tenantless !== true) {
      throw forbidden("a tenant session cannot access the platform namespace");
    }
    // ADMIT — hasGrant && tenantless === true. The returned object is UNCHANGED: it gains neither
    // `operatorGrantId` nor `tenantless` (their only reader is namespace.mjs itself; nothing
    // downstream trusts a value handed forward — 11.20 re-resolves the session instead).
    return { subject: principal.subject, namespace: SUPER_ADMIN_PREFIX };
  }

  if (!allowed.has(String(principal.subject).toLowerCase())) {
    // ★ 403, and deliberately identical for "not on the list" and "list is empty".
    throw forbidden("not permitted");
  }

  return { subject: principal.subject, namespace: SUPER_ADMIN_PREFIX };
}

/**
 * ★ The guard the TENANT app applies in the other direction: a tenant route handler must never
 * serve a platform path, even if routing somehow delivers one.
 */
export function assertNotPlatformPath(path) {
  if (isSuperAdminRoute(path)) {
    throw forbidden("not permitted");
  }
}
