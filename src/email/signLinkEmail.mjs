// @ts-check
// SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 — THE SIGNING EMAIL, REBUILT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TY'S OWN WORDS: "the document's message is the body of the email. This is the one email
//     whose words come from the document, not from Run → Templates." So this module does NOT go
//     through `renderTemplate`/the `document.sign_link*` Run-tab template for its BODY — it reads
//     the sending document_instance's own `message` column (migration 0539) directly. The Run-tab
//     wording is kept as the FALLBACK for a document sent with no message at all (the maintainer: "if the
//     message is empty, fall back to the Run → Templates wording").
//
// ★★★ THE FRAME IS FIXED. Logo, practice name, document name, the "Review and sign" button and the
//     footer are the SAME React Email component for every practice and every document — never
//     built from the message text, never editable. This is what makes the sign link itself
//     un-deletable: nothing about the one clickable link in this email is under a sender's control.
//     Only the paragraph of body text between the greeting and the button comes from the document.
//
// ★ WHY `React.createElement`, NOT JSX: `src/` is plain Node ESM with no build/transform step (the
//   frontend's Vite/JSX pipeline is webreact's own, a separate package). `@react-email/components`
//   are ordinary React components either way — calling them via `createElement` needs no loader.
//
// ★ NO STORED BODY, NO DELIVERY ROW — same rule `documentLinkEmail.mjs`'s own header already states
//   for this sender: a sign link is a bearer credential, and a durable row recording who received
//   one is exactly the surface that must not exist. This module renders and sends; it writes nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import * as mail from "../mail/index.mjs";
import { createElement as h } from "react";
import { logoBlock, lightOnlyMeta } from "./emailLogo.mjs";
import { render } from "@react-email/render";
import {
  Html, Head, Preview, Body, Container, Section, Img, Heading, Text, Button, Hr, Link,
} from "@react-email/components";
import { renderTemplate } from "./templates.mjs";
import { sendViaResend, emailIsConfigured } from "./resend.mjs";
import { redirectForEnvironment } from "./redirect.mjs";
import { sendingAddress } from "./send.mjs";
import { emailWords } from "./signLinkLanguages.mjs";

const BRAND_COLOR = "#5A3AC1"; // ★ the product's own default accent (webreact's design tokens — see designTokens.mjs)

/** ★ THE FIXED FRAME. `bodyText` is the only thing that ever varies by document. */
// ★ QUEUE §23.5.16 — what the email says depends on what the person is being asked to do (sign | approve | view | assist); §23.5.6 — in the language the send chose.
const verbsFor = (action, language = "en") => { const w = emailWords(language); return w.verbs[action] ?? w.verbs.sign; };

function SignLinkEmail({ practiceName, logoUrl, documentTitle, recipientName, bodyText, link, senderName, isReminder = false, action = "sign", language = "en", accent = null, footer = null, buttonLabel = null, preview = null, customFooter = null }) {
  const W = emailWords(language);
  const v = verbsFor(action, language);
  return h(Html, { lang: language, dir: language === "ar" ? "rtl" : "ltr" },   // Arabic reads right to left
    h(Head, null, ...lightOnlyMeta(h)),
    h(Preview, null, preview ? preview : isReminder
      ? `${W.reminder} ${documentTitle} ${v.waiting}`
      : W.sentYou(practiceName, documentTitle, v.to)),
    h(Body, { style: { backgroundColor: "#f4f4f5", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", margin: 0, padding: "32px 0" } },
      h(Container, { style: { backgroundColor: "#ffffff", borderRadius: "12px", maxWidth: "480px", margin: "0 auto", padding: "32px" } },
        logoBlock(h, { logoUrl, practiceName }),
        h(Heading, { style: { fontSize: "20px", fontWeight: 600, color: "#18181b", margin: "0 0 16px" } },
          `${documentTitle}`),
        h(Text, { style: { fontSize: "15px", color: "#3f3f46", lineHeight: "22px", margin: "0 0 8px" } },
          W.hello(recipientName)),
        h(Text, { style: { fontSize: "15px", color: "#3f3f46", lineHeight: "22px", margin: "0 0 24px", whiteSpace: "pre-wrap" } },
          bodyText),
        h(Button, {
          href: link,
          style: {
            backgroundColor: /^#[0-9a-fA-F]{6}$/.test(accent ?? "") ? accent : BRAND_COLOR, color: "#ffffff", fontSize: "15px", fontWeight: 600,
            borderRadius: "8px", padding: "12px 24px", textDecoration: "none", display: "inline-block",
          },
        }, buttonLabel || v.button),
        h(Text, { style: { fontSize: "13px", color: "#a1a1aa", margin: "24px 0 0" } },
          v.note),
        h(Hr, { style: { borderColor: "#e4e4e7", margin: "24px 0" } }),
        h(Text, { style: { fontSize: "12px", color: "#a1a1aa", margin: 0 } },
          W.sentBy(senderName, practiceName)),
        h(Link, { href: link, style: { fontSize: "12px", color: "#a1a1aa", wordBreak: "break-all" } }, link),
        // ★ Part 29 (D5): the product's own line, on the free plan only (the host decides; null = none)
        customFooter ? h(Text, { style: { fontSize: "12px", color: "#71717a", margin: "16px 0 0", whiteSpace: "pre-wrap" } }, customFooter) : null,   // FP-K2: the workspace's own footer text
        footer ? h(Text, { style: { fontSize: "12px", color: "#a1a1aa", margin: "16px 0 0" } }, footer) : null,
      ),
    ),
  );
}

/** The platform's own sender address, with the display name taken off whatever KEYSTONE_EMAIL_FROM holds ("the platform <noreply@…>" or a bare address). */
export function platformAddress(env = process.env) {
  const from = sendingAddress(env);
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
}

/**
 * ★ QUEUE §23.3.4 — THE FROM LINE FOR A SENDING IDENTITY. `identity` comes from the Documents island (its settings): `platform` → "<Org> via the platform" <platform address> with the org's reply-to;
 *   `domain` (only ever passed once the organisation's domain is verified) → "<from name>" <their address>. Never anything else: the island decides the mode, this decides how it reads.
 */
export function fromLineFor(identity, { practiceName }, env = process.env) {
  // the mail module's identity (platform "<Org> via <Product>" · own verified domain) knows how it reads
  if (identity?.platform) return mail.fromLine({ ...identity, orgName: identity.orgName || practiceName || "" });
  const q = (n) => String(n).replace(/["\r\n]/g, "").trim();
  return { from: `"${q(practiceName || "Documents")} via ${mail.productName(env)}" <${platformAddress(env)}>`, replyTo: identity?.replyTo || null };
}

/** ★ Render the signing email (subject, HTML, plain text) without sending it — the island sends it itself when an organisation uses its own SMTP server. */
export async function renderSigningEmail({
  practiceName, logoUrl = null, documentTitle, recipientName, message = null, link, senderName,
  fallbackTemplateKey = "document.sign_link", isReminder = false, subject: subjectOverride = null, action = "sign", language = "en", accent = null, footer = null, buttonLabel = null, preview = null, customFooter = null,
}) {
  const W = emailWords(language);
  const v = verbsFor(action, language);
  // ★ THE FALLBACK — the Run → Templates wording, resolved the ordinary way, for a document sent with no message. Only its TEXT BODY is reused as `bodyText`.
  // ★ Run 8 (R8-8): a send in another language uses that language's own sentence; the Run → Templates fallback is English text, so it is the English email's body only
  const bodyText = (message && message.trim())
    ? message.trim()
    : action !== "sign" || language !== "en" ? v.body(senderName || practiceName)
    : (await renderTemplate(fallbackTemplateKey, { practiceName, recipientName, documentTitle, link, senderName }, {})).text
        .split("\n\n")[1] ?? `${senderName || practiceName} has sent you a document to review and sign.`;
  // the product's own line ("Sent with Docustay", from the host) in the email's language too
  if (footer && W.sentWith) footer = footer.replace(/^Sent with (.+)$/, (_, product) => W.sentWith(product));
  // QUEUE §23.4.6 — an uploaded document's sender writes the subject; every other send keeps the standard line
  const subject = subjectOverride && subjectOverride.trim()
    ? subjectOverride.trim().slice(0, 200)
    : isReminder ? `${W.reminder} ${documentTitle} ${v.waiting}` : W.sentYou(practiceName, documentTitle, v.to);
  const props = { practiceName, logoUrl, documentTitle, recipientName, bodyText, link, senderName, isReminder, action, language, accent, footer, buttonLabel, preview, customFooter };
  const html = await render(h(SignLinkEmail, props));
  const text = await render(h(SignLinkEmail, props), { plainText: true });
  return { subject, html, text, bodyText, buttonLabel: buttonLabel || v.button, preview: preview || (isReminder ? `${W.reminder} ${documentTitle} ${v.waiting}` : W.sentYou(practiceName, documentTitle, v.to)) };
}


/**
 * ★★★ THE ONE SIGNING-EMAIL SENDER, REPLACING `sendSignLinkEmail`'s plain-text-only body.
 *
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.practiceName
 * @param {string|null} opts.logoUrl
 * @param {string} opts.documentTitle
 * @param {string} opts.recipientName
 * @param {string|null} opts.message      the document_instance's own message (migration 0539) —
 *                                        null/blank falls back to the Run → Templates wording
 * @param {string} opts.link
 * @param {string} opts.senderName
 * @param {string} [opts.fallbackTemplateKey] ★ FIX, 30 Sep 2026 ("unsigned-document reminder" brief)
 *   — which Run → Templates wording to fall back to when `message` is blank. Defaults to the
 *   first-send wording; `remindSigners` (src/documents/signLinks.mjs) passes
 *   `"document.sign_link_reminder"` so a REMINDER reads as a reminder, in this same branded frame,
 *   instead of going out through the old plain-text-only `sendSignLinkEmail` it used to.
 * @param {boolean} [opts.isReminder] ★ subject line says "Reminder:" — a second email with the exact
 *   same subject as the first looks like a duplicate, not a nudge.
 * @param {object} [opts.identity] ★ QUEUE §23.3.4 — the organisation's sending identity from the Documents island ({mode:'platform'|'domain', fromName, fromAddress, replyTo}).
 */
export async function sendSigningEmail({
  to, practiceName, logoUrl = null, documentTitle, recipientName, message = null, link, senderName,
  fallbackTemplateKey = "document.sign_link", isReminder = false, identity = null, subject = null, action = "sign", language = "en", accent = null, footer = null, buttonLabel = null, preview = null, customFooter = null,
}, { fetchImpl, env = process.env } = {}) {
  if (!emailIsConfigured(env)) {
    console.warn(`sendSigningEmail: RESEND_API_KEY is not set — skipping`);
    return { status: "skipped", providerMessageId: null, error: "RESEND_API_KEY is not set" };
  }
  const rendered = await renderSigningEmail({ practiceName, logoUrl, documentTitle, recipientName, message, link, senderName, fallbackTemplateKey, isReminder, subject, action, language, accent, footer, buttonLabel, preview, customFooter });
  const routed = redirectForEnvironment({ to, subject: rendered.subject }, env);
  const { from, replyTo } = identity ? fromLineFor(identity, { practiceName }, env) : { from: sendingAddress(env), replyTo: null };

  const outcome = await sendViaResend(
    { to: routed.to, from, subject: routed.subject, text: rendered.text, html: rendered.html, ...(replyTo ? { replyTo } : {}) },
    { fetchImpl, env });

  if (!outcome.ok) {
    return { status: "failed", providerMessageId: null, error: outcome.error };
  }
  return { status: "sent", providerMessageId: outcome.providerMessageId, error: null };
}
