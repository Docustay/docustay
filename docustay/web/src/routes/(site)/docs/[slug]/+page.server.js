import fs from "node:fs";
import { marked } from "marked";
import { error } from "@sveltejs/kit";
import { readPages } from "../../../../../scripts/build-docs.mjs";
import path from "node:path";
import { highlight } from "$lib/docs/highlight.js";
const DOCS = path.join(process.cwd(), "..", "docs");   // the build runs from docustay/web; these pages are prerendered, nothing reads the files at run time
export const prerender = true;
// a scrollable code block or table must be reachable by keyboard (WCAG 2.1.1): every <pre> and <table> (tables scroll sideways on a phone, R8-33) gets tabindex 0
// headings get GitHub-style ids so in-page links such as #api-limits land somewhere
// R8-43: a link to another page written as `quickstart.md` (right in the plain-Markdown copy) goes to the PAGE here, not to the raw .md file
const slugOf = (h) => h.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
const parse = (md) => marked.parse(md).replace(/<pre>/g, '<pre tabindex="0">').replace(/<table>/g, '<table tabindex="0">').replace(/href="(?:\/docs\/)?([a-z0-9-]+)\.md(#[^"]*)?"/g, (_, page, hash) => `href="/docs/${page}${hash ?? ""}"`).replace(/<(h[2-4])>(.*?)<\/\1>/g, (_, tag, inner) => `<${tag} id="${slugOf(inner)}">${inner}</${tag}>`);
const STATIC = path.join(process.cwd(), "static", "docs");
export const entries = () => readPages(DOCS).map((p) => ({ slug: p.slug }));   // the API reference is its own page (../api-reference)
// every h2/h3 for the "On this page" column, and the code blocks highlighted at build time (Shiki)
const tocOf = (html) => [...html.matchAll(/<h([23]) id="([^"]+)">(.*?)<\/h\1>/g)].map((m) => ({ level: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'") }));
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
async function shiki(html) {
  const parts = html.split(/(<pre tabindex="0"><code(?: class="language-[\w-]+")?>[\s\S]*?<\/code><\/pre>)/);
  for (let i = 1; i < parts.length; i += 2) {
    const m = /<code(?: class="language-([\w-]+)")?>([\s\S]*?)<\/code>/.exec(parts[i]);
    parts[i] = await highlight(decode(m[2]).replace(/\n$/, ""), ({ sh: "bash", shell: "bash", js: "javascript", ts: "typescript", py: "python", yml: "bash" })[m[1]] ?? m[1] ?? "bash");
  }
  return parts.join("");
}
export const load = async ({ params }) => {
  const p = readPages(DOCS).find((x) => x.slug === params.slug); if (!p) error(404, "Not found");
  const html = parse(p.body).replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, "");   // the page header draws the title
  return { slug: p.slug, title: p.title.replace(/^"|"$/g, ""), description: p.description, markdown: p.body, toc: tocOf(html), html: await shiki(html) };
};
