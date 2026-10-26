// src/documents/emailIdentity.mjs — THE ORGANISATION'S SENDING IDENTITY, as the Documents island uses it. The identity itself (platform · own domain · SMTP), the sending limit, the domain check and the provider live in the
// shared MAIL MODULE (src/mail/**) — one identity per organisation, the same for every email family (Batch A, the maintainer 3 Oct 2026). This file keeps the island's own names for them and adds what is the island's alone:
// the signing email's frame, which provider message carried which person's invitation, and what a bounce does to a document.
// ★ The island reaches the mail module only through src/mail/index.mjs; the module reaches the host only through its ports (src/ports/mail.mjs).
import * as mail from "../mail/index.mjs";
import { emailIsConfigured } from "../email/resend.mjs";
import { conflict } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
import { leadOf } from "./parties.mjs";
import { emit } from "../events/outbox.mjs";
import { footerBrandFor } from "./chromeInputs.mjs";
import { wordingFor, render as renderWording } from "./emailMessages.mjs";
import { logEmail, noteDelivery, pausedRefusal } from "./emailLog.mjs";
import { emailLogoUrl } from "../branding/publicLogo.mjs";

/** The identity the next email is sent with — never contains a secret. */
export const getIdentity = (tx, { tenantId }) => mail.resolveIdentity(tx, { tenantId });

/** Send one email with the organisation's identity. `attachments` are `[{filename, content: base64}]`. Returns {status:'sent'|'skipped'|'failed'|'limit_reached', providerMessageId, error, mode}. */
export async function sendMail(tx, { tenantId, to, subject, html, text, attachments = null, log = null }) {
  // FP-K6 — a paused workspace sends nothing, and says why (the refusal is logged too, so the log is the whole story)
  const refusal = await pausedRefusal(tx, { tenantId });
  if (refusal) { if (log) await logEmail(tx, { tenantId, ...log, to, subject, outcome: { status: "paused", error: refusal } }); return { status: "failed", providerMessageId: null, error: refusal, paused: true }; }
  const out = await mail.sendMail(tx, { tenantId, to, subject, html, text, attachments });
  if (log) await logEmail(tx, { tenantId, ...log, to, subject, outcome: out });
  return out;
}

/** The signing email through the organisation's identity: the host's React Email frame, then the module sends it. */
/** FP-K2/K3 — the workspace's own wording for this email, applied under what the sender chose for THIS document: a document's own subject and message win; then the workspace's; then the standard. */
async function withWorkspaceWording(tx, opts, wording = null) {
  const w = wording ?? await wordingFor(tx, { kind: opts.isReminder ? "reminder" : "invitation", locale: opts.language ?? "en" });
  if (!w?.custom) return opts;
  const r = renderWording(w, { "signer.name": opts.recipientName ?? "", "signer.email": opts.to ?? "", "document.title": opts.documentTitle ?? "", "sender.name": opts.senderName ?? "", "org.name": opts.practiceName ?? "", link: opts.link ?? "" });
  const out = { ...opts };
  if (!(typeof out.subject === "string" && out.subject.trim()) && r.subject) out.subject = r.subject;
  if (!(typeof out.message === "string" && out.message.trim()) && r.body) out.message = r.body;
  if (r.buttonLabel) out.buttonLabel = r.buttonLabel;
  if (r.preview) out.preview = r.preview;
  if (r.footer) out.customFooter = r.footer;
  return out;
}

export async function sendSigningMail(tx, { tenantId, log = null, ...given }) {
  const refusal = await pausedRefusal(tx, { tenantId });
  if (refusal) { if (log) await logEmail(tx, { tenantId, ...log, to: given.to, subject: given.subject ?? given.documentTitle ?? "", outcome: { status: "paused", error: refusal } }); await tellSenderNotSent(tx, { tenantId, log, outcome: { status: "failed" } }); return { status: "failed", providerMessageId: null, error: refusal, paused: true }; }
  const out = await sendSigningMailInner(tx, { tenantId, ...given });
  if (log) await logEmail(tx, { tenantId, ...log, to: given.to, subject: out.subject ?? given.subject ?? given.documentTitle ?? "", outcome: out });
  await tellSenderNotSent(tx, { tenantId, log, outcome: out });
  return out;
}

/** R13-D413: an invitation or reminder that could not be sent at all (the provider failed, today's limit, a paused workspace) reaches the sender the way a bounce does:
 *  the same event, so the same "Something needs you" notice, preference and webhook carry it, with reason not_sent. A practice (test) document stays quiet. */
async function tellSenderNotSent(tx, { tenantId, log, outcome }) {
  if (!log?.instanceId || log.isTest === true || !["invitation", "reminder"].includes(log.kind)) return;
  if (!["failed", "limit_reached"].includes(outcome?.status)) return;
  await emit(tx, { tenantId, topic: "documents.document.bounced", emittedBy: "documents", subjectType: "document", subjectId: log.instanceId, actor: "system",
    payload: { role: log.seat ?? null, builder: "pdf", reason: "not_sent", status: outcome.status } }).catch(() => {});   // telling must never undo the send's own outcome
}

/** The signing email's options exactly as they are sent: the workspace's wording (or `wording`, an unsaved draft for a preview) under this document's own choices, then the product's footer line. The preview uses this too, so it shows what is sent. */
export async function signingMailOptions(tx, { tenantId, wording = null, ...given }) {
  let opts = await withWorkspaceWording(tx, given, wording);
  if ("logoUrl" in opts) opts = { ...opts, logoUrl: emailLogoUrl(opts.logoUrl, opts.link, tenantId) };   // R13-D492
  // the product's own footer line (free Docustay plan) — undefined leaves the host's default wording alone
  const { footer } = await footerBrandFor(tx, { tenantId });
  if (footer !== undefined && opts.footer === undefined) opts = { ...opts, footer };
  return opts;
}

async function sendSigningMailInner(tx, { tenantId, ...given }) {
  const opts = await signingMailOptions(tx, { tenantId, ...given });
  const P = await ports();
  // Launch step 8: a demo workspace sends nothing — the rendered invitation is recorded for its demo inbox (the signing link is inside it) and the send carries on as if it had gone
  const held = await mail.holdMessage(tx, async () => { const r = await P.mailer.renderSigningEmail(opts); return { to: opts.to, subject: r.subject, text: r.text, html: r.html }; });
  if (held) return { ...held, mode: "held", fallbackReason: null };
  let identity = await mail.resolveIdentity(tx, { tenantId });
  // FP-K3 — this document's own reply-to and sender name, when the sender chose them
  if (opts.replyTo) identity = { ...identity, replyTo: opts.replyTo };
  if (opts.fromName) identity = { ...identity, orgName: opts.fromName, fromName: opts.fromName };
  if (identity.mode === "smtp" || identity.mode === "mailbox") {
    const r = await P.mailer.renderSigningEmail(opts);
    return mail.sendMail(tx, { tenantId, to: opts.to, subject: r.subject, html: r.html, text: r.text });
  }
  const lim = await mail.checkLimit(tx, { tenantId });
  if (lim.reached) return { status: "limit_reached", providerMessageId: null, error: `This organisation has reached its daily sending limit (${lim.limit}).`, mode: identity.mode, limit: lim };
  // the organisation chose its own sender and it cannot be used: the mail still goes from the platform address, and that is recorded for the settings screen — never silent
  if (identity.requested !== "platform" && identity.fallbackReason) await mail.noteFallback(tx, { tenantId, reason: identity.fallbackReason });
  const out = { ...(await P.mailer.sendSigningEmail({ ...opts, identity })), mode: identity.mode, fallbackReason: identity.fallbackReason };
  if (out.status === "sent") { await mail.countSend(tx, { tenantId }); await mail.recordMessage(tx, { tenantId, providerMessageId: out.providerMessageId }); }
  return out;
}

/** Remember which provider message carried a person's invitation, so a later bounce can find them. */
export async function recordInvitation(tx, { tenantId, instanceId, to, providerMessageId }) {
  if (!providerMessageId || !to) return;
  const lead = await leadOf(tx, { instanceId });
  if (!lead) return;
  await tx.query(
    `UPDATE keystone.document_party SET email_message_id = $3, email_delivery = NULL, updated_at = now() WHERE tenant_id = $1 AND instance_id = $2 AND lower(email) = lower($4)`,
    [tenantId, lead, providerMessageId, to]);
}

/**
 * A delivery event from the mail provider (delivered · bounced · complained) about a message this island sent. Finds the person it carried, records it on them and on the document's audit trail;
 * a bounce marks the person "bounced" — the document then shows "fix the address". Returns {applied}. A message that is not ours is reported, never thrown (the provider would retry it forever).
 */
export async function noteEmailDelivery(tx, { tenantId, providerMessageId, type, kind: given }) {
  const kind = given ?? { "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "complained" }[type];
  if (!kind || !providerMessageId) return { applied: false, reason: "not_a_delivery_event" };
  await noteDelivery(tx, { tenantId, providerMessageId, kind });   // FP-K4/K6: the email log, the workspace's webhooks and the sending guard hear about it first
  const { rows: [party] } = await tx.query(
    `SELECT id, instance_id, role FROM keystone.document_party WHERE tenant_id = $1 AND email_message_id = $2 LIMIT 1`, [tenantId, providerMessageId]);
  if (!party) return { applied: false, reason: "not_a_document_message" };
  await tx.query(
    `UPDATE keystone.document_party SET email_delivery = $2, status = CASE WHEN $2 = 'bounced' AND status = 'pending' THEN 'bounced' ELSE status END, updated_at = now() WHERE id = $1`, [party.id, kind]);
  await recordAuditEvent(tx, { tenantId, instanceId: party.instance_id, kind, actorRole: party.role });
  // ★ §23.15.1 — the sender is told when an invitation bounces (the notice reaches them by the host's notice machinery, honouring their preferences)
  if (kind === "bounced") await emit(tx, { tenantId, topic: "documents.document.bounced", emittedBy: "documents", subjectType: "document", subjectId: party.instance_id, actor: "system", payload: { role: party.role, builder: "pdf" } });
  return { applied: true, kind };
}

// ── the sending domain and the settings screen's view of it (all of it the module's) ──
export const identityStatus = (tx, { tenantId }) => mail.mailStatus(tx, { tenantId });
// R13-D367: a sending domain is verified through the email provider (Resend). An install that sends through its own mail server has none, and was told to add RESEND_API_KEY although its email worked: say what applies instead.
export async function startDomain(tx, { tenantId, domain }, env = process.env) {
  if (env.KEYSTONE_SELF_HOST === "1" && !emailIsConfigured(env)) throw conflict("This install sends email through your own mail server, so the sending address is the one set in Settings, Email; nothing is verified here. A sending domain needs the Resend provider (RESEND_API_KEY on the app and the worker).", { code: "domain_needs_provider" });
  await mail.startDomain(tx, { tenantId, domain }); return identityStatus(tx, { tenantId });
}
export async function verifyDomain(tx, { tenantId }) { await mail.verifyDomainNow(tx, { tenantId }); return identityStatus(tx, { tenantId }); }
/** R13-D015 — take the sending domain off this workspace (the row only; the domain at the email provider is left as it is, since it may be shared). Returns the screen's new view. */
export async function removeDomain(tx, { tenantId }) { await mail.removeDomain(tx, { tenantId }); return identityStatus(tx, { tenantId }); }
export async function saveSmtpPassword(tx, { tenantId, password, updatedBy = null }) { await mail.saveSmtpPassword(tx, { tenantId, password, updatedBy }); return identityStatus(tx, { tenantId }); }
export const startMailbox = (tx, { tenantId, userId = null, provider }) => mail.startMailboxConnect(tx, { tenantId, userId, provider });
export const removeMailbox = (tx, { tenantId, updatedBy = null }) => mail.removeMailbox(tx, { tenantId, updatedBy });
export const sendTestEmail = (tx, { tenantId, to }) => mail.sendTestEmail(tx, { tenantId, to });
