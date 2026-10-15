// src/documents/emailPreview.mjs — PREVIEW AND "SEND ME A TEST" FOR A WORKSPACE'S EMAIL WORDING (FP-K2). Sample values only: a preview never shows a real person, and a test goes only to the person asking for it.
import { ports } from "./ports.mjs";
import { sendMail, signingMailOptions } from "./emailIdentity.mjs";
import { messageKind, checkDraft, wordingFor, render, sampleVars } from "./emailMessages.mjs";
import { invalid } from "../http/errors.mjs";
import { plainFrame } from "./emailFrame.mjs";

export async function previewMessage(tx, { tenantId, kind, locale = "en", draft = null }) {
  const k = messageKind(kind);
  if (!k) throw invalid("unknown message type", { field: "kind" });
  const P = await ports();
  const brand = await P.brand.get(tx, { tenantId });
  const org = brand.practiceName || brand.tenantName || "Your company";
  const saved = await wordingFor(tx, { kind, locale });
  const wording = draft ? { kind, custom: true, ...(saved ?? {}), ...checkDraft(kind, draft) } : saved;
  const vars = sampleVars(org);
  if (kind === "expired") vars.summary = "Services agreement (sent to Alex Sample)";   // D-078: nobody declined — the sample must not say so
  const r = render(wording, vars, { standard: true, kind });
  if (k.button) {
    // ★ Run 8 (R8-8): the signing email is previewed through the SAME options and frame a real send uses (signingMailOptions), so its subject, sentence, button and footer are what the person will get, in that language
    const opts = await signingMailOptions(tx, { tenantId, wording, to: vars["signer.email"], practiceName: org, logoUrl: brand.logoUrl ?? null, documentTitle: vars["document.title"], recipientName: vars["signer.name"], link: vars.link, senderName: vars["sender.name"],
      isReminder: kind === "reminder", fallbackTemplateKey: kind === "reminder" ? "document.sign_link_reminder" : "document.sign_link", language: locale });
    const out = await P.mailer.renderSigningEmail(opts);
    return { kind, locale, subject: out.subject, preview: out.preview, body: out.bodyText, buttonLabel: out.buttonLabel, footer: r.footer, html: out.html };
  }
  const html = plainFrame({ org, subject: r.subject, body: r.body, footer: r.footer });
  return { kind, locale, subject: r.subject, preview: r.preview, body: r.body, buttonLabel: r.buttonLabel, footer: r.footer, html };
}

/** Send the preview to the person who asked (their own address only). Returns what the mail module answered. */
export async function sendTestMessage(tx, { tenantId, kind, locale = "en", draft = null, actorUserId }) {
  const P = await ports();
  const [me] = actorUserId ? await P.people.byIds(tx, [actorUserId]) : [];
  if (!me?.email) throw invalid("Your own email address is needed to send you a test.", { field: "email" });
  const p = await previewMessage(tx, { tenantId, kind, locale, draft });
  const out = await sendMail(tx, { tenantId, to: me.email, subject: `[Test] ${p.subject}`, html: p.html, text: `${p.body}\n`, log: { kind, isTest: true } });
  return { sent: out.status === "sent", status: out.status, error: out.error ?? null, to: me.email };
}

