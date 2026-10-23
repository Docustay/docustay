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
  // R13-D234: a self-hosted install with no Resend key has exactly one way to send anything, the SMTP server its owner saved in Settings → Email. So every message (sign-in codes,
  // invitations, signing mail, system mail) goes there BEFORE any platform sender is looked up: the install has no platform sender, and looking one up threw (/forgot answered 503)
  // or forced "platform" for sign-in mail ("the product has no default sending address"). The hosted service never takes this path: its sign-in mail never depends on a customer's server.
  if (env.KEYSTONE_SELF_HOST === "1" && !emailIsConfigured(env)) {
    const r = await selfHostSmtp({ tx, tenantId, m: { to, subject, html, text, attachments, headers, purpose: "default" } }).catch((e) => { console.error(`self-host smtp: ${e?.message ?? e}`); return null; });
    if (r) return { providerMessageId: r.providerMessageId ?? null, error: r.error ?? null, mode: "smtp", status: r.status, ok: r.status === "sent" };
    return { providerMessageId: null, error: "email is not set up: save an SMTP server in Settings → Email", mode: "none", status: "skipped", ok: false };
  }
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

/** R13-D234: send through a self-hosted install's own SMTP server. The workspace's when it has one saved; with no workspace (a sign-in code before anyone is signed in), the first workspace on the install that saved one. → the send outcome, or null when no workspace has SMTP set up. */
async function selfHostSmtp({ tx, tenantId, m }) {
  const { identityRow } = await import("../mail/identity.mjs");
  const { withTenant } = await import("../db/index.mjs");
  const viaTenant = async (db, t) => ((await identityRow(db)).mode === "smtp" ? mail.sendMail(db, { tenantId: t, ...m }) : null);
  if (tx && tenantId) return viaTenant(tx, tenantId);
  const ids = tenantId ? [tenantId] : await installTenants();
  for (const t of ids) { const r = await withTenant(t, (db) => viaTenant(db, t)); if (r) return r; }
  return null;
}
// the install's workspaces, read as app_worker (the self-host entrypoint gives the app this URL; only auth_owner and app_worker may list workspaces), as scripts/file-keys.mjs does
async function installTenants() {
  const url = process.env.KEYSTONE_WORKER_DATABASE_URL; if (!url) return [];
  const pg = (await import("pg")).default; const c = new pg.Client({ connectionString: url, ssl: process.env.KEYSTONE_DB_SSL === "off" ? false : undefined });
  await c.connect();
  try { return (await c.query(`SELECT tenant_id FROM keystone_auth.list_active_tenant_ids()`)).rows.map((r) => r.tenant_id); } finally { await c.end(); }
}
