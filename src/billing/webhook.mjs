// Task 6.5 (spec 06 §5, §2.7 row 6) — THE STRIPE WEBHOOK'S `workbench_subscription` MIRROR.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CT-110: "Stripe is the source of truth, mirror on success, never compute from local data
//     alone." This file is the write half of that mirror for the platform's OWN billing relationship
//     (`keystone.workbench_subscription`) — distinct from `src/payments/webhook.mjs`, which mirrors
//     a PRACTICE'S OWN client payments (`keystone.payment`/`keystone.invoice`). Both are reached
//     through the same verified-then-resolved `'stripe'` provider door
//     (`src/routes/webhooks.mjs`'s existing signature-verification gate, unchanged per §4) — this
//     file adds a second applier, chosen by event type, not a second door.
//
// ★★ SCOPE NOTE, STATED RATHER THAN SILENTLY ASSUMED (own finding from this task's build):
//    `keystone_auth.webhook_source` — the routing table `resolve_webhook_source()` reads to find
//    WHICH tenant a `(provider, external_id)` pair belongs to — has NO WRITER anywhere in this
//    codebase today, for ANY provider (a pre-existing, cross-spec gap; migration 0339, widening the
//    provider CHECK to admit `'stripe_workbench'`, is task 6.7's job and does not exist on disk yet).
//    So this mirror is wired into the EXISTING `'stripe'` provider tenant-resolution path
//    (`EXTERNAL_REF.stripe` in `src/routes/webhooks.mjs`, which already reads
//    `data.object.customer` — true for a subscription event exactly as it is for a payment one),
//    reusing whatever `stripe_customer_id` rows already resolve today. §12 test item 8
//    (`resolve_webhook_source('stripe_workbench', …)`) is explicitly task 6.7's, not this task's —
//    this file's own two tests are §12 items 3 and 7, neither of which touches this module.
//
// ★ NO LIVE STRIPE CALL. This module only ever READS a verified, already-parsed event body handed
//   to it by the caller; it never calls `callOutside("stripe", …)`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit } from "../events/outbox.mjs";
import { PLAN_KEYS } from "./plans.mjs";
import { periodOf } from "./subscriptionPeriod.mjs";
import { isDocustayPlanKey, foundersFlagFor } from "../product/docustayPlans.mjs";
import * as mail from "../mail/index.mjs";
import { billingEmail, receiptEmail } from "../email/docustayBilling.mjs";
import { billingCopyAddress } from "../product/docustayBillingContact.mjs";
import { languageOfUser } from "../product/docustayLanguage.mjs";

/** ★ The subscription-lifecycle family this mirror acts on. An unknown type is acknowledged and
 *    ignored (`payments/webhook.mjs`'s own convention) — Stripe adds event types over time. */
export const SUBSCRIPTION_EVENTS = Object.freeze([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
/** ★ Part 29 (A2): these three belong to a Docustay WORKSPACE's own subscription AND to a practice's client payments. The router asks this module first; for any organisation that is not a Docustay
 *   workspace it answers `{applied:false, reason:"not_a_docustay_workspace"}` and the payment handler runs as before. */
export const DOCUSTAY_SHARED_EVENTS = Object.freeze(["checkout.session.completed", "invoice.paid", "invoice.payment_failed"]);

/** ★ Stripe's own subscription `status` vocabulary, folded down onto
 *    `workbench_subscription_status_check`'s four values ('trialing'|'active'|'past_due'|'canceled')
 *    — never a fifth value invented here; a status this map does not name is left UNCHANGED rather
 *    than guessed. */
const STATUS_MAP = Object.freeze({
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete_expired: "canceled",
});

class SubscriptionWebhookRejected extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "SubscriptionWebhookRejected";
    this.reason = reason;
  }
}

/**
 * Mirror one Stripe subscription-lifecycle event onto `keystone.workbench_subscription`.
 *
 * @param tx     a pg client inside a transaction, tenant context already set (the caller —
 *               `handleWebhook`, `src/paths/index.mjs` — has already verified the signature and
 *               resolved `tenantId` before this runs)
 * @param event  { id, type, data } — already signature-verified by the caller
 */
export async function handleSubscriptionWebhook(tx, event, { tenantId } = {}) {
  if (!event?.id || !event?.type) {
    throw new SubscriptionWebhookRejected("event is missing id or type", "malformed");
  }
  const shared = DOCUSTAY_SHARED_EVENTS.includes(event.type);
  if (!SUBSCRIPTION_EVENTS.includes(event.type) && !shared) {
    return { applied: false, reason: "unhandled_event_type", type: event.type };
  }
  if (shared) {
    const { rows: [own] } = await tx.query(`SELECT plan_key FROM keystone.workbench_subscription WHERE tenant_id = $1`, [tenantId]);
    if (!own || !isDocustayPlanKey(own.plan_key)) return { applied: false, reason: "not_a_docustay_workspace", type: event.type };
  }
  // ★ A replayed delivery changes nothing: the event id is recorded in the same transaction as its effect.
  const { rowCount: fresh } = await tx.query(
    `INSERT INTO keystone.billing_event (event_id, tenant_id, type) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING`, [event.id, tenantId, event.type]);
  if (fresh === 0) return { applied: false, reason: "duplicate_event", type: event.type };
  // ★ Stripe does not promise order: an event older than the newest one already seen for this workspace is recorded (above) and ignored, so a late `invoice.payment_failed` cannot undo a later `invoice.paid`.
  const evAt = Number.isFinite(event.created) ? new Date(event.created * 1000) : null;
  if (evAt) {
    const { rows: [seen] } = await tx.query(`SELECT stripe_event_at FROM keystone.workbench_subscription WHERE tenant_id = $1`, [tenantId]);
    if (seen?.stripe_event_at && evAt < seen.stripe_event_at) return { applied: false, reason: "stale_event", type: event.type };
    await tx.query(`UPDATE keystone.workbench_subscription SET stripe_event_at = GREATEST(COALESCE(stripe_event_at, $2), $2) WHERE tenant_id = $1`, [tenantId, evAt]);
  }
  if (shared) return handleDocustayBillingEvent(tx, event, { tenantId });

  const d = event.data?.object ?? {};
  const stripeSubscriptionId = d.id ?? null;
  if (!stripeSubscriptionId) throw new SubscriptionWebhookRejected("no subscription id", "malformed");

  // ★ Deleted (cancelled at Stripe) always lands on 'canceled', regardless of Stripe's own
  //   status field on that event (which can still read 'active' the instant it fires).
  const mappedStatus = event.type === "customer.subscription.deleted"
    ? "canceled"
    : (STATUS_MAP[d.status] ?? null);

  // ★ `plan_key` and `seat_count` travel in the subscription's own metadata, stamped when the
  //   Checkout session was created (`POST /api/settings/plans/checkout-session`,
  //   `src/routes/settings.mjs`) — same round-trip convention `stripeCustomer.mjs` already uses for
  //   `metadata[keystone_tenant_id]`. An event with no (or an unrecognised) `plan_key` in metadata
  //   leaves the mirrored plan_key UNCHANGED — never guessed from a price id this codebase has no
  //   mapping table for.
  const metaPlanKey = d.metadata?.plan_key;
  const planKey = PLAN_KEYS.includes(metaPlanKey) || isDocustayPlanKey(metaPlanKey) ? metaPlanKey : null;
  const seatCount = Number.isInteger(Number(d.metadata?.seat_count))
    ? Number(d.metadata.seat_count)
    : (Number.isInteger(d.items?.data?.[0]?.quantity) ? d.items.data[0].quantity : null);
  const trialEndsAt = d.trial_end ? new Date(d.trial_end * 1000) : null;

  // ★★★ R4 (the maintainer, 25 Sep 2026) — THE RENEWAL DATE IS STRIPE'S. `current_period_start`/`_end` travel
  //     on every subscription event (epoch seconds) and are mirrored verbatim; nothing in this
  //     codebase may compute a renewal or billing-period date from `updated_at` again. An event
  //     that somehow lacks them leaves the mirrored values unchanged — mirrored, never guessed.
  //   (D-032: on newer Stripe API versions the dates live on the subscription ITEM and a portal cancellation is `cancel_at`; periodOf reads both shapes.)
  const per = periodOf(d);
  const currentPeriodStart = per.start ? new Date(per.start * 1000) : null;
  const currentPeriodEnd = per.end ? new Date(per.end * 1000) : null;
  const cancelKnown = event.type === "customer.subscription.deleted" || d.cancel_at !== undefined || d.cancel_at_period_end !== undefined;
  const cancelAt = event.type === "customer.subscription.deleted" ? null : (per.cancelAt ? new Date(per.cancelAt * 1000) : null);

  // ★ Part 29 — a Docustay workspace's extra state. Pro is granted only once Stripe says the subscription is paid ('incomplete' is not), the grace clock starts at the FIRST failed payment, and the
  //   founders' flag follows the stamp checkout put on the subscription, is set only once it is paid (active/trialing), and is cleared only by the subscription ending.
  const { rows: [cur] } = await tx.query(`SELECT plan_key, past_due_since, status, cancel_at, seat_count FROM keystone.workbench_subscription WHERE tenant_id = $1`, [tenantId]);
  const docustay = Boolean(cur && isDocustayPlanKey(cur.plan_key));
  let docPlanKey = planKey, graceMode = "keep", founders = null, interval = null, priceId = null;
  if (docustay) {
    if (!["active", "trialing", "past_due"].includes(mappedStatus)) docPlanKey = null;
    graceMode = mappedStatus === "past_due" ? "set" : (mappedStatus === "active" || mappedStatus === "trialing") ? "clear" : "keep";
    founders = foundersFlagFor({ status: mappedStatus, metadata: d.metadata, created: d.created, deleted: event.type === "customer.subscription.deleted" });
    if (event.type === "customer.subscription.deleted") graceMode = "clear";
    interval = d.items?.data?.[0]?.price?.recurring?.interval ?? d.metadata?.billing_interval ?? null;
    if (!["month", "year"].includes(interval)) interval = null;
    priceId = d.items?.data?.[0]?.price?.id ?? null;
  }
  const { rows } = await tx.query(
    `UPDATE keystone.workbench_subscription
        SET stripe_subscription_id = $2,
            past_due_since         = CASE $12 WHEN 'set' THEN COALESCE(past_due_since, now()) WHEN 'clear' THEN NULL ELSE past_due_since END,
            founders_price         = COALESCE($13::boolean, founders_price),
            billing_interval       = COALESCE($14, billing_interval),
            stripe_price_id        = COALESCE($15, stripe_price_id),
            status                 = COALESCE($3, status),
            plan_key               = COALESCE($4, plan_key),
            seat_count             = COALESCE($5, seat_count),
            trial_ends_at          = CASE WHEN $6::boolean THEN $7 ELSE trial_ends_at END,
            current_period_start   = CASE WHEN $8::boolean THEN $9  ELSE current_period_start END,
            current_period_end     = CASE WHEN $10::boolean THEN $11 ELSE current_period_end END,
            cancel_at              = CASE WHEN $16::boolean THEN $17 ELSE cancel_at END
      WHERE tenant_id = $1
      RETURNING id, plan_key, status, seat_count, seat_limit, past_due_since`,
    [tenantId, stripeSubscriptionId, mappedStatus, docustay ? docPlanKey : planKey, seatCount,
     d.trial_end !== undefined, trialEndsAt,
     per.start !== undefined, currentPeriodStart,
     per.end !== undefined, currentPeriodEnd,
     graceMode, founders, interval, priceId, cancelKnown, cancelAt]);

  // the owner hears about a failed payment ONCE per episode — whichever of the two events (this one, or invoice.payment_failed) is first to start the clock
  if (docustay && rows.length > 0 && graceMode === "set" && !cur.past_due_since) await tellOwnerPaymentFailed(tx, { tenantId }).catch((e) => console.error("docustay: could not email the payment-failed notice:", e?.message ?? e));

  if (rows.length === 0) {
    // ★ Reported, never thrown — a verified event for a tenant whose row does not exist (should
    //   not happen past migration 0334's backfill, but a webhook applier never 500s on a state it
    //   cannot itself have caused; `payments/webhook.mjs`'s own "no delivery row" case is the same
    //   shape).
    return { applied: false, reason: "no_workbench_subscription_row", type: event.type, tenantId };
  }

  // ★★★ §5: "SetBilling/SetPlans re-fetch on next load (no live-push needed — §7 names the
  //     drift-tolerance instead)". `emit()` is the mechanism, `actor: 'webhook:stripe'` (valid
  //     ACTOR_SHAPE, `src/events/outbox.mjs:295-298` — the existing 'stripe' provider name, reused
  //     unchanged, not a new 'stripe_workbench' actor string this file would have to invent).
  // ★ `writeAudit()` is NOT called here, on purpose — a named gap, not an oversight. §5 also says
  //   "settings.changed audit_entry fired alongside", but `writeAudit()` HARD REQUIRES a real
  //   `actorUserId`/`actorOperatorGrantId` (`src/permissions/audit.mjs`'s `audit_entry_has_an_actor`
  //   CHECK) and a Stripe webhook has neither — there is no "system"/webhook actor option on that
  //   writer today, unlike `emit()`'s five-shape `ACTOR_SHAPE`. Extending `writeAudit()` to accept
  //   one is a change to `src/permissions/audit.mjs`, which this task's file list does not name.
  //   `lastChangedBy()` therefore will not show a line for a webhook-driven plan change until that
  //   gap is closed — the outbox event (and this function's own return value) is the record of it
  //   in the meantime.
  // ★ D3 (13 Oct 2026, the $1 live test): this used to emit on EVERY call — each webhook, and every confirm poll, cancel and resume (their made-up event ids can never match a replay) — so one purchase made five identical
  //   "Your workspace is on Pro" notices. The owner is told when the plan, its status, the cancel date or the seat count ACTUALLY CHANGED, once, and the notice says what changed.
  const sameMoment = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
  const changed = !cur || cur.plan_key !== rows[0].plan_key || cur.status !== rows[0].status || cur.seat_count !== rows[0].seat_count || (cancelKnown && !sameMoment(cur.cancel_at, cancelAt));
  if (!changed) return { applied: true, type: event.type, subscriptionId: rows[0].id, unchanged: true };
  const wasPro = cur?.plan_key === "docustay_pro" && ["active", "trialing", "past_due"].includes(cur?.status), isPro = rows[0].plan_key === "docustay_pro" && ["active", "trialing"].includes(rows[0].status);
  const change = !docustay ? "updated"
    : (!wasPro && isPro) ? "pro_started"
    : (wasPro && !isPro && rows[0].status !== "past_due") ? "pro_ended"
    : (isPro && cancelKnown && cancelAt && !sameMoment(cur?.cancel_at, cancelAt)) ? "cancel_scheduled"
    : (isPro && cancelKnown && !cancelAt && cur?.cancel_at) ? "resumed"
    : rows[0].status === "past_due" ? "payment_failed" : "updated";
  await emit(tx, {
    tenantId,
    emittedBy: "settings",
    topic: "settings.subscription.updated",
    subjectType: "workbench_subscription",
    subjectId: rows[0].id,
    actor: "webhook:stripe",
    payload: {
      stripeEventId: event.id,
      stripeEventType: event.type,
      change,
      cancelAt: cancelAt ? cancelAt.toISOString() : null,
      periodEnd: currentPeriodEnd ? currentPeriodEnd.toISOString() : null,
      amountMinor: d.items?.data?.[0]?.price?.unit_amount ?? null, currency: d.items?.data?.[0]?.price?.currency ?? d.currency ?? null, interval,   // what the person is told, from Stripe's own subscription (never typed here)
      founders: founders === true,
      planKey: rows[0].plan_key,
      status: rows[0].status,
      seatCount: rows[0].seat_count,
      seatLimit: rows[0].seat_limit,
    },
  });

  // ★ Task 20.21 — also emit the workbench-family event for the subscription change, consumed by
  //   workbenchAnnouncements and the sweep task (20.19's routing, 20.13's usage read).
  await emit(tx, {
    tenantId,
    emittedBy: "workbench",
    topic: "workbench.subscription.updated",
    subjectType: "workbench_subscription",
    subjectId: rows[0].id,
    actor: "webhook:stripe",
    payload: {
      planKey: rows[0].plan_key,
      status: rows[0].status,
      seatCount: rows[0].seat_count,
    },
  });

  return { applied: true, type: event.type, subscriptionId: rows[0].id };
}

/** Run 9 Part 3.7 (B2–B5) — after Docustay itself writes to Stripe (cancel, resume) or reads a finished Checkout, the mirror is refreshed from Stripe's OWN response, through the very same
 *  path a webhook takes (so founders, grace, interval and the renewal date follow the same rules). The record id is ours (`sync_…`), never a Stripe event id; it is "now", so an older event
 *  arriving later cannot undo what Stripe just answered. */
export async function mirrorSubscriptionFromStripe(tx, { tenantId, subscription, why = "api" }) {
  if (!subscription?.id) return { applied: false, reason: "no_subscription" };
  return handleSubscriptionWebhook(tx, { id: `sync_${why}_${subscription.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, type: subscription.status === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000), data: { object: subscription } }, { tenantId });
}

/**
 * ★ Part 29 (A2) — the three events that tell a Docustay workspace's own billing story. Called only for a workspace on a Docustay plan, and only once per Stripe event id.
 *   checkout.session.completed  → link the Stripe customer and subscription to the workspace (the subscription events then carry the status)
 *   invoice.paid                → paid: status active, the grace clock cleared
 *   invoice.payment_failed      → past due: the grace clock starts at the FIRST failure (never restarted), and the owner is told once, in plain words, with no number of days
 */
async function handleDocustayBillingEvent(tx, event, { tenantId }) {
  const d = event.data?.object ?? {};
  if (event.type === "checkout.session.completed") {
    if (d.mode !== "subscription") return { applied: false, reason: "not_a_subscription_checkout", type: event.type };
    await tx.query(
      `UPDATE keystone.workbench_subscription SET stripe_customer_id = COALESCE(stripe_customer_id, $2), stripe_subscription_id = COALESCE($3, stripe_subscription_id) WHERE tenant_id = $1`,
      [tenantId, d.customer ?? null, d.subscription ?? null]);
    return { applied: true, type: event.type };
  }
  const forSubscription = Boolean(d.subscription ?? d.parent?.subscription_details?.subscription);
  if (!forSubscription) return { applied: false, reason: "invoice_without_subscription", type: event.type };
  if (event.type === "invoice.paid") {
    const { rows } = await tx.query(
      `UPDATE keystone.workbench_subscription SET status = 'active', past_due_since = NULL WHERE tenant_id = $1 AND plan_key = 'docustay_pro' AND status IN ('past_due','active') RETURNING id`, [tenantId]);
    // F1045: Docustay sends its own receipt (Stripe's receipt and invoice pages carry the Stripe account's business name). Once per paid invoice: this event id is recorded above, so a replay never sends twice.
    if (rows.length > 0 && Number(d.amount_paid) > 0 && d.billing_reason !== "subscription_create") await tellOwnerReceipt(tx, { tenantId, invoice: d }).catch((e) => console.error("docustay: could not email the receipt:", e?.message ?? e));
    return { applied: rows.length > 0, type: event.type };
  }
  // invoice.payment_failed
  const { rows: [before] } = await tx.query(`SELECT past_due_since FROM keystone.workbench_subscription WHERE tenant_id = $1`, [tenantId]);
  const { rows } = await tx.query(
    `UPDATE keystone.workbench_subscription SET status = 'past_due', past_due_since = COALESCE(past_due_since, now()) WHERE tenant_id = $1 AND plan_key = 'docustay_pro' RETURNING id`, [tenantId]);
  if (rows.length === 0) return { applied: false, reason: "no_pro_subscription", type: event.type };
  if (!before?.past_due_since) await tellOwnerPaymentFailed(tx, { tenantId }).catch((e) => console.error("docustay: could not email the payment-failed notice:", e?.message ?? e));
  return { applied: true, type: event.type };
}

const money = (minor, currency) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency || "usd").toUpperCase() }).format(Number(minor) / 100); } catch { return `${(Number(minor) / 100).toFixed(2)} ${String(currency || "").toUpperCase()}`; } };
const day = (s) => (Number.isFinite(Number(s)) && Number(s) > 0 ? new Date(Number(s) * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : null);
/** The receipt for one paid Pro invoice, from the Docustay address, to the workspace owner(s) (F1045). It signs as "Docustay", what was paid and for which period, and points to Billing for the PDF. */
async function ownerRows(tx, tenantId) {
  const { rows } = await tx.query(`SELECT DISTINCT id, email, display_name FROM keystone.app_user WHERE tenant_id = $1 AND role = 'staff' AND staff_role IN ('owner','admin') AND archived_at IS NULL AND email IS NOT NULL`, [tenantId]);
  return rows;
}
/** The receipt for one paid Pro invoice after the first (the first payment's receipt is in the Welcome email). From Docustay, to the workspace owner(s); once per paid invoice (this event id is recorded above). */
async function tellOwnerReceipt(tx, { tenantId, invoice }) {
  const owners = await ownerRows(tx, tenantId);
  for (const o of owners) {
    const built = receiptEmail({ name: o.display_name, invoice, lang: await languageOfUser(tx, { tenantId, userId: o.id }) });
    await mail.sendMail(tx, { tenantId, to: o.email, purpose: "platform", product: "docustay", subject: built.subject, text: built.text, html: built.html, idempotencyKey: `docustay-receipt:${invoice.id}:${o.email}` });
  }
  // the workspace's separate billing email (when set) gets the same receipt, once per invoice
  const copy = await billingCopyAddress(tx, { tenantId, already: owners.map((o) => o.email) });
  if (copy) { const built = receiptEmail({ name: null, invoice, lang: owners[0] ? await languageOfUser(tx, { tenantId, userId: owners[0].id }) : "en" }); await mail.sendMail(tx, { tenantId, to: copy, purpose: "platform", product: "docustay", subject: built.subject, text: built.text, html: built.html, idempotencyKey: `docustay-receipt:${invoice.id}:${copy}` }); }
  return { sent: owners.length };
}

/** One plain notice, from Docustay, to the workspace owner(s), once per failed-payment episode. It names no number of days and no other product. */
async function tellOwnerPaymentFailed(tx, { tenantId }) {
  const owners = await ownerRows(tx, tenantId);
  for (const o of owners) {
    const built = billingEmail("payment_failed", { name: o.display_name, lang: await languageOfUser(tx, { tenantId, userId: o.id }) });
    await mail.sendMail(tx, { tenantId, to: o.email, purpose: "platform", product: "docustay", subject: built.subject, text: built.text, html: built.html });
  }
  const copy = await billingCopyAddress(tx, { tenantId, already: owners.map((o) => o.email) });
  if (copy) { const built = billingEmail("payment_failed", { name: null, lang: owners[0] ? await languageOfUser(tx, { tenantId, userId: owners[0].id }) : "en" }); await mail.sendMail(tx, { tenantId, to: copy, purpose: "platform", product: "docustay", subject: built.subject, text: built.text, html: built.html }); }
}
