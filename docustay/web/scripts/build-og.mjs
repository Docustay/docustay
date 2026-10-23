#!/usr/bin/env node
// Open Graph images: one 1200x630 card per public page (the cream ground, serif title in ink, the violet seal; CREAM 16 Oct 2026, specs/SITE-CREAM-RESTYLE.md §5), drawn with the same browser the tests use. Writes static/og/<slug>.png. Run: node scripts/build-og.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { allPages } from "../src/lib/site/pages.js";
import { readPages } from "./build-docs.mjs";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const slugOf = (p) => (p === "/" ? "home" : p.slice(1).replace(/\//g, "-"));
const FONT = (f) => `file://${path.join(ROOT, "static", "fonts", f)}`;
const logoSvg = fs.readFileSync(path.join(ROOT, "static", "brand", "docustay-wordmark-ink.svg"), "utf8");
const card = (title, desc) => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:IS;src:url(${FONT("instrument-serif-latin-400-normal.woff2")})}@font-face{font-family:GE;src:url(${FONT("geist-latin-wght-normal.woff2")});font-weight:100 900}
body{margin:0;width:1200px;height:630px;background:#f7f6fc;color:#16161d;font-family:GE,system-ui,sans-serif;position:relative;overflow:hidden}
.b1{position:absolute;left:50%;top:-420px;width:1500px;height:900px;transform:translateX(-50%);background:radial-gradient(closest-side,rgba(90,58,193,.08),transparent 72%)}
.b2{position:absolute;right:-200px;bottom:-300px;width:800px;height:700px;background:radial-gradient(closest-side,rgba(90,58,193,.07),transparent 70%)}
.logo{position:absolute;left:70px;top:58px;width:200px}.logo svg{width:100%;height:auto;display:block}
.t{position:absolute;left:70px;right:260px;top:178px;font:400 ${title.length > 40 ? 78 : 98}px/1 IS;letter-spacing:-.025em;color:#16161d}
.d{position:absolute;left:70px;right:200px;bottom:62px;font-size:27px;line-height:1.4;color:#4c4a5e}
.s{position:absolute;right:76px;top:70px;width:74px;height:74px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#b9aeff,#6a49e0 60%,#4e30b2);box-shadow:0 14px 30px -10px rgba(60,40,140,.45),inset 0 2px 3px rgba(255,255,255,.55)}
.p{position:absolute;right:96px;top:170px;width:150px;height:196px;background:#ffffff;border:1px solid #e4e1f0;border-radius:6px;transform:rotate(7deg);box-shadow:0 1px 2px rgba(22,22,29,.04),0 30px 50px -24px rgba(60,40,140,.35)}.p i{display:block;height:7px;margin:22px 18px 0;border-radius:3px;background:#e4e1f0}
</style><body><div class="b1"></div><div class="b2"></div><div class="logo">${logoSvg}</div><div class="p"><i></i><i style="width:70%"></i><i></i></div><div class="s"><img src="data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, "static", "brand", "docustay-favicon-D-white.svg")).toString("base64")}" style="position:absolute;left:50%;top:50%;width:34px;transform:translate(-50%,-50%)"></div>
<div class="t">${esc(title)}</div><div class="d">${esc(desc.length > 120 ? `${desc.slice(0, 118).replace(/\s+\S*$/, "")}…` : desc)}</div></body>`;
const b = await chromium.launch({ channel: "chrome" }); const page = await b.newPage({ viewport: { width: 1200, height: 630 } });
fs.mkdirSync(path.join(ROOT, "static", "og"), { recursive: true });
let n = 0;
const docs = readPages(path.join(ROOT, "..", "docs")).map((d) => ({ path: `/docs/${d.slug}`, title: d.title, desc: d.description ?? "" })).concat([{ path: "/docs/api-reference", title: "API reference", desc: "Every operation, generated from the OpenAPI file." }]);
for (const p of [...allPages(), ...docs.filter((d) => !allPages().some((a) => a.path === d.path))]) { await page.setContent(card(p.title, p.desc)); await page.screenshot({ path: path.join(ROOT, "static", "og", `${slugOf(p.path)}.png`) }); n += 1; }
await b.close(); console.log(`wrote ${n} images`);
