// src/product/posthogListener.mjs — the outbox listener that turns committed Docustay events into PostHog events (LISTENER.POSTHOG in src/queue/tasks.mjs).
// ★★ It runs AFTER the business transaction committed, from the outbox, so a rolled-back send never counts, every send path counts once
//    (in-app, API v1/v2, scheduled, kiosk, form: they all emit documents.document.sent), and a PostHog failure retries on the listener ladder.
// ★★★ The PERSON is the workspace account that owns the work (the document's sender, the actor, or the workspace owner), NEVER a signer.
//     Properties are ids, states, timings, plans and buckets only (safeProps in ./posthog.mjs drops everything else).
import { capture, captureSoon, amountBucket, posthogConfigured, accountFlags } from "./posthog.mjs";
import { instanceAnalyticsFacts } from "../documents/frontDoor.mjs";   // the documents wall: never a raw query on document_instance

const DOC = { "documents.document.sent": "document_sent", "documents.document.opened": "document_opened", "documents.document.executed": "document_completed",
  "documents.document.declined": "document_declined", "documents.document.expired": "document_expired", "documents.document.voided": "document_voided" };
const OTHER = { "documents.template.created": "template_created", "documents.template.published": "template_published",
  "documents.ai.draft_generated": "scribe_draft_used",
  "documents.email.delivered": "email_delivered", "documents.email.bounced": "email_bounced", "documents.email.complained": "email_complained" };
// settings.subscription.updated's own `change` (src/billing/webhook.mjs) → the business event
const BILLING = { pro_started: "upgrade_completed", pro_ended: "subscription_ended", cancel_scheduled: "cancel_scheduled", resumed: "subscription_resumed", payment_failed: "payment_failed" };

export const POSTHOG_TOPICS = Object.freeze([...Object.keys(DOC), ...Object.keys(OTHER), "settings.subscription.updated", "documents.usage.threshold"]);

/** Should this event get the listener? Only Docustay workspaces, only when PostHog is configured. */
export async function wantsPosthog(tx, ev, tenantId, { env = process.env } = {}) {
  if (!posthogConfigured(env) || !POSTHOG_TOPICS.includes(ev.topic)) return false;
  const { rows: [t] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  return t?.product === "docustay";
}

const userOf = (actor) => (/^user:([0-9a-f-]{36})$/.exec(String(actor ?? "")) ?? [])[1] ?? null;
/** is_test / is_internal for an event, from the workspace owner's address (read here, never sent), so PostHog's test-account filter hides QA and throwaway workspaces. */
async function flagsOf(tx, tenantId) {
  const { rows: [u] } = await tx.query(`SELECT email FROM keystone.app_user WHERE tenant_id = $1 AND role = 'staff' ORDER BY (staff_role = 'owner') DESC, created_at LIMIT 1`, [tenantId]);
  const f = accountFlags(u?.email); return { is_test: f.is_test, is_internal: f.is_internal };
}
async function owner(tx, tenantId) {
  const { rows: [u] } = await tx.query(`SELECT id FROM keystone.app_user WHERE tenant_id = $1 AND role = 'staff' ORDER BY (staff_role = 'owner') DESC, created_at LIMIT 1`, [tenantId]);
  return u?.id ?? null;
}

/** The handler. Returns the PostHog event name it sent, or null when the event maps to nothing. */
export async function handlePosthogEvent(ev, { tx, tenantId }, { send = capture } = {}) {
  const p = ev.payload ?? {};
  const base = { workspaceId: tenantId, uuid: ev.id, timestamp: ev.created_at };
  if (DOC[ev.topic]) {
    const d = await instanceAnalyticsFacts(tx, { tenantId, instanceId: ev.subject_id });
    const accountId = d?.created_by ?? (ev.topic === "documents.document.sent" ? userOf(ev.actor) : null) ?? await owner(tx, tenantId);
    const props = { document_id: ev.subject_id, builder: p.builder, test_document: Boolean(d?.is_test ?? p.test) };
    if (ev.topic === "documents.document.executed" && d?.sent_at && d?.executed_at) props.hours_to_complete = Math.round((new Date(d.executed_at) - new Date(d.sent_at)) / 36e5 * 10) / 10;
    await send(DOC[ev.topic], { ...base, accountId, props });
    if (ev.topic === "documents.document.sent" && !props.test_document) {
      // first real send of the workspace: the marker row is the proof, so it is counted once (same table as the Umami events)
      const { rows } = await tx.query(`INSERT INTO keystone.docustay_event_once (tenant_id, event_key) VALUES ($1, 'posthog:first_document_sent') ON CONFLICT DO NOTHING RETURNING 1`, [tenantId]);
      if (rows.length) await send("first_document_sent", { ...base, uuid: undefined, accountId, props });
    }
    return DOC[ev.topic];
  }
  if (OTHER[ev.topic]) {
    const accountId = userOf(ev.actor) ?? await owner(tx, tenantId);
    const props = { template_id: ev.topic.startsWith("documents.template") ? ev.subject_id : null,
      builder: p.builder, kind: p.kind, outcome: p.outcome ?? p.status, email_event: ev.topic.split(".").pop(),
      sending_domain: typeof p.sending_domain === "string" ? p.sending_domain : typeof p.from_domain === "string" ? p.from_domain : null };
    await send(OTHER[ev.topic], { ...base, accountId, props });
    return OTHER[ev.topic];
  }
  if (ev.topic === "documents.usage.threshold") {   // V1 usage billing: a budget alert (kind "budget", percent 50/80/100; 100 is the pause) or the monthly summary (kind "summary"). Counts only: no amounts.
    const name = p.kind === "summary" ? "usage_summary_sent" : "budget_threshold";
    await send(name, { ...base, accountId: await owner(tx, tenantId), props: { kind: p.kind, percent: Number.isFinite(p.percent) ? p.percent : null, period_start: typeof p.period_start === "string" ? p.period_start : null, period_end: typeof p.period_end === "string" ? p.period_end : null, ...await flagsOf(tx, tenantId) } });
    return name;
  }
  if (ev.topic === "settings.subscription.updated") {
    const name = BILLING[p.change];
    if (!name) return null;
    const plan = ({ docustay_pro: "pro", docustay_free: "free", docustay_payg: "payg", docustay_lifetime: "lifetime" })[p.planKey] ?? p.planKey;
    const accountId = await owner(tx, tenantId);
    await send(name, { ...base, accountId, props: { plan, plan_status: p.status, change: p.change, interval: p.interval, currency: p.currency,
      amount_bucket: amountBucket(p.amountMinor), ...await flagsOf(tx, tenantId) }, set: { plan, plan_status: p.status } });
    return name;
  }
  return null;
}

/** A business moment raised inside a webhook (dispute, refund): Docustay workspaces only; never throws, never waits. */
export async function docustayMoment(tx, tenantId, name, props = {}, { env = process.env } = {}) {
  try {
    if (!posthogConfigured(env) || !tenantId) return false;
    const { rows: [t] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
    if (t?.product !== "docustay") return false;
    captureSoon(name, { accountId: await owner(tx, tenantId), workspaceId: tenantId, props: { ...props, ...await flagsOf(tx, tenantId) } }, { env });
    return true;
  } catch { return false; }
}
