// src/booking/facts.mjs — THE ONE DOOR documents (or anything else) uses to read a booking/invoice/
// subscription fact for a MERGE FIELD. Not a general booking API — narrowly, exactly what
// documents/variables.mjs needs, so this file's own shape stays small and its own contract stays
// legible (the same posture documents/api.mjs asks of everyone reading ITS tables).
import { db, run } from "../db/kysely.mjs";

/** relocated verbatim from documents/variables.mjs:156-170 */
export async function bookingFactsFor(tx, { tenantId, bookingId, timeZone }) {
  const { rows: [booking] } = await tx.query(
    `SELECT b.id, b.starts_at, b.host_id, s.name AS service_name, s.name AS service,
            h.first_name AS "coachFirstName", b.location_detail AS location,
            to_char(b.starts_at AT TIME ZONE $1, 'FMMM DD, YYYY') AS date,
            to_char(b.starts_at AT TIME ZONE $1, 'FMHH12:MI AM') || ' ' || $1 AS time
       FROM keystone.booking b
       LEFT JOIN keystone.service s ON s.id = b.service_id
       LEFT JOIN keystone.app_user h ON h.id = b.host_id
       WHERE b.id = $2 AND b.tenant_id = $3`,
    [timeZone || 'UTC', bookingId, tenantId]);
  return booking ?? null;
}

/** relocated verbatim from documents/variables.mjs:173-181.
 *  ★ STRIPE-MIRROR REPOINT (2 Oct 2026): amount/balance/link/number come from `invoice_effective` (Stripe's
 *  figures); subtotal_minor and due_at are the platform's own, read via LEFT JOIN so a Stripe-only invoice still resolves. */
export async function invoiceFactsFor(tx, { tenantId, invoiceId, timeZone }) {
  const { rows: [invoice] } = await tx.query(
    `SELECT ie.id, ie.invoice_number, i.subtotal_minor, i.due_at, ie.amount_minor AS amount,
            ie.hosted_invoice_url AS link, ie.amount_remaining_minor AS balance,
            to_char(i.due_at AT TIME ZONE $1, 'FMMM DD, YYYY') AS "dueDate"
       FROM keystone.invoice_effective ie
       LEFT JOIN keystone.invoice i ON i.id = ie.id
      WHERE ie.id = $2 AND ie.tenant_id = $3`,
    [timeZone || 'UTC', invoiceId, tenantId]);
  return invoice ?? null;
}

/** relocated verbatim from documents/variables.mjs:186-196.
 *  ★ STRIPE-MIRROR REPOINT (2 Oct 2026): state/price/renewal date from `subscription_effective` (its
 *  snapshot_amount_minor already folds in the platform's price override for the platform-only rows and is Stripe's own
 *  unit amount for mirrored ones). plan name is the platform's own (NULL for a Stripe-only subscription). */
export async function subscriptionFactsFor(tx, { tenantId, subjectId, timeZone }) {
  const { rows: [subscription] } = await tx.query(
    `SELECT p.name AS plan, s.snapshot_amount_minor AS price,
            to_char(s.current_period_end AT TIME ZONE $1, 'FMMM DD, YYYY') AS renews_on
       FROM keystone.subscription_effective s
       LEFT JOIN keystone.plan p ON p.id = s.plan_id
      WHERE s.tenant_id = $2 AND s.app_user_id = $3 AND s.state IN ('active', 'past_due', 'paused')
      ORDER BY s.created_at DESC LIMIT 1`,
    [timeZone || 'UTC', tenantId, subjectId]);
  return subscription ?? null;
}
