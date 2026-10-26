// ═══════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 4 TASK 10 — THE TWO THINGS A PERSON MAY DO TO A GIVE-UP (07 §4 rule 8, MOCKUPS §20).
//
// ★★★ "RETRY NOW" AND "GIVE UP…" ARE THE ONLY WAY AN OPEN GIVE-UP EVER CLOSES WHILE ITS PRACTICE IS
//     ALIVE. F511/0156 let the SYSTEM acknowledge one only when the practice it belonged to is gone;
//     everything else waits for a person. Until this module there was no person-shaped path at all,
//     so the queue check counted rows nobody could act on, forever.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT THIS FILE IS **NOT** ALLOWED TO BE: A SECOND OPINION.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//   · The PERMISSION is `keystone.caller_is_platform()`, inside all four database functions (0160).
//     The route checks it too (`section: "/platform/jobs"` + `super_admin_1`, src/routes/writes.mjs)
//     — belt and suspenders, and the brief asks for both — but nothing here re-derives "is this
//     person platform staff" from a session field. A check this module could get wrong is a check
//     that would eventually disagree with the database's.
//   · The QUEUE POLICY is `addJobWithPolicy` (src/queue/jobPolicy.mjs). The retry goes THROUGH it,
//     so the attempt budget and the queue name come from the one table that decides them. The adder
//     handed to it does not add a job — it resets the one that is already there (see `retryJobNow`).
//   · The EMAIL RULES are `emailRetryReadiness` (src/email/send.mjs), which is `priorDelivery` +
//     `verdictFor` and nothing else. In-doubt past R66's window, already sent, or in flight — the
//     answer is the send path's own, so the button cannot drift away from what a send would do.
//   · The STALENESS RULE (progress.md M-3) is the database's, taken twice: once on the read
//     (`platform_job_retry_target`) and again under `FOR UPDATE` in `acknowledge_job_failure`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE AUDIT EVENT GOES IN THE **PRACTICE'S** LOG, AND THAT IS THE §A9 RULE, NOT A NICETY.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//   §A9 makes impersonation visible to the tenant *as the condition of it existing*: "this is the
//   feature that gets abused if it is not recorded." Re-queueing or closing a practice's background
//   work is the same kind of reach — a platform operator changing what happens inside somebody
//   else's practice — so it is recorded the same way, in a log the practice itself can read
//   (`src/audit/queries.mjs`, which excludes nothing).
//   ★★ HOW: a TRANSACTION-LOCAL GUC swap around the `emit()`, inside the request's own transaction.
//      `keystone.event`'s INSERT policy is `tenant_id = require_tenant_id()`, so the row cannot be
//      written for a practice the connection is not currently "in" — and that is a good policy, not
//      an obstacle to route around. The swap is `set_config(..., true)` (transaction-local), the
//      restore is in a `finally`, and the restore is ASSERTED afterwards, because a request that
//      silently continued in the wrong practice's context would be the worst defect in this file.
//   ★ The payload carries ids and counts only — `assertSafePayload` refuses free text, so the
//     operator's typed reason lives on the ledger row (where it belongs) and never in an event.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { addJobWithPolicy } from "../queue/jobPolicy.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { emailRetryReadiness } from "../email/send.mjs";
import { invalid, forbidden, notFound, conflict, internal } from "../http/errors.mjs";

/** ★ The one task whose retry has a rule of its own. Named once. */
const EMAIL_TASK = "deliver_notification_email";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE DATABASE'S REFUSALS, TURNED INTO THE HTTP ANSWER THEY ALREADY MEAN.
//    0160 raises with a deliberate SQLSTATE per case and a sentence a person can read. Mapping by
//    CODE (never by matching the message) keeps the wording free to improve without breaking the
//    status, and keeps the sentence — which was written for the screen — as the message.
//  ★ 40001 is a CONFLICT, not an error: the row moved while it was on screen and the person is
//    asked to look again. 55006 (lock_not_available) is the same shape — come back in a moment.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const BY_SQLSTATE = Object.freeze({
  "42501": forbidden,   // caller_is_platform() said no, or the row is already dealt with
  "22023": invalid,     // a blank reason, a missing person, a key or queue that is not the job's
  "40001": conflict,    // M-3 — the give-up changed while it was on screen
  "42704": notFound,    // no such give-up, or the job has been reaped
  "55006": conflict,    // a worker holds the job right now
});

/**
 * ★ The database's message with its function-name prefix removed — `platform_retry_job: a worker is
 *   running that job right now` reads as a leak of an internal name on a screen, and the sentence
 *   after the colon is the one that was written for a person.
 */
function plainly(message) {
  return String(message ?? "").replace(/^[a-z_]+:\s*/, "");
}

/** ★ Rethrow a Postgres refusal as the AppError it already means; anything else is left alone. */
function asAppError(err) {
  const make = BY_SQLSTATE[err?.code];
  if (!make) return err;
  return make(plainly(err.message));
}

async function call(tx, sql, params) {
  try {
    return await tx.query(sql, params);
  } catch (err) {
    throw asAppError(err);
  }
}

// ── what the caller must have sent ─────────────────────────────────────────────────────────────
// ★ These refuse SHAPES, not permissions. The permission is the route's and the database's.

function asFailureId(v) {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? "").trim(), 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw invalid(`failureId must be the id of a give-up on Platform Jobs — got ${JSON.stringify(v)}`);
  }
  return n;
}

/**
 * ★★★ THE VERSION THE PERSON HAD ON SCREEN (progress.md M-3). BOTH HALVES ARE REQUIRED, and their
 *     absence is a refusal rather than a default: a caller that omitted them would otherwise get the
 *     un-raced behaviour by accident, which is exactly the defect M-3 names.
 */
function asVersion({ repeatCount, lastSeenAt }) {
  const n = typeof repeatCount === "number" ? repeatCount : Number.parseInt(String(repeatCount ?? "").trim(), 10);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw invalid(
      `repeatCount must be the number of times this give-up had happened when you loaded the screen ` +
      `— got ${JSON.stringify(repeatCount)}. Reload Platform Jobs and try again.`);
  }
  const raw = lastSeenAt instanceof Date ? lastSeenAt.toISOString() : String(lastSeenAt ?? "").trim();
  if (!raw || Number.isNaN(Date.parse(raw))) {
    throw invalid(
      `lastSeenAt must be the time this give-up was last seen when you loaded the screen ` +
      `— got ${JSON.stringify(lastSeenAt)}. Reload Platform Jobs and try again.`);
  }
  return { repeatCount: n, lastSeenAt: raw };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE AUDIT ROW, WRITTEN INTO THE PRACTICE'S OWN LOG, IN THIS TRANSACTION.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const TENANT_GUC = "keystone.tenant_id";

/**
 * ★★★ THE EVENT IS WRITTEN BY THE CALLER, NOT BY THIS HELPER, AND THE TOPIC LITERAL STAYS AT THE
 *     CALL SITE. This helper used to take `topic` as an argument and call `emit()` itself — which
 *     made `db/gates/s3_topic_emitters.mjs` fail, correctly: a topic that reaches `emit()` through a
 *     variable is invisible to the catalogue check, so "every emit is catalogued" and "every topic
 *     has a reachable producer" both went blind at this one call. [MEASURED: 3 failures, two of them
 *     `platform.job.retried` / `platform.job.given_up` reported as having no producer at all.] The
 *     fix is the code's, not the gate's: this function now lends its CONTEXT and the caller writes
 *     its own event, so both topics are ordinary literals a static reader can see.
 *
 * ★★ WHAT IT LENDS IS THE PRACTICE'S TENANT CONTEXT, transaction-locally. §A9's rule for
 *    impersonation applies to these two actions for the same reason: a platform operator cannot
 *    reach into a practice's background work without the practice being able to read that they did.
 *    The GUC is set for the emit and GIVEN BACK afterwards, asserted rather than assumed — the rest
 *    of this request, including the idempotency record the boundary writes after the handler
 *    returns, runs on this same connection.
 */
async function auditForPractice(tx, { platformTenantId, practiceTenantId }, writeTheEvent) {
  // ★ A give-up with no practice (a platform-wide job) is still audited — into the platform's own
  //   log, because there is no practice to show it to. Silence would be the wrong answer either way.
  const target = practiceTenantId ?? platformTenantId;
  const swapped = String(target) !== String(platformTenantId);

  if (swapped) await tx.query(`SELECT set_config($1, $2, true)`, [TENANT_GUC, target]);
  try {
    await writeTheEvent(target);
  } finally {
    if (swapped) await tx.query(`SELECT set_config($1, $2, true)`, [TENANT_GUC, platformTenantId]);
  }

  if (swapped) {
    // ★★★ ASSERTED, NOT ASSUMED.
    const { rows } = await tx.query(`SELECT current_setting($1, true) AS t`, [TENANT_GUC]);
    if (String(rows[0]?.t) !== String(platformTenantId)) {
      throw internal(
        `the practice context was not given back after the audit event (still ${JSON.stringify(rows[0]?.t)})`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1 · RETRY NOW
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ RE-QUEUE THE JOB BEHIND THIS GIVE-UP, UNDER THE SAME KEY, AS ONE JOB.
 *
 * ★★ IT DOES NOT ADD A JOB. `addJobWithPolicy` is called with an adder whose `addJob` resets the row
 *    that is already on the queue (`keystone.platform_retry_job`, 0160) — graphile's own
 *    `ON CONFLICT (key) DO UPDATE` branch. A real `addJob` would be a SECOND job under a new key if
 *    the key were ever dropped, and 07 §4 says one run. Going through the policy anyway is what
 *    makes the attempt budget and the queue name the policy's rather than this file's.
 *  ★ The adder has no `withPgClient` ON PURPOSE: that is what tells `addJobWithPolicy` not to take
 *    its periodic pull-forward shortcut, which is for a job still WAITING between retries. This job
 *    has none left.
 *
 * @param {{query: Function}} tx the request's tenant transaction (platform practice)
 */
export async function retryJobNow(tx, { failureId, repeatCount, lastSeenAt, actorUserId, tenantId }) {
  const id = asFailureId(failureId);
  const version = asVersion({ repeatCount, lastSeenAt });

  // ★★★ `job_created_at::text`, AND THAT CAST IS LOad-BEARING. The job identity is (id, task,
  //     created_at) — F510 — and `created_at` is a `timestamptz` with MICROSECOND precision. Read
  //     into JavaScript it becomes a Date, which is MILLISECONDS, and handing that back as the
  //     identity would match no row at all: the retry would report "that job is no longer on the
  //     queue" for every job that is in fact sitting right there. Kept as text, the value makes the
  //     round trip byte for byte. ★ The same fact is why 0160 compares the M-3 timestamp — which
  //     really does come from a browser, through JSON — to the millisecond instead.
  const { rows: [target] } = await call(tx,
    `SELECT job_id, task_identifier, job_created_at::text AS job_created_at, tenant_id,
            repeat_count, last_seen_at
       FROM keystone_meta.platform_job_retry_target($1, $2, $3::timestamptz)`,
    [id, version.repeatCount, version.lastSeenAt]);
  if (!target) throw notFound(`there is no open give-up numbered ${id}`);

  const { rows: [queued] } = await call(tx,
    `SELECT payload, job_key, attempts, max_attempts, locked_at, queue_name
       FROM keystone.platform_job_queue_row($1, $2, $3::timestamptz)`,
    [target.job_id, target.task_identifier, target.job_created_at]);
  // ★ Zero rows is the honest case, not an error state: graphile deletes a job when it succeeds or is
  //   reaped, and the payload goes with it, so there is nothing left to put back.
  if (!queued) {
    throw conflict(
      "that job is no longer on the queue, so there is nothing to retry — it has already run or been " +
      "cleared away. Give up… is the way to close this row.");
  }
  if (queued.locked_at) {
    throw conflict("a worker is running that job right now — wait for it to finish and look again.");
  }

  // ★★★ THE EMAIL RULE, ASKED BEFORE ANYTHING IS WRITTEN AND ANSWERED BY THE SEND PATH ITSELF.
  //     A re-queued in-doubt email past R66's 23-hour window could be a SECOND real email to a real
  //     person (Resend has forgotten the Idempotency-Key by then), and 02 §2.6 says never.
  //  ★★ NOTHING IS WRITTEN BY THE CHECK — in particular `ever_in_doubt` (sticky since 0155) cannot be
  //     cleared here, by construction: there is no UPDATE on `notification_delivery` in this path.
  if (target.task_identifier === EMAIL_TASK) {
    const readiness = await emailRetryReadiness({
      tenantId: queued.payload?.tenantId ?? target.tenant_id,
      notificationId: queued.payload?.notificationId,
    });
    if (!readiness.ok) throw conflict(readiness.reason);
  }

  const adder = {
    addJob: async (name, payload, finalOpts) => {
      const { rows } = await call(tx,
        `SELECT keystone.platform_retry_job($1, $2, $3::timestamptz, $4, $5, $6) AS job_id`,
        [target.job_id, name, target.job_created_at, queued.job_key,
         finalOpts.maxAttempts, queued.queue_name ?? finalOpts.queueName ?? null]);   // a job queued before D559 keeps the queue it is on (the SQL refuses a rename)
      return { id: rows[0].job_id, requeued: true };
    },
  };
  const requeued = await addJobWithPolicy(adder, target.task_identifier, queued.payload,
    // ★ The job's OWN key, read from the row — never one the caller sent. The function refuses a key
    //   that is not the job's, so a retry can never rename a job.
    queued.job_key === null ? {} : { jobKey: queued.job_key });

  await auditForPractice(tx, { platformTenantId: tenantId, practiceTenantId: target.tenant_id },
    (auditTenantId) => emit(tx, {
      tenantId: auditTenantId,
      topic: "platform.job.retried",
      emittedBy: "platform",
      // ★ No subject: neither a graphile job nor a ledger row is a record in this product's
      //   vocabulary (SUBJECT_TYPES), and inventing a name for one would be a private vocabulary.
      subjectType: null,
      subjectId: null,
      actor: userActor(actorUserId),
      payload: {
        failure_id: id,
        job_id: Number(target.job_id),
        task_identifier: target.task_identifier,
        repeat_count: target.repeat_count,
      },
    }));

  return {
    ok: true,
    action: "retried",
    failureId: id,
    jobId: String(requeued?.id ?? target.job_id),
    taskIdentifier: target.task_identifier,
    tenantId: target.tenant_id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2 · GIVE UP…
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ A NAMED PERSON CLOSES A GIVE-UP AND SAYS WHY. 07 §4 rule 8: "Give up… requires a reason."
 * ★★ The reason is refused here AND in the database AND by the table's own CHECK. Three layers for
 *    one rule, deliberately: this one exists so the person reads a sentence rather than a 23514.
 * ★ `actorUserId` comes from the SESSION — `registerWriteRoutes` binds it after the body, so a body
 *   that claimed one cannot override who is signed in. That is what makes `acknowledged_by` mean
 *   something (F511's person half).
 */
export async function giveUpJobFailure(tx, { failureId, reason, repeatCount, lastSeenAt, actorUserId, tenantId }) {
  const id = asFailureId(failureId);
  const version = asVersion({ repeatCount, lastSeenAt });

  if (typeof reason !== "string" || reason.trim() === "") {
    throw invalid("say why you are giving up on this — the reason is kept with the record, and it is " +
                  "what the next person reads when they ask why this stopped.");
  }
  if (!actorUserId) {
    // ★ Not a validation failure: it means the caller has no person attached (the /api/platform/*
    //   console namespace, which admits none). A give-up is acknowledged BY somebody.
    throw forbidden("a give-up is acknowledged by a named person, and this request carries none.");
  }

  const { rows: [row] } = await call(tx,
    `SELECT failure_id, tenant_id, task_identifier, repeat_count
       FROM keystone_meta.acknowledge_job_failure($1, $2::uuid, $3, $4, $5::timestamptz)`,
    [id, actorUserId, reason.trim(), version.repeatCount, version.lastSeenAt]);
  if (!row) throw notFound(`there is no open give-up numbered ${id}`);

  await auditForPractice(tx, { platformTenantId: tenantId, practiceTenantId: row.tenant_id },
    (auditTenantId) => emit(tx, {
      tenantId: auditTenantId,
      topic: "platform.job.given_up",
      emittedBy: "platform",
      // ★ No subject: neither a graphile job nor a ledger row is a record in this product's
      //   vocabulary (SUBJECT_TYPES), and inventing a name for one would be a private vocabulary.
      subjectType: null,
      subjectId: null,
      actor: userActor(actorUserId),
      payload: {
        failure_id: id,
        task_identifier: row.task_identifier,
        repeat_count: row.repeat_count,
      },
    }));

  return {
    ok: true,
    action: "given_up",
    failureId: id,
    taskIdentifier: row.task_identifier,
    tenantId: row.tenant_id,
  };
}
