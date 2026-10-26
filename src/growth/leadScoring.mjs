// @ts-check
// Stage 20 Task 20.50 — LEAD SCORING — nightly sweep scores leads from 90-day facts
//
// ★★★ THE SWEEP IS THE ONLY WRITER. A score is never hand-mutated, never editable by a person,
//     never patched by a route. If it is wrong, the facts or the weights are wrong.
//
// DETERMINISM: the same facts produce the same score. Two runs leave identical rows.
//   No randomness, no clock inside the computation beyond the 90-day window boundary.
//
// REASONS NAME REAL FACTS ONLY. Every reason in the jsonb corresponds to a row that exists.
//   A reason is evidence, not a guess, and the test asserts it.
//
// COACHES SEE NO AMOUNTS: reasons in a coach's payload carry no money figures. The server
//   decides that, not the screen.

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { recentInstanceCountFor } from "../documents/api.mjs";

/**
 * ★★★ SCORE A PERSON FROM WEIGHTED FACTS OVER 90 DAYS.
 *
 * Inputs: facts from email engagement, bookings, documents, consent, funnel events.
 * Outputs: { score, reasons, scoredAt }
 *   · score: sum of weighted facts, integer 0–100+
 *   · reasons: array of { fact, weight, value } — evidence for the score
 *   · scoredAt: ISO timestamp of computation
 *
 * ★ Deterministic: same facts → same score, every time. No randomness, no floating point,
 *   no clock except the 90-day window boundary (computed at call time, same for all facts
 *   in one sweep).
 */
export async function scoreLead(tx, tenantId, personId, weights, nowOverride = null) {
  const now = nowOverride ? new Date(nowOverride) : new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const reasons = [];
  let totalScore = 0;

  // ★ EMAIL ENGAGEMENT: opens and clicks are signals of interest.
  //   opened_at and click_count are CACHES maintained by webhooks (0486),
  //   and email_click is the ledger. We use the ledger to count clicks in the window,
  //   and the cache timestamps to determine recency.
  const clickCount = await tx.query(
    `SELECT count(*) as cnt FROM keystone.email_click
      WHERE tenant_id = $1 AND app_user_id = $2 AND clicked_at > $3`,
    [tenantId, personId, ninetyDaysAgo]);
  const clicks = clickCount.rows[0]?.cnt ?? 0;
  if (clicks > 0) {
    const weight = weights.email_click ?? 0;
    const value = clicks * weight;
    totalScore += value;
    reasons.push({
      fact: `clicked email ${clicks} time${clicks === 1 ? '' : 's'}`,
      weight,
      count: clicks,
    });
  }

  // ★ OPENED EMAIL: first_opened_at signals early engagement.
  const openedRow = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("opened_at")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", personId)
    .where("opened_at", "is not", null)
    .where("opened_at", ">", ninetyDaysAgo));
  if (openedRow.rowCount > 0) {
    const weight = weights.email_opened ?? 0;
    totalScore += weight;
    reasons.push({
      fact: 'opened an email',
      weight,
    });
  }

  // ★ FUNNEL EVENTS: page_view and conversion signal active interest.
  //   visit_pricing is implicit in conversion events.
  const funnelRow = await tx.query(
    `SELECT
       COUNT(CASE WHEN event_type = 'page_view' THEN 1 END) as views,
       COUNT(CASE WHEN event_type = 'conversion' THEN 1 END) as conversions,
       MAX(created_at) as last_event_at
      FROM keystone.funnel_event
      WHERE tenant_id = $1 AND person_id = $2 AND created_at > $3`,
    [tenantId, personId, ninetyDaysAgo]);
  const funnel = funnelRow.rows[0];
  if (funnel?.views > 0) {
    const weight = weights.funnel_page_view ?? 0;
    const value = funnel.views * weight;
    totalScore += value;
    reasons.push({
      fact: `visited the site ${funnel.views} time${funnel.views === 1 ? '' : 's'}`,
      weight,
      count: funnel.views,
    });
  }
  if (funnel?.conversions > 0) {
    const weight = weights.funnel_conversion ?? 0;
    const value = funnel.conversions * weight;
    totalScore += value;
    reasons.push({
      fact: `converted ${funnel.conversions} time${funnel.conversions === 1 ? '' : 's'}`,
      weight,
      count: funnel.conversions,
    });
  }

  // ★ BOOKING: a booked session is the strongest signal — they committed.
  //   Count non-cancelled bookings in the 90-day window.
  const bookingRow = await tx.query(
    `SELECT count(*)::int as cnt FROM keystone.booking b
       JOIN keystone.booking_participant bp ON bp.booking_id = b.id AND bp.party = 'client'
      WHERE b.tenant_id = $1 AND bp.app_user_id = $2 AND b.state != 'cancelled'
        AND b.created_at > $3`,
    [tenantId, personId, ninetyDaysAgo]);
  const bookings = bookingRow.rows[0]?.cnt ?? 0;
  if (bookings > 0) {
    const weight = weights.booking_created ?? 0;
    const value = bookings * weight;
    totalScore += value;
    reasons.push({
      fact: `booked a session ${bookings} time${bookings === 1 ? '' : 's'}`,
      weight,
      count: bookings,
    });
  }

  // ★ CONSENT: active consent (marketing, not revoked) is a signal of permission.
  const consentRow = await tx.query(
    `SELECT count(*) as cnt FROM keystone.consent_record
      WHERE tenant_id = $1 AND person_id = $2 AND consent_type = 'marketing'
        AND is_active = true AND created_at > $3`,
    [tenantId, personId, ninetyDaysAgo]);
  const consents = consentRow.rows[0]?.cnt ?? 0;
  if (consents > 0) {
    const weight = weights.consent_marketing ?? 0;
    totalScore += weight;
    reasons.push({
      fact: 'gave marketing consent',
      weight,
    });
  }

  // ★ DOCUMENT: viewed or signed a document signals serious interest.
  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
  const documents = await recentInstanceCountFor(tx, { tenantId, subjectUserId: personId, since: ninetyDaysAgo });
  if (documents > 0) {
    const weight = weights.document_interaction ?? 0;
    const value = documents * weight;
    totalScore += value;
    reasons.push({
      fact: `interacted with a document ${documents} time${documents === 1 ? '' : 's'}`,
      weight,
      count: documents,
    });
  }

  return {
    score: Math.max(0, totalScore),
    reasons,
    scoredAt: now.toISOString(),
  };
}

/**
 * ★ LOAD WEIGHTS FROM SETTINGS, or use shipped defaults.
 * Called by the sweep job to ensure settings changes take effect on the next run.
 */
export function defaultLeadScoringWeights() {
  return {
    email_click: 10,
    email_opened: 5,
    funnel_page_view: 2,
    funnel_conversion: 15,
    booking_created: 50,
    consent_marketing: 5,
    document_interaction: 8,
  };
}
