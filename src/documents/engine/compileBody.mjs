// THE SHARED DOCUMENT ENGINE — source ⇄ contract body (the `contract` render profile). Pure, no imports of the host.
// The contract body (src/documents/body.mjs `contractBodySchema`) stays the ONE shape the existing view tree, pdfkit renderer, signing screens and frozen
// snapshots read. This file maps the shared SOURCE to it and back, so a template written in the shared editor still renders through today's A4 contract pipeline
// (that is how the Coaching Agreement keeps its text AND its layout class). It mirrors webreact/src/lib/screens/documents/contractDoc.js, with three differences
// the recon (PLATFORM-TEMPLATE-ENGINE-RECON-6OCT.md §16) asked for: section KEYS are stored on the heading and survive a round trip (F-G); signature labels are authored
// on a `signatureBlock` node (F-C); marks the schema cannot hold are reported as warnings instead of vanishing silently (F-B).
//
// NORMAL FORM of a section's blocks: a `paragraphBreak` between any two adjacent block items (paragraph or list), none first or last, runs of prose/variable/lineBreak in between.
import { KEY_RE } from "./source.mjs";

const slug = (s, i) => {
  const base = String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base) return `section_${i}`;
  return /^[a-z]/.test(base) ? base : `section_${base}`;
};

/** Inline source nodes → body runs (prose with marks/href, variable, lineBreak). Adjacent text with the SAME marks merges into one run. */
function runs(nodes, where, warnings, errors) {
  const out = [];
  let buf = "", bufKey = null, bufMarks = [], bufHref;
  const flush = () => {
    if (buf) { const r = { type: "prose", text: buf }; if (bufMarks.length) r.marks = bufMarks; if (bufHref) r.href = bufHref; out.push(r); }
    buf = ""; bufKey = null; bufMarks = []; bufHref = undefined;
  };
  for (const n of nodes ?? []) {
    if (n.type === "text") {
      const m = (n.marks ?? []);
      if (m.some((x) => x.type === "underline")) warnings.push(`${where}: underline is not part of the contract view and was left out`);
      const marks = m.map((x) => x.type).filter((t) => t === "bold" || t === "italic");
      const href = m.find((x) => x.type === "link")?.attrs?.href;
      const k = JSON.stringify([marks, href ?? null]);
      if (bufKey !== null && k !== bufKey) flush();
      if (bufKey === null) { bufKey = k; bufMarks = marks; bufHref = href; }
      buf += n.text;
    } else if (n.type === "variableChip") { flush(); out.push({ type: "variable", name: n.attrs.name, label: n.attrs.label }); }
    else if (n.type === "hardBreak") { flush(); out.push({ type: "lineBreak" }); }
    else if (n.type === "fieldTag") errors.push(`${where}: a field tag (${n.attrs.name}) cannot be drawn by the contract view; use the typeset profile`);
  }
  flush();
  return out;
}

/** source → { sections, errors, warnings }. */
export function sourceToSections(source) {
  const errors = [], warnings = [];
  const sections = [];
  const taken = new Set();
  const uniq = (base) => { let k = base, n = 2; while (taken.has(k)) k = `${base}_${n++}`; taken.add(k); return k; };
  for (const n of source.content) if (n.type === "heading" && n.attrs.key) taken.add(n.attrs.key);   // explicit keys are reserved first so a derived one never steals them
  let cur = null, i = 0, prev = null;
  const open = (title, attrs = {}) => {
    i += 1;
    const key = attrs.key ?? uniq(slug(title, i));
    if (!KEY_RE.test(key)) errors.push(`section ${i}: key ${key} is not valid`);
    cur = { key, title: title || `Section ${i}`, owner: attrs.owner ?? "client", requires_signature: attrs.requiresSignature === true, blocks: [] };
    sections.push(cur);
  };
  const brk = () => { if (cur.blocks.length > 0) cur.blocks.push({ type: "paragraphBreak" }); };
  source.content.forEach((n, idx) => {
    const where = `block ${idx + 1}`;
    if (n.type === "heading") { open(n.content.map((c) => c.text).join(""), n.attrs); }
    else {
      if (!cur) open("Agreement");
      if (n.type === "paragraph") {
        const r = runs(n.content, where, warnings, errors);
        if (r.length) { brk(); cur.blocks.push(...r); }
      } else if (n.type === "bulletList" || n.type === "orderedList") {
        const items = n.content.map((li) => runs(li.content[0].content, where, warnings, errors)).filter((x) => x.length);
        if (items.length) { brk(); cur.blocks.push({ type: "list", ordered: n.type === "orderedList", items }); }
      } else if (n.type === "signatureBlock") {
        const ownHeading = prev?.type === "heading" && cur.blocks.length === 0 && cur.requires_signature;
        if (!ownHeading) open("Signatures", { requiresSignature: true });
        cur.requires_signature = true;
        for (const s of n.attrs.slots) cur.blocks.push({ type: "signature", key: s.key, label: s.label, ...(s.owner ? { owner: s.owner } : {}) });
      } else if (n.type === "table") errors.push(`${where}: a table cannot be drawn by the contract view; use the typeset profile`);
      else if (n.type === "horizontalRule" || n.type === "pageBreak") warnings.push(`${where}: a ${n.type} is not part of the contract view and was left out`);
    }
    prev = n;
  });
  for (const s of sections) if (!s.blocks.length) s.blocks.push({ type: "prose", text: " " });   // the schema refuses an empty section; same stand-in the editor mapping uses
  return { sections, errors, warnings };
}

const proseNode = (r) => {
  const marks = [...(r.marks ?? []).map((type) => ({ type })), ...(r.href ? [{ type: "link", attrs: { href: r.href } }] : [])];
  return marks.length ? { type: "text", text: r.text, marks } : { type: "text", text: r.text };
};
const inlineNodes = (rs) => rs.flatMap((r) => r.type === "prose" ? (r.text ? [proseNode(r)] : []) : r.type === "variable" ? [{ type: "variableChip", attrs: { name: r.name, label: r.label } }] : r.type === "lineBreak" ? [{ type: "hardBreak" }] : []);
const para = (content) => (content.length ? { type: "paragraph", content } : { type: "paragraph" });

/** contract sections → source. The whitespace-only stand-in block (the empty-section placeholder) becomes an empty paragraph, not text. */
export function sectionsToSource(sections) {
  const content = [];
  for (const s of sections ?? []) {
    const attrs = { level: 2, key: s.key };
    if (s.owner && s.owner !== "client") attrs.owner = s.owner;
    if (s.requires_signature) attrs.requiresSignature = true;
    content.push({ type: "heading", attrs, content: [{ type: "text", text: s.title || "Untitled" }] });
    let inline = [], wrote = false;
    const slots = [];
    const flushPara = () => { if (inline.length) { content.push(para(inline)); wrote = true; } inline = []; };
    const standIn = (s.blocks ?? []).length === 1 && s.blocks[0].type === "prose" && !s.blocks[0].text.trim();
    for (const b of standIn ? [] : s.blocks ?? []) {
      if (b.type === "prose" || b.type === "variable" || b.type === "lineBreak") inline.push(...inlineNodes([b]));
      else if (b.type === "paragraphBreak") flushPara();
      else if (b.type === "list") {
        flushPara();
        content.push({ type: b.ordered ? "orderedList" : "bulletList", content: b.items.map((it) => ({ type: "listItem", content: [para(inlineNodes(it))] })) });
        wrote = true;
      } else if (b.type === "signature") slots.push({ key: b.key, label: b.label, ...(b.owner ? { owner: b.owner } : {}) });
    }
    flushPara();
    if (slots.length) content.push({ type: "signatureBlock", attrs: { slots } });
    else if (!wrote) content.push({ type: "paragraph" });
  }
  return { type: "doc", content };
}
