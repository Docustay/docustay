#!/usr/bin/env node
// Crawl gate (Part 31, 500 audit): requests EVERY route of the built site, as a desktop and a phone browser, and fails on any answer that is not 200 (or an expected redirect).
// The routes come from three places so none is missed: the route files (walked), the dynamic values (slugs, languages, docs, legal), and sitemap.xml. Links found in each page are followed one level too.
// The server runs from its OWN COPY of the build folder (build-preview), so rebuilding while it runs can never crash it.
//   node scripts/crawl-gate.mjs            → table of failures, exit 1 if any     --all  → every route     --json FILE → write the results
import { SIGNPDF } from "../src/lib/site/signpdf.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { ALL } from "../src/lib/site/pages/registry.js";
import { TEMPLATES } from "../src/lib/site/pages/templates.js";
import { readPages } from "./build-docs.mjs";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const UA = { desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", mobile: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" };
import { match as langMatch } from "../src/params/lang.js";
import legalDocs from "../src/lib/legal.json" with { type: "json" };
const LANGS = ["es", "fr", "de", "pt", "it", "nl", "pl", "tr", "ru", "ar", "ja", "zh", "ko", "en"].filter(langMatch);   // only the languages the route matcher accepts have a site page today
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/^\+(page|server)/.test(e.name)) out.push(p); } return out; };
export function routePaths() {
  const base = path.join(ROOT, "src/routes");
  const dirs = new Set(walk(base).filter((f) => /\+page\./.test(f)).map((f) => path.dirname(path.relative(base, f))));
  const fill = { "[slug]": null, "[doc]": null, "[id]": null, "[lang=lang]": null, "[lang]": null };
  const out = new Set();
  for (const d of dirs) {
    const segs = d.split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
    const url = "/" + segs.join("/");
    if (segs[0] === "design") continue;   // the illustration sheet exists only with DOCUSTAY_DESIGN_PREVIEW
    if (segs.some((s) => s in fill)) continue;   // dynamic: expanded below
    out.add(url === "/." || url === "/" ? "/" : url);
  }
  for (const p of ALL) out.add(p.path); for (const t of TEMPLATES) out.add(`/templates/${t.slug}`);
  out.add("/sign-pdf"); for (const l of SIGNPDF) out.add(`/sign-pdf/${l.slug}`);
  for (const p of readPages()) out.add(`/docs/${p.slug}`); out.add("/docs/api-reference");
  for (const l of ["terms", "privacy-policy", "cookies", "dpa", "notices"]) out.add(`/legal/${l}`);
  for (const l of LANGS) { out.add(`/${l}`); out.add(`/${l}/product`); out.add(`/${l}/trust`); }
  // every address the sitemap names, <loc> and every hreflang alternate: a hreflang that points at a page that does not exist is a defect
  try { const sm = fs.readFileSync(path.join(ROOT, "static", "sitemap.xml"), "utf8"); for (const m of sm.matchAll(/(?:<loc>|href=")https:\/\/docustay\.app([^<"]*)/g)) out.add(m[1] || "/"); } catch { /* no sitemap yet */ }
  for (const f of ["/robots.txt", "/sitemap.xml", "/llms.txt", "/llms-full.txt", "/favicon.svg", "/api/openapi.json"]) out.add(f);
  return [...out].sort();
}
const free = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
export async function startDev() {
  const port = await free();
  const srv = spawn("npx", ["vite", "dev", "--port", String(port), "--host", "127.0.0.1"], { cwd: ROOT, env: { ...process.env, DOCUSTAY_API_URL: process.env.DOCUSTAY_API_URL ?? "http://127.0.0.1:9" }, stdio: "ignore" });
  for (let i = 0; i < 120; i += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/robots.txt`)).status) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  return { port, stop: () => srv.kill() };
}
export async function startPreview() {
  const copy = path.join(ROOT, "build-preview"); fs.rmSync(copy, { recursive: true, force: true }); fs.cpSync(path.join(ROOT, "build"), copy, { recursive: true });
  const port = await free();
  const srv = spawn("node", ["build-preview/index.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ORIGIN: `http://127.0.0.1:${port}`, DOCUSTAY_API_URL: process.env.DOCUSTAY_API_URL ?? "http://127.0.0.1:9" }, stdio: "ignore" });
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/robots.txt`)).status) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
  return { port, stop: () => srv.kill() };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { port, stop } = process.argv.includes("--dev") ? await startDev() : await startPreview(); process.on("exit", stop);
  let paths = routePaths();
  const rows = [];
  const seen = new Set();
  const hit = async (p, ua) => { try { const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers: { "user-agent": UA[ua] }, redirect: "manual" }); const body = r.status < 300 ? await r.text() : ""; return { status: r.status, body, loc: r.headers.get("location") }; } catch (e) { return { status: 0, body: "", err: String(e).slice(0, 80) }; } };
  const queue = [...paths];
  while (queue.length) {
    const p = queue.shift(); if (seen.has(p)) continue; seen.add(p);
    for (const ua of ["desktop", "mobile"]) {
      const r = await hit(p, ua); rows.push({ path: p, ua, status: r.status, loc: r.loc ?? null, err: r.err ?? null });
      if (ua === "desktop" && r.status === 200 && /text\/html|<html/i.test(r.body.slice(0, 400))) for (const m of r.body.matchAll(/href="(\/[^"#?]*)"/g)) { const h = m[1]; if (!seen.has(h) && !/\.(png|jpg|jpeg|webp|svg|ico|mp4|webm|pdf|json|xml|txt|md|css|js)$/.test(h) && !h.startsWith("/_app/") && !h.startsWith("/api/")) queue.push(h); }
    }
  }
  stop();
  const ok = (r) => r.status === 200 || ((r.status === 301 || r.status === 302 || r.status === 307 || r.status === 308) && r.loc);
  const bad = rows.filter((r) => !ok(r));
  if (process.argv.includes("--json")) fs.writeFileSync(process.argv[process.argv.indexOf("--json") + 1], JSON.stringify({ at: new Date().toISOString(), routes: seen.size, requests: rows.length, failing: bad.length, rows }, null, 1));
  for (const r of process.argv.includes("--all") ? rows : bad) console.log(`${ok(r) ? "✓" : "✗"} ${String(r.status).padEnd(3)} ${r.ua.padEnd(8)} ${r.path}${r.loc ? "  → " + r.loc : ""}${r.err ? "  " + r.err : ""}`);
  console.log(`\nCRAWL GATE ${bad.length ? "FAIL" : "PASS"}: ${seen.size} routes, ${rows.length} requests, ${bad.length} not 200`);
  process.exit(bad.length ? 1 : 0);
}
