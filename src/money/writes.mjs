// @ts-check
// P15B.11 — THE MONEY WRITES. createLineItem · createSubscription · createPaymentMethod ·
//           createEntitlement (+ N credit ROWS).
//
// ═════════════════════════════════════════════════════════════════════════════
// ★★★ §Z3.15 — ONE PARENT PER LINE ITEM, NEVER SHARED. COPY IT.
// ═════════════════════════════════════════════════════════════════════════════
// [MEASURED from the catalog] `line_item` carries ONE `(parent_type, parent_id)` pair and there is no
// join table. **So sharing is not "refused", it is UNREPRESENTABLE** — a row cannot name two parents,
// and the only way to put the same charge on two parents is two rows. That is the strongest form the
// rule can take, and it is why this module's `createLineItem` takes exactly one parent and offers no
// way to attach an existing one.
//   ★ WHY THE RULE EXISTS: a shared line item means voiding it on one invoice voids it on the other,
//     and refunding it twice is one UPDATE away. Copies diverge safely; shares diverge silently.
//   ★★ NOT THE SAME THING: `entitlement.line_item_id` is legitimately MANY-to-one — a package line
//      granting three services produces three entitlements from one line item. A unique index there
//      would be wrong, and this note exists so nobody "fixes" §Z3.15 by adding one.
//
// ═════════════════════════════════════════════════════════════════════════════
// ★★★ subscription_requires_contract — THE ITEM'S CLAIM IS OUT OF DATE, MEASURED
// ═════════════════════════════════════════════════════════════════════════════
// P15B.11 says: "CHECK (contract_id IS NOT NULL) **NOT VALID** … NOT VALID means pre-existing rows
// were never validated; new INSERT/UPDATE IS enforced. State that precisely."
//   ★★★ [MEASURED 2026-09-13] `SELECT convalidated FROM pg_constraint WHERE conname =
//       'subscription_requires_contract'` → **true**. THE CONSTRAINT IS VALIDATED. So it is enforced
//       for EVERY row, not only for new writes, and there is no population of legacy rows exempt from
//       it. ★ Stated here because the item's wording would otherwise have this module — and the next
//       reader — believe a weaker guarantee than the database actually gives.

import { emit, userActor } from "../events/outbox.mjs";
import { nextInvoiceNumber } from "./invoiceNumbers.mjs";
import { getSetting } from "../settings/writes.mjs";
import { MONEY_DEFAULTS } from "../settings/keys.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { createNotification } from "../notifications/writes.mjs";
import { recomputeDraftTotals } from "./invoices.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same RETURNING columns, same ON CONFLICT
//   behaviour, same row values). `sql` is the escape hatch for what the builder itself does not
//   express — CASE, coalesce/interval arithmetic, generate_series, FILTER — per the L3 per-file
//   ruling: "SQL that calls plpgsql or uses features the builder lacks stays as sql`…` through run".
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ★★ P2.6 — the practice's payment terms. ★ NOT in invoiceNumbers.mjs: that module allocates a
//    number and knows nothing about money. The default is 14 days because that is what a small
//    practice invoicing a person (rather than a finance department) actually uses; 30 is the
//    business-to-business convention and is what a tenant would override to.
export const DEFAULT_PAYMENT_TERMS_DAYS = 14;
export const PAYMENT_TERMS_SETTING_KEY = "money.payment_terms_days";
import { invalid, conflict, notFound } from "../http/errors.mjs";

const SECTION = "money";

// ★★★ P2.7 — WAS `["booking","invoice","contract","quote"]`, AND TWO OF THOSE FOUR NAMED TABLES THAT
//     DO NOT EXIST. [MEASURED] `to_regclass('keystone.contract')` and `to_regclass('keystone.quote')`
//     both return NULL. A `contract` is a `document_instance` — a real concept under a wrong name —
//     and `quote` is not in this schema at all.
//   ★★ A list of permitted values naming a table nobody created reads as a specification and is a
//      promise made on behalf of code that was never written. `quote` is GONE rather than renamed:
//      when a quote object exists, it gets a column, a cascade decision and a screen, in that order.
//   ★ estimate added Stage 15 (0428) — the object exists now: column, cascade, screen.
export const LINE_ITEM_PARENTS = Object.freeze(["booking", "invoice", "document", "estimate"]);
// ★ Part 3 invoice rebuild — "custom" added (the maintainer's own brief, §6: "Items (search catalogue or add
//   one-off; qty, price, description)"). MEASURED before adding it: `keystone.line_item`'s own
//   `line_item_at_most_one_source` CHECK is `<= 1`, not `= 1` — a row with NO catalogue FK set at
//   all (service_id/package_id/plan_id/modifier_id all NULL) was already schema-legal; only this
//   function's OWN stricter `LINE_ITEM_SOURCES` allow-list ever blocked a true one-off line.
export const LINE_ITEM_SOURCES = Object.freeze(["service", "package", "plan", "modifier", "custom"]);

// ★★ THE BOUNDARY KEEPS A DISCRIMINATED UNION; THE TABLE KEEPS AN EXCLUSIVE ARC OF REAL FOREIGN KEYS.
//    `{parentType, parentId}` is the natural shape for a caller and `booking_id | invoice_id |
//    document_id` is the only shape Postgres can enforce — so the mapping lives here, in one place,
//    rather than every caller learning three column names. ★ One representation AT REST; a convenient
//    one at the edge. That is not duplicate truth: only the table can be read.
const PARENT_COLUMN = Object.freeze({
  booking: "booking_id", invoice: "invoice_id", document: "document_id", estimate: "estimate_id",
});
const SOURCE_COLUMN = Object.freeze({
  service: "service_id", package: "package_id", plan: "plan_id", modifier: "modifier_id",
});
export const LINE_ITEM_STATUSES = Object.freeze(["active", "void", "refunded"]);
export const SUBSCRIPTION_STATES = Object.freeze(["active", "paused", "cancelled", "past_due"]);
export const INVOICE_STATUSES = Object.freeze(["draft", "open", "paid", "void", "uncollectible"]);
export const ENTITLEMENT_STATUSES = Object.freeze(["active", "exhausted", "expired", "refunded"]);
// ★★★ P2 CLOSE — `payment.status` HAD A FIVE-VALUE CHECK IN THE DATABASE AND NO CONSTANT ANYWHERE.
//     [MEASURED] `payment_status_check` enumerates pending · succeeded · failed · refunded ·
//     partially_refunded, and `grep` found the literal `'succeeded'` hand-typed in FOUR places across
//     `src/` — a record query, a list view, the Stripe webhook, and again in the refund branch.
//   ★★ **THIS IS THE MOST CONSEQUENTIAL ENUM IN THE PRODUCT AND IT WAS UNDECLARED.** Every "has this
//      been paid" question in the system is a comparison against one of these strings, and a typo in
//      any of them does not raise — it matches no rows and the invoice reads as unpaid. **Money
//      silently disappears**, which is the failure mode this whole section exists to prevent.
//   ★ Declared here, beside the other money vocabularies, and asserted against the CHECK in both
//     directions by `db/gates/p2_money_vocabulary.mjs`.
export const PAYMENT_STATUSES = Object.freeze([
  "pending", "succeeded", "failed", "refunded", "partially_refunded",
]);

export const CREDIT_STATUSES = Object.freeze(["available", "reserved", "consumed", "returned"]);

const CHECK_VIOLATION = "23514";
// ★ P2.7 — reachable for the first time now that line_item's parent is a real foreign key.
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const NOT_NULL_VIOLATION = "23502";

function assertMinor(label, v, { allowZero = true } = {}) {
  if (!Number.isInteger(v) || v < 0 || (!allowZero && v === 0)) {
    throw invalid(`${label} must be a ${allowZero ? "non-negative" : "positive"} integer in minor units — got ${JSON.stringify(v)}`);
  }
}

// ★ L3.0 — the same `SELECT keystone.uuid_generate_v7() AS id` idiom every writer here used,
//   now through the builder once instead of eight identical hand-written strings.
async function newId(tx) {
  return (await run(tx, db.selectNoFrom(sql`keystone.uuid_generate_v7()`.as("id")))).rows[0].id;
}

/**
 * ★★★ CREATE A LINE ITEM. EXACTLY ONE PARENT — §Z3.15.
 *
 * ★★ `nameSnapshot` IS REQUIRED AND IS A SNAPSHOT, not a lookup. The catalogue entry it came from can
 *    be renamed or deactivated; an invoice must still read the way it read when it was issued. This is
 *    the same principle as §M0 LAW 3 one layer down.
 * ★ `priceId` / `contractedPriceId` record WHICH price row this charge was computed from, so the amount
 *   is auditable back to the §Z4 history rather than merely asserted.
 * ★★ B-4 (F794) — `bookingId` is a REFERENCE, not a parent: `booking_id` no longer counts toward
 *    §Z3.15's exclusive arc (migration 0512), so a line item may carry it ALONGSIDE its real parent
 *    (e.g. `parentType: "invoice"` for a no-show charge) so booking history can find its own charge
 *    without booking holding an out-pointer into money's tables.
 */
export async function createLineItem(tx, {
  tenantId, parentType, parentId, sourceType, sourceId, nameSnapshot,
  unitAmountMinor, quantity = 1, discountMinor = 0, taxMinor = 0, currency = "USD",
  priceId = null, contractedPriceId = null, unit = null, actorUserId = null,
  bookingId = null,
}) {
  if (!LINE_ITEM_PARENTS.includes(parentType)) {
    throw invalid(`parent_type must be one of ${LINE_ITEM_PARENTS.join(", ")} — got ${JSON.stringify(parentType)}`);
  }
  if (!parentId) {
    throw invalid("a line item must have exactly one parent — §Z3.15: never shared, copy it instead");
  }
  if (!LINE_ITEM_SOURCES.includes(sourceType)) {
    throw invalid(`source_type must be one of ${LINE_ITEM_SOURCES.join(", ")} — got ${JSON.stringify(sourceType)}`);
  }
  if (sourceType === "custom" && sourceId) {
    throw invalid(`source_type "custom" (a one-off line) must not carry a sourceId — got ${JSON.stringify(sourceId)}`);
  }
  if (typeof nameSnapshot !== "string" || !nameSnapshot.trim()) {
    throw invalid(
      "name_snapshot is required — an invoice line must read the way it read when issued, even after the " +
      "catalogue entry is renamed or retired");
  }
  assertMinor("unit_amount_minor", unitAmountMinor);
  assertMinor("discount_minor", discountMinor);
  assertMinor("tax_minor", taxMinor);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw invalid(`quantity must be a positive integer — got ${JSON.stringify(quantity)}`);
  }
  // ★★ A DISCOUNT LARGER THAN THE LINE IS REFUSED. The columns only require each to be >= 0, so a
  //    100-unit discount on a 10-unit line would store happily and make the line's contribution
  //    NEGATIVE — a credit note wearing an invoice line's clothes, which no total would explain.
  const gross = unitAmountMinor * quantity;
  if (discountMinor > gross) {
    throw invalid(
      `discount_minor (${discountMinor}) exceeds the line's gross amount (${gross}) — a negative line is ` +
      `a credit note, not a discount, and nothing downstream would read it as one`);
  }

  // ★ Validate and normalize unit if provided
  let normalizedUnit = null;
  if (unit !== null && unit !== undefined) {
    const trimmedUnit = unit.trim();
    if (trimmedUnit.length === 0) {
      // Whitespace-only → store as NULL
      normalizedUnit = null;
    } else if (trimmedUnit.length > 24) {
      throw invalid(`unit must be 24 characters or fewer — got ${JSON.stringify(trimmedUnit)} (${trimmedUnit.length} characters)`);
    } else {
      normalizedUnit = trimmedUnit;
    }
  }

  const id = await newId(tx);
  // ★ B-4 — `booking_id` is added to the row only when given, so a parentType of "booking" (never
  //   used in `src/` today — see the frozen-map comment below) cannot collide with it: the parent
  //   arc's own column would already be `booking_id` in that case.
  // ★ The column names come from the frozen maps above, never from the caller's string — so a
  //   `parentType` that passed validation cannot reach the SQL as anything but one of three known
  //   identifiers (they are used as computed object keys, not concatenated into SQL text).
  const row = {
    id, tenant_id: tenantId,
    [PARENT_COLUMN[parentType]]: parentId,
    // ★ "custom" (a one-off line, Part 3 invoice rebuild) has no catalogue FK column at all —
    //   SOURCE_COLUMN has no entry for it, deliberately, so there is nothing to spread in.
    ...(sourceType === "custom" ? {} : { [SOURCE_COLUMN[sourceType]]: sourceId }),
    name_snapshot: nameSnapshot.trim(),
    unit_amount_minor: unitAmountMinor, quantity, discount_minor: discountMinor, tax_minor: taxMinor,
    currency, price_id: priceId, contracted_price_id: contractedPriceId, unit: normalizedUnit,
  };
  if (bookingId && PARENT_COLUMN[parentType] !== "booking_id") {
    row.booking_id = bookingId;
  }
  try {
    await run(tx, db.insertInto("keystone.line_item").values(row));
  } catch (e) {
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this line item: ${e.constraint ?? e.message}`);
    // ★★★ P2.7 MADE THIS BRANCH REACHABLE. Before the arc, `parent_id` had no foreign key and an
    //     invented parent stored happily; now it raises 23503. A caller who names an invoice that
    //     does not exist has made a BAD REQUEST, and answering 500 would tell an integrator "we
    //     broke" about their own typo — the same defect createBooking's hostId check was written for.
    if (e.code === FOREIGN_KEY_VIOLATION) {
      // ★ B-4 — `booking_id` is a reference alongside the real parent; its own FK violating names
      //   the booking, not the parent, so it gets its own message rather than reusing parentType's.
      if (e.constraint === "line_item_booking_fkey") {
        throw invalid(`no booking with id ${bookingId} exists in this practice, so a line item cannot reference it`);
      }
      throw invalid(
        `no ${parentType} with id ${parentId} exists in this practice, so a line item cannot be ` +
        `attached to it`);
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "money.line_item.created", emittedBy: SECTION,
    subjectType: "line_item", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: {
      parent_type: parentType, parent_id: parentId,
      total_minor: gross - discountMinor + taxMinor,
      currency, priced_from: priceId ? "price" : contractedPriceId ? "contracted_price" : "ad_hoc",
    },
  });

  // ★★★ MEASURED against production — this line was previously the ONLY writer that never kept
  //   keystone.invoice.amount_minor in step with its own lines; every reader that trusted that
  //   column instead of summing lines fresh (the money.invoice.sent event payload, specifically —
  //   src/money/invoiceSend.mjs) got a stale 0, which is exactly how the "invoice for $0.00" email
  //   subject/header happened while the line summary right below it correctly said $2.00 (that
  //   part reads keystone.line_item directly). Scoped to `draft` only — settleBooking.mjs and
  //   noShow.mjs both call this on an invoice they just created `status: 'open'` directly, with
  //   `amountMinor` already set correctly up front; recomputing there would throw (recompute-
  //   DraftTotals refuses a non-draft invoice) over nothing that needs fixing.
  if (parentType === "invoice") {
    const { rows: invoiceStatusRows } = await run(tx, db
      .selectFrom("keystone.invoice")
      .select("status")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", parentId));
    if (invoiceStatusRows[0]?.status === "draft") {
      await recomputeDraftTotals(tx, { tenantId, invoiceId: parentId });
    }
  }

  return { id, total_minor: gross - discountMinor + taxMinor, currency };
}

/**
 * ★ UPDATE A LINE ITEM — the platform-only, never touches Stripe (specs/INVOICE-SEND-FIX.md §2.4: the
 *   editor saves lines locally; the one Stripe invoice is created fresh at Send). Draft-only, same
 *   guard `updateInvoiceDraft` already enforces on the parent invoice. Recomputes the invoice's
 *   own cached totals afterward so every OTHER reader of `keystone.invoice` (list screens, the
 *   voided-invoice event payload) stays correct — `buildInvoiceView` itself never trusts those
 *   cached columns, it sums the lines directly.
 */
export async function updateLineItem(tx, {
  tenantId, invoiceId, lineItemId, nameSnapshot, unitAmountMinor, quantity = 1,
  discountMinor = 0, taxMinor = 0,
}) {
  if (!tenantId || !invoiceId || !lineItemId) {
    throw invalid("tenantId, invoiceId and lineItemId are required");
  }
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "status"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));
  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");
  if (invoiceRows[0].status !== "draft") {
    throw conflict("Only a draft invoice's lines can be edited — this one has been sent.");
  }

  if (typeof nameSnapshot !== "string" || !nameSnapshot.trim()) {
    throw invalid("name_snapshot is required");
  }
  assertMinor("unit_amount_minor", unitAmountMinor);
  assertMinor("discount_minor", discountMinor);
  assertMinor("tax_minor", taxMinor);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw invalid(`quantity must be a positive integer — got ${JSON.stringify(quantity)}`);
  }
  const gross = unitAmountMinor * quantity;
  if (discountMinor > gross) {
    throw invalid(`discount_minor (${discountMinor}) exceeds the line's gross amount (${gross})`);
  }

  // ★ MEASURED against the real schema — keystone.line_item has no `updated_at` column, only
  //   `created_at`. createLineItem (above) never set one either; matched here rather than guessed.
  const { rows } = await run(tx, db
    .updateTable("keystone.line_item")
    .set({
      name_snapshot: nameSnapshot.trim(), unit_amount_minor: unitAmountMinor, quantity,
      discount_minor: discountMinor, tax_minor: taxMinor,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", lineItemId)
    .where("invoice_id", "=", invoiceId)
    .where("status", "=", "active")
    .returning(["id"]));
  if (rows.length === 0) throw notFound("no such active line on this invoice");

  const totals = await recomputeDraftTotals(tx, { tenantId, invoiceId });
  return { id: lineItemId, total_minor: gross - discountMinor + taxMinor, invoice: totals };
}

/**
 * ★ VOID A LINE ITEM — same the platform-only, draft-only posture as `updateLineItem` above. Never a
 *   hard delete: `status='void'` keeps the row for audit the same way `recomputeDraftTotals`
 *   already expects (`WHERE status = 'active'`).
 */
export async function voidLineItem(tx, { tenantId, invoiceId, lineItemId }) {
  if (!tenantId || !invoiceId || !lineItemId) {
    throw invalid("tenantId, invoiceId and lineItemId are required");
  }
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "status"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));
  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");
  if (invoiceRows[0].status !== "draft") {
    throw conflict("Only a draft invoice's lines can be removed — this one has been sent.");
  }

  const { rows } = await run(tx, db
    .updateTable("keystone.line_item")
    .set({ status: "void" })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", lineItemId)
    .where("invoice_id", "=", invoiceId)
    .where("status", "=", "active")
    .returning(["id"]));
  if (rows.length === 0) throw notFound("no such active line on this invoice");

  const totals = await recomputeDraftTotals(tx, { tenantId, invoiceId });
  return { id: lineItemId, voided: true, invoice: totals };
}

/**
 * Create a subscription.
 * ★★★ `contractId` IS REQUIRED, AND THE DATABASE AGREES FOR EVERY ROW (see the header — the constraint
 *     is VALIDATED, not NOT VALID). A subscription without a contract is a recurring charge nobody
 *     agreed to in writing, which is the one thing a recurring charge must never be.
 * ★★ `snapshotAmountMinor` freezes what was agreed. The plan's catalogue price will move (§Z4), and a
 *    subscriber keeps the amount they signed up at until something explicitly changes it.
 */
export async function createSubscription(tx, {
  tenantId, planId, appUserId, contractId, snapshotAmountMinor,
  paymentMethodId = null, startedOn = null, currentPeriodEnd = null, actorUserId = null,
}) {
  if (!planId) throw invalid("planId is required");
  if (!appUserId) throw invalid("appUserId is required");
  if (!contractId) {
    throw invalid(
      "contractId is required — a subscription with no contract is a recurring charge nobody agreed to " +
      "in writing. The database enforces this as subscription_requires_contract, for every row.");
  }
  if (snapshotAmountMinor !== null && snapshotAmountMinor !== undefined) {
    assertMinor("snapshot_amount_minor", snapshotAmountMinor);
  }

  const id = await newId(tx);
  try {
    await run(tx, db.insertInto("keystone.subscription").values({
      id: id ?? null, tenant_id: tenantId ?? null, plan_id: planId ?? null, app_user_id: appUserId ?? null, contract_id: contractId ?? null,
      snapshot_amount_minor: snapshotAmountMinor ?? null,
      payment_method_id: paymentMethodId ?? null,
      started_on: sql`coalesce(${startedOn}::date, CURRENT_DATE)`,
      current_period_end: currentPeriodEnd ?? null,
    }));
  } catch (e) {
    if (e.code === CHECK_VIOLATION) {
      throw invalid(`the database refused this subscription: ${e.constraint ?? e.message}`);
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "money.subscription.started", emittedBy: SECTION,
    subjectType: "subscription", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: {
      plan_id: planId, app_user_id: appUserId, contract_id: contractId,
      snapshot_amount_minor: snapshotAmountMinor ?? null,
      // ★ `amount_frozen` says whether this subscriber's price is pinned or will follow the catalogue.
      //   A consumer computing the next invoice must not have to guess which.
      amount_frozen: snapshotAmountMinor !== null && snapshotAmountMinor !== undefined,
    },
  });
  return { id, contract_id: contractId };
}

/**
 * Cancel a subscription.
 * ★ `subscription_cancelled_shape` requires `cancelled_on` exactly when state is 'cancelled', so the
 *   two can never disagree — a cancelled subscription always says when.
 */
export async function cancelSubscription(
  tx, { tenantId, subscriptionId, onDate = null, atPeriodEnd = false, actorUserId = null }
) {
  if (atPeriodEnd) {
    // ★★ "Cancel at period end" is NOT cancellation. The subscription stays ACTIVE and keeps billing
    //    until the period closes; marking it cancelled now would stop the charge the customer still
    //    owes. Two different facts, two different writes.
    const r = await run(tx, db
      .updateTable("keystone.subscription")
      .set({ cancel_at_period_end: true, updated_at: sql`now()` })
      .where("id", "=", subscriptionId)
      .where("state", "=", "active")
      .returning("current_period_end"));
    if (r.rowCount === 0) throw conflict("only an active subscription can be set to cancel at period end");
    return { id: subscriptionId, cancel_at_period_end: true, current_period_end: r.rows[0].current_period_end };
  }

  const r = await run(tx, db
    .updateTable("keystone.subscription")
    .set({
      state: "cancelled",
      cancelled_on: sql`coalesce(${onDate}::date, CURRENT_DATE)`,
      updated_at: sql`now()`,
    })
    .where("id", "=", subscriptionId)
    .where("state", "<>", "cancelled")
    .returning(["plan_id", "app_user_id", "cancelled_on"]));
  // ★ Idempotent by predicate: a second cancel matches zero rows, so it cannot move `cancelled_on`.
  if (r.rowCount === 0) throw conflict("this subscription is already cancelled, or does not exist here");

  await emit(tx, {
    tenantId, topic: "money.subscription.cancelled", emittedBy: SECTION,
    subjectType: "subscription", subjectId: subscriptionId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: { plan_id: r.rows[0].plan_id, app_user_id: r.rows[0].app_user_id, cancelled_on: r.rows[0].cancelled_on },
  });
  return { id: subscriptionId, state: "cancelled", cancelled_on: r.rows[0].cancelled_on };
}

/**
 * Store a payment method reference.
 * ★★★ NO CARD DATA. `provider_payment_method_id`, a brand and FOUR DIGITS — nothing else, and nothing
 *     here accepts a number, a CVC or an expiry. The provider holds the instrument; this table holds a
 *     handle and enough to recognise it on a screen.
 */
export async function createPaymentMethod(tx, {
  tenantId, appUserId, providerPaymentMethodId, lastFour = null, brand = null, isDefault = false,
  actorUserId = null,
}) {
  if (!appUserId) throw invalid("appUserId is required");
  if (typeof providerPaymentMethodId !== "string" || !providerPaymentMethodId.trim()) {
    throw invalid("providerPaymentMethodId is required — this table stores a handle, never an instrument");
  }
  if (lastFour !== null && !/^[0-9]{4}$/.test(String(lastFour))) {
    throw invalid(`last_four must be exactly four digits or null — got ${JSON.stringify(lastFour)}`);
  }
  // ★★ REFUSE ANYTHING THAT LOOKS LIKE A FULL CARD NUMBER IN THE HANDLE FIELD. A caller passing a PAN
  //    where a token belongs would silently persist cardholder data in a table with no encryption and
  //    no PCI scope — the sort of thing discovered in an audit rather than in a test.
  if (/^[0-9]{12,19}$/.test(providerPaymentMethodId.replace(/[\s-]/g, ""))) {
    throw invalid(
      "providerPaymentMethodId looks like a card number, not a provider token — this table must never " +
      "hold cardholder data. Store the provider's payment-method id.");
  }

  const id = await newId(tx);
  // ★ SAVEPOINT: a unique violation aborts the whole transaction in Postgres. A replayed `payment_method.attached` webhook (Stripe redelivers) hits exactly this,
  //   and the caller (handlePaymentMethodEvent) swallows the conflict and goes on to UPDATE in the SAME transaction — which then died with "current transaction is
  //   aborted". Roll back to the savepoint so the conflict is reported and the transaction stays usable.
  await tx.query("SAVEPOINT create_payment_method");
  try {
    await run(tx, db.insertInto("keystone.payment_method").values({
      id: id ?? null, tenant_id: tenantId ?? null, app_user_id: appUserId ?? null,
      provider_payment_method_id: providerPaymentMethodId.trim() ?? null,
      last_four: lastFour ?? null, brand: brand ?? null, is_default: isDefault ?? null,
    }));
    await tx.query("RELEASE SAVEPOINT create_payment_method");
  } catch (e) {
    await tx.query("ROLLBACK TO SAVEPOINT create_payment_method").catch(() => {});
    if (e.code === UNIQUE_VIOLATION) {
      // ★ Idempotent in effect: the same provider id is already stored, which is success, not failure —
      //   but reported as a conflict so the caller knows it did not create a second row.
      throw conflict("this payment method is already stored for this organisation", { field: "provider_payment_method_id" });
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "money.payment_method.added", emittedBy: SECTION,
    subjectType: "payment_method", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ `last_four` and `brand` only. Putting the provider id in an append-only event table would
    //   scatter a credential-shaped value into a place nothing ever redacts.
    payload: { app_user_id: appUserId, last_four: lastFour, brand, is_default: isDefault },
  });
  return { id, last_four: lastFour, brand };
}

/**
 * ★★★ CREATE AN ENTITLEMENT AND ITS N CREDIT ROWS — §B4 STEP 6's "a credit is a ROW".
 *
 * ★★ N ROWS, NOT A COUNTER. A counter cannot answer "which session did that credit pay for", cannot be
 *    returned exactly once on cancellation, and races under concurrency. `credit_one_per_booking`
 *    (UNIQUE (tenant_id, booking_id)) makes "two credits for one booking" unrepresentable — which only
 *    works because credits are rows.
 * ★ All N are inserted in THIS transaction. An entitlement that exists with fewer credits than it
 *   promises is a customer short-changed, and there is no later moment at which the shortfall is
 *   visible as an error.
 */
export async function createEntitlement(tx, {
  tenantId, ownerUserId, serviceId, totalCredits, lineItemId = null, expiresAt = null,
  packageId = null, actorUserId = null,
  // ★ credits pipeline (0583): who the credits are FOR, where they came from, and `silent` — the invoice-paid grant emits ONE
  //   `money.entitlement.granted` for the whole purchase itself (a multi-service package must send one "package purchased" email, not one per service).
  beneficiaryUserId = null, grantSource = null, grantSourceId = null, silent = false,
}) {
  if (!ownerUserId) throw invalid("ownerUserId is required");
  if (!serviceId) throw invalid("serviceId is required");
  if (!Number.isInteger(totalCredits) || totalCredits <= 0) {
    throw invalid(`totalCredits must be a positive integer — got ${JSON.stringify(totalCredits)}`);
  }
  // ★ A sanity ceiling. Not a business rule — a guard against a bad multiplication upstream creating
  //   millions of rows in one transaction, which would look like a hang rather than a mistake.
  if (totalCredits > 1000) {
    throw invalid(`totalCredits of ${totalCredits} is implausible — refusing rather than writing that many rows`);
  }

  const id = await newId(tx);

  // Determine the expires_at value to insert. An explicitly-supplied expiresAt ALWAYS WINS over packageId.
  let expiresAtToInsert = expiresAt;
  if ((expiresAt === null || expiresAt === undefined) && packageId) {
    // Compute from package's expiry_months
    const pkgResult = await run(tx, db
      .selectFrom("keystone.package")
      .select("expiry_months")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", packageId));
    if (pkgResult.rows.length === 0) {
      throw invalid(`no package with id ${packageId} exists in this practice, so expiry_months cannot be resolved`);
    }
    const expiryMonths = pkgResult.rows[0].expiry_months;
    // If expiry_months is non-null, compute expires_at as now() + expiry_months months
    // If expiry_months is null, expires_at stays null (never expires)
    if (expiryMonths !== null) {
      // Use SQL to compute: now() + (expiry_months || ' months')::interval
      expiresAtToInsert = await run(tx, db.selectNoFrom(
        sql`(now() + (${expiryMonths}::int || ' months')::interval)::date`.as("expires_at")));
      expiresAtToInsert = expiresAtToInsert.rows[0].expires_at;
    }
  }

  await run(tx, db.insertInto("keystone.entitlement").values({
    id: id ?? null, tenant_id: tenantId ?? null, owner_user_id: ownerUserId ?? null, service_id: serviceId ?? null,
    total_credits: totalCredits ?? null, line_item_id: lineItemId ?? null, expires_at: expiresAtToInsert ?? null,
    ...(beneficiaryUserId ? { beneficiary_user_id: beneficiaryUserId } : {}),
    ...(grantSource ? { grant_source: grantSource, grant_source_id: grantSourceId } : {}),
  }));

  // ★★ ONE STATEMENT, N ROWS, via generate_series — so the count cannot drift from `total_credits` by
  //    a loop that exits early, and so a partial insert is impossible rather than merely unlikely.
  const ins = await run(tx, db
    .insertInto("keystone.entitlement_credit")
    .columns(["tenant_id", "entitlement_id", "status"])
    .expression(
      db.selectFrom(sql`generate_series(1, ${totalCredits})`.as("gs"))
        .select([
          sql`${tenantId}`.as("tenant_id"),
          sql`${id}`.as("entitlement_id"),
          sql`'available'`.as("status"),
        ])));
  if (ins.rowCount !== totalCredits) {
    // ★ Cannot normally happen; refused rather than trusted, because "an entitlement with fewer credits
    //   than it promises" is exactly the silent shortfall this function exists to prevent.
    throw invalid(`expected ${totalCredits} credit rows, wrote ${ins.rowCount} — refusing to leave a short entitlement`);
  }

  if (!silent) await emit(tx, {
    tenantId, topic: "money.entitlement.granted", emittedBy: SECTION,
    subjectType: "entitlement", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: {
      owner_user_id: ownerUserId, service_id: serviceId,
      total_credits: totalCredits, credits_written: ins.rowCount,
      expires_at: expiresAt, line_item_id: lineItemId,
    },
  });
  return { id, total_credits: totalCredits, credits_written: ins.rowCount };
}

/**
 * ★★★ B-2 (F799) — grantCredits: THE ONE WRITER FOR "A PURCHASE OR A CYCLE GRANTS CREDITS."
 *
 * ★ Three callers share this rather than each re-implementing "loop the lines, create an entitlement,
 *   remember where it came from": a package payment (`money.payment.succeeded`), a subscription
 *   invoice paid (`money.invoice.paid`), and a document-started plan's first cycle (which reaches here
 *   through that same `money.invoice.paid` path — `startClientSubscription` itself is unchanged).
 * ★★ IDEMPOTENT BY SOURCE, NOT BY LINE. A redelivered event or a retried listener must grant nothing
 *    twice. The check below is for the WHOLE grant this (source, sourceId) represents: if anything was
 *    already recorded for it, nothing more is granted on this call, because every line this call would
 *    grant was granted together the first time it ran. `entitlement`'s own
 *    `UNIQUE (tenant_id, owner_user_id, service_id, grant_source, grant_source_id)` (migration 0514) is
 *    the database's backstop if two calls ever race past this check.
 * ★ `lines` entries with `quantity === null` are UNLIMITED (`plan_line.quantity_per_cycle`'s own NULL,
 *   migration 0514) — nothing to grant, so they are skipped rather than turned into some large number.
 * ★ `createEntitlement` has no `grantSource`/`grantSourceId` parameters (its signature is unchanged by
 *   this task) — this function sets them with an UPDATE on the row it just created instead.
 */
export async function grantCredits(tx, {
  tenantId, ownerUserId, lines, source, sourceId, expiresAt = null, packageId = null,
}) {
  if (!ownerUserId) throw invalid("ownerUserId is required");
  if (!source) throw invalid("source is required");
  if (!sourceId) throw invalid("sourceId is required");

  // ★ Idempotent by source: a replay of the same (owner, source, sourceId) grants nothing twice.
  const already = await run(tx, db
    .selectFrom("keystone.entitlement")
    .select(sql`1`.as("one"))
    .where("tenant_id", "=", tenantId)
    .where("owner_user_id", "=", ownerUserId)
    .where("grant_source", "=", source)
    .where("grant_source_id", "=", sourceId)
    .limit(1));
  if (already.rows.length > 0) {
    return { entitlementIds: [] };
  }

  const entitlementIds = [];
  for (const { serviceId, quantity, expiresAt: lineExpiresAt } of lines) {
    if (quantity === null) continue; // NULL = unlimited — nothing to grant.
    // ★ B-2b — a line's own expiresAt (e.g. a subscription cycle's rollover-mode-derived value,
    //   which may deliberately be null) wins over the call-level expiresAt. `undefined` means the
    //   line carried no such field at all (the package leg), so the call-level value still applies.
    const effectiveExpiresAt = lineExpiresAt !== undefined ? lineExpiresAt : expiresAt;
    const granted = await createEntitlement(tx, {
      tenantId, ownerUserId, serviceId, totalCredits: quantity, expiresAt: effectiveExpiresAt, packageId,
    });
    await run(tx, db
      .updateTable("keystone.entitlement")
      .set({ grant_source: source ?? null, grant_source_id: sourceId ?? null })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", granted.id));
    entitlementIds.push(granted.id);
  }

  if (entitlementIds.length > 0) {
    await emit(tx, {
      tenantId, topic: "money.credit.granted", emittedBy: SECTION,
      subjectType: "entitlement", subjectId: entitlementIds[0],
      payload: { source, sourceId, lines },
    });
  }

  return { entitlementIds };
}

/**
 * ★ Mark an entitlement exhausted when its last credit is gone.
 * ★★ THE COUNT IS COMPUTED FROM THE ROWS, never passed in. A caller's idea of how many credits remain
 *    is a read that may already be stale; the rows are the truth.
 */
export async function refreshEntitlementStatus(tx, { tenantId, entitlementId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.entitlement_credit")
    .select([
      sql`count(*) FILTER (WHERE status = 'available')::int`.as("available"),
      sql`count(*)::int`.as("total"),
    ])
    .where("tenant_id", "=", tenantId)
    .where("entitlement_id", "=", entitlementId));
  if (rows[0].total === 0) throw notFound("no such entitlement in this organisation");

  if (rows[0].available > 0) return { id: entitlementId, status: "active", available: rows[0].available };

  const r = await run(tx, db
    .updateTable("keystone.entitlement")
    .set({ status: "exhausted", updated_at: sql`now()` })
    .where("id", "=", entitlementId)
    .where("status", "=", "active")
    .returning(["owner_user_id", "service_id"]));
  // ★ Already exhausted — no event, because nothing changed. Emitting again would put a second
  //   "you have run out" in the feed for one exhaustion.
  if (r.rowCount === 0) return { id: entitlementId, status: "exhausted", available: 0, emitted: false };

  await emit(tx, {
    tenantId, topic: "booking.entitlement.exhausted", emittedBy: "booking",
    subjectType: "entitlement", subjectId: entitlementId,
    // ★★ `emittedBy: "booking"` because THE TOPIC IS BOOKING'S — [MEASURED] the catalogue files
    //    `entitlement.exhausted` under `booking`, not `money`, and emit() refuses a cross-section
    //    topic (P15B.3). The fact belongs to whoever consumed the last credit, which is booking.
    payload: { owner_user_id: r.rows[0].owner_user_id, service_id: r.rows[0].service_id },
  });
  return { id: entitlementId, status: "exhausted", available: 0, emitted: true };
}

/**
 * ★★★ CREATE AN INVOICE. THIS FUNCTION EXISTS BECAUSE THE CENSUS CAUGHT ITS ABSENCE — D-15B.14b.
 *
 * [EXECUTED 2026-09-13] `keystone.invoice` was UPDATED by `payments/webhook.mjs` (marking it paid) and
 * **INSERTED BY NOTHING**. So an invoice could be marked paid and could never come into existence: the
 * webhook's `UPDATE … SET status='paid'` matched zero rows, forever, and an UPDATE that affects nothing
 * is not an error.
 *   ★★ IT PASSED THE FIRST VERSION OF THE TABLE CENSUS because that census accepted an UPDATE as "a
 *      write path". **A table that can be changed but never created is exactly as unreachable as one
 *      nothing writes, and harder to see** — the grep for "a write" succeeds. The census now checks
 *      INSERT separately.
 *   ★ It also made P15B.15's final step ("an invoice exists") unreachable, which is how it surfaced.
 *
 * ★ `amount_minor` is the invoice's own total and is NOT derived from its line items here: lines are
 *   added afterwards, and a total recomputed on every line change would drift from what was issued.
 *   An issued invoice's total is a statement, not a running sum.
 */
export async function createInvoice(tx, {
  tenantId, payerUserId, amountMinor, currency = "USD", status = "draft",
  // ★★ P2.6 — the canonical additions. All optional, because an invoice raised by the Stripe webhook
  //    path has none of them and is still a real invoice.
  subtotalMinor = 0, taxMinor = 0, discountMinor = 0, memo = null,
  billingLine1 = null, billingLine2 = null, billingCity = null,
  billingStateRegion = null, billingPostcode = null, billingCountry = null,
  // ★★★ `undefined` vs `null` AGAIN, and the same rule P2.5 settled: unset means "use the
  //     practice's terms"; an explicit null means "no deadline" and is honoured. A draft or an
  //     invoice settled at the point of sale genuinely has no due date, and collapsing the two would
  //     make that unsayable.
  paymentTermsDays,
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ FIX ROUND 2, F494 — `createdBy` IS GONE. It used to be its own parameter, populated
  //     straight from the request body via `routes/writes.mjs`'s `{ ...body }` spread — so
  //     `POST /api/money/invoices` could name ANY user id as the one who created an invoice.
  //     `actorUserId` (the session id `routes/writes.mjs:230` stamps LAST, after the body spread,
  //     so a body cannot override it) is now the ONLY source for `invoice.created_by`, exactly as
  //     round 1 fixed `archiveRecord`'s `actorId` and `setStaffRole`'s `changedByUserId`. A body
  //     that still sends `createdBy` is simply not read under any name.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  actorUserId = null,
  // ★ Stage 15 task 15.5 — draft editing and reminders
  title = null, message = null, source = "staff", reminderDays = undefined,
  saveCardOffered = false, customFields = {},
}) {
  if (!payerUserId) throw invalid("payerUserId is required — an invoice is addressed to somebody");
  assertMinor("amount_minor", amountMinor);
  assertMinor("subtotal_minor", subtotalMinor);
  assertMinor("tax_minor", taxMinor);
  assertMinor("discount_minor", discountMinor);
  if (!INVOICE_STATUSES.includes(status)) {
    throw invalid(`status must be one of ${INVOICE_STATUSES.join(", ")} — got ${JSON.stringify(status)}`);
  }

  const terms = paymentTermsDays === undefined
    ? await getSetting(tx, PAYMENT_TERMS_SETTING_KEY, DEFAULT_PAYMENT_TERMS_DAYS)
    : paymentTermsDays;
  if (terms !== null && (!Number.isInteger(terms) || terms < 0)) {
    throw invalid(`payment terms must be a whole number of days, or null for no deadline — got ${JSON.stringify(terms)}`);
  }

  const id = await newId(tx);
  const number = await nextInvoiceNumber(tx, tenantId);

  // ★ Stage 15 task 15.5 — resolve reminder days from practice setting if not provided
  const resolvedReminderDays = reminderDays === undefined
    ? await getSetting(tx, 'money.reminder_days', MONEY_DEFAULTS['money.reminder_days'])
    : reminderDays;

  try {
    await run(tx, db.insertInto("keystone.invoice").values({
      id: id ?? null, tenant_id: tenantId ?? null, payer_user_id: payerUserId ?? null, amount_minor: amountMinor ?? null, currency: currency ?? null, status: status ?? null,
      invoice_number: number ?? null, payment_terms_days: terms ?? null,
      // ★★ THE DUE DATE IS COMPUTED HERE AND STORED, not derived on read. The terms may change
      //    next month; the deadline on an invoice already sent must not move with them.
      due_at: sql`CASE WHEN ${terms}::int IS NULL THEN NULL ELSE now() + (${terms}::int * interval '1 day') END`,
      subtotal_minor: subtotalMinor ?? null, tax_minor: taxMinor ?? null, discount_minor: discountMinor ?? null, memo: memo ?? null,
      created_by: actorUserId ?? null,
      billing_line1: billingLine1 ?? null, billing_line2: billingLine2 ?? null, billing_city: billingCity ?? null,
      billing_state_region: billingStateRegion ?? null, billing_postcode: billingPostcode ?? null,
      billing_country: billingCountry ?? null,
      title: title ?? null, message: message ?? null,
      issued_at: sql`CASE WHEN ${status} = 'open' THEN now() ELSE NULL END`,
      source: source ?? null, save_card_offered: saveCardOffered ?? null, custom_fields: JSON.stringify(customFields) ?? null,
    }));
  } catch (e) {
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this invoice: ${e.constraint ?? e.message}`);
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "money.invoice.opened", emittedBy: SECTION,
    subjectType: "invoice", subjectId: id,
    // ★ FIX ROUND 2 — same session id as the row's `created_by` column now (see the parameter's
    //   own comment above): one fact, one source, never the body.
    actor: userActor(actorUserId),
    // ★ The NUMBER travels in the payload: `money.invoice_issued` requires it, and a consumer that
    //   had to re-read the row to find out what to call the invoice would be reading at a different
    //   instant from the one that caused it.
    payload: {
      payer_user_id: payerUserId, amount_minor: amountMinor, currency, status,
      invoice_number: number,
    },
  });

  // ★ NEW (B3.1): Create invoice notification for admins. The notification is for "invoice overdue"
  //   but is triggered on opening because overdue is a state reached by time passage, not an event
  //   (see src/notifications/topics.mjs comment for money.invoice.opened).
  {
    // Query for the event ID just emitted (UUID v7 ordered)
    const eventResult = await run(tx, db
      .selectFrom("keystone.event")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("subject_id", "=", id)
      .where("topic", "=", "money.invoice.opened")
      .orderBy("id", "desc")
      .limit(1));
    const eventId = eventResult.rows[0]?.id;

    if (eventId) {
      // Query for practice admins/owners to notify
      const adminsResult = await run(tx, db
        .selectFrom("keystone.app_user")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("role", "=", "staff")
        .where("staff_role", "in", ["owner", "admin"]));

      // Create notifications for each admin
      for (const admin of adminsResult.rows) {
        try {
          await createNotification(tx, {
            tenantId,
            recipientId: admin.id,
            eventId,
            topic: "money.invoice.opened",
            title: "Invoice created",
            body: `Invoice #${number} for ${(amountMinor / 100).toFixed(2)} ${currency} has been created.`,
          });
        } catch (e) {
          // Log but don't fail — notification should not block the invoice creation
          console.error("Failed to create notification for invoice opening:", e.message);
        }
      }
    }
  }

  // ★ Stage 15 task 15.5 — create reminder rows for open invoices
  if (status === 'open' && resolvedReminderDays && Array.isArray(resolvedReminderDays)) {
    for (const offsetDays of resolvedReminderDays) {
      await run(tx, db
        .insertInto("keystone.invoice_reminder")
        .values({ tenant_id: tenantId ?? null, invoice_id: id ?? null, offset_days: offsetDays ?? null })
        .onConflict((oc) => oc.columns(["invoice_id", "offset_days"]).doNothing()));
    }
  }

  return { id, amount_minor: amountMinor, currency, status, invoice_number: number };
}

/**
 * Create or update a refund row (idempotent on Stripe id for webhook redelivery).
 * ★★ Called by B1.4 webhook handlers. ON CONFLICT ensures webhook redelivery does not
 *    create duplicate rows — the same stripe_id is either inserted once or updated.
 */
export async function createOrUpdateRefund(tx, {
  tenantId, stripeId, amountMinor, state, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!stripeId || typeof stripeId !== "string") throw invalid("stripeId is required — use the Stripe refund id");
  assertMinor("amount_minor", amountMinor, { allowZero: true });
  if (!["pending", "succeeded", "failed"].includes(state)) {
    throw invalid(`state must be one of pending, succeeded, failed — got ${JSON.stringify(state)}`);
  }

  // ★ Capture the before state for audit purposes
  const existing = await run(tx, db
    .selectFrom("keystone.refund")
    .select(["id", "amount_minor", "state"])
    .where("tenant_id", "=", tenantId)
    .where("stripe_id", "=", stripeId));
  const beforeState = existing.rows.length > 0
    ? { amount_minor: existing.rows[0].amount_minor, state: existing.rows[0].state }
    : null;

  const id = await newId(tx);
  const result = await run(tx, db
    .insertInto("keystone.refund")
    .values({ id: id ?? null, tenant_id: tenantId ?? null, stripe_id: stripeId ?? null, amount_minor: amountMinor ?? null, state: state ?? null })
    .onConflict((oc) => oc
      .columns(["tenant_id", "stripe_id"])
      .doUpdateSet({ amount_minor: amountMinor ?? null, state: state ?? null, updated_at: sql`now()` }))
    .returning(["id", "stripe_id", "amount_minor", "state"]));

  const row = result.rows[0];
  await emit(tx, {
    tenantId, topic: "money.refund.recorded", emittedBy: SECTION,
    subjectType: "refund", subjectId: row.id,
    actor: userActor(actorUserId),
    payload: {
      stripe_id: row.stripe_id, amount_minor: row.amount_minor, state: row.state,
    },
  });

  // ★ NEW (B3.1): Emit notification event when refund fails and create notifications for admins.
  //   Only emit when state becomes "failed", not on subsequent calls with the same state.
  if (row.state === "failed" && (!beforeState || beforeState.state !== "failed")) {
    // Emit the payment failure event
    await emit(tx, {
      tenantId, topic: "money.payment.failed", emittedBy: SECTION,
      subjectType: "payment", subjectId: row.id,
      actor: userActor(actorUserId),
      payload: { stripe_id: row.stripe_id, amount_minor: row.amount_minor },
    });

    // Query for the event ID just emitted (UUID v7 ordered)
    const eventResult = await run(tx, db
      .selectFrom("keystone.event")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("subject_id", "=", row.id)
      .where("topic", "=", "money.payment.failed")
      .orderBy("id", "desc")
      .limit(1));
    const eventId = eventResult.rows[0]?.id;

    if (eventId) {
      // Query for practice admins/owners to notify
      const adminsResult = await run(tx, db
        .selectFrom("keystone.app_user")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("role", "=", "staff")
        .where("staff_role", "in", ["owner", "admin"]));

      // Create notifications for each admin
      for (const admin of adminsResult.rows) {
        try {
          await createNotification(tx, {
            tenantId,
            recipientId: admin.id,
            eventId,
            topic: "money.payment.failed",
            title: "Payment refund failed",
            body: `A refund of ${(row.amount_minor / 100).toFixed(2)} failed. Check Stripe for details.`,
          });
        } catch (e) {
          // Log but don't fail — notification should not block the state update
          console.error("Failed to create notification for refund failure:", e.message);
        }
      }
    }
  }

  await writeAudit(tx, {
    tenantId,
    action: "settings.changed",
    object: "money.refund",
    subjectId: row.id,
    before: beforeState,
    after: { amount_minor: row.amount_minor, state: row.state },
    actorUserId: actorUserId ?? null,
  });
  return { id: row.id, stripe_id: row.stripe_id, amount_minor: row.amount_minor, state: row.state };
}

/**
 * Create or update a payout row (idempotent on Stripe id for webhook redelivery).
 * ★★ Called by B1.4 webhook handlers. ON CONFLICT ensures webhook redelivery does not
 *    create duplicate rows — the same stripe_id is either inserted once or updated.
 */
export async function createOrUpdatePayout(tx, {
  tenantId, stripeId, amountMinor, state, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!stripeId || typeof stripeId !== "string") throw invalid("stripeId is required — use the Stripe payout id");
  assertMinor("amount_minor", amountMinor, { allowZero: true });
  if (!["pending", "in_transit", "paid", "failed", "cancelled"].includes(state)) {
    throw invalid(`state must be one of pending, in_transit, paid, failed, cancelled — got ${JSON.stringify(state)}`);
  }

  // ★ Capture the before state for audit purposes
  const existing = await run(tx, db
    .selectFrom("keystone.payout")
    .select(["id", "amount_minor", "state"])
    .where("tenant_id", "=", tenantId)
    .where("stripe_id", "=", stripeId));
  const beforeState = existing.rows.length > 0
    ? { amount_minor: existing.rows[0].amount_minor, state: existing.rows[0].state }
    : null;

  const id = await newId(tx);
  const result = await run(tx, db
    .insertInto("keystone.payout")
    .values({ id: id ?? null, tenant_id: tenantId ?? null, stripe_id: stripeId ?? null, amount_minor: amountMinor ?? null, state: state ?? null })
    .onConflict((oc) => oc
      .columns(["tenant_id", "stripe_id"])
      .doUpdateSet({ amount_minor: amountMinor ?? null, state: state ?? null, updated_at: sql`now()` }))
    .returning(["id", "stripe_id", "amount_minor", "state"]));

  const row = result.rows[0];
  await emit(tx, {
    tenantId, topic: "money.payout.recorded", emittedBy: SECTION,
    subjectType: "payout", subjectId: row.id,
    actor: userActor(actorUserId),
    payload: {
      stripe_id: row.stripe_id, amount_minor: row.amount_minor, state: row.state,
    },
  });

  // ★ NEW (B3.1): Emit notification event when payout fails and create notifications for admins.
  //   Only emit when state becomes "failed", not on subsequent calls with the same state.
  if (row.state === "failed" && (!beforeState || beforeState.state !== "failed")) {
    // Emit the payout failure event
    await emit(tx, {
      tenantId, topic: "money.payout.failed", emittedBy: SECTION,
      subjectType: "payout", subjectId: row.id,
      actor: userActor(actorUserId),
      payload: { stripe_id: row.stripe_id, amount_minor: row.amount_minor },
    });

    // Query for the event ID just emitted (UUID v7 ordered)
    const eventResult = await run(tx, db
      .selectFrom("keystone.event")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("subject_id", "=", row.id)
      .where("topic", "=", "money.payout.failed")
      .orderBy("id", "desc")
      .limit(1));
    const eventId = eventResult.rows[0]?.id;

    if (eventId) {
      // Query for practice admins/owners to notify
      const adminsResult = await run(tx, db
        .selectFrom("keystone.app_user")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("role", "=", "staff")
        .where("staff_role", "in", ["owner", "admin"]));

      // Create notifications for each admin
      for (const admin of adminsResult.rows) {
        try {
          await createNotification(tx, {
            tenantId,
            recipientId: admin.id,
            eventId,
            topic: "money.payout.failed",
            title: "Payout failed",
            body: `A payout of ${(row.amount_minor / 100).toFixed(2)} failed. Check Stripe for details.`,
          });
        } catch (e) {
          // Log but don't fail — notification should not block the state update
          console.error("Failed to create notification for payout failure:", e.message);
        }
      }
    }
  }

  await writeAudit(tx, {
    tenantId,
    action: "settings.changed",
    object: "money.payout",
    subjectId: row.id,
    before: beforeState,
    after: { amount_minor: row.amount_minor, state: row.state },
    actorUserId: actorUserId ?? null,
  });
  return { id: row.id, stripe_id: row.stripe_id, amount_minor: row.amount_minor, state: row.state };
}

/**
 * Create or update a dispute row (idempotent on Stripe id for webhook redelivery).
 * ★★ Called by B1.4 webhook handlers. ON CONFLICT ensures webhook redelivery does not
 *    create duplicate rows — the same stripe_id is either inserted once or updated.
 */
export async function createOrUpdateDispute(tx, {
  tenantId, stripeId, amountMinor, state, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!stripeId || typeof stripeId !== "string") throw invalid("stripeId is required — use the Stripe dispute id");
  assertMinor("amount_minor", amountMinor, { allowZero: true });
  if (!["warning_under_review", "under_review", "evidence_submitted", "won", "lost"].includes(state)) {
    throw invalid(`state must be one of warning_under_review, under_review, evidence_submitted, won, lost — got ${JSON.stringify(state)}`);
  }

  // ★ Capture the before state for audit purposes
  const existing = await run(tx, db
    .selectFrom("keystone.dispute")
    .select(["id", "amount_minor", "state"])
    .where("tenant_id", "=", tenantId)
    .where("stripe_id", "=", stripeId));
  const beforeState = existing.rows.length > 0
    ? { amount_minor: existing.rows[0].amount_minor, state: existing.rows[0].state }
    : null;

  const id = await newId(tx);
  const result = await run(tx, db
    .insertInto("keystone.dispute")
    .values({ id: id ?? null, tenant_id: tenantId ?? null, stripe_id: stripeId ?? null, amount_minor: amountMinor ?? null, state: state ?? null })
    .onConflict((oc) => oc
      .columns(["tenant_id", "stripe_id"])
      .doUpdateSet({ amount_minor: amountMinor ?? null, state: state ?? null, updated_at: sql`now()` }))
    .returning(["id", "stripe_id", "amount_minor", "state"]));

  const row = result.rows[0];
  await emit(tx, {
    tenantId, topic: "money.dispute.recorded", emittedBy: SECTION,
    subjectType: "dispute", subjectId: row.id,
    actor: userActor(actorUserId),
    payload: {
      stripe_id: row.stripe_id, amount_minor: row.amount_minor, state: row.state,
    },
  });

  // ★ NEW (B3.1): Emit notification event when dispute opens and create notifications for admins.
  //   "opened" means the state transitions to "under_review" (not just a warning).
  if (row.state === "under_review" && (!beforeState || beforeState.state !== "under_review")) {
    // Emit the dispute opened event
    await emit(tx, {
      tenantId, topic: "money.dispute.opened", emittedBy: SECTION,
      subjectType: "dispute", subjectId: row.id,
      actor: userActor(actorUserId),
      payload: { stripe_id: row.stripe_id, amount_minor: row.amount_minor },
    });

    // Query for the event ID just emitted (UUID v7 ordered)
    const eventResult = await run(tx, db
      .selectFrom("keystone.event")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("subject_id", "=", row.id)
      .where("topic", "=", "money.dispute.opened")
      .orderBy("id", "desc")
      .limit(1));
    const eventId = eventResult.rows[0]?.id;

    if (eventId) {
      // Query for practice admins/owners to notify
      const adminsResult = await run(tx, db
        .selectFrom("keystone.app_user")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("role", "=", "staff")
        .where("staff_role", "in", ["owner", "admin"]));

      // Create notifications for each admin
      for (const admin of adminsResult.rows) {
        try {
          await createNotification(tx, {
            tenantId,
            recipientId: admin.id,
            eventId,
            topic: "money.dispute.opened",
            title: "Payment dispute opened",
            body: `A payment dispute has been opened for an amount of ${(row.amount_minor / 100).toFixed(2)}. Check Stripe for details.`,
          });
        } catch (e) {
          // Log but don't fail — notification should not block the state update
          console.error("Failed to create notification for dispute opening:", e.message);
        }
      }
    }
  }

  await writeAudit(tx, {
    tenantId,
    action: "settings.changed",
    object: "money.dispute",
    subjectId: row.id,
    before: beforeState,
    after: { amount_minor: row.amount_minor, state: row.state },
    actorUserId: actorUserId ?? null,
  });
  return { id: row.id, stripe_id: row.stripe_id, amount_minor: row.amount_minor, state: row.state };
}
