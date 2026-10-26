// @ts-check
// P8.8 — THE DUE REGISTRY. TIME BECOMES A FACT HERE, AND NOWHERE ELSE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT WAS ACTUALLY MISSING, MEASURED RATHER THAN ASSUMED. [MEASURED 2026-09-15] the only
//     recurring trigger in the whole system is ONE `setInterval` in `src/queue/runner.mjs:211`
//     enqueueing `sweep_tenants` every 60s, which fans out to four per-tenant jobs. Every one of
//     those four is about the SYSTEM — the outbox, orphan tasks, the Run cadence, payload pruning.
//     **Not one of them is about a fact in the product going out of date.** So: an entitlement could
//     expire and nobody was told, an invoice could pass its date and nothing happened, a signature
//     request could sit for a year, and `rate_limit_window` grew forever.
//
// ★★★ AND IT IS NOT A SECOND SCHEDULE TABLE, DELIBERATELY. `run_schedule_item` is the existing
//     cadence model and P8.8 calls it "the generalisable piece" — but generalising it wrongly would
//     have meant a table of rows saying "check document X on date Y", **next to a
//     `document_instance.expires_at` that already says the same thing.** That is DUPLICATE-TRUTH,
//     this project's most expensive recurring class (`F75` two credit systems, `F76` two prices —
//     the latter retired one item ago), and the two copies would drift the first time a deadline
//     moved.
//   ★★ THE DISTINCTION IS WHETHER THE FACT CARRIES ITS OWN MOMENT. "Pull this account's Google
//      Analytics monthly" has no natural timestamp anywhere — the schedule IS the fact, so it needs
//      `run_schedule_item`. "This entitlement expires on the 14th" is already written on the
//      entitlement. **A due-sweep over rows that already know when they are due needs no schedule
//      of its own**, and the registry below is exactly that: a predicate per fact, asked every
//      sweep.
//
// ★★★ EVERY ENTRY IS IDEMPOTENT BY CONSTRUCTION, AND THAT IS THE PROPERTY TO CHECK FIRST WHEN
//     ADDING ONE. The sweep runs on every pass, so a `find` that keeps returning the same row emits
//     the same event forever. Each entry's predicate therefore excludes the state its own `act`
//     produces — `expiring` writes a row into `entitlement_warned`, `expired` moves `status`,
//     `lapsed` moves `state`, retention DELETES. ★ "It emitted once when I tested it" is not
//     evidence of this; the gate runs each entry TWICE and asserts the second pass is a no-op.
//
// ★★ IT RIDES THE ONE STATIC ENTRY. §D5 ruling 3 / P18.6(d) permits exactly one, and
//    `db/gates/p18_no_static_cron.mjs` refuses a second. `sweep_due` is a per-tenant job enqueued by
//    `sweep_tenants`, with its own `job_key`, like the four already there.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit } from "../events/outbox.mjs";
// ★ 14.28 — `documents.reminder_days` (F07 §5) and 14.25's own `nudgeGiftCard` (which already does
//   the write + emit for the gift-card fact below — see that entry's own comment). Both tables are
//   plain tenant policies (0065, 0415) with no user condition, so both read fine under this sweep's
//   null-user tx, same as every existing entry in this registry.
import { getSetting } from "../settings/writes.mjs";
import { nudgeGiftCard } from "../items/giftCards.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ★ 15.14–15.29 — the eight money-based due facts. PAYMENT_FEE_MIRROR_FACT is a forward dependency;
//   if not yet on disk it is skipped (not imported, not registered).
import { INVOICE_REMINDER_FACT, INVOICE_OVERDUE_FACT } from "../money/reminders.mjs";
import { ESTIMATE_EXPIRING_FACT, ESTIMATE_EXPIRED_FACT } from "../money/estimates.mjs";
import { INSTALLMENT_DUE_FACT } from "../money/paymentPlans.mjs";
import { PAYOUT_ITEMISE_FACT } from "../money/payouts.mjs";
// ★ DOCUSTAY WALL FIX (29 Sep 2026) — document_lapsed/document_reminder_due moved to
//   documents/dueFacts.mjs, the SAME "each domain owns its own facts, imported here by reference"
//   shape the four money imports just above already use. Nothing about the facts themselves
//   changed — same predicates, same writes, same events, relocated verbatim.
import { MAIL_DOMAIN_PENDING_FACT } from "../mail/index.mjs";
import { DOCUMENT_LAPSED_FACT, DOCUMENT_REMINDER_DUE_FACT, PAYMENT_HOLD_LAPSED_FACT, PAYMENT_RECEIPT_DUE_FACT, PAYMENT_FEE_DUE_FACT } from "../documents/frontDoor.mjs";

/**
 * ★★ HOW LONG BEFORE AN ENTITLEMENT EXPIRES SOMEBODY IS TOLD. Seven days is the ruling: long enough
 *    to book a session and use what they paid for, short enough that the warning is about THIS
 *    entitlement rather than a date nobody can act on yet.
 *  ★ Exported so the gate asserts against the SAME number the code uses.
 */
export const EXPIRY_WARNING_DAYS = 7;

/**
 * ★★ HOW LONG A RATE-LIMIT WINDOW IS KEPT. The table is a counter, not a record: once a window is
 *    closed it can never be consulted again, because every limit decision is about now(). A day is
 *    already far past the longest bucket. ★ Keeping them is not "safer" — an unbounded table on the
 *    hot path of every request is the failure, and this is the only thing that bounds it.
 */
export const RATE_LIMIT_RETENTION_HOURS = 24;

/**
 * ★★★ THE REGISTRY. Each entry is one time-based fact.
 *
 *   key      — the name it is logged and asserted under
 *   why      — what fact this turns a passing moment into, in the words a person would use
 *   find     — the rows that are due NOW. ★★ ITS PREDICATE MUST EXCLUDE WHAT `act` PRODUCES, or the
 *              sweep re-fires forever.
 *   act      — do the thing, in the sweep's transaction. Returns a short description for the log.
 *
 * ★ `find` and `act` both receive the tenant-scoped `tx`, so RLS applies and no entry can reach
 *   another tenant's rows — the sweep does not get to be the exception to isolation.
 */
export const DUE_FACTS = Object.freeze([
  {
    key: "entitlement_expiring",
    why: "a client's package runs out soon and nobody has told them",
    // ★★ `entitlement_warned` IS THE IDEMPOTENCY. A warning is not a state the entitlement has, so
    //    there is nowhere on the row to record that it was sent; without the ledger this would warn
    //    the same person every sixty seconds for a week.
    find: (tx, { tenantId }) => tx.query(
      `SELECT e.id, e.owner_user_id, e.expires_at,
              (SELECT count(*) FROM keystone.entitlement_credit c
                WHERE c.entitlement_id = e.id AND c.status IN ('available','returned'))::int AS remaining
         FROM keystone.entitlement e
        WHERE e.tenant_id = $1
          AND e.status = 'active'
          AND e.expires_at IS NOT NULL
          AND e.expires_at > now()
          AND e.expires_at <= now() + make_interval(days => $2::int)
          AND NOT EXISTS (SELECT 1 FROM keystone.entitlement_warned w
                           WHERE w.tenant_id = e.tenant_id AND w.entitlement_id = e.id)
        ORDER BY e.expires_at`,
      [tenantId, EXPIRY_WARNING_DAYS]),
    act: async (tx, { tenantId, row }) => {
      await tx.query(
        `INSERT INTO keystone.entitlement_warned (tenant_id, entitlement_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`, [tenantId, row.id]);
      await emit(tx, {
        tenantId, topic: "booking.entitlement.expiring", emittedBy: "booking",
        subjectType: "entitlement", subjectId: row.id,
        // ★ STAGE 3 TASK 1 — this whole file runs off `runDueFacts`, called only from the tenant
        //   sweep (`queue/tasks.mjs:1248`), never from a request with a session.
        actor: "worker",
        // ★★ THE REMAINING COUNT TRAVELS IN THE PAYLOAD. "Your package expires on Friday" and "your
        //    package expires on Friday and you have 4 sessions left" are different messages, and the
        //    consumer cannot recompute the second one at delivery time without re-reading the
        //    credits — by which point some of them may have been spent. The number is the number at
        //    the moment the fact was true.
        payload: { expires_at: row.expires_at, credits_remaining: row.remaining,
                   owner_user_id: row.owner_user_id, warning_days: EXPIRY_WARNING_DAYS },
      });
      return `entitlement ${row.id} expires ${row.expires_at?.toISOString?.() ?? row.expires_at} with ${row.remaining} credit(s) left`;
    },
  },

  {
    key: "entitlement_running_low",
    why: "a client's package is nearly used up and nobody has told them (level-triggered: warns while it is low, re-arms once it is topped up)",
    // ★★★ credits defect 15. Counts what the client can STILL SPEND (available + returned — the old edge test counted `available` only, so a
    //     returned credit hid the shortage) against the practice's threshold; `entitlement_warned (kind 'running_low')` is the idempotency.
    //     `remaining > 0`: an empty package is `exhausted`, which has its own topic.
    find: async (tx, { tenantId }) => {
      const threshold = Number(await getSetting(tx, "credits.running_low_at", 1)) || 1;
      // re-arm: a package that is topped up again (remaining above the threshold) forgets its warning, so the next dip warns again
      await tx.query(
        `DELETE FROM keystone.entitlement_warned w
          WHERE w.tenant_id = $1 AND w.kind = 'running_low'
            AND (SELECT count(*) FROM keystone.entitlement_credit c WHERE c.entitlement_id = w.entitlement_id AND c.status IN ('available','returned')) > $2`,
        [tenantId, threshold]);
      return tx.query(
        `SELECT e.id, e.owner_user_id, e.beneficiary_user_id, e.service_id, e.total_credits, r.remaining
           FROM keystone.entitlement e
           CROSS JOIN LATERAL (SELECT count(*)::int AS remaining FROM keystone.entitlement_credit c
                                WHERE c.entitlement_id = e.id AND c.status IN ('available','returned')) r
          WHERE e.tenant_id = $1 AND e.status = 'active'
            AND (e.expires_at IS NULL OR e.expires_at > now())
            AND r.remaining > 0 AND r.remaining <= $2
            AND NOT EXISTS (SELECT 1 FROM keystone.entitlement_warned w
                             WHERE w.tenant_id = e.tenant_id AND w.entitlement_id = e.id AND w.kind = 'running_low')
          ORDER BY e.created_at`,
        [tenantId, threshold]);
    },
    act: async (tx, { tenantId, row }) => {
      const { rowCount } = await tx.query(
        `INSERT INTO keystone.entitlement_warned (tenant_id, entitlement_id, kind) VALUES ($1,$2,'running_low') ON CONFLICT DO NOTHING`, [tenantId, row.id]);
      if (rowCount === 0) return null;                    // another sweep already warned
      await emit(tx, {
        tenantId, topic: "booking.entitlement.running_low", emittedBy: "booking", subjectType: "entitlement", subjectId: row.id, actor: "worker",
        payload: { credits_remaining: row.remaining, total_credits: row.total_credits, owner_user_id: row.owner_user_id,
                   beneficiary_user_id: row.beneficiary_user_id ?? null, service_id: row.service_id },
      });
      return `entitlement ${row.id} is down to ${row.remaining} credit(s)`;
    },
  },

  {
    key: "entitlement_expired",
    why: "an entitlement is past its date and still says it is active",
    // ★★★ THE STATUS WAS UNREACHABLE. [MEASURED] nothing in `src/` ever moved `entitlement.status`
    //     off `active`, so a package that expired two years ago still reads "active" on every
    //     screen. ★ The CREDITS were already safe — `src/money/credits.mjs` filters on
    //     `expires_at > now()`, so an expired entitlement was correctly unspendable. It just said
    //     the opposite of that to every human looking at it.
    find: (tx, { tenantId }) => tx.query(
      `SELECT id, owner_user_id, expires_at FROM keystone.entitlement
        WHERE tenant_id = $1 AND status = 'active'
          AND expires_at IS NOT NULL AND expires_at <= now()
        ORDER BY expires_at`, [tenantId]),
    act: async (tx, { tenantId, row }) => {
      // ★ The predicate repeats `status = 'active'`: two sweeps overlapping must not both claim the
      //   same row, and the row count is what tells `act` whether it won.
      const { rowCount } = await tx.query(
        `UPDATE keystone.entitlement SET status = 'expired', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'active'`, [tenantId, row.id]);
      if (rowCount === 0) return null;
      await emit(tx, {
        tenantId, topic: "booking.entitlement.exhausted", emittedBy: "booking",
        subjectType: "entitlement", subjectId: row.id,
        // ★ STAGE 3 TASK 1 — see the note on this file's first emit.
        actor: "worker",
        // ★★ `reason` DISTINGUISHES THE TWO WAYS AN ENTITLEMENT ENDS, and they are not the same
        //    fact: running out of sessions means the client used what they bought; running out of
        //    TIME means they did not, and somebody should probably call them. The catalogue has one
        //    topic, so the discriminator travels in the payload — the same shape
        //    `booking.booking.completed` uses for `outcome`.
        payload: { reason: "expired", expires_at: row.expires_at, owner_user_id: row.owner_user_id },
      });
      return `entitlement ${row.id} marked expired`;
    },
  },

  {
    key: "gift_card_never_opened",
    why: "a gift card sold a month ago has never been opened, and nobody has nudged the holder",
    // ★★★ `opened_at IS NULL AND nudged_at IS NULL AND voided_at IS NULL` IS THE IDEMPOTENCY.
    //     `nudgeGiftCard` (14.25) sets `nudged_at`, which this predicate excludes — a card nudged
    //     once can never be found by this sweep again. `voided_at` and `opened_at` are excluded for
    //     the same reason `document_lapsed` excludes signed states: a card that has been opened or
    //     voided is not the fact this entry is about.
    find: (tx, { tenantId }) => tx.query(
      `SELECT id FROM keystone.gift_card
        WHERE tenant_id = $1 AND opened_at IS NULL AND nudged_at IS NULL AND voided_at IS NULL
          AND created_at <= now() - interval '30 days'
        ORDER BY created_at`, [tenantId]),
    // ★★ `nudgeGiftCard` DOES THE WRITE AND THE EMIT ITSELF (`items.gift_card.nudged`, `id`/`number`
    //    only — never the code, never a minor-unit amount, never anything from the blocked list; see
    //    that function's own header). This `act` calls it and nothing more — a second emit here would
    //    be a duplicate of the one it already sends. `nudgeGiftCard` itself throws `conflict()` on an
    //    already-nudged card; this predicate already excludes that state, so the only way `act` ever
    //    reaches that throw is two sweeps racing the same row — which `runDueFacts`'s per-fact
    //    savepoint (above) already isolates into `problems` without losing the other rows this pass.
    act: async (tx, { tenantId, row }) => {
      await nudgeGiftCard(tx, { tenantId, id: row.id, actorUserId: null });
      return `gift card ${row.id} nudged — never opened 30 days after issue`;
    },
  },

  {
    key: "rate_limit_retention",
    why: "a counter table on the hot path of every request grows without bound",
    // ★★ NO `find`/`act` PAIR — this one is a DELETE and there is nothing to report per row. The
    //    registry allows a `sweepAll` for facts whose action is a set operation rather than a
    //    per-row decision; splitting it into a find and an act would read a million rows to throw
    //    them away.
    sweepAll: async (tx, { tenantId }) => {
      const { rowCount } = await tx.query(
        `DELETE FROM keystone.rate_limit_window
          WHERE tenant_id = $1 AND window_start < now() - make_interval(hours => $2::int)`,
        [tenantId, RATE_LIMIT_RETENTION_HOURS]);
      // ★ 7.29 — the per-key counter table (keystone.api_key_rate_window, migration 0225) is a
      //   counter on the hot path of every key request, exactly like keystone.rate_limit_window
      //   above, and is pruned the same way, in the same fact — not a new due fact, so
      //   DUE_FACT_KEYS is unchanged and db/gates/p18_no_static_cron.mjs is unaffected.
      const { rowCount: keyRowCount } = await tx.query(
        `DELETE FROM keystone.api_key_rate_window
          WHERE tenant_id = $1 AND window_start < now() - make_interval(hours => $2::int)`,
        [tenantId, RATE_LIMIT_RETENTION_HOURS]);
      return (rowCount === 0 && keyRowCount === 0)
        ? []
        : [`pruned ${rowCount} closed rate-limit window(s) and ${keyRowCount} API-key window(s)`];
    },
  },

  // ★ 14.28/P8.8 — document lapsed and reminder due (moved to documents/dueFacts.mjs, Docustay wall fix)
  DOCUMENT_LAPSED_FACT,
  DOCUMENT_REMINDER_DUE_FACT,
  // ★ Run 9 Part 3.4 — key dates read from signed documents' boxes, then the renewal reminder (Pro), in that order so a newly read notice date is reminded the same sweep
  PAYMENT_HOLD_LAPSED_FACT,   // Run 9 Part 3.7: a signature held 7 days for its payment, unpaid — cleared, signer and sender told
  PAYMENT_RECEIPT_DUE_FACT,   // Run 9 Part 3.7: a paid payment whose document did not complete gets its receipt on its own
  PAYMENT_FEE_DUE_FACT,       // Run 9 Part 3.7: Stripe's fee that was not settled at payment time is asked for again

  // ★ Batch A — own-domain verification re-checked in the background (mail module)
  MAIL_DOMAIN_PENDING_FACT,

  // ★ 15.17 — invoice reminders and overdue
  INVOICE_REMINDER_FACT,
  INVOICE_OVERDUE_FACT,

  // ★ 15.18 — estimate expiring and expired
  ESTIMATE_EXPIRING_FACT,
  ESTIMATE_EXPIRED_FACT,

  // ★ 15.22 — payment plan installment due (R8 guard: charges off → empty array, moves no money)
  INSTALLMENT_DUE_FACT,

  // ★ 15.29 — payout itemise
  PAYOUT_ITEMISE_FACT,
]);

export const DUE_FACT_KEYS = Object.freeze(DUE_FACTS.map((f) => f.key));

/**
 * Run every due fact for one tenant, inside that tenant's transaction.
 *
 * ★★★ ONE ENTRY'S FAILURE IS NOT ANOTHER'S, BUT IT IS NOT SWALLOWED EITHER. An entry that throws is
 *     recorded in `problems` and the remaining entries still run — a broken document predicate must
 *     not stop entitlements expiring. The caller RE-THROWS if anything failed, so the job goes red
 *     and graphile retries it; what it does not do is abandon the other four facts on the way.
 *
 * @returns {{ acted: string[], counts: Record<string, number>, problems: string[], errors: Error[] }}
 */
export async function runDueFacts(tx, { tenantId, facts = DUE_FACTS } = {}) {
  // ★ Stage 4 Task 6: `errors` carries the thrown objects themselves, so sweep_due can classify them (retry a
  //   passing failure, give up on a fault) without reading the message text in `problems`.
  const acted = [], counts = {}, problems = [], errors = [];

  for (const fact of facts) {
    counts[fact.key] = 0;
    // ★★ Stage 4 Task 6 fix round 1 (review I-4) — A SAVEPOINT PER FACT. Without one, a database error in one fact
    //    (a 40001, a statement timeout) aborts the whole transaction, and every fact after it fails with 25P02
    //    "current transaction is aborted" — its own work lost, and a passing blip reported as four failures, three
    //    of them code faults. ROLLBACK TO undoes only the failing fact's writes and clears the aborted state.
    await tx.query("SAVEPOINT due_fact");
    try {
      if (fact.sweepAll) {
        const lines = await fact.sweepAll(tx, { tenantId });
        for (const line of lines) { acted.push(`${fact.key}: ${line}`); counts[fact.key] += 1; }
        await tx.query("RELEASE SAVEPOINT due_fact");
        continue;
      }
      const { rows } = await fact.find(tx, { tenantId });
      for (const row of rows) {
        const said = await fact.act(tx, { tenantId, row });
        // ★ `null` means another sweep won the row between the find and the act. Not an error, and
        //   deliberately not counted — counting it would report work that did not happen.
        if (said !== null && said !== undefined) { acted.push(`${fact.key}: ${said}`); counts[fact.key] += 1; }
      }
      await tx.query("RELEASE SAVEPOINT due_fact");
    } catch (e) {
      await tx.query("ROLLBACK TO SAVEPOINT due_fact");
      await tx.query("RELEASE SAVEPOINT due_fact");
      // ★ The fact's partial writes are gone with its savepoint, so what it said it did is not counted either.
      acted.splice(0, acted.length, ...acted.filter((a) => !a.startsWith(`${fact.key}: `)));
      counts[fact.key] = 0;
      problems.push(`${fact.key} — ${e.name}: ${e.message}`);
      errors.push(e);
    }
  }

  return { acted, counts, problems, errors };
}
