// "Sign a PDF with …" pages: one template, one entry per language. Every snippet here is RUN against the sandbox by docustay/web/scripts/signpdf-proof.mjs (it reads this file), so a page never shows code nobody ran.
// A snippet reads DOCUSTAY_API_KEY and DOCUSTAY_TEMPLATE_ID (and DOCUSTAY_URL when not the hosted service) and prints the document id and its state.
export const SIGNPDF = [
  { slug: "javascript", notes: "The package has no dependencies and needs Node 18 or newer. It makes one Idempotency-Key for each call and reuses it on every retry, so a network retry never sends the document twice. It is an ES module, so use import, or a .mjs file.", name: "JavaScript", ext: "mjs", run: ["node", "{file}"], sdk: true, install: "npm install @docustay2026/sdk",
    code: `import { Docustay } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const doc = await docustay.sendDocument({
  templateId: process.env.DOCUSTAY_TEMPLATE_ID,
  parties: [{ seat: "signer_1", name: "Pat Example", email: "pat@example.com" }],
});
console.log(doc.id, doc.state);` },
  { slug: "typescript", notes: "The types ship inside the package: SendRequest describes what you send and the answer is typed too, so a wrong field name fails in your editor and not at 2 a.m. The program runs as it stands on Node 22 and newer with --experimental-strip-types; elsewhere compile it with tsc as usual.", name: "TypeScript", ext: "ts", run: ["node", "--experimental-strip-types", "{file}"], sdk: true, install: "npm install @docustay2026/sdk",
    code: `import { Docustay, type SendRequest } from "@docustay2026/sdk";

const docustay = new Docustay(process.env.DOCUSTAY_API_KEY!, process.env.DOCUSTAY_URL ? { baseUrl: process.env.DOCUSTAY_URL } : {});
const request: SendRequest = {
  templateId: process.env.DOCUSTAY_TEMPLATE_ID!,
  parties: [{ seat: "signer_1", name: "Pat Example", email: "pat@example.com" }],
};
const doc = await docustay.sendDocument(request);
console.log(doc.id, doc.state);` },
  { slug: "python", notes: "The package has no dependencies and needs Python 3.9 or newer. Calls are synchronous and return plain dictionaries. Every POST gets an idempotency key made for it and reused on retries. Pass base_url only when you point at a self-hosted install.", name: "Python", ext: "py", run: ["python3", "{file}"], sdk: true, install: "pip install docustay",
    code: `import os
from docustay import Docustay

kw = {"base_url": os.environ["DOCUSTAY_URL"]} if os.environ.get("DOCUSTAY_URL") else {}
docustay = Docustay(os.environ["DOCUSTAY_API_KEY"], **kw)
doc = docustay.send_document(
    os.environ["DOCUSTAY_TEMPLATE_ID"],
    [{"seat": "signer_1", "name": "Pat Example", "email": "pat@example.com"}],
)
print(doc["id"], doc["state"])` },
];
export const bySlug = (s) => SIGNPDF.find((x) => x.slug === s) ?? null;
