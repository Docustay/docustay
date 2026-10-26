// @ts-check
// Stage 15 Task 15.17 — invoice reminders and overdue facts
// Stage 20 Task 20.68 — per-invoice reminders toggle

import { emit, userActor } from "../events/outbox.mjs";
import { invalid } from "../http/errors.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same date-arithmetic expression, same UPDATE
//   predicates). `sql` is the escape hatch for what the builder itself does not express — the
//   `AT TIME ZONE` date comparison and `now()` — per the L3 per-file ruling.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★★★ INVOICE REMINDER FACT — fires when an invoice reminder's offset date passes.
 *
 * IDEMPOTENCY: the `sent_at` column is NULL until `act` sets it. A row with `sent_at` set
 * is excluded from the next sweep, so this entry is idempotent by construction — `find`'s
 * `r.sent_at IS NULL` predicate excludes what `act` produces.
 *
 * ★ Deleted reminders never fire: `r.deleted_at IS NULL` ensures a soft-deleted row is
 *   never found again.
 */
export const INVOICE_REMINDER_FACT = {
  key: "invoice_reminder_due",
  why: "an invoice reminder's offset date has passed",
  find: (tx, { tenantId }) => run(tx, db
    .selectFrom("keystone.invoice_reminder as r")
    .innerJoin("keystone.invoice as i", "i.id", "r.invoice_id")
    // ★ STRIPE MIRROR (0574) — whether the invoice is still `open`, and for how much, is Stripe's word.
    .innerJoin("keystone.invoice_effective as ie", "ie.id", "i.id")
    .innerJoin("keystone.tenant as t", "t.id", "i.tenant_id")
    .select(["r.id", "r.offset_days", "i.id as invoice_id", "ie.amount_minor as amount_minor", "i.due_at"])
    .where("r.tenant_id", "=", tenantId)
    .where("r.sent_at", "is", null)
    .where("r.deleted_at", "is", null)
    .where("ie.status", "=", "open")
    .where("i.sent_at", "is not", null)
    .where("i.due_at", "is not", null)
    .where(sql`((i.due_at AT TIME ZONE t.timezone)::date + r.offset_days) <= (now() AT TIME ZONE t.timezone)::date`)
    .orderBy("r.created_at", "asc")),
  act: async (tx, { tenantId, row }) => {
    // ★ Repeat the predicate: if another sweep claims this row between find and act, the
    //   UPDATE returns 0 rows, and we return null (no event). The idempotency gate asserts
    //   this by running the sweep twice on the same data.
    const { rowCount } = await run(tx, db
      .updateTable("keystone.invoice_reminder")
      .set({ sent_at: sql`now()` })
      .where("id", "=", row.id)
      .where("sent_at", "is", null));

    if (rowCount === 0) return null;

    await emit(tx, {
      tenantId,
      topic: "money.invoice.reminder_due",
      emittedBy: "money",
      subjectType: "invoice",
      subjectId: row.invoice_id,
      actor: "worker",
      payload: {
        invoice_id: row.invoice_id,
        offset_days: row.offset_days,
        amount_minor: row.amount_minor,
        due_at: row.due_at,
      },
    });

    return `invoice reminder ${row.id} sent (offset ${row.offset_days} days)`;
  },
};

/**
 * ★★★ INVOICE OVERDUE FACT — fires when an invoice's due date passes.
 *
 * IDEMPOTENCY: the `overdue_at` column is NULL until `act` sets it. A row with `overdue_at`
 * set is excluded from the next sweep, so this entry is idempotent by construction.
 */
export const INVOICE_OVERDUE_FACT = {
  key: "invoice_overdue",
  why: "an invoice is past its due date",
  find: (tx, { tenantId }) => run(tx, db
    // ★ STRIPE MIRROR (0574) — `open` and the amount are Stripe's word (invoice_effective); the due date
    //   and the overdue marker stay the platform's own columns on the base row.
    .selectFrom("keystone.invoice as i")
    .innerJoin("keystone.invoice_effective as ie", "ie.id", "i.id")
    .select(["i.id as id", "ie.amount_minor as amount_minor", "i.due_at as due_at"])
    .where("i.tenant_id", "=", tenantId)
    .where("ie.status", "=", "open")
    .where("i.due_at", "<", sql`now()`)
    .where("i.overdue_at", "is", null)
    .orderBy("i.due_at", "asc")),
  act: async (tx, { tenantId, row }) => {
    // ★ Repeat the predicate: if another sweep claims this row, the UPDATE returns 0 rows.
    const { rowCount } = await run(tx, db
      .updateTable("keystone.invoice")
      .set({ overdue_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", row.id)
      .where("overdue_at", "is", null));

    if (rowCount === 0) return null;

    // ★ Calculate days late at the moment the fact is true
    const daysLate = Math.floor((Date.now() - row.due_at.getTime()) / (1000 * 60 * 60 * 24));

    await emit(tx, {
      tenantId,
      topic: "money.invoice.overdue",
      emittedBy: "money",
      subjectType: "invoice",
      subjectId: row.id,
      actor: "worker",
      payload: {
        invoice_id: row.id,
        days_late: daysLate,
      },
    });

    return `invoice ${row.id} marked overdue (${daysLate} day(s) late)`;
  },
};

/**
 * ★ TOGGLE REMINDERS FOR A DRAFT INVOICE (Task 20.68)
 *
 * When toggled OFF: soft-deletes unsent reminder rows (sets deleted_at = now())
 * When toggled ON: restores soft-deleted reminder rows (sets deleted_at = NULL)
 * Sent reminders are never touched.
 *
 * @param tx the transaction
 * @param options { tenantId, invoiceId, enabled, actorUserId }
 * @returns { toggled: boolean, count: number }
 */
export async function toggleInvoiceReminders(tx, {
  tenantId, invoiceId, enabled, actorUserId,
} = {}) {
  if (!tenantId || !invoiceId || enabled === undefined) {
    throw invalid("tenantId, invoiceId, and enabled are required");
  }

  if (enabled) {
    // ★ Restore: clear deleted_at on soft-deleted reminders (only unsent ones)
    const { rowCount } = await run(tx, db
      .updateTable("keystone.invoice_reminder")
      .set({ deleted_at: null })
      .where("tenant_id", "=", tenantId)
      .where("invoice_id", "=", invoiceId)
      .where("sent_at", "is", null));

    if (rowCount > 0) {
      await emit(tx, {
        tenantId,
        topic: "money.invoice.reminders_enabled",
        emittedBy: "money",
        subjectType: "invoice",
        subjectId: invoiceId,
        actor: userActor(actorUserId), // RUN-2: emit() takes an actor STRING (outbox.mjs ACTOR_SHAPE); the object/word here threw TopicViolation and rolled the write back
        payload: { count: rowCount },
      });
    }

    return { toggled: true, count: rowCount };
  } else {
    // ★ Soft-delete: set deleted_at on unsent reminders (preserve sent state)
    const { rowCount } = await run(tx, db
      .updateTable("keystone.invoice_reminder")
      .set({ deleted_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("invoice_id", "=", invoiceId)
      .where("sent_at", "is", null)
      .where("deleted_at", "is", null));

    if (rowCount > 0) {
      await emit(tx, {
        tenantId,
        topic: "money.invoice.reminders_disabled",
        emittedBy: "money",
        subjectType: "invoice",
        subjectId: invoiceId,
        actor: userActor(actorUserId), // RUN-2: emit() takes an actor STRING (outbox.mjs ACTOR_SHAPE); the object/word here threw TopicViolation and rolled the write back
        payload: { count: rowCount },
      });
    }

    return { toggled: true, count: rowCount };
  }
}
