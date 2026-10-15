// PDF FIELD DETECTION · KNOWN FORMS (Run 7 part 4). A library of field maps for widely used public blank forms, recognised by FINGERPRINT — no AI, no guessing.
// A page's fingerprint is a MinHash of the three-word phrases printed on it (64 numbers; the words themselves are not stored and cannot be read back). An upload whose every page matches
// one library form closely is given that form's own field map (the author's boxes, read from the official fillable file by scripts/detect/build-known.mjs); anything else goes to the
// ordinary detector unchanged. A different revision of a form prints different words, so it does not match — it is detected the ordinary way rather than given the wrong boxes.
// Pure apart from the library file it reads once.
import fs from "node:fs";

const SEEDS = 64;
const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const mix = (h, seed) => { let x = (h ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };

/** The fingerprint of one page from its words (pageWords().words): 64 numbers, or null when the page has too few words to tell (a scan, a blank page). */
export function pageFingerprint(words) {
  const toks = words.map((w) => norm(w.str)).filter(Boolean);
  if (toks.length < 12) return null;
  const sig = new Array(SEEDS).fill(0xffffffff);
  for (let i = 0; i + 2 < toks.length; i += 1) { const h = fnv(`${toks[i]} ${toks[i + 1]} ${toks[i + 2]}`); for (let k = 0; k < SEEDS; k += 1) { const v = mix(h, k); if (v < sig[k]) sig[k] = v; } }
  return sig;
}
/** How alike two fingerprints are, 0..1 (the estimated share of three-word phrases they have in common). */
export const likeness = (a, b) => { if (!a || !b) return 0; let same = 0; for (let k = 0; k < SEEDS; k += 1) if (a[k] === b[k]) same += 1; return same / SEEDS; };

const PAGE_MATCH = 0.8, FORM_MATCH = 0.85;
let LIB = null;
/** The library: [{ id, title, publisher, revision, source, pages: [{ fp, aspect }], fields: [{ page, type, x, y, w, h, label? }] }]. */
export function knownForms() {
  if (LIB) return LIB;
  try { LIB = JSON.parse(fs.readFileSync(new URL("./known/library.json", import.meta.url), "utf8")).forms ?? []; } catch { LIB = []; }
  return LIB;
}
/**
 * Which library form these pages are, or null. `pages` = [{ fp, aspect }] for the upload's pages in order. Every page must match its counterpart (≥ PAGE_MATCH),
 * the page count and shapes must agree, and the mean must reach FORM_MATCH — so a form that merely shares boilerplate with a library one is never taken for it.
 */
export function recognise(pages, lib = knownForms(), { words: firstPageWords = null } = {}) {
  if (!pages.length || pages.some((p) => !p.fp)) return null;
  // a library form whose title names its revision ("(Rev. March 2024)", "2026 Form W-4") is only taken when that revision is printed in the file (when its words are given; a cover page may come first)
  const firstText = firstPageWords ? ` ${firstPageWords.map((w) => norm(w.str)).filter(Boolean).join(" ")} ` : null;
  const revisionOk = (f) => { if (!firstText) return true; const m = /\(rev\.?\s*([^)]+)\)/i.exec(f.title ?? "") ?? /^((?:19|20)\d\d)\s+form\b/i.exec(f.title ?? ""); if (!m) return true; const want = m[1].split(/\s+/).map(norm).filter(Boolean); return want.every((t) => firstText.includes(` ${t} `) || firstText.includes(t)); };
  let best = null;
  for (const f of lib) {
    if (f.pages.length !== pages.length) continue;
    if (likeness(f.pages[0].fp, pages[0].fp) < PAGE_MATCH) continue;
    const scores = f.pages.map((lp, i) => (Math.abs(lp.aspect - pages[i].aspect) < 0.02 ? likeness(lp.fp, pages[i].fp) : 0));
    if (scores.some((s) => s < PAGE_MATCH)) continue;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (mean >= FORM_MATCH && revisionOk(f) && (!best || mean > best.mean)) best = { form: f, mean };
  }
  return best ? { ...best.form, likeness: Math.round(best.mean * 100) / 100 } : null;
}
