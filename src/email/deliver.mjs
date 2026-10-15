// src/email/deliver.mjs — THE HOST'S ONE DOOR FOR EVERY DIRECT (non-notification) EMAIL: a lead thank-you, a client invite, a document link, a signed copy, a gift card, a referral, a template test.
// Who it is from, and how many a day an organisation may send, are the MAIL MODULE's answers (src/mail); this file only adds the host's provider call with its injectable fetch/env. Nothing here picks a From address.
//   identity → daily limit → (own SMTP: the module sends) | (otherwise: environment backstop → provider)
import * as mail from "../mail/index.mjs";
import { sendViaResend, emailIsConfigured } from "./resend.mjs";
import { redirectForEnvironment } from "./redirect.mjs";

/**
 * @param {object} tx tenant transaction
 * @param {{tenantId:string,to:string,subject:string,text:string,html?:string|null,attachments?:Array|null,purpose?:string,fromNameSuffix?:string}} m
 * @returns {Promise<{status:'sent'|'skipped'|'failed'|'limit_reached', providerMessageId:string|null, error:string|null, mode:string, ok:boolean}>}
 */
export async function deliverAsOrganisation(tx, { tenantId, to, subject, text, html = null, attachments = null, headers = null, purpose = "default", fromNameSuffix = "", product = null }, { fetchImpl, env = process.env } = {}) {
  // no organisation context (sign-in codes sent before anyone is signed in, platform alerts): the product's own fixed sender
  const identity = tx && tenantId ? await mail.resolveIdentity(tx, { tenantId, purpose, product })
    : (() => { const ps = mail.productSenderFor(mail.productKeyOf(product, env), env); return { mode: "platform", fixed: true, fromName: ps.name, fromAddress: ps.address, replyTo: null, orgName: "", product: ps.name, platform: ps }; })();
  const done = (o) => ({ providerMessageId: null, error: null, mode: identity.mode, ...o, ok: o.status === "sent" });
  if (identity.mode === "smtp" && tx) {
    const r = await mail.sendMail(tx, { tenantId, to, subject, html, text, attachments, headers, purpose });
    return done({ status: r.status, providerMessageId: r.providerMessageId, error: r.error });
  }
  // Launch step 8: a demo workspace sends nothing; the message is recorded for its demo inbox
  if (tx && tenantId) { const h = await mail.holdMessage(tx, { to, subject, text, html }); if (h) return done({ status: "sent", providerMessageId: h.providerMessageId }); }
  if (!emailIsConfigured(env)) return done({ status: "skipped", error: "RESEND_API_KEY is not set" });
  if (!identity.fixed) {
    const lim = await mail.checkLimit(tx, { tenantId });
    if (lim.reached) return done({ status: "limit_reached", error: `daily sending limit reached (${lim.limit} a day)` });
  }
  let from = mail.fromLine(identity).from;
  const replyTo = mail.fromLine(identity).replyTo;
  if (fromNameSuffix) from = from.replace(/^"([^"]*)"/, (_, n) => `"${n}${fromNameSuffix}"`);
  let routed;
  try { routed = redirectForEnvironment({ to, subject }, env); } catch (e) { return done({ status: "skipped", error: e.message }); }
  const o = await sendViaResend({ to: routed.to, from, subject: routed.subject, text, ...(headers ? { headers } : {}), ...(html ? { html } : {}), ...(replyTo ? { replyTo } : {}), ...(attachments ? { attachments } : {}), tenantId }, { fetchImpl, env });
  if (!o.ok) return done({ status: "failed", error: o.error, kind: o.kind ?? null, retryAfterSeconds: o.retryAfterSeconds ?? null });
  if (tx && tenantId) await mail.recordMessage(tx, { tenantId, providerMessageId: o.providerMessageId });
  if (!identity.fixed) await mail.countSend(tx, { tenantId });
  return done({ status: "sent", providerMessageId: o.providerMessageId });
}
