// @ts-check
// Stage 15 Task 15.22 — PAYMENT PLANS
//
// Payment plan creation, agreement, and installment processing for part-payment invoices.

import { emit, userActor } from "../events/outbox.mjs";
import { getSetting } from "../settings/writes.mjs";
import { MONEY_DEFAULTS } from "../settings/keys.mjs";
import { stripeConnectedRequest, applicationFeeMinor } from "./stripeConnected.mjs";
import { chargesOn } from "./stripeConnected.mjs";
import { getConnectAccountState } from "./connect.mjs";
import { metadataFor } from "./metadata.mjs";
import { ensureCustomer } from "./customers.mjs";
import { conflict } from "../http/errors.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below (except `handleStripeScheduleStatusEvent`, landed
//   separately by L5.3 and out of this task's 20-query count) now goes through the builder + `run`;
//   the SQL semantics are unchanged (same WHERE clauses, same joins, same RETURNING columns, same
//   parameterization, same INSERT ... SELECT shape). `sql` is the escape hatch for what the builder
//   itself does not express — `now()`, `CURRENT_DATE`, `count(*) ::int` — per the L3 per-file ruling:
//   "SQL that calls plpgsql or uses features the builder lacks stays as sql`…` through run".
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CALENDAR DATE ARITHMETIC. Dates are plain `YYYY-MM-DD` strings, never instants.
//      Month math uses real calendar-month boundaries (1 January + 1 month = 1 February).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Add days to a date string (YYYY-MM-DD).
 * @param {string} dateString date in YYYY-MM-DD format
 * @param {number} days number of days to add
 * @returns {string} new date in YYYY-MM-DD format
 */
function addDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}`.padStart(4, "0") + "-" +
    `${dt.getUTCMonth() + 1}`.padStart(2, "0") + "-" +
    `${dt.getUTCDate()}`.padStart(2, "0");
}

/**
 * Add months to a date string (YYYY-MM-DD), using real calendar-month boundaries.
 * @param {string} dateString date in YYYY-MM-DD format
 * @param {number} months number of months to add
 * @returns {string} new date in YYYY-MM-DD format
 */
function addMonths(dateString, months) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return `${dt.getUTCFullYear()}`.padStart(4, "0") + "-" +
    `${dt.getUTCMonth() + 1}`.padStart(2, "0") + "-" +
    `${dt.getUTCDate()}`.padStart(2, "0");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ PLAN ROWS: equal split with remainder absorbed by the LAST row.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Generate installment rows for a payment plan.
 * Equal split in minor units, with remainder absorbed by the LAST row.
 * @param {number} totalMinor total amount in minor units
 * @param {number} installments number of installments
 * @param {string} frequency "weekly", "fortnightly", or "monthly"
 * @param {string} firstDueOn date string in YYYY-MM-DD format for first installment
 * @returns {Array} array of {n, due_date, amount_minor}
 */
export function planRows({ totalMinor, installments, frequency, firstDueOn }) {
  const baseAmount = Math.floor(totalMinor / installments);
  const remainder = totalMinor - (baseAmount * (installments - 1));

  const rows = [];
  for (let i = 1; i <= installments; i++) {
    let dueDate;
    if (i === 1) {
      dueDate = firstDueOn;
    } else {
      const daysBetween = frequency === "weekly" ? 7 * (i - 1)
        : frequency === "fortnightly" ? 14 * (i - 1)
          : null; // monthly handled below
      if (daysBetween !== null) {
        dueDate = addDays(firstDueOn, daysBetween);
      } else {
        // monthly
        dueDate = addMonths(firstDueOn, i - 1);
      }
    }

    const amountMinor = i === installments ? remainder : baseAmount;
    rows.push({ n: i, due_date: dueDate, amount_minor: amountMinor });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ OFFER A PAYMENT PLAN
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Create a payment plan offer on an invoice.
 * @param {object} tx database transaction
 * @param {object} options
 *   tenantId: practice id
 *   invoiceId: invoice id
 *   installments: number of installments
 *   frequency: "weekly", "fortnightly", or "monthly"
 *   firstDueOn: date string YYYY-MM-DD
 *   actorUserId: user creating the plan
 * @returns {Promise<string>} the created payment_plan id
 * @throws {object} 409 if part_payments is off
 */
export async function offerPaymentPlan(tx, {
  tenantId, invoiceId, installments, frequency, firstDueOn, actorUserId,
}) {
  // ★ Check if part payments are enabled
  const partPaymentsOn = await getSetting(
    tx, "money.part_payments", MONEY_DEFAULTS["money.part_payments"]
  );
  if (!partPaymentsOn) {
    const error = new Error("Part payments are off. Turn them on in Money settings.");
    error.statusCode = 409;
    throw error;
  }

  // ★ Get the invoice
  const { rows: invoiceRows } = await run(tx, db
    // ★ STRIPE MIRROR (0574) — what is owed on the invoice (amount / paid so far) is Stripe's word.
    .selectFrom("keystone.invoice_effective")
    .select(["amount_minor", "paid_minor", "currency as currency_code", "payer_user_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));
  if (invoiceRows.length === 0) {
    const error = new Error("Invoice not found");
    error.statusCode = 404;
    throw error;
  }
  const invoice = invoiceRows[0];

  // ★ Calculate remaining balance
  const totalMinor = invoice.amount_minor - invoice.paid_minor;

  // ★ Generate rows
  const rows = planRows({ totalMinor, installments, frequency, firstDueOn });

  // ★ Create subscription_schedule row
  const { rows: planRows_ } = await run(tx, db
    .insertInto("keystone.subscription_schedule")
    .values({
      tenant_id: tenantId ?? null,
      payer_user_id: invoice.payer_user_id ?? null,
      invoice_id: invoiceId ?? null,
      total_minor: totalMinor ?? null,
      currency: invoice.currency_code ?? null,
      installments: installments ?? null,
      frequency: frequency ?? null,
      first_due_on: firstDueOn ?? null,
      offered_by: actorUserId ?? null,
    })
    .returning(["id"]));
  const planId = planRows_[0].id;

  // ★ Insert subscription_schedule_row rows
  for (const row of rows) {
    await run(tx, db
      .insertInto("keystone.subscription_schedule_row")
      .values({
        tenant_id: tenantId ?? null,
        subscription_schedule_id: planId ?? null,
        n: row.n ?? null,
        due_date: row.due_date ?? null,
        amount_minor: row.amount_minor ?? null,
      }));
  }

  // ★ Emit event
  await emit(tx, {
    tenantId,
    topic: "money.payment_plan.offered",
    emittedBy: "money",
    subjectType: "payment_plan",
    subjectId: planId,
    actor: userActor(actorUserId),
    payload: { invoice_id: invoiceId, installments, frequency },
  });

  return planId;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ AGREE TO A PAYMENT PLAN
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Mark a payment plan as agreed and snapshot its terms.
 * Soft-deletes the original invoice's reminder rows.
 * Creates a Stripe Subscription Schedule if Connect is available.
 * @param {object} tx database transaction
 * @param {object} options
 *   tenantId: practice id
 *   planId: payment_plan id
 *   agreementDocumentId: optional document_instance id
 *   actorUserId: user agreeing to the plan
 * @returns {Promise<void>}
 */
export async function agreePaymentPlan(tx, {
  tenantId, planId, agreementDocumentId = null, actorUserId,
}) {
  // ★ Get the plan and its rows
  const { rows: planRows_ } = await run(tx, db
    .selectFrom("keystone.subscription_schedule")
    .select(["id", "invoice_id", "total_minor", "currency", "frequency", "payer_user_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", planId));
  if (planRows_.length === 0) {
    const error = new Error("Payment plan not found");
    error.statusCode = 404;
    throw error;
  }
  const plan = planRows_[0];

  // ★ Get all rows of this plan to snapshot
  const { rows: rows_ } = await run(tx, db
    .selectFrom("keystone.subscription_schedule_row")
    .select(["n", "due_date", "amount_minor"])
    .where("tenant_id", "=", tenantId)
    .where("subscription_schedule_id", "=", planId)
    .orderBy("n"));

  // ★ Build frozen_terms snapshot
  const frozenTerms = {
    rows: rows_.map(r => ({ n: r.n, due_date: r.due_date, amount_minor: r.amount_minor })),
    total_minor: plan.total_minor,
    currency: plan.currency,
    frequency: plan.frequency,
  };

  // ★ Update plan to agreed state
  await run(tx, db
    .updateTable("keystone.subscription_schedule")
    .set({
      state: "agreed",
      agreed_at: sql`now()`,
      frozen_terms: JSON.stringify(frozenTerms) ?? null,
      agreement_document_id: agreementDocumentId ?? null,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", planId));

  // ★ Soft-delete the original invoice's reminder rows
  await run(tx, db
    .updateTable("keystone.invoice_reminder")
    .set({ deleted_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", plan.invoice_id)
    .where("deleted_at", "is", null));

  // ★ Create Stripe Subscription Schedule if Connect is available
  const connectState = await getConnectAccountState(tx, tenantId);
  let stripeScheduleId = null;

  if (connectState.state === "live" || connectState.state === "restricted") {
    // ★ Build phases from frozen_terms rows
    const phases = [];
    for (let i = 0; i < rows_.length; i++) {
      const row = rows_[i];
      const nextRow = rows_[i + 1];

      // Convert due_date (YYYY-MM-DD) to unix timestamp
      const [y, m, d] = row.due_date.split("-").map(Number);
      const startDate = Math.floor(new Date(Date.UTC(y, m - 1, d)).getTime() / 1000);

      const endDate = nextRow ? (() => {
        const [y2, m2, d2] = nextRow.due_date.split("-").map(Number);
        return Math.floor(new Date(Date.UTC(y2, m2 - 1, d2)).getTime() / 1000);
      })() : null;

      const phase = {
        start_date: startDate,
        add_invoice_items: [{
          amount: row.amount_minor,
          currency: plan.currency,
          description: `Installment ${row.n} of ${rows_.length}`,
        }],
      };

      if (endDate) {
        phase.end_date = endDate;
      }

      phases.push(phase);
    }

    // ★ Build metadata using metadataFor
    const metadata = metadataFor("subscription", {
      person_id: plan.payer_user_id,
      practice_id: tenantId,
      plan_id: planId,
      created_by_document_id: agreementDocumentId,
    });

    // ★ Create the subscription schedule via Stripe
    const form = {
      customer: plan.payer_user_id, // TODO: map to Stripe customer id
      phases: phases,
    };
    // ★ Merge metadata into form
    Object.entries(metadata).forEach(([k, v]) => {
      form[`metadata[${k}]`] = v;
    });

    const result = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/subscription_schedules",
      sdk: (s, o, form, query) => s.subscriptionSchedules.create(form, o),
      form,
      movesMoney: false,
      purpose: "create_subscription_schedule",
      actorUserId,
    }, { fetchImpl: globalThis.fetch });

    stripeScheduleId = result.body.id;

    // ★ Store the schedule id
    await run(tx, db
      .updateTable("keystone.subscription_schedule")
      .set({ stripe_subscription_schedule_id: stripeScheduleId ?? null })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", planId));
  } else {
    // ★ Connect not available — record skip
    await emit(tx, {
      tenantId,
      topic: "money.subscription_schedule.skipped",
      emittedBy: "money",
      subjectType: "payment_plan",
      subjectId: planId,
      actor: userActor(actorUserId),
      payload: { reason: "connect_not_live", invoice_id: plan.invoice_id },
    });
  }

  // ★ Emit event
  await emit(tx, {
    tenantId,
    topic: "money.payment_plan.agreed",
    emittedBy: "money",
    subjectType: "payment_plan",
    subjectId: planId,
    actor: userActor(actorUserId),
    payload: { invoice_id: plan.invoice_id },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ INSTALLMENT_DUE_FACT — a DUE_FACTS entry for scheduled plan rows
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A DUE_FACTS entry for payment plan installments that have come due.
 * ★★★ R8 GUARD FIRST: if charges are off, return null with zero side effects.
 */
export const INSTALLMENT_DUE_FACT = {
  key: "payment_plan_installment_due",
  why: "a payment plan installment has come due and needs to be invoiced",
  find: (tx, { tenantId }) => {
    // ★ FIX, 30 Sep 2026 (worker-failures brief) — MEASURED live: this GAVE UP on `sweep_due` for
    //   EVERY tenant, every run, with "TypeError: rows is not iterable" — because charges are OFF
    //   (HELD, this whole project) so this guard fires unconditionally, and `runDueFacts`
    //   (`src/time/due.mjs:270`) does `const { rows } = await fact.find(...)` on whatever it
    //   returns. Every OTHER DUE_FACTS entry's `find` resolves `{rows: [...]}` (a raw pg result);
    //   this one alone resolved a bare array, so `rows` destructured to `undefined` and the `for
    //   (const row of rows)` right after threw. Shape now matches every sibling fact.
    if (!chargesOn()) {
      return Promise.resolve({ rows: [] });
    }
    // ★ Find scheduled rows on agreed plans where due_date <= today
    return run(tx, db
      .selectFrom("keystone.subscription_schedule_row as ppr")
      .innerJoin("keystone.subscription_schedule as pp", (join) => join
        .onRef("pp.tenant_id", "=", "ppr.tenant_id")
        .onRef("pp.id", "=", "ppr.subscription_schedule_id"))
      .select([
        "ppr.id", "ppr.subscription_schedule_id", "ppr.n", "ppr.due_date", "ppr.amount_minor",
        "pp.invoice_id", "pp.payer_user_id", "pp.currency", "pp.frozen_terms",
      ])
      .where("ppr.tenant_id", "=", tenantId)
      .where("ppr.state", "=", "scheduled")
      .where(sql`ppr.due_date <= CURRENT_DATE`)
      .where("pp.state", "=", "agreed")
      .orderBy("ppr.due_date")
      .orderBy("ppr.n"));
  },
  act: async (tx, { tenantId, row }) => {
    // ★ Instalment invoices go on the practice's Stripe customer for this payer (F791 extended).
    const { customerId } = await ensureCustomer(tx, { tenantId, personId: row.payer_user_id });
    if (!customerId) {
      throw conflict("Connect Stripe first — Settings › Money.");
    }

    // ★ Call stripeConnectedRequest to draft the invoice
    const result = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/invoices",
      sdk: (s, o, form, query) => s.invoices.create(form, o),
      form: {
        customer: customerId,
        metadata: metadataFor("invoice", {
          keystone_invoice_id: row.invoice_id,
          keystone_plan_row_id: row.id,
        }),
      },
      movesMoney: false,
      purpose: "installment_draft",
    }, { fetchImpl: globalThis.fetch });

    const stripeInvoiceId = result.body.id;

    // ★ Add invoice item
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/invoiceitems",
      sdk: (s, o, form, query) => s.invoiceItems.create(form, o),
      form: {
        invoice: stripeInvoiceId,
        amount: row.amount_minor,
        application_fee_amount: applicationFeeMinor(row.amount_minor),
      },
      movesMoney: false,
      purpose: "installment_item",
    }, { fetchImpl: globalThis.fetch });

    // ★ Finalize the invoice (this is where money actually moves)
    const installmentFinalizeResult = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/invoices/${stripeInvoiceId}/finalize`,
      sdk: (s, o, form, query) => s.invoices.finalizeInvoice(stripeInvoiceId, form, o),
      movesMoney: true,
      purpose: "installment_finalize",
    }, { fetchImpl: globalThis.fetch });

    // ★ Saved-card brief, Part 3 — same belt-and-braces as invoiceStripe.mjs's own finalize.
    //   movesMoney: false — this updates the PI's own future-use flag, never its amount/confirm
    //   state, so it does not touch any of the four charge locks.
    if (installmentFinalizeResult?.body?.payment_intent) {
      const installmentPiId = typeof installmentFinalizeResult.body.payment_intent === "string"
        ? installmentFinalizeResult.body.payment_intent : installmentFinalizeResult.body.payment_intent.id;
      try {
        await stripeConnectedRequest(tx, {
          tenantId,
          method: "POST",
          path: `/payment_intents/${installmentPiId}`,
          sdk: (s, o, form) => s.paymentIntents.update(installmentPiId, form, o),
          form: { setup_future_usage: "off_session" },
          movesMoney: false,
          purpose: "installment_pi_setup_future_usage",
        }, { fetchImpl: globalThis.fetch });
      } catch (sfuErr) {
        console.error(`paymentPlans: could not set setup_future_usage on PaymentIntent ${installmentPiId}: ${sfuErr.message}`);
      }
    }

    // ★ Update row to invoiced state
    await run(tx, db
      .updateTable("keystone.subscription_schedule_row")
      .set({ state: "invoiced", stripe_invoice_id: stripeInvoiceId ?? null, updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", row.id));

    // ★ Emit event
    await emit(tx, {
      tenantId,
      topic: "money.invoice.sent",
      emittedBy: "money",
      subjectType: "invoice",
      subjectId: row.invoice_id,
      actor: "worker",
      payload: { invoice_id: row.invoice_id, installment: row.n },
    });

    return `payment plan row ${row.id} invoiced (installment ${row.n})`;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ HANDLE INSTALLMENT PAID EVENT FROM STRIPE
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Release a subscription schedule (20.72).
 * ★ Release means the subscription continues at Stripe normally (no schedule phases);
 *   the schedule object itself is released but the subscription stays active.
 * @param {object} tx database transaction
 * @param {object} options
 *   tenantId: practice id
 *   planId: subscription_schedule id
 *   actorUserId: user releasing the plan
 * @returns {Promise<void>}
 */
export async function releasePaymentPlan(tx, {
  tenantId, planId, actorUserId,
}) {
  // ★ Get the plan and its stripe_subscription_schedule_id
  const { rows: planRows_ } = await run(tx, db
    .selectFrom("keystone.subscription_schedule")
    .select(["id", "stripe_subscription_schedule_id", "invoice_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", planId));
  if (planRows_.length === 0) {
    const error = new Error("Payment plan not found");
    error.statusCode = 404;
    throw error;
  }
  const plan = planRows_[0];

  // ★ If a Stripe schedule exists, release it
  if (plan.stripe_subscription_schedule_id) {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/subscription_schedules/${plan.stripe_subscription_schedule_id}/release`,
      sdk: (s, o, form, query) => s.subscriptionSchedules.release(plan.stripe_subscription_schedule_id, {}, o),
      movesMoney: false,
      purpose: "release_subscription_schedule",
      actorUserId,
    }, { fetchImpl: globalThis.fetch });
  }

  // ★ Update plan to released state
  await run(tx, db
    .updateTable("keystone.subscription_schedule")
    .set({ state: "released" })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", planId));

  // ★ Emit event
  await emit(tx, {
    tenantId,
    topic: "money.payment_plan.released",
    emittedBy: "money",
    subjectType: "payment_plan",
    subjectId: planId,
    actor: userActor(actorUserId),
    payload: { invoice_id: plan.invoice_id },
  });
}

/**
 * Cancel a subscription schedule and release it on Stripe.
 * @param {object} tx database transaction
 * @param {object} options
 *   tenantId: practice id
 *   planId: subscription_schedule id
 *   actorUserId: user cancelling the plan
 * @returns {Promise<void>}
 */
export async function cancelPaymentPlan(tx, {
  tenantId, planId, actorUserId,
}) {
  // ★ Get the plan and its stripe_subscription_schedule_id
  const { rows: planRows_ } = await run(tx, db
    .selectFrom("keystone.subscription_schedule")
    .select(["id", "stripe_subscription_schedule_id", "invoice_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", planId));
  if (planRows_.length === 0) {
    const error = new Error("Payment plan not found");
    error.statusCode = 404;
    throw error;
  }
  const plan = planRows_[0];

  // ★ If a Stripe schedule exists, release it
  if (plan.stripe_subscription_schedule_id) {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/subscription_schedules/${plan.stripe_subscription_schedule_id}/release`,
      sdk: (s, o, form, query) => s.subscriptionSchedules.release(plan.stripe_subscription_schedule_id, {}, o),
      movesMoney: false,
      purpose: "release_subscription_schedule",
      actorUserId,
    }, { fetchImpl: globalThis.fetch });
  }

  // ★ Update plan to cancelled state
  await run(tx, db
    .updateTable("keystone.subscription_schedule")
    .set({ state: "cancelled" })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", planId));

  // ★ Emit event
  await emit(tx, {
    tenantId,
    topic: "money.payment_plan.cancelled",
    emittedBy: "money",
    subjectType: "payment_plan",
    subjectId: planId,
    actor: userActor(actorUserId),
    payload: { invoice_id: plan.invoice_id },
  });
}

/**
 * Handle a Stripe invoice.payment_succeeded webhook for a plan installment.
 * @param {object} tx database transaction
 * @param {object} event Stripe webhook event
 * @param {object} options { tenantId }
 * @returns {Promise<void>}
 */
export async function handleInstallmentPaid(tx, event, { tenantId }) {
  const stripeInvoiceId = event.data.object.id;

  // ★ Find the row by stripe_invoice_id (replay-safe)
  const { rows: rowRows } = await run(tx, db
    .selectFrom("keystone.subscription_schedule_row")
    .select(["id", "subscription_schedule_id", "amount_minor", "state"])
    .where("tenant_id", "=", tenantId)
    .where("stripe_invoice_id", "=", stripeInvoiceId));
  if (rowRows.length === 0) {
    // Not a plan installment, ignore
    return;
  }
  const row = rowRows[0];

  // ★ If already paid, do nothing (replay-safe)
  if (row.state === "paid") {
    return;
  }

  // ★ Mark row as paid
  await run(tx, db
    .updateTable("keystone.subscription_schedule_row")
    .set({ state: "paid", updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", row.id));

  // ★ Get the original invoice id from the plan
  const { rows: planRows_ } = await run(tx, db
    .selectFrom("keystone.subscription_schedule")
    .select(["invoice_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", row.subscription_schedule_id));
  if (planRows_.length === 0) return;
  const invoiceId = planRows_[0].invoice_id;

  // ★ Call applyPaymentToInvoice (forward dependency: task 15.14)
  // If payments.mjs doesn't exist yet, this will be wired in task 15.14
  const { applyPaymentToInvoice } = await import("./payments.mjs").catch(() => ({}));
  if (applyPaymentToInvoice) {
    await applyPaymentToInvoice(tx, { tenantId, invoiceId, amountMinor: row.amount_minor });
  }

  // ★ Insert payment row for this installment
  // ★ payment has no `source`; payer and currency come from the invoice (payer is NOT NULL)
  await run(tx, db
    .insertInto("keystone.payment")
    .columns(["tenant_id", "invoice_id", "amount_minor", "provider", "status", "payer_user_id", "currency"])
    .expression(db
      .selectFrom("keystone.invoice as i")
      .select([
        sql.val(tenantId).as("tenant_id"),
        "i.id as invoice_id",
        sql.val(row.amount_minor).as("amount_minor"),
        sql.lit("stripe").as("provider"),
        sql.lit("succeeded").as("status"),
        "i.payer_user_id",
        "i.currency",
      ])
      .where("i.tenant_id", "=", tenantId)
      .where("i.id", "=", invoiceId)));

  // ★ Check if all rows are now paid
  const { rows: remainingRows } = await run(tx, db
    .selectFrom("keystone.subscription_schedule_row")
    .select([sql`count(*)::int`.as("remaining")])
    .where("tenant_id", "=", tenantId)
    .where("subscription_schedule_id", "=", row.subscription_schedule_id)
    .where("state", "!=", "paid"));

  if (remainingRows[0].remaining === 0) {
    // All rows paid, mark plan as completed
    await run(tx, db
      .updateTable("keystone.subscription_schedule")
      .set({ state: "completed", updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", row.subscription_schedule_id));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ L5.3 — STRIPE'S OWN subscription_schedule STATUS CHANGE, MIRRORED ONTO keystone.subscription_schedule
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ PHASE-4 L5.3 — Stripe's own subscription_schedule status change, mirrored onto
 * `keystone.subscription_schedule`. Same discipline as `handleStripeQuoteStatusEvent`
 * (src/money/estimates.mjs, L5.2) and `handleStripeInvoiceStatusEvent` (src/money/invoices.mjs,
 * L5.1): looked up by `stripe_subscription_schedule_id`, no match → `{ applied:false,
 * reason:'no_such_schedule' }`, and a `WHERE state <> $new` guard makes a redelivery a no-op
 * (`{ applied:false, reason:'replay' }`).
 *
 * Mapping (0520 widened the CHECK to admit the third value):
 *   `subscription_schedule.completed` → `state='completed'`
 *   `subscription_schedule.canceled`  → `state='cancelled'`
 *   `subscription_schedule.released`  → `state='released'`
 *
 * ★★★ RELEASED IS NOT CANCELLED. Stripe's `released` means the schedule stops managing the
 *     subscription and the subscription CONTINUES (see `releasePaymentPlan` above); `canceled`
 *     means the subscription itself stopped. The mapping keeps them as two different states.
 *
 * ★ `money.payment_plan.cancelled` and `money.payment_plan.released` already exist in
 *   `src/events/topics.mjs`'s catalogue and are emitted here (topics.mjs is read-only for this
 *   task). ★★★ FLAG (L5.3, for the maintainer/Opus): there is NO `money.payment_plan.completed` topic in that
 *   catalogue, so a `subscription_schedule.completed` event only moves `state` — it emits nothing.
 *   `handleInstallmentPaid` above already reaches the same `state='completed'` from the
 *   installment-paid path without emitting either, so this is consistent with existing behaviour,
 *   but it means a schedule completed FROM STRIPE'S SIDE directly (rather than via the last
 *   installment being paid through this app) leaves no event trace.
 *
 * @param {object} tx database transaction
 * @param {object} event Stripe webhook event (`subscription_schedule.completed` / `.canceled` / `.released`)
 * @param {object} options { tenantId }
 * @returns {Promise<object>} { applied, reason, scheduleId? }
 */
export async function handleStripeScheduleStatusEvent(tx, event, { tenantId }) {
  const stripeScheduleId = event.data?.object?.id;

  const { rows: scheduleRows } = await tx.query(
    `SELECT id, invoice_id, state FROM keystone.subscription_schedule
     WHERE tenant_id = $1 AND stripe_subscription_schedule_id = $2`,
    [tenantId, stripeScheduleId]
  );

  if (scheduleRows.length === 0) {
    return { applied: false, reason: 'no_such_schedule' };
  }

  const schedule = scheduleRows[0];

  const STATE_BY_EVENT = {
    'subscription_schedule.completed': 'completed',
    'subscription_schedule.canceled': 'cancelled',
    'subscription_schedule.released': 'released',
  };
  const newState = STATE_BY_EVENT[event.type];
  if (!newState) {
    return { applied: false, reason: 'unhandled_event_type', type: event.type };
  }

  // ★ THE REPLAY GUARD: WHERE state <> $new — a redelivery of the same event finds the row already
  //   in that state and updates zero rows.
  const { rows } = await tx.query(
    `UPDATE keystone.subscription_schedule
     SET state = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2 AND state <> $3
     RETURNING id`,
    [tenantId, schedule.id, newState]
  );

  if (rows.length === 0) {
    return { applied: false, reason: 'replay', scheduleId: schedule.id };
  }

  if (newState === 'cancelled') {
    await emit(tx, {
      tenantId,
      topic: "money.payment_plan.cancelled",
      emittedBy: "money",
      subjectType: "payment_plan",
      subjectId: schedule.id,
      actor: "webhook:stripe",
      payload: { invoice_id: schedule.invoice_id, stripe_subscription_schedule_id: stripeScheduleId },
    });
  } else if (newState === 'released') {
    await emit(tx, {
      tenantId,
      topic: "money.payment_plan.released",
      emittedBy: "money",
      subjectType: "payment_plan",
      subjectId: schedule.id,
      actor: "webhook:stripe",
      payload: { invoice_id: schedule.invoice_id, stripe_subscription_schedule_id: stripeScheduleId },
    });
  }
  // 'completed': state moves, nothing emitted — see the FLAG in this function's header comment.

  return { applied: true, reason: `schedule_${newState}`, scheduleId: schedule.id };
}
