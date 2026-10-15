// Mail capture (sandbox only). With KEYSTONE_MAIL_CAPTURE_SMTP=host:port set, EVERY outgoing email — through Resend, through an organisation's own SMTP, through a connected mailbox — is handed to that one SMTP server (Mailpit) and goes nowhere else. Because nothing can leave, the recipient allowlist does not apply: invented customers can receive mail and be read back.
// ★★★ It cannot exist in production: the readiness check refuses to bind when the variable is set there, and captureTarget() throws if it is asked in production. test/p31_mail_capture.test.mjs proves both and proves a send with the variable set never touches the network provider.
import nodemailer from "nodemailer";

export class CaptureConfigError extends Error { constructor(m) { super(m); this.name = "CaptureConfigError"; } }

/** @returns {{host: string, port: number} | null} null when capture is off. Throws in production, or when the value is not host:port. */
export function captureTarget(env = process.env) {
  const v = env.KEYSTONE_MAIL_CAPTURE_SMTP;
  if (v === undefined || v === "") return null;
  if (env.KEYSTONE_ENVIRONMENT === "production") throw new CaptureConfigError("KEYSTONE_MAIL_CAPTURE_SMTP is set in production: mail capture would swallow real email. Remove the variable.");
  const m = /^([A-Za-z0-9._-]+):(\d{1,5})$/.exec(v);
  if (!m) throw new CaptureConfigError("KEYSTONE_MAIL_CAPTURE_SMTP must look like host:port");
  return { host: m[1], port: Number(m[2]) };
}

/** Send one message to the capture server. Same result shape as sendViaResend. `attachments` are [{filename, content (base64)}]. */
export async function captureSend({ to, from, subject, text, html = null, replyTo = null, attachments = null, headers = null }, { env = process.env, createTransport = nodemailer.createTransport } = {}) {
  const t = captureTarget(env); if (!t) throw new CaptureConfigError("mail capture is not configured");
  const transport = createTransport({ host: t.host, port: t.port, secure: false, ignoreTLS: true, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  try {
    const info = await transport.sendMail({ from, to, subject, text, ...(headers && Object.keys(headers).length ? { headers } : {}), ...(html ? { html } : {}), ...(replyTo ? { replyTo } : {}), ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "base64") })) } : {}) });
    return { ok: true, status: 250, providerMessageId: info.messageId ?? null, response: { captured: true }, error: null };
  } catch (e) { return { ok: false, status: null, providerMessageId: null, response: null, error: `capture server refused the message: ${String(e?.message ?? e).slice(0, 200)}` }; }
  finally { transport.close(); }
}
