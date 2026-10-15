// @ts-check
/**
 * RUN SCHEDULE — P20.6 (cadence) and P20.6b (P18.6(d)'s SOURCE-OF-TRUTH half, moved from Phase 18).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ P18.6(d) HAS TWO HALVES AND ONLY ONE WAS BUILDABLE IN PHASE 18:
 *       · the PROHIBITION — never graphile's static crontab. Done then, and guarded permanently by
 *         `db/gates/p18_no_static_cron.mjs`.
 *       · the SOURCE OF TRUTH — cadence lives in `run_schedule_item`, a TABLE, read every sweep.
 *         **BLOCKED in Phase 18 because the table did not exist.** 0057 created it; this module is
 *         that half, and P20.6b is where the move was recorded.
 *
 * ★★★ WHY A TABLE AND NOT A CRONTAB, RESTATED SO NOBODY "SIMPLIFIES" IT BACK: §D5 ruling 3 — *"graphile's
 *     cron is STATIC and cannot express a job set that changes"*. A crontab is parsed ONCE at runner
 *     construction. The moment cadence lives in one, adding an account, changing a cadence, or pausing
 *     a service requires a DEPLOY — and worse, the running worker keeps the old schedule until it is
 *     restarted, so the database and the behaviour disagree with nothing to reconcile them.
 *   ★ Here the schedule is data: `dueItems()` asks the table on every sweep, so a cadence change takes
 *     effect on the next sweep with no deploy and no restart.
 *
 * ★★ AND `next_run_at` IS WHY THIS WORKS AT ALL. ADD3-2 had only `last_run_at`, from which you cannot
 *    schedule: change a cadence and every item keeps the old rhythm until it next fires, and a worker
 *    outage makes "overdue" unqueryable. 0057 added the column; `advanceSchedule()` is the only writer.
 */

import { itemObjection } from "./catalogue.mjs";
import { classifyRunFact, RUN_FACTS } from "./blocked.mjs";
import { emit } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** ★ The cadences 0057's CHECK permits, with their intervals. ONE place, so the table's closed set and
 *    the arithmetic cannot drift — a cadence the CHECK allows but this map does not know would throw
 *    rather than silently never advance. */
export const CADENCE_INTERVALS = Object.freeze({
  hourly: "1 hour",
  daily: "1 day",
  weekly: "7 days",
  monthly: "1 month",
  quarterly: "3 months",
});

/**
 * ★★★ THE FIVE NOT-DELIVERABLE / HEALTH STATES, AND WHY THERE ARE THREE FLAVOURS OF BLOCKED (P20.9a).
 *     "We never had access", "Google stopped accepting the token" and "the property was removed" need
 *     THREE DIFFERENT HUMAN ACTIONS — ask the client for access, ask them to re-consent, find out what
 *     happened to the property. One boolean, or one `blocked` state, would make the screen say
 *     "something is wrong" and leave an operator to guess. That IS the screen lying.
 */
export const SCHEDULE_STATES = Object.freeze([
  "pending", "healthy", "degraded",
  "not_deliverable_no_grant", "not_deliverable_grant_lost", "not_deliverable_resource_lost",
  "paused",
]);

/**
 * ★★ HOW MANY CONSECUTIVE FAILURES BEFORE `healthy` BECOMES `degraded`, AND `degraded` BECOMES A REAL
 *    LOSS. P20.6's own note: *"`degraded` exists so ONE 503 cannot flip an account to
 *    not-deliverable. A checker that cries wolf is worse than none."*
 *  ★ Exported so the gate asserts against the SAME numbers the code uses.
 */
export const DEGRADE_AFTER = 1;    // the first failure degrades — visible, but not alarming
export const LOSE_AFTER = 3;       // three in a row is no longer weather

/**
 * CREATE a schedule item — put one service+item for one account ON the clock.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ THIS FUNCTION EXISTS BECAUSE `write-census` DEMANDED IT, AND THE FINDING WAS REAL.
 *     [EXECUTED 2026-09-14] After P20.6 wired `advanceSchedule` and `markNoGrant`, the census said:
 *
 *         ✗ keystone.run_schedule_item is UPDATED somewhere but NEVER INSERTED in src/ — so no row
 *           can exist for that UPDATE to find.
 *
 *     Exactly right, and it is the subtler half of "a table nothing writes is a feature that cannot
 *     happen": a table nothing INSERTS is a feature that cannot START. Every piece of the cadence
 *     machinery was built and tested, and there was no way to put the first item on the schedule — the
 *     gate fixtures inserted directly, which is precisely how that gap stays invisible.
 *
 * ★★ `next_run_at` DEFAULTS TO `now()`, SO A NEW ITEM IS DUE IMMEDIATELY. Deliberate: the alternative
 *    is a new account sitting idle for up to a quarter before its first pull, and the operator who set
 *    it up has no way to tell that from a broken scheduler. One immediate pull also surfaces a missing
 *    grant straight away rather than at the end of the first cadence period.
 *
 * ★ IDEMPOTENT on 0057's UNIQUE (tenant_id, account_id, service, item). Re-running setup for an account
 *   must not duplicate its schedule, and `DO UPDATE` on the cadence lets setup CHANGE a cadence — which
 *   is the same operation P20.6b proves takes effect on the next sweep with no deploy.
 *   ★★ It does NOT reset `state` or `consecutive_failures`: re-running setup is not a reason to forget
 *      that an account has no grant. Clearing those would hide a not-deliverable item from the screen
 *      exactly when somebody is looking at the account.
 */
export async function createScheduleItem(tx, {
  tenantId, accountId, service, item, cadence, mechanism = "api", lineItemId = null,
}) {
  if (!tenantId) throw new Error("createScheduleItem needs a tenantId");
  if (!accountId) throw new Error("createScheduleItem needs an accountId");
  if (!CADENCE_INTERVALS[cadence]) {
    throw new Error(
      `createScheduleItem: cadence "${cadence}" is not one of ${Object.keys(CADENCE_INTERVALS).join(" · ")}`);
  }
  if (!item || !/^[a-z][a-z0-9_]*$/.test(item)) {
    throw new Error(`createScheduleItem: item must match ^[a-z][a-z0-9_]*$ — got ${JSON.stringify(item)}`);
  }
  // ★★★ P20.7a / P20.7b ARE ENFORCED HERE, WHICH IS WHAT MAKES THEM DECISIONS RATHER THAN INTENTIONS.
  //     A cut write item (negatives · posts · review_replies · hours) and an unbuildable one
  //     (index_coverage) cannot be put on the clock at all. ★ P20.7a's own warning is *"do not leave the
  //     nouns in the service list with nothing behind them — that is the §M2 'emits into nothing'
  //     failure repeating"*; refusing at the creator is how the noun stops being available to leave.
  const objection = itemObjection(service, item);
  if (objection) {
    throw new Error(
      `createScheduleItem refuses ${service}/${item} — ${objection.kind.toUpperCase()}. ${objection.reason}` +
      (objection.replacement ? ` ★ Use "${objection.replacement}" instead.` : ""));
  }
  const { rows } = await tx.query(
    `INSERT INTO keystone.run_schedule_item
       (tenant_id, account_id, service, item, cadence, mechanism, line_item_id, next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (tenant_id, account_id, service, item) DO UPDATE
        SET cadence = EXCLUDED.cadence,
            mechanism = EXCLUDED.mechanism,
            line_item_id = COALESCE(EXCLUDED.line_item_id, keystone.run_schedule_item.line_item_id)
     RETURNING id, state, cadence, next_run_at, (xmax = 0) AS was_insert`,
    [tenantId, accountId, service, item, cadence, mechanism, lineItemId]);
  return Object.freeze({
    id: rows[0].id, state: rows[0].state, cadence: rows[0].cadence,
    nextRunAt: rows[0].next_run_at, created: rows[0].was_insert,
  });
}

/**
 * RE-ARM the blocked items for an account+service — put them back on the clock.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ THIS FUNCTION EXISTS BECAUSE P20.9's GATE FOUND A REAL GAP, AND IT IS A LOOP THAT DID NOT CLOSE.
 *     `dueItems()` deliberately EXCLUDES the three not_deliverable states — P20.6 asserts that, because
 *     re-attempting an item that cannot be delivered writes an identical failure row every sweep and
 *     fills the screen with noise. Correct on its own.
 *   ★★ BUT IT MEANS A BLOCKED ITEM IS NEVER RETRIED, SO IT CAN NEVER RECOVER. `run.access.granted` is
 *      emitted BY a successful pull, so it cannot be what CAUSES one. [EXECUTED 2026-09-14] the gate's
 *      recovery leg proved it: the grant was fixed, and nothing ever looked again. Without this,
 *      every recovery in the product would require somebody to edit the database by hand.
 *
 * ★★★ SO THE TRIGGER IS THE **GRANT WRITE**, NOT A TIMER. A client re-consenting (`upsertGoogleIdentity`)
 *     or a property being re-sighted (`recordDiscoveredResources`) is the moment the world changed, and
 *     it is a moment we already handle. Re-arming there is precise: no polling, no guessing, and the
 *     item is retried exactly once per real change.
 *
 * ★★ IT MOVES THEM TO `pending`, NOT to `healthy`. The item has not been proven to work — it has been
 *    given another chance. `pending` is the state a new item starts in, and it is the honest one here:
 *    the next pull decides. Setting `healthy` would show a green account that has read nothing.
 *  ★ `blocked_reason` and `not_deliverable_since` are cleared because `run_schedule_item_blocked_shape`
 *    requires them to be NULL off the not_deliverable states — the constraint keeps this honest.
 */
export async function rearmBlockedItems(tx, { tenantId, accountId = null, service = null }) {
  if (!tenantId) throw new Error("rearmBlockedItems needs a tenantId");
  const { rows } = await tx.query(
    `UPDATE keystone.run_schedule_item
        SET state = 'pending',
            blocked_reason = NULL,
            not_deliverable_since = NULL,
            consecutive_failures = 0,
            next_run_at = now()
      WHERE tenant_id = $1
        AND state LIKE 'not_deliverable%'
        AND ($2::uuid IS NULL OR account_id = $2)
        AND ($3::text IS NULL OR service = $3)
      RETURNING id, service, item`,
    [tenantId, accountId, service]);
  return Object.freeze({ rearmed: rows.length, items: rows });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P8.9 — `paused` WAS A STATE NOTHING COULD SET, ON A TABLE BUILT AROUND IT.
//     [MEASURED 2026-09-15] the string `'paused'` appeared in exactly two places for this table: in
//     `SCHEDULE_STATES` above, and in `dueItems`'s comment explaining that paused items are skipped.
//     **Zero writers.** The sweep was carefully built to honour a state that could not exist.
//   ★★ AND IT IS NOT THE SAME AS not-deliverable, which is why the state exists separately. The
//      three `not_deliverable_*` states mean *we cannot*; `paused` means *we chose not to* — the
//      client is away, the engagement is on hold, the account is in dispute. Collapsing them would
//      make a deliberate hold look like a broken integration on every screen that shows it, and
//      `rearmBlockedItems` would silently resume something a person switched off on purpose.
//    ★ Which is exactly why `resumeScheduleItems` below is a SEPARATE function from
//      `rearmBlockedItems`, and why `rearmBlockedItems`'s `state LIKE 'not_deliverable%'` predicate
//      is load-bearing: a re-consent must never un-pause.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * PAUSE one account's schedule, or one service within it. A deliberate hold.
 *
 * ★★ `next_run_at` IS LEFT WHERE IT IS. On resume the item is due immediately anyway (see below), and
 *    keeping the old value means the row still records when it WOULD have run — which is the
 *    question somebody asks when they come back to a pause they set three weeks ago.
 * ★ Only live states can be paused. Pausing a not-deliverable item would overwrite the reason it
 *   cannot be delivered with a reason somebody chose, and `run_schedule_item_blocked_shape` requires
 *   `blocked_reason` to be NULL off those states — so the constraint would refuse it anyway. Refusing
 *   here says which of the two happened.
 */
export async function pauseScheduleItems(tx, { tenantId, accountId = null, service = null }) {
  if (!tenantId) throw new Error("pauseScheduleItems needs a tenantId");
  const { rows } = await tx.query(
    `UPDATE keystone.run_schedule_item
        SET state = 'paused'
      WHERE tenant_id = $1
        AND state IN ('pending','healthy','degraded')
        AND ($2::uuid IS NULL OR account_id = $2)
        AND ($3::text IS NULL OR service = $3)
      RETURNING id, service, item`,
    [tenantId, accountId, service]);
  return Object.freeze({ paused: rows.length, items: rows });
}

/**
 * RESUME a paused schedule. The inverse, and ONLY of a pause.
 *
 * ★★ IT RESUMES TO `pending` AND MAKES THE ITEM DUE NOW, for the same reason `createScheduleItem`
 *    starts a new item due immediately: an operator who has just switched something back on has no
 *    way to tell "waiting for the next monthly slot" from "still broken", and the first pull is what
 *    answers that. ★ `pending`, never `healthy` — nothing has been proven to work yet.
 * ★★★ `state = 'paused'` IN THE PREDICATE IS THE WHOLE SAFETY PROPERTY. Without it this becomes a
 *     general "turn everything back on", including the not-deliverable items whose reason nobody has
 *     addressed — which would attempt a pull with no grant, write a failure row, and put the account
 *     straight back where it was, every cadence, forever.
 */
export async function resumeScheduleItems(tx, { tenantId, accountId = null, service = null }) {
  if (!tenantId) throw new Error("resumeScheduleItems needs a tenantId");
  const { rows } = await tx.query(
    `UPDATE keystone.run_schedule_item
        SET state = 'pending', next_run_at = now()
      WHERE tenant_id = $1
        AND state = 'paused'
        AND ($2::uuid IS NULL OR account_id = $2)
        AND ($3::text IS NULL OR service = $3)
      RETURNING id, service, item`,
    [tenantId, accountId, service]);
  return Object.freeze({ resumed: rows.length, items: rows });
}

/**
 * DUE ITEMS — the query that replaces a crontab.
 *
 * ★★ `FOR UPDATE SKIP LOCKED`, the same shape as `claim_events`. Two sweeps overlapping (a slow tenant,
 *    a retried sweep) must not both enqueue the same item; SKIP LOCKED makes the second sweep simply
 *    not see it rather than block behind it.
 *  ★ `paused` and the three not_deliverable states are excluded by the index's own predicate — an item
 *    that cannot be delivered must not keep being attempted, because every attempt writes a failure row
 *    and the screen fills with noise that says nothing new.
 */
export async function dueItems(tx, { tenantId, limit = 100 } = {}) {
  if (!tenantId) throw new Error("dueItems needs a tenantId");
  const { rows } = await tx.query(
    `SELECT i.id, i.account_id, i.service, i.item, i.cadence, i.mechanism, i.state,
            i.consecutive_failures, i.next_run_at, i.last_ok_reading_id
       FROM keystone.run_schedule_item i
      WHERE i.tenant_id = $1
        AND i.state IN ('pending','healthy','degraded')
        AND i.next_run_at <= now()
      ORDER BY i.next_run_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [tenantId, limit]);
  return rows;
}

/**
 * ADVANCE the clock after an attempt, and move the state machine.
 *
 * ★★★ `next_run_at` IS COMPUTED FROM `now()`, NOT FROM THE OLD `next_run_at`. That is a decision with a
 *     consequence either way, so it is recorded: adding the interval to the OLD value means an item
 *     that was overdue by a week fires seven times in a row catching up. For a daily Search Console
 *     pull that is seven identical requests against a quota, producing seven rows that say the same
 *     thing. ★ The cost of `now()` is that a genuine gap leaves no rows for the missed days — which is
 *     visible as a gap in `run_metric` and is the honest representation of "we were down".
 *
 * ★★ A FAILURE STILL ADVANCES THE CLOCK. If it did not, a failing item would be re-attempted on every
 *    sweep forever, writing a failure row each time — the queue equivalent of a hot loop, and the
 *    reason `consecutive_failures` would become meaningless (it would count sweeps, not days).
 */
export async function advanceSchedule(tx, { tenantId, itemId, ok, failureClass = null, readingId = null }) {
  if (!tenantId) throw new Error("advanceSchedule needs a tenantId");
  if (!itemId) throw new Error("advanceSchedule needs an itemId");

  const cur = (await run(tx, db
    .selectFrom("keystone.run_schedule_item")
    .select(["cadence", "state", "consecutive_failures", "service"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", itemId))).rows[0];
  if (!cur) throw new Error(`advanceSchedule: no schedule item ${itemId} visible in this tenant`);

  const interval = CADENCE_INTERVALS[cur.cadence];
  if (!interval) {
    throw new Error(
      `advanceSchedule: cadence "${cur.cadence}" has no interval in CADENCE_INTERVALS. ★ The database ` +
      `CHECK allows it, so this is a drift between the closed set and the arithmetic — and the silent ` +
      `version of this bug is an item that never advances and is attempted on every sweep forever.`);
  }

  let state, blockedReason = null, failures;
  if (ok) {
    // ★ A success RESETS the counter. "Consecutive" is the whole point (0057's comment): a total would
    //   make an item that failed twice a year ago look the same as one failing right now.
    state = "healthy"; failures = 0;
  } else {
    failures = cur.consecutive_failures + 1;
    if (failureClass === "grant_unusable" && failures >= LOSE_AFTER) {
      state = "not_deliverable_grant_lost";
      blockedReason = `Google refused the token on ${failures} consecutive attempts`;
    } else if (failureClass === "resource_forbidden" && failures >= LOSE_AFTER) {
      state = "not_deliverable_resource_lost";
      blockedReason = `the resource returned forbidden on ${failures} consecutive attempts`;
    } else {
      // ★★ EVERYTHING ELSE DEGRADES AND STAYS DEGRADED. rate_limited, quota_exhausted, provider_error
      //    and internal are WEATHER — they are not evidence that access was lost, and promoting them
      //    to not_deliverable would tell an operator to go and ask a client for permissions they
      //    already granted. A checker that cries wolf is worse than none.
      state = failures >= DEGRADE_AFTER ? "degraded" : cur.state;
    }
  }

  // ★★★ P20.9 — THE TRANSITION IS WHAT DESERVES AN EVENT, NOT THE MEASUREMENT. `was` is captured
  //     BEFORE the update so the emit below fires only on a CHANGE: an item that is already
  //     not_deliverable must not re-emit on every sweep, or `chase_the_grant` would be opened, closed
  //     by nothing, and re-opened forever. (task_open_key would dedupe the task, but the outbox would
  //     still fill with identical events, and the activity feed is the same table.)
  const was = cur.state;

  const { rows } = await tx.query(
    `UPDATE keystone.run_schedule_item
        SET last_run_at = now(),
            next_run_at = now() + $3::interval,
            state = $4,
            blocked_reason = $5,
            not_deliverable_since = CASE
              WHEN $4 LIKE 'not_deliverable%' THEN COALESCE(not_deliverable_since, now())
              ELSE NULL END,
            consecutive_failures = $6,
            last_ok_reading_id = COALESCE($7, last_ok_reading_id)
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, state, consecutive_failures, next_run_at, not_deliverable_since`,
    [tenantId, itemId, interval, state, blockedReason, failures, ok ? readingId : null]);

  await emitBlockedTransition(tx, {
    tenantId, itemId, wasState: was, nowState: rows[0].state,
    service: cur.service, failureClass, consecutiveFailures: failures, loseAfter: LOSE_AFTER });

  // ★ `last_ok_reading_id` is COALESCEd, never cleared on failure — it is what P20.8 degrades TO. A
  //   failure that wiped it would take the last good data off the screen at the moment it is needed.
  return Object.freeze({
    state: rows[0].state,
    consecutiveFailures: rows[0].consecutive_failures,
    nextRunAt: rows[0].next_run_at,
    notDeliverableSince: rows[0].not_deliverable_since,
  });
}


/**
 * ★★★ P20.9's EVENT PAIR — `run.item.blocked` when an item becomes not-deliverable, and
 *     `run.access.granted` when it recovers. These are the two topics 0054 added for exactly this, and
 *     they are what P20.3's `chase_the_grant` chain opens and closes on.
 *
 * ★★ IT FIRES ONLY ON A TRANSITION. An item already not_deliverable must not re-emit every sweep:
 *    `task_open_key` would dedupe the TASK, but the outbox would fill with identical events and
 *    `keystone.event` is also the record's activity feed (D-15.4) and the audit log (P19.9).
 *
 * ★★★ AND THE PAYLOAD CARRIES `task_title` — THE FACT'S OWN WORDS. This is the only place that knows
 *     which of the five facts applied, so it is the only place that can name the action. A chain with
 *     one fixed title for three different causes is the screen lying (P20.9a).
 *
 * ★ BILLING IS NOT TOUCHED HERE, AND THAT IS THE POINT OF P20.9: *"Billing does not pause."* The item
 *   keeps its `line_item_id`; what changes is that the work is now known to be undeliverable, and a
 *   human has a task naming the action.
 */
async function emitBlockedTransition(tx, {
  tenantId, itemId, wasState, nowState, service, failureClass, consecutiveFailures, loseAfter,
}) {
  const wasBlocked = String(wasState).startsWith("not_deliverable");
  const nowBlocked = String(nowState).startsWith("not_deliverable");

  // ★★★ RECOVERY IS DISCRIMINATED BY THE **OPEN TASK**, NOT BY THE PREVIOUS STATE — AND THAT IS A FIX.
  //     [EXECUTED 2026-09-14] The state-history version could not work, and the gate proved it:
  //     `rearmBlockedItems` legitimately moves a blocked item to `pending` (it has been given another
  //     chance, not proven to work), which ERASES the fact that it was blocked. The next successful pull
  //     is then `pending → healthy` — indistinguishable from a brand-new item's first success.
  //   ★★ THE OPEN TASK IS THE HONEST DISCRIMINATOR. `chase_the_grant` exists if and only if this item
  //      was blocked and nobody has resolved it, so "a success while that task is open" IS the recovery.
  //      It cannot fire spuriously: a new item has no task. And it needs no sixth state.
  //   ★ It also answers the semantic question correctly. The task says "ask the client to re-connect";
  //     that is done when the access WORKS again, not when we merely decided to try once more.
  if (!nowBlocked) {
    const open = await run(tx, db
      .selectFrom("keystone.task")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("subject_type", "=", "run_schedule_item")
      .where("subject_id", "=", itemId)
      .where("topic", "=", "run.item.blocked")
      .where("closed_at", "is", null)
      .limit(1));
    if (open.rows.length === 0) return { emitted: null };
    await emit(tx, {
      tenantId, topic: "run.access.granted", emittedBy: "run",
      subjectType: "run_schedule_item", subjectId: itemId,
      // ★ STAGE 3 TASK 1 — reached only from the run-schedule sweep (`queue/tasks.mjs`), never from
      //   a request with a session.
      actor: "worker",
      payload: { service, state: nowState, recovered_from: wasState },
    });
    return { emitted: "run.access.granted" };
  }

  if (wasBlocked) return { emitted: null };   // ★ already blocked; do not re-emit every sweep

  {
    // ★ The fact is derived from the STATE the machine just reached, so the task text and the state
    //   cannot disagree — they come from one table (RUN_FACTS) keyed by the same string.
    const fact = factForState(nowState);
    // ★★★ STAGE 3 TASK 3 — `task_title` AND `screen_text` DROPPED. Both are free-text sentences
    //   (`RUN_FACTS` in `src/run/blocked.mjs` — "Ask the client to re-connect (re-consent) this
    //   account", "the property is gone — the authorisation still works…"), exactly the shape §12's
    //   payload lint refuses. `fact` (the enum KEY, e.g. "grant_lost") already carries the same
    //   information losslessly: `chase_the_grant` (`src/tasks/chains.mjs`) now looks the words up
    //   from `RUN_FACTS[fact]` itself rather than trusting a copy frozen into the event — the two
    //   can never disagree, because there is only one place the words live.
    await emit(tx, {
      tenantId, topic: "run.item.blocked", emittedBy: "run",
      subjectType: "run_schedule_item", subjectId: itemId,
      // ★ STAGE 3 TASK 1 — see the note on emitBlockedTransition's other emit, above.
      actor: "worker",
      payload: {
        service, state: nowState, fact: fact?.key ?? null,
        failure_class: failureClass ?? null,
        consecutive_failures: consecutiveFailures,
        // ★★ RECORDED ON THE EVENT so the audit trail answers "why did we stop delivering this" without
        //    needing the row's current state, which will have moved on.
        billing_continues: true,
      },
    });
    return { emitted: "run.item.blocked", fact: fact?.key ?? null };
  }
}

/** ★ state → fact, so the task text and the state can never disagree: both come from RUN_FACTS. */
function factForState(state) {
  const found = Object.entries(RUN_FACTS).find(([, v]) => v.state === state);
  return found ? { key: found[0], ...found[1] } : null;
}

/**
 * MARK an item not deliverable because THERE IS NO GRANT AT ALL — the P20.9 case.
 *
 * ★★★ THIS IS A DIFFERENT FACT FROM THE OTHER TWO AND IT IS DETECTED DIFFERENTLY. `grant_lost` and
 *     `resource_lost` are concluded from repeated FAILED ATTEMPTS. `no_grant` is concluded from the
 *     ABSENCE OF A BINDING — there is nothing to attempt, so there will never be a failure row to
 *     count. An item in this state has no `account_grant` row, so the pull cannot even be constructed.
 *   ★★ AND BILLING DOES NOT PAUSE. P20.9: the item stays billed and becomes not deliverable, which is
 *      exactly why `line_item_id` and `blocking_task_id` exist on the row — without them
 *      "billed and not deliverable" is a word on a screen that nothing can act on.
 */
export async function markNoGrant(tx, { tenantId, itemId, blockingTaskId = null }) {
  if (!tenantId) throw new Error("markNoGrant needs a tenantId");
  const before = (await run(tx, db
    .selectFrom("keystone.run_schedule_item")
    .select(["state", "service"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", itemId))).rows[0];
  const prevState = before?.state ?? null;
  const svc = before?.service ?? null;
  const { rows } = await tx.query(
    `UPDATE keystone.run_schedule_item
        SET state = 'not_deliverable_no_grant',
            blocked_reason = 'no live account_grant for this account and service',
            not_deliverable_since = COALESCE(not_deliverable_since, now()),
            blocking_task_id = COALESCE($3, blocking_task_id)
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, state, not_deliverable_since, blocking_task_id, line_item_id`,
    [tenantId, itemId, blockingTaskId]);
  if (!rows[0]) return null;

  // ★★★ `never_granted` IS REACHED ONLY HERE, so the emit has to be here too. It is concluded from the
  //     ABSENCE of a binding — there is nothing to attempt, so `advanceSchedule` will never see a
  //     failure for it and its transition would otherwise be silent.
  //   ★ `was` is read from the caller's perspective: markNoGrant is idempotent and the sweep calls it
  //     every time, so the emit is suppressed unless the state actually changed.
  if (prevState !== "not_deliverable_no_grant") {
    const fact = factForState("not_deliverable_no_grant");
    // ★ STAGE 3 TASK 3 — `task_title`/`screen_text` DROPPED, same reasoning as
    //   `emitBlockedTransition` above: `fact.key` already carries it losslessly.
    await emit(tx, {
      tenantId, topic: "run.item.blocked", emittedBy: "run",
      subjectType: "run_schedule_item", subjectId: itemId,
      // ★ STAGE 3 TASK 1 — `markNoGrant` is reached only from the run-schedule sweep.
      actor: "worker",
      payload: {
        service: svc, state: "not_deliverable_no_grant", fact: fact.key,
        failure_class: null, consecutive_failures: 0, billing_continues: true,
      },
    });
  }
  return rows[0];
}

/**
 * RESOLVE the grant for one schedule item — the query that decides whether work can happen at all.
 *
 * ★★★ IT REQUIRES ALL THREE FACTS TO BE GOOD AT ONCE, and returns WHICH ONE FAILED. That is the whole
 *     point of P20.5's three tables: a live binding, an identity Google still accepts, and a resource
 *     that still exists. Any one of them being wrong blocks the work, and each one means something
 *     different to the person who has to fix it.
 */
export async function resolveGrant(tx, { tenantId, accountId, service }) {
  const { rows } = await tx.query(
    `SELECT g.id AS grant_id, r.id AS resource_id, r.external_id, r.login_customer_id,
            r.parent_account_id, r.disappeared_at,
            i.id AS identity_id, i.grant_state
       FROM keystone.account_grant g
       JOIN keystone.google_resource r ON r.id = g.resource_id
       JOIN keystone.google_identity i ON i.id = r.identity_id
      WHERE g.tenant_id = $1 AND g.account_id = $2 AND g.service = $3
        AND g.revoked_at IS NULL
      ORDER BY g.granted_at DESC
      LIMIT 1`,
    [tenantId, accountId, service]);

  const row = rows[0];
  if (!row) return Object.freeze({ usable: false, because: "no_grant", detail: null });
  if (row.grant_state !== "usable") {
    // ★★★ `resourceId` IS RETURNED EVEN THOUGH THE GRANT IS UNUSABLE, AND THAT IS A FIX, NOT A
    //     CONVENIENCE. [EXECUTED 2026-09-14] without it `run_pull` called `recordReading` with a null
    //     resourceId and the module refused — so **a failed pull for an unusable grant could not be
    //     recorded at all**, which breaks P20.6's central rule ("a missing row and a failed row are
    //     different facts") at precisely the moment it matters most: the screen would show nothing for
    //     an account whose authorisation had died, indistinguishable from one nobody had scheduled.
    //   ★★ And the resource IS known here: the binding exists and points at it. What is broken is the
    //     IDENTITY, not our knowledge of which property we were going to read. Returning null conflated
    //     "we do not know the resource" with "we cannot use it".
    return Object.freeze({ usable: false, because: "grant_unusable", detail: row.grant_state,
                           identityId: row.identity_id, resourceId: row.resource_id });
  }
  if (row.disappeared_at) {
    // ★ Same reasoning: the resource row still EXISTS in our tables (marked disappeared), so the
    //   reading can be attributed to it. `run_reading.resource_id` is ON DELETE RESTRICT precisely so
    //   the evidence that we once read it survives.
    return Object.freeze({ usable: false, because: "resource_lost",
                           detail: row.disappeared_at, resourceId: row.resource_id,
                           identityId: row.identity_id });
  }
  return Object.freeze({
    usable: true, because: null,
    grantId: row.grant_id, resourceId: row.resource_id, identityId: row.identity_id,
    externalId: row.external_id, loginCustomerId: row.login_customer_id,
    parentAccountId: row.parent_account_id,
  });
}
