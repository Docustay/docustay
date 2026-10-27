// src/product/deletion.mjs — DELETING AN ACCOUNT OR A WORKSPACE THE WAY THE INDUSTRY DOES IT (Round 3, 10 Oct 2026; design: specs/proofs/stage-t/run5/DELETION-DESIGN.md).
// A REQUEST (typed confirmation + a recent sign-in) → a cooling-off period the person can cancel in → the worker runs it → a minimal, name-free record that it happened.
//   · account   — the member's own details are erased to a tombstone, their sessions end, their sign-in identity is removed when nobody else uses it. Documents they SIGNED stay, with the name as signed (the evidence); documents they were only asked to sign and have not are removed.
//   · workspace — the owner's whole organisation, via keystone.delete_workspace() (migration 0695), exactly as before, but after the cooling-off period.
// Everything here runs inside the caller's tenant transaction; the stored files and the identity-provider users are removed AFTER the commit by `afterCommit()`, best effort and reported.
import { createHash } from "node:crypto";
import { conflict, forbidden, invalid, notFound } from "../http/errors.mjs";
import { revokeSessionsForUser } from "../auth/session.mjs";
import { deleteWorkspace, removeLeftovers } from "./workspaceDeletion.mjs";
import { planLossNotice, endPlanForDeletion } from "./docustay.mjs";
import * as mail from "../mail/index.mjs";
import { accountEmail } from "../email/docustayAccountEmails.mjs";
import { languageOfEmail } from "./docustayLanguage.mjs";
import { putLedgerEntry, storageIsConfigured } from "../storage/s3.mjs";
import { getFirebaseAuth } from "../auth/firebase.mjs";

/** The cooling-off period in days. `DOCUSTAY_DELETION_GRACE_DAYS` overrides both (0 = immediate; for self-hosted installs that want it and for tests). */
const GRACE_DAYS = Object.freeze({ account: 14, workspace: 14 });
const REAUTH_MINUTES = 15;
const REMINDER_HOURS = 24;
function graceDays(kind, env = process.env) {
  const raw = env.DOCUSTAY_DELETION_GRACE_DAYS;
  if (raw !== undefined && raw !== "") { const n = Number(raw); if (Number.isInteger(n) && n >= 0 && n <= 90) return n; }
  return GRACE_DAYS[kind];
}
const DAY = 86_400_000;
export const emailHash = (email) => createHash("sha256").update(String(email ?? "").trim().toLowerCase()).digest("hex");
const baseUrl = () => (process.env.KEYSTONE_DOCUSTAY_APP_URL || "https://docustay.app").replace(/\/+$/, "");
const dateText = (d) => new Date(d).toISOString().slice(0, 10);

/** A destructive act needs a sign-in from the last few minutes (not just any live session). `createdAt` is when the CURRENT session began. */
function requireFreshSession(createdAt, { now = new Date(), minutes = REAUTH_MINUTES } = {}) {
  const at = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(at) || now.getTime() - at > minutes * 60_000) throw forbidden("For your security, sign in again to continue — this needs a sign-in from the last few minutes.", { code: "reauth_required", minutes });
}

const present = (r) => r && ({ progress: r.progress ?? null, id: r.id, kind: r.kind, status: r.status, requestedAt: r.requested_at, scheduledFor: r.scheduled_for, cancelledAt: r.cancelled_at, finishedAt: r.finished_at, subjectUserId: r.subject_user_id, requestedBy: r.requested_by });

async function pendingOf(tx, { tenantId, kind, userId = null }) {
  const { rows: [r] } = await tx.query(`SELECT * FROM keystone.deletion_request WHERE tenant_id = $1 AND kind = $2 AND status IN ('pending','running','failed') AND subject_user_id IS NOT DISTINCT FROM $3 ORDER BY requested_at DESC LIMIT 1`, [tenantId, kind, userId]);
  return r ?? null;
}

/** What the screens show: this person's pending account deletion, and the workspace's. Also whether they may start either. */
export async function deletionStatus(tx, { tenantId, userId }) {
  const [account, workspace] = [await pendingOf(tx, { tenantId, kind: "account", userId }), await pendingOf(tx, { tenantId, kind: "workspace" })];
  const { rows: [me] } = await tx.query(`SELECT staff_role FROM keystone.app_user WHERE id = $1`, [userId]);
  const { rows: [{ n }] } = await tx.query(`SELECT count(*)::int AS n FROM keystone.app_user WHERE tenant_id = $1 AND staff_role = 'owner' AND lifecycle_status <> 'former'`, [tenantId]);
  return { account: present(account), workspace: present(workspace), plan: me?.staff_role === "owner" ? await planLossNotice(tx, { tenantId }) : null, isOwner: me?.staff_role === "owner", soleOwner: me?.staff_role === "owner" && n <= 1, graceDays: { account: graceDays("account"), workspace: graceDays("workspace") }, reauthMinutes: REAUTH_MINUTES };
}

async function tell(tx, { tenantId, to, kind, facts = {} }) {
  try {
    const lang = await languageOfEmail(tx, { tenantId, email: to });
    const { subject, text, html } = accountEmail(kind, { facts, lang });
    return await mail.sendMail(tx, { tenantId, to, subject, text, html, purpose: "platform", product: "docustay" });
  } catch (e) { return { status: "failed", error: String(e?.message ?? e).slice(0, 200) }; }   // a failed email never blocks, cancels or half-does a deletion
}


/** Start deleting my own account. Typed confirmation = my email address. A sole owner must hand over or delete the workspace first. */
export async function requestAccountDeletion(tx, { tenantId, userId, confirm, sessionCreatedAt, now = new Date() }) {
  requireFreshSession(sessionCreatedAt, { now });
  const { rows: [u] } = await tx.query(`SELECT id, email, display_name, staff_role, protected_real_client, lifecycle_status FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`, [userId, tenantId]);
  if (!u) throw notFound("That account does not exist.");
  if (u.protected_real_client) throw forbidden("This account is marked as a real client's and cannot be deleted here.", { code: "protected" });
  if (String(confirm ?? "").trim().toLowerCase() !== String(u.email).toLowerCase()) throw invalid("Type your email address exactly to confirm.", { field: "confirm", code: "confirm_mismatch" });
  if (u.staff_role === "owner") {
    const { rows: [{ n }] } = await tx.query(`SELECT count(*)::int AS n FROM keystone.app_user WHERE tenant_id = $1 AND staff_role = 'owner' AND lifecycle_status <> 'former' AND id <> $2`, [tenantId, userId]);
    if (n === 0) throw conflict("You are the only owner of this workspace. Make someone else an owner first, or delete the whole workspace instead.", { code: "sole_owner" });
  }
  const existing = await pendingOf(tx, { tenantId, kind: "account", userId });
  if (existing) return { ...present(existing), alreadyRequested: true };
  const days = graceDays("account");
  const when = new Date(now.getTime() + days * DAY);
  const { rows: [r] } = await tx.query(`INSERT INTO keystone.deletion_request (tenant_id, kind, subject_user_id, requested_by, requested_at, scheduled_for) VALUES ($1,'account',$2,$2,$3,$4) RETURNING *`, [tenantId, userId, now, when]);
  await tell(tx, { tenantId, to: u.email, kind: "account_scheduled", facts: { date: dateText(when), immediate: days === 0 } });
  return { ...present(r), alreadyRequested: false };
}

/** Start deleting the whole workspace. Owner only, typed name, paid plan cancelled first (all as before); the work waits out the cooling-off period. */
export async function requestWorkspaceDeletion(tx, { tenantId, actorUserId, confirm, acknowledgePlanLoss = false, sessionCreatedAt, now = new Date() }) {
  requireFreshSession(sessionCreatedAt, { now });
  const { rows: [t] } = await tx.query(`SELECT slug, name, is_reference, is_platform FROM keystone.tenant WHERE id = $1`, [tenantId]);
  if (!t) throw notFound("That workspace does not exist.");
  if (t.is_reference || t.is_platform) throw forbidden(`The ${t.slug} workspace is permanent and cannot be deleted.`);
  const { rows: [a] } = await tx.query(`SELECT staff_role FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`, [actorUserId, tenantId]);
  if (a?.staff_role !== "owner") throw forbidden("Only an owner of this workspace can delete it.");
  const typed = String(confirm ?? "").trim().toLowerCase();
  if (!typed || (typed !== String(t.name).trim().toLowerCase() && typed !== String(t.slug).toLowerCase())) throw invalid("Type the workspace's name exactly to confirm.", { field: "confirm", code: "confirm_mismatch" });
  const existing = await pendingOf(tx, { tenantId, kind: "workspace" });
  if (existing) return { ...present(existing), alreadyRequested: true };
  // A paid plan no longer blocks deletion (21 Oct 2026): it ENDS NOW, but only after the owner has been told, in numbers, what is lost and has said they understand (no refund, no credit, not recoverable).
  const notice = await planLossNotice(tx, { tenantId, now });
  if (notice.kind !== "none" && acknowledgePlanLoss !== true) throw conflict(notice.kind === "lifetime" ? "Deleting this workspace ends Lifetime, which was a one-time purchase and cannot be recovered. Confirm that you understand." : `Deleting this workspace ends your ${notice.planName} plan now. Confirm that you understand the paid days left are lost.`, { code: "plan_loss_unacknowledged", notice });
  const ended = await endPlanForDeletion(tx, { tenantId, actorUserId });
  const days = graceDays("workspace");
  const when = new Date(now.getTime() + days * DAY);
  const { rows: [r] } = await tx.query(`INSERT INTO keystone.deletion_request (tenant_id, kind, requested_by, requested_at, scheduled_for) VALUES ($1,'workspace',$2,$3,$4) RETURNING *`, [tenantId, actorUserId, now, when]);
  const { rows: owners } = await tx.query(`SELECT email FROM keystone.app_user WHERE tenant_id = $1 AND staff_role = 'owner' AND lifecycle_status <> 'former' AND email NOT LIKE '%@deleted.invalid'`, [tenantId]);
  for (const o of owners) await tell(tx, { tenantId, to: o.email, kind: "workspace_scheduled", facts: { date: dateText(when), name: t.name, immediate: days === 0, planEnded: ended.ended ? ended.planName : "", daysLost: ended.daysLeft ?? 0, lifetime: ended.kind === "lifetime" } });
  return { ...present(r), alreadyRequested: false, planEnded: ended.ended ? { kind: ended.kind, planName: ended.planName, daysLost: ended.daysLeft ?? 0 } : null };
}

/** "Delete now" (26 Oct 2026): the owner skips the cooling-off period. Same checks as scheduling (owner, typed name, a recent sign-in, the plan-loss acknowledgement); the request is made due this moment and the caller wakes the worker. */
export async function requestWorkspaceDeletionNow(tx, { tenantId, actorUserId, confirm, acknowledgePlanLoss = false, sessionCreatedAt, now = new Date() }) {
  const r = await requestWorkspaceDeletion(tx, { tenantId, actorUserId, confirm, acknowledgePlanLoss, sessionCreatedAt, now });
  const { rows: [due] } = await tx.query(`UPDATE keystone.deletion_request SET scheduled_for = $2, requested_at = LEAST(requested_at, $2), progress = 'queued', attempts = 0, status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END WHERE id = $1 AND status IN ('pending','failed') RETURNING *`, [r.id, now]);
  if (!due) throw conflict("It is already being deleted.", { code: "already_running" });
  return { ...r, ...present(due), now: true };
}

/** What the worker is doing, for the progress screen. */
export async function setProgress(tx, { tenantId, requestId, progress }) {
  await tx.query(`UPDATE keystone.deletion_request SET progress = $3 WHERE id = $1 AND tenant_id = $2`, [requestId, tenantId, progress]);
}

/** Change my mind. An account request is cancelled by that person; a workspace request by any owner. */
export async function cancelDeletion(tx, { tenantId, kind, actorUserId }) {
  if (kind !== "account" && kind !== "workspace") throw invalid("kind must be account or workspace", { field: "kind" });
  if (kind === "workspace") {
    const { rows: [a] } = await tx.query(`SELECT staff_role FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`, [actorUserId, tenantId]);
    if (a?.staff_role !== "owner") throw forbidden("Only an owner of this workspace can keep it.");
  }
  const r = await pendingOf(tx, { tenantId, kind, userId: kind === "account" ? actorUserId : null });
  if (!r || !["pending", "failed"].includes(r.status)) throw conflict(r ? "It is already being deleted and can no longer be stopped." : "Nothing is scheduled for deletion.", { code: r ? "already_running" : "nothing_pending" });
  const { rows: [done] } = await tx.query(`UPDATE keystone.deletion_request SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2 WHERE id = $1 AND status IN ('pending','failed') RETURNING *`, [r.id, actorUserId]);
  if (!done) throw conflict("It is already being deleted and can no longer be stopped.", { code: "already_running" });
  const { rows: [who] } = await tx.query(`SELECT email FROM keystone.app_user WHERE id = $1`, [actorUserId]);
  if (who?.email) await tell(tx, { tenantId, to: who.email, kind: kind === "account" ? "kept_account" : "kept_workspace" });
  return present(done);
}

/** My own data as one JSON document (GDPR Art. 15/20): profile, notification settings, documents I created, and what I am a party to. Never secrets. */
export async function exportAccount(tx, { tenantId, userId, documents = null }) {
  const { rows: [u] } = await tx.query(`SELECT id, email, secondary_email, display_name, first_name, last_name, preferred_name, pronouns, mobile_phone, timezone, bio, staff_role, role, lifecycle_status, created_at, last_seen_at FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`, [userId, tenantId]);
  if (!u) throw notFound("That account does not exist.");
  const created = documents?.documentsCreatedBy ? await documents.documentsCreatedBy(tx, { userId }) : [];
  const { rows: prefs } = await tx.query(`SELECT * FROM keystone.notification_preference WHERE app_user_id = $1`, [userId]);
  const asParty = documents?.personReport ? (await documents.personReport(tx, { email: u.email })).documents : [];
  return { generatedAt: new Date().toISOString(), format: "docustay-account-export/1", account: u, notificationPreferences: prefs.map(({ id, tenant_id, ...rest }) => rest), documentsCreated: created, documentsAsParty: asParty };
}

// ── the worker half ─────────────────────────────────────────────────────────────

const TOMBSTONE_NULLS = ["secondary_email", "first_name", "last_name", "preferred_name", "pronouns", "date_of_birth", "mobile_phone", "home_phone", "preferred_contact_method", "address_line1", "address_line2", "city", "state_region", "postcode", "country", "timezone", "source", "notes", "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone", "sobriety_date", "recovery_programme", "sponsor_name", "support_network", "consent_status", "lead_next_step", "booking_slug", "stripe_customer_id", "bio", "photo_url", "care_note", "lead_service_id", "lead_service_name", "lead_best_time_date", "lead_best_time_window", "lead_best_time_time", "lead_attribution", "lead_best_time_days", "score_cache", "score_reasons", "firebase_uid"];

/** Erase one person to a tombstone inside the workspace's transaction. Returns what the application must do after the commit. Not reversible. */
async function eraseAccount(tx, { tenantId, request, documents }) {
  const { rows: [u] } = await tx.query(`SELECT id, email, staff_role FROM keystone.app_user WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [request.subject_user_id, tenantId]);
  if (!u) return { identity: null, hash: null, gone: true };
  const hash = emailHash(u.email);
  if (u.staff_role === "owner") {
    const { rows: [{ n }] } = await tx.query(`SELECT count(*)::int AS n FROM keystone.app_user WHERE tenant_id = $1 AND staff_role = 'owner' AND lifecycle_status <> 'former' AND id <> $2`, [tenantId, u.id]);
    if (n === 0) throw conflict("This person is now the only owner of the workspace; the deletion cannot run until another owner exists.", { code: "sole_owner" });
  }
  if (documents?.erasePerson) await documents.erasePerson(tx, { tenantId, email: u.email, actorUserId: null });   // signer-side details on documents (the island's own rules: signed stays)
  await revokeSessionsForUser(tx, tenantId, u.id, "admin").catch(() => {});
  const { rows: [{ uid }] } = await tx.query(`SELECT keystone.remove_account_identity($1) AS uid`, [request.id]);   // before the tombstone: it reads the person's identity
  const sets = TOMBSTONE_NULLS.map((c) => `${c} = NULL`).join(", ");
  await tx.query(`UPDATE keystone.app_user SET email = $3, display_name = 'Deleted user', ${sets}, staff_role = CASE WHEN staff_role = 'owner' THEN NULL ELSE staff_role END, lifecycle_status = 'former', do_not_email = true, do_not_text = true, do_not_call = true, accepting_new_bookings = false, archived_at = coalesce(archived_at, now()), updated_at = now() WHERE id = $1 AND tenant_id = $2`, [u.id, tenantId, `deleted-${u.id}@deleted.invalid`]);
  for (const sql of [`DELETE FROM keystone.device_token WHERE app_user_id = $1`, `DELETE FROM keystone.notification WHERE recipient_id = $1`, `DELETE FROM keystone.notification_preference WHERE app_user_id = $1`]) {
    await tx.query("SAVEPOINT erase_step");
    try { await tx.query(sql, [u.id]); await tx.query("RELEASE SAVEPOINT erase_step"); } catch { await tx.query("ROLLBACK TO SAVEPOINT erase_step"); }   // a table this role may not clear is left; the person's identity is already gone
  }
  await tx.query(`SELECT keystone.record_account_deletion($1, $2)`, [request.id, hash]);
  return { identity: uid ?? null, hash, email: u.email };
}

/** Run one due request: claim it, do the database part, mark it done. `documents` is the Documents front door (injected so the island stays behind its wall). Returns the after-commit work. */
export async function runRequest(tx, { tenantId, requestId, documents = null, now = new Date() }) {
  const { rows: [claimed] } = await tx.query(`UPDATE keystone.deletion_request SET status = 'running', attempts = attempts + 1 WHERE id = $1 AND tenant_id = $2 AND status IN ('pending','running','failed') AND scheduled_for <= $3 RETURNING *`, [requestId, tenantId, now]);
  if (!claimed) return { ran: false };
  if (claimed.kind === "account") {
    const out = await eraseAccount(tx, { tenantId, request: claimed, documents });
    await tx.query(`UPDATE keystone.deletion_request SET status = 'done', finished_at = now(), failure = NULL WHERE id = $1`, [claimed.id]);
    return { ran: true, kind: "account", identities: out.identity ? [out.identity] : [], storageKeys: [], notify: out.email ? [out.email] : [], hash: out.hash, tenantId, requestId: claimed.id };
  }
  const { rows: owners } = await tx.query(`SELECT id, email FROM keystone.app_user WHERE tenant_id = $1 AND staff_role = 'owner' AND lifecycle_status <> 'former' ORDER BY (id = $2) DESC, created_at`, [tenantId, claimed.requested_by]);
  if (!owners.length) throw conflict("The workspace has no owner left to carry out its deletion.", { code: "no_owner" });
  const { rows: [t] } = await tx.query(`SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const out = await deleteWorkspace(tx, { tenantId, actorUserId: owners[0].id, actorEmail: owners[0].email, confirm: t.name });
  return { ran: true, kind: "workspace", identities: out.identities, storageKeys: out.storageKeys, notify: [], workspaceName: out.name, tenantId, requestId: claimed.id, slug: out.slug };
}

/** Record that a run failed (called from a fresh transaction after the failed one rolled back). */
export async function markFailed(tx, { tenantId, requestId, error }) {
  await tx.query(`UPDATE keystone.deletion_request SET status = 'failed', attempts = attempts + 1, failure = $3 WHERE id = $1 AND tenant_id = $2 AND status IN ('running','pending','failed')`, [requestId, tenantId, String(error?.message ?? error).slice(0, 300)]).catch(() => {});
}

/** The reminder two days before (once). Returns how many were sent. */
export async function sendReminders(tx, { tenantId, now = new Date() }) {
  const { rows } = await tx.query(`SELECT r.*, u.email AS subject_email FROM keystone.deletion_request r LEFT JOIN keystone.app_user u ON u.id = r.subject_user_id WHERE r.tenant_id = $1 AND r.status = 'pending' AND r.reminder_sent_at IS NULL AND r.scheduled_for <= $2 AND r.scheduled_for - r.requested_at > interval '${REMINDER_HOURS} hours'`, [tenantId, new Date(now.getTime() + REMINDER_HOURS * 3_600_000)]);
  let n = 0;
  for (const r of rows) {
    const to = r.kind === "account" ? [r.subject_email] : (await tx.query(`SELECT email FROM keystone.app_user WHERE tenant_id = $1 AND staff_role = 'owner' AND lifecycle_status <> 'former'`, [tenantId])).rows.map((x) => x.email);
    for (const e of to.filter(Boolean)) await tell(tx, { tenantId, to: e, kind: r.kind === "account" ? "reminder_account" : "reminder_workspace", facts: { date: dateText(r.scheduled_for) } });
    await tx.query(`UPDATE keystone.deletion_request SET reminder_sent_at = now() WHERE id = $1`, [r.id]);
    n += 1;
  }
  return n;
}

/** The "it's done" email for an account (the workspace still exists to send it from). */
export async function sendDone(tx, { tenantId, to }) {
  return tell(tx, { tenantId, to, kind: "account_done" });
}

/** After the commit: stored files, identity-provider users, the "it's done" email, and the ledger object that makes a restore replay the deletion. Best effort, honest about failures. */
export async function afterCommit(done, { log = console, send = null, ledger = writeLedger, auth = null, remove = undefined } = {}) {
  const cleanup = await removeLeftovers({ storageKeys: done.storageKeys ?? [], identities: done.identities ?? [] }, { log, auth, ...(remove ? { remove } : {}) });
  let ledgered = false;
  try { ledgered = await ledger(done); } catch (e) { log.error?.(`[deletion] could not write the ledger entry: ${e?.message}`); }
  if (send) for (const to of done.notify ?? []) { try { await send({ to, done }); } catch { /* the deletion is done; a missing email is not a failure */ } }
  return { ...cleanup, ledgered };
}

/** The ledger entry: what a restore must replay. Account → the SHA-256 of the address; workspace → its id. Nothing else (no names, no addresses). Kept in object storage, outside the database a restore rewinds. */
async function writeLedger(done) {
  const entry = done.kind === "account" ? { v: 1, kind: "account", emailHash: done.hash, tenantId: done.tenantId, requestId: done.requestId, at: new Date().toISOString() } : { v: 1, kind: "workspace", tenantId: done.tenantId, requestId: done.requestId, at: new Date().toISOString() };
  if (!storageIsConfigured()) return false;
  const r = await putLedgerEntry({ name: `${entry.at.slice(0, 10)}-${entry.kind}-${entry.requestId}`, body: Buffer.from(JSON.stringify(entry)) });
  if (!r.ok) throw new Error(r.error ?? "the ledger entry was not stored");
  return true;
}


