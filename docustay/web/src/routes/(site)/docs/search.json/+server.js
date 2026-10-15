// The docs search index: every page split at its headings, plus every API operation. Fetched once by the sidebar search and the Ask bar; no server runs per query.
import path from "node:path";
import fs from "node:fs";
import { readPages } from "../../../../../scripts/build-docs.mjs";
import { operations } from "$lib/docs/openapi.js";
export const prerender = true;
const DOCS = path.join(process.cwd(), "..", "docs");
const slugOf = (h) => h.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
const plain = (md) => md.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*_>|]/g, " ").replace(/\s+/g, " ").trim();
export function GET() {
  const out = [];
  for (const p of readPages(DOCS)) {
    const title = p.title.replace(/^"|"$/g, ""), parts = p.body.split(/^(#{2,3} .*)$/m);
    out.push({ slug: p.slug, title, heading: title, id: "", text: plain(parts[0]).slice(0, 500) });
    for (let i = 1; i < parts.length; i += 2) { const h = parts[i].replace(/^#+ /, ""); out.push({ slug: p.slug, title, heading: h, id: slugOf(h), text: plain(parts[i + 1] ?? "").slice(0, 500) }); }
  }
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), "static", "api", "openapi.json"), "utf8"));
  for (const o of operations(spec)) out.push({ slug: "api-reference", title: "API reference", heading: `${o.method} ${o.path}`, id: o.id, text: `${o.summary}. ${o.description}`.slice(0, 500) });
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
}
