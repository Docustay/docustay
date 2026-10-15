// THE SHARED DOCUMENT ENGINE — the source format (design: specs/SHARED-DOCUMENT-ENGINE-DESIGN-6OCT.md §3.1). Pure, no imports of the host.
// A document SOURCE is a TipTap/ProseMirror `doc` with a CLOSED node set, so the editor, the two compilers and the AI agree on one thing:
//   doc > block+
//   block   heading{level 1-3, key?, owner?} · paragraph · bulletList/orderedList > listItem > paragraph · horizontalRule · pageBreak · signatureBlock{slots}
//   inline  text{marks: bold · italic · underline · link{href}} · hardBreak · variableChip{name,label} (a merge field) · fieldTag{name,type,role,…} (a text tag)
// `parseSource` returns { ok, source, errors[], warnings[] } — it never throws on bad input, and it NORMALISES (drops unknown attrs, trims, fills defaults) so
// two equal documents hash equal. `sourceHash` is the template-text hash recon found missing on the contract path.
import { checkRule, evaluateRule } from "../rules.mjs";
import { createHash } from "node:crypto";

export const SOURCE_VERSION = 1;
export const KEY_RE = /^[a-z][a-z0-9_]*$/;
const MARKS = new Set(["bold", "italic", "underline", "link"]);
const FIELD_ATTRS = ["name", "type", "role", "required", "default", "options", "label", "width", "height", "max_length", "autofill", "editable", "placeholder", "tooltip", "locked", "amount", "currency", "formula", "price", "link", "show", "calc", "places", "filled", "from"];   // filled/from: Run 9 Part 4.2 (a box the sender fills in)   // show/calc/places: Run 9 (a box's rule and formula)
const MAX_NODES = 20000;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const httpUrl = (s) => { try { const u = new URL(String(s)); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } };

export function parseSource(input) {
  const errors = [], warnings = [];
  let count = 0;
  const err = (path, msg) => errors.push(`${path}: ${msg}`);
  const warn = (path, msg) => warnings.push(`${path}: ${msg}`);

  const marks = (raw, path) => {
    const out = [];
    for (const m of Array.isArray(raw) ? raw : []) {
      if (!isObj(m) || !MARKS.has(m.type)) { err(path, `unknown mark ${JSON.stringify(m?.type)}`); continue; }
      if (m.type === "link") {
        const href = m.attrs?.href;
        if (!httpUrl(href)) { err(path, "a link needs an http or https address"); continue; }
        out.push({ type: "link", attrs: { href: String(href) } });
      } else out.push({ type: m.type });
    }
    // canonical order so the same marks always hash the same
    const order = ["bold", "italic", "underline", "link"];
    return out.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  };

  const inline = (nodes, path, { allowMarks = true } = {}) => {
    const out = [];
    (Array.isArray(nodes) ? nodes : []).forEach((n, i) => {
      const p = `${path}[${i}]`;
      if (++count > MAX_NODES) { err(p, "the document is too large"); return; }
      if (!isObj(n)) { err(p, "not a node"); return; }
      if (n.type === "text") {
        if (typeof n.text !== "string" || n.text === "") { err(p, "a text node needs text"); return; }
        const m = allowMarks ? marks(n.marks, p) : [];
        out.push(m.length ? { type: "text", text: n.text, marks: m } : { type: "text", text: n.text });
      } else if (n.type === "hardBreak") out.push({ type: "hardBreak" });
      else if (n.type === "variableChip") {
        const name = String(n.attrs?.name ?? "").trim();
        if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(name)) { err(p, `a merge field name looks like signer.name; got ${JSON.stringify(name)}`); return; }
        const ca = { name, label: String(n.attrs?.label ?? name).trim() || name };
        // Docustay flow v3: a TEMPLATE VARIABLE (custom.*) says what the sender is asked: its kind, a starting value and a line of help
        if (name.startsWith("custom.")) { const k = String(n.attrs?.kind ?? ""); if (["text", "number", "money", "date"].includes(k)) ca.kind = k; for (const [a, max] of [["default", 300], ["help", 200]]) { const v = n.attrs?.[a]; if (typeof v === "string" && v.trim()) ca[a] = v.trim().slice(0, max); } }
        out.push({ type: "variableChip", attrs: ca });
      } else if (n.type === "fieldTag") {
        const a = isObj(n.attrs) ? n.attrs : {};
        const name = String(a.name ?? "").trim();
        if (!name || /[{};\n]/.test(name)) { err(p, "a field needs a name without { } or ;"); return; }
        const attrs = { name };
        for (const k of FIELD_ATTRS) if (k !== "name" && a[k] !== undefined && a[k] !== null && a[k] !== "") attrs[k] = typeof a[k] === "boolean" ? a[k] : String(a[k]);
        out.push({ type: "fieldTag", attrs });
      } else err(p, `a ${JSON.stringify(n.type)} cannot appear inside a paragraph`);
    });
    return out;
  };

  const para = (n, path) => {
    const c = inline(n.content, `${path}.content`);
    return c.length ? { type: "paragraph", content: c } : { type: "paragraph" };
  };

  const list = (n, path, depth) => {
    const items = [];
    (Array.isArray(n.content) ? n.content : []).forEach((li, i) => {
      const p = `${path}.content[${i}]`;
      if (!isObj(li) || li.type !== "listItem") { err(p, "a list holds list items"); return; }
      const kids = Array.isArray(li.content) ? li.content : [];
      const paras = kids.filter((k) => k?.type === "paragraph");
      if (kids.some((k) => k?.type === "bulletList" || k?.type === "orderedList")) warn(p, "nested lists are flattened away in the contract view");
      if (paras.length > 1) warn(p, "only the first paragraph of a list item is kept in the contract view");
      items.push({ type: "listItem", content: [paras[0] ? para(paras[0], `${p}.content[0]`) : { type: "paragraph" }] });
    });
    return { type: n.type, content: items };
  };

  const cell = (c, path) => {
    if (!isObj(c) || (c.type !== "tableCell" && c.type !== "tableHeader")) { err(path, "a table row holds cells"); return null; }
    const attrs = {};
    for (const k of ["colspan", "rowspan"]) if (c.attrs?.[k] !== undefined && c.attrs[k] !== null && Number(c.attrs[k]) > 1) attrs[k] = Math.min(12, Math.floor(Number(c.attrs[k])));
    if (c.attrs?.width !== undefined && c.attrs.width !== null && /^\d{1,3}%$/.test(String(c.attrs.width))) attrs.width = String(c.attrs.width);
    const paras = (Array.isArray(c.content) ? c.content : []).filter((k) => k?.type === "paragraph").map((k, i) => para(k, `${path}.content[${i}]`));
    return { type: c.type, ...(Object.keys(attrs).length ? { attrs } : {}), content: paras.length ? paras : [{ type: "paragraph" }] };
  };
  const table = (n, path) => {
    const rows = [];
    (Array.isArray(n.content) ? n.content : []).forEach((r, i) => {
      if (!isObj(r) || r.type !== "tableRow") { err(`${path}.content[${i}]`, "a table holds rows"); return; }
      const cells = (Array.isArray(r.content) ? r.content : []).map((c, j) => cell(c, `${path}.content[${i}].content[${j}]`)).filter(Boolean);
      if (cells.length) rows.push({ type: "tableRow", content: cells });
    });
    if (!rows.length) { err(path, "a table needs at least one row"); return null; }
    return { type: "table", content: rows };
  };

  const slot = (s, i, path) => {
    if (!isObj(s)) { err(path, "a signature slot is an object"); return null; }
    const label = String(s.label ?? "").trim();
    if (!label) { err(path, "a signature slot needs a label"); return null; }
    const key = String(s.key ?? "").trim() || `slot_${i + 1}`;
    if (!KEY_RE.test(key)) { err(path, `slot key ${JSON.stringify(key)} must be lower-case letters, digits and _ and start with a letter`); return null; }
    const out = { key, label };
    if (s.owner !== undefined && s.owner !== "") out.owner = String(s.owner);
    if (s.role !== undefined && s.role !== "") out.role = String(s.role);
    if (s.required === false) out.required = false;
    if (s.showDate === false) out.showDate = false;
    if (s.showPrintedName === false) out.showPrintedName = false;
    return out;
  };

  const doc = (() => {
    if (!isObj(input) || input.type !== "doc") { err("$", 'a source is { "type": "doc", "content": [...] }'); return null; }
    const content = [];
    (Array.isArray(input.content) ? input.content : []).forEach((n, i) => {
      const p = `$.content[${i}]`;
      if (++count > MAX_NODES) { err(p, "the document is too large"); return; }
      if (!isObj(n)) { err(p, "not a node"); return; }
      switch (n.type) {
        case "heading": {
          const level = Number(n.attrs?.level ?? 2);
          if (![1, 2, 3].includes(level)) { err(p, "heading level is 1, 2 or 3"); return; }
          const c = inline(n.content, `${p}.content`, { allowMarks: false });
          if (!c.length || c.some((x) => x.type !== "text")) { err(p, "a heading is plain text"); return; }
          const attrs = { level };
          const key = n.attrs?.key;
          if (key !== undefined && key !== null && key !== "") { if (!KEY_RE.test(String(key))) { err(p, `section key ${JSON.stringify(key)} must be lower-case letters, digits and _ and start with a letter`); return; } attrs.key = String(key); }
          if (n.attrs?.owner) attrs.owner = String(n.attrs.owner);
          if (n.attrs?.requiresSignature === true) attrs.requiresSignature = true;
          if (n.attrs?.audience === "sender") attrs.audience = "sender";   // additive (Docustay flow v2): a section only the sender sees
          // Run 9: a CONDITIONAL section — it is in the document only when this rule holds. It may read only what the sender fills in before sending (custom.*), so it is decided when the
          // document is made and the text reflows; nobody who signs ever sees a section appear or vanish.
          if (n.attrs?.showWhen != null) {
            let vars; try { vars = checkRule(n.attrs.showWhen); } catch (e) { err(p, `the section's rule: ${e.message}`); return; }
            const bad = vars.find((x) => !/^custom\.[A-Za-z0-9_]{1,60}$/.test(x));
            if (bad) { err(p, `the section's rule reads “${bad}”. A section can only depend on what you fill in before sending (a custom value such as custom.has_pets)`); return; }
            attrs.showWhen = n.attrs.showWhen;
          }
          content.push({ type: "heading", attrs, content: c });
          break;
        }
        case "paragraph": content.push(para(n, p)); break;
        case "bulletList": case "orderedList": content.push(list(n, p, 0)); break;
        case "horizontalRule": case "pageBreak": content.push({ type: n.type }); break;
        case "table": { const t = table(n, p); if (t) content.push(t); break; }
        case "signatureBlock": {
          const slots = (Array.isArray(n.attrs?.slots) ? n.attrs.slots : []).map((s, j) => slot(s, j, `${p}.attrs.slots[${j}]`)).filter(Boolean);
          if (!slots.length) { err(p, "a signature block needs at least one slot"); return; }
          const keys = slots.map((s) => s.key);
          if (new Set(keys).size !== keys.length) { err(p, "two signature slots share a key"); return; }
          content.push({ type: "signatureBlock", attrs: { slots } });
          break;
        }
        default: err(p, `${JSON.stringify(n.type)} is not part of the document format`);
      }
    });
    // heading keys, when given, must be unique
    const hk = content.filter((n) => n.type === "heading" && n.attrs.key).map((n) => n.attrs.key);
    if (new Set(hk).size !== hk.length) err("$", "two sections share a key");
    return { type: "doc", content };
  })();

  return { ok: errors.length === 0, source: errors.length ? null : doc, errors, warnings };
}

/**
 * Run 9 — THE SECTION RULE. A heading with `showWhen` and its whole section (to the next heading of the same or a higher level) are dropped when the rule does not hold over the
 * sender's values. `valueOf(name)` answers "custom.has_pets" → "yes" | null. A rule that cannot be worked out counts as holding (the section stays: never dropped silently).
 * Pure; returns { source, removed, hidden: [heading text…] }.
 */
export function stripByRules(source, valueOf) {
  const blocks = source?.content ?? []; const out = []; let removed = 0, skipLevel = null; const hidden = [];
  const holds = (rule) => {
    let vars = []; try { vars = checkRule(rule); } catch { return true; }
    const data = {};
    for (const v of vars) { const parts = v.split("."); let o = data; parts.slice(0, -1).forEach((k) => { o[k] = o[k] ?? {}; o = o[k]; }); o[parts.at(-1)] = valueOf(v); }
    return evaluateRule(rule, data);
  };
  for (const b of blocks) {
    if (b.type === "heading") {
      const level = b.attrs?.level ?? 2;
      if (skipLevel !== null && level > skipLevel) { removed++; continue; }
      skipLevel = null;
      if (b.attrs?.showWhen && !holds(b.attrs.showWhen)) { skipLevel = level; removed++; hidden.push((b.content ?? []).map((c) => c.text ?? "").join("")); continue; }
    } else if (skipLevel !== null) { removed++; continue; }
    out.push(b);
  }
  return { source: { ...source, content: out }, removed, hidden };
}

/** Stable JSON: object keys sorted, so two equal sources serialise equal. */
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const sourceHash = (source) => createHash("sha256").update(canonicalJson(source)).digest("hex");

/** Every inline node of a node, in order. */
export function* inlineNodes(node) {
  for (const c of node?.content ?? []) { if (c.type === "listItem" || c.type === "paragraph" || c.type === "table" || c.type === "tableRow" || c.type === "tableCell" || c.type === "tableHeader") yield* inlineNodes(c); else yield c; }
}

/**
 * THE AUDIENCE RULE (Docustay flow v2). A section is a heading plus every block up to the next heading of the same or a higher level (a smaller level number). A heading with
 * `audience: "sender"` and its whole section are dropped. What a person signs must be exactly what they saw, so this runs BEFORE anything a signer receives is made (the PDF, the
 * signing page, the sealed copy, the certificate); the stored source keeps the section for the sender. Pure; returns { source, removed } (removed = number of blocks dropped).
 */
export function stripSenderOnly(source) {
  const blocks = source?.content ?? []; const out = []; let removed = 0, skipLevel = null;
  for (const b of blocks) {
    if (b.type === "heading") {
      const level = b.attrs?.level ?? 2;
      if (skipLevel !== null && level > skipLevel) { removed++; continue; }
      skipLevel = null;
      if (b.attrs?.audience === "sender") { skipLevel = level; removed++; continue; }
    } else if (skipLevel !== null) { removed++; continue; }
    out.push(b);
  }
  return { source: { ...source, content: out }, removed };
}
