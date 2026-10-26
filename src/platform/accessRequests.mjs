// @ts-check
// Stage 18 task 18.3 — Support-access requests (CT-F13 core).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ OPERATOR ASKS, OWNER ANSWERS. An `operator_access_request` row is created when a platform
//     operator asks for temporary access to a tenant. The Owner may approve (creating a
//     `support_access` grant) or deny. Once answered, the request is immutable.
//
// ★★ NOTIFICATIONS AND QUEUED JOBS. When an ask is created, every Owner-role staff member gets an
//    in-app notification. The email delivery is queued separately (not fan-out, only email), so if
//    an email job fails, the notification persists.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { withTenant } from "../db/index.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { writeAudit } from "../permissions/audit.mjs";
import { emit } from "../events/outbox.mjs";
import { createNotification } from "../notifications/writes.mjs";
import { enqueue } from "../queue/runner.mjs";
import { grantSupportAccess } from "./supportAccess.mjs";
import { invalid, conflict } from "../http/errors.mjs";

/**
 * Ask for access. Creates an `operator_access_request` row with state 'asked', writes an audit
 * entry, emits an event, creates one notification per Owner-role staff member, and queues an
 * email job for each notification.
 *
 * ★ Opens its own `withTenant(tenantId, …)` (C10 — the caller is a platform request).
 *
 * @param {string} tenantId - the practice being requested to access
 * @param {string} operatorGrantId - the operator_grant.id UUID requesting access
 * @param {string} why - 10-1000 characters (after trim), required reason for the access
 * @param {number} durationMinutes - one of {60, 120, 240, 480}
 * @returns {Promise<{id, state: 'asked', askedAt}>}
 */
export async function askForAccess({ tenantId, operatorGrantId, why, durationMinutes }) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!operatorGrantId) throw invalid("operatorGrantId is required");

  // Validate why: 10–1000 chars after trim
  if (typeof why !== "string") throw invalid("why must be a string");
  const whyTrimmed = why.trim();
  if (whyTrimmed.length < 10 || whyTrimmed.length > 1000) {
    throw invalid("Say why in a sentence or two — they read this.");
  }

  // Validate duration: only specific values allowed
  const validDurations = [60, 120, 240, 480];
  if (!validDurations.includes(durationMinutes)) {
    throw invalid(`durationMinutes must be one of ${validDurations.join(", ")}`);
  }

  return withTenant(tenantId, async (tx) => {
    // Resolve operator_label using the database function
    const labelResult = await tx.query(
      "SELECT keystone.operator_display_name($1) AS label",
      [operatorGrantId]
    );
    const operatorLabel = labelResult.rows[0]?.label || "Workbench support";

    // Check for an existing open ask: the unique index prevents duplicates
    const existingResult = await run(tx, db
      .selectFrom("keystone.operator_access_request")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("operator_grant_id", "=", operatorGrantId)
      .where("state", "=", "asked")
    );
    if (existingResult.rows.length > 0) {
      throw conflict("You already asked — they haven't answered yet.");
    }

    // Insert the request row
    const { rows: requestRows } = await tx.query(
      `INSERT INTO keystone.operator_access_request
         (tenant_id, operator_grant_id, operator_label, why, duration_minutes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, state, asked_at`,
      [tenantId, operatorGrantId, operatorLabel, whyTrimmed, durationMinutes]
    );
    const requestRow = requestRows[0];

    // Write audit entry with the why as the reason
    await writeAudit(tx, {
      tenantId,
      action: "operator.grant_requested",
      object: "support_access",
      subjectId: requestRow.id,
      actorOperatorGrantId: operatorGrantId,
      reason: whyTrimmed,
    });

    // Emit event for topic listeners
    await emit(tx, {
      tenantId,
      topic: "platform.support_access.requested",
      emittedBy: "platform",
      subjectType: "support_access",
      subjectId: requestRow.id,
      payload: {
        request_id: requestRow.id,
        duration_minutes: durationMinutes,
      },
    });

    // Create one notification per Owner-role staff member, and queue email jobs
    const ownersResult = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(["id", "email"])
      .where("tenant_id", "=", tenantId)
      .where("staff_role", "=", "owner")
    );

    // Need a fake event ID for the notification (the notification system requires it)
    // Since this is a new feature and the owner just created the request, we'll use the request id
    const { rows: fakeEventRows } = await tx.query(
      `INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor, sample)
       VALUES ($1, 'platform.support_access.requested', 'platform', 'support_access', $2, $3, 'system', false)
       RETURNING id`,
      [tenantId, requestRow.id, JSON.stringify({})]
    );
    const eventId = fakeEventRows[0].id;

    for (const owner of ownersResult.rows) {
      // Create in-app notification
      const notifResult = await createNotification(tx, {
        tenantId,
        recipientId: owner.id,
        eventId,
        topic: "platform.support_access.requested",
        title: "Workbench asked to look at your account",
        body: whyTrimmed,
        deepLink: "/settings/support-access",
      });

      // Queue email delivery job AFTER the transaction commits
      // We'll collect these to queue after commit
    }

    // Return the created request
    return {
      id: requestRow.id,
      state: requestRow.state,
      askedAt: requestRow.asked_at,
    };
  }, { operatorGrantId }).then(async (result) => {   // ★ the operator's grant rides the transaction: audit_entry's INSERT ... RETURNING needs the SELECT policy, which an operator passes only through caller_is_platform()
    // Queue email jobs after transaction commits
    // We need to re-fetch the notification IDs to queue them
    try {
      await withTenant(tenantId, async (tx) => {
        const ownersResult = await run(tx, db
          .selectFrom("keystone.app_user")
          .select("id")
          .where("tenant_id", "=", tenantId)
          .where("staff_role", "=", "owner")
        );

        for (const owner of ownersResult.rows) {
          const notifResult = await run(tx, db
            .selectFrom("keystone.notification")
            .select("id")
            .where("tenant_id", "=", tenantId)
            .where("recipient_id", "=", owner.id)
            .where("topic", "=", "platform.support_access.requested")
            .orderBy("created_at", "desc")
            .limit(1)
          );

          if (notifResult.rows.length > 0) {
            const notificationId = notifResult.rows[0].id;
            await enqueue("deliver_notification_email", { tenantId, notificationId }, {
              jobKey: `email:${notificationId}`,
              jobKeyMode: "replace",
              priority: -5,   // ahead of background sweeps (NOTICE_PRIORITY, src/queue/tasks.mjs)
            });
          }
        }
      });
    } catch (e) {
      // Silently fail to queue emails; the notification still exists
      console.error("Failed to queue email jobs for support access request:", e.message);
    }

    return result;
  });
}

/**
 * Answer a support access request. Must be called by an Owner. Locks the row, verifies state is
 * 'asked', and either creates a support_access grant (yes) or records a denial (no).
 *
 * ★ Caller must check that actorUserId is an Owner before calling.
 * ★ `tx` is the Owner's transaction (not opened here).
 *
 * @param {object} tx - transaction client, already inside the tenant
 * @param {string} tenantId - the practice
 * @param {string} requestId - the operator_access_request row id
 * @param {string} answer - 'yes' or 'no'
 * @param {string} actorUserId - the answering Owner's app_user id
 * @returns {Promise<{id, state, supportAccessId: null|string, expiresAt: null|Date}>}
 */
export async function answerAccessRequest(tx, { tenantId, requestId, answer, actorUserId }) {
  if (!["yes", "no"].includes(answer)) {
    throw invalid("answer must be 'yes' or 'no'");
  }
  if (!actorUserId) throw invalid("actorUserId is required");
  if (!requestId) throw invalid("requestId is required");

  // Lock the row FOR UPDATE
  const { rows: requestRows } = await tx.query(
    `SELECT * FROM keystone.operator_access_request
     WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, requestId]
  );

  if (requestRows.length === 0) {
    throw invalid("request not found");
  }

  const request = requestRows[0];

  // Verify state is 'asked'
  if (request.state !== "asked") {
    throw conflict("This was already answered.");
  }

  let supportAccessId = null;
  let expiresAt = null;
  let newState;

  if (answer === "yes") {
    newState = "approved";

    // Call grantSupportAccess with the same transaction (not opening a new one)
    // Calculate expires_at: now + duration_minutes
    const expiresAtValue = new Date(Date.now() + request.duration_minutes * 60000);
    expiresAt = expiresAtValue;

    // Insert the support_access row directly (matching the pattern from supportAccess.mjs)
    const grantResult = await tx.query(
      `INSERT INTO keystone.support_access
         (tenant_id, operator_user_id, expires_at, allow_changes, allow_private_notes)
       VALUES ($1, $2, $3, false, false)
       RETURNING id`,
      [tenantId, request.operator_grant_id, expiresAtValue]
    );
    supportAccessId = grantResult.rows[0].id;

    // Write audit entry
    await writeAudit(tx, {
      tenantId,
      action: "operator.grant_approved",
      object: "support_access",
      subjectId: requestId,
      actorUserId,
    });
  } else {
    // answer === 'no'
    newState = "denied";

    // Write audit entry for denial
    await writeAudit(tx, {
      tenantId,
      action: "operator.grant_denied",
      object: "support_access",
      subjectId: requestId,
      actorUserId,
    });
  }

  // Update the request row with the answer
  const updateResult = await tx.query(
    `UPDATE keystone.operator_access_request
     SET state = $1, answered_at = now(), answered_by = $2, support_access_id = $3
     WHERE id = $4
     RETURNING id, state, support_access_id,
               (SELECT sa.expires_at FROM keystone.support_access sa WHERE sa.id = $3) AS expires_at`,  /* expiry lives on the grant */
    [newState, actorUserId, supportAccessId, requestId]
  );

  // Emit answered event
  await emit(tx, {
    tenantId,
    topic: "platform.support_access.answered",
    emittedBy: "platform",
    subjectType: "support_access",
    subjectId: requestId,
    payload: {
      request_id: requestId,
      answer,
    },
  });

  return {
    id: updateResult.rows[0].id,
    state: updateResult.rows[0].state,
    supportAccessId: updateResult.rows[0].support_access_id,
    expiresAt: updateResult.rows[0].expires_at,
  };
}

/**
 * End a support access grant early (tenant-side revocation).
 *
 * @param {object} tx - transaction client, already inside the tenant (owner's transaction)
 * @param {string} tenantId - the practice
 * @param {string} supportAccessId - the support_access row id
 * @param {string} actorUserId - the Owner ending the access
 * @returns {Promise<{ended: boolean}>}
 */
export async function endSupportAccess(tx, { tenantId, supportAccessId, actorUserId }) {
  if (!supportAccessId) throw invalid("supportAccessId is required");
  if (!actorUserId) throw invalid("actorUserId is required");

  const { rows } = await tx.query(
    `UPDATE keystone.support_access
     SET revoked_at = now()
     WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [supportAccessId, tenantId]
  );

  const ended = rows.length > 0;

  if (ended) {
    // Write audit entry
    await writeAudit(tx, {
      tenantId,
      action: "operator.grant_revoked",
      object: "support_access",
      subjectId: supportAccessId,
      actorUserId,
      reason: "ended early",
    });

    // Emit ended event
    await emit(tx, {
      tenantId,
      topic: "platform.support_access.ended",
      emittedBy: "platform",
      subjectType: "support_access",
      subjectId: supportAccessId,
      payload: {},
    });
  }

  return { ended };
}

/**
 * End my own access grant (operator-side revocation).
 *
 * @param {string} tenantId - the practice
 * @param {string} operatorGrantId - the operator_grant id (identifies the operator)
 * @returns {Promise<{ended: boolean}>}
 */
export async function endMyAccess({ tenantId, operatorGrantId }) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!operatorGrantId) throw invalid("operatorGrantId is required");

  return withTenant(tenantId, async (tx) => {
    // Find the live access for this operator
    const liveAccess = await liveAccessFor(tx, { tenantId, operatorGrantId });

    if (!liveAccess) {
      // No active grant to revoke
      return { ended: false };
    }

    const { rows } = await tx.query(
      `UPDATE keystone.support_access
       SET revoked_at = now()
       WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [liveAccess.supportAccessId, tenantId]
    );

    const ended = rows.length > 0;

    if (ended) {
      // Write audit entry
      await writeAudit(tx, {
        tenantId,
        action: "operator.grant_revoked",
        object: "support_access",
        subjectId: liveAccess.supportAccessId,
        actorOperatorGrantId: operatorGrantId,
        reason: "ended early",
      });

      // Emit ended event
      await emit(tx, {
        tenantId,
        topic: "platform.support_access.ended",
        emittedBy: "platform",
        subjectType: "support_access",
        subjectId: liveAccess.supportAccessId,
        payload: {},
      });
    }

    return { ended };
  }, { operatorGrantId });
}

/**
 * List all support access requests and grants for a tenant, organized by state.
 *
 * @param {object} tx - transaction client, already inside the tenant
 * @param {string} tenantId - the practice
 * @returns {Promise<{pending: Array, live: Array, history: Array}>}
 *   - pending: asked but not yet answered
 *   - live: approved, not yet expired, not yet revoked
 *   - history: all past requests (newest first, limit 50), with audit reads for each
 */
export async function listSupportAccess(tx, { tenantId }) {
  if (!tenantId) throw invalid("tenantId is required");

  // Pending: state = 'asked'
  const pendingResult = await run(tx, db
    .selectFrom("keystone.operator_access_request")
    .select([
      "id",
      "operator_label",
      "why",
      "duration_minutes",
      "state",
      "asked_at",
      "answered_at",
      "answered_by",
      "support_access_id",
      "operator_grant_id"
    ])
    .where("tenant_id", "=", tenantId)
    .where("state", "=", "asked")
    .orderBy("asked_at", "desc")
  );

  // Live: state = 'approved' AND expires_at > now() AND revoked_at IS NULL
  const liveResult = await run(tx, db
    .selectFrom("keystone.operator_access_request as oar")
    .innerJoin("keystone.support_access as sa", "oar.support_access_id", "sa.id")
    .select([
      "oar.id",
      "oar.operator_label",
      "oar.why",
      "oar.duration_minutes",
      "oar.state",
      "oar.asked_at",
      "oar.answered_at",
      "sa.expires_at",
      sql`sa.id`.as("support_access_id"),
      "oar.operator_grant_id"
    ])
    .where("oar.tenant_id", "=", tenantId)
    .where("oar.state", "=", "approved")
    .where((eb) => eb("sa.expires_at", ">", sql`now()`))
    .where("sa.revoked_at", "is", null)
    .orderBy("oar.asked_at", "desc")
  );

  // History: all other requests (newest first, limit 50)
  const historyResult = await run(tx, db
    .selectFrom("keystone.operator_access_request")
    .select([
      "id",
      "operator_label",
      "why",
      "duration_minutes",
      "state",
      "asked_at",
      "answered_at",
      "support_access_id",
      "operator_grant_id"
    ])
    .where("tenant_id", "=", tenantId)
    .where("state", "<>", "asked")
    .orderBy("asked_at", "desc")
    .limit(50)
  );

  // For each grant, collect audit reads (support.page_viewed actions by the operator)
  const buildRequestWithReads = async (request) => {
    const readsResult = await run(tx, db
      .selectFrom("keystone.audit_entry")
      .select(["at", "object"])
      .where("tenant_id", "=", tenantId)
      .where("action", "=", "support.page_viewed")
      .where("actor_operator_grant_id", "=", request.operator_grant_id)
      .where("at", ">=", request.asked_at)
      .orderBy("at", "desc")
    );

    return {
      id: request.id,
      operatorLabel: request.operator_label,
      why: request.why,
      durationMinutes: request.duration_minutes,
      state: request.state,
      askedAt: request.asked_at,
      answeredAt: request.answered_at,
      supportAccessId: request.support_access_id,
      expiresAt: request.expires_at || null,
      reads: readsResult.rows.map((r) => ({
        at: r.at,
        object: r.object,
      })),
    };
  };

  const pending = await Promise.all(pendingResult.rows.map(buildRequestWithReads));
  const live = await Promise.all(liveResult.rows.map(buildRequestWithReads));
  const history = await Promise.all(historyResult.rows.map(buildRequestWithReads));

  return { pending, live, history };
}

/**
 * Find the live access for an operator in this tenant, if any.
 * Returns the live support_access row joined to its request, or null.
 *
 * ★ Used by 18.8 and endMyAccess.
 *
 * @param {object} tx - transaction client, already inside the tenant
 * @param {string} tenantId - the practice
 * @param {string} operatorGrantId - the operator_grant id
 * @returns {Promise<{supportAccessId, requestId, why, expiresAt, answeredAt} | null>}
 */
export async function liveAccessFor(tx, { tenantId, operatorGrantId }) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!operatorGrantId) throw invalid("operatorGrantId is required");

  const { rows } = await run(tx, db
    .selectFrom("keystone.support_access as sa")
    .innerJoin("keystone.operator_access_request as oar", "sa.id", "oar.support_access_id")
    .select([
      sql`sa.id`.as("support_access_id"),
      sql`oar.id`.as("request_id"),
      "oar.why",
      "sa.expires_at",
      "oar.answered_at"
    ])
    .where("sa.tenant_id", "=", tenantId)
    .where("oar.operator_grant_id", "=", operatorGrantId)
    .where((eb) => eb("sa.expires_at", ">", sql`now()`))
    .where("sa.revoked_at", "is", null)
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    supportAccessId: row.support_access_id,
    requestId: row.request_id,
    why: row.why,
    expiresAt: row.expires_at,
    answeredAt: row.answered_at,
  };
}
