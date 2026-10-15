// PDF FIELD DETECTION · THE ENGINE (PDF-FIELD-DETECTION-SPEC §4). Reads a PDF, finds every blank a person would fill or sign, says what each one is and who it belongs to, and says how sure it is.
// Layers (each adds to the earlier): 1 native form fields · 3 page text (the text layer, or OCR when the page is a picture) · 4 lines, cells, checkboxes, bars (geometry.mjs) · 5 label matching · 6 roles.
// (Text tags, layer 2, are read at upload by textTags.mjs and win over everything here; the AI pass, layer 7, is visionPass.mjs.) Pure of the database and the network: bytes in, a plain result out.
// Result: { pages:[{page,kind,fields,sideways,scanned}], fields:[{id,type,page,x,y,w,h,confidence,source,label?,role?,sensitive?,format?,group?}], roles:[{key,label}], documents:[{from,to,title,kind}], summary:{…} }
// Every coordinate is a fraction of the page, y from the top, matching the editor's own.
import { openPdf, renderPage, pageWords } from "./render.mjs";
import { analyse } from "./geometry.mjs";
import { vectorGeometry } from "./vector.mjs";
import { classifyLabel, roleOf, ROLE_LABEL, looksLikeSentence } from "./labels.mjs";
import { nativeFields } from "../pdfProcess.mjs";
import { knownForms, recognise, pageFingerprint } from "./known.mjs";

export const DETECT_MAX_PAGES = 100;
const DETECT_DEADLINE_MS = 45_000;
const MIN_CONFIDENCE = 0.6;      // a guess below this is not shown
const MAX_PER_PAGE = 120;        // more than this on one page is a table or a list, not a form: say so and offer to split (a dense checklist form holds a hundred tick boxes)


const clamp01 = (v) => Math.max(0, Math.min(1, v));
const RTL = /[\u0590-\u08FF\uFB1D-\uFEFF]/;
const BLANKISH = /^[(\[]?[._\-–—]{4,}[,.;:)\]]?$/;   // a run of underscores, dots or dashes, with punctuation stuck to it ("____,")
const GLYPH_BOX = /^(\[\s*[xX✓✔]?\s*\]|\(\s*[xX✓✔]?\s*\)|☐|□|◻|❏)$/;   // a tick box written as characters
const CLOSING = /^(sincerely|regards|best regards|kind regards|warm regards|respectfully( yours| submitted)?|yours (truly|sincerely|faithfully)|very truly yours|cordially|with appreciation|thank you)[,.!]?$/i;
const LABEL_ONLY = /^(?:[\p{L}/'’-]+\s+){0,3}(signature|signed|date|todays? date|date signed|initials?)\s*:?\*?$/iu;   // "Parent/Guardian Signature:" on a line of its own
const SIZE = {            // default box, as a fraction of the page: [w cap, h]
  signature: [0.34, 0.036], initials: [0.09, 0.032], date_signed: [0.17, 0.024], text: [1, 0.024], checkbox: [0.02, 0.014],
};

/** Words → phrases: neighbours on one text line, split where the gap is wider than a space or two. */
function phrasesOf(words) {
  const real = words.filter((w) => !BLANKISH.test(w.str) && /[\p{L}\p{N}]/u.test(w.str))      // a word with no letter or digit in it is a drawn line the reader mistook for text.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const w of real) {
    const cy = w.y + w.h / 2, line = lines.find((l) => Math.abs(l.cy - cy) < Math.max(l.h, w.h) * 0.45);
    if (line) { line.ws.push(w); line.cy = (line.cy * (line.ws.length - 1) + cy) / line.ws.length; line.h = Math.max(line.h, w.h); } else lines.push({ cy, h: w.h, ws: [w] });
  }
  const out = [];
  for (const l of lines) {
    l.ws.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const w of l.ws) {
      if (cur && w.x - (cur.x + cur.w) < Math.max(0.012, w.h * 0.9)) { cur.str += ` ${w.str}`; cur.w = w.x + w.w - cur.x; cur.h = Math.max(cur.h, w.h); cur.y = Math.min(cur.y, w.y); }
      else { if (cur) out.push(cur); cur = { str: w.str, x: w.x, y: w.y, w: w.w, h: w.h, page: w.page }; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** A 64-bit picture hash of the page (8 by 8 blocks, each lighter or darker than the page's average): the same form gives nearly the same hash whatever is written on it. */
function pageHash({ w, h, rgba }) {
  const bw = Math.floor(w / 8), bh = Math.floor(h / 8), sums = new Array(64).fill(0);
  for (let by = 0; by < 8; by += 1) for (let bx = 0; bx < 8; bx += 1) { let s = 0, n = 0; for (let y = by * bh; y < (by + 1) * bh; y += 3) for (let x = bx * bw; x < (bx + 1) * bw; x += 3) { const i = (y * w + x) * 4; s += (rgba[i] * 77 + rgba[i + 1] * 151 + rgba[i + 2] * 28) >> 8; n += 1; } sums[by * 8 + bx] = s / Math.max(1, n); }
  const mean = sums.reduce((a, b) => a + b, 0) / 64; let bits = 0n; sums.forEach((v, i) => { if (v < mean) bits |= 1n << BigInt(i); });
  return bits.toString(16).padStart(16, "0");
}
const cx = (b) => b.x + b.w / 2, cy = (b) => b.y + b.h / 2;
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy; return i / (a.w * a.h + b.w * b.h - i || 1);
}

/** The phrase that names a blank: on its left on the same line, then printed under it, then above it. */
function labelFor(blank, phrases, W = 1) {
  let best = null;
  const bcy = blank.type === "line" ? blank.y : cy(blank);
  for (const p of phrases) {
    if (looksLikeSentence(p.str) && p.str.length > 60) continue;
    const pcy = cy(p);
    let score = null, where = null;
    const sameLine = Math.abs(pcy - (blank.type === "line" ? blank.y - p.h * 0.45 : bcy)) < Math.max(p.h, 0.012) * 0.9;
    if (sameLine && p.x + p.w <= blank.x + 0.015 && blank.x - (p.x + p.w) < 0.3) { score = (blank.x - (p.x + p.w)) + 0.0; where = "left"; }
    else if (sameLine && p.x >= blank.x + blank.w - 0.01 && p.x - (blank.x + blank.w) < (blank.type === "check" ? 0.12 : 0.3) && (blank.type === "check" || RTL.test(p.str))) { score = (p.x - (blank.x + blank.w)) + 0.02; where = "right"; }   // a right-to-left form puts its label on the right of the blank
    else {
      const overlap = Math.min(blank.x + blank.w, p.x + p.w) - Math.max(blank.x, p.x);
      const bottom = blank.y + (blank.type === "line" ? 0 : blank.h), top = blank.type === "line" ? blank.y : blank.y;
      if (overlap > Math.min(p.w, blank.w) * 0.25 && p.y >= bottom - 0.002 && p.y - bottom < 0.034) { score = 0.1 + (p.y - bottom) * 2; where = "below"; }
      else if (overlap > Math.min(p.w, blank.w) * 0.25 && p.y + p.h <= top + 0.004 && top - (p.y + p.h) < 0.03) { score = 0.14 + (top - (p.y + p.h)) * 2; where = "above"; }
    }
    if (score == null) continue;
    const cls = classifyLabel(p.str);
    if (!cls && blank.type !== "check") { score += 0.2; }
    if (!best || score < best.score) best = { score, phrase: p, cls, where };
  }
  return best;
}

/** Empty-looking things that are really decoration: a line right under running text (an underlined heading). */
/** A stroke inside a word's own box (the bar of a letter, a Arabic baseline) is part of the word, not a blank. */
function insideWord(line, words) {
  return words.some((w) => /[\p{L}\p{N}]/u.test(w.str) && line.x >= w.x - 0.003 && line.x + line.w <= w.x + w.w + 0.003 && line.y > w.y + w.h * 0.1 && line.y < w.y + w.h * 0.95);
}
function underlinesText(line, words) {
  let covered = 0;
  for (const w of words) if (!BLANKISH.test(w.str) && /[\p{L}\p{N}]/u.test(w.str) && w.y + w.h >= line.y - 0.012 && w.y + w.h <= line.y + 0.006 && w.x >= line.x - 0.005 && w.x + w.w <= line.x + line.w + 0.005) covered += w.w;
  return covered > line.w * 0.55;
}

/** The engine's result for a recognised known form (same shape as a detected one), or null. */
async function knownFormResult(pdf, n, t0) {
  const lib = knownForms(); if (!lib.length || !lib.some((f) => f.pages.length === n)) return null;
  const pages = [], all = [];
  for (let p = 1; p <= n; p += 1) { const pg = await pdf.getPage(p), vp = pg.getViewport({ scale: 1 }), words = (await pageWords(pdf, p)).words; all.push(...words); pages.push({ fp: pageFingerprint(words), aspect: vp.width / vp.height }); if (!pages.at(-1).fp) return null; }
  const f = recognise(pages, lib, { words: all }); if (!f) return null;
  let seq = 0;
  const fields = f.fields.map((x) => ({ id: `k${x.page}-${++seq}`, page: x.page, type: x.type, x: x.x, y: x.y, w: x.w, h: x.h, confidence: 0.99, source: "known", ...(x.label ? { label: x.label } : {}), role: "signer_1" }));
  const pageInfo = Array.from({ length: n }, (_, i) => ({ page: i + 1, kind: fields.some((x) => x.page === i + 1) ? "form" : "reference", heading: i === 0 ? f.title : null, fields: fields.filter((x) => x.page === i + 1).length }));
  return { pages: pageInfo, fields, roles: [{ key: "signer_1", label: "Signer 1" }], documents: [{ from: 1, to: n, kind: "form", title: f.title }], recognised: { id: f.id, title: f.title, publisher: f.publisher, likeness: f.likeness },
    summary: { fields: fields.length, signers: 1, lowConfidence: 0, pagesRead: n, pagesTotal: n, timedOut: false, truncated: false, ms: Date.now() - t0, recognised: f.title } };
}

/** P10R1-7: a PDF field's own name as a label a person can read: the last part of a form-tool path ("topmostSubform[0].Page1[0].f1_01[0]" → none, "Employer_Name" → "Employer Name"); a machine name (f1_01, Text12, c1_1) gives no label at all. */
function nativeLabel(name) {
  if (!name) return null;
  const last = String(name).split(".").pop().replace(/\[\d+\]/g, "").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  if (!last || /^(f|c|text|check ?box|field|txt|untitled)\s?\d+([ _]\d+)*$/i.test(last) || !/[a-z]{3}/i.test(last)) return null;
  return last.slice(0, 80);
}

export async function detectFields(bytes, { maxPages = DETECT_MAX_PAGES, deadlineMs = DETECT_DEADLINE_MS, native = null, ocr = null, dpi = 150, hashOnly = false, minConfidence = MIN_CONFIDENCE } = {}) {
  const t0 = Date.now();
  // candidates mode (minConfidence below the normal bar): every plausible box is kept, numbered by the caller, for the AI look to choose from; the page-level "not a form" drop and the per-page cap do not apply
  const candidates = minConfidence < MIN_CONFIDENCE, MIN_C = minConfidence;
  if (hashOnly) {   // upload time: only the pages' fingerprints, so a form sent before is recognised. No guessing at fields.
    const { pdf, task } = await openPdf(bytes);
    try { const n = Math.min(pdf.numPages, maxPages), pages = []; for (let p = 1; p <= n; p += 1) { if (Date.now() - t0 > deadlineMs) break; pages.push({ page: p, hash: pageHash(await renderPage(pdf, p, { dpi })) }); } return { pages, fields: [], roles: [], documents: [], summary: { fields: 0, signers: 0, lowConfidence: 0, pagesRead: pages.length, pagesTotal: pdf.numPages, ms: Date.now() - t0 } }; }
    finally { try { await task.destroy(); } catch { /* nothing to release */ } }
  }
  native ??= await nativeFields(bytes).catch(() => []);
  const { pdf, task } = await openPdf(bytes);
  try {
    const n = Math.min(pdf.numPages, maxPages);
    // Run 7: a form the known-forms library recognises (by fingerprint, no AI) gets that form's own field map; everything else is detected below as before
    if (!candidates && n === pdf.numPages) { const known = await knownFormResult(pdf, n, t0); if (known) return known; }
    const found = [], pageInfo = [], headings = [];
    let timedOut = false;
    for (let p = 1; p <= n; p += 1) {
      if (Date.now() - t0 > deadlineMs) { timedOut = true; break; }
      const tw = await pageWords(pdf, p);
      const scanned = tw.charCount < 15;
      // a page with a text layer is read from its own drawing commands (vector.mjs); only a picture of a page is analysed as a picture
      const vec = scanned ? null : await vectorGeometry(await pdf.getPage(p), tw.words);
      const img = vec ? { w: vec.W, h: vec.H } : await renderPage(pdf, p, { dpi });
      const geo = vec ?? analyse(img);
      const hash = vec ? null : pageHash(img);
      let words = tw.words;
      if (scanned && ocr) { try { words = (await ocr(img, p, { skew: geo.skew })) ?? words; } catch { /* the page is read by shape alone */ } }
      const phrases = phrasesOf(words);
      const W = img.w, H = img.h;
      const fr = (b) => ({ x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H });
      const blanks = [];
      const elementary = (o) => !geo.cells.some((q) => q !== o && q.x >= o.x - 1 && q.x + q.w <= o.x + o.w + 1 && q.y >= o.y - 1 && q.y + q.h <= o.y + o.h + 1 && (q.w < o.w - 2 || q.h < o.h - 2));   // a cell with another cell inside it is two boxes read as one
      // Run 9 (Part 4.1): a run of four or more short underlines, the same width and evenly spaced on one baseline, is a character comb drawn as one stroke per character (an EIN "__ – _______"):
      // one text field per stroke (each stroke is one character's place, as the form's own fillable copy has it), the height of a line of writing above the strokes
      const underComb = new Set();
      { const shorts = geo.lines.map((l, k) => ({ l, k })).filter(({ l }) => !l.ruled && l.w / W >= 0.012 && l.w / W < 0.05).sort((a, b) => a.l.y - b.l.y || a.l.x - b.l.x);
        for (let i = 0; i < shorts.length; i += 1) {
          if (underComb.has(shorts[i].k)) continue; const run = [shorts[i]];
          for (let j = i + 1; j < shorts.length; j += 1) { const last = run.at(-1).l, q = shorts[j].l; if (Math.abs(q.y - last.y) < 1 && q.x > last.x && q.x - (last.x + last.w) < last.w * 0.6 && Math.abs(q.w - last.w) < last.w * 0.2) run.push(shorts[j]); }
          if (run.length < 4) continue;
          const a = run[0].l, z = run.at(-1).l, h = Math.min(0.016, (a.w / H) * 1.1);
          if (underlinesText({ x: a.x / W, y: a.y / H, w: (z.x + z.w - a.x) / W, h: 0 }, words)) continue;
          run.forEach((r) => underComb.add(r.k));
          for (const { l } of run) blanks.push({ type: "cell", x: l.x / W, y: l.y / H - h, w: l.w / W, h, src: "comb" });
        } }
      // candidates from the picture
      for (const [k, l] of geo.lines.entries()) {
        if (underComb.has(k)) continue;
        if (l.ruled || l.w > W * 0.8) continue;
        const b = { type: "line", x: l.x / W, y: l.y / H, w: l.w / W, h: 0, src: "line" };
        if (b.y < 0.035 || b.y > 0.985 || underlinesText(b, words) || insideWord(b, words)) continue;
        blanks.push(b);
      }
      // a run of four or more touching or nearly touching small squares or boxes is a character comb (an ID number, a ZIP code): one text field, not tick boxes or cells
      const smalls = [...geo.checks.map((c) => ({ ...fr(c), kind: "check" })), ...geo.cells.filter((c) => c.empty && c.w / W < 0.06 && c.h / H < 0.05).map((c) => ({ ...fr(c), kind: "cell" }))].sort((a, b) => a.y - b.y || a.x - b.x), combUsed = new Set();
      for (let i = 0; i < smalls.length; i += 1) {
        if (combUsed.has(i)) continue; const run = [i];
        for (let j = i + 1; j < smalls.length; j += 1) { const last = smalls[run.at(-1)], q = smalls[j]; if (!combUsed.has(j) && q.kind === last.kind && Math.abs(q.y - last.y) < 0.006 && q.x - (last.x + last.w) < last.w * 0.45 && q.x > last.x) run.push(j); }   // Run 9: one kind per comb; a row of cells each framing a tick box (Yes | No | N/A) is not a comb
        if (run.length >= 4) { run.forEach((k) => combUsed.add(k)); const a = smalls[run[0]], z = smalls[run.at(-1)]; blanks.push({ type: "cell", x: a.x, y: a.y, w: z.x + z.w - a.x, h: a.h, src: "comb" }); }
      }
      smalls.forEach((q, k) => { if (!combUsed.has(k) && q.kind === "check") blanks.push({ type: "check", x: q.x, y: q.y, w: q.w, h: q.h, src: "check" }); });
      for (const c of geo.cells) if (c.empty && elementary(c)) { const q = fr(c); if (!smalls.some((m, k) => combUsed.has(k) && m.kind === "cell" && Math.abs(m.x - q.x) < 1e-6 && Math.abs(m.y - q.y) < 1e-6)) blanks.push({ type: "cell", ...q, src: "cell" }); }
      for (const c of geo.bars) blanks.push({ type: "bar", ...fr(c), src: "bar" });
      // tick boxes written as characters: "[ ]", "( )" and the ballot-box signs. pdf.js hands the brackets back as separate little words, so a "[" and the "]" after it on the same line are one box
      { const sorted = [...words].filter((w) => w.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x), used = new Set();
        sorted.forEach((w, i) => {
          if (used.has(i)) return; const one = GLYPH_BOX.test(w.str.trim());
          const open = /^[\[(]$/.test(w.str.trim()) ? i : -1; const close = open >= 0 ? sorted.findIndex((c, k) => k > i && /^[\])]$/.test(c.str.trim()) && Math.abs(cy(c) - cy(w)) < w.h * 0.6 && c.x >= w.x && c.x - (w.x + w.w) < 0.05) : -1;
          if (one) { used.add(i); blanks.push({ type: "check", x: w.x, y: w.y + w.h * 0.1, w: Math.max(w.w, w.h * 0.9), h: w.h * 0.85, src: "glyph" }); }
          else if (open >= 0 && close > i) { used.add(i); used.add(close); const c = sorted[close]; blanks.push({ type: "check", x: w.x, y: Math.min(w.y, c.y) + w.h * 0.1, w: c.x + c.w - w.x, h: w.h * 0.85, src: "glyph" }); }
        }); }
      // candidates from the text: ______ and ........ runs the picture may have broken up
      for (const w of words) {
        if (!BLANKISH.test(w.str) || w.w <= 0.03) continue;
        // a row of dots with a number right after it is a leader (a contents page, a menu price): not a blank
        const dots = (w.str.match(/[.·]/g) ?? []).length / w.str.length > 0.6, after = dots ? words.filter((o) => o !== w && Math.abs(cy(o) - cy(w)) < w.h * 0.7 && o.x >= w.x + w.w - 0.01 && o.x - (w.x + w.w) < 0.4).sort((a, b) => a.x - b.x)[0] : null;
        if (after && /^[$€£]?[\d.,]+[%)]?$/.test(after.str.trim())) continue;
        blanks.push({ type: "line", x: w.x, y: w.y + w.h * 0.92, w: w.w, h: 0, src: "textline" });
      }
      // a bordered box with a small caption in its top corner and room under it is a blank (the numbered boxes of a tax-style form): the field is the room under the caption
      // how far down a cell its own words reach: a captioned blank leaves room below its caption, a cell of a data table is full
      const reach = (c) => { const b = fr(c), ins = words.filter((w) => /[\p{L}\p{N}]/u.test(w.str) && cx(w) > b.x && cx(w) < b.x + b.w && cy(w) > b.y && cy(w) < b.y + b.h); return ins.length ? (Math.max(...ins.map((w) => w.y + w.h)) - b.y) / b.h : 0; };
      for (const c of geo.cells) {
        if (c.empty || !elementary(c)) continue;
        const bx = fr(c); if (bx.h < 0.01 || bx.w < 0.04 || bx.w > 0.95) continue;
        { const row = geo.cells.filter((o) => !o.empty && elementary(o) && Math.abs(o.y - c.y) < c.h * 0.2 && Math.abs(o.h - c.h) < c.h * 0.3); if (row.length >= 3 && Math.max(...row.map(reach)) >= 0.85) continue; }   // a row of table cells whose height is set by the words in it (data), not by room left for a blank
        if (geo.lines.some((l) => { const f = fr({ x: l.x, y: l.y, w: l.w, h: 0 }); return f.y > bx.y + 0.006 && f.y < bx.y + bx.h - 0.004 && f.x < bx.x + bx.w && f.x + f.w > bx.x && f.w < bx.w * 0.9; })) continue;   // a blank already drawn inside the box is the field; its caption is not another one
        const inside = words.filter((w) => /[\p{L}\p{N}]/u.test(w.str) && !/^[$€£]$/.test(w.str.trim()) && cx(w) > bx.x && cx(w) < bx.x + bx.w && cy(w) > bx.y && cy(w) < bx.y + bx.h);
        if (!inside.length || inside.length > 45) continue;
        if ((bx.h < 0.026 || bx.w < 0.08) && !(inside.length === 1 && /^\d{1,2}[a-z]?$/i.test(inside[0].str.trim()))) continue;   // only a numbered answer box may be this small
        const bottom = Math.max(...inside.map((w) => w.y + w.h)), tallest = Math.max(...inside.map((w) => w.h));
        // one caption, or several side by side in a shared box (Signature | Date): each gets the room under it, up to the next caption
        let caps = phrasesOf(inside).filter((c) => !/^\d{1,2}[a-z]?[.)]?$/i.test(c.str.trim())).sort((a, b) => a.x - b.x);   // the box number ("6") is not a caption
        // a box holding only its line number ("11a", "13") is the answer box for that line
        if (!caps.length && inside.length === 1 && bx.w <= 0.3 && bx.h >= 0.012) {
          blanks.push({ type: "cell", x: bx.x + 0.003, y: bx.y + 0.002, w: bx.w - 0.006, h: bx.h - 0.004, src: "capcell", caption: `Line ${inside[0].str.trim()}`, sibSig: false });
          continue;
        }
        if (!caps.length || caps[0].x - bx.x > 0.07) continue;   // a caption starts in the box's top-left corner; words set in the middle of a cell are its data
        // a caption that wraps onto two or three lines, all starting at the same left edge, is still one caption (the first box of a tax-style form)
        const stacked = caps.length > 1 && caps.length <= 3 && bx.w > 0.1 && caps.every((c) => Math.abs(c.x - caps[0].x) < (/^\d{1,2}[a-z]?\s/i.test(caps[0].str) ? 0.05 : 0.012)) && caps.every((c) => Math.abs(c.h - caps[0].h) < caps[0].h * 0.5);
        if (stacked) { const top = [...caps].sort((a, b) => a.y - b.y); caps = [{ ...top[0], str: top.map((c) => c.str).join(" "), w: Math.max(...top.map((c) => c.w)), h: bottom - top[0].y }]; }
        if (inside.length > 30 && !stacked) continue;
        // a caption set along the bottom of its box (I-9 style: the box is the room above its label)
        const topOf = Math.min(...inside.map((w) => w.y));
        if (!stacked && topOf - bx.y >= 0.012 && topOf >= bx.y + bx.h * 0.4 && bx.y + bx.h - bottom < 0.02 && tallest <= 0.42 * bx.h + 0.004 && caps.every((c) => Math.abs(cy(c) - cy(caps[0])) <= Math.max(c.h, caps[0].h) * 0.6)) {
          caps.forEach((cp, i) => {
            const right = i + 1 < caps.length ? caps[i + 1].x - 0.008 : bx.x + bx.w - 0.004, left = i === 0 ? bx.x + 0.004 : cp.x - 0.004;
            if (/^\p{Ll}/u.test(cp.str.trim()) || /^(yes|no|n\/a|none|all|any|[-–—]|[\d.,%$]+)$/i.test(cp.str.trim())) return;
            if (cp.str.trim().split(/\s+/).length < 2) return;   // one word at the foot of a cell is a table's data ("Mon"); a label has more
            blanks.push({ type: "cell", x: left, y: bx.y + 0.002, w: right - left, h: topOf - bx.y - 0.004, src: "capcell", caption: cp.str, sibSig: false });
          });
          continue;
        }
        if (tallest > bx.h * 0.42 || bottom > bx.y + bx.h * (stacked ? 0.8 : 0.62) || bx.y + bx.h - bottom < 0.012 || inside.some((w) => cy(w) > bx.y + bx.h * (stacked ? 0.75 : 0.55))) continue;
        if (!stacked && caps.some((c) => Math.abs(cy(c) - cy(caps[0])) > Math.max(c.h, caps[0].h) * 0.6)) continue;   // text on several lines is a text block in a box, not a caption
        caps.forEach((cp, i) => {
          const right = i + 1 < caps.length ? caps[i + 1].x - 0.008 : bx.x + bx.w - 0.004;
          if (/^\p{Ll}/u.test(cp.str.trim().replace(/^(?:\(?[a-z]{1,2}\)|[a-z][.)]|[\d.()]+)\s*/i, ''))) return;   // a caption begins with a capital; a phrase that begins in lower case is the middle of a sentence or a table's data (Run 9: after a column letter, "(a) Policy number")
          if (/(\.\.\.|…)$/.test(cp.str.trim())) return;   // Run 9: a caption that trails off ("IF you live in...") leads into what is printed below it: a table's heading, not a blank's
          if (/^(yes|no|n\/a|none|all|any|[-–—]|[\d.,%$]+)$/i.test(cp.str.trim())) return;   // a table's data ("Yes", "N/A", a figure), not the caption of a blank
          if (/[.!?]$/.test(cp.str) && cp.str.split(" ").length > (stacked ? 30 : 9) && !/^[\p{Lu}][^.!?]{0,60}[.]\s/u.test(cp.str) || /^[\p{Lu}][^.!?]{0,60}[.]\s/u.test(cp.str) && cp.str.split(/[.]\s/)[0].split(" ").length > 12) return;   // Run 9: a caption may open with its label and go on with an instruction ("Name. If married, file …", "City, town or post office … ZIP code. If you have a foreign address …")
          const left = i === 0 ? bx.x + 0.004 : cp.x - 0.004, sibSig = caps.some((c) => classifyLabel(c.str)?.type === "signature");
          // Run 9 (Part 4.1): one caption over a room split by dividers that start under the caption (an SSN's three boxes): one blank per part
          const cuts = caps.length === 1 ? (c.dividers ?? []).filter((d) => d.top / H >= bottom - 0.004).map((d) => d.x / W).filter((x) => x > left + 0.012 && x < right - 0.012) : [];
          if (cuts.length) { const edges = [left, ...cuts, right]; for (let e = 0; e + 1 < edges.length; e += 1) blanks.push({ type: "cell", x: edges[e] + (e ? 0.002 : 0), y: bottom + 0.002, w: edges[e + 1] - edges[e] - (e ? 0.004 : 0.002), h: bx.y + bx.h - bottom - 0.004, src: "capcell", caption: cp.str, sibSig }); return; }
          blanks.push({ type: "cell", x: left, y: bottom + 0.002, w: right - left, h: bx.y + bx.h - bottom - 0.004, src: "capcell", caption: cp.str, sibSig });
        });
      }
      // table headers: the words inside non-empty cells
      const filledCells = geo.cells.filter((c) => !c.empty && elementary(c)).map((c) => ({ ...fr(c) }));   // Run 9: a cell holding smaller cells is several boxes read as one; it names nothing
      const cellText = (c) => words.filter((w) => cx(w) > c.x && cx(w) < c.x + c.w && cy(w) > c.y && cy(w) < c.y + c.h).sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.str).join(" ");
      // role headings: a phrase that names a person and sits in no blank's line
      for (const ph of phrases) { const r = ph.str.trim().split(/\s+/).length <= 5 ? roleOf(ph.str) : null; if (r && !classifyLabel(ph.str)) headings.push({ page: p, y: ph.y, role: r }); }
      // a page that is mostly turned text is a reference page
      const sideways = tw.charCount < 15 && false;
      const local = [];
      for (const b of blanks) {
        let label = null, cls = null, where = null, conf;
        if (b.type === "bar") {
          const lab = labelFor({ ...b, type: "box" }, phrases);
          const own = phrases.find((ph) => cx(ph) > b.x && cx(ph) < b.x + b.w && cy(ph) > b.y - 0.004 && cy(ph) < b.y + b.h + 0.004);
          label = own?.str ?? lab?.phrase.str ?? null; cls = (label && classifyLabel(label)) || null;
          local.push({ b, kind: "signature", label, cls: cls ?? { type: "signature" }, conf: 0.9, source: "highlight", roleText: [lab?.phrase.str, own?.str].filter(Boolean).join(" ") });
          continue;
        }
        if (b.type === "cell") {
          // a table cell: its column header names it
          const header = filledCells.filter((c) => Math.abs(c.x - b.x) < 0.02 && c.y + c.h <= b.y + 0.004 && b.y - (c.y + c.h) < 0.4).sort((a, c) => (c.y) - (a.y))[0];
          const rowHead = filledCells.filter((c) => c.x + c.w <= b.x + 0.004 && Math.abs(cy(c) - cy(b)) < b.h * 0.6).sort((a, c) => (c.x) - (a.x))[0];
          const lab = labelFor(b, phrases);
          label = b.caption ?? (b.src === "comb" ? lab?.phrase.str : null) ?? ((header && cellText(header)) || (rowHead && cellText(rowHead)) || lab?.phrase.str || null);
          cls = label ? classifyLabel(label) : null;
          // a data table with one empty column (a report whose Notes column has nothing in it) is not a form: where a row holds more filled cells than empty ones, its empty cells are weak guesses
          const rowFilled = geo.cells.filter((c) => !c.empty && elementary(c) && Math.abs((c.y + c.h / 2) / H - cy(b)) < b.h * 0.3).length, rowEmpty = geo.cells.filter((c) => c.empty && elementary(c) && Math.abs((c.y + c.h / 2) / H - cy(b)) < b.h * 0.3).length;   // Run 9: a cell spanning several rows (two rules that are not neighbours) is no row's data
          const dataRow = !b.caption && b.src !== "comb" && rowFilled > rowEmpty && rowFilled >= 3;
          conf = dataRow ? 0.5 : b.src === "comb" ? 0.72 : b.caption ? (cls ? 0.8 : 0.68) : cls ? 0.78 : (header || rowHead ? 0.66 : (lab && !looksLikeSentence(lab.phrase.str) && lab.phrase.str.length <= 40 ? 0.66 : 0.5));   // an empty cell under a column heading is a blank to fill, even when the heading names no known type
          // Run 9 (Part 4.1): a narrow empty cell under a "Yes" or "No" column heading is that column's tick box
          if (header && !b.caption && b.w < 0.06 && /^(yes|no|n\/a|s[ií]|oui|non|ja|nein|sim|n[ãa]o)$/i.test(cellText(header).trim())) {
            const s = Math.min(0.014, b.w * 0.8, b.h * 0.9); local.push({ b: { ...b, type: "check", x: b.x + b.w / 2 - s / 2, y: b.y + b.h / 2 - s / 2, w: s, h: s }, kind: "checkbox", label: cellText(header).trim(), cls: { type: "checkbox" }, conf: 0.72, source: "checkbox", where: "above", roleText: null });
            continue;
          }
          if (cls?.type === "date_signed" && !b.sibSig) cls = { ...cls, type: "text", format: "date" };   // a date column is typed in; only a date beside a signature is filled by signing
          // Run 9 (Part 4.1): a tall empty cell beside a numbered line (a line-item form whose question wraps) is answered on the line its number sits on
          if (rowHead && !b.caption && b.h >= 0.035 && b.w < 0.3) {
            const num = words.filter((w) => /^\d{1,2}[a-z]?$/i.test(w.str.trim()) && cx(w) > rowHead.x && cx(w) < rowHead.x + rowHead.w && cy(w) > b.y && cy(w) < b.y + b.h).sort((p, q) => q.y - p.y)[0];
            if (num) { const h = Math.max(0.015, num.h + 0.004); b.y = Math.min(b.y + b.h - h, Math.max(b.y, cy(num) - h / 2)); b.h = h; }
          }
          local.push({ b, kind: cls?.type ?? "text", label, cls: cls ?? { type: "text" }, conf, source: b.caption ? "box" : header || rowHead ? "table" : "box", table: !b.caption && Boolean(header || rowHead), roleText: label });
          continue;
        }
        // a full-width rule with shorter blank lines sitting on it, inside it, is the separator between table rows, not an answer line
        if (b.type === "line" && b.w > 0.5) {
          const shorts = blanks.filter((o) => o !== b && o.type === "line" && o.w < b.w * 0.7 && Math.abs(o.y - b.y) < 0.05 && o.x >= b.x - 0.01 && o.x + o.w <= b.x + b.w + 0.01);
          const sameRow = shorts.some((o) => shorts.some((q) => q !== o && Math.abs(q.y - o.y) < 0.006));
          const sisterRule = blanks.some((o) => o !== b && o.type === "line" && o.w > 0.5 && Math.abs(o.y - b.y) < 0.06 && Math.abs(o.x - b.x) < 0.01);
          if (sameRow || (shorts.length >= 1 && sisterRule)) continue;
        }
        const lab = labelFor(b, phrases);
        label = lab?.phrase.str ?? null; cls = lab?.cls ?? null; where = lab?.where ?? null;
        if (b.type === "check") {
          conf = label ? 0.78 : 0.55;
          local.push({ b, kind: "checkbox", label: label && where === "right" ? label : label ?? null, cls: { type: "checkbox" }, conf, source: "checkbox", where, roleText: label });
          continue;
        }
        // "Yes ___  No ___": a short blank after an answer word is a tick spot
        if (b.type === "line" && label && b.w < 0.1 && /^(yes|no|si|sí|oui|non|ja|nein|sim|não|nao|n\/a)$/i.test(label.trim())) {
          const bx = { ...b, type: "check", x: b.x + b.w / 2 - 0.007, y: b.y - 0.022, w: 0.014, h: 0.014 };
          local.push({ b: bx, kind: "checkbox", label, cls: { type: "checkbox" }, conf: 0.6, source: "checkbox", where: "left", roleText: label }); continue;
        }
        // a short line after a party's name in the footer ("PARTY A ____") is where that party initials
        if (b.type === "line" && !cls && where === "left" && label && b.w >= 0.05 && b.w < 0.1 && b.y > 0.95 && !/\bpage\b|\d/i.test(label) && label.trim().split(/\s+/).length <= 3) {
          cls = { type: "initials" }; local.push({ b, kind: "initials", label: `${label} initials`, cls, conf: 0.72, source: "line", where, roleText: label }); continue;
        }
        // a long line under a prompt, with nothing else on its row, is the answer space of a written question: a text area standing on the line
        if (b.type === "line" && (!cls || where === "below") && b.w >= 0.6 && (where !== "left" || /^[\d.()a-z]{1,6}$/i.test(String(label).trim())) && b.y > 0.06 && b.y < 0.93) {
          const q = phrases.filter((ph) => ph.y + ph.h <= b.y - 0.01 && b.y - (ph.y + ph.h) < 0.12 && ph.x < b.x + b.w * 0.5 && !/^[\d.()a-z]{1,6}$/i.test(ph.str.trim())).sort((x, y) => (y.y + y.h) - (x.y + x.h))[0];
          const between = blanks.some((o) => o !== b && o.type === "line" && o.y < b.y && o.y > (q ? q.y : 0) && o.w >= 0.1);
          if (q && !between && q.str.trim().length > 12 && (/[?:]\s*$/.test(q.str.trim()) || where === "left") && !/^[A-Z0-9\s.,()&/-]+$/.test(q.str)) { local.push({ b, kind: "text", label: q.str, cls: { type: "text" }, conf: 0.66, source: "line", where: "above", roleText: null, area: true }); continue; }
        }
        // a line in the middle of a sentence (words right before it and right after it on the same row) is a blank in that sentence
        if (b.type === "line" && !cls && b.w >= 0.12 && b.w <= 0.4 && b.y > 0.06 && b.y < 0.93) {
          const rowOf = (ph) => Math.abs((ph.y + ph.h) - b.y) < 0.02;
          const before = phrases.some((ph) => rowOf(ph) && ph.x + ph.w <= b.x + 0.005 && b.x - (ph.x + ph.w) < 0.03), after = phrases.some((ph) => rowOf(ph) && ph.x >= b.x + b.w - 0.005 && ph.x - (b.x + b.w) < 0.03) || words.some((w) => rowOf(w) && w.x >= b.x + b.w - 0.005 && w.x - (b.x + b.w) < 0.03 && /[\p{L}\p{N}]/u.test(w.str));
          if (before && after) { local.push({ b, kind: "text", label: label ?? "Fill in", cls: { type: "text" }, conf: 0.72, source: "line", where: where ?? "left", roleText: null }); continue; }
        }
        // a blank that opens a line of the paragraph (its words follow it on the same row) is a blank to fill, even when nothing is printed before it
        if (b.type === "line" && !cls && (!label || where !== "left") && b.w >= 0.12 && b.y > 0.06 && b.y < 0.93) {
          const next = phrases.find((ph) => Math.abs((ph.y + ph.h) - b.y) < 0.02 && ph.x >= b.x + b.w - 0.005 && ph.x - (b.x + b.w) < 0.03);
          if (next) { local.push({ b, kind: "text", label: next.str, cls: { type: "text" }, conf: 0.66, source: "line", where: "right", roleText: null }); continue; }
        }
        // the rest of a sentence that wraps onto a line of its own ("... reporting to" then a rule and a full stop), and the recipient's line above a salutation, are blanks to fill
        if (b.type === "line" && !cls && b.w >= 0.12 && b.w <= 0.4 && b.y > 0.06 && b.y < 0.93) {
          const onRow = words.some((w) => Math.abs((w.y + w.h) - b.y) < 0.02 && w.x < b.x + b.w + 0.02 && w.x + w.w > b.x - 0.02 && /[\p{L}\p{N}]/u.test(w.str));
          const above = phrases.filter((ph) => ph.y + ph.h <= b.y && b.y - (ph.y + ph.h) < 0.045 && b.y - (ph.y + ph.h) > 0.004 && ph.x <= b.x + 0.2 && ph.x + ph.w >= b.x - 0.02).sort((x, y) => (y.y + y.h) - (x.y + x.h))[0];
          const below = phrases.find((ph) => ph.y >= b.y - 0.004 && ph.y - b.y < 0.05 && Math.abs(ph.x - b.x) < 0.03 && /^(dear|hello|hi)\b/i.test(ph.str.trim()));
          if (!onRow && above && (/\b(to|of|by|for|with|on|at|and|or|the|a|an|is|as|from|in|within|under|than)\s*$/i.test(above.str.trim()) || (above.str.trim().split(/\s+/).length >= 4 && above.w > 0.3 && !/[.!?:;]\s*$/.test(above.str.trim()) && above.str.trim().split(/\s+/).filter((t) => t.length === 1).length < 4))) { local.push({ b, kind: "text", label: above.str.trim().split(/\s+/).slice(-4).join(" "), cls: { type: "text" }, conf: 0.66, source: "line", where: "above", roleText: null }); continue; }
          if (!onRow && below) { local.push({ b, kind: "text", label: "Recipient", cls: { type: "text" }, conf: 0.66, source: "line", where: "above", roleText: null }); continue; }
        }
        // a line with only a person's title printed under it ("Director", "Tenant") is where that person signs
        if (b.type === "line" && !cls && where === "below" && label && label.trim().split(/\s+/).length <= 3 && roleOf(label) && b.w >= 0.15) {
          cls = { type: "signature" }; local.push({ b, kind: "signature", label: `${label} signature`, cls, conf: 0.74, source: "line", where, roleText: label }); continue;
        }
        // the line under "Sincerely," is where the sender signs, whatever is printed beneath it
        if (b.type === "line" && !cls) {
          const closing = phrases.find((ph) => CLOSING.test(ph.str.trim()) && b.y - (ph.y + ph.h) > -0.005 && b.y - (ph.y + ph.h) < 0.14 && b.x < ph.x + 0.2 && b.x + b.w > ph.x - 0.02);
          if (closing) { cls = { type: "signature" }; label = "Signature"; where = "above"; local.push({ b, kind: "signature", label, cls, conf: 0.84, source: "line", roleText: lab?.phrase.str ?? null }); continue; }
        }
        // a long rule with only a caption under it that names nothing is a divider (a cut line, a section rule), not an answer line
        if (b.type === "line" && !cls && where === "below" && b.w > 0.5) continue;
        // an underline with a recognised label is a field; with no label at all it is a weak guess; with an unrelated label it is ignored when it is short
        if (!cls && label && b.w < 0.08 && !(b.type === "line" && b.w >= 0.05 && blanks.filter((o) => o !== b && o.type === "line" && Math.abs(o.x - b.x) < 0.01 && Math.abs(o.w - b.w) < 0.01).length >= 3)) continue;   // a short line is a blank only when the same short line repeats down the page
        conf = cls ? (cls.type === "signature" || cls.type === "initials" ? 0.9 : 0.85) : (label && (where === "left" || (b.src === "textline" && where)) ? 0.65 : 0.4);   // a drawn line with a printed label right before it on the same row is a fill-in blank even when the label names no known type
        if (b.src === "textline" && (cls || !label)) conf -= 0.05;
        // a stack of three or more equal ruled lines under a prompt is a written answer: the lines are the answer space
        if (!cls && b.type === "line" && b.w >= 0.1 && (() => { const n = blanks.filter((o) => o !== b && o.type === "line" && Math.abs(o.x - b.x) < 0.01 && Math.abs(o.w - b.w) < 0.015 && Math.abs(o.y - b.y) < (b.w > 0.4 ? 0.14 : 0.3) && Math.abs(o.y - b.y) > 0.01).length; return n >= 2 || (n >= 1 && b.w <= 0.4 && phrases.some((ph) => ph.y + ph.h <= b.y && b.y - (ph.y + ph.h) < 0.09 && ph.x < b.x + b.w && ph.x + ph.w > b.x)); })()) {
          conf = Math.max(conf, 0.66);
          if (!label) { const q = phrases.filter((ph) => ph.y + ph.h <= b.y + 0.002 && b.y - (ph.y + ph.h) < (b.w > 0.4 ? 0.12 : 0.3) && ph.x < b.x + b.w && ph.x + ph.w > b.x).sort((x, y) => (y.y + y.h) - (x.y + x.h))[0]; if (q) { label = q.str; where = "above"; } }
        }
        local.push({ b, kind: cls?.type ?? "text", label, cls: cls ?? { type: "text" }, conf, source: b.src === "textline" ? "text" : "line", roleText: lab ? `${lab.phrase.str}` : null });
      }
      // "Signature:" or "Date" alone on a line, with no blank drawn beside or under it: the field goes to its right, but only where nothing else is already there (a table heading is not one)
      for (const ph of phrases) {
        const m = LABEL_ONLY.exec(ph.str.trim()); if (!m || ph.str.trim().split(/\s+/).length > 5) continue;
        if (words.some((w) => w.x > ph.x + ph.w + 0.003 && Math.abs(cy(w) - cy(ph)) < ph.h * 0.7 && w.x - (ph.x + ph.w) < 0.4 && /[\p{L}\p{N}]/u.test(w.str))) continue;
        if (filledCells.some((c) => cx(ph) > c.x && cx(ph) < c.x + c.w && cy(ph) > c.y && cy(ph) < c.y + c.h)) continue;
        const cls = classifyLabel(ph.str); if (!cls || !["signature", "date_signed", "initials"].includes(cls.type)) continue;
        const near = (o) => o.b.y - 0.012 <= ph.y + ph.h && (o.b.type === "line" ? o.b.y : o.b.y + o.b.h) >= ph.y - 0.012 && o.b.x + o.b.w >= ph.x + ph.w - 0.01 || (o.b.y >= ph.y + ph.h - 0.004 && o.b.y - (ph.y + ph.h) < 0.045 && o.b.x + o.b.w > ph.x && o.b.x < ph.x + ph.w + 0.3) || (o.b.type === "line" && ph.y - o.b.y > 0 && ph.y - o.b.y < 0.04 && o.b.x <= cx(ph) + 0.02 && o.b.x + o.b.w >= cx(ph) - 0.02);   // a caption under its own line is that line's caption
        if (local.some(near)) continue;
        const b = { type: "line", x: ph.x + ph.w + 0.012, y: ph.y + ph.h * 0.95, w: SIZE[cls.type]?.[0] ?? 0.2, h: 0, src: "labelonly" };
        local.push({ b, kind: cls.type, label: ph.str, cls, conf: 0.64, source: "text", roleText: ph.str });
      }
      // empty squares that repeat in a row or a column (a Yes/No column, a rating scale) are tick boxes even with no word beside them; one square alone stays a weak guess
      for (const c of local) {
        if (c.kind !== "checkbox" || c.conf >= MIN_C) continue;
        const inCol = local.filter((o) => o !== c && o.kind === "checkbox" && Math.abs(cx(o.b) - cx(c.b)) < 0.012).length, inRow = local.filter((o) => o !== c && o.kind === "checkbox" && Math.abs(cy(o.b) - cy(c.b)) < 0.008).length;
        if (inCol >= 2 || inRow >= 2) c.conf = 0.66;
      }
      // checkbox groups: boxes in a row/column sharing a question → one single-choice group
      const checks = local.filter((l) => l.kind === "checkbox");
      let g = 0;
      for (const c of checks) {
        if (c.group) continue;
        const mates = checks.filter((o) => o !== c && !o.group && ((Math.abs(cy(o.b) - cy(c.b)) < 0.01 && Math.abs(cx(o.b) - cx(c.b)) < 0.35) || (Math.abs(cx(o.b) - cx(c.b)) < 0.01 && Math.abs(cy(o.b) - cy(c.b)) < 0.03)));
        const answers = [c, ...mates].filter((m) => /^(yes|no|si|sí|oui|non|ja|nein|sim|não|nao|n\/a|none|other)$/i.test(String(m.label ?? "").trim()));
        if (answers.length >= 2) { g += 1; const gid = `g${p}-${g}`; for (const m of answers) m.group = gid; }
      }
      // "Check only one": the tick boxes just under that line are a single-choice group
      for (const ph of phrases) {
        if (!/\b(check|select|choose|tick|mark)\s+(only\s+)?(one|1)\b/i.test(ph.str)) continue;
        const under = checks.filter((c) => !c.group && cy(c.b) > ph.y + ph.h * 0.5 && cy(c.b) < ph.y + ph.h + 0.06);
        if (under.length >= 2) { g += 1; for (const m of under) m.group = `g${p}-${g}`; }
      }
      // nesting: a tick box indented under another one is named after it ("Housing needs › Shelter"), so the sub-choices keep their place in the list
      const sortedChecks = [...checks].sort((a, b) => cy(a.b) - cy(b.b) || cx(a.b) - cx(b.b));
      for (const c of sortedChecks) {
        const parent = sortedChecks.filter((o) => o !== c && o.label && o.b.x < c.b.x - 0.02 && cy(o.b) < cy(c.b) - 0.004 && cy(c.b) - cy(o.b) < 0.1 && !o.nested).sort((a, b) => cy(b.b) - cy(a.b))[0];
        if (parent && c.label && !c.group) { c.label = `${parent.label} › ${c.label}`; c.nested = true; }
      }
      // Date next to a signature belongs to the same person; every field gets a role
      for (const l of local) {
        const rt = l.roleText ?? l.label ?? "";
        l.role = rt.trim().split(/\s+/).length > 5 ? null : roleOf(rt);   // a whole sentence printed near a blank says nothing about who fills it
      }
      for (const l of local) {
        if (l.role || !["date_signed", "initials"].includes(l.cls.type)) continue;
        const sig = local.filter((o) => o.role && o.cls.type === "signature" && Math.abs(cy(o.b) - cy(l.b)) < 0.06).sort((a, b) => Math.abs(cx(a.b) - cx(l.b)) - Math.abs(cx(b.b) - cx(l.b)))[0];
        if (sig) l.role = sig.role;
      }
      // a date written into a sentence ("the lease dated ___", "Finish date") with no signature on its row is typed in; only a date beside a signature, or one that says it is the signing date, is filled by signing
      for (const l of local) {
        if (l.cls.type !== "date_signed" || l.table) continue;
        if (/sign|firma|unterschr|signature/i.test(l.label ?? "")) continue;
        const sentence = String(l.label ?? "").trim().split(/\s+/).length >= 4;
        if (local.some((o) => o !== l && o.cls.type === "signature" && (!sentence || Math.abs(cy(o.b) - cy(l.b)) < 0.08))) continue;
        l.kind = "text"; l.cls = { ...l.cls, type: "text", format: "date" };
      }
      // a rule with a sentence of printed words hugging it from underneath is a table's row separator, not a blank to write on (a caption under a line is a few words)
      for (let i = local.length - 1; i >= 0; i -= 1) {
        const l = local[i]; if (l.b.type !== "line" || l.source !== "line" || l.area || ["signature", "initials", "date_signed"].includes(l.kind)) continue;
        if (phrases.some((ph) => ph.y >= l.b.y - 0.002 && ph.y - l.b.y < 0.014 && ph.x < l.b.x + l.b.w && ph.x + ph.w > l.b.x && ph.str.trim().split(/\s+/).length >= 5) && phrases.some((ph) => ph.y + ph.h <= l.b.y + 0.002 && l.b.y - (ph.y + ph.h) < 0.02 && ph.x < l.b.x + l.b.w && ph.x + ph.w > l.b.x && ph.str.trim().split(/\s+/).length >= 2)) local.splice(i, 1);
      }
      // a short rule centred just under the page's own title, with no word near it, is the blank for the document's name or reference
      {
        const medH = phrases.length ? phrases.map((x) => x.h).sort((a, b) => a - b)[phrases.length >> 1] : 0;
        const title = phrases.filter((ph) => ph.y < 0.25 && ph.h > medH * 1.25).sort((a, b) => b.h - a.h)[0];
        if (title) for (const l of local) {
          if (l.kind !== "text" || l.label || l.conf >= MIN_C || l.b.type !== "line" || l.b.w < 0.12 || l.b.w > 0.4) continue;
          const gap = l.b.y - (title.y + title.h), mid = l.b.x + l.b.w / 2;
          if (gap < -0.005 || gap > 0.045 || Math.abs(mid - (title.x + title.w / 2)) > 0.03) continue;
          if (words.some((w) => Math.abs(cy(w) - l.b.y) < 0.02 && w.x < l.b.x + l.b.w + 0.03 && w.x + w.w > l.b.x - 0.03 && /[\p{L}\p{N}]/u.test(w.str))) continue;
          l.conf = 0.66; l.label = "Title";
        }
      }
      for (const l of local) {
        const b = l.b; let type = l.kind; if (type === "name" || type === "email" || type === "phone" || type === "address") type = "text";
        const [wcap, hh] = SIZE[type] ?? SIZE.text;
        let box;
        if (b.type === "line" && l.area) {
          box = { x: b.x, y: b.y - 0.066, w: b.w, h: 0.068 };
          // Run 9 (Part 4.1): an answer area stops under the printed words above its line (the question it answers), as a one-line box does
          const above = words.filter((k) => /[\p{L}\p{N}]/u.test(k.str) && k.y + k.h > box.y + 0.002 && k.y + k.h <= b.y + 0.001 && Math.min(k.x + k.w, box.x + box.w) - Math.max(k.x, box.x) > Math.min(k.w, 0.02) * 0.5);
          if (above.length) { const top = Math.max(...above.map((k) => k.y + k.h)) + 0.001; box = b.y + 0.002 - top >= 0.012 ? { ...box, y: top, h: b.y + 0.002 - top } : { x: b.x, y: b.y - 0.017, w: b.w, h: 0.019 }; }
        }
        else if (b.type === "line") {
          const w = Math.min(b.w, wcap); box = { x: b.x, y: b.y - hh + 0.003, w, h: hh };
          // a box stands on its line and stops under the printed words above it, so it never lies over a caption or a sentence
          const above = words.filter((k) => /[\p{L}\p{N}]/u.test(k.str) && k.y + k.h > box.y + 0.002 && k.y + k.h <= b.y + 0.001 && Math.min(k.x + k.w, box.x + box.w) - Math.max(k.x, box.x) > Math.min(k.w, 0.02) * 0.5);
          if (above.length && type !== "signature" && type !== "initials") { const top = Math.max(...above.map((k) => k.y + k.h)) + 0.001, bottom = box.y + box.h; if (bottom - top >= 0.008) box = { ...box, y: top, h: bottom - top }; }
        }
        else if (b.type === "bar") { box = { x: b.x, y: b.y - Math.max(0, (hh - b.h) / 2), w: b.w, h: Math.max(b.h, hh) }; }
        else box = { x: b.x, y: b.y, w: b.w, h: b.h };
        if (type === "checkbox") box = { x: b.x, y: b.y, w: b.w, h: b.h };
        box = { x: clamp01(box.x), y: clamp01(box.y), w: Math.min(box.w, 1 - clamp01(box.x)), h: Math.min(box.h, 1 - clamp01(box.y)) };
        local[local.indexOf(l)] = { ...l, box, type };
      }
      // THE VETOES (9 Oct 2026), the same for every kind of box: weak guesses are dropped, not shown; a box with printed words in it is not blank; a line that runs through words is a rule, not a blank
      const realWords = words.filter((w) => /[\p{L}\p{N}]/u.test(w.str) && !BLANKISH.test(w.str) && !(scanned && w.str.trim().length <= 1));   // on a picture, character recognition reads a tick box as an O or a D: one stray character is not printed text
      const overlapArea = (bx, w) => Math.max(0, Math.min(bx.x + bx.w, w.x + w.w) - Math.max(bx.x, w.x)) * Math.max(0, Math.min(bx.y + bx.h, w.y + w.h) - Math.max(bx.y, w.y));
      const printed = (bx) => realWords.some((w) => overlapArea(bx, w) > 0.3 * Math.min(w.w * w.h, bx.w * bx.h) + 1e-9 && overlapArea(bx, w) > 0);
      let vetoed = 0;
      for (let i = local.length - 1; i >= 0; i -= 1) {
        const l = local[i];
        const weak = l.conf < MIN_C, covered = l.b.type === "line" ? false : l.type !== "checkbox" ? printed(l.box) : printed({ x: l.box.x + l.box.w * 0.15, y: l.box.y + l.box.h * 0.15, w: l.box.w * 0.7, h: l.box.h * 0.7 });
        if (weak || covered) { if (process.env.KEYSTONE_DETECT_DEBUG) console.error(`veto p${p} ${l.type} ${weak ? "weak" : "printed"} conf ${l.conf} at ${l.box.x.toFixed(3)},${l.box.y.toFixed(3)} label=${l.label}`); local.splice(i, 1); vetoed += 1; }
      }
      for (const l of local) {
        found.push({ page: p, type: l.type, ...l.box, confidence: Math.round(l.conf * 100) / 100, source: l.source, ...(l.label ? { label: String(l.label).replace(/[:：_\s]+$/g, "").slice(0, 80) } : {}), role: l.role ?? null, ...(l.cls.sensitive ? { sensitive: true } : {}), ...(l.cls.format ? { format: l.cls.format } : {}), ...(l.cls.kind && l.type === "text" ? { kind: l.cls.kind } : {}), ...(l.group ? { group: l.group } : {}), ...(l.table ? { table: true } : {}), _y: l.box.y });
      }
      const heading = phrases.filter((ph) => ph.y < 0.2).sort((a, b) => b.h - a.h || a.y - b.y)[0];
      pageInfo.push({ page: p, hash, scanned, sideways, skew: Math.round(geo.skew * 10) / 10, heading: heading?.str?.slice(0, 80) ?? null, headingSize: heading?.h ?? 0, medianH: phrases.length ? phrases.map((x) => x.h).sort((a, b) => a - b)[phrases.length >> 1] : 0, fields: local.length });
    }
    // native form fields are exact: they replace any guess that lands on them
    const nat = native.map((f) => ({ page: f.page, type: f.type, x: f.x, y: f.y, w: f.w, h: f.h, confidence: 1, source: "native", label: nativeLabel(f.name) ?? undefined, role: roleOf(f.name ?? "") }));
    let all = [...nat, ...found.filter((f) => !nat.some((nf) => nf.page === f.page && iou(nf, f) > 0.1))];
    // two guesses on the same spot: keep the surer one
    all.sort((a, b) => b.confidence - a.confidence);
    const keep = [];
    for (const f of all) if (!keep.some((k) => k.page === f.page && iou(k, f) > 0.25)) keep.push(f);
    keep.sort((a, b) => a.page - b.page || a._y - b._y || a.x - b.x);
    // a page with no blank that was named is not a form: it gets nothing. A page with more than MAX_PER_PAGE is a table or a list: the surest ones are kept and the page is flagged.
    const cappedPages = new Set();
    for (let i = keep.length - 1; i >= 0; i -= 1) {
      const f = keep[i], onPage = keep.filter((k) => k.page === f.page);
      if (!candidates && f.source !== "native" && !onPage.some((k) => k.source === "native" || k.confidence >= 0.7) && onPage.filter((k) => k.label && k.confidence >= 0.62).length < 3 && !(onPage.length <= 2 && onPage.every((k) => k.source === "line" && k.label && k.confidence >= 0.65))) keep.splice(i, 1);   // a form page has a blank that was named, or at least three labelled ones
    }
    for (const pg of new Set(keep.map((k) => k.page))) {
      const onPage = keep.filter((k) => k.page === pg && k.source !== "native");
      if (onPage.length > (candidates ? 80 : MAX_PER_PAGE)) { cappedPages.add(pg); const drop = new Set(onPage.sort((a, b) => b.confidence - a.confidence).slice(candidates ? 80 : MAX_PER_PAGE)); for (let i = keep.length - 1; i >= 0; i -= 1) if (drop.has(keep[i])) keep.splice(i, 1); }
    }
    // roles: the people named, in reading order; a field with none takes the nearest heading above it, else the first person
    const roleOrder = [];
    const headAbove = (f) => headings.filter((h) => h.page === f.page && h.y <= f.y + 0.01).sort((a, b) => b.y - a.y)[0] ?? headings.filter((h) => h.page < f.page).sort((a, b) => b.page - a.page || b.y - a.y)[0];
    for (const f of keep) {
      if (!f.role) f.role = ["signature", "initials", "date_signed"].includes(f.type) ? null : (headAbove(f)?.role ?? null);
      if (f.role && !roleOrder.includes(f.role)) roleOrder.push(f.role);
    }
    const hasRoles = roleOrder.length > 0;
    const roles = (hasRoles ? roleOrder : ["client"]).map((r, i) => ({ key: `signer_${i + 1}`, label: hasRoles ? ROLE_LABEL[r] ?? String(r).replace(/^custom:/, "") : "Signer 1", _r: r }));
    const keyOf = (r) => (roles.find((x) => x._r === (r ?? roles[0]._r)) ?? roles[0]).key;
    let seq = 0;
    const fields = keep.map((f) => { const { _y, role, ...rest } = f; return { id: `d${f.page}-${++seq}`, ...rest, role: keyOf(role) }; });
    // pages: a form page has a field that was named; the rest are reference pages
    for (const pi of pageInfo) {
      const onPg = fields.filter((f) => f.page === pi.page), named = onPg.filter((f) => f.source === "native" || f.confidence >= 0.7);
      pi.kind = named.length || onPg.filter((f) => f.label && f.confidence >= 0.62).length >= 3 ? "form" : "reference"; if (cappedPages.has(pi.page)) pi.capped = true; pi.fields = fields.filter((f) => f.page === pi.page).length;
    }
    const documents = [];
    for (const pi of pageInfo) {
      const last = documents.at(-1);
      const newTitle = pi.kind === "form" && last?.kind === "form" && pi.heading && pi.headingSize > pi.medianH * 1.25 && pi.heading !== last.title && !/page\s+\d|continued|cont\./i.test(pi.heading);
      if (last && last.kind === pi.kind && !newTitle) last.to = pi.page;
      else documents.push({ from: pi.page, to: pi.page, kind: pi.kind, title: pi.heading ?? null });
    }
    const low = fields.filter((f) => f.confidence < 0.6).length;
    return {
      pages: pageInfo.map(({ headingSize, medianH, ...r }) => r), fields, roles: roles.map(({ _r, ...r }) => r), documents,
      summary: { fields: fields.length, signers: roles.length, lowConfidence: low, pagesRead: pageInfo.length, pagesTotal: pdf.numPages, timedOut, truncated: pdf.numPages > n, ms: Date.now() - t0 },
    };
  } finally { try { await task.destroy(); } catch { /* nothing to release */ } }
}
