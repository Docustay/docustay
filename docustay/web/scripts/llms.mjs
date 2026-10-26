// llms.txt and llms-full.txt, generated from the page registry (allPages) and the docs, so they cannot drift from the site.
// check:site (site-gate) fails when a sitemap page is missing from llms.txt or a listed Markdown file does not exist.
import facts from "../src/lib/site/facts.gen.json" with { type: "json" };
export const GROUPS = [
  ["Features", "What Docustay does, step by step: how it works, Scribe, payments, proof, embedded signing, test mode, agent-ready and your brand.", (p) => p === "/features" || p.startsWith("/features/")],
  ["Use cases", "How people use it: contracts, waivers, leases, HR, schools and more.", (p) => p === "/use-cases" || p.startsWith("/use-cases/")],
  ["Templates", "Free, ready-to-send templates, each with its roles, fields and what to check before sending.", (p) => p === "/free-templates" || p.startsWith("/templates/")],
  ["Developers", "The API, SDKs, command line, webhooks, embedded signing, test mode and AI agent tools.", (p) => p === "/developers" || p.startsWith("/developers/")],
  ["Sign from code", "A short, tested program for sending a document for signature in each language.", (p) => p === "/sign-pdf" || p.startsWith("/sign-pdf/")],
  ["Documentation", "The developer documentation: quickstart, authentication, webhooks, embedding, self-hosting and the full API reference.", (p) => p.startsWith("/docs/")],
  ["Pricing and licensing", "Plans, prices, limits, the open-source licence and self-hosting.", (p) => ["/pricing", "/licensing", "/open-source"].includes(p) || p === "/self-host" || p.startsWith("/self-host/")],
  ["Free tools", "Sign, fill and verify a PDF in the browser; the file is never uploaded.", (p) => p.startsWith("/tools/") || p === "/verify"],
  ["Trust", "Security, privacy, data handling, status and the legal pages.", (p) => p === "/trust" || p.startsWith("/trust/") || p.startsWith("/legal/") || p === "/status"],
  ["Company", "About Docustay and the facts, help, what is next, the demo, the guide to signing a PDF, the changelog and how to reach the team.", (p) => ["/about", "/help", "/whats-next", "/contact", "/changelog", "/demo"].includes(p) || p.startsWith("/guides/")],
];
export const mdUrl = (base, p) => `${base}${p === "/" ? "/index" : p}.md`;
export function llmsTxt({ pages, docs, base }) {
  const all = [...pages.filter((p) => p.path !== "/"), ...docs.map((d) => ({ path: `/docs/${d.slug}`, title: d.title, desc: d.description }))];
  const used = new Set(); const out = [];
  out.push("# Docustay", "", `> ${facts.tagline.headline} ${facts.tagline.support} Docustay sends documents for signature, signers need no account, and the signed PDF is sealed with a certificate of completion that lists who signed and when. REST API, SDKs, embedded signing, webhooks and an MCP server, with a free plan and a self-hosted edition.`, "",
    `This site is in English. Every page also exists as Markdown: add .md to its address (the home page is ${base}/index.md). The plain facts (plans, prices, limits, licence, security, hosting) are in ${base}/about.md.`, "");
  for (const [name, line, test] of GROUPS) {
    const rows = all.filter((p) => test(p.path)); rows.forEach((p) => used.add(p.path)); if (!rows.length) continue;
    out.push(`## ${name}`, "", line, "", ...rows.map((p) => `- [${p.title}](${mdUrl(base, p.path)}): ${p.desc}`), "");
  }
  const left = all.filter((p) => !used.has(p.path)); if (left.length) out.push("## Other", "", ...left.map((p) => `- [${p.title}](${mdUrl(base, p.path)}): ${p.desc}`), "");
  out.push("## Machine-readable", "", `- [OpenAPI 3.1 description](${base}/openapi.json): every API operation`, `- [About and facts](${base}/about.md): plans, prices, limits, licence, SDKs, security, hosting`, `- [Sitemap](${base}/sitemap.xml): every public page`, `- [All pages and documentation in one file](${base}/llms-full.txt)`, "");
  return { text: out.join("\n"), listed: all };
}
export function llmsFull({ pages, docs, base }) {
  const body = pages.map((p) => `<!-- ${base}${p.path === "/" ? "" : p.path} -->\n${p.md.trim()}`);
  return [...body, ...docs.map((d) => d.body)].join("\n\n---\n\n") + "\n";
}
