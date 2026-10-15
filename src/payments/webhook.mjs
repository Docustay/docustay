// @ts-check
// P8.7 / §Z2.12 — "Payment status is tracked by WEBHOOK, not polling."
//
// ★★★ THE ONE FACT THAT DETERMINES THIS FILE'S SHAPE: **A WEBHOOK IS DELIVERED AT LEAST ONCE.**
// Stripe retries on any non-2xx, on a timeout, and on its own schedule after an outage. So the
// same `payment_intent.succeeded` WILL arrive twice, and the handler that assumes otherwise
// records a second payment against the same invoice. ★ The symptom is not an error — it is an
// invoice that looks overpaid, found during a refund conversation.
//
// ★★ IDEMPOTENCY IS ENFORCED IN THE DATABASE, NOT IN THIS FILE.
// `payment_provider_id` is `UNIQUE (tenant_id, provider_payment_id)` (migration 0015). A check
// written here — "have I seen this id?" — is a read followed by a write, and two concurrent
// deliveries both read "no". ★ The unique index is the only thing that is atomic.
//
// ★★★ AND NOTHING HERE CALLS STRIPE. This module CONSUMES events. Creating a charge is a
// different act, it is not in this file, and per hard limit 1 it does not happen without the maintainer
// in-session.

/** ★ Events we act on. An unknown type is IGNORED, never guessed at. */
export const HANDLED_EVENTS = Object.freeze([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.paid',
  'checkout.session.completed',
  'payout.paid',
  'payout.failed',
  'charge.dispute.created',
  'charge.dispute.closed',
  'charge.dispute.updated',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'payment_method.attached',
  'payment_method.updated',
  'payment_method.detached',
  // ★★★ FOUND, saved-card brief (1 Oct 2026, Part 3) — MEASURED: none of these three were in this
  //   list, so Stripe sent them and the webhook silently returned {applied:false,
  //   reason:'unhandled_event_type'} for every one. `automatically_updated` fires when the card
  //   network replaces an expiring/reissued card behind the scenes (no attach/detach pair at all —
  //   the only signal); `customer.updated` is how a default-payment-method change made directly on
  //   Stripe's side (support, Dashboard, another integration) would ever reach the platform;
  //   `setup_intent.succeeded` is the save-a-card flow that runs with NO Checkout Session at all
  //   (the belt-and-braces off_session flow this same brief's Part 3 adds to every invoice) —
  //   `checkout.session.completed`'s own `mode==='setup'` branch never fires for it.
  'payment_method.automatically_updated',
  'customer.updated',
  'setup_intent.succeeded',
  'invoice.finalized',
  'charge.succeeded',
  'customer.source.expiring',
  'invoice.upcoming',
  // ★ [Stripe webhook crisis, 2 Oct 2026] was 'credit_note.issued' — Stripe has no such event.
  //   The real event is 'credit_note.created'; this handler could never have fired. 'issued' is
  //   our own internal status/topic name, not Stripe's event name — kept for the topic below.
  'credit_note.created',
  'credit_note.voided',
  // ★ [Stripe webhook crisis, 2 Oct 2026] was 'customer.tax_id.verification_succeeded'/
  //   'verification_failed' — neither is a real Stripe event (confirmed against Stripe's own live
  //   enabled_events enum). The real event is 'customer.tax_id.updated'; the verification result
  //   is a field on the object, not a separate event type. See taxIds.mjs's own comment.
  'customer.tax_id.updated',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'quote.accepted',
  'quote.canceled',
  'subscription_schedule.completed',
  'subscription_schedule.canceled',
  'subscription_schedule.released',
]);

export class WebhookRejected extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'WebhookRejected';
    this.reason = reason;
  }
}

/**
 * ★★ Handle one delivery. Returns {applied, reason} — a REPLAY is a SUCCESS, not an error.
 *
 * ★★★ THAT DISTINCTION IS LOAD-BEARING. If a replay returned a non-2xx, Stripe would retry it,
 * which produces another replay, which returns non-2xx… ★ A handler that treats duplicates as
 * failures manufactures the retry storm it is trying to survive. A replay must be acknowledged.
 *
 * @param tx     a pg client inside a transaction, tenant context set
 * @param event  { id, type, data } — already signature-verified by the caller
 */
import { emit } from "../events/outbox.mjs";
import { runWithScope } from "../money/idempotencyScope.mjs";
import { handlePaymentIntentSucceeded, handleStripeInvoicePaid } from "../money/payments.mjs";
import { handleInstallmentPaid, handleStripeScheduleStatusEvent } from "../money/paymentPlans.mjs";
import { handlePaymentLinkCompleted } from "../money/paymentLinks.mjs";
import { handleSetupCompleted, handlePaymentMethodEvent, handleSetupIntentSucceeded, handleCustomerUpdated } from "../money/cardUpdate.mjs";
import { handleDisputeUpdated } from "../money/disputes.mjs";
import { handleSubscriptionEvent } from "../money/subscriptions.mjs";
import { handleTaxIdVerificationWebhook } from "../money/taxIds.mjs";
import { handleGiftCardSalePaid } from "../money/giftCardSales.mjs";
import { handleInvoicePaymentFailed, handleSubscriptionInvoicePaid } from "../money/dunning.mjs";
import { handleStripeInvoiceStatusEvent } from "../money/invoices.mjs";
import { handleStripeQuoteStatusEvent } from "../money/estimates.mjs";
import { voidCreditsForRefundedCharge } from "../money/creditGrant.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

export async function handlePaymentWebhook(tx, event, { tenantId, now = new Date() } = {}) {
  return runWithScope(`evt:${event.id}`, async () => {
  if (!event?.id || !event?.type) {
    throw new WebhookRejected('event is missing id or type', 'malformed');
  }

  // ★ An unrecognised type is acknowledged and ignored. Stripe adds event types over time, and a
  // handler that throws on an unfamiliar one turns a Stripe product change into our outage.
  if (!HANDLED_EVENTS.includes(event.type)) {
    return { applied: false, reason: 'unhandled_event_type', type: event.type };
  }

  const d = event.data?.object ?? {};

  switch (event.type) {
    case 'payment_intent.succeeded': {
      // ★★★ DISPATCH: Gift card sale or payment allocation
      if (d.metadata?.keystone_gift_card_sale === "1") {
        try {
          await handleGiftCardSalePaid(tx, event, { tenantId });
          return { applied: true, reason: 'gift_card_sale_paid' };
        } catch (e) {
          return { applied: false, reason: 'handler_error', error: e.message };
        }
      }

      // ★ Dispatch to payment handler (task 15.14) if it exists — else fall back to basic logic
      try {
        await handlePaymentIntentSucceeded(tx, event, { tenantId });
        return { applied: true, reason: 'payment_intent_succeeded' };
      } catch (e) {
        return { applied: false, reason: 'handler_not_yet_landed' };
      }

      // ★ TASK 15.1 FALLBACK: Basic payment recording for non-special cases
      const providerPaymentId = d.id;
      const invoiceId = d.keystone_invoice_id ?? null;
      if (!providerPaymentId) throw new WebhookRejected('no provider payment id', 'malformed');

      // ★★★ THE IDEMPOTENT WRITE. `ON CONFLICT DO NOTHING` against the unique index means a
      // redelivery inserts nothing and reports zero rows — atomically, with no prior read.
      const ins = await tx.query(
        `INSERT INTO keystone.payment
           (tenant_id, invoice_id, payer_user_id, amount_minor, currency, status, provider_payment_id)
         VALUES ($1,$2,$3,$4,$5,'succeeded',$6)
         ON CONFLICT (tenant_id, provider_payment_id) WHERE provider_payment_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [tenantId, invoiceId, d.keystone_payer_id, d.amount_received ?? d.amount_paid,
         (d.currency ?? 'usd').toUpperCase(), providerPaymentId]);

      if (ins.rowCount === 0) {
        return { applied: false, reason: 'replay', providerPaymentId };
      }

      // ★ Mark the invoice paid only when a payment was genuinely recorded. Doing it
      // unconditionally would let a replay re-open-then-re-close an invoice that had since been
      // voided — a state change caused by nothing.
      let invoiceClosed = false;
      if (invoiceId) {
        const upd = await run(tx, db
          .updateTable("keystone.invoice")
          .set({ status: "paid" })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", invoiceId)
          .where("status", "=", "open"));
        invoiceClosed = upd.rowCount === 1;
      }

      // ★★★ §X4.1 — THE EVENT, IN THE SAME TRANSACTION. P15B.2.
      // ★★ REACHED ONLY AFTER THE REPLAY GUARD. The `rowCount === 0` return above has already left,
      //    so a Stripe redelivery — which Stripe WILL send — emits nothing. An event per delivery
      //    would mean "paid" receipts sent repeatedly for one payment, which is money-adjacent and
      //    the kind of thing a customer notices before we do.
      // ★ `money.invoice.paid` is the topic even when there is no invoice row, because the section's
      //   catalogue has no bare `payment.succeeded` and inventing one is a schema change, not a
      //   string (P15B.3). `invoice_closed` says which actually happened, so a consumer never has
      //   to guess from the topic alone.
      await emit(tx, {
        tenantId,
        topic: "money.invoice.paid",
        emittedBy: "money",
        subjectType: "payment",
        subjectId: ins.rows[0].id,
        // ★ STAGE 3 TASK 1 — this whole module IS the Stripe webhook receiver; there is no session,
        //   only a provider callback. See outbox.mjs's ACTOR_SHAPE.
        actor: "webhook:stripe",
        payload: {
          invoice_id: invoiceId,
          invoice_closed: invoiceClosed,
          amount_minor: d.amount_received ?? d.amount_paid,
          currency: (d.currency ?? "usd").toUpperCase(),
        },
      });
      return { applied: true, paymentId: ins.rows[0].id };
    }

    case 'invoice.payment_succeeded': {
      // ★★★ TASK 20.73 — INVOICE PAYMENT RECONCILIATION (partial/full/overpaid)
      // When a payment is received against an open invoice, update amount_remaining and amount_overpaid.
      // This fold applies to ANY invoice payment, handling partial, full, and overpaid cases.
      const invoiceId = d.invoice;
      const amountPaidMinor = d.amount_received ?? d.amount ?? 0;
      if (invoiceId && amountPaidMinor > 0) {
        try {
          const invoiceRes = await run(tx, db
            .selectFrom("keystone.invoice")
            .select(["id", "amount_minor"])
            .where("tenant_id", "=", tenantId)
            .where("id", "=", invoiceId)
            .where("status", "=", "open"));

          if (invoiceRes.rows.length > 0) {
            const invoice = invoiceRes.rows[0];
            const invoiceAmountMinor = invoice.amount_minor;

            // ★ Read current allocation total to know what's been paid so far
            const allocRes = await tx.query(
              `SELECT COALESCE(SUM(amount_minor), 0) as allocated
               FROM keystone.payment_allocation
               WHERE tenant_id = $1 AND invoice_id = $2 AND state = 'applied'`,
              [tenantId, invoiceId]);
            const previouslyAllocatedMinor = allocRes.rows[0]?.allocated || 0;

            // ★ Calculate new running total and reconcile with invoice
            const totalPaidMinor = previouslyAllocatedMinor + amountPaidMinor;
            const amountRemainingMinor = Math.max(0, invoiceAmountMinor - totalPaidMinor);
            const amountOverpaidMinor = Math.max(0, totalPaidMinor - invoiceAmountMinor);

            // ★ Update invoice with reconciled amounts
            await run(tx, db
              .updateTable("keystone.invoice")
              .set({
                amount_remaining_minor: amountRemainingMinor ?? null,
                amount_overpaid_minor: amountOverpaidMinor ?? null,
                updated_at: sql`now()`
              })
              .where("tenant_id", "=", tenantId)
              .where("id", "=", invoiceId));

            await emit(tx, {
              tenantId,
              topic: "money.invoice.payment_reconciled",
              emittedBy: "money",
              subjectType: "invoice",
              subjectId: invoiceId,
              actor: "webhook:stripe",
              payload: {
                amount_paid_minor: amountPaidMinor,
                total_paid_minor: totalPaidMinor,
                amount_remaining_minor: amountRemainingMinor,
                amount_overpaid_minor: amountOverpaidMinor,
              },
            });
          }
        } catch (e) {
          // Log but don't fail the webhook — reconciliation is best-effort
          await emit(tx, {
            tenantId,
            topic: "money.invoice.reconciliation_error",
            emittedBy: "money",
            subjectType: "invoice",
            subjectId: invoiceId,
            actor: "webhook:stripe",
            payload: { error: e.message },
          });
        }
      }

      // ★★★ DISPATCH: Invoice payments — check for payment plans or subscriptions
      if (d.metadata?.keystone_plan_row_id) {
        try {
          await handleInstallmentPaid(tx, event, { tenantId });
          return { applied: true, reason: 'installment_paid' };
        } catch (e) {
          return { applied: false, reason: 'handler_error', error: e.message };
        }
      }

      if (d.subscription) {
        try {
          await handleSubscriptionInvoicePaid(tx, event, { tenantId });
        } catch (e) {
          // Continue to next handler even if this one fails
        }

        try {
          await handleStripeInvoicePaid(tx, event, { tenantId });
          return { applied: true, reason: 'subscription_invoice_paid' };
        } catch (e) {
          return { applied: false, reason: 'handler_error', error: e.message };
        }
      }

      // ★ Try general invoice payment handler
      try {
        await handleStripeInvoicePaid(tx, event, { tenantId });
        return { applied: true, reason: 'invoice_paid' };
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    case 'invoice.paid': {
      // ★★★ DISPATCH: Same as invoice.payment_succeeded — check for payment plans or subscriptions
      if (d.metadata?.keystone_plan_row_id) {
        try {
          await handleInstallmentPaid(tx, event, { tenantId });
          return { applied: true, reason: 'installment_paid' };
        } catch (e) {
          return { applied: false, reason: 'handler_error', error: e.message };
        }
      }

      if (d.subscription) {
        try {
          await handleSubscriptionInvoicePaid(tx, event, { tenantId });
        } catch (e) {
          // Continue to next handler even if this one fails
        }

        try {
          await handleStripeInvoicePaid(tx, event, { tenantId });
          return { applied: true, reason: 'subscription_invoice_paid' };
        } catch (e) {
          return { applied: false, reason: 'handler_error', error: e.message };
        }
      }

      // ★ Try general invoice payment handler
      try {
        await handleStripeInvoicePaid(tx, event, { tenantId });
        return { applied: true, reason: 'invoice_paid' };
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    case 'payment_intent.payment_failed': {
      // ★ TASK 15.1: Basic payment failure handling
      const invoiceId = d.keystone_invoice_id ?? null;
      // ★★ §Z2.11: a failed payment does NOT accumulate anything and does NOT close the invoice.
      // The invoice stays OPEN, scoped to its period, and the NEXT period gets its own invoice.
      // ★ There is deliberately no "amount owed" being incremented anywhere.
      if (invoiceId) {
        await run(tx, db
          .updateTable("keystone.invoice")
          .set({ updated_at: now ?? null })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", invoiceId)
          .where("status", "=", "open"));
      }
      // ★★★ THE EVENT IS THE ONLY TRACE A FAILED PAYMENT LEAVES. §Z2.11 is explicit that nothing
      //     accumulates and the invoice is NOT closed — so without this emit, a failed payment
      //     changes essentially no state and is therefore invisible: no dunning, no task, no
      //     notification. **The absence of a write is exactly why the event matters most here.**
      // ★ No `subjectId`: there is no payment row to point at, because nothing was paid. Pointing
      //   at the invoice would say a different thing (the invoice is fine; the attempt failed).
      // ★★★ FOUND LIVE, receipts brief (1 Oct 2026, Part 1) — a failed off-session charge (Held/
      //     no-show, no invoice at all — src/money/charge.mjs's own createChargeIntent) has NO
      //     payment row (nothing was paid) and NO invoice, so `invoiceId` is null and this event
      //     had NO WAY to name who to email — payload carried only provider_payment_id/
      //     failure_code. `payer_user_id` is resolved from the SAME metadata createChargeIntent
      //     sends on every PaymentIntent it creates (person_id — see payments.mjs's own matching
      //     fix), so MONEY_EMAILS's fast path (payload.payer_user_id) actually finds someone.
      const failedPayerId = d.metadata?.person_id ?? d.metadata?.keystone_payer_id ?? null;
      await emit(tx, {
        tenantId,
        topic: "money.payment.failed",
        emittedBy: "money",
        subjectType: invoiceId ? "invoice" : null,
        subjectId: invoiceId,
        // ★ STAGE 3 TASK 1 — see the note on the sibling emit above.
        actor: "webhook:stripe",
        payload: {
          provider_payment_id: d.id ?? null,
          failure_code: d.failure_code ?? null,
          invoice_left_open: Boolean(invoiceId),
          payer_user_id: failedPayerId,
          amount_minor: d.amount ?? null,
          currency: (d.currency ?? "usd").toUpperCase(),
        },
      });
      return { applied: true, reason: 'payment_failed_invoice_left_open' };
    }

    case 'invoice.payment_failed': {
      // ★★★ DISPATCH: Check for subscription invoice failures
      if (d.subscription) {
        try {
          await handleInvoicePaymentFailed(tx, event, { tenantId });
          return { applied: true, reason: 'subscription_invoice_payment_failed' };
        } catch (e) {
          return { applied: false, reason: 'handler_error', error: e.message };
        }
      }

      // ★ TASK 15.1 FALLBACK: Basic payment failure handling for non-subscription invoices
      const invoiceId = d.keystone_invoice_id ?? null;
      // ★★ §Z2.11: a failed payment does NOT accumulate anything and does NOT close the invoice.
      // The invoice stays OPEN, scoped to its period, and the NEXT period gets its own invoice.
      // ★ There is deliberately no "amount owed" being incremented anywhere.
      if (invoiceId) {
        await run(tx, db
          .updateTable("keystone.invoice")
          .set({ updated_at: now ?? null })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", invoiceId)
          .where("status", "=", "open"));
      }
      // ★★★ THE EVENT IS THE ONLY TRACE A FAILED PAYMENT LEAVES. §Z2.11 is explicit that nothing
      //     accumulates and the invoice is NOT closed — so without this emit, a failed payment
      //     changes essentially no state and is therefore invisible: no dunning, no task, no
      //     notification. **The absence of a write is exactly why the event matters most here.**
      // ★ No `subjectId`: there is no payment row to point at, because nothing was paid. Pointing
      //   at the invoice would say a different thing (the invoice is fine; the attempt failed).
      // ★★★ FOUND LIVE, receipts brief (1 Oct 2026, Part 1) — a failed off-session charge (Held/
      //     no-show, no invoice at all — src/money/charge.mjs's own createChargeIntent) has NO
      //     payment row (nothing was paid) and NO invoice, so `invoiceId` is null and this event
      //     had NO WAY to name who to email — payload carried only provider_payment_id/
      //     failure_code. `payer_user_id` is resolved from the SAME metadata createChargeIntent
      //     sends on every PaymentIntent it creates (person_id — see payments.mjs's own matching
      //     fix), so MONEY_EMAILS's fast path (payload.payer_user_id) actually finds someone.
      const failedPayerId = d.metadata?.person_id ?? d.metadata?.keystone_payer_id ?? null;
      await emit(tx, {
        tenantId,
        topic: "money.payment.failed",
        emittedBy: "money",
        subjectType: invoiceId ? "invoice" : null,
        subjectId: invoiceId,
        // ★ STAGE 3 TASK 1 — see the note on the sibling emit above.
        actor: "webhook:stripe",
        payload: {
          provider_payment_id: d.id ?? null,
          failure_code: d.failure_code ?? null,
          invoice_left_open: Boolean(invoiceId),
          payer_user_id: failedPayerId,
          amount_minor: d.amount ?? null,
          currency: (d.currency ?? "usd").toUpperCase(),
        },
      });
      return { applied: true, reason: 'payment_failed_invoice_left_open' };
    }

    case 'charge.refunded': {
      // ★ B1.4 — Wire Stripe charge.refunded events to the refund table
      // `event.data.object` is a Charge object with id, amount_refunded, metadata.tenantId
      const stripeRefundId = d.id;
      const amountMinor = d.amount_refunded ?? d.amount;
      if (!stripeRefundId || !Number.isInteger(amountMinor)) {
        throw new WebhookRejected('charge.refunded missing id or amount', 'malformed');
      }

      // ★★★ TASK 15.1 REPAIR — THE REPLAY GUARD WAS DEAD CODE, MEASURED: `ON CONFLICT … DO UPDATE
      // … RETURNING id` returns a row on BOTH the insert path and the update path, so
      // `ins.rowCount` was 1 either way and `=== 0` could never be true — a redelivered Stripe
      // webhook re-emitted `money.refund.recorded` on every delivery. The WHERE clause on the
      // DO UPDATE arm is the fix: a REDELIVERY of the SAME event carries the SAME
      // `external_event_id`, so `EXCLUDED.external_event_id IS DISTINCT FROM` the stored one is
      // FALSE, the conflict arm matches nothing, `RETURNING` yields zero rows, and the
      // `rowCount === 0` branch below — unreachable until this fix — now actually fires. A LATER
      // event about the same refund carries a NEW `external_event_id`, the WHERE is TRUE, the row
      // updates, and exactly one row is returned.
      const ins = await tx.query(
        `INSERT INTO keystone.refund
           (id, tenant_id, stripe_id, amount_minor, state, external_event_id, stripe_charge_id)
         VALUES (keystone.uuid_generate_v7(), $1, $2, $3, 'succeeded', $4, $5)
         ON CONFLICT (tenant_id, stripe_id) DO UPDATE
           SET amount_minor = $3, state = 'succeeded', stripe_charge_id = $5,
               external_event_id = EXCLUDED.external_event_id, updated_at = now()
         WHERE keystone.refund.external_event_id IS DISTINCT FROM EXCLUDED.external_event_id
         RETURNING id`,
        [tenantId, stripeRefundId, amountMinor, event.id, d.charge ?? d.id]);

      if (ins.rowCount === 0) return { applied: false, reason: 'replay', stripeRefundId };

      await emit(tx, {
        tenantId,
        topic: "money.refund.recorded",
        emittedBy: "money",
        subjectType: "refund",
        subjectId: ins.rows[0].id,
        actor: "webhook:stripe",
        payload: {
          stripe_id: stripeRefundId,
          amount_minor: amountMinor,
          state: 'succeeded',
        },
      });
      // ★ credits defect 16 — a refund made in Stripe's own dashboard voids a fully-refunded package's unused credits too
      await voidCreditsForRefundedCharge(tx, {
        tenantId, stripeChargeId: d.charge ?? d.id, refundedMinor: d.amount_refunded ?? 0, totalMinor: d.amount ?? 0,
      });
      return { applied: true, refundId: ins.rows[0].id };
    }

    case 'checkout.session.completed': {
      // ★★★ DISPATCH: Check for payment link or setup mode
      if (d.payment_link) {
        try {
          await handlePaymentLinkCompleted(tx, event, { tenantId });
          return { applied: true, reason: 'payment_link_completed' };
        } catch (e) {
          return { applied: false, reason: 'handler_error', error: e.message };
        }
      }

      if (d.mode === "setup") {
        try {
          await handleSetupCompleted(tx, event, { tenantId });
          return { applied: true, reason: 'setup_completed' };
        } catch (e) {
          return { applied: false, reason: 'handler_error', error: e.message };
        }
      }

      // ★ TASK 15.1 FALLBACK: Basic checkout session handling
      // ★★★ CHECKOUT SESSION COMPLETED — ONE-TIME PAYMENT FROM EMBEDDED CHECKOUT.
      // A checkout.session.completed event indicates the checkout session was successfully completed.
      // The payment_intent field contains the Stripe payment intent ID that becomes our provider_payment_id.
      // Metadata fields (keystone_invoice_id, keystone_payer_id, etc.) are passed when creating the
      // checkout session and are nested under `d.metadata` in the webhook payload.
      const paymentIntentId = d.payment_intent ?? null;
      const invoiceId = d.metadata?.keystone_invoice_id ?? null;
      const payerId = d.metadata?.keystone_payer_id ?? null;
      const amountTotal = d.amount_total ?? d.amount_total_details?.amount_total ?? null;
      const currency = d.currency ?? 'usd';

      // FINAL PUSH Stage 6 fix: a SUBSCRIPTION-mode checkout (a Documents installment plan or subscription) has no payment_intent at all, only a subscription. It is not a one-time invoice payment, so this
      // fallback has nothing to record: the document's own payment row reads its state from Stripe. It used to answer 500 and Stripe retried it for days.
      if (!paymentIntentId && (d.mode === 'subscription' || d.subscription)) {
        return { applied: false, reason: 'subscription_checkout' };
      }
      if (!paymentIntentId) {
        throw new WebhookRejected('checkout.session.completed missing payment_intent', 'malformed');
      }

      // ★★★ THE IDEMPOTENT WRITE. Same pattern as payment_intent.succeeded:
      // A redelivery inserts nothing and reports zero rows — atomically, with no prior read.
      const ins = await tx.query(
        `INSERT INTO keystone.payment
           (tenant_id, invoice_id, payer_user_id, amount_minor, currency, status, provider_payment_id)
         VALUES ($1,$2,$3,$4,$5,'succeeded',$6)
         ON CONFLICT (tenant_id, provider_payment_id) WHERE provider_payment_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [tenantId, invoiceId, payerId, amountTotal,
         currency.toUpperCase(), paymentIntentId]);

      if (ins.rowCount === 0) {
        return { applied: false, reason: 'replay', paymentIntentId };
      }

      // ★ Mark the invoice paid only when a payment was genuinely recorded.
      let invoiceClosed = false;
      if (invoiceId) {
        const upd = await run(tx, db
          .updateTable("keystone.invoice")
          .set({ status: "paid" })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", invoiceId)
          .where("status", "=", "open"));
        invoiceClosed = upd.rowCount === 1;
      }

      // ★★★ THE EVENT, IN THE SAME TRANSACTION. Same as payment_intent.succeeded.
      // Reached only after the replay guard, so a redelivery emits nothing.
      await emit(tx, {
        tenantId,
        topic: "money.invoice.paid",
        emittedBy: "money",
        subjectType: "payment",
        subjectId: ins.rows[0].id,
        actor: "webhook:stripe",
        payload: {
          invoice_id: invoiceId,
          invoice_closed: invoiceClosed,
          amount_minor: amountTotal,
          currency: currency.toUpperCase(),
          checkout_session_id: event.data.object.id,
        },
      });
      return { applied: true, paymentId: ins.rows[0].id };
    }

    case 'payout.paid': {
      // ★ B1.4 — Wire Stripe payout.paid events to the refund/payout/dispute tables
      // `event.data.object` is a Payout object with id, amount, metadata.tenantId
      const stripePayoutId = d.id;
      const amountMinor = d.amount;
      if (!stripePayoutId || !Number.isInteger(amountMinor)) {
        throw new WebhookRejected('payout.paid missing id or amount', 'malformed');
      }

      // ★★★ TASK 15.1 REPAIR — same dead-replay-guard fix as `charge.refunded` above: the DO
      // UPDATE arm's WHERE clause is what makes `ins.rowCount === 0` reachable on a genuine
      // redelivery (same `external_event_id`) while a later event about the same payout still
      // updates and returns one row. See that case's comment for the full measurement.
      const ins = await tx.query(
        `INSERT INTO keystone.payout
           (id, tenant_id, stripe_id, amount_minor, state, external_event_id,
            arrival_date, statement_descriptor, failure_message, method)
         VALUES (keystone.uuid_generate_v7(), $1, $2, $3, 'paid', $4,
                 to_timestamp($5)::date, $6, $7, $8)
         ON CONFLICT (tenant_id, stripe_id) DO UPDATE
           SET amount_minor = $3, state = 'paid', arrival_date = to_timestamp($5)::date,
               statement_descriptor = $6, failure_message = $7, method = $8,
               external_event_id = EXCLUDED.external_event_id, updated_at = now()
         WHERE keystone.payout.external_event_id IS DISTINCT FROM EXCLUDED.external_event_id
         RETURNING id`,
        [tenantId, stripePayoutId, amountMinor, event.id,
         d.arrival_date ?? null, d.statement_descriptor ?? null, d.failure_message ?? null,
         d.method ?? null]);

      if (ins.rowCount === 0) return { applied: false, reason: 'replay', stripePayoutId };

      await emit(tx, {
        tenantId,
        topic: "money.payout.recorded",
        emittedBy: "money",
        subjectType: "payout",
        subjectId: ins.rows[0].id,
        actor: "webhook:stripe",
        payload: {
          stripe_id: stripePayoutId,
          amount_minor: amountMinor,
          state: 'paid',
        },
      });
      return { applied: true, payoutId: ins.rows[0].id };
    }

    case 'payout.failed': {
      // ★ B1.4 — Wire Stripe payout.failed events to the payout table
      const stripePayoutId = d.id;
      const amountMinor = d.amount;
      if (!stripePayoutId || !Number.isInteger(amountMinor)) {
        throw new WebhookRejected('payout.failed missing id or amount', 'malformed');
      }

      // ★★★ TASK 15.1 REPAIR — same dead-replay-guard fix as `charge.refunded` above.
      const ins = await tx.query(
        `INSERT INTO keystone.payout
           (id, tenant_id, stripe_id, amount_minor, state, external_event_id,
            arrival_date, statement_descriptor, failure_message, method)
         VALUES (keystone.uuid_generate_v7(), $1, $2, $3, 'failed', $4,
                 to_timestamp($5)::date, $6, $7, $8)
         ON CONFLICT (tenant_id, stripe_id) DO UPDATE
           SET amount_minor = $3, state = 'failed', arrival_date = to_timestamp($5)::date,
               statement_descriptor = $6, failure_message = $7, method = $8,
               external_event_id = EXCLUDED.external_event_id, updated_at = now()
         WHERE keystone.payout.external_event_id IS DISTINCT FROM EXCLUDED.external_event_id
         RETURNING id`,
        [tenantId, stripePayoutId, amountMinor, event.id,
         d.arrival_date ?? null, d.statement_descriptor ?? null, d.failure_message ?? null,
         d.method ?? null]);

      if (ins.rowCount === 0) return { applied: false, reason: 'replay', stripePayoutId };

      await emit(tx, {
        tenantId,
        topic: "money.payout.recorded",
        emittedBy: "money",
        subjectType: "payout",
        subjectId: ins.rows[0].id,
        actor: "webhook:stripe",
        payload: {
          stripe_id: stripePayoutId,
          amount_minor: amountMinor,
          state: 'failed',
        },
      });
      return { applied: true, payoutId: ins.rows[0].id };
    }

    case 'charge.dispute.created': {
      // ★ B1.4 — Wire Stripe charge.dispute.created events to the dispute table
      const stripeDisputeId = d.id;
      const amountMinor = d.amount;
      if (!stripeDisputeId || !Number.isInteger(amountMinor)) {
        throw new WebhookRejected('charge.dispute.created missing id or amount', 'malformed');
      }

      // ★★★ TASK 15.1 REPAIR — same dead-replay-guard fix as `charge.refunded` above.
      const ins = await tx.query(
        `INSERT INTO keystone.dispute
           (id, tenant_id, stripe_id, amount_minor, state, external_event_id,
            stripe_charge_id, reason, evidence_due_by)
         VALUES (keystone.uuid_generate_v7(), $1, $2, $3, 'under_review', $4, $5, $6, to_timestamp($7))
         ON CONFLICT (tenant_id, stripe_id) DO UPDATE
           SET amount_minor = $3, state = 'under_review', stripe_charge_id = $5, reason = $6,
               evidence_due_by = to_timestamp($7),
               external_event_id = EXCLUDED.external_event_id, updated_at = now()
         WHERE keystone.dispute.external_event_id IS DISTINCT FROM EXCLUDED.external_event_id
         RETURNING id`,
        [tenantId, stripeDisputeId, amountMinor, event.id,
         d.charge ?? null, d.reason ?? null, d.evidence_details?.due_by ?? null]);

      if (ins.rowCount === 0) return { applied: false, reason: 'replay', stripeDisputeId };

      await emit(tx, {
        tenantId,
        topic: "money.dispute.recorded",
        emittedBy: "money",
        subjectType: "dispute",
        subjectId: ins.rows[0].id,
        actor: "webhook:stripe",
        payload: {
          stripe_id: stripeDisputeId,
          amount_minor: amountMinor,
          state: 'under_review',
        },
      });
      return { applied: true, disputeId: ins.rows[0].id };
    }

    case 'charge.dispute.closed': {
      // ★ B1.4 — Wire Stripe charge.dispute.closed events to the dispute table
      const stripeDisputeId = d.id;
      const amountMinor = d.amount;
      if (!stripeDisputeId || !Number.isInteger(amountMinor)) {
        throw new WebhookRejected('charge.dispute.closed missing id or amount', 'malformed');
      }

      // ★ Map Stripe dispute status to our state enum. Defaults to 'lost'.
      let state = 'lost';
      if (d.status === 'won') state = 'won';

      // ★★★ TASK 15.1 REPAIR — same dead-replay-guard fix as `charge.refunded` above.
      const ins = await tx.query(
        `INSERT INTO keystone.dispute
           (id, tenant_id, stripe_id, amount_minor, state, external_event_id,
            stripe_charge_id, reason, evidence_due_by)
         VALUES (keystone.uuid_generate_v7(), $1, $2, $3, $4, $5, $6, $7, to_timestamp($8))
         ON CONFLICT (tenant_id, stripe_id) DO UPDATE
           SET amount_minor = $3, state = $4, stripe_charge_id = $6, reason = $7,
               evidence_due_by = to_timestamp($8),
               external_event_id = EXCLUDED.external_event_id, updated_at = now()
         WHERE keystone.dispute.external_event_id IS DISTINCT FROM EXCLUDED.external_event_id
         RETURNING id`,
        [tenantId, stripeDisputeId, amountMinor, state, event.id,
         d.charge ?? null, d.reason ?? null, d.evidence_details?.due_by ?? null]);

      if (ins.rowCount === 0) return { applied: false, reason: 'replay', stripeDisputeId };

      await emit(tx, {
        tenantId,
        topic: "money.dispute.recorded",
        emittedBy: "money",
        subjectType: "dispute",
        subjectId: ins.rows[0].id,
        actor: "webhook:stripe",
        payload: {
          stripe_id: stripeDisputeId,
          amount_minor: amountMinor,
          state: state,
        },
      });
      return { applied: true, disputeId: ins.rows[0].id };
    }

    case 'charge.dispute.updated': {
      // ★★★ DISPATCH: Dispute status updated
      try {
        await handleDisputeUpdated(tx, event, { tenantId });
        return { applied: true, reason: 'dispute_updated' };
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      // ★★★ DISPATCH: Subscription lifecycle events
      try {
        await handleSubscriptionEvent(tx, event, { tenantId });
        return { applied: true, reason: 'subscription_event' };
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    case 'payment_method.attached':
    case 'payment_method.updated':
    case 'payment_method.detached':
    // ★ Part 3 — same handler: handlePaymentMethodEvent branches on event.type internally, and
    //   now treats 'automatically_updated' as an alias of 'updated' (same card, new expiry/brand).
    case 'payment_method.automatically_updated': {
      // ★★★ DISPATCH: Payment method lifecycle events
      try {
        await handlePaymentMethodEvent(tx, event, { tenantId });
        return { applied: true, reason: 'payment_method_event' };
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    // ★★★ Part 3 — a card saved with NO Checkout Session (the off_session-on-invoice flow this
    //   same brief adds) fires this instead of checkout.session.completed's mode==='setup' branch.
    //   Same default-setting job as handleSetupCompleted, generalised to read a SetupIntent's own
    //   shape (customer/payment_method sit directly on the object, not under a nested session).
    case 'setup_intent.succeeded': {
      try {
        await handleSetupIntentSucceeded(tx, event, { tenantId });
        return { applied: true, reason: 'setup_intent_succeeded' };
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    // ★★★ Part 3 — the default payment method can change on Stripe's own side (Dashboard,
    //   support, another integration) with no the platform-initiated event at all; this is the only
    //   way that change ever reaches the mirrored `is_default` flag.
    case 'customer.updated': {
      try {
        await handleCustomerUpdated(tx, event, { tenantId });
        return { applied: true, reason: 'customer_updated' };
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    case 'invoice.finalized': {
      // ★★★ TASK 20.60 — Invoice finalized webhook handler
      // Stripe sends this when an invoice is finalized (draft → finalized).
      // ★ Extract invoice ID and update mirror columns with amounts idempotently.
      const stripeInvoiceId = d.id;
      if (!stripeInvoiceId) {
        throw new WebhookRejected('invoice.finalized missing id', 'malformed');
      }

      // ★★ FIND THE INVOICE ROW BY stripe_invoice_id
      const { rows: invoiceRows } = await run(tx, db
        .selectFrom("keystone.invoice")
        .select(["id"])
        .where("tenant_id", "=", tenantId)
        .where("stripe_invoice_id", "=", stripeInvoiceId));

      if (invoiceRows.length > 0) {
        const invoiceId = invoiceRows[0].id;

        // ★★★ THE IDEMPOTENT UPDATE — update amounts and effective_at from Stripe
        // A duplicate delivery will overwrite with the same values (idempotent).
        const amountDueMinor = d.amount_due || 0;
        const amountPaidMinor = d.paid || 0;
        const amountRemainingMinor = Math.max(0, amountDueMinor - amountPaidMinor);
        const amountOverpaidMinor = Math.max(0, amountPaidMinor - amountDueMinor);

        await run(tx, db
          .updateTable("keystone.invoice")
          .set({
            amount_remaining_minor: amountRemainingMinor ?? null,
            amount_overpaid_minor: amountOverpaidMinor ?? null,
            effective_at: (d.created ? new Date(d.created * 1000) : now) ?? null,
            updated_at: sql`now()`
          })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", invoiceId));

        // ★ Emit the finalized event with invoice ID
        await emit(tx, {
          tenantId,
          topic: "money.invoice.finalized",
          emittedBy: "money",
          subjectType: "invoice",
          subjectId: invoiceId,
          actor: "webhook:stripe",
          payload: {
            stripe_invoice_id: stripeInvoiceId,
            amount_due_minor: amountDueMinor,
            amount_paid_minor: amountPaidMinor,
            amount_remaining_minor: amountRemainingMinor,
            amount_overpaid_minor: amountOverpaidMinor,
          },
        });

        // ★★★ TASK 20.66's "credit delta fold" WAS HERE AND IS GONE (26 Sep 2026, RUN-2 ruling). It never
        //     ran: it imported ./money/customerCredit.mjs relative to src/payments/ (no such file) and a
        //     .catch swallowed that, and it read invoice.account_id/payer_id (no such columns). Had it run,
        //     it booked an invoice's WHOLE amount_due as a negative customer credit on every finalize,
        //     keyed on the invoice id as if it were a balance transaction. Customer credit is Stripe's
        //     customer balance — mirror it from customer.balance_transaction events, not from here.
      }

      return { applied: true, reason: 'invoice_finalized' };
    }

    case 'charge.succeeded': {
      // ★★★ TASK 20.23 — Charge succeeded webhook handler
      // Stripe sends this when a charge is successfully created (independent of intent).
      const stripeChargeId = d.id;
      if (!stripeChargeId) {
        throw new WebhookRejected('charge.succeeded missing id', 'malformed');
      }

      // ★ Emit charge succeeded event with ids only.
      await emit(tx, {
        tenantId,
        topic: "money.payment.succeeded",
        emittedBy: "money",
        subjectType: null,      // F905: no local row to point at, and emit() refuses a type without an id (this handler returned 500 for EVERY charge.succeeded)
        subjectId: null,
        actor: "webhook:stripe",
        payload: {
          stripe_charge_id: stripeChargeId,
        },
      });
      return { applied: true, reason: 'charge_succeeded' };
    }

    case 'customer.source.expiring': {
      // ★★★ TASK 20.23 — Payment source expiring warning handler
      // Stripe sends this when a payment method (e.g. card) will soon expire.
      const stripePaymentMethodId = d.id;
      if (!stripePaymentMethodId) {
        throw new WebhookRejected('customer.source.expiring missing id', 'malformed');
      }

      // ★ Emit payment method expiring event with ids only.
      await emit(tx, {
        tenantId,
        topic: "money.payment_method.update_requested",
        emittedBy: "money",
        subjectType: "payment_method",
        subjectId: null,
        actor: "webhook:stripe",
        payload: {
          stripe_payment_method_id: stripePaymentMethodId,
        },
      });
      return { applied: true, reason: 'source_expiring' };
    }

    case 'invoice.upcoming': {
      // ★★★ TASK 20.23 — Upcoming invoice preview handler
      // Stripe sends this as a preview when an invoice is about to be created from a subscription.
      const stripeInvoiceId = d.id;
      if (!stripeInvoiceId) {
        throw new WebhookRejected('invoice.upcoming missing id', 'malformed');
      }

      // ★ Emit reminder due event with ids only.
      await emit(tx, {
        tenantId,
        topic: "money.invoice.reminder_due",
        emittedBy: "money",
        subjectType: "invoice",
        subjectId: null,
        actor: "webhook:stripe",
        payload: {
          stripe_invoice_id: stripeInvoiceId,
        },
      });
      return { applied: true, reason: 'invoice_upcoming' };
    }

    // ★ [Stripe webhook crisis, 2 Oct 2026] was 'credit_note.issued' (not a real Stripe event —
    //   this case could never fire). Real event: 'credit_note.created'.
    case 'credit_note.created': {
      // ★ TASK 20.62 — Mirror Stripe CreditNote issued events
      // d is a CreditNote object with id, invoice, reason, total, pdf, etc.
      const stripeCreditNoteId = d.id;
      const stripeInvoiceId = d.invoice;

      if (!stripeCreditNoteId || !stripeInvoiceId) {
        throw new WebhookRejected('credit_note.created missing id or invoice', 'malformed');
      }

      // ★★★ IDEMPOTENT: ON CONFLICT DO NOTHING guards against replays via unique constraint
      const ins = await tx.query(
        `INSERT INTO keystone.credit_note
           (tenant_id, invoice_id, stripe_credit_note_id, number_ours, status, reason,
            subtotal_minor, tax_minor, total_minor, destination, effective_at, created_by)
         VALUES ($1,
                 (SELECT id FROM keystone.invoice WHERE stripe_invoice_id = $2 AND tenant_id = $1),
                 $3, 'CN-' || to_char(now(), 'YYYYMMDD-HH24MISS'), 'issued',
                 COALESCE($4, 'order_change'),
                 COALESCE($5::int, 0), COALESCE($6::int, 0), COALESCE($7::int, 0),
                 'out_of_band', now(), (SELECT id FROM keystone.app_user WHERE tenant_id = $1 LIMIT 1))
         ON CONFLICT (tenant_id, stripe_credit_note_id) DO NOTHING
         RETURNING id`,
        [tenantId, stripeInvoiceId, stripeCreditNoteId, d.reason || 'order_change',
         d.subtotal || 0, d.tax || 0, d.total || 0]);

      if (ins.rowCount === 0) {
        return { applied: false, reason: 'replay', stripeCreditNoteId };
      }

      const creditNoteId = ins.rows[0].id;

      // ★ Emit event (only on actual insert, not replay)
      await emit(tx, {
        tenantId,
        topic: "money.credit_note.issued",
        emittedBy: "money",
        subjectType: "credit_note",
        subjectId: creditNoteId,
        actor: "webhook:stripe",
        payload: {
          credit_note_id: creditNoteId,
          stripe_credit_note_id: stripeCreditNoteId,
          total_minor: d.total || 0,
        },
      });

      return { applied: true, reason: 'credit_note_issued' };
    }

    case 'credit_note.voided': {
      // ★ TASK 20.62 — Mirror Stripe CreditNote voided events
      const stripeCreditNoteId = d.id;
      if (!stripeCreditNoteId) {
        throw new WebhookRejected('credit_note.voided missing id', 'malformed');
      }

      // ★★★ IDEMPOTENT: only update if status is not already void
      const upd = await run(tx, db
        .updateTable("keystone.credit_note")
        .set({ status: "void", voided_at: sql`now()` })
        .where("tenant_id", "=", tenantId)
        .where("stripe_credit_note_id", "=", stripeCreditNoteId)
        .where("status", "=", "issued")
        .returning(["id", "invoice_id"]));

      if (upd.rowCount === 0) {
        return { applied: false, reason: 'replay', stripeCreditNoteId };
      }

      const { id: creditNoteId, invoice_id: invoiceId } = upd.rows[0];

      // ★ Emit event (only on actual update, not replay)
      await emit(tx, {
        tenantId,
        topic: "money.credit_note.voided",
        emittedBy: "money",
        subjectType: "invoice",
        subjectId: invoiceId,
        actor: "webhook:stripe",
        payload: {
          credit_note_id: creditNoteId,
          stripe_credit_note_id: stripeCreditNoteId,
        },
      });

      return { applied: true, reason: 'credit_note_voided' };
    }

    case 'customer.tax_id.updated': {
      // ★ Task 20.65 — Tax ID verification webhook
      try {
        return await handleTaxIdVerificationWebhook(tx, event, { tenantId });
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    case 'invoice.voided':
    case 'invoice.marked_uncollectible': {
      // ★ PHASE-4 L5.1 — Stripe's own status change, mirrored onto keystone.invoice.
      try {
        return await handleStripeInvoiceStatusEvent(tx, event, { tenantId });
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    case 'quote.accepted':
    case 'quote.canceled': {
      // ★ PHASE-4 L5.2 — Stripe's own quote status change, mirrored onto keystone.estimate.
      try {
        return await handleStripeQuoteStatusEvent(tx, event, { tenantId });
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    case 'subscription_schedule.completed':
    case 'subscription_schedule.canceled':
    case 'subscription_schedule.released': {
      // ★ PHASE-4 L5.3 — Stripe's own subscription_schedule status change, mirrored onto
      // keystone.subscription_schedule.
      try {
        return await handleStripeScheduleStatusEvent(tx, event, { tenantId });
      } catch (e) {
        return { applied: false, reason: 'handler_error', error: e.message };
      }
    }

    default:
      return { applied: false, reason: 'unhandled_event_type' };
  }
  });
}
