// STAGE 7 task 7.3 — THE AUDIT TRAIL: one table, one frozen action set, one writer.
// CT-041 (keystone.audit_entry, db/migrations/0183) · CT-042 (AUDIT_ACTIONS) ·
// CT-043 (writeAudit) · CCR-13 (actor_operator_grant_id, not actor_operator_uid) · Q7-7
// (the per-action field allowlist) · Q7-8 / CCR-8 / conflict C-3 (the extension to 25).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIS FILE IS OWNED OUTRIGHT BY TASK 7.3. Task 7.15 APPENDS a helper to it later (a private-read
//     audit call), in its own named part — nothing here should assume that helper's shape, and
//     nothing here should need to change for it to be added.
//
// ★★ ONE WRITER. `writeAudit` is the only function in the product that inserts into
//    keystone.audit_entry — db/migrations/0183 backs that with GRANT SELECT, INSERT (no UPDATE, no
//    DELETE) and no UPDATE/DELETE policy either. If a second writer is ever tempted, it belongs here,
//    not as a raw INSERT somewhere else, because the field allowlist below (Q7-7) is enforced in
//    exactly one place and a second call site is a second place it can be gotten wrong.
//
// ★ AUDIT_ACTIONS IS 25 MEMBERS AND THE NUMBER IS THE CONTRACT (CT-042, CONTRACTS §0 C-3). The last
//   two — secret.key_rotated, secret.key_retired — have NO CALLER in Stage 7. Stage 9 task 9.12 is
//   their only writer. They are seeded into keystone.audit_action by 0183 anyway: the set is frozen
//   the moment this migration applies, and there is no later migration that can widen a frozen
//   contract without reopening it. Recorded as an orphan-by-construction, not an oversight — the
//   wiring gate (7.20) is told which task clears each one.
//
// ★★★ AUDIT_FIELDS — Q7-7's allowlist — IS DESIGNED-IN-BUILD FOR THE ACTIONS NO OTHER TASK NAMES A
//     SHAPE FOR. The plan's field 4 states the MECHANISM ("each AUDIT_ACTIONS member declares the
//     field names it may record; anything else is dropped, not redacted in place") but only writes
//     out the shape for THREE of the 25: `staff_role.changed` carries `staff_role`
//     (STAGE-7-PLAN.md:2540-2541, task 7.13's call site) and `secret.key_rotated` /
//     `secret.key_retired` carry `kek_version` / `retired_at` and nothing else (STAGE-7-PLAN.md:1140-
//     1142, CT-041). No other action's call site is named anywhere in STAGE-7-PLAN.md, STAGE-8-
//     PLAN.md, STAGE-9-PLAN.md or CONTRACTS.md (checked by grep before writing this file). The
//     remaining 22 actions get an EMPTY allowlist here — before/after collapse to `{}` for them —
//     which is the conservative reading of "never a secret and never PHI": nothing is admitted until
//     a task that names a real field extends this list, in this same file, beside its action. That
//     is a deliberate, narrower-than-necessary default, not a guess at what those 22 actions will one
//     day carry; a task that needs one adds it here, in the open, next to the action it belongs to.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Thrown by every refusal in this file — a bad action, a missing reason, a missing actor. */
export class AuditViolation extends Error {
  constructor(message) { super(message); this.name = "AuditViolation"; }
}

/**
 * CT-042. The frozen 25 — the JavaScript half of keystone.audit_action (db/migrations/0183).
 * Order carries no meaning; it is kept identical to the migration's seed list so the two are easy
 * to eyeball against each other, and test (f) of test/s7_audit_entry.test.mjs asserts the two agree
 * as SETS, not as this order.
 */
export const AUDIT_ACTIONS = Object.freeze([
  "role.granted",
  "role.revoked",
  "role.permission_changed",
  "staff_role.changed",
  "operator.grant_requested",
  "operator.grant_approved",
  "operator.grant_denied",
  "operator.grant_revoked",
  "operator.acted_as",
  "session.revoked",
  "api_key.minted",
  "api_key.revoked",
  "webhook.secret_rotated",
  "record.archived",
  "record.restored",
  "note.viewed",
  "message.viewed",
  "goal.viewed",
  "checkin.viewed",
  "export.performed",
  "settings.changed",
  "support.page_viewed",
  "invoice.refunded",
  "approval.granted",
  "secret.key_rotated",
  "secret.key_retired",
  // ★ Task 1.4 / CT-107 — the fourth new audit action (of four; the other three are spec 11's
  //   PlatViewingAs half, seeded by its own migration). 25 → 26. test/s7_audit_entry.test.mjs:222
  //   hard-asserts the OLD count (25) and is expected to fail until that test file is updated —
  //   it is outside this task's file list (spec 01 §3/§5 only) and is reported, not edited, per
  //   the hard rule against weakening or touching a test this task does not own.
  "staff.viewed_as",
  // ★ Stage 15, 0427 (CT-F40/CT-F41), task 15.4 — three money audit actions. Callers: 15.5
  //   (invoice.voided), 15.14 (payment.recorded_offline), 15.27 (dispute.evidence_sent).
  "invoice.voided",
  "payment.recorded_offline",
  "dispute.evidence_sent",
  // ★ R7 (RECONCILE, migration 0522) — six actions their callers already wrote; without them every
  //   Mark paid / Mark uncollectible / Duplicate / Attach payment / Close dispute / Issue credit note
  //   threw AuditViolation and rolled back.
  "invoice.marked_paid",
  "invoice.marked_uncollectible",
  "invoice.duplicated",
  "invoice.payment_attached",
  "dispute.closed",
  "credit_note.issued",
  // ★ Migration 0554, 1 Oct 2026 — suspendTeamMember/reactivateTeamMember (src/people/offboard.mjs).
  //   36 → 38.
  "staff.suspended",
  "staff.reactivated",
  // ★ F829, 1 Oct 2026 — already seeded in keystone.audit_action by migration 0487 (its one caller,
  //   src/routes/platform.mjs, used a raw INSERT instead of this list); added here now that the
  //   caller is fixed to go through writeAudit(). 38 → 39.
  "platform.tier_capability.changed",
  // ★ Migration 0581, 2 Oct 2026 — the shared Delete (src/records/delete.mjs). 39 → 40.
  "record.deleted",
]);

/**
 * Q7-7. Per action, the field names `before`/`after` may carry. Anything else is DROPPED before
 * the insert — not written, not redacted-in-place, gone. Every one of the 25 needs an entry (test
 * (f) asserts `Object.keys(AUDIT_FIELDS)` sorted equals `AUDIT_ACTIONS` sorted); most are `[]`
 * today for the reason in the file header above.
 */
export const AUDIT_FIELDS = Object.freeze({
  "role.granted": Object.freeze([]),
  "role.revoked": Object.freeze([]),
  "role.permission_changed": Object.freeze([]),
  // ★ STAGE-7-PLAN.md:2540-2541 (task 7.13's setStaffRole call site).
  "staff_role.changed": Object.freeze(["staff_role"]),
  "operator.grant_requested": Object.freeze([]),
  "operator.grant_approved": Object.freeze([]),
  "operator.grant_denied": Object.freeze([]),
  "operator.grant_revoked": Object.freeze([]),
  "operator.acted_as": Object.freeze([]),
  "session.revoked": Object.freeze([]),
  "api_key.minted": Object.freeze([]),
  "api_key.revoked": Object.freeze([]),
  "webhook.secret_rotated": Object.freeze([]),
  "record.archived": Object.freeze([]),
  "record.restored": Object.freeze([]),
  // ★ the shared Delete: what was removed, in words (never the record's own content beyond its label)
  "record.deleted": Object.freeze(["label", "noun", "also_removed", "stripe"]),
  "note.viewed": Object.freeze([]),
  "message.viewed": Object.freeze([]),
  "goal.viewed": Object.freeze([]),
  "checkin.viewed": Object.freeze([]),
  "export.performed": Object.freeze([]),
  // ★ Wave B3 task B3.2 (money-write auditing, 24 Sep 2026) — refund/payout/dispute state changes
  //   (src/money/writes.mjs) and Connect account state changes (src/money/connect.mjs) call
  //   writeAudit with action "settings.changed" carrying { amount_minor, state } / { state }.
  // ★ Task 17.5 — tenant setting changes carry { key, value } (free text dropped for PHI safety,
  //   numeric/enum values and the setting key itself preserved).
  "settings.changed": Object.freeze(["amount_minor", "state", "key", "value"]),
  "support.page_viewed": Object.freeze([]),
  "invoice.refunded": Object.freeze([]),
  "approval.granted": Object.freeze([]),
  // ★ CT-041: "may carry kek_version and retired_at and nothing else — never a key, never a
  //   fragment of one, never a length." Stage 9 task 9.12 is the only caller.
  "secret.key_rotated": Object.freeze(["kek_version"]),
  "secret.key_retired": Object.freeze(["retired_at"]),
  // ★ Task 1.4 / CT-107 — per spec §3's table: may carry the viewed person's app_user id, nothing
  //   else (no name, no role — the audit row's own subjectId already names the viewed person; this
  //   field is the same id restated as CT-107's own table names it).
  "staff.viewed_as": Object.freeze(["viewed_app_user_id"]),
  // ★ Stage 15, 0427 (CT-F40/CT-F41), task 15.4. An empty array is a real, deliberate value —
  //   "dispute.evidence_sent" records no before/after fields, not "no entry yet".
  "invoice.voided": Object.freeze(["void_reason"]),
  "payment.recorded_offline": Object.freeze(["amount_minor", "method"]),
  "dispute.evidence_sent": Object.freeze([]),
  // ★ R7 — ids, enums and amounts only; free text (a mark-paid note, an uncollectible reason) is
  //   dropped, as this file's header requires.
  "invoice.marked_paid": Object.freeze(["status", "payment_method"]),
  "invoice.marked_uncollectible": Object.freeze(["status"]),  // reason → record_reason (R26)
  "invoice.duplicated": Object.freeze(["duplicated_from", "status"]),
  "invoice.payment_attached": Object.freeze(["payment_intent_id"]),
  "dispute.closed": Object.freeze(["state", "confirmation"]),
  "credit_note.issued": Object.freeze(["credit_note_id", "reason", "destination", "total_minor"]),
  // ★ Migration 0554 — the lifecycle_status transition itself; the free-text reason goes to
  //   `keystone.record_reason` via `setLifecycleStatus`, same as every other stage change (R46).
  "staff.suspended": Object.freeze(["lifecycle_status"]),
  "staff.reactivated": Object.freeze(["lifecycle_status"]),
  // ★ F829 — a capability key and its boolean value, nothing else; never a secret, never PHI.
  "platform.tier_capability.changed": Object.freeze(["capability", "value"]),
});

/**
 * The named actions 7.1's `WRITE_ROUTES` table references, alongside the plain view/edit/delete
 * verbs (STAGE-7-PLAN.md task 7.3 field 4). ★ DEPENDS ON Q7-3 — the storage shape these routes
 * write through is task 7.9's table, not this one; this is only the closed vocabulary of NAMES.
 * `booking.waive_charge`, `discount.apply`, `invoice.refund` and `setting.billing` are not yet
 * assigned to a row in 7.1's 54-route table (their routes are later tasks' work); they are listed
 * here because field 4 names them explicitly as part of this frozen set.
 */
export const ROUTE_ACTIONS = Object.freeze([
  "person.create",
  "team.invite",
  "team.remove",
  "staff_role.change",
  "document.sign",
  "document.execute",
  "template.author",
  "record.archive",
  "record.restore",
  "booking.waive_charge",
  "discount.apply",
  "invoice.refund",
  "setting.billing",
  // ★ NEW at Stage 14 task 14.15 (migration 0416, task 14.9) — the same two names, mirrored here
  //   as this file's own header requires for every NAMED_ACTIONS member 7.1's WRITE_ROUTES table
  //   references. Not yet assigned to a row in that table (their routes are 14.24/14.25's own
  //   work, not built as of this task) — listed here anyway because this is the frozen-name set.
  "loyalty.manage",
  "gift_card.manage",
]);

/** Keep only the keys `AUDIT_FIELDS[action]` allows; everything else is dropped, not redacted. */
function allowedFieldsOnly(action, shape) {
  if (shape === null || shape === undefined) return null;
  const allowed = AUDIT_FIELDS[action] ?? [];
  const out = {};
  for (const key of Object.keys(shape)) {
    if (allowed.includes(key)) out[key] = shape[key];
  }
  return out;
}

/**
 * CT-043. The one writer of keystone.audit_entry.
 *
 * `actorOperatorGrantId`, NOT `actorOperatorUid` (CCR-13): once task 7.6 lands, the application
 * holds a grant id uuid and never an operator uid, so that is the only thing there is to pass.
 * `actor_operator_uid` is filled inside the database by 0183's BEFORE INSERT trigger — this
 * function never sets it, never reads it back, and never receives it as an argument.
 *
 * Refuses: an `action` outside AUDIT_ACTIONS; an operator action (`actorOperatorGrantId` set) with
 * no `reason`; both actors null (neither `actorUserId` nor `actorOperatorGrantId` given) —
 * `audit_entry_has_an_actor`'s CHECK exists precisely because a row must always answer "who did
 * this", and refusing it here gives an engineer a message instead of a bare CHECK violation
 * (the same argument `src/permissions/writes.mjs:setRolePermission` makes for its own CHECK).
 *
 * @returns {Promise<{id: string}>}
 */
export async function writeAudit(tx, {
  tenantId,
  action,
  object,
  subjectId = null,
  before = null,
  after = null,
  reason = null,
  actorUserId = null,
  actorOperatorGrantId = null,
  requestId = null,
} = {}) {
  if (!tenantId) throw new AuditViolation("writeAudit requires tenantId");
  if (!AUDIT_ACTIONS.includes(action)) {
    throw new AuditViolation(`writeAudit: "${action}" is not one of the AUDIT_ACTIONS`);
  }
  if (!object) throw new AuditViolation("writeAudit requires object");
  if (!actorUserId && !actorOperatorGrantId) {
    throw new AuditViolation(
      "writeAudit requires an actor: actorUserId or actorOperatorGrantId, and an audit row always has one");
  }
  if (actorOperatorGrantId && !reason) {
    throw new AuditViolation("writeAudit: an operator action (actorOperatorGrantId set) requires a reason");
  }

  const beforeFiltered = allowedFieldsOnly(action, before);
  const afterFiltered = allowedFieldsOnly(action, after);

  const { rows } = await tx.query(
    `INSERT INTO keystone.audit_entry
       (tenant_id, actor_user_id, actor_operator_grant_id, action, object, subject_id,
        before, after, reason, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
     RETURNING id`,
    [
      tenantId,
      actorUserId,
      actorOperatorGrantId,
      action,
      object,
      subjectId,
      beforeFiltered === null ? null : JSON.stringify(beforeFiltered),
      afterFiltered === null ? null : JSON.stringify(afterFiltered),
      reason,
      requestId,
    ]);

  // ★ ZERO ROWS IS A REFUSAL, NOT A SUCCESS — the same idiom as
  //   src/permissions/writes.mjs:setRolePermission. tenant_insert's WITH CHECK normally RAISES
  //   rather than silently dropping a row on a plain INSERT, so this branch is defence in depth,
  //   not the expected path.
  if (rows.length === 0 || !rows[0]?.id) {
    throw new AuditViolation(
      "the audit row was not written — row-level security refused it, which means the transaction's tenant does not match tenantId");
  }
  return { id: rows[0].id };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 7 task 7.15 — "EVERY PRIVATE READ LEAVES AN AUDIT ROW." Appended, per this file's own
// header above (:7-9): the helper lands here, in its own named part, and nothing above this line
// changed to make room for it.
//
// ★★★ F597's resolution. Field 4 named the mechanism ("a helper `auditPrivateRead(tx, {...})`
//     ... called from the staff record read for a note") but field 2's file list omitted the one
//     file that call site can actually live in — `RECORD_QUERIES`/`RELATED_QUERIES`
//     (src/records/queries.mjs) are `Object.freeze()`d static SQL-string maps built once at module
//     load, with no per-request JS execution point inside `queries.mjs` itself. F597 added
//     `src/routes/index.mjs`'s generic `GET /api/records/:type/:id` handler to this task's scope —
//     that is where `auditPrivateRead` is actually called (after a successful `document` read,
//     when the row's `is_session_note` is true and the reader is not its own `created_by`).
//
// ★★★ auditPrivateRead DOES NOT INSERT. Its entire body is one call to `writeAudit` — the ONE
//     WRITER invariant declared at :11-15 above is unchanged: `writeAudit` remains the only
//     function in the product that inserts into `keystone.audit_entry`. This helper exists only so
//     (a) a private-read call site reads as one at the call site, and (b) the small, closed set of
//     actions it may ever record is declared in exactly one place instead of re-typed at each
//     caller.
//
// ★ PRIVATE_READ_ACTIONS — the four `.viewed` members of AUDIT_ACTIONS (05 §2b.6 / §6). Only
//   `note.viewed` has a caller this stage (src/routes/index.mjs's generic record read, wired by
//   7.15/F597); `message.viewed`, `goal.viewed` and `checkin.viewed` stay in AUDIT_ACTIONS with no
//   caller until Stage 8/9 build those surfaces — an orphan by construction, declared to 7.20's
//   wiring gate by name (task 7.15 field 4), not an oversight here.
const PRIVATE_READ_ACTIONS = Object.freeze([
  "note.viewed",
  "message.viewed",
  "goal.viewed",
  "checkin.viewed",
]);

/**
 * F597 / 7.15. Called from the read path itself, never from a guard — "who supplies the
 * condition: the read path itself. There is no guard here to fool" (7.15 field 4). `tx` MUST be
 * the caller's own transaction client — the same one the read just ran on — so a read that then
 * raises rolls this row back with it (7.15 field 8(c)); this function opens no transaction of its
 * own.
 *
 * `tenantId` is required (not listed in field 4's shorthand, but `writeAudit` cannot insert
 * without it and every existing call site passes it — see `src/people/writes.mjs:579-588`).
 *
 * @returns {Promise<{id: string}>}
 */
export async function auditPrivateRead(tx, {
  tenantId, action, object, subjectId, actorUserId, requestId = null,
} = {}) {
  if (!PRIVATE_READ_ACTIONS.includes(action)) {
    throw new AuditViolation(
      `auditPrivateRead: "${action}" is not one of the four private-read actions (${PRIVATE_READ_ACTIONS.join(", ")})`);
  }
  return writeAudit(tx, { tenantId, action, object, subjectId, actorUserId, requestId });
}
