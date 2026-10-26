// Deleting a workspace (Run 4, 10 Oct 2026): the owner closes the whole organisation. The database half is keystone.delete_workspace() (migration 0695: owner-only, every row in foreign-key order, one platform-level record that outlives the workspace);
// this file is the application half: the typed confirmation, the paid-plan check, and — after the database has committed — the stored files and the sign-in identities that belonged only to this workspace.
import { forbidden, invalid, notFound } from "../http/errors.mjs";
import { deleteObject, storageIsConfigured } from "../storage/s3.mjs";
import { getFirebaseAuth } from "../auth/firebase.mjs";

const PAID_STATES = new Set(["active", "trialing", "past_due", "unpaid"]);

/** The part that runs in the workspace's own transaction. Returns what the cleanup after the commit needs. */
export async function deleteWorkspace(tx, { tenantId, actorUserId, actorEmail = null, confirm }) {
  const { rows: [t] } = await tx.query(`SELECT slug, name FROM keystone.tenant WHERE id = $1`, [tenantId]);
  if (!t) throw notFound("That workspace does not exist.");
  const typed = String(confirm ?? "").trim().toLowerCase();
  if (!typed || (typed !== String(t.name).trim().toLowerCase() && typed !== String(t.slug).toLowerCase())) throw invalid("Type the workspace's name exactly to confirm.");
  const { rows: [sub] } = await tx.query(`SELECT plan_key, status, stripe_subscription_id FROM keystone.mainstay_subscription WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  if (sub?.stripe_subscription_id && PAID_STATES.has(String(sub.status)) && sub.plan_key && !/free$/.test(sub.plan_key)) throw forbidden("This workspace has a paid plan. Cancel it first (Billing → Manage plan), then delete the workspace.");
  let out;
  try { out = (await tx.query(`SELECT keystone.delete_workspace($1, $2, $3) AS j`, [tenantId, actorUserId, actorEmail])).rows[0].j; }
  catch (e) { if (e?.code === "42501") throw forbidden(String(e.message).replace(/^.*?:\s*/, "")); throw e; }
  return { slug: out.slug, name: out.name, rowsRemoved: out.rows_removed ?? {}, storageKeys: out.storage_keys ?? [], identities: out.firebase_uids ?? [] };
}

/** After the commit: the stored files and the identities. Best effort and honest — it says how many it could not remove; the database side is already done and a leftover file or login belongs to nobody. */
export async function removeLeftovers({ storageKeys = [], identities = [] }, { log = console, remove = deleteObject, auth = null } = {}) {
  let filesRemoved = 0, filesFailed = 0, identitiesRemoved = 0, identitiesFailed = 0;
  if (storageKeys.length && storageIsConfigured()) {
    for (const key of storageKeys) { try { const r = await remove({ key }); if (r.ok) filesRemoved += 1; else filesFailed += 1; } catch { filesFailed += 1; } }
  } else filesFailed += storageKeys.length;
  for (const uid of identities) {
    if (String(uid).startsWith("local:")) { identitiesRemoved += 1; continue; }   // the built-in identity: removed inside the database transaction
    try { await (auth ?? getFirebaseAuth()).deleteUser(uid); identitiesRemoved += 1; } catch (e) { if (e?.code === "auth/user-not-found") identitiesRemoved += 1; else { identitiesFailed += 1; log.error?.(`[workspace-deletion] could not remove sign-in identity: ${e?.code ?? e?.message}`); } }
  }
  return { filesRemoved, filesFailed, identitiesRemoved, identitiesFailed };
}
