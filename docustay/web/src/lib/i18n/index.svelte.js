// The signed-in app's translations: t("English sentence", { values }) looks the sentence up in the current language's catalogue and formats it. English is the key, so a missing translation shows English, never a blank.
// The language is chosen from ?lang=, then the saved choice, then the browser's language; it lives in `i18n.lang` (a rune, so every screen redraws when it changes). Catalogues load on demand, one small JSON per language.
import { format } from "./format.js";
import { SITE_LANGS, RTL } from "$lib/site/l10n-langs.js";
export const APP_LANGS = SITE_LANGS;
export const i18n = $state({ lang: "en", ready: true, catalogue: {} });
const loaders = import.meta.glob("../../../i18n/locales/*.json", { import: "default" });
const KEY = "docustay-lang";
const tag = (l) => (l === "zh" ? "zh-Hans" : l === "pt" ? "pt-BR" : l);
/** The text for a sentence in the current language, with {values} filled in. */
export function t(en, vars) { const s = (i18n.lang !== "en" && i18n.catalogue[en]) || en; return vars === undefined && !s.includes("{") ? s : format(s, vars, tag(i18n.lang)); }
/** Like t(), for English that comes from the server (the settings schema's labels and help): the sentence is collected from the schema by scripts/i18n-extract.mjs, not found in code. Unknown text shows as it is. */
// D-030: the settings pickers build labels like "3 days" or "100 MB" from numbers, so no catalogue can hold each one: they are rebuilt from one plural sentence per unit (literal t() calls, so the extractor collects them).
const COUNTED = [
  [/^(\d+) days?$/, (n) => t("{n, plural, one {# day} other {# days}}", { n })],
  [/^(\d+) months$/, (n) => t("{n, plural, one {# month} other {# months}}", { n })],
  [/^(\d+) years$/, (n) => t("{n, plural, one {# year} other {# years}}", { n })],
  [/^(\d+) drafts?$/, (n) => t("{n, plural, one {# draft} other {# drafts}}", { n })],
  [/^(\d+) MB$/, (n) => t("{n} MB", { n })],
  [/^(\d+) pt$/, (n) => t("{n} pt", { n })],
];
export const td = (en) => {
  if (en == null) return "";
  const k = String(en), hit = i18n.lang !== "en" ? i18n.catalogue[k] : null;
  if (hit) return format(hit, undefined, tag(i18n.lang));
  if (i18n.lang !== "en") for (const [re, make] of COUNTED) { const m = re.exec(k); if (m) return make(Number(m[1])); }
  return k;
};
/** D-042: a date and time in the chosen language (never the browser's, which headless and many installs report as en-US). */
export function whenText(v, opts = { dateStyle: "medium", timeStyle: "short" }) { if (!v) return ""; const d = new Date(v); if (Number.isNaN(d.getTime())) return ""; try { return d.toLocaleString(tag(i18n.lang), opts); } catch { return d.toLocaleString(); } }
/** D-042: "Chrome on macOS" written in the chosen language from the parts the server sends. */
export async function setLang(l, { save = true } = {}) {
  if (!APP_LANGS.includes(l)) l = "en";
  if (l !== "en") { const load = loaders[`../../../i18n/locales/${l}.json`]; i18n.catalogue = load ? await load() : {}; } else i18n.catalogue = {};
  i18n.lang = l;
  if (typeof document !== "undefined") { document.documentElement.lang = tag(l); document.documentElement.dir = RTL.includes(l) ? "rtl" : "ltr"; }
  if (save) { try { localStorage.setItem(KEY, l); } catch { /* storage may be blocked: the choice lasts for this visit */ } }
}
/** The first browser language the app speaks (the same rule as the signing page's pickLanguage): pt-PT is Portuguese, Traditional Chinese is skipped rather than shown in Simplified, three-letter languages are not ours. */
export function detectLang(tags) {
  for (const raw of tags ?? []) {
    const tg = String(raw ?? "").trim();
    if (!/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(tg) || /^zh[-_](hant|tw|hk|mo)/i.test(tg) || /^[A-Za-z]{3}/.test(tg)) continue;
    const base = tg.slice(0, 2).toLowerCase(); if (APP_LANGS.includes(base)) return base;
  }
  return "en";
}
/** Pick the starting language: ?lang=, then the saved one, then the browser's. Call once when the app shell mounts. */
export async function startLang() {
  let l = null;
  try { l = new URLSearchParams(location.search).get("lang") || localStorage.getItem(KEY); } catch { /* ignore */ }
  if (!l) l = detectLang(navigator.languages ?? [navigator.language]);
  await setLang(l, { save: false });
}
