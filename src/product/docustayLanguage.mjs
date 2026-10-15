// The language a Docustay person asked for on the sign-up screen (stored with their welcome series), so account and billing emails speak it. English when unknown. One small read; never throws.
import { BILLING_LANGS } from "../email/docustayBillingLanguages.mjs";
export async function languageOfUser(tx, { tenantId, userId }) {
  if (!userId) return "en";
  try {
    const { rows: [r] } = await tx.query(`SELECT lang FROM keystone.docustay_welcome WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`, [tenantId, userId]);
    return BILLING_LANGS.includes(r?.lang) ? r.lang : "en";
  } catch { return "en"; }
}
export async function languageOfEmail(tx, { tenantId, email }) {
  try {
    const { rows: [r] } = await tx.query(`SELECT w.lang FROM keystone.docustay_welcome w JOIN keystone.app_user u ON u.id = w.user_id AND u.tenant_id = w.tenant_id WHERE w.tenant_id = $1 AND lower(u.email) = lower($2) LIMIT 1`, [tenantId, email]);
    return BILLING_LANGS.includes(r?.lang) ? r.lang : "en";
  } catch { return "en"; }
}
