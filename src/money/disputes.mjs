// @ts-check
// Stage 15 Task 15.27 — DISPUTE EVIDENCE STAGING
//
// ★★★ RULE: Never include note bodies, DOB, sobriety date, recovery fields, emergency contact,
//     consent detail, or guardian relationship in any evidence row's sentence field.
//
// Evidence assembly, detail, staging, and submission tracking for Stripe disputes.

import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict, dependency } from "../http/errors.mjs";
// ★ L3.money/disputes — every `tx.query(<static SQL>)` below now goes through the builder + `run`;
//   the SQL semantics are unchanged (same joins, same WHERE clauses, same GROUP BY, same
//   parameterization, same RETURNING columns). `sql` is the escape hatch for expressions the
//   builder itself does not express (casts, NULLIF, aggregate expressions, `now()`).
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { mostRecentExecutedInstanceFor } from "../documents/api.mjs";

const SECTION = "money";

/**
 * Assemble evidence rows for a dispute.
 * @param {object} tx database transaction
 * @param {object} options tenantId, disputeId
 * @returns {Promise<Array<{kind, sentence, strength, attached}>>}
 */
export async function assembleEvidence(tx, { tenantId, disputeId }) {
  // ── Get the dispute and its payment ──────────────────────────────────────────
  const { rows: disputeRows } = await run(tx, db
    // ★ STRIPE MIRROR (0574) — dispute + payment facts read from the effective views, not the cache tables.
    .selectFrom("keystone.dispute_effective as d")
    .leftJoin("keystone.payment_effective as p", (join) => join
      .onRef("d.tenant_id", "=", "p.tenant_id")
      .onRef("d.payment_id", "=", "p.id"))
    .selectAll("d")
    .select(["p.payer_user_id as customer_person_id", "p.invoice_id"])
    .where("d.tenant_id", "=", tenantId)
    .where("d.id", "=", disputeId));

  if (disputeRows.length === 0) {
    return [];
  }

  const dispute = disputeRows[0];
  const payerId = dispute.customer_person_id;

  if (!payerId) {
    return [];
  }

  const evidence = [];

  // ── Attended sessions: bookings for the payer, scoped by invoice_id where present ───
  // Only include attended sessions if the payment is linked to a specific invoice.
  // Scoping to the disputed invoice prevents overstating evidence by including unrelated sessions.
  if (dispute.invoice_id) {
    const { rows: bookingRows } = await run(tx, db
      .selectFrom("keystone.booking as b")
      .innerJoin("keystone.booking_participant as bp", (join) => join
        .onRef("bp.booking_id", "=", "b.id")
        .on("bp.party", "=", "client"))
      .select([
        sql`COUNT(*)::int`.as("count"),
        sql`MAX(b.starts_at)`.as("last_date"),
      ])
      .where("b.tenant_id", "=", tenantId)
      .where("bp.app_user_id", "=", payerId)
      // ★ R1 (RECONCILE) — `booking.invoice_id` is gone (0513): the invoice's sessions are the bookings
      //   its line items reference (0512's `line_item.booking_id`). IN, not a join, so a booking with two
      //   lines on the invoice is still counted once.
      .where("b.id", "in", db
        .selectFrom("keystone.line_item as li")
        .select("li.booking_id")
        .where("li.tenant_id", "=", tenantId)
        .where("li.invoice_id", "=", dispute.invoice_id)
        .where("li.booking_id", "is not", null))
      .where("b.state", "=", "completed"));

    if (bookingRows[0]?.count > 0) {
      evidence.push({
        kind: "attended_sessions",
        sentence: `Attended ${bookingRows[0].count} session${bookingRows[0].count === 1 ? "" : "s"} on ${formatDate(bookingRows[0].last_date)}.`,
        strength: "Strong",
        attached: false,
      });
    }
  }

  // ── Executed agreement: document_instance with state='executed' for payer ────
  // ★ the words they SIGNED are the instance's snapshot, not the template's current body
  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
  const docRows = await mostRecentExecutedInstanceFor(tx, { tenantId, subjectUserId: payerId });

  if (docRows.length > 0) {
    const doc = docRows[0];
    evidence.push({
      kind: "executed_agreement",
      sentence: `Signed agreement on ${formatDate(doc.signed_at)}.`,
      strength: "Strong",
      attached: false,
    });

    // Terms clause from the document
    if (doc.content) {
      evidence.push({
        kind: "terms_clause",
        sentence: `Agreed to terms: ${extractTermsSummary(doc.content)}`,
        strength: "Strong",
        attached: true,
      });
    }
  }

  // ── Invoice opens: view_count and viewed_at (from 15.5 columns) ───────────────
  // Note: These columns may not exist yet depending on migration status
  // Try to read them if they exist
  // ★ R13 (RECONCILE) — `invoiceId` was never declared in this function, so this line threw a
  //   ReferenceError synchronously (BEFORE the `.catch` below could see it) and dispute evidence never
  //   assembled. The disputed invoice is the payment's, read at the top (`p.invoice_id`).
  const { rows: invoiceRows } = dispute.invoice_id
    ? await run(tx, db
      .selectFrom("keystone.invoice")
      .select(["view_count", "viewed_at"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", dispute.invoice_id))
      .catch(() => ({ rows: [{ view_count: null, viewed_at: null }] }))
    : { rows: [] };

  if (invoiceRows[0]?.view_count > 0) {
    evidence.push({
      kind: "invoice_opens",
      sentence: `Invoice viewed ${invoiceRows[0].view_count} time${invoiceRows[0].view_count === 1 ? "" : "s"}.`,
      strength: "Strong",
      attached: false,
    });
  }

  // ── Message count: messages in the payer's message thread ────────────────────
  const { rows: msgCountRows } = await run(tx, db
    .selectFrom("keystone.message as m")
    .innerJoin("keystone.message_thread as mt", (join) => join
      .onRef("m.tenant_id", "=", "mt.tenant_id")
      .onRef("m.thread_id", "=", "mt.id"))
    .select([sql`COUNT(m.*)`.as("count")])
    .where("m.tenant_id", "=", tenantId)
    .where("mt.person_id", "=", payerId));

  if (msgCountRows[0]?.count > 0) {
    evidence.push({
      kind: "message_count",
      sentence: `${msgCountRows[0].count} message${msgCountRows[0].count === 1 ? "" : "s"} exchanged.`,
      strength: "Supporting",
      attached: false,
    });
  }

  // ── Paid-for sessions unused: unused credits on the payment's entitlement ────
  // ★ credits are entitlement_credit rows (one per session); the entitlement reaches the payment
  //   through its line item's invoice. Per-session value = the line's amount ÷ credits bought.
  const { rows: creditRows } = await run(tx, db
    .selectFrom("keystone.entitlement_credit as c")
    .innerJoin("keystone.entitlement as e", (join) => join
      .onRef("c.tenant_id", "=", "e.tenant_id")
      .onRef("c.entitlement_id", "=", "e.id"))
    .innerJoin("keystone.line_item as li", (join) => join
      .onRef("e.tenant_id", "=", "li.tenant_id")
      .onRef("e.line_item_id", "=", "li.id"))
    .innerJoin("keystone.payment_effective as p", (join) => join
      .onRef("p.tenant_id", "=", "li.tenant_id")
      .onRef("p.invoice_id", "=", "li.invoice_id"))
    .select([
      sql`count(c.id)::int`.as("available"),
      sql`max((li.unit_amount_minor * li.quantity - COALESCE(li.discount_minor, 0)) / NULLIF(e.total_credits, 0))`.as("price_minor"),
    ])
    .where("c.tenant_id", "=", tenantId)
    .where("c.status", "in", ["available", "returned"])
    .where("p.id", "=", dispute.payment_id)
    .groupBy("e.id"));

  if (creditRows.length > 0) {
    let totalCount = 0;
    let totalMinor = 0;
    for (const row of creditRows) {
      const count = row.available || 0;
      const priceMinor = row.price_minor || 0;
      totalCount += count;
      totalMinor += count * priceMinor;
    }

    if (totalCount > 0) {
      evidence.push({
        kind: "unused_credits",
        sentence: `${totalCount} unused session${totalCount === 1 ? "" : "s"} worth $${(totalMinor / 100).toFixed(2)}.`,
        strength: "Goes against you",
        attached: false,
      });
    }
  }

  return evidence;
}

/**
 * Format a date for display.
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return "unknown date";
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Extract a summary of terms from document content.
 * @param {string} content
 * @returns {string}
 */
function extractTermsSummary(content) {
  if (!content) return "terms agreed";
  // a template body is jsonb ({sections:[{blocks:[{type:'text',text}]}]}), not a string
  if (typeof content === "object") {
    content = (content.sections ?? []).flatMap((sec) => (sec.blocks ?? []))
      .filter((b) => b?.type === "text" && b.text).map((b) => b.text).join(" ");
    if (!content) return "terms agreed";
  }
  // Extract first 100 chars, or first sentence
  const match = content.match(/^[^.!?]*[.!?]/);
  const summary = match ? match[0] : content.substring(0, 100);
  return summary.length > 100 ? summary.substring(0, 97) + "..." : summary;
}

/**
 * Get full dispute details including evidence.
 * @param {object} tx database transaction
 * @param {object} options tenantId, disputeId
 * @returns {Promise<object>}
 */
export async function disputeDetail(tx, { tenantId, disputeId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.dispute_effective as d")
    .leftJoin("keystone.payment_effective as p", (join) => join
      .onRef("d.tenant_id", "=", "p.tenant_id")
      .onRef("d.payment_id", "=", "p.id"))
    .leftJoin("keystone.app_user as u", (join) => join
      .onRef("p.tenant_id", "=", "u.tenant_id")
      .onRef("p.payer_user_id", "=", "u.id"))
    .selectAll("d")
    .select([
      "p.amount_minor as payment_amount_minor",
      "p.payer_user_id as customer_person_id",
      "u.display_name",
    ])
    .where("d.tenant_id", "=", tenantId)
    .where("d.id", "=", disputeId));

  if (rows.length === 0) {
    return null;
  }

  const dispute = rows[0];
  const evidence = await assembleEvidence(tx, { tenantId, disputeId });

  return {
    id: dispute.id,
    tenant_id: dispute.tenant_id,
    stripe_id: dispute.stripe_id,
    amount_minor: dispute.amount_minor,
    state: dispute.state,
    reason: dispute.reason,
    evidence_due_by: dispute.evidence_due_by,
    evidence_submitted_at: dispute.evidence_submitted_at,
    payment_id: dispute.payment_id,
    fee_minor: dispute.fee_minor,
    created_at: dispute.created_at,
    updated_at: dispute.updated_at,
    payment: {
      id: dispute.payment_id,
      amount_minor: dispute.payment_amount_minor,
      customer_person_id: dispute.customer_person_id,
    },
    payerDisplayName: dispute.display_name || "Unknown",
    evidence,
    refundUnusedMinor: calculateUnusedCreditsTotal(evidence),
    acceptLoss: dispute.amount_minor,
    fee: dispute.fee_minor !== null ? dispute.fee_minor : "Either way it costs $15.",
  };
}

/**
 * Calculate total unused credits from evidence.
 * @param {Array} evidence
 * @returns {number}
 */
function calculateUnusedCreditsTotal(evidence) {
  const creditEvidence = evidence.find((e) => e.kind === "unused_credits");
  if (!creditEvidence) return 0;
  // Extract amount from sentence like "$50.00"
  const match = creditEvidence.sentence.match(/\$([0-9.]+)/);
  return match ? Math.round(parseFloat(match[1]) * 100) : 0;
}

/**
 * Stage dispute evidence to Stripe and write audit.
 * @param {object} tx database transaction
 * @param {object} options tenantId, disputeId, extraText, actorUserId
 * @returns {Promise<void>}
 */
export async function stageDisputeEvidence(
  tx,
  { tenantId, disputeId, extraText = null, actorUserId },
) {
  const { rows: disputeRows } = await run(tx, db
    .selectFrom("keystone.dispute_effective")
    .select(["stripe_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", disputeId));

  if (disputeRows.length === 0) return;

  const dispute = disputeRows[0];
  const evidence = await assembleEvidence(tx, { tenantId, disputeId });

  // Build evidence text: sentences joined, plus extraText if given
  let evidenceText = evidence
    .map((e) => e.sentence)
    .join(" ");

  if (extraText) {
    evidenceText = `${evidenceText} ${extraText}`.trim();
  }

  // ★★★ CRITICAL: Verify no blocked-list fields leaked into evidence text
  // This check should never fire if assembleEvidence is correct
  const blockedPatterns = [
    /date.?of.?birth/i,
    /sobriety/i,
    /recovery/i,
    /note/i,
    /emergency.?contact/i,
    /consent/i,
    /guardian/i,
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(evidenceText)) {
      throw new Error(
        `dispute.evidence contains blocked-list field — rejecting. Text: ${evidenceText}`,
      );
    }
  }

  // Get first attended session date for service_date
  const firstSessionDate = evidence
    .filter((e) => e.kind === "attended_sessions")
    .map((e) => {
      const match = e.sentence.match(/(\d{4}-\d{2}-\d{2})/);
      return match ? match[0] : null;
    })
    .find((d) => d !== null);

  // Call Stripe to stage evidence
  await stripeConnectedRequest(
    tx,
    {
      tenantId,
      method: "POST",
      path: `/disputes/${dispute.stripe_id}`,
      sdk: (s, o, form, query) => s.disputes.update(dispute.stripe_id, form, o),
      form: {
        "evidence[uncategorized_text]": evidenceText,
        ...(firstSessionDate && { "evidence[service_date]": firstSessionDate }),
      },
      movesMoney: false,
      purpose: "dispute_evidence",
      actorUserId,
    },
  );

  // Write audit entry
  await writeAudit(tx, {
    tenantId,
    action: "dispute.evidence_sent",
    object: "dispute",
    subjectId: disputeId,
    actorUserId,
  });
}

/**
 * Accept a dispute (close it on Stripe).
 * @param {object} tx database transaction
 * @param {object} options tenantId, disputeId, actorUserId
 * @returns {Promise<void>}
 */
export async function acceptDispute(tx, { tenantId, disputeId, actorUserId }) {
  const { rows: disputeRows } = await run(tx, db
    .selectFrom("keystone.dispute_effective")
    .select(["stripe_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", disputeId));

  if (disputeRows.length === 0) return;

  const dispute = disputeRows[0];

  await stripeConnectedRequest(
    tx,
    {
      tenantId,
      method: "POST",
      path: `/disputes/${dispute.stripe_id}/close`,
      sdk: (s, o, form, query) => s.disputes.close(dispute.stripe_id, {}, o),
      movesMoney: false,
      purpose: "dispute_close",
      actorUserId,
    },
  );
}

/**
 * Handle a charge.dispute.updated Stripe webhook event.
 * Sets evidence_submitted_at and updates state if evidence was submitted.
 * Idempotent: only fires once per dispute.
 * @param {object} tx database transaction
 * @param {object} event Stripe webhook event
 * @param {object} options tenantId
 * @returns {Promise<void>}
 */
export async function handleDisputeUpdated(tx, event, { tenantId }) {
  const disputeObj = event.data.object;
  if (!disputeObj) return;

  // Only process if evidence was submitted
  const submissionCount = disputeObj.evidence_details?.submission_count ?? 0;
  if (submissionCount === 0) return;

  // Find the dispute row by stripe_id
  const { rows } = await run(tx, db
    .selectFrom("keystone.dispute")
    .select(["id", "evidence_submitted_at"])
    .where("tenant_id", "=", tenantId)
    .where("stripe_id", "=", disputeObj.id));

  if (rows.length === 0) return;

  const dispute = rows[0];

  // Only update if evidence_submitted_at is still NULL (idempotent)
  if (dispute.evidence_submitted_at !== null) {
    return;
  }

  // Update the dispute row
  await run(tx, db
    .updateTable("keystone.dispute")
    .set({
      evidence_submitted_at: sql`now()`,
      state: "evidence_submitted",
      updated_at: sql`now()`,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", dispute.id));

  // Emit event
  await emit(tx, {
    tenantId,
    topic: "money.dispute.evidence_submitted",
    emittedBy: "money",
    subjectType: "dispute",
    subjectId: dispute.id,
    actor: "system",
  });
}

/**
 * ★ CLOSE A DISPUTE BY CONCEDING IT — MONEY IS LOST AND IT CANNOT BE UNDONE.
 * Requires a typed confirmation; the confirmation text states the real consequence in plain words.
 * Sets dispute state to `lost`, calls Stripe `/close` endpoint, emits event, writes audit.
 *
 * @param {object} tx database transaction
 * @param {object} options tenantId, disputeId, confirmationText, actorUserId
 * @returns {Promise<{ id, state }>}
 */
export async function closeDispute(tx, {
  tenantId, disputeId, confirmationText, actorUserId,
} = {}) {
  if (!tenantId || !disputeId) throw invalid("tenantId and disputeId are required");
  if (!confirmationText) throw invalid("confirmationText is required — state the consequence");

  // ★ Load dispute
  const { rows: disputeRows } = await run(tx, db
    .selectFrom("keystone.dispute_effective")
    .select(["id", "stripe_id", "state", "amount_minor", "payment_id", "tenant_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", disputeId));

  if (disputeRows.length === 0) throw notFound("no such dispute in this practice");

  const dispute = disputeRows[0];

  // ★ Only allow from open/evidence_submitted states (not already lost/won)
  if (dispute.state === "lost" || dispute.state === "won") {
    throw conflict(
      `This dispute is already ${dispute.state} — it cannot be changed.`);
  }

  // ★ Call Stripe to close/concede the dispute
  try {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/disputes/${dispute.stripe_id}/close`,
      sdk: (s, o, form, query) => s.disputes.close(dispute.stripe_id, {}, o),
      form: {},
      movesMoney: false,
      purpose: "dispute_close",
      actorUserId,
    });
  } catch (err) {
    throw dependency(`Stripe refused this: ${err.message}`, err);
  }

  // ★ Update dispute state to lost
  await run(tx, db
    .updateTable("keystone.dispute")
    .set({ state: "lost", updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", disputeId));

  // ★ Emit event
  await emit(tx, {
    tenantId,
    topic: "money.dispute.closed",
    emittedBy: SECTION,
    subjectType: "dispute",
    subjectId: disputeId,
    actor: userActor(actorUserId),
    // ★ `confirmation_text` dropped from the payload (§2.4 — no text keys). Already on the record
    //   (`writeAudit` below writes `after.confirmation`, the audit row); no consumer of
    //   `money.dispute.closed` reads `payload.confirmation_text` (grepped src/, n8n/workflows/) —
    //   `src/audit/queries.mjs` only maps the topic to a fixed label string.
    payload: {
      state: "lost",
      amount_minor: dispute.amount_minor,
    },
  });

  // ★ Write audit with consequence stated plainly
  await writeAudit(tx, {
    tenantId,
    action: "dispute.closed",
    object: "dispute",
    subjectId: disputeId,
    after: { state: "lost", confirmation: confirmationText },
    actorUserId,
  });

  return { id: disputeId, state: "lost" };
}
