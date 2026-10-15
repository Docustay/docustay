// src/documents/pdfProcess.mjs — READ AN UPLOADED PDF (QUEUE §23.4.2 and §23.4.12). Pure: bytes in, facts out. No database, no storage, no host.
//
//   inspectPdf(bytes) → { pageCount, pages:[{w,h}], hasText, scanned, alreadySigned, acroform:[…], suggestions:[…] }
//   or it THROWS a PdfProblem with a `code` the screen turns into a sentence:
//     not_pdf · locked (password-protected) · corrupt · too_many_pages
//
// ★ An uploaded PDF is UNTRUSTED. Nothing in it is executed or fetched: pdf-lib parses structure, pdf.js reads text with `isEvalSupported:false`, every number that comes out is clamped, and the
//   work is bounded (a page cap, a suggestion cap). A file that cannot be parsed is refused with a reason; it never reaches storage as a "document".
// ★ Positions leave here as FRACTIONS of the page, origin top-left (the shape pdfBody.mjs stores), whatever the file's own origin or rotation.
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFDict, EncryptedPDFError } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PAGES = 2000;
const TEXT_SCAN_PAGES = 200;           // detection reads at most this many pages of text
const MAX_SUGGESTIONS = 300;

export class PdfProblem extends Error {
  constructor(code, message) { super(message); this.name = "PdfProblem"; this.code = code; }
}

const clamp01 = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Does this byte string even claim to be a PDF? (The real type check is `file-type`; this is the cheap guard for callers that skip it.) */
export function looksLikePdf(bytes) {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

/** An already digitally signed PDF carries a /ByteRange (the span the signature covers). Editing it would break that signature, so the caller attaches it untouched.
 *  ★ Run 7 (P10-B-1): a "usage rights" signature (/TransformMethod /UR3 — what Adobe adds so the free Reader may fill in a form; nearly every IRS and government form has one)
 *  is NOT someone signing the document: it only switches on Reader features, and it is removed when the file is prepared. Only a signature whose object is not a UR3 one counts
 *  (an approval signature in a field, or a certification /DocMDP). */
export function hasDigitalSignature(bytes) {
  const b = Buffer.from(bytes);
  let at = b.indexOf("/ByteRange");
  while (at !== -1) {
    const from = Math.max(0, b.lastIndexOf("obj", at)), to = b.indexOf("endobj", at);
    const obj = b.subarray(from, to === -1 ? Math.min(b.length, at + 4000) : to).toString("latin1");
    if (!/\/TransformMethod\s*\/UR3/.test(obj)) return true;
    at = b.indexOf("/ByteRange", at + 10);
  }
  return false;
}

function pageSizeOf(page) {
  const { width, height } = page.getSize();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  return rot === 90 || rot === 270 ? { w: height, h: width } : { w: width, h: height };
}

async function loadStructure(bytes) {
  if (!looksLikePdf(bytes)) throw new PdfProblem("not_pdf", "This file is not a PDF.");
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    if (e instanceof EncryptedPDFError || /encrypt/i.test(String(e?.message))) throw new PdfProblem("locked", "This PDF is password-protected. Remove the password and upload it again.");
    throw new PdfProblem("corrupt", "This PDF could not be read — it may be damaged. Try saving it again from the program that made it.");
  }
}

/** Form fields (AcroForm), each with the page and box of its first widget, as fractions. */
function readAcroForm(doc, pageSizes) {
  const out = [];
  let form;
  try { form = doc.getForm(); } catch { return out; }
  const pages = doc.getPages();
  // page index by the widget refs on each page's /Annots
  const widgetPage = new Map();
  pages.forEach((p, i) => {
    const annots = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let k = 0; k < annots.size(); k += 1) { const r = annots.get(k); if (r instanceof PDFRef) widgetPage.set(r.toString(), i); }
  });
  for (const field of form.getFields()) {
    const kind = field.constructor.name;
    const type = kind === "PDFTextField" ? "text" : kind === "PDFCheckBox" ? "checkbox" : kind === "PDFDropdown" || kind === "PDFOptionList" ? "dropdown" : kind === "PDFSignature" ? "signature" : null;
    if (!type) continue;
    for (const widget of field.acroField.getWidgets()) {
      const ref = doc.context.getObjectRef(widget.dict);
      const pi = ref ? widgetPage.get(ref.toString()) : undefined;
      if (pi === undefined) continue;
      const r = widget.getRectangle();
      const { w: pw, h: ph } = pageSizes[pi];
      const mb = pages[pi].getMediaBox();
      const x = (r.x - mb.x) / pw, yTop = (ph - (r.y - mb.y) - r.height) / ph;
      out.push({
        name: field.getName(), type, page: pi + 1,
        x: clamp01(x), y: clamp01(yTop), w: Math.max(0.005, Math.min(1 - clamp01(x), r.width / pw)), h: Math.max(0.005, Math.min(1 - clamp01(yTop), r.height / ph)),
        options: type === "dropdown" ? (() => { try { return field.getOptions(); } catch { return []; } })() : undefined,
      });
      break;   // the first widget stands for the field
    }
  }
  return out;
}

const LABELS = [
  { re: /^(?:client\s+|customer\s+|party\s+|parent\s+|guardian\s+|owner\s+|tenant\s+|landlord\s+|employee\s+|employer\s+)?(?:signature|signed|sign\s+here|sign)\b/i, type: "signature", h: 30, w: 190 },
  { re: /^initials?\b/i, type: "initials", h: 22, w: 60 },
  { re: /^date(?:\s+signed)?\b/i, type: "date_signed", h: 20, w: 110 },
  { re: /^(?:printed\s+)?name\b/i, type: "text", h: 20, w: 190 },
];

/** Look for "Signature: ______", "Date: ______", "Sign here", "Initials ___" in the text layer, and turn each into a dashed suggestion. */
async function readTextAndDetect(bytes, pageSizes) {
  let task;
  try {
    task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
    const pdf = await task.promise;
    const n = Math.min(pdf.numPages, TEXT_SCAN_PAGES);
    let chars = 0;
    const suggestions = [];
    for (let p = 1; p <= n; p += 1) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const { w: pw, h: ph } = pageSizes[p - 1];
      const view = page.view;                                     // [x0, y0, x1, y1] — the same box pdf.js lays text out in
      for (const it of tc.items) {
        if (!("str" in it)) continue;
        const s = it.str; chars += s.trim().length;
        if (!s.trim()) continue;
        const label = LABELS.find((l) => l.re.test(s.trim()));
        if (!label) continue;
        const underscore = s.search(/_{3,}/);
        const total = Math.max(1, s.length);
        const itemX = it.transform[4] - view[0], baseline = it.transform[5] - view[1];
        let x, width;
        if (underscore >= 0) {
          const run = (s.slice(underscore).match(/^_+/) ?? ["___"])[0].length;
          x = itemX + (underscore / total) * it.width; width = Math.max(40, (run / total) * it.width);
        } else if (/[:：]\s*$/.test(s.trim()) || /sign\s+here/i.test(s)) {
          x = itemX + it.width + 6; width = label.w;
        } else continue;                                             // a bare word "name" in a sentence is not a blank
        const h = label.h;
        const yTop = ph - (baseline + h - 4);
        if (x + width > pw) width = Math.max(20, pw - x - 4);
        if (suggestions.length >= MAX_SUGGESTIONS) break;
        suggestions.push({
          id: `s${p}-${suggestions.length + 1}`, type: label.type, page: p,
          x: clamp01(x / pw), y: clamp01(yTop / ph), w: Math.max(0.01, Math.min(1, width / pw)), h: Math.max(0.01, Math.min(1, h / ph)),
          why: `found “${s.trim().slice(0, 40)}”`,
        });
      }
    }
    return { chars, pagesScanned: n, suggestions };
  } catch (e) {
    if (e?.name === "PasswordException") throw new PdfProblem("locked", "This PDF is password-protected. Remove the password and upload it again.");
    // text reading failing does not make the file unusable: fields can be placed by hand
    return { chars: 0, pagesScanned: 0, suggestions: [], textFailed: true };
  } finally { try { await task?.destroy(); } catch { /* nothing to release */ } }
}

/** Run 9 — the check before sending: the words of each page with where they sit (fractions of the page, origin top-left), at most `maxPages` pages and 4,000 runs a page. A file whose text cannot be
 *  read gives no pages (the check then has nothing to compare, and says nothing about it) — never a throw. */
export async function pdfTextRuns(bytes, { maxPages = 30 } = {}) {
  let task;
  try {
    task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
    const pdf = await task.promise;
    const out = [];
    for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p += 1) {
      const page = await pdf.getPage(p);
      const [x0, y0, x1, y1] = page.view; const pw = Math.max(1, x1 - x0), ph = Math.max(1, y1 - y0);
      const runs = [];
      for (const it of (await page.getTextContent()).items) {
        if (!("str" in it) || !it.str.trim() || runs.length >= 4000) continue;
        const h = Math.max(4, Math.abs(it.transform[3]) || it.height || 10);
        runs.push({ str: it.str.slice(0, 500), x: clamp01((it.transform[4] - x0) / pw), y: clamp01((ph - (it.transform[5] - y0) - h) / ph), w: clamp01(it.width / pw), h: clamp01((h * 1.2) / ph) });
      }
      out.push({ page: p, runs });
    }
    return out;
  } catch { return []; }
  finally { try { await task?.destroy(); } catch { /* nothing to release */ } }
}

const MAX_IMAGE_PIXELS = 150e6;   // an A4 page scanned at 600 dpi is ~35 million; a decompression bomb declares hundreds of millions
/** The most pixels any single image in the file DECLARES (Width x Height from its dictionary; nothing is decoded). */
function largestImagePixels(doc) {
  let max = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const d = obj?.dict;
    if (!d || typeof d.get !== "function") continue;
    const w = d.get(PDFName.of("Width")), h = d.get(PDFName.of("Height"));
    if (w?.asNumber && h?.asNumber) max = Math.max(max, w.asNumber() * h.asNumber());
  }
  return max;
}

export async function inspectPdf(bytes) {
  const doc = await loadStructure(bytes);
  let count, pages;
  try { count = doc.getPageCount(); } catch { throw new PdfProblem("corrupt", "This PDF could not be read — it may be damaged. Try saving it again from the program that made it."); }
  if (count < 1) throw new PdfProblem("corrupt", "This PDF has no pages.");
  if (count > MAX_PAGES) throw new PdfProblem("too_many_pages", `This PDF has ${count} pages; the most that can be sent in one document is ${MAX_PAGES}.`);
  try { pages = doc.getPages().map(pageSizeOf); } catch { throw new PdfProblem("corrupt", "This PDF could not be read — its pages are damaged."); }
  if (pages.some((g) => !(g.w >= 3 && g.h >= 3 && g.w <= 14400 && g.h <= 14400))) throw new PdfProblem("bad_page_size", "A page in this PDF has a size that cannot be used (smaller than 3 points or larger than 200 inches). Save it again at a normal page size.");
  const pixels = largestImagePixels(doc);
  if (pixels > MAX_IMAGE_PIXELS) throw new PdfProblem("image_too_big", `This PDF contains an image of ${Math.round(pixels / 1e6)} million pixels; the most that can be handled is ${MAX_IMAGE_PIXELS / 1e6} million. Save it again at a lower scan resolution.`);
  const acroform = readAcroForm(doc, pages);
  const text = await readTextAndDetect(bytes, pages);
  const scanned = text.pagesScanned > 0 && text.chars < 20 * Math.max(1, Math.min(text.pagesScanned, 3));
  const suggestions = [
    ...acroform.map((f, i) => ({ id: `f${i + 1}`, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, why: `form field “${String(f.name).slice(0, 40)}”` })),
    ...text.suggestions,
  ].slice(0, MAX_SUGGESTIONS);
  return {
    pageCount: count, pages, hasText: text.chars > 0, scanned, alreadySigned: hasDigitalSignature(bytes),
    acroform: acroform.map(({ name, type, page }) => ({ name, type, page })), suggestions,
  };
}

/** Layer 1 of field detection: the form fields already in the file, as { name, type, page, x, y, w, h } in page fractions (y from the top). */
export async function nativeFields(bytes) {
  const doc = await loadStructure(bytes);
  return readAcroForm(doc, doc.getPages().map(pageSizeOf));
}

/**
 * Remove what a PDF could DO rather than show (PDF-FIELD-DETECTION-SPEC §5, safety): scripts, launch and URI-less actions, embedded files, rich media. Nothing is executed on our side either way (pdf.js runs with eval off and no scripting);
 * this is so the copy that is kept, sent and downloaded carries none of it. Returns the same bytes untouched when there is nothing to remove, else a rewritten copy and a list of what went.
 * @returns {Promise<{bytes:Uint8Array, removed:string[]}>}
 */
export async function stripActiveContent(bytes) {
  let rightsDropped = false;   // Run 7: usage rights removed (not active content, so not listed in `removed`)
  const raw = Buffer.from(bytes).toString("latin1");
  // ★ Run 8 (R8-17): the quick look at the raw bytes can only see dictionaries that are written out plainly. In a file with OBJECT STREAMS (most PDFs saved by Word, Chrome and the
  //   like) every dictionary is inside a compressed stream, the look found nothing, and the file kept its scripts and launch actions all the way into the sealed copy. Such a file is always read.
  if (!/\/ObjStm\b/.test(raw) && !/\/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFiles?|EmbeddedFile|RichMedia|FileAttachment|GoToR|GoToE|SubmitForm|ImportData|UR3)\b/.test(raw)) return { bytes, removed: [] };
  const doc = await loadStructure(bytes), removed = new Set(), ctx = doc.context;
  const isActive = (d) => { const s = d instanceof PDFDict ? d.lookup(PDFName.of("S")) : null; return s instanceof PDFName && /^\/(JavaScript|Launch|GoToR|GoToE|SubmitForm|ImportData|Rendition|Movie|Sound)$/.test(s.toString()); };
  const cat = doc.catalog;
  const open = cat.lookup(PDFName.of("OpenAction")); if (open instanceof PDFDict && isActive(open)) { cat.delete(PDFName.of("OpenAction")); removed.add("open action"); }
  if (cat.has(PDFName.of("AA"))) { cat.delete(PDFName.of("AA")); removed.add("document actions"); }
  const names = cat.lookup(PDFName.of("Names"));
  if (names instanceof PDFDict) {
    if (names.has(PDFName.of("JavaScript"))) { names.delete(PDFName.of("JavaScript")); removed.add("script"); }
    if (names.has(PDFName.of("EmbeddedFiles"))) { names.delete(PDFName.of("EmbeddedFiles")); removed.add("embedded files"); }
  }
  if (cat.has(PDFName.of("JavaScript"))) { cat.delete(PDFName.of("JavaScript")); removed.add("script"); }
  // ★ Run 7: Adobe "usage rights" (/Perms /UR3) stop being valid the moment the file is saved again; left in, Reader warns that the form "has been changed". It is not a signature of the document, so it goes.
  { const perms = cat.lookup(PDFName.of("Perms")); if (perms instanceof PDFDict && perms.has(PDFName.of("UR3")) && !perms.has(PDFName.of("DocMDP"))) { perms.delete(PDFName.of("UR3")); if (!perms.keys().length) cat.delete(PDFName.of("Perms")); rightsDropped = true; } }
  const scrub = (d) => {
    if (!(d instanceof PDFDict)) return;
    if (d.has(PDFName.of("AA"))) { d.delete(PDFName.of("AA")); removed.add("field actions"); }
    const a = d.lookup(PDFName.of("A")); if (a instanceof PDFDict && isActive(a)) { d.delete(PDFName.of("A")); removed.add("link action"); }
  };
  for (const page of doc.getPages()) {
    scrub(page.node);
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray); if (!annots) continue;
    const keep = [];
    for (let i = 0; i < annots.size(); i += 1) {
      const a = annots.lookup(i);
      if (a instanceof PDFDict) {
        const sub = a.lookup(PDFName.of("Subtype"));
        if (sub instanceof PDFName && /^\/(FileAttachment|RichMedia|Screen|Sound|Movie|3D)$/.test(sub.toString())) { removed.add("attachment"); continue; }
        scrub(a);
      }
      keep.push(annots.get(i));
    }
    if (keep.length !== annots.size()) page.node.set(PDFName.of("Annots"), ctx.obj(keep));
  }
  // ★ Run 8 (R8-17): and every script or launch ACTION left anywhere in the file goes too — a bookmark's action, a name tree we do not walk, an action no longer referenced.
  //   Unreferenced ones are inert, but a scanner (and a careful reader) still sees "/JavaScript" in the file; a referenced one we did not walk would still run.
  for (const [ref, obj] of [...ctx.enumerateIndirectObjects()]) {
    if (obj instanceof PDFDict && (isActive(obj) || obj.has(PDFName.of("JS")))) { ctx.delete(ref); removed.add("script"); }
  }
  if (!removed.size && !rightsDropped) return { bytes, removed: [] };
  return { bytes: await doc.save({ useObjectStreams: false }), removed: [...removed], rightsDropped };
}
