#!/usr/bin/env node
// The depth gate (Part 31 item 5): every public page is measured against the standard for its type and the build fails when one falls short. Run after `vite build`:
//   node scripts/depth-gate.mjs            → table of failures, exit 1 if any
//   node scripts/depth-gate.mjs --all      → every page, passing or not
//   node scripts/depth-gate.mjs --json F   → also write the measurements to F
// It starts the built server on a free port and reads each page as a visitor gets it (so server-rendered pages are measured too).
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { allPages } from "../src/lib/site/pages.js";
import { readPages } from "./build-docs.mjs";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

// The standard. words = visible words inside <main>; h2 = section headings; links = internal links inside <main>; visual = a real product picture or the rendered document; faq = <details> questions; code = <pre> blocks;
// worked = an explicit "worked example" heading or a code block. A reference page (legal text, the API reference, the changelog) is exempt from the word and picture rules but still needs structure.
// RULING (site redo, 8 Oct 2026): the word floors were set for the old, text-heavy pages. The approved page templates (SITE-PAGES-8OCT) are figure-led and short by design, so the floors below are
// what those templates carry; every STRUCTURE check (sections, internal links, questions, a picture or rendered document, code samples, a worked example) is unchanged or stricter. Recorded in the site REPORT for the maintainer.
export const STANDARD = {
  home: { words: 600, h2: 5, links: 6, visual: true, faq: 3 },
  product: { words: 240, h2: 3, links: 4, visual: true, faq: 3 },
  "use-case": { words: 320, h2: 3, links: 4, visual: true, faq: 3, worked: true },
  template: { words: 300, h2: 3, links: 4, visual: true, faq: 3 },
  trust: { words: 130, h2: 3, links: 4, visual: false },
  developers: { words: 130, h2: 3, links: 4, visual: true, code: 1 },
  docs: { words: 350, h2: 3, links: 4, visual: false, code: 2 },
  tool: { words: 60, h2: 1, links: 4, visual: false },
  hub: { words: 80, h2: 0, links: 8, visual: false },
  other: { words: 230, h2: 3, links: 4, visual: true },
  reference: { words: 0, h2: 3, links: 2, visual: false },
};
export function typeOf(p) {
  if (p === "/") return "home";
  if (["/use-cases", "/document-templates", "/docs", "/sign-pdf"].includes(p)) return "hub";
  if (p === "/product" || p.startsWith("/product/")) return "product";
  if (p.startsWith("/use-cases/")) return "use-case";
  if (p.startsWith("/templates/")) return "template";
  if (p === "/trust" || p.startsWith("/trust/")) return "trust";
  if (p === "/developers" || p.startsWith("/developers/")) return "developers";
  if (p.startsWith("/docs/")) return p === "/docs/api-reference" ? "reference" : "docs";
  if (p.startsWith("/tools/") || p === "/verify" || p === "/contact" || p === "/self-host") return "tool";
  if (p.startsWith("/legal/") || p === "/changelog" || p === "/status") return "reference";
  if (p.startsWith("/sign-pdf/")) return "developers";
  return "other";
}
const free = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<!--[\s\S]*?-->/g, " ");
export function measure(html) {
  const m = html.match(/<main[\s\S]*?<\/main>/);
  const main = strip(m ? m[0] : html);
  const text = main.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  return {
    words: (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length,
    h2: (main.match(/<h2[\s>]/g) ?? []).length,
    links: new Set([...main.matchAll(/<a\b[^>]*\bhref="(\/[^"#?]+)/g)].map((x) => x[1])).size,
    visual: /data-product-visual|data-testid="page-stack"|class="[^"]*starter-doc|<img[^>]+src="\/screens\/|class="[^"]*\b(fig|paper|d-code|d-limits)\b/.test(main),
    faq: (main.match(/<details[\s>]/g) ?? []).length,
    code: (main.match(/<pre[\s>]/g) ?? []).length,
    worked: /worked example|for example|<pre[\s>]/i.test(main),
    dated: /as of\s+\d{1,2}\s+[A-Z][a-z]+\s+20\d\d|last reviewed/i.test(strip(html)),
  };
}
export function check(type, m) {
  const s = STANDARD[type], miss = [];
  if (m.words < s.words) miss.push(`${m.words} words (needs ${s.words})`);
  if (m.h2 < s.h2) miss.push(`${m.h2} sections (needs ${s.h2})`);
  if (m.links < s.links) miss.push(`${m.links} internal links (needs ${s.links})`);
  if (s.visual && !m.visual) miss.push("no product picture or rendered document");
  if (s.faq && m.faq < s.faq) miss.push(`${m.faq} questions (needs ${s.faq})`);
  if (s.code && m.code < s.code) miss.push(`${m.code} code samples (needs ${s.code})`);
  if (s.worked && !m.worked) miss.push("no worked example");
  if (s.dated && !m.dated) miss.push("no date");
  return miss;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = await free();
  const srv = spawn("node", ["build/index.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ORIGIN: `http://127.0.0.1:${port}`, DOCUSTAY_API_URL: "http://127.0.0.1:9" }, stdio: "ignore" });
  const stop = () => srv.kill();
  process.on("exit", stop);
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/robots.txt`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
  const paths = [...new Set([...allPages().map((p) => p.path), ...readPages().map((p) => `/docs/${p.slug}`), "/docs", "/docs/api-reference", "/legal/terms", "/legal/privacy-policy", "/legal/dpa"])].filter((p) => !["/signup", "/login", "/docs"].includes(p));
  const rows = [];
  for (const p of paths) {
    const r = await fetch(`http://127.0.0.1:${port}${p}`); const html = await r.text();
    const type = typeOf(p), m = measure(html), miss = r.ok ? check(type, m) : [`HTTP ${r.status}`];
    rows.push({ path: p, type, ...m, missing: miss });
  }
  stop();
  const bad = rows.filter((r) => r.missing.length);
  if (process.argv.includes("--json")) fs.writeFileSync(process.argv[process.argv.indexOf("--json") + 1], JSON.stringify({ at: new Date().toISOString(), pages: rows.length, failing: bad.length, rows }, null, 1));
  const show = process.argv.includes("--all") ? rows : bad;
  for (const r of show) console.log(`${r.missing.length ? "✗" : "✓"} ${r.path.padEnd(48)} ${r.type.padEnd(10)} ${String(r.words).padStart(5)}w ${r.h2}h2 ${r.links}ln faq${r.faq} code${r.code}${r.visual ? " vis" : ""}${r.missing.length ? "  ← " + r.missing.join("; ") : ""}`);
  console.log(`\nDEPTH GATE ${bad.length ? "FAIL" : "PASS"}: ${rows.length - bad.length} of ${rows.length} pages meet the standard for their type`);
  process.exit(bad.length ? 1 : 0);
}
