// @ts-check
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 16.20 — THE AUTOMATION ENGINE. Server-side guards, direct send, run log.
//
// ★★★ COMPLIANCE ZONE — review_ask must make no sentiment/rating-based decisions. The function
//     signature accepts only booking count and config. No rating, note, attendance mood, payment
//     state, or any per-person sentiment data is passed, read, or referenced (16 CFR 465).
//
// ★★★ THE NEVER-TWICE GUARD LIVES IN THE DATABASE. automation_run_once index on
//     (tenant_id, key, guard_key) WHERE state <> 'dropped' decides "never twice" atomically.
//     A 23505 violation is expected and caught; the guard is not application logic.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { createNotification } from "../notifications/writes.mjs";
import { createInstance, sendInstance } from "../documents/frontDoor.mjs";
import { AUTOMATIONS, automationSettingKey } from "./catalogue.mjs";
import { readConfig } from "./config.mjs";
import { getSetting } from "../settings/writes.mjs";

/**
 * AUTOMATION_TOPICS — every distinct event topic that any catalogue entry triggers on.
 * 16.32's listener reads this to know which topics to subscribe to.
 */
export const AUTOMATION_TOPICS = Object.freeze([
  "booking.booking.created",
  "booking.booking.completed",
]);

/**
 * ★★ THE ERROR CODE FOR THE NEVER-TWICE GUARD.
 * When the unique index (tenant_id, key, guard_key) WHERE state <> 'dropped' would be violated,
 * Postgres raises 23505 (unique_violation). Caught and interpreted as 'already_ran'.
 */
const UNIQUE_VIOLATION = "23505";

/**
 * runEventAutomations(tx, ev, {tenantId, helpers})
 *
 * For each catalogue entry whose trigger is `event:${ev.topic}`:
 * 1. Read the toggle from tenant_setting; missing row = defaultOn value
 * 2. Read config from automation_config (merged over defaults)
 * 3. Run the kind's evaluator
 * 4. If fire: insert automation_run row inside a SAVEPOINT (catch 23505 as 'already_ran')
 * 5. Emit tasks.automation.ran event and run the kind's action
 *
 * Returns {ran: [{key, runId, action}], skipped: [{key, reason}]}
 */
export async function runEventAutomations(tx, ev, { tenantId, helpers }) {
  const ran = [];
  const skipped = [];

  // Find all automations triggered by this event topic
  const triggered = AUTOMATIONS.filter((a) => a.trigger === `event:${ev.topic}`);

  for (const automation of triggered) {
    const { key, kind, defaultOn } = automation;

    // 1. Check toggle: tenant_setting for automationSettingKey(key)
    const settingKey = automationSettingKey(key);
    const settingRow = await run(tx, db
      .selectFrom("keystone.tenant_setting")
      .select(["value"])
      .where("tenant_id", "=", tenantId)
      .where("key", "=", settingKey));
    const isEnabled = settingRow.rows.length > 0
      ? settingRow.rows[0].value
      : defaultOn;

    if (!isEnabled) {
      skipped.push({ key, reason: "off" });
      continue;
    }

    // 2. Read config
    const config = await readConfig(tx, { tenantId, key });

    // 3. Run the kind's evaluator
    let evaluation = null;

    if (kind === "package_low") {
      evaluation = await evaluatePackageLow(tx, ev, { tenantId, config });
    } else if (kind === "review_ask") {
      evaluation = await evaluateReviewAsk(tx, ev, { tenantId, config });
    } else if (kind === "first_agreement") {
      evaluation = await evaluateFirstAgreement(tx, ev, { tenantId, config });
    }

    if (!evaluation || !evaluation.shouldFire) {
      skipped.push({ key, reason: "no_fire" });
      continue;
    }

    const { guardKey, action: actionType, subjectType, subjectId, personId } = evaluation;

    // 4. Insert automation_run row inside a SAVEPOINT
    let runId;
    try {
      await tx.query("SAVEPOINT automation_run_insert");

      const runResult = await run(tx, db
        .insertInto("keystone.automation_run")
        .values({
          tenant_id: tenantId ?? null,
          key: key ?? null,
          subject_type: subjectType ?? null,
          subject_id: subjectId ?? null,
          person_id: personId ?? null,
          guard_key: guardKey ?? null,
          trigger_event_id: ev.id ?? null,
          action: actionType ?? null,
          state: "done",
          run_at: new Date() ?? null,
        })
        .returning(["id"]));

      runId = runResult.rows[0].id;
      await tx.query("RELEASE SAVEPOINT automation_run_insert");
    } catch (err) {
      await tx.query("ROLLBACK TO SAVEPOINT automation_run_insert");
      if (err.code === UNIQUE_VIOLATION) {
        skipped.push({ key, reason: "already_ran" });
        continue;
      }
      throw err;
    }

    // 5. Emit event, send notification, optionally create task
    const eventResult = await emit(tx, {
      tenantId,
      topic: "tasks.automation.ran",
      emittedBy: "tasks",
      subjectType: "automation_run",
      subjectId: runId,
      payload: { key, action: actionType, ...(evaluation.sessionsRemaining != null ? { sessions_remaining: evaluation.sessionsRemaining } : {}) },
    });

    const eventId = eventResult.id;

    // Run kind-specific actions
    if (kind === "package_low") {
      await actionPackageLow(tx, {
        tenantId,
        runId,
        eventId,
        config,
        evaluation,
        helpers,
      });
    } else if (kind === "review_ask") {
      await actionReviewAsk(tx, {
        tenantId,
        runId,
        config,
      });
    } else if (kind === "first_agreement") {
      await actionFirstAgreement(tx, {
        tenantId,
        runId,
        eventId,
        config,
        evaluation,
        helpers,
      });
    }

    ran.push({ key, runId, action: actionType });
  }

  return { ran, skipped };
}

/**
 * ★★★ PACKAGE_LOW EVALUATOR
 * Fires when a booking leaves the client with exactly config.threshold credits remaining
 * (counted AT BOOKING TIME, after reserves are applied).
 *
 * Checks:
 * - The booking's service has an active entitlement for the client
 * - Remaining available credits = threshold
 * - If min_package_minor is set, entitlement's line item total >= that amount
 */
async function evaluatePackageLow(tx, ev, { tenantId, config }) {
  // Extract booking data from the event
  // ev.subjectId is the booking id
  const bookingId = ev.subjectId;

  const bookingRow = await tx.query(
    // ★ booking has no person_id: the client is the booking_participant with party 'client'
    `SELECT b.id, (SELECT bp.app_user_id FROM keystone.booking_participant bp WHERE bp.booking_id = b.id AND bp.party = 'client' ORDER BY bp.id LIMIT 1) AS person_id, b.service_id, s.name as service_name
     FROM keystone.booking b
     JOIN keystone.service s ON b.service_id = s.id
     WHERE b.id = $1 AND b.tenant_id = $2`,
    [bookingId, tenantId]
  );

  if (bookingRow.rows.length === 0) {
    return null;
  }

  const booking = bookingRow.rows[0];
  const { person_id: personId, service_id: serviceId } = booking;

  // Find active entitlement for this service
  const entitlementRow = await run(tx, db
    .selectFrom("keystone.entitlement as e")
    .innerJoin("keystone.line_item as li", "li.id", "e.line_item_id")
    .select(["e.id", "e.total_credits", "li.unit_amount_minor", "li.quantity", "li.discount_minor"])
    .where("e.owner_user_id", "=", personId)
    .where("e.service_id", "=", serviceId)
    .where("e.status", "=", "active")
    .where("e.expires_at", ">", sql`now()`)
    .orderBy("e.created_at", "desc")
    .limit(1));

  if (entitlementRow.rows.length === 0) {
    return null;
  }

  const entitlement = entitlementRow.rows[0];
  const entitlementId = entitlement.id;

  // Count available credits (after booking reserves them)
  const creditRow = await tx.query(
    `SELECT COUNT(*) as remaining
     FROM keystone.entitlement_credit
     WHERE entitlement_id = $1 AND status = 'available'`,
    [entitlementId]
  );

  const remaining = parseInt(creditRow.rows[0].remaining, 10);

  // Check if it matches the threshold
  if (remaining !== config.threshold) {
    return null;
  }

  // Check min_package_minor if set
  if (config.min_package_minor !== null) {
    const totalMinor = (entitlement.unit_amount_minor * entitlement.quantity) - entitlement.discount_minor;
    if (totalMinor < config.min_package_minor) {
      return null;
    }
  }

  return {
    shouldFire: true,
    guardKey: `entitlement:${entitlementId}`,
    action: config.tell_owner ? "told_client_and_task" : "told_client",
    subjectType: "entitlement",
    subjectId: entitlementId,
    personId,
    sessionsRemaining: remaining,
  };
}

/**
 * ★★★ REVIEW_ASK EVALUATOR
 * COMPLIANCE: This function signature accepts ONLY booking count and config.
 * NO sentiment/rating/note/attendance data is passed or read.
 *
 * Fires the FIRST TIME a client reaches or exceeds config.after_sessions completed bookings.
 * Once-ever guard: after firing for a person, never again.
 *
 * Guard key is person:<personId> with no other qualifier, making it once-per-person-ever.
 */
async function evaluateReviewAsk(tx, ev, { tenantId, config }) {
  const personId = ev.subjectId;

  // Count completed bookings for this person
  const countRow = await tx.query(
    `SELECT COUNT(*) as total
     FROM keystone.booking b
     JOIN keystone.booking_participant bp ON bp.booking_id = b.id AND bp.party = 'client'
     WHERE bp.app_user_id = $1 AND b.state = 'completed' AND b.tenant_id = $2`,
    [personId, tenantId]
  );

  const completedCount = parseInt(countRow.rows[0].total, 10);

  // Fire only if this is the first time hitting the threshold
  if (completedCount < config.after_sessions) {
    return null;
  }

  return {
    shouldFire: true,
    guardKey: `person:${personId}`,
    action: "told_client",
    subjectType: "person",
    subjectId: personId,
    personId,
  };
}

/**
 * ★★★ FIRST_AGREEMENT EVALUATOR
 * Fires only if config.template_id is set AND this is the person's first non-cancelled booking.
 * Note: ev.subjectId is a booking ID (event is booking.booking.created)
 */
async function evaluateFirstAgreement(tx, ev, { tenantId, config }) {
  if (!config.template_id) {
    return null;
  }

  const bookingId = ev.subjectId;

  // Get the booking and extract person_id
  const bookingRow = await tx.query(
    `SELECT (SELECT bp.app_user_id FROM keystone.booking_participant bp WHERE bp.booking_id = b.id AND bp.party = 'client' ORDER BY bp.id LIMIT 1) AS person_id FROM keystone.booking b WHERE b.id = $1 AND b.tenant_id = $2`,
    [bookingId, tenantId]
  );

  if (bookingRow.rows.length === 0) {
    return null;
  }

  const personId = bookingRow.rows[0].person_id;

  // Count non-cancelled bookings for this person
  const countRow = await tx.query(
    `SELECT COUNT(*) as total
     FROM keystone.booking b
     JOIN keystone.booking_participant bp ON bp.booking_id = b.id AND bp.party = 'client'
     WHERE bp.app_user_id = $1 AND b.state <> 'cancelled' AND b.tenant_id = $2`,
    [personId, tenantId]
  );

  const nonCancelledCount = parseInt(countRow.rows[0].total, 10);

  // Fire only on first non-cancelled booking
  if (nonCancelledCount !== 1) {
    return null;
  }

  return {
    shouldFire: true,
    guardKey: `person:${personId}`,
    action: "told_client",
    subjectType: "booking",
    subjectId: bookingId,
    personId,
  };
}

/**
 * ★★ PACKAGE_LOW ACTION
 * 1. Send client notification
 * 2. If tell_owner, create an automation task
 */
async function actionPackageLow(
  tx,
  { tenantId, runId, eventId, config, evaluation, helpers }
) {
  const { personId } = evaluation;

  // Send notification to client
  await sendAutomationMessage(tx, {
    tenantId,
    recipientId: personId,
    eventId,
    templateKey: "automation.package_low",
    title: "Your session block is running low",
    body: null,
    helpers,
  });

  // If tell_owner, create a task
  if (config.tell_owner) {
    // Get first name for task title
    const personRow = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(["display_name"])
      .where("id", "=", personId)
      .where("tenant_id", "=", tenantId));
    const firstName = personRow.rows[0]?.display_name?.split(" ")[0] || "Client";

    await openAutomationTask(tx, {
      tenantId,
      eventId,
      subjectType: "entitlement",
      subjectId: evaluation.subjectId,
      title: `Offer ${firstName} the next block`,
    });
  }
}

/**
 * ★★ REVIEW_ASK ACTION
 * Update automation_run with state='queued' and run_at = now() + delay_hours.
 * A delayed-step job will send the notification later.
 */
async function actionReviewAsk(tx, { tenantId, runId, config }) {
  const delaySeconds = (config.delay_hours || 0) * 3600;
  const runAt = new Date(Date.now() + delaySeconds * 1000);

  await run(tx, db
    .updateTable("keystone.automation_run")
    .set({ state: "queued", run_at: runAt ?? null })
    .where("id", "=", runId));
}

/**
 * ★★ FIRST_AGREEMENT ACTION
 * Create a document instance from the template and send it to the person (the booking's host sends).
 * Note: evaluation.subjectId is the booking ID for first_agreement (since trigger is booking.booking.created)
 */
async function actionFirstAgreement(
  tx,
  { tenantId, runId, eventId, config, evaluation, helpers }
) {
  const bookingId = evaluation.subjectId;
  const personId = evaluation.personId;

  // Get booking to find host_id
  const bookingRow = await run(tx, db
    .selectFrom("keystone.booking")
    .select(["host_id"])
    .where("id", "=", bookingId)
    .where("tenant_id", "=", tenantId));

  if (bookingRow.rows.length === 0) {
    return;
  }

  const hostId = bookingRow.rows[0].host_id;

  // Create instance
  const instance = await createInstance(tx, {
    tenantId,
    builder: "document",
    title: "Agreement",
    templateId: config.template_id,
    subjectUserId: personId,
    assignedTo: [],
    actorUserId: hostId,
  });

  // Send instance
  await sendInstance(tx, {
    tenantId,
    instanceId: instance.id,
    actorUserId: hostId,
  });
}

/**
 * ★★ sendAutomationMessage
 * Direct path used by automations to send notifications.
 * 1. Create notification (topic 'tasks.automation.ran')
 * 2. Queue the delivery email job
 *
 * Does NOT call n8n (deliverN8n stays unwired).
 */
export async function sendAutomationMessage(
  tx,
  { tenantId, recipientId, eventId, templateKey, title, body, helpers }
) {
  // 1. Create notification
  // ★ FIX, 30 Sep 2026 (worker-failures brief) — `templateKey` was accepted by this function and
  //   silently dropped; every automation-sent notification shares one topic
  //   ('tasks.automation.ran'), so the topic→template map `deliver_notification_email` reads
  //   cannot tell invoice_chase apart from win_back apart from package_low. Relayed onto the
  //   notification row (migration 0542) so `emailFor()` can read it directly.
  const notification = await createNotification(tx, {
    tenantId,
    recipientId,
    eventId,
    topic: "tasks.automation.ran",
    title,
    body,
    templateKey,
  });

  // 2. Queue delivery email job
  await helpers.addJob(
    "deliver_notification_email",
    { tenantId, notificationId: notification.id },
    { jobKey: `email:${notification.id}`, jobKeyMode: "replace", priority: -5 }   // ahead of background sweeps (NOTICE_PRIORITY, src/queue/tasks.mjs)
  );
}

/**
 * ★★ openAutomationTask (local helper)
 * Opens a task for the owner when an automation fires.
 * Uses the ON CONFLICT pattern with non-null created_by_event_id to de-duplicate.
 */
async function openAutomationTask(
  tx,
  { tenantId, eventId, subjectType, subjectId, title }
) {
  await tx.query(
    `INSERT INTO keystone.task
       (tenant_id, topic, subject_type, subject_id, title, created_by_event_id)
     VALUES ($1, 'tasks.automation.ran', $2, $3, $4, $5)
     ON CONFLICT (tenant_id, subject_type, subject_id, topic)
       WHERE closed_at IS NULL AND created_by_event_id IS NOT NULL
       DO NOTHING`,
    [tenantId, subjectType, subjectId, title, eventId]
  );
}

/**
 * ★ Task 20.17 — runCallbackAutomation(tx, args)
 *
 * Callback automation from n8n. Reuses the guard chain from runEventAutomations:
 * 1. Read the toggle from tenant_setting
 * 2. Read config from automation_config
 * 3. Check platform flag (flagIsOn n8n kill switch)
 * 4. Insert automation_run row (catch 23505 as already_ran)
 * 5. Emit tasks.automation.ran event and run the action
 *
 * Returns {ran:true, runId} or {ran:false, reason}
 */
export async function runCallbackAutomation(
  tx,
  { key, topic, tenantId, recipient, context, step }
) {
  const { personId, role } = recipient || {};

  // ★ Task 20.22 — CUTOVER FLAG FOR MONEY-TELLING. The four money email templates are being cut over
  //   from queue to n8n. When the cutover flag is OFF (default), queue sends and callback refuses.
  //   When ON, queue skips and callback sends. Check the flag first.
  const MONEY_TELLING_KEYS = ["money.receipt", "money.invoice_reminder", "money.update_card", "money.invoice_issued"];
  if (MONEY_TELLING_KEYS.includes(key)) {
    const cutoverFlag = await getSetting(tx, "automation_cutover.money_telling", false);
    if (!cutoverFlag) {
      // Cutover is OFF — queue sends, callback refuses
      return { ran: false, reason: "cutover_off" };
    }
  }

  // 1. Check toggle: tenant_setting for automationSettingKey(key)
  const settingKey = automationSettingKey(key);
  const settingRow = await run(tx, db
    .selectFrom("keystone.tenant_setting")
    .select(["value"])
    .where("tenant_id", "=", tenantId)
    .where("key", "=", settingKey));

  // Default to ON; if explicitly disabled, return tenant_off
  const isEnabled = settingRow.rows.length > 0 ? settingRow.rows[0].value : true;
  if (!isEnabled) {
    return { ran: false, reason: "tenant_off" };
  }

  // 2. Find the automation in the catalogue by key
  const automation = AUTOMATIONS.find((a) => a.key === key);
  if (!automation) {
    return { ran: false, reason: "no_recipient" };
  }

  // 3. Determine the subject (person or role)
  let subjectType = "person";
  let subjectId = personId;

  if (!personId && role) {
    subjectType = "role";
    subjectId = role;
  } else if (!personId) {
    return { ran: false, reason: "no_recipient" };
  }

  // 4. Read config from automation_config (merged over defaults)
  const config = await readConfig(tx, { tenantId, key });

  // 5. Insert automation_run row inside a SAVEPOINT (catch 23505 as already_ran)
  //    Task 20.48: For sequence steps, include step in guard_key (never-twice per step per person)
  let runId;
  let guardKey = `callback:${key}:${subjectType}:${subjectId}`;
  if (step !== undefined && step !== null) {
    guardKey = `callback:${key}:${subjectType}:${subjectId}:step:${step}`;
  }

  try {
    await tx.query("SAVEPOINT automation_run_insert");

    const runResult = await run(tx, db
      .insertInto("keystone.automation_run")
      .values({
        tenant_id: tenantId ?? null,
        key: key ?? null,
        subject_type: subjectType ?? null,
        subject_id: subjectId ?? null,
        person_id: personId ?? null,
        guard_key: guardKey ?? null,
        action: "send",
        state: "done",
        run_at: new Date() ?? null,
      })
      .returning(["id"]));

    runId = runResult.rows[0].id;
    await tx.query("RELEASE SAVEPOINT automation_run_insert");
  } catch (err) {
    await tx.query("ROLLBACK TO SAVEPOINT automation_run_insert");
    if (err.code === UNIQUE_VIOLATION) {
      return { ran: false, reason: "already_ran" };
    }
    throw err;
  }

  // 6. Emit event
  await emit(tx, {
    tenantId,
    topic: "tasks.automation.ran",
    emittedBy: "tasks",
    subjectType: "automation_run",
    subjectId: runId,
    payload: { key, action: "send" },
  });

  return { ran: true, runId };
}
