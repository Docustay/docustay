// src/email/authEmail.mjs — TASK 8.10: the ONE sender for sign-in mail.
//
// ★★★ WHY THIS IS ITS OWN SENDER, NOT `sendNotificationEmail` (`src/email/send.mjs:55`) — spec 04 §5
//     requires sign-in email to go "always through Resend, never the practice mailbox", and
//     `sendNotificationEmail` needs a `notificationId` — a row that needs a recipient `app_user` in a
//     practice, which an invitee and a code requester may not have.
//
// ★★ IT WRITES NO `notification_delivery` ROW. That table's `UNIQUE (tenant_id, notification_id, channel)`
//    (0016:128) requires a notification, and a sign-in email has none. The audit trail for an invite is
//    the `keystone.invite` row plus `people.person.invited`; for a code it is deliberately nothing — a
//    durable row saying "a code went to this address at this time" is a login-history leak.
//
// ★ Calls `sendViaResend`, `redirectForEnvironment` and `sendingAddress` BY NAME — it does not reach
//   into their modules' internals, so Stage 9's CT-064 (moving `resend.mjs`'s `fetch` onto `callOutside`)
//   and CT-067 (`send.mjs`) do not require a change here as long as those exported signatures hold.
import { docustayFrame } from "./docustayBilling.mjs";
import { renderTemplate } from "./templates.mjs";
import { deliverAsOrganisation } from "./deliver.mjs";
import * as mail from "../mail/index.mjs";
import { authEmailWords } from "./authEmailLanguages.mjs";
import { billingWords } from "./docustayBillingLanguages.mjs";

/**
 * ★★★ THE ONE SIGN-IN SENDER. Renders an `auth.*` template, routes it through the environment
 *     redirect, and sends it through Resend directly.
 *
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.templateKey   must start with "auth." — refused otherwise
 * @param {object} [opts.vars]
 * @param {object} [opts.tx]        ★ PART 2 ADDITION ("every email on the one system", 1 Oct 2026)
 *   — the `withTenant` handle, when the caller has one. Forwarded to `renderTemplate`'s own
 *   `resolve` param so a tenant's Run → Templates override of an `auth.*` template actually wins
 *   (F844: `auth.invite`'s staff-invite send was the one named case still on the hardcoded path
 *   with zero override capability, while its wording is editable and visible in Run → Templates
 *   today). Omitted (the sign-in-code and 2FA-changed call sites, which run before or outside any
 *   single tenant context) → unchanged hardcoded-TEMPLATES rendering, exactly as before this fix.
 * @param {string} [opts.tenantId]  paired with `tx`; both or neither.
 * @returns {Promise<{status: 'sent'|'skipped'|'failed', providerMessageId: string|null, error: string|null}>}
 */
/** The sign-in / verification code for a Docustay person, dressed in Docustay's frame (wordmark, the code large, plain-text twin kept). Built from the SAME words the plain email carries, so every language is covered. */
function codeEmailHtml(subject, text, lang = "en") {
  const code = String(text).match(/\b(\d{6})\b/)?.[1] ?? null;
  const paras = String(text).split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x && x !== code && !/^[—-]\s*\S*$/.test(x));
  if (!code) return {};
  const w = billingWords(lang);
  return { html: docustayFrame({ preheader: code, heading: subject, intro: paras, code, lang: w.lang, footer: w("footer") }).html };
}

/** Run 10 (EK-002): the Docustay password-reset mail in Docustay's frame (it went out as plain text only, a bare link). Built from the words the plain email carries, so every language still applies; the link becomes the button and stays in the text twin. */
function resetEmailHtml(subject, text, link, lang = "en") {
  const url = String(link ?? ""); if (!url) return {};
  const paras = String(text).split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x && !x.includes(url));
  const w = billingWords(lang); const [first, ...rest] = paras;
  return { html: docustayFrame({ preheader: first ?? subject, heading: subject, intro: first ? [first] : [], button: { label: subject, url }, after: rest, lang: w.lang ?? lang, footer: w("footer") }).html };
}

/** Run 10 (R10-41): a Docustay team invitation in Docustay's frame (it went out as plain text only). Built from the words the plain email carries, so a workspace's own wording and every language still apply; the link becomes a button and stays in the text twin. */
function inviteEmailHtml(subject, text, vars) {
  const url = String(vars?.acceptUrl ?? ""); if (!url) return {};
  const paras = String(text).split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x && !/^Hello,?$/i.test(x) && !x.includes(url) && !/^[—-]\s*\S/.test(x));
  const w = billingWords("en");
  const [first, ...rest] = paras;
  return { html: docustayFrame({ preheader: first ?? subject, heading: subject, intro: first ? [first] : [], button: { label: "Accept the invitation", url }, after: rest.slice(0, -1), fine: rest.at(-1) ?? null, lang: "en", footer: w("footer") }).html };
}

export async function sendAuthEmail({ to, templateKey, vars = {}, tx, tenantId, product = null, lang = null, variant = null }, { fetchImpl, env = process.env } = {}) {
  // ★ Refused before anything else runs — a caller reaching for this sender with a non-sign-in
  //   template is a programming error, not a delivery outcome, exactly like an unknown template key
  //   in `renderTemplate` itself (`templates.mjs:148`).
  if (typeof templateKey !== "string" || !templateKey.startsWith("auth.")) {
    throw new Error(
      `sendAuthEmail: "${templateKey}" is not a sign-in template. This sender only sends "auth.*" ` +
      `templates — everything else goes through sendNotificationEmail.`);
  }

  const rendered = await renderTemplate(templateKey, vars, {}, tx && tenantId ? { tx, tenantId } : {});

  // ★★ A `skipped` outcome, not a thrown error: a deployment with no RESEND_API_KEY is a configuration
  //    state, not a bug in the caller — the same distinction `send.mjs:93-103` draws for the durable
  //    path. ★ Logged at warn so a missing key is visible in production rather than silent, with the
  //    template key and NO address (an address in a log line is exactly the login-history leak this
  //    sender otherwise avoids by writing no delivery row).
  // ★ Part 29 (D1): a Docustay person is never told the mail is from another product — the same words, the product's name swapped
  const docustay = mail.productKeyOf(product, env) === "docustay";
  // a code asked for while SIGNING UP verifies an address; it is not a sign-in, and the email must not call it one
  const verify = variant === "verify" && templateKey === "auth.email_code";
  const brand = (t) => (typeof t !== "string" ? t : (docustay ? t.replace(/Workbench/g, "Docustay") : t).replace(verify ? /sign-in code/g : /(?!)/g, "verification code"));
  // A Docustay person who asked in another language gets the two before-sign-in mails (code, reset) in it; anything else, or a language without words, stays English.
  const words = docustay && lang && lang !== "en" ? authEmailWords(lang, templateKey === "auth.email_code" ? (verify ? "verify" : "code") : templateKey === "auth.password_reset" ? "reset" : null, vars) : null;
  const out = await deliverAsOrganisation(tx ?? null, { tenantId: tenantId ?? null, to, subject: words ? words.subject : brand(rendered.subject), text: words ? words.text : brand(rendered.text), ...(docustay && templateKey === "auth.email_code" ? codeEmailHtml(words ? words.subject : brand(rendered.subject), words ? words.text : brand(rendered.text), words ? lang : "en") : {}), ...((docustay || vars?.productName === "Docustay") && templateKey === "auth.invite" ? inviteEmailHtml(brand(rendered.subject), brand(rendered.text), vars) : {}), ...(docustay && templateKey === "auth.password_reset" ? resetEmailHtml(words ? words.subject : brand(rendered.subject), words ? words.text : brand(rendered.text), vars?.link, words ? lang : "en") : {}), purpose: "auth", product }, { fetchImpl, env });
  if (out.status === "skipped") console.warn(`sendAuthEmail: not sent "${templateKey}" — ${out.error}`);
  return { status: out.status === "limit_reached" ? "skipped" : out.status, providerMessageId: out.providerMessageId, error: out.error };
}
