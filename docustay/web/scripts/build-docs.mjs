#!/usr/bin/env node
// Builds the developer documentation's Markdown versions from docustay/docs/*.md and the OpenAPI file:
//   static/docs/<slug>.md      every page, plain Markdown (served at /docs/<slug>.md)
//   static/docs/api-reference.md   generated from static/api/openapi.json (never written by hand)
//   static/llms.txt, static/llms-full.txt   an index and the whole documentation, for tools that read docs
// `node scripts/build-docs.mjs` writes; `--check` fails if what is on disk differs from what would be written (the test runs this).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DOCS = path.join(ROOT, "..", "docs");
const BASE = process.env.DOCUSTAY_DOCS_BASE ?? "https://docs.docustay.app";

export function readPages(dir = DOCS) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
    if (!m) throw new Error(`${f}: missing front matter`);
    const meta = Object.fromEntries(m[1].split("\n").map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
    if (!meta.title || !meta.description) throw new Error(`${f}: front matter needs title and description`);
    return { slug: f.replace(/\.md$/, ""), title: meta.title, description: meta.description, order: Number(meta.order ?? 99), body: m[2].trim() + "\n" };
  }).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

const deref = (spec, s) => (s?.$ref ? deref(spec, spec.components.schemas[s.$ref.split("/").pop()]) : s);
const typeOf = (spec, s) => { s = deref(spec, s) ?? {}; if (s.enum) return s.enum.map((x) => `\`${x}\``).join(" · "); if (s.type === "array") return `array of ${typeOf(spec, s.items)}`; return Array.isArray(s.type) ? s.type.join(" or ") : (s.type ?? "object"); };
function fieldsTable(spec, schema) {
  const s = deref(spec, schema); if (!s?.properties) return "";
  const req = new Set(s.required ?? []);
  const rows = Object.entries(s.properties).map(([k, v]) => { const d = deref(spec, v) ?? {}; return `| \`${k}\` | ${typeOf(spec, v)} | ${req.has(k) ? "yes" : "no"} | ${String(v.description ?? d.description ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`; });
  return ["| Field | Type | Required | Notes |", "|---|---|---|---|", ...rows].join("\n");
}
// A skeleton value for a request body. Run 10 (OI-007, every docs code block executed against the sandbox): "string" for a field that is really an email, an address, an object or a name
// made the API answer 400 to copy-pasted examples, so the value follows the field's format and its name.
const HINT = { email: "jo@example.com", replyTo: "jo@example.com", url: "https://example.com/hook", returnUrl: "https://example.com/done", origin: "https://example.com", name: "Example", title: "Example", subject: "Example", message: "Example", slug: "mutual-nda", role: "Signer", seat: "signer_1", language: "en", reason: "Example" };
const RECORD_KEYS = new Set(["source", "facts", "answers", "variableValues", "brief", "values", "fields", "data"]);
const example = (spec, schema, key = "") => {
  const s = deref(spec, schema) ?? {};
  if (s.example !== undefined) return s.example;
  if (s.type === "array") return [example(spec, s.items, key)];
  if (s.properties) return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, example(spec, v, k)]));
  if (s.type === "integer" || s.type === "number") return 0;
  if (s.type === "boolean") return false;
  if (s.enum?.[0] !== undefined) return s.enum[0];
  if (s.format === "uuid") return "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e";
  if (s.format === "email") return "jo@example.com";
  if (s.format === "uri" || s.format === "url") return "https://example.com/hook";
  if (s.format === "date-time") return "2026-12-01T09:00:00Z";
  if (!s.type && RECORD_KEYS.has(key)) return {};
  return HINT[key] ?? "string";
};

export function apiReference(spec) {
  const out = [`---\ntitle: API reference\ndescription: Every operation of the Docustay API: parameters, request bodies, answers and a curl example. Generated from the OpenAPI file.\norder: 10\n---\n`, "# API reference\n", "Generated from the OpenAPI 3.1 document at `/api/openapi.json`; do not edit by hand.\n"];
  out.push(String(spec.info?.description ?? "").trim(), "");
  for (const [p, ops] of Object.entries(spec.paths)) for (const [method, op] of Object.entries(ops)) {
    out.push(`## ${method.toUpperCase()} ${p}\n`, `**${op.summary}**\n`);
    if (op.description) out.push(op.description.trim(), "");
    const params = op.parameters ?? [];
    if (params.length) out.push("| Parameter | In | Required | Notes |", "|---|---|---|---|", ...params.map((x) => `| \`${x.name}\` | ${x.in} | ${x.required ? "yes" : "no"} | ${String(x.description ?? typeOf(spec, x.schema)).replace(/\n/g, " ")} |`), "");
    const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
    if (bodySchema) { out.push("Request body (JSON):\n", fieldsTable(spec, bodySchema), ""); }
    out.push("Answers:\n", ...Object.entries(op.responses ?? {}).map(([code, r]) => `- \`${code}\` ${r.description}`), "");
    // Placeholders in a URL are UPPER_CASE words (DOCUMENT_ID), never <angle brackets>: a shell reads "<id>" as a redirect, and the hosted edge answers an unescaped "<" in a path with a bare HTTP/2 protocol error instead of a plain 400 (Run 10, OI-007).
    const urlPath = p.replace(/(?:\/([a-z-]+))?\/\{(\w+)\}/g, (_, seg, name) => `${seg ? `/${seg}` : ""}/${(seg ? `${seg.replace(/ies$/, "y").replace(/s$/, "")}_${name}` : name).replace(/-/g, "_").toUpperCase()}`);
    // A required query parameter belongs in the example, or the example is refused with a 400 (Run 12: GET /search without q).
    const qs = params.filter((x) => x.in === "query" && x.required).map((x) => `${x.name}=${x.schema?.type === "integer" ? (x.schema.minimum ?? 1) : "example"}`).join("&");
    const url = `https://app.docustay.app${urlPath}${qs ? `?${qs}` : ""}`;
    const lines = [`curl${method === "get" ? "" : ` -X ${method.toUpperCase()}`} ${url} \\`, `  -H "Authorization: Bearer $DOCUSTAY_KEY"${bodySchema || method === "post" ? " \\" : ""}`];
    if (method === "post") lines[lines.length - 1] += "\n" + `  -H "Idempotency-Key: $(uuidgen)"` + (bodySchema ? " \\" : "");
    if (bodySchema) lines.push(`  -H "Content-Type: application/json" \\`, `  -d '${JSON.stringify(example(spec, bodySchema))}'`);
    out.push("```bash", lines.join("\n"), "```", "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function build() {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "static", "api", "openapi.json"), "utf8"));
  const pages = readPages();
  const ref = apiReference(spec);
  const refPage = { slug: "api-reference", title: "API reference", description: "Every operation of the Docustay API, generated from the OpenAPI file.", order: 10, body: ref.replace(/^---[\s\S]*?---\n/, "") };
  const all = [...pages, refPage].sort((a, b) => a.order - b.order);
  const files = new Map();
  for (const p of all) files.set(`docs/${p.slug}.md`, p.body);
  files.set("llms.txt", [`# Docustay`, ``, `> Docustay sends documents for signature. REST API, SDKs for JavaScript/TypeScript and Python, embedded signing, webhooks, an MCP server and agent skills.`, ``, `## Documentation`, ``, ...all.map((p) => `- [${p.title}](${BASE}/docs/${p.slug}.md): ${p.description}`), ``, `## Machine-readable`, ``, `- [OpenAPI 3.1](${BASE}/api/openapi.json)`, `- [Postman collection](${BASE}/api/docustay.postman_collection.json)`, `- [All documentation in one file](${BASE}/llms-full.txt)`, ``].join("\n"));
  files.set("llms-full.txt", all.map((p) => p.body).join("\n\n---\n\n"));
  return { files, pages: all, spec };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { files } = build();
  let stale = 0;
  for (const [rel, text] of files) {
    const file = path.join(ROOT, "static", rel);
    const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (have === text) continue;
    stale += 1;
    if (check) { console.error(`stale: static/${rel}`); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  }
  if (check && stale) { console.error("run: node scripts/build-docs.mjs"); process.exit(1); }
  console.log(check ? "docs are current" : `wrote ${files.size} files (${stale} changed)`);
}
