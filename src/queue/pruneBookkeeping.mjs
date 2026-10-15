// src/queue/pruneBookkeeping.mjs — Stage 4 Task 12. THE DAILY BOOKKEEPING PRUNE (spec 07 §3).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIS IS THE ONLY MODULE IN KEYSTONE WHOSE BUG IS INVISIBLE AFTERWARDS.
//     Every other defect leaves the wrong row sitting there to be found. A wrong WHERE clause here leaves
//     NOTHING — the evidence is the thing that is gone. So every statement below is written twice over: once
//     as what it removes, and once, in the comment above it, as what it must never reach and why.
//
// ★★★ WHAT IS BOOKKEEPING AND WHAT IS HISTORY. Spec 02: keystone.event is the practice's HISTORY and its
//     audit record — it is never pruned, by anything, ever. keystone.notification is what a person was told
//     — also never pruned. What this job removes is the DELIVERY SCOREBOARD kept ALONGSIDE those: which
//     listener has taken which event (event_delivery, 0139 says so in its own header), which webhook attempt
//     got which response (webhook_delivery), which API request already has an answer (idempotency_key), and
//     which background job gave up and was dealt with (keystone_meta.job_failure). None of it is the record
//     of anything that happened to a client.
//   ★★ AND keystone.platform_event IS NOT TOUCHED EITHER, FOR A DIFFERENT REASON: it is THE OPERATOR'S
//      AUDIT TRAIL — what the platform did to a practice, by whose hand. It belongs to nobody's practice,
//      so a per-practice job has no business in it at all, and an audit trail with a retention policy is
//      not an audit trail. No statement below names it, and test/s4_prune_bookkeeping.test.mjs §0 matches
//      it out by name alongside event and notification so a future edit cannot quietly add one.
//
// ★★★ NOTHING HERE CASCADES INTO EITHER. [MEASURED, pg_constraint] no foreign key anywhere in the schema
//     names event_delivery, webhook_delivery, idempotency_key or notification_delivery as its PARENT, so a
//     DELETE from them cannot reach another table. In the other direction event_delivery.event_id is
//     ON DELETE CASCADE and webhook_delivery.event_id is ON DELETE RESTRICT — both point AT the event, and
//     the event is never deleted. keystone.notification.event_id is ON DELETE SET NULL (0016): that clause
//     can only fire if an EVENT is deleted, which this job never does, so a sample notification can never
//     lose its sample-ness here.
//   ★ THE ONE CASCADE THERE IS, AND WHY IT IS RIGHT: keystone_meta.job_failure_repeat.failure_id REFERENCES
//     keystone_meta.job_failure(id) ON DELETE CASCADE (0156, MEASURED). A repeat row is not a second
//     give-up — it is "this job failed the same way again", counted ON the open row. When that row is
//     acknowledged and pruned, its repeats go with it, because they are the same fact. Nothing else in the
//     schema references keystone_meta.job_failure at all (MEASURED, pg_constraint), and keystone.task is
//     NOT reached by job_failure.handed_off_task_id — that is a plain uuid, no foreign key (0158).
//
// ★★ SETTLED, NOT MERELY OLD. Age alone is the wrong filter for all four:
//       · a delivery row whose EVENT is still pending / claimed / failed is a job still owed;
//       · a webhook attempt awaiting its next_retry_at, or dead but not yet REPORTED, is the only place the
//         give-up report can still be read from;
//       · an `in_flight` idempotency key is a request still in progress;
//       · an UNACKNOWLEDGED give-up is counted by the queue check forever (R59) — pruning it would clear an
//         alert nobody ever looked at.
//     Each of those is a positive control in test/s4_prune_bookkeeping.test.mjs, in the same test as its
//     negative, because "0 deleted" and "the right 1 deleted" look identical without the pair.
//
// ★★ THE REFERENCE PRACTICE IS SKIPPED IN THE QUERY, NOT LEFT TO THE GUARD. 0099's
//    refuse_touch_reference_rows() fires AFTER DELETE on idempotency_key, webhook_delivery and
//    notification_delivery (MEASURED, pg_trigger) and RAISES — so leaving the reference practice to the
//    guard would not "protect" it, it would FAIL THE WHOLE RUN every night, for ever, on a practice that is
//    working exactly as designed. Every statement carries `NOT t.is_reference`, and pruneBookkeepingForTenant
//    returns before any of them when the practice is the reference one.
//
// ★ PER PRACTICE, NOT PLATFORM-WIDE — like prune_run_payloads (tasks.mjs:1131), not like sweep_tenants. One
//   practice's failure stops that practice's prune and nothing else: sweep_tenants enqueues one job per
//   practice on that practice's own queue (Task 9), so a practice whose prune throws retries on its own.
import { withTenant } from "../db/index.mjs";
import { nextDailySummaryRunAt, pacificDateKey } from "../health/dailySummary.mjs";

// ★ Spec 07 §3. Changing any of these changes what is destroyed — they are asserted by name in the test.
export const RETENTION = Object.freeze({
  eventDeliveryDays: 30,
  webhookDeliveryDays: 30,
  idempotencyKeyDays: 7,
  jobFailureDays: 30,
  // ★ Task 6 / R66. 24 h, and not less, because src/email/send.mjs:225 will still re-send a body that is
  //   IN DOUBT for IN_DOUBT_RETRY_HOURS = 23 h. A body erased inside that window would turn a retry into
  //   either a second email or a give-up. 24 > 23 by exactly the margin that makes the two disjoint.
  requestBodyHours: 24,
});

// ★ The bound. Five hundred rows is one small statement per table per day per practice; a practice that has
//   somehow accumulated more catches up over the following nights instead of taking a lock for minutes.
export const PRUNE_BATCH = 500;

// ★ 03:00 Pacific — the quietest hour, and well clear of daily_summary's 07:00.
const PRUNE_HOUR = 3;
/** The next 03:00 Pacific strictly after `now` (DST-safe — dailySummary.mjs:92 owns that arithmetic). */
export const nextPruneRunAt = (now = new Date()) => nextDailySummaryRunAt(now, "America/Los_Angeles", PRUNE_HOUR);
/** The Pacific calendar date a run belongs to — the job key rolls over with it, so tomorrow is a new job. */
export const pruneDateKey = (instant = new Date()) => pacificDateKey(instant);

// ★★ EVERY statement takes the practice as $1 and carries `EXISTS (… NOT t.is_reference)`. Under withTenant
//    app_rw sees exactly one row of keystone.tenant — its own (MEASURED) — so that EXISTS is a one-row
//    lookup that is true for every practice except the reference one, for which it is false and the
//    statement matches nothing.
export const PRUNE_STATEMENTS = Object.freeze([
  {
    name: "event_delivery",
    // ★ WHAT IT MUST NEVER REACH: a delivery row whose event is still pending, claimed or failed. Those are
    //   the dispatcher's work queue — the event will be handed to that listener again. Only `processed`
    //   (done) and `dead` (given up on, recorded) are settled. The row's own age is used, not the event's:
    //   a delivery attempted last night against a year-old event is a young row.
    sql: `
      DELETE FROM keystone.event_delivery
       WHERE id IN (
         SELECT d.id
           FROM keystone.event_delivery d
           JOIN keystone.event e ON e.id = d.event_id AND e.tenant_id = d.tenant_id
          WHERE d.tenant_id = $1
            AND d.created_at < now() - make_interval(days => $2)
            AND e.status IN ('processed', 'dead')
            AND EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = $1 AND NOT t.is_reference)
          ORDER BY d.created_at
          LIMIT $3)`,
    params: (tenantId) => [tenantId, RETENTION.eventDeliveryDays, PRUNE_BATCH],
  },
  {
    name: "webhook_delivery",
    // ★★ THE ONLY GROUP-AWARE RULE HERE, AND IT HAS TO BE. A webhook delivery is not one row: it is up to
    //    six ATTEMPTS at one (endpoint, event), and only the LAST of them carries the outcome. A literal
    //    per-row "is this row final?" test keeps five of every six attempts for ever, which is not a
    //    retention policy. So finality is asked of the GROUP:
    //      settled  — some attempt in the group delivered, or was skipped, or was CLOSED (endpoint disabled
    //                 / unsubscribed, 0143), or died AND its give-up was reported;
    //      not owed — no attempt in the group is awaiting a retry, still `attempted` (in flight), or dead
    //                 with gave_up_reported_at unset.
    // ★ dead-but-UNREPORTED is the one that matters most: 0143's gave_up_reported_at is written when the
    //   practice is told. Prune it first and the practice is never told, and there is nothing left to tell
    //   them from.
    sql: `
      DELETE FROM keystone.webhook_delivery
       WHERE id IN (
         SELECT c.id
           FROM keystone.webhook_delivery c
          WHERE c.tenant_id = $1
            AND c.attempted_at < now() - make_interval(days => $2)
            AND EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = $1 AND NOT t.is_reference)
            AND EXISTS (
              SELECT 1 FROM keystone.webhook_delivery s
               WHERE s.tenant_id = c.tenant_id AND s.endpoint_id = c.endpoint_id AND s.event_id = c.event_id
                 AND (s.status IN ('delivered', 'skipped')
                      OR s.closed_reason IS NOT NULL
                      OR (s.dead_at IS NOT NULL AND s.gave_up_reported_at IS NOT NULL)))
            AND NOT EXISTS (
              SELECT 1 FROM keystone.webhook_delivery o
               WHERE o.tenant_id = c.tenant_id AND o.endpoint_id = c.endpoint_id AND o.event_id = c.event_id
                 AND (o.next_retry_at IS NOT NULL
                      OR o.status = 'attempted'
                      OR (o.dead_at IS NOT NULL AND o.gave_up_reported_at IS NULL)))
          ORDER BY c.attempted_at
          LIMIT $3)`,
    params: (tenantId) => [tenantId, RETENTION.webhookDeliveryDays, PRUNE_BATCH],
  },
  {
    name: "idempotency_key",
    // ★ WHAT IT MUST NEVER REACH: an `in_flight` key. That is a request STILL RUNNING; delete its key and a
    //   client's retry stops being a replay and becomes a second charge, a second booking, a second anything.
    //   completed_at is the age used — it is the answer that is being retained, not the attempt.
    sql: `
      DELETE FROM keystone.idempotency_key
       WHERE (tenant_id, key) IN (
         SELECT c.tenant_id, c.key
           FROM keystone.idempotency_key c
          WHERE c.tenant_id = $1
            AND c.state IN ('succeeded', 'failed')
            AND c.completed_at IS NOT NULL
            AND c.completed_at < now() - make_interval(days => $2)
            AND EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = $1 AND NOT t.is_reference)
          ORDER BY c.completed_at
          LIMIT $3)`,
    params: (tenantId) => [tenantId, RETENTION.idempotencyKeyDays, PRUNE_BATCH],
  },
  {
    name: "notification_delivery_request_body",
    // ★★ TASK 6 / R66 — THIS ONE DELETES NOTHING. notification_delivery.request_body (0153) is the exact
    //    JSON handed to Resend, kept ONLY so an in-doubt send can be repeated byte-identically under the
    //    same Idempotency-Key. It is the person's own email, in full, sitting in a table — so it is erased
    //    as soon as it can no longer be needed, and the ROW stays: the delivery record, its status, its
    //    provider id and its first_attempted_at are all History.
    // ★ `attempted` is excluded by name: that is a send IN FLIGHT or IN DOUBT, the one case the body exists
    //   for. 0155 relaxed the shape CHECK to one-directional (`request_body IS NULL OR first_attempted_at
    //   IS NOT NULL`) precisely so this UPDATE is legal — the anchor outlives the body.
    sql: `
      UPDATE keystone.notification_delivery
         SET request_body = NULL
       WHERE id IN (
         SELECT c.id
           FROM keystone.notification_delivery c
          WHERE c.tenant_id = $1
            AND c.request_body IS NOT NULL
            AND c.status IN ('sent', 'delivered', 'failed', 'skipped')
            AND c.first_attempted_at IS NOT NULL
            AND c.first_attempted_at < now() - make_interval(hours => $2)
            AND EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = $1 AND NOT t.is_reference)
          ORDER BY c.first_attempted_at
          LIMIT $3)`,
    params: (tenantId) => [tenantId, RETENTION.requestBodyHours, PRUNE_BATCH],
  },
]);

/**
 * ★★ ONE PRACTICE'S BOOKKEEPING. Returns { skipped } for the reference practice, otherwise
 *    { pruned: { <table>: n }, requestBodiesCleared: n }.
 *
 * ★ TWO CONNECTIONS, BECAUSE TWO IDENTITIES OWN THE TWO HALVES:
 *     · the four keystone.* statements run as app_rw inside withTenant — tenant-scoped by RLS as well as by
 *       the predicate, which is the belt and the braces;
 *     · keystone_meta.job_failure has NO table grants for any application role, by design (0145). It is
 *       pruned through keystone_meta.prune_acknowledged_job_failures() (0159) on the worker's own
 *       connection, the only role that may execute it.
 * ★ The reference check is ONE read, made first, as app_rw: app_owner — which owns the 0159 definer — sees
 *   ZERO rows of keystone.tenant under FORCE RLS and holds no USAGE on keystone_auth (both MEASURED), so
 *   `NOT t.is_reference` could not be written truthfully inside that function. It is enforced here instead,
 *   before anything runs, and repeated inside all four statements that CAN carry it.
 */
export async function pruneBookkeepingForTenant(tenantId, { workerClient } = {}) {
  const pruned = {};
  let requestBodiesCleared = 0;

  const isReference = await withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT is_reference FROM keystone.tenant WHERE id = $1`, [tenantId]);
    if (!rows.length) {
      // ★ Not a guess: withTenant's GUC is set, so app_rw sees its own practice row or the practice is gone.
      throw new Error(`prune_bookkeeping: practice ${tenantId} is not visible to app_rw — refusing to prune`);
    }
    return rows[0].is_reference === true;
  });
  if (isReference) return { skipped: "reference practice", pruned, requestBodiesCleared };

  await withTenant(tenantId, async (tx) => {
    for (const s of PRUNE_STATEMENTS) {
      const r = await tx.query(s.sql, s.params(tenantId));
      if (s.name === "notification_delivery_request_body") requestBodiesCleared = r.rowCount;
      else pruned[s.name] = r.rowCount;
    }
  });

  if (workerClient) {
    const { rows } = await workerClient.query(
      `SELECT keystone_meta.prune_acknowledged_job_failures($1::uuid, $2::int, $3::int) AS n`,
      [tenantId, RETENTION.jobFailureDays, PRUNE_BATCH]);
    pruned.job_failure = rows[0].n;
  }

  return { pruned, requestBodiesCleared };
}
