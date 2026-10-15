// @ts-check
// Stage 15 Task 15.23 — PAYMENT LINKS: shareable, reusable money collection
//
// A payment link is a URL a practice sends to collect money without a bespoke invoice.
// Four variants: plain (fixed price), pick_amount (payer chooses), sign_first (document then pay),
// book_with (book a session then pay). The first two go straight to Stripe; the last two create the
// intent AFTER their own flows complete.
//
// ★ L3.money/paymentLinks — every `tx.query(<static SQL>)` below now goes through the Kysely builder
//   + `run`; the SQL semantics are unchanged (same WHERE clauses, same RETURNING columns, same
//   parameterization). `sql` is the escape hatch for what the builder itself does not express —
//   casts, computed ORDER BY expressions, computed UPDATE/INSERT values — per the L3 per-file ruling.

import crypto from "node:crypto";
import { stripeConnectedRequest, applicationFeeMinor } from "./stripeConnected.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { notFound, dependency } from "../http/errors.mjs";
import { metadataFor } from "./metadata.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * Generate a slug from a title, ensuring uniqueness within the tenant.
 * Lowercase, spaces→hyphens, strip anything not [a-z0-9-].
 * If clash, append -2, -3, etc. until unique.
 *
 * @param {object} tx a tenant transaction
 * @param {string} tenantId the practice id
 * @param {string} title the link title
 * @returns {Promise<string>} a unique slug for this tenant
 */
async function generateUniqueSlug(tx, tenantId, title) {
  let base = title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);

  // Ensure slug meets the minimum length check (at least 3 chars after fixing)
  if (base.length < 3) {
    base = "payment-link";
  }

  let slug = base;
  let suffix = 1;

  while (true) {
    const { rowCount } = await run(tx, db
      .selectFrom("keystone.payment_link")
      .select(sql`1`.as("one"))
      .where("tenant_id", "=", tenantId)
      .where("slug", "=", slug));

    if (rowCount === 0) {
      return slug;
    }

    suffix++;
    slug = `${base}-${suffix}`;
  }
}

/**
 * Create a payment link (plain, pick_amount, sign_first, or book_with variant).
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   title: the link title (1-120 chars)
 *   variant: one of 'plain', 'pick_amount', 'sign_first', 'book_with'
 *   amountMinor: required for plain; null for pick_amount; null for sign_first/book_with
 *   minAmountMinor: optional minimum for pick_amount
 *   documentTemplateId: required for sign_first; null otherwise
 *   serviceId: required for book_with; null otherwise
 *   actorUserId: the user creating the link
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<{id, slug, stripeUrl}>}
 */
export async function createPaymentLink(tx, {
  tenantId, title, variant, amountMinor = null, minAmountMinor = null,
  documentTemplateId = null, serviceId = null, actorUserId,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const slug = await generateUniqueSlug(tx, tenantId, title);

  // ★★★ T1.13 / F801 — THE ROW IS CREATED ONLY AFTER STRIPE ACCEPTED. The id is minted first so the
  // Stripe metadata (`keystone_payment_link_id`) names the row that is about to be inserted, but the
  // INSERT itself happens LAST — a refused Stripe call must leave no row on the Payment links screen.
  const linkId = crypto.randomUUID();
  let stripeUrl = null;
  let stripePaymentLinkId = null;

  // For plain and pick_amount, create the Stripe payment link BEFORE our row exists.
  if (variant === "plain" || variant === "pick_amount") {
    try {
      // Step 1: Create a price
      const priceForm = {
        currency: "usd",
        ...(variant === "pick_amount" ? {
          "custom_unit_amount[enabled]": true,
          ...(minAmountMinor ? { "custom_unit_amount[minimum]": minAmountMinor } : {}),
        } : {
          unit_amount: amountMinor,
        }),
        "product_data[name]": title,
      };

      const priceResponse = await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: "/prices",
        sdk: (s, o, form, query) => s.prices.create(form, o),
        form: priceForm,
        movesMoney: false,
        purpose: "payment_link_price",
        actorUserId,
      }, { fetchImpl, env });

      const priceId = priceResponse.body.id;

      // Step 2: Create the payment link
      const meta = metadataFor("payment_link", {
        keystone_payment_link_id: linkId,
        keystone_tenant_id: tenantId,
      });
      const linkForm = {
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": 1,
        ...(variant === "plain" ? {
          application_fee_amount: applicationFeeMinor(amountMinor),
        } : {
          application_fee_percent: 0.5,
        }),
        ...Object.fromEntries(
          Object.entries(meta).map(([k, v]) => [`metadata[${k}]`, v])
        ),
      };

      const linkCreateResponse = await stripeConnectedRequest(tx, {
        tenantId,
        method: "POST",
        path: "/payment_links",
        sdk: (s, o, form, query) => s.paymentLinks.create(form, o),
        form: linkForm,
        movesMoney: true,
        purpose: "payment_link_create",
        actorUserId,
      }, { fetchImpl, env });

      stripePaymentLinkId = linkCreateResponse.body.id;
      stripeUrl = linkCreateResponse.body.url;
    } catch (e) {
      // ★ No special-casing by error name (that special-casing was F801: it swallowed a refusal and
      // kept the row anyway). ANY failure here means Stripe did not accept this link, so no row is
      // created — the caller sees one uniform refusal.
      throw dependency(`Stripe refused this: ${e.message}`);
    }
  }
  // For sign_first and book_with, no Stripe payment link is created yet — INSERT only, unchanged.

  // Insert the row now that Stripe accepted (or was never asked, for sign_first/book_with).
  const { rows: linkRows } = await run(tx, db
    .insertInto("keystone.payment_link")
    .values({
      id: linkId ?? null,
      tenant_id: tenantId ?? null,
      title: title ?? null,
      variant: variant ?? null,
      amount_minor: amountMinor ?? null,
      min_amount_minor: minAmountMinor ?? null,
      document_template_id: documentTemplateId ?? null,
      service_id: serviceId ?? null,
      slug: slug ?? null,
      created_by: actorUserId ?? null,
      stripe_payment_link_id: stripePaymentLinkId ?? null,
      stripe_url: stripeUrl ?? null,
    })
    .returning(["id", "slug", "stripe_payment_link_id", "stripe_url"]));

  // Emit the created event
  await emit(tx, {
    tenantId,
    topic: "money.payment_link.created",
    emittedBy: "money",
    subjectType: "payment_link",
    subjectId: linkId,
    actor: userActor(actorUserId),
    payload: {
      variant,
      slug,
    },
  });

  return { id: linkId, slug, stripeUrl };
}

/**
 * Create a payment intent for a sign_first or book_with link after its flow completes.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   slug: the payment link slug
 *   amountMinor: amount in minor units
 *   actorUserId: optional user id for audit
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<{clientSecret, paymentIntentId}>}
 */
export async function createLinkIntent(tx, {
  tenantId, slug, amountMinor, actorUserId = null,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  // Look up the link to get its details
  const { rows: linkRows } = await run(tx, db
    .selectFrom("keystone.payment_link")
    .select(["id", "variant"])
    .where("tenant_id", "=", tenantId)
    .where("slug", "=", slug));

  if (linkRows.length === 0) {
    throw notFound("payment link not found");
  }

  const linkId = linkRows[0].id;

  // Create the payment intent the same way terminal.mjs does
  const meta = metadataFor("payment_intent", {
    keystone_payment_link_id: linkId,
    keystone_tenant_id: tenantId,
  });
  const response = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/payment_intents",
    sdk: (s, o, form, query) => s.paymentIntents.create(form, o),
    form: {
      amount: amountMinor,
      currency: "usd",
      application_fee_amount: applicationFeeMinor(amountMinor),
      ...Object.fromEntries(
        Object.entries(meta).map(([k, v]) => [`metadata[${k}]`, v])
      ),
    },
    movesMoney: true,
    purpose: "payment_link_intent",
    actorUserId,
  }, { fetchImpl, env });

  return {
    clientSecret: response.body.client_secret,
    paymentIntentId: response.body.id,
  };
}

/**
 * Deactivate a payment link in Stripe and mark it inactive.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   paymentLinkId: the payment link id
 *   actorUserId: the user deactivating the link
 * @param {object} deps optional dependencies
 *   fetchImpl: stub fetch implementation
 *   env: environment variables
 * @returns {Promise<void>}
 */
export async function deactivatePaymentLink(tx, {
  tenantId, paymentLinkId, actorUserId,
} = {}, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  // Get the Stripe payment link ID
  const { rows: linkRows } = await run(tx, db
    .selectFrom("keystone.payment_link")
    .select("stripe_payment_link_id")
    .where("id", "=", paymentLinkId)
    .where("tenant_id", "=", tenantId));

  if (linkRows.length === 0) {
    throw notFound("payment link not found");
  }

  const stripePaymentLinkId = linkRows[0].stripe_payment_link_id;

  // If there's a Stripe ID, deactivate it there
  if (stripePaymentLinkId) {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/payment_links/${stripePaymentLinkId}`,
      sdk: (s, o, form, query) => s.paymentLinks.update(stripePaymentLinkId, form, o),
      form: { active: false },
      movesMoney: false,
      purpose: "payment_link_deactivate",
      actorUserId,
    }, { fetchImpl, env });
  }

  // Mark the row as inactive
  await run(tx, db
    .updateTable("keystone.payment_link")
    .set({ state: "inactive" })
    .where("id", "=", paymentLinkId));
}

/**
 * Get the public view of a payment link.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   slug: the payment link slug
 * @returns {Promise<{title, variant, amountMinor, minAmountMinor, practiceName, payUrl, state}>}
 */
export async function publicPaymentLinkView(tx, { tenantId, slug }) {
  const { rows: linkRows } = await run(tx, db
    .selectFrom("keystone.payment_link")
    .select(["id", "title", "variant", "amount_minor", "min_amount_minor", "state", "stripe_url"])
    .where("tenant_id", "=", tenantId)
    .where("slug", "=", slug));

  if (linkRows.length === 0) {
    throw notFound("not found");
  }

  const link = linkRows[0];

  // If inactive, return the generic 404 shape (caller cannot tell apart from "never existed")
  if (link.state === "inactive") {
    throw notFound("not found");
  }

  // Get the practice name for branding
  const { rows: practiceRows } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select("name")
    .where("id", "=", tenantId));

  const practiceName = practiceRows[0]?.name ?? "Keystone";

  return {
    title: link.title,
    variant: link.variant,
    amountMinor: link.amount_minor,
    minAmountMinor: link.min_amount_minor,
    practiceName,
    payUrl: link.stripe_url,
    state: link.state,
  };
}

/**
 * Handle a completed Stripe checkout session for a payment link.
 * Replay-safe: idempotent on payment_intent, increments uses only once per session.
 *
 * @param {object} tx a tenant transaction
 * @param {object} event Stripe checkout.session.completed event
 * @param {object} options
 *   tenantId: the practice id
 * @returns {Promise<void>}
 */
export async function handlePaymentLinkCompleted(tx, event, { tenantId }) {
  const paymentIntent = event.data.object.payment_intent;
  const amountMinor = event.data.object.amount_total;

  // Check if a payment row for this intent already exists (replay-safe)
  const { rows: existingRows } = await run(tx, db
    .selectFrom("keystone.payment")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("provider_payment_id", "=", paymentIntent));

  if (existingRows.length > 0) {
    // Already processed this event; do nothing further
    return;
  }

  // ★★ payment.payer_user_id is NOT NULL and this named no payer (and a `provider_type` column that
  //    does not exist) — no payment-link payment was ever recorded (26 Sep 2026). The payer is the
  //    person whose Stripe customer paid, else the person with the checkout email. Nobody → a loud
  //    failure the webhook dead-letters with this reason, never a payment with an invented payer.
  const session = event.data.object;
  const customerId = session.customer ?? null;
  const customerEmail = session.customer_details?.email ?? null;
  const { rows: [payer] } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("archived_at", "is", null)
    .where((eb) => eb.or([
      eb.and([
        sql`${sql.val(customerId)}::text is not null`,
        eb("stripe_customer_id", "=", customerId),
      ]),
      eb.and([
        sql`${sql.val(customerEmail)}::text is not null`,
        sql`lower(email) = lower(${sql.val(customerEmail)})`,
      ]),
    ]))
    .orderBy(sql`(stripe_customer_id = ${sql.val(customerId)}) desc nulls last`)
    .limit(1));
  if (!payer) {
    throw new Error(`payment link paid (${paymentIntent}) by a customer who is not a person in this practice — add them, then replay the event`);
  }
  const { rows: paymentRows } = await run(tx, db
    .insertInto("keystone.payment")
    .values({
      tenant_id: tenantId ?? null,
      provider_payment_id: paymentIntent ?? null,
      provider: "stripe",
      amount_minor: amountMinor ?? null,
      status: "succeeded",
      payer_user_id: payer.id ?? null,
      currency: sql`upper(coalesce(${sql.val(session.currency ?? null)}, 'usd'))`,
      method: "link",
    })
    .returning("id"));

  const paymentId = paymentRows[0].id;

  // Find the payment link by its metadata
  const { rows: linkRows } = await run(tx, db
    .selectFrom("keystone.payment_link")
    .select("id")
    .where("tenant_id", "=", tenantId));

  // Try to find the link from the event's payment_link metadata if present
  const paymentLinkId = event.data.object.payment_link;

  if (paymentLinkId) {
    // Update uses and taken_minor for this link
    await run(tx, db
      .updateTable("keystone.payment_link")
      .set({
        uses: sql`uses + 1`,
        taken_minor: sql`taken_minor + ${sql.val(amountMinor)}`,
        last_used_at: sql`now()`,
      })
      .where("tenant_id", "=", tenantId)
      .where("stripe_payment_link_id", "=", paymentLinkId));
  }

  // Emit the payment link completed event
  await emit(tx, {
    tenantId,
    topic: "money.payment_link.paid",
    emittedBy: "money",
    subjectType: "payment",
    subjectId: paymentId,
    actor: "webhook:stripe", // RUN-2: emit() takes an actor STRING (outbox.mjs ACTOR_SHAPE); the object/word here threw TopicViolation and rolled the write back
    payload: {
      amount_minor: amountMinor,
      provider_type: "stripe",
    },
  });
}
