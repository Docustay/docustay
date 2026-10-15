// F1012 (Run 9): Scribe's cards worded in the person's language. The server sends each card's FACTS (kind, titles, names, counts) with its English words; this file words them through t(),
// so a German conversation shows German cards. A card stored before the facts existed (no `kind`) keeps the English it was saved with. The English labels and prompts of the Pro cards are the keys here:
// the server's words are fixed, so the table below always matches them (the test reads pro.mjs and checks every one is here).
import { t, whenText } from "$lib/i18n/index.svelte.js";
import { tl } from "$lib/flow/flowLabels.js";
import { roleLabel } from "$lib/flow/flowDefinition.js";

const people = (n) => t("{n, plural, one {# person} other {# people}}", { n });
const action = (a) => tl(roleLabel(a ?? "signer"));
const after = (days) => t("after {days} days", { days: days.join(", ") });
const PARTY = () => ({ signed: t("Signed"), pending: t("Pending"), waiting: t("Waiting"), declined: t("Declined"), viewed: t("Viewed"), sent: t("Sent"), approved: t("Approved"), rejected: t("Rejected"), cancelled: t("Cancelled"), closed: t("Not needed"), awaiting_payment: t("Waiting to pay") });
const who = (p) => `${p.name} <${p.email ?? t("no email")}>`;

/** A confirmation card: → { title, summary, button, lines } in the person's language, or null when the card carries no facts (an older card: show its stored words). */
export function confirmWords(card) {
  switch (card?.kind) {
    case "send": {
      const lines = [...(card.people ?? []).map((p) => ({ label: action(p.action), value: who(p) })), { label: t("Subject"), value: card.subject || t("Please sign: {title}", { title: card.docTitle }) },
        { label: t("Expires"), value: card.expiryDays ? t("after {n, plural, one {# day} other {# days}}", { n: card.expiryDays }) : card.expiryDays === 0 ? t("Never") : t("the workspace default") },
        ...((card.reminderDays ?? []).length ? [{ label: t("Reminders"), value: after(card.reminderDays) }] : []), ...(card.sequential ? [{ label: t("Signing order"), value: tl("One after another") }] : [])];
      return { title: t("Send “{title}”", { title: card.docTitle }), summary: card.test ? t("This is a TEST: it goes only to you and is stamped TEST. Nobody else receives anything.") : t("This sends the document for signature to {people} now.", { people: people(card.n ?? 0) }), button: card.test ? t("Send test") : t("Send now"), lines };
    }
    case "remind": case "resend":
      return { title: card.kind === "resend" ? t("Resend the signing email to {name}", { name: card.name }) : t("Send a reminder on “{title}”", { title: card.docTitle }), summary: t("{n, plural, one {# person gets} other {# people get}} an email now.", { n: card.n ?? 0 }), button: card.kind === "resend" ? t("Resend") : t("Send reminder"), lines: (card.people ?? []).map((p) => ({ label: action(p.action), value: who(p) })) };
    case "void":
      return { title: t("Void “{title}”", { title: card.docTitle }), summary: t("Voiding stops it: nobody can sign any more and the people are told it was cancelled. This cannot be undone."), button: t("Void it"), lines: (card.people ?? []).map((p) => ({ label: action(p.action), value: `${p.name} — ${PARTY()[p.status] ?? p.status}` })) };
    case "copy":
      return { title: t("Copy “{title}”", { title: card.docTitle }), summary: t("Makes a new draft with the same words, people and choices. Nothing is sent."), button: t("Make a copy"), lines: [] };
    case "use_template":
      return { title: t("Make “{title}” from the template", { title: card.docTitle }), summary: t("Makes a new draft for these people from the template. Nothing is sent; you can open and change it first."), button: t("Make the draft"), lines: (card.people ?? []).map((p) => ({ label: p.role || action(p.action), value: who(p) })) };
    case "bulk_send":
      return { title: t("Send to a list of {people}", { people: people(card.n ?? 0) }), summary: card.failed ? t("{n, plural, one {# document goes} other {# documents go}} out now, one to each person; {failed, plural, one {# row cannot be sent and will be skipped} other {# rows cannot be sent and will be skipped}}. Each is a real send.", { n: card.n ?? 0, failed: card.failed }) : t("{n, plural, one {# document goes} other {# documents go}} out now, one to each person. Each is a real send.", { n: card.n ?? 0 }), button: t("Send {n}", { n: card.n ?? 0 }),
        lines: [...(card.rows ?? []).map((r) => ({ label: t("Recipient"), value: who(r) })), ...(card.more ? [{ label: t("Recipient"), value: t("and {n} more", { n: card.more }) }] : [])] };
    case "support":
      return { title: card.which === "problem" ? t("Report a problem") : t("Talk to a person"), summary: t("This sends the screen you are on and the ids of what is open, plus what you wrote. It does not send any of your document's words unless you tick the box."), button: t("Send"), lines: [{ label: t("Screen"), value: card.screen || t("Unknown") }, ...(card.documentId ? [{ label: t("Document id"), value: card.documentId }] : [])] };
    default: return null;
  }
}

/** What a pressed card says it did: → a sentence in the person's language, or null for a card with no facts (the server's own summary is shown). */
export function doneWords(card, result) {
  const d = result?.detail ?? null;
  switch (card?.kind) {
    case "send": {
      if (!d) return null; const missed = d.notEmailed ?? [];
      if (missed.length) return missed.some((m) => m.reason === "limit_reached") ? t("Sent, but {n, plural, one {# person was} other {# people were}} not emailed: today's email limit was reached; send a reminder after midnight UTC.", { n: missed.length }) : t("Sent, but {n, plural, one {# person was} other {# people were}} not emailed: the email could not be sent; check Settings → Email, then send a reminder.", { n: missed.length });
      return d.emailed ? t("Sent. {n, plural, one {# email} other {# emails}} went out.", { n: d.emailed }) : t("Sent.");
    }
    case "remind": case "resend": return d ? t("{n, plural, one {# reminder} other {# reminders}} sent.", { n: d.reminded ?? 0 }) : null;
    case "void": return t("Voided. The people were told it was cancelled.");
    case "copy": return t("Copied. The new draft is ready to open.");
    case "use_template": return t("The draft is made from the template.");
    case "bulk_send": {
      if (!d) return null;
      const first = d.failed ? t("Sent {sent}; {failed} could not be sent.", { sent: d.sent ?? 0, failed: d.failed }) : t("Sent {sent}.", { sent: d.sent ?? 0 });
      return d.notEmailed ? `${first} ${t("{n, plural, one {# person was} other {# people were}} not emailed (today's email limit). Send them a reminder after midnight UTC.", { n: d.notEmailed })}` : first;
    }
    case "support": return (d?.which ?? card.which) === "problem" ? t("Thank you. The problem is reported with the screen and ids.") : t("Thank you. A person will get back to you by email.");
    default: return null;
  }
}

// The Pro answers (pro.mjs PRO_ANSWERS) and the plan-limit cards (limitCard), keyed by the server's item and English words
const PRO_BODY = {
  bulk_send: () => t("Sending one template to a list of people is part of Docustay Pro."),
  ai_bulk: () => t("Sending to a list from the chat is part of Docustay Pro."),
  custom_plays: () => t("Your own plays and playbooks are part of Docustay Pro."),
  recurring_payments: () => t("Installments and subscriptions inside a document are part of Docustay Pro."),
  auto_reminders: () => t("Automatic reminders are part of Docustay Pro."),
  team_roles: () => t("Adding people to your team, with roles, is part of Docustay Pro."),
  hide_footer: () => t("Removing the Docustay footer is part of Docustay Pro."),
  own_signing_domain: () => t("Signing links on your own domain are part of Docustay Pro."),
  plays_api: () => t("The plays and drafts API is part of Docustay Pro."),
  scribe_actions: () => t("Scribe sending, reminding, voiding and making templates for you is part of Docustay Pro."),
};
export const PRO_INSTEAD = {
  "Send it to one person myself": () => t("Send it to one person myself"),
  "Make a form with one link": () => t("Make a form with one link"),
  "Use a built-in play": () => t("Use a built-in play"),
  "Keep it as a template": () => t("Keep it as a template"),
  "Take a one-time payment": () => t("Take a one-time payment"),
  "Take a deposit": () => t("Take a deposit"),
  "See who has not signed": () => t("See who has not signed"),
  "Open my documents": () => t("Open my documents"),
  "Send a document to them instead": () => t("Send a document to them instead"),
  "Add my logo": () => t("Add my logo"),
  "Send email from my own domain": () => t("Send email from my own domain"),
  "Use the documents API": () => t("Use the documents API"),
  "Show me who has not signed": () => t("Show me who has not signed"),
  "Use one of my templates": () => t("Use one of my templates"),
  "Make a one-off document": () => t("Make a one-off document"),
  "See my usage": () => t("See my usage"),
};
export const PRO_PROMPTS = {
  "Make me a form that everyone on my list can fill in from one link.": () => t("Make me a form that everyone on my list can fill in from one link."),
  "Help me make this into a template instead.": () => t("Help me make this into a template instead."),
  "Add a one-time payment to this document.": () => t("Add a one-time payment to this document."),
  "Add a deposit to this document.": () => t("Add a deposit to this document."),
  "Which of my documents are still waiting for a signature?": () => t("Which of my documents are still waiting for a signature?"),
  "Make this as a one-off document instead, not a template.": () => t("Make this as a one-off document instead, not a template."),
};
export { PRO_BODY };

/** A Pro or plan-limit card: → { title, body, instead, linkLabel } in the person's language. Anything not in the tables keeps the server's words. */
export function proWords(card) {
  const when = card?.resetsAt ? whenText(card.resetsAt, { day: "numeric", month: "long", timeZone: "UTC" }) : t("the first of next month");
  const limit = card?.code === "plan_template_limit" ? { title: t("This month's new templates are used"), body: t("You have made all {limit} new templates your Free plan includes this month. You can still use and edit every template you have. New ones open again on {date}.", { limit: card.limit ?? "?", date: when }) }
    : card?.code === "plan_document_limit" ? { title: t("This month's documents are used"), body: t("You have sent all {limit} documents your Free plan includes this month. Sending opens again on {date}.", { limit: card.limit ?? "?", date: when }) } : null;
  const pro = !limit && PRO_BODY[card?.item] ? { title: t("This is part of Pro"), body: `${PRO_BODY[card.item]()}${card.instead?.length ? ` ${t("On your plan I can still:")}` : ""}` } : null;
  const instead = (card?.instead ?? []).map((a) => ({ ...a, label: PRO_INSTEAD[a.label]?.() ?? a.label, ...(a.prompt ? { prompt: PRO_PROMPTS[a.prompt]?.() ?? a.prompt } : {}) }));
  return { title: limit?.title ?? pro?.title ?? card?.title, body: limit?.body ?? pro?.body ?? card?.body, instead, linkLabel: card?.linkLabel === "Explore Pro" || !card?.linkLabel ? t("Explore Pro") : card.linkLabel };
}

/** The answer given at once for a Pro thing (no model ran) is the card's own English body; show it in the person's language. Any other message is the model's, already in their language. */
export function botText(m) {
  const pro = (m?.proposals ?? []).find((p) => p.kind === "pro" && p.card?.body);
  return pro && String(m.text ?? "").trim() === pro.card.body.trim() ? proWords(pro.card).body : m?.text;
}
