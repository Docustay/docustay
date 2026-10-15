// @ts-check
// P2.6 — THE PRACTICE'S OWN INVOICE NUMBER.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHY THERE IS A MODULE HERE AND NOT A ONE-LINE `max(n) + 1`.
//     A `SELECT max(...) + 1` inside a transaction is the textbook race: two invoices raised at the
//     same instant read the same maximum and both write it. Under READ COMMITTED neither sees the
//     other's uncommitted row, so **both succeed at the SELECT and one fails at the unique index** —
//     which, if the caller is a webhook, means a payment that arrived is not recorded.
//   ★★ THE UNIQUE INDEX IS THE BACKSTOP AND IT IS NOT THE ANSWER. `invoice_number_unique_per_tenant`
//      guarantees no two invoices share a number; it cannot make the write succeed. **A guard that
//      turns a race into an error is correct and still loses the invoice.**
//
// ★★★ SO THE NUMBER IS ALLOCATED UNDER A TRANSACTION-SCOPED ADVISORY LOCK, KEYED ON THE TENANT.
//     Two concurrent invoices in the SAME practice serialise for the microsecond it takes to read
//     the maximum; two in DIFFERENT practices never touch each other, because the key is the tenant.
//   ★ `pg_advisory_xact_lock` releases at COMMIT or ROLLBACK with no unlock call, so a caller that
//     throws cannot strand the lock — the failure mode a manual lock/unlock pair always eventually
//     produces.
//
// ★★ AND THE SERIES RESTARTS EACH YEAR, WHICH IS A DECISION AND NOT A DEFAULT. `2026-0001` tells a
//    person which year an invoice belongs to without opening it, and it keeps the sequence short
//    enough to read aloud on the telephone. The alternative — one unbroken sequence forever — is
//    also defensible, and is what a practice that migrated from another system may need; that is a
//    setting, and P6.65 is where it would live. **Recorded rather than silently decided.**
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★ A stable 64-bit key for the advisory lock. Postgres takes a bigint, and a tenant id is a uuid,
 *   so the first 15 hex digits are used — 60 bits, comfortably inside a signed bigint and with far
 *   more room than the number of practices this will ever hold.
 * ★★ A COLLISION HERE IS HARMLESS AND SAYING SO MATTERS: two tenants sharing a lock key would
 *    serialise with each other unnecessarily for a microsecond. It cannot produce a duplicate
 *    number, because the SELECT that follows is still scoped by `tenant_id` under RLS.
 */
const lockKeyFor = (tenantId) => BigInt("0x" + tenantId.replace(/-/g, "").slice(0, 15));

/**
 * ★★★ THE SERIES YEAR IS THE PRACTICE'S OWN YEAR, NOT UTC'S.
 *
 *   [MEASURED, P2 CLOSE §VISUAL] this read `now.getUTCFullYear()`, and `createInvoice` passes no
 *   `now`, so it was always real UTC:
 *     · a tenant in America/Los_Angeles, local date 2026-12-31  →  number **2027-0001**
 *     · a tenant in Pacific/Auckland, local 2027-01-01 00:30    →  number **2026-0002**
 *   The US practice files an invoice DATED 31 December 2026 under 2027, then continues 2027-0002 in
 *   January — so its 2027 series is short by one and one 2026 invoice is in the wrong year. For a
 *   number whose entire purpose is *"which year does this invoice belong to, without opening it"*,
 *   that is the one thing it must not get wrong.
 *
 * ★ It contradicted the rule this project applies everywhere else — `next_session` renders
 *   `AT TIME ZONE t.timezone`, `reminderFacts` falls back to `t.timezone`. `tenant.timezone` was
 *   one join away and was not consulted.
 * ★★ Computed in SQL rather than in JS: the zone lives in the database and `AT TIME ZONE` is the
 *    same mechanism every other date-in-a-practice's-own-terms read here uses. One way to do it.
 */
async function seriesFor(tx, tenantId, now) {
  const { rows } = await tx.query(
    `SELECT to_char($2::timestamptz AT TIME ZONE t.timezone, 'YYYY') AS series
       FROM keystone.tenant t WHERE t.id = $1`,
    [tenantId, now.toISOString()]);
  if (!rows[0]) {
    throw new Error(
      `nextInvoiceNumber: practice ${tenantId} is not readable here, so its year is unknown. ` +
      `★ Falling back to UTC would file an invoice under the wrong year for any practice west of ` +
      `Greenwich in the last hours of December — refuse instead.`);
  }
  return rows[0].series;
}

/**
 * ★★★ REFUSE TO RUN OUTSIDE A TRANSACTION, RATHER THAN DEGRADE QUIETLY INTO THE RACE.
 *
 *   The docstring below used to PROMISE this — *"this throws rather than silently degrading"* — and
 *   [MEASURED, P2 CLOSE §VISUAL] **there was no such check.** `pg_advisory_xact_lock` releases at
 *   the end of the implicit single-statement transaction, so on an autocommit client the lock was
 *   taken and dropped before the SELECT ran, and the function degraded to exactly the
 *   `max(n)+1` race it exists to prevent. Two autocommit callers measured:
 *
 *       2026-0002   2026-0002        <-- IDENTICAL
 *
 *   ★★ A comment describing a guard that does not exist is worse than no comment: it is the reason
 *      nobody checks. This project has now recorded that three times.
 *
 * ★ `SAVEPOINT` is the probe because Postgres answers it definitively — outside a transaction block
 *   it raises 25P01, *"SAVEPOINT can only be used in transaction blocks"*. No timing, no heuristic.
 */
async function assertInTransaction(tx) {
  try {
    await tx.query("SAVEPOINT keystone_invoice_number_probe");
    await tx.query("RELEASE SAVEPOINT keystone_invoice_number_probe");
  } catch (e) {
    if (e.code === "25P01") {
      throw new Error(
        `nextInvoiceNumber must be called inside a transaction. ★ pg_advisory_xact_lock releases at ` +
        `the end of the implicit single-statement transaction, so on an autocommit client the lock ` +
        `is gone before the number is read and two callers get the SAME number — MEASURED, twice ` +
        `returning 2026-0002. Refusing is the only honest answer; the alternative is a duplicate ` +
        `invoice number nobody notices until a client queries their bill.`);
    }
    throw e;
  }
}

/**
 * Allocate the next invoice number for this practice.
 *
 * @param {object} tx        a pg client INSIDE a transaction — the advisory lock has no meaning
 *                           otherwise, and this THROWS rather than silently degrading if it is not.
 *                           ★ That promise is now enforced by `assertInTransaction`; it was a
 *                             comment describing nothing until P2 CLOSE.
 * @param {string} tenantId
 * @returns {Promise<string>} e.g. "2026-0001"
 */
export async function nextInvoiceNumber(tx, tenantId, now = new Date()) {
  if (!tenantId) throw new Error("nextInvoiceNumber requires a tenantId");

  await assertInTransaction(tx);

  // ★★★ SERIALISE THIS PRACTICE'S ALLOCATION. Transaction-scoped: released at COMMIT or ROLLBACK,
  //     with no unlock call to forget.
  await tx.query("SELECT pg_advisory_xact_lock($1)", [lockKeyFor(tenantId).toString()]);

  const series = await seriesFor(tx, tenantId, now);
  // ★★ READ THE MAXIMUM WITHIN THIS SERIES ONLY, and read it from the NUMBERS THEMSELVES rather than
  //    from a counter column somewhere else. A counter is a second place the truth lives and drifts
  //    the first time a row is inserted by any other path. The numbers ARE the sequence.
  //  ★★ CORRECTION, P2 CLOSE §VISUAL: this used to say *"and this table already has one: the Stripe
  //     webhook."* **It does not.** [MEASURED] `grep "INSERT INTO keystone.invoice" src/` finds
  //     exactly ONE production site — `src/money/writes.mjs:458`, which calls this function.
  //     `src/payments/webhook.mjs` only UPDATEs `status`. The reasoning above still holds on its own
  //     merits; the example was invented, and an invented justification is the thing that stops the
  //     next reader checking.
  //  ★ No `tenant_id` predicate is written by hand: FORCE RLS applies it, and a second isolation
  //    mechanism is the one that drifts (see the note at the top of src/records/queries.mjs).
  const { rows } = await tx.query(
    `SELECT max(substring(invoice_number from '[0-9]+$')::int) AS n
       FROM keystone.invoice
      WHERE invoice_number LIKE $1`,
    [`${series}-%`]);

  const next = (rows[0]?.n ?? 0) + 1;
  // ★ Four digits, growing past that rather than wrapping. A practice issuing its 10,000th invoice
  //   in a year gets `2026-10000`, which is ugly and correct; a wrap would be pretty and wrong.
  return `${series}-${String(next).padStart(4, "0")}`;
}
