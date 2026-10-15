// THE SHARED DOCUMENT ENGINE — HTML with text tags → source. Used to make a READY-MADE starter (or a developer's HTML template) EDITABLE: the words, tables, lists, bold/italic and
// every {{tag}} come across; the print-only layout (title block, running footer, initials boxes, classes) does not, and each thing dropped is listed in `warnings` so nothing
// vanishes silently. Output goes through parseSource by the caller. Pure apart from the parser.
import { parseDocument } from "htmlparser2";

const SKIP = new Set(["script", "style", "head", "title"]);
const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "hr", "div", "section", "article", "header", "footer", "blockquote"]);
const TAG_RE = /\{\{([^{}\n]{1,600})\}\}/g;
const FIELD_KEYS = ["type", "role", "required", "default", "options", "label", "width", "height", "max_length", "autofill", "editable", "placeholder", "tooltip", "locked", "amount", "currency", "formula", "price", "link", "show", "calc", "places", "filled", "from"];

/** split on ; outside double quotes (same grammar as textTags.mjs) */
function parts(inner) {
  const out = []; let cur = "", quoted = false;
  for (const ch of inner) { if (ch === '"') { quoted = !quoted; cur += ch; } else if (ch === ";" && !quoted) { out.push(cur); cur = ""; } else cur += ch; }
  out.push(cur);
  return out.map((p) => p.trim());
}
function tagNode(inner) {
  const ps = parts(inner), name = ps[0];
  if (ps.length >= 2 && ps.slice(1).some((p) => /^[A-Za-z_]+\s*=/.test(p))) {
    const attrs = { name };
    for (const p of ps.slice(1)) { const m = /^([A-Za-z_]+)\s*=\s*([\s\S]*)$/.exec(p); if (!m) continue; const k = m[1].toLowerCase(); if (FIELD_KEYS.includes(k)) attrs[k] = m[2].trim().replace(/^"(.*)"$/s, "$1"); }
    return { type: "fieldTag", attrs };
  }
  if (/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(name)) return { type: "variableChip", attrs: { name, label: name } };
  return null;
}
/** text → text nodes and tag nodes, marks carried */
export function textToNodes(text, marks) {
  const out = []; let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    if (m.index > last) out.push(mk(text.slice(last, m.index), marks));
    const node = tagNode(m[1]);
    out.push(node ?? mk(m[0], marks));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(mk(text.slice(last), marks));
  return out.filter((n) => n.type !== "text" || n.text !== "");
}
const mk = (text, marks) => (marks.length ? { type: "text", text, marks: marks.map((x) => ({ ...x })) } : { type: "text", text });

export function htmlToSource(html) {
  const warnings = new Set();
  const root = parseDocument(String(html ?? ""));
  const content = [];

  const inline = (nodes, marks = []) => {
    const out = [];
    for (const n of nodes ?? []) {
      if (n.type === "text") { const t = n.data.replace(/\s+/g, " "); if (t.trim() !== "" || t === " ") out.push(...textToNodes(t, marks)); }
      else if (n.type === "tag") {
        if (SKIP.has(n.name)) continue;
        if (n.name === "br") out.push({ type: "hardBreak" });
        else if (n.name === "strong" || n.name === "b") out.push(...inline(n.children, [...marks, { type: "bold" }]));
        else if (n.name === "em" || n.name === "i") out.push(...inline(n.children, [...marks, { type: "italic" }]));
        else if (n.name === "u") out.push(...inline(n.children, [...marks, { type: "underline" }]));
        else if (n.name === "a" && /^https?:\/\//i.test(n.attribs.href ?? "") && !/docustay\.invalid/.test(n.attribs.href)) out.push(...inline(n.children, [...marks, { type: "link", attrs: { href: n.attribs.href } }]));
        else if (n.name === "span" && n.attribs.class === "n") { out.push(...inline(n.children, marks)); out.push({ type: "text", text: " " }); }   // a clause number keeps its place in the line
        else out.push(...inline(n.children, marks));
      }
    }
    // trim the line's outer spaces and collapse doubles between nodes
    while (out.length && out[0].type === "text" && out[0].text.trim() === "" && !out[0].marks) out.shift();
    while (out.length && out.at(-1).type === "text" && out.at(-1).text.trim() === "" && !out.at(-1).marks) out.pop();
    if (out[0]?.type === "text") out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, "") };
    if (out.at(-1)?.type === "text") out[out.length - 1] = { ...out.at(-1), text: out.at(-1).text.replace(/\s+$/, "") };
    return out.filter((x) => x.type !== "text" || x.text !== "");
  };
  const para = (n) => { const c = inline(n.children); return c.length ? { type: "paragraph", content: c } : null; };
  const cellOf = (c) => {
    const kids = c.children.filter((k) => k.type === "tag" && k.name === "p");
    const paras = kids.length ? kids.map(para).filter(Boolean) : [para(c)].filter(Boolean);
    const attrs = {}; if (Number(c.attribs.colspan) > 1) attrs.colspan = Number(c.attribs.colspan); if (Number(c.attribs.rowspan) > 1) attrs.rowspan = Number(c.attribs.rowspan);
    const w = /width:\s*(\d{1,3}%)/.exec(c.attribs.style ?? ""); if (w) attrs.width = w[1];
    return { type: c.name === "th" ? "tableHeader" : "tableCell", ...(Object.keys(attrs).length ? { attrs } : {}), content: paras.length ? paras : [{ type: "paragraph" }] };
  };
  const rowsOf = (n, acc = []) => { for (const k of n.children ?? []) { if (k.type !== "tag") continue; if (k.name === "tr") acc.push({ type: "tableRow", content: k.children.filter((c) => c.type === "tag" && (c.name === "td" || c.name === "th")).map(cellOf) }); else if (["thead", "tbody", "tfoot"].includes(k.name)) rowsOf(k, acc); } return acc; };

  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type !== "tag") { if (n.type === "text" && n.data.trim()) { const c = inline([n]); if (c.length) content.push({ type: "paragraph", content: c }); } continue; }
      if (SKIP.has(n.name)) continue;
      if (/^h[1-6]$/.test(n.name)) {
        const level = Math.min(3, Number(n.name[1]));
        const text = inline(n.children).map((x) => x.type === "text" ? x.text : x.type === "variableChip" ? `{{${x.attrs.name}}}` : "").join("").trim();
        if (text) content.push({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
      } else if (n.name === "p") { const p = para(n); if (p) content.push(p); }
      else if (n.name === "ul" || n.name === "ol") {
        const items = n.children.filter((k) => k.type === "tag" && k.name === "li").map((li) => ({ type: "listItem", content: [para(li) ?? { type: "paragraph" }] }));
        if (items.length) content.push({ type: n.name === "ul" ? "bulletList" : "orderedList", content: items });
      } else if (n.name === "table") { const rows = rowsOf(n); if (rows.length) content.push({ type: "table", content: rows }); }
      else if (n.name === "hr") content.push({ type: "horizontalRule" });
      else if (BLOCKS.has(n.name)) {
        if (/page-break|break-(before|after)/.test(n.attribs.style ?? "") || /\bpb\b/.test(n.attribs.class ?? "")) content.push({ type: "pageBreak" });
        if (n.attribs.class && !/^(tb|sub|t|keep|cl|lbl|rec|sched|sig|wit)\b/.test(n.attribs.class)) warnings.add(`the layout class “${n.attribs.class}” is print-only and was dropped`);
        walk(n.children);
      } else walk(n.children);
    }
  };
  walk(root.children);
  if (!content.some((b) => b.type === "heading")) content.unshift({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Document" }] });
  return { source: { type: "doc", content }, warnings: [...warnings] };
}
