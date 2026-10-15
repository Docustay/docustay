// @ts-check
/**
 * SWEEPS — time-based automations.
 *
 * Four sweep automations: invoice_chase, quiet_flag, win_back, monthly_writeup.
 * Each sweep creates automation_run rows + emits tasks.automation.ran events + actions (messages/tasks).
 *
 * Imports that are task 16.20+ (engine) and 16.15 (config):
 * - sendAutomationMessage from src/automations/engine.mjs
 * - config object from src/automations/config.mjs
 * - quietClientsSql from src/growth/campaigns.mjs
 * Imports that are task 16.29 (reports):
 * - buildReceipt from src/reports/ (location TBD)
 */

import { emit } from "../events/outbox.mjs";
import { attributeOutcomes } from "./outcomes.mjs";
import { sendAutomationMessage } from "./engine.mjs";
import { quietClientsSql } from "../growth/campaigns.mjs";
import { db as kdb, run as runQuery } from "../db/kysely.mjs";
import { withTenant } from "../db/index.mjs";
import { asPracticeOwner } from "../money/asPracticeOwner.mjs";
// ★ NEW, saved-card brief (1 Oct 2026, Part 3) — `cardsExpiringNextMonth` has existed since the
//   Part 3 saved-card work with ZERO callers (MEASURED — grepped src/ before this line existed).
import { cardsExpiringNextMonth } from "../money/cardUpdate.mjs";
import { sql } from "kysely";

/**
 * SWEEP AUTOMATIONS — runs all four sweeps and attributes outcomes.
 *
 * Runs for each automation in order:
 *   1. Insert automation_run row
 *   2. Emit 'tasks.automation.ran' event
 *   3. Execute action (send message, create task, etc.)
 *
 * Called once per practice per scheduled time.
 *
 * @param {Object} tx - database transaction
 * @param {Object} opts
 * @param {string} opts.tenantId - practice id
 * @param {Date} opts.now - current timestamp
 * @param {Object} opts.helpers - {sendAutomationMessage, config, quietClientsSql, getSetting, buildReceipt}
 */
/** An invoice that has reached several offsets gets only the latest one (offsets are visited in ascending order, so the later visit wins). Pure. */
export const pickLatest = (current, invoice, offset) => (!current || offset >= current.offset ? { invoice, offset } : current);

export async function sweepAutomations(tx, { tenantId, now, helpers }) {
  if (!tenantId || !now || !helpers) {
    throw new Error("sweepAutomations needs tenantId, now, and helpers");
  }

  const { sendAutomationMessage, config, quietClientsSql, getSetting, buildReceipt, addJob } = helpers;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // SWEEP 1: INVOICE CHASE — for each open invoice with due_at, for each passed offset day
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // ★ FIX 9 Oct 2026 (the maintainer's two wrong emails, found live): the old loop took each offset on its own, so an invoice already well past due
  //   matched EVERY offset at once (-7, 0, 1 and 3) and the payer got up to four identical "payment due" emails in the same minute. An invoice now gets
  //   only the LATEST offset it has reached (the one that describes where it is today); the earlier ones are simply passed. And an invoice that has its
  //   own reminder schedule (keystone.invoice_reminder, set per invoice on the invoice screen) is left to that schedule: one owner for each payer reminder.
  const offsets = [...(config.offsets_days || [-7, 0, 1, 3])].map(Number).filter(Number.isFinite).sort((x, y) => x - y);
  const dayMs = 24 * 60 * 60 * 1000;
  const reached = new Map(); // invoice id -> { invoice, offset (the largest one reached) }
  for (const offset of offsets) {
    const offsetDate = new Date(now.getTime() + offset * dayMs);

    // Find all open invoices with due dates that have passed (relative to this offset).
    // ★ F877 — this sweep runs with no viewer (sweepAutomationsTask's own withTenant call), and
    //   `keystone.invoice`'s only no-viewer RLS carve-out (`system_divergence_read`, migration 0557)
    //   requires `stripe_invoice_id IS NOT NULL` — an invoice sent before Stripe Connect went live,
    //   or on a practice with no live Connect account, has `stripe_invoice_id = NULL` forever and
    //   was invisible here, so invoice_chase silently never fired for it. Same bug class as F854;
    //   asPracticeOwner works because the practice owner's own grants satisfy `user_may` on invoice.
    // ★ STRIPE-MIRROR REPOINT (2 Oct 2026) — "is it still open?" is Stripe's answer: a dunning candidate
    //   starts from `invoice_effective` (status), so an invoice Stripe already shows paid/void is never
    //   chased from a stale the platform row. `keystone.invoice` is LEFT JOINed only for the platform's own
    //   columns (due_at, protected_real_client); both filters on it exclude a Stripe-only row (no
    //   the platform due date to be late against), exactly as before.
    const { rows: invoices } = await asPracticeOwner(tx, tenantId, () => runQuery(tx, kdb
      .selectFrom("keystone.invoice_effective as ie")
      .leftJoin("keystone.invoice as i", "i.id", "ie.id")
      .select(["ie.id as id", sql`ie.payer_user_id as payer_id`])
      .where("ie.tenant_id", "=", tenantId)
      .where("ie.status", "=", "open")
      .where("i.protected_real_client", "=", false)
      .where("i.due_at", "is not", null)
      .where("i.due_at", "<=", offsetDate.toISOString())
      .where(sql`i.reminders_enabled IS NOT FALSE`)
      .where(sql`NOT EXISTS (SELECT 1 FROM keystone.invoice_reminder r WHERE r.invoice_id = i.id AND r.deleted_at IS NULL)`)));
    for (const invoice of invoices) reached.set(invoice.id, pickLatest(reached.get(invoice.id), invoice, offset));
  }

  for (const { invoice, offset } of reached.values()) {
    {
      const guardKey = `invoice:${invoice.id}:${offset}`;

      // Check if this run already exists.
      const { rows: existing } = await runQuery(tx, kdb
        .selectFrom("keystone.automation_run")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("key", "=", "invoice.chase")
        .where("guard_key", "=", guardKey)
        .where("state", "<>", "dropped"));

      if (existing.length > 0) continue; // Already ran for this offset.

      // Insert automation_run row.
      const eventId = await (async () => {
        // First create the event, then insert the run with its id.
        // ★ through emit(): the raw INSERT named no emitted_by (NOT NULL) and failed every sweep
        const { id } = await emit(tx, { tenantId, topic: 'tasks.automation.ran', emittedBy: 'tasks',
                                          payload: { automationKey: 'invoice.chase', key: 'invoice_chase', invoice_id: invoice.id, offset_days: offset } });
        return id;
      })();

      const { rows } = await runQuery(tx, kdb
        .insertInto("keystone.automation_run")
        .values({
          tenant_id: tenantId ?? null,
          key: "invoice.chase",
          subject_type: "invoice",
          subject_id: invoice.id ?? null,
          person_id: invoice.payer_id ?? null,
          guard_key: guardKey ?? null,
          trigger_event_id: eventId ?? null,
          action: "told_client",
          state: "queued",
          run_at: now.toISOString() ?? null
        })
        .returning("id"));
      const { id: runId } = rows[0];

      // Queue the message send.
      // ★ FIX, 30 Sep 2026 (worker-failures brief) — MEASURED live: `sendAutomationMessage`'s real
      //   signature (src/automations/engine.mjs) is `{tenantId, recipientId, eventId, templateKey,
      //   title, body, helpers}` — this call passed `template` (not `templateKey`) and a `runId`
      //   the function has no parameter for, and supplied neither `title` (required —
      //   `createNotification` throws without one) nor `helpers` (needed for `helpers.addJob`,
      //   which queues the actual email). All three fixed together; `title` is the in-app
      //   notification line, separate from the email subject the template itself carries.
      await sendAutomationMessage(tx, {
        tenantId,
        recipientId: invoice.payer_id,
        eventId,
        templateKey: 'automation.invoice_chase',
        title: 'Payment reminder sent',
        helpers: { addJob },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // SWEEP 2: QUIET FLAG — clients quiet for config.days, create a task about them
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  const quietDays = config.days || 90;
  const quietClientsSqlFn = quietClientsSql; // Will be a function that returns parameterized SQL

  // Find clients matching the quiet definition.
  // ★ FIX, 30 Sep 2026 (worker-failures brief) — MEASURED live: `quietClientsSql(paramIndex)`
  //   (src/growth/campaigns.mjs:79) takes ONE numeric bind-index and hardcodes alias `u` internally
  //   — it was never alias-parameterised. The old two-arg call `quietClientsSqlFn('u', '$2')` bound
  //   its only parameter to the string `'u'`, producing `$u::int` in the generated SQL — Postgres
  //   42601 (syntax error), which is exactly the "pg 42601" GAVE UP seen in worker logs after the
  //   `withTx` → `withTenant` fix let execution reach this query for the first time. `quietDays` is
  //   bound as `$2` below (params: `[tenantId, quietDays]`), so the index is `2`.
  const quietWhere = quietClientsSqlFn(2);
  // ★ FIX, 30 Sep 2026 (worker-failures brief) — MEASURED live (reproduced locally against the
  //   same schema): pg 42883 "function max(uuid) does not exist" — `b.id` is `uuid`, which this
  //   Postgres has no built-in MAX/MIN aggregate for. `last_completed_booking_id` is only ever
  //   used as an opaque guard-key string (`person:${id}:${last_completed_booking_id || 'none'}`),
  //   never compared as a real id, so a text cast is the correct fix, not a workaround.
  const { rows: quietClients } = await tx.query(
    `SELECT u.id, u.display_name, MAX(b.id::text) as last_completed_booking_id
     FROM keystone.app_user u
     LEFT JOIN keystone.booking_participant bp ON bp.app_user_id = u.id AND bp.party = 'client'
     LEFT JOIN keystone.booking b ON b.id = bp.booking_id AND b.tenant_id = u.tenant_id  -- booking has no person_id
     WHERE u.tenant_id = $1
       AND ${quietWhere}
       -- ★★★ FOUND LIVE, the maintainer's own report, 2 Oct 2026 — quietClientsSql (src/growth/campaigns.mjs)
       --   is written ENTIRELY as negatives ("no recent booking, no future booking, no recent
       --   cancellation"), which a person who has NEVER booked anything satisfies trivially —
       --   this sweep was flagging every LEAD who never converted as a "quiet client" the moment
       --   they aged past config.days, with a staff task reading "Check in with <lead's name>" as
       --   if they were a lapsed client. "Gone quiet" presupposes "was once here" — require at
       --   least one real (non-cancelled) booking to have EVER existed, same table this sweep
       --   already joins, not a new join.
       AND EXISTS (
         SELECT 1 FROM keystone.booking_participant bp2
         JOIN keystone.booking b2 ON b2.id = bp2.booking_id AND b2.tenant_id = bp2.tenant_id
         WHERE bp2.tenant_id = u.tenant_id AND bp2.app_user_id = u.id
           AND bp2.party = 'client' AND b2.state <> 'cancelled'
       )
     GROUP BY u.id, u.display_name`,
    [tenantId, quietDays]);

  for (const client of quietClients) {
    const guardKey = `person:${client.id}:${client.last_completed_booking_id || 'none'}`;

    // Check if this run already exists.
    const { rows: existing } = await runQuery(tx, kdb
      .selectFrom("keystone.automation_run")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("key", "=", "quiet.flag")
      .where("guard_key", "=", guardKey)
      .where("state", "<>", "dropped"));

    if (existing.length > 0) continue;

    // Insert automation_run row and create task.
    const eventId = await (async () => {
      // ★ through emit(): the raw INSERT named no emitted_by (NOT NULL) and failed every sweep
      const { id } = await emit(tx, { tenantId, topic: 'tasks.automation.ran', emittedBy: 'tasks',
                                        payload: { automationKey: 'quiet.flag' } });
      return id;
    })();

    const { rows } = await runQuery(tx, kdb
      .insertInto("keystone.automation_run")
      .values({
        tenant_id: tenantId ?? null,
        key: "quiet.flag",
        subject_type: "person",
        subject_id: client.id ?? null,
        person_id: client.id ?? null,
        guard_key: guardKey ?? null,
        trigger_event_id: eventId ?? null,
        action: "flagged",
        state: "queued",
        run_at: now.toISOString() ?? null
      })
      .returning("id"));
    const { id: runId } = rows[0];

    // Create the task directly (action='flagged').
    const { rows: taskRows } = await runQuery(tx, kdb
      .insertInto("keystone.task")
      .values({
        tenant_id: tenantId ?? null,
        subject_type: "person",
        subject_id: client.id ?? null,
        title: `Check in with ${client.display_name}` ?? null,
        topic: "tasks.automation.ran",
        created_by_event_id: eventId ?? null
      })
      .returning("id"));
    const { id: taskRowId } = taskRows[0];

    // Update the run with the task id.
    await runQuery(tx, kdb
      .updateTable("keystone.automation_run")
      .set({ task_id: taskRowId ?? null })
      .where("id", "=", runId));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ [TY, 2 Oct 2026] SWEEP 3 (WIN BACK) REMOVED ENTIRELY — "no we miss you needs to fucking go
  //   get rid of it entirely." It had already been found live, same session, to be emailing every
  //   lead who never converted ("we miss you, it's been a while since your last session" about a
  //   session that never happened) because "gone quiet" never required a booking to have existed
  //   in the first place. the maintainer's own ruling, once he saw it, was to remove the feature rather than
  //   keep refining the eligibility query. Removed with it: the `win_back` block in
  //   automations/config.mjs, the `people.win_back`/`workbench.lifecycle_win_back` catalogue
  //   entries, the `automation.win_back` email template, and the `campaigns.win_back_cooldown_days`
  //   setting — nothing left that can turn this back on by configuration.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // SWEEP 4: MONTHLY WRITEUP — on day_of_month, build receipt and notify owners
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // Check if today is the configured day of month.
  const dayOfMonth = config.day_of_month || 1;
  const todayDayOfMonth = now.getDate();

  if (todayDayOfMonth === dayOfMonth) {
    // Format the month key as YYYY-MM.
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const monthKey = `${year}-${month}`;
    const guardKey = `month:${monthKey}`;

    // Check if this run already exists for this month.
    const { rows: existing } = await runQuery(tx, kdb
      .selectFrom("keystone.automation_run")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("key", "=", "monthly.writeup")
      .where("guard_key", "=", guardKey)
      .where("state", "<>", "dropped"));

    if (existing.length === 0) {
      // Insert automation_run row.
      const eventId = await (async () => {
        // ★ through emit(): the raw INSERT named no emitted_by (NOT NULL) and failed every sweep
        const { id } = await emit(tx, { tenantId, topic: 'tasks.automation.ran', emittedBy: 'tasks',
                                          payload: { automationKey: 'monthly.writeup' } });
        return id;
      })();

      const { rows } = await runQuery(tx, kdb
        .insertInto("keystone.automation_run")
        .values({
          tenant_id: tenantId ?? null,
          key: "monthly.writeup",
          subject_type: "tenant",
          subject_id: tenantId ?? null,
          guard_key: guardKey ?? null,
          trigger_event_id: eventId ?? null,
          action: "written_up",
          state: "queued",
          run_at: now.toISOString() ?? null
        })
        .returning("id"));
      const { id: runId } = rows[0];

      // Build the receipt for the month.
      const receipt = await buildReceipt(tx, {
        tenantId,
        month: monthKey,
      });

      // Notify all owners with 'reports.monthly.ready' topic.
      const { rows: owners } = await runQuery(tx, kdb
        .selectFrom("keystone.app_user")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("role", "=", "staff")
        .where("staff_role", "=", "owner")
        .where("email", "is not", null));

      for (const owner of owners) {
        // Create notification for each owner.
        await runQuery(tx, kdb
          .insertInto("keystone.notification")
          .values({
            tenant_id: tenantId ?? null,
            recipient_id: owner.id ?? null,
            topic: "reports.monthly.ready",
            title: "Your monthly write-up is ready" ?? null,
            body: `Your write-up for ${monthKey} is ready.` ?? null,
            deep_link: "/reports" ?? null,
            event_id: eventId ?? null
          }));
      }

      // Update run state to done (it's now complete).
      await runQuery(tx, kdb
        .updateTable("keystone.automation_run")
        .set({ state: "done" })
        .where("id", "=", runId));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★ NEW, saved-card brief (1 Oct 2026, Part 3) — CARD EXPIRY. `cardsExpiringNextMonth` finds every
  //   card expiring next calendar month; for each, a client email (money.payment_method.
  //   expiring_soon → MONEY_EMAILS, same wiring shape the card-updated/removed emails just got)
  //   AND a staff alert, raised the same raw-INSERT way the monthly-writeup sweep just above does.
  //   ★★ IDEMPOTENT PER MONTH, NOT PER SWEEP RUN — this sweep runs daily; without a guard, the same
  //      card would be emailed once a day for the whole month it's expiring in. `expiring_alerted_for`
  //      (year-month) on the payment_method row is the guard — set once, checked every run.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const expiring = await cardsExpiringNextMonth(tx, { tenantId, now });
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    for (const card of expiring) {
      if (card.expiring_alerted_for === monthKey) continue;

      const event = await emit(tx, {
        tenantId, topic: "money.payment_method.expiring_soon", emittedBy: "money",
        subjectType: "payment_method", subjectId: card.id,
        actor: "worker",
        payload: {
          recipient_user_id: card.app_user_id,
          brand: card.brand, last_four: card.last_four,
          exp_month: card.exp_month, exp_year: card.exp_year,
        },
      });

      await runQuery(tx, kdb
        .updateTable("keystone.payment_method")
        .set({ expiring_alerted_for: monthKey })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", card.id));

      // ★ F854-ADJACENT FIX, 1 Oct 2026 (Part 4a) — same stale-enum bug found/fixed across
      //   tasks.mjs: 'super_admin' cannot exist in `staff_role` (CHECK admits only owner/admin/
      //   member) and 'owner' was missing — the practice OWNER never received this card-expiring
      //   alert.
      const { rows: owners } = await tx.query(
        `SELECT id FROM keystone.app_user
          WHERE tenant_id = $1 AND role = 'staff' AND staff_role IN ('owner', 'admin')
            AND archived_at IS NULL`,
        [tenantId]);
      for (const owner of owners) {
        await runQuery(tx, kdb
          .insertInto("keystone.notification")
          .values({
            tenant_id: tenantId ?? null,
            recipient_id: owner.id ?? null,
            topic: "money.payment_method.expiring_soon",
            title: "A client's card is expiring soon" ?? null,
            body: `${card.brand ?? "A card"} ending ${card.last_four ?? "····"} expires ${card.exp_month}/${card.exp_year}.` ?? null,
            deep_link: "/app/money",
            event_id: event.id ?? null,
          }));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // FINALLY: Attribute outcomes for all runs in this tenant
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  await attributeOutcomes(tx, { tenantId, now });
}

/**
 * RUN AUTOMATION STEP — job body for delayed sends.
 *
 * Loads an automation_run by id; if state is 'queued', re-checks the toggle and sends.
 * A 'dropped' run does nothing.
 *
 * @param {Object} payload - {tenantId, runId}
 * @param {Object} helpers - {db, sendAutomationMessage}
 */
export async function runAutomationStep(payload, helpers) {
  if (!payload || !payload.tenantId || !payload.runId) {
    throw new Error("runAutomationStep needs payload.tenantId and payload.runId");
  }
  const { sendAutomationMessage } = helpers;

  // ★ FIX, 30 Sep 2026 (worker-failures brief) — the SAME `helpers.db.withTx` defect as
  //   `sweepAutomationsTask` (this file's own fix, above): `src/queue/tasks.mjs` wires this task
  //   directly (`guardedTask("run_automation_step", runAutomationStep)`, no wrapper), so
  //   `helpers.db` was never supplied here either. Same real fix: `withTenant`.
  await withTenant(payload.tenantId, async (tx) => {
    // Load the run.
    const { rows } = await runQuery(tx, kdb
      .selectFrom("keystone.automation_run")
      .select(["id", "tenant_id", "key", "state", "notification_id", "task_id"])
      .where("id", "=", payload.runId)
      .where("tenant_id", "=", payload.tenantId));
    const [run] = rows;

    if (!run) throw new Error(`automation_run not found: ${payload.runId}`);

    // If already done or dropped, do nothing.
    if (run.state !== 'queued') return;

    // Re-check the toggle (same pattern as engine).
    const { automationSettingKey } = await import('./catalogue.mjs');
    const settingKey = automationSettingKey(run.key);
    const { rows: settingRows } = await runQuery(tx, kdb
      .selectFrom("keystone.tenant_setting")
      .select("value")
      .where("tenant_id", "=", run.tenant_id)
      .where("key", "=", settingKey));
    const [setting] = settingRows;

    if (!setting || !setting.value) {
      // Automation was toggled off; mark as dropped and return.
      await runQuery(tx, kdb
        .updateTable("keystone.automation_run")
        .set({ state: "dropped" })
        .where("id", "=", run.id));
      return;
    }

    // Send via sendAutomationMessage (which handles the actual send).
    // ★ NOT FIXED, 30 Sep 2026 (worker-failures brief) — SCOPE, recorded rather than guessed at:
    //   [MEASURED] `run_automation_step` is registered (jobPolicy.mjs, giveUpOwners.mjs, tasks.mjs)
    //   but nothing anywhere calls `addJob("run_automation_step", ...)` — an orphan task, same
    //   class as this project's own "built and wired to nothing" failure mode, just never reached
    //   rather than crashing. This call is ALSO missing `recipientId`/`eventId`/`templateKey`/
    //   `title` (the SELECT above never reads `person_id` or `trigger_event_id`), but rebuilding
    //   it correctly needs a per-`run.key` title mapping this task was never given — inventing one
    //   here would be guessing at a product decision, not fixing a measured defect. Left as the
    //   `withTenant` fix only; flagged in the report for the maintainer rather than silently "finished."
    await sendAutomationMessage(tx, { tenantId: run.tenant_id, runId: run.id });

    // Mark as done.
    await runQuery(tx, kdb
      .updateTable("keystone.automation_run")
      .set({ state: "done" })
      .where("id", "=", run.id));
  });
}

/**
 * SWEEP AUTOMATIONS TASK — plain job function for the task queue.
 *
 * Called by the per-practice scheduled job (16.32).
 * Wraps sweepAutomations with the necessary imports.
 *
 * @param {Object} payload - {tenantId}
 * @param {Object} helpers - {config, sendAutomationMessage, ...} — a transaction, NOT a `db` with
 *   its own `.withTx` (see the FIX note below).
 */
// ★ FIX, 30 Sep 2026 (worker-failures brief) — MEASURED live: `sweep_automations` GAVE UP on every
//   tenant, every run, with "Cannot read properties of undefined (reading 'withTx')". This function
//   destructured `helpers.db` and called `db.withTx(...)` — an API shape NOTHING in this codebase
//   actually implements (grepped: no other file anywhere defines or calls `.withTx`). The wrapper in
//   `src/queue/tasks.mjs` (`sweepAutomationsWrapper`) supplied every OTHER helper this function names
//   but never a `db`, so it was always going to be `undefined` — not a missing helper, a made-up one.
//   Every real sweep task in this codebase opens its transaction with `withTenant(tenantId, tx => …)`
//   (`src/db/index.mjs`) — the RLS-scoped transaction opener, not a bare Kysely handle — so that is
//   what this now calls, exactly like `sweepRunSchedule` and every other working sweep.
export async function sweepAutomationsTask(payload, helpers) {
  if (!payload || !payload.tenantId) {
    throw new Error("sweepAutomationsTask needs payload.tenantId");
  }
  const { sendAutomationMessage, config, quietClientsSql, getSetting, buildReceipt, addJob } = helpers;

  await withTenant(payload.tenantId, async (tx) => {
    await sweepAutomations(tx, {
      tenantId: payload.tenantId,
      now: new Date(),
      helpers: {
        sendAutomationMessage,
        config,
        quietClientsSql,
        getSetting,
        buildReceipt,
        // ★ FIX, 30 Sep 2026 (worker-failures brief) — `sendAutomationMessage` (engine.mjs) calls
        //   `helpers.addJob` to queue the delivery email; nothing here ever supplied it. `addJob` is
        //   graphile-worker's own helper, real on THIS function's own `helpers` (the queue runner
        //   gives every task one) — just never threaded down to the calls inside `sweepAutomations`.
        addJob,
      },
    });
  });
}

// ★ [TY, 2 Oct 2026] "get rid of that email trigger and email entirely" — the accountant pack
//   feature (sendAccountantPackTask, the manual send route, the template, the setting) removed
//   entirely, same as automation.win_back's own prior removal. See the removal's own commit for
//   the full file list.
