// Part 30 item 7 — HTML to a document with fields. A developer sends HTML with text tags in it; we clean the HTML, leave a clear box where each tag was, have the host's converter print it to a PDF,
// find each box in that PDF, and place the fields there. The tags never print (nothing to cover, nothing hidden underneath).
// ★ THE HTML IS UNTRUSTED. The converter is a real browser, so anything that could make it fetch or run something is removed BEFORE it sees the page: scripts, styles, frames, forms, event handlers, and every
//   address that is not a `data:` picture. Only a short list of text, table and picture tags survive, with a short list of harmless style properties.
// ★ HOW THE BOXES ARE FOUND: each tag becomes an invisible link of exactly the field's size; the browser writes every link into the PDF with its exact rectangle, we read those rectangles back and delete the links.
import sanitizeHtml from "sanitize-html";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { invalid, dependency } from "../http/errors.mjs";
import { ports } from "./ports.mjs";
import { parseTag, defaultSize, fieldsFromTags } from "./textTags.mjs";
import { typesetCss, footerHtml, TYPESET_CLASSES, PAGE_MARGIN_IN } from "./typeset.mjs";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MARK = "https://docustay.invalid/field/";
const INIT = "https://docustay.invalid/initials/";
const ANY_MARK = "https://docustay.invalid/";
const TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "div", "span", "section", "article", "header", "footer", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "strong", "b", "em", "i", "u", "s", "sub", "sup", "small", "blockquote", "pre", "code", "img", "a"];
const STYLES = ["color", "background-color", "font-size", "font-weight", "font-style", "font-family", "text-align", "text-decoration", "line-height", "letter-spacing", "text-transform",
  "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
  "border", "border-top", "border-bottom", "border-left", "border-right", "border-collapse", "width", "height", "min-height", "page-break-before", "page-break-after", "page-break-inside", "break-before", "break-after", "break-inside"];
const SAFE_VALUE = /^(?!.*(url\(|expression|javascript:|@import|\\)).*$/i;
const allowedStyles = { "*": Object.fromEntries(STYLES.map((p) => [p, [SAFE_VALUE]])) };

/** R13-D170 (SEC-012/013/016): the HTML is cleaned before it is printed, and the sender is told plainly what was taken out. */
export function removalNotes(html) {
  const notes = [];
  if (/<\s*script\b/i.test(html)) notes.push("Scripts were removed: a document never runs code.");
  if (/<\s*(iframe|object|embed|form|link|style)\b/i.test(html)) notes.push("Frames, forms and style sheets were removed.");
  if (/\son[a-z]+\s*=/i.test(html)) notes.push("Event handlers were removed.");
  if (/<\s*img\b[^>]*\bsrc\s*=\s*["']?(?!data:image\/)/i.test(html)) notes.push("Pictures that are not embedded in the HTML (an address) were not fetched; use a data: picture.");
  return notes;
}

export function cleanHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: TAGS,
    allowedAttributes: { "*": ["style", "class", "colspan", "rowspan", "align"], a: ["href"], img: ["src", "alt", "width", "height"], table: ["border", "width"], td: ["width"], th: ["width"], col: ["width"] },
    allowedStyles,
    allowedClasses: { "*": TYPESET_CLASSES.slice() },
    allowedSchemes: ["http", "https", "mailto"], allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    // a picture must be inline (a data: address); anything else would make the converter fetch it
    transformTags: { img: (tag, attribs) => (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(attribs.src ?? "") ? { tagName: "img", attribs } : { tagName: "span", attribs: {}, text: attribs.alt ? `[${attribs.alt}]` : "" }) },
    disallowedTagsMode: "discard",
  });
}

const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const unescapeText = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

/** Replaces each tag in the TEXT of already-clean HTML with an invisible link box; returns the HTML and the tags found (in order). Tags inside attribute values are left alone. */
export function boxTags(clean, { rules = false } = {}) {
  const tags = [];
  const html = clean.split(/(<[^>]*>)/g).map((part) => {
    if (part.startsWith("<")) return part;
    return part.replace(/\{\{([^{}]{1,900})\}\}/g, (m, inner) => {
      const parsed = parseTag(unescapeText(inner));
      if (!parsed) return m;
      if (parsed.error) { tags.push({ raw: m, parsed }); return m; }
      const [w, h] = parsed.size ? [parsed.size.w, parsed.size.h] : defaultSize(parsed.spec.type);
      const n = tags.length;
      tags.push({ raw: unescapeText(m), parsed });
      // a typeset document draws a thin rule under each blank (a box for a checkbox), so a printed copy reads as a form
      const rule = !rules ? "" : parsed.spec.type === "checkbox" ? ";border:.75pt solid #55555e" : ";border-bottom:.6pt solid #77777f";
      return `<a href="${MARK}${n}" style="display:inline-block;width:${w}pt;height:${h}pt;vertical-align:text-bottom;text-decoration:none${rule}">&nbsp;</a>`;
    });
  }).join("");
  return { html, tags };
}

const PAPER = Object.freeze({ letter: { w: 8.5, h: 11 }, a4: { w: 8.27, h: 11.7 } });
const wrapPage = (body, { title = "Document", typeset = false } = {}) => typeset ? `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title><style>${typesetCss()}</style></head><body>${body}</body></html>` : `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title><style>
body{font-family:Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#111;margin:0}
table{border-collapse:collapse;width:100%}td,th{vertical-align:top}h1,h2,h3{line-height:1.25}img{max-width:100%}
</style></head><body>${body}</body></html>`;

/** Reads each marker link out of the PDF (rectangle in points from the top-left) and returns a copy with those links removed. Tag boxes come back by number; the footer's initials boxes come back as a list (one per page per box). */
async function readBoxesAndStrip(pdfBytes) {
  const task = getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const boxes = new Map(), initials = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      for (const a of await page.getAnnotations()) {
        if (a.subtype !== "Link" || typeof a.url !== "string" || !a.url.startsWith(ANY_MARK)) continue;
        const [x1, y1, x2, y2] = a.rect;
        const box = { page: p, x: x1, y: vp.height - Math.max(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), pageW: vp.width, pageH: vp.height };
        if (a.url.startsWith(MARK)) boxes.set(Number(a.url.slice(MARK.length)), box);
        else if (a.url.startsWith(INIT)) initials.push({ ...box, k: Number(a.url.slice(INIT.length)) });
      }
    }
  } finally { await task.destroy(); }
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots?.();
    if (!annots) continue;
    const keep = [];
    for (let i = 0; i < annots.size(); i += 1) {
      const ref = annots.get(i), a = pdf.context.lookup(ref);
      const action = a?.get?.(PDFName.of("A")), actionDict = action ? pdf.context.lookup(action) : null;
      const uri = actionDict?.get?.(PDFName.of("URI"))?.decodeText?.() ?? null;
      if (typeof uri === "string" && uri.startsWith(ANY_MARK)) { if (action?.constructor?.name === "PDFRef") pdf.context.delete(action); pdf.context.delete(ref); } else keep.push(ref);
    }
    if (keep.length === annots.size()) continue;
    if (keep.length) page.node.set(PDFName.of("Annots"), pdf.context.obj(keep)); else page.node.delete(PDFName.of("Annots"));
  }
  return { boxes, initials, bytes: Buffer.from(await pdf.save()) };
}

/**
 * @param typeset  optional: `{ ref, initials: ["Provider", "Client"] }` prints the document in the product's own typeset look (serif body, one-inch margins, running footer) and puts an initials box per seat at the foot of every page.
 * @returns {Promise<{bytes:Buffer, roles:Array, fields:Array, warnings:Array}>} the printed PDF (marker links removed) and the fields placed on it
 */
export async function renderHtmlDocument({ html, paper = "letter", title = "Document", typeset = null }) {
  if (typeof html !== "string" || !html.trim()) throw invalid("html is required", { field: "html" });
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw invalid(`The HTML is too long (${(Buffer.byteLength(html) / 1048576).toFixed(1)} MB; the most is ${MAX_HTML_BYTES / 1048576} MB).`, { code: "html_too_big" });
  if (!PAPER[paper]) throw invalid("paper must be letter or a4", { field: "paper" });
  const P = await ports();
  if (!P.converter?.htmlToPdf || !P.converter.available()) throw dependency("HTML documents need the document converter, which is not set up here.");
  const { html: boxed, tags } = boxTags(cleanHtml(html), { rules: !!typeset });
  const bad = tags.find((t) => t.parsed.error);
  if (bad) throw invalid(`A text tag cannot be used: ${bad.parsed.error}.`, { code: "text_tag_invalid", tags: tags.filter((t) => t.parsed.error).map((t) => ({ raw: t.raw, error: t.parsed.error })) });
  if (tags.length > 500) throw invalid("A document takes at most 500 tags.", { code: "text_tag_invalid" });
  const seats = typeset?.initials ?? [];
  const print = { html: wrapPage(boxed, { title, typeset: !!typeset }), paper: PAPER[paper] };
  if (typeset) { print.margins = PAGE_MARGIN_IN; print.footerHtml = footerHtml({ ref: typeset.ref ?? "", initialsLabels: seats.map((r) => r.slice(0, 11)) }); }
  let printed;
  try { printed = await P.converter.htmlToPdf(print); }
  catch (e) { throw (/answered \d+/.test(String(e.message)) ? invalid("That HTML could not be printed — check it is well formed.", { code: "conversion_failed" }) : dependency("The HTML could not be turned into a document right now. Try again in a minute.")); }
  const { boxes, initials, bytes } = await readBoxesAndStrip(printed);
  const missing = tags.map((_, i) => i).filter((i) => !boxes.has(i));
  if (missing.length) throw invalid(`${missing.length} tag(s) could not be placed on the printed page (the first is ${tags[missing[0]].raw}).`, { code: "text_tag_unplaced" });
  const placed = tags.map((_, i) => boxes.get(i));
  // the footer's initials boxes become one initials field per seat per page, after the body's own fields
  const all = tags.slice();
  for (const b of initials.sort((x, y) => x.page - y.page || x.k - y.k)) {
    const role = seats[b.k]; if (!role) continue;
    const raw = `{{${role} initials, page ${b.page};type=initials;role=${role};label=Initials}}`;
    const parsed = parseTag(raw.slice(2, -2)); parsed.size = { w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 };
    all.push({ raw, parsed }); placed.push(b);
  }
  const { roles, fields, warnings } = all.length ? fieldsFromTags(all, placed, { fromBlanks: true }) : { roles: [{ key: "signer_1", label: "Signer 1" }], fields: [], warnings: [] };
  return { bytes, roles, fields, warnings: [...removalNotes(html), ...warnings], tagCount: tags.length, pages: placed.reduce((m, b) => Math.max(m, b.page), initials.reduce((m, b) => Math.max(m, b.page), 1)) };
}
