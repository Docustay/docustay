// THE PRO GATE FOR THE CHAT. Two layers, both on the server:
//  1. UP FRONT (Run 8, the maintainer 11 Oct 2026): the moment the person ASKS for a Pro thing, before the model runs and before any question, their words are matched against the Pro items here.
//     When the plan does not include it, the answer is a plain "this is part of Pro" with Explore Pro and what can be done on their plan instead — no model call, no credits, no questions.
//  2. THE BACKSTOP: when the model calls a tool that needs Pro (worded some other way), the tool does not run and the same card is shown.
// Making a document or a form with AI is NOT Pro (the maintainer, Run 8): Free does it within its monthly AI credits. A workspace on no Docustay plan (self-hosted, the platform) is never limited.
import { ports } from "../ports.mjs";

/** Where Explore Pro goes: the website's Pro section and pricing (the maintainer). */
export const EXPLORE_PRO_URL = "https://docustay.app/pricing#pro";

/** Which Pro item a tool call needs, if any. Pure. */
export function proItemFor(name, input) {
  void name; void input;   // v1 item 16: Scribe actions and list sends are on every plan; no tool needs Pro any more
  return null;
}
/** Run 9 (the maintainer, decision 2): Scribe ACTING for the person — sending, reminding, voiding, making a template, setting reminders — is Pro. Asking, reading, explaining, the checks, a copy or a draft from a
 *  template (nothing is sent) and talking to support stay on every plan. The card's button re-checks this (`SCRIBE_ACTIONS`, confirm.mjs), so a card made while on Pro does nothing after Pro ends. */
export const SCRIBE_ACTIONS = Object.freeze(new Set(["send", "remind", "resend", "void", "remind_many", "make_template", "set_reminders"]));
const SCRIBE_ACTION_TOOLS = new Set([...SCRIBE_ACTIONS].map((a) => `docustay.confirm.${a}`));

/** The Pro items a person can ASK for in words, in the order they are tried. Pure regexes over the person's message (English; other wordings still meet the backstop). */
const INTENTS = Object.freeze([
  { item: "custom_plays", re: /\b(make|create|build|write|save|set up|add)\s+(me\s+)?(a |an |my |our )?(own |custom |new )?(play|playbook)s?\b(?!\s+(to|for) (make|create|draft))|\bmy own (plays?|playbooks?)\b/i },
  { item: "plays_api", re: /\bplays? (api|endpoint)s?\b|\bdrafts api\b/i },
]);
/** The first Pro item the words ask for, or null. Pure. */
export function proIntent(text) {
  const s = String(text ?? "").slice(0, 4000);
  for (const it of INTENTS) if (it.re.test(s)) return it.item;
  return null;
}

/** What each Pro item is called, and what the person CAN do on their plan instead (each a message the chat sends, or a page). One list for the up-front answer and the backstop. */
const PRO_ANSWERS = Object.freeze({
  custom_plays: { what: "Your own plays and playbooks", instead: [{ label: "Use a built-in play", link: "/plays" }, { label: "Keep it as a template", prompt: "Help me make this into a template instead." }] },
  plays_api: { what: "The Plays and drafts API", instead: [{ label: "Use the documents API", link: "/settings?tab=dev" }] },
});
const ITEM_OF = Object.freeze({});   // the plan item each answer is checked against (none differ now)

/** The card both layers show. Pure. */
function proCard(item) {
  const a = PRO_ANSWERS[item] ?? { what: "This", instead: [] };
  const body = `${a.what} is part of Docustay Pro and Lifetime.${a.instead.length ? " On your plan I can still:" : ""}`;
  return { item, title: "This is part of Pro and Lifetime", body, instead: a.instead, link: EXPLORE_PRO_URL, linkLabel: "Explore Pro", external: true };
}

const entitledTo = async (db, tenantId, item) => {
  let P; try { P = await ports(); } catch { return true; }
  if (!P?.entitlements?.isEntitled) return true;
  return Boolean(await P.entitlements.isEntitled(db, { tenantId, item: ITEM_OF[item] ?? item }));
};

/** A PLAN LIMIT met by a tool (Run 8 verify): the month's new templates or documents are used. The tool refused with the server's own plain words; this card says them on screen whatever the model
 *  then writes, with what the person can still do and Explore Pro — the same card shape as the Pro answers. → null for any other failure. Pure. */
export function limitCard(result) {
  const code = result?.code;
  const facts = { code, used: result.used ?? null, limit: result.limit ?? null, resetsAt: result.resetsAt ?? null };   // F1012: the browser words the card from these, in the person's language
  if (code === "plan_template_limit") return { ...facts, item: "unlimited_templates", title: "This month's new templates are used", body: String(result.error ?? ""), instead: [{ label: "Use one of my templates", link: "/templates" }, { label: "Make a one-off document", prompt: "Make this as a one-off document instead, not a template." }], link: EXPLORE_PRO_URL, linkLabel: "Explore Pro", external: true };
  if (code === "plan_signer_limit") return { ...facts, item: "signer_limit", title: "This month's new signers are used", body: String(result.error ?? ""), instead: [{ label: "Send to someone I already sent to", link: "/contacts" }, { label: "See my usage", link: "/billing" }], link: EXPLORE_PRO_URL, linkLabel: "Explore Pro", external: true };
  if (code === "plan_document_limit") return { ...facts, item: "unlimited_documents", title: "This month's documents are used", body: String(result.error ?? ""), instead: [{ label: "See my usage", link: "/billing" }], link: EXPLORE_PRO_URL, linkLabel: "Explore Pro", external: true };
  return null;
}

/** UP FRONT: → null to carry on, or { item, card, text } to answer at once without the model. */
export async function proUpFront(db, { tenantId, text }) {
  const item = proIntent(text); if (!item) return null;
  if (await entitledTo(db, tenantId, item)) return null;
  const card = proCard(item);
  return { item, card, text: card.body };
}

/** THE BACKSTOP: → null when allowed, else { item, error, card }. */
export async function proGate(db, { tenantId, name, input }) {
  const item = proItemFor(name, input); if (!item) return null;
  if (await entitledTo(db, tenantId, item)) return null;
  const card = proCard(item);
  return { item, error: `${card.body} Tell the person this plainly, offer what they can do instead, and do not try another way around it.`, card };
}
