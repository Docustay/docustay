// src/product/demoKeep.mjs — Launch step 9: "Keep my work". A demo visitor gives an email, proves it with a six-digit code, and the SAME workspace becomes their real Free account: the sample documents and forms are removed,
// what they made themselves stays, the demo's mail inbox and limits go, the welcome series starts, and their old demo session is replaced by a real one. Nothing is copied, so nothing can be lost between the two.
import { withTenant, withCredentialLookup } from "../db/index.mjs";
import { invalid, conflict, forbidden, dependency } from "../http/errors.mjs";
import { requestEmailCode, verifyEmailCode } from "../auth/emailCode.mjs";
import { localAuthEnabled, ensureLocalIdentity, localUserByEmail } from "../auth/localIdentity.mjs";
import { getFirebaseAuth } from "../auth/firebase.mjs";
import { createSession, revokeSessionsForUser } from "../auth/session.mjs";
import { CURRENT_POLICY_VERSION } from "../legal/policies.mjs";
import { deleteRecord } from "../records/delete.mjs";
import { enrol } from "./lifecycle.mjs";
import { demoRow } from "./demoHold.mjs";
import { trackOnce } from "./analytics.mjs";

const looksLikeEmail = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);
/** The same name the sign-up page gives a new workspace (the first-run checklist offers to rename it). */
export function workspaceNameFromEmail(email) {
  const [local = "", domain = ""] = String(email).trim().toLowerCase().split("@");
  const pretty = (s) => s.split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  if (domain && !FREE_MAIL.has(domain)) { const org = pretty(domain.split(".").slice(0, -1).join(" ")); if (org) return org.slice(0, 60); }
  const who = pretty(local.replace(/\+.*$/, ""));
  return who ? `${who.slice(0, 40)}'s workspace` : "My workspace";
}

async function uidOf(email) {
  if (localAuthEnabled()) return (await localUserByEmail(email)).uid;
  return (await getFirebaseAuth().getUserByEmail(email)).uid;
}
const tenantsOf = (uid) => withCredentialLookup(async (db) => (await db.query(`SELECT * FROM keystone.resolve_tenants_by_firebase_uid($1)`, [uid])).rows);

/** Step 1: make (or find) the identity for this address and mail the six-digit code. A refusal that says what to do: an address that already has an account is told to sign in. */
export async function requestKeepCode({ tx, email, ip, lang = null }) {
  if (!(await demoRow(tx))) throw conflict("This workspace is already a real account.", { code: "not_demo" });
  email = String(email ?? "").trim().toLowerCase();
  if (!looksLikeEmail(email)) throw invalid("Enter a valid email address.", { field: "email" });
  if (localAuthEnabled()) { if (process.env.KEYSTONE_SELF_HOST !== "1") await ensureLocalIdentity(email); }
  else { try { await getFirebaseAuth().createUser({ email, emailVerified: false }); } catch (err) { if (err?.code !== "auth/email-already-exists") throw dependency("Saving is not available right now.", err); } }
  let uid = null; try { uid = await uidOf(email); } catch { /* the code request below gives the person nothing either way */ }
  if (uid && (await tenantsOf(uid)).length) throw conflict("That email already has a Docustay account. Sign in with it instead; this demo will expire on its own.", { code: "exists" });
  return requestEmailCode({ email, purpose: "verify_email", ip, product: "docustay", lang });
}

/** Remove the sample items; whatever the visitor made stays. → how many went. */
async function removeSamples(tenantId, ownerId) {
  const { rows } = await withTenant(tenantId, (tx) => tx.query(`SELECT kind, item_id FROM keystone.docustay_demo_seed`), { userId: ownerId });
  let gone = 0;
  for (const r of rows) {
    try {
      await withTenant(tenantId, (tx) => deleteRecord(tx, { tenantId, object: r.kind === "document" ? "document" : "document_template", id: r.item_id, confirm: true, reason: "demo sample removed on Keep my work", actorUserId: ownerId }), { userId: ownerId });
      gone += 1;
    } catch (e) { console.warn(`demo keep: sample ${r.kind} ${r.item_id} not removed (${e?.message ?? e})`); }
  }
  return gone;
}

/** Step 2: the code is right → the demo becomes a real account. Idempotent for a double click (the second call finds a real account and says so). → { token, ttlHours }. */
export async function keepDemo({ tenantId, ownerId, email, code, policy, ip, userAgent, lang = "en" }) {
  email = String(email ?? "").trim().toLowerCase();
  if (!looksLikeEmail(email)) throw invalid("Enter a valid email address.", { field: "email" });
  if (policy !== true) throw invalid("Please agree to the Terms, Privacy Policy and Data Processing Addendum.", { field: "policy", code: "policy" });
  const live = await withTenant(tenantId, (tx) => demoRow(tx), { userId: ownerId });
  if (!live) throw conflict("This workspace is already a real account.", { code: "not_demo" });
  if (new Date(live.expires_at) <= new Date()) throw conflict("This demo has expired. Start a new one, or create a free account.", { code: "demo_expired" });
  await verifyEmailCode({ email, code: String(code ?? ""), purpose: "verify_email" });   // wrong / expired code → the same plain refusals as sign-up
  const uid = await uidOf(email);
  if ((await tenantsOf(uid)).length) throw conflict("That email already has a Docustay account. Sign in with it instead.", { code: "exists" });
  await removeSamples(tenantId, ownerId);
  await withTenant(tenantId, async (tx) => {
    await tx.query(`UPDATE keystone.app_user SET email = $2, firebase_uid = $3, display_name = $4 WHERE id = $1`, [ownerId, email, uid, email.split("@")[0]]);
    await tx.query(`UPDATE keystone.tenant SET name = $2 WHERE id = $1`, [tenantId, workspaceNameFromEmail(email)]);
    for (const type of ["terms", "privacy", "dpa"]) await tx.query(`INSERT INTO keystone.policy_acceptance (tenant_id, user_id, policy_type, version, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5,$6)`, [tenantId, ownerId, type, CURRENT_POLICY_VERSION, ip ?? null, userAgent ?? null]);
    await tx.query(`DELETE FROM keystone.docustay_demo_mail`);
    await tx.query(`UPDATE keystone.docustay_demo SET converted_at = now() WHERE tenant_id = $1`, [tenantId]);
    await enrol(tx, { tenantId, userId: ownerId, lang });
    await trackOnce(tx, tenantId, "demo_converted_to_account").catch(() => {});
  }, { userId: ownerId });
  await withTenant(tenantId, (tx) => revokeSessionsForUser(tx, tenantId, ownerId, "tenant_changed"), { userId: ownerId }).catch((e) => console.warn(`demo keep: old session not revoked (${e?.message ?? e})`));
  const session = await createSession({ tenantId, appUserId: ownerId, firebaseUid: uid, ttlHours: 12, userAgent, ip, kind: "app" });
  return { token: session.token, ttlHours: 12 };
}
