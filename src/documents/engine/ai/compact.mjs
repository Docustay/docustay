// THE SHARED DOCUMENT ENGINE — the COMPACT DRAFT. The model writes the document as plain text with the same {{field tags}} the ready-made starters use, NOT as nested editor JSON
// (that was 3-4x longer and was cut off at the output limit, which showed a person "could not be read"). This file holds: the JSON schema the provider enforces (Anthropic structured
// outputs), the converter text → source, and the deterministic checks that run on every draft before a person sees it. Pure.
import { textToNodes } from "../fromHtml.mjs";
import { ACTION_ROLES, REMINDER_CHOICES } from "../../flowDefinition.mjs";

const ACTIONS = ACTION_ROLES.map((r) => r.id);
export const DRAFT_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["title", "document", "people", "signing_order", "email_subject", "email_message", "reminders", "expiry_days", "assumptions", "open_questions", "careful"],
  properties: {
    title: { type: "string" },
    document: { type: "string" },
    people: { type: "array", items: { type: "object", additionalProperties: false, required: ["role", "action", "step"], properties: { role: { type: "string" }, action: { type: "string", enum: ACTIONS }, step: { type: "integer" } } } },
    signing_order: { type: "string", enum: ["all", "sequential"] },
    email_subject: { type: "string" },
    email_message: { type: "string" },
    reminders: { type: "string", enum: REMINDER_CHOICES.map((r) => r.id) },
    expiry_days: { type: "integer" },
    assumptions: { type: "array", items: { type: "string" } },
    open_questions: { type: "array", items: { type: "string" } },
    careful: { type: "array", items: { type: "string" } },
  },
});

/** The draft schema; with a typed payment the model also returns payment_plan (data only: the worker checks it against what the person typed). */
export const draftSchema = (withPayment) => withPayment ? { ...DRAFT_SCHEMA, required: [...DRAFT_SCHEMA.required, "payment_plan"], properties: { ...DRAFT_SCHEMA.properties, payment_plan: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "amount_minor", "payer_role", "when"], properties: { label: { type: "string" }, amount_minor: { type: "integer" }, payer_role: { type: "string" }, when: { type: "string" } } } } } } } } : DRAFT_SCHEMA;

const slug = (s) => { let k = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); if (!/^[a-z]/.test(k)) k = `signer_${k}`.replace(/_$/, ""); return k.slice(0, 40) || "signer"; };

function inlineNodes(text) {
  const out = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) out.push(...textToNodes(part.slice(2, -2), [{ type: "bold" }]));
    else out.push(...textToNodes(part, []));
  }
  return out;
}

/** The compact text → { source, tagRoles } . Lines: `## ` heading, `### ` smaller heading, `- ` bullet, `1. ` numbered, `---page---` page break, blank line ends a paragraph. */
export function compactToSource(text, people = []) {
  const content = []; let para = [], list = null, ordered = false, n = 0;
  const flushPara = () => { if (para.length) { content.push({ type: "paragraph", content: inlineNodes(para.join(" ")) }); para = []; } };
  const flushList = () => { if (list) { content.push({ type: ordered ? "orderedList" : "bulletList", content: list.map((t) => ({ type: "listItem", content: [{ type: "paragraph", content: inlineNodes(t) }] })) }); list = null; } };
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trimEnd();
    if (/^---page---$/i.test(line.trim())) { flushPara(); flushList(); content.push({ type: "pageBreak" }); continue; }
    if (/^---+$/.test(line.trim())) { flushPara(); flushList(); content.push({ type: "horizontalRule" }); continue; }
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) { flushPara(); flushList(); content.push({ type: "heading", attrs: { level: h[1].length === 1 ? 1 : h[1].length, key: `s${++n}` }, content: [{ type: "text", text: h[2].replace(/\*\*/g, "") }] }); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const li = line.match(/^(?:- |\* )(.+)$/), ol = line.match(/^\d+[.)] (.+)$/);
    if (li || ol) { flushPara(); const isOl = Boolean(ol); if (list && ordered !== isOl) flushList(); ordered = isOl; (list ??= []).push((li ?? ol)[1]); continue; }
    flushList(); para.push(line.trim());
  }
  flushPara(); flushList();
  const tagRoles = new Set(), signatureRoles = new Set();
  const visit = (nodes) => { for (const nd of nodes ?? []) { if (nd.type === "fieldTag") { const r = nd.attrs.role || "Signer"; tagRoles.add(r); if (/^(signature|sign)$/i.test(nd.attrs.type ?? "")) signatureRoles.add(r); } if (nd.content) visit(nd.content); } };
  visit(content);
  // everyone who signs and has no signature field in the text gets a slot in a signature block at the end
  const missing = people.filter((p) => p.action === "signer" && !signatureRoles.has(p.role));
  if (missing.length) {
    const taken = new Set(); const slots = missing.map((p) => { let k = slug(p.role), i = 2; while (taken.has(k)) k = `${slug(p.role)}_${i++}`; taken.add(k); return { key: k, label: p.role, role: p.role }; });
    content.push({ type: "heading", attrs: { level: 2, key: `s${++n}`, requiresSignature: true }, content: [{ type: "text", text: "Signatures" }] }, { type: "signatureBlock", attrs: { slots } });
  }
  return { source: { type: "doc", content }, tagRoles: [...tagRoles], signatureRoles: [...signatureRoles] };
}

const money = (s) => [...String(s).matchAll(/(?:\$|USD\s?|€|£)\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) => Number(m[1].replace(/,/g, "")));

/** Deterministic checks on a draft + its brief. Returns { problems:[string] } — each a plain sentence for the person (they go on the Check screen, none of them blocks). */
export function checkDraft(draft, { briefText = "", names = [] } = {}) {
  const problems = [];
  const people = Array.isArray(draft.people) ? draft.people : [];
  const { signatureRoles, tagRoles } = compactToSource(draft.document, []);
  const slots = []; // signers named in the document by a signature block are added by compactToSource; here we check what the writer actually wrote
  const signers = people.filter((p) => p.action === "signer");
  if (!signers.length) problems.push("Nobody is set to sign this document.");
  for (const p of signers) if (!signatureRoles.includes(p.role) && !new RegExp(p.role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(draft.document)) problems.push(`${p.role} signs, but the text never mentions them.`);
  for (const r of tagRoles) if (!people.some((p) => p.role === r)) problems.push(`A blank is for “${r}”, who is not on the list of people.`);
  if (draft.signing_order === "sequential") { const steps = signers.map((p) => p.step); if (new Set(steps).size !== steps.length) problems.push("It says people sign one after another, but two of them share the same turn."); }
  if (!Number.isInteger(draft.expiry_days) || draft.expiry_days < 0 || draft.expiry_days > 365) problems.push("The time allowed to sign is not sensible; set it yourself in Details.");
  const tags = [...String(draft.document).matchAll(/\{\{([^{}\n]{1,600})\}\}/g)].map((m) => m[1]);
  for (const t of tags) { const lab = /(?:^|;)\s*label\s*=\s*([^;]*)/i.exec(t); const nm = t.split(";")[0].trim(); if (t.includes(";") && !(lab ? lab[1].trim() : nm)) problems.push("A blank has no label, so the person filling it in would not know what it is."); }
  const defined = [...String(draft.document).matchAll(/[(“"]\s*(?:the\s+)?“?([A-Z][A-Za-z ]{2,30})”?\s*[)”"]/g)].map((m) => m[1].trim());
  for (const term of new Set(defined)) { const uses = String(draft.document).split(term).length - 1; if (uses < 2) problems.push(`“${term}” is defined but never used again.`); }
  const allowed = new Set(money(briefText)); for (const a of money(draft.document)) if (!allowed.has(a)) problems.push(`The amount ${a} is in the text but not in what you asked for. Check it.`);
  for (const t of tags) { const head = t.split(";")[0].trim(); if (!t.includes(";") && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(head) && names.length && !names.includes(head) && !head.startsWith("custom.")) problems.push(`The merge field ${head} does not exist in this workspace.`); }
  return { problems: [...new Set(problems)] };
}
