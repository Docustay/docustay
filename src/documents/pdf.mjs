// src/documents/pdf.mjs — THE PDF OF A DOCUMENT, DRAWN FROM THE ONE DOCUMENT VIEW (QUEUE §23 Part 2). This file no longer decides what a document says; `documentView.mjs` does, and the React screen
// reads the same tree. This file only knows how to DRAW that tree with pdfkit: letterhead, header and footer on every page ("Page X of Y", the document ID), the body, each signature in place
// (the drawn mark, or the typed name in a signature font), and the Certificate of Completion.
//
// ★★★ AN EXECUTED INSTRUMENT RENDERS THE FROZEN **SNAPSHOT**, NEVER THE LIVE TEMPLATE (§M0 LAW 3). `renderExecutedPdf` takes a snapshot and has no access to a template at all: a "copy" of an agreement
//   must show the words that were signed, not today's. ★ It is also DETERMINISTIC: both PDF dates are pinned to the instrument's own `executedAt`, text is not compressed, so one instrument is one
//   set of bytes — which is what makes the content fingerprint on the certificate mean something.
//
// ★★ THE OVERLAP DEFECT (QUEUE §16.1), FOUND AND FIXED HERE. A paragraph of mixed bold and plain runs was drawn with one `text()` call per run, each carrying `width`, and closed with an empty
//   `text("")`. pdfkit restarts its line wrapper whenever the options of a continued call change, and the empty closer leaves the cursor on the paragraph's last line, so the NEXT paragraph started
//   about three points too high and drew over it (19 overlaps on the real 19-section Coaching Agreement, measured with test/helpers/pdfInvariants.mjs). Fix: the options go on the FIRST run only, every
//   later run is a bare `{continued}`, and the last run closes the paragraph itself (`drawRuns` below).
//
// ★★★ THE SEAL (FOUND ON THE SANDBOX, 2 Oct 2026): `@signpdf/signpdf` is a CommonJS build with __esModule, so under this Node the default import is the module wrapper — unwrapped below. The plain
//   placeholder works on the FINISHED PDF buffer and has no pdfkit version at all (the old pdfkit-0.10 placeholder never reached the bytes on pdfkit 0.20).

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANG_META } from "./languages.mjs";
import { prepareForSeal } from "./pdfPrepare.mjs";
import { parseTemplateSnapshot } from "./body.mjs";
import { buildDocumentView } from "./documentView.mjs";
import { PDF_THEME } from "./pdfTheme.mjs";
import signpdfModule from "@signpdf/signpdf";
const signpdf = (() => { let m = signpdfModule; for (let i = 0; i < 3 && m && typeof m.sign !== "function"; i += 1) m = m.default; return m; })();
import { P12Signer } from "@signpdf/signer-p12";
import { plainAddPlaceholder } from "@signpdf/placeholder-plain";
import { timestampPdf, KNOWN_TSA_URLS } from "pdf-rfc3161";
import { signingCertP12, signingCertPassphrase } from "./signingCert.mjs";
import "./pdfFlattenFonts.mjs";
import { appendPdfs } from "./pdfFlatten.mjs";
import { installFontFallback, fitOneLine } from "./pdfTextFallback.mjs";

// ★ D4 — swappable, never hardcoded past this one line. DigiCert is the measured, working default.
const tsaUrl = () => process.env.DOCUMENT_TSA_URL || KNOWN_TSA_URLS.DIGICERT;   // read when used, so a test can point it at its own authority after the module is loaded

const require = createRequire(import.meta.url);
const fontDir = (pkg) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "files");

export class PdfInputError extends Error {
  constructor(message) { super(message); this.name = "PdfInputError"; }
}

// ── fonts ─────────────────────────────────────────────────────────────────────────────────────
// helvetica and times are built into PDF; inter is embedded (it covers accented letters, so Spanish and later languages render). The signature face is Dancing Script (OFL).
function registerFonts(doc, family) {
  if (family === "times") return { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic", boldItalic: "Times-BoldItalic", script: registerScript(doc) };
  if (family === "inter") {
    const dir = fontDir("@fontsource/inter");
    doc.registerFont("Inter", path.join(dir, "inter-latin-400-normal.woff"));
    doc.registerFont("Inter-Bold", path.join(dir, "inter-latin-700-normal.woff"));
    doc.registerFont("Inter-Italic", path.join(dir, "inter-latin-400-italic.woff"));
    doc.registerFont("Inter-BoldItalic", path.join(dir, "inter-latin-700-italic.woff"));
    return { regular: "Inter", bold: "Inter-Bold", italic: "Inter-Italic", boldItalic: "Inter-BoldItalic", script: registerScript(doc) };
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", boldItalic: "Helvetica-BoldOblique", script: registerScript(doc) };
}
function registerScript(doc) {
  doc.registerFont("Script", path.join(fontDir("@fontsource/dancing-script"), "dancing-script-latin-700-normal.woff"));
  return "Script";
}
const runFont = (f, r) => (r.bold && r.italic ? f.boldItalic : r.bold ? f.bold : r.italic ? f.italic : f.regular);

// ── drawing helpers ───────────────────────────────────────────────────────────────────────────
const bottomLimit = (doc) => doc.page.height - doc.page.margins.bottom;
function ensureSpace(doc, h) { if (doc.y + h > bottomLimit(doc)) { doc.addPage(); } }

/** One paragraph (or one list item) of styled runs as ONE continued chain: the options ride on the first call only and the last call closes the paragraph. */
function drawRuns(doc, runs, fonts, { size, width, indent = 0, marker = null, ink, faint }) {
  const parts = [];
  if (marker) parts.push({ text: marker, font: fonts.regular, color: ink });
  for (const r of runs) { if (r.text === "") continue; parts.push({ text: r.text, font: runFont(fonts, r), color: r.href ? PDF_THEME.link : r.missing ? faint : ink, href: r.href }); }
  if (!parts.length) return;
  const x0 = doc.page.margins.left;
  parts.forEach((p, i) => {
    doc.font(p.font).fontSize(size).fillColor(p.color);
    const last = i === parts.length - 1;
    const link = p.href ? { link: p.href, underline: true } : { underline: false };
    doc.text(p.text, i === 0 ? { continued: !last, width, indent, ...link } : { continued: !last, ...link });
  });
  doc.x = x0;
  doc.fillColor(ink);
}

function drawNodes(doc, nodes, ctx) {
  const { fonts, theme, ink, muted, faint, width } = ctx;
  const size = theme.bodySize;
  const x0 = doc.page.margins.left;
  for (const n of nodes) {
    if (n.type === "heading") {
      ensureSpace(doc, 60);
      doc.font(fonts.bold).fontSize(size + 2).fillColor(theme.accent).text(n.text, x0, doc.y, { width });
      doc.moveDown(0.2); doc.fillColor(ink);
    } else if (n.type === "paragraph") {
      drawRuns(doc, n.runs, fonts, { size, width, ink, faint });
      doc.moveDown(0.35);
    } else if (n.type === "list") {
      n.items.forEach((item, idx) => {
        drawRuns(doc, item, fonts, { size, width: width - 14, indent: 14, marker: n.ordered ? `${idx + 1}. ` : "• ", ink, faint });
        doc.moveDown(0.1);
      });
      doc.moveDown(0.2);
    } else if (n.type === "panel") {
      doc.font(fonts.bold).fontSize(size + 1).fillColor(ink).text(n.label, x0 + n.depth * 14, doc.y, { width: width - n.depth * 14 });
      doc.moveDown(0.2);
    } else if (n.type === "field") {
      doc.font(fonts.bold).fontSize(size).fillColor(ink).text(n.label, x0 + n.depth * 14, doc.y, { width: width - n.depth * 14 });
      doc.font(fonts.regular).fontSize(size).fillColor(n.value === null ? faint : ink).text(n.value === null ? "— not answered —" : n.value, x0 + n.depth * 14, doc.y, { width: width - n.depth * 14 });
      doc.fillColor(ink).moveDown(0.45);
    } else if (n.type === "signature") {
      drawSignature(doc, n, ctx);
    } else if (n.type === "pages") {
      doc.font(fonts.italic).fontSize(size).fillColor(muted).text("(the original pages of this document follow)", x0, doc.y, { width });
      doc.fillColor(ink).moveDown(0.5);
    }
  }
}

/** A signature in place: the slot's label, the mark (drawn image or typed name in the signature face), a rule, the printed name and when it was signed — or, unsigned, an empty labelled line. */
function drawSignature(doc, n, ctx) {
  const { fonts, theme, ink, muted, width } = ctx;
  const x0 = doc.page.margins.left;
  const sigW = Math.min(width, 300);
  ensureSpace(doc, n.state === "signed" ? 120 : 70);
  doc.font(fonts.regular).fontSize(8).fillColor(muted).text(n.label, x0, doc.y, { width });
  doc.moveDown(0.3);
  const top = doc.y;
  if (n.state === "signed") {
    const s = n.signature;
    if (s.markKind === "drawn" && s.markImage) {
      try {
        const buf = Buffer.from(String(s.markImage).replace(/^data:image\/png;base64,/, ""), "base64");
        doc.image(buf, x0, top, { fit: [sigW, 52] });
      } catch { const fit = (doc.font(fonts.script), fitOneLine(doc, s.typedText, sigW, 22)); doc.fontSize(fit.size).fillColor(ink).text(fit.text, x0, top, { width: sigW, lineBreak: false }); }
    } else if (s.markKind === "typed") {
      // one line, in the signature face, fitted to the slot (a very long name is shrunk, then cut with an ellipsis — the printed name under the rule always carries the whole name)
      const fit = (doc.font(fonts.script), fitOneLine(doc, s.typedText, sigW, 24));
      doc.fontSize(fit.size).fillColor(ink).text(fit.text, x0, top, { width: sigW, lineBreak: false });
    }
    const lineY = top + 54;
    doc.moveTo(x0, lineY).lineTo(x0 + sigW, lineY).lineWidth(0.7).strokeColor(theme.accent).stroke();
    doc.y = lineY + 4;
    doc.font(fonts.bold).fontSize(ctx.theme.bodySize).fillColor(ink).text(s.printedName, x0, doc.y, { width });
    doc.font(fonts.regular).fontSize(9).fillColor(muted).text(`${s.roleLabel} · Signed ${s.signedText}`, x0, doc.y, { width });
    if (s.email) doc.text(s.email, x0, doc.y, { width });
    if (s.ip) doc.text(`IP address ${s.ip}`, x0, doc.y, { width });
  } else {
    const lineY = top + 40;
    doc.moveTo(x0, lineY).lineTo(x0 + sigW, lineY).lineWidth(0.7).strokeColor(muted).stroke();
    doc.y = lineY + 4;
    doc.font(fonts.italic).fontSize(8).fillColor(muted).text(n.state === "pending" ? "To be signed" : "Signature", x0, doc.y, { width });
  }
  doc.fillColor(ink).moveDown(0.8);
}

function drawLetterhead(doc, view, ctx) {
  const lh = view.chrome.letterhead;
  if (!lh) return;
  const { fonts, theme, ink, muted, width } = ctx;
  const x0 = doc.page.margins.left;
  let textX = x0;
  const top = doc.y;
  if (ctx.logoBytes) {
    try { doc.image(ctx.logoBytes, x0, top, { fit: [110, 38] }); textX = x0 + 122; } catch { /* an unreadable logo is left out, never fatal */ }
  }
  doc.font(fonts.bold).fontSize(14).fillColor(ink).text(lh.name, textX, top + (textX === x0 ? 0 : 4), { width: width - (textX - x0) });
  if (lh.address) doc.font(fonts.regular).fontSize(9).fillColor(muted).text(lh.address, textX, doc.y, { width: width - (textX - x0) });
  const bottom = Math.max(doc.y, top + (textX === x0 ? 0 : 40)) + 6;
  doc.moveTo(x0, bottom).lineTo(x0 + width, bottom).lineWidth(1).strokeColor(theme.accent).stroke();
  doc.x = x0; doc.y = bottom + 14; doc.fillColor(ink);
}

// ── the certificate's own fonts (Part 30 item 9): Inter cannot draw Cyrillic with Latin, Latin Extended, Arabic or CJK, so a certificate in one of those languages is drawn in Noto Sans (SIL OFL 1.1, subset by scripts/fonts/subset.py,
// kept in ./fonts). CJK has one weight (bold falls back to regular). The rest of the document keeps its own font; only the certificate pages change.
const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
const CERT_FONTS = { noto: ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"], "plex-arabic": ["PlexSansArabic-Regular.ttf", "PlexSansArabic-Bold.ttf"], "noto-jp": ["NotoSansJP-Regular.ttf"], "noto-sc": ["NotoSansSC-Regular.ttf"], "noto-kr": ["NotoSansKR-Regular.ttf"] };
function certFontsFor(doc, language, fallback) {
  const fam = LANG_META[language]?.font;
  const files = CERT_FONTS[fam];
  if (!files) return fallback;
  doc.registerFont("CertRegular", path.join(FONT_DIR, files[0]));
  doc.registerFont("CertBold", path.join(FONT_DIR, files[1] ?? files[0]));
  if (fam === "plex-arabic") for (const n of ["CertRegular", "CertBold"]) copyableLigatures(doc.font(n)._font);
  return { regular: "CertRegular", bold: "CertBold", italic: "CertRegular", boldItalic: "CertBold", script: fallback.script };
}

// Copying Arabic text out of a PDF (Part 31 item 7). The font's own glyph->Unicode table is what a viewer reads. (ActualText spans were tried and REJECTED: pdfium treats the span as drawn order and reverses it, so Chrome's viewer returned every word backwards — measured.) Plex has no glyph without a code point (Noto Sans Arabic did: 25% of them), but a ligature glyph (ل+إ, ف+ي …) carries two code points
// and a viewer reverses a right-to-left line AS A WHOLE, including the two inside one glyph, so they must be stored back to front. (Measured on the 82 Arabic strings of the product: pdf.js 0/82 exact with Noto, 36/82 with Plex, 81/82 with this.)
export function copyableLigatures(font) {
  if (font.__copyable) return;
  font.__copyable = true;
  const encode = font.encode.bind(font);
  font.encode = (text, features) => {
    const r = encode(text, features);
    for (const g of font.layout(text, features).glyphs) if (g.codePoints && g.codePoints.length > 1) font.unicode[font.subset.includeGlyph(g.id)] = [...g.codePoints].reverse();
    return r;
  };
}
// pdfkit has no bidirectional layout of its own. Arabic alone is shaped, ordered and wrapped correctly when the "rtla" feature is on; a line that MIXES Arabic with Latin text or digits (a date, an email, "SHA-256") comes out with one of the two
// reversed. So a mixed line is cut into runs, the runs are laid out right to left, and each run is drawn on its own (Arabic runs with "rtla", Latin runs plain) — checked on a rendered page, not assumed.
const LTR_RUN = /[A-Za-z0-9][A-Za-z0-9 .,:@\-\/()+_#'’]*[A-Za-z0-9)]|[A-Za-z0-9]/g;
function rtlRuns(t) {
  const runs = []; let last = 0, m;
  LTR_RUN.lastIndex = 0;
  while ((m = LTR_RUN.exec(t))) { if (m.index > last) runs.push({ s: t.slice(last, m.index), ltr: false }); runs.push({ s: m[0], ltr: true }); last = m.index + m[0].length; }
  if (last < t.length) runs.push({ s: t.slice(last), ltr: false });
  return runs;
}
async function drawCertificate(doc, cert, ctx) {
  if (cert.rtl !== true) return drawCertificateInner(doc, cert, ctx);
  const plain = doc.text;
  doc.text = function (t, ...a) {
    const i = a.length && typeof a[a.length - 1] === "object" && a[a.length - 1] !== null ? a.length - 1 : -1;
    const opts = i >= 0 ? a[i] : {};
    const text = String(t);
    const runs = rtlRuns(text);
    const mixed = runs.some((r) => r.ltr) && runs.some((r) => !r.ltr && /\S/.test(r.s));
    if (!mixed || typeof a[0] !== "number" || typeof a[1] !== "number" || !opts.width || opts.align !== "right") {
      const o = { ...opts, features: ["rtla"] };
      if (i >= 0) a[i] = o; else a.push(o);
      return plain.call(this, t, ...a);
    }
    // mixed line: draw the runs right to left from the right edge (no wrapping — these are short labels and values)
    const parts = runs.map((r) => ({ ...r, w: this.widthOfString(r.s.trim() === "" ? " " : r.s, { features: r.ltr ? [] : ["rtla"] }), pre: /^\s/.test(r.s), post: /\s$/.test(r.s) }));
    const gap = this.widthOfString(" ");
    let cx = a[0] + opts.width; const y = a[1];
    for (const r of parts.slice().reverse()) {
      const str = r.s.trim(); if (!str) { cx -= gap; continue; }
      const w = this.widthOfString(str, { features: r.ltr ? [] : ["rtla"] });
      cx -= w; plain.call(this, str, cx, y, { lineBreak: false, features: r.ltr ? [] : ["rtla"] });
      if (r.pre && !r.ltr) cx -= gap; if (r.post && !r.ltr) cx -= gap;
      if (r.ltr && (r.pre || r.post)) cx -= 0;
    }
    this.y = y + this.currentLineHeight(true); this.x = a[0];
    return this;
  };
  try { return await drawCertificateInner(doc, cert, ctx); } finally { doc.text = plain; }
}
async function drawCertificateInner(doc, cert, ctx) {
  const { theme, ink, muted, width } = ctx;
  const fonts = certFontsFor(doc, cert.language, ctx.fonts);
  const rtl = cert.rtl === true, align = rtl ? "right" : "left";
  const x0 = theme.margin;
  // F926: the certificate's type follows "Text size" (10 pt is the design size every number below was drawn for)
  const K = (Number(theme.bodySize) || 10) / 10, S = (n) => Math.round(n * K * 100) / 100;
  doc.addPage();
  // F927: a certified copy's certificate page carries the letterhead (logo, name, address) when the workspace has it on
  if (ctx.letterhead) drawLetterhead(doc, { chrome: { letterhead: ctx.letterhead } }, ctx);
  doc.font(fonts.bold).fontSize(S(17)).fillColor(theme.accent).text(cert.title, x0, doc.y, { width, align });
  doc.moveDown(0.6);
  const kv = (label, value, { labelW = 150, mono = false } = {}) => {
    const text = String(value ?? "—");
    const valueFont = mono ? "Courier" : fonts.regular;      // a 64-character hash must not wrap mid-way: monospace, small enough to fit one line
    const valueSize = S(mono ? 7 : 9.5);
    doc.font(valueFont).fontSize(valueSize);
    const labelH = doc.font(fonts.regular).fontSize(S(9)).heightOfString(String(label), { width: labelW });   // a long translated label wraps: the row must be as tall as the label too
    doc.font(valueFont).fontSize(valueSize);
    const h = Math.max(doc.heightOfString(text, { width: width - labelW - 10 }) + 3, labelH + 3, 14);
    ensureSpace(doc, h + 4);
    const y = doc.y;
    // right-to-left: the label sits at the right edge and the value runs to its left, both right-aligned
    const labelX = rtl ? x0 + width - labelW : x0, valueX = rtl ? x0 : x0 + labelW + 10;
    doc.font(fonts.regular).fontSize(S(9)).fillColor(muted).text(label, labelX, y, { width: labelW, align });
    doc.font(valueFont).fontSize(valueSize).fillColor(ink).text(text, valueX, y, { width: width - labelW - 10, align: rtl && !mono ? "right" : "left" });
    doc.y = y + h; doc.x = x0;
  };
  for (const [l, v] of cert.summary) kv(l, v);
  for (const p of cert.parties) {
    doc.moveDown(0.6); ensureSpace(doc, 100);
    doc.font(fonts.bold).fontSize(S(11)).fillColor(ink).text(p.heading, x0, doc.y, { width, align });
    if (p.email) doc.font(fonts.regular).fontSize(S(9)).fillColor(muted).text(p.email, x0, doc.y, { width, align });
    doc.moveDown(0.2);
    for (const [l, v] of p.lines) kv(l, v);
  }
  if (cert.fingerprint) {
    doc.moveDown(0.6); ensureSpace(doc, 70);
    doc.font(fonts.bold).fontSize(S(11)).fillColor(ink).text(cert.labels?.fingerprint ?? "Fingerprint", x0, doc.y, { width, align });
    doc.moveDown(0.2);
    for (const [l, v] of cert.fingerprint) kv(l, v, { labelW: 170, mono: true });
    doc.font(fonts.italic).fontSize(S(8)).fillColor(muted).text(cert.labels?.fingerprintNote ?? "The fingerprint is taken from the signed document without this certificate page; the digital seal below covers the whole file.", x0, doc.y, { width });
  }
  if (cert.timeline && cert.timeline.length) {
    doc.moveDown(0.6); ensureSpace(doc, 60);
    doc.font(fonts.bold).fontSize(S(11)).fillColor(ink).text(cert.labels?.timeline ?? "Timeline", x0, doc.y, { width, align });
    doc.moveDown(0.2);
    for (const [at, what, who] of cert.timeline) { ensureSpace(doc, 14); doc.font(fonts.regular).fontSize(S(9)).fillColor(ink).text(`${at}  —  ${what}${who ? ` (${who})` : ""}`, x0, doc.y, { width, align }); }
  }
  // Run 6: the seal sentence, the statement and the verify code are ONE block — if it does not fit it moves to the next page together, so the code never lands alone on a last page
  const sealH = doc.font(fonts.regular).fontSize(S(9)).heightOfString(String(cert.seal ?? ""), { width }), statementH = doc.font(fonts.italic).fontSize(S(9)).heightOfString(String(cert.statement ?? ""), { width });
  doc.moveDown(0.8); ensureSpace(doc, sealH + statementH + (cert.verifyUrl ? 120 : 20));
  doc.font(fonts.regular).fontSize(S(9)).fillColor(ink).text(cert.seal, x0, doc.y, { width, align });
  doc.moveDown(0.4);
  doc.font(fonts.italic).fontSize(S(9)).fillColor(muted).text(cert.statement, x0, doc.y, { width, align });
  if (cert.verifyUrl) {
    doc.moveDown(0.6); ensureSpace(doc, 120);
    const top = doc.y;
    try {
      const png = await QRCode.toBuffer(cert.verifyUrl, { margin: 1, width: 220, errorCorrectionLevel: "M" });
      doc.image(png, x0, top, { fit: [90, 90] });
    } catch { /* no QR: the address is printed anyway */ }
    doc.font(fonts.bold).fontSize(S(9)).fillColor(ink).text(cert.labels?.verify ?? "Verify this document", x0 + 104, top + 6, { width: width - 104 });
    doc.font(fonts.regular).fontSize(S(9)).fillColor(muted).text(cert.verifyUrl, x0 + 104, doc.y, { width: width - 104 });
    drawSealMark(doc, x0 + width - 48, top + 20);
    doc.y = top + 96;
  }
  doc.fillColor(ink);
}

// The Docustay seal on the certificate: the cut D of the final logo (specs/brand/docustay-logo), white on a violet round seal. Vector, no text — the viewer's own signature panel is the cryptographic seal; this is its picture.
const SEAL_D = "M267 139.2V168.1C266.6 165.7 266.2 161.4 266 157.7C265.8 151.8 265.4 151.4 264.4 156.1C263.7 159 263.4 159.8 261.6 164.8C252.4 188.5 229.7 210.4 203.8 220.4C202.9 220.7 201.4 221.3 200.6 221.6C193.9 224.3 181.5 227.4 174.6 228.2C173.4 228.4 171.7 228.6 170.9 228.8C168.7 229.2 53.1 229.4 52.6 229C52.3 228.7 52.2 224.7 52.2 203.7C52.2 178.8 52.2 178.8 52.8 178.2C53.3 177.6 55 176.2 61.2 170.9C62.4 169.9 63.9 168.7 64.5 168.1C65.1 167.6 66 166.8 66.5 166.4C67 166 69.8 163.6 72.6 161.1C79.3 155.4 89.7 146.4 96.1 140.9C98.9 138.5 102 135.8 103.1 134.8C104.2 133.9 107.2 131.4 109.8 129.3C112.3 127.2 115.2 124.7 116.2 123.8C116.6 123.5 116.8 123.2 117.1 123C118.7 121.6 119.6 120.8 120.4 120.8C121.6 120.8 122.8 122.4 125.8 126C127.3 127.7 129.7 130.6 131.3 132.4C134.4 136.1 135 136.9 135 137.8C135 138.4 133.6 140.7 131.5 143.8C130.8 144.6 129 147.4 127.3 149.9C125.6 152.4 123.4 155.6 122.4 157.1C121.3 158.6 120 160.7 119.3 161.6C118.7 162.6 116.9 165.3 115.4 167.6C111.1 174 110 176 110.1 176.4C110.2 176.7 112.9 176.8 127.1 176.8H143.9L144.9 176C145.4 175.6 148.6 172.8 152 169.8C155.4 166.7 160.3 162.3 162.9 159.9C180.8 143.8 182.9 142.1 183.2 140.1C183.2 139.7 183.2 139.4 183.2 138.9C183.4 134.6 183 134 172 124.8C169.5 122.6 165.3 119.1 162.7 116.9C160.2 114.7 156.8 111.8 155.2 110.5C153.7 109.2 151.1 107 149.5 105.5C145.6 102 145.4 101.9 143.4 101.4C141.9 101 138 101 97.2 101C60 101 52.7 101 52.5 100.7C52.4 100.5 52.3 87.9 52.3 72.7V72.7C52.3 46.1 52.3 45.1 52.7 44.7C52.7 44.6 52.8 44.6 52.8 44.6C53.5 44 161 43.8 167.8 44.5C179.6 45.5 194.7 49.2 203.6 53.2C203.9 53.4 205 53.8 206 54.3C230.1 64.5 252.2 86.2 260.7 108C264.8 118.6 266.4 125.4 266.6 134.4C266.7 137.1 266.8 138.7 267 139.2Z";
function drawSealMark(doc, x, y, d = 44) {
  doc.save();
  doc.circle(x + d / 2, y + d / 2, d / 2).fill(PDF_THEME.seal);
  const k = (d * 0.56) / 283.5;
  doc.translate(x + d * 0.22, y + d * 0.22).scale(k).translate(-17.9, 5.1).path(SEAL_D).fill(PDF_THEME.sealInk);
  doc.restore();
}

/** Header (pages after the first) and footer (every page) — drawn last, when the page count is known. */
function drawHeadersAndFooters(doc, view, ctx) {
  const { fonts, muted, width } = ctx;
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + total; i += 1) {
    doc.switchToPage(i);
    const m = doc.page.margins;
    const saved = { top: m.top, bottom: m.bottom };
    m.top = 0; m.bottom = 0;           // writing in the margin must not make pdfkit add a page
    const x0 = m.left;
    if (i > 0 && view.chrome.headerText) doc.font(fonts.regular).fontSize(8).fillColor(muted).text(view.chrome.headerText, x0, Math.max(saved.top / 2 - 4, 14), { width, lineBreak: false });
    if (view.chrome.banner) doc.font(fonts.bold).fontSize(8).fillColor(muted).text(view.chrome.banner, x0, doc.page.height - saved.bottom / 2 - 18, { width, lineBreak: false });
    const y = doc.page.height - Math.max(saved.bottom / 2, 22) + 2;
    const left = [view.chrome.showDocumentId ? `Document ID ${view.chrome.documentIdText}` : null, view.chrome.footerText, view.chrome.poweredBy].filter(Boolean).join("  ·  ");
    if (left) doc.font(fonts.regular).fontSize(8).fillColor(muted).text(left, x0, y, { width: width - 90, lineBreak: false });
    if (view.chrome.pageNumbers) doc.font(fonts.regular).fontSize(8).fillColor(muted).text(`Page ${(ctx.pageOffset ?? 0) + i - range.start + 1} of ${(ctx.pageOffset ?? 0) + total}`, x0 + width - 90, y, { width: 90, align: "right", lineBreak: false });
    m.top = saved.top; m.bottom = saved.bottom;
  }
}

function drawFrozen(doc, frozen, ctx) {
  if (!frozen) return;
  const { fonts, theme, ink, muted, width } = ctx;
  const x0 = doc.page.margins.left;
  if (frozen.terms || frozen.price) {
    doc.font(fonts.bold).fontSize(11).fillColor(theme.accent).text("Terms and price, as frozen at execution", x0, doc.y, { width });
    if (frozen.terms) doc.font(fonts.regular).fontSize(theme.bodySize).fillColor(ink).text(String(frozen.terms), x0, doc.y, { width });
    if (frozen.price) {
      const amount = typeof frozen.price.amount_minor === "number" ? (frozen.price.amount_minor / 100).toFixed(2) : "—";
      doc.font(fonts.regular).fontSize(theme.bodySize).fillColor(ink).text(`${amount} ${frozen.price.currency ?? ""}`.trim() + (frozen.price.effective_from ? `  ·  in force from ${String(new Date(frozen.price.effective_from).toISOString()).slice(0, 10)}` : ""), x0, doc.y, { width });
    }
    doc.moveDown(0.8);
  }
  const d = frozen.disclosure;
  if (d) {
    doc.font(fonts.bold).fontSize(11).fillColor(theme.accent).text("Electronic records disclosure", x0, doc.y, { width });
    doc.font(fonts.regular).fontSize(9).fillColor(muted).text(`Status at execution: ${d.status}` + (d.version ? `  ·  version ${d.version}` : "") + (d.accepted_at ? `  ·  accepted ${String(d.accepted_at).slice(0, 19)}` : ""), x0, doc.y, { width });
    doc.fillColor(ink).moveDown(0.8);
  }
}

/** Draw a view to PDF bytes (UNSEALED). `withCertificate` false leaves the certificate pages off (that pass is what the fingerprint is taken from). */
async function drawView(view, { executedAt = null, logoBytes = null, withCertificate = true } = {}) {
  const theme = view.theme;
  const date = executedAt ? new Date(executedAt) : undefined;
  const doc = new PDFDocument({
    size: "A4", margins: { top: theme.margin, bottom: theme.margin, left: theme.margin, right: theme.margin }, bufferPages: true, compress: false,
    // ★ DETERMINISM: pdfkit stamps both dates from the clock unless pinned. Previews have no instrument date, so they keep pdfkit's default.
    info: { Title: view.title, Producer: "Keystone", Creator: "Keystone", ...(date ? { CreationDate: date, ModDate: date } : {}) },
  });
  installFontFallback(doc);   // R3-2: any name or answer in any script is drawn in a font that has it, never as garbage
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on("end", resolve); doc.on("error", reject); });
  const fonts = registerFonts(doc, theme.font);
  const width = doc.page.width - theme.margin * 2;
  const ctx = { fonts, theme, ink: PDF_THEME.ink, muted: PDF_THEME.muted, faint: PDF_THEME.faint, width, logoBytes };

  drawLetterhead(doc, view, ctx);
  doc.font(fonts.bold).fontSize(18).fillColor(ctx.ink).text(view.title, doc.page.margins.left, doc.y, { width });
  doc.moveDown(0.3);
  if (view.chrome.executedLine) doc.font(fonts.regular).fontSize(9).fillColor(ctx.muted).text(view.chrome.executedLine, { width });
  if (view.mode === "signed") doc.font(fonts.regular).fontSize(9).fillColor(ctx.muted).text("This is a frozen copy of the instrument as executed. Its price, terms and disclosure are as they were at that moment and do not change.", { width });
  if (view.chrome.note) doc.font(fonts.regular).fontSize(9).fillColor(ctx.muted).text(view.chrome.note, { width });
  doc.fillColor(ctx.ink).moveDown(1);
  drawFrozen(doc, view.frozen, ctx);

  view.documents.forEach((d, i) => {
    if (view.documents.length > 1) {
      if (i > 0) doc.addPage();
      doc.font(fonts.bold).fontSize(14).fillColor(theme.accent).text(`Document ${i + 1} of ${view.documents.length} — ${d.title}`, doc.page.margins.left, doc.y, { width });
      doc.fillColor(ctx.ink).moveDown(0.6);
    }
    drawNodes(doc, d.nodes, ctx);
  });
  if (view.closingLine) { doc.moveDown(0.4); doc.font(fonts.italic).fontSize(theme.bodySize).fillColor(ctx.muted).text(view.closingLine, doc.page.margins.left, doc.y, { width }); doc.fillColor(ctx.ink); }
  if (withCertificate && view.certificate) await drawCertificate(doc, view.certificate, ctx);

  drawHeadersAndFooters(doc, view, ctx);
  const pages = doc.bufferedPageRange().count;
  doc.end();
  await done;
  return { bytes: Buffer.concat(chunks), pages };
}

// ── the public functions ──────────────────────────────────────────────────────────────────────

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

async function seal(bytes, { title, executedAt, productName = "Docustay" }) {
  bytes = await prepareForSeal(bytes);
  const asciiProduct = String(productName ?? "").replace(/[^\x20-\x7E]/g, "").replace(/[()\\]/g, "").trim() || "Docustay";
  // ★ D4 — add the signature placeholder to the finished bytes, sign them, then request an independent trusted timestamp for the signed buffer.
  const withPlaceholder = plainAddPlaceholder({ pdfBuffer: bytes, reason: `Electronically signed via ${asciiProduct}`, name: `${asciiProduct} seal`, location: asciiProduct, contactInfo: asciiProduct });   // ASCII only: the placeholder writes the string as UTF-8 bytes, which a viewer reads as mojibake for any non-Latin title (Round 3 T-8); the real title stays in the document's own Info/Title
  const signer = new P12Signer(signingCertP12(), { passphrase: signingCertPassphrase() });
  let sealed = await signpdf.sign(withPlaceholder, signer, new Date(executedAt));
  let timestamped = true;
  try {
    const stamped = await timestampPdf({ pdf: sealed, tsa: { url: tsaUrl() }, omitModificationTime: false });
    sealed = stamped.pdf;
  } catch (err) {
    // A TSA outage must not block signing — the document is still validly SIGNED (the PKCS#7 seal), only without an independent timestamp. Logged, never thrown.
    timestamped = false;
    console.error(`document TSA timestamp failed (${tsaUrl()}): ${err.message} — sealed without a timestamp`);
  }
  const out = Buffer.from(sealed); out.timestamped = timestamped;   // carried on the buffer so every caller keeps its shape; the archive records it
  return out;   // signpdf / pdf-rfc3161 hand back a plain Uint8Array; callers are written against Buffer
}

/** B-3 (Run 6): add the independent trusted timestamp to a sealed copy that was sealed without one (the timestamp service did not answer). An incremental update after the seal, exactly what `seal` does inline; returns the new bytes, or null when the service still does not answer. */
export async function addTrustedTimestamp(sealedBytes) {
  try {
    const stamped = await timestampPdf({ pdf: sealedBytes, tsa: { url: tsaUrl() }, omitModificationTime: false });
    return Buffer.from(stamped.pdf);
  } catch (err) {
    console.error(`document TSA timestamp (re-stamp) failed (${tsaUrl()}): ${err.message}`);
    return null;
  }
}

/**
 * ★★★ RENDER AN EXECUTED INSTRUMENT TO SEALED PDF BYTES.
 * @param {object} instrument
 * @param {object} instrument.snapshot     the FROZEN `template_snapshot` — validated, not trusted
 * @param {string} instrument.title
 * @param {string} instrument.executedAt   ISO timestamp STRING — also the PDF's CreationDate, for determinism
 * @param {Array}  instrument.signatures   {role, signerName, signedAt, signedLocalDate, signerTimezone, markImage, markSha256, signerEmail, signerIp}
 * @param {object} [instrument.settings]   the island settings (defaults fill any gap)
 * @param {object} [instrument.brand]      {practiceName, logoUrl}   · logoBytes: the logo already fetched (the caller owns network access)
 * @param {string} [instrument.zone]       the practice's timezone
 * @param {string} [instrument.documentId] shown on every page
 * @param {object} [instrument.certificate] facts for the Certificate of Completion (see documentView.certificateView)
 * @param {Array}  [instrument.documents]  a package: several {title, builder, body, values}; default is the snapshot's own single document
 * @returns {Promise<{bytes: Buffer, sha256: string, pages: number, contentSha256: string}>}
 */
export async function renderExecutedPdf({ snapshot, title, executedAt, signatures = [], values = {}, settings = {}, brand = {}, logoBytes = null, zone = "UTC", documentId = null, certificate = null, verifyUrl = null, documents = null, originalSha256 = null, language = "en" }) {
  // ★★ THE SNAPSHOT IS VALIDATED BEFORE A SINGLE BYTE IS DRAWN — the same validator `executeInstance` runs.
  let parsed;
  try { parsed = parseTemplateSnapshot(snapshot); } catch (e) {
    throw new PdfInputError(`refusing to render a PDF from an invalid snapshot: ${e.message} ★ A PDF is handed to somebody; a malformed one is discovered by them, not by us.`);
  }
  // ★★★ THE MESSAGE NAMES THE **TYPE** — a Date stringifies to the very ISO text this check asks for, and the old message cost six worker retries.
  if (typeof executedAt !== "string" || Number.isNaN(Date.parse(executedAt))) {
    const got = executedAt instanceof Date ? `a Date object (which stringifies to ${JSON.stringify(executedAt)} — LOOK AT THE TYPE, not the text; call .toISOString())` : `${typeof executedAt} ${JSON.stringify(executedAt)}`;
    throw new PdfInputError(`executedAt must be an ISO timestamp STRING — got ${got}. ★ It is also the PDF's CreationDate, which is what makes two renders of one instrument byte-identical.`);
  }
  if (typeof title !== "string" || title.trim() === "") throw new PdfInputError("an executed instrument must have a title to put on its first page");
  if (!Array.isArray(signatures) || signatures.length === 0) {
    throw new PdfInputError("refusing to render an executed instrument with NO signature records. ★ A PDF with a signature section and nothing in it reads as a binding agreement that nobody signed.");
  }
  if (!documents && (snapshot.template === null || snapshot.template === undefined)) {
    throw new PdfInputError("refusing to render a PDF from a snapshot whose frozen `template` is null. ★ The result would be a titled page with signatures and NO TERMS — indistinguishable from a real agreement to anyone holding it.");
  }

  const docs = documents ?? [{ title, builder: parsed.builder, body: parsed.template ?? {}, values: parsed.builder === "form" ? values : (parsed.template?.values ?? {}) }];
  const base = { mode: "signed", documents: docs, title, documentId, language, signatures, settings, brand, zone, executedAt, verifyUrl, frozen: { terms: parsed.terms, price: parsed.price, disclosure: parsed.disclosure } };

  // pass 1 — the signed document WITHOUT the certificate: its hash is the content fingerprint printed on the certificate
  const contentPass = await drawView(buildDocumentView({ ...base, certificate: null }), { executedAt, logoBytes, withCertificate: false });
  const contentSha256 = sha256(contentPass.bytes);
  // pass 2 — the same document, plus the certificate when the practice has it on
  const finalView = buildDocumentView({ ...base, certificate: certificate ? { ...certificate, contentSha256, originalSha256: certificate.originalSha256 ?? originalSha256 } : null });
  const final = finalView.certificate ? await drawView(finalView, { executedAt, logoBytes, withCertificate: true }) : contentPass;

  const bytes = await seal(final.bytes, { title, executedAt, productName: brand?.productName });
  return { bytes, sha256: sha256(bytes), pages: final.pages, contentSha256 };
}

/** Draw ONLY the Certificate of Completion (for an uploaded document, whose own pages are the flattened original). Unsealed bytes. */
async function drawCertificateOnly(view, { executedAt = null, logoBytes = null, pageOffset = 0 } = {}) {   // pageOffset: the pages in front of the certificate in the same file, so its footers read "Page 8 of 9" and not nothing (Run 6)
  const theme = view.theme;
  const date = executedAt ? new Date(executedAt) : undefined;
  const doc = new PDFDocument({
    size: "A4", autoFirstPage: false, margins: { top: theme.margin, bottom: theme.margin, left: theme.margin, right: theme.margin }, bufferPages: true, compress: false,
    info: { Title: view.title, Producer: "Keystone", Creator: "Keystone", ...(date ? { CreationDate: date, ModDate: date } : {}) },
  });
  installFontFallback(doc);   // R3-2: any name or answer in any script is drawn in a font that has it, never as garbage
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on("end", resolve); doc.on("error", reject); });
  const fonts = registerFonts(doc, theme.font);
  const width = 595.28 - theme.margin * 2;
  const ctx = { fonts, theme, ink: PDF_THEME.ink, muted: PDF_THEME.muted, faint: PDF_THEME.faint, width, logoBytes, letterhead: view.chrome?.letterhead ?? null, pageOffset };
  await drawCertificate(doc, view.certificate, ctx);
  drawHeadersAndFooters(doc, { ...view, chrome: { ...view.chrome, banner: null, headerText: "" } }, ctx);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/**
 * ★ QUEUE §23.4.8 — AN UPLOADED DOCUMENT, EXECUTED: the flattened original pages of each document, then ONE certificate (for the whole send), sealed. `documents` are {title, pageCount, bytes} where `bytes` is the
 * already-flattened PDF of that document. `includeDocuments` picks which documents' pages go into THIS file (a package's members each get their own sealed file; the certificate rides with the lead).
 * @returns {Promise<{bytes:Buffer, sha256:string, pages:number, contentSha256:string}>}
 */
export async function renderExecutedFlattenedPdf({ title, executedAt, documents, includeIndexes = null, withCertificate = true, separateCertificate = false, signatures, settings = {}, brand = {}, logoBytes = null, zone = "UTC", documentId = null, certificate = null, verifyUrl = null, originalSha256 = null, disclosure = null, language = "en" }) {
  if (typeof executedAt !== "string" || Number.isNaN(Date.parse(executedAt))) throw new PdfInputError("executedAt must be an ISO timestamp STRING");
  if (!Array.isArray(signatures) || signatures.length === 0) throw new PdfInputError("refusing to render an executed document with NO signature records");
  const pick = (includeIndexes ?? documents.map((_, i) => i)).map((i) => documents[i]);
  const [first, ...rest] = pick.map((d) => d.bytes);
  const content = rest.length ? await appendPdfs(first, rest) : first;
  const contentSha256 = sha256(content);
  let finalBytes = content, certificateBytes = null;
  if (withCertificate && certificate) {
    const view = buildDocumentView({
      mode: "signed", title, documentId, signatures, settings, brand, zone, executedAt, verifyUrl, language,
      documents: documents.map((d) => ({ title: d.title, builder: "pdf_pages", pageCount: d.pageCount, fields: [] })),
      frozen: { terms: null, price: null, disclosure },
      certificate: { ...certificate, contentSha256, originalSha256: certificate.originalSha256 ?? originalSha256 },
    });
    if (view.certificate) {
      const { PDFDocument: PL } = await import("@cantoo/pdf-lib");
      const bodyPages = separateCertificate ? 0 : (await PL.load(content, { updateMetadata: false })).getPageCount();   // numbering carries on from the document's own pages
      const certOnly = await drawCertificateOnly(view, { executedAt, logoBytes, pageOffset: bodyPages });
      // Part 30 item 5 — `separateCertificate`: the signed PDF holds the document only, and the certificate is a second sealed PDF
      if (separateCertificate) certificateBytes = await seal(certOnly, { title: `${title} — certificate of completion`, executedAt, productName: brand?.productName });
      else finalBytes = await appendPdfs(content, [certOnly]);
    }
  }
  const bytes = await seal(finalBytes, { title, executedAt, productName: brand?.productName });
  const { PDFDocument: Lib } = await import("@cantoo/pdf-lib");
  const pages = (await Lib.load(finalBytes, { updateMetadata: false })).getPageCount();
  return { bytes, sha256: sha256(bytes), pages, contentSha256, certificateBytes, timestamped: bytes.timestamped !== false };
}

/**
 * A PDF of a live template or a SAMPLE signed copy — never signed, never sealed. `signedSample: true` draws the signed-copy layout with the caller's sample signatures and certificate
 * (the "Preview a signed copy" button); otherwise it is the template preview ("PREVIEW — NOT SIGNED").
 */
export async function renderPreviewPdf({ builder = "contract", title, body, values = {}, settings = {}, brand = {}, logoBytes = null, zone = "UTC", signedSample = false, signatures = [], certificate = null, documents = null, documentId = null, draft = false }) {
  if (typeof title !== "string" || title.trim() === "") throw new PdfInputError("a preview needs a title to put on its first page");
  const docs = documents ?? [{ title, builder, body, values }];
  const view = signedSample
    ? buildDocumentView({ mode: "signed", documents: docs, title, documentId: documentId ?? "SAMPLE-0000", signatures, settings, brand, zone, executedAt: "2026-01-15T17:30:00.000Z", certificate, verifyUrl: "https://example.com/verify/SAMPLE", sample: true, frozen: null })
    : buildDocumentView({ mode: "template_preview", documents: docs, title, settings, brand, zone });
  // draft: the page a sender will place fields on — no PREVIEW banner or note (it is the real document, just not yet signed)
  if (draft && !signedSample) view.chrome = { ...view.chrome, banner: null, note: null, showDocumentId: false };
  const out = await drawView(view, { executedAt: signedSample ? "2026-01-15T17:30:00.000Z" : null, logoBytes, withCertificate: !draft });
  return { bytes: out.bytes };
}
