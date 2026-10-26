// src/product/analytics.mjs — Launch step 6: Docustay's own usage events, sent from the SERVER to a self-hosted Umami (no tracking script anywhere in the signed-in app, no cookie, no person in the event).
// An event is a name, an optional small data object of plain facts (a step name, a language), and nothing that names a person: never an email, a name, an address or a tenant id. Off (a no-op) unless
// KEYSTONE_UMAMI_URL and KEYSTONE_UMAMI_WEBSITE_ID are both set; a failure is swallowed (analytics must never break a sign-up), and the call has a short timeout.
import { callOutside } from "../http/outside.mjs";
import { captureSoon, posthogConfigured, accountFlags } from "./posthog.mjs";

export const EVENTS = Object.freeze(["signup_started", "signup_completed", "first_document_sent", "demo_started", "demo_step", "demo_converted_to_account"]);
const configured = (env = process.env) => Boolean(env.KEYSTONE_UMAMI_URL && env.KEYSTONE_UMAMI_WEBSITE_ID);
const clean = (data) => Object.fromEntries(Object.entries(data ?? {}).filter(([k, v]) => /^[a-z_]{1,30}$/.test(k) && ["string", "number", "boolean"].includes(typeof v) && String(v).length <= 60 && !/@/.test(String(v))));

/** Fire and forget. Returns true when an event was handed to Umami (false when off, unknown or failed). `fetchImpl` is for tests.
 *  PH1: the same event also goes to PostHog when it is configured, as the account (`accountId`) in its workspace, or anonymous without one. */
export async function trackEvent(name, data = null, { env = process.env, fetchImpl = null, accountId = null, workspaceId = null, set = null } = {}) {
  if (!EVENTS.includes(name)) return false;
  // first_document_sent reaches PostHog from the outbox listener instead (every send path, once): src/product/posthogListener.mjs
  if (posthogConfigured(env) && name !== "first_document_sent") captureSoon(name, { accountId, workspaceId, props: { ...clean(data), workspace_id: workspaceId ?? undefined }, set }, { env });
  if (!configured(env)) return false;
  const url = `${String(env.KEYSTONE_UMAMI_URL).replace(/\/+$/, "")}/api/send`;
  const body = JSON.stringify({ type: "event", payload: { website: env.KEYSTONE_UMAMI_WEBSITE_ID, hostname: env.KEYSTONE_UMAMI_HOSTNAME || "app.docustay.app", url: "/", name, ...(data ? { data: clean(data) } : {}) } });
  try {
    const init = { method: "POST", headers: { "content-type": "application/json", "user-agent": "Docustay-server/1.0" }, body };
    const r = fetchImpl ? await fetchImpl(url, init) : await callOutside("umami", url, init, { timeoutMs: 3000 });
    return Boolean(r?.ok ?? r?.status < 400);
  } catch (e) { console.warn(`analytics: ${name} not sent (${e?.message ?? e})`); return false; }
}

/** Once per workspace per key: the marker row is the proof, so a retry or a second send never counts twice. The event is sent only by whoever wrote the row. */
export async function trackOnce(tx, tenantId, name, data = null, { key = name, env = process.env, fetchImpl = null } = {}) {
  if (!configured(env) && !posthogConfigured(env)) return false;
  const { rows } = await tx.query(`INSERT INTO keystone.docustay_event_once (tenant_id, event_key) VALUES (COALESCE($1::uuid, keystone.current_tenant_id()), $2) ON CONFLICT DO NOTHING RETURNING 1`, [tenantId, key]);
  if (!rows.length) return false;
  // PH1: the person is the workspace owner's ACCOUNT id; their address is read only to set the internal/test flags and never leaves
  let who = {};
  if (posthogConfigured(env)) {
    const { rows: [o] } = await tx.query(`SELECT u.id, u.email, u.country, u.created_at, t.id AS tenant_id, s.plan_key FROM keystone.app_user u JOIN keystone.tenant t ON t.id = u.tenant_id
        LEFT JOIN keystone.mainstay_subscription s ON s.tenant_id = t.id WHERE t.id = COALESCE($1::uuid, keystone.current_tenant_id()) AND u.role = 'staff' ORDER BY (u.staff_role = 'owner') DESC, u.created_at LIMIT 1`, [tenantId]);
    if (o) {
      const plan = ({ docustay_pro: "pro", docustay_payg: "payg", docustay_lifetime: "lifetime" })[o.plan_key] ?? "free";
      who = { accountId: o.id, workspaceId: o.tenant_id, set: { account_id: o.id, workspace_id: o.tenant_id, plan, country: o.country ?? undefined,
        created_at: new Date(o.created_at).toISOString(), environment: env.KEYSTONE_ENVIRONMENT ?? undefined, ...accountFlags(o.email) } };
    }
  }
  void trackEvent(name, data, { env, fetchImpl, ...who });
  return true;
}
