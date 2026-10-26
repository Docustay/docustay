// P3.S11 — APPROVE A HELD PAYMENT (RADAR REVIEW) AND LIST OPEN REVIEWS
//
// A Stripe Radar "review" is a payment Stripe held for a manual look before it settles.
// Approving one tells Stripe to let it continue. There is no local mirror table for reviews —
// same posture as `src/settings/invoiceLayouts.mjs`'s "Stripe IS the list, live, every time it is
// asked for" — so both functions here talk straight to `/v1/reviews` through
// `stripeConnectedRequest` and hold nothing of their own.
//
// The permission gate is asked by the CALLER, not here: `approveFraudReview` is reached only
// through the `/api/money/fraud/approve` WRITE_ROUTES row (`object: "dispute", action: "edit"`,
// checked by `src/routes/writes.mjs`'s dispatcher before this function is ever called — the same
// shape `cancelRefund`/`closeDispute` already use). `listFraudReviews` is reached through
// `src/routes/money.mjs`'s own `GET /api/money/fraud/reviews`, which asks `assertMay` for
// `dispute.view` itself before calling this file — the same shape `previewCreditNote` uses for
// `invoice.view` (`src/money/creditNotes.mjs`).

import { dependency } from "../http/errors.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { emit, userActor } from "../events/outbox.mjs";

/**
 * Approve a held payment — POST /v1/reviews/{id}/approve. Emits `money.review.approved`.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId, reviewId, actorUserId
 * @returns {Promise<{id: string}>}
 */
export async function approveFraudReview(tx, { tenantId, reviewId, actorUserId }) {
  try {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/reviews/${reviewId}/approve`,
      sdk: (s, o, form, query) => s.reviews.approve(reviewId, {}, o),
      form: {},
      movesMoney: false,
      purpose: "approve_fraud_review",
      actorUserId,
    });
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`, e);
  }

  await emit(tx, {
    tenantId,
    topic: "money.review.approved",
    emittedBy: "money",
    subjectType: "dispute",
    subjectId: reviewId,
    actor: userActor(actorUserId),
    payload: { review_id: reviewId },
  });

  return { id: reviewId };
}

/**
 * List open Stripe Radar reviews — GET /v1/reviews?limit=100, following `has_more` (same
 * pagination idiom as `listInvoiceLayouts`/`listPayouts`), keeping only the ones still open.
 *
 * ★ Same posture as `listInvoiceLayouts`'s field 8(c): this is a read, never a refused write. A
 *   Stripe outage returns an empty list with `unavailable: true` rather than throwing.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId
 * @returns {Promise<{reviews: Array<{id, reason, open, created}>, unavailable?: true}>}
 */
export async function listFraudReviews(tx, { tenantId }) {
  try {
    const reviews = [];
    let startingAfter = null;

    while (true) {
      const query = { limit: 100 };
      if (startingAfter) {
        query.starting_after = startingAfter;
      }

      const { body } = await stripeConnectedRequest(tx, {
        tenantId,
        method: "GET",
        path: "/reviews",
        sdk: (s, o, form, query) => s.reviews.list(query, o),
        query,
        movesMoney: false,
        purpose: "list_fraud_reviews",
        actorUserId: null,
      });

      const page = body.data || [];
      reviews.push(...page);

      if (!body.has_more) break;
      if (page.length === 0) break;
      startingAfter = page[page.length - 1].id;
    }

    return {
      reviews: reviews
        .filter((r) => r.open === true)
        .map((r) => ({ id: r.id, reason: r.reason ?? null, open: r.open, created: r.created ?? null })),
    };
  } catch {
    return { reviews: [], unavailable: true };
  }
}
