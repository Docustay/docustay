// @ts-check
// src/people/bulk.mjs — TOUCH-UP GROUP A, WORKSTREAM 4 · LIST WORKSPACE, items 4.2/4.3.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHY A NEW FILE, AND WHY IT DOES NOT REINVENT A SINGLE WRITE. Every row-level change below is
//     the SAME function `src/routes/writes.mjs` already wires for the single-row case
//     (`archiveRecord`, `assignPerson`, `setLifecycleStatus`) — this module is the LOOP, the per-row
//     PERMISSION CHECK, and the PARTIAL-FAILURE bookkeeping around them, never a second writer. A
//     bulk action that fires its own event/audit path instead of the single-row one is exactly the
//     "two places the same fact can be gotten wrong" this codebase keeps naming as the class of
//     defect to avoid.
//
// ★★★ THE PERMISSION QUESTION A MULTI-ID BODY STRUCTURALLY CANNOT ASK AT THE ROUTE'S COARSE GATE.
//     `src/routes/writes.mjs`'s dispatcher resolves ONE subject id per request (`route.subject`,
//     F690) and asks `assertMay` once, before the handler runs. A bulk body carries N ids, so
//     `subject: null` is the only honest declaration for these routes — and `assertMay.mjs`'s own
//     comment states what that means: "`subject: null`… resolves to `null`, which only
//     `scope = 'everything'` can carry." **A Coach's `person: owned` grant cannot pass that coarse
//     gate at all for a bulk route**, by the SAME conservative design `/api/people/samples/remove`
//     already relies on (`src/routes/writes.mjs:193-201`) — not a gap introduced here.
//   ★★ SO THIS MODULE ASKS THE REAL QUESTION A SECOND TIME, PER ROW, THE WAY `linkGuardian`/
//      `unlinkGuardian` ALREADY DO (`src/people/guardians.mjs`, `src/routes/writes.mjs:164-175`'s own
//      comment): `assertMay` again, per id, with the REAL subject this time. A row outside the
//      caller's scope is refused right here, per row, and becomes a `failed` entry — never a
//      forgery and never a silent skip.
//   ★ THE PRACTICAL CONSEQUENCE, STATED RATHER THAN HIDDEN: because the route table's own
//     `object`/`action` pair for these four routes is `person`/`edit` with `subject: null`, a Coach
//     (`scope: 'owned'`) is refused at the OUTER gate before this module's per-row check ever runs —
//     bulk actions on the people list are reachable by Owner/Admin (`scope: 'everything'`) only,
//     today. Widening that means changing `assertMay`'s coarse resolution for a multi-id body, which
//     is shared by 70+ other routes and is a real design decision, not a touch-up — flagged in the
//     tracker close record, not silently worked around here.
//
// ★ SAVEPOINT PER ROW, NOT PER REQUEST. Postgres aborts the whole transaction on the first error in
//   a multi-statement transaction; without an isolating SAVEPOINT, row 6 failing would poison rows
//   1-5 that already succeeded, and "N changed, M failed" would be a lie. `runTenantScoped` already
//   gives the request one transaction (`src/http/app.mjs`); this is the row-level boundary inside it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { archiveRecord } from "../records/archive.mjs";
import { assignPerson, setLifecycleStatus } from "./writes.mjs";
import { scoped } from "../records/lists/_shared.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { invalid } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** ★ Non-negotiable, per the tracker: "bulk actions are capped at 100 rows; going over shows a
 *   warning and does not silently truncate." Exported so the client can show the SAME number. */
export const BULK_MAX_ROWS = 100;

function assertIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw invalid("ids must be a non-empty array of person ids", { field: "ids" });
  }
  if (ids.length > BULK_MAX_ROWS) {
    throw invalid(
      `a bulk action is capped at ${BULK_MAX_ROWS} rows — ${ids.length} were selected; narrow the ` +
      `selection and try again`,
      { field: "ids" });
  }
  if (new Set(ids).size !== ids.length) {
    throw invalid("ids must not repeat the same person twice", { field: "ids" });
  }
}

/**
 * Runs `run(id)` once per id, inside its own SAVEPOINT, after asking `assertMay` the real per-row
 * scope question. Returns `{ changed: string[], failed: [{id, reason}] }` — never throws for a
 * per-row failure, only for a malformed call (see `assertIds`).
 */
async function forEachRowScoped(tx, { principal, ids, run }) {
  const changed = [];
  const failed = [];
  for (const id of ids) {
    await tx.query("SAVEPOINT bulk_row");
    try {
      // ★ The real subject, this time — see the file header. `edit` is the same verb every
      //   single-row person write in `src/routes/writes.mjs` already asks for this object.
      await assertMay(tx, principal, { object: "person", action: "edit", subject: "id" }, { id });
      await run(id);
      await tx.query("RELEASE SAVEPOINT bulk_row");
      changed.push(id);
    } catch (err) {
      await tx.query("ROLLBACK TO SAVEPOINT bulk_row");
      await tx.query("RELEASE SAVEPOINT bulk_row");
      failed.push({ id, reason: err?.message ?? "this row could not be changed" });
    }
  }
  return { changed, failed };
}

/**
 * Bulk archive. Reuses `archiveRecord` per row (§ file header) — same event, same session-revoke,
 * same idempotent-by-404 shape a single archive already has. Additionally writes ONE
 * `keystone.audit_entry` row PER ARCHIVED PERSON, using the existing `record.archived` member of
 * the frozen `AUDIT_ACTIONS` (CT-042) — `archiveRecord` itself does not call `writeAudit` (measured:
 * no call site in `src/records/archive.mjs`), so this is this workstream's own audit write, not a
 * duplicate of one archiveRecord already makes.
 */
export async function bulkArchivePeople(tx, { tenantId, ids, actorUserId, principal, requestId = null }) {
  assertIds(ids);
  const { changed, failed } = await forEachRowScoped(tx, {
    principal, ids,
    run: (id) => archiveRecord(tx, { tenantId, object: "person", id, actorUserId, reason: "bulk archive" }),
  });
  for (const id of changed) {
    await writeAudit(tx, {
      tenantId, action: "record.archived", object: "person", subjectId: id, actorUserId, requestId,
    });
  }
  return { changed: changed.length, failed };
}

/**
 * Bulk `assign coach` — loops `assignPerson`. No `writeAudit` call: `assignPerson` already emits
 * `people.person.assigned` in the same transaction, and there is no `person.edit`-shaped member in
 * the frozen `AUDIT_ACTIONS` list to write to (the same reasoning `src/people/writes.mjs`'s own
 * comment gives for why `updatePerson`/`setLifecycleStatus` call only `emit()` — the event IS this
 * project's audit trail for an ordinary field edit; `keystone.audit_entry` is reserved for the
 * closed, more sensitive 25/26).
 */
export async function bulkAssignPeople(tx, { tenantId, ids, ownerUserId = null, actorUserId, principal }) {
  assertIds(ids);
  const { changed, failed } = await forEachRowScoped(tx, {
    principal, ids,
    run: (id) => assignPerson(tx, { tenantId, personId: id, ownerUserId, actorUserId }),
  });
  return { changed: changed.length, failed };
}

/** Bulk "change stage" — loops `setLifecycleStatus`. Same no-`writeAudit` reasoning as assign, above. */
export async function bulkChangeStagePeople(tx, { tenantId, ids, status, actorUserId, principal, reason = null }) {
  assertIds(ids);
  const { changed, failed } = await forEachRowScoped(tx, {
    principal, ids,
    run: (id) => setLifecycleStatus(tx, { tenantId, personId: id, status, actorUserId, reason }),
  });
  return { changed: changed.length, failed };
}

/**
 * Bulk export — the list workspace's "export" bulk action (item 4.2/4.3). NOT the whole-tenant
 * `keystone.data_export` background job (`src/settings/dataExport.mjs`, migration 0337) — that is a
 * different, async, S3-backed feature for a full data request, and reusing its queue for "export
 * these 40 selected rows to a CSV right now" would be the wrong shape stretched to fit. This is a
 * synchronous read of the SAME rows the list itself shows (same `scoped()` predicate people.mjs's
 * own descriptors use — never a second, hand-written column set) plus one `export.performed` audit
 * row, using the `AUDIT_ACTIONS` member that already exists for exactly this (CT-042).
 * ★ Owner/Admin only IN PRACTICE, not by a role check written here: the route table's `subject: null`
 *   coarse gate (see the file header) means a Coach's `scope: 'owned'` grant cannot reach this
 *   function's route at all — matching the tracker's non-negotiable ("export is Owner/Admin only")
 *   by the platform's own existing, conservative design rather than a second, local role check that
 *   could drift from it.
 */
export async function exportPeople(tx, { tenantId, ids, actorUserId, requestId = null }) {
  assertIds(ids);
  const { rows } = await tx.query(
    `SELECT u.id, u.display_name, u.email, u.mobile_phone, u.role, u.staff_role, u.lifecycle_status
       FROM keystone.app_user u
      WHERE ${scoped('person', 'u')} AND u.id = ANY($2)
      ORDER BY u.display_name, u.id`,
    [actorUserId, ids]);

  // ★ ONE audit row for the whole export, not one per person — `export.performed` is a statement
  //   about the ACT of exporting, made by the actor; `AUDIT_FIELDS["export.performed"]` is `[]`
  //   (audit.mjs:110), so no row content ever reaches `before`/`after` here regardless.
  await writeAudit(tx, {
    tenantId, action: "export.performed", object: "person", subjectId: actorUserId, actorUserId, requestId,
    reason: `exported ${rows.length} of ${ids.length} selected people from the list workspace`,
  });

  return { rows, requested: ids.length, exported: rows.length };
}
