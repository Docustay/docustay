// THE ONE "A STRIPE INVOICE WAS PAID → GRANT ITS CREDITS" REACTION (QUEUE §12.3, specs/CREDITS-PIPELINE.md §3.1).
//
// ★★★ WHY THIS EXISTS. [MEASURED 2 Oct 2026] The only grant path was an outbox listener on events emitted from `keystone.payment`
//     inserts. A payment seen only through the Stripe mirror (the maintainer's paid Test Package, 2026-0011) emitted nothing, so it granted
//     nothing — and the nightly reconcile only heals the mirror. Stripe is the money record; "Stripe says this invoice is paid" is the
//     only fact a grant should wait for, whichever door told us.
//
// ★★ ONE FUNCTION, THREE DOORS: the Stripe webhook (inline, errors NOT swallowed), the mirror (after a verified event), and the nightly
//    catch-up (every Stripe-paid invoice of a known person that has package/plan lines and no `credit_grant` row). They all call
//    `grantInvoiceCredits`; running it twice does nothing the second time.
// ★★★ THE IDEMPOTENCY IS A ROW, NOT A JOB KEY: `keystone.credit_grant (tenant, stripe_invoice_id, line_item_id)` PRIMARY KEY, inserted in
//    the SAME transaction as the entitlements. (A Graphile job key only collapses a burst of triggers.) Partial payments, redeliveries,
//    a webhook racing the catch-up: the second caller conflicts on the row and grants nothing.
// ★ Paid means STRIPE says paid (keystone.mirror_invoice.status), never the platform's cached invoice.status.
// ★ Credits belong to the PAYER (`owner_user_id`, the money) and are FOR `beneficiary_user_id` when the line names exactly one person
//   (`line_item.for_user_ids`); otherwise the payer's family may spend them (keystone.credit_payers_for). One "package purchased"
//   event per PURCHASE, not per service.
import { emit, userActor } from "../events/outbox.mjs";
import { createEntitlement } from "./writes.mjs";
import { spendableCredits } from "./credits.mjs";
import { resolvePeriodGrant } from "../items/writes.mjs";
import { asPracticeOwner } from "./asPracticeOwner.mjs";

const SECTION = "money";

/**
 * @param {object} tx a tenant transaction already running as the practice Owner (asPracticeOwner) — invoice rows are viewer-gated
 * @returns {Promise<{status: "no_invoice"|"not_paid"|"nothing_to_grant"|"granted"|"already_granted", entitlementIds: string[], lines: object[]}>}
 */
export async function grantInvoiceCredits(tx, { tenantId, stripeInvoiceId, actorUserId = null }) {
  if (!tenantId || !stripeInvoiceId) throw new Error("grantInvoiceCredits needs tenantId and stripeInvoiceId");

  let { rows: [inv] } = await tx.query(
    `SELECT id, payer_user_id, status, period_end FROM keystone.invoice WHERE tenant_id = $1 AND stripe_invoice_id = $2`,
    [tenantId, stripeInvoiceId]);
  // ★ A Stripe-GENERATED renewal invoice has no the platform invoice row at all (defect 5): it belongs to a subscription the platform knows. Its one
  //   "line" is the plan, with a deterministic ledger id so the same renewal can only ever grant once.
  let renewal = null;
  if (!inv) {
    const { rows: [sub] } = await tx.query(
      `SELECT ks.plan_id, ks.app_user_id, to_timestamp(si.period_end) AS period_end
         FROM keystone.mirror_invoice si JOIN keystone.subscription ks ON ks.stripe_subscription_id = si.subscription AND ks.tenant_id = $2
        WHERE si.id = $1`, [stripeInvoiceId, tenantId]);
    if (!sub) return { status: "no_invoice", entitlementIds: [], lines: [] };
    renewal = sub;
    inv = { id: null, payer_user_id: sub.app_user_id, status: "open", period_end: sub.period_end };
  }

  // PAID = Stripe says so. The mirror row wins; with no mirror row (a tenant without the mirror) fall back to the platform's own.
  const { rows: [mirror] } = await tx.query(
    `SELECT status::text AS status, (status_transitions->>'paid_at')::bigint AS paid_at FROM keystone.mirror_invoice WHERE id = $1`, [stripeInvoiceId]);
  const paid = mirror ? mirror.status === "paid" : inv.status === "paid";
  if (!paid) return { status: "not_paid", entitlementIds: [], lines: [] };
  const paidAt = mirror?.paid_at ? new Date(Number(mirror.paid_at) * 1000) : new Date();

  const { rows: lineItems } = renewal ? { rows: [{ id: (await tx.query(`SELECT md5($1)::uuid AS id`, [`renewal:${stripeInvoiceId}`])).rows[0].id,
      package_id: null, plan_id: renewal.plan_id, quantity: 1, for_user_ids: null, pseudo: true }] } : await tx.query(
    `SELECT id, package_id, plan_id, quantity, for_user_ids
       FROM keystone.line_item
      WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'active' AND (package_id IS NOT NULL OR plan_id IS NOT NULL)
      ORDER BY position NULLS LAST, created_at, id`, [tenantId, inv.id]);
  if (lineItems.length === 0) return { status: "nothing_to_grant", entitlementIds: [], lines: [] };

  const entitlementIds = [];
  const lines = [];
  let alreadyAll = true;
  for (const li of lineItems) {
    // THE LEDGER ROW FIRST. A conflict means another caller (or an earlier run) already owns this line.
    const claimed = await tx.query(
      `INSERT INTO keystone.credit_grant (tenant_id, stripe_invoice_id, line_item_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING RETURNING 1`, [tenantId, stripeInvoiceId, li.id]);
    if (claimed.rowCount === 0) continue;
    alreadyAll = false;

    const forIds = Array.isArray(li.for_user_ids) ? li.for_user_ids : [];
    const beneficiaryUserId = forIds.length === 1 ? forIds[0] : null;
    const sourceId = `${stripeInvoiceId}:${li.id}`;
    const granted = [];

    if (li.package_id) {
      const { rows: pk } = await tx.query(`SELECT expiry_months FROM keystone.package WHERE tenant_id = $1 AND id = $2`, [tenantId, li.package_id]);
      const months = pk[0]?.expiry_months ?? null;
      const expiresAt = months === null ? null : new Date(new Date(paidAt).setMonth(paidAt.getMonth() + months));
      const { rows: pls } = await tx.query(
        `SELECT service_id, quantity FROM keystone.package_line WHERE tenant_id = $1 AND package_id = $2 ORDER BY service_id`, [tenantId, li.package_id]);
      // ★ the package's lines AS THEY ARE NOW are what this purchase gets — and the snapshot is kept on the ledger row (defect 22)
      for (const pl of pls) {
        // one entitlement per (service, purchase-line): same service in two lines of one package would collide on the unique key
        const e = await createEntitlement(tx, {
          tenantId, ownerUserId: inv.payer_user_id, serviceId: pl.service_id, totalCredits: pl.quantity * (li.quantity ?? 1),
          lineItemId: li.id, expiresAt, packageId: li.package_id, beneficiaryUserId, grantSource: "invoice", grantSourceId: `${sourceId}:${pl.service_id}`,
          silent: true, actorUserId,
        });
        granted.push({ entitlementId: e.id, serviceId: pl.service_id, credits: e.total_credits });
      }
    } else if (li.plan_id) {
      const { rows: pls } = await tx.query(
        `SELECT pl.service_id, pl.quantity_per_cycle, p.rollover_mode, p.rollover_cap
           FROM keystone.plan_line pl JOIN keystone.plan p ON p.id = pl.plan_id AND p.tenant_id = pl.tenant_id
          WHERE pl.tenant_id = $1 AND pl.plan_id = $2`, [tenantId, li.plan_id]);
      for (const pl of pls) {
        if (pl.quantity_per_cycle === null) continue;                          // unlimited — nothing to grant
        const carryover = await spendableCredits(tx, { tenantId, ownerUserId: inv.payer_user_id, serviceId: pl.service_id });
        const { grantCount, expiresAt } = resolvePeriodGrant({
          sessionsIncluded: pl.quantity_per_cycle, rolloverMode: pl.rollover_mode, rolloverCap: pl.rollover_cap,
          carryoverAvailable: carryover, periodEnd: inv.period_end ? new Date(inv.period_end).toISOString() : null,
        });
        if (grantCount <= 0) continue;
        const e = await createEntitlement(tx, {
          tenantId, ownerUserId: inv.payer_user_id, serviceId: pl.service_id, totalCredits: grantCount, lineItemId: li.pseudo ? null : li.id,
          expiresAt, beneficiaryUserId, grantSource: "invoice", grantSourceId: `${sourceId}:${pl.service_id}`, silent: true, actorUserId,
        });
        granted.push({ entitlementId: e.id, serviceId: pl.service_id, credits: e.total_credits });
      }
    }

    await tx.query(
      `UPDATE keystone.credit_grant SET state = $4, entitlement_ids = $5::uuid[], detail = $6::jsonb
        WHERE tenant_id = $1 AND stripe_invoice_id = $2 AND line_item_id = $3`,
      [tenantId, stripeInvoiceId, li.id, granted.length ? "granted" : "nothing_to_grant", granted.map((g) => g.entitlementId),
       JSON.stringify({ package_id: li.package_id, plan_id: li.plan_id, quantity: li.quantity, lines: granted })]);
    entitlementIds.push(...granted.map((g) => g.entitlementId));
    lines.push({ lineItemId: li.id, pseudo: Boolean(li.pseudo), granted });
  }

  if (entitlementIds.length > 0) {
    const total = lines.flatMap((l) => l.granted).reduce((n, g) => n + g.credits, 0);
    // ONE event for the whole purchase → one "package purchased" email (defect 23), not one per service
    await emit(tx, {
      tenantId, topic: "money.entitlement.granted", emittedBy: SECTION,
      subjectType: "entitlement", subjectId: entitlementIds[0], actor: userActor(actorUserId),
      payload: { owner_user_id: inv.payer_user_id, service_id: lines[0].granted[0].serviceId, total_credits: total, credits_written: total,
                 expires_at: null, line_item_id: lines[0].pseudo ? null : lines[0].lineItemId, stripe_invoice_id: stripeInvoiceId, entitlement_count: entitlementIds.length },
    });
  }
  return { status: entitlementIds.length ? "granted" : alreadyAll ? "already_granted" : "nothing_to_grant", entitlementIds, lines };
}

/**
 * The catch-up: every Stripe-PAID invoice of this practice that has package/plan lines and no ledger row yet.
 * Read-mostly; the grant itself is `grantInvoiceCredits`. Returns what it found so the caller can alert.
 */
export async function findPaidInvoicesWithoutCredits(tx, { tenantId, limit = 200 }) {
  const { rows } = await tx.query(
    `SELECT DISTINCT i.stripe_invoice_id
       FROM keystone.invoice i
       JOIN keystone.line_item li ON li.invoice_id = i.id AND li.tenant_id = i.tenant_id AND li.status = 'active'
                                AND (li.package_id IS NOT NULL OR li.plan_id IS NOT NULL)
       LEFT JOIN keystone.mirror_invoice si ON si.id = i.stripe_invoice_id
      WHERE i.tenant_id = $1 AND i.stripe_invoice_id IS NOT NULL
        AND ((si.id IS NOT NULL AND si.status::text = 'paid') OR (si.id IS NULL AND i.status = 'paid'))
        AND NOT EXISTS (SELECT 1 FROM keystone.credit_grant g
                         WHERE g.tenant_id = i.tenant_id AND g.stripe_invoice_id = i.stripe_invoice_id AND g.line_item_id = li.id)
      LIMIT $2`, [tenantId, limit]);
  return rows.map((r) => r.stripe_invoice_id);
}

/**
 * ★★★ credits defect 16 — A PACKAGE THAT WAS REFUNDED IN FULL: its UNUSED credits are VOIDED and the entitlement is marked `refunded`.
 *   Used sessions are not clawed back (they happened); a credit still RESERVED for a future session is left alone (that booking is a
 *   commitment — staff cancel it, and the cancel returns the credit to a voided-nothing). Idempotent: nothing unused → nothing changes.
 * Two doors call it: `executeRefund` (a refund issued from the platform) and the Stripe `charge.refunded` webhook (a refund issued in Stripe).
 * @returns {Promise<{voided: number, entitlementIds: string[]}>}
 */
async function voidCreditsForRefundedInvoice(tx, { tenantId, stripeInvoiceId, actorUserId = null }) {
  if (!stripeInvoiceId) return { voided: 0, entitlementIds: [] };
  await tx.query(`SELECT set_config('keystone.credit_reason', 'the package was refunded', true)`);
  const { rows: ents } = await tx.query(
    `SELECT id FROM keystone.entitlement
      WHERE tenant_id = $1 AND grant_source = 'invoice' AND split_part(grant_source_id, ':', 1) = $2 AND status <> 'refunded' FOR UPDATE`,
    [tenantId, stripeInvoiceId]);
  if (ents.length === 0) return { voided: 0, entitlementIds: [] };
  const ids = ents.map((e) => e.id);
  const { rowCount } = await tx.query(
    `UPDATE keystone.entitlement_credit SET status = 'voided'
      WHERE tenant_id = $1 AND entitlement_id = ANY($2) AND status IN ('available', 'returned', 'pending')`, [tenantId, ids]);
  await tx.query(
    `UPDATE keystone.entitlement e SET status = 'refunded'
      WHERE e.tenant_id = $1 AND e.id = ANY($2)
        AND NOT EXISTS (SELECT 1 FROM keystone.entitlement_credit c WHERE c.entitlement_id = e.id AND c.status = 'reserved')`, [tenantId, ids]);
  await emit(tx, {
    tenantId, topic: "money.entitlement.voided", emittedBy: SECTION, subjectType: "entitlement", subjectId: ids[0], actor: userActor(actorUserId),
    payload: { stripe_invoice_id: stripeInvoiceId, credits_voided: rowCount, entitlement_count: ids.length },
  });
  return { voided: rowCount, entitlementIds: ids };
}

/**
 * The refund → credits bridge both doors use: find the payment's Stripe invoice and, when the charge is refunded IN FULL, void the package.
 * A partial refund changes nothing (money back for part of it ≠ the package is gone).
 */
export async function voidCreditsForRefundedCharge(tx, { tenantId, stripeChargeId = null, paymentId = null, refundedMinor, totalMinor, actorUserId = null }) {
  if (!(refundedMinor >= totalMinor && totalMinor > 0)) return { voided: 0, entitlementIds: [] };
  // ★ The Stripe invoice behind this refund, by the most reliable door first: the mirror's own charge row (Stripe says which invoice it paid),
  //   then the platform's payment row (viewer-gated → read as the practice Owner) — three ways, because a payment recorded from an `invoice.paid`
  //   webhook has NO invoice_id and no stripe_charge_id; its provider_payment_id is the Stripe invoice id (found in the sandbox browser test).
  let stripeInvoiceId = null;
  if (stripeChargeId) {
    // (Stripe's current API links a charge to its invoice through the INVOICE PAYMENT — charge → payment_intent → invoice_payments.invoice;
    //  `charges.invoice` is null — found in the sandbox browser test)
    const { rows: ch } = await tx.query(
      `SELECT COALESCE(ch.invoice, ip.invoice) AS invoice FROM keystone.mirror_charge ch
         LEFT JOIN keystone.mirror_invoice_payment ip ON ip.payment->>'payment_intent' = ch.payment_intent
        WHERE ch.id = $1 LIMIT 1`, [stripeChargeId]).catch(() => ({ rows: [] }));
    stripeInvoiceId = ch[0]?.invoice ?? null;
  }
  if (!stripeInvoiceId) {
    const { rows } = await asPracticeOwner(tx, tenantId, () => tx.query(
      `SELECT COALESCE(i.stripe_invoice_id,
                       CASE WHEN p.provider_payment_id LIKE 'in\\_%' THEN p.provider_payment_id END,
                       (SELECT ch.invoice FROM keystone.mirror_charge ch WHERE ch.id = p.stripe_charge_id)) AS stripe_invoice_id
         FROM keystone.payment p LEFT JOIN keystone.invoice i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND (p.id = $2 OR p.stripe_charge_id = $3) LIMIT 1`, [tenantId, paymentId, stripeChargeId]));
    stripeInvoiceId = rows[0]?.stripe_invoice_id ?? null;
  }
  return voidCreditsForRefundedInvoice(tx, { tenantId, stripeInvoiceId, actorUserId });
}

/**
 * The refund half of the nightly catch-up: Stripe invoices REFUNDED IN FULL (the mirror: every charge that paid them is fully refunded) whose
 * package credits are still live — a refund made while the webhook could not reach the platform, or before it could. Idempotent through
 * `voidCreditsForRefundedInvoice`. Returns the invoice ids it voided credits for.
 */
export async function voidCreditsForFullyRefundedInvoices(tx, { tenantId, limit = 200 }) {
  const { rows } = await tx.query(
    `SELECT DISTINCT split_part(e.grant_source_id, ':', 1) AS stripe_invoice_id
       FROM keystone.entitlement e
      WHERE e.tenant_id = $1 AND e.grant_source = 'invoice' AND e.status <> 'refunded'
        AND EXISTS (SELECT 1 FROM keystone.entitlement_credit c WHERE c.entitlement_id = e.id AND c.status IN ('available','returned','pending'))
        AND EXISTS (
          SELECT 1 FROM keystone.mirror_invoice_payment ip
            JOIN keystone.mirror_charge ch ON ch.payment_intent = ip.payment->>'payment_intent'
           WHERE ip.invoice = split_part(e.grant_source_id, ':', 1)
          HAVING count(*) > 0 AND bool_and(ch.amount_refunded >= ch.amount AND ch.amount > 0))
      LIMIT $2`, [tenantId, limit]);
  const done = [];
  for (const r of rows) {
    const out = await voidCreditsForRefundedInvoice(tx, { tenantId, stripeInvoiceId: r.stripe_invoice_id });
    if (out.voided > 0 || out.entitlementIds.length > 0) done.push(r.stripe_invoice_id);
  }
  return done;
}
