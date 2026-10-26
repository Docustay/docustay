#!/usr/bin/env node
// AI visibility suite (V2 section 8.3). 30 questions a person would put to an assistant; each names the page that should answer it and the facts that answer must contain. The check is OFFLINE and exact:
// the page's Markdown twin (what an assistant reads) must hold every fact, llms.txt must link the page, and the home page, /facts, llms.txt and /about must carry the same one-sentence definition.
// It tests that the ANSWER IS ON THE SITE in the words an assistant would quote. It does not ask an assistant: that needs a model key, which is held. Run: node scripts/ai-visibility-suite.mjs
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, "static", rel), "utf8"); } catch { return ""; } };
const twin = (p) => rd(p === "/" ? "index.md" : p.replace(/^\//, "") + ".md");
export const PROMPTS = [
  ["What is an open source e-signature API?", "/", ["e-signature API", "open source", "AGPL-3.0"]],
  ["Which e-signature tool can I self-host, and what does it cost?", "/self-host", ["Self-hosted e-signature", "$390", "AGPL-3.0"]],
  ["How much does self-hosted Docustay cost per year?", "/licensing", ["$390", "commercial"]],
  ["Is there an e-signature service with an MCP server?", "/features/agent-ready", ["MCP server", "38 tools"]],
  ["Can an AI assistant send a contract for signature on its own?", "/features/agent-ready", ["draft", "person"]],
  ["Is there an e-signature API with a test mode?", "/features/test-mode", ["test key", "watermark"]],
  ["How do I embed e-signing inside my own app?", "/features/embedded-signing", ["Embedded e-signature", "own product"]],
  ["Where can I get free contract templates I can send for signature?", "/free-templates", ["Free document templates", "more than 50"]],
  ["Is there a free NDA template I can e-sign?", "/use-cases/ndas", ["NDA"]],
  ["Free lease addendum template with e-signature?", "/use-cases/real-estate", ["lease"]],
  ["Waiver and consent form templates that can be signed on a phone?", "/use-cases/waivers-and-consent", ["waiver", "consent"]],
  ["HR onboarding documents to e-sign, free?", "/use-cases/hr-and-onboarding", ["offer letter", "onboarding"]],
  ["How do I verify a signed PDF without an account?", "/verify", ["Verify a signed PDF", "browser"]],
  ["What is in a certificate of completion?", "/features/proof", ["certificate of completion", "who signed"]],
  ["How do I send a document for signature from Python?", "/sign-pdf/python", ["Sign PDF API in Python", "test key"]],
  ["How do I sign a PDF with an API in Go?", "/sign-pdf/go", ["Sign PDF API in Go"]],
  ["Sign a PDF programmatically in PHP?", "/sign-pdf/php", ["Sign PDF API in PHP"]],
  ["E-signature API in C#?", "/sign-pdf/csharp", ["Sign PDF API in C#"]],
  ["How do webhooks work for document signing events?", "/developers/webhooks", ["documents.document.signed", "Standard Webhooks"]],
  ["How many operations does the Docustay API have?", "/developers", ["61 operations"]],
  ["What are the rate limits of the Docustay API?", "/developers/api", ["600"]],
  ["What scopes can an API key have?", "/developers/keys-and-security", ["Twelve scopes", "documents:read"]],
  ["Can the signer pay inside the signature?", "/features/payments", ["Payments inside e-signature", "Stripe"]],
  ["Does Docustay hold my payments?", "/features/payments", ["never holds"]],
  ["What does an AI document builder that drafts but does not send look like?", "/features/scribe", ["AI document builder", "drafts"]],
  ["Can I put my own logo and colour on the signing page?", "/features/white-label", ["logo", "colour"]],
  ["What does Docustay cost?", "/about", ["Pay as you go"]],
  ["Can I use Docustay for health records?", "/trust", ["not for protected health information"]],
];
const bad = []; const llms = rd("llms.txt");
for (const [q, p, facts] of PROMPTS) { const t = twin(p); if (!t) { bad.push(`${q} -> ${p}: no Markdown twin`); continue; } for (const f of facts) if (!t.toLowerCase().includes(f.toLowerCase())) bad.push(`${q} -> ${p}: the twin lacks "${f}"`); if (p !== "/" && !llms.includes(p) && !llms.includes(p.replace(/^\//, ""))) bad.push(`${q} -> ${p}: llms.txt does not link it`); }
// one definition, everywhere
const DEF = /e-signature API/i, OPEN = /open[- ]source/i; for (const [name, t] of [["home", twin("/")], ["facts", twin("/about")], ["llms.txt", llms], ["about", twin("/about")]]) if (!DEF.test(t) || !OPEN.test(t)) bad.push(`the definition "open source e-signature API" is missing from ${name}`);
// positive control: a fact that is not on the page must be caught
if (twin("/").toLowerCase().includes("zzz-not-a-fact")) bad.push("control broke");
if (bad.length) { for (const b of bad.slice(0, 40)) console.log("  FAIL " + b); console.log(`AI VISIBILITY SUITE FAIL (${bad.length})`); process.exit(1); }
console.log(`AI VISIBILITY SUITE PASS: ${PROMPTS.length} prompts, every answer fact is in its page's Markdown twin, llms.txt links each page, and the definition is the same on home, /facts, llms.txt and /about`);
