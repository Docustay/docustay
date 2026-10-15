// @ts-check
// Stage 15 task 15.16 — send an invoice to a payer
// Stage 20 task 20.60 — push invoice to Stripe on send

import { emit, userActor } from "../events/outbox.mjs";
import { getSetting } from "../settings/writes.mjs";
import { MONEY_DEFAULTS } from "../settings/keys.mjs";
import { ensureCustomer } from "./customers.mjs";
import { invalid, conflict, notFound, dependency } from "../http/errors.mjs";
import { getConnectAccountState } from "./connect.mjs";
import { pushInvoiceToStripe } from "./invoiceStripe.mjs";
// ★ L3 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; same SQL
//   semantics (same WHERE clauses, same ORDER BY, same ON CONFLICT DO NOTHING). `sql` is the escape
//   hatch for `now()` and other things the builder does not express.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "money";

/**
 * ★★ SEND AN INVOICE. Transition from draft to open, create Stripe mirror if connected,
 * emit the sent event.
 *
 * Steps:
 * 1. Load invoice and active line items under caller's viewer
 * 2. Refuse if no lines, already sent, or payer archived
 * 3. If draft: set status='open', issue now, compute due_at if needed, create reminders if needed
 * 4. If Connect live: create Stripe invoice + line items, finalize (with charges-off handling)
 * 5. Set sent_at, emit money.invoice.sent
 *
 * @param tx the transaction
 * @param options { tenantId, invoiceId, actorUserId }
 * @param deps optional { fetchImpl, env } for testing
 */
export async function sendInvoice(tx, { tenantId, invoiceId, actorUserId }, deps = {}) {
  if (!tenantId || !invoiceId) throw invalid("tenantId and invoiceId are required");

  // ── Step 1: Load the invoice and its active line items ──────────────────────────────────────
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "status", "sent_at", "payer_user_id", "amount_minor", "currency",
      "invoice_number", "due_at", "payment_terms_days", "reminders_enabled", "stripe_invoice_id",
      // ★ specs/INVOICE-SEND-FIX.md §2.8 — every per-invoice setting the editor lets a staff
      //   member set has to actually reach the Stripe invoice created here, not just this
      //   function's own local row update. Collection method decides send_invoice vs. autocharge
      //   (ruling §4); memo/footer/custom_fields were being silently dropped at Send before this.
      "collection_method", "payment_method_types", "statement_descriptor", "memo", "rendering",
      "custom_fields"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");

  const invoice = invoiceRows[0];

  // ── Step 1 continued: Load active line items ───────────────────────────────────────────────
  const { rows: lineItems } = await run(tx, db
    .selectFrom("keystone.line_item")
    .select(["id", "name_snapshot", "unit_amount_minor", "quantity", "discount_minor", "tax_minor"])
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId)
    .where("status", "=", "active")
    .orderBy("position", "asc"));

  // ── Step 2: Refuse if no lines ─────────────────────────────────────────────────────────────
  if (lineItems.length === 0) {
    throw invalid("An invoice needs at least one line.");
  }

  // ── Step 2 continued: Refuse if already sent ───────────────────────────────────────────────
  if (invoice.sent_at !== null) {
    throw conflict("Already sent.");
  }

  // ── Step 2 continued: Check payer is not archived ──────────────────────────────────────────
  const { rows: payerRows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["id", "archived_at"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoice.payer_user_id));

  if (payerRows.length === 0) throw notFound("payer not found");
  if (payerRows[0].archived_at !== null) {
    throw invalid("That person is archived.");
  }

  // ── Step 3: If draft, update status and dates ──────────────────────────────────────────────
  let dueAt = invoice.due_at;
  if (invoice.status === 'draft') {
    // Compute due_at from payment_terms_days if not set
    if (dueAt === null) {
      const terms = await getSetting(tx, 'money.payment_terms_days', MONEY_DEFAULTS['money.payment_terms_days']);
      if (terms !== null && terms > 0) {
        const now = new Date();
        dueAt = new Date(now.getTime() + terms * 24 * 60 * 60 * 1000);
      }
    }

    // ★ F819/0535 — `reminders_enabled === false` is an EXPLICIT "off", set by the editor before
    //   send (webreact InvoiceEditor.jsx). That must skip default-creation entirely: with zero
    //   invoice_reminder rows and none created here, INVOICE_REMINDER_FACT's sweep
    //   (src/money/reminders.mjs:24) has nothing to find for this invoice, ever. `null` (never
    //   decided) and `true` (explicitly on) both keep today's behaviour — create the practice's
    //   default set if none exist yet.
    if (invoice.reminders_enabled !== false) {
      // Create reminder rows if none exist
      const { rows: reminderRows } = await run(tx, db
        .selectFrom("keystone.invoice_reminder")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("invoice_id", "=", invoiceId));

      if (reminderRows.length === 0) {
        const reminderDays = await getSetting(tx, 'money.reminder_days', MONEY_DEFAULTS['money.reminder_days']);
        if (Array.isArray(reminderDays)) {
          for (const offsetDays of reminderDays) {
            await run(tx, db
              .insertInto("keystone.invoice_reminder")
              .values({ tenant_id: tenantId, invoice_id: invoiceId, offset_days: offsetDays })
              .onConflict((oc) => oc.columns(["invoice_id", "offset_days"]).doNothing()));
          }
        }
      }
    }

    // Update invoice status to 'open' and issued_at
    await run(tx, db
      .updateTable("keystone.invoice")
      .set({ status: "open", issued_at: sql`now()`, due_at: dueAt, updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", invoiceId));
  }

  // ── Step 4: Push to Stripe mirror, only when Connect is live ───────────────────────────────
  let stripeResult = null;
  const connectState = await getConnectAccountState(tx, tenantId);

  if (connectState.state === 'live') {
    try {
      // Step 4a: Ensure customer exists on Stripe
      const customerResult = await ensureCustomer(tx, {
        tenantId,
        personId: invoice.payer_user_id,
      });
      const customerId = customerResult?.customerId;

      if (customerId) {
        // Step 4b: Get invoice prefix from settings
        const invoicePrefix = await getSetting(tx, 'money.invoice_prefix', MONEY_DEFAULTS['money.invoice_prefix']) || '';

        // Step 4c: Load the payer's account to pass to metadata
        // ★ a person's account is account_contact, not a column on app_user
        const { rows: payerRows } = await run(tx, db
          .selectFrom("keystone.account_contact")
          .select("account_id")
          .where("tenant_id", "=", tenantId)
          .where("app_user_id", "=", invoice.payer_user_id)
          .orderBy("account_id", "asc")
          .limit(1));
        const accountId = payerRows.length > 0 ? payerRows[0].account_id : null;

        // Step 4d: Call pushInvoiceToStripe to create and finalize
        stripeResult = await pushInvoiceToStripe(tx, {
          tenantId,
          invoiceId,
          customerId,
          currency: invoice.currency,
          invoiceNumber: invoice.invoice_number,
          invoicePrefix,
          lines: lineItems,
          payerUserId: invoice.payer_user_id,
          accountId,
          actorUserId,
          // ★ the maintainer, 1 Oct 2026 — FOUND LIVE, the SECOND real bug this QA access surfaced: Stripe
          //   refused the invoice create with "If invoice collection method is 'send_invoice', you
          //   must specify 'due_date' or 'days_until_due'" — `dueAt` was computed right above,
          //   specifically for this invoice, and never passed to the one function that talks to
          //   Stripe. Every real `send_invoice`-collection invoice has hit this.
          dueAt,
          collectionMethod: invoice.collection_method || undefined,
          paymentMethodTypes: invoice.payment_method_types || undefined,
          statementDescriptor: invoice.statement_descriptor || undefined,
          memo: invoice.memo || null,
          footer: invoice.rendering?.footer || null,
          customFields: Array.isArray(invoice.custom_fields) ? invoice.custom_fields : [],
          // ★ A retry whose earlier attempt reached Stripe's finalize call before this
          //   transaction committed leaves `stripe_invoice_id` set on a row that is still
          //   `status='draft'` locally. pushInvoiceToStripe's own reuse rule (specs/INVOICE-
          //   SEND-FIX.md §2.3) decides what to do with it — reuse only if Stripe itself already
          //   shows `open`/`paid`, otherwise create fresh — never finalize or build on it here.
          existingStripeInvoiceId: invoice.stripe_invoice_id,
        }, deps);
      }
    } catch (err) {
      throw dependency(`Stripe refused this: ${err.message}`, err);
    }
  }

  // ── Step 5: Set sent_at and emit the event ────────────────────────────────────────────────
  await run(tx, db
    .updateTable("keystone.invoice")
    .set({ sent_at: sql`now()`, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  await emit(tx, {
    tenantId,
    topic: "money.invoice.sent",
    emittedBy: SECTION,
    subjectType: "invoice",
    subjectId: invoiceId,
    actor: userActor(actorUserId),
    payload: {
      invoice_id: invoiceId,
      payer_user_id: invoice.payer_user_id,
      amount_minor: invoice.amount_minor,
      currency: invoice.currency,
      due_at: dueAt,
      invoice_number: invoice.invoice_number,
      stripe_invoice_id: stripeResult?.stripe_invoice_id || null,
      stripe_error: stripeResult?.error || null,
    },
  });

  return {
    id: invoiceId,
    status: "open",
    sent_at: new Date(),
    stripe_invoice_id: stripeResult?.stripe_invoice_id,
    stripe_error: stripeResult?.error,
  };
}
