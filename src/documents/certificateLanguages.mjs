// The fixed wording of the Certificate of Completion in en, es, fr, de (QUEUE §23.5.6). Pure data, no imports.
// ★ MACHINE-WRITTEN Spanish, French and German — a native speaker should review them (recorded on the board). The organisation's own statement is never translated.
const W = {
  en: { title: "Certificate of Completion", document: "Document", documentId: "Document ID", status: "Status", completedState: "Completed", completed: "Completed", sentBy: "Sent by", package: "Documents in this package",
    sent: "Sent", viewed: "Viewed", agreed: "Agreed to sign electronically", wording: "wording version", signed: "Signed", ip: "IP address", device: "Device",
    fingerprint: "Fingerprint", contentFp: "Content fingerprint (SHA-256)", originalFp: "Original file (SHA-256)", fingerprintNote: "The fingerprint is taken from the signed document without this certificate page; the digital seal below covers the whole file.",
    timeline: "Timeline", seal: "The document was sealed with a digital signature when the last party signed, so any later change to it can be detected. Check it at the verification address below.", verify: "Verify this document",
    kinds: { sent: "Sent", opened: "Opened", link_clicked: "Link opened", verified: "Email verified", consented: "Agreed to sign electronically", signed: "Signed", declined: "Declined", executed: "Completed" } },
};
import { CERT } from "./languages.mjs";
import EN_FILE from "./lang/en.mjs";
// Run 9 (found by the 3.3 build check: the certificate printed "hidden_by_rule"): the English table above is the long-standing wording and wins; any word it lacks comes from the English
// language file (the translation pipeline's source), and every language falls back word by word to English — a certificate never prints a code.
const fill = (base, extra) => { const out = { ...(extra ?? {}), ...base }; for (const [k, v] of Object.entries(extra ?? {})) if (v && typeof v === "object" && base?.[k] && typeof base[k] === "object") out[k] = fill(base[k], v); return out; };
W.en = fill(W.en, EN_FILE.cert);
// Arabic is written without its optional vowel marks (fatha, damma, kasra, shadda, sukun, tanween, dagger alif): the certificate's Arabic wording drops them. A mark is a separate zero-width glyph in the PDF and PDFium (Chrome's viewer) sorts it away from its
// letter, so a marked word cannot be copied out whole (Part 31 item 7, measured). Names and other text a person typed are never touched; this only reads the fixed wording below.
const MARKS = /[\u064b-\u0652\u0670\u0640]/g;
const stripMarks = (v) => (typeof v === "string" ? v.replace(MARKS, "") : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripMarks(x)])) : v);
const AR = stripMarks(CERT.ar);
const BY_LANG = new Map();
export const certWords = (lang) => {
  if (!BY_LANG.has(lang)) BY_LANG.set(lang, lang === "en" || !(W[lang] || CERT[lang]) ? W.en : fill(lang === "ar" ? AR : W[lang] ?? CERT[lang], W.en));
  return BY_LANG.get(lang);
};
