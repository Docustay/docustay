// src/documents/emailMessages.mjs — A WORKSPACE'S OWN WORDING FOR ITS DOCUMENT EMAILS (FP-K1/K2, 7 Oct 2026).
// Nine message types, each with standard wording (Docustay v1 removed the editor that let a workspace change it): subject, preview line, body, button label and footer. The body is plain text with {{variables}} that THIS FILE substitutes — no template language is run on
// anything a customer types. An unknown variable is refused when it is saved, so a typo never reaches a signer. The sign button and its link are always in the email: the wording changes, the link cannot be removed.
// ★ Email goes ONLY to people named on a document the workspace made (FP-K5): this file never takes a recipient; callers pass the document's own person.
import { LANGUAGES } from "./languages.mjs";
import { ports } from "./ports.mjs";

const COMMON = ["signer.name", "signer.email", "document.title", "sender.name", "org.name"];

/** The nine message types. `vars` are the only {{names}} a message of that type may use. `button` = the email carries the sign button. */
export const MESSAGE_KINDS = Object.freeze([
  { kind: "invitation", label: "Signing invitation", to: "each person asked to sign", button: true, vars: [...COMMON, "link"],
    subject: "{{org.name}}: please read and sign {{document.title}}", preview: "{{sender.name}} sent you {{document.title}} to sign.",
    body: "{{sender.name}} at {{org.name}} has sent you a document to review and sign: {{document.title}}.\n\nIt takes about a minute to read and sign. No account needed.", buttonLabel: "Review and sign" },
  { kind: "reminder", label: "Reminder", to: "a person who has not signed yet", button: true, vars: [...COMMON, "link"],
    subject: "Reminder — {{org.name}}: please read and sign {{document.title}}", preview: "{{document.title}} is still waiting for your signature.",
    body: "This is a reminder from {{sender.name}} at {{org.name}}: {{document.title}} is still waiting for your signature.\n\nIt takes about a minute to read and sign.", buttonLabel: "Review and sign" },
  // completed, declined and expired are sent by the host from its own email templates (the same ones the platform edits), so they use THAT template's variable names and a saved wording is also stored there (the `templates` port).
  { kind: "completed", label: "Completed copy", to: "everyone, when the document is fully signed", button: false, host: "documents.signed_copy", vars: ["practiceName", "recipientName", "documentTitle", "executedLocalDate"],
    subject: "Your signed copy of {{documentTitle}}", preview: "Everyone has signed {{documentTitle}}. Your copy is attached.",
    body: "Hello {{recipientName}},\n\n{{documentTitle}} was fully signed. Your copy is attached to this email.\n\n— {{practiceName}}", buttonLabel: "" },
  { kind: "declined", label: "Declined", to: "the person who sent the document, when someone declines", button: false, host: "documents.document_declined", vars: ["practiceName", "recipientName", "summary", "link"],
    subject: "{{practiceName}}: a document was declined", preview: "{{summary}}",
    body: "Hello {{recipientName}},\n\n{{summary}}.\n\nYou can see their reason, if they gave one, and follow up from Documents.\n\n— {{practiceName}}", buttonLabel: "" },
  { kind: "voided", label: "Cancelled", to: "people who were asked to sign, when the sender cancels the document", button: false, vars: [...COMMON, "reason"],
    subject: "{{org.name}}: {{document.title}} was cancelled", preview: "{{sender.name}} cancelled {{document.title}}. You do not need to sign it.",
    body: "{{sender.name}} at {{org.name}} cancelled {{document.title}}. You do not need to do anything, and the link you were sent no longer opens it.\n\nReason given: {{reason}}", buttonLabel: "" },
  { kind: "expired", label: "Expired", to: "the person who sent the document, when it lapses unsigned", button: false, host: "documents.document_expired", vars: ["practiceName", "recipientName", "summary"],
    subject: "{{practiceName}}: a document lapsed unsigned", preview: "{{summary}}",
    body: "Hello {{recipientName}},\n\n{{summary}} — it was sent for signature and the window closed before anyone signed it.\n\nYou can resend it, with a fresh deadline, from Documents.\n\n— {{practiceName}}", buttonLabel: "" },
  { kind: "code", label: "Verification code", to: "a person opening a document that asks for an email code", button: false, vars: [...COMMON, "code", "minutes"],
    subject: "{{code}} is your code for “{{document.title}}”", preview: "Your code is {{code}}.",
    body: "Your code is {{code}}.\n\nIt opens “{{document.title}}” from {{org.name}} and works for {{minutes}} minutes. If you were not expecting this, ignore this email — nothing can be opened without the code.", buttonLabel: "" },
  { kind: "receipt", label: "Payment receipt", to: "the person who paid while signing", button: false, vars: [...COMMON, "amount", "description"],
    subject: "Receipt: {{amount}} to {{org.name}}", preview: "Thank you. Your payment of {{amount}} went through.",
    body: "Thank you, {{signer.name}}. Your payment of {{amount}} ({{description}}) for {{document.title}} went through.\n\nStripe also sends its own receipt to the email you paid with.", buttonLabel: "" },
  // Run 9 Part 3.7: a signature kept for its payment for 7 days was not paid — nothing of it was kept, and the same link signs again
  { kind: "hold_lapsed", label: "Payment not received", to: "a person who signed but did not finish paying within 7 days", button: false, vars: [...COMMON],
    subject: "{{org.name}}: {{document.title}} is not signed yet", preview: "Your payment did not arrive, so your signature was not kept.",
    body: "Your signature on {{document.title}} was waiting for its payment, and the payment did not arrive within 7 days, so your signature was not kept.\n\nThe link in the email you were first sent still opens it: you can sign and pay again there, until the document's own deadline.", buttonLabel: "" },
]);

const KIND_BY = new Map(MESSAGE_KINDS.map((k) => [k.kind, k]));
export const messageKind = (kind) => KIND_BY.get(kind) ?? null;

const VAR = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/** The variables a text uses, in order, without repeats. */
export const variablesIn = (text) => [...new Set([...String(text ?? "").matchAll(VAR)].map((m) => m[1]))];

/** Replace {{name}} with the value (unknown or missing → empty text). Never runs anything. */
export const fill = (text, vars = {}) => String(text ?? "").replace(VAR, (_, name) => (vars[name] == null ? "" : String(vars[name])));

const localeOf = (l) => (LANGUAGES.includes(String(l ?? "en").slice(0, 2)) ? String(l ?? "en").slice(0, 2) : "en");

/**
 * The wording that applies right now: this language's saved row, else English's, else the standard — field by field, so a workspace that only changed the subject keeps the standard body.
 * Docustay v1: the wording is no longer editable, so a Docustay workspace always gets the standard text and any row an older version saved is ignored (kept, not deleted).
 * Returns the TEXT still containing {{variables}}; `render` below fills them.
 */
export async function wordingFor(tx, { kind, locale = "en" }) {
  if (!KIND_BY.has(kind)) return null;
  if (await (await ports()).brand?.isDocustay?.(tx).catch?.(() => false)) return { kind, custom: false, subject: null, preview: null, body: null, buttonLabel: null, footer: null };
  const loc = localeOf(locale);
  const { rows: [r] } = await tx.query(`SELECT subject, preview, body, button_label, footer FROM keystone.document_email_message WHERE kind = $1 AND locale = $2`, [kind, loc]);
  return { kind, custom: Boolean(r), subject: r?.subject ?? null, preview: r?.preview ?? null, body: r?.body ?? null, buttonLabel: r?.button_label ?? null, footer: r?.footer ?? null };
}

/** Fill a wording's fields with a person's real values. Standard text is the fallback for any field left unset (only when `standard` is true). */
export function render(wording, vars, { standard = false, kind = wording?.kind } = {}) {
  const k = KIND_BY.get(kind);
  const f = (field, std) => { const t = wording?.[field] ?? (standard ? std : null); return t == null ? null : fill(t, vars); };
  return { subject: f("subject", k?.subject), preview: f("preview", k?.preview), body: f("body", k?.body), buttonLabel: f("buttonLabel", k?.buttonLabel), footer: wording?.footer ? fill(wording.footer, vars) : null };
}

/** Sample values for a preview or a test send — made-up, never a real person's. */
export const sampleVars = (org = "Your company") => ({
  "signer.name": "Alex Sample", "signer.email": "alex@example.com", "document.title": "Services agreement", "sender.name": "Jordan Example", "org.name": org,
  practiceName: org, recipientName: "Jordan Example", documentTitle: "Services agreement", executedLocalDate: "7 October 2026", summary: "Alex Sample declined Services agreement",
  link: "https://sign.example.com/sign?t=sample", code: "482 913", minutes: "15", reason: "I need to change a clause.", amount: "$150.00", description: "Deposit", signed_date: "7 October 2026",
});
