// Stage 14 task 14.30 — THE ONE SENDER FOR A SIGN-LINK EMAIL.
//
// ★★★ THE `sendAuthEmail` BODY (src/email/authEmail.mjs:31-65, M), MIRRORED, NOT REUSED BY IMPORT.
//     A sign link is a SECOND credential-bearing sender for the same reason sign-in mail got its own:
//     `sendNotificationEmail` (src/email/send.mjs) needs a `notificationId` to hang a delivery row
//     off, and a sign link goes to a subject or a guardian who may have neither a notification nor a
//     durable audit row this task's own title says must not exist. render → `emailIsConfigured` skip
//     → `redirectForEnvironment` → `sendViaResend` — same shape, same four calls, by name.
//   ★★ IT WRITES NO `notification_delivery` ROW AND LOGS NO ADDRESS, same as `sendAuthEmail`
//      (authEmail.mjs:8-11,43-47) and for the same reason: a durable row saying "a sign link went to
//      this address at this time" is exactly the surface a bearer credential must not leave lying
//      around, and a log line naming the recipient is a second one.
//   ★ Calls `sendViaResend`, `redirectForEnvironment` and `sendingAddress` BY NAME, never reaching
//     into their modules' internals — the same reason authEmail.mjs gives for itself.
import { renderTemplate } from "./templates.mjs";
import { deliverAsOrganisation } from "./deliver.mjs";

/**
 * ★★★ THE ONE SIGN-LINK SENDER. Renders a `document.sign_link*` template, routes it through the
 *     environment redirect, and sends it through Resend directly — never through
 *     `sendNotificationEmail`.
 *
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.templateKey   must start with "document.sign_link" — refused otherwise
 * @param {object} [opts.vars]
 * @returns {Promise<{status: 'sent'|'skipped'|'failed', providerMessageId: string|null, error: string|null}>}
 */
export async function sendSignLinkEmail({ to, templateKey, vars = {} }, { fetchImpl, env = process.env } = {}) {
  // ★ Refused before anything else runs, exactly like sendAuthEmail's own guard on "auth." — a caller
  //   reaching for this sender with a template it does not own is a programming error, not a delivery
  //   outcome.
  if (typeof templateKey !== "string" || !templateKey.startsWith("document.sign_link")) {
    throw new Error(
      `sendSignLinkEmail: "${templateKey}" is not a sign-link template. This sender only sends ` +
      `"document.sign_link*" templates — everything else goes through sendNotificationEmail or ` +
      `sendAuthEmail.`);
  }

  const rendered = await renderTemplate(templateKey, vars, {});

  // ★★ A `skipped` outcome, not a thrown error — the same distinction authEmail.mjs draws (a
  //    deployment with no RESEND_API_KEY is a configuration state, not a bug in the caller). Logged
  //    at warn with the template key and NO address — an address in a log line is exactly the
  //    login-history-shaped leak this sender otherwise avoids by writing no delivery row.
  const out = await deliverAsOrganisation(null, { tenantId: null, to, subject: rendered.subject, text: rendered.text }, { fetchImpl, env });
  if (out.status === "skipped") console.warn(`sendSignLinkEmail: not sent "${templateKey}" — ${out.error}`);
  return { status: out.status === "limit_reached" ? "skipped" : out.status, providerMessageId: out.providerMessageId, error: out.error };
}
