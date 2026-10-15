// Task 6.5 (spec 06 §2.7, §9, §10) — READS OF `keystone.workbench_subscription`.
//
// ★★★ CT-110's "mirror written once, on success, never computed live" discipline, from the read
//     side: every function here SELECTs the mirror `db/migrations/0334`/`0335` already hold. None
//     of them ever calls Stripe — that only happens in `src/billing/webhook.mjs` (the mirror
//     writer, on a verified inbound event) and in the checkout/portal-session routes
//     (`src/routes/settings.mjs`), which ask Stripe for a hosted URL and write nothing back here.
// ★★ `getSeatStatus()` is named explicitly, by this exact signature, in 06-settings.md §10 point 2:
//    "`getSeatStatus(tx, tenantId) → {seatCount, seatLimit, canInviteMore}` is this spec's own new
//    function" — CT-111 leaves the call site inside `inviteTeamMember` (spec 01's file) as NOT
//    BUILT this stage; this is the function spec 01 calls when it does, not a guess at its shape.
// ★ `createTrialSubscription()` (§10 point 6, §11) is a DIFFERENT task's writer (spec 12's signup
//   flow calls it the first time a tenant is provisioned) — out of this task's file list (§2.7, §3,
//   §9, §5 only) and out of its two named tests (§12 items 3 and 7). Not built here.

import { usageForPeriod } from "./usage.mjs";

/**
 * The practice's own the platform subscription row, or `null` if none exists yet (should not happen
 * for any tenant past migration 0334's backfill, but a read function never assumes a write ran).
 */
export async function getSubscription(tx, tenantId) {
  const { rows } = await tx.query(
    `SELECT id, tenant_id, stripe_customer_id, stripe_subscription_id, plan_key, seat_count,
            seat_limit, trial_ends_at, status, updated_at,
            current_period_start, current_period_end
       FROM keystone.workbench_subscription
      WHERE tenant_id = $1`,
    [tenantId]);
  return rows[0] ?? null;
}

/**
 * ★★★ §12 test item 7, verbatim: "returns canInviteMore: false when seatCount >= seatLimit and
 *     seatLimit IS NOT NULL — positive control: seatLimit IS NULL (unlimited, Enterprise) always
 *     returns true regardless of seatCount."
 * ★ `seatLimit: null` is the Enterprise/unlimited case (same convention `plans.mjs`'s
 *   `seats: null` uses) — a plan with no seat ceiling never blocks an invite, no matter how many
 *   seats are already filled.
 */
export async function getSeatStatus(tx, tenantId) {
  const sub = await getSubscription(tx, tenantId);
  const seatCount = sub?.seat_count ?? 0;
  const seatLimit = sub?.seat_limit ?? null;
  const canInviteMore = seatLimit == null ? true : seatCount < seatLimit;
  return { seatCount, seatLimit, canInviteMore };
}

/**
 * ★★★ Task 17.17 — Billing invoice reads reconciled. Delegates to usageForPeriod with
 *   basis:'invoice', keeping the old return shape for existing fields (aiDraft, marketingEmail)
 *   while adding the new metrics. Used by GET /api/settings/billing to compute overage for
 *   invoice (reconciled counts), and by GET /api/settings/plans' usage display.
 * ★ `periodStart` is the first of the CURRENT calendar month; callers key their own rows
 *   the same way, per migration 0335's comment ("one row per (tenant, period_start, metric)").
 */
export async function getUsage(tx, tenantId, periodStart = firstOfThisMonth()) {
  const usage = await usageForPeriod(tx, tenantId, periodStart, { basis: 'invoice' });

  // Keep existing shape for backward compatibility, add new metrics
  return {
    aiDraft: usage.ai_draft?.used ?? 0,
    marketingEmail: usage.marketing_email?.used ?? 0,
    text: usage.text?.used ?? 0,
    esign: usage.esign?.used ?? 0,
    // The full usage object with included/overage/reconciled flags for billing calculations
    _fullUsage: usage,
  };
}

function firstOfThisMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
