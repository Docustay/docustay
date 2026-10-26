// src/documents/languages.mjs — THE FOURTEEN LANGUAGES (Part 30 item 9). Pure data and tiny helpers; the only imports are the per-language data files beside it (themselves pure data).
// English is the source. Spanish, French and German were written earlier; Portuguese, Italian, Dutch, Polish, Turkish, Russian, Arabic, Japanese, Chinese (Simplified) and Korean are added here. EVERY non-English language is a
// MACHINE-WRITTEN DRAFT, marked Beta wherever a person picks or sees it, until a native speaker has read it. The sender's own message and the organisation's own statements are never translated — only the fixed wording around them.
// Four surfaces speak these languages: the signing page (web), the Certificate of Completion (PDF), the signing/reminder email, and the signed-copy / access-code emails.
// A language's file holds plain strings with {0} {1} {2} placeholders (so word order can differ); `hydrate*` turns them into the same shapes the older English/Spanish/French/German tables use.
import STATUS from "./lang/status.mjs";
import es from "./lang/es.mjs"; import fr from "./lang/fr.mjs"; import de from "./lang/de.mjs"; import pt from "./lang/pt.mjs"; import it from "./lang/it.mjs"; import nl from "./lang/nl.mjs"; import pl from "./lang/pl.mjs"; import tr from "./lang/tr.mjs";
import ru from "./lang/ru.mjs"; import ar from "./lang/ar.mjs"; import ja from "./lang/ja.mjs"; import zh from "./lang/zh.mjs"; import ko from "./lang/ko.mjs";

export const LANGUAGES = Object.freeze(["en", "es", "fr", "de", "pt", "it", "nl", "pl", "tr", "ru", "ar", "ja", "zh", "ko"]);
/** name in the language itself · reading direction · Beta (machine-written, unreviewed) · which certificate font family draws it */
const RAW_META = {
  en: { name: "English", dir: "ltr", beta: false, font: "inter" }, es: { name: "Español", dir: "ltr", beta: true, font: "inter" }, fr: { name: "Français", dir: "ltr", beta: true, font: "inter" }, de: { name: "Deutsch", dir: "ltr", beta: true, font: "inter" },
  pt: { name: "Português", dir: "ltr", beta: true, font: "noto" }, it: { name: "Italiano", dir: "ltr", beta: true, font: "noto" }, nl: { name: "Nederlands", dir: "ltr", beta: true, font: "noto" }, pl: { name: "Polski", dir: "ltr", beta: true, font: "noto" },
  tr: { name: "Türkçe", dir: "ltr", beta: true, font: "noto" }, ru: { name: "Русский", dir: "ltr", beta: true, font: "noto" }, ar: { name: "العربية", dir: "rtl", beta: true, font: "plex-arabic" },
  ja: { name: "日本語", dir: "ltr", beta: true, font: "noto-jp" }, zh: { name: "简体中文", dir: "ltr", beta: true, font: "noto-sc" }, ko: { name: "한국어", dir: "ltr", beta: true, font: "noto-kr" },
};
/** Beta on the signing page: a language is Beta until the translation pipeline reports its whole signer-facing set clean (lang/status.mjs: no critical or major finding, every deterministic check passing, reviewed, and the agreement threshold met). */
export const LANG_META = Object.freeze(Object.fromEntries(Object.entries(RAW_META).map(([l, m]) => [l, { ...m, beta: m.beta && !STATUS[l]?.signerClean }])));
/** "auto" (or nothing) on a send means: match each signer's own language. Any real language code forces that language for everyone on the document. */
const AUTO_LANGUAGE = "auto";
export const isExplicitLanguage = (v) => typeof v === "string" && v !== AUTO_LANGUAGE && LANGUAGES.includes(v);
/** The first of the person's browser languages (BCP 47 tags, most preferred first) that Docustay speaks, or null. pt-PT and es-419 are Portuguese and Spanish; Traditional Chinese (zh-TW, zh-HK, zh-Hant) is NOT Simplified, so it is skipped and the next preference is tried. */
export function pickLanguage(tags) {
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw ?? "").trim();
    if (!/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(tag)) continue;
    if (/^zh[-_](hant|tw|hk|mo)/i.test(tag)) continue;
    const base = tag.slice(0, 2).toLowerCase();
    if (tag.length > 2 && /^[A-Za-z]{3}/.test(tag)) continue;   // three-letter primary subtags (fil, yue) are not two-letter languages we speak
    if (LANGUAGES.includes(base)) return base;
  }
  return null;
}
/** Every language but English, each with its signing-page, certificate, email and code-email wording in src/documents/lang/<l>.mjs (plain data with {0} {1} placeholders; English, the source, is lang/en.mjs). */
export const TRANSLATED_LANGUAGES = Object.freeze(LANGUAGES.filter((l) => l !== "en"));
import en from "./lang/en.mjs";
// A sentence the quality pipeline flagged (lang/status.mjs, written by scripts/i18n/publish.mjs) reads in English until it passes: the signer sees the official text, never a doubtful translation.
const overlay = (lang, tree, source, path = "") => Object.fromEntries(Object.entries(tree).map(([k, v]) => { const id = `${path}${k}`; const e = source?.[k]; return [k, v && typeof v === "object" ? overlay(lang, v, e, `${id}.`) : (STATUS[lang]?.flagged ?? []).includes(id) && typeof e === "string" ? e : v]; }));
export const DATA = Object.freeze(Object.fromEntries(Object.entries({ es, fr, de, pt, it, nl, pl, tr, ru, ar, ja, zh, ko }).map(([l, d]) => [l, overlay(l, d, en)])));
export const isRtl = (lang) => LANG_META[lang]?.dir === "rtl";
export const languageLabel = (lang) => { const m = LANG_META[lang]; return m ? (m.beta ? `${m.name} (Beta)` : m.name) : String(lang); };

const fmt = (s, ...a) => String(s).replace(/\{(\d)\}/g, (_, i) => a[Number(i)] ?? "");

/** The signing page's words, in the same shape as the English table in docustay/web/src/lib/i18n.js. */
export function hydrateWeb(w) {
  const { needFields1, needFieldsN, assistTitleFor, ...rest } = w;
  return {
    ...rest,
    pad: { ...w.pad, use: (l) => fmt(w.pad.use, l), drawFirst: (l) => fmt(w.pad.drawFirst, l), drawHere: (l) => fmt(w.pad.drawHere, l) },
    waitingBody: (who) => fmt(w.waitingBody, who), toFill: (n) => fmt(w.toFill, n), needFields: (n) => (n === 1 ? needFields1 : fmt(needFieldsN, n)),
    assistTitle: (n) => (n ? fmt(assistTitleFor, n) : w.assistTitle), pay: (label) => fmt(w.pay, label),
  };
}
/** The signing / reminder email's frame, in the shape of src/email/signLinkLanguages.mjs. */
function hydrateEmail(e) {
  return {
    hello: (n) => (n ? fmt(e.hello, n) : e.helloAnon), reminder: e.reminder,
    sentBy: (who, org) => (who && who !== org ? fmt(e.sentBy, who, org) : fmt(e.sentByOnly ?? e.sentBy, org, org)), sentYou: (org, doc, to) => fmt(e.sentYou, org, doc, to),
    sentWith: (product) => fmt(e.sentWith ?? "Sent with {0}", product),   // Run 8: the product's own footer line, in the email's language
    verbs: Object.fromEntries(Object.entries(e.verbs).map(([k, v]) => [k, { ...v, body: (w) => fmt(v.body, w) }])),
  };
}
/** The signed-copy and access-code emails, in the shape of src/documents/signingWords.mjs. */
function hydrateWords(x) {
  return {
    signed: { heading: x.signed.heading, hello: (n) => (n ? fmt(x.signed.hello, n) : x.signed.helloAnon), subject: (doc) => fmt(x.signed.subject, doc), body: (doc, org) => fmt(x.signed.body, doc, org), bodyLink: (doc, org) => fmt(x.signed.bodyLink ?? x.signed.body, doc, org), footer: (org) => fmt(x.signed.footer, org), download: x.signed.download },
    code: { subject: (code, doc) => fmt(x.code.subject, code, doc), text: (code, doc, org, min) => fmt(x.code.text, code, doc, org, min) },
  };
}
export const CERT = Object.freeze(Object.fromEntries(TRANSLATED_LANGUAGES.map((l) => [l, DATA[l].cert])));
export const EMAIL = Object.freeze(Object.fromEntries(TRANSLATED_LANGUAGES.map((l) => [l, hydrateEmail(DATA[l].email)])));
export const WORDS = Object.freeze(Object.fromEntries(TRANSLATED_LANGUAGES.map((l) => [l, hydrateWords(DATA[l].words)])));
