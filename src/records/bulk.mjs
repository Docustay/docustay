// src/records/bulk.mjs — QUEUE §13.3: ONE bulk server request for every list. Each id is processed INDEPENDENTLY (its own savepoint) through the
// SAME single-record functions the row menu and the record page use — archiveRecord, restoreRecord, deleteRecord — so there is no second set of
// rules to drift: the protected-real-client block, the dependents check, the Stripe halves, the audit line and the e-sign override are all theirs.
// The result lists successes AND refusals per id (never half-silent). Delete without `confirm: true` returns ONE aggregated plan for the
// confirm dialog (counts by type, what else goes, what blocks, what Stripe will do) and changes nothing.
import { invalid } from "../http/errors.mjs";
import { archiveRecord, restoreRecord } from "./archive.mjs";
import { deleteRecord, planDeleteRecord } from "./delete.mjs";

export const BULK_MAX = 100;
const BULK_ACTIONS = Object.freeze(["delete", "archive", "restore"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {object} tx a tenant transaction (the route's)
 * @returns {Promise<{action, object, requested, changed, failed: {id, reason}[]} | {plan: true, ...}>}
 */
export async function bulkRecords(tx, { tenantId, action, object, ids, confirm = false, reason = null, options = {}, actorUserId = null, requestId = null }) {
  if (!tenantId) throw invalid("a tenantId is required");
  if (!BULK_ACTIONS.includes(action)) throw invalid(`action must be one of ${BULK_ACTIONS.join(", ")}`);
  if (!object) throw invalid("which kind of record? (object)");
  if (!Array.isArray(ids) || ids.length === 0) throw invalid("choose at least one record");
  const unique = [...new Set(ids)];
  if (unique.length > BULK_MAX) throw invalid(`a bulk action is capped at ${BULK_MAX} records — ${unique.length} were chosen`);
  if (unique.some((i) => !UUID.test(String(i)))) throw invalid("every id must be a record id");

  // ── delete, no confirm: the aggregated plan ──
  if (action === "delete" && confirm !== true) {
    const items = [];
    for (let i = 0; i < unique.length; i += 1) {
      await tx.query(`SAVEPOINT bulk_plan`);
      try {
        const { _row, _context, _entry, ...p } = await planDeleteRecord(tx, { tenantId, object, id: unique[i], options: options ?? {}, actorUserId });
        await tx.query(`RELEASE SAVEPOINT bulk_plan`);
        items.push({ id: unique[i], label: p.label, noun: p.noun, canDelete: p.canDelete, blockers: p.blockers, alsoRemoves: p.alsoRemoves, notes: p.notes });
      } catch (err) {
        await tx.query(`ROLLBACK TO SAVEPOINT bulk_plan`);
        items.push({ id: unique[i], label: null, noun: null, canDelete: false, blockers: [{ what: err?.message ?? "this record can't be checked", count: 1 }], alsoRemoves: [], notes: [] });
      }
    }
    const merged = new Map();
    for (const it of items.filter((x) => x.canDelete)) for (const a of it.alsoRemoves) merged.set(a.what, (merged.get(a.what) ?? 0) + a.count);
    return {
      plan: true, action, object, requested: unique.length,
      deletable: items.filter((i) => i.canDelete).length,
      blocked: items.filter((i) => !i.canDelete).map((i) => ({ id: i.id, label: i.label, reasons: i.blockers.map((b) => b.hint ?? `${b.count} ${b.what}`) })),
      alsoRemoves: [...merged.entries()].map(([what, count]) => ({ what, count })),
      notes: [...new Set(items.flatMap((i) => i.notes))],
    };
  }

  const failed = [];
  let changed = 0;
  for (let i = 0; i < unique.length; i += 1) {
    const id = unique[i];
    await tx.query(`SAVEPOINT bulk_one`);
    try {
      if (action === "delete") await deleteRecord(tx, { tenantId, object, id, confirm: true, reason, options: options ?? {}, actorUserId, requestId });
      else if (action === "archive") await archiveRecord(tx, { tenantId, object, id, actorUserId, reason });
      else await restoreRecord(tx, { tenantId, object, id, actorUserId });
      await tx.query(`RELEASE SAVEPOINT bulk_one`);
      changed += 1;
    } catch (err) {
      await tx.query(`ROLLBACK TO SAVEPOINT bulk_one`);
      failed.push({ id, reason: err?.message ?? "this did not run" });
    }
  }
  return { action, object, requested: unique.length, changed, failed };
}
