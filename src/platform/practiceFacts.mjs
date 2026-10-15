// Stage 18 task 18.11 — Practice facts: Overview, Practices list and Practice record routes.
//
// ★★★ CROSS-TENANT RULE: COUNTS, NEVER NAMES.
// Every practice's plan, size, money and usage facts are computed from that practice's own rows
// (one `withTenant` per practice). Queries run inside withTenant and return counts/sums only —
// no person-level fields ever leave this function (F13 §3).

import { withTenant } from "../db/index.mjs";
import { PLANS } from "../billing/plans.mjs";
import { APPLICATION_FEE_BPS } from "../money/stripeConnected.mjs";
import { anyInstanceEverSent } from "../documents/api.mjs";

/**
 * Compute all practice facts for a single practice.
 * Runs inside withTenant(tenantRow.id) to read that practice's rows under RLS.
 * Returns an object with plan, team, clients, payments, stripe connection, and access history.
 *
 * @param {object} tenantRow - row from platform_list_tenants() { id, slug, name, status, timezone, is_platform }
 * @param {object} db - database connection (passed by withTenant)
 * @returns {Promise<object>} Facts object
 */
export async function practiceFacts(tenantRow, db) {
  const tenantId = tenantRow.id;

  // ──────────────────────────────────────────────────────────────────────────────
  // Tenant details (status, created_at, is_platform, sandbox_of, is_reference)
  // ──────────────────────────────────────────────────────────────────────────────
  const { rows: tenantRows } = await db.query(
    `SELECT created_at, is_platform, sandbox_of, is_reference FROM keystone.tenant WHERE id = $1`,
    [tenantId]
  );
  const tenant = tenantRows[0] || {};

  // ──────────────────────────────────────────────────────────────────────────────
  // Subscription facts: plan, status, trial_ends_at
  // ──────────────────────────────────────────────────────────────────────────────
  const { rows: subRows } = await db.query(
    `SELECT plan_key, status, trial_ends_at, updated_at FROM keystone.workbench_subscription LIMIT 1`
  );
  const sub = subRows[0] || { plan_key: null, status: null, trial_ends_at: null };

  const planObj = PLANS.find((p) => p.key === sub.plan_key);
  const monthlyMinor = planObj?.monthlyPriceMinor ?? null;

  // Compute display plan: 'Trial' if trialing, otherwise plan name or '—'
  const displayPlan = sub.status === "trialing" ? "Trial" : (planObj?.name ?? "—");

  // ──────────────────────────────────────────────────────────────────────────────
  // Team count: staff (archived_at IS NULL)
  // ──────────────────────────────────────────────────────────────────────────────
  const { rows: teamRows } = await db.query(
    `SELECT count(*) as cnt FROM keystone.app_user WHERE role = 'staff' AND archived_at IS NULL`
  );
  const teamCount = parseInt(teamRows[0]?.cnt ?? 0, 10);

  // ──────────────────────────────────────────────────────────────────────────────
  // Client counts: adults and adolescents (not sample, archived_at IS NULL)
  // ──────────────────────────────────────────────────────────────────────────────
  const { rows: clientRows } = await db.query(
    `SELECT count(*) as cnt FROM keystone.app_user
     WHERE role IN ('adult_client', 'adolescent_client')
       AND archived_at IS NULL
       AND NOT is_sample`
  );
  const clientCount = parseInt(clientRows[0]?.cnt ?? 0, 10);

  // Clients new this month
  const { rows: newClientRows } = await db.query(
    `SELECT count(*) as cnt FROM keystone.app_user
     WHERE role IN ('adult_client', 'adolescent_client')
       AND archived_at IS NULL
       AND NOT is_sample
       AND created_at >= date_trunc('month', now())`
  );
  const clientsNewThisMonth = parseInt(newClientRows[0]?.cnt ?? 0, 10);

  // ──────────────────────────────────────────────────────────────────────────────
  // Payment facts: processed this month and all time, earned this month
  // ★ STRIPE-MIRROR REPOINT (2 Oct 2026) — `payment_effective` (Stripe charges + the platform-only payments).
  //   This runs inside ONE practice's withTenant (not a cross-tenant aggregate), so the single-tenant
  //   views are correct here.
  // ──────────────────────────────────────────────────────────────────────────────
  const { rows: paymentThisMonthRows } = await db.query(
    `SELECT coalesce(sum(amount_minor), 0) as total FROM keystone.payment_effective
     WHERE status = 'succeeded'
       AND created_at >= date_trunc('month', now())`
  );
  const processedThisMonthMinor = parseInt(paymentThisMonthRows[0]?.total ?? 0, 10);

  const { rows: paymentAllTimeRows } = await db.query(
    `SELECT coalesce(sum(amount_minor), 0) as total FROM keystone.payment_effective
     WHERE status = 'succeeded'`
  );
  const processedAllTimeMinor = parseInt(paymentAllTimeRows[0]?.total ?? 0, 10);

  // Earned = platform fee on processed this month
  const earnedThisMonthMinor = Math.round(
    (processedThisMonthMinor * APPLICATION_FEE_BPS) / 10000
  );

  // ──────────────────────────────────────────────────────────────────────────────
  // Staff last signed in
  // ──────────────────────────────────────────────────────────────────────────────
  const { rows: staffLastSeenRows } = await db.query(
    `SELECT max(last_seen_at) as last_seen FROM keystone.app_user WHERE role = 'staff'`
  );
  const staffLastSignedIn = staffLastSeenRows[0]?.last_seen || null;

  // ──────────────────────────────────────────────────────────────────────────────
  // Feature usage: documents sent, packages/entitlements used
  // ──────────────────────────────────────────────────────────────────────────────
  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
  const documentsUsed = await anyInstanceEverSent(db);

  const { rows: entRows } = await db.query(
    `SELECT count(*) as cnt FROM keystone.entitlement`
  );
  const packagesUsed = parseInt(entRows[0]?.cnt ?? 0, 10) > 0;

  // ──────────────────────────────────────────────────────────────────────────────
  // Stripe connection: latest connect_account
  // ──────────────────────────────────────────────────────────────────────────────
  const { rows: stripeRows } = await db.query(
    `SELECT state, stripe_account_id, created_at FROM keystone.connect_account
     ORDER BY created_at DESC LIMIT 1`
  );
  // ★ the platform's own account (Docustay) has no connect_account row — keystone.stripe_account is_platform (0575)
  let stripeConn = stripeRows[0];
  if (!stripeConn) {
    const { rows: acct } = await db.query(
      `SELECT 'live' AS state, stripe_account_id, created_at FROM keystone.stripe_account ORDER BY created_at DESC LIMIT 1`);
    stripeConn = acct[0];
  }
  const stripeData = {
    connected: stripeConn?.state ?? "not_connected",
    accountId: stripeConn?.stripe_account_id ?? null,
    connectedAt: stripeConn?.created_at ?? null,
  };

  // ──────────────────────────────────────────────────────────────────────────────
  // Access history: latest operator_access_request
  // ──────────────────────────────────────────────────────────────────────────────
  const { rows: accessRows } = await db.query(
    `SELECT asked_at, why, state FROM keystone.operator_access_request
     ORDER BY asked_at DESC LIMIT 1`
  );
  const lastAccess = accessRows[0];
  const accessData = {
    lastAsked: lastAccess
      ? {
          askedAt: lastAccess.asked_at,
          why: lastAccess.why,
          state: lastAccess.state,
        }
      : null,
  };

  // ──────────────────────────────────────────────────────────────────────────────
  // State computation: based on subscription status
  // ──────────────────────────────────────────────────────────────────────────────
  let state = "Fine";
  if (sub.status === "canceled" || sub.status === "closed") {
    state = "Gone";
  } else if (sub.status === "past_due") {
    state = "Payment failing";
  } else if (sub.status === "trialing" && sub.trial_ends_at) {
    const daysLeft = Math.ceil(
      (new Date(sub.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24)
    );
    if (daysLeft > 0) {
      state = `${daysLeft} days left`;
    } else {
      state = "Gone";
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // needsLooking: check if this practice matches any prompt conditions
  // ──────────────────────────────────────────────────────────────────────────────
  let needsLooking = false;

  // Check payment_failing condition
  if (sub.status === "past_due") {
    needsLooking = true;
  }

  // Check trial_idle condition: trialing and no activity in last 4 days
  if (!needsLooking && sub.status === "trialing") {
    const { rows: activityRows } = await db.query(
      `SELECT count(*) as cnt FROM (
        SELECT 1 FROM keystone.booking WHERE created_at > now() - interval '4 days'
        UNION ALL
        SELECT 1 FROM keystone.app_user WHERE role != 'staff' AND created_at > now() - interval '4 days'
        UNION ALL
        SELECT 1 FROM keystone.payment_effective WHERE created_at > now() - interval '4 days'
      ) t`
    );
    const hasActivity = parseInt(activityRows[0]?.cnt ?? 0, 10) > 0;
    if (!hasActivity) {
      needsLooking = true;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Compute isReal: is_platform=false, sandbox_of IS NULL, is_reference=false
  // ──────────────────────────────────────────────────────────────────────────────
  const isReal = !tenant.is_platform && !tenant.sandbox_of && !tenant.is_reference;

  // ──────────────────────────────────────────────────────────────────────────────
  // Return the Facts object
  // ──────────────────────────────────────────────────────────────────────────────
  return {
    id: tenantId,
    slug: tenantRow.slug,
    name: tenantRow.name,
    status: tenantRow.status,
    since: tenant.created_at,
    isReal,
    plan: {
      key: sub.plan_key,
      name: planObj?.name ?? null,
      status: sub.status,
      trialEndsAt: sub.trial_ends_at,
      monthlyMinor,
    },
    displayPlan,
    team: teamCount,
    clients: clientCount,
    clientsNewThisMonth,
    processedThisMonthMinor,
    processedAllTimeMinor,
    earnedThisMonthMinor,
    staffLastSignedIn,
    neverUsed: [
      { key: "documents", used: documentsUsed },
      { key: "packages", used: packagesUsed },
    ],
    stripe: stripeData,
    access: accessData,
    needsLooking,
    state,
  };
}
