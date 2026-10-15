// src/documents/emailMessages.mjs — A WORKSPACE'S OWN WORDING FOR ITS DOCUMENT EMAILS (FP-K1/K2, 7 Oct 2026).
// Eight message types, each editable per language: subject, preview line, body, button label and footer. The body is plain text with {{variables}} that THIS FILE substitutes — no template language is run on
// anything a customer types. An unknown variable is refused when it is saved, so a typo never reaches a signer. The sign button and its link are always in the email: the wording changes, the link cannot be removed.
// ★ Email goes ONLY to people named on a document the workspace made (FP-K5): this file never takes a recipient; callers pass the document's own person.
import { z } from "zod";
import { invalid } from "../http/errors.mjs";
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
  // Run 7: one email to the workspace owner per signed form response (the form's "Email me each new response" switch). It names who responded and links to the response; it never carries the answers.
  { kind: "form_response", label: "New form response", to: "the workspace owner, for each signed response to a form", button: false, vars: ["signer.name", "signer.email", "form.name", "document.title", "org.name", "link"],
    subject: "New response to {{form.name}} from {{signer.name}}", preview: "{{signer.name}} filled in and signed {{form.name}}.",
    body: "{{signer.name}} ({{signer.email}}) filled in and signed {{form.name}}.\n\nOpen the response: {{link}}\n\nThis email does not include the answers. They are in the signed document.", buttonLabel: "" },
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

const Draft = z.object({
  subject: z.string().max(200).optional().nullable(), preview: z.string().max(200).optional().nullable(), body: z.string().max(5000).optional().nullable(),
  buttonLabel: z.string().max(60).optional().nullable(), footer: z.string().max(500).optional().nullable()
});

/** Check a draft against its message type: every variable known to that type, nothing too long. Throws a sentence naming the field and the variable. */
export function checkDraft(kind, draft) {
  const k = KIND_BY.get(kind);
  if (!k) throw invalid(`kind must be one of ${MESSAGE_KINDS.map((m) => m.kind).join(", ")}`, { field: "kind" });
  const r = Draft.safeParse(draft ?? {});
  if (!r.success) throw invalid(`${r.error.issues[0].path.join(".") || "message"}: ${r.error.issues[0].message}`, { field: String(r.error.issues[0].path[0] ?? "message") });
  const clean = {};
  for (const f of ["subject", "preview", "body", "buttonLabel", "footer"]) {
    const v = r.data[f];
    if (v === undefined) continue;
    const text = v === null ? "" : String(v).replace(/\r\n/g, "\n");
    const unknown = variablesIn(text).filter((n) => !k.vars.includes(n));
    if (unknown.length) throw invalid(`${f} uses {{${unknown[0]}}}, which a “${k.label}” message cannot use. You can use: ${k.vars.map((n) => `{{${n}}}`).join(", ")}`, { field: f });
    if (/\{\{|\}\}|\{%|%\}/.test(text.replace(VAR, ""))) throw invalid(`${f} has a stray { or } pair. Variables look like {{document.title}}; nothing else in braces is allowed.`, { field: f });
    if ((f === "subject" || f === "preview" || f === "buttonLabel") && /\n/.test(text)) throw invalid(`${f} must be one line`, { field: f });
    clean[f] = text.trim() === "" ? null : text;
  }
  return clean;
}

const localeOf = (l) => (LANGUAGES.includes(String(l ?? "en").slice(0, 2)) ? String(l ?? "en").slice(0, 2) : "en");

/** All eight types for one language: the workspace's saved wording (or null) beside the standard wording. */
export async function listMessages(tx, { locale = "en" } = {}) {
  const loc = localeOf(locale);
  const { rows } = await tx.query(`SELECT kind, locale, subject, preview, body, button_label, footer, updated_at FROM keystone.document_email_message WHERE locale = $1`, [loc]);
  const by = new Map(rows.map((r) => [r.kind, r]));
  const { rows: langs } = await tx.query(`SELECT kind, array_agg(locale ORDER BY locale) AS locales FROM keystone.document_email_message GROUP BY kind`);
  const has = new Map(langs.map((r) => [r.kind, r.locales]));
  return MESSAGE_KINDS.map((k) => {
    const r = by.get(k.kind);
    return { kind: k.kind, label: k.label, to: k.to, button: k.button, vars: k.vars, locale: loc, languages: has.get(k.kind) ?? [],
      standard: { subject: k.subject, preview: k.preview, body: k.body, buttonLabel: k.buttonLabel },
      saved: r ? { subject: r.subject, preview: r.preview, body: r.body, buttonLabel: r.button_label, footer: r.footer, updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at } : null };
  });
}

export async function saveMessage(tx, { tenantId, kind, locale = "en", draft, userId = null }) {
  const clean = checkDraft(kind, draft);
  const loc = localeOf(locale);
  await tx.query(
    `INSERT INTO keystone.document_email_message (tenant_id, kind, locale, subject, preview, body, button_label, footer, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, kind, locale) DO UPDATE SET subject = EXCLUDED.subject, preview = EXCLUDED.preview, body = EXCLUDED.body, button_label = EXCLUDED.button_label, footer = EXCLUDED.footer,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [tenantId, kind, loc, clean.subject ?? null, clean.preview ?? null, clean.body ?? null, clean.buttonLabel ?? null, clean.footer ?? null, userId]);
  await syncHost(tx, { tenantId, kind, locale: loc, clean, userId });
  return (await listMessages(tx, { locale: loc })).find((m) => m.kind === kind);
}

// The three emails the HOST sends (completed copy, declined, expired) read their wording from the host's own template store, so a saved English wording is also written there. Other languages keep the fixed
// translated emails. Standard text stands in for any field left blank, so the stored template is always complete.
async function syncHost(tx, { tenantId, kind, locale, clean, userId }) {
  const k = KIND_BY.get(kind);
  if (!k?.host || locale !== "en") return;
  const P = await ports();
  if (!P.templates) return;
  if (!clean.subject && !clean.body) { await P.templates.clear(tx, { tenantId, key: k.host }); return; }
  await P.templates.override(tx, { tenantId, key: k.host, subject: clean.subject ?? k.subject, text: clean.body ?? k.body, userId });
}

/** Back to the standard wording for this type and language. */
export async function resetMessage(tx, { tenantId, kind, locale = "en" }) {
  if (!KIND_BY.has(kind)) throw invalid("unknown message type", { field: "kind" });
  await tx.query(`DELETE FROM keystone.document_email_message WHERE kind = $1 AND locale = $2`, [kind, localeOf(locale)]);
  await syncHost(tx, { tenantId, kind, locale: localeOf(locale), clean: {}, userId: null });
  return (await listMessages(tx, { locale })).find((m) => m.kind === kind);
}

/**
 * The wording that applies right now: this language's saved row, else English's, else the standard — field by field, so a workspace that only changed the subject keeps the standard body.
 * Returns the TEXT still containing {{variables}}; `render` below fills them.
 */
export async function wordingFor(tx, { kind, locale = "en" }) {
  if (!KIND_BY.has(kind)) return null;
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
