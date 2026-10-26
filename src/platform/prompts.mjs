// src/platform/prompts.mjs — Stage 18 task 18.10: platform prompts. Compute on read, store only
// dismissals (operator session context). `computePlatformPrompts` returns the operator's live
// prompts in priority order (≤3 for Overview); dismissals are stored in the new
// keystone_auth.operator_prompt_dismissal table (migration 0469, task 18.10).

import { withTenant } from "../db/index.mjs";
import { invalid } from "../http/errors.mjs";

/**
 * Platform prompts catalogue. Each entry is a prompt kind the platform monitors across all
 * tenants. Entries are computed by looping platform_list_tenants() and reading each practice's
 * own rows through withTenant() — never cross-tenant reads.
 */
const PLATFORM_PROMPTS = Object.freeze([
  {
    key: "payment_failing",
    priority: 1,
    compute: async (db, tenantId) => {
      // Check if this practice's subscription is past_due
      const { rows } = await db.query(
        `SELECT id, status, updated_at FROM keystone.mainstay_subscription LIMIT 1`
      );
      if (rows.length === 0) return [];
      const sub = rows[0];
      if (sub.status !== "past_due") return [];

      // Get the practice name
      const { rows: tenantRows } = await db.query(
        `SELECT name FROM keystone.tenant WHERE id = $1`,
        [tenantId]
      );
      const tenantName = tenantRows[0]?.name || "This practice";

      return [{
        subjectTenantId: tenantId,
        title: `${tenantName}'s card is failing`,
        why: `Stripe marked their subscription past due on ${new Date(sub.updated_at).toLocaleDateString()}. They're still using it normally and probably don't know.`,
        actions: [{
          label: "Get in touch",
          href: `/platform/tenants/${tenantId}`,
        }],
      }];
    },
  },

  {
    key: "trial_idle",
    priority: 2,
    compute: async (db, tenantId) => {
      // Check if status = 'trialing' and no activity in last 4 days
      const { rows: subRows } = await db.query(
        `SELECT id, status, trial_ends_at FROM keystone.mainstay_subscription LIMIT 1`
      );
      if (subRows.length === 0) return [];
      const sub = subRows[0];
      if (sub.status !== "trialing") return [];

      // Check for activity in the last 4 days
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      const { rows: bookingRows } = await db.query(
        `SELECT id FROM keystone.booking WHERE created_at >= $1 LIMIT 1`,
        [fourDaysAgo]
      );
      if (bookingRows.length > 0) return []; // Has bookings

      const { rows: appUserRows } = await db.query(
        `SELECT id FROM keystone.app_user WHERE role != 'staff' AND created_at >= $1 LIMIT 1`,
        [fourDaysAgo]
      );
      if (appUserRows.length > 0) return []; // Has non-staff users added

      const { rows: paymentRows } = await db.query(
        `SELECT id FROM keystone.payment_effective WHERE created_at >= $1 LIMIT 1`,
        [fourDaysAgo]
      );
      if (paymentRows.length > 0) return []; // Has payments

      // Compute the service count
      const { rows: serviceRows } = await db.query(
        `SELECT COUNT(*) as count FROM keystone.service`
      );
      const serviceCount = parseInt(serviceRows[0]?.count || 0);

      // Get the practice name
      const { rows: tenantRows } = await db.query(
        `SELECT name FROM keystone.tenant WHERE id = $1`,
        [tenantId]
      );
      const tenantName = tenantRows[0]?.name || "This practice";
      const createdDate = new Date(sub.created_at).toLocaleDateString();
      const trialEndDate = new Date(sub.trial_ends_at).toLocaleDateString("en-US", { weekday: "long" });

      return [{
        subjectTenantId: tenantId,
        title: `${tenantName} has done nothing in 4 days`,
        why: `signed up ${createdDate}, added ${serviceCount} service(s), hasn't imported anyone or taken a payment. Trial ends ${trialEndDate}.`,
        actions: [{
          label: "See what they're stuck on",
          href: `/platform/tenants/${tenantId}`,
        }],
      }];
    },
  },
]);

const PLATFORM_CEILING = 3;

/**
 * `computePlatformPrompts(db, { operatorGrantId }) → { prompts, total }`
 * Compute all candidate prompts across all tenants, filter by dismissals, sort by priority,
 * and return the first 3.
 */
export async function computePlatformPrompts(db, { operatorGrantId }) {
  if (typeof operatorGrantId !== "string") {
    throw invalid("operatorGrantId must be a string");
  }

  // ── step 1: collect all candidates across all tenants ───────────────────────────────────────
  let candidates = [];
  const { rows: tenantRows } = await db.query(
    `SELECT * FROM keystone.platform_list_tenants()`
  );

  for (const tenant of tenantRows) {
    for (const promptEntry of PLATFORM_PROMPTS) {
      const promptCandidates = await withTenant(tenant.id, async (tx) => {
        return await promptEntry.compute(tx, tenant.id);
      });

      // Each candidate from the compute function already has subjectTenantId set
      for (const candidate of promptCandidates) {
        candidates.push({
          key: promptEntry.key,
          priority: promptEntry.priority,
          subjectTenantId: candidate.subjectTenantId,
          title: candidate.title,
          why: candidate.why,
          actions: candidate.actions,
        });
      }
    }
  }

  // ── step 2: filter out dismissed prompts ────────────────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { rows: dismissals } = await db.query(
    `SELECT prompt_key, subject_tenant_id
       FROM keystone.platform_list_prompt_dismissals($1, $2)`,
    [operatorGrantId, sevenDaysAgo]
  );

  const isDismissed = (candidate) => {
    return dismissals.some(
      (d) =>
        d.prompt_key === candidate.key &&
        d.subject_tenant_id === candidate.subjectTenantId
    );
  };

  candidates = candidates.filter((c) => !isDismissed(c));

  // ── step 3: sort by priority, then cap for platform ───────────────────────────────────────────
  candidates.sort((a, b) => a.priority - b.priority);
  const total = candidates.length;
  const limited = candidates.slice(0, PLATFORM_CEILING);

  const prompts = limited.map((c) => ({
    key: c.key,
    subjectTenantId: c.subjectTenantId,
    title: c.title,
    why: c.why,
    actions: c.actions,
  }));

  return { prompts, total };
}
