// Launch plan Part 3 (13 Oct 2026) — a workspace's SEPARATE BILLING EMAIL. Receipts, failed-payment notices and the plan-change emails go to the workspace owners as before AND to this address when one is set, so a
// finance person or a shared inbox sees them without being a member. It receives billing emails only (never document, signing or account mail). One copy per business event: the sender passes an idempotency key.
import { getSetting, setSetting } from "../settings/writes.mjs";
import { invalid } from "../http/errors.mjs";
const BILLING_EMAIL_KEY = "billing.email";
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v) => String(v ?? "").trim().toLowerCase();

/** the saved billing email, or null */
export async function getBillingEmail(tx, { tenantId } = {}) {
  const v = await getSetting(tx, BILLING_EMAIL_KEY, "");
  return typeof v === "string" && SHAPE.test(v) ? v : null;
}

/** save (or, with an empty string, remove) the billing email. → { email } */
export async function setBillingEmail(tx, { tenantId, actorUserId = null, email }) {
  const v = clean(email);
  if (v !== "" && (v.length > 254 || !SHAPE.test(v))) throw invalid("Enter a valid email address, or leave it empty to remove the billing email.", { field: "email" });
  await setSetting(tx, { tenantId, key: BILLING_EMAIL_KEY, value: v, updatedBy: actorUserId });
  return { email: v === "" ? null : v };
}

/** the extra address a billing email should ALSO go to: the saved billing email unless it is already one of `already` (the owners being written to). null when none. */
export async function billingCopyAddress(tx, { tenantId, already = [] } = {}) {
  const b = await getBillingEmail(tx, { tenantId });
  if (!b) return null;
  return already.map(clean).includes(clean(b)) ? null : b;
}
