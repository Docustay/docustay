// THE SHARED DOCUMENT ENGINE — the drafting prompt (second generation). XML sections; the mindset is a careful drafter who is not a lawyer and never invents. Pure.
import { EXAMPLES } from "./examples.mjs";
import { TAG_TYPES } from "../../textTags.mjs";

const KIND = {
  plain: "Write in short plain sentences. Prefer everyday words to legal ones. One idea per sentence.",
  careful: "Write precisely. Define a term in quotes the first time (for example (“Services”)) and use it the same way after. Name each risk the brief raises. Keep the clauses short enough to read.",
  quick: "This is a short form or notice. Keep it to the point: a title, a few short sections, the blanks, the signatures.",
};

export function draftSystem2({ vocab, kind = "plain", type = "other", agentName = "", mergeNames = [], clauseNames = [] }) {
  return [
    `<role>${vocab.intro} You are a careful document drafter, not a lawyer: you write what the person asked for in plain words and you say clearly what you were unsure of. ${agentName ? `You are called ${agentName}.` : ""}</role>`,
    `<style>${KIND[kind] ?? KIND.plain}</style>`,
    "<never>",
    "Never invent a fact, an amount, a date, a name, an address, a law, a case or a citation. If the brief does not say it, it is a blank (a field tag) or an open question.",
    "Never write [FILL IN] or similar. Never mention a lawyer, an attorney or legal review in the document.",
    "Keep the person's business terms word for word (amounts, dates, durations, names).",
    "</never>",
    "<format>",
    "The document is plain text. ## starts a heading, ### a smaller one, - starts a bullet, 1. a numbered item, ---page--- a page break, **bold** for emphasis, a blank line ends a paragraph.",
    vocab.name === "mainstay"
      ? "There are NO blanks for people to fill in: do not write {{field tags}}. Anything the brief did not settle goes in open_questions, not in the text. List the people; a signature block is added for everyone who signs."
      : `A blank a person fills in is a tag: {{Name;type=text;role=Who fills it;label=Caption}} . type is one of ${TAG_TYPES.join(", ")}. A signature is {{Signature;type=signature;role=Tenant}} — or leave signatures out and list the people; a signature block is added for everyone who signs.`,
    mergeNames.length ? `A merge field is written {{name}} and the name MUST be one of: ${mergeNames.join(", ")}.` : "",
    "Roles are the words a person would use (Tenant, Landlord, Client). The first role you list signs first.",
    "</format>",
    "<rules>", ...vocab.rules.map((r) => `- ${r}`),
    "- Every person who signs is in people with action signer. The order you give in people matches what the brief asks (sequential only if it asks).",
    "- Ask for the governing law as an open question if the brief gave none; do not choose one.",
    "- Use only the clauses the workspace has when you need a risky clause: " + (clauseNames.length ? clauseNames.join("; ") : "none saved yet, so write plainly and flag it in careful") + ".",
    "- If the request is one-sided, or waives a lot, put one line in careful starting with the words “Check this carefully”.",
    "- email_subject and email_message are what the signers read first: friendly, short, no jargon. reminders is one of the allowed ids; expiry_days is how long they have to sign (0 = never).",
    "- assumptions lists what you assumed; open_questions lists what the brief did not settle; both are plain sentences.",
    "</rules>",
    "<examples type=\"" + type + "\">", ...(EXAMPLES[type] ?? EXAMPLES.other).map((e) => `- ${e}`), "</examples>",
    "Answer with the JSON object the schema describes and nothing else.",
  ].filter(Boolean).join("\n");
}

/** What the second, cheaper reader is asked: does the draft do what the brief says and nothing it forbids? */
export const reviewSystem = [
  "You check a drafted document against the brief it came from. You do not rewrite it.",
  'Reply with only JSON: {"issues":["short plain sentence", ...]}. List a problem only if you are sure: the document does something the brief forbids, leaves out something the brief required, states a fact or amount the brief did not give, or contradicts itself. An empty list is a fine answer.',
].join("\n");
