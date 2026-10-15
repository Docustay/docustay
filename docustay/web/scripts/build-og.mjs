#!/usr/bin/env node
// Open Graph images: one 1200x630 card per public page (paper background, serif title, the violet seal), drawn with the same browser the tests use. Writes static/og/<slug>.png. Run: node scripts/build-og.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { allPages } from "../src/lib/site/pages.js";
import { readPages } from "./build-docs.mjs";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const WM = fs.readFileSync(path.join(ROOT, "static/brand/docustay-wordmark-white.svg")).toString("base64");   // the final wordmark (specs/brand/docustay-logo), white on the dark card
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const slugOf = (p) => (p === "/" ? "home" : p.slice(1).replace(/\//g, "-"));
const card = (title, desc) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1200px;height:630px;background:#0b0b0c;color:#f4f2ec;font-family:'Geist',system-ui,-apple-system,'Segoe UI',sans-serif;position:relative;overflow:hidden">
<div style="position:absolute;left:70px;top:60px;display:flex;align-items:center;gap:14px;font-size:34px;font-weight:600;letter-spacing:-.02em"><img src="data:image/svg+xml;base64,${WM}" alt="Docustay" style="height:40px;width:auto;display:block"></div>
<div style="position:absolute;left:70px;right:140px;top:200px;font-size:${title.length > 38 ? 70 : 88}px;line-height:1.04;font-weight:600;letter-spacing:-.035em">${esc(title)}</div>
<div style="position:absolute;left:70px;right:160px;bottom:70px;font-size:28px;line-height:1.4;color:#a8a39a">${esc(desc.length > 120 ? `${desc.slice(0, 118).replace(/\s+\S*$/, "")}…` : desc)}</div>
<div style="position:absolute;right:70px;top:66px;width:70px;height:92px;background:#faf8f3;border-radius:4px;transform:rotate(6deg);box-shadow:0 10px 30px rgb(0 0 0 / .5)"><div style="margin:14px 10px 0;height:5px;background:#d8d4c8"></div><div style="margin:8px 10px 0;height:5px;background:#d8d4c8"></div><div style="margin:12px 10px 0;height:14px;border:1.5px solid #5a3ac1"></div></div></body>`;
const b = await chromium.launch({ channel: "chrome" }); const page = await b.newPage({ viewport: { width: 1200, height: 630 } });
fs.mkdirSync(path.join(ROOT, "static", "og"), { recursive: true });
let n = 0;
const docs = readPages(path.join(ROOT, "..", "docs")).map((d) => ({ path: `/docs/${d.slug}`, title: d.title, desc: d.description ?? "" })).concat([{ path: "/docs/api-reference", title: "API reference", desc: "Every operation, generated from the OpenAPI file." }]);
for (const p of [...allPages(), ...docs.filter((d) => !allPages().some((a) => a.path === d.path))]) { await page.setContent(card(p.title, p.desc)); await page.screenshot({ path: path.join(ROOT, "static", "og", `${slugOf(p.path)}.png`) }); n += 1; }
await b.close(); console.log(`wrote ${n} images`);
