// src/documents/textFonts.mjs — WHICH FONT DRAWS WHICH CHARACTER (Round 3, R3-2). A signed copy and its certificate carry people's names and typed answers, and a name is in any script.
// The old code chose a font by the certificate's LANGUAGE (or used Helvetica, whose 8-bit encoding turns anything else into garbage or "?"), so a signer called "田中 太郎" or "Łukasz" or "Привет" was printed wrongly on the legal record.
// Here the font is chosen by the CHARACTER: the document's own font first, then a fixed stack of fallbacks (Latin Extended, Cyrillic, Greek, Devanagari, Hebrew, Arabic, Thai, Chinese/Japanese/Korean, symbols — all SIL OFL, kept in ./fonts).
// A character that NO font can draw is never printed as garbage: it is printed as the visible text [U+XXXX], so a reader can see something was not drawable and which character it was.
// Server only (reads font files). Used by pdf.mjs (pdfkit: certificate, body, signature) and pdfFlatten.mjs (pdf-lib: typed answers burned onto an uploaded document).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");

/** The fallback stack, in the order tried. `bold` is the bold file when the family has one. */
const FALLBACKS = Object.freeze([
  { id: "noto", regular: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" },                  // Latin, Latin Extended, Cyrillic, Greek, Devanagari
  { id: "hebrew", regular: "NotoSansHebrew-Regular.woff", bold: "NotoSansHebrew-Bold.woff", rtl: true },
  { id: "arabic", regular: "PlexSansArabic-Regular.ttf", bold: "PlexSansArabic-Bold.ttf", rtl: true },
  { id: "thai", regular: "NotoSansThai-Regular.woff", bold: "NotoSansThai-Bold.woff" },
  { id: "cjk", regular: "NotoSansSC-Regular.ttf", bold: null },                                  // Han shapes differ slightly between zh/ja/ko, but a name is readable in any of them
  { id: "cjk-jp", regular: "NotoSansJP-Regular.ttf", bold: null },
  { id: "cjk-kr", regular: "NotoSansKR-Regular.ttf", bold: null },                              // Hangul
  { id: "symbols", regular: "NotoSansSymbols2-Regular.woff", bold: null },                      // ✓ ★ ♥ and the like
]);

const cache = new Map();   // id -> { regular: fontkit font, bold }
function load(id, weight) {
  const fb = FALLBACKS.find((f) => f.id === id);
  const file = weight === "bold" && fb.bold ? fb.bold : fb.regular;
  const key = `${id}/${file}`;
  if (!cache.has(key)) cache.set(key, fontkit.openSync(path.join(DIR, file)));
  return cache.get(key);
}
/** The path of a fallback's font file (pdf-lib embeds from bytes, pdfkit registers from a path). */
export function fallbackFile(id, weight = "regular") {
  const fb = FALLBACKS.find((f) => f.id === id);
  return path.join(DIR, weight === "bold" && fb.bold ? fb.bold : fb.regular);
}
export const fallbackBytes = (id, weight = "regular") => fs.readFileSync(fallbackFile(id, weight));
export const isRtlFallback = (id) => !!FALLBACKS.find((f) => f.id === id)?.rtl;

import { winAnsiHas } from "./winAnsi.mjs";
export { winAnsiHas };

/** The first fallback that has a glyph for the code point, or null. A Hangul syllable goes to the Korean font, kana to the Japanese one, everything else Han to the Chinese one. */
function fallbackFor(cp) {
  const hangul = (cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x3130 && cp <= 0x318F);
  const kana = (cp >= 0x3040 && cp <= 0x30FF) || (cp >= 0x31F0 && cp <= 0x31FF);
  const order = hangul ? ["cjk-kr"] : kana ? ["cjk-jp"] : [];
  for (const id of [...order, ...FALLBACKS.map((f) => f.id)]) {
    try { if (load(id, "regular").hasGlyphForCodePoint(cp)) return id; } catch { /* an unreadable font file is skipped, never fatal */ }
  }
  return null;
}

/** Does a bidirectional/complex script run need to be kept whole (one draw call) so the font can shape it? Arabic, Hebrew, Thai, Indic. */
function isComplexScript(cp) {
  return (cp >= 0x0590 && cp <= 0x08FF) || (cp >= 0xFB1D && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF) || (cp >= 0x0900 && cp <= 0x0DFF) || (cp >= 0x0E00 && cp <= 0x0E7F);
}

const isNeutral = (cp) => cp === 0x20 || cp === 0xA0 || (cp >= 0x21 && cp <= 0x2F) || (cp >= 0x3A && cp <= 0x40) || cp === 0x2D;
const hex = (cp) => `[U+${cp.toString(16).toUpperCase().padStart(4, "0")}]`;

/**
 * Cut `text` into runs, each drawn with one font. `baseHas(cp)` says whether the document's own font can draw a code point.
 * Returns [{ text, font }] where font is "base" or a fallback id. A character nothing can draw becomes its visible [U+XXXX] text in the base font.
 * Spaces and punctuation stay in the run they sit in, so a name is not chopped into one run per word.
 */
export function splitRuns(text, baseHas) {
  const runs = [];
  const push = (t, font) => { const last = runs[runs.length - 1]; if (last && last.font === font) last.text += t; else runs.push({ text: t, font }); };
  let pending = "";   // neutrals waiting to see which font their neighbours use
  let current = null;
  for (const ch of String(text ?? "")) {
    const cp = ch.codePointAt(0);
    if (cp === 0xA || cp === 0xD || cp === 0x9) { push((pending || "") + " ", current ?? "base"); pending = ""; continue; }
    if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F) || (cp >= 0x200B && cp <= 0x200F) || (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2060 && cp <= 0x2064) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xFEFF) continue;   // control and invisible formatting characters are never drawn
    if (isNeutral(cp)) { if (current === null || (current === "base" ? baseHas(cp) : (() => { try { return load(current, "regular").hasGlyphForCodePoint(cp); } catch { return false; } })())) { push(pending + ch, current ?? "base"); pending = ""; current ??= "base"; } else pending += ch; continue; }
    let font = baseHas(cp) ? "base" : fallbackFor(cp);
    if (font === null) { push(pending, current ?? "base"); pending = ""; push(hex(cp), "base"); current = "base"; continue; }
    if (pending) { push(pending, font === "base" || font === current ? font : (current ?? font)); pending = ""; }
    push(ch, font); current = font;
  }
  if (pending) push(pending, current ?? "base");
  // a base-font run that sits next to a Noto Sans run (same Latin/Cyrillic/Greek name) is drawn in Noto Sans too, so a word is not half one font and half another
  const covers = (id, t) => { for (const c of t) { const cp = c.codePointAt(0); if (cp > 0x20 && !fallbackHas(id, cp)) return false; } return true; };
  runs.forEach((r, i) => { if (r.font === "base" && ((runs[i - 1]?.font === "noto") || (runs[i + 1]?.font === "noto")) && covers("noto", r.text)) r.font = "noto"; });
  const out = [];
  for (const r of runs) { const last = out[out.length - 1]; if (last && last.font === r.font) last.text += r.text; else out.push({ ...r }); }
  return out;
}
/** True when every character of `text` is drawable by the base font (so the fast, unchanged path can be used). */
export const allCovered = (text, baseHas) => { for (const ch of String(text ?? "")) { const cp = ch.codePointAt(0); if (cp === 0xA || cp === 0xD || cp === 0x9) continue; if (!baseHas(cp)) return false; } return true; };

/** Test seam: does fallback `id` draw this code point. */
const fallbackHas = (id, cp) => { try { return load(id, "regular").hasGlyphForCodePoint(cp); } catch { return false; } };
