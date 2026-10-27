// src/mail/send.mjs — SENDING. One door for every email that is not a the platform notification (which keeps its own delivery record and hands the From/Reply-To/limit questions to this module):
// identity → environment backstop → per-organisation daily limit → provider (Resend) or the organisation's own SMTP server. Every outcome is returned, never thrown for a delivery failure.
//   status: sent | skipped (environment refused, or no provider configured) | failed | limit_reached
import nodemailer from "nodemailer";
import { ports } from "./ports.mjs";
import { resolveIdentity, fromLine, identityRow, secretRow, SMTP_SECRET, noteFallback } from "./identity.mjs";
import { sendViaMailbox } from "./mailbox.mjs";
import { resolvePublicHost, DestinationRefused } from "./destination.mjs";

const SMTP_PURPOSE = "document_smtp_password";   // the purpose the sealed envelopes were created under (kept, so existing passwords still open)
const DEFAULT_DAILY_LIMIT = 500;
// ★ S-4 (security audit run 5, 10 Oct 2026): the failure shown to the organisation (and returned by the test email) is ONE FIXED SENTENCE chosen by the kind of failure — never the server's own
//   words. A talkative service on a port the organisation pointed us at would otherwise have its greeting banner read back to them, which turns "test email" into a banner grabber.
const SMTP_FAILURE = Object.freeze({
  refused: "That mail server address is not allowed. It must be a public address.",
  login: "The mail server did not accept the login. Check the user name and password.",
  connect: "Could not connect to the mail server. Check the address, the port and the security setting.",
  envelope: "The mail server did not accept the sender or recipient address.",
  other: "The mail server did not accept the message. Check its settings and try again.",
});
function smtpFailureKind(e) {
  if (e?.code === "DESTINATION_REFUSED" || e instanceof DestinationRefused) return "refused";
  if (e?.code === "EAUTH") return "login";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET", "EDNS", "ETLS"].includes(e?.code)) return "connect";
  if (e?.code === "EENVELOPE") return "envelope";
  return "other";
}

export async function limitState(tx, { tenantId }) {
  // a self-hosted install is never limited: the person running it owns the sending account (the maintainer, 6 Oct 2026)
  if (process.env.KEYSTONE_SELF_HOST === "1") { const { rows } = await tx.query(`SELECT sent FROM keystone.mail_usage WHERE tenant_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date`, [tenantId]); return { limit: null, sent: rows[0]?.sent ?? 0, reached: false, custom: false }; }
  const P = await ports();
  const row = await identityRow(tx);
  const planned = row.daily_limit === null && P.limits?.dailyDefault ? await P.limits.dailyDefault(tx, { tenantId }) : null;
  const limit = row.daily_limit ?? planned ?? (await P.product(tx, { tenantId })).defaultDailyLimit ?? DEFAULT_DAILY_LIMIT;
  const { rows } = await tx.query(`SELECT sent FROM keystone.mail_usage WHERE tenant_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date`, [tenantId]);
  const sent = rows[0]?.sent ?? 0;
  return { limit, sent, reached: sent >= limit, custom: row.daily_limit !== null };
}
/** ★ The limit is checked BEFORE the send and counted on success — the the platform notification path calls these two around its own provider request. */
export async function checkLimit(tx, { tenantId }) { return limitState(tx, { tenantId }); }
export async function countSend(tx, { tenantId }) {
  const { rows } = await tx.query(`INSERT INTO keystone.mail_usage (tenant_id, day, sent) VALUES ($1, (now() AT TIME ZONE 'UTC')::date, 1) ON CONFLICT (tenant_id, day) DO UPDATE SET sent = keystone.mail_usage.sent + 1 RETURNING sent`, [tenantId]);
  const P = await ports();
  if (P.limits?.afterCount) await P.limits.afterCount(tx, { tenantId, sent: rows[0]?.sent ?? 1 });   // the host's notice at 80% and 100% of the day's limit
}

/** Remember which organisation a provider message belongs to, so a later delivery event (bounce, complaint) finds it whoever's domain it was sent from. */
export async function recordMessage(tx, { tenantId, providerMessageId }) {
  if (!providerMessageId || !tenantId) return;
  await tx.query(`INSERT INTO keystone.mail_message (provider_message_id, tenant_id) VALUES ($1,$2) ON CONFLICT (provider_message_id) DO NOTHING`, [providerMessageId, tenantId]);
}

async function smtpSend(tx, { tenantId, identity, routed, html, text, attachments, headers = null }) {
  const P = await ports();
  const row = identity.smtp.user ? await secretRow(tx) : null;   // D-054: no user name, no login, no password
  let password = "";
  if (identity.smtp.user) try { password = P.secrets.open({ envelope: row.secret_envelope, tenantId, purpose: SMTP_PURPOSE, kekVersion: row.kek_version }); }
  catch { return { status: "failed", providerMessageId: null, error: "The saved SMTP password could not be opened — enter it again." }; }
  // ★ S-4: the host is RESOLVED here and every address must be public; the connection then goes to the address that was judged (not to a second lookup of the name), with the original
  //   name kept for the TLS certificate check. On a developer's machine (KEYSTONE_ENVIRONMENT=local) loopback is allowed, so Mailpit on 127.0.0.1 still works.
  let route;
  try { route = await resolvePublicHost(identity.smtp.host); }
  catch (e) { return { status: "failed", providerMessageId: null, error: SMTP_FAILURE[smtpFailureKind(e)] }; }
  const transport = nodemailer.createTransport({
    host: route.address, ...(route.isIp ? {} : { servername: route.host }), port: identity.smtp.port, secure: identity.smtp.security === "tls", requireTLS: identity.smtp.security === "starttls", ignoreTLS: identity.smtp.security === "none",
    auth: identity.smtp.user ? { user: identity.smtp.user, pass: password } : undefined, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  try {
    const info = await transport.sendMail({
      from: `"${String(identity.fromName).replace(/["\r\n]/g, "")}" <${identity.fromAddress}>`, ...(identity.replyTo ? { replyTo: identity.replyTo } : {}),
      to: routed.to, subject: routed.subject, html, text, ...(headers && Object.keys(headers).length ? { headers } : {}),
      ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "base64") })) } : {}),
    });
    return { status: "sent", providerMessageId: info.messageId ?? null, error: null };
  } catch (e) {
    return { status: "failed", providerMessageId: null, error: SMTP_FAILURE[smtpFailureKind(e)] };
  } finally { transport.close(); }
}

/**
 * Send one email as the organisation. `purpose: "platform"` is the fixed product sender (sign-in, password, platform alerts). `attachments` are `[{filename, content: base64}]`.
 * @returns {{status, providerMessageId, error, mode, fallbackReason, limit?}}
 */
export async function sendMail(tx, { tenantId, to, subject, html = null, text, attachments = null, headers = null, purpose = "default", replyTo = null, idempotencyKey = null, product = null }) {
  // 26 Oct 2026 launch-night switch: KEYSTONE_MAIL_PAUSED=1 stops every outgoing email at this door (LAUNCH-NIGHT-RUNBOOK.md). Nothing is queued: the sender sees a skipped send and can resend once it is switched off.
  if (process.env.KEYSTONE_MAIL_PAUSED === "1") return { providerMessageId: null, error: "Email sending is paused for a moment. Try again shortly.", mode: "paused", fallbackReason: null, status: "skipped" };
  const P = await ports();
  // Launch step 8: a demo workspace sends nothing — the message is recorded for the visitor's demo inbox and the product carries on as if it had gone
  if (P.hold) { const h = await P.hold(tx, { to, subject, text, html }); if (h) return { ...h, mode: "held", fallbackReason: null }; }
  const identity = await resolveIdentity(tx, { tenantId, purpose, product });
  const out = (o) => ({ providerMessageId: null, error: null, mode: identity.mode, fallbackReason: identity.fallbackReason, ...o });
  let routed;
  try { routed = P.environment.route({ to, subject }); } catch (e) { return out({ status: "skipped", error: e.message }); }
  const capturing = P.capture?.target?.() != null;   // sandbox capture: every mode ends at the capture server
  if (!capturing && identity.mode !== "smtp" && identity.mode !== "mailbox" && !identity.platform?.address && identity.mode === "platform") return out({ status: "skipped", error: "email isn't set up: the product has no default sending address (KEYSTONE_MAIL_SENDER)" });
  if (!capturing && identity.mode !== "smtp" && identity.mode !== "mailbox" && !P.transport.configured()) return out({ status: "skipped", error: "email isn't set up: no provider key (RESEND_API_KEY) is configured" });
  if (!identity.fixed) {
    const lim = await limitState(tx, { tenantId });
    if (lim.reached) return out({ status: "limit_reached", error: `This organisation has reached its daily sending limit (${lim.limit}). It resets at midnight UTC.`, limit: lim });
  }
  const effective = { ...identity, replyTo: replyTo ?? identity.replyTo };
  // the organisation chose its own sender and it cannot be used: the mail still goes (a signer must not miss it) from the platform address, and that is recorded and shown — never silent
  if (!identity.fixed && identity.requested !== "platform" && identity.mode === "platform" && identity.fallbackReason) await noteFallback(tx, { tenantId, reason: identity.fallbackReason });
  let r;
  if (capturing) {
    const { from, replyTo: rt } = fromLine(effective);
    const o = await P.capture.send({ to: routed.to, from, subject: routed.subject, text, html, headers, replyTo: rt ?? null, attachments });
    r = o.ok ? { status: "sent", providerMessageId: o.providerMessageId, error: null } : { status: "failed", providerMessageId: null, error: o.error };
  } else if (identity.mode === "smtp") r = await smtpSend(tx, { tenantId, identity: effective, routed, html, text, attachments, headers });
  else if (identity.mode === "mailbox") r = await sendViaMailbox(tx, { tenantId, identity: effective, routed, html, text, attachments, replyTo: effective.replyTo });
  else {
    const { from, replyTo: rt } = fromLine(effective);
    const o = await P.transport.send({ to: routed.to, from, subject: routed.subject, text, ...(headers && Object.keys(headers).length ? { headers } : {}), ...(html ? { html } : {}), ...(rt ? { replyTo: rt } : {}), ...(attachments ? { attachments } : {}), ...(idempotencyKey ? { idempotencyKey } : {}), tenantId });
    r = o.ok ? { status: "sent", providerMessageId: o.providerMessageId, error: null } : { status: "failed", providerMessageId: null, error: o.error };
  }
  if (r.status === "sent") await recordMessage(tx, { tenantId, providerMessageId: r.providerMessageId });
  if (r.status === "sent" && !identity.fixed) await countSend(tx, { tenantId });
  return out(r);
}

/** Launch step 8: hold a message instead of sending it, when the host says this workspace is a demo (`message` may be a function, called only then). Null for a real workspace. */
export async function holdMessage(tx, message) { const P = await ports(); return P.hold ? P.hold(tx, message) : null; }
