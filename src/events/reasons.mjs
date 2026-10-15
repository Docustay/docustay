// Stage 3 Task 3, fix round 1 (controller ruling R46) — A REASON IS KEPT ON THE RECORD, NOT IN THE EVENT.
//
// ★★★ §2.4 forbids typed text in an event payload, and Task 3 enforced it inside `emit()`. Three writers
//     used to carry a typed reason in the payload — archive, document decline, stage change — and the
//     served staff app still asks for all three (ArchiveControl, DocumentActions, PersonActions). So the
//     reason is written HERE, into `keystone.record_reason` (migration 0140), in the SAME transaction as
//     the event, joined by `event_id`. Staff reads (History's ACTIVITY_SQL, the audit log) join it back;
//     no `/api/app/*` read does, and it never reaches an outbound webhook because it is not in the payload.
//
// ★★ `createdBy` is ALWAYS the session actor the writer was handed as `actorUserId` — which
//    `routes/writes.mjs` stamps AFTER spreading the body (F494). A body field never reaches it.

import { randomUUID } from "node:crypto";
import { invalid } from "../http/errors.mjs";

// ★ R26 (RECONCILE, 0523) — "write_off": the reason an invoice was marked uncollectible.
const REASON_KINDS = Object.freeze(["archive", "decline", "stage_change", "write_off"]);
const REASON_MAX_CHARS = 500;

/**
 * ★ Trim a caller-supplied reason. Returns null for absent / empty / whitespace-only (no row is
 *   stored), throws a 400 naming the limit for anything over 500 characters or not a string —
 *   BEFORE the writer changes anything, so a refused reason leaves no half-written record.
 */
export function normaliseReason(reason) {
  if (reason === null || reason === undefined) return null;
  if (typeof reason !== "string") throw invalid("reason must be text", { field: "reason" });
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > REASON_MAX_CHARS) {
    throw invalid(`a reason can be at most ${REASON_MAX_CHARS} characters (this one is ${trimmed.length})`,
      { field: "reason" });
  }
  return trimmed;
}

/**
 * ★★ Store the reason beside the event that recorded the act. Call it AFTER `emit()` with the id
 *    `emit()` returned, on the same `tx`. A null reason (see normaliseReason) stores nothing.
 */
export async function keepReason(tx, { tenantId, eventId, subjectType, subjectId, kind, reason, createdBy = null }) {
  if (reason === null) return null;
  if (!REASON_KINDS.includes(kind)) throw new Error(`keepReason: unknown kind ${JSON.stringify(kind)}`);
  if (!eventId) throw new Error("keepReason needs the id of the event the reason belongs to");
  // ★ The id is made here and the INSERT has no RETURNING: a reason is readable by staff only (the table's
  //   tenant_isolation policy reads through reason_is_visible), and RETURNING re-reads the new row through that
  //   policy — so a signer declining a document through their signing link (a client-role principal, who may
  //   WRITE a reason under tenant_insert but never read one) was refused "insufficient privilege" and could not
  //   decline at all. Nothing needs the row back; callers only need its id.
  const id = randomUUID();
  await tx.query(
    `INSERT INTO keystone.record_reason (id, tenant_id, event_id, subject_type, subject_id, kind, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, tenantId, eventId, subjectType, subjectId, kind, reason, createdBy]);
  return id;
}
