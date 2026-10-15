// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CAPABILITIES — TIER-GATED FEATURE REGISTRY AND RESOLUTION.
//
// ★★★ FROZEN CAPABILITY REGISTRY. A capability key not in CAPABILITIES throws — the exact same
//     idiom as flagIsOn() (src/platform/flags.mjs). A typo reading as "off" is a silent defect;
//     an unknown key raises loudly.
//
// ★ RESOLUTION ORDER (ABSOLUTE):
//   (1) Read tenant's `tenant_site_tier.site_tier_id`
//   (2) If no row, use the DEFAULT tier (lowest display_order from site_tier)
//   (3) Read `tier_capability.allowed` for (tier, capability_key)
//   (4) Check `feature_flag_practice.on` override — it WINS in either direction
//   (5) Return the resolved boolean
//
// ★ NO CACHE, NO GUC. tenantHasCapability reads inside the CALLER'S transaction, every time,
//   so a tier change or a feature flag flip takes effect immediately. A cache here would be the
//   "who supplies the condition" defect — same as flagIsOn, same as every guard in Keystone.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { assertTenantTx } from "../db/index.mjs";
import { internal } from "../http/errors.mjs";

// ★ THE FROZEN CAPABILITY REGISTRY — ~20 keys from F17 §4. A key not in this list throws.
export const CAPABILITIES = Object.freeze([
  "growth.campaigns",
  "growth.templates",
  "growth.sequences",
  "growth.sms",
  "growth.landing_pages",
  "growth.forms",
  "growth.lead_scoring",
  "run.presence",
  "run.signals",
  "run.reviews",
  "run.listings",
  "run.ads",
  "run.calls",
  "run.competitors",
  "run.ai_visibility",
]);

function assertNonBlankString(value, name, who) {
  if (typeof value !== "string" || value.trim() === "") {
    throw internal(`${who}: ${name} must be a non-blank string (got ${JSON.stringify(value)})`);
  }
}

/**
 * ★★★ Does tenant `tenantId` have capability `key`?
 *
 * Resolution order:
 * 1. Tenant's tier from tenant_site_tier (or DEFAULT if no row)
 * 2. Tier's tier_capability.allowed
 * 3. Tenant's feature_flag_practice override (wins either way)
 * 4. Return boolean
 *
 * ★★★ AN UNKNOWN CAPABILITY KEY RAISES — never reads as `false`. The error names the key.
 *
 * @param tx        a tenant transaction — the handle `withTenant()` passes to its callback.
 * @param tenantId  the practice/tenant to resolve for.
 * @param key       the capability key, e.g. "growth.campaigns".
 * @returns {Promise<boolean>}
 */
export async function tenantHasCapability(tx, tenantId, key) {
  assertTenantTx(tx, "tenantHasCapability()");
  assertNonBlankString(tenantId, "tenantId", "tenantHasCapability");
  assertNonBlankString(key, "key", "tenantHasCapability");

  // ★ Check registry — throw if key is unknown
  if (!CAPABILITIES.includes(key)) {
    throw internal(`tenantHasCapability: "${key}" is not a known capability — add it to CAPABILITIES first`);
  }

  // ★ Resolve tenant's tier. If no row, use DEFAULT (lowest display_order).
  const { rows: tierRows } = await tx.query(
    `SELECT tst.site_tier_id
       FROM keystone.tenant_site_tier tst
      WHERE tst.tenant_id = $1`,
    [tenantId]);

  let tierId;
  if (tierRows.length > 0) {
    tierId = tierRows[0].site_tier_id;
  } else {
    // ★ No tier assignment — use DEFAULT tier (lowest display_order)
    const { rows: defaultTierRows } = await tx.query(
      `SELECT id FROM keystone.site_tier
        ORDER BY display_order ASC
        LIMIT 1`);
    if (defaultTierRows.length === 0) {
      throw internal("tenantHasCapability: no site_tier rows exist — cannot resolve default tier");
    }
    tierId = defaultTierRows[0].id;
  }

  // ★ Read tier's capability allowed status
  const { rows: tierCapRows } = await tx.query(
    `SELECT allowed FROM keystone.tier_capability
      WHERE tier_id = $1 AND capability_key = $2`,
    [tierId, key]);

  const tierAllows = tierCapRows.length > 0 ? tierCapRows[0].allowed === true : false;

  // ★ Check feature_flag_practice override — wins in either direction
  const { rows: flagRows } = await tx.query(
    `SELECT "on" FROM keystone.feature_flag_practice
      WHERE flag_key = $1 AND tenant_id = $2`,
    [key, tenantId]);

  if (flagRows.length > 0) {
    return flagRows[0].on === true;
  }

  // ★ No override — return tier decision
  return tierAllows;
}
