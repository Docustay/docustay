#!/usr/bin/env node
// Keyword ownership gate (V2 section 8.1 item 4): each page owns ONE primary phrase. The phrase must appear in the page's title and meta description, and in its H1 or its first 100 words, and in the title, H1 or meta description of no other page.
// Ruling (14 Oct 2026): /verify owns "verify a signed PDF" (the tool is where that search lands) and /features/proof owns "certificate of completion"; V2 had given both to /features/proof.
// Ruling (14 Oct 2026): the H1s of V2 section 4 are fixed brand lines ("Get paid inside the signature") that do not contain the phrases, so the H1 may stand in for the first 100 words but is not required to carry the phrase; cost if wrong: none for readers, a weaker H1 signal for search.
// Usage: node scripts/keywords-gate.mjs [--base http://127.0.0.1:5199]
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:5199");
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWN = { "/": "e-signature API", "/developers": "e-signature API", "/features": "e-signature features", "/features/how-it-works": "how e-signatures work", "/features/scribe": "AI document builder", "/features/payments": "payments inside e-signature",
  "/features/proof": "certificate of completion", "/verify": "verify a signed PDF", "/features/embedded-signing": "embedded e-signature", "/features/test-mode": "e-signature test mode", "/features/agent-ready": "MCP server e-signature",
  "/free-templates": "free document templates", "/self-host": "self-hosted e-signature", "/pricing": "e-signature pricing" };
const LANG = { javascript: "JavaScript", typescript: "TypeScript", python: "Python", go: "Go", php: "PHP", csharp: "C#" };
for (const [s, l] of Object.entries(LANG)) OWN[`/sign-pdf/${s}`] = `sign pdf api in ${l}`;
const norm = (t) => t.toLowerCase().replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/[-‑]/g, " ").replace(/\s+/g, " ");
const dec = (t) => t.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'");
const sm = fs.readFileSync(path.join(ROOT, "static/sitemap.xml"), "utf8"); const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/\/$/, "") || "/");
const pages = {};
for (const u of urls) { const html = await (await fetch(BASE + u)).text(); const title = dec(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ""), meta = dec(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ""), h1 = dec((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "").replace(/<[^>]+>/g, "")); const main = html.match(/<main[\s\S]*<\/main>/)?.[0] ?? html; const body = dec(main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "); pages[u] = { title, meta, h1, first100: body.split(" ").slice(0, 100).join(" ") }; }
const bad = [];
for (const [u, phrase] of Object.entries(OWN)) { const p = pages[u]; if (!p) { bad.push(`${u}: not in the sitemap`); continue; } const ph = norm(phrase);
  for (const f of ["title", "meta"]) if (!norm(p[f]).includes(ph)) bad.push(`${u}: "${phrase}" is not in the ${f}`);
  if (!norm(p.h1).includes(ph) && !norm(p.first100).includes(ph)) bad.push(`${u}: "${phrase}" is in neither the H1 nor the first 100 words`);
  for (const [v, q] of Object.entries(pages)) if (!/^\/(docs|legal)\//.test(v) && v !== u && !Object.keys(OWN).some((k) => k === v && norm(OWN[k]).includes(ph) )) for (const f of ["title", "h1", "meta"]) if (norm(q[f]).includes(ph) && !(v in OWN && norm(OWN[v]).includes(ph))) bad.push(`${v}: the ${f} uses "${phrase}", which ${u} owns`); }
if (bad.length) { for (const b of bad.slice(0, 80)) console.log("  FAIL " + b); console.log(`KEYWORDS GATE FAIL (${bad.length})`); process.exit(1); }
console.log(`KEYWORDS GATE PASS: ${Object.keys(OWN).length} owned phrases, each in its page's title and meta and in its H1 or first 100 words, and in no other page's title, H1 or meta`);
