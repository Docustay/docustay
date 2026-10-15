// @ts-check
// P8.6 — THE CREDIT SPEND PATH. THREE STATES THAT WERE UNREACHABLE BY CONSTRUCTION.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NEITHER CREDIT SYSTEM HAD A PRODUCTION SPEND PATH, AND THAT IS WORSE THAN THE DUPLICATE
//     `F75` RECORDS. [MEASURED 2026-09-15] `entitlement_credit` rows are INSERTed `'available'` by
//     `createEntitlement` (`src/money/writes.mjs:296`) and **there is no UPDATE of that column
//     anywhere in `src/`** — so `reserved`, `consumed` and `returned` were unreachable BY
//     CONSTRUCTION, not by omission. The other system (`package_credit` / `package_balance`) is
//     touched only by `spendCredit`/`releaseCredit` in `createBooking.mjs`, **neither of which has
//     a production caller**, and `package_balance` has zero reads and zero writes — a balance read
//     from it would be permanently zero.
//   ★★ So KS-16.0's "move `spendCredit` onto `entitlement_credit`" had nothing to move. **The job
//      was to write the path**, and this module is it.
//
// ★★★ THE SCHEMA ALREADY ENCODES THE STATE MACHINE, AND THIS MODULE IS ITS ONLY LEGAL MOVER.
//     `credit_state_shape` (0015:206) refuses any row that disagrees:
//       available | returned → booking_id IS NULL AND consumed_at IS NULL
//       reserved            → booking_id IS NOT NULL AND consumed_at IS NULL
//       consumed            → booking_id IS NOT NULL AND consumed_at IS NOT NULL
//     Every statement below moves a row from one of those shapes to another in ONE update, so a
//     half-applied transition cannot exist even for an instant.
//
// ★★★ `returned` IS SPENDABLE AGAIN, AND THAT IS A DECISION I AM MAKING EXPLICITLY.
//     The CHECK groups `available` and `returned` identically — both hold no booking and no
//     consumption — so the schema treats them as the same SHAPE and distinguishes only PROVENANCE:
//     `available` was never used, `returned` came back from a cancelled booking. The reserve query
//     therefore accepts both.
//   ★★ THE ALTERNATIVE IS A BUSINESS RULING, NOT A TECHNICAL ONE. Making `returned` unspendable
//      would mean a client loses a session by cancelling — a late-cancellation penalty. That is the
//      same class of decision as the no-show charge (§OPEN-QUESTIONS Q5) and belongs to the maintainer, not to
//      this module. **Recorded in the handoff rather than settled quietly**; the change would be one
//      word in the WHERE clause below.
//
// ★★★ CONCURRENCY IS `FOR UPDATE … SKIP LOCKED LIMIT 1`, NOT A COUNT-THEN-WRITE.
//     Two people booking the last credit must not both succeed. A `SELECT count(*)` followed by an
//     UPDATE is two statements with a gap, and the gap is the bug. `FOR UPDATE` takes the row lock;
//     `SKIP LOCKED` makes the loser skip past the locked row rather than block on it and then take
//     it when the winner commits; `LIMIT 1` means each caller claims exactly one. The loser finds
//     nothing and is told so.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { conflict, invalid } from "../http/errors.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same locking, same parameterization). `sql` is
//   the escape hatch for what the builder itself does not express — FILTER, ANY(...), NULLS LAST,
//   FOR UPDATE ... SKIP LOCKED — per the L3 per-file ruling: "SQL that calls plpgsql or uses
//   features the builder lacks stays as sql`…` through run".
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** ★ Both are spendable — see the header. `reserved` and `consumed` are not. */
export const SPENDABLE = Object.freeze(["available", "returned"]);

/**
 * ★★★ WHOSE CREDITS MAY THIS PERSON SPEND (specs/CREDITS-PIPELINE.md §3.2, defect 3). The owner is the PAYER; the person
 *     attending is not always the payer (a parent buys, the young person attends). A credit is usable by `person` when:
 *       · they own it, or it names them as its beneficiary, or
 *       · it names NO beneficiary and its owner is someone who pays for them — themselves, a guardian, a payer-group mate
 *         (`keystone.credit_payers_for`, migration 0583).
 *     ONE definition: reserve, the remaining count and the standing sentence all use it, so "4 of 4 left" and "no credit
 *     available" can never disagree about whose credit it is.
 */
const usableBy = (person) => sql`(e.owner_user_id = ${person}
    OR e.beneficiary_user_id = ${person}
    OR (e.beneficiary_user_id IS NULL AND e.owner_user_id = ANY(keystone.credit_payers_for(${person}))))`;

/** Why a credit moved — read by the credit_event trigger (migration 0583); transaction-local. */
async function because(tx, reason) { await tx.query(`SELECT set_config('keystone.credit_reason', $1, true)`, [reason]); }

/**
 * Reserve one credit for a booking, in the SAME TRANSACTION as the booking.
 *
 * ★★ ORDERED BY EXPIRY FIRST. A client holding two entitlements should spend the one that dies
 *    soonest, or they lose it and keep one they could have used later. `NULLS LAST` so a
 *    never-expiring credit is spent only when nothing is expiring.
 * ★ A booking that already holds a credit is a CONFLICT, not a second reservation —
 *   `credit_one_per_booking` would refuse it anyway; this says so in words first.
 *
 * @returns {{creditId, entitlementId}|null} null when the person has no spendable credit
 */
export async function reserveCreditForBooking(tx, { tenantId, ownerUserId, serviceId, bookingId, bookingStartsAt = null }) {
  if (!bookingId) throw invalid("reserving a credit requires the bookingId it is being spent on");
  if (!ownerUserId) throw invalid("reserving a credit requires whose credit it is");

  const existing = await run(tx, db
    .selectFrom("keystone.entitlement_credit")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("booking_id", "=", bookingId));
  if (existing.rowCount > 0) {
    throw conflict("this booking already holds a credit — one booking, one credit");
  }

  const { rows } = await run(tx, db
    .selectFrom("keystone.entitlement_credit as c")
    .innerJoin("keystone.entitlement as e", "e.id", "c.entitlement_id")
    .select(["c.id", "c.entitlement_id"])
    .where("c.tenant_id", "=", tenantId)
    .where(usableBy(ownerUserId))
    .where("e.status", "=", "active")
    // ★ a credit that has expired by the DAY OF THE SESSION cannot pay for it (defect 20) — `now()` when no date is given
    .where(sql`(e.expires_at IS NULL OR e.expires_at > coalesce(${sql.val(bookingStartsAt)}::timestamptz, now()))`)
    // A credit bought for one service cannot pay for another. service_id is NOT NULL on
    // entitlement today, so this is an equality.
    .where("e.service_id", "=", serviceId)
    .where(sql`c.status = ANY(${sql.val(SPENDABLE)})`)
    .orderBy(sql`e.expires_at ASC NULLS LAST`)
    .orderBy("c.created_at", "asc")
    .limit(1)
    .modifyEnd(sql`FOR UPDATE OF c SKIP LOCKED`));

  if (rows.length === 0) return null;      // ★ "no credit" is an answer, not an error

  const { id: creditId, entitlement_id: entitlementId } = rows[0];
  await because(tx, "reserved for a booking");
  await run(tx, db
    .updateTable("keystone.entitlement_credit")
    .set({ status: "reserved", booking_id: bookingId, consumed_at: null })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", creditId));

  return { creditId, entitlementId };
}

/**
 * ★ credits defect 20 — a session that holds a RESERVED credit cannot be moved to a time after that credit expires.
 *   Called by both reschedule paths with the new start; a booking with no reserved credit passes.
 */
export async function assertCreditCoversDate(tx, { tenantId, bookingId, newStart }) {
  const { rows } = await tx.query(
    `SELECT e.expires_at FROM keystone.entitlement_credit c JOIN keystone.entitlement e ON e.id = c.entitlement_id
      WHERE c.tenant_id = $1 AND c.booking_id = $2 AND c.status = 'reserved' AND e.expires_at IS NOT NULL AND e.expires_at <= $3`,
    [tenantId, bookingId, newStart]);
  if (rows.length > 0) {
    throw conflict("The package credit set aside for this session expires before that time. Choose an earlier time, or cancel this session and book again.");
  }
}

/**
 * The session happened → the credit is spent for good.
 * ★★ Emitted, because this is the moment a thing a client PAID FOR was used up. `booking.credit.*`
 *    does not exist in the catalogue and adding one is an edit to a file this item does not own, so
 *    the consumption is reported by its return value and the caller decides — the same shape
 *    `attendance.mjs` uses for the charge decision.
 */
export async function consumeCreditForBooking(tx, { tenantId, bookingId }) {
  await because(tx, "the session was held");
  const { rows } = await run(tx, db
    .updateTable("keystone.entitlement_credit")
    .set({ status: "consumed", consumed_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("booking_id", "=", bookingId)
    .where("status", "=", "reserved")
    .returning(["id", "entitlement_id"]));
  return rows[0] ?? null;
}

/**
 * The booking was cancelled → the credit goes back.
 * ★★★ `booking_id` IS CLEARED, and it has to be: `credit_state_shape` forbids a `returned` row
 *     holding a booking. The provenance survives in the STATUS — `returned` says "this came back"
 *     where `available` says "never used" — which is the distinction the two states exist for.
 */
export async function returnCreditForBooking(tx, { tenantId, bookingId }) {
  await because(tx, "the booking was cancelled");
  const { rows } = await run(tx, db
    .updateTable("keystone.entitlement_credit")
    .set({ status: "returned", booking_id: null, consumed_at: null })
    .where("tenant_id", "=", tenantId)
    .where("booking_id", "=", bookingId)
    .where("status", "=", "reserved")
    .returning(["id", "entitlement_id"]));
  return rows[0] ?? null;
}

/**
 * ★★★ THE CREDIT COMES BACK WHATEVER STATE IT WAS IN (defect 19). A booking that is DELETED, or refunded after it was held,
 *     may hold a `reserved` OR a `consumed` credit; `returnCreditForBooking` above only moved `reserved`, so deleting a
 *     held session left a `consumed` row pointing at a booking that no longer exists — and the new FK rule (0581,
 *     entitlement_credit.booking_id SET NULL) then violated `credit_state_shape`, so the delete itself failed.
 *     Both states go to `returned` (spendable again), the booking pointer cleared in the same UPDATE.
 */
export async function returnCreditsForBooking(tx, { tenantId, bookingId, reason = "the booking was removed" }) {
  await because(tx, reason);
  const { rows } = await run(tx, db
    .updateTable("keystone.entitlement_credit")
    .set({ status: "returned", booking_id: null, consumed_at: null })
    .where("tenant_id", "=", tenantId)
    .where("booking_id", "=", bookingId)
    .where(sql`status IN ('reserved','consumed')`)
    .returning(["id", "entitlement_id"]));
  return rows;
}

/**
 * ★ How many credits this person can still spend on this service. The number a client surface shows
 *   and the number `reserveCreditForBooking` would find must come from ONE definition of spendable,
 *   or "9 remaining" and "no credit available" can both be true at once (KS-16.2 ruling 5).
 */
export async function spendableCredits(tx, { tenantId, ownerUserId, serviceId = null }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.entitlement_credit as c")
    .innerJoin("keystone.entitlement as e", "e.id", "c.entitlement_id")
    .select([
      sql`count(*)::int`.as("remaining"),
      sql`count(*) FILTER (WHERE c.status = 'consumed')::int`.as("consumed_unused"),
    ])
    .where("c.tenant_id", "=", tenantId)
    .where(usableBy(ownerUserId))
    .where("e.status", "=", "active")
    .where((eb) => eb.or([
      eb("e.expires_at", "is", null),
      eb("e.expires_at", ">", sql`now()`),
    ]))
    .where(sql`(${sql.val(serviceId)}::uuid IS NULL OR e.service_id = ${sql.val(serviceId)})`)
    .where(sql`c.status = ANY(${sql.val(SPENDABLE)})`));
  return rows[0]?.remaining ?? 0;
}

/**
 * ★★ The whole picture for one person and service: bought, used, left. This is what "Session 3 of
 *    12 · 9 remaining" is rendered from, so it is computed ONCE here rather than three times on
 *    three surfaces — P4.10's measured defect was the same seven labels held in two tables.
 */
export async function creditStanding(tx, { tenantId, ownerUserId, serviceId = null }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.entitlement_credit as c")
    .innerJoin("keystone.entitlement as e", "e.id", "c.entitlement_id")
    .select([
      sql`count(*)::int`.as("total"),
      sql`count(*) FILTER (WHERE c.status = 'consumed')::int`.as("used"),
      sql`count(*) FILTER (WHERE c.status = 'reserved')::int`.as("reserved"),
      sql`count(*) FILTER (WHERE c.status = ANY(${sql.val(SPENDABLE)}))::int`.as("remaining"),
    ])
    .where("c.tenant_id", "=", tenantId)
    .where(usableBy(ownerUserId))
    .where("e.status", "=", "active")
    .where((eb) => eb.or([
      eb("e.expires_at", "is", null),
      eb("e.expires_at", ">", sql`now()`),
    ]))
    .where(sql`(${sql.val(serviceId)}::uuid IS NULL OR e.service_id = ${sql.val(serviceId)})`)
    // total/used/reserved/remaining count LIVE credits only — a voided or expired one is not part of "N of M"
    .where(sql`c.status NOT IN ('expired','voided')`));
  const r = rows[0] ?? { total: 0, used: 0, reserved: 0, remaining: 0 };
  return Object.freeze({ ...r, sessionNumber: r.used + 1 });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P10.4 / KS-16.2 RULING 5 — "SESSION 3 OF 12 · 9 REMAINING", IN ONE SENTENCE, IN ONE PLACE.
//
//     [EXECUTED 2026-09-15, before this] `balance`, `credit`, `entitlement` and `remaining` appeared
//     **zero times** in `src/routes/app.mjs` or `web/src/app/ClientSurfaces.jsx`. A client could buy
//     twelve sessions, attend three, and have no way to find out that nine were left.
//
// ★★★ WHICH IS EXACTLY THE STATE KS-16.1 SET OUT TO BEAT. Square's own users complain that
//     *"receipts do not count down, so a client cannot tell how many sessions are left"* — so being
//     in that state is not a gap, it is the competitor's defect, shipped.
//
// ★★ THE SENTENCE IS COMPOSED ONCE, HERE, BECAUSE THE RULING NAMES **THREE** SURFACES — the client
//    app, the receipt and the confirmation email. Three renderings of one fact drift, and the first
//    symptom is a client being told two different numbers by two parts of the same product.
//  ★ It returns `null`, not "0 of 0", when there is no active entitlement. A person who never bought
//    a package has no standing to report, and a zero would tell them they had run out of something
//    they never had — the same distinction `credit_progress` draws in the CRM.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ The words a person reads. Composed from `creditStanding`'s numbers, never re-counted.
 * @returns {string|null} e.g. "Session 3 of 12 · 9 remaining", or null when they hold no package
 */
export function standingSentence(standing) {
  if (!standing || Number(standing.total) === 0) return null;
  const total = Number(standing.total);
  const remaining = Number(standing.remaining);
  // ★★ `sessionNumber` is `used + 1` — the session they are ON, not the one they have finished. A
  //    client who has attended three of twelve is on session four, and telling them "session 3" the
  //    day after their third is the off-by-one everybody notices.
  const n = Math.min(Number(standing.sessionNumber), total);
  return `Session ${n} of ${total} · ${remaining} remaining`;
}
