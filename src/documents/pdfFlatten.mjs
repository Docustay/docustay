// src/documents/pdfFlatten.mjs — BURN WHAT PEOPLE FILLED IN ONTO THE ORIGINAL PAGES (QUEUE §23.4.8). Pure: original bytes + fields + values → new bytes. The pages themselves are untouched (same content, same
// fonts, same layout); only the signature marks, typed text, dates and ticks are drawn on top, at the places the sender put the fields.
//
// ★ Field boxes are fractions of the page as DISPLAYED (top-left origin). A page stored rotated is handled by one coordinate transform per page, so a field lands where it was placed whatever the rotation.
// ★ Text is Helvetica for what Helvetica can draw. Anything else (Ł, Привет, 田中, עברית, محمد, ไทย, ✓ …) is drawn in a fallback font that has it (Round 3, R3-2: it used to become "?"), shaped by fontkit (Arabic joins, Hebrew runs right to left, Thai marks stack).
// A character no font has is drawn as the visible text [U+XXXX], never as "?" and never as a crash on a signed document.
import { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from "@cantoo/pdf-lib";
import { winAnsiHas } from "./winAnsi.mjs";

// ★ This file also runs in the BROWSER (the free "sign a PDF" page), so it cannot import fontkit or read font files. The server plugs the fallback-font provider in once (src/documents/pdfFlattenFonts.mjs: fontkit + the OFL font files);
//   with no provider (the browser), a character Helvetica cannot draw is printed as the visible text [U+XXXX], never as "?" and never as garbage.
let provider = null;
export function setFlattenFontProvider(p) { provider = p; }
const hex = (cp) => `[U+${cp.toString(16).toUpperCase().padStart(4, "0")}]`;
function plainRuns(text) {
  let out = "";
  for (const ch of String(text)) { const cp = ch.codePointAt(0); if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) continue; out += winAnsiHas(cp) ? ch : hex(cp); }
  return [{ text: out, font: "base" }];
}
const splitRuns = (text) => (provider ? provider.splitRuns(text, winAnsiHas) : plainRuns(text));

// ★ no Node-only globals in this file: the free "sign a PDF" page runs the SAME flattening in the browser (QUEUE §23.5.14), so decoding uses atob and the result is a Buffer only where Buffer exists
const dataUrlBytes = (u) => Uint8Array.from(atob(String(u).split(",")[1] ?? ""), (c) => c.charCodeAt(0));
const asBytes = (u8) => (typeof Buffer !== "undefined" ? Buffer.from(u8) : u8);

/** Embeds fallback fonts into this document the first time a run needs one (and registers fontkit once). */
function fontSource(doc) {
  const cache = new Map(); let registered = false;
  return async (id) => {
    if (!cache.has(id)) { if (!registered) { doc.registerFontkit(provider.fontkit); registered = true; } cache.set(id, await doc.embedFont(provider.fallbackBytes(id), { subset: true })); }
    return cache.get(id);
  };
}
/** The text cut into runs with each run's font and width at `size`. */
async function layout(get, helv, text, size) {
  const runs = splitRuns(String(text).replace(/\s+/g, " "));
  const out = [];
  for (const r of runs) { const font = r.font === "base" ? helv : await get(r.font); out.push({ text: r.text, font, width: font.widthOfTextAtSize(r.text, size) }); }
  return out;
}
const total = (runs) => runs.reduce((a, r) => a + r.width, 0);
/** Shrink the text to fit the box; below 5 pt cut it with an ellipsis, so a long answer never runs past its field onto the page. */
async function fitRuns(get, helv, text, maxWidth, maxSize) {
  let size = maxSize, runs = await layout(get, helv, text, size);
  while (size > 5 && total(runs) > maxWidth) { size -= 0.5; runs = await layout(get, helv, text, size); }
  if (total(runs) > maxWidth) {
    let t = Array.from(String(text));
    while (t.length > 1) { t = t.slice(0, -1); runs = await layout(get, helv, t.join("").trimEnd() + "…", size); if (total(runs) <= maxWidth) break; }
  }
  return { size, runs };
}
function drawRuns(page, runs, x, y, size, color) {
  let cx = x;
  for (const r of runs) { page.drawText(r.text, { x: cx, y, size, font: r.font, color }); cx += r.width; }
}

/** The matrix that lets us draw in "displayed page, origin bottom-left" coordinates on a page stored with `rotation` (0/90/180/270). */
function visualToNative(rotation, W, H) {
  switch (rotation) {
    case 90:  return [0, 1, -1, 0, W, 0];
    case 180: return [-1, 0, 0, -1, W, H];
    case 270: return [0, -1, 1, 0, 0, H];
    default:  return [1, 0, 0, 1, 0, 0];
  }
}

/**
 * @param {Buffer} originalBytes
 * @param {Array<{id:string,type:string,page:number,x:number,y:number,w:number,h:number}>} fields
 * @param {Map<string,{value:string|null, mark:string|null}>|Record<string,{value:string|null, mark:string|null}>} values  keyed by field id
 * @param {{signatureIds?: Map<string,string>|null, testWatermark?: boolean}} [opts] `signatureIds` (field id → ID) prints that ID in small type under the signature or initials mark; `testWatermark` draws TEST across every page (test mode)
 * @returns {Promise<Buffer>}
 */
export async function flattenOntoOriginal(originalBytes, fields, values, { signatureIds = null, testWatermark = false, dropPages = null } = {}) {
  const get = (id) => (values instanceof Map ? values.get(id) : values[id]);
  const doc = await PDFDocument.load(originalBytes, { updateMetadata: false });
  try { doc.getForm().flatten(); } catch { /* a file with no form, or one pdf-lib cannot flatten, is drawn on as it is */ }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const getFallback = fontSource(doc);
  const pages = doc.getPages();
  const byPage = new Map();
  for (const f of fields) { if (!byPage.has(f.page)) byPage.set(f.page, []); byPage.get(f.page).push(f); }

  for (const [pageNo, list] of byPage) {
    const page = pages[pageNo - 1];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const VW = rot === 90 || rot === 270 ? H : W, VH = rot === 90 || rot === 270 ? W : H;
    const mb = page.getMediaBox();
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...visualToNative(rot, W, H)));
    for (const f of list) {
      const v = get(f.id);
      if (!v || (v.value == null && v.mark == null)) continue;
      const bx = f.x * VW, bw = f.w * VW, bh = f.h * VH;
      const by = VH - f.y * VH - bh;                         // bottom-left origin, displayed page
      if (v.mark) {
        let img;
        try { img = await doc.embedPng(dataUrlBytes(v.mark)); } catch { continue; }
        const s = Math.min(bw / img.width, bh / img.height);
        const w = img.width * s, h = img.height * s;
        page.drawImage(img, { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, width: w, height: h });
        const sid = signatureIds?.get?.(f.id);
        if (sid && (f.type === "signature" || f.type === "initials")) page.drawText(`Signature ID ${String(sid).replace(/[^\x20-\x7E]/g, "?")}`, { x: bx, y: Math.max(2, by - 7), size: 5.5, font, color: rgb(0.4, 0.4, 0.45) });
      } else if (f.type === "checkbox") {
        if (v.value === "true") {
          const pad = Math.min(bw, bh) * 0.2, x0 = bx + pad, x1 = bx + bw - pad, y0 = by + pad, y1 = by + bh - pad;
          page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 1.4, color: rgb(0, 0, 0) });
          page.drawLine({ start: { x: x0, y: y1 }, end: { x: x1, y: y0 }, thickness: 1.4, color: rgb(0, 0, 0) });
        }
      } else if (v.value) {
        let shown = v.value;
        if (f.type === "multiselect") { try { shown = JSON.parse(v.value).join(", "); } catch { shown = v.value; } }
        const { size, runs } = await fitRuns(getFallback, font, shown, bw - 4, Math.min(12, bh * 0.75));
        drawRuns(page, runs, bx + 2, by + (bh - size) / 2 + size * 0.15, size, rgb(0.05, 0.05, 0.25));
      }
    }
    page.pushOperators(popGraphicsState());
    void mb;
  }
  if (testWatermark) for (const page of pages) {
    const { width: W, height: H } = page.getSize(), size = Math.min(W, H) * 0.22, label = "TEST";
    page.drawText(label, { x: W / 2 - (font.widthOfTextAtSize(label, size) / 2) * 0.7071, y: H / 2 - size * 0.25, size, font, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(45) });
  }
  // Run 9: pages a rule left out of the document are not in the sealed copy (highest first, so the numbers of the pages still to drop do not move); one page always stays
  if (dropPages?.size) for (const n of [...dropPages].sort((a, b) => b - a)) if (n >= 1 && n <= doc.getPageCount() && doc.getPageCount() > 1) doc.removePage(n - 1);
  return asBytes(await doc.save({ useObjectStreams: false }));
}

/** Append `extra` PDFs' pages after `base`'s (used to put the certificate pages after the flattened document). */
export async function appendPdfs(base, extras) {
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  for (const bytes of extras) {
    const other = await PDFDocument.load(bytes, { updateMetadata: false });
    const copied = await doc.copyPages(other, other.getPageIndices());
    copied.forEach((p) => doc.addPage(p));
  }
  return asBytes(await doc.save({ useObjectStreams: false }));
}
