#!/usr/bin/env node
// SEO / sharing gate (Part 31 Part B): every prerendered page has one canonical, an Open Graph title, description and image that exists, Twitter card tags, and valid JSON-LD; robots.txt names the sitemap; the site is English only: <html lang="en"> everywhere and no hreflang alternates anywhere.
import fs from "node:fs";
import path from "node:path";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), ".."); const PRE = path.join(ROOT, "build", "prerendered");
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, o); else if (/\.html$/.test(e.name)) o.push(f); } return o; };
const problems = []; const pages = walk(PRE);
for (const f of pages) { const r = "/" + path.relative(PRE, f).replace(/(^|\/)index\.html$/, "").replace(/\.html$/, ""); const h = fs.readFileSync(f, "utf8"); if (/^<script>location\.href=/.test(h)) continue;   // a redirect stub, not a page
  if ((h.match(/<link rel="canonical"/g) ?? []).length !== 1) problems.push(`${r}: needs exactly one canonical`);
  for (const k of ["og:title", "og:description", "og:image"]) if (!new RegExp(`<meta property="${k}" content="[^"]+"`).test(h)) problems.push(`${r}: no ${k}`);
  if (!/<meta name="twitter:card"/.test(h)) problems.push(`${r}: no twitter:card`);
  const img = h.match(/<meta property="og:image" content="https?:\/\/[^/]+(\/[^"]+)"/); if (img && !fs.existsSync(path.join(ROOT, "static", img[1])) && !fs.existsSync(path.join(ROOT, "build", "client", img[1]))) problems.push(`${r}: og:image ${img[1]} does not exist`);
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); } catch { problems.push(`${r}: JSON-LD does not parse`); } }
  if (/hreflang=/.test(h)) problems.push(`${r}: has hreflang (the site is English only)`);
  const lang = h.match(/<html[^>]*\slang="([^"]*)"/)?.[1]; if (lang !== "en") problems.push(`${r}: <html lang="${lang}"> (the site is English only)`); }
const robots = fs.readFileSync(path.join(ROOT, "static/robots.txt"), "utf8"); if (!/^Sitemap: https?:\/\/\S+\/sitemap\.xml/m.test(robots)) problems.push("robots.txt does not name the sitemap");
console.log(`${pages.length} prerendered pages`); for (const p of problems.slice(0, 25)) console.log("  FAIL " + p); console.log(problems.length ? `SEO GATE FAIL (${problems.length})` : "SEO GATE PASS"); process.exit(problems.length ? 1 : 0);
