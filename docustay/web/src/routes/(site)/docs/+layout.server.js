import { readPages } from "../../../../scripts/build-docs.mjs";
import path from "node:path";
import fs from "node:fs";
import { operations, tagsOf } from "$lib/docs/openapi.js";
const DOCS = path.join(process.cwd(), "..", "docs");   // the build runs from docustay/web; these pages are prerendered, nothing reads the files at run time
export const prerender = true;
// the three top tabs: Documentation (reference pages), Guides (start here and the tutorials), API Reference (every operation)
const GUIDES = new Set(["quickstart", "documents-from-words", "tutorial-nextjs", "tutorial-python", "tutorial-agent", "connector", "scribe-embed", "mcp-and-skills", "test-mode"]);
export const load = () => {
  const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), "static", "api", "openapi.json"), "utf8"));
  const pages = readPages(DOCS).map((p) => ({ slug: p.slug, title: p.title.replace(/^"|"$/g, ""), tab: GUIDES.has(p.slug) ? "guides" : "docs" }));
  return { nav: pages, api: tagsOf(operations(spec)).map((g) => ({ tag: g.tag, items: g.items.map((o) => ({ id: o.id, method: o.method, path: o.path, summary: o.summary })) })) };
};
