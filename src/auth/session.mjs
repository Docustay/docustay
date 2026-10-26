// P13.2b — THE SESSION: MINT, RESOLVE, REVOKE.
//
// ★★★ THE PRESENTED STRING IS `ks_<token_id>_<secret>` AND THE SHAPE IS NOT COSMETIC.
// It is the resolution of the salt dilemma, and it is deliberately THE SAME SHAPE P19.3 uses for
// `api_token` so the reasoning is not re-derived — and re-derived differently — in two places:
//
//   A per-row salt (bcrypt/argon2) makes the digest a function of (secret, salt), so IT CANNOT BE
//   AN INDEX KEY. Lookup degrades to a sequential scan running a deliberately-expensive KDF once
//   per row — every authenticated request becomes O(n) in sessions-in-existence. Disqualifying on
//   performance alone, before any security argument.
//
//   RESOLUTION: put a PUBLIC id in the string. Lookup is a unique-index probe on `token_id`;
//   verification is a digest comparison against `secret_hash`.
//
// ★★ HMAC-SHA256 WITH A PEPPER, NOT bcrypt/argon2. The secret is 256 CSPRNG bits, not a human
// password — a work factor multiplies an already-infeasible search and buys nothing. The PEPPER
// buys something real: a stolen database dump CANNOT be used to confirm a guessed session
// offline, because the pepper lives in a different blast radius (env, not the database). Same
// reasoning envelope.mjs:28-41 applies to KEYSTONE_MASTER_KEY.
// ★ bcrypt would additionally TRUNCATE AT 72 BYTES, silently discarding entropy.

import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { withCredentialLookup } from "../db/index.mjs";
import { unauthenticated, internal } from "../http/errors.mjs";

// ★ Crockford base32 — the alphabet in the CHECK constraint on session.token_id. No I, L, O or U,
//   so a token read aloud or copied by hand cannot become a different valid token.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TOKEN_ID_LEN = 26;

function pepper() {
  const p = process.env.KEYSTONE_TOKEN_PEPPER;
  // ★★ FAIL LOUD. A missing pepper must never silently degrade to an unpeppered HMAC: every
  //    session minted in that window would be verifiable from a database dump alone, and nothing
  //    would look wrong.
  if (!p || p.length < 32) {
    throw internal("KEYSTONE_TOKEN_PEPPER is unset or shorter than 32 chars — refusing to mint or verify a session");
  }
  return p;
}

function newTokenId() {
  // ★ Rejection-free: 32 is a power of two, so masking 5 bits is uniform over the alphabet.
  const bytes = randomBytes(TOKEN_ID_LEN);
  let out = "";
  for (let i = 0; i < TOKEN_ID_LEN; i++) out += ALPHABET[bytes[i] & 31];
  return out;
}

export function hashSecret(secret) {
  return createHmac("sha256", pepper()).update(secret, "utf8").digest();
}

const PRESENTED = /^ks_([0-9A-HJKMNP-TV-Z]{26})_([A-Za-z0-9_-]{20,})$/;

/** Split a presented string. ★ Returns null rather than throwing — a malformed token is simply
 *  not a session, and the caller decides that means 401. */
export function parsePresented(raw) {
  const m = PRESENTED.exec(String(raw ?? ""));
  return m ? { tokenId: m[1], secret: m[2] } : null;
}

/**
 * Mint a session for an already-verified identity.
 * ★ The SECRET is returned ONCE, here, and is never retrievable again — only its HMAC is stored.
 */
export async function createSession({ tenantId, appUserId, firebaseUid, ttlHours = 12,
                                      userAgent = null, ip = null, kind = "app" }) {
  const tokenId = newTokenId();
  const secret = randomBytes(32).toString("base64url");
  const hash = hashSecret(secret);

  await withCredentialLookup(async (db) => {
    await db.query(
      `SELECT keystone.create_session($1,$2,$3,$4,$5, make_interval(hours => $6), $7, $8, $9)`,
      [tenantId, appUserId, firebaseUid, tokenId, hash, ttlHours, userAgent, ip, kind]
    );
  });

  return { token: `ks_${tokenId}_${secret}`, tokenId, expiresInHours: ttlHours };
}

/**
 * ★★★ THE PER-REQUEST RESOLUTION. This is what `handleBrowserRequest` calls, and it is the one
 * query in the system that runs with NO tenant context — because it is the query that PRODUCES
 * the tenant.
 *
 * ★★★ TASK 7.6 — `operatorGrantId` is a **uuid or null**, never a uid. `keystone.resolve_session`
 * (0186) looks the grant up INSIDE its own SECURITY DEFINER body from the session's `firebase_uid`
 * and returns only the grant's id; the uid itself never crosses back out. No key on the returned
 * object matches `/uid|firebase/i` except `operatorGrantId`, by construction of the query below.
 */
export async function resolveSession(presented) {
  const parsed = parsePresented(presented);
  if (!parsed) return undefined;
  const hash = hashSecret(parsed.secret);

  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT tenant_id, app_user_id, operator_grant_id FROM keystone.resolve_session($1, $2)`,
      [parsed.tokenId, hash]
    );
    if (rows.length === 0) return undefined;
    // ★ The shape handleBrowserRequest expects — {tenantId, userId, operatorGrantId} — so the
    //   pluggable store is a drop-in for the Map it replaces and the Y1 gates keep working
    //   unchanged.
    return {
      tenantId: rows[0].tenant_id,
      userId: rows[0].app_user_id,
      operatorGrantId: rows[0].operator_grant_id,
    };
  });
}

// ★ 0173 widened the CHECK constraint on keystone_auth.session.revoked_reason to eight values;
//   exported so 6.12 and 6.15 validate against the same set this file's own functions do, rather
//   than drifting with a locally re-typed copy.
const REVOKE_REASONS = Object.freeze(new Set([
  "logout", "tenant_changed", "admin", "expired_sweep",
  "role_changed", "password_changed", "device_removed", "operator_ended",
  "removed_from_team",
  // ★ Migration 0555, 1 Oct 2026 — suspendTeamMember (src/people/offboard.mjs).
  "suspended",
  // Migration 0769, 21 Oct 2026 — a Free workspace's fourth device signed in and the oldest was signed out (src/auth/deviceLimit.mjs).
  "device_limit",
]));

/**
 * ★★★ U27's CLOSURE, AND IT IS THE REASON A SESSION WAS CHOSEN OVER STATELESS.
 * A tenancy change calls this and the old tenant becomes unreachable IN ONE STATEMENT. The
 * stateless alternative's window is "up to an hour, unobservable, and checkRevoked does not
 * catch it" — measured from firebase-admin's own source.
 * ★ BY UID, NOT BY TENANT: a tenancy change means the OLD tenant is exactly the thing that must
 *   not be used to find the sessions.
 */
export async function revokeSessionsForUid(firebaseUid, reason) {
  // ★ A reason outside the CHECK set would be refused by Postgres 40 lines later with a
  //   constraint-violation message; refuse it here, naming the set.
  if (!REVOKE_REASONS.has(reason)) {
    throw internal(`revoke reason must be one of ${[...REVOKE_REASONS].join(", ")}`);
  }
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT keystone.revoke_sessions_for_uid($1,$2) AS n`, [firebaseUid, reason]
    );
    return rows[0].n;
  });
}

/** ★ Constant-time compare, exported for the gate. Not used on the hot path — the DIGEST is the
 *  index probe, so the comparison happens inside Postgres on a bytea. */
export function digestsEqual(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * ★★★ 6.14 CALLS THIS ON EVERY AUTHENTICATED REQUEST. NEVER THROWS — a failed bookkeeping write
 * must not fail the request it is recording, so any error (an unset pepper, a dead pool) is
 * swallowed and reported as "no write happened" rather than propagated.
 * ★ A garbage / unparseable token returns `false` WITHOUT issuing a query — there is no token_id
 *   to look up.
 */
export async function touchSession(presented) {
  const parsed = parsePresented(presented);
  if (!parsed) return false;
  try {
    const hash = hashSecret(parsed.secret);
    return await withCredentialLookup(async (db) => {
      const { rows } = await db.query(
        `SELECT keystone.touch_session($1,$2) AS touched`,
        [parsed.tokenId, hash]
      );
      return rows[0].touched;
    });
  } catch {
    return false;
  }
}

/** Run 7 part 6 — seconds this live session has gone without a request (0710), or null when it is not live. Read BEFORE touchSession on the request path. */
export async function sessionIdleSeconds(presented) {
  const parsed = parsePresented(presented);
  if (!parsed) return null;
  const hash = hashSecret(parsed.secret);
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(`SELECT keystone.session_idle_seconds($1,$2) AS idle`, [parsed.tokenId, hash]);
    return rows[0]?.idle ?? null;
  });
}

/** LOGOUT. Revokes the one session `presented` names. No tenant GUC involved — the token itself
 *  is the scope, exactly like `resolveSession`. */
export async function revokeSession(presented, reason) {
  if (!REVOKE_REASONS.has(reason)) {
    throw internal(`revoke reason must be one of ${[...REVOKE_REASONS].join(", ")}`);
  }
  const parsed = parsePresented(presented);
  if (!parsed) return { revoked: false };
  const hash = hashSecret(parsed.secret);
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT keystone.revoke_session_by_token($1,$2,$3) AS n`,
      [parsed.tokenId, hash, reason]
    );
    return { revoked: rows[0].n > 0 };
  });
}

/**
 * "Remove this device". ★★★ TAKES THE CALLER'S ALREADY-TENANT-SCOPED `db` HANDLE — it must NOT
 * use `withCredentialLookup`, which issues no `set_config` (src/db/index.mjs:176-193). Without the
 * tenant GUC, `keystone.revoke_session_by_id`'s own guard
 * (`p_tenant_id::text = current_setting('keystone.tenant_id', true)`, 0176) would return zero rows
 * every time.
 */
export async function revokeSessionById(db, tenantId, appUserId, sessionId, reason) {
  if (!REVOKE_REASONS.has(reason)) {
    throw internal(`revoke reason must be one of ${[...REVOKE_REASONS].join(", ")}`);
  }
  const { rows } = await db.query(
    `SELECT keystone.revoke_session_by_id($1,$2,$3,$4) AS n`,
    [tenantId, appUserId, sessionId, reason]
  );
  return { revoked: rows[0].n > 0 };
}

/**
 * ★★★ F634 — THE ONLY READER THAT CAN SEE A kind='partial' ROW. resolveSession() (above) now
 * EXCLUDES kind='partial' outright (migration 0228); this is its narrow, deliberate opposite,
 * used by exactly one route: POST /api/auth/two-step/verify. Returns two uuids, never a
 * firebase_uid — CONTRACTS §0 C-1 already refused a SECURITY DEFINER handing a uid text back
 * once (Q0-16); the caller gets the uid the same way login.mjs's own person lookup and this
 * task's other six routes already do, an ordinary RLS'd SELECT against keystone.app_user run
 * inside withTenant(tenantId).
 */
export async function resolvePartialSession(presented) {
  const parsed = parsePresented(presented);
  if (!parsed) return undefined;
  const hash = hashSecret(parsed.secret);
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT tenant_id, app_user_id FROM keystone.resolve_partial_session($1, $2)`,
      [parsed.tokenId, hash]
    );
    if (rows.length === 0) return undefined;
    return { tenantId: rows[0].tenant_id, appUserId: rows[0].app_user_id };
  });
}

/**
 * ★★★ F634 — THE UPGRADE, CALLED ONLY AFTER totp.mjs's verifyTotp HAS ALREADY SUCCEEDED (the
 * SAME "verify, then act" shape verifyEmailCode + signInWithCode already use, and disableTotp's
 * own re-verify-then-write sequence). ONE UPDATE, guarded on kind='partial': a second call, or
 * one racing the row's own 1-hour expiry, touches nothing and returns undefined — the caller
 * (the route) turns that into a 401, never a silent success. IN PLACE, not revoke-and-remint:
 * the token_id/secret string the browser already holds does not change, so no new secret has to
 * cross the wire (P0.7/F109's standing rule against a second copy of a session secret in JSON).
 */
export async function upgradeSession(presented) {
  const parsed = parsePresented(presented);
  if (!parsed) return undefined;
  const hash = hashSecret(parsed.secret);
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT tenant_id, app_user_id FROM keystone.upgrade_session($1, $2)`,
      [parsed.tokenId, hash]
    );
    if (rows.length === 0) return undefined;
    return { tenantId: rows[0].tenant_id, appUserId: rows[0].app_user_id };
  });
}

/**
 * ★★★ the maintainer, 28 Sep 2026 — THE ONE READER THAT CAN SEE A kind='handoff' ROW, mirroring
 * resolvePartialSession's own shape exactly (resolveSession excludes 'handoff' the same way it
 * excludes 'partial' — see 0532_handoff_session_kind.sql). Used by exactly one route:
 * GET /api/auth/handoff/redeem, on the PRACTICE's own host. ATOMIC: the SQL function's WHERE
 * clause IS the validity check (right secret, kind='handoff', not expired, not already redeemed),
 * so a replayed link or a second concurrent request simply gets `undefined` back, never a second
 * success. On success the row is already moved to kind='partial' (1 hour) — the caller then calls
 * `upgradeSession` with the SAME presented string when no second factor is outstanding, exactly
 * the path an ordinary two-step-pending sign-in already takes.
 */
export async function redeemHandoffSession(presented) {
  const parsed = parsePresented(presented);
  if (!parsed) return undefined;
  const hash = hashSecret(parsed.secret);
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT tenant_id, app_user_id, firebase_uid FROM keystone.redeem_handoff_session($1, $2)`,
      [parsed.tokenId, hash]
    );
    if (rows.length === 0) return undefined;
    return { tenantId: rows[0].tenant_id, appUserId: rows[0].app_user_id, firebaseUid: rows[0].firebase_uid };
  });
}

/**
 * "Sign out everywhere", practice-scoped. ★★★ SAME RULE AS `revokeSessionById` — takes the
 * caller's already-tenant-scoped `db` handle, never `withCredentialLookup`, for the same reason.
 */
export async function revokeSessionsForUser(db, tenantId, appUserId, reason, { exceptTokenId = null } = {}) {
  if (!REVOKE_REASONS.has(reason)) {
    throw internal(`revoke reason must be one of ${[...REVOKE_REASONS].join(", ")}`);
  }
  const { rows } = await db.query(
    `SELECT keystone.revoke_sessions_for_user($1,$2,$3,$4) AS n`,
    [tenantId, appUserId, reason, exceptTokenId]
  );
  return { revoked: rows[0].n };
}

/**
 * ★★★ Task 1.4 / CT-112 (spec 01's same-tenant half) — ENTER "viewing as". Same shape as
 * `upgradeSession` above: parse the presented token locally, hash the secret, hand both to the
 * SECURITY DEFINER function that does the actual UPDATE. `keystone.enter_viewing_as` (0250)
 * refuses (zero rows, so `undefined` here) unless the caller's session is a live `kind='app'` row
 * and the target is `role='staff'` in the SAME tenant as the caller and is not the caller — the
 * route (src/routes/index.mjs) turns `undefined` into the refusal spec §2 names, never a 200.
 */
export async function enterViewingAs(presented, targetAppUserId) {
  const parsed = parsePresented(presented);
  if (!parsed) return undefined;
  const hash = hashSecret(parsed.secret);
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT tenant_id, viewing_as_app_user_id, expires_at FROM keystone.enter_viewing_as($1, $2, $3)`,
      [parsed.tokenId, hash, targetAppUserId]
    );
    if (rows.length === 0) return undefined;
    return {
      tenantId: rows[0].tenant_id,
      viewingAsAppUserId: rows[0].viewing_as_app_user_id,
      expiresAt: rows[0].expires_at,
    };
  });
}

/**
 * ★★★ Task 1.4 / CT-112 — EXIT "viewing as". Idempotent (spec §3: "matches revokeInvite's own
 * 'already revoked is not an error' idiom") — `keystone.exit_viewing_as` (0250) matches and
 * returns a row for any live `kind='app'` session regardless of whether the claim was already
 * clear, so this only returns `undefined` when the presented token itself does not resolve to a
 * live app session (the route then answers 401, not 409 — spec §2's 409 is TeamSeeAs's own route
 * concern, not this wrapper's).
 */
export async function exitViewingAs(presented) {
  const parsed = parsePresented(presented);
  if (!parsed) return undefined;
  const hash = hashSecret(parsed.secret);
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT tenant_id FROM keystone.exit_viewing_as($1, $2)`,
      [parsed.tokenId, hash]
    );
    if (rows.length === 0) return undefined;
    return { tenantId: rows[0].tenant_id };
  });
}

/**
 * The device list's only read. ★★★ SAME RULE AS `revokeSessionById` — takes the caller's
 * already-tenant-scoped `db` handle, never `withCredentialLookup`, for the same reason. Maps
 * `keystone.sessions_for_user`'s snake_case columns to camelCase, `is_current` → `current`
 * (CT-026); no key here matches `/secret|hash|token/i`.
 */
export async function listSessionsForUser(db, tenantId, appUserId, currentTokenId) {
  const { rows } = await db.query(
    `SELECT * FROM keystone.sessions_for_user($1,$2,$3)`,
    [tenantId, appUserId, currentTokenId]
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
    userAgent: r.user_agent,
    ipFirstSeen: r.ip_first_seen,
    current: r.is_current,
  }));
}
