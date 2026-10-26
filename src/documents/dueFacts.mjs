// src/documents/dueFacts.mjs — DOCUSTAY WALL FIX (29 Sep 2026). `document_lapsed` and
// `document_reminder_due` used to live inline in src/time/due.mjs (P8.8's shared sweep registry),
// which reached keystone.document_instance directly for both their SELECT and their UPDATE.
// Relocated verbatim (same predicates, same writes, same events) to where every other domain's own
// due-facts already live — src/money/reminders.mjs's INVOICE_REMINDER_FACT/INVOICE_OVERDUE_FACT,
// src/money/estimates.mjs's ESTIMATE_EXPIRING_FACT, etc. — imported into time/due.mjs's DUE_FACTS
// array by reference, exactly like those.
import { ports } from "./ports.mjs";
import { emit } from "../events/outbox.mjs";
import { getDocumentSetting } from "./settings.mjs";

export const DOCUMENT_LAPSED_FACT = {
  key: "document_lapsed",
  why: "a signature request has sat past its deadline and its chase task can never close",
  // ★★★ ONLY `sent`. NOT `partially_signed` — see migration 0110's ruling: a document somebody has
  //     already signed must not be voided by a clock, and `expired_shape` refuses it in the
  //     database as well as here.
  find: (tx, { tenantId }) => tx.query(
    `SELECT id, title, sent_at, expires_at FROM keystone.document_instance
      WHERE tenant_id = $1 AND state = 'sent'
        AND expires_at IS NOT NULL AND expires_at <= now()
        AND archived_at IS NULL
        -- Run 9 Part 3.7: a signature given before the deadline and HELD for its payment keeps the document open until the hold is paid or lapses (7 days)
        AND NOT EXISTS (SELECT 1 FROM keystone.document_party hp WHERE hp.instance_id = document_instance.id AND hp.status = 'awaiting_payment')
      ORDER BY expires_at`, [tenantId]),
  act: async (tx, { tenantId, row }) => {
    const { rowCount } = await tx.query(
      `UPDATE keystone.document_instance SET state = 'expired', updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND state = 'sent'`, [tenantId, row.id]);
    if (rowCount === 0) return null;
    await emit(tx, {
      tenantId, topic: "documents.document.expired", emittedBy: "documents",
      subjectType: "document", subjectId: row.id,
      actor: "worker",
      // ★★★ `title` DROPPED. It is a banned key name outright (§2.4), and it is also still on the
      //     row: `chase_signature` (src/tasks/chains.mjs) is the one reader, and it looks the
      //     CURRENT document_instance.title up at task-open time instead of trusting a copy frozen
      //     into the event.
      payload: { sent_at: row.sent_at, expires_at: row.expires_at },
    });
    return `document ${row.id} (${row.title}) lapsed unsigned`;
  },
};

export const DOCUMENT_REMINDER_DUE_FACT = {
  key: "document_reminder_due",
  why: "a signature request has gone quiet and its signer(s) have not been chased",
  // ★★ VISIBLE THROUGH 0418's `system_reminder_read` — the same policy shape as `system_expiry_read`
  //    (0112) DOCUMENT_LAPSED_FACT already relies on: an unviewered caller (this sweep) sees only
  //    sent/partially_signed rows whose `next_reminder_at` is due.
  // ★★★ `next_reminder_at IS NOT NULL AND next_reminder_at <= now()` IS THE IDEMPOTENCY. Once `act`
  //     below exhausts the schedule it sets `next_reminder_at` to NULL, which this predicate
  //     excludes — a row with no next reminder scheduled can never be found again.
  find: (tx, { tenantId }) => tx.query(
    `SELECT id, builder, reminders_sent, sent_at FROM keystone.document_instance
      WHERE tenant_id = $1 AND state IN ('sent','partially_signed')
        AND next_reminder_at IS NOT NULL AND next_reminder_at <= now()
        AND archived_at IS NULL
        -- R13-D552: a member of a package is reminded through the package's first document; asking for the member itself threw "part of a package" and made every sweep of the workspace fail
        AND package_lead_id IS NULL
      ORDER BY next_reminder_at`, [tenantId]),
  act: async (tx, { tenantId, row }) => {
    // ★ Part 29 (A7-2): AUTOMATIC reminders are a paid-plan item. Where the plan does not include them the schedule is cleared (a manual "send a reminder now" is never affected) and nothing is sent.
    if ((await (await ports()).entitlements?.isEntitled?.(tx, { tenantId, item: "auto_reminders" })) === false) {
      await tx.query(`UPDATE keystone.document_instance SET next_reminder_at = NULL WHERE tenant_id = $1 AND id = $2`, [tenantId, row.id]);
      return `document ${row.id} not reminded automatically (not part of the plan)`;
    }
    // ★★★ 14.30's src/documents/signLinks.mjs — DYNAMICALLY imported, deliberately, because this
    //     task built due.mjs alongside (not after) 14.30 and that file may not exist yet at any
    //     given moment of the parallel build. A static top-level import of a module that is not on
    //     disk would fail to LOAD the whole registry. A dynamic import fails only THIS fact, caught
    //     by runDueFacts's own per-fact savepoint. Kept here unchanged — 14.30 is long since built,
    //     but re-verifying that is out of THIS fix's scope.
    const { remindSigners } = await import("./signLinks.mjs");
    // ★ Mints fresh links for every signer who has not yet signed and emails them — see
    //   signLinks.mjs's own header for what it does and does not store (no presented string ever
    //   reaches this file or this fact's own event payload below).
    await remindSigners(tx, { tenantId, instanceId: row.id });

    // ★ QUEUE §23.5.17 — an uploaded document's people each have their own cadence; `remindDueParties` already re-aimed `next_reminder_at` at the earliest of them, so the lead-level schedule below does not apply
    if (row.builder === "pdf") {
      const { rows: [left] } = await tx.query(`SELECT next_reminder_at FROM keystone.document_instance WHERE id = $1`, [row.id]);
      await emit(tx, { tenantId, topic: "documents.document.reminder_due", emittedBy: "documents", subjectType: "document", subjectId: row.id, actor: "worker", payload: { builder: "pdf", next_reminder_at: left?.next_reminder_at ?? null } });
      return `document ${row.id} (uploaded) reminded on each person's own cadence`;
    }
    const reminderDays = await getDocumentSetting(tx, "reminder_days");
    const nextCount = row.reminders_sent + 1;
    // ★ NULL once every configured offset has been used — no third reminder is ever scheduled, and
    //   the predicate above then excludes this row for good.
    const nextOffsetDays = nextCount < reminderDays.length ? reminderDays[nextCount] : null;

    // ★ The date arithmetic happens in SQL, off the frozen `sent_at`, never in JS. The predicate is
    //   repeated in the WHERE so two overlapping sweeps cannot both claim this row.
    const { rows, rowCount } = await tx.query(
      `UPDATE keystone.document_instance
          SET reminders_sent = $3,
              next_reminder_at = CASE WHEN $4::int IS NULL THEN NULL
                                       ELSE sent_at + make_interval(days => $4::int) END
        WHERE tenant_id = $1 AND id = $2 AND state IN ('sent','partially_signed')
          AND next_reminder_at IS NOT NULL AND next_reminder_at <= now()
        RETURNING next_reminder_at`,
      [tenantId, row.id, nextCount, nextOffsetDays]);
    if (rowCount === 0) return null;

    await emit(tx, {
      tenantId, topic: "documents.document.reminder_due", emittedBy: "documents",
      subjectType: "document", subjectId: row.id,
      actor: "worker",
      // ★★ NO TITLE, NO SIGNER NAME, NO EMAIL — a reminder says a document is due, never who it is
      //    about or what it says (the blocked-list discipline this whole registry follows).
      payload: { reminders_sent: nextCount, next_reminder_at: rows[0].next_reminder_at },
    });
    return `document ${row.id} reminded (${nextCount} of ${reminderDays.length})`;
  },
};
