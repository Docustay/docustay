// src/mail/index.mjs — THE MAIL MODULE'S FRONT DOOR. Everything outside src/mail/** reaches mail through this file (and ports.mjs, which the host plugs into).
import { beginConnect as beginMailboxConnect, completeConnect as completeMailboxConnect, disconnect as disconnectMailbox, mailboxRow, PROVIDERS as MAILBOX_PROVIDERS, verifyState as verifyMailboxState } from "./mailbox.mjs";
import { noteFallback, resolveIdentity, fromLine, identityRow, domainRow, secretRow, SMTP_SECRET, isIdentitySettingKey, identitySettings, setIdentitySetting, setDailyLimit, saveIdentity as saveIdentityFields } from "./identity.mjs";
import { startDomain, verifyDomainNow, removeDomain, MAIL_DOMAIN_PENDING_FACT, provider as domainProvider } from "./domains.mjs";
import { sendMail, holdMessage, limitState, checkLimit, countSend, recordMessage } from "./send.mjs";
import { recordMailEvent, onMailEvent, eventCounts } from "./events.mjs";
import { ports, installMailPorts, mailPortsInstalled } from "./ports.mjs";
import { productName, productSender, platformAlertTo, MailConfigError, productKeyOf, productNameFor, productSenderFor } from "./product.mjs";
import { invalid, conflict } from "../http/errors.mjs";

export async function saveIdentity(tx, args) { return saveIdentityFields(tx, { ...args, invalid }); }
export { productName, productSender, platformAlertTo, MailConfigError, productKeyOf, productNameFor, productSenderFor, resolveIdentity, fromLine, isIdentitySettingKey, identitySettings, setIdentitySetting, setDailyLimit, startDomain, verifyDomainNow, removeDomain, MAIL_DOMAIN_PENDING_FACT, domainProvider,
  sendMail, holdMessage, limitState, checkLimit, countSend, recordMessage, recordMailEvent, noteFallback, beginMailboxConnect, completeMailboxConnect, disconnectMailbox, MAILBOX_PROVIDERS, verifyMailboxState, onMailEvent, eventCounts, installMailPorts, mailPortsInstalled, ports };

/** Save the SMTP password (sealed). An empty password removes it. */
export async function saveSmtpPassword(tx, { tenantId, password, updatedBy = null }) {
  if (password === null || password === "") { await tx.query(`DELETE FROM keystone.mail_secret WHERE tenant_id = $1 AND name = $2`, [tenantId, SMTP_SECRET]); return; }
  if (typeof password !== "string" || password.length > 500) throw invalid("That password is not usable", { field: "password" });
  const sealed = (await ports()).secrets.seal({ tenantId, purpose: "document_smtp_password", plaintext: password });
  await tx.query(
    `INSERT INTO keystone.mail_secret (tenant_id, name, secret_envelope, kek_version, secret_fingerprint, updated_by) VALUES ($1,$2,$3::jsonb,$4,$5,$6)
     ON CONFLICT (tenant_id, name) DO UPDATE SET secret_envelope = EXCLUDED.secret_envelope, kek_version = EXCLUDED.kek_version, secret_fingerprint = EXCLUDED.secret_fingerprint, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [tenantId, SMTP_SECRET, JSON.stringify(sealed.envelope), sealed.kekVersion, sealed.fingerprint, updatedBy]);
}

/**
 * Everything a settings screen needs, never a secret. `state`: not_configured (no provider key and not SMTP) · limit_reached · failed (domain check failed) · pending_dns · ok.
 */
export async function mailStatus(tx, { tenantId }) {
  const P = await ports();
  const identity = await resolveIdentity(tx, { tenantId });
  const d = await domainRow(tx);
  const pw = await secretRow(tx);
  const lim = await limitState(tx, { tenantId });
  const events = await eventCounts(tx, { tenantId });
  const mb = await mailboxRow(tx);
  const idRow = await identityRow(tx);
  const configured = identity.mode === "smtp" || identity.mode === "mailbox" || P.transport.configured();
  const state = !configured ? "not_configured" : lim.reached ? "limit_reached" : identity.requested === "domain" && d?.status === "failed" ? "failed" : identity.requested === "domain" && d?.status !== "verified" ? "pending_dns" : identity.requested === "mailbox" && identity.mode !== "mailbox" ? "failed" : "ok";
  return {
    state, configured, mode: identity.mode, requested: identity.requested, fallbackReason: identity.fallbackReason,
    from: { name: identity.fromName, address: identity.fromAddress, replyTo: identity.replyTo, platform: identity.platform },
    domain: d ? { domain: d.domain, status: d.status, records: d.records, lastError: d.last_error, verifiedAt: d.verified_at, checkedAt: d.checked_at } : null,
    smtp: { passwordSet: Boolean(pw), passwordSetAt: pw?.updated_at ?? null },
    mailbox: mb ? { provider: mb.provider, providerLabel: MAILBOX_PROVIDERS[mb.provider].label, email: mb.email, displayName: mb.display_name, status: mb.status, lastError: mb.last_error, connectedAt: mb.connected_at, lastUsedAt: mb.last_used_at } : null,
    mailboxProviders: await Promise.all(Object.entries(MAILBOX_PROVIDERS).map(async ([key, p]) => ({ key, label: p.label, available: Boolean(await Promise.resolve(P.oauthClient?.(key)).then((c) => c?.clientId && c?.clientSecret).catch(() => false)) }))),
    fallback: idRow.fallback_count > 0 ? { count: idRow.fallback_count, at: idRow.fallback_at, reason: idRow.fallback_reason, now: Boolean(identity.fallbackReason) } : null,
    limit: lim, events, bounced: events.bounced > 0,
  };
}

/** ★ D-013: a test that was not sent must not look sent. "limit_reached", "skipped" and "failed" each become a refusal in plain words instead of a 200 the screen reads as success. */
export function assertTestSent(out) {
  if (out?.status === "limit_reached") throw conflict(out.error || "This organisation has reached its daily sending limit. It resets at midnight UTC.", { code: "email_limit" });
  if (out?.status === "skipped") throw conflict(out.error || "Email could not be sent from this server right now.", { code: "email_skipped" });
  if (out?.status === "failed") throw conflict(out.error || "The mail server refused the test message.", { code: "email_failed" });
  return out;
}

/** A short test email through the CURRENT identity, so the organisation sees exactly what a recipient would get. */
export async function sendTestEmail(tx, { tenantId, to, subject = null }) {
  if (typeof to !== "string" || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(to)) throw invalid("Enter an email address to send the test to", { field: "to" });
  const identity = await resolveIdentity(tx, { tenantId });
  const how = identity.mode === "platform" ? "from the platform address on your behalf" : identity.mode === "domain" ? "from your own domain" : identity.mode === "mailbox" ? `from your own mailbox (${identity.mailbox?.email ?? identity.fromAddress})` : "through your own mail server";
  const text = `This is a test of how your email is sent.\n\nSent ${how}.${identity.replyTo ? `\nReplies go to ${identity.replyTo}.` : ""}\n`;
  const html = `<p>This is a test of how your email is sent.</p><p>Sent ${how}.${identity.replyTo ? ` Replies go to ${identity.replyTo.replace(/</g, "&lt;")}.` : ""}</p>`;
  const out = await sendMail(tx, { tenantId, to, subject: typeof subject === "string" && subject.trim() ? subject.trim().slice(0, 200) : `Test email from ${identity.orgName || "your organisation"}`, html, text });
  assertTestSent(out);   // D-013
  return { status: out.status, mode: out.mode, error: out.error ?? null, fallbackReason: identity.fallbackReason };
}

// ── connecting the organisation's own Google or Microsoft mailbox (src/mail/mailbox.mjs) ──
const callbackUri = async (tenantId) => {
  const base = await (await ports()).callbackBase?.({ tenantId });
  if (!base) throw conflict("Connecting a mailbox is not set up on this server yet (it has no public address for the provider to return to). Ask the person who runs this server to set one.");
  return `${base}/api/public/mailbox/callback`;
};
/** The address the person is sent to for consent. */
export async function startMailboxConnect(tx, { tenantId, userId = null, provider }) {
  return beginMailboxConnect({ tenantId, userId, provider, redirectUri: await callbackUri(tenantId) });
}
/** The provider sent the person back: finish the connection for the organisation the signed state names. Run inside that organisation's own tenant scope. */
export async function finishMailboxConnect(tx, { state, code }) {
  const { tenantId } = verifyMailboxState(state);
  return completeMailboxConnect(tx, { state, code, redirectUri: await callbackUri(tenantId) });
}
export async function removeMailbox(tx, { tenantId, updatedBy = null }) { await disconnectMailbox(tx, { tenantId, updatedBy }); return mailStatus(tx, { tenantId }); }
