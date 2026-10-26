// src/product/posthog.mjs — Docustay's business events and server errors to PostHog Cloud (OPERATION-LIVE §24, specs/POSTHOG-WIRING-PLAN.md).
// ★★★ WHO A PERSON IS: an ACCOUNT id (app_user.id) only; the workspace (tenant.id) is a PostHog group. NEVER a name, an email, a workspace
//     name, a document title or content, a signer, or a file name. Properties pass through `safeProps` (a closed list of keys, plain values,
//     no "@"); exception text is scrubbed of emails, long numbers and secrets before it leaves.
// ★★ OFF unless POSTHOG_PROJECT_TOKEN is set, so a self-hosted install never reports to us. Production carries the 'Docustay production'
//    token; sandbox and beta carry the 'Docustay beta' token, so test traffic never reaches the real numbers.
// ★ Every call goes out through callOutside("posthog") (the one outside-call wrapper); a failure never breaks the caller.
import { PostHog } from "posthog-node";
import { callOutside } from "../http/outside.mjs";
import { scrubSecrets } from "../logging/scrub.mjs";

export const posthogConfigured = (env = process.env) => Boolean(env.POSTHOG_PROJECT_TOKEN);
const environment = (env = process.env) => env.KEYSTONE_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || "unknown";

// The only property keys that may ever leave. Anything else is dropped, whatever the caller passes.
export const SAFE_KEYS = Object.freeze(["account_id", "workspace_id", "document_id", "template_id", "form_id", "plan", "plan_status", "change", "builder",
  "state", "test_document", "hours_to_complete", "amount_bucket", "currency", "interval", "outcome", "step", "language", "sending_domain", "email_event",
  "kind", "percent", "is_internal", "is_test", "created_at", "country", "environment", "source", "status_class", "route", "http_status", "stripe_event_type", "period_start", "period_end", "action", "severity", "form", "meter", "option", "reason"]);
export function safeProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (!SAFE_KEYS.includes(k) || v == null) continue;
    if (!["string", "number", "boolean"].includes(typeof v)) continue;
    if (typeof v === "string" && (v.length > 80 || /@/.test(v))) continue;
    out[k] = v;
  }
  return out;
}

/** Internal and test accounts are flagged at sign-up so PostHog's one test-account switch hides them. The address is read here and never sent. */
export function accountFlags(email) {
  const e = String(email ?? "").toLowerCase();
  // Whose addresses count as ours is configuration, never source: KEYSTONE_INTERNAL_ADDRESSES (exact addresses) and KEYSTONE_QA_ADDRESS_PREFIXES (comma lists).
  const list = (k) => String(process.env[k] ?? "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  if (list("KEYSTONE_INTERNAL_ADDRESSES").includes(e)) return { kind: "owner", is_internal: true, is_test: false };
  if (list("KEYSTONE_QA_ADDRESS_PREFIXES").some((p) => e.startsWith(p))) return { kind: "qa", is_internal: true, is_test: true };
  if (e.endsWith("@demo.invalid")) return { kind: "demo", is_internal: false, is_test: false };   // a visitor trying the demo is real funnel traffic
  if (/@docustay\.app$/.test(e) || list("KEYSTONE_STAFF_DOMAINS").some((d) => e.endsWith(`@${d}`))) return { kind: "staff", is_internal: true, is_test: false };
  if (/(\.example|@example\.|\.test$|\.invalid$|mailpit)/.test(e)) return { kind: "test", is_internal: false, is_test: true };
  return { kind: "customer", is_internal: false, is_test: false };
}

/** Amounts leave as a bucket, never the figure. */
export const amountBucket = (minor) => minor == null ? null : minor < 1000 ? "<10" : minor < 5000 ? "10-50" : minor < 20000 ? "50-200" : minor < 100000 ? "200-1000" : "1000+";

// posthog-node with our wrapper as its fetch: the client sees a Response-like object.
const viaOutside = async (url, init) => {
  const r = await callOutside("posthog", url, init, { timeoutMs: 5000 });
  return { status: r.status ?? 0, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? "")), json: async () => r.body };
};
let client = null, clientToken = null;
function getClient(env = process.env) {
  if (!posthogConfigured(env)) return null;
  if (!client || clientToken !== env.POSTHOG_PROJECT_TOKEN) {
    client = new PostHog(env.POSTHOG_PROJECT_TOKEN, { host: env.POSTHOG_HOST || "https://us.i.posthog.com", flushAt: 1, flushInterval: 0,
      fetch: viaOutside, disableGeoip: true, enableExceptionAutocapture: false });
    clientToken = env.POSTHOG_PROJECT_TOKEN;
  }
  return client;
}
/** For tests: swap in a fake client ({ captureImmediate, groupIdentify, captureExceptionImmediate }). */
export function _setClient(c, token = "test") { client = c; clientToken = token; }

/**
 * One business event, awaited (an outbox listener retries a failure). `accountId` is the person; without one the event is
 * workspace-level and makes no person profile. Returns true when PostHog took it, false when off.
 */
export async function capture(name, { accountId = null, workspaceId = null, props = {}, set = null, timestamp = null, uuid = null } = {}, { env = process.env } = {}) {
  const ph = getClient(env);
  if (!ph) return false;
  const properties = { ...safeProps(props), environment: environment(env), source: "app" };
  if (workspaceId) properties.$groups = { workspace: String(workspaceId) };
  if (set) properties.$set = safeProps(set);
  if (!accountId) properties.$process_person_profile = false;
  await ph.captureImmediate({ distinctId: accountId ? String(accountId) : `workspace:${workspaceId ?? "none"}`, event: name, properties,
    ...(timestamp ? { timestamp: new Date(timestamp) } : {}), ...(uuid ? { uuid } : {}) });
  return true;
}

/** The workspace group: id, plan and dates only (never its name). */
export async function identifyWorkspace(workspaceId, props, { env = process.env } = {}) {
  const ph = getClient(env);
  if (!ph) return false;
  ph.groupIdentify({ groupType: "workspace", groupKey: String(workspaceId), properties: { ...safeProps(props), environment: environment(env) } });
  await ph.flush();
  return true;
}

/** Fire and forget for code paths that must never wait (sign-up, demo). */
export function captureSoon(name, opts, cfg) {
  void capture(name, opts, cfg).catch((e) => console.warn(`posthog: ${name} not sent (${e?.message ?? e})`));
}

const SCRUB = [[/[^\s@"'<>]+@[^\s@"'<>]+/g, "[email]"], [/\b\d{6,}\b/g, "[number]"], [/(["'])(?:(?=(\\?))\2.)*?\1/g, "[text]"]];
export function scrubText(s) {
  let t = scrubSecrets(String(s ?? ""));
  for (const [re, rep] of SCRUB) t = t.replace(re, rep);
  return t.slice(0, 2000);
}

/** A server 5xx: type, scrubbed message and stack, the route pattern and status. No request body, query or headers. */
export function reportError(err, { route = null, status = null, accountId = null, workspaceId = null } = {}, { env = process.env } = {}) {
  const ph = getClient(env);
  if (!ph) return false;
  const e = err instanceof Error ? err : new Error(String(err));
  const clean = new Error(scrubText(e.message));
  clean.name = e.name;
  clean.stack = scrubText(e.stack ?? "");
  const properties = { ...safeProps({ route: route ? String(route).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id").split("?")[0] : null, http_status: status }), environment: environment(env), source: "app" };
  if (workspaceId) properties.$groups = { workspace: String(workspaceId) };
  if (!accountId) properties.$process_person_profile = false;
  void ph.captureExceptionImmediate(clean, accountId ? String(accountId) : "server", properties).catch(() => {});
  return true;
}
