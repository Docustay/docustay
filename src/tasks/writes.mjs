// @ts-check
/**
 * TASK WRITES — P20.3. Opening a task from a chain, and closing it from the chain's closing event.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ BOTH FUNCTIONS TAKE `tx`, NOT A POOL, AND THAT IS THE CONTRACT — the same one `emit()` enforces
 *     (P15B.2a). A task created outside the dispatcher's transaction survives a rollback of the event
 *     that created it, leaving a task whose `created_by_event_id` points at an event that never
 *     happened. Since that column is `ON DELETE RESTRICT` specifically so the trail is trustworthy,
 *     breaking it here would make the strongest guarantee in the table the falsest thing in it.
 *
 * ★★ NEITHER FUNCTION EMITS AN EVENT. Deliberate: the chain layer runs INSIDE `dispatch_outbox`, which
 *    is already draining the outbox. Emitting `tasks.task.created` there would enqueue work from inside
 *    the drain of that same work — a feedback path that terminates only because nothing subscribes to
 *    it today. If Tasks ever needs its own notifications, the emit belongs on the ROUTE that creates a
 *    manual task, not in the dispatcher.
 */

import { emit, userActor } from "../events/outbox.mjs";
import { notFound } from "../http/errors.mjs";
import { automationSettingKey } from "../automations/catalogue.mjs";
import { readConfig } from "../automations/config.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * OPEN a task for a chain, idempotently.
 *
 * ★★★ THE IDEMPOTENCE IS THE WHOLE FUNCTION, AND IT IS THE DATABASE'S, NOT OURS.
 *     `ON CONFLICT` against `task_open_key` — the partial unique index over
 *     (tenant_id, subject_type, subject_id, topic) WHERE closed_at IS NULL. A `SELECT` then `INSERT`
 *     would race: two workers draining the same tenant, or one job retried after a lease expiry, both
 *     see no row and both insert. This system HAS those retry paths on purpose (P18.6(a)'s lease, and
 *     graphile-worker's own retries), so the race is not hypothetical.
 *   ★ `DO NOTHING` rather than `DO UPDATE`: a second firing must not overwrite the title or the
 *     assignee a human has since set. The first event to arrive owns the row.
 *
 * @returns {Promise<{id: string, created: boolean}>} — `created:false` means a task was already open
 *   for this (subject, topic). That is a SUCCESS, and the caller must not treat it as an error.
 */
export async function openChainTask(tx, {
  tenantId, topic, subjectType, subjectId, title, createdByEventId = null,
  assigneeId = null, dueAt = null,
}) {
  if (!tenantId) throw new Error("openChainTask needs a tenantId");
  if (!subjectId) {
    // ★★ A chain whose `subjectFrom` returned null must FAIL, not insert a null-subject task.
    //    `subject_id` is NOT NULL in 0055, so the database would refuse it anyway — but the error the
    //    database gives names a column, and this one names the CHAIN, which is what a reader needs.
    throw new Error(
      `openChainTask for topic "${topic}" has no subjectId — the chain's subjectFrom() found nothing in ` +
      `the event payload. The task cannot be opened from any record page without a subject, so this is ` +
      `a defect in the emitter's payload, not a reason to create an orphan task.`);
  }
  if (!title || !String(title).trim()) {
    throw new Error(
      `openChainTask for topic "${topic}" has no title. §A4.4: "a topic is not a sentence" — a task ` +
      `with no title renders a blank row (U30) and tells nobody what to do.`);
  }
  if (!createdByEventId) {
    throw new Error(
      "openChainTask needs createdByEventId — a chain task without its event cannot be de-duplicated (task_open_key, 0353)");
  }

  const { rows } = await tx.query(
    `INSERT INTO keystone.task
       (tenant_id, topic, subject_type, subject_id, title, created_by_event_id, assignee_id, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, subject_type, subject_id, topic) WHERE closed_at IS NULL AND created_by_event_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [tenantId, topic, subjectType, subjectId, String(title).trim(), createdByEventId, assigneeId, dueAt]);

  if (rows[0]) return { id: rows[0].id, created: true };

  // ★ ON CONFLICT DO NOTHING returns no row, so the already-open task is read back explicitly. The
  //   caller needs its id to log what happened; "created:false with no id" would be a half answer.
  const existing = await run(tx, db
    .selectFrom("keystone.task")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("subject_type", "=", subjectType)
    .where("subject_id", "=", subjectId)
    .where("topic", "=", topic)
    .where("closed_at", "is", null));
  return { id: existing.rows[0]?.id ?? null, created: false };
}

/**
 * CLOSE every open task that this event closes, for one chain.
 *
 * ★★★ IT CLOSES BY (subject, OPENING topic) — NOT by the closing topic. The task's `topic` column holds
 *     the topic that OPENED it (`documents.document.sent`), and the event arriving is the CLOSER
 *     (`documents.document.executed`). Matching on the closer's own topic would find nothing and close
 *     nothing, silently — the task stays on the screen and the chain looks unbuilt. This is the single
 *     easiest way to get P20.3 wrong and it produces no error at all.
 *
 * ★★ `closed_reason = 'event'` REQUIRES `closed_by_event_id`, per `task_closed_shape` in 0055. Both are
 *    written together here so the constraint can never be the thing that discovers a bug in this file.
 *
 * @returns {Promise<Array<{id: string, topic: string}>>} the tasks actually closed — possibly empty,
 *   which is legitimate (a document executed without ever having a chase task, e.g. one sent before
 *   this chain existed).
 */
export async function closeChainTasks(tx, {
  tenantId, openingTopic, subjectType, subjectId, closedByEventId,
}) {
  if (!tenantId) throw new Error("closeChainTasks needs a tenantId");
  if (!closedByEventId) {
    throw new Error(
      `closeChainTasks for "${openingTopic}" has no closedByEventId, but closed_reason='event' requires ` +
      `one (task_closed_shape, 0055). ★ Without it "an event closed it" cannot be resolved to WHICH ` +
      `event, which is the audit gap that constraint exists to forbid.`);
  }
  if (!subjectId) return [];   // ★ nothing to match on; not an error, just no work

  const { rows } = await run(tx, db
    .updateTable("keystone.task")
    .set({
      closed_at: sql`now()`,
      closed_reason: "event",
      closed_by_event_id: closedByEventId ?? null,
    })
    .where("tenant_id", "=", tenantId)
    .where("subject_type", "=", subjectType)
    .where("subject_id", "=", subjectId)
    .where("topic", "=", openingTopic)
    .where("closed_at", "is", null)
    .returning(["id", "topic"]));
  return rows;
}

/**
 * CREATE a task manually — a person is creating it, not an event chain.
 *
 * ★★ UNLIKE `openChainTask`, THIS HAS NO IDEMPOTENCE. A manual task can coexist with others
 *    on the same (subject, topic) — the `task_open_key` unique constraint applies only to
 *    event-created tasks (created_by_event_id IS NOT NULL). A person can create as many tasks
 *    as they want for the same subject; this function just creates a new one each time.
 *
 * ★★ TAKES A TRANSACTION LIKE `openChainTask`, FOR THE SAME REASON: the task must exist in
 *    the same transaction as the event or route that created it, or it survives a rollback.
 *
 * @returns {Promise<{id: string}>} — the newly created task's id
 */
export async function createManualTask(tx, {
  tenantId, topic, subjectType, subjectId, title, createdByAppUserId,
  assigneeId = null, dueAt = null,
}) {
  if (!tenantId) throw new Error("createManualTask needs a tenantId");
  if (!title || !String(title).trim()) {
    throw new Error(
      `createManualTask for topic "${topic}" has no title. A task with no title renders a ` +
      `blank row and tells nobody what to do.`);
  }
  if (!createdByAppUserId) {
    throw new Error(
      `createManualTask needs createdByAppUserId to track who created it. ` +
      `For system-created tasks, use openChainTask with createdByEventId instead.`);
  }

  // ★ Default subjectType and subjectId if not provided
  const finalSubjectType = subjectType || "person";
  const finalSubjectId = subjectId || (assigneeId ?? createdByAppUserId);

  const { rows } = await run(tx, db
    .insertInto("keystone.task")
    .values({
      tenant_id: tenantId ?? null,
      topic: topic ?? null,
      subject_type: finalSubjectType ?? null,
      subject_id: finalSubjectId ?? null,
      title: (String(title).trim()) ?? null,
      created_by_app_user_id: createdByAppUserId ?? null,
      assignee_id: assigneeId ?? null,
      due_at: dueAt ?? null,
    })
    .returning("id"));

  // ★ Emit task.assigned event when an assignee is set
  if (assigneeId) {
    await emit(tx, {
      tenantId,
      topic: "tasks.task.assigned",
      emittedBy: "tasks",
      subjectType: "task",
      subjectId: rows[0].id,
      actor: userActor(createdByAppUserId),
      payload: { assignee_id: assigneeId },
    });
  }

  return { id: rows[0].id };
}

/**
 * SNOOZE a task — hide it until a future date without closing it.
 *
 * ★★ A TEMPORAL STATE CHANGE ONLY. Snoozing does not close the task; it just sets
 *    `snoozed_until` so screens can filter it out. When the time arrives, screens stop
 *    filtering and the task reappears. A closed task cannot be unsnoozed.
 *
 * @param taskId — the task to snooze
 * @param snoozeUntil — a timestamptz, or null to clear the snooze
 * @returns {Promise<{id: string, snoozedUntil: string | null}>}
 */
export async function snoozeTask(tx, { tenantId, taskId, snoozeUntil, actorUserId = null }) {
  if (!taskId) throw new Error("snoozeTask needs a taskId");

  const { rows } = await run(tx, db
    .updateTable("keystone.task")
    .set({ snoozed_until: snoozeUntil ?? null })
    .where("id", "=", taskId)
    .returning(["id", "snoozed_until"]));

  if (!rows[0]) return { id: null, snoozedUntil: null };

  // ★ Emit task.snoozed event if tenantId is available
  if (tenantId) {
    await emit(tx, {
      tenantId,
      topic: "tasks.task.snoozed",
      emittedBy: "tasks",
      subjectType: "task",
      subjectId: rows[0].id,
      actor: userActor(actorUserId),
      payload: { snoozed_until: rows[0].snoozed_until },
    });
  }

  return { id: rows[0].id, snoozedUntil: rows[0].snoozed_until };
}

/**
 * COMPLETE a task — mark it as done with manual completion.
 *
 * @param taskId — the task to complete
 * @param actorUserId — who is completing it
 * @returns {Promise<{id: string}>}
 */
export async function completeTask(tx, { tenantId, taskId, actorUserId }) {
  if (!taskId) throw new Error("completeTask needs a taskId");

  const { rows } = await run(tx, db
    .updateTable("keystone.task")
    .set({
      closed_at: sql`now()`,
      closed_reason: "manual",
    })
    .where("id", "=", taskId)
    .where("closed_at", "is", null)
    .returning("id"));

  if (!rows[0]) throw notFound("no such task or it is already closed");

  await emit(tx, {
    tenantId,
    topic: "tasks.task.completed",
    emittedBy: "tasks",
    subjectType: "task",
    subjectId: rows[0].id,
    actor: userActor(actorUserId),
    payload: { closed_reason: "manual" },
  });

  return { id: rows[0].id };
}

/**
 * REASSIGN a task to a different staff member.
 *
 * @param taskId — the task to reassign
 * @param assigneeId — the new assignee (must be staff)
 * @param actorUserId — who is reassigning it
 * @returns {Promise<{id: string}>}
 */
export async function reassignTask(tx, { tenantId, taskId, assigneeId, actorUserId }) {
  if (!taskId) throw new Error("reassignTask needs a taskId");
  if (!assigneeId) throw new Error("reassignTask needs an assigneeId");

  // ★ Verify the new assignee is staff in this tenant
  const staffRow = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(sql`1`)
    .where("id", "=", assigneeId)
    .where("tenant_id", "=", tenantId)
    .where("role", "=", "staff"));

  if (!staffRow.rows[0]) {
    throw new Error("assigneeId must be a staff member in this tenant");
  }

  const { rows } = await run(tx, db
    .updateTable("keystone.task")
    .set({ assignee_id: assigneeId ?? null })
    .where("id", "=", taskId)
    .returning("id"));

  if (!rows[0]) throw notFound("no such task");

  await emit(tx, {
    tenantId,
    topic: "tasks.task.reassigned",
    emittedBy: "tasks",
    subjectType: "task",
    subjectId: rows[0].id,
    actor: userActor(actorUserId),
    payload: { new_assignee_id: assigneeId },
  });

  return { id: rows[0].id };
}

/**
 * ★★ THE CHAIN LAYER ITSELF — run for EVERY claimed event, opener or closer or neither.
 *
 * ★★★ IT IS SEPARATE FROM `TOPIC_HANDLERS` ON PURPOSE, AND THE DISPATCHER CALLS BOTH.
 *     A topic can be a chain opener AND have a side-effect handler — `documents.document.sent` is
 *     exactly that: it emails the signer (TOPIC_HANDLERS) and opens a chase task (here). If the chain
 *     work lived inside the handler map, then every topic that needed a task would also need a handler
 *     entry, and `booking.booking.completed` — which needs a task and no side effect — would have to
 *     have a do-nothing handler written for it. A reader would then not be able to tell a deliberate
 *     no-op from a forgotten one, which is the ambiguity the `unhandled` counter exists to remove.
 *
 * @returns {Promise<{opened: Array, closed: Array}>}
 */
export async function applyChains(tx, ev, { tenantId, chains, closingIndex, subjectClosers = {} }) {
  const opened = [], closed = [];

  for (const chain of chains) {
    if (chain.opensOn !== ev.topic) continue;
    const subjectId = chain.subjectFrom(ev);
    // ★ STAGE 3 TASK 3 FIX 1, REVIEW M7 — A RE-DISPATCH DOES NOT RE-READ THE NAME. When a task is
    //   already open for this (subject, opening topic), `openChainTask` would DO NOTHING with the title
    //   anyway (ON CONFLICT … DO NOTHING) — so the name lookups `chain.title` runs (up to four queries
    //   for `chase_signature`) are skipped. Same predicate as openChainTask's own read-back.
    if (subjectId) {
      const open = await run(tx, db
        .selectFrom("keystone.task")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("subject_type", "=", chain.subjectType)
        .where("subject_id", "=", subjectId)
        .where("topic", "=", chain.opensOn)
        .where("closed_at", "is", null));
      if (open.rows[0]) {
        opened.push({ chain: chain.key, taskId: open.rows[0].id, created: false });
        continue;
      }
    }

    // ★★★ CHECK AUTOMATION SETTING IF THIS CHAIN HAS AN AUTOMATION KEY
    if (chain.automationKey) {
      const settingKey = automationSettingKey(chain.automationKey);
      const settingResult = await run(tx, db
        .selectFrom("keystone.tenant_setting")
        .select("value")
        .where("tenant_id", "=", tenantId)
        .where("key", "=", settingKey));
      // If setting explicitly false, skip this chain
      if (settingResult.rows[0] && settingResult.rows[0].value === false) {
        opened.push({ chain: chain.key, skipped: 'off' });
        continue;
      }
      // If no row, the catalogue's defaultOn applies (forms.lead_task defaults to true)
    }

    // ★ STAGE 3 TASK 3 — `chain.title` is now `async (ev, tx) => string`: it reads the current
    //   record for any name it needs (see `src/tasks/chains.mjs`'s own header), rather than trusting
    //   a copy the payload privacy rule no longer allows the event to carry.
    let dueAt = null;

    // ★★★ CALCULATE DUE_AT FOR write_session_note CHAIN BASED ON AUTOMATION CONFIG
    if (chain.key === 'write_session_note') {
      const config = await readConfig(tx, { tenantId, key: 'tasks.session_writeup' });
      if (config.due === 'next_morning') {
        // Get practice timezone
        const tenantRow = await run(tx, db
          .selectFrom("keystone.tenant")
          .select("timezone")
          .where("id", "=", tenantId));
        if (tenantRow.rows[0]) {
          const tz = tenantRow.rows[0].timezone;
          // Calculate 09:00 tomorrow in the practice's timezone
          dueAt = await tx.query(
            `SELECT (((NOW() AT TIME ZONE $1) + INTERVAL '1 day')::date + TIME '09:00') AT TIME ZONE $1 AS due`  /* 09:00 local tomorrow; `AT TIME ZONE` bound to the string before */,
            [tz]
          );
          if (dueAt.rows[0]) {
            dueAt = dueAt.rows[0].due;
          } else {
            dueAt = null;
          }
        }
      }
      // Otherwise (same_evening or missing), dueAt stays NULL
    }

    const r = await openChainTask(tx, {
      tenantId, topic: chain.opensOn, subjectType: chain.subjectType, subjectId,
      title: await chain.title(ev, tx), createdByEventId: ev.id, dueAt,
    });
    opened.push({ chain: chain.key, taskId: r.id, created: r.created });
  }

  for (const chain of (closingIndex[ev.topic] ?? [])) {
    // ★★ THE SUBJECT COMES FROM THE **CHAIN'S** subjectFrom, APPLIED TO THE CLOSING EVENT. Both ends of
    //    a chain are about the same subject, so the same extractor is correct — and using it for both
    //    is what guarantees the close matches the open. A second, hand-written extractor for the closer
    //    is how the two halves drift apart and stop matching.
    const subjectId = chain.subjectFrom(ev);
    const rows = await closeChainTasks(tx, {
      tenantId, openingTopic: chain.opensOn, subjectType: chain.subjectType,
      subjectId, closedByEventId: ev.id,
    });
    for (const row of rows) closed.push({ chain: chain.key, taskId: row.id });
  }

  // ★★★ STAGE 3 TASK 9 — a SUBJECT closer (src/tasks/chains.mjs SUBJECT_CLOSERS): the subject is over, so
  //     every open task on it closes, whichever topic opened it. Same closed shape as a chain closer.
  const sc = subjectClosers[ev.topic];
  if (sc && ev.subject_type === sc.subjectType && ev.subject_id) {
    const { rows } = await run(tx, db
      .updateTable("keystone.task")
      .set({
        closed_at: sql`now()`,
        closed_reason: "event",
        closed_by_event_id: ev.id ?? null,
      })
      .where("tenant_id", "=", tenantId)
      .where("subject_type", "=", sc.subjectType)
      .where("subject_id", "=", ev.subject_id)
      .where("closed_at", "is", null)
      .returning("id"));
    for (const row of rows) closed.push({ chain: `subject:${ev.topic}`, taskId: row.id });
  }

  return { opened, closed };
}
