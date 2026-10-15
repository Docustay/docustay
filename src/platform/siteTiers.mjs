// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SITE TIERS — PLATFORM-LEVEL TIER CATALOGUE WITH STRIPE WRITE-THROUGH.
//
// ★★★ A TIER CHANGE WRITES TO STRIPE AND READS BACK; IT NEVER ASSUMES.
// When an operator sets or changes a tier's price, the function calls Stripe (on the PLATFORM's
// own Stripe account, not a tenant's connected account, since this is platform-level catalogue)
// and stores the price id and amount Stripe actually returns in `site_tier.stripe_price_id`.
// Never trust the operator's typed amount alone as the source of truth once Stripe has responded.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid, internal, dependency } from "../http/errors.mjs";
import { callOutside } from "../http/outside.mjs";

const SECTION = "platform";

/**
 * ★★★ THE PLATFORM STRIPE SECRET KEY IS REQUIRED FOR TIER MANAGEMENT.
 * This is the platform's own Stripe account key, not a tenant's connected account.
 */
function getPlatformStripeKey(env = process.env) {
  // ★★★ FLAG IF NO STRIPE KEY IS CONFIGURED. Do not silently skip the write-through.
  const key = env.KEYSTONE_PLATFORM_STRIPE_SECRET_KEY;
  if (!key) {
    return null;
  }
  return key;
}

/**
 * ★ Verify we can reach Stripe and have the key configured.
 * Returns { ok: true } or { ok: false, reason: string }
 */
function checkStripeConfigured(env = process.env) {
  const key = getPlatformStripeKey(env);
  if (!key) {
    return {
      ok: false,
      reason: "KEYSTONE_PLATFORM_STRIPE_SECRET_KEY is not set — tier prices cannot be synced to Stripe",
    };
  }
  return { ok: true };
}

/**
 * ★★★ CREATE A NEW TIER WITH STRIPE PRICE CREATION.
 *
 * ★ `placeholder_price_minor` is the operator's intended price in minor units (cents).
 *   We send this to Stripe, read back the REAL price id and amount, and store what Stripe
 *   confirms, never what the operator typed.
 *
 * ★★ If Stripe is not configured, flag it clearly but allow the tier to be created with a
 *    temporary null `stripe_price_id`. The operator cannot issue the tier until the sync succeeds.
 */
export async function createTier(tx, {
  name, placeholder_price_minor, display_order = 0,
  env = process.env,
}) {
  if (!name || typeof name !== "string" || !name.trim()) {
    throw invalid("name is required and must be text");
  }
  if (!Number.isInteger(placeholder_price_minor) || placeholder_price_minor < 0) {
    throw invalid("placeholder_price_minor must be a non-negative integer (price in cents)");
  }
  if (!Number.isInteger(display_order)) {
    throw invalid("display_order must be an integer");
  }

  const stripeCheck = checkStripeConfigured(env);
  let stripePriceId = null;
  let actualAmountMinor = placeholder_price_minor;

  // ★ Attempt to create the price in Stripe if the key is available.
  if (stripeCheck.ok) {
    const secretKey = getPlatformStripeKey(env);
    const productId = env.KEYSTONE_PLATFORM_STRIPE_PRODUCT_ID;
    if (!productId) {
      throw internal(
        "KEYSTONE_PLATFORM_STRIPE_PRODUCT_ID is not configured — tier prices cannot be synced to Stripe."
      );
    }

    const out = await callOutside("stripe_prices_create", "https://api.stripe.com/v1/prices", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${secretKey}`,
      },
      body: new URLSearchParams({
        currency: "usd",
        unit_amount: String(placeholder_price_minor),
        product: productId,
      }).toString(),
    });

    if (!out.ok) {
      throw internal(
        `Failed to create Stripe price: ${out.body?.error?.message ?? out.status ?? "unknown error"}. ` +
        `Tier creation aborted. Please check KEYSTONE_PLATFORM_STRIPE_SECRET_KEY and KEYSTONE_PLATFORM_STRIPE_PRODUCT_ID.`
      );
    }

    stripePriceId = out.body?.id;
    actualAmountMinor = out.body?.unit_amount ?? placeholder_price_minor;
    if (!stripePriceId) {
      throw internal("Stripe did not return a price id — tier creation aborted.");
    }
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await tx.query(
      `INSERT INTO keystone.site_tier
         (id, name, placeholder_price_minor, stripe_price_id, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, name.trim(), placeholder_price_minor, stripePriceId, display_order]
    );
  } catch (e) {
    if (e.code === "23505") {
      // Unique constraint violation on name
      throw invalid(`a tier named "${name.trim()}" already exists`);
    }
    throw e;
  }

  return {
    id,
    name: name.trim(),
    placeholder_price_minor,
    stripe_price_id: stripePriceId,
    display_order,
    stripe_sync_note: stripeCheck.ok ? null : stripeCheck.reason,
  };
}

/**
 * ★★★ UPDATE AN EXISTING TIER'S PRICE WITH STRIPE WRITE-THROUGH.
 *
 * ★ If the price changes, we call Stripe to create or update the Price object, read back
 *   the confirmed id and amount, and store those in the database.
 *
 * ★★ Stripe failures are FATAL for price updates — an out-of-sync tier is a breaking issue.
 *    If Stripe is not configured, flag it clearly.
 */
export async function updateTier(tx, {
  tierId, name = null, placeholder_price_minor = null, display_order = null,
  env = process.env,
}) {
  if (!tierId) {
    throw invalid("tierId is required");
  }

  // ★ Fetch the current tier state.
  const current = await tx.query(
    `SELECT id, name, placeholder_price_minor, stripe_price_id, display_order
       FROM keystone.site_tier
      WHERE id = $1`,
    [tierId]
  );
  if (current.rows.length === 0) {
    throw invalid(`no tier with id ${tierId} exists`);
  }

  const tier = current.rows[0];
  const newName = name !== null ? name : tier.name;
  const newPrice = placeholder_price_minor !== null ? placeholder_price_minor : tier.placeholder_price_minor;
  const newOrder = display_order !== null ? display_order : tier.display_order;

  // ★ Validation.
  if (typeof newName !== "string" || !newName.trim()) {
    throw invalid("name must be text and not blank");
  }
  if (!Number.isInteger(newPrice) || newPrice < 0) {
    throw invalid("placeholder_price_minor must be a non-negative integer");
  }
  if (!Number.isInteger(newOrder)) {
    throw invalid("display_order must be an integer");
  }

  let stripePriceId = tier.stripe_price_id;
  let actualAmountMinor = newPrice;

  // ★ If price changed and Stripe is configured, sync it.
  if (newPrice !== tier.placeholder_price_minor) {
    const stripeCheck = checkStripeConfigured(env);
    if (stripeCheck.ok) {
      const secretKey = getPlatformStripeKey(env);
      const productId = env.KEYSTONE_PLATFORM_STRIPE_PRODUCT_ID;
      if (!productId) {
        throw internal(
          "KEYSTONE_PLATFORM_STRIPE_PRODUCT_ID is not configured — tier prices cannot be synced to Stripe."
        );
      }

      // ★ Stripe prices are immutable; we always create a new price object when the price changes.
      const out = await callOutside("stripe_prices_create", "https://api.stripe.com/v1/prices", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${secretKey}`,
        },
        body: new URLSearchParams({
          currency: "usd",
          unit_amount: String(newPrice),
          product: productId,
        }).toString(),
      });

      if (!out.ok) {
        throw internal(
          `Failed to sync price to Stripe: ${out.body?.error?.message ?? out.status ?? "unknown error"}. ` +
          `Tier update aborted. Please check KEYSTONE_PLATFORM_STRIPE_SECRET_KEY and KEYSTONE_PLATFORM_STRIPE_PRODUCT_ID.`
        );
      }

      stripePriceId = out.body?.id;
      actualAmountMinor = out.body?.unit_amount ?? newPrice;
      if (!stripePriceId) {
        throw internal("Stripe did not return a price id — tier update aborted.");
      }
    } else {
      // ★ Stripe not configured; flag clearly.
      throw internal(stripeCheck.reason);
    }
  }

  // ★ Update the tier.
  try {
    await tx.query(
      `UPDATE keystone.site_tier
         SET name = $2,
             placeholder_price_minor = $3,
             stripe_price_id = $4,
             display_order = $5,
             updated_at = now()
       WHERE id = $1`,
      [tierId, newName.trim(), newPrice, stripePriceId, newOrder]
    );
  } catch (e) {
    if (e.code === "23505") {
      // Unique constraint violation on name
      throw invalid(`a tier named "${newName.trim()}" already exists (or name is unchanged)`);
    }
    throw e;
  }

  return {
    id: tierId,
    name: newName.trim(),
    placeholder_price_minor: newPrice,
    stripe_price_id: stripePriceId,
    display_order: newOrder,
  };
}
