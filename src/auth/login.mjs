// P13.3 / P13.4 / P13.6 / P13.7d — THE ONE LOGIN PATH.
//
// ★★★ ONE PATH. Not "a path per role", not "a fallback for legacy tokens". Every branch added
// here is a branch in which one party's credential can catch another party's case, which is
// exactly the live defect §2.7 of CLAUDE.md records: a `|| signerByRole.client` fallback let a
// tech client's signature render under a badge reading "PIR" on an executed instrument.
//
// THE SEQUENCE, AND EVERY STEP IS LOAD-BEARING:
//   1. verifyIdToken            — Google says who this is. Nothing more.
//   2. ★★★ resolve_tenants_by_firebase_uid — OUR OWN TABLE decides which tenants this uid belongs
//                                 to. D-17.26: this WAS the `orgId` claim, and a different
//                                 application sharing the Firebase project overwrites that claim
//                                 (MEASURED — it became "_consumer" and locked the owner out).
//   3. one membership ⇒ that one; several ⇒ the claim may NARROW among them, never admit. No
//                                 fall-through to a default tenant, ever.
//   4. ★★★ RE-CHECK THE UID→TENANT LINK AGAINST app_user INSIDE withTenant (U27 / P13.7d) — RLS is
//                                 then a second, independent reason the row must belong there.
//   5. the session               — and only now.

import { withTenant, withCredentialLookup } from "../db/index.mjs";
import { enforceFreeDeviceLimit, DEVICE_NOTICE } from "./deviceLimit.mjs";
import { verifyIdToken, orgSlugFromClaims } from "./firebase.mjs";
import { createSession, revokeSessionsForUid } from "./session.mjs";
import { unauthenticated, forbidden, AppError, ErrorKind } from "../http/errors.mjs";
import { APP_DOMAIN_VAR } from "./tenantFromHost.mjs";
// ★★★ F634 / 8.14 — the ONE new top-level import this correction adds. NOT circular: totp.mjs
//     imports session.mjs, db/index.mjs, secrets/envelope.mjs, firebase.mjs, http/errors.mjs —
//     never login.mjs (checked: `grep -rln "auth/login.mjs" src/` names only emailCode.mjs,
//     tenantFromHost.mjs, install.mjs, routes/writes.mjs, none of which totp.mjs imports).
import { summary as twoStepSummary, isTrustedDevice } from "./twoStep.mjs";

// ★ CT-028 / Q6-1 — the domain a wrong-address redirect's `correctHost` hangs off, read the same
//   way `src/routes/settings.mjs:94` already reads it: the deployment's own config, never
//   hardcoded, with the same fallback that module already uses.
const appDomain = () => process.env[APP_DOMAIN_VAR] || "example.com";

/**
 * Exchange a Firebase id token for a keystone session.
 * @returns { token, tenantId, appUserId, role, staffRole }
 */
/**
 * @param {string} idToken
 * @param {{ verify?: Function, tenantSlug?: string|null }} opts
 *   ★★★ `tenantSlug` — P5.1. THE TENANT SWITCHER'S ONLY MECHANISM, and it is safe for exactly the
 *   reason the claim below is: **it FILTERS a set computed without it.** `memberships` comes from
 *   `resolve_tenants_by_firebase_uid` — our own table, keyed on a uid Google vouched for — before
 *   this value is read. A slug naming a practice this identity does not belong to matches nothing
 *   and is refused; it cannot GRANT anything.
 *   ★★ It exists because **there is no in-session tenant swap**: the session row carries
 *   `tenant_id`, so "switch practice" is a RE-LOGIN scoped to the chosen one. The Firebase claim
 *   cannot serve here — the client cannot re-issue its own token with a different claim.
 *   ★ The claim still wins when both are present, so an identity provider that HAS scoped the token
 *     is not overridden by a stale value in a browser.
 */
export async function login(idToken, {
  verify = verifyIdToken, tenantSlug = null,
  requestedSlug = null, userAgent = null, ip = null,
  // ★ the maintainer, 28 Sep 2026 — true only from the central app. domain's own login route. Identity and
  //   tenancy are resolved exactly as normal (steps 1-4, above, are completely unchanged); only
  //   step 5 differs, minting a one-time `handoff` session instead of a real one. See
  //   0532_handoff_session_kind.sql for why this session KIND, not a new credential type.
  handoff = false,
  // 0766: the remembered-device cookie of this browser (skips only the SECOND step, for this person, for 30 days)
  trustedDeviceToken = null,
} = {}) {
  // ── 1 · IDENTITY ───────────────────────────────────────────────────────────
  let decoded;
  try {
    decoded = await verify(idToken, { checkRevoked: true });
  } catch {
    // ★ CT-027 / F473 — a revoked or disabled identity surfaces from firebase-admin (or, in a
    //   test double simulating that shape) as a thrown error. It becomes ONE generic refusal —
    //   the same non-oracle discipline as the multi-membership refusal below (:112-115 pre-edit):
    //   the message says neither whether the account exists nor why it was refused.
    throw unauthenticated("this account cannot sign in");
  }
  const uid = decoded?.uid ?? decoded?.sub;
  if (typeof uid !== "string" || uid.length === 0) {
    throw unauthenticated("verified token carries no uid");
  }

  // ── 2 · ★★★ TENANCY COMES FROM OUR OWN TABLE, BY UID — D-17.26 ─────────────
  //
  // ★★★ IT USED TO COME FROM THE FIREBASE `orgId` CLAIM, AND A DIFFERENT APPLICATION OVERWRITES IT.
  //     [EXECUTED 2026-09-13] minutes after signup set orgId='example', the account's stored claims
  //     read {role:'pir', orgId:'_consumer', tenantId:'consumer'} — Keystone shares the Firebase
  //     project with the LIVE Nexus app, whose onAuthUserCreate trigger fires on the account
  //     Keystone just created and calls setCustomUserClaims, WHICH REPLACES RATHER THAN MERGES.
  //     The owner was locked out of the workspace they had created, with the message
  //     `invalid credential` about a credential Google had just vouched for.
  // ★★ Re-setting the claim afterwards cannot fix it: the other system owns a trigger on the same
  //    event. A design where OUR tenancy lives in a field SOMEONE ELSE writes is broken by
  //    construction, not unlucky.
  // ★ And this is what step 4's own comment already said — "a Firebase custom claim is GOOGLE'S
  //   ASSERTION ABOUT IDENTITY, not our statement about who belongs to which practice". The
  //   membership row was always the authority; the claim only said where to look.
  const memberships = await withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT keystone.resolve_tenants_by_firebase_uid($1) AS id`, [uid]
    );
    return rows.map((r) => r.id).filter(Boolean);
  });

  if (memberships.length === 0) {
    // ★★ NEVER A FALL-THROUGH TO A DEFAULT TENANT. ★ And deliberately the SAME message as a bad
    //    token: "you have no account anywhere" vs "that token is forged" are different facts and
    //    distinguishing them for an unauthenticated caller is an oracle.
    throw unauthenticated("invalid credential");
  }

  // ── 3 · ONE MEMBERSHIP → THAT ONE. SEVERAL → THE CLAIM MAY NARROW, NEVER ADMIT ──
  //
  // ★★★ [MEASURED] the uniqueness constraint is UNIQUE (tenant_id, firebase_uid), so one person MAY
  //     legitimately belong to several tenants. Picking one for them is exactly the
  //     `|| signerByRole.client` failure class CLAUDE.md §2.7 records — one party's credential
  //     quietly catching another party's branch — so it is refused instead.
  // ★★ THE CLAIM IS CONSULTED ONLY HERE, AND ONLY TO CHOOSE AMONG TENANTS THIS UID IS ALREADY
  //    CONFIRMED TO BELONG TO. It cannot grant access to anything; the set it filters was computed
  //    without it. A stale claim naming a tenant the person has LEFT simply matches nothing in the
  //    set, so U27's stale-claim case still fails closed — and, unlike before, a person MOVED to a
  //    new tenant is admitted to the new one instead of being locked out by the old claim.
  let tenantId;
  if (memberships.length === 1) {
    // ★★ CT-028 / Q0-18 / Q6-1 — the single-membership branch is no longer unconditional: a host
    //    or slug naming a DIFFERENT practice than the one this identity belongs to is refused,
    //    not silently admitted to the wrong tenant.
    if (requestedSlug === null) {
      // ★ No host-derived slug — the API-client and test path. Unchanged from today.
      tenantId = memberships[0];
    } else {
      const requested = await withCredentialLookup(async (db) => {
        const { rows } = await db.query(
          `SELECT keystone.resolve_tenant_by_slug($1) AS id`, [requestedSlug]
        );
        return rows[0]?.id ?? null;
      });
      if (requested && memberships.includes(requested)) {
        tenantId = requested;
      } else {
        // ★★★ Q0-18 / Q6-1 — REFUSE, NOT REDIRECT: the session cookie is host-only
        //     (src/auth/install.mjs:95-98), so a server-side redirect would mint a cookie the
        //     destination host cannot read. `detail.correctHost` lets the LOGIN SCREEN do the
        //     redirect instead, and it is carried ONLY here — exactly one membership — so the
        //     response is never an existence oracle when there are zero or several memberships.
        const slug = await withCredentialLookup(async (db) => {
          const { rows } = await db.query(
            `SELECT slug FROM keystone.practices_for_firebase_uid($1) WHERE id = $2`,
            [uid, memberships[0]]
          );
          return rows[0]?.slug ?? null;
        });
        throw new AppError(ErrorKind.FORBIDDEN,
          "this account does not belong to the practice at this address",
          slug ? { detail: { correctHost: `${slug}.${appDomain()}` } } : undefined);
      }
    }
  } else {
    let claimed = null;
    try { claimed = orgSlugFromClaims(decoded); } catch { claimed = null; }
    // ★ The claim first; then the host-derived slug; the caller's requested `tenantSlug` last —
    //   only when neither the token nor the host scopes itself. `requestedSlug` joins the same
    //   fallback chain `tenantSlug` already used here (CT-028).
    claimed = claimed
      ?? (typeof requestedSlug === "string" && requestedSlug.trim() ? requestedSlug.trim() : null)
      ?? (typeof tenantSlug === "string" && tenantSlug.trim() ? tenantSlug.trim() : null);
    const narrowed = claimed
      ? await withCredentialLookup(async (db) => {
          const { rows } = await db.query(
            `SELECT keystone.resolve_tenant_by_slug($1) AS id`, [claimed]
          );
          return rows[0]?.id ?? null;
        })
      : null;
    if (!narrowed || !memberships.includes(narrowed)) {
      // ★★★ the maintainer, 28 Sep 2026 — THE PRACTICE PICKER. `claimed === null` means nothing has tried to
      //     narrow this yet (the FIRST time this identity's multiple memberships are seen this
      //     sign-in) — that is the picker step, not a refusal: return the caller's OWN practices
      //     (name, slug, logo — the same branding `/api/auth/branding` already exposes for one
      //     practice, read here for all of them) so the client can render "choose your practice"
      //     and resubmit the SAME idToken with the chosen slug. `claimed !== null` means a slug
      //     WAS supplied (the picker's own resubmission, or a stale/forged one) and it did not
      //     resolve to a real membership — THAT stays a hard refusal; a person in two practices
      //     already told which one they meant does not get a second guess at enumeration.
      if (claimed === null) {
        // ★ R10-54: read through the named definer. The old direct SELECT on keystone.tenant returned ZERO rows here (no tenant context → forced RLS), so the picker was empty.
        const practices = await withCredentialLookup(async (db) => {
          const { rows } = await db.query(
            `SELECT slug, display_name, logo_url FROM keystone.resolve_login_practices($1::uuid[])`,
            [memberships]
          );
          return rows.map((row) => ({ slug: row.slug, displayName: row.display_name, logoUrl: row.logo_url ?? null }));
        });
        return { needsPracticePick: true, practices };
      }
      // ★ Naming the caller's OWN memberships is not an oracle about anyone else — it is a fact
      //   about them — so this one may be specific, and it has to be: a person in two practices
      //   needs to know why they were refused and what to supply.
      throw unauthenticated(
        `this identity belongs to ${memberships.length} organisations; sign in through the one you mean`
      );
    }
    tenantId = narrowed;
  }

  // ── 4 · ★★★ U27 — THE CLAIM IS NOT AN AUTHORISATION ABOUT TENANCY ──────────
  //
  // A Firebase custom claim is GOOGLE'S ASSERTION ABOUT IDENTITY. It is not our statement about
  // who belongs to which practice, and the two can disagree — measurably:
  //   [MEAS, firebase-admin] `setCustomUserClaims` does NOT move `tokensValidAfterTime`; only
  //   `revokeRefreshTokens` does; and `checkRevoked` compares against exactly that field. So a
  //   user MOVED FROM TENANT A TO TENANT B KEEPS A CRYPTOGRAPHICALLY VALID TOKEN NAMING A for up
  //   to an hour, and `verifyIdToken(token, true)` ACCEPTS IT.
  // ★★ RLS cannot save us here: the context is CORRECT-LOOKING AND WRONG. Y1's threat model
  //    covers "no context" and "wrong context asked for explicitly" — not "stale context supplied
  //    by a trusted issuer".
  //
  // ★★★ SO THE LINK IS RE-CHECKED AGAINST OUR OWN TABLE, BY UID, BEFORE THE SESSION EXISTS.
  //     This runs INSIDE withTenant(tenantId) on purpose: the RLS predicate is then a second,
  //     independent reason the row must belong to that tenant — if the query somehow named the
  //     wrong tenant, RLS returns zero rows and this refuses.
  const person = await withTenant(tenantId, async (db) => {
    // ★★★ P13.4 — MATCHED BY firebase_uid. NEVER BY EMAIL, NEVER BY display_name (hard limit 2).
    //     An email is a MUTABLE, USER-SUPPLIED, REASSIGNABLE handle: change it in Firebase and an
    //     email-keyed lookup silently finds nobody — or, far worse, finds the NEXT person who is
    //     given that address. A Firebase uid is opaque, assigned by Google, and never reused.
    //     ★ Before migration 0019 there was no column to match on and this line could not be
    //       written at all. That is why P13.0 came first.
    const { rows } = await db.query(
      // ★★★ `archived_at IS NULL` IS A SECOND LAYER, NOT A DUPLICATE OF THE RESOLVER'S (0096).
      //     `resolve_tenants_by_firebase_uid` decides WHICH PRACTICES this uid may enter; this
      //     decides WHO they are once inside one. [MEASURED, P2 CLOSE §VISUAL] neither tested
      //     archival, so a departed client signed straight back in and every surface treated them
      //     as current. The resolver alone would close the front door and leave this lookup
      //     answering for a person the practice has retired.
      `SELECT id, role, staff_role, display_name, email, lifecycle_status
         FROM keystone.app_user
        WHERE firebase_uid = $1
          AND archived_at IS NULL`,
      [uid]
    );
    // ★ CT-... (28 Sep 2026, app.->practice handoff) — the practice's own slug, read inside the
    //   same tenant transaction (RLS admits a tenant reading its own row). Needed so a caller on
    //   the central app. domain can build the handoff redirect without a second round trip.
    const { rows: tenantRows } = await db.query(
      `SELECT slug FROM keystone.tenant WHERE id = $1`, [tenantId]
    );
    if (rows[0]) rows[0].tenantSlug = tenantRows[0]?.slug ?? null;
    return rows[0] ?? null;
  });

  if (!person) {
    // ★★ 403, NOT 401, AND THE DIFFERENCE IS REAL: the credential is GENUINE and Google vouched
    //    for it. What is refused is the TENANCY. Returning 401 would invite a client to
    //    re-authenticate forever against a tenant it will never be admitted to.
    // ★ The message names neither the tenant nor the uid — a refusal that echoes what was asked
    //   for is an existence oracle.
    // ★★★ SINCE D-17.26 THIS SHOULD BE UNREACHABLE, AND IT STAYS ANYWAY. `tenantId` was derived
    //     FROM an app_user row for this uid, so a miss here means the row vanished between the two
    //     statements or RLS disagreed with the definer — both of which are conditions to fail
    //     closed on, not to assume away. A guard that has become redundant is not a guard to delete;
    //     it is the one that catches the next change.
    throw forbidden("this identity has no account in that organisation");
  }

  // ★★★ the maintainer's brief, 1 Oct 2026 — the matching second layer for a SUSPENDED staff member, same
  //     shape as the `archived_at` check just above: `resolve_tenants_by_firebase_uid` admits the
  //     practice, this decides whether this particular person may act inside it right now. Without
  //     this, a paused coach whose live sessions were revoked (suspendTeamMember,
  //     src/people/offboard.mjs) could simply sign back in and get a fresh one — the per-request
  //     gate in src/http/app.mjs would then refuse their very next call, but only after they had
  //     already seen a successful sign-in, which is confusing and is also one more place the fact
  //     has to be checked instead of one. CLIENTS are exempt (see app.mjs's own note on the same
  //     scoping decision) — this is "suspend a team member", not a client lifecycle gate.
  // ★★★ FOUND LIVE, 1 Oct 2026 — the maintainer himself (the OWNER) locked out within hours of this check
  //     shipping. `lifecycle_status`'s column DEFAULT is 'lead' (0076), not 'active' — a staff row
  //     never explicitly moved to 'active' (true of accounts created before suspend/reactivate
  //     existed, the maintainer's own included) reads as "not active" under `!== "active"` and was refused
  //     exactly like a genuinely suspended one. The only two states suspendTeamMember/
  //     offboardTeamMember ever actually produce are 'paused' and 'former' — check for THOSE
  //     explicitly, never by exclusion from 'active'.
  if (person.role === "staff" && (person.lifecycle_status === "paused" || person.lifecycle_status === "former")) {
    throw forbidden(
      person.lifecycle_status === "paused"
        ? "this team member's access has been suspended"
        : "this team member is no longer with this practice");
  }

  // ── 5 · THE SESSION ────────────────────────────────────────────────────────
  // ★★★ F634 / 8.14 — A CONFIRMED SECOND FACTOR GATES THE KIND, NOT A SEPARATE CHECK LATER.
  //     hasConfirmedFactor reads keystone_auth.totp_factor for this uid (task 8.8, confirmed only
  //     once two-step/confirm has run). A 'partial' session can do exactly ONE thing —
  //     POST /api/auth/two-step/verify — because keystone.resolve_session (0228) now excludes
  //     kind='partial' outright: every OTHER authenticated route 401s on it, by construction of
  //     the resolver every route already goes through (src/http/app.mjs:689-698), not by a check
  //     this file or any route file has to remember to add.
  // 0766: a second step is asked for when the person has ANY (an authenticator app, a passkey, a security key), except when this very sign-in was made with a passkey (the device was unlocked with Face ID,
  // Touch ID or the PIN, so it was already two factors) or this browser was remembered for this person.
  let requiresTwoStep = false;
  if (!(decoded?.docustay_passkey === true)) {
    requiresTwoStep = (await twoStepSummary(uid)).on;
    if (requiresTwoStep && trustedDeviceToken && !handoff && await isTrustedDevice(uid, trustedDeviceToken)) requiresTwoStep = false;
  }
  // ★ the maintainer, 28 Sep 2026 — a handoff mint ALWAYS uses kind='handoff', regardless of requiresTwoStep:
  //   the two-step decision is re-made on the practice's own host, after redemption, the same way
  //   an ordinary sign-in already makes it — see redeem_handoff_session's own header. Minting it
  //   here as 'partial' or 'app' directly would leak that decision across the origin boundary the
  //   handoff exists to cross, for no benefit (the redeeming route re-derives it from the SAME
  //   hasConfirmedFactor(uid) call either way).
  const kind = handoff ? "handoff" : requiresTwoStep ? "partial" : "app";
  const session = await createSession({
    tenantId, appUserId: person.id, firebaseUid: uid,
    userAgent, ip,
    kind,
    // ★ 1 hour, not the ordinary 12. Not 10 minutes (email-code's own convention,
    //   src/auth/emailCode.mjs:84-86) — keystone.create_session's EXISTING 9-argument SQL
    //   (0173) calls `make_interval(hours => $6)`, and Postgres's own make_interval declares
    //   `hours` as `integer`; a sub-hour fraction bound to that parameter fails to cast. 1 hour is
    //   the smallest value the EXISTING mechanism can express without changing createSession's own
    //   query text, which is out of this correction's scope (a migration + two small function
    //   additions, not a change to an already-shipped, universally-called function). Still four
    //   times shorter than an ordinary session, and it is re-checked server-side on every use
    //   (expires_at > now()) regardless of what the browser's cookie Max-Age says.
    ...(kind !== "app" ? { ttlHours: 1 } : {}),
  });

  // 21 Oct 2026 (the maintainer, decision 5): a Free workspace may be signed in on three devices at once; a fourth sign-in signs out the oldest, and the new device is told so
  const devices = kind === "app" ? await enforceFreeDeviceLimit({ tenantId, appUserId: person.id, currentTokenId: session.tokenId }) : { signedOut: 0 };
  return {
    token: session.token,
    tenantId,
    tenantSlug: person.tenantSlug,
    ...(devices.signedOut > 0 ? { deviceNotice: DEVICE_NOTICE } : {}),
    appUserId: person.id,
    // ★★ P13.6 — role and rank come FROM THE DATABASE ROW. The token's own `role` claim
    //    (measured as 'pir' on live records) is NEVER consulted: 'pir' is not in app_user's CHECK
    //    set and not on the RANK ladder, so trusting it would refuse the user every section while
    //    looking like an authorisation bug.
    role: person.role,
    staffRole: person.staff_role,
    displayName: person.display_name,
    // ★★★ THE SIGNAL 8.20 READS. Omitted — not `false` — for an ordinary sign-in, so the response
    //     shape for every identity without a confirmed factor (the overwhelming majority of logins
    //     today) is byte-for-byte what it was before this correction.
    ...(handoff ? {} : requiresTwoStep ? { requiresTwoStep: true } : {}),
    ...(handoff ? { handoff: true } : {}),
  };
}

/**
 * ★ The other half of U27, and the reason a session table was chosen: moving a person between
 *   tenants must make the old tenant unreachable NOW, not in an hour.
 *   Call this from every path that changes a person's tenancy.
 */
export async function onTenancyChanged(firebaseUid) {
  return revokeSessionsForUid(firebaseUid, "tenant_changed");
}

export async function logout(firebaseUid) {
  return revokeSessionsForUid(firebaseUid, "logout");
}
