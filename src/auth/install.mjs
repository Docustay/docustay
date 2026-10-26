// P13.3 — WIRING. The one place the real stores replace the in-memory stand-ins.
//
// ★ It is a separate file from login.mjs so the GATE can drive login with a stub verifier while
//   the SERVER installs the real one, without either knowing about the other.

import { requestPasswordRecovery, verifyRecoveryCode, resetWithGrant, resetWithLink } from "./password.mjs";
import { localAuthEnabled } from "./localIdentity.mjs";
import { oidcEnabled, oidcLabel, beginOidc, finishOidc, readStateCookie, stateCookie, clearStateCookie } from "./oidc.mjs";
import { passkeysEnabled, requestOrigin, beginLogin, finishLogin } from "./passkeys.mjs";
import { AUTH_EMAIL } from "../email/authEmailLanguages.mjs";
/** The language a person asked for on the sign-in screen, only if we have words for it. */
// the browser keeps the cookie for the longest a session can live (a Docustay workspace: 30 days). The SERVER decides how long a session is valid (keystone_auth.session.expires_at, 12 hours for the platform, up to 30 days for Docustay: migration 0738), so a cookie that outlives its session is simply refused.
const SESSION_COOKIE_SECONDS = 30 * 24 * 3600;
const mailLang = (l) => (typeof l === "string" && Object.hasOwn(AUTH_EMAIL, l) ? l : null);
import { installSessionResolver, installApiTokenResolver, installWebhookResolver } from "../paths/index.mjs";
// ★ 7.23 — `hashSecret` is ALIASED because session.mjs exports one of the same name below. They are
//   different peppers over different credentials and must never be confused: `hashTokenSecret` is the
//   API-key HMAC (apiToken.mjs:88-91), `hashSecret` is the session one.
import { resolveTenantForToken, parseToken, hashSecret as hashTokenSecret } from "./apiToken.mjs";
import { withCredentialLookup, withTenant } from "../db/index.mjs";
import {
  resolveSession, parsePresented, hashSecret, revokeSession,
  // ★★★ TASK 8.14 — the two-step / session-list / Platform routes' own dependencies.
  //     resolvePartialSession/upgradeSession are F634's own additions (this same task, session.mjs
  //     §3 of field 4). The rest (revokeSessionById, revokeSessionsForUser, listSessionsForUser) are
  //     pre-existing exports (Stage 6, 6.4/6.5) that simply had no HTTP caller until now.
  resolvePartialSession, upgradeSession,
  revokeSessionById, revokeSessionsForUser, listSessionsForUser,
  // ★ the maintainer, 28 Sep 2026 — the app.->practice handoff's own reader (session.mjs's own header on it).
  redeemHandoffSession,
} from "./session.mjs";
import { login } from "./login.mjs";
import { subdomainFromRequest, APP_DOMAIN_VAR } from "./tenantFromHost.mjs";
import { unauthenticated, invalid, notFound } from "../http/errors.mjs";
// ★★★ TASK 8.12 — the invite and code routes' own dependencies (8.6, 8.7), plus the raw Firebase
//     verifier the accept route needs BEFORE `acceptInvite`/`login` ever run (see that route's own
//     comment for why the token is verified twice). None of the three is edited here — imports only.
import { requestEmailCode, verifyEmailCode } from "./emailCode.mjs";
import { previewInvite, acceptInvite } from "./invite.mjs";
import { verifyIdToken } from "./firebase.mjs";
// ★★★ TASK 8.14 — the two-step routes' own dependencies (8.8). beginEnrolment/confirmEnrolment/
//     disableTotp were, until this task, imported by no non-test module; verifyTotp already has one
//     non-test caller (operatorSession.mjs) and gains a second, direct one here for two-step/verify.
// ★★★ F637 — `getTwoStepStatus` ADDED. A third, additional export of totp.mjs; the four already
//     imported here are unchanged.
// ★★★ TASK 8.14 — 8.9's own wrappers, whose only prior caller was that module's own test file.
import { openPlatformSession, closePlatformSession } from "./operatorSession.mjs";
// ★★★ TASK 8.14 — the `auth.two_step_changed` sender (8.10), the SAME sender 8.12's code/request
//     route already calls, following requestEmailCode's own established pattern (no try/catch:
//     sendAuthEmail never throws on a delivery-level failure, only on a genuine config mistake).
import { registerTwoStepRoutes } from "./twoStepRoutes.mjs";
import { summary as twoStepSummary, trustTokenFrom } from "./twoStep.mjs";

/** Install the database-backed session store. Called once, at boot. */
export function installAuth() {
  installSessionResolver(async (presented) => (presented ? resolveSession(presented) : undefined));
  // ★★★ P19.11 — THE API-TOKEN PATH. Until now it read an in-memory Map, so no real key worked.
  //     `withCredentialLookup` gives a connection with NO tenant context, which is exactly right:
  //     this lookup is what DISCOVERS the tenant, so it necessarily runs before one exists.
  //   ★ 5.10 — `scope` travels from the route's `ROUTE_SCOPES` entry through `handleApiTokenRequest` to
  //     `authorize_api_token`; `process.env` is passed explicitly because `env` stays the THIRD parameter.
  installApiTokenResolver(async (presented, scope) =>
    withCredentialLookup((db) => resolveTenantForToken(db, presented, process.env, scope)).catch(() => null));
  // ★★★ P19.5a — THE INBOUND WEBHOOK ROUTING TABLE, in Postgres rather than a process-memory Map.
  //     ★ The SIGNATURE is verified before this runs (U29); by the time we are here the payload is a
  //       statement by a party holding the signing secret, not attacker-controlled input.
  installWebhookResolver(async (provider, externalRef) =>
    withCredentialLookup(async (db) => {
      const r = await db.query(`SELECT keystone.resolve_webhook_source($1,$2) AS t`, [provider, externalRef]);
      return r.rows[0]?.t ?? null;
    }).catch(() => null));
}

/**
 * ★★★ THE PER-REQUEST PRINCIPAL. It reads the session token and NOTHING ELSE.
 *
 * ★★ NOTE WHAT IS *NOT* HERE: no verifyIdToken. The Firebase token is exchanged ONCE, at login,
 * for a keystone session. Per-request verification would mean a `getUser()` network round trip to
 * Google on EVERY request (that is what `checkRevoked` costs), which makes a Firebase Auth outage
 * a TOTAL APPLICATION OUTAGE and puts a WAN hop in front of every read. P13.2b weighed both and
 * chose the session; this function is that decision made concrete.
 *
 * ★ The role is deliberately absent here too. `runTenantScoped` loads it from `app_user` INSIDE
 *   the tenant transaction (P13.6: from the database row, never from the token) — so there is no
 *   copy of a person's rank travelling around outside RLS.
 */
export async function resolvePrincipal(c) {
  const presented = bearerOrCookie(c);
  if (!presented) return null;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 7.23 — A DEVELOPER KEY IS A PRINCIPAL TOO, AND IT IS A NON-PERSON ONE.
  //
  //     `bearerOrCookie` already takes the Authorization header FIRST, so a `gl_live_…` key has
  //     always arrived here — and always died in `parsePresented` below (no match → null → 401).
  //     That 401 is the one Q7-11 names. This branch is the whole of "a key becomes a principal".
  //
  //   ★★ NO sessionId, NO user, NO appUserId, and that is the POINT, not an omission. A key
  //      authenticates a PRACTICE, not a person: `runTenantScoped` skips the two person-loading
  //      blocks for it, and `handleApiTokenRequest` resolves the tenant from the credential itself.
  //   ★★ NO DATABASE CALL — the file's own rule (see the note above). Parsing and hashing are local;
  //      the credential is verified inside the tenant transaction by
  //      `keystone.authorize_api_token`, which is the single enforcement point (CT-090).
  //   ★★★ THE RAW SECRET IS NOT CARRIED (F593 sub-ruling (c)). `handleApiTokenRequest` re-reads the
  //       Authorization header itself (src/paths/index.mjs:100), so the only consumer already has
  //       it. A principal object reaches handlers, log lines and error envelopes; the secret does
  //       not need to travel with it, so it does not.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (API_KEY_PREFIX.test(presented)) {
    let parsed;
    try {
      // ★ parseToken THROWS (apiToken.mjs:126-136) — it does not return null like parsePresented.
      //   Every malformed shape raises the same message on purpose, so there is nothing to branch
      //   on here: a bad key is simply not a principal, and the caller answers 401.
      parsed = parseToken(presented);
    } catch {
      return null;
    }
    return {
      apiKey: Object.freeze({
        tokenId: parsed.tokenId,
        secretHash: hashTokenSecret(parsed.secret),
        // ★ Which environment the PRESENTED key claims. It is carried for the ceiling lookup only;
        //   the authorisation path derives its own from the same prefix (apiToken.mjs:159-177), so
        //   nothing downstream trusts this copy.
        expectLive: parsed.environment === "live",
      }),
      // ★ `subject` must be populated — namespace.mjs:74 tests it FIRST and 401s when it is absent.
      //   api_key: + the PUBLIC token id, never the secret. It is also the actor vocabulary 7.24
      //   writes into the event envelope, so the two spellings are deliberately identical.
      subject: `api_key:${parsed.tokenId}`,
    };
  }

  // ★★★ THE TOKEN IS SPLIT AND HASHED HERE, LOCALLY, WITH NO DATABASE CALL — so that the person
  //     lookup later can run INSIDE withTenant() rather than outside it. See the note in
  //     runTenantScoped: loading the person inside the tenant transaction makes RLS a SECOND,
  //     independent reason the row must belong to that tenant.
  const parsed = parsePresented(presented);
  if (!parsed) return null;

  return {
    // ★★ handleBrowserRequest does the actual tenant resolution, so the SESSION TOKEN is what
    //    travels, not a tenant id. A principal carrying a caller-supplied tenantId would be
    //    tenant selection by the caller — the exact defect §D5 names on the queue path.
    sessionId: presented,
    tokenId: parsed.tokenId,
    secretHash: hashSecret(parsed.secret),
    // ★ `subject` is populated because namespace.mjs:74 tests it FIRST and throws 401 when it is
    //   absent. Without it an authenticated tenant user is refused the platform namespace as
    //   though they had presented no credential at all — 401 where U14 requires 403. [EXECUTED
    //   in Phase 12.] They are authenticated and NOT PERMITTED, and that is 403.
    // ★ ks_ + the PUBLIC token_id, never the secret. It is an opaque handle for the platform
    //   namespace check and for logs.
    subject: `ks_${parsed.tokenId}`,
  };
}

// ★★ 7.23 — the two live prefixes, and NOTHING ELSE decides the branch above. It is deliberately a
//    prefix test and not a full-shape test: a string that starts `gl_live_`/`gl_test_` and is
//    otherwise malformed must reach `parseToken` and be REFUSED as a key, never fall through and be
//    re-read as a session token. Falling through would make a mangled key and a mangled session
//    indistinguishable in the logs, and it would be one more place the 401 could differ by input.
const API_KEY_PREFIX = /^(?:gl|dsk)_(live|test)_/;

function bearerOrCookie(c) {
  const auth = c.req.header("authorization");
  const m = /^Bearer\s+(.+)$/i.exec(auth ?? "");
  if (m) return m[1].trim();
  const cookie = c.req.header("cookie") ?? "";
  const km = /(?:^|;\s*)ks_session=([^;]+)/.exec(cookie);
  return km ? decodeURIComponent(km[1]) : null;
}

/**
 * ★ 6.11 — the login route's `requestedSlug`. A weak, LOCAL parse of the Host header: the first
 *   label, lower-cased, and `null` for anything that is not a tenant subdomain — the bare apex,
 *   an IPv4/IPv6 literal, `localhost`, or Railway's own default `*.up.railway.app` host. `null` is
 *   the "behave exactly as today" path (login.mjs:114-116), so an ambiguous host must resolve to
 *   `null`, never a guess.
 *   ★★ Deliberately NOT `subdomainFromHost` (tenantFromHost.mjs): that helper VALIDATES against
 *      `validateSubdomain` and the configured `APP_DOMAIN_VAR`, because a WRONG answer there is a
 *      public branding leak. Here a wrong answer is refused downstream anyway — `login()` can only
 *      NARROW an already-computed membership set with this value, never admit — so the weaker,
 *      dependency-free parse is enough and keeps this route's device/host work self-contained.
 */
function slugFromHost(rawHost) {
  if (typeof rawHost !== "string") return null;
  const host = rawHost.trim().toLowerCase();
  if (!host) return null;
  const withoutPort = host.split(":")[0];
  if (!withoutPort || withoutPort === "localhost") return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(withoutPort)) return null; // IPv4 literal
  if (host.startsWith("[") || withoutPort.includes("::")) return null; // IPv6 literal
  if (withoutPort.endsWith(".up.railway.app")) return null; // Railway's own default host
  const labels = withoutPort.split(".");
  if (labels.length < 3) return null; // bare apex (`domain.tld`) — no subdomain present
  return labels[0];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK 8.14 — the two-step / session-list / Platform routes' own two small helpers.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ "SIGNED-IN" FOR THIS TASK'S SEVEN ROUTES (all but `two-step/verify`, which resolves a
 * PARTIAL session instead, and `DELETE /api/platform/session`, which needs only the raw presented
 * string — see those two routes' own code). Resolves the caller's ORDINARY session (never a
 * partial one — `keystone.resolve_session`, 0228, excludes `kind='partial'` by construction) and
 * re-reads the person's `firebase_uid`/`email` inside `withTenant`, the SAME "load the person from
 * the row, inside the tenant transaction, never from the token" idiom `login()` and
 * `src/http/app.mjs`'s own `loadPerson` already use — a second, independent, RLS-enforced check
 * that the row belongs to the tenant the session named.
 * ★ A Platform ('operator') session's row carries `tenant_id: null, app_user_id: null` (0209) —
 *   whatever `resolveSession` returns for it, `resolved?.tenantId`/`resolved?.userId` are falsy
 *   either way, so this throws `unauthenticated` for it exactly as it does for no session at all.
 *   That is test (h)'s "a Platform session calling a practice route gets nothing".
 */
async function loadSelf(c) {
  const principal = await resolvePrincipal(c);
  if (!principal?.tokenId) throw unauthenticated("sign in required");
  const resolved = await resolveSession(principal.sessionId);
  if (!resolved?.tenantId || !resolved?.userId) throw unauthenticated("sign in required");
  const person = await withTenant(resolved.tenantId, async (db) => {
    const { rows } = await db.query(
      `SELECT u.firebase_uid, u.email, t.product FROM keystone.app_user u JOIN keystone.tenant t ON t.id = u.tenant_id WHERE u.id = $1`,
      [resolved.userId]
    );
    return rows[0] ?? null;
  });
  if (!person?.firebase_uid) throw unauthenticated("sign in required");
  return {
    tenantId: resolved.tenantId,
    appUserId: resolved.userId,
    tokenId: principal.tokenId,
    firebaseUid: person.firebase_uid,
    email: person.email,
    product: person.product,
    productName: person.product === "docustay" ? "Docustay" : "Workbench",
  };
}

/** ★★★ A COARSE SUMMARY, NEVER THE RAW STRING (route table bullet (d)) — a browser/OS pair, no
 *  version numbers, no raw string an entry in this list could be reversed from. No location field
 *  is added here: there is no geo-IP data source anywhere in this codebase (checked — nothing under
 *  `src/` resolves an IP to a place), and inventing one from the `ip_first_seen` column this route
 *  must never expose (bullet (d)) would be fabricating a field CLAUDE.md's "field lists come from
 *  the canonical source, not from imagination" rule refuses. Not tested by name (test (d) checks
 *  only the ABSENCE of `ip`/a full user-agent and the PRESENCE of `tokenId`/`createdAt`/`kind`) —
 *  recorded here rather than guessed at.
 */
function userAgentParts(raw) {
  const ua = String(raw ?? "");
  if (!ua) return null;
  const os = /Windows/.test(ua) ? "Windows"
    : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /Linux/.test(ua) ? "Linux"
    : null;
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  return { browser, os };
}
function userAgentSummary(raw) {
  const p = userAgentParts(raw);
  return p ? `${p.browser ?? "an unknown browser"} on ${p.os ?? "an unknown OS"}` : "unknown device";
}

const appDomain = () => process.env[APP_DOMAIN_VAR] || "example.com";

/**
 * ★★★ the maintainer, 28 Sep 2026 — TRUE ONLY ON THE CENTRAL ENTRY HOST, `app.{domain}`. Checked as an EXACT
 *     first-label match, not "any reserved name" (`auth.`/`admin.`/etc. are reserved for OTHER
 *     reasons — squatting prevention, mostly — and must keep behaving like an ordinary unscoped
 *     host, i.e. the pre-existing API-client path). `slugFromHost` is the weak, unvalidated parser
 *     already used just below for `requestedSlug` — deliberately not `subdomainFromRequest`, which
 *     would (correctly, for ITS purpose) refuse to tell "app" apart from any other reserved label.
 */
function isCentralAppHost(rawHost) {
  return slugFromHost(rawHost) === "app";
}

/** POST /api/auth/login  ·  POST /api/auth/logout */
export function registerAuthRoutes(app, { loginImpl = login } = {}) {
  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    const idToken = body?.idToken;
    if (!idToken) throw unauthenticated("no id token presented");
    const host = c.req.header("host");
    // ★ D554 — a self-host has one organisation and no tenant subdomains: behind the web container the app sees an internal Host ("app.railway.internal", "app:8080") whose first label reads as the central "app" host, which sent every sign-in to https://<slug>.example.com. No handoff, no slug from the Host there.
    const selfHost = process.env.KEYSTONE_SELF_HOST === "1";
    const handoff = !selfHost && isCentralAppHost(host);
    // ★★ P5.1 — the tenant switcher's only mechanism. It NARROWS a set already computed from our
    //    own table; it cannot grant access to a practice this identity does not belong to. See the
    //    header on `login()` for why the Firebase claim cannot serve here.
    // ★ On the central host, `requestedSlug` is passed as null, NEVER as the literal "app" label —
    //   "app" is not a tenant and would incorrectly narrow-then-refuse a single-membership
    //   identity exactly the way a real wrong-practice host does. `slugFromHost` already returns
    //   null for the bare apex; the central host needs the SAME behaviour deliberately forced.
    const r = await loginImpl(idToken, {
      tenantSlug: body?.tenantSlug ?? null,
      requestedSlug: handoff || selfHost ? null : slugFromHost(host),
      userAgent: c.req.header("user-agent") ?? null,
      ip: c.get("clientIp") ?? null,
      handoff,
      trustedDeviceToken: trustTokenFrom(c.req.header("cookie")),
    });

    // ★★★ the maintainer, 28 Sep 2026 — THE PRACTICE PICKER BRANCH. No session anything yet — `login()`
    //     returned the caller's own practice list instead of a token (see its own header on this
    //     branch). The client shows "choose your practice" and resubmits the SAME idToken with
    //     `tenantSlug` set to the one picked, which lands back here and narrows cleanly.
    if (r.needsPracticePick) {
      return c.json({ needsPracticePick: true, practices: r.practices });
    }

    // ★★★ THE HANDOFF BRANCH. No cookie is set here — a cookie minted on `app.{domain}` cannot be
    //     read on `{slug}.{domain}` (different host, no shared `Domain=` — see app.mjs's own
    //     header on why that stays true). Instead the ALREADY-RESOLVED practice's own address is
    //     handed back so the CLIENT can navigate there; the one-time token in the query string is
    //     what actually crosses, not a credential the browser could otherwise carry.
    if (r.handoff) {
      return c.json({
        redirectTo: `https://${r.tenantSlug}.${appDomain()}/api/auth/handoff/redeem` +
          `?token=${encodeURIComponent(r.token)}`,
      });
    }

    // ★★ THE SECRET IS RETURNED EXACTLY ONCE, HERE, AND IS NEVER RETRIEVABLE AGAIN — only its
    //    HMAC is stored. Same capture-at-creation rule as an API key (P19.4).
    // ★ HttpOnly + SameSite=Lax + Secure: a session readable by JavaScript is a session an XSS
    //   takes with it.
    c.header(
      "set-cookie",
      `ks_session=${encodeURIComponent(r.token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_SECONDS}`
    );
    return c.json({
      // ★ No tenant slug, no email, no uid echoed back. The client does not need them and each
      //   one is a value an XSS could exfiltrate more conveniently than it could a cookie.
      appUserId: r.appUserId, role: r.role, staffRole: r.staffRole, displayName: r.displayName,
      // R13-D505: the fourth-device notice (Free workspace) must reach the browser; the page keeps it for the first screen after sign-in
      ...(r.deviceNotice ? { deviceNotice: r.deviceNotice } : {}),
      // ★★★ F634 / 8.14 — THE ONE ADDED LINE. Still a 200: the credential and the tenancy are both
      //     genuinely good, only the second factor is outstanding. The set-cookie header above is
      //     unchanged — for a partial session r.token IS the partial session's own presented
      //     string, so the browser gets the right cookie for free.
      ...(r.requiresTwoStep ? { requiresTwoStep: true } : {}),
      // ★★★ P0.7 — `token: r.token` WAS HERE AND IS GONE. [F109] The session secret was handed to
      //     JavaScript in the same response that set it as an HttpOnly cookie, which defeats the
      //     cookie. THREE comments in two files asserted the opposite and none of them was code:
      //     `:50-51` (*"a session readable by JavaScript is a session an XSS takes with it"*),
      //     `:56-58` (*"No tenant slug, no email, no uid echoed back"*) and
      //     `web/src/lib/api.js:31-33` (*"the front end never SEES the session"*).
      //   ★ Nothing consumed it — `web/src/auth/Login.jsx:101` discards the response entirely.
      //   ★★ `displayName` STAYS: it is not a secret, and P5.13's avatar needs it. It is sent once
      //      here because `/api/nav` deliberately returns no name and there is no `/api/me`.
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // the maintainer, 28 Sep 2026 — GET /api/auth/handoff/redeem. The other half of the app.->practice handoff:
  // reached ONLY on a practice's own host (the URL `POST /api/auth/login` on app. just handed
  // back), redeems the one-time token, sets the SAME host-only cookie an ordinary sign-in sets,
  // and 302s into the app — no extra client-rendered page, no extra round trip.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/auth/handoff/redeem", async (c) => {
    const presented = c.req.query("token");
    // ★ A missing/malformed/expired/already-used token all collapse to the SAME destination — the
    //   practice's own login screen, with nothing an attacker could use to distinguish "expired"
    //   from "never existed" from "already redeemed by someone else watching the URL bar".
    if (!presented) return c.redirect("/login?problem=handoff", 302);
    const redeemed = await redeemHandoffSession(presented);
    if (!redeemed) return c.redirect("/login?problem=handoff", 302);

    // ★ Re-derives the two-step decision from the SAME source login() itself reads
    //   (hasConfirmedFactor(uid)) — the handoff mint deliberately did not carry this decision
    //   across the origin boundary (login.mjs's own header on the `handoff` option says why).
    const requiresTwoStep = (await twoStepSummary(redeemed.firebaseUid)).on;
    let presentedForCookie = presented;
    if (!requiresTwoStep) {
      // ★ redeemHandoffSession already landed the row at kind='partial' (1 hour) — upgradeSession
      //   is the SAME promote-in-place call an ordinary two-step-pending sign-in uses once its own
      //   second factor succeeds. The token_id/secret string does not change on upgrade, so the
      //   cookie value set below is correct either way.
      const upgraded = await upgradeSession(presented);
      if (!upgraded) return c.redirect("/login?problem=handoff", 302);
    }
    c.header(
      "set-cookie",
      `ks_session=${encodeURIComponent(presentedForCookie)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_SECONDS}`
    );
    return c.redirect("/", 302);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // MS-18.2 · GET /api/auth/branding — WHOSE LOGIN SCREEN IS THIS?
  //
  // ★★★ UNAUTHENTICATED BY NECESSITY, NOT BY OVERSIGHT. It is read to DRAW the sign-in form, so it
  //     runs before any credential exists. Stated plainly because it has a real consequence: this
  //     endpoint tells the internet which subdomains are live practices. That was ruled acceptable
  //     deliberately, and it is bounded two ways — by the SQL function's return type (three
  //     presentation strings, structurally incapable of carrying a count or a person), and by the
  //     collapse below.
  //
  // ★★★ ONE ANSWER FOR EVERY REFUSAL. Unknown subdomain, SUSPENDED tenant, provisioning, closed,
  //     reserved name, malformed host, the apex itself, a host on another domain entirely — all of
  //     them return `200 {tenant:null}`. Identical status, identical body, identical shape.
  //   ★★ WHY 200 AND NOT 404: a 404 for "no such practice" against a 200 for a real one IS the
  //      directory, even with an empty body. The status code is as much of an oracle as the body,
  //      and it is the half people forget.
  //   ★★ WHY THE STATUS FILTER IS NOT IN THIS FILE: "suspended" and "absent" are collapsed inside
  //      `resolve_login_branding_by_slug`'s single WHERE clause (migration 0121), so the two cases
  //      never take different code paths, never differ in timing and never differ in what they log.
  //      A check here — `if (row.status !== 'active')` — would restore the oracle while looking
  //      exactly as safe. Do not add one.
  //
  // ★ NO EXTRA RATE LIMIT. The per-IP limiter at http/app.mjs:95-102 already runs on `*`, before
  //   authentication and before any database round trip, which is the right place for it.
  app.get("/api/auth/branding", async (c) => {
    // ★ `Vary: Host` because the body is a pure function of the Host header, and `no-store` because
    //   a shared cache that keys on path alone would hand one practice's mark to another. A 60-second
    //   win on one indexed lookup is not worth that failure mode.
    c.header("cache-control", "no-store");
    c.header("vary", "Host");

    const slug = subdomainFromRequest(c);
    // ★ Returns before touching the database. Reserved and malformed labels are computable offline
    //   by anyone (the rules are in this repo, which is public), so skipping the query for them
    //   leaks nothing — while the two cases that MUST be indistinguishable, absent and suspended,
    //   both go through the query below and are separated by nothing.
    if (!slug) return c.json({ tenant: null });

    const rows = await withCredentialLookup(async (db) => {
      const r = await db.query(
        `SELECT display_name, logo_url
           FROM keystone.resolve_login_branding_by_slug($1)`,
        [slug]
      );
      return r.rows;
    });

    const row = rows[0];
    if (!row) return c.json({ tenant: null });

    return c.json({
      tenant: {
        // ★ KS-5.6 (src/settings/keys.mjs:169): a tenant with no logo falls back to their NAME in
        //   text, and Keystone's mark is NEVER substituted for a tenant's. `displayName` is
        //   therefore always present for an active tenant; the other two may be null.
        displayName: row.display_name,
        // ★ TY, 2026-09-16 — an uploaded logo is a storage pointer; hand the browser our own URL.
        logoUrl: (() => {
          const v = row.logo_url ?? null;
          const m = v && /^ks-object:t\/[0-9a-f-]{36}\/brand_logo\/([A-Za-z0-9._-]{1,128})$/i.exec(v);
          if (m) return `/api/auth/branding/logo?v=${encodeURIComponent(m[1])}`;
          return v && /^https:\/\//.test(v) ? v : null;
        })(),
        // ★★★ NO COLOUR. This route answers BEFORE any session exists, so anything it returns is
        //     readable by the whole internet for any slug it can guess. The tenant hue was removed
        //     product-wide (S8); leaving it in the most exposed read in the system would have been
        //     the worst place of the five to forget it.
        // ★★ THE SLUG IS ECHOED BACK **ONLY BECAUSE IT RESOLVED**, and it is the one case where
        //    echoing is not an oracle: the caller already sent this host, and it is returned only
        //    on the success branch, so it confirms nothing the `tenant:null` branch would deny.
        //    The client needs it to pass `tenantSlug` to login — which can narrow but never admit
        //    (src/auth/login.mjs:32-41).
        slug,
      },
    });
  });

  // ★ TY, 2026-09-16 — GET /api/auth/branding/logo — the sign-in logo's BYTES, before any session.
  //   Same resolution as /api/auth/branding: the Host decides the practice, never a parameter, so
  //   no caller can ask for another practice's file. The pointer itself is written only by the
  //   authenticated upload route, from the session's own tenant id.
  app.get("/api/auth/branding/logo", async (c) => {
    c.header("vary", "Host");
    const slug = subdomainFromRequest(c);
    if (!slug) return c.json({ error: { kind: "not_found", message: "no logo" } }, 404);
    const rows = await withCredentialLookup(async (db) =>
      (await db.query(`SELECT logo_url FROM keystone.resolve_login_branding_by_slug($1)`, [slug])).rows);
    const m = /^ks-object:(t\/[0-9a-f-]{36}\/brand_logo\/[A-Za-z0-9._-]{1,128})$/i.exec(rows[0]?.logo_url ?? "");
    if (!m) return c.json({ error: { kind: "not_found", message: "no logo" } }, 404);
    const { getObject } = await import("../storage/s3.mjs");
    const got = await getObject({ key: m[1] });
    if (!got.ok) return c.json({ error: { kind: "not_found", message: "no logo" } }, 404);
    const b = got.body;
    const type = b[0] === 0x89 ? "image/png" : b[0] === 0xff ? "image/jpeg" : "image/webp";
    return c.body(b, 200, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  });

  app.post("/api/auth/logout", async (c) => {
    // ★ Logout is best-effort by design: a caller with no valid session still gets a 204 and a
    //   cleared cookie. Telling them "that session did not exist" is an oracle. ★★ CT-024/F472 —
    //   the row is now revoked too, but the response contract above is unchanged: 204, a cleared
    //   cookie, no body, whether the revoke found a row, found none, or threw.
    const presented = bearerOrCookie(c);
    if (presented) {
      try {
        await revokeSession(presented, "logout");
      } catch {
        // best-effort — a credential-store failure must not turn a sign-out into a 500 that
        // leaves the person signed in.
      }
    }
    c.header("set-cookie", "ks_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    return c.body(null, 204);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // TASK 8.12 — THE INVITE AND CODE ROUTES. All four are unauthenticated by necessity (spec 04 §5,
  // §7): whoever calls them has no session yet — that is the entire reason each exists. The
  // same-origin check (CT-020, `src/http/app.mjs:224-244`) and the per-IP limiter
  // (`src/http/app.mjs:147-153`) already run ahead of every route under `/api/*`, mutating or not,
  // so nothing here adds either a second time.
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  // ★★★ F626 gap 1 (RESOLVED 21 Sep 2026) — NO `checkEmailLimit` CALL HERE, ON EITHER SCOPE.
  //     `requestEmailCode` (`src/auth/emailCode.mjs:99-112,127-130`, task 8.7) already spends the
  //     WHOLE 5-per-15-minute budget, per email AND per IP, against the SAME table/RPC
  //     `checkEmailLimit` would hit — an outer call here would double-spend that shared bucket.
  //     See STAGE-8-PLAN.md task 8.12 §4 and FINDINGS.md F626 for the full reasoning.
  app.post("/api/auth/code/request", async (c) => {
    // the emailed code signs in through Firebase; a deployment on the built-in password identity has none, and must say so plainly instead of failing inside (found by the live-customer program, D-001)
    if (localAuthEnabled()) throw notFound("Emailed sign-in codes are not available on this server. Sign in with your password.");
    const body = await c.req.json().catch(() => null);
    const result = await requestEmailCode({
      email: body?.email, purpose: "sign_in", ip: c.get("clientIp") ?? null,
      product: body?.product === "docustay" ? "docustay" : null, lang: body?.product === "docustay" ? null : mailLang(body?.lang),   // Docustay's own sign-in screen: the mail says Docustay, in English (Docustay v1 is English only)
    });
    return c.json(result);
  });

  /** Docustay's own "forgot password" — always the same answer. A six-digit code is emailed (with the old link beside it for another device). */
  app.post("/api/auth/password-reset/request", async (c) => {
    const body = await c.req.json().catch(() => null);
    return c.json(await requestPasswordRecovery({ email: body?.email, ip: c.get("clientIp") ?? null, product: body?.product === "docustay" ? "docustay" : null, lang: body?.product === "docustay" ? null : mailLang(body?.lang) }));
  });
  /** The typed code → a ten-minute, single-use grant for choosing the new password. The code itself never leaves the body of this request. */
  app.post("/api/auth/password-reset/code", async (c) => {
    const body = await c.req.json().catch(() => null);
    return c.json(await verifyRecoveryCode({ email: body?.email, code: body?.code }));
  });
  /** The grant + the new password. Signs nobody in; every session ends, remembered devices are forgotten, the person is emailed; two-step is asked at the next sign-in. */
  app.post("/api/auth/password-reset/set", async (c) => {
    const body = await c.req.json().catch(() => null);
    return c.json(await resetWithGrant({ email: body?.email, grant: body?.grant, password: body?.password, product: body?.product === "docustay" ? "docustay" : "docustay" }));
  });
  /** The fallback link from the same email (another device): the one-time link code and the new password, finished here so it does the same follow-up. */
  app.post("/api/auth/password-reset/link", async (c) => {
    const body = await c.req.json().catch(() => null);
    return c.json(await resetWithLink({ oobCode: body?.oobCode, password: body?.password }));
  });

  /** The built-in identity's own reset (D-006): spend the emailed one-time token, set the new password. Only where local sign-in is on. */
  app.post("/api/auth/local/reset", async (c) => {
    if (!localAuthEnabled()) throw notFound("Password reset by this route is not available on this server.");
    const body = await c.req.json().catch(() => null);
    return c.json(await resetWithLink({ oobCode: body?.token, password: body?.password }));
  });

  /** Redeem a code, mint a Firebase custom token. No session, no cookie — the browser exchanges
   *  this for an id token at Google's own endpoint and posts THAT to /api/auth/login. */
  app.post("/api/auth/code/verify", async (c) => {
    if (localAuthEnabled()) throw notFound("Emailed sign-in codes are not available on this server. Sign in with your password.");
    const body = await c.req.json().catch(() => null);
    const result = await verifyEmailCode({ email: body?.email, code: body?.code, purpose: "sign_in" });
    return c.json(result);
  });

  /** ★ A READ-ONLY PREVIEW (CCR-11's `peekLinkToken`) — spends no redemption, so the accept screen
   *  can say "you were invited to {practice} as {role}" before asking for a password, and the link
   *  still works afterwards. */
  app.get("/api/auth/invite/:token", async (c) => {
    const result = await previewInvite({ presented: c.req.param("token") });
    return c.json(result);
  });

  /** ★★★ `email`/`uid` COME FROM THE VERIFIED TOKEN, NEVER FROM THE BODY (F494's rule, extended to
   *  the accept surface) — a hostile `email`/`uid`/`role`/`staffRole`/`tenantId` in the body changes
   *  nothing. The token is verified TWICE, deliberately: once here, to hand `acceptInvite` an
   *  identity it can check the invite's own stored email against BEFORE any write; and again inside
   *  `loginImpl`, which is the ONLY path that mints a session (spec 04 §11's "one login path") and
   *  verifies its own credential rather than trusting a caller's prior check of it. */
  app.post("/api/auth/invite/accept", async (c) => {
    const body = await c.req.json().catch(() => null);
    const idToken = body?.idToken;
    if (!idToken) throw unauthenticated("no id token presented");
    const decoded = await verifyIdToken(idToken, { checkRevoked: true });
    const uid = decoded?.uid ?? decoded?.sub;
    const email = decoded?.email;

    const accepted = await acceptInvite({ presented: body?.token, firebaseUid: uid, email, mobilePhone: body?.mobilePhone ?? null });

    // ★ The just-accepted practice's OWN slug — so a person who already belongs to ANOTHER
    //   practice too (login()'s multi-membership branch) is narrowed to the one just accepted,
    //   never left to sign in against the ambiguous-membership refusal.
    const slugRows = await withTenant(accepted.tenantId, async (tx) =>
      (await tx.query(`SELECT slug FROM keystone.tenant WHERE id = $1`, [accepted.tenantId])).rows);
    const slug = slugRows[0]?.slug ?? null;

    const session = await loginImpl(idToken, { tenantSlug: slug });
    // ★ The EXACT SAME attribute string POST /api/auth/login sets, above (`:184-186`) — one cookie
    //   contract, never a second one for a second entry point.
    c.header(
      "set-cookie",
      `ks_session=${encodeURIComponent(session.token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_COOKIE_SECONDS}`
    );
    return c.json({
      appUserId: session.appUserId, role: session.role, staffRole: session.staffRole,
      displayName: session.displayName,
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // TASK 8.14 — TWO-STEP, THE SESSION LIST, AND PLATFORM. Seven routes; all but `two-step/verify`
  // require a live ORDINARY session via `loadSelf(c)` above (never a partial one — see that
  // helper's own comment). `two-step/start`/`confirm`/`disable` act ONLY on the caller's own
  // `firebaseUid` — no target id is ever read from the body (spec 04 §5's "an owner can require
  // two-step for all staff" is Q8-7, DEFERRED).
  // ═════════════════════════════════════════════════════════════════════════════════════════════

  // ── FP-E3 · PASSKEYS (OFF unless KEYSTONE_PASSKEYS=1). Registering needs a signed-in person; signing in needs nothing but the device, and ends at the same /api/auth/login as a code. ──
  // FP-E7/H5 — sign in with the organisation's own OpenID Connect provider (self-host; off unless configured)
  app.get("/api/auth/oidc/config", (c) => c.json({ enabled: oidcEnabled(), ...(oidcEnabled() ? { label: oidcLabel() } : {}) }));
  const publicBase = (c) => (process.env.KEYSTONE_PUBLIC_URL || new URL(c.req.url).origin).replace(/\/+$/, "");
  app.get("/api/auth/oidc/start", async (c) => {
    if (!oidcEnabled()) return c.json({ error: { kind: "not_found", message: "Not available." } }, 404);
    try {
      const { url, sealed } = await beginOidc({ publicUrl: publicBase(c) });
      c.header("set-cookie", stateCookie(sealed, publicBase(c).startsWith("https:")));
      return c.redirect(url, 302);
    } catch (e) { console.warn(`oidc: the provider could not be reached or read (${e?.name}: ${String(e?.message).slice(0, 160)})`); return c.redirect(`${publicBase(c)}/login?sso=unavailable`, 302); }   // R13-D411: the docs promise an oidc: line for every refusal
  });
  app.get("/api/auth/oidc/callback", async (c) => {
    if (!oidcEnabled()) return c.json({ error: { kind: "not_found", message: "Not available." } }, 404);
    c.header("set-cookie", clearStateCookie());
    try {
      const { idToken } = await finishOidc({ publicUrl: publicBase(c), currentUrl: `${publicBase(c)}${new URL(c.req.url).pathname}${new URL(c.req.url).search}`, sealed: readStateCookie(c.req.header("cookie")) });
      return c.redirect(`${publicBase(c)}/login#t=${encodeURIComponent(idToken)}`, 302);
    } catch { return c.redirect(`${publicBase(c)}/login?sso=failed`, 302); }
  });
  app.post("/api/auth/passkeys/login/begin", async (c) => c.json(await beginLogin({ origin: requestOrigin(c) })));
  app.post("/api/auth/passkeys/login/finish", async (c) => {
    const body = await c.req.json().catch(() => null);
    return c.json(await finishLogin({ origin: requestOrigin(c), ticket: body?.ticket, response: body?.response }));
  });

  // 0766: the two-step routes (overview, start, confirm, disable, recovery codes, passkeys and security keys, remembered devices, and the second step of signing in) live in twoStepRoutes.mjs
  registerTwoStepRoutes(app, { loadSelf, resolvePrincipal, resolvePartialSession, upgradeSession, revokeSession });

  /** "Where am I signed in." No IP, no full user-agent — see `userAgentSummary` above.
   *  `current` is the `tokenId` (the session row's own id — the same identifier
   *  `sessions/revoke` accepts back) of the caller's own session. */
  app.get("/api/auth/sessions", async (c) => {
    const self = await loadSelf(c);
    const rows = await withTenant(self.tenantId, (db) =>
      listSessionsForUser(db, self.tenantId, self.appUserId, self.tokenId));
    const sessions = rows.map((r) => ({
      tokenId: r.id,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      kind: r.kind,
      userAgentSummary: userAgentSummary(r.userAgent),
      // D-042: the parts, so the screen writes the sentence in the person's language (null = not recognised)
      device: userAgentParts(r.userAgent),
    }));
    const current = rows.find((r) => r.current)?.id ?? null;
    return c.json({ sessions, current });
  });

  /** Sign out elsewhere (`{all:true}`, keeps the caller's own) or one specific device
   *  (`{tokenId}`, which MAY be the caller's own — a deliberate self-logout-elsewhere path).
   *  `revoked_reason='admin'` either way (the CHECK set 0020 already allows). Scoped to the
   *  caller's own tenant+appUserId — never a target read from the body — by
   *  `revoke_session_by_id`/`revoke_sessions_for_user`'s own SQL (0176), so another person's
   *  session simply matches zero rows rather than being revoked. */
  app.post("/api/auth/sessions/revoke", async (c) => {
    const self = await loadSelf(c);
    const body = await c.req.json().catch(() => null);
    if (body?.all === true) {
      const { revoked } = await withTenant(self.tenantId, (db) =>
        revokeSessionsForUser(db, self.tenantId, self.appUserId, "admin", { exceptTokenId: self.tokenId }));
      return c.json({ revoked });
    }
    if (typeof body?.tokenId === "string" && body.tokenId) {
      const { revoked } = await withTenant(self.tenantId, (db) =>
        revokeSessionById(db, self.tenantId, self.appUserId, body.tokenId, "admin"));
      return c.json({ revoked: revoked ? 1 : 0 });
    }
    throw invalid("tokenId or all is required");
  });

  /** Open Platform. Thin wrapper over 8.9's `openPlatformSession` — the gate (the operator grant;
   *  the two-step gates were removed by the maintainer's G11.1 ruling, 25 Sep 2026) lives there; `totpCode`
   *  in the body is accepted and ignored. The NEW `kind:'operator'` session REPLACES the caller's
   *  `ks_session` cookie (same attribute string every other route here uses); the caller's
   *  ORIGINAL ordinary session row is untouched and still resolvable on its own token — that is
   *  test (h)'s positive control. */
  app.post("/api/platform/session", async (c) => {
    const self = await loadSelf(c);
    const body = await c.req.json().catch(() => null);
    const opened = await openPlatformSession({
      firebaseUid: self.firebaseUid,
      userAgent: c.req.header("user-agent") ?? null,
      ip: c.get("clientIp") ?? null,
      totpCode: body?.totpCode,
    });
    const maxAgeSeconds = Math.max(1, Math.round((opened.expiresAt.getTime() - Date.now()) / 1000));
    c.header(
      "set-cookie",
      `ks_session=${encodeURIComponent(opened.presented)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`
    );
    return c.json({ expiresAt: opened.expiresAt });
  });

  /** Leave Platform. Thin wrapper over 8.9's `closePlatformSession` — reads the raw presented
   *  string directly (same as `POST /api/auth/logout` above), never `loadSelf`/`resolveSession`,
   *  because an operator/'platform' session's row cannot resolve through the ordinary path
   *  (0209's null tenant/app_user columns). Best-effort, same contract as logout: a missing or
   *  already-revoked session still clears the cookie and answers 204, never an oracle. */
  app.delete("/api/platform/session", async (c) => {
    const presented = bearerOrCookie(c);
    if (!presented) throw unauthenticated("no platform session to close");
    await closePlatformSession({ presented });
    c.header("set-cookie", "ks_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    return c.body(null, 204);
  });
}
