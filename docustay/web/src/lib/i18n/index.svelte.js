// The signed-in app's words: t("English sentence", { values }) formats the sentence (plurals, numbers, {values}). Docustay v1 is English only, so there is no catalogue to look anything up in and no language to choose; the wrapper stays
// so every screen keeps its t() call and a language can be added back later without rewriting a screen. The English sentence is the key, and also what is shown.
import { format } from "./format.js";
export const i18n = $state({ lang: "en", ready: true, catalogue: {} });
/** The text for a sentence, with {values} filled in. */
export function t(en, vars) { return vars === undefined && !en.includes("{") ? en : format(en, vars, "en"); }
/** Like t(), for English that comes from the server (the settings schema's labels and help). Unknown text shows as it is. */
// D-030: the settings pickers build labels like "3 days" or "100 MB" from numbers: they are rebuilt from one plural sentence per unit.
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
  const k = String(en);
  for (const [re, make] of COUNTED) { const m = re.exec(k); if (m) return make(Number(m[1])); }
  return k;
};
/** D-042: a date and time (never the browser's own language, which headless and many installs report as en-US). */
export function whenText(v, opts = { dateStyle: "medium", timeStyle: "short" }) { if (!v) return ""; const d = new Date(v); if (Number.isNaN(d.getTime())) return ""; try { return d.toLocaleString("en", opts); } catch { return d.toLocaleString(); } }
/** Kept so the app shell's start-up call stays as it was: there is nothing to choose. */
export async function startLang() { if (typeof document !== "undefined") { document.documentElement.lang = "en"; document.documentElement.dir = "ltr"; } }
