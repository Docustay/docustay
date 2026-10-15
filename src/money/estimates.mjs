// @ts-check
// Stage 15 task 15.18 — estimates, line items, acceptance, and conversion to invoices
// Stage 20 task 20.6 — sending an estimate creates a Stripe Quote; accepting converts to Invoice

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, conflict, notFound, dependency } from "../http/errors.mjs";
import { createInvoice } from "./writes.mjs";
import { sendInvoice } from "./invoiceSend.mjs";
import { asPracticeOwner } from "./asPracticeOwner.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { metadataFor } from "./metadata.mjs";
// ★ L3.money/estimates — every `tx.query(<static SQL>)` below now goes through the builder + `run`
//   (src/db/kysely.mjs), same SQL semantics (same WHERE clauses, same RETURNING columns, same
//   parameterization). `sql` is the escape hatch for what the builder itself does not express —
//   casts, `now()`/`make_interval(...)`, self-referencing column updates, FILTER-free aggregates —
//   per the L3 per-file ruling: "SQL that calls plpgsql or uses features the builder lacks stays
//   as sql`…` through run". Imported as `kdb` (not `db`) because `estimateEditor`'s own first
//   parameter is already named `db` — same builder instance, renamed only to avoid shadowing it.
// ★★★ EXCEPTION, matching B-5's own precedent: the SAVEPOINT / RELEASE SAVEPOINT / ROLLBACK TO
//   SAVEPOINT statements (the probe in assertInTransaction, and B-5's estimate_subscription block
//   at what was ~:527-560) are transaction-control commands, not queries — there is no SELECT/
//   INSERT/UPDATE/DELETE for Kysely to build, and B-5's block is already named as staying exactly
//   as it is. Left as raw `tx.query(...)`, untouched, for the identical reason.
import { db as kdb, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { createInstance, sendInstance } from "../documents/frontDoor.mjs";
import { executedInstanceStartingPlanFor } from "../documents/api.mjs";

const SECTION = "money";

/**
 * ★ A stable 64-bit key for the advisory lock, offset by 1 from invoiceNumbers.mjs so the two
 *   series never collide. invoiceNumbers.mjs uses lockKeyFor(tenantId); this uses that + 1n.
 */
const lockKeyFor = (tenantId) => {
  const base = BigInt("0x" + tenantId.replace(/-/g, "").slice(0, 15));
  return (base + 1n).toString();
};

/**
 * ★★★ REFUSE TO RUN OUTSIDE A TRANSACTION, copying invoiceNumbers.mjs's pattern.
 * SAVEPOINT is the probe because Postgres answers it definitively.
 */
async function assertInTransaction(tx) {
  try {
    await tx.query("SAVEPOINT keystone_estimate_number_probe");
    await tx.query("RELEASE SAVEPOINT keystone_estimate_number_probe");
  } catch (e) {
    if (e.code === "25P01") {
      throw new Error(
        `nextEstimateNumber must be called inside a transaction. ★ pg_advisory_xact_lock releases at ` +
        `the end of the implicit single-statement transaction, so on an autocommit client the lock ` +
        `is gone before the number is read and two callers get the SAME number.`);
    }
    throw e;
  }
}

/**
 * Allocate the next estimate number for this practice.
 * @param {object} tx a pg client INSIDE a transaction
 * @param {string} tenantId
 * @returns {Promise<string>} e.g. "EST-000001"
 */
export async function nextEstimateNumber(tx, tenantId) {
  if (!tenantId) throw new Error("nextEstimateNumber requires a tenantId");

  await assertInTransaction(tx);

  // ★★★ SERIALISE THIS PRACTICE'S ALLOCATION, transaction-scoped.
  await run(tx, kdb.selectNoFrom(sql`pg_advisory_xact_lock(${sql.val(lockKeyFor(tenantId))})`.as("locked")));

  // ★★ READ THE MAXIMUM WITHIN THIS SERIES ONLY.
  const { rows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(sql`max(substring(estimate_number from '[0-9]+$')::int)`.as("n"))
    .where("tenant_id", "=", tenantId));

  const next = (rows[0]?.n ?? 0) + 1;
  // ★ Six digits, growing past that rather than wrapping.
  return `EST-${String(next).padStart(6, "0")}`;
}

/**
 * Create a draft estimate.
 */
export async function createEstimate(tx, {
  tenantId, recipientUserId, title, message, goodForDays = 30,
  onAcceptInvoice = true, onAcceptRecord = false, documentTemplateId = null,
  actorUserId,
}) {
  if (!tenantId || !recipientUserId) throw invalid("tenantId and recipientUserId are required");

  const estimateNumber = await nextEstimateNumber(tx, tenantId);
  const { rows: idRows } = await run(tx, kdb.selectNoFrom(sql`keystone.uuid_generate_v7()`.as("id")));
  const id = idRows[0].id;

  await run(tx, kdb
    .insertInto("keystone.estimate")
    .values({
      id: id ?? null, tenant_id: tenantId ?? null, recipient_user_id: recipientUserId ?? null,
      estimate_number: estimateNumber ?? null,
      title: title ?? null, message: message ?? null, good_for_days: goodForDays ?? null,
      on_accept_invoice: onAcceptInvoice ?? null,
      on_accept_record: onAcceptRecord ?? null, document_template_id: documentTemplateId ?? null,
      created_by: actorUserId ?? null,
    }));

  await emit(tx, {
    tenantId, topic: "money.estimate.created", emittedBy: SECTION,
    subjectType: "estimate", subjectId: id,
    actor: userActor(actorUserId),
    payload: { estimate_number: estimateNumber, recipient_user_id: recipientUserId },
  });

  return { id, status: "draft", estimate_number: estimateNumber };
}

/**
 * Update a draft estimate. Refuses (409) if not draft or if expectedUpdatedAt stale.
 */
export async function updateEstimateDraft(tx, {
  tenantId, estimateId, expectedUpdatedAt, title, message, goodForDays,
  onAcceptInvoice, onAcceptRecord, documentTemplateId, actorUserId,
}) {
  if (!tenantId || !estimateId) throw invalid("tenantId and estimateId are required");

  const { rows: estimateRows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(["id", "status", "updated_at"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId));

  if (estimateRows.length === 0) throw notFound("no such estimate in this practice");

  const estimate = estimateRows[0];
  if (estimate.status !== 'draft') {
    throw conflict("Only a draft can be edited — this one has been sent.");
  }

  // ★ F531-class bug, same as invoices.mjs's updateInvoiceDraft — `estimate.updated_at` is a JS
  //   `Date`, `expectedUpdatedAt` is the JSON-round-tripped string; `Date !== string` never
  //   coerces and is always true. Compared as millisecond timestamps instead.
  if (expectedUpdatedAt && estimate.updated_at.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw conflict("Someone changed this estimate since you opened it.");
  }

  // ★ Same dynamic-column-list semantics as before: only the fields the caller actually passed are
  //   set. Kysely's `.set()` takes a plain object, so building that object conditionally reproduces
  //   the original `updates.push(...)` construction without needing raw SQL.
  const setValues = {};
  if (title !== undefined) setValues.title = title;
  if (message !== undefined) setValues.message = message;
  if (goodForDays !== undefined) setValues.good_for_days = goodForDays;
  if (onAcceptInvoice !== undefined) setValues.on_accept_invoice = onAcceptInvoice;
  if (onAcceptRecord !== undefined) setValues.on_accept_record = onAcceptRecord;
  if (documentTemplateId !== undefined) setValues.document_template_id = documentTemplateId;

  if (Object.keys(setValues).length === 0) {
    return { id: estimateId, updated_at: new Date() };
  }
  setValues.updated_at = sql`now()`;

  const { rows } = await run(tx, kdb
    .updateTable("keystone.estimate")
    .set(setValues)
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId)
    .returning(["id", "updated_at"]));
  if (rows.length === 0) throw notFound("estimate was not updated");

  return { id: rows[0].id, updated_at: rows[0].updated_at };
}

/**
 * Recompute totals on a draft estimate.
 */
export async function recomputeEstimateTotals(tx, { tenantId, estimateId }) {
  if (!tenantId || !estimateId) throw invalid("tenantId and estimateId are required");

  const { rows: estimateRows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(["id", "status"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId));

  if (estimateRows.length === 0) throw notFound("no such estimate in this practice");

  if (estimateRows[0].status !== 'draft') {
    throw conflict("Only a draft can be recomputed — this one has been sent.");
  }

  const { rows: sumRows } = await run(tx, kdb
    .selectFrom("keystone.line_item")
    .select([
      sql`COALESCE(SUM(unit_amount_minor * quantity), 0)::int`.as("subtotal"),
      sql`COALESCE(SUM(discount_minor), 0)::int`.as("discount"),
      sql`COALESCE(SUM(tax_minor), 0)::int`.as("tax"),
    ])
    .where("tenant_id", "=", tenantId)
    .where("estimate_id", "=", estimateId)
    .where("status", "=", "active"));

  const { subtotal, discount, tax } = sumRows[0];
  const amount = subtotal - discount + tax;

  const { rows } = await run(tx, kdb
    .updateTable("keystone.estimate")
    .set({
      subtotal_minor: subtotal ?? null, discount_minor: discount ?? null, tax_minor: tax ?? null,
      amount_minor: amount ?? null,
      updated_at: sql`now()`,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId)
    .returning(["id", "subtotal_minor", "discount_minor", "tax_minor", "amount_minor"]));

  if (rows.length === 0) throw notFound("estimate was not updated");

  return {
    id: rows[0].id,
    subtotal_minor: rows[0].subtotal_minor,
    discount_minor: rows[0].discount_minor,
    tax_minor: rows[0].tax_minor,
    amount_minor: rows[0].amount_minor,
  };
}

/**
 * Send an estimate, transitioning from draft to sent.
 * On send, creates a Stripe Quote on the connected account.
 */
export async function sendEstimate(tx, { tenantId, estimateId, actorUserId }, { fetchImpl = globalThis.fetch } = {}) {
  if (!tenantId || !estimateId) throw invalid("tenantId and estimateId are required");

  const { rows: estimateRows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(["id", "status", "good_for_days", "recipient_user_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId));

  if (estimateRows.length === 0) throw notFound("no such estimate in this practice");

  const estimate = estimateRows[0];

  // Check for active line items
  const { rows: lineRows } = await run(tx, kdb
    .selectFrom("keystone.line_item")
    .select(["id", "unit_amount_minor", "quantity", "discount_minor", "tax_minor", "currency", "name_snapshot"])
    .where("tenant_id", "=", tenantId)
    .where("estimate_id", "=", estimateId)
    .where("status", "=", "active")
    .orderBy("position"));

  if (lineRows.length === 0) {
    throw invalid("An estimate needs at least one line.");
  }

  // ★★★ STRIPE QUOTE CREATION: Build line items for Quote API
  // parent_type='quote' is the shipped landing zone for quote line items
  const quoteLines = lineRows.map((line) => ({
    price_data: {
      currency: (line.currency || "usd").toLowerCase(),
      unit_amount: line.unit_amount_minor,
      product_data: {
        name: line.name_snapshot || "Estimate Line",
      },
    },
    quantity: line.quantity || 1,
  }));

  // Metadata for the Quote (person, practice, etc.)
  const quoteMeta = metadataFor("payment_intent", {
    person_id: estimate.recipient_user_id,
    practice_id: tenantId,
  });

  // Create Quote on Stripe (movesMoney: false — a quote moves no money)
  let stripeQuoteId = null;
  let stripeQuoteState = null;
  let quotePdfUrl = null;

  try {
    const createQuoteResult = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/quotes",
      sdk: (s, o, form, query) => s.quotes.create(form, o),
      form: {
        customer: `cus_${tenantId.slice(0, 8)}`,  // Placeholder; real customer lookup happens in integration
        line_items: quoteLines,
        metadata: quoteMeta,
      },
      movesMoney: false,
      purpose: "create_estimate_quote",
      actorUserId,
    }, { fetchImpl });

    if (createQuoteResult.status === 201 || createQuoteResult.status === 200) {
      stripeQuoteId = createQuoteResult.body.id;
      stripeQuoteState = createQuoteResult.body.status || "draft";

      // Finalize the Quote
      const finalizeResult = await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: `/quotes/${stripeQuoteId}/finalize`,
        sdk: (s, o, form, query) => s.quotes.finalizeQuote(stripeQuoteId, form, o),
        form: {},
        movesMoney: false,
        purpose: "finalize_estimate_quote",
        actorUserId,
      }, { fetchImpl });

      // Extract PDF URL from finalized quote
      quotePdfUrl = finalizeResult.body.pdf || finalizeResult.body.quote_pdf;
      // Update state after finalization
      stripeQuoteState = "open";
    }
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`, e);
  }

  // Update estimate: transition to sent, set expiry, store Quote id/state/pdf_url
  const { rows } = await run(tx, kdb
    .updateTable("keystone.estimate")
    .set({
      status: "sent",
      sent_at: sql`now()`,
      expires_at: sql`now() + make_interval(days => ${sql.val(estimate.good_for_days || 1)}::int)`,
      stripe_quote_id: stripeQuoteId ?? null,
      stripe_quote_state: stripeQuoteState ?? null,
      quote_pdf_url: quotePdfUrl ?? null,
      updated_at: sql`now()`,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId)
    .where("status", "=", "draft")
    .returning(["id", "sent_at", "expires_at", "stripe_quote_id"]));

  if (rows.length === 0) throw conflict("Only a draft can be sent.");

  await emit(tx, {
    tenantId, topic: "money.estimate.sent", emittedBy: SECTION,
    subjectType: "estimate", subjectId: estimateId,
    actor: userActor(actorUserId),
    payload: { sent_at: rows[0].sent_at, expires_at: rows[0].expires_at, stripe_quote_id: rows[0].stripe_quote_id },
  });

  return { id: estimateId, status: "sent", sent_at: rows[0].sent_at, expires_at: rows[0].expires_at };
}

/**
 * Record the first view of an estimate.
 */
export async function recordEstimateView(tx, { tenantId, estimateId }) {
  if (!tenantId || !estimateId) throw invalid("tenantId and estimateId are required");

  const { rows: estimateRows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(["id", "status", "opened_at"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId));

  if (estimateRows.length === 0) throw notFound("no such estimate in this practice");

  const estimate = estimateRows[0];

  // Only fire once, on first view
  if (estimate.opened_at !== null) {
    return { id: estimateId, status: estimate.status };
  }

  const { rows } = await run(tx, kdb
    .updateTable("keystone.estimate")
    .set({
      status: "opened",
      opened_at: sql`now()`,
      view_count: sql`view_count + 1`,
      updated_at: sql`now()`,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId)
    .returning(["id", "status", "opened_at"]));

  await emit(tx, {
    tenantId, topic: "money.estimate.opened", emittedBy: SECTION,
    subjectType: "estimate", subjectId: estimateId,
    actor: "system", // RUN-2: emit() takes an actor STRING (outbox.mjs ACTOR_SHAPE); the object/word here threw TopicViolation and rolled the write back (public estimate link: no signed-in actor)
    payload: { opened_at: rows[0].opened_at },
  });

  return { id: rows[0].id, status: rows[0].status };
}

/**
 * Accept an estimate. May convert to invoice and attach documents based on settings.
 * On accept: if estimate has a Stripe Quote, call Quote.accept to create the Stripe Invoice.
 * If the estimate has starts_plan_id, create a subscription through startClientSubscription.
 */
export async function acceptEstimate(tx, { tenantId, estimateId }, { fetchImpl = globalThis.fetch } = {}) {
  if (!tenantId || !estimateId) throw invalid("tenantId and estimateId are required");

  const { rows: estimateRows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select([
      "id", "status", "expires_at", "recipient_user_id", "title", "amount_minor",
      "currency", "on_accept_invoice", "document_template_id", "stripe_quote_id", "starts_plan_id",
    ])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId));

  if (estimateRows.length === 0) throw notFound("no such estimate in this practice");

  const estimate = estimateRows[0];

  if (!['sent', 'opened'].includes(estimate.status)) {
    throw conflict("Only a sent or opened estimate can be accepted.");
  }

  if (estimate.expires_at && new Date(estimate.expires_at) <= new Date()) {
    throw conflict("This estimate has expired.");
  }

  const { rows } = await run(tx, kdb
    .updateTable("keystone.estimate")
    .set({ status: "accepted", accepted_at: sql`now()`, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId)
    .returning(["id", "status", "accepted_at"]));

  await emit(tx, {
    tenantId, topic: "money.estimate.accepted", emittedBy: SECTION,
    subjectType: "estimate", subjectId: estimateId,
    actor: "system", // RUN-2: emit() takes an actor STRING (outbox.mjs ACTOR_SHAPE); the object/word here threw TopicViolation and rolled the write back (public estimate link: no signed-in actor)
    payload: { accepted_at: rows[0].accepted_at },
  });

  // ★★★ STRIPE QUOTE ACCEPTANCE: If estimate has a Stripe Quote, accept it → creates Invoice
  let stripeInvoiceId = null;
  if (estimate.stripe_quote_id) {
    try {
      const acceptQuoteResult = await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: `/quotes/${estimate.stripe_quote_id}/accept`,
        sdk: (s, o, form, query) => s.quotes.accept(estimate.stripe_quote_id, {}, o),
        form: {},
        movesMoney: false,
        purpose: "accept_estimate_quote",
        actorUserId: null,
      }, { fetchImpl });

      if (acceptQuoteResult.status === 200) {
        // Quote.accept() returns the quote object; we need to extract the invoice id
        stripeInvoiceId = acceptQuoteResult.body.invoice?.id;
      }
    } catch (e) {
      throw dependency(`Stripe refused this: ${e.message}`, e);
    }
  }

  // ★ R17 (RECONCILE, the maintainer 27 Sep) — the post-accept steps live in ONE function, shared with the Stripe webhook path.
  await runEstimateAcceptanceSteps(tx, { tenantId, estimateId, estimate, stripeInvoiceId }, { fetchImpl });

  return { id: estimateId, status: "accepted" };
}

/**
 * ★ R17 (RECONCILE, the maintainer 27 Sep) — what accepting an estimate DOES, once it is accepted: the invoice (on_accept_invoice),
 * the attached document (document_template_id), the plan start (starts_plan_id). ONE function, called by
 * acceptEstimate (acceptance through this app) and by handleStripeQuoteStatusEvent (a quote accepted directly in
 * Stripe). Callers gate it: it runs only when THEIR call moved the estimate out of sent/opened — never twice.
 * @param estimate the estimate row: recipient_user_id, title, amount_minor, on_accept_invoice, document_template_id, starts_plan_id
 */
export async function runEstimateAcceptanceSteps(tx, { tenantId, estimateId, estimate, stripeInvoiceId = null }, { fetchImpl = globalThis.fetch } = {}) {
  // ★★ EXISTING INVOICE CREATION PATH: kept intact and clearly separated
  // If on_accept_invoice is true, create and send an invoice
  if (estimate.on_accept_invoice) {
    const invoiceResult = await createInvoice(tx, {
      tenantId,
      payerUserId: estimate.recipient_user_id,
      amountMinor: estimate.amount_minor,
      status: "draft",
      title: estimate.title,
      source: "estimate",
      actorUserId: null,
    });

    const invoiceId = invoiceResult.id;

    // Update invoice with estimate reference
    await run(tx, kdb
      .updateTable("keystone.invoice")
      .set({ estimate_id: estimateId ?? null })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", invoiceId));

    // If we have a Stripe Invoice id from Quote.accept, store it
    if (stripeInvoiceId) {
      await run(tx, kdb
        .updateTable("keystone.invoice")
        .set({ stripe_invoice_id: stripeInvoiceId ?? null })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", invoiceId));
    }

    // Copy line items: BYTE-FOR-BYTE INSERT...SELECT
    const lineColumns = [
      'service_id', 'package_id', 'plan_id', 'name_snapshot',
      'unit_amount_minor', 'quantity', 'discount_minor', 'tax_minor',
      'currency', 'price_id', 'contracted_price_id', 'discount_id', 'position'
    ];

    await run(tx, kdb
      .insertInto("keystone.line_item")
      .columns(["tenant_id", "invoice_id", ...lineColumns])
      .expression(
        kdb.selectFrom("keystone.line_item")
          .select([
            "tenant_id",
            sql`${sql.val(invoiceId)}`.as("invoice_id"),
            ...lineColumns,
          ])
          .where("tenant_id", "=", tenantId)
          .where("estimate_id", "=", estimateId)
          .where("status", "=", "active")
      ));

    // Send the invoice
    await sendInvoice(tx, { tenantId, invoiceId, actorUserId: null });

    // Update estimate to mark as converted
    await run(tx, kdb
      .updateTable("keystone.estimate")
      .set({ status: "converted", converted_invoice_id: invoiceId ?? null, updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", estimateId));

    await emit(tx, {
      tenantId, topic: "money.estimate.converted", emittedBy: SECTION,
      subjectType: "estimate", subjectId: estimateId,
      actor: "system", // RUN-2: emit() takes an actor STRING (outbox.mjs ACTOR_SHAPE); the object/word here threw TopicViolation and rolled the write back (public estimate link: no signed-in actor)
      payload: { converted_invoice_id: invoiceId },
    });
  }

  // If document_template_id is set, attempt to create and send a document
  // ★ DOCUSTAY WALL FIX (recon+build round 2, 29 Sep 2026) — this dynamic `await import(
  //   "../documents/writes.mjs")` was the "attach to an estimate so signing accepts it" plug-in
  //   your brief asked about, and it went undetected by documents_wall.mjs's first version: the
  //   gate only matched static `from "…"` imports, not a dynamic `import(…)` call. Both fixed —
  //   the gate now catches dynamic imports too (and kysely JOIN targets, which caught two more
  //   crossings a few lines below), and this one is repointed to the front door, same functions,
  //   same call shape, zero logic change.
  if (estimate.document_template_id) {
    try {
      const docResult = await createInstance(tx, {
        tenantId,
        builder: "form",
        title: estimate.title ? `Estimate: ${estimate.title}` : "Estimate",
        templateId: estimate.document_template_id,
        subjectUserId: estimate.recipient_user_id,
        actorUserId: null,
      });

      await sendInstance(tx, {
        tenantId,
        instanceId: docResult.id,
        actorUserId: null,
      });
    } catch (e) {
      // Document attachment failed, but acceptance already succeeded
      console.error(`Failed to attach document to estimate ${estimateId}: ${e.message}`);
    }
  }

  // ★★★ PLAN-BACKED ESTIMATE: accepts into startClientSubscription with created_by_estimate_id
  if (estimate.starts_plan_id) {
    // ★ SAVEPOINT: this runs in the acceptance's own transaction. A swallowed SQL error without one
    //   leaves Postgres in "current transaction is aborted" and the acceptance fails anyway, later.
    await tx.query("SAVEPOINT estimate_subscription");
    let contractId = null;
    try {
      const { startSubscriptionFromEstimate } = await import("./subscriptions.mjs");
      // ★ The contract is the recipient's EXECUTED agreement whose template starts this plan
      //   (subscription.contract_id → document_instance). There is no plan_subscription_contract
      //   table — this never ran (26 Sep 2026). None on file → null (the column is nullable).
      // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
      const contractRows = await executedInstanceStartingPlanFor(tx, {
        tenantId, planId: estimate.starts_plan_id, subjectUserId: estimate.recipient_user_id,
      });
      contractId = contractRows[0]?.id ?? null;

      // Call startSubscriptionFromEstimate with created_by_estimate_id metadata lineage
      await startSubscriptionFromEstimate(tx, {
        tenantId,
        planId: estimate.starts_plan_id,
        appUserId: estimate.recipient_user_id,
        contractId,
        createdByEstimateId: estimateId,
        estimateId,
        actorUserId: null,
      }, { fetchImpl });
      await tx.query("RELEASE SAVEPOINT estimate_subscription");
    } catch (e) {
      // Subscription creation failed; the acceptance stands (and the transaction is usable again)
      await tx.query("ROLLBACK TO SAVEPOINT estimate_subscription");
      // ★ The failed attempt is undone by the rollback above; the acceptance itself still commits.
      //   Recorded as an event so a retried job (B-5b) can pick it up and, on give-up, notify the
      //   owner.
      await emit(tx, {
        tenantId, topic: "money.subscription.start_failed", emittedBy: "money",
        subjectType: "subscription", subjectId: estimate.starts_plan_id,
        payload: {
          planId: estimate.starts_plan_id,
          appUserId: estimate.recipient_user_id,
          contractId,
          createdByDocumentId: null,
          estimateId,
        },
      });
    }
  }
}

/**
 * Decline an estimate.
 * If the estimate has a Stripe Quote, cancel it (both sides).
 */
export async function declineEstimate(tx, { tenantId, estimateId, reason, actorUserId }, { fetchImpl = globalThis.fetch } = {}) {
  if (!tenantId || !estimateId) throw invalid("tenantId and estimateId are required");

  const { rows: estimateRows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(["id", "status", "stripe_quote_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId));

  if (estimateRows.length === 0) throw conflict("This estimate cannot be declined.");

  const estimate = estimateRows[0];

  const { rows } = await run(tx, kdb
    .updateTable("keystone.estimate")
    .set({ status: "declined", declined_at: sql`now()`, decline_reason: reason ?? null, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId)
    .where("status", "in", ["sent", "opened"])
    .returning(["id", "status"]));

  if (rows.length === 0) throw conflict("Only a sent or opened estimate can be declined.");

  // ★★★ STRIPE QUOTE CANCELLATION: If estimate has a Stripe Quote, cancel it
  if (estimate.stripe_quote_id) {
    try {
      await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: `/quotes/${estimate.stripe_quote_id}/cancel`,
        sdk: (s, o, form, query) => s.quotes.cancel(estimate.stripe_quote_id, {}, o),
        form: {},
        movesMoney: false,
        purpose: "decline_estimate_quote",
        actorUserId,
      }, { fetchImpl });
    } catch (e) {
      throw dependency(`Stripe refused this: ${e.message}`, e);
    }
  }

  await emit(tx, {
    tenantId, topic: "money.estimate.declined", emittedBy: SECTION,
    subjectType: "estimate", subjectId: estimateId,
    actor: userActor(actorUserId),
    payload: {},
  });

  return { id: rows[0].id, status: rows[0].status };
}

/**
 * ESTIMATE_EXPIRING_FACT — used by the due-sweep.
 */
export const ESTIMATE_EXPIRING_FACT = {
  key: "estimate_expiring",
  why: "an estimate expires soon and nobody has told the recipient",
  find: (tx, { tenantId }) => run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(["id", "recipient_user_id", "expires_at"])
    .where("tenant_id", "=", tenantId)
    .where("status", "in", ["sent", "opened"])
    .where("expires_at", "is not", null)
    .where("expires_at", ">", sql`now()`)
    .where("expires_at", "<=", sql`now() + interval '3 days'`)
    .where("expiring_told_at", "is", null)
    .orderBy("expires_at")),
  act: async (tx, { tenantId, row }) => {
    await run(tx, kdb
      .updateTable("keystone.estimate")
      .set({ expiring_told_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", row.id));

    await emit(tx, {
      tenantId, topic: "money.estimate.expiring", emittedBy: SECTION,
      subjectType: "estimate", subjectId: row.id,
      actor: "worker",
      payload: { expires_at: row.expires_at, recipient_user_id: row.recipient_user_id },
    });

    return `estimate ${row.id} expiring on ${row.expires_at?.toISOString?.() ?? row.expires_at}`;
  },
};

/**
 * ESTIMATE_EXPIRED_FACT — used by the due-sweep.
 * When an estimate expires, mark it as expired AND cancel the Stripe Quote if one exists.
 */
export const ESTIMATE_EXPIRED_FACT = {
  key: "estimate_expired",
  why: "an estimate is past its expiration date",
  find: (tx, { tenantId }) => run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(["id", "expires_at", "stripe_quote_id"])
    .where("tenant_id", "=", tenantId)
    .where("status", "in", ["sent", "opened"])
    .where("expires_at", "is not", null)
    .where("expires_at", "<=", sql`now()`)
    .orderBy("expires_at")),
  act: async (tx, { tenantId, row }, { fetchImpl = globalThis.fetch } = {}) => {
    const { rowCount } = await run(tx, kdb
      .updateTable("keystone.estimate")
      .set({ status: "expired", updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", row.id)
      .where("status", "in", ["sent", "opened"]));

    if (rowCount === 0) return null;

    // ★★★ BOTH CLOCKS AGREE: Cancel the Stripe Quote if one exists
    if (row.stripe_quote_id) {
      try {
        await stripeConnectedRequest(tx, {
          tenantId,
          method: "POST",
          path: `/quotes/${row.stripe_quote_id}/cancel`,
          sdk: (s, o, form, query) => s.quotes.cancel(row.stripe_quote_id, {}, o),
          form: {},
          movesMoney: false,
          purpose: "expire_estimate_quote",
          actorUserId: null,
        }, { fetchImpl });
      } catch (e) {
        // Log but don't fail the expiry — the estimate is already marked expired
        console.error(`Failed to cancel Stripe Quote for expired estimate ${row.id}: ${e.message}`);
      }
    }

    await emit(tx, {
      tenantId, topic: "money.estimate.expired", emittedBy: SECTION,
      subjectType: "estimate", subjectId: row.id,
      actor: "worker",
      payload: { expires_at: row.expires_at },
    });

    return `estimate ${row.id} marked expired`;
  },
};

/**
 * ★★★ T1.23 — THE ESTIMATE EDITOR READ (F804). `GET /api/money/estimates/:id/editor` — exactly the
 * fields EstimateEditor.svelte reads (measured 27 Sep 2026: `estimate.document_template_id …
 * estimate.updated_at`, `estimate?.amount_minor`, `lineItems`). `lineItems` is the estimate's own
 * `line_item` rows (`estimate_id = id`), ordered by `position`, active only — the same filter
 * `sendEstimate`/`recomputeEstimateTotals` above already use for "what this estimate currently bills".
 */
export async function estimateEditor(db, { tenantId, id }) {
  if (!tenantId || !id) throw invalid("tenantId and id are required");

  const { rows: estimateRows } = await run(db, kdb
    .selectFrom("keystone.estimate as e")
    .leftJoin("keystone.app_user as u", (join) => join
      .onRef("u.id", "=", "e.recipient_user_id")
      .onRef("u.tenant_id", "=", "e.tenant_id"))
    .select([
      "e.id", "e.title", "e.message", "e.status", "e.good_for_days", "e.on_accept_invoice",
      "e.on_accept_record", "e.document_template_id", "e.recipient_user_id",
      "u.display_name as recipient_display_name", "e.sent_at", "e.updated_at", "e.amount_minor",
    ])
    .where("e.tenant_id", "=", tenantId)
    .where("e.id", "=", id));

  if (estimateRows.length === 0) throw notFound("no such estimate in this practice");

  const { rows: lineItems } = await run(db, kdb
    .selectFrom("keystone.line_item")
    .select(["id", "name_snapshot", "unit_amount_minor", "quantity", "discount_minor", "tax_minor", "currency", "position"])
    .where("tenant_id", "=", tenantId)
    .where("estimate_id", "=", id)
    .where("status", "=", "active")
    .orderBy("position"));

  return { estimate: estimateRows[0], lineItems };
}

/**
 * ★★★ P3.S9 — Cancel an estimate (staff side).
 * Only a draft, sent or opened estimate can be cancelled. If it has a Stripe Quote, cancel that
 * first (Stripe-first, same order as declineEstimate above) before the local row moves.
 */
export async function cancelEstimate(tx, { tenantId, estimateId, actorUserId }) {
  if (!tenantId || !estimateId) throw invalid("tenantId and estimateId are required");

  const { rows: estimateRows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(["id", "status", "stripe_quote_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId));

  if (estimateRows.length === 0) throw notFound("no such estimate in this practice");

  const estimate = estimateRows[0];

  if (!['draft', 'sent', 'opened'].includes(estimate.status)) {
    throw conflict(`This estimate is already ${estimate.status}.`);
  }

  if (estimate.stripe_quote_id) {
    try {
      await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: `/quotes/${estimate.stripe_quote_id}/cancel`,
        sdk: (s, o, form, query) => s.quotes.cancel(estimate.stripe_quote_id, {}, o),
        form: {},
        movesMoney: false,
        purpose: "cancel_estimate_quote",
        actorUserId,
      });
    } catch (e) {
      throw dependency(`Stripe refused this: ${e.message}`, e);
    }
  }

  const { rows } = await run(tx, kdb
    .updateTable("keystone.estimate")
    .set({ status: "cancelled", cancelled_at: sql`now()`, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId)
    .where("status", "in", ["draft", "sent", "opened"])
    .returning(["id", "status", "cancelled_at"]));

  if (rows.length === 0) throw conflict(`This estimate is already ${estimate.status}.`);

  await emit(tx, {
    tenantId, topic: "money.estimate.cancelled", emittedBy: SECTION,
    subjectType: "estimate", subjectId: estimateId,
    actor: userActor(actorUserId),
    payload: { cancelled_at: rows[0].cancelled_at },
  });

  return { id: rows[0].id, status: rows[0].status };
}

/**
 * ★ PHASE-4 L5.2 — STRIPE'S SIDE MOVED THE QUOTE TO `accepted` OR `canceled`, and this mirrors it.
 * This is the webhook-driven counterpart to acceptEstimate/cancelEstimate above: those are called
 * FROM this app and tell Stripe; this one is called when Stripe's own state already changed.
 *
 * Looks up `keystone.estimate` by `tenant_id` + `stripe_quote_id = event.data.object.id`.
 * No such estimate → `{ applied: false, reason: 'no_such_estimate' }`, nothing changes.
 * `quote.accepted` → `status='accepted', accepted_at=now()`, emits `money.estimate.accepted`.
 * ★★★ R17 (RECONCILE, the maintainer 27 Sep): a quote accepted in Stripe runs the same post-accept steps (runEstimateAcceptanceSteps), gated on the estimate still being sent/opened — an acceptance this app made echoes back as a replay and runs nothing.
 * `quote.canceled` → `status='cancelled', cancelled_at=now()`, emits `money.estimate.cancelled`.
 * ★★ ONLY UPDATES WHEN THE STATUS ACTUALLY CHANGES — a Stripe redelivery of the same event is a
 * no-op, same discipline as `handleStripeInvoiceStatusEvent` in invoices.mjs (L5.1).
 */
export async function handleStripeQuoteStatusEvent(tx, event, { tenantId }) {
  const stripeQuoteId = event.data?.object?.id;

  const { rows: estimateRows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select(["id", "status", "recipient_user_id", "title", "amount_minor", "on_accept_invoice", "document_template_id", "starts_plan_id"])
    .where("tenant_id", "=", tenantId)
    .where("stripe_quote_id", "=", stripeQuoteId));

  if (estimateRows.length === 0) {
    return { applied: false, reason: 'no_such_estimate' };
  }

  const estimate = estimateRows[0];

  if (event.type === 'quote.accepted') {
    const { rows } = await run(tx, kdb
      .updateTable("keystone.estimate")
      .set({ status: "accepted", accepted_at: sql`now()`, updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", estimate.id)
      // ★ R17 — "not already done": only an estimate still waiting (sent/opened) moves. One this app already accepted
      //   (accepted / converted) is our own acceptance echoing back → replay, and the steps never run twice.
      .where("status", "in", ["sent", "opened"])
      .returning(["id", "accepted_at"]));

    if (rows.length === 0) {
      return { applied: false, reason: 'replay', estimateId: estimate.id };
    }

    await emit(tx, {
      tenantId, topic: "money.estimate.accepted", emittedBy: SECTION,
      subjectType: "estimate", subjectId: estimate.id,
      actor: "webhook:stripe",
      payload: { accepted_at: rows[0].accepted_at, stripe_quote_id: stripeQuoteId },
    });

    // ★ R17 — a quote accepted directly in Stripe gets the same steps as one accepted here. Stripe already created the
    //   invoice for the accepted quote; its id rides on the quote object (a string id, or an object when expanded).
    const quoteInvoice = event.data?.object?.invoice;
    const stripeInvoiceId = typeof quoteInvoice === "string" ? quoteInvoice : (quoteInvoice?.id ?? null);
    await runEstimateAcceptanceSteps(tx, { tenantId, estimateId: estimate.id, estimate, stripeInvoiceId });

    return { applied: true, reason: 'estimate_accepted', estimateId: estimate.id };
  }

  if (event.type === 'quote.canceled') {
    const { rows } = await run(tx, kdb
      .updateTable("keystone.estimate")
      .set({ status: "cancelled", cancelled_at: sql`now()`, updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", estimate.id)
      .where("status", "<>", "cancelled")
      .returning(["id", "cancelled_at"]));

    if (rows.length === 0) {
      return { applied: false, reason: 'replay', estimateId: estimate.id };
    }

    await emit(tx, {
      tenantId, topic: "money.estimate.cancelled", emittedBy: SECTION,
      subjectType: "estimate", subjectId: estimate.id,
      actor: "webhook:stripe",
      payload: { cancelled_at: rows[0].cancelled_at, stripe_quote_id: stripeQuoteId },
    });

    return { applied: true, reason: 'estimate_cancelled', estimateId: estimate.id };
  }

  return { applied: false, reason: 'unhandled_event_type', type: event.type };
}

/**
 * Return an estimate as a logged-out client would see it. Excludes decline_reason and staff fields.
 */
export async function publicEstimateView(tx, { tenantId, estimateId }) {
  if (!tenantId || !estimateId) throw invalid("tenantId and estimateId are required");

  const { rows } = await run(tx, kdb
    .selectFrom("keystone.estimate")
    .select([
      "id", "estimate_number", "title", "message", "status", "currency",
      "subtotal_minor", "discount_minor", "tax_minor", "amount_minor",
      "good_for_days", "expires_at", "sent_at", "opened_at", "accepted_at", "declined_at",
    ])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", estimateId));

  if (rows.length === 0) throw notFound("no such estimate in this practice");

  return rows[0];
}
