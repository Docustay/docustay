// The three embed modules served at /embed/*.js are copies of sdk/embed/src; this fails the build when they drift apart.
import { readFileSync } from "node:fs";
const bad = ["index", "builder", "scribe"].filter((f) => readFileSync(new URL(`../src/lib/embed/${f}.js`, import.meta.url), "utf8") !== readFileSync(new URL(`../../../sdk/embed/src/${f}.js`, import.meta.url), "utf8"));
if (bad.length) { console.error(`embed copies differ from sdk/embed/src: ${bad.join(", ")} — copy them over`); process.exit(1); }
console.log("embed assets match sdk/embed/src");
