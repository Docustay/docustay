// src/documents/pdfTextFallback.mjs — make every text call on a pdfkit document draw each character in a font that HAS it (Round 3, R3-2). See textFonts.mjs for why.
// `installFontFallback(doc)` wraps `doc.text` once. A call whose text the current font can draw completely goes straight through, unchanged. A call with anything the font cannot draw is cut into runs; each run is drawn in the right font as one continued chain,
// and the document's own font is selected again afterwards, so the caller never notices. Right-to-left runs (Arabic, Hebrew) are laid out right to left.
import { allCovered, fallbackFile, isRtlFallback, splitRuns, winAnsiHas } from "./textFonts.mjs";

const baseCoverage = (doc) => {
  const f = doc._font?.font;
  if (f && typeof f.hasGlyphForCodePoint === "function") return (cp) => { try { return f.hasGlyphForCodePoint(cp); } catch { return false; } };   // an embedded font (Inter, Noto, Plex, Dancing Script)
  return winAnsiHas;                                                                                                                              // a PDF standard font (Helvetica, Times)
};

export function installFontFallback(doc) {
  if (doc.__fontFallback) return doc;
  doc.__fontFallback = true;
  const original = doc.text;
  const originalFont = doc.font;
  doc.font = function (src, ...rest) { if (typeof src === "string") this.__family = src; return originalFont.call(this, src, ...rest); };   // remember which font the caller chose, to select it again after a mixed run
  const registered = new Set();
  const nameFor = (id, bold) => {
    const name = `FB-${id}-${bold ? "b" : "r"}`;
    if (!registered.has(name)) { doc.registerFont(name, fallbackFile(id, bold ? "bold" : "regular")); registered.add(name); }
    return name;
  };
  doc.text = function (t, ...args) {
    const text = t == null ? "" : String(t);
    const has = baseCoverage(this);
    if (allCovered(text, has)) return original.call(this, t, ...args);
    let pos = [], opts;
    if (args.length && typeof args[0] === "object" && args[0] !== null) opts = { ...args[0] };
    else { pos = args.slice(0, 2); opts = { ...(args[2] ?? {}) }; }
    const family = this.__family ?? this._fontFamily ?? "Helvetica", bold = /bold/i.test(String(family ?? ""));
    const runs = splitRuns(text, has);
    const closing = !!opts.continued;
    const keep = {}; for (const k of ["link", "underline", "strike", "oblique", "align", "characterSpacing", "wordSpacing"]) if (k in opts) keep[k] = opts[k];
    runs.forEach((r, i) => {
      const last = i === runs.length - 1;
      if (r.font === "base") this.font(family); else this.font(nameFor(r.font, bold));
      const o = i === 0 ? { ...opts } : { ...keep };
      o.continued = last ? closing : true;
      if (r.font !== "base" && isRtlFallback(r.font)) o.features = [...(o.features ?? []), "rtla"];
      if (i === 0) original.call(this, r.text, ...pos, o); else original.call(this, r.text, o);
    });
    this.font(family);
    return this;
  };
  return doc;
}

/** The width a text would take at the document's current font and size, counting each run in the font that will draw it (doc.widthOfString only knows the current font). */
function mixedWidth(doc, text) {
  const has = baseCoverage(doc);
  const family = doc.__family ?? doc._fontFamily ?? "Helvetica", bold = /bold/i.test(String(family));
  const size = doc._fontSize;
  let w = 0;
  for (const r of splitRuns(String(text ?? ""), has)) {
    if (r.font === "base") doc.font(family); else { const name = `FB-${r.font}-${bold ? "b" : "r"}`; if (!doc._fontFamilies?.[name] && !doc._registeredFonts?.[name]) doc.registerFont(name, fallbackFile(r.font, bold ? "bold" : "regular")); doc.font(name); }
    w += doc.fontSize(size).widthOfString(r.text);
  }
  doc.font(family).fontSize(size);
  return w;
}

/** Shrink `size` until the text fits `maxWidth` on one line; below `minSize` cut the text with an ellipsis. Returns { text, size }. */
export function fitOneLine(doc, text, maxWidth, size, minSize = 9) {
  let sz = size, t = String(text ?? "");
  doc.fontSize(sz);
  while (sz > minSize && mixedWidth(doc.fontSize(sz), t) > maxWidth) sz -= 1;
  if (mixedWidth(doc.fontSize(sz), t) > maxWidth) { const chars = Array.from(t); while (chars.length > 1) { chars.pop(); const cand = chars.join("").trimEnd() + "…"; if (mixedWidth(doc.fontSize(sz), cand) <= maxWidth) { t = cand; break; } } }
  return { text: t, size: sz };
}
