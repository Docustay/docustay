// A document the assistant writes, as a short list of plain blocks, becomes a document SOURCE (the shared editor's JSON). Pure: no database, no network.
// The model never writes the editor's JSON itself: fewer ways to get it wrong, and the result always goes through parseSource.
//   {type:"heading", text, level?:1|2|3, senderOnly?:true}   {type:"paragraph", text}   {type:"bullets"|"numbered", items:[text]}
//   {type:"signature", role, label?}   {type:"field", fieldType, role, label?, required?}   {type:"payment", role, amount, currency?, label?}   {type:"rule"}   {type:"pagebreak"}
// Inside any text: **bold**, and {{Role.name}} / {{Role.email}} for a person's own name or email (resolved when the document is made).
import { slugWord } from "../engine/rolesOfSource.mjs";
import { parseSource } from "../engine/source.mjs";
import { PAYMENT_CURRENCIES } from "../flowDefinition.mjs";

const MAX_BLOCKS = 200, MAX_TEXT = 4000;
const FIELD_KINDS = new Set(["signature", "initials", "date_signed", "text", "date", "checkbox", "name", "smart_name", "smart_email", "email", "company", "title", "number", "phone"]);
const PAY_MIN = 0.5, PAY_MAX = 999_999.99;   // the wizard's own limits (engine/ai/payment.mjs)
/** A payment the person asked for in words, as the editor's own payment field. The model passes the number; this checks it and the existing payment code does the charging. → { ok, attrs } | { ok:false, error } */
export function paymentAttrs(b) {
  const raw = String(b?.amount ?? "").trim().replace(/^[$€£]/, "").replace(/,/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(raw)) return { ok: false, error: "a payment needs an amount as a plain number, for example 180 or 180.50" };
  const n = Number(raw); if (n < PAY_MIN || n > PAY_MAX) return { ok: false, error: "a payment must be between 0.50 and 999,999.99" };
  const currency = String(b?.currency ?? "usd").toLowerCase();
  if (!PAYMENT_CURRENCIES.includes(currency)) return { ok: false, error: `the payment currency must be one of ${PAYMENT_CURRENCIES.join(", ")}` };
  if (!b?.role) return { ok: false, error: "a payment needs the role of the person who pays" };
  return { ok: true, attrs: { name: clip(b.label || "Payment", 80), type: "payment", role: clip(b.role, 60), amount: n.toFixed(2), currency, required: "true" } };
}
const clip = (s, n = MAX_TEXT) => String(s ?? "").slice(0, n);

/** text with **bold** and {{Role.name}} tokens → inline nodes */
export function inlineOf(text) {
  const out = []; const t = clip(text);
  const re = /(\*\*[^*]+\*\*|\{\{\s*[^{}.]+\.(?:name|email)\s*\}\})/g; let last = 0, m;
  const plain = (s) => { if (s) out.push({ type: "text", text: s }); };
  while ((m = re.exec(t))) {
    plain(t.slice(last, m.index)); const tok = m[0];
    if (tok.startsWith("**")) for (const n of inlineOf(tok.slice(2, -2))) out.push(n.type === "text" ? { ...n, marks: [{ type: "bold" }] } : n);   // a name token inside bold stays a name token
    else { const [, role, what] = tok.match(/\{\{\s*([^{}.]+)\.(name|email)\s*\}\}/); out.push({ type: "variableChip", attrs: { name: `custom.p_${slugWord(role.trim())}_${what}`, label: `${role.trim()} ${what}` } }); }
    last = m.index + tok.length;
  }
  plain(t.slice(last));
  return out.length ? out : [{ type: "text", text: " " }];
}
const para = (text) => ({ type: "paragraph", content: inlineOf(text) });
const tag = (kind, role, label, required) => ({ type: "fieldTag", attrs: { name: clip(label || `${role} ${kind}`, 80), type: kind, role: clip(role, 60), ...(required === false ? { required: false } : {}) } });

/** @returns {{ok:boolean, source?:object, errors:string[], roles:string[]}} */
export function blocksToSource(blocks) {
  const errors = [];
  if (!Array.isArray(blocks) || !blocks.length) return { ok: false, errors: ["Give the document at least one block."], roles: [] };
  if (blocks.length > MAX_BLOCKS) return { ok: false, errors: [`At most ${MAX_BLOCKS} blocks.`], roles: [] };
  const content = [];
  blocks.forEach((b, i) => {
    const at = `block ${i + 1}`;
    if (!b || typeof b !== "object") { errors.push(`${at} is not a block`); return; }
    switch (b.type) {
      case "heading": { const level = [1, 2, 3].includes(b.level) ? b.level : 2; content.push({ type: "heading", attrs: { level, ...(b.senderOnly === true ? { audience: "sender" } : {}) }, content: [{ type: "text", text: clip(b.text, 200) || " " }] }); break; }
      case "paragraph": content.push(para(b.text)); break;
      case "bullets": case "numbered": {
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60); if (!items.length) { errors.push(`${at}: a list needs items`); break; }
        content.push({ type: b.type === "bullets" ? "bulletList" : "orderedList", content: items.map((x) => ({ type: "listItem", content: [para(x)] })) }); break;
      }
      case "signature": { if (!b.role) { errors.push(`${at}: a signature needs the role of the person who signs`); break; } content.push({ type: "paragraph", content: [{ type: "text", text: `${clip(b.label || `${b.role} signature`, 80)}: ` }, tag("signature", b.role, `${b.role} signature`), { type: "text", text: "   Date: " }, tag("date_signed", b.role, `${b.role} date`)] }); break; }
      case "field": {
        if (!b.role) { errors.push(`${at}: a field needs a role`); break; }
        if (!FIELD_KINDS.has(b.fieldType)) { errors.push(`${at}: field type must be one of ${[...FIELD_KINDS].join(", ")}`); break; }
        content.push({ type: "paragraph", content: [...(b.label ? [{ type: "text", text: `${clip(b.label, 80)}: ` }] : []), tag(b.fieldType, b.role, b.label, b.required)] }); break;
      }
      case "payment": { const pa = paymentAttrs(b); if (!pa.ok) { errors.push(`${at}: ${pa.error}`); break; } content.push({ type: "paragraph", content: [{ type: "text", text: `${clip(b.label || "Payment", 80)}: ` }, { type: "fieldTag", attrs: pa.attrs }] }); break; }
      case "rule": content.push({ type: "horizontalRule" }); break;
      case "pagebreak": content.push({ type: "pageBreak" }); break;
      default: errors.push(`${at}: unknown block type ${JSON.stringify(b.type)} (use heading, paragraph, bullets, numbered, signature, field, payment, rule, pagebreak)`);
    }
  });
  if (errors.length) return { ok: false, errors, roles: [] };
  const p = parseSource({ type: "doc", content });
  if (!p.ok) return { ok: false, errors: p.errors.slice(0, 5), roles: [] };
  const roles = []; const seen = (n) => { if (n?.type === "fieldTag" && n.attrs?.role && !roles.includes(n.attrs.role)) roles.push(n.attrs.role); (n?.content ?? []).forEach(seen); }; seen(p.source);
  return { ok: true, source: p.source, errors: [], roles };
}
