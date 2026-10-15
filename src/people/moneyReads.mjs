// @ts-check
// P3.S16 — A PERSON'S CREDIT LEDGER, SAVED CARDS, TAX IDS (READS).
//
// ★★★ Stripe is the money record (GROUP-C-RECLUSTERED.md ruling) — these three tables MIRROR
//     Stripe/the ledger; nothing here calls out, and nothing here computes a balance. Each function
//     is a plain read, scoped to `tenantId` (forced RLS besides) and to the one person's rows.
//
// ★ The finer `person.view` permission check (which staff may see THIS person's money records)
//   happens in the route (`src/routes/peopleRecord.mjs`, via `assertMay`), not here — same split
//   the section's other routes use: a coarse floor and a finer per-row check live one level up,
//   these functions only ever run once that check has already passed.

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * Up to the newest 100 credit-ledger entries for this person, newest first.
 * (Keyset pagination on `created_at` for more than 100 is not built by this task.)
 */
export async function personCreditLedger(tx, { tenantId, personId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.customer_credit_entry")
    .select(["id", "amount_minor", "type", "note", "created_at"])
    .where("tenant_id", "=", tenantId)
    .where("subject_type", "=", "person")
    .where("subject_id", "=", personId)
    .orderBy("created_at", "desc")
    .limit(100));
  return rows.map((row) => ({
    id: row.id,
    amountMinor: row.amount_minor,
    type: row.type,
    note: row.note,
    createdAt: row.created_at,
  }));
}

/** This person's saved payment methods that have not been detached. */
/**
 * ★★★ specs/STRIPE-MIRROR.md §4 stage (d) — STRIPE IS THE TRUTH FOR SAVED CARDS TOO. Reads the
 *     person's own `stripe_customer_id` off `keystone.app_user`, then the mirror's own
 *     `stripe.payment_methods` for that customer, with `stripe.customers.invoice_settings
 *     ->>'default_payment_method'` deciding `isDefault` — Stripe's own real answer, not a column
 *     the platform maintains separately. Falls back to `keystone.payment_method` (the platform's own,
 *     older mirror) when there is no `stripe_customer_id`, or the mirror has no rows for that
 *     customer yet (not backfilled, or a card attached before the webhook/backfill existed) — the
 *     same EXPAND-not-CONTRACT shape §3.3 names for every other repoint in this stage.
 * ★ [MEASURED, 2 Oct 2026] found and fixed by this exact repoint: Example Owner' own Discover
 *   card (stripe_id_EXAMPLE, real on Stripe) had NO row at all in
 *   `keystone.payment_method` — the old read path would have shown "no card on file" for a
 *   person who has one. Not a regression; the old table was simply never backfilled for him.
 */
export async function personPaymentMethods(tx, { tenantId, personId }) {
  const { rows: personRows } = await tx.query(
    `SELECT stripe_customer_id FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`,
    [tenantId, personId]);
  const stripeCustomerId = personRows[0]?.stripe_customer_id ?? null;

  if (stripeCustomerId) {
    const { rows: mirrorRows } = await tx.query(
      `SELECT pm.id, pm.type, pm.card->>'brand' AS brand, pm.card->>'last4' AS last_four,
              (pm.card->>'exp_month')::int AS exp_month, (pm.card->>'exp_year')::int AS exp_year,
              pm.is_default
         FROM keystone.mirror_payment_method pm
        WHERE pm.customer = $1`,
      [stripeCustomerId]);
    if (mirrorRows.length > 0) {
      return mirrorRows.map((row) => ({
        id: row.id,
        kind: row.type,
        brand: row.brand,
        lastFour: row.last_four,
        expMonth: row.exp_month,
        expYear: row.exp_year,
        isDefault: row.is_default,
      }));
    }
  }

  const { rows } = await run(tx, db
    .selectFrom("keystone.payment_method")
    .select(["id", "kind", "brand", "last_four", "exp_month", "exp_year", "is_default"])
    .where("tenant_id", "=", tenantId)
    .where("app_user_id", "=", personId)
    .where("detached_at", "is", null));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    brand: row.brand,
    lastFour: row.last_four,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    isDefault: row.is_default,
  }));
}

/** This person's tax IDs. */
export async function personTaxIds(tx, { tenantId, personId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.tax_id")
    .select(["id", "type", "value", "verification_state"])
    .where("tenant_id", "=", tenantId)
    .where("subject_type", "=", "person")
    .where("subject_id", "=", personId));
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    value: row.value,
    verificationState: row.verification_state,
  }));
}
