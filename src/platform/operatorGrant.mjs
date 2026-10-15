// src/platform/operatorGrant.mjs — Stage 7 task 7.4. CT-039 / CCR-12.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIN WRAPPERS, EACH ONE QUERY AGAINST THE MATCHING DEFINER FUNCTION. `keystone.grant_operator`,
//     `keystone.revoke_operator` and `keystone.operator_grant_active` (migration 0184) do ALL the
//     deciding — blank-reason refusal, expires-in-the-future refusal, the duplicate-active-grant
//     refusal, the revoke count. Nothing here re-implements any of it: the SAME reason the codebase
//     never re-derives the salt/pepper argument in a fourth place (src/auth/linkToken.mjs:9-10)
//     applies here to the operator-grant rules.
//
// ★★ `withCredentialLookup`, NOT `withTenant`. `keystone_auth.operator_grant` carries no `tenant_id`
//    (CT-039) and none of the three functions reads a tenant-scoped table, so there is no tenant
//    context to set — exactly the shape `src/auth/session.mjs` and `src/auth/linkToken.mjs` already
//    use for the other keystone_auth tables. The three functions are `SECURITY DEFINER` and
//    `GRANT EXECUTE`d to `app_rw` (0184), so the ordinary application connection reaches them with
//    no elevated privilege of its own — the return types (a boolean, a uuid, an integer) are the
//    entire safety argument, same as every other resolver in this schema.
//
// ★★★ `scripts/operator-grant.mjs` IS THE FIRST CALLER (CCR-12). Without a caller of
//     `grantOperator`/`revokeOperator`, the operator grant this migration and 0186's bootstrap seed
//     create would be a credential nothing in the system could ever take back — worse than an
//     orphan (CLAUDE.md failure #1), a security hole with a JSON schema. `operatorGrantActive` has
//     no NON-TEST application caller yet in Stage 7 — it is called by the script's `list`, by this
//     task's own tests, and inside the database by 7.6's `keystone.caller_is_platform()` — and is
//     recorded as a knowing baseline orphan in `db/gates/wiring-baseline.json`, with the note that
//     Stage 9's operator-access screen is what clears it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { withCredentialLookup } from "../db/index.mjs";
import { internal } from "../http/errors.mjs";

function assertNonBlankString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw internal(`operatorGrant: ${name} must be a non-blank string (got ${JSON.stringify(value)})`);
  }
}

/**
 * ISSUE a grant. `expiresAt` is a `Date` or anything `pg` accepts as a `timestamptz` (an ISO
 * string is fine). Every refusal reason (blank uid/grantedBy/reason, a past `expiresAt`, a second
 * active grant for the same uid) is enforced by `keystone.grant_operator` itself — this function
 * only shapes the call and unwraps the returned uuid.
 * @returns {Promise<string>} the new operator_grant row's id (a uuid)
 */
export async function grantOperator({ uid, grantedBy, reason, expiresAt } = {}) {
  assertNonBlankString(uid, "uid");
  assertNonBlankString(grantedBy, "grantedBy");
  assertNonBlankString(reason, "reason");
  if (!(expiresAt instanceof Date) && typeof expiresAt !== "string") {
    throw internal(`operatorGrant: expiresAt must be a Date or an ISO timestamp string (got ${JSON.stringify(expiresAt)})`);
  }

  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT keystone.grant_operator($1, $2, $3, $4) AS id`,
      [uid, grantedBy, reason, expiresAt]);
    return rows[0].id;
  });
}

/**
 * REVOKE every currently-active grant for `uid` (in practice at most one — `grantOperator`'s own
 * uniqueness check makes that true by construction).
 * @returns {Promise<number>} how many rows were revoked — 0 for a uid with no active grant, never
 *   an error (`keystone.revoke_operator` is idempotent by design).
 */
export async function revokeOperator({ uid, reason } = {}) {
  assertNonBlankString(uid, "uid");
  assertNonBlankString(reason, "reason");

  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT keystone.revoke_operator($1, $2) AS count`,
      [uid, reason]);
    return Number(rows[0].count);
  });
}

/**
 * True when `uid` holds a live (not revoked, not expired) operator grant right now.
 * @returns {Promise<boolean>}
 */
export async function operatorGrantActive(uid) {
  assertNonBlankString(uid, "uid");

  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT keystone.operator_grant_active($1) AS active`, [uid]);
    return rows[0].active === true;
  });
}
