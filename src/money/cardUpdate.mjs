// @ts-check
// Stage 15 Task 15.21 — CARD UPDATE FLOW
//
// Handle payment method updates: request updates, manage the Stripe checkout session,
// process webhook events, and maintain expiry information.

import { emit, userActor } from "../events/outbox.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { createPaymentMethod } from "./writes.mjs";
import { ensureCustomer } from "./customers.mjs";
import { invalid, conflict, notFound, dependency } from "../http/errors.mjs";
// ★ L3 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same locking where present, same parameterization).
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "money";

/**
 * Request a card update for a payment method.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   appUserId: the person id requesting the update
 *   subscriptionId: optional subscription id this update is for
 *   channel: "email" (default) or "text" — text not yet implemented
 *   message: optional custom message
 *   actorUserId: optional user id for audit
 * @throws 400 if channel is not supported (text → "Text messages aren't set up yet")
 */
export async function requestCardUpdate(tx, {
  tenantId, appUserId, subscriptionId = null, channel = "email", message = null, actorUserId = null,
}) {
  if (channel !== "email") {
    throw invalid("Text messages aren't set up yet");
  }

  await emit(tx, {
    tenantId, topic: "money.payment_method.update_requested", emittedBy: SECTION,
    subjectType: "payment_method", subjectId: appUserId,
    actor: userActor(actorUserId),
    payload: {
      app_user_id: appUserId,
      subscription_id: subscriptionId,
    },
  });
}

/**
 * Start a card update session (Stripe setup mode checkout).
 * Called after a card_update link token is redeemed.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   appUserId: the person id
 *   returnUrl: the URL to return to after setup
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<{url: string}>}
 */
export async function startCardUpdateSession(tx, {
  tenantId, appUserId, returnUrl,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  // Ensure the person has a Stripe customer
  const { customerId } = await ensureCustomer(tx, { tenantId, personId: appUserId, fetchImpl });

  if (!customerId) {
    throw invalid("Customer could not be created in Stripe");
  }

  // Get the tenant's currency (default USD)
  // ★ tenant has no settings column: the currency is the `money.currency` setting. (The old
  //   `::text` of a jsonb would also have been '"USD"' WITH the quotes.)
  const { getSetting } = await import("../settings/writes.mjs");
  const currency = (await getSetting(tx, "money.currency", "USD")) ?? "USD";

  // Call Stripe to create a setup mode checkout session
  const result = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/checkout/sessions",
    sdk: (s, o, form, query) => s.checkout.sessions.create(form, o),
    form: {
      mode: "setup",
      customer: customerId,
      currency: currency.toLowerCase(),
      success_url: returnUrl,
      cancel_url: returnUrl,
    },
    movesMoney: false,
    purpose: "card_update_session",
    actorUserId: null,
  }, { fetchImpl, env });

  return { url: result.body.url };
}

/**
 * Handle Stripe payment_method events: attached, updated, detached.
 *
 * @param {object} tx a tenant transaction
 * @param {object} event Stripe event object
 * @param {object} options { tenantId }
 */
export async function handlePaymentMethodEvent(tx, event, { tenantId }) {
  const eventType = event.type;
  const object = event.data.object;

  if (eventType === "payment_method.attached") {
    // Find the person by stripe_customer_id
    const { rows } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("stripe_customer_id", "=", object.customer)
      .where("archived_at", "is", null));

    if (rows.length === 0) {
      // Customer not found — silently skip
      return;
    }

    const appUserId = rows[0].id;

    // Insert the payment method
    try {
      await createPaymentMethod(tx, {
        tenantId,
        appUserId,
        providerPaymentMethodId: object.id,
        lastFour: object.card?.last_four,
        brand: object.card?.brand,
        isDefault: false,
      });
    } catch (e) {
      if (e.statusCode === 409 && /already stored/.test(e.message)) {
        // Swallow conflict — replay of a webhook attaching the same method
      } else {
        throw e;
      }
    }

    // Update expiry and brand
    await run(tx, db
      .updateTable("keystone.payment_method")
      .set({
        exp_month: object.card?.exp_month ?? null,
        exp_year: object.card?.exp_year ?? null,
        kind: object.type || "card",
      })
      .where("tenant_id", "=", tenantId)
      .where("provider_payment_method_id", "=", object.id));
    // ★ First saved card becomes the customer's default in Stripe if they have none yet — Part 3's
    //   own rule, mirrored here since `attached` is the event that fires for a brand-new card with
    //   no prior payment method at all (handleSetupCompleted/handleCustomerUpdated cover the "this
    //   one is now default" case when Stripe already has a default to compare against).
    await maybeMakeFirstCardDefault(tx, { tenantId, appUserId, providerPaymentMethodId: object.id });
  } else if (eventType === "payment_method.updated" || eventType === "payment_method.automatically_updated") {
    // Update expiry, brand, and other fields
    await run(tx, db
      .updateTable("keystone.payment_method")
      .set({
        exp_month: object.card?.exp_month ?? null,
        exp_year: object.card?.exp_year ?? null,
        brand: object.card?.brand ?? null,
        kind: object.type || "card",
      })
      .where("tenant_id", "=", tenantId)
      .where("provider_payment_method_id", "=", object.id));
    // ★ NEW, receipts brief (1 Oct 2026, Part 2) — "card updated" client email. Only for
    //   `automatically_updated` (the bank/network silently reissued the card) — plain `updated`
    //   also fires for trivial internal metadata changes Stripe makes on its own, which is not a
    //   fact worth emailing a client about every time.
    if (eventType === "payment_method.automatically_updated") {
      const { rows: pmRows } = await run(tx, db
        .selectFrom("keystone.payment_method")
        .select(["id", "app_user_id"])
        .where("tenant_id", "=", tenantId)
        .where("provider_payment_method_id", "=", object.id));
      if (pmRows[0]) {
        await emit(tx, {
          tenantId, topic: "money.payment_method.updated", emittedBy: SECTION,
          subjectType: "payment_method", subjectId: pmRows[0].id,
          actor: "webhook:stripe",
          payload: { recipient_user_id: pmRows[0].app_user_id, last_four: object.card?.last_four ?? null, brand: object.card?.brand ?? null },
        });
      }
    }
  } else if (eventType === "payment_method.detached") {
    // Mark as detached
    await run(tx, db
      .updateTable("keystone.payment_method")
      .set({ detached_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("provider_payment_method_id", "=", object.id));
  }
}

/**
 * Part 3 — "first saved card becomes the customer's default in Stripe if they have none."
 * Only acts when this app_user has exactly one live card (the one just attached) — a second or
 * later card never silently displaces whatever is already default.
 */
async function maybeMakeFirstCardDefault(tx, { tenantId, appUserId, providerPaymentMethodId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.payment_method")
    .select(["id"])
    .where("tenant_id", "=", tenantId)
    .where("app_user_id", "=", appUserId)
    .where("detached_at", "is", null));
  if (rows.length !== 1) return; // zero (race) or already more than one — leave the existing default alone

  await setDefaultPaymentMethod(tx, { tenantId, appUserId, providerPaymentMethodId, pushToStripe: false });
}

/**
 * Part 3, item 2 — "setting a default in the platform sets it in Stripe" and the reverse mirror for
 * every place THIS app decides a default (first-card, setup completed). `pushToStripe: false` for
 * webhook-originated calls, where Stripe is already the source of truth and pushing back would be
 * a pointless round trip (and, for `automatically_updated`, actively wrong — that event is not a
 * default change at all).
 */
async function setDefaultPaymentMethod(tx, { tenantId, appUserId, providerPaymentMethodId, pushToStripe = true }, deps = {}) {
  await run(tx, db
    .updateTable("keystone.payment_method")
    .set({ is_default: true })
    .where("tenant_id", "=", tenantId)
    .where("app_user_id", "=", appUserId)
    .where("provider_payment_method_id", "=", providerPaymentMethodId));
  await run(tx, db
    .updateTable("keystone.payment_method")
    .set({ is_default: false })
    .where("tenant_id", "=", tenantId)
    .where("app_user_id", "=", appUserId)
    .where("provider_payment_method_id", "!=", providerPaymentMethodId)
    .where("is_default", "=", true));

  if (pushToStripe) {
    const { rows } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(["stripe_customer_id"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", appUserId));
    const customerId = rows[0]?.stripe_customer_id;
    if (customerId) {
      await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: `/customers/${customerId}`,
        sdk: (s, o, form) => s.customers.update(customerId, form, o),
        form: { invoice_settings: { default_payment_method: providerPaymentMethodId } },
        movesMoney: false,
        purpose: "set_default_payment_method",
        actorUserId: null,
      }, deps);
    }
  }
}

/**
 * Part 3 — `setup_intent.succeeded` fires with NO Checkout Session at all (the off_session save
 * path this brief adds to every invoice); same default-setting job as handleSetupCompleted below,
 * reading customer/payment_method straight off the SetupIntent object.
 */
export async function handleSetupIntentSucceeded(tx, event, { tenantId }) {
  const object = event.data.object;
  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("stripe_customer_id", "=", object.customer)
    .where("archived_at", "is", null));
  if (rows.length === 0 || !object.payment_method) return;

  await maybeMakeFirstCardDefault(tx, { tenantId, appUserId: rows[0].id, providerPaymentMethodId: object.payment_method });
}

/**
 * Part 3 — a default-payment-method change made directly on Stripe (Dashboard, support, another
 * integration) with no the platform-initiated event. Mirrors `invoice_settings.default_payment_method`
 * into the local `is_default` flag; never pushes back (Stripe already has the value it just sent).
 */
export async function handleCustomerUpdated(tx, event, { tenantId }) {
  const object = event.data.object;
  const defaultPm = object.invoice_settings?.default_payment_method;
  if (!defaultPm) return;

  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("stripe_customer_id", "=", object.id)
    .where("archived_at", "is", null));
  if (rows.length === 0) return;
  const appUserId = rows[0].id;

  // Only act if this payment method is already mirrored locally — a customer.updated naming a PM
  // the platform has never seen (a race with payment_method.attached) is left for that event to write.
  const { rows: pmRows } = await run(tx, db
    .selectFrom("keystone.payment_method")
    .select(["id"])
    .where("tenant_id", "=", tenantId)
    .where("app_user_id", "=", appUserId)
    .where("provider_payment_method_id", "=", typeof defaultPm === "string" ? defaultPm : defaultPm.id)
    .where("detached_at", "is", null));
  if (pmRows.length === 0) return;

  await setDefaultPaymentMethod(tx, {
    tenantId, appUserId,
    providerPaymentMethodId: typeof defaultPm === "string" ? defaultPm : defaultPm.id,
    pushToStripe: false,
  });
}

/**
 * Handle setup_intent.succeeded or checkout.session.completed for setup mode.
 * Mark the new payment method as default for that person.
 *
 * @param {object} tx a tenant transaction
 * @param {object} event Stripe event object
 * @param {object} options { tenantId }
 */
export async function handleSetupCompleted(tx, event, { tenantId, fetchImpl = globalThis.fetch, env = process.env }) {
  const eventType = event.type;

  if (eventType === "checkout.session.completed") {
    const session = event.data.object;

    // Only handle setup mode
    if (session.mode !== "setup") {
      return;
    }

    // Find the person by stripe_customer_id
    const { rows } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("stripe_customer_id", "=", session.customer)
      .where("archived_at", "is", null));

    if (rows.length === 0) {
      return;
    }

    const appUserId = rows[0].id;
    const paymentMethodId = session.payment_method;

    if (paymentMethodId) {
      // ★ Shared with handleSetupIntentSucceeded/handleCustomerUpdated (Part 3) — same
      //   mark-one-default/clear-the-rest job, one definition.
      await setDefaultPaymentMethod(tx, { tenantId, appUserId, providerPaymentMethodId: paymentMethodId, pushToStripe: false });

      // Check if this person has a past_due subscription and update its default payment method on Stripe
      const { rows: subscRows } = await run(tx, db
        .selectFrom("keystone.subscription")
        .select(["id", "stripe_subscription_id"])
        .where("tenant_id", "=", tenantId)
        .where("app_user_id", "=", appUserId)
        .where("state", "=", "past_due"));

      if (subscRows.length > 0) {
        for (const sub of subscRows) {
          if (sub.stripe_subscription_id) {
            // Update Stripe subscription's default payment method
            await stripeConnectedRequest(tx, {
              tenantId,
              method: "POST",
              path: `/subscriptions/${sub.stripe_subscription_id}`,
              sdk: (s, o, form, query) => s.subscriptions.update(sub.stripe_subscription_id, form, o),
              form: {
                default_payment_method: paymentMethodId,
              },
              movesMoney: false,
              purpose: "update_subscription_payment_method",
              actorUserId: null,
            }, { fetchImpl, env });
          }
        }
      }
    }
  }
}

/**
 * Find payment methods expiring in the calendar month after `now`.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options { tenantId, now }
 * @returns {Promise<Array>} rows of payment methods expiring next month
 */
export async function cardsExpiringNextMonth(tx, { tenantId, now }) {
  if (!now) {
    now = new Date();
  }

  // Calculate the first day of next month
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthNum = nextMonth.getMonth() + 1; // 1-12
  const nextMonthYear = nextMonth.getFullYear();

  // Calculate the last day of next month
  const lastDayOfNextMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);

  const { rows } = await run(tx, db
    // ★ STRIPE MIRROR (0574) — the card's brand/last4/expiry are Stripe's word (person_card_effective; it already
    //   excludes detached cards). The join to keystone.payment_method is deliberate and INNER: the sweep that
    //   consumes these rows (src/automations/sweeps.mjs) stamps `expiring_alerted_for` on that row by its own id
    //   so a card is alerted once a month, not once a day — a mirrored card with no the platform row has nowhere to
    //   carry that guard, so it is not returned (same as before the mirror).
    .selectFrom("keystone.person_card_effective as pe")
    .innerJoin("keystone.payment_method as k", (join) => join
      .onRef("k.tenant_id", "=", "pe.tenant_id")
      .onRef("k.provider_payment_method_id", "=", "pe.provider_payment_method_id"))
    .select([
      "k.id as id", "pe.tenant_id as tenant_id", "pe.app_user_id as app_user_id",
      "pe.provider_payment_method_id as provider_payment_method_id", "pe.kind as kind",
      "pe.brand as brand", "pe.last_four as last_four", "pe.exp_month as exp_month", "pe.exp_year as exp_year",
      "pe.is_default as is_default", "pe.created_at as created_at",
      "k.expiring_alerted_for as expiring_alerted_for",
    ])
    .where("pe.tenant_id", "=", tenantId)
    .where("pe.exp_year", "is not", null)
    .where("pe.exp_month", "is not", null)
    .where("pe.exp_year", "=", nextMonthYear)
    .where("pe.exp_month", "=", nextMonthNum)
    .orderBy("pe.created_at"));

  return rows;
}

/**
 * Remove a saved card (P3.S8).
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   paymentMethodId: the payment_method row id to detach
 *   actorUserId: optional user id for audit
 * @throws 404 ("no such card") if there is no such live payment method
 * @throws 409 if an active subscription's payment_method_id still points at this card
 * @throws dependency if Stripe refuses the detach
 */
export async function detachPaymentMethod(tx, { tenantId, paymentMethodId, actorUserId = null }, deps = {}) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.payment_method")
    .select(["provider_payment_method_id", "app_user_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", paymentMethodId)
    .where("detached_at", "is", null));

  if (rows.length === 0) throw notFound("no such card");
  const { provider_payment_method_id: providerPaymentMethodId, app_user_id: cardOwnerId } = rows[0];

  const { rows: subs } = await run(tx, db
    .selectFrom("keystone.subscription")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("payment_method_id", "=", paymentMethodId));

  if (subs.length > 0) {
    throw conflict("This card pays an active subscription. Update the subscription's card first.");
  }

  try {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/payment_methods/${providerPaymentMethodId}/detach`,
      sdk: (s, o, form, query) => s.paymentMethods.detach(providerPaymentMethodId, {}, o),
      movesMoney: false,
      purpose: "payment_method_detach",
      actorUserId,
    }, deps);
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`);
  }

  await run(tx, db
    .updateTable("keystone.payment_method")
    .set({ detached_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", paymentMethodId));

  await emit(tx, {
    tenantId, topic: "money.payment_method.removed", emittedBy: SECTION,
    subjectType: "payment_method", subjectId: paymentMethodId,
    actor: userActor(actorUserId),
    // ★ FIX, receipts brief (1 Oct 2026, Part 2) — was `{}`, so MONEY_EMAILS (once wired, this
    //   same brief) would have found no recipient to email at all.
    payload: { recipient_user_id: cardOwnerId },
  });

  return { id: paymentMethodId };
}
