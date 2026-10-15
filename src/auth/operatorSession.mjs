// src/auth/operatorSession.mjs — TASK 8.9. CT-058 / spec 04 §4, §6, §8a.
//
// Turns a signed-in identity that holds an APPROVED operator grant (task 8.4/8.8's two-step flow)
// and has completed two-step into a Platform session that carries no practice — and ends it. Also
// the two thin wrappers over 8.4's request/approve definer functions, and the single reader
// `hasConfirmedFactor`/8.14 need to decide "is this identity an operator right now".
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ F629 (RESOLVED 21 Sep 2026) — `openPlatformSession`, `requestGrant` and `approveGrant` do
//     **NOT** call `writeAudit` (`src/permissions/audit.mjs`) — `keystone.audit_entry.tenant_id`
//     is `NOT NULL`/RLS-enforced (0183) and the subject of all three actions,
//     `keystone_auth.operator_grant` (0184), is by CT-039's own design tenant-less. Instead, all
//     three write a platform-scoped trail through the ONE new SECURITY DEFINER function migration
//     0227 adds, `keystone.write_operator_audit(action, actorOperatorGrantId, subjectId, requestId)`
//     — `reason` is read from `keystone_auth.operator_grant.reason` itself, never passed in.
//     `keystone.audit_entry` / `require_tenant_id()` / `audit_action` (0001, 0183) are untouched.
//     Every call to `write_operator_audit` goes through `withCredentialLookup` — never `withTenant`
//     — there is no tenant to set a GUC for, exactly as `createSession` and
//     `request_operator_grant`/`approve_operator_grant` already do.
//
// ★★★ WHERE `openPlatformSession` GETS THE GRANT'S ROW ID. `hasActiveOperatorGrant` (below) calls
//     `keystone.operator_grant_status`, which by design (F605, 8.4's own COMMENT ON FUNCTION)
//     returns only `(active, expires_at)` — no id, because it exists to decide the ttl clamp, not
//     to hand back a row identifier. The row id `write_operator_audit` needs comes from
//     `resolveSession` (`src/auth/session.mjs`, called immediately after `createSession` mints the
//     row) — its `operatorGrantId` is the uuid-or-null shape task 7.6 gave `keystone.resolve_session`
//     precisely so nothing downstream ever holds a uid (CCR-13). That is "the grant id uuid, which
//     is all `openPlatformSession` ever holds after Stage 7 task 7.6".
//
// ★★★ NEVER READ, HOLD OR PASS AN OPERATOR **UID** into `write_operator_audit` — only the grant id
//     uuid (Stage 7 CCR-13). `firebaseUid` is an input to this module's functions (it has to be —
//     that is how an identity is named), but it never crosses into a `write_operator_audit` call.
//
// ★ `totp.mjs`'s `disableTotp` imports `hasActiveOperatorGrant` from THIS file with a dynamic
//   `import()`, not a static one, to avoid a circular static import (this file statically imports
//   `hasConfirmedFactor`/`verifyTotp` FROM totp.mjs). See totp.mjs's own header note.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { withCredentialLookup } from "../db/index.mjs";
import { createSession, resolveSession, revokeSession } from "./session.mjs";
// ★ G11.1 (25 Sep 2026): the totp.mjs imports (hasConfirmedFactor, verifyTotp) left with the
//   gate they served — openPlatformSession no longer reads any factor.
import { forbidden, internal } from "../http/errors.mjs";

const MAX_PLATFORM_SESSION_HOURS = 12;
const MS_PER_HOUR = 60 * 60 * 1000;

function assertUid(firebaseUid) {
  if (typeof firebaseUid !== "string" || firebaseUid.trim() === "") {
    throw internal(`operatorSession: firebaseUid must be a non-blank string (got ${JSON.stringify(firebaseUid)})`);
  }
}

/**
 * ★★★ THE SINGLE READER OF "is p_uid an operator RIGHT NOW" IN `src/auth/` (F605, closed by 8.4).
 * Calls `keystone.operator_grant_status(firebaseUid)` and does not reimplement its predicate.
 * Zero rows (no grant, unapproved, revoked or expired — the caller cannot and need not tell which)
 * means inactive. `totp.mjs`'s `disableTotp` dynamically imports this.
 * @param {string} firebaseUid
 * @returns {Promise<{ active: boolean, expiresAt: Date|null }>}
 */
export async function hasActiveOperatorGrant(firebaseUid) {
  assertUid(firebaseUid);
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT active, expires_at FROM keystone.operator_grant_status($1)`,
      [firebaseUid]
    );
    return {
      active: rows[0]?.active === true,
      expiresAt: rows[0]?.expires_at ?? null,
    };
  });
}

/**
 * ★★★ OPEN A PLATFORM SESSION. ONE gate — an active operator grant (G11.1, 25 Sep 2026:
 * the two-step gates are gone; Q8-7 overturned). Then a
 * `kind: 'operator'` session with `tenantId: null, appUserId: null` whose `ttlHours` is the
 * SHORTER of 12 and the hours remaining on the grant — a Platform session can never outlive the
 * grant that justified it (spec 04 §6, "hard stop"). Then the F629 audit trail, in a SEPARATE
 * `withCredentialLookup` transaction (it cannot share `createSession`'s own — session.mjs is
 * Stage 6's and is never edited).
 * @param {{ firebaseUid: string, userAgent?: string|null, ip?: string|null, totpCode?: string,  // accepted, ignored (G11.1)
 *           requestId?: string|null }} args
 * @returns {Promise<{ presented: string, expiresAt: Date }>}
 */
export async function openPlatformSession({
  firebaseUid, userAgent = null, ip = null, totpCode, requestId = null,
} = {}) {
  assertUid(firebaseUid);

  const grantStatus = await hasActiveOperatorGrant(firebaseUid);
  if (!grantStatus.active) {
    throw forbidden("Platform is not available on this sign-in.");
  }

  // ★★★ RULED BY TY, 25 Sep 2026 (G11.1, spec 04 §0.1a — OVERTURNS Q8-7): TOTP is never
  //     mandatory, the operator included. The confirmed-factor and code gates that stood here are
  //     removed; the grant gate above, the tenantless session below and the F629 audit write all
  //     stay. `totpCode` remains an accepted, IGNORED parameter so existing callers keep working.
  void totpCode;

  // ★ The hard stop — never outlive the grant, rounded to the nearest whole hour because
  //   `make_interval`'s `hours` argument is an integer (`createSession`'s own SQL, session.mjs,
  //   never edited). ★★ FLOORED AT 1, NOT 0: `keystone_auth.session` carries
  //   `CHECK (expires_at > created_at)` (0020, already deployed, never edited) — a ttlHours of 0
  //   would violate it outright and the session could never be minted at all. A floor of 1 is the
  //   one case where this can slightly overshoot the grant's own remaining life (a grant with under
  //   an hour left gets a 1-hour session) — the smaller of two imperfect choices against a session
  //   table that cannot express "expires immediately", named here rather than silently accepted,
  //   the same way field 4's own two-write tradeoff is named rather than hidden.
  const remainingHours = (new Date(grantStatus.expiresAt).getTime() - Date.now()) / MS_PER_HOUR;
  const ttlHours = Math.max(1, Math.min(MAX_PLATFORM_SESSION_HOURS, Math.round(remainingHours)));

  const session = await createSession({
    tenantId: null, appUserId: null, firebaseUid, kind: "operator", ttlHours, userAgent, ip,
  });

  // ★ The grant's own row id — see this file's header note. `resolveSession` re-resolves the
  //   session we just minted; its operatorGrantId is the same active grant hasActiveOperatorGrant
  //   just confirmed, by construction of keystone.resolve_session's own predicate (0208).
  const resolved = await resolveSession(session.token);
  const grantId = resolved?.operatorGrantId ?? null;
  if (!grantId) {
    // ★ Defensive only — the two gates above already proved an active, approved grant exists for
    //   this uid, and resolve_session filters on the identical predicate.
    throw internal("openPlatformSession: the session was minted but no operator grant id resolved for it");
  }

  await withCredentialLookup(async (db) => {
    await db.query(
      `SELECT keystone.write_operator_audit($1, $2, $3, $4)`,
      ["operator.acted_as", grantId, grantId, requestId ?? null]
    );
  });

  return {
    presented: session.token,
    // ★ Approximation of the row's real expires_at (createSession's own SQL uses the database's
    //   now(), not this process's clock) — close enough for an API response; nothing downstream
    //   trusts this value for an authorization decision, only the row's own column does that.
    expiresAt: new Date(Date.now() + ttlHours * MS_PER_HOUR),
  };
}

/**
 * "Leave Platform." Revokes the one session `presented` names, reason `operator_ended` (Stage 6 /
 * CT-025 adds this reason to the CHECK set). The route (8.14) clears the cookie.
 * @param {{ presented: string }} args
 * @returns {Promise<{ revoked: boolean }>}
 */
export async function closePlatformSession({ presented } = {}) {
  return revokeSession(presented, "operator_ended");
}

/**
 * REQUEST a grant (CT-058's two-step flow, task 8.4). Thin wrapper over
 * `keystone.request_operator_grant`, plus the F629 audit trail in the SAME `withCredentialLookup`
 * transaction as the request itself — one round trip, both writes commit or neither does.
 * @param {{ firebaseUid: string, requestedBy: string, reason: string, ttlHours: number,
 *           requestId?: string|null }} args
 * @returns {Promise<{ id: string }>}
 */
export async function requestGrant({ firebaseUid, requestedBy, reason, ttlHours, requestId = null } = {}) {
  assertUid(firebaseUid);
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT keystone.request_operator_grant($1,$2,$3, make_interval(hours => $4)) AS id`,
      [firebaseUid, requestedBy, reason, ttlHours]
    );
    const grantId = rows[0].id;
    await db.query(
      `SELECT keystone.write_operator_audit($1, $2, $3, $4)`,
      ["operator.grant_requested", grantId, grantId, requestId]
    );
    return { id: grantId };
  });
}

/**
 * APPROVE a grant a DIFFERENT operator requested (CT-058, task 8.4). Thin wrapper over
 * `keystone.approve_operator_grant`, plus the F629 audit trail in the SAME `withCredentialLookup`
 * transaction. ★ `approve_operator_grant` returns `(id, expires_at)` only — the subject uid is
 * never read from it or passed anywhere (K1-8-2).
 * @param {{ id: string, approverUid: string, requestId?: string|null }} args
 * @returns {Promise<{ id: string, expiresAt: Date }>}
 */
export async function approveGrant({ id, approverUid, requestId = null } = {}) {
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT id, expires_at AS "expiresAt" FROM keystone.approve_operator_grant($1,$2)`,
      [id, approverUid]
    );
    const row = rows[0];
    await db.query(
      `SELECT keystone.write_operator_audit($1, $2, $3, $4)`,
      ["operator.grant_approved", row.id, row.id, requestId]
    );
    return { id: row.id, expiresAt: row.expiresAt };
  });
}
