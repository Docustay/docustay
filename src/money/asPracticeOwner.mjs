// Stage 15 Task 15.2 — PRACTICE OWNER UTILITIES
//
// Helper to find and run operations as the practice owner.

import { asViewer } from "../db/viewer.mjs";

/**
 * Find the practice's owner user.
 *
 * @param {object} tx a tenant transaction
 * @param {string} tenantId the practice id
 * @returns {Promise<string>} the owner's user id
 * @throws if no owner exists
 */
export async function practiceOwnerId(tx, tenantId) {
  const { rows } = await tx.query(
    `SELECT id FROM keystone.app_user
      WHERE tenant_id = $1 AND role = 'staff' AND staff_role = 'owner' AND archived_at IS NULL
      ORDER BY created_at LIMIT 1`,
    [tenantId]);

  if (rows.length === 0) {
    throw new Error("No practice owner found");
  }

  return rows[0].id;
}

/**
 * Run a function as the practice owner.
 *
 * @param {object} tx a tenant transaction
 * @param {string} tenantId the practice id
 * @param {Function} fn the function to run (receives tx, returns a promise)
 * @returns {Promise<*>} the result of fn
 */
export async function asPracticeOwner(tx, tenantId, fn) {
  const ownerId = await practiceOwnerId(tx, tenantId);
  return asViewer(tx, ownerId, fn);
}
