// QUEUE §23.5.8 — THE DOCUMENTS REST API, behind a developer's API key (`Authorization: Bearer gl_live_…` / test key), documented with OpenAPI (`/api/v1/openapi.json`) and a Scalar reference page (`/api/v1/docs`).
// Host-side on purpose: the key check, the scope map (src/developer/scopes.mjs ROUTE_SCOPES) and idempotency are the host's; Documents is reached only through its front door.
// ★ A key may start and follow a signature, never sign for anyone: no response carries a signing link, link token or access code. Reads need `documents:read`, the two writes need `documents:write`.
// ★ POST /send needs an Idempotency-Key header (a retry must not email people twice).
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { polish, BASE_CONFIG } from "../developer/openapiPolish.mjs";
import { registerWebhooksV1 } from "./developerWebhooks.mjs";
import { registerBuilderV1 } from "./developerBuilder.mjs";
import { invalid, notFound, forbidden, unauthenticated } from "../http/errors.mjs";
import { registerPlaysV1, registerLibraryV1 } from "./developerPlays.mjs";
import { registerFormsV1 } from "./developerForms.mjs";
import { requireIdempotencyKey, withIdempotency, fingerprint } from "../http/idempotency.mjs";
import { decodeCursor } from "./index.mjs";
import { apiUsage, apiAiUsage, apiDetectFields } from "../product/docustay.mjs";
import { registerRun9V1 } from "./developerRun9.mjs";
import { paymentsStatus } from "../product/docustayPayments.mjs";
import { listEmailMessages, saveEmailMessage, resetEmailMessage, previewEmailMessage, listEmails, apiTestSign, referenceFilter, saveTemplateReference, cleanReference, apiListDocuments, apiGetDocument, apiTemplates, apiSendFromTemplate, apiCreateDocument, apiUseTemplate, apiReviseDocument, apiSendDraft, apiDraftSource, apiCheckSource, apiTemplateDefaults, apiWizard, cancelAiJob, apiVoid, apiSignedCopy, selfServeOwner, createTemplateFromSource, saveSourceTemplate, createAiJob, getAiJob, apiTemplate, apiRemind, apiEmbedSession, assertTestKeyMay, auditLogCsv, listTeams, documentReport, LANGUAGES, policyFor, currentKeyId, countAgainstLimit, requestSendApproval, contentDisposition } from "../documents/frontDoor.mjs";

/**
 * The document list pages by KEYSET, not offset (Round 3, R-14): with an offset, a document created while someone pages through shifts every row down one, so the next page repeats a row (measured: 65 rows, 64 unique, 7 pages).
 * The cursor names the last row seen (its created-at at microsecond precision, and its id); the next page is everything after it. A cursor from before this change (an offset) is still understood.
 */
const CURSOR_T = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/, CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encodeDocumentCursor = ({ t, id }) => Buffer.from(JSON.stringify({ k: [t, id] }), "utf8").toString("base64url");
function parseDocumentCursor(s) {
  if (typeof s === "string" && s.length > 0 && s.length <= 160) {
    try {
      const p = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
      if (p && Array.isArray(p.k) && p.k.length === 2 && CURSOR_T.test(p.k[0]) && CURSOR_ID.test(p.k[1]) && encodeDocumentCursor({ t: p.k[0], id: p.k[1] }) === s) return { after: { t: p.k[0], id: p.k[1] } };
    } catch { /* fall through to the old form */ }
  }
  return { offset: decodeCursor(s) };   // an offset cursor from an earlier version, or a 400 naming `cursor`
}


const Id = z.string().uuid().openapi({ example: "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e" });
const Err = z.object({ error: z.object({ kind: z.enum(["validation", "unauthenticated", "forbidden", "not_found", "conflict", "unprocessable", "rate_limited", "dependency", "timeout", "internal"]).openapi({ example: "validation" }), message: z.string().openapi({ example: "parties[0].email is not a valid address" }), requestId: z.string().optional(), retryable: z.boolean().optional(), detail: z.record(z.string(), z.any()).optional() }) }).openapi("Error");
const Meta = z.record(z.string(), z.string()).openapi({ description: "Your own key-value text (up to 20 keys; keys 1–40 letters, digits, dot, dash or underscore; values up to 500 characters). Returned in every response and every webhook for this document; never shown to a signer.", example: { crmDealId: "D-1042" } });
const ExternalId = z.string().min(1).max(200).openapi({ description: "Your own id for this thing, so you can match it to your records. Filter lists with `externalId=`.", example: "contract-2026-0042" });
const EmailChoice = z.object({ subject: z.string().max(200).optional(), message: z.string().max(4000).optional(), replyTo: z.string().email().optional().openapi({ description: "Where replies to this document's emails go." }),
  senderName: z.string().min(1).max(120).optional().openapi({ description: "The name the emails say they are from, for this document." }), locale: z.string().optional().openapi({ description: "The language of the emails (en, es, fr, …), or auto to match each person." }) })
  .openapi("EmailChoice", { description: "Your own wording for the emails about THIS document. The workspace's saved wording (Settings → Email templates) applies underneath; what you give here wins." });
// the grouped `email` object is the friendly spelling of the send choices
const emailChoice = (e) => (e ? { subject: e.subject, message: e.message, replyTo: e.replyTo, senderName: e.senderName, language: e.locale === "auto" ? undefined : e.locale } : {});
const Party = z.object({ seat: z.string(), externalId: ExternalId.nullable(), metadata: Meta, name: z.string(), email: z.string().nullable(), role: z.string(), status: z.string(), viewedAt: z.string().nullable(), completedAt: z.string().nullable(), declineReason: z.string().nullable() }).openapi("Party");
const Summary = z.object({ externalId: ExternalId.nullable(), metadata: Meta, test: z.boolean().openapi({ description: "True for a document made in test mode (a test API key or the workspace's test switch)." }), id: Id, title: z.string(), state: z.string(), parties: z.number().int(), createdAt: z.string().nullable(), sentAt: z.string().nullable(), executedAt: z.string().nullable(), expiresAt: z.string().nullable() }).openapi("DocumentSummary");
const Payment = z.object({ id: Id, fieldId: z.string().nullable(), person: z.string(), status: z.enum(["pending", "paid", "partially_refunded", "refunded", "expired"]).openapi({ description: "`paid` once Stripe says so. A refund moves it to `partially_refunded` or `refunded`." }),
  amountMinor: z.number().int().openapi({ description: "What was charged, in the smallest unit of `currency` (cents). Worked out on the server; never taken from the browser.", example: 15000 }), currency: z.string().openapi({ example: "usd" }), paidAt: z.string().nullable(),
  receiptUrl: z.string().nullable().openapi({ description: "Stripe's own receipt for the payment." }), refundedMinor: z.number().int(),
  fee: z.object({ basisPoints: z.number().int().openapi({ description: "Docustay's fee, decided when the payment started: 200 (2%) on the Free plan, 0 on Pro.", example: 200 }), amountMinor: z.number().int().openapi({ example: 300 }), refundedMinor: z.number().int().openapi({ description: "How much of the fee went back with refunds." }), plan: z.string().nullable() }).openapi({ description: "Docustay's platform fee on this payment, on top of Stripe's own fees (which Stripe charges to your own Stripe account)." }),
  test: z.boolean() }).openapi("Payment");
const Detail = z.object({
  externalId: ExternalId.nullable(), metadata: Meta, test: z.boolean(), id: Id, title: z.string(), state: z.string(), sentAt: z.string().nullable(), expiresAt: z.string().nullable(), executedAt: z.string().nullable(), voidedAt: z.string().nullable(), voidReason: z.string().nullable(),
  progress: z.object({ signed: z.number().int(), of: z.number().int() }), signedCopyAvailable: z.boolean(), parties: z.array(Party), payments: z.array(Payment).openapi({ description: "Payments made through payment fields on this document (empty when it has none). A payment field's amount is set by ONE of: a fixed amount, a formula over the signer's own fields, a Stripe price, or a Stripe payment link — see the text tag settings `amount`, `formula`, `price` and `link`." }), events: z.array(z.object({ at: z.string().nullable(), kind: z.string(), text: z.string() })),
}).openapi("Document");
const Template = z.object({ externalId: ExternalId.nullable().optional(), metadata: Meta.optional(), id: Id, name: z.string(), pages: z.number().int().nullable(), seats: z.array(z.object({ key: z.string(), label: z.string() })) }).openapi("Template");
const SendBody = z.object({
  templateId: Id, email: EmailChoice.optional(), metadata: Meta.optional(), externalId: ExternalId.optional(), title: z.string().max(200).optional(), message: z.string().max(5000).nullable().optional(), subject: z.string().max(200).optional(),
  language: z.enum(LANGUAGES).optional(), expiryDays: z.number().int().min(1).max(365).optional(),
  embedded: z.array(z.string()).optional().openapi({ description: "Seats signed inside your own app instead of by emailed link (for example [\"signer_1\"]). Nobody is emailed for these seats: you ask for a session with POST /api/v1/documents/{id}/embed-session and show it on a website you listed under Settings → Developers → Embedding." }),
  parties: z.array(z.object({ seat: z.string(), name: z.string().min(1), email: z.string().email().max(254).refine((e) => e.split("@")[0].length <= 64, "the part before the @ is at most 64 characters"), externalId: ExternalId.optional(), metadata: Meta.optional() })).min(1).openapi({ description: "One entry for each seat of the template (see GET /api/v1/documents/templates)." }),
}).openapi("SendRequest");
const TemplateMade = z.object({ externalId: ExternalId.nullable().optional(), metadata: Meta.optional(), templateId: Id, fields: z.number().int(), warnings: z.array(z.object({ tag: z.string(), warning: z.string() })), detected: z.object({ fields: z.number().int(), signers: z.number().int(), lowConfidence: z.number().int(), placed: z.number().int() }).optional().openapi({ description: "Present when the page itself was looked at (a file without text tags): how many fields were found, how many seats, how many it was unsure of, and how many were placed (`fields: auto`)." }) }).openapi("TemplateMade");
const HtmlTemplateBody = z.object({ metadata: Meta.optional(), externalId: ExternalId.optional(), name: z.string().min(1).max(200), html: z.string().min(1).openapi({ description: "HTML with text tags such as {{Tenant signature;type=signature;role=Tenant}}. Scripts, styles, frames, forms and remote addresses are removed; pictures must be data: addresses. Up to 2 MB." }), paper: z.enum(["letter", "a4"]).optional() }).openapi("HtmlTemplateRequest");
const FileTemplateBody = z.object({ metadata: Meta.optional(), externalId: ExternalId.optional(), name: z.string().min(1).max(200), fileName: z.string().min(1).max(255), file: z.string().min(1).openapi({ description: "The file, base64-encoded: a PDF file with text tags written in it." }), fields: z.enum(["tags", "auto"]).optional().openapi({ description: "`tags` (default) places fields only where a text tag is written. `auto` also looks at the page itself — lines, boxes, tick boxes, highlighted bars and the words beside them — and places the fields it is confident about, with the people grouped into seats." }), minConfidence: z.number().min(0).max(1).optional().openapi({ description: "With `fields: auto`: the least sure a field may be and still be placed (default 0.6)." }) }).openapi("FileTemplateRequest");
const bearerSec = [{ bearerAuth: [] }];
// A gl_test_ key acts on test documents only (the key's prefix is the host's own reading of the bearer, as for the send route).
const testKey = (c) => /^Bearer\s+(?:gl|dsk)_test_/i.test(c.req.header("authorization") ?? "");
const guard = (c, db, id) => assertTestKeyMay(db, { instanceId: id, testOnly: testKey(c) });
const errBody = (description, example) => ({ description, content: { "application/json": { schema: Err, example: { error: example } } } });
const errs = {
  400: errBody("The request is not valid. `message` says which field and why.", { kind: "validation", message: "parties[0].email is not a valid address", retryable: false }),
  401: errBody("The key is missing, wrong, revoked, or lacks the scope. Every credential failure gets this same answer.", { kind: "unauthenticated", message: "the API token is not valid", retryable: false }),
  403: errBody("The key is valid but not allowed to do this (a plan limit, or the action is not permitted for keys).", { kind: "forbidden", message: "this key is not permitted", retryable: false }),
  429: errBody("Too many requests. Wait `Retry-After` seconds, then try again.", { kind: "rate_limited", message: "rate limit exceeded for this API key", retryable: true }),
};

/**
 * ★ A key request has no signed-in person, and Documents' row-level security shows nothing to nobody. So — AFTER the key and its scope have been checked — the request acts as the practice's owner for the rest of its
 *   transaction (the same person self-serve links and the owner-notices use). That is the delegation a key with `documents:*` means: the owner's reach over uploaded documents, through these six routes and no others.
 */
const asOwner = async (db) => { const id = await selfServeOwner(db); await db.query("SELECT set_config('keystone.user_id', $1, true)", [id]); return id; };

/** True when any text anywhere in a validated request (a string value or an object key) holds a NUL character — Postgres cannot store one, so it is refused up front as a 400 (Round 3, W1-6). */
const hasNul = (v) => (typeof v === "string" ? v.includes(String.fromCharCode(0)) : Array.isArray(v) ? v.some(hasNul) : v && typeof v === "object" ? Object.entries(v).some(([k, x]) => hasNul(k) || hasNul(x)) : false);

export function registerDocumentsV1(app, { tokenRoute }) {
  const api = new OpenAPIHono({ defaultHook: (r) => { if (!r.success) throw invalid(r.error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ")); if (hasNul(r.data)) throw invalid("text cannot contain a NUL character"); } });
  // Schemathesis (OI-010, 15 Oct 2026): a request with NO bearer key at all got a field-level 400 (the body check, or the Idempotency-Key check) before it ever got a 401. Credentials first: the answer to "who are you" never depends on the body.
  // (A key that is present but wrong still reaches the route and gets the same single 401 from the key check; the two documentation routes stay open.)
  api.use("/api/v1/*", async (c, next) => { if (c.req.path !== "/api/v1/openapi.json" && c.req.path !== "/api/v1/docs" && !/^Bearer\s+\S/i.test(c.req.header("authorization") ?? "")) throw unauthenticated("the API token is not valid"); await next(); });
  api.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer", description: "A developer API key from Settings → Developer. Test keys act on test documents only." });
  const run = (c, method, path, fn) => tokenRoute(c, method, path, fn);

  api.openapi(createRoute({ method: "get", path: "/api/v1/documents/templates", tags: ["Documents"], summary: "Templates you can send", security: bearerSec,
    responses: { 200: { description: "Approved, current templates.", content: { "application/json": { schema: z.object({ templates: z.array(Template) }) } } }, ...errs } }),
  async (c) => c.json({ templates: await run(c, "GET", "/api/v1/documents/templates", async (db) => { await asOwner(db); return apiTemplates(db); }) }, 200));

  api.openapi(createRoute({ method: "get", path: "/api/v1/documents", tags: ["Documents"], summary: "List documents", security: bearerSec,
    description: "Filter by your own reference: `externalId=…`, and `metadata[key]=value` (repeat for more keys; a document must match all).",
    request: { query: z.object({ state: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional(), cursor: z.string().optional(), externalId: z.string().max(200).optional().openapi({ description: "Only documents with this `externalId`." }) }) },
    responses: { 200: { description: "A page of documents, newest first.", content: { "application/json": { schema: z.object({ documents: z.array(Summary), page: z.object({ limit: z.number().int(), nextCursor: z.string().nullable(), hasMore: z.boolean() }) }) } } }, ...errs } }),
  async (c) => {
    const q = c.req.valid("query"); const limit = q.limit ?? 50;
    const cur = q.cursor === undefined ? { offset: 0 } : parseDocumentCursor(q.cursor);
    const out = await run(c, "GET", "/api/v1/documents", async (db) => { await asOwner(db); return apiListDocuments(db, { testOnly: testKey(c), state: q.state ?? null, limit, offset: cur.offset ?? 0, after: cur.after ?? null, filter: referenceFilter(c.req.query(), 7) }); });
    return c.json({ documents: out.rows, page: { limit, nextCursor: out.hasMore && out.next ? encodeDocumentCursor(out.next) : null, hasMore: out.hasMore } }, 200);
  });

  api.openapi(createRoute({ method: "get", path: "/api/v1/documents/{id}", tags: ["Documents"], summary: "One document and where each person is", security: bearerSec,
    request: { params: z.object({ id: Id }) },
    responses: { 200: { description: "The document.", content: { "application/json": { schema: Detail } } }, 404: { description: "No such document.", content: { "application/json": { schema: Err } } }, ...errs } }),
  async (c) => {
    const { id } = c.req.valid("param");
    return c.json(await run(c, "GET", "/api/v1/documents/:id", async (db) => {
      await asOwner(db); await guard(c, db, id);
      const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`);
      return apiGetDocument(db, { tenantId: t.t, instanceId: id });
    }), 200);
  });

  api.openapi(createRoute({ method: "get", path: "/api/v1/documents/{id}/signed.pdf", tags: ["Documents"], summary: "Download the signed copy", security: bearerSec,
    request: { params: z.object({ id: Id }) },
    responses: { 200: { description: "The sealed PDF, with its certificate.", content: { "application/pdf": { schema: z.string().openapi({ format: "binary" }) } } }, 404: { description: "Not signed yet, or no such document.", content: { "application/json": { schema: Err } } }, ...errs } }),
  async (c) => {
    const { id } = c.req.valid("param");
    const file = await run(c, "GET", "/api/v1/documents/:id/signed.pdf", async (db) => {
      await asOwner(db); await guard(c, db, id);
      return apiSignedCopy(db, { instanceId: id });
    });
    return new Response(file.bytes, { status: 200, headers: { "content-type": "application/pdf", "cache-control": "no-store", "content-disposition": contentDisposition("attachment", `signed-${id}.pdf`) } });
  });

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/send", tags: ["Documents"], summary: "Send a template to people to sign", security: bearerSec,
    description: "Makes a document from the template, puts each person on their seat and sends it. Needs an `Idempotency-Key` header (8–200 characters): a retry with the same key and body does not send again.",
    request: { body: { content: { "application/json": { schema: SendBody } }, required: true } },
    responses: { 201: { description: "Sent.", content: { "application/json": { schema: z.object({ id: Id, state: z.string(), emailed: z.number().int().openapi({ description: "How many signing emails went out now." }), notEmailed: z.array(z.object({ seat: z.string(), email: z.string(), reason: z.string(), detail: z.string().nullable() })).openapi({ description: "Anyone who was NOT emailed, and why (for example `limit_reached`: the daily email limit). The document is still sent; fetch their link or send a reminder later." }) }) } } }, ...errs } }),
  async (c) => {
    const body = c.req.valid("json");
    const key = requireIdempotencyKey({ "idempotency-key": c.req.header("idempotency-key") });
    const out = await run(c, "POST", "/api/v1/documents/send", async (db) => {
      const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`);
      const op = await withIdempotency(db, t.t, key, fingerprint("POST", "/api/v1/documents/send", body), async () => {
        const ownerId = await asOwner(db);
        if ((await policyFor(db, await currentKeyId(db))).draftOnly) throw forbidden("this key can only make drafts: make one with POST /api/v1/templates/{id}/documents, then ask to send it — a person approves in the app");
        await countAgainstLimit(db, { tenantId: t.t, kind: "send" });
        return { status: 201, body: await apiSendFromTemplate(db, { tenantId: t.t, ownerId, ...body, ...Object.fromEntries(Object.entries(emailChoice(body.email)).filter(([, v]) => v !== undefined)), test: testKey(c) }) };
      });
      return op.failed ? { failed: op.error } : op.body;
    });
    if (out?.failed) throw out.failed;
    return c.json(out, 201);
  });

  const makeTemplate = (c, path, body, source, extra = {}) => {
    const key = requireIdempotencyKey({ "idempotency-key": c.req.header("idempotency-key") });
    return run(c, "POST", path, async (db) => {
      const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`);
      const op = await withIdempotency(db, t.t, key, fingerprint("POST", path, { ...body, file: body.file ? `sha:${body.file.length}` : undefined }), async () => {
        const ownerId = await asOwner(db);
        const ref = cleanReference({ metadata: body.metadata, externalId: body.externalId }); const made = await createTemplateFromSource(db, { tenantId: t.t, actorUserId: ownerId, name: body.name, source: source(body), paper: body.paper, ...extra }); await saveTemplateReference(db, made.templateId, ref); return { status: 201, body: { ...made, externalId: ref.externalId, metadata: ref.metadata } };
      });
      return op.failed ? { failed: op.error } : op.body;
    });
  };
  api.openapi(createRoute({ method: "post", path: "/api/v1/templates/html", tags: ["Templates"], summary: "Make a template from HTML with text tags", security: bearerSec,
    description: "Prints your HTML to a PDF and places a field wherever a text tag sits, then keeps the result as a template you can send with `POST /api/v1/documents/send`. Needs an `Idempotency-Key` header.",
    request: { body: { content: { "application/json": { schema: HtmlTemplateBody } }, required: true } },
    responses: { 201: { description: "The template.", content: { "application/json": { schema: TemplateMade } } }, ...errs } }),
  async (c) => { const out = await makeTemplate(c, "/api/v1/templates/html", c.req.valid("json"), (b) => ({ html: b.html })); if (out?.failed) throw out.failed; return c.json(out, 201); });

  api.openapi(createRoute({ method: "post", path: "/api/v1/templates/file", tags: ["Templates"], summary: "Make a template from a file with text tags", security: bearerSec,
    description: "Reads a PDF file, places a field wherever a text tag is written in it, and keeps the result as a template. Needs an `Idempotency-Key` header.",
    request: { body: { content: { "application/json": { schema: FileTemplateBody } }, required: true } },
    responses: { 201: { description: "The template.", content: { "application/json": { schema: TemplateMade } } }, ...errs } }),
  async (c) => { const out = await makeTemplate(c, "/api/v1/templates/file", c.req.valid("json"), (b) => ({ bytes: Buffer.from(b.file, "base64"), fileName: b.fileName }), { fieldsAuto: c.req.valid("json").fields === "auto", minConfidence: c.req.valid("json").minConfidence }); if (out?.failed) throw out.failed; return c.json(out, 201); });

  // ── Shared document engine (6 Oct 2026): a template from a document SOURCE, and an AI draft as a job a key can start and poll. An AI draft is only ever a suggestion: it makes no template and sends nothing. ──
  const SourceTemplateBody = z.object({ metadata: Meta.optional(), externalId: ExternalId.optional(), name: z.string().min(1).max(200), source: z.record(z.string(), z.any()).openapi({ description: "The document source: a ProseMirror/TipTap JSON document (`{type:\"doc\",content:[…]}`) using headings, paragraphs, lists, tables, `fieldTag`, `signatureBlock`, `variableChip`. See the guide on document sources." }), profile: z.enum(["typeset", "contract"]).optional(), paper: z.enum(["letter", "a4"]).optional() });
  const Brief = z.object({ type: z.string(), kind: z.string().optional(), answers: z.record(z.string(), z.string()).optional(), final: z.string(), payment: z.object({ collect: z.literal(true), amount: z.string().openapi({ description: "In major units, typed by the person (for example \"1500\"). The assistant never decides an amount.", example: "1500" }), currency: z.string().openapi({ example: "usd" }), payer_role: z.string().optional(), description: z.string(), schedule_note: z.string().optional() }).optional().openapi({ description: "A payment collected at signing. The worker (plain code) places the Payment field with exactly this amount; later payments are written as text." }) }).openapi("WizardBrief", { description: "The wizard's answers (see GET /api/v1/ai/wizard for the questions)." });
const AiDraftBody = z.object({ prompt: z.string().max(4000).optional(), brief: Brief.optional(), mode: z.enum(["template", "document"]).optional() }).refine((b) => b.prompt || b.brief, { message: "send a prompt or a brief" });
  const AiJob = z.object({ id: Id, state: z.enum(["queued", "running", "done", "failed", "cancelled"]), message: z.string().nullable().optional(), source: z.record(z.string(), z.any()).nullable().optional(), patches: z.record(z.string(), z.any()).nullable().optional() }).passthrough().openapi("AiDraftJob");
  api.openapi(createRoute({ method: "post", path: "/api/v1/templates/source", tags: ["Templates"], summary: "Make a template from a document source", security: bearerSec,
    description: "Keeps a document written in the shared editor's format as a template (profile `typeset` by default). Needs an `Idempotency-Key` header.",
    request: { body: { content: { "application/json": { schema: SourceTemplateBody } }, required: true } },
    responses: { 201: { description: "The template.", content: { "application/json": { schema: z.object({ templateId: Id, profile: z.string(), version: z.number().int(), hash: z.string(), warnings: z.array(z.any()) }).passthrough() } } }, ...errs } }),
  async (c) => {
    const body = c.req.valid("json"); const key = requireIdempotencyKey({ "idempotency-key": c.req.header("idempotency-key") });
    const out = await run(c, "POST", "/api/v1/templates/source", async (db) => {
      const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`);
      const op = await withIdempotency(db, t.t, key, fingerprint("POST", "/api/v1/templates/source", body), async () => {
        const ownerId = await asOwner(db);
        const ref = cleanReference({ metadata: body.metadata, externalId: body.externalId }); const made = await saveSourceTemplate(db, { tenantId: t.t, actorUserId: ownerId, name: body.name, source: body.source, profile: body.profile ?? "typeset", origin: "written", paper: body.paper ?? "letter" }); await saveTemplateReference(db, made.templateId, ref); return { status: 201, body: { ...made, externalId: ref.externalId, metadata: ref.metadata } };
      });
      return op.failed ? { failed: op.error } : op.body;
    });
    if (out?.failed) throw out.failed; return c.json(out, 201);
  });
  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/ai/draft", tags: ["Documents"], summary: "Ask for an AI-written draft", security: bearerSec,
    description: "Starts a draft and answers at once with a job id; poll `GET /api/v1/documents/ai/jobs/{id}`. The draft is a suggestion for a person to read; nothing is saved or sent. Refused plainly when AI drafting is switched off for the workspace or a limit is reached.",
    request: { body: { content: { "application/json": { schema: AiDraftBody } }, required: true } },
    responses: { 202: { description: "Started.", content: { "application/json": { schema: z.object({ jobId: Id, state: z.string() }) } } }, ...errs } }),
  async (c) => {
    const body = c.req.valid("json");
    const out = await run(c, "POST", "/api/v1/documents/ai/draft", async (db) => {
      const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); const ownerId = await asOwner(db);
      return createAiJob(db, { tenantId: t.t, actorUserId: ownerId, prompt: body.prompt ?? "", brief: body.brief ?? null, mode: body.mode ?? "template", vocabulary: "docustay", kind: "draft", baseSource: null, baseTemplateId: null });
    });
    return c.json(out, 202);
  });
  api.openapi(createRoute({ method: "get", path: "/api/v1/documents/ai/jobs/{id}", tags: ["Documents"], summary: "Read an AI draft job", security: bearerSec,
    request: { params: z.object({ id: Id }) },
    responses: { 200: { description: "The job. When `state` is `done`, `source` is the draft and `patches.notes` lists what to check.", content: { "application/json": { schema: AiJob } } }, 404: { description: "No such job.", content: { "application/json": { schema: Err } } }, ...errs } }),
  async (c) => { const { id } = c.req.valid("param"); return c.json(await run(c, "GET", "/api/v1/documents/ai/jobs/:id", async (db) => { await asOwner(db); return getAiJob(db, { jobId: id }); }), 200); });

  // ── Usage (6 Oct 2026, pricing predictability): the same numbers the Billing page shows, readable with a key ──
  api.openapi(createRoute({ method: "get", path: "/api/v1/usage", tags: ["Account"], summary: "Documents, templates and emails used against your plan", security: bearerSec,
    description: "Documents sent this calendar month (UTC), new templates made this month and emails sent today, with the plan's limits. `limit` is null when the plan has no limit (Pro has no template limit; a self-hosted install has no limits).",
    responses: { 200: { description: "Usage.", content: { "application/json": { schema: z.object({ plan: z.string().nullable(), period: z.object({ start: z.string(), end: z.string() }).nullable(), documents: z.object({ used: z.number().int(), limit: z.number().int().nullable() }).nullable(), emails: z.object({ usedToday: z.number().int(), limitPerDay: z.number().int(), resetsAt: z.string() }).nullable(), templates: z.object({ used: z.number().int(), limit: z.number().int().nullable(), resetsAt: z.string().nullable() }).nullable().optional().openapi({ description: "New templates made this calendar month (UTC), documents and forms together. Free includes 5; `limit` is null on Pro." }) }).openapi("Usage") } } }, ...errs } }),
  async (c) => c.json(await run(c, "GET", "/api/v1/usage", async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); await asOwner(db); return apiUsage(db, { tenantId: t.t }); }), 200));

  // ── Field detection (8 Oct 2026): the boxes a person would draw, found for them. Nothing is stored. ──
  const DetectBody = z.object({ fileName: z.string().min(1).max(255).optional(), file: z.string().min(1).openapi({ description: "The file, base64-encoded: a PDF file." }), minConfidence: z.number().min(0).max(1).optional(), ocr: z.boolean().optional().openapi({ description: "Read pages that are only a picture by character recognition (default true; English)." }) }).openapi("DetectFieldsRequest");
  const DetectedField = z.object({ id: z.string(), type: z.enum(["signature", "initials", "date_signed", "text", "checkbox", "dropdown"]), page: z.number().int(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), confidence: z.number(), source: z.string().openapi({ description: "`native` (already a form field), `line`, `text`, `box`, `table`, `checkbox` or `highlight`." }), label: z.string().optional(), role: z.string().optional().openapi({ description: "The seat this field belongs to: one of `signers[].key`." }), sensitive: z.boolean().optional(), format: z.string().optional(), group: z.string().optional().openapi({ description: "Tick boxes that answer one question share a group: pick one." }), uncertain: z.boolean() }).openapi("DetectedField");
  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/detect-fields", tags: ["Documents"], summary: "Find the fields on a PDF", security: bearerSec,
    description: "Looks at a PDF and returns the signature, initials, date, text and tick-box fields a person would place, with the page, the box (fractions of the page, origin top left), how sure it is, where it came from and which signer it belongs to. Stores nothing and sends nothing; pass the result on when you create a template or a document, or ask for `fields: \"auto\"` when you upload one. Free for everyone.",
    request: { body: { content: { "application/json": { schema: DetectBody } }, required: true } },
    responses: { 200: { description: "The fields found.", content: { "application/json": { schema: z.object({ fields: z.array(DetectedField), signers: z.array(z.object({ key: z.string(), label: z.string() })), pages: z.array(z.object({ page: z.number().int(), kind: z.enum(["form", "reference"]), fields: z.number().int() }).passthrough()), documents: z.array(z.object({ from: z.number().int(), to: z.number().int(), kind: z.enum(["form", "reference"]), title: z.string().nullable() })), summary: z.object({ fields: z.number().int(), signers: z.number().int(), uncertain: z.number().int(), truncated: z.boolean(), cached: z.boolean() }), notes: z.array(z.string()) }).openapi("DetectFieldsResult") } } }, ...errs } }),
  async (c) => { const b = c.req.valid("json"); return c.json(await run(c, "POST", "/api/v1/documents/detect-fields", async (db) => { await asOwner(db); return apiDetectFields(db, { bytes: Buffer.from(b.file, "base64"), fileName: b.fileName, minConfidence: b.minConfidence, ocr: b.ocr }); }), 200); });

  // ── AI usage: the allowance the Settings card shows, for a key ──
  const AiUsageOut = z.object({ mode: z.enum(["hosted", "own_key", "unmetered"]), plan: z.string().nullable(), allowance: z.number().nullable(), used: z.number().nullable(), remaining: z.number().nullable(), percent: z.number().nullable(), state: z.string(), resetsAt: z.string().nullable(), byFeature: z.record(z.string(), z.object({ calls: z.number(), credits: z.number() })), thinkHarder: z.object({ available: z.boolean() }).passthrough(), paused: z.boolean() }).openapi("AiUsage");
  api.openapi(createRoute({ method: "get", path: "/api/v1/ai/usage", tags: ["Account"], summary: "AI credits used against your plan", security: bearerSec,
    description: "The AI allowance for the current period: credits included, used and remaining, when it resets, and the split by kind of work. `mode` is `own_key` (you bring your own provider key, so nothing is metered) or `unmetered` (self-hosted).",
    responses: { 200: { description: "AI usage.", content: { "application/json": { schema: AiUsageOut } } }, ...errs } }),
  async (c) => c.json(await run(c, "GET", "/api/v1/ai/usage", async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); await asOwner(db); return apiAiUsage(db, { tenantId: t.t }); }), 200));

  registerLibraryV1(api, { run, asOwner });   // Run 9 Part 4R: before /templates/{id}, so "library" is never read as an id
  api.openapi(createRoute({ method: "get", path: "/api/v1/templates/{id}", tags: ["Templates"], summary: "One template and its seats", security: bearerSec,
    request: { params: z.object({ id: Id }) },
    responses: { 200: { description: "The template.", content: { "application/json": { schema: Template } } }, 404: { description: "No such template.", content: { "application/json": { schema: Err } } }, ...errs } }),
  async (c) => { const { id } = c.req.valid("param"); return c.json(await run(c, "GET", "/api/v1/templates/:id", async (db) => { await asOwner(db); return apiTemplate(db, { templateId: id }); }), 200); });

  api.openapi(createRoute({ method: "get", path: "/api/v1/documents/{id}/audit-log.csv", tags: ["Documents"], summary: "The document's audit log as CSV", security: bearerSec,
    request: { params: z.object({ id: Id }) },
    responses: { 200: { description: "One row per event: time (UTC), event, description, person, document, detail.", content: { "text/csv": { schema: z.string() } } }, 404: { description: "No such document.", content: { "application/json": { schema: Err } } }, ...errs } }),
  async (c) => {
    const { id } = c.req.valid("param");
    const out = await run(c, "GET", "/api/v1/documents/:id/audit-log.csv", async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); await asOwner(db); await guard(c, db, id); return auditLogCsv(db, { tenantId: t.t, instanceId: id }); });
    return c.body(out.csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-log.csv"`, "cache-control": "private, no-store" });
  });

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/{id}/remind", tags: ["Documents"], summary: "Remind the people who still have to sign", security: bearerSec,
    request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: z.object({ seat: z.string().optional().openapi({ description: "Remind only this seat (for example signer_2). Leave out to remind everyone who is up." }) }) } }, required: false } },
    responses: { 200: { description: "Reminded.", content: { "application/json": { schema: z.object({ id: Id, reminded: z.number().int() }) } } }, 409: { description: "Nobody is waiting to be reminded.", content: { "application/json": { schema: Err } } }, ...errs } }),
  async (c) => {
    const { id } = c.req.valid("param"); const b = await c.req.json().catch(() => ({}));
    return c.json(await run(c, "POST", "/api/v1/documents/:id/remind", async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); await asOwner(db); await guard(c, db, id); return apiRemind(db, { tenantId: t.t, instanceId: id, seat: typeof b?.seat === "string" ? b.seat : null }); }), 200);
  });

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/{id}/embed-session", tags: ["Documents"], summary: "Start an embedded signing session for a seat", security: bearerSec,
    description: "For a seat that was sent in `embedded`. Returns a link that works for one hour and is meant for an iframe or the `<docustay-sign>` element on one of your allowed websites. It is the only way a key can put someone in front of a signing form, and only for seats you marked embedded yourself. Needs an `Idempotency-Key` header.",
    request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: z.object({ seat: z.string().openapi({ example: "signer_1" }), origin: z.string().openapi({ example: "https://app.example.com", description: "The website that will show the form; must be on your allowed list." }) }) } }, required: true } },
    responses: { 200: { description: "The session.", content: { "application/json": { schema: z.object({ id: Id, seat: z.string(), url: z.string().url(), expiresAt: z.string() }) } } }, 409: { description: "The seat was not sent as embedded, it is not their turn, the website is not allowed, or embedding is off.", content: { "application/json": { schema: Err } } }, ...errs } }),
  async (c) => {
    const { id } = c.req.valid("param"); const b = await c.req.json().catch(() => ({}));
    return c.json(await run(c, "POST", "/api/v1/documents/:id/embed-session", async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); await asOwner(db); await guard(c, db, id); return apiEmbedSession(db, { tenantId: t.t, instanceId: id, seat: b?.seat, origin: b?.origin }); }), 200);
  });

  const Counted = z.object({ name: z.string(), sent: z.number().int(), completed: z.number().int() });
  api.openapi(createRoute({ method: "get", path: "/api/v1/reports", tags: ["Reports"], summary: "Counts of what was sent and completed", security: bearerSec,
    description: "Real documents only — documents made in test mode are never counted. Dates are in the workspace's own time zone; `to` is inclusive; the default window is the last 30 days.",
    request: { query: z.object({ from: z.string().optional().openapi({ example: "2026-10-01" }), to: z.string().optional().openapi({ example: "2026-10-31" }), team: Id.optional() }) },
    responses: { 200: { description: "The report.", content: { "application/json": { schema: z.object({ window: z.object({ from: z.string(), to: z.string(), days: z.number().int() }), timezone: z.string(),
      totals: z.object({ sent: z.number().int(), completed: z.number().int(), declined: z.number().int(), expired: z.number().int(), voided: z.number().int(), waitingNow: z.number().int(), completionRate: z.number().nullable(), averageHoursToComplete: z.number().nullable(), medianHoursToComplete: z.number().nullable() }),
      byDay: z.array(z.object({ date: z.string(), sent: z.number().int(), completed: z.number().int() })), byTemplate: z.array(Counted), byTeam: z.array(Counted), bySender: z.array(Counted) }).openapi("Report") } } }, ...errs } }),
  async (c) => { const q = c.req.valid("query"); return c.json(await run(c, "GET", "/api/v1/reports", async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); await asOwner(db); return documentReport(db, { tenantId: t.t, from: q.from ?? null, to: q.to ?? null, teamId: q.team ?? null }); }), 200); });

  api.openapi(createRoute({ method: "get", path: "/api/v1/teams", tags: ["Teams"], summary: "Teams and their members", security: bearerSec,
    responses: { 200: { description: "The teams.", content: { "application/json": { schema: z.object({ teams: z.array(z.object({ id: Id, name: z.string(), members: z.array(z.object({ id: Id, name: z.string() })), documents: z.number().int(), templates: z.number().int() })) }) } } }, ...errs } }),
  async (c) => c.json({ teams: await run(c, "GET", "/api/v1/teams", async (db) => { await asOwner(db); return listTeams(db); }) }, 200));

  // FP-K4 — the workspace's own email wording and the log of email about documents, for a key.
  const Kind = z.string().openapi({ description: "invitation, reminder, completed, declined, voided, expired, code or receipt", example: "invitation" });
  const Wording = z.object({ locale: z.string().optional(), subject: z.string().max(200).nullable().optional(), preview: z.string().max(200).nullable().optional(), body: z.string().max(5000).nullable().optional(), buttonLabel: z.string().max(60).nullable().optional(), footer: z.string().max(500).nullable().optional() }).openapi("EmailWording");
  const tenantOf = async (db) => (await db.query(`SELECT keystone.current_tenant_id() AS t`)).rows[0].t;
  api.openapi(createRoute({ method: "get", path: "/api/v1/email-templates", tags: ["Email"], summary: "The workspace's email wording", security: bearerSec,
    request: { query: z.object({ locale: z.string().optional() }) }, responses: { 200: { description: "The eight message types with the standard and the saved wording.", content: { "application/json": { schema: z.object({ templates: z.array(z.record(z.string(), z.any())) }) } } }, ...errs } }),
  async (c) => c.json({ templates: await run(c, "GET", "/api/v1/email-templates", async (db) => { await asOwner(db); return listEmailMessages(db, { locale: c.req.valid("query").locale ?? "en" }); }) }, 200));
  api.openapi(createRoute({ method: "put", path: "/api/v1/email-templates/{kind}", tags: ["Email"], summary: "Set the wording of one email", security: bearerSec,
    description: "Variables look like `{{document.title}}`; each message type accepts only its own (see GET). A blank field means the standard wording.",
    request: { params: z.object({ kind: Kind }), body: { content: { "application/json": { schema: Wording } }, required: true } }, responses: { 200: { description: "The saved wording.", content: { "application/json": { schema: z.record(z.string(), z.any()) } } }, ...errs } }),
  async (c) => { const { kind } = c.req.valid("param"); const b = c.req.valid("json");
    return c.json(await run(c, "PUT", "/api/v1/email-templates/:kind", async (db) => { const ownerId = await asOwner(db); return saveEmailMessage(db, { tenantId: await tenantOf(db), kind, locale: b.locale ?? "en", draft: b, userId: ownerId }); }), 200); });
  api.openapi(createRoute({ method: "delete", path: "/api/v1/email-templates/{kind}", tags: ["Email"], summary: "Back to the standard wording", security: bearerSec,
    request: { params: z.object({ kind: Kind }), query: z.object({ locale: z.string().optional() }) }, responses: { 200: { description: "The standard wording again.", content: { "application/json": { schema: z.record(z.string(), z.any()) } } }, ...errs } }),
  async (c) => { const { kind } = c.req.valid("param");
    return c.json(await run(c, "DELETE", "/api/v1/email-templates/:kind", async (db) => { await asOwner(db); return resetEmailMessage(db, { tenantId: await tenantOf(db), kind, locale: c.req.valid("query").locale ?? "en" }); }), 200); });
  api.openapi(createRoute({ method: "post", path: "/api/v1/email-templates/{kind}/preview", tags: ["Email"], summary: "Preview an email with made-up names", security: bearerSec,
    request: { params: z.object({ kind: Kind }), body: { content: { "application/json": { schema: Wording } }, required: false } }, responses: { 200: { description: "Subject, preview line, body and the HTML.", content: { "application/json": { schema: z.record(z.string(), z.any()) } } }, ...errs } }),
  async (c) => { const { kind } = c.req.valid("param"); const b = (await c.req.json().catch(() => ({}))) ?? {};
    return c.json(await run(c, "POST", "/api/v1/email-templates/:kind/preview", async (db) => { await asOwner(db); return previewEmailMessage(db, { tenantId: await tenantOf(db), kind, locale: b.locale ?? "en", draft: Object.keys(b).length ? b : null }); }), 200); });
  api.openapi(createRoute({ method: "get", path: "/api/v1/emails", tags: ["Email"], summary: "The log of email about your documents", security: bearerSec,
    description: "Every email sent about a document, to a person named on it: kind, subject, status (sent, delivered, bounced, complained, failed, paused). Filter by `documentId`, `to`, `status`, `kind`. No bodies, no links.",
    request: { query: z.object({ documentId: Id.optional(), to: z.string().optional(), status: z.string().optional(), kind: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional(), cursor: z.string().optional() }) },
    responses: { 200: { description: "A page of emails, newest first.", content: { "application/json": { schema: z.object({ emails: z.array(z.record(z.string(), z.any())), nextCursor: z.string().nullable() }) } } }, ...errs } }),
  async (c) => c.json(await run(c, "GET", "/api/v1/emails", async (db) => { await asOwner(db); return listEmails(db, c.req.valid("query")); }), 200));

  // FP-D2 — sign one seat of a TEST document with sample answers, so an integration's automated tests can finish a signature with no email and no browser. A live key is refused.
  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/{id}/test-sign", tags: ["Documents"], summary: "Sign a test document (test mode only)", security: bearerSec,
    description: "Signs one seat of a **test** document with sample answers, through the same code a person's signature uses: consent, signing order, the audit trail and your webhooks all happen. Only a test key (`dsk_test_…`) may call it, and only on a test document; a live key gets `403`. A seat with a payment field cannot be test-signed: pay it with a Stripe test card.",
    request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: z.object({ seat: z.string().openapi({ description: "The seat to sign, for example `signer_1`.", example: "signer_1" }) }) } }, required: true } },
    responses: { 200: { description: "Signed.", content: { "application/json": { schema: z.object({ id: Id, seat: z.string(), signed: z.boolean(), state: z.string(), progress: z.object({ signed: z.number().int(), of: z.number().int() }), finished: z.boolean() }) } } }, ...errs } }),
  async (c) => {
    const { id } = c.req.valid("param"); const b = c.req.valid("json");
    return c.json(await run(c, "POST", "/api/v1/documents/:id/test-sign", async (db) => {
      // Run 8 S3: checked AFTER the key is authenticated, so a call with no key gets 401 (it got 403 before)
      if (!testKey(c)) throw forbidden("test signing is only available to test keys (dsk_test_…): use a test key, or sign with a real person");
      const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); await asOwner(db); await guard(c, db, id);
      return apiTestSign(db, { tenantId: t.t, instanceId: id, seat: b.seat });
    }), 200);
  });

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/{id}/void", tags: ["Documents"], summary: "Void a document that is still out for signature", security: bearerSec,
    request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: z.object({ reason: z.string().max(500).optional() }) } }, required: false } },
    responses: { 200: { description: "Voided.", content: { "application/json": { schema: z.object({ id: Id, state: z.string() }) } } }, ...errs } }),
  async (c) => {
    const { id } = c.req.valid("param");
    const b = await c.req.json().catch(() => ({}));
    return c.json(await run(c, "POST", "/api/v1/documents/:id/void", async (db) => {
      const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); await asOwner(db); await guard(c, db, id);
      return apiVoid(db, { tenantId: t.t, instanceId: id, reason: typeof b?.reason === "string" ? b.reason : null, ownerId: await asOwner(db) });
    }), 200);
  });


  // ── B10 (7 Oct 2026): the v2 flow — people first, roles as words, template questions, revise, check, defaults, AI edit, payments status. Anything the screens can do, a key can do. ──
  const Person = z.object({ externalId: ExternalId.optional(), metadata: Meta.optional(), name: z.string().min(1).max(120), email: z.string().email(), role: z.string().max(80).optional().openapi({ description: "The role word in the text (Client, Provider). Left out, people take the roles in the order they appear." }), action: z.enum(["signer", "approver", "viewer", "assistant", "cc"]).optional(), order: z.number().int().min(1).max(30).optional().openapi({ description: "Signing order when signingOrder is sequential." }) }).openapi("Person");
  const SendChoice = z.object({ replyTo: z.string().email().optional(), senderName: z.string().min(1).max(120).optional(), subject: z.string().max(200).optional(), message: z.string().max(4000).optional(), expiryDays: z.number().int().min(0).max(365).nullable().optional(), reminderDays: z.array(z.number().int().min(1).max(60)).max(3).optional(), signingOrder: z.enum(["any", "sequential"]).optional(), language: z.string().optional(), internalNote: z.string().max(2000).optional().openapi({ description: "A note only the sender sees; never in anything a signer gets." }), requireDeclineReason: z.boolean().optional() }).openapi("SendChoices");
  const Source = z.record(z.string(), z.any()).openapi({ description: "A written document: TipTap JSON `{type:\"doc\",content:[…]}`. Field tags (`fieldTag` with name, type, role, required, autofill, editable, placeholder, tooltip, locked, options, default…), merge chips (`variableChip`; `custom.<key>` chips are the template's questions), and headings with `audience: \"sender\"` (Sender only: in nothing a signer sees, signs or receives)." });
  const Approval = z.object({ id: z.string(), status: z.string(), instanceId: z.string().optional() }).openapi({ description: "Set when a draft-only key asked to send: a person approves or declines in the app, and the document stays a draft until then." });
  const Made = z.object({ approval: Approval.optional(),  externalId: ExternalId.nullable().optional(), metadata: Meta.optional(), id: Id, state: z.enum(["draft", "sent"]), roles: z.array(z.object({ key: z.string(), label: z.string() })).optional(), emailed: z.number().int().optional(), notEmailed: z.array(z.any()).optional(), warnings: z.array(z.any()).optional() }).openapi("DocumentMade");
  const CreateBody = z.object({ email: EmailChoice.optional(), metadata: Meta.optional(), externalId: ExternalId.optional(), title: z.string().min(1).max(200), source: Source, people: z.array(Person).min(1).max(30), facts: z.record(z.string(), z.string()).optional().openapi({ description: "Merge text: `org.name`, `sender.name`, `custom.<key>` …" }), variableValues: z.record(z.string(), z.string()).optional(), paper: z.enum(["letter", "a4"]).optional(), send: SendChoice.optional(), description: z.string().max(2000).optional(), sendNow: z.boolean().optional().openapi({ description: "Also send it. The same checks as the screen's Send apply (a payment field needs Stripe connected)." }) }).openapi("CreateDocumentRequest");

  // ── FP-G1 · draft-only keys and daily limits. A draft-only key makes drafts; asking it to send files an approval request a person decides in the app. ──
  const makeGated = async (db, tenantId, { wantSend, test }, make) => {
    const p = await policyFor(db, await currentKeyId(db));
    await countAgainstLimit(db, { tenantId, kind: "draft" });
    if (wantSend) await countAgainstLimit(db, { tenantId, kind: "send" });
    if (!(p.draftOnly && wantSend)) return make(wantSend);
    const out = await make(false);
    return { ...out, approval: await requestSendApproval(db, { tenantId, instanceId: out.id, test }) };
  };
  const sendGated = async (db, { tenantId, ownerId, instanceId, test }) => {
    const p = await policyFor(db, await currentKeyId(db));
    await countAgainstLimit(db, { tenantId, kind: "send" });
    if (!p.draftOnly) return apiSendDraft(db, { tenantId, ownerId, instanceId, test });
    return { id: instanceId, state: "draft", emailed: 0, notEmailed: [], approval: await requestSendApproval(db, { tenantId, instanceId, test }) };
  };
  const idem = (c, path, body, fn, fpPath = path) => { const key = requireIdempotencyKey({ "idempotency-key": c.req.header("idempotency-key") }); return run(c, "POST", path, async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); const op = await withIdempotency(db, t.t, key, fingerprint("POST", fpPath, body), async () => { const ownerId = await asOwner(db); return { status: 201, body: await fn(db, t.t, ownerId) }; }); return op.failed ? { failed: op.error } : op.body; }); };
  const done = (out, status = 201) => { if (out?.failed) throw out.failed; return out; };

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents", tags: ["Documents"], summary: "Make a document from words and people", security: bearerSec,
    description: "People first: each person has a name, an email and (optionally) a role word from the text. The document is left as a **draft** unless `sendNow` is true. Needs an `Idempotency-Key`.",
    request: { body: { content: { "application/json": { schema: CreateBody } }, required: true } }, responses: { 201: { description: "The document.", content: { "application/json": { schema: Made } } }, ...errs } }),
  async (c) => { const b = c.req.valid("json"); const test = testKey(c);
    const out = await idem(c, "/api/v1/documents", b, (db, tenantId, ownerId) => makeGated(db, tenantId, { wantSend: b.sendNow === true, test }, (send) => apiCreateDocument(db, { tenantId, ownerId, title: b.title, source: b.source, people: b.people, facts: b.facts, variableValues: b.variableValues, paper: b.paper, sendChoice: { ...(b.send ?? {}), ...emailChoice(b.email) }, description: b.description, send, test, metadata: b.metadata, externalId: b.externalId })));
    return c.json(done(out), 201); });

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/check", tags: ["Documents"], summary: "Check a document's words before making it", security: bearerSec,
    request: { body: { content: { "application/json": { schema: z.object({ source: Source, facts: z.record(z.string(), z.string()).optional(), people: z.array(Person).max(30).optional().openapi({ description: "With people, each person's own merge text is known, as when the document is made." }), variableValues: z.record(z.string(), z.string()).optional(), requireSignature: z.boolean().optional(), forTemplate: z.boolean().optional() }) } }, required: true } },
    responses: { 200: { description: "What a person would be told.", content: { "application/json": { schema: z.object({ ok: z.boolean(), errors: z.array(z.string()), warnings: z.array(z.any()), roles: z.array(z.any()) }) } } }, ...errs } }),
  async (c) => { const b = c.req.valid("json"); return c.json(await run(c, "POST", "/api/v1/documents/check", async () => apiCheckSource(b)), 200); });

  api.openapi(createRoute({ method: "get", path: "/api/v1/documents/{id}/source", tags: ["Documents"], summary: "The words, people and choices of a draft", security: bearerSec,
    request: { params: z.object({ id: Id }) }, responses: { 200: { description: "The draft's source.", content: { "application/json": { schema: z.object({ id: Id, state: z.string(), title: z.string(), source: Source, facts: z.record(z.string(), z.any()), variableValues: z.record(z.string(), z.string()).nullable(), paper: z.string(), roles: z.array(z.any()), people: z.array(z.any()), sendOptions: z.record(z.string(), z.any()) }) } } }, ...errs } }),
  async (c) => { const { id } = c.req.valid("param"); return c.json(await run(c, "GET", "/api/v1/documents/:id/source", async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); await asOwner(db); await guard(c, db, id); return apiDraftSource(db, { tenantId: t.t, instanceId: id }); }), 200); });

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/{id}/revise", tags: ["Documents"], summary: "Change the words of a draft", security: bearerSec,
    description: "A draft is never edited in place: the new words are printed into a NEW draft that takes the people and choices, and the old draft is deleted. **The id changes** (use `id` in the answer). Needs an `Idempotency-Key`.",
    request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: z.object({ source: Source, facts: z.record(z.string(), z.string()).optional(), variableValues: z.record(z.string(), z.string()).optional(), roleMap: z.record(z.string(), z.string()).optional().openapi({ description: "Old role word → new role word when you renamed a role." }) }) } }, required: true } },
    responses: { 201: { description: "The new draft.", content: { "application/json": { schema: z.object({ id: Id, previousId: Id, warnings: z.array(z.any()) }) } } }, ...errs } }),
  async (c) => { const { id } = c.req.valid("param"); const b = c.req.valid("json");
    const out = await idem(c, "/api/v1/documents/:id/revise", b, async (db, tenantId, ownerId) => { await guard(c, db, id); return apiReviseDocument(db, { tenantId, ownerId, instanceId: id, source: b.source, facts: b.facts, variableValues: b.variableValues, roleMap: b.roleMap }); }, `/api/v1/documents/${id}/revise`);
    return c.json(done(out), 201); });

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/{id}/send", tags: ["Documents"], summary: "Send a draft", security: bearerSec,
    description: "Sends a draft made with `POST /api/v1/documents`. The same checks as the screen's Send; a payment field needs Stripe connected. Needs an `Idempotency-Key`.",
    request: { params: z.object({ id: Id }) }, responses: { 201: { description: "Sent.", content: { "application/json": { schema: z.object({ id: Id, state: z.string(), emailed: z.number().int(), notEmailed: z.array(z.any()) }) } } }, 202: { description: "A draft-only key: the request waits for a person to approve it in the app. The document is still a draft.", content: { "application/json": { schema: z.object({ id: Id, state: z.string(), approval: Approval }) } } }, ...errs } }),
  async (c) => { const { id } = c.req.valid("param"); const test = testKey(c);
    const out = await idem(c, "/api/v1/documents/:id/send", {}, async (db, tenantId, ownerId) => { await guard(c, db, id); return sendGated(db, { tenantId, ownerId, instanceId: id, test }); }, `/api/v1/documents/${id}/send`);
    return c.json(done(out), out?.approval ? 202 : 201); });

  api.openapi(createRoute({ method: "post", path: "/api/v1/templates/{id}/documents", tags: ["Templates"], summary: "Use a written template for people", security: bearerSec,
    description: "Makes a document from a template made with `POST /api/v1/templates/source`: the people, the template's questions answered in `variableValues` (see `GET /api/v1/templates/{id}`), the template's own defaults first. A draft unless `sendNow`. Needs an `Idempotency-Key`.",
    request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: z.object({ email: EmailChoice.optional(), metadata: Meta.optional(), externalId: ExternalId.optional(), title: z.string().max(200).optional(), people: z.array(Person).min(1).max(30), variableValues: z.record(z.string(), z.string()).optional(), facts: z.record(z.string(), z.string()).optional(), send: SendChoice.optional(), sendNow: z.boolean().optional() }) } }, required: true } },
    responses: { 201: { description: "The document.", content: { "application/json": { schema: Made } } }, ...errs } }),
  async (c) => { const { id } = c.req.valid("param"); const b = c.req.valid("json"); const test = testKey(c);
    const out = await idem(c, "/api/v1/templates/:id/documents", b, (db, tenantId, ownerId) => makeGated(db, tenantId, { wantSend: b.sendNow === true, test }, (send) => apiUseTemplate(db, { tenantId, ownerId, templateId: id, title: b.title, people: b.people, variableValues: b.variableValues, facts: b.facts, sendChoice: { ...(b.send ?? {}), ...emailChoice(b.email) }, send, test, metadata: b.metadata, externalId: b.externalId })), `/api/v1/templates/${id}/documents`);
    return c.json(done(out), 201); });

  api.openapi(createRoute({ method: "post", path: "/api/v1/templates/{id}/defaults", tags: ["Templates"], summary: "Set what a document made from a template starts with", security: bearerSec,
    request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: z.object({ description: z.string().max(2000).nullable().optional(), clientDescription: z.string().max(2000).nullable().optional(), message: z.string().max(4000).nullable().optional(), send: SendChoice.optional() }) } }, required: true } },
    responses: { 200: { description: "Saved.", content: { "application/json": { schema: z.object({ templateId: Id, saved: z.boolean() }) } } }, ...errs } }),
  async (c) => { const { id } = c.req.valid("param"); const b = c.req.valid("json"); return c.json(await run(c, "POST", "/api/v1/templates/:id/defaults", async (db) => { await asOwner(db); return apiTemplateDefaults(db, { templateId: id, description: b.description ?? null, clientDescription: b.clientDescription ?? null, message: b.message ?? null, sendChoice: b.send ?? {} }); }), 200); });

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/ai/edit", tags: ["Documents"], summary: "Ask the assistant to change a document", security: bearerSec,
    description: "Starts an edit job and answers at once; poll `GET /api/v1/documents/ai/jobs/{id}`. The answer is a list of **proposed changes** (`patches.applied`); nothing is changed until you apply the ones you accept with your own copy of the source. If you pass the template's questions in `variables`, `patches.values` carries proposed answers.",
    request: { body: { content: { "application/json": { schema: z.object({ request: z.string().min(1).max(4000), source: Source, mode: z.enum(["template", "document"]).optional(), variables: z.array(z.object({ key: z.string(), label: z.string().optional(), kind: z.enum(["text", "number", "money", "date"]).optional() })).max(30).optional() }) } }, required: true } },
    responses: { 202: { description: "Started.", content: { "application/json": { schema: z.object({ jobId: Id, state: z.string() }) } } }, ...errs } }),
  async (c) => { const b = c.req.valid("json"); const out = await run(c, "POST", "/api/v1/documents/ai/edit", async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); const ownerId = await asOwner(db); return createAiJob(db, { tenantId: t.t, actorUserId: ownerId, prompt: b.request, mode: b.mode ?? "document", vocabulary: "docustay", kind: "edit", baseSource: b.source, variables: b.variables ?? null }); }); return c.json(out, 202); });

  api.openapi(createRoute({ method: "post", path: "/api/v1/documents/ai/jobs/{id}/cancel", tags: ["Documents"], summary: "Cancel an AI job", security: bearerSec,
    request: { params: z.object({ id: Id }) }, responses: { 200: { description: "The job.", content: { "application/json": { schema: AiJob } } }, ...errs } }),
  async (c) => { const { id } = c.req.valid("param"); return c.json(await run(c, "POST", "/api/v1/documents/ai/jobs/:id/cancel", async (db) => { await asOwner(db); return cancelAiJob(db, { jobId: id }); }), 200); });

  api.openapi(createRoute({ method: "get", path: "/api/v1/ai/wizard", tags: ["Documents"], summary: "The wizard's questions", security: bearerSec,
    description: "The questions the screen's Describe wizard asks, so an integration asks the same ones and sends the answers as `brief` to `POST /api/v1/documents/ai/draft`. Includes the payment questions and the currencies offered.",
    responses: { 200: { description: "The questions.", content: { "application/json": { schema: z.record(z.string(), z.any()) } } }, ...errs } }),
  async (c) => c.json(await run(c, "GET", "/api/v1/ai/wizard", async () => apiWizard()), 200));

  api.openapi(createRoute({ method: "get", path: "/api/v1/payments/status", tags: ["Account"], summary: "Is Stripe ready to take a payment?", security: bearerSec,
    description: "`connected` (details submitted, charges on, nothing due), `needs_attention` (Stripe still needs information) or `not_connected`. A document with a payment field can only be sent when this says `connected`.",
    responses: { 200: { description: "The status.", content: { "application/json": { schema: z.object({ status: z.enum(["connected", "needs_attention", "not_connected"]), mode: z.string().nullable() }) } } }, ...errs } }),
  async (c) => c.json(await run(c, "GET", "/api/v1/payments/status", async (db) => { const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`); const s = await paymentsStatus(db, { tenantId: t.t }); return { status: s.state === "live" ? "connected" : s.state === "not_connected" ? "not_connected" : "needs_attention", mode: s.mode ?? null }; }), 200));

  // FP-C5 — the published document is the registry's, polished (names, servers, headers, code samples); built once and kept
  let published = null;
  api.get("/api/v1/openapi.json", (c) => c.json(published ??= polish(api.getOpenAPI31Document(BASE_CONFIG))));
  api.get("/api/v1/docs", Scalar({ url: "/api/v1/openapi.json", pageTitle: "Docustay API" }));
  registerPlaysV1(api, { run, asOwner, testKey });
  registerFormsV1(api, { run, asOwner, errs, errBody });
  registerWebhooksV1(api, { run, errs });   // FP-D1/D4/F5
  registerBuilderV1(api, { run, errs });    // the embeddable template builder
  registerRun9V1(api, { run, asOwner, idem, errs, errBody });   // Run 9: search, contracts and key dates, payments and refunds, playbooks that run
  app.route("/", api);
}
