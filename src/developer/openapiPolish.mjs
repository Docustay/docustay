// src/developer/openapiPolish.mjs — FP-C5: turns the registry's raw OpenAPI document into the published one: a server, contact and licence, a description that matches the product today, a name (operationId)
// for every operation, descriptions for the tags, the headers every answer carries, and a ready-to-run code sample (curl, JavaScript, Python) on every operation. Pure: the same input always gives the same output.
import { OPERATIONS } from "./operations.mjs";
import { docustayScopes } from "./scopes.mjs";

export const API_VERSION = "2026-10-07";   // the date-stamped version every answer reports in the Docustay-Version header

const resolve = (doc, s) => (s?.$ref ? resolve(doc, s.$ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], doc)) : s);
/** A small example value for a schema (an `example` the registry gave wins). */
export function sample(doc, schema, depth = 0) {
  const s = resolve(doc, schema);
  if (!s || depth > 4) return null;
  if (s.example !== undefined) return s.example;
  if (s.enum) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  if (type === "object" || s.properties) return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, sample(doc, v, depth + 1)]));
  if (type === "array") return [sample(doc, s.items, depth + 1)];
  if (type === "integer" || type === "number") return s.minimum ?? 1;
  if (type === "boolean") return false;
  if (s.format === "uuid") return "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e";
  if (s.format === "email") return "person@example.com";
  return "string";
}

const TAGS = [
  ["Documents", "Make a document, send it to people to sign and follow it to the signed copy."],
  ["Templates", "Reusable documents with seats for the people who fill them. Make one from HTML, a file or words, then send it again and again."],
  ["Email", "What the emails about your documents say, and the log of what was sent and what happened to it."],
  ["Reports", "Counts of what was sent and completed."],
  ["Teams", "Teams and their members."],
  ["Account", "Your plan, your usage and whether payments are ready."],
  ["Webhooks", "Where Docustay tells your software that something happened. Add an address (or a relay to your own computer), test it, rotate its secret."],
  ["Plays", "Rules your assistant follows when it starts a document (Pro)."],
];

const DESCRIPTION = [
  "Send documents for signature and follow them, from your own software.",
  "**Authentication.** Send `Authorization: Bearer <key>`. Make keys in Settings → Developers → API keys and give each only the scopes it needs (there are " + docustayScopes().length + " in all): " + docustayScopes().map((s) => "`" + s + "`").join(", ") + ". A key that starts `dsk_test_` works in **test mode**: documents it sends are practice runs (emailed only to the sender, stamped TEST, never counted or billed), it can only see and act on test documents (any other document answers `404`), and it can sign them itself with `POST /api/v1/documents/{id}/test-sign`. A key can also be limited to a list of addresses, given an expiry, or made **draft-only**.",
  "**Draft-only keys.** A draft-only key can make and edit drafts but cannot send. Asking it to send answers `202` with an `approval`, the document stays a draft, and a person approves or declines in Settings → Developers → Approvals. Keys can also have a daily limit of drafts and sends; past it you get `429`.",
  "**Payments.** A template may contain payment fields (text tag `type=payment` with a set `amount`, optionally a `deposit`, or an amount you give when you send it with `amount=custom.<name>`). The signer pays on Stripe's hosted page; the money goes to your own connected Stripe account; Docustay's fee is 2% on the Free plan and 0% on Pro, plus Stripe's own fees. The document's `payments` list shows each payment, its receipt and the fee. Card details never reach Docustay.",
  "**Idempotency.** Requests that create a document or a template, or send one, need an `Idempotency-Key` header (8–200 characters). Repeating a request with the same key and body returns the first answer instead of doing it twice.",
  "**Your own reference.** Documents and templates take `externalId` (your id for it) and `metadata` (up to 20 short key/value pairs). List with `externalId=` or `metadata[key]=value` to find them again, and both come back in webhooks.",
  "**Errors.** Every error is `{ \"error\": { \"kind\", \"message\", \"requestId\", \"retryable\" } }`. `kind` is one of `invalid`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `dependency`, `timeout`. Quote the `requestId` to support, or search it in Settings → Developers → API log. **Plan limits** are `403 forbidden` with `error.detail.code`: `plan_document_limit` (the plan's documents this month are used), `plan_signer_limit` (Free: 15 different signers a month; sending again to someone already sent to this month never counts) or `plan_template_limit` (Free: 5 and Pay as you go: 25 new templates a month; a new version of a template you have does not count). All carry `detail.used`, `detail.limit` and `detail.resetsAt` (the first of next month, UTC). Everything already made keeps working. Pro, Lifetime and self-hosted installs have no template or signer limit.",
  "**Rate limits.** Each key has its own per-minute budget. Every answer carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds); over the budget you get `429` with a `Retry-After` header.",
  "**Versions.** Every answer carries `Docustay-Version`, a date. A change that could break a caller gets a new date and is announced in the changelog before it ships; additions (a new field, a new route) are not breaking and do not change the date.",
  "**Pagination.** Lists take `limit` (1–200) and `cursor`; the answer carries `page.nextCursor` (null on the last page).",
  "**Signing links.** No response contains a signing link or access code, with one exception you control: a seat you send in `embedded` can be given an embedded signing session (`POST /api/v1/documents/{id}/embed-session`), a one-hour link for a frame on a website you listed. A key can start and follow a signature, and put your own signer in front of the form for seats you marked yourself; it cannot sign for anyone.",
].join("\n\n");

export const BASE_CONFIG = Object.freeze({
  openapi: "3.1.0",
  info: {
    title: "Docustay API", version: API_VERSION, description: DESCRIPTION,
    termsOfService: "https://docustay.app/legal/terms",
    contact: { name: "Docustay support", url: "https://docustay.app/contact", email: "support@docustay.app" },
    license: { name: "AGPL-3.0-or-later (server); the SDKs are MIT. The hosted API is used under the Terms.", url: "https://docustay.app/docs/licensing" },
    "x-api-version": API_VERSION,
  },
  servers: [
    { url: "https://{host}", description: "Docustay (hosted) or your own install", variables: { host: { default: "app.docustay.app", description: "app.docustay.app for the hosted service; your own address when you self-host." } } },
  ],
});

const HEADERS = {
  "Docustay-Version": { description: "The API version (a date) that answered.", schema: { type: "string", example: API_VERSION } },
  "RateLimit-Limit": { description: "This key's requests allowed per minute.", schema: { type: "integer", example: 600 } },
  "RateLimit-Remaining": { description: "Requests left in the current minute.", schema: { type: "integer", example: 598 } },
  "RateLimit-Reset": { description: "Seconds until the current minute ends.", schema: { type: "integer", example: 41 } },
};

const q = (s) => JSON.stringify(s);
function samples(doc, method, path, op, js) {
  const body = op.requestBody?.content?.["application/json"]?.schema;
  const pathParams = (op.parameters ?? []).filter((p) => p.in === "path");
  const url = "https://app.docustay.app" + path.replace(/\{(\w+)\}/g, (_, n) => `{${n}}`);
  const bodyVal = body ? sample(doc, body) : undefined;
  const needsKey = /Idempotency-Key/i.test(op.description ?? "") || (method === "post" && /Idempotency/.test(JSON.stringify(op.parameters ?? [])));
  const curl = [`curl -X ${method.toUpperCase()} "${url}" \\`, `  -H "Authorization: Bearer $DOCUSTAY_API_KEY" \\`, ...(needsKey ? [`  -H "Idempotency-Key: $(uuidgen)" \\`] : []), ...(body ? [`  -H "Content-Type: application/json" \\`, `  -d '${JSON.stringify(bodyVal)}'`] : [`  -H "Accept: application/json"`])].join("\n").replace(/ \\\n(  -H "Accept: application\/json")$/, " \\\n$1");
  const args = [...pathParams.map((p) => q(sample(doc, p.schema) ?? "id")), ...(bodyVal !== undefined ? [JSON.stringify(bodyVal)] : [])].join(", ");
  const jsCode = `import { Docustay } from "@docustay2026/sdk";\n\nconst docustay = new Docustay(process.env.DOCUSTAY_API_KEY);\nconst result = await docustay.${js}(${args});\nconsole.log(result);`;
  const pyUrl = url.replace(/\{(\w+)\}/g, (_, n) => `{${n}}`);
  const pyCode = `import os, requests\n\nr = requests.${method}(\n    f"${pyUrl.replace(/\{(\w+)\}/g, "{" + "$1" + "}")}",\n    headers={"Authorization": f"Bearer {os.environ['DOCUSTAY_API_KEY']}"${needsKey ? ', "Idempotency-Key": __import__("uuid").uuid4().hex' : ""}},${bodyVal !== undefined ? `\n    json=${JSON.stringify(bodyVal)},` : ""}\n)\nr.raise_for_status()\nprint(r.json())`;
  return [{ lang: "curl", label: "curl", source: curl }, { lang: "JavaScript", label: "JavaScript (SDK)", source: jsCode }, { lang: "Python", label: "Python (requests)", source: pyCode }];
}

/** The operations whose route refuses a request without an `Idempotency-Key` header (src/routes/developerDocuments.mjs, developerRun9.mjs). Found by Schemathesis (OI-010): the header was only in the prose, so a client built from the file could not make these calls. */
export const IDEMPOTENT_OPERATIONS = Object.freeze(["POST /api/v1/documents", "POST /api/v1/documents/send", "POST /api/v1/documents/{id}/revise", "POST /api/v1/documents/{id}/send", "POST /api/v1/payments/{id}/refund", "POST /api/v1/templates/file", "POST /api/v1/templates/html", "POST /api/v1/templates/source", "POST /api/v1/templates/{id}/documents"]);
const IDEMPOTENCY_PARAMETER = Object.freeze({ name: "Idempotency-Key", in: "header", required: true, description: "A unique value for this request (8–200 characters, for example a UUID). Repeating the request with the same key and body returns the first answer instead of doing it twice.", schema: { type: "string", minLength: 8, maxLength: 200 } });

/** A response may gain fields without a new API version ("additions are not breaking": the versions note), so a response object is OPEN. Without this a strict generated client (Go's decoder refuses unknown fields) fails on an answer that is correct: found 15 Oct 2026 running the Go client against `POST /documents/send`, which answers `externalId` and `metadata` that the schema did not list, and by walking 19 read operations (37 more undocumented fields). Request bodies stay closed. */
function openResponse(o, doc, seen = new Set()) { if (!o || typeof o !== "object") return; if (o.$ref) { const name = o.$ref.split("/").pop(); if (seen.has(name)) return; seen.add(name); return openResponse(doc.components?.schemas?.[name], doc, seen); } if (o.type === "object" && o.additionalProperties === undefined) o.additionalProperties = true; for (const v of Object.values(o.properties ?? {})) openResponse(v, doc, seen); openResponse(o.items, doc, seen); for (const k of ["allOf", "anyOf", "oneOf"]) for (const x of o[k] ?? []) openResponse(x, doc, seen); if (o.additionalProperties && typeof o.additionalProperties === "object") openResponse(o.additionalProperties, doc, seen); }

/** The published document: the registry's document plus everything above. Throws when an operation has no name, so a new route cannot ship unnamed. */
export function polish(raw) {
  const doc = structuredClone(raw);
  doc.tags = TAGS.map(([name, description]) => ({ name, description }));
  doc.components = { ...(doc.components ?? {}), headers: { ...(doc.components?.headers ?? {}), ...HEADERS } };
  const ref = Object.fromEntries(Object.keys(HEADERS).map((h) => [h, { $ref: `#/components/headers/${h}` }]));
  doc.security = [{ bearerAuth: [] }];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const names = OPERATIONS[`${method.toUpperCase()} ${path}`];
      if (!names) throw new Error(`openapi: ${method.toUpperCase()} ${path} has no entry in src/developer/operations.mjs — name it (and add the SDK methods)`);
      op.operationId = names[0];
      if (IDEMPOTENT_OPERATIONS.includes(`${method.toUpperCase()} ${path}`) && !(op.parameters ?? []).some((p) => p.in === "header" && /^idempotency-key$/i.test(p.name))) op.parameters = [...(op.parameters ?? []), structuredClone(IDEMPOTENCY_PARAMETER)];
      for (const [code, res] of Object.entries(op.responses ?? {})) if (/^2/.test(code)) { res.headers = { ...ref, ...(res.headers ?? {}) }; for (const c of Object.values(res.content ?? {})) openResponse(c.schema, doc); }
      // Run 8 S3: every operation that names something in its path answers 404 when it does not exist — or belongs to another workspace (the two answers are the same, on purpose). Say so.
      if (/\{[^}]+\}/.test(path) && !op.responses?.["404"] && op.responses?.["400"]) op.responses["404"] = { ...structuredClone(op.responses["400"]), description: "Not found: nothing with that id or name in this workspace (something in another workspace answers exactly the same)." };
      op["x-codeSamples"] = samples(doc, method, path, op, names[0]);
    }
  }
  // a boolean that can only be one value (`enum: [true]`) is written as a plain boolean with an example: the C# generator turns the enum into `True = true` inside an int enum and the client does not compile
  const flatten = (o) => { if (o && typeof o === "object") { if (o.type === "boolean" && Array.isArray(o.enum) && o.enum.length === 1) { o.example = o.enum[0]; delete o.enum; } for (const v of Object.values(o)) flatten(v); } };
  flatten(doc);
  return doc;
}
