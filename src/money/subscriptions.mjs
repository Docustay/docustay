// @ts-check
// Stage 15 Task 15.19 — SUBSCRIPTION LIFECYCLE. Start, push to Stripe, pause, resume, cancel,
//                          and webhook event handling.
//
// ★★★ STRIPE IS THE MONEY RECORD — THE PLATFORM MIRRORS ONLY. Every subscription needs a Stripe
//     record that moves money (charges automatically every billing cycle). This module creates and
//     manages those records, handles the three cancellation modes, and processes Stripe webhook
//     events to stay in sync.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, conflict, dependency } from "../http/errors.mjs";
import { createSubscription, cancelSubscription } from "./writes.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { ChargePathDisabled } from "./charge.mjs";
import { ensureCustomer } from "./customers.mjs";
import { executeRefund } from "./refunds.mjs";
import { metadataFor } from "./metadata.mjs";
// ★ L3 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; same SQL
//   semantics (same WHERE clauses, same columns, no RETURNING to preserve). `sql` is the escape
//   hatch for the two reads that call the `keystone.current_price` plpgsql function through
//   correlated subqueries — the builder does not express that, so those stay whole `sql`…``
//   templates through `run`, per the L3 per-file ruling.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "money";

/**
 * ★★★ STATUS FOLD: Incoming Stripe statuses map to our four states via this frozen table.
 * Tested by looping over this table; unmappable statuses throw loudly, never default silently.
 */
const STRIPE_STATUS_FOLD = Object.freeze({
  incomplete: "active",
  incomplete_expired: "cancelled",
  unpaid: "past_due",
  // The below are already our states or explicit mappings:
  active: "active",
  paused: "paused",
  past_due: "past_due",
  canceled: "cancelled",
  trialing: "active",
});

/**
 * Map a Stripe subscription status to our state.
 * @param {string} stripeStatus the status from Stripe
 * @returns {string} our state
 * @throws {Error} if status cannot be mapped
 */
export function mapStripeSubscriptionStatus(stripeStatus) {
  if (!STRIPE_STATUS_FOLD[stripeStatus]) {
    throw new Error(`Unmappable Stripe subscription status: "${stripeStatus}"`);
  }
  return STRIPE_STATUS_FOLD[stripeStatus];
}

/**
 * ★ NEW ENTRY POINT: Start a subscription via accepted estimate (calls startClientSubscription,
 * then sets created_by_estimate_id metadata).
 *
 * @param tx
 * @param options { tenantId, planId, appUserId, contractId, createdByEstimateId, estimateId,
 *                  priceMinorOverride, staffNote, actorUserId }
 * @param deps optional { fetchImpl } for testing
 * @returns subscription object with created_by_estimate_id set
 */
export async function startSubscriptionFromEstimate(tx, {
  tenantId, planId, appUserId, contractId, createdByEstimateId, estimateId,
  priceMinorOverride = null, staffNote = null, actorUserId,
}, deps = {}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!planId) throw invalid("planId is required");
  if (!appUserId) throw invalid("appUserId is required");
  if (!contractId) throw invalid("contractId is required");
  if (!createdByEstimateId) throw invalid("createdByEstimateId is required");
  if (!estimateId) throw invalid("estimateId is required");

  // Call the existing writer with no document lineage
  const result = await startClientSubscription(tx, {
    tenantId, planId, appUserId, contractId,
    createdByDocumentId: null,
    priceMinorOverride, staffNote, actorUserId,
  }, deps);

  // Set the estimate lineage on the subscription
  // ★ subscription has no created_by_estimate_id (this UPDATE always threw, 26 Sep 2026): the
  //   lineage is the event below, which names both ids.

  // Emit estimate.accepted_with_subscription event
  await emit(tx, {
    tenantId, topic: "money.estimate.accepted_with_subscription", emittedBy: SECTION,
    subjectType: "estimate", subjectId: estimateId,
    actor: userActor(actorUserId),
    payload: { subscription_id: result.id, plan_id: planId, app_user_id: appUserId },
  });

  return result;
}

/**
 * Start a client subscription.
 *
 * Call createSubscription(...) with the snapshot price, then UPDATE the row with document/override/note,
 * then push to Stripe. If Stripe charges are off, the subscription row is still created and returned
 * with stripe_subscription_id NULL (held_charges_off).
 */
export async function startClientSubscription(tx, {
  tenantId, planId, appUserId, contractId, createdByDocumentId = null,
  priceMinorOverride = null, staffNote = null, actorUserId,
}, deps = {}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!planId) throw invalid("planId is required");
  if (!appUserId) throw invalid("appUserId is required");
  if (!contractId) throw invalid("contractId is required");

  // 1. Create the subscription with the snapshot price (or override if provided)
  const snapshotAmountMinor = priceMinorOverride ?? null;
  const subscription = await createSubscription(tx, {
    tenantId, planId, appUserId, contractId, snapshotAmountMinor, actorUserId,
  });

  // 2. UPDATE the row with document, override, and note
  await run(tx, db
    .updateTable("keystone.subscription")
    .set({
      created_by_document_id: createdByDocumentId ?? null,
      price_minor_override: priceMinorOverride ?? null,
      staff_note: staffNote ?? null,
      updated_at: sql`now()`,
    })
    .where("id", "=", subscription.id));

  // 3. Push to Stripe
  const stripeResult = await pushSubscriptionToStripe(tx, {
    tenantId, subscriptionId: subscription.id, actorUserId,
  }, deps);

  return { ...subscription, ...stripeResult };
}

/**
 * Push a subscription to Stripe. Fetches the subscription row (with plan and person), ensures
 * a customer exists, and creates the Stripe subscription.
 *
 * If charges are off (ChargePathDisabled), the row stays created with stripe_subscription_id NULL
 * and we return { stripe: "held_charges_off" } — no automatic retry, no rethrow.
 */
export async function pushSubscriptionToStripe(tx, { tenantId, subscriptionId, actorUserId }, deps = {}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!subscriptionId) throw invalid("subscriptionId is required");

  // Fetch the subscription with plan data
  const { rows: subs } = await run(tx, sql`
    SELECT s.id, s.app_user_id, s.plan_id, s.price_minor_override,
            p.stripe_product_id, p.interval, p.currency,
            -- ★ the Stripe price is on the PRICE row, not the plan
            (SELECT pr.stripe_price_id FROM keystone.current_price('plan', p.id) cp
               JOIN keystone.price pr ON pr.id = cp.price_id) AS stripe_price_id,
            (SELECT amount_minor FROM keystone.current_price('plan', p.id)) AS price_minor
      FROM keystone.subscription s
      JOIN keystone.plan p ON p.id = s.plan_id
     WHERE s.id = ${subscriptionId} AND s.tenant_id = ${tenantId}
  `);

  if (subs.length === 0) throw conflict("subscription not found");
  const sub = subs[0];

  // Ensure customer exists
  // ★ the caller's injected fetch (deps.fetchImpl) reaches the customer call too — before, only the subscription call honoured it and the customer call always hit the network.
  const customer = await ensureCustomer(tx, { tenantId, personId: sub.app_user_id, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
  if (!customer.customerId) {
    // No connect account or customer queued
    throw conflict("customer could not be created — connect account may not be live");
  }

  // Build the Stripe subscription form
  const form = {
    customer: customer.customerId,
    application_fee_percent: "0.5",
    collection_method: "charge_automatically",
    payment_behavior: "default_incomplete",
    metadata: metadataFor("subscription", {
      person_id: sub.app_user_id,
      practice_id: tenantId,
      plan_id: sub.plan_id,
    }),
  };

  // If price override, build price_data inline; otherwise use stripe_price_id
  if (sub.price_minor_override !== null) {
    form.items = [{
      price_data: {
        currency: sub.currency,
        product: sub.stripe_product_id,
        unit_amount: String(sub.price_minor_override),
        recurring: { interval: sub.interval },
      },
    }];
  } else {
    form.items = [{ price: sub.stripe_price_id }];
  }

  try {
    const result = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/subscriptions",
      sdk: (s, o, form, query) => s.subscriptions.create(form, o),
      form,
      movesMoney: true,
      purpose: "subscription_start",
      idempotencyKey: `sub:${tenantId}:${subscriptionId}`,
      actorUserId,
    }, deps);

    // Store Stripe subscription details
    const stripeSubId = result.body.id;
    const currentPeriodStart = new Date(result.body.current_period_start * 1000);
    const currentPeriodEnd = new Date(result.body.current_period_end * 1000);

    await run(tx, db
      .updateTable("keystone.subscription")
      .set({
        stripe_subscription_id: stripeSubId ?? null,
        current_period_start: currentPeriodStart ?? null,
        current_period_end: currentPeriodEnd ?? null,
        updated_at: sql`now()`,
      })
      .where("id", "=", subscriptionId));

    return { stripe: "live" };
  } catch (e) {
    if (e instanceof ChargePathDisabled || e.name === "ChargePathDisabled") {
      // Charges are off — subscription row was created, but Stripe push is deferred
      return { stripe: "held_charges_off" };
    }
    // ★ T1.14 / F801 — a Stripe REFUSAL (not held_charges_off) must throw, so the route's
    //   transaction rolls the createSubscription INSERT back. No row is left for a card Stripe
    //   refused.
    throw dependency(`Stripe refused this: ${e.message}`);
  }
}

/**
 * Cancel a client subscription.
 *
 * ★★★ NEW SEMANTICS (20.72): Mirrors Stripe's pause_collection and cancel params.
 *   - when: "period_end" or "now" (replaces old "period_end"/"now_refund" modes)
 *   - reason: optional cancellation reason (enum mapped to Stripe cancellation_details.feedback)
 *   - feedback: optional detail text
 *   - resumeOn: for pause operations only
 */
export async function cancelClientSubscription(tx, {
  tenantId, subscriptionId, when = "period_end", reason = null, feedback = null,
  resumeOn = null, actorUserId,
}, deps = {}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!subscriptionId) throw invalid("subscriptionId is required");
  if (!["period_end", "now"].includes(when)) {
    throw invalid("when must be one of: period_end, now");
  }

  // Fetch subscription details
  const { rows: subs } = await run(tx, sql`
    SELECT s.id, s.stripe_subscription_id, s.plan_id, s.app_user_id,
            (SELECT COALESCE(amount_minor, snapshot_amount_minor) FROM keystone.current_price('plan', s.plan_id))
              AS current_price_minor
      FROM keystone.subscription s
      JOIN keystone.plan p ON p.id = s.plan_id
     WHERE s.id = ${subscriptionId} AND s.tenant_id = ${tenantId}
  `);

  if (subs.length === 0) throw conflict("subscription not found");
  const sub = subs[0];

  if (when === "period_end") {
    // Schedule cancellation at period end with optional feedback
    const form = { cancel_at_period_end: "true" };
    if (feedback) {
      form["cancellation_details[feedback]"] = feedback;
    }
    // ★ the free-text reason is Stripe's cancellation_details.comment — Stripe keeps it, not us
    if (reason) form["cancellation_details[comment]"] = String(reason).slice(0, 500);

    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/subscriptions/${sub.stripe_subscription_id}`,
      sdk: (s, o, form, query) => s.subscriptions.update(sub.stripe_subscription_id, form, o),
      form,
      movesMoney: false,
      purpose: "subscription_cancel_at_period_end",
      idempotencyKey: `cancel_period_end:${tenantId}:${subscriptionId}`,
      actorUserId,
    }, deps);

    // Mirror cancel_at and reason to local state
    const cancelAt = new Date();
    await run(tx, db
      // ★ no cancel_at / cancel_reason / cancel_feedback columns — reason and feedback went to Stripe
      .updateTable("keystone.subscription")
      .set({ cancel_at_period_end: true, updated_at: sql`now()` })
      .where("id", "=", subscriptionId));

    await emit(tx, {
      tenantId, topic: "money.subscription.cancel_scheduled", emittedBy: SECTION,
      subjectType: "subscription", subjectId: subscriptionId,
      actor: userActor(actorUserId),
      payload: { plan_id: sub.plan_id, app_user_id: sub.app_user_id, when: "period_end", reason },
    });

    return { id: subscriptionId, when: "period_end", reason };
  }

  if (when === "now") {
    // Cancel immediately
    const form = {};
    if (feedback) {
      form["cancellation_details[feedback]"] = feedback;
    }
    if (reason) form["cancellation_details[comment]"] = String(reason).slice(0, 500);

    await stripeConnectedRequest(tx, {
      tenantId,
      method: "DELETE",
      path: `/subscriptions/${sub.stripe_subscription_id}`,
      sdk: (s, o, form, query) => s.subscriptions.cancel(sub.stripe_subscription_id, {}, o),
      movesMoney: false,
      purpose: "subscription_cancel_now",
      idempotencyKey: `cancel_now:${tenantId}:${subscriptionId}`,
      actorUserId,
    }, deps);

    // Mirror cancellation to local state
    const cancelAt = new Date();
    await run(tx, db
      .updateTable("keystone.subscription")
      .set({ state: "cancelled", cancelled_on: sql`now()`, updated_at: sql`now()` })
      .where("id", "=", subscriptionId));

    await emit(tx, {
      tenantId, topic: "money.subscription.cancelled", emittedBy: SECTION,
      subjectType: "subscription", subjectId: subscriptionId,
      actor: userActor(actorUserId),
      payload: { plan_id: sub.plan_id, app_user_id: sub.app_user_id, when: "now", reason },
    });

    return { id: subscriptionId, when: "now", reason };
  }
}

/**
 * Pause a subscription.
 *
 * If byClient is true, enforce the per-plan allowance. Returns 409 if exhausted.
 * Otherwise (byClient false), admin can pause without checking allowance.
 */
export async function pauseClientSubscription(tx, {
  tenantId, subscriptionId, resumeOn, byClient = false, actorUserId,
}, deps = {}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!subscriptionId) throw invalid("subscriptionId is required");
  if (!resumeOn) throw invalid("resumeOn date is required");

  // Fetch subscription and plan
  const { rows: subs } = await run(tx, db
    .selectFrom("keystone.subscription as s")
    .innerJoin("keystone.plan as p", "p.id", "s.plan_id")
    .select([
      "s.id", "s.stripe_subscription_id", "s.plan_id", "s.pauses_used_year",
      "p.pause_allowance_per_year", "p.pause_max_days",
    ])
    .where("s.id", "=", subscriptionId)
    .where("s.tenant_id", "=", tenantId));

  if (subs.length === 0) throw conflict("subscription not found");
  const sub = subs[0];

  // Check client pause allowance
  if (byClient && sub.pauses_used_year >= sub.pause_allowance_per_year) {
    throw conflict("You've used both pauses this year.");
  }

  // Push pause to Stripe
  const resumeAtTs = Math.floor(new Date(resumeOn).getTime() / 1000);
  await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: `/subscriptions/${sub.stripe_subscription_id}`,
    sdk: (s, o, form, query) => s.subscriptions.update(sub.stripe_subscription_id, form, o),
    form: {
      "pause_collection[behavior]": "void",
      "pause_collection[resumes_at]": String(resumeAtTs),
    },
    movesMoney: false,
    purpose: "subscription_pause",
    idempotencyKey: `pause:${tenantId}:${subscriptionId}`,
    actorUserId,
  }, deps);

  // Update local subscription
  await run(tx, db
    .updateTable("keystone.subscription")
    .set({
      state: "paused",
      paused_at: sql`now()`,
      resume_on: resumeOn ?? null,
      pauses_used_year: sql`pauses_used_year + ${byClient ? 1 : 0}`,
      updated_at: sql`now()`,
    })
    .where("id", "=", subscriptionId));

  await emit(tx, {
    tenantId, topic: "money.subscription.paused", emittedBy: SECTION,
    subjectType: "subscription", subjectId: subscriptionId,
    actor: userActor(actorUserId),
    payload: { resume_on: resumeOn },
  });

  return { id: subscriptionId, state: "paused", resume_on: resumeOn };
}

/**
 * Resume a paused subscription.
 */
export async function resumeClientSubscription(tx, { tenantId, subscriptionId, actorUserId }, deps = {}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!subscriptionId) throw invalid("subscriptionId is required");

  // Fetch subscription
  const { rows: subs } = await run(tx, db
    .selectFrom("keystone.subscription")
    .select(["id", "stripe_subscription_id"])
    .where("id", "=", subscriptionId)
    .where("tenant_id", "=", tenantId));

  if (subs.length === 0) throw conflict("subscription not found");
  const sub = subs[0];

  // Resume on Stripe
  await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: `/subscriptions/${sub.stripe_subscription_id}`,
    sdk: (s, o, form, query) => s.subscriptions.update(sub.stripe_subscription_id, form, o),
    form: { "pause_collection": "" },
    movesMoney: false,
    purpose: "subscription_resume",
    idempotencyKey: `resume:${tenantId}:${subscriptionId}`,
    actorUserId,
  }, deps);

  // Update local subscription
  await run(tx, db
    .updateTable("keystone.subscription")
    .set({ state: "active", paused_at: null, resume_on: null, updated_at: sql`now()` })
    .where("id", "=", subscriptionId));

  await emit(tx, {
    tenantId, topic: "money.subscription.resumed", emittedBy: SECTION,
    subjectType: "subscription", subjectId: subscriptionId,
    actor: userActor(actorUserId),
    payload: {},
  });

  return { id: subscriptionId, state: "active" };
}

/**
 * Handle a Stripe webhook event for subscriptions.
 *
 * Maps Stripe status to our state, copies period dates, and ONLY EMITS when the state
 * actually changed (replay-safe). Do NOT emit on every webhook call with the same state.
 */
export async function handleSubscriptionEvent(tx, event, { tenantId }) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!event || !event.data || !event.data.object) throw invalid("invalid event");

  const obj = event.data.object;
  const stripeSubId = obj.id;

  // Find our subscription by Stripe subscription ID
  const { rows: subs } = await run(tx, db
    .selectFrom("keystone.subscription")
    .select(["id", "state"])
    .where("stripe_subscription_id", "=", stripeSubId)
    .where("tenant_id", "=", tenantId));

  if (subs.length === 0) {
    // No matching subscription — this is OK (webhook from a different integration)
    return { found: false };
  }

  const sub = subs[0];
  const oldState = sub.state;

  // Map Stripe status to our state using frozen fold table
  let newState = oldState;
  try {
    newState = mapStripeSubscriptionStatus(obj.status);
  } catch (e) {
    // Unmappable status — log and keep old state
    console.error(`[handleSubscriptionEvent] ${e.message}; keeping state="${oldState}"`);
  }

  // Copy period dates
  const currentPeriodStart = obj.current_period_start
    ? new Date(obj.current_period_start * 1000)
    : null;
  const currentPeriodEnd = obj.current_period_end
    ? new Date(obj.current_period_end * 1000)
    : null;
  const cancelledOn = obj.canceled_at
    ? new Date(obj.canceled_at * 1000)
    : null;

  // Update the subscription
  await run(tx, db
    .updateTable("keystone.subscription")
    .set({
      state: newState ?? null,
      current_period_start: currentPeriodStart ?? null,
      current_period_end: currentPeriodEnd ?? null,
      cancel_at_period_end: obj.cancel_at_period_end ?? false,
      cancelled_on: (newState === "cancelled" ? cancelledOn : null) ?? null,
      updated_at: sql`now()`,
    })
    .where("id", "=", sub.id));

  // ONLY emit if the state actually changed
  if (newState !== oldState) {
    const topicMap = {
      active: "money.subscription.active",
      past_due: "money.subscription.past_due",
      paused: "money.subscription.paused",
      cancelled: "money.subscription.cancelled",
    };

    const topic = topicMap[newState];
    if (topic) {
      await emit(tx, {
        tenantId, topic, emittedBy: SECTION,
        subjectType: "subscription", subjectId: sub.id,
        actor: userActor(null),
        payload: { stripe_status: obj.status, state: newState },
      });
    }
  }

  return { found: true, subscriptionId: sub.id, stateChanged: newState !== oldState };
}

/**
 * P3.S5 — Remove a discount from a subscription.
 *
 * Stripe-first: DELETE /v1/subscriptions/{id}/discount, then emit
 * money.subscription.discount_removed. A subscription with no stripe_subscription_id yet is a
 * conflict (409), not a Stripe call.
 */
export async function removeSubscriptionDiscount(tx, { tenantId, subscriptionId, actorUserId }, deps = {}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!subscriptionId) throw invalid("subscriptionId is required");

  // ★ STRIPE MIRROR (0574) — subscription_effective, so a Stripe-only subscription is found too.
  const { rows: subs } = await run(tx, db
    .selectFrom("keystone.subscription_effective")
    .select(["id", "stripe_subscription_id"])
    .where("id", "=", subscriptionId)
    .where("tenant_id", "=", tenantId));

  if (subs.length === 0) throw conflict("subscription not found");
  const sub = subs[0];

  if (!sub.stripe_subscription_id) {
    throw conflict("This subscription isn't on Stripe yet.");
  }

  try {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "DELETE",
      path: `/subscriptions/${sub.stripe_subscription_id}/discount`,
      sdk: (s, o, form, query) => s.subscriptions.deleteDiscount(sub.stripe_subscription_id, {}, o),
      movesMoney: false,
      purpose: "subscription_discount_removed",
      idempotencyKey: `remove_discount:${tenantId}:${subscriptionId}`,
      actorUserId,
    }, deps);
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`);
  }

  await emit(tx, {
    tenantId, topic: "money.subscription.discount_removed", emittedBy: SECTION,
    subjectType: "subscription", subjectId: subscriptionId,
    actor: userActor(actorUserId),
    payload: {},
  });

  return { id: subscriptionId };
}

/**
 * P3.S6 — Preview a subscription's next invoice.
 *
 * Read-only: POST /v1/invoices/create_preview { subscription: stripe_subscription_id } — a POST
 * that writes nothing (Stripe's own preview). No event (read). A subscription with no
 * stripe_subscription_id yet is a conflict (409), not a Stripe call — same wording P3.S5 uses.
 */
export async function previewSubscriptionInvoice(tx, { tenantId, subscriptionId }, deps = {}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!subscriptionId) throw invalid("subscriptionId is required");

  // ★ STRIPE MIRROR (0574) — subscription_effective, so a Stripe-only subscription is found too.
  const { rows: subs } = await run(tx, db
    .selectFrom("keystone.subscription_effective")
    .select(["id", "stripe_subscription_id"])
    .where("id", "=", subscriptionId)
    .where("tenant_id", "=", tenantId));

  if (subs.length === 0) throw conflict("subscription not found");
  const sub = subs[0];

  if (!sub.stripe_subscription_id) {
    throw conflict("This subscription isn't on Stripe yet.");
  }

  let resp;
  try {
    resp = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: "/invoices/create_preview",
      sdk: (s, o, form, query) => s.invoices.createPreview(form, o),
      form: { subscription: sub.stripe_subscription_id },
      movesMoney: false,
      purpose: "subscription_invoice_preview",
      actorUserId: null,
    }, deps);
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`);
  }

  const body = resp.body ?? {};
  const lines = (body.lines?.data ?? []).map((line) => ({
    description: line.description ?? "",
    amountMinor: line.amount,
  }));

  return {
    lines,
    totalMinor: body.total,
    date: body.created ? new Date(body.created * 1000).toISOString() : null,
  };
}

/**
 * ★ the maintainer's ruling, 28 Sep 2026 — "no embedded Stripe screens, build in React on the Stripe API,"
 * plus a real, in-depth subscription creator matching Stripe's own — pick a customer, add
 * multiple services/packages/plans, quantities, billing behavior.
 *
 * List subscriptions, live from Stripe. keystone.subscription is single-plan-only by schema
 * (one plan_id column) — it cannot represent a multi-item subscription, and building that schema
 * properly needs a real migration, not a rushed one under this ruling. This reads Stripe directly
 * instead, same reasoning as payouts/disputes/balance tonight.
 */
export async function subscriptionsListLive(tx, { tenantId }) {
  // ★★★ specs/STRIPE-MIRROR.md stage (e) — THE SUBSCRIPTIONS SCREEN READS THE MIRROR, NOT STRIPE LIVE.
  //   (The 28 Sep 2026 "live" ruling existed because the mirror was empty and keystone.subscription is
  //   single-plan only; the mirror now holds every Stripe subscription with ALL its items, and
  //   `keystone.subscription_effective` maps each to a practice + person — so this is the same list,
  //   with no Stripe round-trip, no 5-level expand limit (F-money-audit-1), no per-product fetches.)
  const { rows: subs } = await tx.query(
    `SELECT se.stripe_subscription_id AS id, se.stripe_status, se.app_user_id, se.current_period_end,
            se.cancel_at_period_end, s.items,
            (SELECT u.display_name FROM keystone.app_user u WHERE u.id = se.app_user_id) AS customer_name,
            (SELECT u.email FROM keystone.app_user u WHERE u.id = se.app_user_id) AS customer_email,
            -- ★ QUEUE §4 — a subscription's program is DERIVED from its plan, never stored on it.
            (SELECT sp.program_id FROM keystone.subscription_program sp WHERE sp.subscription_id::text = se.id::text) AS program_id
       FROM keystone.subscription_effective se
       JOIN keystone.mirror_subscription s ON s.id = se.stripe_subscription_id
      WHERE se.tenant_id = $1
      ORDER BY se.created_at DESC`, [tenantId]);

  const productIds = [...new Set(subs.flatMap((sub) => (sub.items?.data ?? [])
    .map((it) => it.price?.product).filter((p) => typeof p === "string")))];
  const productNames = {};
  if (productIds.length > 0) {
    const { rows } = await tx.query(`SELECT id, name FROM keystone.mirror_product WHERE id = ANY($1)`, [productIds]);
    for (const r of rows) productNames[r.id] = r.name;
  }

  const personIds = [...new Set(subs.map((r) => r.app_user_id))];
  const cardByPerson = {};
  if (personIds.length > 0) {
    const { rows: cardRows } = await tx.query(
      `SELECT app_user_id, brand, last_four, exp_month, exp_year
         FROM keystone.person_card_effective
        WHERE tenant_id = $1 AND app_user_id = ANY($2) AND is_default = true`, [tenantId, personIds]);
    for (const row of cardRows) cardByPerson[row.app_user_id] = row;
  }

  const rows = subs.map((sub) => {
    const items = (sub.items?.data ?? []).map((it) => ({
      description: productNames[it.price?.product] ?? it.price?.nickname ?? "Item",
      amountMinor: it.price?.unit_amount ?? null,
      quantity: it.quantity ?? 1,
    }));
    const monthlyMinor = items.reduce((t, it) => t + (it.amountMinor ?? 0) * it.quantity, 0);
    const card = cardByPerson[sub.app_user_id];
    return {
      id: sub.id,
      programId: sub.program_id ?? null,
      state: sub.stripe_status === "trialing" ? "active" : sub.stripe_status,
      customerName: sub.customer_name ?? sub.customer_email ?? null,
      card: card ? { brand: card.brand, lastFour: card.last_four } : null,
      items,
      monthlyMinor,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end).toISOString() : null,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      _personId: sub.app_user_id,
    };
  });

  // ★ A real "expiring soon" count now (was a hard-coded 0): practice's running subscriptions whose
  //   payer's default card expires this month or next.
  const now = new Date();
  const horizon = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1 + 1; // this month + next (1-based months)
  const expiringPeople = new Set();
  for (const r of rows) {
    if (r.state !== "active") continue;
    const c = cardByPerson[r._personId];
    if (c?.exp_year && c?.exp_month && c.exp_year * 12 + c.exp_month <= horizon) expiringPeople.add(r._personId);
  }
  for (const r of rows) delete r._personId;

  return {
    running: rows.filter((r) => r.state === "active").length,
    monthlyMinor: rows.filter((r) => r.state === "active").reduce((t, r) => t + r.monthlyMinor, 0),
    cardsExpiring: expiringPeople.size,
    rows,
  };
}

/**
 * Create a real, multi-item subscription directly against Stripe — the in-depth creator the maintainer asked
 * for, matching Stripe's own: any mix of services/packages/plans from the catalogue, quantities,
 * trial days, and either auto-charge-on-file or email-invoice-to-pay-manually collection.
 *
 * ★ Respects the standing M4-M7 hold exactly like pushSubscriptionToStripe already does elsewhere
 *   in this file: if charges are off, Stripe's own subscription create will simply not attempt to
 *   charge (collection_method: send_invoice never auto-charges; charge_automatically would only
 *   attempt a charge on the first invoice, which the platform-wide charge kill switch still blocks
 *   at the stripeConnectedRequest layer for anything that moves money).
 *
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId, personId, items: [{sourceId, sourceType, quantity, amountMinor, name}],
 *   trialDays, collectionMethod: "charge_automatically"|"send_invoice", description
 */
export async function createMultiItemSubscription(tx, {
  tenantId, personId, items, trialDays = 0, collectionMethod = "send_invoice", description = null, actorUserId = null,
}) {
  if (!personId) throw invalid("Choose who this subscription is for.");
  if (!Array.isArray(items) || items.length === 0) throw invalid("Add at least one service, package, or plan.");

  const { stripeCustomerId } = await ensureCustomer(tx, { tenantId, personId });

  const form = {
    customer: stripeCustomerId,
    collection_method: collectionMethod,
    metadata: metadataFor({ tenantId, actorUserId }),
  };
  if (description) form.description = description;
  if (trialDays > 0) form.trial_period_days = trialDays;
  items.forEach((item, i) => {
    form[`items[${i}][price_data][currency]`] = "usd";
    form[`items[${i}][price_data][product_data][name]`] = item.name;
    form[`items[${i}][price_data][unit_amount]`] = item.amountMinor;
    form[`items[${i}][price_data][recurring][interval]`] = "month";
    form[`items[${i}][quantity]`] = item.quantity ?? 1;
  });

  try {
    const { body } = await stripeConnectedRequest(tx, {
      tenantId, method: "POST", path: "/subscriptions", form,
      movesMoney: true, purpose: "create_multi_item_subscription", actorUserId,
    });
    return { id: body.id, status: body.status };
  } catch (e) {
    // ★ Same pattern as pushSubscriptionToStripe above — the M4-M7 hold on charges must not
    //   surface as a raw error; it's the shipped, deliberate state.
    if (e instanceof ChargePathDisabled || e.name === "ChargePathDisabled") {
      return { id: null, status: "held_charges_off" };
    }
    throw e;
  }
}
