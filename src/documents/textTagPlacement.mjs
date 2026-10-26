// Part 30 item 7 — finds text tags in a PDF's text layer, says where each one sits, and covers the tag text with white so a signer never sees `{{…}}`.
// ★ HONEST LIMIT: covering is a white rectangle over the words, not removal from the file — the characters stay in the PDF's hidden text layer. A document that must carry no trace of its tags
//   should be made from HTML (htmlDocument.mjs), which never prints them, or have the tags set in white in the source file.
// ★ A tag the word processor wrapped onto a second line is still one tag (the field goes where it starts); a tag on a rotated page is reported, not guessed.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import { parseTag } from "./textTags.mjs";

// Helvetica's character widths (1/1000 em, the published standard metrics). pdf.js gives one width per text run, not per character; sharing that width out in proportion to these weights puts a tag's edges
// within a point or two for ordinary proportional fonts, where an equal share per character was visibly off.
const W = "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584".split(" ").map(Number);
const weight = (ch) => { const c = ch.charCodeAt(0); return c >= 32 && c <= 126 ? W[c - 32] : 556; };
/** x position, from the run's left edge, of the boundary before character `i` of `str`, for a run that is `width` wide. */
function edgeAt(str, i, width) {
  let before = 0, total = 0;
  for (let k = 0; k < str.length; k += 1) { const w = weight(str[k]); total += w; if (k < i) before += w; }
  return total ? width * (before / total) : 0;
}

const MAX_TAGS = 500, LINE_TOL = 2.5;

/** @returns {Promise<{tags:Array<{raw:string, parsed:object, box:{page:number,x:number,y:number,w:number,h:number,pageW:number,pageH:number}, pdfRect:{x:number,y:number,w:number,h:number}}>, errors:Array<{raw:string,page:number,error:string}>}>} boxes are in points from the page's top-left */
export async function locateTags(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const tags = [], errors = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => "str" in it && it.str !== "").map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }));
      if (!items.some((it) => it.s.includes("{{"))) continue;
      // group into lines: same baseline, left to right
      const lines = [];
      for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
        const line = lines.find((l) => Math.abs(l.y - it.y) <= LINE_TOL);
        if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
      }
      // read the page top to bottom; a newline marks each line break, so a tag the word processor wrapped onto a second line is still one tag
      lines.sort((a, b) => b.y - a.y);
      let text = "";
      const spans = [];
      lines.forEach((line, li) => {
        line.items.sort((a, b) => a.x - b.x);
        if (li) text += "\n";
        for (const it of line.items) { spans.push({ it, start: text.length, line: li }); text += it.s; }
      });
      for (const m of text.matchAll(/\{\{([^{}]{1,600})\}\}/g)) {
        const parsed = parseTag(m[1].replace(/\s*\n\s*/g, " "));
        if (!parsed) continue;
        if (parsed.error) { errors.push({ raw: m[0], page: p, error: parsed.error }); continue; }
        if (tags.length >= MAX_TAGS) { errors.push({ raw: m[0], page: p, error: `a document takes at most ${MAX_TAGS} tags` }); continue; }
        if (page.rotate % 360 !== 0) { errors.push({ raw: m[0], page: p, error: "tags on a rotated page are not supported — rotate the page upright and upload again" }); continue; }
        const a = m.index, b = m.index + m[0].length;
        const rects = new Map();   // one rectangle per line the tag touches
        for (const { it, start, line } of spans) {
          const s2 = Math.max(a, start), e2 = Math.min(b, start + it.s.length);
          if (e2 <= s2) continue;
          const r = rects.get(line) ?? { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
          r.x0 = Math.min(r.x0, it.x + edgeAt(it.s, s2 - start, it.w)); r.x1 = Math.max(r.x1, it.x + edgeAt(it.s, e2 - start, it.w));
          r.y0 = Math.min(r.y0, it.y - it.h * 0.22); r.y1 = Math.max(r.y1, it.y + it.h * 0.8);
          rects.set(line, r);
        }
        const pdfRects = [...rects.values()].map((r) => ({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 }));
        const first = pdfRects[0], pageW = vp.width, pageH = vp.height;
        tags.push({ raw: m[0], parsed, pdfRect: first, pdfRects, box: { page: p, x: first.x, y: pageH - (first.y + first.h), w: first.w, h: first.h, pageW, pageH } });
      }
    }
  } finally { await task.destroy(); }
  tags.sort((a, b) => a.box.page - b.box.page || a.box.y - b.box.y || a.box.x - b.box.x);
  return { tags, errors };
}

/** A copy of the PDF with a white rectangle over each tag's text. */
export async function coverTags(bytes, tags) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const pages = pdf.getPages();
  for (const t of tags) {
    for (const r of t.pdfRects) pages[t.box.page - 1].drawRectangle({ x: r.x - 1.5, y: r.y - 0.5, width: r.w + 3, height: r.h + 1, color: rgb(1, 1, 1), borderWidth: 0 });
  }
  return Buffer.from(await pdf.save());
}
