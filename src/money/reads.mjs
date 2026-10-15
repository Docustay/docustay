// @ts-check
// Stage 15 task 15.28 — money reads layer
//
// Read models for money surfaces: invoices, payments, subscriptions, credits, estimates.
// Every function runs under the caller's OWN viewer — respecting RLS, never asPracticeOwner.
// Returns include `mirrorAsOf`: the newest `updated_at` among mirror rows read.

import { refundCostSentence } from "./refunds.mjs";
// ★ L3 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same joins, same ordering/limits, same
//   parameterization). `sql` is the escape hatch for what the builder itself does not express —
//   FILTER, ANY(...), casts, interval arithmetic — per the L3 per-file ruling: "SQL that calls
//   plpgsql or uses features the builder lacks stays as sql`…` through run".
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const STRIPE_US_RATES = Object.freeze({
  online:    { pct: 2.9, fixed: 30 },
  typed:     { pct: 3.4, fixed: 30 },
  in_person: { pct: 2.7, fixed: 5 },
  bank:      { pct: 0.8, capMinor: 500 },
});

/**
 * ★ COMPUTE STRIPE FEE MINORS for the given amount under a given method.
 * Uses the published US rates. Applied only to comparison rows (elsewhere).
 */
function stripeFeesMinor(amountMinor, method = "online") {
  const rate = STRIPE_US_RATES[method];
  if (!rate) return 0;

  let feeMinor = Math.ceil((amountMinor * rate.pct) / 100) + (rate.fixed ?? 0);
  if (rate.capMinor && feeMinor > rate.capMinor) {
    feeMinor = rate.capMinor;
  }
  return feeMinor;
}

/**
 * invoicesSummary: summary stats across all invoices.
 * @returns {outstandingMinor, outstandingCount, lateMinor, lateCount, lateNamed, avgDaysToPaid, termsDays, fiveOpens, mirrorAsOf}
 */
export async function invoicesSummary(tx, { tenantId, now = new Date(), ...filters }) {
  // ★ STRIPE-MIRROR (specs/STRIPE-MIRROR.md §4(e)): status and what is still owed come from
  //   keystone.invoice_effective (Stripe's own status / amount_remaining), never the platform's cached
  //   columns. keystone.invoice is LEFT-joined only for the platform-owned facts (due_at, updated_at) —
  //   a Stripe-only invoice (origin='stripe') has no base row, so it counts as open but never late.
  const { rows: summaryRows } = await run(tx, db
    .selectFrom("keystone.invoice_effective as ie")
    .leftJoin("keystone.invoice as i", (join) => join
      .onRef("i.tenant_id", "=", "ie.tenant_id")
      .onRef("i.id", "=", "ie.id"))
    .select([
      sql`COALESCE(SUM(ie.amount_remaining_minor) FILTER (WHERE ie.status = 'open'), 0)::integer`.as("outstanding_minor"),
      sql`COUNT(*) FILTER (WHERE ie.status = 'open')::integer`.as("outstanding_count"),
      sql`COALESCE(SUM(ie.amount_remaining_minor) FILTER (WHERE ie.status = 'open' AND i.due_at < ${sql.val(now)}), 0)::integer`.as("late_minor"),
      sql`COUNT(*) FILTER (WHERE ie.status = 'open' AND i.due_at < ${sql.val(now)})::integer`.as("late_count"),
      sql`MAX(GREATEST(i.updated_at, ie.mirror_synced_at))`.as("mirror_as_of"),
    ])
    .where("ie.tenant_id", "=", tenantId)
    .where("ie.status", "in", ["open", "paid"]));

  const summary = summaryRows[0] || {};

  // Get the latest overdue invoice for lateNamed
  let lateNamed = null;
  if (summary.late_count > 0) {
    const { rows: lateRows } = await run(tx, db
      .selectFrom("keystone.invoice_effective as ie")
      .innerJoin("keystone.invoice as i", (join) => join
        .onRef("i.tenant_id", "=", "ie.tenant_id")
        .onRef("i.id", "=", "ie.id"))
      .innerJoin("keystone.app_user as u", (join) => join
        .onRef("u.tenant_id", "=", "ie.tenant_id")
        .onRef("u.id", "=", "ie.payer_user_id"))
      .select(["ie.id", "i.due_at", "u.display_name"])
      .where("ie.tenant_id", "=", tenantId)
      .where("ie.status", "=", "open")
      .where("i.due_at", "<", now)
      .orderBy("i.due_at", "asc")
      .limit(1));

    if (lateRows.length > 0) {
      const late = lateRows[0];
      const daysLate = Math.floor((now - late.due_at) / (1000 * 60 * 60 * 24));
      lateNamed = { name: late.display_name, days: daysLate, invoiceId: late.id };
    }
  }

  // Average days to paid (from issued_at to paid_at, derived from paid_minor update)
  // ★ STRIPE-MIRROR: "paid" and WHEN it was paid are Stripe's (invoice_effective.paid_at); the cached
  //   updated_at is only the fallback for a paid invoice the mirror has no paid_at for.
  const { rows: avgRows } = await run(tx, db
    .selectFrom("keystone.invoice_effective as ie")
    .innerJoin("keystone.invoice as i", (join) => join
      .onRef("i.tenant_id", "=", "ie.tenant_id")
      .onRef("i.id", "=", "ie.id"))
    .select(sql`AVG(EXTRACT(DAY FROM (COALESCE(ie.paid_at, i.updated_at) - COALESCE(i.issued_at, i.created_at))))::integer`.as("avg_days"))
    .where("ie.tenant_id", "=", tenantId)
    .where("ie.status", "=", "paid")
    .where("i.issued_at", "is not", null));

  const avgDaysToPaid = avgRows[0]?.avg_days || null;

  // Terms days (derived from due_at - period_end or issued_at, averaged)
  const { rows: termsRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(sql`AVG(EXTRACT(DAY FROM (due_at - COALESCE(period_end, issued_at, created_at))))::integer`.as("terms_days"))
    .where("tenant_id", "=", tenantId)
    .where("due_at", "is not", null));

  const termsDays = termsRows[0]?.terms_days || null;

  // ★ "Opened five times without paying" — unpaid invoices the payer has opened at least five times.
  //   (The first draft returned the five most-viewed invoices of any status, even at zero views, and
  //   the screen told the practice each of them had been opened five times.)
  const { rows: fiveRows } = await run(tx, db
    .selectFrom("keystone.invoice_effective as ie")
    .innerJoin("keystone.invoice as i", (join) => join
      .onRef("i.tenant_id", "=", "ie.tenant_id")
      .onRef("i.id", "=", "ie.id"))
    .innerJoin("keystone.app_user as u", (join) => join
      .onRef("u.id", "=", "ie.payer_user_id")
      .onRef("u.tenant_id", "=", "ie.tenant_id"))
    .select(["ie.id", "ie.invoice_number", "i.view_count", "u.display_name as payer_name"])
    .where("ie.tenant_id", "=", tenantId)
    .where("ie.status", "=", "open")
    .where("i.view_count", ">=", 5)
    .orderBy("i.view_count", "desc")
    .limit(5));

  const fiveOpens = fiveRows.map(r => ({
    invoiceId: r.id,
    number: r.invoice_number,
    name: r.payer_name,
    views: r.view_count
  }));

  return {
    outstandingMinor: summary.outstanding_minor || 0,
    outstandingCount: summary.outstanding_count || 0,
    lateMinor: summary.late_minor || 0,
    lateCount: summary.late_count || 0,
    lateNamed,
    avgDaysToPaid,
    termsDays,
    fiveOpens,
    mirrorAsOf: summary.mirror_as_of || new Date(),
  };
}

/**
 * invoiceRecord: full record view for one invoice with timeline.
 * @returns {id, payer, amount, ...header fields, timeline: [], cardOnFile, planOffered, mirrorAsOf}
 */
export async function invoiceRecord(tx, { tenantId, invoiceId }) {
  // ★ STRIPE-MIRROR: start FROM invoice_effective — status / amount / paid / number are Stripe's, and a
  //   Stripe-only invoice (origin='stripe', md5-derived id) exists ONLY in the view. keystone.invoice is
  //   LEFT-joined for the platform-owned columns (period, due/issued, title, message, views, tip); for a
  //   Stripe-only invoice those are NULL and the mirror's sync time stands in for updated_at.
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice_effective as ie")
    .leftJoin("keystone.invoice as i", (join) => join
      .onRef("i.tenant_id", "=", "ie.tenant_id")
      .onRef("i.id", "=", "ie.id"))
    .innerJoin("keystone.app_user as u", (join) => join
      .onRef("u.tenant_id", "=", "ie.tenant_id")
      .onRef("u.id", "=", "ie.payer_user_id"))
    .select([
      "ie.id", "ie.payer_user_id", "u.display_name as payer_name",
      "ie.amount_minor", "ie.currency", "ie.status", "ie.invoice_number", "ie.paid_minor",
      "ie.invoice_pdf_url",
      "i.period_start", "i.period_end", "i.due_at", "i.issued_at", "i.created_at",
      sql`COALESCE(i.updated_at, ie.mirror_synced_at)`.as("updated_at"),
      "i.title", "i.message", "i.view_count", "i.tip_minor",
    ])
    .where("ie.tenant_id", "=", tenantId)
    .where("ie.id", "=", invoiceId));

  if (invoiceRows.length === 0) return null;

  const invoice = invoiceRows[0];

  // Build timeline: sent events, views, reminders sent, payments, refunds
  const { rows: timelineRows } = await run(tx, db
    .selectFrom("keystone.event as e")
    .select([
      sql.lit("sent").as("type"),
      "e.created_at as timestamp",
      sql`NULL::text`.as("detail"),
    ])
    .where("e.tenant_id", "=", tenantId)
    .where("e.subject_type", "=", "invoice")
    .where("e.subject_id", "=", invoiceId)
    .where("e.topic", "=", "money.invoice.opened")
    .unionAll(db
      .selectFrom("keystone.invoice as i")
      .select([
        sql.lit("view").as("type"),
        "i.viewed_at as timestamp",
        sql`NULL::text`.as("detail"),
      ])
      .where("i.tenant_id", "=", tenantId)
      .where("i.id", "=", invoiceId)
      .where("i.viewed_at", "is not", null))
    .unionAll(db
      .selectFrom("keystone.invoice_reminder as ir")
      .select([
        sql.lit("reminder").as("type"),
        "ir.sent_at as timestamp",
        sql`NULL::text`.as("detail"),
      ])
      .where("ir.tenant_id", "=", tenantId)
      .where("ir.invoice_id", "=", invoiceId)
      .where("ir.sent_at", "is not", null))
    .unionAll(db
      .selectFrom("keystone.payment_effective as p")
      .select([
        sql.lit("payment").as("type"),
        "p.created_at as timestamp",
        sql`CAST(p.amount_minor AS text)`.as("detail"),
      ])
      .where("p.tenant_id", "=", tenantId)
      .where("p.invoice_id", "=", invoiceId)
      // ★ STRIPE-MIRROR: payment_effective derives 'refunded'/'partially_refunded' from the charge;
      //   money that came in and was later refunded is still a payment on the timeline (the refund row
      //   below is the other half), so every received status counts, exactly as 'succeeded' did.
      .where("p.status", "in", ["succeeded", "partially_refunded", "refunded"]))
    .unionAll(db
      .selectFrom("keystone.refund_effective as r")
      .innerJoin("keystone.payment_effective as p", (join) => join
        .onRef("p.tenant_id", "=", "r.tenant_id")
        .onRef("p.id", "=", "r.payment_id"))
      .select([
        sql.lit("refund").as("type"),
        "r.created_at as timestamp",
        sql`CAST(r.amount_minor AS text)`.as("detail"),
      ])
      .where("r.tenant_id", "=", tenantId)
      .where("p.invoice_id", "=", invoiceId))
    .orderBy("timestamp", "desc"));

  // ★ the maintainer, 1 Oct 2026 — Part 3's card audit: "Paid with Visa •••• 4242" on MoneyInvoiceRecord.
  //   Not addable to the "payment" branch of the UNION ALL above directly — every branch of a
  //   UNION ALL must share one column list, and the other four branches have no card to offer.
  //   Keyed by `created_at` (millisecond-precision, matches the union's own `p.created_at` exactly
  //   since both read the same column) rather than by payment id, because the timeline above never
  //   selected the payment's id — changing that query's shape for every branch was a bigger diff
  //   than this fix needed.
  const { rows: paymentCardRows } = await run(tx, db
    .selectFrom("keystone.payment_effective")
    .select(["created_at", "card_brand", "card_last_four"])
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId)
    .where("status", "in", ["succeeded", "partially_refunded", "refunded"]));
  const cardByTimestamp = new Map(
    paymentCardRows.map((p) => [new Date(p.created_at).getTime(), p])
  );

  const timeline = timelineRows.map(row => {
    const card = row.type === "payment" ? cardByTimestamp.get(new Date(row.timestamp).getTime()) : null;
    return {
      type: row.type,
      timestamp: row.timestamp,
      detail: row.detail,
      cardBrand: card?.card_brand ?? null,
      cardLastFour: card?.card_last_four ?? null,
    };
  });

  // Check if payer has card on file
  // ★ FIX, 1 Oct 2026 (saved-card brief, Part 6) — `detached_at IS NULL` was missing; see
  //   recordTabs.mjs's own note on the same class of bug.
  // ★ STRIPE-MIRROR: "has a card" reads person_card_effective (Stripe's payment methods; already
  //   excludes detached ones), not the platform's own payment_method cache.
  const { rows: cardRows } = await run(tx, db
    .selectFrom("keystone.person_card_effective")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("app_user_id", "=", invoice.payer_user_id)
    .where("is_default", "=", true)
    .limit(1));

  const cardOnFile = cardRows.length > 0;

  // Check if a payment plan has been offered (target shape for CT-F08 / payment plans)
  const { rows: planRows } = await run(tx, db
    .selectFrom("keystone.subscription_schedule")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId)
    .limit(1));

  const planOffered = planRows.length > 0;

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    payer: invoice.payer_name,
    payerId: invoice.payer_user_id,
    amount: invoice.amount_minor,
    currency: invoice.currency,
    status: invoice.status,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    dueAt: invoice.due_at,
    issuedAt: invoice.issued_at,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
    title: invoice.title,
    message: invoice.message,
    viewCount: invoice.view_count,
    tipMinor: invoice.tip_minor,
    paidMinor: invoice.paid_minor,
    // ★ STRIPE-MIRROR: Stripe's own PDF link — GET /api/money/invoices/:id/pdf reads exactly this key
    //   (it was never returned before, so that route always answered "not available").
    invoice_pdf_url: invoice.invoice_pdf_url ?? null,
    timeline,
    cardOnFile,
    planOffered,
    mirrorAsOf: invoice.updated_at,
  };
}

/**
 * paymentsList: filtered list of payments with summary stats.
 * @param {tx, {tenantId, range, method, state, ...filters}}
 * @returns {summary: {takenMinor, count, refunded, disputed, failed, feesMinor, byMethod}, rows, mirrorAsOf}
 */
export async function paymentsList(tx, { tenantId, range, method, state, ...filters }) {
  // ★ The same filters apply to the summary, by-method and rows queries below — built once here,
  //   same WHERE semantics as the original hand-joined whereFrags string.
  const filtered = (qb) => qb
    .where("p.tenant_id", "=", tenantId)
    .$if(!!method, (q) => q.where("p.method", "=", method))
    .$if(!!state, (q) => q.where("p.status", "=", state))
    .$if(!!(range && range.from), (q) => q.where("p.created_at", ">=", range.from))
    .$if(!!(range && range.to), (q) => q.where("p.created_at", "<=", range.to));

  // ★ STRIPE-MIRROR: every read below is keystone.payment_effective (Stripe's charges of a known person,
  //   plus the platform-only manual/credit payments) — a charge the platform never recorded now shows here.
  // Summary stats
  const { rows: summaryRows } = await run(tx, filtered(db
    .selectFrom("keystone.payment_effective as p"))
    .select([
      sql`COALESCE(SUM(amount_minor), 0)::integer`.as("taken_minor"),
      sql`COUNT(*)::integer`.as("count"),
      sql`COALESCE(SUM(refunded_minor), 0)::integer`.as("refunded"),
      sql`COUNT(*) FILTER (WHERE status = 'failed')::integer`.as("failed"),
      sql`COALESCE(SUM(stripe_fee_minor), 0)::integer`.as("fees_minor"),
      sql`MAX(updated_at)`.as("mirror_as_of"),
    ]));

  const summary = summaryRows[0] || {};

  // By-method breakdown
  const { rows: byMethodRows } = await run(tx, filtered(db
    .selectFrom("keystone.payment_effective as p"))
    .select([
      "method",
      sql`COUNT(*)::integer`.as("count"),
      sql`COALESCE(SUM(amount_minor), 0)::integer`.as("amount_minor"),
    ])
    .groupBy("method")
    .orderBy("amount_minor", "desc"));

  const byMethod = byMethodRows.map(r => ({
    method: r.method || 'unknown',
    count: r.count,
    amountMinor: r.amount_minor,
  }));

  // Rows with payer display name
  const { rows } = await run(tx, filtered(db
    .selectFrom("keystone.payment_effective as p")
    .innerJoin("keystone.app_user as u", (join) => join
      .onRef("u.tenant_id", "=", "p.tenant_id")
      .onRef("u.id", "=", "p.payer_user_id")))
    .select([
      "p.id", "p.created_at", "p.amount_minor", "p.method", "p.status", "p.payer_user_id", "u.display_name",
      "p.invoice_id", "p.stripe_fee_minor", "p.refunded_minor",
    ])
    .orderBy("p.created_at", "desc")
    .limit(100));

  return {
    summary: {
      takenMinor: summary.taken_minor || 0,
      count: summary.count || 0,
      refunded: summary.refunded || 0,
      failed: summary.failed || 0,
      feesMinor: summary.fees_minor || 0,
      byMethod,
    },
    rows: rows.map(r => ({
      id: r.id,
      createdAt: r.created_at,
      amountMinor: r.amount_minor,
      method: r.method,
      status: r.status,
      payerId: r.payer_user_id,
      payerName: r.display_name,
      invoiceId: r.invoice_id,
      stripeFeeMinor: r.stripe_fee_minor || 0,
      refundedMinor: r.refunded_minor || 0,
    })),
    mirrorAsOf: summary.mirror_as_of || new Date(),
  };
}

/**
 * paymentDetail: full detail view for one payment.
 * @returns {chargedMinor, stripeFeeMinor, workbenchFeeMinor, landingOn, netMinor, forWhat, checks, refundCostSentence, elsewhere, mirrorAsOf, createdAt, method, status, payerName}
 */
export async function paymentDetail(tx, { tenantId, paymentId }) {
  const { rows: paymentRows } = await run(tx, db
    .selectFrom("keystone.payment_effective as p")
    // ★ STRIPE-MIRROR: the payment row and its invoice number come from the effective views (a
    //   Stripe-only charge/invoice exists only there; ids are md5-derived). `checks` is a the platform-only
    //   column with no equivalent in the view, so it is read from keystone.payment by the same id.
    .leftJoin("keystone.invoice_effective as i", (join) => join
      .onRef("i.tenant_id", "=", "p.tenant_id")
      .onRef("i.id", "=", "p.invoice_id"))
    .leftJoin("keystone.payment as kp", (join) => join
      .onRef("kp.tenant_id", "=", "p.tenant_id")
      .onRef("kp.id", "=", "p.id"))
    .leftJoin("keystone.app_user as u", (join) => join
      .onRef("u.tenant_id", "=", "p.tenant_id")
      .onRef("u.id", "=", "p.payer_user_id"))
    .select([
      "p.id", "p.amount_minor", "p.stripe_fee_minor", "p.method", "p.status", "p.stripe_charge_id",
      "p.available_on", "kp.checks", "p.refunded_minor", "p.invoice_id", "p.payer_user_id",
      "p.created_at", "p.updated_at", "i.invoice_number", "u.display_name", "p.application_fee_minor",
      // ★ NEW, saved-card brief (1 Oct 2026, Part 3 screen audit) — MEASURED: this read never
      //   selected the card, so a payment's own record page could not show "Paid with Visa ••••
      //   4242" even once the payment row started carrying it (Part 1's own fix).
      "p.card_brand", "p.card_last_four",
    ])
    .where("p.tenant_id", "=", tenantId)
    .where("p.id", "=", paymentId));

  if (paymentRows.length === 0) return null;

  const payment = paymentRows[0];

  // ★ the platform's own fee is the application fee recorded on the payment — 0 where there is none (Docustay charges
  //   on the platform's own Stripe account, no application fee). This was a hard-coded 63 "example from spec"
  //   printed on EVERY payment: $2.00 charge, Stripe fee $0.36, "the platform −$0.63", "landing $1.01" against
  //   Stripe's real net of $1.64 (found in the 2 Oct 2026 browser check).
  const workbenchFeeMinor = payment.application_fee_minor ?? 0;

  // forWhat array (what this payment is for)
  const forWhat = payment.invoice_number ? [{
    type: 'invoice',
    id: payment.invoice_id,
    label: `Invoice ${payment.invoice_number}`,
  }] : [];

  // Get refund cost sentence if needed
  let refundCostMsg = null;
  if (payment.refunded_minor > 0) {
    refundCostMsg = refundCostSentence({
      refundMinor: payment.refunded_minor,
      stripeFeeMinor: payment.stripe_fee_minor || 0,
      payerDisplayName: payment.display_name,
    });
  }

  // Elsewhere: same charge under other methods
  const elsewhere = [];
  for (const [methodKey, methodName] of Object.entries({
    online: 'Online',
    typed: 'Card on File',
    in_person: 'In-Person',
    bank: 'Bank Transfer',
  })) {
    const feeMinor = stripeFeesMinor(payment.amount_minor, methodKey);
    elsewhere.push({
      how: `Stripe's published US rates, for comparison — the fee you were charged comes from Stripe (${methodName})`,
      feeMinor,
    });
  }

  return {
    id: payment.id,
    chargedMinor: payment.amount_minor,
    stripeFeeMinor: payment.stripe_fee_minor || 0,
    workbenchFeeMinor,
    landingOn: payment.available_on,
    netMinor: (payment.amount_minor - (payment.stripe_fee_minor || 0) - workbenchFeeMinor),
    forWhat,
    checks: payment.checks ? JSON.parse(payment.checks) : [],
    refundCostSentence: refundCostMsg,
    elsewhere,
    createdAt: payment.created_at,
    method: payment.method,
    status: payment.status,
    payerName: payment.display_name,
    cardBrand: payment.card_brand ?? null,
    cardLastFour: payment.card_last_four ?? null,
    mirrorAsOf: payment.updated_at,
  };
}

/**
 * creditsSummary: summary of credits/entitlements.
 * @returns {owedCount, people, worthMinor, expiringSoon, mirrorAsOf}
 */
export async function creditsSummary(tx, { tenantId }) {
  const { rows: creditRows } = await run(tx, db
    .selectFrom("keystone.entitlement_credit as c")
    .innerJoin("keystone.entitlement as e", "e.id", "c.entitlement_id")
    .leftJoin("keystone.line_item as li", "li.id", "e.line_item_id")
    .select([
      sql`COUNT(DISTINCT e.owner_user_id)::integer`.as("people"),
      sql`COUNT(c.id)::integer`.as("owed_count"),
      // ★ A credit's worth is its share of what was paid for the pack it came from: the line's
      //   net amount over the pack's credit count. A pack with no line (granted, not sold) is worth 0.
      sql`COALESCE(SUM((li.unit_amount_minor * li.quantity - li.discount_minor)::numeric / NULLIF(e.total_credits, 0)), 0)::integer`.as("worth_minor"),
      sql`MAX(e.updated_at)`.as("mirror_as_of"),
    ])
    .where("c.tenant_id", "=", tenantId)
    .where("c.status", "in", ["available", "returned"])
    .where("e.status", "=", "active")
    .where((eb) => eb.or([
      eb("e.expires_at", "is", null),
      eb("e.expires_at", ">", sql`now()`),
    ])));

  const summary = creditRows[0] || {};

  // Expiring soon (within 30 days)
  const { rows: expiringRows } = await run(tx, db
    .selectFrom("keystone.entitlement_credit as c")
    .innerJoin("keystone.entitlement as e", "e.id", "c.entitlement_id")
    .innerJoin("keystone.app_user as u", (join) => join
      .onRef("u.tenant_id", "=", "e.tenant_id")
      .onRef("u.id", "=", "e.owner_user_id"))
    .select([
      "e.owner_user_id",
      "u.display_name",
      "e.expires_at",
      sql`COUNT(c.id)::integer`.as("count"),
    ])
    .where("c.tenant_id", "=", tenantId)
    .where("c.status", "in", ["available", "returned"])
    .where("e.status", "=", "active")
    .where("e.expires_at", "is not", null)
    .where("e.expires_at", ">", sql`now()`)
    .where(sql`e.expires_at <= now() + interval '30 days'`)
    .groupBy(["e.owner_user_id", "u.display_name", "e.expires_at"])
    .orderBy("e.expires_at", "asc")
    .limit(10));

  const expiringSoon = expiringRows.map(r => ({
    person: r.display_name,
    count: r.count,
    expiresAt: r.expires_at,
  }));

  return {
    owedCount: summary.owed_count || 0,
    people: summary.people || 0,
    worthMinor: summary.worth_minor || 0,
    expiringSoon,
    mirrorAsOf: summary.mirror_as_of || new Date(),
  };
}

/**
 * chargesForBookings: the no-show charge amount, if any, for each of the given bookings.
 * ★★ B-4 (F794) — booking's own `invoice_id` out-pointer is retired (0513); this is how a no-show
 *    session's history (`src/booking/history.mjs`) finds the invoice line raised against it, via
 *    `line_item.booking_id` (a reference, not a parent — §Z3.15's arc still runs through
 *    `invoice_id`). "The charge read moves to money" (ruling, 27 Sep): `src/booking/` holds no
 *    invoice or line_item reference of its own.
 * ★ An empty `bookingIds` returns an empty Map WITHOUT querying — a history page with zero no-show
 *   rows on it should not run a query against an empty array.
 * @returns {Promise<Map<string, number>>} bookingId -> amountMinor
 */
export async function chargesForBookings(tx, { tenantId, bookingIds }) {
  if (!bookingIds || bookingIds.length === 0) return new Map();

  const { rows } = await run(tx, db
    .selectFrom("keystone.line_item as li")
    // ★ STRIPE-MIRROR: the invoice's amount and void-ness are Stripe's (invoice_effective).
    .innerJoin("keystone.invoice_effective as inv", (join) => join
      .onRef("inv.tenant_id", "=", "li.tenant_id")
      .onRef("inv.id", "=", "li.invoice_id"))
    .select(["li.booking_id", "inv.amount_minor"])
    .where("li.tenant_id", "=", tenantId)
    .where(sql`li.booking_id = ANY(${sql.val(bookingIds)}::uuid[])`)
    .where("inv.status", "<>", "void"));

  return new Map(rows.map((r) => [r.booking_id, r.amount_minor]));
}

/**
 * subscriptionsSummary: summary of subscriptions.
 * @returns {running, monthlyMinor, cardsExpiring, mirrorAsOf}
 */
export async function subscriptionsSummary(tx, { tenantId }) {
  const { rows: subRows } = await run(tx, db
    // ★ STRIPE-MIRROR: subscription_effective is mirror-driven — Stripe's subscriptions of a known
    //   person (state mapped from Stripe's status), the platform-only ones unioned in.
    .selectFrom("keystone.subscription_effective")
    .select([
      sql`COUNT(*) FILTER (WHERE state = 'active')::integer`.as("running"),
      sql`COALESCE(SUM(snapshot_amount_minor), 0)::integer`.as("monthly_minor"),
      sql`MAX(updated_at)`.as("mirror_as_of"),
    ])
    .where("tenant_id", "=", tenantId)
    .where("state", "in", ["active", "paused"]));

  const summary = subRows[0] || {};

  // Cards expiring soon.
  // ★ STRIPE-MIRROR: the card's expiry is person_card_effective's. A subscription linked to a the platform
  //   payment_method row is matched to its card by provider id; a Stripe-only subscription (no
  //   payment_method_id) is matched to its payer's default card.
  const { rows: cardRows } = await run(tx, db
    .selectFrom("keystone.subscription_effective as s")
    .leftJoin("keystone.payment_method as kpm", "kpm.id", "s.payment_method_id")
    .innerJoin("keystone.person_card_effective as pm", (join) => join
      .onRef("pm.tenant_id", "=", "s.tenant_id")
      .onRef("pm.app_user_id", "=", "s.app_user_id")
      .on(sql`(CASE WHEN kpm.provider_payment_method_id IS NOT NULL
                    THEN pm.provider_payment_method_id = kpm.provider_payment_method_id
                    ELSE pm.is_default END)`))
    .select(sql`COUNT(DISTINCT pm.id)::integer`.as("count"))
    .where("s.tenant_id", "=", tenantId)
    .where("s.state", "=", "active")
    .where(sql`pm.exp_year <= EXTRACT(YEAR FROM now())::smallint`)
    .where((eb) => eb.or([
      sql`pm.exp_year < EXTRACT(YEAR FROM now())::smallint`,
      sql`pm.exp_month <= EXTRACT(MONTH FROM now())::smallint`,
    ])));

  const cardsExpiring = cardRows[0]?.count || 0;

  return {
    running: summary.running || 0,
    monthlyMinor: summary.monthly_minor || 0,
    cardsExpiring,
    mirrorAsOf: summary.mirror_as_of || new Date(),
  };
}

/**
 * subscriptionRecord: full record view for one subscription.
 * @returns {id, state, payer, amount, ...fields, mirrorAsOf}
 */
export async function subscriptionRecord(tx, { tenantId, subscriptionId }) {
  const { rows: subRows } = await run(tx, db
    // ★ STRIPE-MIRROR: by subscription_effective id (a Stripe-only subscription's md5-derived id exists only
    //   in the view). It carries no plan join: this record's shape reads no plan column, and plan_id is
    //   NULL for Stripe-only subscriptions, so a plan lookup would have to be a LEFT JOIN regardless.
    .selectFrom("keystone.subscription_effective as s")
    .innerJoin("keystone.app_user as u", (join) => join
      .onRef("u.tenant_id", "=", "s.tenant_id")
      .onRef("u.id", "=", "s.app_user_id"))
    .select([
      "s.id",
      "s.app_user_id as payer_user_id",
      "u.display_name as payer_name",
      "s.state", "s.snapshot_amount_minor", "s.current_period_end", "s.cancel_at_period_end",
      "s.contract_id", "s.payment_method_id", "s.created_at", "s.updated_at",
    ])
    .where("s.tenant_id", "=", tenantId)
    .where("s.id", "=", subscriptionId));

  if (subRows.length === 0) return null;

  const subscription = subRows[0];

  return {
    id: subscription.id,
    payerId: subscription.payer_user_id,
    payer: subscription.payer_name,
    state: subscription.state,
    amountMinor: subscription.snapshot_amount_minor,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    contractId: subscription.contract_id,
    paymentMethodId: subscription.payment_method_id,
    createdAt: subscription.created_at,
    updatedAt: subscription.updated_at,
    mirrorAsOf: subscription.updated_at,
  };
}

/**
 * estimatesList: filtered list of estimates.
 * @param {tx, {tenantId, status}}
 * @returns {rows, mirrorAsOf}
 */
export async function estimatesList(tx, { tenantId, status }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.estimate")
    .select(["id", "status", "estimate_number", "recipient_user_id", "amount_minor", "currency", "created_at", "updated_at"])
    .where("tenant_id", "=", tenantId)
    .$if(!!status, (qb) => qb.where("status", "=", status))
    .orderBy("created_at", "desc")
    .limit(100));

  // Get the newest updated_at for mirrorAsOf
  const mirrorAsOf = rows.length > 0 ? rows[0].updated_at : new Date();

  return {
    rows: rows.map(r => ({
      id: r.id,
      status: r.status,
      estimateNumber: r.estimate_number,
      recipientId: r.recipient_user_id,
      amountMinor: r.amount_minor,
      currency: r.currency,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    mirrorAsOf,
  };
}
