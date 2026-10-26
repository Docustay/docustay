// DOES IT LOAD — the per-task check for a builder (REACT-PLAN §9): syntax-only, no network, <1s per file.
// usage: npm run check-file -- src/lib/foo/Bar.jsx [more files]
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
let bad = 0;
for (const f of process.argv.slice(2)) {
  try { await transform(readFileSync(f, "utf8"), { loader: f.endsWith(".jsx") ? "jsx" : "js", jsx: "automatic", format: "esm", logLevel: "silent" }); console.log("ok  ", f); }
  catch (e) { bad++; console.log("FAIL", f, "\n  ", e.errors?.map((x) => `${x.location?.line}:${x.location?.column} ${x.text}`).join("\n   ") ?? e.message); }
}
process.exit(bad ? 1 : 0);
