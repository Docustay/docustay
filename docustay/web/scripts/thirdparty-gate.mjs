#!/usr/bin/env node
// "Nothing on this site loads from a third party" (the Sub-processors page says so). Opens every page in the sitemap in a real browser and fails if any request goes to another origin. Runs the built server itself.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), ".."); const PORT = 5197;
const srv = spawn("node", ["build/index.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", ORIGIN: `http://127.0.0.1:${PORT}` }, stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 500)); }
const paths = [...new Set([...fs.readFileSync(path.join(ROOT, "static/sitemap.xml"), "utf8").matchAll(/<loc>https:\/\/docustay\.app([^<]*)/g)].map((m) => m[1] || "/"))];
const b = await chromium.launch({ channel: "chrome" }); const ctx = await b.newContext(); const foreign = new Map(); let n = 0;
for (const p of paths) { const q = await ctx.newPage(); q.on("request", (r) => { const u = new URL(r.url()); if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.protocol.startsWith("http")) foreign.set(u.origin, (foreign.get(u.origin) ?? new Set()).add(p)); }); await q.goto(`http://127.0.0.1:${PORT}${p}`, { waitUntil: "networkidle" }).catch(() => {}); await q.close(); n += 1; }
await b.close(); srv.kill();
console.log(`${n} pages opened`); for (const [o, ps] of foreign) console.log(`  FAIL third-party request to ${o} from ${[...ps].slice(0, 3).join(", ")}`);
if (foreign.size) { console.log("THIRD-PARTY GATE FAIL"); process.exit(1); } console.log("THIRD-PARTY GATE PASS: every request on every sitemap page stays on this site");
