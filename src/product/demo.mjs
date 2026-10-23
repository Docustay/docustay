// src/product/demo.mjs — Launch step 8: THE PUBLIC DEMO. A visitor gets a real, throw-away Docustay workspace (the same code, schema and row-level security as a customer's) that:
//   · lives 24 hours and is then deleted through the product's own workspace-deletion path;
//   · SENDS NOTHING: every email it would send is recorded ("in a real account this would email jordan@example.com") and shown in the demo inbox, with the signing link inside it so the visitor can open the signer's side;
//   · CHARGES NOTHING and cannot reach the places that cost or expose something (API keys, checkout, email setup, sign-in settings, workspace deletion) — one list, refused with a plain sentence;
//   · gets a few real Scribe prompts (shared monthly cap, counted per demo) and then a scripted "Demo AI" that still does the real work through the real tools;
//   · is started through a bot check and a per-address hourly budget (the address is stored only as a keyed hash), and never exists on a self-hosted install unless the owner switches it on.
// A demo has a synthetic owner with no email, no password and no login identity: its session is minted directly (src/auth/session.mjs createSession), like the QA sign-in does.
import { trackEvent, trackOnce } from "./analytics.mjs";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { withTenant, withCredentialLookup, withSignupConnection } from "../db/index.mjs";
import { createRun, runCriticalPrefix } from "../provisioning/prefix.mjs";
import { createSession } from "../auth/session.mjs";
import { activateWorkspace } from "./docustay.mjs";
import { demoEnabled, demoLimits } from "./demoConfig.mjs";
import { invalid, forbidden, conflict, rateLimited, AppError } from "../http/errors.mjs";

export const DEMO_TENANT_NAME = "Maple Street Property Management";
export const DEMO_OWNER_EMAIL = "you@demo.invalid";   // never deliverable: .invalid is reserved, and every send in a demo is held anyway

const secretOf = (env = process.env) => env.KEYSTONE_DEMO_SECRET || env.KEYSTONE_UNSUBSCRIBE_SECRET || env.KEYSTONE_LOCAL_AUTH_SECRET || env.KEYSTONE_SESSION_SECRET || "docustay-demo-fallback-secret";
/** The visitor's address as a keyed hash: enough to count "how many demos from here this hour", not enough to find anyone. */
export const hashAddress = (ip, env = process.env) => createHmac("sha256", secretOf(env)).update(`demo-ip:${ip ?? "unknown"}`).digest("hex").slice(0, 32);

// ─────────────────────────────── what a request asks: is this workspace a demo?
export { demoRow, holdMail } from "./demoHold.mjs";
import { demoRow } from "./demoHold.mjs";
export async function isDemoTenantId(tenantId) {
  if (!tenantId) return false;
  return withCredentialLookup(async (db) => (await db.query(`SELECT keystone_auth.is_demo_tenant($1) AS d`, [tenantId])).rows[0]?.d === true).catch(() => false);
}
/** The banner's facts (nothing for a real workspace). */
export async function demoView(tx, env = process.env) {
  const d = await demoRow(tx); if (!d) return null;
  const lim = demoLimits(env);
  const { rows: [m] } = await tx.query(`SELECT count(*)::int AS n FROM keystone.docustay_demo_mail`);
  return { expiresAt: d.expires_at, aiPromptsLeft: Math.max(0, lim.aiPrompts - d.ai_prompts), aiPromptsTotal: lim.aiPrompts, uploadsLeft: Math.max(0, lim.uploads - d.uploads), mailCount: m?.n ?? 0, seeded: Boolean(d.seeded_at) };
}

// ─────────────────────────────── the request guard: what a demo may not reach
// [method or "*", path pattern, plain reason]. Anything that costs money, sends mail outside the workspace, makes a credential, or removes the workspace.
export const DEMO_BLOCKED = Object.freeze([
  ["*", /^\/api\/developer(\/|$)/, "API keys, webhooks and the developer tools are not part of the demo."],
  ["*", /^\/api\/v1(\/|$)/, "The public API is not part of the demo."],
  ["*", /^\/api\/product\/docustay\/(checkout|portal|cancel|resume|licenses|payments|delete-workspace|ai-usage)/, "Billing, payments and plans are not part of the demo."],
  ["*", /^\/api\/settings\/(plans|billing|connect)(\/|$)/, "Billing, plans and payment connections are not part of the demo."],
  ["*", /^\/api\/account\/(deletion|export)/, "Deleting or exporting the account is not part of the demo."],
  ["*", /^\/api\/(settings\/sign-in|auth\/(two-step|passkeys)|people\/team\/two-step)/, "Sign-in settings are not part of the demo."],
  ["*", /^\/api\/documents\/(email|domains|signing-domain)(\/|$)/, "Email set-up is not part of the demo: nothing is sent from a demo."],
  ["*", /^\/api\/people\/invite/, "Inviting teammates is not part of the demo: nothing is sent from a demo."],
  ["*", /^\/api\/documents\/(embedded|connections|connector)/, "Connections are not part of the demo."],
  ["POST", /^\/api\/documents\/ai\/own-key/, "Your own AI key is not part of the demo."],
  ["*", /^\/api\/documents\/ai\/(key|own-key)(\/|$)/, "Your own AI key is not part of the demo."],
]);
/** Throws a plain refusal when this request is one a demo may not make. `isDemo` is asked only for a matching path, so an ordinary request costs a regular expression. */
export async function refuseInDemo(tx, { method, path }) {
  const hit = DEMO_BLOCKED.find(([m, re]) => (m === "*" || m === method) && re.test(path));
  if (!hit) return;
  if (!(await demoRow(tx))) return;
  throw forbidden(hit[2], { code: "demo_blocked" });
}

// ─────────────────────────────── mail: held, recorded, never sent (the hold itself is in demoHold.mjs, used by the mail layers)
export async function listHeldMail(tx, { limit = 50 } = {}) {
  const { rows } = await tx.query(`SELECT id, created_at, to_addr AS "to", subject, body_text AS text, link FROM keystone.docustay_demo_mail ORDER BY created_at DESC LIMIT $1`, [Math.min(100, Math.max(1, limit))]);
  return rows;
}

// ─────────────────────────────── Scribe: a few real prompts, then the scripted one
/**
 * Decide how this chat turn is answered: "real" (the visitor has prompts left, the service has a key and its ceiling is not reached — the caller then admits and bills as usual) or "scripted". Counts a real prompt.
 * `hasKey` is whether the service has an AI key at all (none: always scripted, which is also what keeps AI off until a key is added). Returns null for a real workspace.
 */
export async function aiMode(tx, { hasKey, env = process.env }) {
  const d = await demoRow(tx); if (!d) return null;
  const lim = demoLimits(env);
  await trackOnce(tx, null, "demo_step", { step: "asked_scribe" }, { key: "demo_step:asked_scribe" }).catch(() => {});
  if (!hasKey || d.ai_prompts >= lim.aiPrompts) return "scripted";
  await tx.query(`UPDATE keystone.docustay_demo SET ai_prompts = ai_prompts + 1 WHERE tenant_id = keystone.current_tenant_id()`);
  return "real";
}
/** A real prompt that the platform's allowance refused is given back to the visitor (the turn is answered by the script instead). */
export async function refundAiPrompt(tx) { await tx.query(`UPDATE keystone.docustay_demo SET ai_prompts = greatest(0, ai_prompts - 1) WHERE tenant_id = keystone.current_tenant_id()`); }

// ─────────────────────────────── uploads: one small PDF
export async function checkUpload(tx, { bytes, env = process.env }) {
  const d = await demoRow(tx); if (!d) return;
  const lim = demoLimits(env);
  if (Number.isFinite(bytes) && bytes > lim.uploadBytes) throw invalid(`A demo takes a PDF up to ${Math.round(lim.uploadBytes / 1048576)} MB.`, { code: "demo_upload_size" });
  if (d.uploads >= lim.uploads) throw conflict(`A demo takes ${lim.uploads === 1 ? "one uploaded PDF" : `${lim.uploads} uploaded PDFs`}. Create a free account to upload more.`, { code: "demo_upload_count" });
  await trackOnce(tx, null, "demo_step", { step: "uploaded_pdf" }, { key: "demo_step:uploaded_pdf" }).catch(() => {});
  await tx.query(`UPDATE keystone.docustay_demo SET uploads = uploads + 1 WHERE tenant_id = keystone.current_tenant_id()`);
}

// ─────────────────────────────── start
const slugPart = () => randomBytes(4).toString("hex");
export class DemoRefused extends AppError {}
/**
 * Make a demo workspace for one visitor and return its session. The caller has already passed the bot check. `seed` is injected (the seed module; tests pass a stub or nothing).
 * Refuses (a plain sentence, kind "rate_limited"/"unavailable") when this address has made its share this hour or when too many demos are alive.
 */
export async function startDemo({ ip, userAgent = null, env = process.env, seed = null }) {
  if (!demoEnabled(env)) throw forbidden("The demo is not available here.", { code: "demo_off" });
  const lim = demoLimits(env), ipHash = hashAddress(ip, env);
  const b = await withCredentialLookup(async (db) => (await db.query(`SELECT * FROM keystone_auth.demo_budget($1, interval '1 hour')`, [ipHash])).rows[0] ?? { ip_recent: 0, alive: 0 });
  if (b.ip_recent >= lim.perIpPerHour) throw rateLimited("You have started a few demos this hour already. Try again in a little while, or create a free account.", { code: "demo_ip_limit" });
  if (b.alive >= lim.maxActive) throw rateLimited("The demo is very busy right now. Please try again in a few minutes.", { code: "demo_full" });

  const slug = `demo-${slugPart()}`;
  const uid = `demo:${randomUUID()}`;
  const runId = await withSignupConnection((db) => createRun(db, { slug, name: DEMO_TENANT_NAME }));
  const made = await withSignupConnection((db) => runCriticalPrefix(db, {
    runId, tenant: { slug, name: DEMO_TENANT_NAME, timezone: "America/Los_Angeles" }, admin: { email: DEMO_OWNER_EMAIL, displayName: "You (demo)" },
    firebaseUid: uid, isPlatform: false, staffRole: "owner",
  }));
  const { tenantId, adminUserId } = made;
  await withTenant(tenantId, async (tx) => {
    await activateWorkspace(tx, { tenantId, actorUserId: null });   // Documents-only, Free plan; no welcome series for a demo (no actor)
    await tx.query(`INSERT INTO keystone.docustay_demo (tenant_id, owner_user_id, ip_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))`, [tenantId, adminUserId, ipHash, lim.hours]);
  }, { userId: adminUserId });
  let seeded = false;
  if (seed) { try { await seed({ tenantId, ownerId: adminUserId }); seeded = true; } catch (e) { console.error(`demo seed failed (the demo still opens, empty): ${e?.message ?? e}`); } }
  await withTenant(tenantId, (tx) => tx.query(`UPDATE keystone.docustay_demo SET seeded_at = now() WHERE tenant_id = $1`, [tenantId]), { userId: adminUserId });
  const session = await createSession({ tenantId, appUserId: adminUserId, firebaseUid: uid, ttlHours: lim.hours, userAgent, ip, kind: "app" });
  void trackEvent("demo_started", null, { accountId: adminUserId, workspaceId: tenantId, set: { account_id: adminUserId, workspace_id: tenantId, plan: "free", kind: "demo", is_internal: false, is_test: false } });
  return { token: session.token, tenantId, expiresInHours: lim.hours, seeded };
}

// ─────────────────────────────── the hourly purge
/** Delete demos whose 24 hours are up, through the product's own workspace deletion. Returns how many went. */
export async function purgeExpiredDemos({ limit = 25, now = new Date() } = {}) {
  const { deleteWorkspace, removeLeftovers } = await import("./workspaceDeletion.mjs");
  const rows = await withCredentialLookup(async (db) => (await db.query(`SELECT * FROM keystone_auth.list_expired_demos($1)`, [limit])).rows).catch((e) => { console.error(`demo purge: could not list expired demos (${e?.message ?? e})`); return []; });
  let gone = 0;
  for (const r of rows) {
    try {
      const out = await withTenant(r.tenant_id, (tx) => deleteWorkspace(tx, { tenantId: r.tenant_id, actorUserId: r.owner_user_id, actorEmail: DEMO_OWNER_EMAIL, confirm: DEMO_TENANT_NAME }), { userId: r.owner_user_id });
      await removeLeftovers({ storageKeys: out?.storageKeys ?? [], identities: (out?.identities ?? []).filter((u) => !String(u).startsWith("demo:")) }).catch((e) => console.warn(`demo purge: leftovers not removed (${e?.message ?? e})`));
      gone += 1;
    } catch (e) { console.error(`demo purge: ${r.tenant_id} not deleted (${e?.message ?? e})`); }
  }
  return { gone, due: rows.length, at: now.toISOString() };
}
