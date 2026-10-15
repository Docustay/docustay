// A missing mail setting must not read to a customer as "Something went wrong on our side": they get a plain message, the operator gets one email (at most one an hour per process), and the log keeps the request id.
import { platformAlertTo } from "../mail/index.mjs";
import { sendViaResend } from "../email/resend.mjs";
import { sendingAddress } from "../email/send.mjs";
import { redirectForEnvironment } from "../email/redirect.mjs";
export const MAIL_DOWN_MESSAGE = "We can't send emails right now. Try again in a few minutes.";
export const isMailConfigProblem = (err) => [err, err?.cause].some((e) => e && (e.name === "MailConfigError" || e.name === "EmailConfigError"));
let lastAlertAt = 0;
export function resetConfigAlertThrottle() { lastAlertAt = 0; }
/** Best effort and never throws: the customer's answer must not depend on the alert. */
export async function alertMailConfig({ requestId, method, path, message }, { env = process.env, send = (m) => sendViaResend(m, { env }), now = Date.now() } = {}) {
  try {
    if (now - lastAlertAt < 3_600_000) return { sent: false, reason: "throttled" };
    const to = platformAlertTo(env);
    if (!to || !to.includes("@")) return { sent: false, reason: "no alert address" };
    lastAlertAt = now;
    const subject = `${env.KEYSTONE_ENVIRONMENT ?? "unknown"}: email is not set up correctly, customers cannot get emails`;
    const routed = redirectForEnvironment({ to, subject }, env);
    const r = await send({ to: routed.to, from: sendingAddress(env), subject: routed.subject, text: `A customer request hit a missing email setting.\n\nRequest id: ${requestId}\n${method} ${path}\n\n${message}\n\nPlatform → Health and /readyz list the missing setting names.` });
    return { sent: r?.ok !== false };
  } catch { return { sent: false, reason: "alert failed" }; }
}
