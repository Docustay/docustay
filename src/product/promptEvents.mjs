// src/product/promptEvents.mjs — plan-aware prompting analytics (Part 2 f, 19 Oct 2026): prompt_shown, prompt_clicked, prompt_dismissed (reported by the web) and limit_hit (recorded by the server when a gate refuses).
// Plain facts only: which action, which meter, how severe, which form of the prompt, which option was pressed. Never a name, an address, a document title or an id other than the account and workspace PostHog already holds.
// Test and internal accounts carry is_test / is_internal (from the owner's address, read here and never sent) so PostHog's one test-account switch hides them.
import { captureSoon, posthogConfigured, accountFlags } from "./posthog.mjs";
import { PREFLIGHT_ACTIONS, SEVERITIES } from "./docustayPreflight.mjs";

export const PROMPT_EVENTS = Object.freeze(["prompt_shown", "prompt_clicked", "prompt_dismissed", "limit_hit"]);
export const PROMPT_FORMS = Object.freeze(["note", "sheet", "lock"]);
const METERS = Object.freeze(["documents", "budget", "people", "drafts", "templates", "upload", "feature", "fee"]);
const OPTION_KEYS = Object.freeze(["payg", "pro", "lifetime", "raise_budget", "wait", "not_now", "close", "see_options"]);
const oneOf = (list, v) => (typeof v === "string" && list.includes(v) ? v : undefined);
const REASON = /^[a-z_]{3,40}$/;

/** The properties one prompt event may carry, cleaned: anything unknown is dropped. */
export function promptProps(input = {}) {
  const p = { action: oneOf(PREFLIGHT_ACTIONS, input.action), severity: oneOf(SEVERITIES, input.severity), form: oneOf(PROMPT_FORMS, input.form), meter: oneOf(METERS, input.meter),
    option: oneOf(OPTION_KEYS, input.option), reason: typeof input.reason === "string" && REASON.test(input.reason) ? input.reason : undefined, route: typeof input.route === "string" && /^\/[a-z0-9/_-]{0,40}$/.test(input.route) ? input.route : undefined };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
}

/** Send one prompt event as the workspace owner's account (PostHog only; there is no tracking script in the signed-in app). Returns the cleaned event, or null when off or unknown. Never throws. */
export async function recordPromptEvent(tx, { tenantId, name, props = {}, env = process.env, send = captureSoon }) {
  try {
    if (!PROMPT_EVENTS.includes(name) || !posthogConfigured(env)) return null;
    const { rows: [o] } = await tx.query(`SELECT u.id, u.email, t.id AS tenant_id, s.plan_key FROM keystone.tenant t JOIN keystone.app_user u ON u.tenant_id = t.id AND u.role = 'staff'
        LEFT JOIN keystone.mainstay_subscription s ON s.tenant_id = t.id WHERE t.id = COALESCE($1::uuid, keystone.current_tenant_id()) ORDER BY (u.staff_role = 'owner') DESC, u.created_at LIMIT 1`, [tenantId]);
    if (!o) return null;
    const plan = ({ docustay_pro: "pro", docustay_payg: "payg", docustay_lifetime: "lifetime" })[o.plan_key] ?? "free";
    const f = accountFlags(o.email), clean = { ...promptProps(props), plan, is_test: f.is_test, is_internal: f.is_internal };
    send(name, { accountId: o.id, workspaceId: o.tenant_id, props: clean }, { env });
    return { name, ...clean };
  } catch (e) { console.warn(`analytics: ${name} not sent (${e?.message ?? e})`); return null; }
}

const METER_OF = { plan_document_limit: "documents", budget_reached: "budget", plan_people_limit: "people", plan_template_limit: "templates", plan_signer_limit: "signers", ai_limit_credits: "drafts", ai_limit_usd: "drafts", plan_pro_required: "feature", too_big: "upload" };
/** A gate refused: record limit_hit with the stable refusal code. Fire and forget. */
export function recordLimitHit(tx, { tenantId, code, action }) {
  if (!METER_OF[code]) return Promise.resolve(null);
  return recordPromptEvent(tx, { tenantId, name: "limit_hit", props: { action, reason: code, meter: METER_OF[code], severity: "blocked" } });
}
