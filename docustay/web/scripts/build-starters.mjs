#!/usr/bin/env node
// Writes src/lib/site/starters.gen.json from the island's starter templates (src/documents/starters/*.mjs) AND their printed form (starters/manifest.json + starters/<slug>.pdf, made by
// scripts/starters/render-all.mjs through the product's own HTML-to-PDF path), so the website's template pages describe exactly the document, pages, seats and fields the app will create.
// `--check` fails when the file is stale, or when a template, its options or the typeset look changed without the pages being re-rendered (the fingerprint in the manifest no longer matches).
import fs from "node:fs";
import crypto from "node:crypto";
import { STARTERS } from "../../../src/documents/starters/index.mjs";
import { fingerprint } from "../../../src/documents/starters/fingerprint.mjs";

const OUT = new URL("../src/lib/site/starters.gen.json", import.meta.url);
const INDEX = new URL("../src/lib/site/starters.index.json", import.meta.url);   // small: sign-up, sign-in and the app's picker import this, not the whole text and field map
const DIR = new URL("../starters/", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", DIR), "utf8"));
const FIELD = /\{\{([^{}]+)\}\}/g;
const plain = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<h2[^>]*>(\d+)\.&nbsp;\s*/g, "<h2>Section $1: ").replace(/<span class="n">([\d.]+)<\/span>/g, "$1 ").replace(/<h[1-6][^>]*>/g, "\n\n").replace(/<\/(p|h[1-6]|li|tr)>/g, "\n").replace(/<\/t[dh]>/g, "   ").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(FIELD, (_, inner) => `____ (${(/label=([^;]+)/.exec(inner)?.[1] ?? inner.split(";")[0]).trim()})`).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const stale = [];
const SENDER_ROLE = "You, before sending";
const gen = STARTERS.map((s) => {
  const m = manifest[s.slug];
  if (!m || m.sha !== fingerprint(s)) { stale.push(s.slug); return null; }
  const pdf = fs.readFileSync(new URL(`${s.slug}.pdf`, DIR));
  if (crypto.createHash("sha256").update(pdf).digest("hex").slice(0, 16) !== m.pdfSha) { stale.push(`${s.slug} (pdf changed)`); return null; }
  const seats = m.roles.map((r) => ({ role: r.label, seat: r.key }));
  const seatLabel = Object.fromEntries(seats.map((x) => [x.seat, x.role]));
  const text = plain(s.html);
  const words = text.replace(/____ \([^)]*\)/g, " ").split(/\s+/).filter(Boolean).length;
  // Run 9 (R8-57): a box the sender fills in before sending is shown as theirs, not a signer's
  const fields = m.fields.map((f) => ({ id: f.id, label: f.label, type: f.type, role: f.sender ? SENDER_ROLE : (seatLabel[f.role] ?? f.role), seat: f.role, ...(f.sender ? { sender: true } : {}), required: f.required, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, ...(f.options ? { options: f.options } : {}) }));
  const filled = fields.filter((f) => !["signature", "initials", "date_signed"].includes(f.type)).length;
  return { slug: s.slug, title: s.title, use: s.use, summary: s.summary, who: s.who ?? "", seats, pages: m.pages, words, minutes: Math.max(2, Math.round(filled * 0.35 + m.pages * 0.8)), fields, text, sha: m.sha };
});
if (stale.length) { console.error(`The printed form of ${stale.length} starter(s) is out of date: ${stale.join(", ")}\nRun: node scripts/sandbox/mini-gotenberg.mjs & KEYSTONE_GOTENBERG_URL=http://127.0.0.1:3777 node scripts/starters/render-all.mjs`); process.exit(1); }
const json = JSON.stringify({ starters: gen }, null, 1) + "\n";
const index = JSON.stringify(gen.map((g) => ({ slug: g.slug, title: g.title, use: g.use, who: g.who, summary: g.summary, pages: g.pages, fields: g.fields.length, seats: g.seats.map((x) => x.role), minutes: g.minutes })), null, 1) + "\n";
if (process.argv.includes("--check")) {
  let cur = "", curIndex = ""; try { cur = fs.readFileSync(OUT, "utf8"); curIndex = fs.readFileSync(INDEX, "utf8"); } catch { /* missing */ }
  if (cur !== json || curIndex !== index) { console.error("starters.gen.json is stale — run: node scripts/build-starters.mjs"); process.exit(1); }
  console.log("starters.gen.json is current and every starter's pages match its source"); process.exit(0);
}
fs.writeFileSync(OUT, json); fs.writeFileSync(INDEX, index); console.log(`starters.gen.json written (${gen.length} starters, ${(json.length / 1024).toFixed(0)} KB)`);
