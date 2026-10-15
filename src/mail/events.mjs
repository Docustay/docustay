// src/mail/events.mjs — DELIVERY EVENTS. The provider's delivered / bounced / complained webhooks, recorded by provider message id and handed to whoever registered an interest (the Documents island marks a person's invitation bounced; the platform marks the address).
const listeners = new Set();
/** Register a function `(tx, {tenantId, providerMessageId, kind}) → void` called for every recorded event. Returns an unsubscribe. */
export function onMailEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const KIND = { "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained" };
export async function recordMailEvent(tx, { tenantId, providerMessageId, type }) {
  const kind = KIND[type];
  if (!kind || !providerMessageId) return { applied: false, reason: "not_a_delivery_event" };
  const { rowCount } = await tx.query(
    `INSERT INTO keystone.mail_event (tenant_id, provider_message_id, kind) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, provider_message_id, kind) DO NOTHING`, [tenantId, providerMessageId, kind]);
  if (rowCount === 0) return { applied: false, reason: "already_recorded", kind };
  for (const fn of listeners) await fn(tx, { tenantId, providerMessageId, kind });
  return { applied: true, kind };
}
/** Counts for the screen: how many bounces and complaints this organisation has had in the last 30 days. */
export async function eventCounts(tx, { tenantId }) {
  const { rows } = await tx.query(`SELECT kind, count(*)::int AS n FROM keystone.mail_event WHERE tenant_id = $1 AND created_at > now() - interval '30 days' GROUP BY kind`, [tenantId]);
  return Object.fromEntries(["delivered", "bounced", "complained"].map((k) => [k, rows.find((r) => r.kind === k)?.n ?? 0]));
}
