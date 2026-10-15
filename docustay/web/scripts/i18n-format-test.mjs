// Tests for the ICU formatter the app uses for translations (plain text, arguments, plural in English, Russian and Arabic, select, exact matches, a malformed message). `node scripts/i18n-format-test.mjs` — exits 1 on any failure.
import { format, inspect } from "../src/lib/i18n/format.js";
let failed = 0;
const eq = (a, b, n) => (a === b || (failed += 1), console.log(a === b ? "ok  " : "FAIL", n, a === b ? "" : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));
eq(format("Hello", {}), "Hello", "plain");
eq(format("Hi {name}!", { name: "Rosa" }), "Hi Rosa!", "arg");
const P = "{n, plural, one {# document} other {# documents}}";
eq(format(P, { n: 1 }), "1 document", "plural one"); eq(format(P, { n: 5 }), "5 documents", "plural other"); eq(format(P, { n: 1200 }, "en"), "1,200 documents", "pound formats number");
const RU = "{n, plural, one {# документ} few {# документа} many {# документов} other {# документа}}";
eq(format(RU, { n: 1 }, "ru"), "1 документ", "ru one"); eq(format(RU, { n: 3 }, "ru"), "3 документа", "ru few"); eq(format(RU, { n: 5 }, "ru"), "5 документов", "ru many");
const AR = "{n, plural, zero {لا مستندات} one {مستند واحد} two {مستندان} few {# مستندات} many {# مستندًا} other {# مستند}}";
eq(format(AR, { n: 2 }, "ar"), "مستندان", "ar two"); eq(format(AR, { n: 0 }, "ar"), "لا مستندات", "ar zero"); eq(format(AR, { n: 11 }, "ar"), "11 مستندًا", "ar many");
eq(format("{who, select, a {Alice} other {someone}} signs", { who: "a" }), "Alice signs", "select"); eq(format("{who, select, a {Alice} other {someone}} signs", { who: "z" }), "someone signs", "select other");
eq(format("It''s {n, plural, =0 {none} one {one} other {many}}", { n: 0 }), "It's none", "exact =0 and doubled quote");
eq(format("broken {oops", {}), "broken {oops", "malformed returns the source");
eq(JSON.stringify(inspect(P)), JSON.stringify({ names: ["n"], options: { n: { kind: "plural", keys: ["one", "other"] } } }), "inspect");
process.exit(failed ? 1 : 0);
