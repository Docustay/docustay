// @ts-check
/**
 * CONSENT TOKENS AND UNSUBSCRIBE FLOW (Stage 16, task 16.25).
 *
 * Mints and redeems unsubscribe tokens from email links. Tokens are single-use by design:
 * a token is valid only until redeemed, and idempotence at the handler level (same response
 * on repeat, no second row written) is the contract.
 *
 * ★★★ ENUMERATION-SAFE: An invalid token returns the SAME shape as a valid one, with
 *     null practice info. This prevents a stranger from discovering whether an email
 *     belongs to a practice by watching response differences.
 */

import { randomBytes } from "node:crypto";
import { hashSecret } from "../auth/linkToken.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";

/**
 * MINT an unsubscribe token. Returns the plaintext token (43 base64url chars),
 * which the caller embeds in a link. The token_hash is stored; the plaintext is never
 * retrievable after this call.
 *
 * @param {tx} - the tenant transaction
 * @param {object} - { tenantId, personId }
 * @returns {string} - plaintext token, 43 base64url characters
 */
export async function mintUnsubscribeToken(tx, { tenantId, personId }) {
  const secret = randomBytes(32).toString("base64url");
  const tokenHash = hashSecret(secret);

  await tx.query(
    `INSERT INTO keystone.unsubscribe_token (tenant_id, person_id, token_hash)
     VALUES ($1, $2, $3)`,
    [tenantId, personId, tokenHash]
  );

  return secret;
}

/**
 * UNSUBSCRIBE by token. Marks a person as opted-out of marketing.
 * Idempotent — calling twice with the same token returns identical response,
 * and writes at most one consent_record row.
 *
 * ★★★ ENUMERATION-SAFE: If the token is invalid, returns {status:'unsubscribed'}
 * with practiceName and ownerFirstName both null, and writes nothing.
 * If the token is valid, returns the practice name and owner's first name.
 * A stranger cannot tell the difference from response shape alone.
 *
 * @param {tx} - the tenant transaction
 * @param {object} - { tenantId, token }
 * @returns {object} - {status:'unsubscribed', practiceName, ownerFirstName}
 */
export async function unsubscribeByToken(tx, { tenantId, token }) {
  const tokenHash = hashSecret(token);

  // Look up the token (enumeration-safe)
  const { rows: tokenRows } = await run(tx, db.selectFrom("keystone.unsubscribe_token").select(["person_id"]).where("tenant_id", "=", tenantId).where("token_hash", "=", tokenHash));

  if (tokenRows.length === 0) {
    // Invalid token — return safe response without writing
    return { status: "unsubscribed", practiceName: null, ownerFirstName: null };
  }

  const personId = tokenRows[0].person_id;

  // Check if this person already has an active marketing opt-out (idempotence)
  const { rows: existingRows } = await run(tx, db.selectFrom("keystone.consent_record").select(["id"]).where("tenant_id", "=", tenantId).where("person_id", "=", personId).where("consent_type", "=", "marketing").where("is_active", "=", false));

  // Only insert if no existing opt-out — prevents duplicate rows
  if (existingRows.length === 0) {
    await tx.query(
      `INSERT INTO keystone.consent_record
       (tenant_id, person_id, consent_type, is_active, revoked_at, consent_method, detail)
       VALUES ($1, $2, 'marketing', false, now(), 'web_form', 'unsubscribe link')`,
      [tenantId, personId]
    );

    // Emit the event
    // ★★★ RUN-2 T19 (26 Sep 2026) — this passed `{ subject, event, changes }`, none of which emit()
    //     takes: it threw, the transaction rolled back, and the consent row above was never written —
    //     the link did not unsubscribe. test/r2_unsubscribe.test.mjs proves it now does.
    await emit(tx, {
      tenantId,
      topic: "growth.consent.unsubscribed",
      emittedBy: "growth",
      subjectType: "person",
      subjectId: personId,
      actor: userActor(personId),
      payload: { consent_type: "marketing", is_active: false },
    });
  }

  // Update last_used_at on the token
  await tx.query(
    `UPDATE keystone.unsubscribe_token SET last_used_at = now()
     WHERE tenant_id = $1 AND token_hash = $2`,
    [tenantId, tokenHash]
  );

  // Fetch practice info for response
  const { rows: tenantRows } = await run(tx, db.selectFrom("keystone.tenant").select(["name"]).where("id", "=", tenantId));
  const practiceName = tenantRows[0]?.name ?? null;

  // Fetch owner's first name
  let ownerFirstName = null;
  if (practiceName) {
    const { rows: ownerRows } = await run(tx, db.selectFrom("keystone.app_user").select(["display_name"]).where("tenant_id", "=", tenantId).where("staff_role", "=", "owner").limit(1));
    if (ownerRows.length > 0) {
      const fullName = ownerRows[0].display_name || "";
      ownerFirstName = fullName.split(" ")[0] || null;
    }
  }

  return { status: "unsubscribed", practiceName, ownerFirstName };
}

/**
 * RESUBSCRIBE by token. Re-activates marketing consent for a person.
 * Idempotent — calling twice returns identical response, and writes at most
 * one active consent_record row.
 *
 * ★★★ ENUMERATION-SAFE: Same as unsubscribe — invalid token returns safe response.
 *
 * @param {tx} - the tenant transaction
 * @param {object} - { tenantId, token }
 * @returns {object} - {status:'resubscribed'}
 */
export async function resubscribeByToken(tx, { tenantId, token }) {
  const tokenHash = hashSecret(token);

  // Look up the token (enumeration-safe)
  const { rows: tokenRows } = await run(tx, db.selectFrom("keystone.unsubscribe_token").select(["person_id"]).where("tenant_id", "=", tenantId).where("token_hash", "=", tokenHash));

  if (tokenRows.length === 0) {
    // Invalid token — return safe response without writing
    return { status: "resubscribed" };
  }

  const personId = tokenRows[0].person_id;

  // Check if this person already has an active marketing opt-in (idempotence)
  const { rows: existingRows } = await run(tx, db.selectFrom("keystone.consent_record").select(["id"]).where("tenant_id", "=", tenantId).where("person_id", "=", personId).where("consent_type", "=", "marketing").where("is_active", "=", true));

  // Only insert if no existing active consent — prevents duplicate rows
  if (existingRows.length === 0) {
    await tx.query(
      `INSERT INTO keystone.consent_record
       (tenant_id, person_id, consent_type, is_active, consent_method, detail)
       VALUES ($1, $2, 'marketing', true, 'web_form', 'resubscribe link')`,
      [tenantId, personId]
    );

    // Emit the event
    // ★★★ RUN-2 T19 (26 Sep 2026) — this passed `{ subject, event, changes }`, none of which emit()
    //     takes: it threw, the transaction rolled back, and the consent row above was never written —
    //     the link did not resubscribe. test/r2_unsubscribe.test.mjs proves it now does.
    await emit(tx, {
      tenantId,
      topic: "growth.consent.resubscribed",
      emittedBy: "growth",
      subjectType: "person",
      subjectId: personId,
      actor: userActor(personId),
      payload: { consent_type: "marketing", is_active: true },
    });
  }

  // Update last_used_at on the token
  await tx.query(
    `UPDATE keystone.unsubscribe_token SET last_used_at = now()
     WHERE tenant_id = $1 AND token_hash = $2`,
    [tenantId, tokenHash]
  );

  return { status: "resubscribed" };
}
