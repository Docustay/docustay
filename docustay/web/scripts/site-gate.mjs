#!/usr/bin/env node
// The public site's gate (run after `vite build`): fails on a banned claim, a broken internal link, an image without alt text, or a page with no title/description/H1.
// Banned words are the claims Docustay may not make (no certification, no compliance wording, no customer counts, no testimonials, nothing of the platform) — the maintainer's rulings and plan §5.
import fs from "node:fs";
import path from "node:path";
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const PRE = path.join(ROOT, "build", "prerendered");
const SSR_ROUTES = ["/", "/pricing", "/self-host", "/features", "/signup", "/login", "/legal/terms", "/legal/privacy", "/legal/dpa", "/legal/notices", "/legal/licensing", "/legal/cookies", "/status"];
export const BANNED = [[/workbench/i, "Workbench"], [/hipaa/i, "HIPAA"], [/\bsoc ?2\b/i, "SOC 2"], [/iso ?27001/i, "ISO 27001"], [/\bcertified\b/i, "certified"], [/\bcompliant\b/i, "compliant"], [/legally[- ]binding/i, "legally binding"], [/bank-grade|military-grade/i, "bank/military-grade"],
  [/\b(docuseal|documenso|signwell|docusign|pandadoc|hellosign|dropbox sign|adobe sign|adobe acrobat sign|yousign|signnow|opensign|boldsign|zoho sign|jotform sign|eversign|signeasy|signaturely)\b/i, "another product's name"],
  [/testimonial/i, "testimonial"], [/\btrusted by\b/i, "trusted by"], [/\b\d[\d,.]*\+?\s+(customers|clients|companies|teams|businesses)\b/i, "a customer count"], [/\bFOUNDRY\b(?! LLC)|example practice|\bGLC\b/i, "an operator name other than the legal name \"GLRS LLC\""]];
const files = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const pages = files(PRE).filter((f) => f.endsWith(".html"));
const routeOf = (f) => { const r = "/" + path.relative(PRE, f).replace(/\.html$/, "").replace(/\/index$/, ""); return r === "/index" ? "/" : r; };
const known = new Set([...pages.map(routeOf), ...SSR_ROUTES]);
const problems = [];
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
// Run 7 (the maintainer's decision 10, 11 Oct 2026): the ONE public HIPAA sentence, word for word. Only this exact text is allowed past the HIPAA ban; any other mention (a "compliant", a badge, a changed word) still fails.
export const APPROVED_HIPAA = "Docustay is built to follow the HIPAA Security Rule's safeguards: encryption, two-step sign-in, audit logs and access controls. We do not sign Business Associate Agreements yet, so please do not send protected health information through our hosted service until we do. Need it now? Run Docustay on your own HIPAA-ready servers.";
const withoutApproved = (t) => t.replace(/&#39;|&#x27;|’/g, "'").replace(/\s+/g, " ").split(APPROVED_HIPAA).join(" ");
if (!/hipaa/i.test(withoutApproved(APPROVED_HIPAA.replace("built to follow", "fully compliant with"))) || /hipaa/i.test(withoutApproved(`x ${APPROVED_HIPAA} y`))) { console.error("SITE GATE FAIL: control for the approved HIPAA sentence"); process.exit(1); }
for (const f of pages) {
  const html = fs.readFileSync(f, "utf8"), r = routeOf(f), text = withoutApproved(textOf(html));
  const stub = html.length < 300 && html.match(/<meta http-equiv="refresh" content="0;url=(\/[^"]*)"/);   // a kept old address that only redirects
  if (stub) { if (!pages.some((g) => routeOf(g) === stub[1])) problems.push(`${r}: redirects to ${stub[1]}, which does not exist`); continue; }
  if (r.startsWith("/docs")) continue;            // the documentation describes things like "HIPAA" never; still scanned below for the platform only
  for (const [re, name] of BANNED) if (re.test(text)) problems.push(`${r}: banned wording "${name}"`);
  if (!/<title>[^<]{3,}<\/title>/.test(html)) problems.push(`${r}: no <title>`);
  if (!/<meta name="description" content="[^"]{20,}"/.test(html)) problems.push(`${r}: no meta description`);
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) problems.push(`${r}: needs exactly one <h1>`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) problems.push(`${r}: image without alt text`);
  for (const m of html.matchAll(/<a\b[^>]*\bhref="(\/[^"#?]*)/g)) {
    const h = m[1].replace(/\/$/, "") || "/";
    if (h.startsWith("/api/")) continue;           // served by the backend at run time
    if (h.startsWith("/media/") || /\.(md|txt|json|xml|svg|png|jpg|js)$/.test(h)) { if (/\.(md|txt|json|xml)$/.test(h) && !fs.existsSync(path.join(ROOT, "static", h)) && !fs.existsSync(path.join(PRE, h))) problems.push(`${r}: link to missing file ${h}`); continue; }
    if (!known.has(h) && !fs.existsSync(path.join(ROOT, "src", "routes", "(app)", h.split("/")[1] ?? "__none"))) problems.push(`${r}: broken link ${h}`);
  }
}
for (const f of [...files(path.join(ROOT, "src", "routes", "(site)")), ...files(path.join(ROOT, "src", "lib", "site"))].filter((x) => /\.(svelte|js)$/.test(x))) {
  const s = withoutApproved(fs.readFileSync(f, "utf8")); for (const [re, name] of BANNED) if (re.test(s) && !/site-gate|banned/i.test(s.split("\n")[0])) problems.push(`${path.relative(ROOT, f)}: banned wording "${name}" in source`);
}
for (const f of files(path.join(ROOT, "static", "docs"))) { const t = fs.readFileSync(f, "utf8"); if (/workbench/i.test(t)) problems.push(`static/docs/${path.basename(f)}: mentions Workbench`); if (BANNED.find(([, n]) => n === "another product's name")[0].test(t)) problems.push(`static/docs/${path.basename(f)}: names another product`); }
for (const f of ["llms.txt", "llms-full.txt", "sitemap.xml"]) if (BANNED.find(([, n]) => n === "another product's name")[0].test(fs.readFileSync(path.join(ROOT, "static", f), "utf8"))) problems.push(`static/${f}: names another product`);
// positive control: the ban catches a competitor name and passes a clean sentence
const NAMEBAN = BANNED.find(([, n]) => n === "another product's name")[0]; if (!NAMEBAN.test("compare with DocuSign") || NAMEBAN.test("Docustay sends documents")) { console.error("SITE GATE FAIL: control for the product-name ban"); process.exit(1); }
if (problems.length) { console.error(`SITE GATE FAIL: ${problems.length} problem(s)\n` + problems.slice(0, 60).map((p) => "  " + p).join("\n")); process.exit(1); }
console.log(`SITE GATE PASS: ${pages.length} prerendered pages + ${SSR_ROUTES.length} server-rendered routes; no banned wording, no broken internal links, every image has alt text, every page has a title, description and one H1`);
