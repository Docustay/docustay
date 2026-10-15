// Stage 20 Task 20.1 — Stripe Metadata Composition with Forbidden Field Checks
//
// Single module that composes all Stripe metadata, refusing the blocked list.
// No Stripe calls, no database, no imports. Pure metadata composition and validation.

export class MetadataForbidden extends Error {
  constructor(message) {
    super(message);
    this.name = "MetadataForbidden";
  }
}

export const FORBIDDEN_META_KEYS = [
  "dob",
  "sobriety_date",
  "recovery",
  "notes",
  "note",
  "emergency_contact",
  "consent_status_detail",
  "consent_detail",
  "guardian",
];

const KEY_SETS = {
  // ◆ 20.2 ruling (25 Sep 2026): `tenant_slug` is added because customers.mjs already ships it
  // today. This module's job is to be the ONE writer, not to silently drop a shipped field.
  // ◆ 20.2 ruling (25 Sep 2026): Restore customer fields that were being sent before the rewire.
  // One field from that set is deliberately omitted — consent information is on the blocked list
  // and never leaves the platform. All other fields are restored.
  // ◆ T1.19 (F785/F787): the ten keys customers.mjs builds — workbench_person_id, workbench_tenant_id,
  // consent_status added; existing keys stay (customer is now the ONE writer via metadataFor).
  // ◆ the maintainer, 29 Sep 2026: "tags" added — the four system tags (Adult/Adolescent/Parent/Lead),
  // comma-joined, computed by customers.mjs's buildCustomerPayload alongside the now-short
  // "adult"/"adolescent" `role` value ("parent" is no longer a role at all — see db migration
  // 0533 and src/nav/authorise.mjs).
  customer: ["person_id", "practice_id", "tenant_slug", "role", "tags", "portal_status", "workbench_env", "lifecycle_status", "assigned_coach_id", "account_id", "source", "created_in_workbench_at", "keystone_tenant_id", "workbench_person_id", "workbench_tenant_id", "consent_status"],
  payment_intent: ["person_id", "practice_id", "booking_id", "service_id", "coach_id",
    // ◆ 20.2 one-writer: bookingPayments.mjs sends keystone_booking_id
    "keystone_booking_id",
    // ◆ 20.2 one-writer: clientPayments.mjs sends keystone_tenant_id, keystone_payer_id, keystone_allocation_id
    "keystone_tenant_id", "keystone_payer_id", "keystone_allocation_id",
    // ◆ 20.2 one-writer: paymentLinks.mjs sends keystone_payment_link_id, keystone_tenant_id
    "keystone_payment_link_id",
    // ◆ 20.2 one-writer: tapToPay.mjs sends keystone_invoice_id, keystone_source
    "keystone_invoice_id", "keystone_source",
    // ◆ 20.2 one-writer: publicMoney.mjs sends keystone_gift_card_sale, keystone_gift_card_amount
    "keystone_gift_card_sale", "keystone_gift_card_amount",
    // ◆ 20.2 one-writer: app.mjs sends instanceId for checkout session payment_intent_data
    "instanceId",
    // ◆ Part 30 item 11: documentsPayments.mjs sends the signing party and field ids for a hosted Checkout Session — ids only, no names or amounts
    "docustay_party", "docustay_field",
    // ◆ T1.19 (F785/F787): every other kind gains workbench_tenant_id
    "workbench_tenant_id"],
  invoice: ["person_id", "practice_id", "invoice_id", "account_id",
    // ◆ 20.2 one-writer: paymentPlans.mjs sends keystone_plan_row_id
    "keystone_plan_row_id",
    // ◆ T1.19 (F785/F787): invoice gains keystone_invoice_id, workbench_tenant_id
    "keystone_invoice_id", "workbench_tenant_id"],
  // ◆ 20.2 one-writer: a subscription has two doors — a signed document and an
  // accepted estimate. Both are traceable on the Stripe object, or neither is.
  subscription: ["person_id", "practice_id", "plan_id", "service_id",
    "created_by_document_id", "created_by_estimate_id",
    // ◆ 20.2 one-writer: settings.mjs sends plan_key, seat_count for checkout session subscription_data
    "plan_key", "seat_count", "billing_interval",
    // ◆ the maintainer, 6 Oct 2026: a Docustay founders subscription is stamped when checkout starts ("true"/"false") — the price promise travels with the subscription
    "founders_price",
    // ◆ T1.19 (F785/F787): every other kind gains workbench_tenant_id
    "workbench_tenant_id"],
  // ◆ QUEUE §4 (the maintainer, 2 Oct 2026) — the hard-coded `coaching_group` (life/recovery) is GONE. A catalogue item's Program travels as its id and its name
  // (`program_id`, `program`), for every catalogue kind, so a Stripe report can group by the practice's own programs.
  product: ["service_id", "practice_id", "category", "workbench_tenant_id", "kind", "program_id", "program"],
  price: ["service_id", "practice_id", "price_id", "location_id", "delivery_mode", "unit_label", "modifier_id", "workbench_tenant_id"],
  refund: ["payment_id", "practice_id", "reason_code", "workbench_tenant_id"],
  terminal_location: ["practice_id", "location_id", "keystone_payer_id", "keystone_source", "workbench_tenant_id"],
  credit_note: ["practice_id", "invoice_id", "workbench_tenant_id"],
  // ◆ Part 3 rebuild, 1 Oct 2026 — invoiceDraftSync.mjs's one-writer: a Stripe Invoice Item
  // carries OUR line_item's own id so a later sync pass can diff by it instead of by position
  // (MEASURED: Invoice Item metadata round-trips correctly both via invoiceItems.list and via
  // the invoice's own expanded .lines — real Stripe test-mode call, not assumed).
  invoice_item: ["line_item_id", "workbench_tenant_id"],
  // ◆ 20.2 one-writer: bookingPayments.mjs creates setup_intents with keystone_booking_id
  setup_intent: ["keystone_booking_id", "workbench_tenant_id"],
  // ◆ 20.2 one-writer: paymentLinks.mjs creates payment_links with keystone_payment_link_id, keystone_tenant_id
  payment_link: ["keystone_payment_link_id", "keystone_tenant_id", "workbench_tenant_id"],
};

const MAX_KEY_LENGTH = 40;
const MAX_VALUE_LENGTH = 500;

/**
 * metadataFor(kind, fields) → {[k]:string}
 *
 * Composes Stripe metadata for the given kind.
 * - Returns exactly the documented keys for that kind (no extras).
 * - Omits fields not present in the input (not set to "" or "null").
 * - All values are stringified and must be ≤500 chars.
 * - All keys must be ≤40 chars.
 * - Throws MetadataForbidden if any field name contains a forbidden key.
 * - Throws if kind is unknown.
 *
 * @param {string} kind - One of: customer, payment_intent, invoice, subscription,
 *                        product, price, refund, terminal_location, setup_intent, payment_link
 * @param {object} fields - Object with values to include (missing fields are omitted)
 * @returns {object} Metadata object with stringified values
 * @throws {Error} if kind is unknown
 * @throws {MetadataForbidden} if any field name contains a forbidden key
 * @throws {Error} if key length > 40 or value length > 500
 */
export function metadataFor(kind, fields) {
  if (!KEY_SETS[kind]) {
    throw new Error(`Unknown metadata kind: ${kind}`);
  }

  // Check fields for forbidden keys
  for (const fieldName of Object.keys(fields)) {
    for (const forbidden of FORBIDDEN_META_KEYS) {
      if (fieldName.includes(forbidden)) {
        throw new MetadataForbidden(
          `Field name "${fieldName}" contains forbidden key "${forbidden}"`
        );
      }
    }
  }

  const result = {};
  const allowedKeys = KEY_SETS[kind];

  for (const key of allowedKeys) {
    if (key in fields) {
      const value = String(fields[key]);

      // Validate key length
      if (key.length > MAX_KEY_LENGTH) {
        throw new Error(
          `Metadata key "${key}" exceeds maximum length of ${MAX_KEY_LENGTH}`
        );
      }

      // Validate value length
      if (value.length > MAX_VALUE_LENGTH) {
        throw new Error(
          `Metadata value for key "${key}" exceeds maximum length of ${MAX_VALUE_LENGTH}`
        );
      }

      result[key] = value;
    }
  }

  return result;
}

/**
 * paymentDescription({serviceName, coachFirstName, dateLocal}) → string
 *
 * Formats a payment description for Stripe.
 * Format: "<Service> with <First> · <d MMM>"
 * Example: "Intensive Coaching with John · 25 Sep"
 *
 * @param {object} config - { serviceName, coachFirstName, dateLocal }
 * @returns {string} Formatted description
 */
export function paymentDescription({ serviceName, coachFirstName, dateLocal }) {
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  let dateStr = "";
  if (dateLocal) {
    const date = new Date(dateLocal);
    // Use UTC accessors because date is parsed as UTC midnight (e.g. "2026-09-25" → 2026-09-25T00:00:00Z)
    const day = date.getUTCDate();
    const month = monthNames[date.getUTCMonth()];
    dateStr = `${day} ${month}`;
  }

  return `${serviceName} with ${coachFirstName} · ${dateStr}`;
}

export { KEY_SETS };
