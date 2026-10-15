// Regenerates shell-modules.json: the modules the signed-in app loads on EVERY screen (the intersection across several screens), read from the source maps of a real build.
// usage: 1) SHELL_MODULES_REGEN=1 npx vite build --sourcemap   (grouping off, so the maps show what each screen really imports)   2) serve build/ (node build/index.js)   3) COOKIE='<a signed-in session cookie header>' BASE=http://localhost:13000 node scripts/shell-modules.mjs
// (a local test account's cookie works). The maps are not shipped: run the build again without --sourcemap afterwards.
import fs from "node:fs"; import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:13000", COOKIE = process.env.COOKIE ?? "";
const PAGES = ["/documents", "/templates", "/settings", "/forms", "/plays", "/reports"];
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies(COOKIE.split("; ").filter(Boolean).map((c) => ({ name: c.split("=")[0], value: c.slice(c.indexOf("=") + 1), url: BASE })));
const sets = [];
for (const path of PAGES) {
  const p = await ctx.newPage(), urls = []; p.on("response", (r) => { if (/javascript/.test(r.headers()["content-type"] ?? "")) urls.push(new URL(r.url()).pathname); });
  await p.goto(BASE + path, { waitUntil: "networkidle" }); await p.waitForTimeout(400); await p.close();
  const mods = new Set(); for (const u of urls) { try { const m = JSON.parse(fs.readFileSync("build/client" + u + ".map", "utf8")); for (const s of m.sources) { const k = s.replace(/^(\.\.\/)+/, "").replace(/^.*docustay\/web\//, ""); if (/^(node_modules\/|src\/)/.test(k) && !k.endsWith(".json")) mods.add(k); } } catch {} }
  sets.push(mods);
}
await b.close(); const core = [...sets[0]].filter((m) => sets.every((s) => s.has(m))).sort();
fs.writeFileSync("shell-modules.json", JSON.stringify(core, null, 0)); console.log(core.length, "modules common to", PAGES.length, "screens -> shell-modules.json");
