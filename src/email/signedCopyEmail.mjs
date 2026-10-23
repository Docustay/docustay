// @ts-check
// FIX, 30 Sep 2026 — "EMAIL THE SIGNED COPY." The portal's own sign page (webreact/src/routes/sign.jsx)
// tells every signer "Signed. You'll get a PDF by email." — and nothing has ever sent one. Chat checked
// Resend directly: the three signing-REQUEST emails went out; after signing, nothing at all.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ SAME FRAME AS THE SIGNING EMAIL, DELIBERATELY. `signLinkEmail.mjs`'s own header states the
//     rule this module follows too: the logo, practice name, document name and footer are the SAME
//     branded frame for every practice — never built from message text. Only this email has no
//     button to click (nothing left to do) and a PDF attached (something to keep).
// ★★★ SENT ONCE PER RECIPIENT, ATTACHING THE SAME BYTES `archiveExecutedPdf` JUST VERIFIED AGAINST
//     THE OBJECT STORE'S OWN DIGEST — never a second render that could disagree with the archived
//     artefact a reader could separately download later.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createElement as h } from "react";
import { logoBlock, lightOnlyMeta } from "./emailLogo.mjs";
import { render } from "@react-email/render";
import {
  Html, Head, Preview, Body, Container, Section, Img, Heading, Text, Hr,
} from "@react-email/components";
import { deliverAsOrganisation } from "./deliver.mjs";
import { emailIsConfigured } from "./resend.mjs";
import { renderTemplate } from "./templates.mjs";

import { signingWords, sentenceCase } from "../documents/frontDoor.mjs";
const BRAND_COLOR = "#5A3AC1";

// ★ PART 2 ADDITION ("every email on the one system", 1 Oct 2026) — subject/body sentence now come
//   from the registry's "documents.signed_copy" template (tenant-editable in Run → Templates),
//   same deliberate "fixed frame, editable copy" split `signLinkEmail.mjs`'s own sibling already
//   uses — the FRAME below (logo, heading, footer, PDF attachment) is still never built from the
//   rendered text, only the one body sentence is.
function SignedCopyEmail({ practiceName, logoUrl, documentTitle, recipientName, bodyText, subject, words = null, downloadUrl = null, language = "en" }) {
  const greeting = words ? words.hello(recipientName) : `Hello ${recipientName || "there"},`;
  return h(Html, { lang: language, dir: language === "ar" ? "rtl" : "ltr" },
    h(Head, null, ...lightOnlyMeta(h)),
    h(Preview, null, subject),
    h(Body, { style: { backgroundColor: "#f4f4f5", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", margin: 0, padding: "32px 0" } },
      h(Container, { style: { backgroundColor: "#ffffff", borderRadius: "12px", maxWidth: "480px", margin: "0 auto", padding: "32px" } },
        logoBlock(h, { logoUrl, practiceName }),
        h(Heading, { style: { fontSize: "20px", fontWeight: 600, color: "#18181b", margin: "0 0 16px" } },
          words ? words.heading : "Signed"),
        h(Text, { style: { fontSize: "15px", color: "#3f3f46", lineHeight: "22px", margin: "0 0 8px" } }, greeting),
        h(Text, { style: { fontSize: "15px", color: "#3f3f46", lineHeight: "22px", margin: "0 0 24px", whiteSpace: "pre-wrap" } },
          // the saved wording usually opens with the same greeting the layout already prints: say it once
          bodyText.startsWith(greeting) ? bodyText.slice(greeting.length).replace(/^\s+/, "") : bodyText),
        downloadUrl ? h(Text, { style: { fontSize: "15px", lineHeight: "22px", margin: "0 0 24px" } },
          h("a", { href: downloadUrl, style: { color: BRAND_COLOR, fontWeight: 600 } }, words?.download ?? "Download the signed copy")) : null,
        h(Hr, { style: { borderColor: "#e4e4e7", margin: "24px 0" } }),
        h(Text, { style: { fontSize: "12px", color: "#a1a1aa", margin: 0 } },
          words ? words.footer(practiceName) : `Sent by ${practiceName}. Keep this email for your records.`),
      ),
    ),
  );
}

/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.practiceName
 * @param {string|null} opts.logoUrl
 * @param {string} opts.documentTitle
 * @param {string} opts.recipientName
 * @param {string|null} opts.executedLocalDate
 * @param {Buffer} opts.pdfBytes
 * @param {object} [opts.tx]        ★ PART 2 ADDITION — the withTenant handle, when the caller has
 *   one (tasks.mjs's call site does). Forwarded to renderTemplate's `resolve` param so a tenant's
 *   Run → Templates override of "documents.signed_copy" wins; omitted → the shipped default.
 * @param {string} [opts.tenantId]  paired with `tx`; both or neither.
 * @returns {Promise<{status:'sent'|'skipped'|'failed', providerMessageId:string|null, error:string|null}>}
 */
export async function sendSignedCopyEmail({
  to, practiceName, logoUrl = null, documentTitle, recipientName, executedLocalDate = null, pdfBytes, certificateBytes = null, downloadUrl = null,
  tx, tenantId,
  // ★ QUEUE §23.3.4 — when the caller supplies `deliver({to, subject, html, text, attachments})`, the email is handed to it instead of going straight to the platform provider: the Documents island
  //   sends it with the organisation's own sending identity (platform, its own domain, or its own SMTP server). Without it, behaviour is unchanged.
  deliver = null, language = "en",
}, { fetchImpl, env = process.env } = {}) {
  if (!downloadUrl && (!Buffer.isBuffer(pdfBytes) || pdfBytes.length === 0)) {
    throw new Error("sendSignedCopyEmail: pdfBytes must be a non-empty Buffer — refusing to send an email that claims to attach a copy with nothing attached");
  }
  if (!deliver && !emailIsConfigured(env)) {
    console.warn(`sendSignedCopyEmail: RESEND_API_KEY is not set — skipping`);
    return { status: "skipped", providerMessageId: null, error: "RESEND_API_KEY is not set" };
  }

  const rendered = await renderTemplate("documents.signed_copy", {
    practiceName, recipientName, documentTitle, executedLocalDate: executedLocalDate ?? "",
  }, {}, tx && tenantId ? { tx, tenantId } : {});
  // es / fr / de: the fixed words come from signingWords.mjs (English keeps the editable template)
  const words = signingWords(language)?.signed ?? null;
  const subject = words ? words.subject(documentTitle) : rendered.subject;
  // D-009: when the copy travels as a link (no attachment) the words must not say it is attached
  const bodyText = sentenceCase(words ? (downloadUrl ? words.bodyLink(documentTitle, practiceName) : words.body(documentTitle, practiceName))
    : (downloadUrl ? rendered.text.replace("Your copy is attached to this email.", "Your copy is ready to download with the link below.") : rendered.text));
  const html = await render(h(SignedCopyEmail, { practiceName, logoUrl, documentTitle, recipientName, bodyText, subject, words, downloadUrl, language }));
  const text = await render(h(SignedCopyEmail, { practiceName, logoUrl, documentTitle, recipientName, bodyText, subject, words, downloadUrl, language }), { plainText: true });

  // ★ Resend's filename rules refuse a path separator or a leading dot — the title is a free-text
  //   field an author typed, so it is sanitised rather than trusted as a filename.
  const safeName = (documentTitle || "document").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "document";

  // A download link replaces the attachment (the sealed copy then travels by link, never in the mailbox); a separate certificate rides along when the organisation keeps it apart.
  const attachments = downloadUrl ? [] : [{ filename: `${safeName}.pdf`, content: pdfBytes.toString("base64") }];
  if (!downloadUrl && Buffer.isBuffer(certificateBytes) && certificateBytes.length) attachments.push({ filename: `${safeName} - certificate.pdf`, content: certificateBytes.toString("base64") });
  if (deliver) {
    const out = await deliver({ to, subject, html, text, ...(attachments.length ? { attachments } : {}) });   // R13-D056: a link-only copy has NO attachments; Resend refuses an empty list, so the key is left out
    return { status: out.status, providerMessageId: out.providerMessageId ?? null, error: out.error ?? null };
  }
  const out = await deliverAsOrganisation(tx ?? null, { tenantId: tenantId ?? null, to, subject, text, html, ...(attachments.length ? { attachments } : {}) }, { fetchImpl, env });
  return { status: out.status === "limit_reached" ? "skipped" : out.status, providerMessageId: out.providerMessageId, error: out.error };
}
