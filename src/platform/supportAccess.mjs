// src/platform/supportAccess.mjs — Stage 2 task C1.7. Support access grants.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIN WRAPPERS, EACH ONE QUERY AGAINST THE MATCHING TABLE OR DEFINER FUNCTION.
//     `keystone.support_access` (migration 0362) stores time-bound grants of access to a tenant
//     for a platform operator. Nothing here re-implements the expiry or revocation rules — they
//     are enforced by the checks in `isGrantActive` and at the schema level.
//
// ★★ `withTenant`, NOT `withCredentialLookup`. A support grant is TENANT-SCOPED (the operator
//    is granted access to a specific tenant, not platform-wide), and all three functions read
//    tenant-scoped tables. The grant itself lives in `keystone.support_access` which has FORCE
//    ROW LEVEL SECURITY like every other tenant table.
//
// ★★★ "A GRANT NEVER OUTLIVES ITS EXPIRY" — ENFORCED AT READ TIME. Any function checking whether
//     a grant is currently active must verify BOTH `expires_at > now()` AND `revoked_at IS NULL`.
//     This is not just an optimization: an operator's access must vanish the instant the expiry
//     time passes, with no need to run a reaper or call a revoke function.
//
// ★★ EVERY USE AUDITED — callers who actually USE an active grant (not just grant/revoke/check)
//    must write an audit row. The grant lifecycle functions (grant/revoke/check) do not audit
//    themselves; they are primitives for the caller to use. If a route or handler uses a grant
//    to permit an action, that USE is audited at the call site (see src/settings/audit.mjs).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { withTenant } from "../db/index.mjs";
import { internal, forbidden } from "../http/errors.mjs";

function assertNonBlankString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw internal(`supportAccess: ${name} must be a non-blank string (got ${JSON.stringify(value)})`);
  }
}

function assertValidUuid(value, name) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof value !== "string" || !uuidRegex.test(value)) {
    throw internal(`supportAccess: ${name} must be a valid UUID (got ${JSON.stringify(value)})`);
  }
}

/**
 * ISSUE a support access grant. `expiresAt` is a `Date` or anything `pg` accepts as a
 * `timestamptz` (an ISO string is fine). A grant is scoped to `tenantId` and permits the
 * operator to take specific actions (based on `allowChanges` and `allowPrivateNotes`).
 *
 * ★ OPERATOR-ONLY: This is a platform operator action. The route layer must check
 *   `keystone.caller_is_platform()` before calling this function.
 *
 * @param {string} tenantId - the practice being granted access to
 * @param {string} operatorUserId - the platform operator being granted access (a UUID)
 * @param {Date|string} expiresAt - the instant this grant expires (required, never null)
 * @param {boolean} allowChanges - whether the operator may modify data (default false)
 * @param {boolean} allowPrivateNotes - whether the operator may read/write private notes (default false)
 * @returns {Promise<string>} the new support_access row's id (a uuid)
 */
export async function grantSupportAccess({
  tenantId,
  operatorUserId,
  expiresAt,
  allowChanges = false,
  allowPrivateNotes = false,
} = {}) {
  assertValidUuid(tenantId, "tenantId");
  assertValidUuid(operatorUserId, "operatorUserId");
  if (!(expiresAt instanceof Date) && typeof expiresAt !== "string") {
    throw internal(
      `supportAccess: expiresAt must be a Date or an ISO timestamp string (got ${JSON.stringify(expiresAt)})`);
  }
  if (typeof allowChanges !== "boolean") {
    throw internal(`supportAccess: allowChanges must be a boolean (got ${JSON.stringify(allowChanges)})`);
  }
  if (typeof allowPrivateNotes !== "boolean") {
    throw internal(`supportAccess: allowPrivateNotes must be a boolean (got ${JSON.stringify(allowPrivateNotes)})`);
  }

  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query(
      `INSERT INTO keystone.support_access
        (tenant_id, operator_user_id, expires_at, allow_changes, allow_private_notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tenantId, operatorUserId, expiresAt, allowChanges, allowPrivateNotes]);
    return rows[0].id;
  });
}

/**
 * REVOKE a support access grant early. Sets `revoked_at` to now. Idempotent: calling this
 * on an already-revoked or expired grant is safe (no error).
 *
 * ★ OPERATOR-ONLY: This is a platform operator action.
 *
 * @param {string} tenantId - the practice whose grant is being revoked
 * @param {string} grantId - the support_access row's id to revoke
 * @returns {Promise<boolean>} true if a row was updated, false if the grant was not found
 */
export async function revokeSupportAccess({ tenantId, grantId } = {}) {
  assertValidUuid(tenantId, "tenantId");
  assertValidUuid(grantId, "grantId");

  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query(
      `UPDATE keystone.support_access
        SET revoked_at = now()
       WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [grantId, tenantId]);
    return rows.length > 0;
  });
}

/**
 * True when grant `grantId` is currently active: not expired, not revoked, and held for the
 * given `tenantId`.
 *
 * ★★★ ENFORCED AT READ TIME: This function checks BOTH `expires_at > now()` AND `revoked_at IS NULL`.
 *     A grant that has expired is considered inactive even if it was never explicitly revoked.
 *     This ensures operator access vanishes the instant the expiry time passes.
 *
 * @param {string} tenantId - the practice the grant was issued for
 * @param {string} grantId - the support_access row's id
 * @returns {Promise<boolean>}
 */
async function isGrantActive({ tenantId, grantId } = {}) {
  assertValidUuid(tenantId, "tenantId");
  assertValidUuid(grantId, "grantId");

  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query(
      `SELECT id FROM keystone.support_access
        WHERE id = $1
          AND tenant_id = $2
          AND expires_at > now()
          AND revoked_at IS NULL`,
      [grantId, tenantId]);
    return rows.length > 0;
  });
}

/**
 * Read a specific grant. Returns null if the grant is not found, expired, or revoked.
 *
 * ★★ Used by callers who need to check the grant's permissions (`allow_changes`, `allow_private_notes`).
 *    Callers who USE this grant to perform an action should audit that action (see `src/settings/audit.mjs`).
 *
 * @param {string} tenantId - the practice the grant was issued for
 * @param {string} grantId - the support_access row's id
 * @returns {Promise<{id, operatorUserId, allowChanges, allowPrivateNotes, expiresAt} | null>}
 */
export async function getActiveGrant({ tenantId, grantId } = {}) {
  assertValidUuid(tenantId, "tenantId");
  assertValidUuid(grantId, "grantId");

  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query(
      `SELECT id, operator_user_id, allow_changes, allow_private_notes, expires_at
        FROM keystone.support_access
       WHERE id = $1
         AND tenant_id = $2
         AND expires_at > now()
         AND revoked_at IS NULL`,
      [grantId, tenantId]);
    if (!rows.length) return null;
    return {
      id: rows[0].id,
      operatorUserId: rows[0].operator_user_id,
      allowChanges: rows[0].allow_changes === true,
      allowPrivateNotes: rows[0].allow_private_notes === true,
      expiresAt: rows[0].expires_at,
    };
  });
}
