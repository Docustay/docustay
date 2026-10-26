// THE SHARED DOCUMENT ENGINE — source → HTML with text tags (the `typeset` render profile). Pure, no imports of the host except the tag grammar (also pure).
// The output goes to the SAME pipeline starters and uploaded HTML use: cleanHtml → boxTags → Gotenberg → readBoxesAndStrip → fieldsFromTags. No second print path.
// Rules (recon §15.1): headings keep their literal numbers; one <p> per paragraph; hardBreak → <br>; & and < are escaped, quotes are NOT touched (no smart-quoting);
// a merge field is resolved BEFORE printing (the HTML pipeline has no resolver of its own); a signature slot becomes a signature tag (and, unless switched off, a
// date tag), in role order, so the first role written is signer_1.
import { parseTag } from "../textTags.mjs";
import { missingMarker } from "./resolver.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const tagText = (a) => {
  const q = (v) => (/[;="{}]/.test(String(v)) ? `"${String(v).replace(/"/g, "'")}"` : String(v));
  const parts = [a.name];
  for (const k of ["type", "role", "required", "default", "options", "label", "width", "height", "max_length", "autofill", "editable", "placeholder", "tooltip", "locked", "amount", "currency", "formula", "price", "link", "show", "calc", "places", "filled", "from"]) if (a[k] !== undefined && a[k] !== "") parts.push(`${k}=${q(a[k])}`);
  return `{{${parts.join(";")}}}`;
};

function run(nodes, resolver, issues) {
  return (nodes ?? []).map((n) => {
    if (n.type === "text") {
      let h = esc(n.text);
      for (const m of n.marks ?? []) h = m.type === "bold" ? `<strong>${h}</strong>` : m.type === "italic" ? `<em>${h}</em>` : m.type === "underline" ? `<u>${h}</u>` : `<a href="${escAttr(m.attrs.href)}">${h}</a>`;
      return h;
    }
    if (n.type === "hardBreak") return "<br>";
    if (n.type === "variableChip") {
      const v = resolver?.resolve ? resolver.resolve(n.attrs.name) : null;
      if (v == null || v === "") { issues.unresolved.push(n.attrs.name); return esc(resolver ? missingMarker(n.attrs.label) : `{{${n.attrs.name}}}`); }
      return esc(v);
    }
    if (n.type === "fieldTag") return esc(tagText(n.attrs)).replace(/&quot;/g, '"');
    return "";
  }).join("");
}

// B-9 (Run 7, fixed 11 Oct 2026): a ready-made form's closing block (heading, sentence, signature, caption, date, caption) is ONE `<div class="keep">` in its starter HTML, but once it becomes an
// editable source it is a heading and loose paragraphs, so the converter could print "Signature" at the foot of one page and "Date" at the top of the next. A short section — a heading and the
// blocks after it up to the next heading — that holds a signature tag is wrapped in `.keep` again (typeset.mjs keeps it on one page). A long section is left to flow (it may need two pages).
const KEEP_MAX_BLOCKS = 10;
const holdsSignatureTag = (h) => [...h.matchAll(/\{\{([^{}\n]{1,600})\}\}/g)].some((m) => parseTag(m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"'))?.spec?.type === "signature");
function keepSigningSections(out, blocks) {
  const res = []; let i = 0;
  while (i < out.length) {
    if (blocks[i]?.type !== "heading") { if (out[i]) res.push(out[i]); i += 1; continue; }
    let j = i + 1; while (j < out.length && blocks[j]?.type !== "heading") j += 1;
    const section = out.slice(i, j);
    const wrap = section.length <= KEEP_MAX_BLOCKS && !section.some((h) => h.startsWith('<div class="keep">') || /page-break-after:always/.test(h)) && section.some(holdsSignatureTag);
    res.push(wrap ? `<div class="keep">${section.filter(Boolean).join("\n")}</div>` : section.filter(Boolean).join("\n")); i = j;
  }
  return res;
}

/** source → { html, tags[], unresolved[], errors[] }. `resolver` omitted keeps `{{signer.name}}` visible (a preview of the template itself). */
export function sourceToHtml(source, { resolver = null } = {}) {
  const issues = { unresolved: [], errors: [] };
  const out = [];
  for (const [bi, b] of source.content.entries()) {
    if (b.type === "heading") out.push(`<h${b.attrs.level}>${run(b.content, resolver, issues)}</h${b.attrs.level}>`);
    else if (b.type === "paragraph") out.push(`<p>${run(b.content, resolver, issues)}</p>`);
    else if (b.type === "bulletList" || b.type === "orderedList") {
      const t = b.type === "bulletList" ? "ul" : "ol";
      out.push(`<${t}>${b.content.map((li) => `<li>${run(li.content[0].content, resolver, issues)}</li>`).join("")}</${t}>`);
    } else if (b.type === "table") {
      const rows = b.content.map((r) => `<tr>${r.content.map((c) => {
        const tag = c.type === "tableHeader" ? "th" : "td", a = c.attrs ?? {};
        return `<${tag}${a.colspan ? ` colspan="${a.colspan}"` : ""}${a.rowspan ? ` rowspan="${a.rowspan}"` : ""}${a.width ? ` style="width:${a.width}"` : ""}>${c.content.map((p) => run(p.content, resolver, issues)).join("<br>")}</${tag}>`;
      }).join("")}</tr>`);
      out.push(`<table class="t"><tbody>${rows.join("")}</tbody></table>`);
    } else if (b.type === "horizontalRule") out.push("<hr>");
    else if (b.type === "pageBreak") out.push('<div style="page-break-after:always;break-after:page"></div>');
    else if (b.type === "signatureBlock") {
      // the same ruled, two-seats-to-a-row layout the ready-made agreements use (.sig in typeset.mjs): room for each field, nothing printed that is not the person's own words
      const cell = (s) => {
        const role = s.role ?? s.owner ?? s.label;
        const req = s.required === false ? { required: "false" } : {};
        const parts = [`<p><strong>${esc(s.label)}</strong></p>`];
        if (s.showPrintedName !== false) parts.push(`<p>${esc(tagText({ name: `${s.label} printed name`, type: "text", role, ...req }))}</p>`);
        parts.push(`<p style="margin-top:14pt">${esc(tagText({ name: s.label, type: "signature", role, ...req }))}</p>`);
        if (s.showDate !== false) parts.push(`<p>${esc(tagText({ name: `${s.label} date`, type: "date_signed", role }))}</p>`);
        return `<td>${parts.join("")}</td>`;
      };
      const slots = b.attrs.slots, rows = [];
      for (let k = 0; k < slots.length; k += 2) rows.push(`<tr>${cell(slots[k])}${slots[k + 1] ? cell(slots[k + 1]) : "<td></td>"}</tr>`);
      out.push(`<div class="keep"><table class="sig">${rows.join("")}</table></div>`);
    }
    while (out.length <= bi) out.push("");   // one entry per block, so keepSigningSections can read each block's type beside its HTML
  }
  const html = keepSigningSections(out, source.content).join("\n");
  const tags = [];
  for (const m of html.matchAll(/\{\{([^{}\n]{1,600})\}\}/g)) { const t = parseTag(m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"')); if (t?.error) issues.errors.push(t.error); else if (t) tags.push(t); }
  return { html, tags, unresolved: [...new Set(issues.unresolved)], errors: issues.errors };
}
