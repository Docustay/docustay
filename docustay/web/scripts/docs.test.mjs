import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build, readPages } from "./build-docs.mjs";
import { llmsTxt, llmsFull } from "./llms.mjs";
import { allPages } from "../src/lib/site/pages.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { files, pages, spec } = build();
const text = [...files.entries()].filter(([k]) => k.startsWith("docs/")).map(([, v]) => v).join("\n");

test("the Markdown on disk is exactly what the generator writes now (run: node scripts/build-docs.mjs)", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/build-docs.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("every OpenAPI operation has its own heading and a curl example in the API reference (positive control: the generator saw operations)", () => {
  const ref = files.get("docs/api-reference.md");
  const ops = Object.entries(spec.paths).flatMap(([p, o]) => Object.keys(o).map((m) => `## ${m.toUpperCase()} ${p}`));
  assert.ok(ops.length >= 13, `only ${ops.length} operations`);
  for (const h of ops) assert.ok(ref.includes(`${h}\n`), `missing ${h}`);
  assert.equal((ref.match(/```bash/g) ?? []).length, ops.length);
});

test("every /api/v1 path named anywhere in the hand-written pages exists in the OpenAPI file", () => {
  const known = Object.keys(spec.paths).map((p) => new RegExp(`^${p.replace(/\{\w+\}/g, "[^/]+")}$`));
  const handwritten = readPages().map((p) => p.body).join("\n");
  const named = [...new Set([...handwritten.matchAll(/\/api\/v1\/[A-Za-z0-9_\-./{}<>$]+/g)].map((m) => m[0].replace(/[.,)`]+$/, "")))];
  assert.ok(named.length >= 8, `only ${named.length} paths named`);
  for (const n of named) { if (n === "/api/v1/") continue; assert.ok(known.some((re) => re.test(n.replace(/<\w+>/g, "x").replace(/\$\{?\w+\}?/g, "x"))), `docs name ${n}, which is not in the OpenAPI file`); }
});

test("every internal link in the pages resolves to a page (and a broken one would be caught: positive control)", () => {
  const slugs = new Set(pages.map((p) => p.slug));
  const links = [...text.matchAll(/\]\(\/docs\/([a-z0-9-]+)\.md\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 10, `only ${links.length} links`);
  for (const l of links) assert.ok(slugs.has(l), `broken link /docs/${l}.md`);
  assert.ok(!slugs.has("no-such-page"));
});

test("llms.txt lists every docs page once with an absolute address, and llms-full.txt contains every page", () => {
  const args = { pages: allPages(), docs: pages, base: "https://docustay.app" }; const idx = llmsTxt(args).text, full = llmsFull(args);
  for (const p of pages) { assert.equal(idx.split(`/docs/${p.slug}.md)`).length - 1, 1, `${p.slug} listed once`); assert.ok(full.includes(p.body.split("\n")[0]), `${p.slug} in full`); }
  assert.ok(/^- \[.+\]\(https:\/\//m.test(idx));
  assert.ok(!/docs\.docustay\.app/.test(idx), "llms.txt links a host that does not exist");
});

test("words the product cannot back up are absent from the documentation", () => {
  const banned = [/SOC ?2/i, /ISO ?27001/i, /HIPAA/i, /legally[- ]binding/i, /bank[- ]grade/i, /military[- ]grade/i, /\bcertified\b/i, /compliant with/i, /\bGDPR[- ]compliant\b/i, /\b\d+,?\d* customers\b/i, /\bDocuSeal\b/i];
  for (const re of banned) assert.ok(!re.test(text), `documentation contains ${re}`);
});

// a "# comment" inside a code block is not a heading, so fenced code is left out of the count
test("every page has a title, a description, and one H1", () => {
  for (const p of pages) { assert.ok(p.title && p.description, p.slug); assert.equal((p.body.replace(/```[\s\S]*?```/g, "").match(/^# /gm) ?? []).length, 1, `${p.slug}: one H1`); }
});
