// @ts-check
// Messages — thread-based messaging between clients and staff.
//
// Write functions: createThread, sendMessage, markRead.
// Threads are scoped to a client (person_id) and a practice (tenant_id).
// Messages track sender_type (staff|client) and optional read_at for delivery tracking.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, forbidden } from "../http/errors.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const FK_VIOLATION = "23503";

/**
 * Create a new message thread between a client and their practice.
 *
 * ★★ `person_id` IS REQUIRED AND VALIDATED. Thread is scoped to exactly one person (client).
 *    A thread with no person makes no sense — it is a message with nobody to send to.
 *
 * ★ Threads are created on demand (when the first message is sent, or explicitly here).
 *   The return includes the thread id so the caller can immediately send the first message.
 */
export async function createThread(tx, { tenantId, personId }) {
  if (!personId) throw invalid("personId is required — a thread must belong to exactly one person");

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.message_thread")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        person_id: personId ?? null,
        created_at: sql`now()`,
        updated_at: sql`now()`,
      }));
  } catch (e) {
    if (e.code === FK_VIOLATION) {
      throw notFound("the person does not exist in this organisation");
    }
    throw e;
  }

  // ★★ NO emit() here. A thread created but empty is just infrastructure; the first message
  //    is what makes it real. If thread creation is ever user-facing, reconsider.

  return { id, personId };
}

/**
 * Send a message in a thread.
 *
 * ★★ `threadId` AND `body` ARE REQUIRED. A message with no target or no content is invalid.
 *    `sender_type` must be 'staff' or 'client'; `sender_id` names the person sending it.
 *
 * ★ `sender_id` IS NOT VALIDATED AGAINST THE SESSION. The caller is responsible for
 *   ensuring the sender_id they provide is the actual actor — this is not a guard that
 *   prevents forgery; it is just a way to record who sent the message. (In the app, this
 *   comes from the session or from a queue worker, both trusted contexts.)
 *
 * ★ Idempotent: multiple sends of the same body in the same thread within a short time
 *   window could create duplicates. The caller is responsible for preventing that
 *   (e.g., by disabling the send button until the response comes back).
 */
export async function sendMessage(tx, {
  tenantId, threadId, senderType, senderId, body,
}) {
  if (!threadId) throw invalid("threadId is required");
  if (!body || typeof body !== "string" || !body.trim()) {
    throw invalid("body is required and must be a non-empty string");
  }
  if (!["staff", "client"].includes(senderType)) {
    throw invalid("senderType must be 'staff' or 'client'");
  }
  if (!senderId) throw invalid("senderId is required");

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.message")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        thread_id: threadId ?? null,
        sender_type: senderType ?? null,
        sender_id: senderId ?? null,
        body: body.trim() ?? null,
        created_at: sql`now()`,
        read_at: null,
      }));
  } catch (e) {
    if (e.code === FK_VIOLATION) {
      throw notFound("the thread does not exist in this organisation");
    }
    throw e;
  }

  // ★ Update the thread's updated_at to reflect the new message
  await run(tx, db
    .updateTable("keystone.message_thread")
    .set({ updated_at: sql`now()` })
    .where("id", "=", threadId)
    .where("tenant_id", "=", tenantId));

  // ★ Emit a message.sent event for observability and automation
  await emit(tx, {
    tenantId,
    topic: "messages.message.sent",
    emittedBy: "messages",
    subjectType: "message",
    subjectId: id,
    actor: userActor(senderId),
    payload: {
      thread_id: threadId,
      sender_type: senderType,
    },
  });

  return { id, threadId, senderType, senderId, body: body.trim(), created_at: new Date() };
}

/**
 * Mark a message as read.
 *
 * ★★ `messageId` IS REQUIRED. A read without a target makes no sense.
 *    The read is idempotent: if read_at is already set, it does not move.
 *
 * ★ NO ACTOR VALIDATION. The caller does not provide an actor; we trust the RLS boundary
 *   and the session to ensure the reader is authorized. (A staff member can read any message
 *   in their tenant; a client can only read their own thread — that is enforced by RLS,
 *   not by this function.)
 */
export async function markRead(tx, { tenantId, messageId }) {
  if (!messageId) throw invalid("messageId is required");

  const r = await tx.query(
    `UPDATE keystone.message SET read_at = now()
     WHERE id = $1 AND tenant_id = $2 AND read_at IS NULL
     RETURNING read_at, thread_id`,
    [messageId, tenantId]);

  if (r.rowCount === 0) {
    // ★ Already read, or does not exist in this tenant. Not an error — idempotent is the goal.
    return { id: messageId, changed: false };
  }

  return { id: messageId, changed: true, read_at: r.rows[0].read_at, threadId: r.rows[0].thread_id };
}
