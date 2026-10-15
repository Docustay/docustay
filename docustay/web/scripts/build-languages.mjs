// Part 30 item 9 — the signing page's words for the ten added languages, copied out of the island's per-language files (src/documents/lang/*.mjs) into src/lib/i18n-gen.json, because the browser app cannot import from outside its own folder.
// `--check` fails when the committed file is stale. Same pattern as build-legal.mjs and build-docs.mjs.
import fs from "node:fs";
import EN_DATA from "../../../src/documents/lang/en.mjs";
import { LANGUAGES, LANG_META, TRANSLATED_LANGUAGES, DATA } from "../../../src/documents/languages.mjs";
const out = { languages: LANGUAGES, meta: LANG_META, en: { sp: EN_DATA.web.sp, err: EN_DATA.web.err }, web: Object.fromEntries(TRANSLATED_LANGUAGES.map((l) => [l, DATA[l].web])) };
const file = new URL("../src/lib/i18n-gen.json", import.meta.url);
const text = JSON.stringify(out, null, 1) + "\n";
if (process.argv.includes("--check")) { const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; if (cur !== text) { console.error("i18n-gen.json is stale — run: node scripts/build-languages.mjs"); process.exit(1); } console.log("languages are current"); }
else { fs.writeFileSync(file, text); console.log("i18n-gen.json written"); }
