#!/usr/bin/env node
// AI CRAWLER CHECK (BUILD-BLUEPRINT §7.6). For every crawler token in src/lib/site/crawlers.js: (1) robots.txt names it explicitly with a group that allows the public pages and disallows the keep-out paths; (2) fetching the public pages with that token's user agent answers 200 with no noindex, in the first HTML, with the page's H1 present.
//   node scripts/ai-crawler-check.mjs --base https://host.example.com     (exit 1 on any failure)
import { BOTS, KEEP_OUT } from "../src/lib/site/crawlers.js";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:5191").replace(/\/$/, "");
const PAGES = ["/", "/developers", "/pricing", "/docs/quickstart", "/llms.txt", "/openapi.json", "/robots.txt", "/index.md", "/templates/nda-template"];
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const LOG = [];   // the crawler-hit log: token, path, status, date (no personal data); written to research/crawler-hits.csv beside the reports
let bad = 0; const say = (ok, m) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${m}`); };
const robots = await (await fetch(BASE + "/robots.txt")).text();
const groups = robots.split(/\n\s*\n/).map((g) => g.trim()).filter(Boolean);
for (const bot of BOTS) {
  const g = groups.find((x) => new RegExp(`^User-agent:\\s*${bot.replace(/[-.]/g, "\\$&")}\\s*$`, "im").test(x)) ?? groups.find((x) => /^User-agent:\s*\*\s*$/im.test(x));
  const named = groups.some((x) => new RegExp(`^User-agent:\\s*${bot.replace(/[-.]/g, "\\$&")}\\s*$`, "im").test(x));
  say(named && /^Allow:\s*\/\s*$/im.test(g ?? "") && KEEP_OUT.slice(0, 3).every((p) => g.includes(`Disallow: ${p}`)), `robots.txt names ${bot} with Allow / and the keep-out paths`);
}
for (const bot of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Googlebot", "Bingbot", "Google-Extended", "CCBot", "Applebot", "Applebot-Extended"]) {
  for (const path of PAGES) {
    const r = await fetch(BASE + path, { headers: { "user-agent": `Mozilla/5.0 (compatible; ${bot}/1.0)` }, redirect: "manual" });
    const body = /\.(json|txt|md)$/.test(path) ? "" : await r.text(); LOG.push([bot, path, r.status, new Date().toISOString().slice(0, 10)].join(","));
    const noindex = /noindex/i.test(r.headers.get("x-robots-tag") ?? "") || /<meta[^>]+robots[^>]+noindex/i.test(body);
    say(r.status === 200 && !noindex && (!body || /<h1[\s>]/.test(body)), `${bot} gets ${path} (${r.status}${noindex ? ", noindex" : ""}${body && !/<h1[\s>]/.test(body) ? ", no H1 in first HTML" : ""})`);
  }
}
try { const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../specs/proofs/stage-t/launch-site/research/crawler-hits.csv"); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, ["token,path,status,date", ...LOG].join("\n") + "\n"); } catch { /* log is best effort */ }
console.log(bad ? `\n${bad} failure(s)` : `\nAI crawler check: all ${BOTS.length} tokens named, all fetches clean`); process.exit(bad ? 1 : 0);
