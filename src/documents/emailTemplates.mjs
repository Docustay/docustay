// src/documents/emailTemplates.mjs — THE DOCUMENTS ISLAND'S OWN EMAIL WORDINGS (Batch A, the maintainer 3 Oct 2026). Pure data: no imports but zod. The island owns what its emails SAY; the host's registry
// (src/email/registry.mjs) and renderer pick these up at load, so Run → Templates and Settings → Email still list and edit them, exactly as before. Default wording is UNCHANGED: every entry below was moved
// verbatim from the host's files (the registry, the hard-coded fallback table, the older shipped-defaults list), and `documents.email_code` is the signer's code message that used to be built inline.
//   DOCUMENT_EMAIL_TEMPLATES          the registry entries (key, name, event, recipients, schema, liquid)
//   DOCUMENT_TEMPLATE_FALLBACKS       the host's hard-coded render path ({version, subject, text}) for the three signing emails
//   DOCUMENT_TEMPLATE_REQUIRED_VARS   the variables that path insists on
//   DOCUMENT_DEFAULT_TEMPLATES        the older shipped-defaults list (read by the template editor)
import { z } from "zod";

export const DOCUMENT_EMAIL_TEMPLATES = Object.freeze([
  {
    key: "document.ready_to_sign",
    family: "documents",
    name: "Document ready to sign",
    description: "Sent when a document is sent to someone to review and sign.",
    event: "documents.document.sent",
    recipients: "the document's signer",
    schema: z.object({ "documentTitle": z.string(), "link": z.string(), "practiceName": z.string(), "recipientName": z.string(), "userType": z.object({ "member": z.string().optional() }).optional() }),
    liquid: {
      subject: "{{ practiceName }}: your {{ documentTitle }} is ready to sign",
      body: "Hello {{ recipientName }},\n\nYour {{ userType.member | default: \"Team member\" }} at {{ practiceName }} has sent you a document to review and sign: {{ documentTitle }}.\n\nOpen it here: {{ link }}\n\nNothing is signed until you choose to sign it, and you can read the whole document first.\n\n\u2014 {{ practiceName }}",
    },
  },
  {
    key: "document.sign_link",
    family: "documents",
    name: "Document sign link",
    description: "The document-signing link itself, sent to each signer.",
    event: null,
    recipients: "each signer",
    schema: z.object({ "documentTitle": z.string(), "link": z.string(), "practiceName": z.string(), "recipientName": z.string(), "senderName": z.string() }),
    liquid: {
      subject: "{{ practiceName }}: please read and sign {{ documentTitle }}",
      body: "Hello {{ recipientName }},\n\n{{ senderName }} at {{ practiceName }} has sent you a document to review and sign: {{ documentTitle }}.\n\nIt takes about a minute to read and sign.\n\nOpen it here: {{ link }}\n\nNo account needed.\n\n\u2014 {{ practiceName }}",
    },
  },
  {
    key: "document.sign_link_reminder",
    family: "documents",
    name: "Document sign reminder",
    description: "A reminder to a signer who has not yet signed.",
    event: null,
    recipients: "the outstanding signer",
    schema: z.object({ "documentTitle": z.string(), "link": z.string(), "practiceName": z.string(), "recipientName": z.string(), "senderName": z.string() }),
    liquid: {
      subject: "Reminder \u2014 {{ practiceName }}: please read and sign {{ documentTitle }}",
      body: "Hello {{ recipientName }},\n\nThis is a reminder from {{ senderName }} at {{ practiceName }}: {{ documentTitle }} is still waiting for your signature.\n\nIt takes about a minute to read and sign.\n\nOpen it here: {{ link }}\n\nNo account needed.\n\n\u2014 {{ practiceName }}",
    },
  },
  {
    // \u2605 PART 2 ADDITION ("every email on the one system", 1 Oct 2026) \u2014 the "signed-copy" email
    // (src/email/signedCopyEmail.mjs) sent its SUBJECT and body sentence fully hardcoded, with no
    // registry entry and no Run \u2192 Templates editability at all (the one outside sender the maintainer named
    // by this exact description). The branded React Email FRAME (logo, heading, footer, PDF
    // attachment) stays fixed, same deliberate split `documents.sign_link`'s own sibling
    // (signLinkEmail.mjs) already uses for the identical reason stated in both files' headers \u2014 only
    // the subject and body sentence become tenant-editable here. `executedLocalDate` is optional
    // (empty string, not null, when the signed date is not known) \u2014 same "" idiom this registry's
    // other optional free-text vars already use (e.g. auth.invite's personalLine).
    key: "documents.signed_copy",
    family: "documents",
    name: "Signed copy",
    description: "Sent to every signer (and the staff member who sent it) once a document is fully executed, with the signed PDF attached. Direct sender (sendSignedCopyEmail, from the archive_document_pdf job's first archive) — not reached via TOPIC_TEMPLATE/emailFor().",
    event: null,
    recipients: "every signer with an account, plus the staff member who sent it",
    schema: z.object({ "practiceName": z.string(), "recipientName": z.string(), "documentTitle": z.string(), "executedLocalDate": z.string() }),
    liquid: {
      subject: "Your signed copy of {{ documentTitle }}",
      body: "Hello {{ recipientName }},\n\n{{ documentTitle }} was fully signed{% if executedLocalDate != \"\" %} on {{ executedLocalDate }}{% endif %}. Your copy is attached to this email.\n\n\u2014 {{ practiceName }}",
    },
  },
  {
    key: "documents.document_expired",
    family: "documents",
    name: "Document lapsed unsigned",
    description: "Tells the sender a document expired before being signed.",
    event: "documents.document.expired",
    recipients: "the document's sender",
    schema: z.object({ "practiceName": z.string(), "recipientName": z.string(), "summary": z.string(), "link": z.string().optional() }),
    liquid: {
      subject: "{{ practiceName }}: a document lapsed unsigned",
      body: "Hello {{ recipientName }},\n\n{{ summary }} \u2014 it was sent for signature and the window closed before anyone signed it.\n\nYou can resend it, with a fresh deadline, from Documents.{% if link and link != '' %}\n\nOpen it: {{ link }}{% endif %}\n\n\u2014 {{ practiceName }}",
    },
  },
  {
    key: "documents.document_declined",
    family: "documents",
    name: "Document declined",
    description: "Tells the sender a signer declined a document.",
    event: "documents.document.declined",
    recipients: "the document's sender",
    schema: z.object({ "practiceName": z.string(), "recipientName": z.string(), "summary": z.string(), "link": z.string().optional() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary | split: ' \u2014 ' | first }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}.\n\nYou can see their reason, if they gave one, and follow up from Documents.{% if link and link != '' %}\n\nOpen it: {{ link }}{% endif %}\n\n\u2014 {{ practiceName }}",
    },
  },
  {
    key: "documents.opened",
    family: "documents",
    name: "Opened",
    description: "Internal notice: someone opened a document you sent.",
    event: "documents.document.opened",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}{% if link != '' %}\n\nOpen it: {{ link }}{% endif %}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.changes_requested",
    family: "documents",
    name: "Changes requested",
    description: "Internal notice: a person asked for changes to a document you sent.",
    event: "documents.document.changes_requested",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}\n\nIf the document needs to change, cancel it and send a corrected one.\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.bounced",
    family: "documents",
    name: "Email bounced",
    description: "Internal notice: an email for a document you sent could not be delivered.",
    event: "documents.document.bounced",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.signed",
    family: "documents",
    name: "Signed",
    description: "Internal notice: a document was signed.",
    event: "documents.document.signed",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}{% if link != '' %}\n\nOpen it: {{ link }}{% endif %}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.executed",
    family: "documents",
    name: "Executed",
    description: "Internal notice: everyone has signed a document, so it is complete.",
    event: "documents.document.executed",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}{% if link != '' %}\n\nOpen it: {{ link }}{% endif %}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.reminder_due",
    family: "documents",
    name: "Reminder Due",
    description: "Internal notice: a document is still waiting to be signed.",
    event: "documents.document.reminder_due",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.key_date_due",
    family: "documents",
    name: "Renewal notice date",
    description: "Internal notice (Pro): a signed contract's notice date is 30 or 7 days away.",
    event: "documents.key_date.due",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }} If the contract should not renew, this is the time to say so.{% if link != '' %}\n\nOpen it: {{ link }}{% endif %}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.playbook_ran",
    family: "documents",
    name: "An automation told you",
    description: "Internal notice (Pro): an automation reached its \"tell me\" step.",
    event: "documents.playbook.ran",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}{% if link != '' %}\n\nOpen it: {{ link }}{% endif %}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.payment_hold_lapsed",
    family: "documents",
    name: "A payment did not arrive",
    description: "Internal notice: a signature kept for its payment was not paid within 7 days, so it was not kept.",
    event: "documents.payment.hold_lapsed",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }} They have been told, and can still sign and pay with the link they were sent.{% if link != '' %}\n\nOpen it: {{ link }}{% endif %}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.disclosure_accepted",
    family: "documents",
    name: "Disclosure Accepted",
    description: "Internal notice: a disclosure was accepted.",
    event: "documents.disclosure.accepted",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.disclosure_withdrawn",
    family: "documents",
    name: "Disclosure Withdrawn",
    description: "Internal notice: a disclosure was withdrawn.",
    event: "documents.disclosure.withdrawn",
    recipients: "resolved from the event's own subject (falls back to practice staff)",
    schema: z.object({ practiceName: z.string(), recipientName: z.string(), summary: z.string(), link: z.string() }),
    liquid: {
      subject: "{{ practiceName }}: {{ summary }}",
      body: "Hello {{ recipientName }},\n\n{{ summary }}\n\n— {{ practiceName }}",
    },
  },
  {
    key: "documents.email_code",
    family: "documents",
    name: "Signer's email code",
    description: "Sent to a signer when the sender asked for an emailed code before the document can be opened.",
    event: null,
    recipients: "the person asked to open a document",
    schema: z.object({ "code": z.string(), "documentTitle": z.string(), "practiceName": z.string(), "minutes": z.string() }),
    liquid: {
      subject: "{{ code }} is your code for “{{ documentTitle }}”",
      body: "Your code is {{ code }}.\n\nIt opens “{{ documentTitle }}” from {{ practiceName }} and works for {{ minutes }} minutes. If you were not expecting this, ignore this email — nothing can be opened without the code.",
    },
  },
]);

export const DOCUMENT_TEMPLATE_FALLBACKS = {
  // ★ A document is waiting for them. The most consequential message in the product: it precedes a
  //   signature.
  "document.ready_to_sign": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: your ${v.documentTitle} is ready to sign`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${t("userType.member", "Team member")} at ${v.practiceName} has sent you a document to review ` +
      `and sign: ${v.documentTitle}.\n\n` +
      `Open it here: ${v.link}\n\n` +
      `Nothing is signed until you choose to sign it, and you can read the whole document first.\n\n` +
      `— ${v.practiceName}`,
  },
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 14.30 — SIGN-LINK MAIL. Sent by `src/email/documentLinkEmail.mjs`'s `sendSignLinkEmail`,
  //     NEVER `sendNotificationEmail` — same reasoning as `auth.*` above, restated for a signer who
  //     may have no `notificationId` to hang a delivery row off. ★ Neither template says one word of
  //     what the document contains — the blocked list (DOB, sobriety date, recovery fields, notes,
  //     emergency contact, consent detail, guardian relationship) never reaches a var here, and these
  //     two say only that a document is READY, never what is in it.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  "document.sign_link": {
    version: 1,
    subject: (v, t) => `${v.practiceName}: please read and sign ${v.documentTitle}`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.senderName && v.senderName !== v.practiceName ? `${v.senderName} at ${v.practiceName}` : v.practiceName} has sent you a document to review and sign: ` +
      `${v.documentTitle}.\n\n` +
      `It takes about a minute to read and sign.\n\n` +
      `Open it here: ${v.link}\n\n` +
      `No account needed.\n\n` +
      `— ${v.practiceName}`,
  },
  // ★ A later reminder for the same still-unsigned document — its own key so a signer's inbox shows
  //   the difference, and so a reminder sweep (task 14.28) can never accidentally send the FIRST-send
  //   wording twice.
  "document.sign_link_reminder": {
    version: 1,
    subject: (v, t) => `Reminder — ${v.practiceName}: please read and sign ${v.documentTitle}`,
    text: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `This is a reminder from ${v.senderName && v.senderName !== v.practiceName ? `${v.senderName} at ${v.practiceName}` : v.practiceName}: ${v.documentTitle} is still ` +
      `waiting for your signature.\n\n` +
      `It takes about a minute to read and sign.\n\n` +
      `Open it here: ${v.link}\n\n` +
      `No account needed.\n\n` +
      `— ${v.practiceName}`,
  },
};

export const DOCUMENT_TEMPLATE_REQUIRED_VARS = {
  "document.ready_to_sign": ["practiceName", "recipientName", "documentTitle", "link"],
  "document.sign_link":          ["practiceName", "recipientName", "documentTitle", "link", "senderName"],
  "document.sign_link_reminder": ["practiceName", "recipientName", "documentTitle", "link", "senderName"],
};

export const DOCUMENT_DEFAULT_TEMPLATES = [
  // ═════════════════════════════════════════════════════════════════════════════
  // ★ A document is waiting for them. The most consequential message in the product.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "document.ready_to_sign",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: your ${v.documentTitle} is ready to sign`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `Your ${t("userType.member", "Team member")} at ${v.practiceName} has sent you a document to review ` +
      `and sign: ${v.documentTitle}.\n\n` +
      `Open it here: ${v.link}\n\n` +
      `Nothing is signed until you choose to sign it, and you can read the whole document first.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle", "link", `userType.coach`],
  },
  // ═════════════════════════════════════════════════════════════════════════════
  // ★★★ TASK 14.30 — SIGN-LINK MAIL.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "document.sign_link",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: please read and sign ${v.documentTitle}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.senderName && v.senderName !== v.practiceName ? `${v.senderName} at ${v.practiceName}` : v.practiceName} has sent you a document to review and sign: ` +
      `${v.documentTitle}.\n\n` +
      `It takes about a minute to read and sign.\n\n` +
      `Open it here: ${v.link}\n\n` +
      `No account needed.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle", "link", "senderName"],
  },
  {
    key: "document.sign_link_reminder",
    family: "documents",
    subject: (v, t) => `Reminder — ${v.practiceName}: please read and sign ${v.documentTitle}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `This is a reminder from ${v.senderName && v.senderName !== v.practiceName ? `${v.senderName} at ${v.practiceName}` : v.practiceName}: ${v.documentTitle} is still ` +
      `waiting for your signature.\n\n` +
      `It takes about a minute to read and sign.\n\n` +
      `Open it here: ${v.link}\n\n` +
      `No account needed.\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "documentTitle", "link", "senderName"],
  },
  // ═════════════════════════════════════════════════════════════════════════════
  // ★ F836, "7 missing emails" brief, 1 Oct 2026 — four topics that already emitted
  //   (documents.document.expired/declined, money.credit_note.issued,
  //   money.entitlement.granted) with no email template or listener at all until now. Each
  //   notification's own `title` carries the specific wording (TOPIC_HANDLERS in
  //   src/queue/tasks.mjs), reused here as `v.summary` rather than re-derived.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    key: "documents.document_expired",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: a document lapsed unsigned`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.summary} — it was sent for signature and the window closed before anyone signed it.\n\n` +
      `You can resend it, with a fresh deadline, from Documents.` + (v.link ? `\n\nOpen it: ${v.link}` : ``) + `\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "summary", "link"],
  },
  {
    key: "documents.document_declined",
    family: "documents",
    subject: (v, t) => `${v.practiceName}: ${String(v.summary ?? "").split(" \u2014 ")[0] || "a document was declined"}`,
    html_body: "",
    text_body: (v, t) =>
      `Hello ${v.recipientName},\n\n` +
      `${v.summary}.\n\n` +
      `You can see their reason, if they gave one, and follow up from Documents.` + (v.link ? `\n\nOpen it: ${v.link}` : ``) + `\n\n` +
      `— ${v.practiceName}`,
    variables: ["practiceName", "recipientName", "summary", "link"],
  },
];
