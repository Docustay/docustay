// B10 CONTRACT: the OpenAPI file, the key scopes, the JavaScript SDK, the Python SDK and the MCP tools describe ONE API. Every operation in the OpenAPI document must have an SDK method (JS and Python), a key scope, and an MCP tool (or be named below with the reason it has none).
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildOpenApi } from "../scripts/build-api-files.mjs";
import { ROUTE_SCOPES } from "../src/developer/scopes.mjs";
import { Docustay } from "../sdk/js/src/index.js";
import { buildTools } from "../sdk/mcp/src/tools.js";
import { OPERATIONS } from "../src/developer/operations.mjs";

const doc = await buildOpenApi();
const ops = []; for (const [p, item] of Object.entries(doc.paths)) for (const m of ["get", "post", "put", "delete"]) if (item[m]) ops.push(`${m.toUpperCase()} ${p}`);
// [operation, JS method, Python method, MCP tool | null (reason)]
const MAP = {
  "GET /api/v1/documents/templates": ["listTemplates", "list_templates", "list_templates"],
  "GET /api/v1/documents": ["listDocuments", "list_documents", "list_documents"],
  "GET /api/v1/documents/{id}": ["getDocument", "get_document", "get_document"],
  "GET /api/v1/documents/{id}/signed.pdf": ["downloadSignedPdf", "download_signed_pdf", "save_signed_pdf"],
  "POST /api/v1/documents/send": ["sendDocument", "send_document", "send_document"],
  "POST /api/v1/templates/html": ["createTemplateFromHtml", "create_template_from_html", "create_template_from_html"],
  "POST /api/v1/templates/file": ["createTemplateFromFile", "create_template_from_file", [null, "a binary upload: an assistant has no file to give; it writes the words with create_template_from_source"]],
  "POST /api/v1/templates/source": ["createTemplateFromSource", "create_template_from_source", "create_template_from_source"],
  "POST /api/v1/documents/ai/draft": ["draftWithAi", "draft_with_ai", "draft_document_with_ai"],
  "GET /api/v1/documents/ai/jobs/{id}": ["getAiDraft", "get_ai_draft", "get_ai_draft"],
  "POST /api/v1/preflight": ["preflight", "preflight", "preflight"],
  "GET /api/v1/usage": ["usage", "usage", [null, "the person's own billing numbers are not an assistant's business"]],
  "GET /api/v1/templates/{id}": ["getTemplate", "get_template", "get_template"],
  "GET /api/v1/documents/{id}/audit-log.csv": ["auditLogCsv", "audit_log_csv", "get_audit_log"],
  "POST /api/v1/documents/{id}/remind": ["remind", "remind", "remind"],
  "POST /api/v1/documents/{id}/embed-session": ["embedSession", "embed_session", [null, "returns a signing link: a key may start a signature, an assistant never receives a way to sign"]],
  "POST /api/v1/embedded/builder-session": ["builderSession", "builder_session", [null, "returns a link that holds a short-lived key: an assistant is never handed a credential, and a person drives the builder"]],
  "POST /api/v1/embedded/scribe-session": ["scribeSession", "scribe_session", [null, "returns a link that holds a short-lived draft-only key: an assistant is never handed a credential, and a person drives Scribe"]],
  "GET /api/v1/teams": ["listTeams", "list_teams", [null, "team structure is not a document operation"]],
  "POST /api/v1/documents/{id}/void": ["voidDocument", "void_document", "void_document"],
  // FINAL PUSH Stage 6 — the workspace's email wording is the person's voice: an assistant may read the log, not rewrite the wording.
  "GET /api/v1/emails": ["listEmails", "list_emails", "list_emails"],
  "POST /api/v1/documents/{id}/test-sign": ["testSign", "test_sign", "test_sign_document"],
  // B10 — the v2 flow
  "POST /api/v1/documents": ["createDocument", "create_document", "create_document"],
  "POST /api/v1/documents/check": ["checkDocument", "check_document", "check_document"],
  "GET /api/v1/documents/{id}/source": ["getDraftSource", "get_draft_source", "get_draft_source"],
  "POST /api/v1/documents/{id}/revise": ["reviseDocument", "revise_document", "revise_document"],
  "POST /api/v1/documents/{id}/send": ["sendDraft", "send_draft", "send_draft"],
  "POST /api/v1/templates/{id}/documents": ["useTemplate", "use_template", "use_template"],
  "POST /api/v1/templates/{id}/defaults": ["setTemplateDefaults", "set_template_defaults", "set_template_defaults"],
  "POST /api/v1/documents/ai/edit": ["editWithAi", "edit_with_ai", "edit_document_with_ai"],
  "POST /api/v1/documents/ai/jobs/{id}/cancel": ["cancelAiJob", "cancel_ai_job", "cancel_ai_job"],
  "GET /api/v1/ai/wizard": ["getWizard", "get_wizard", "get_wizard"],
  "GET /api/v1/ai/usage": ["aiUsage", "ai_usage", "get_ai_usage"],
  "POST /api/v1/documents/detect-fields": ["detectFields", "detect_fields", "detect_fields"],
  "GET /api/v1/payments/status": ["paymentsStatus", "payments_status", "get_payments_status"],
  // FINAL PUSH Stage 4 — plays, playbooks and drafts (Pro). An assistant may use plays and start drafts; changing the workspace's own plays and playbooks is the person's job, not an assistant's.
  "GET /api/v1/plays": ["listPlays", "list_plays", "list_plays"],
  "GET /api/v1/plays/{name}": ["getPlay", "get_play", "get_play"],
  "POST /api/v1/plays/test": ["testPlay", "test_play", [null, "checking a play file is authoring work a person does; an assistant uses plays, it does not write the workspace's rules"]],
  "POST /api/v1/plays": ["savePlay", "save_play", [null, "saving a play changes the workspace's own rules for its assistant: a person does that, never an assistant"]],
  "POST /api/v1/plays/{name}/publish": ["publishPlay", "publish_play", [null, "publishing a play changes what the workspace's assistant will do: a person decides that"]],
  "POST /api/v1/plays/{name}/duplicate": ["duplicatePlay", "duplicate_play", [null, "copying a play is authoring work for a person, not an assistant"]],
  "DELETE /api/v1/plays/{name}": ["archivePlay", "archive_play", [null, "removing a play from use is the person's decision, not an assistant's"]],
  "GET /api/v1/playbooks": ["listPlaybooks", "list_playbooks", "list_playbooks"],
  "POST /api/v1/playbooks": ["savePlaybook", "save_playbook", [null, "bundling plays is authoring work for a person, not an assistant"]],
  // FINAL PUSH Stage 6 — webhooks. Where events are sent is the person's decision: an assistant may read what exists, never add, remove or re-key a destination.
  "GET /api/v1/webhooks/topics": ["listWebhookTopics", "list_webhook_topics", [null, "setting up where events go is the person's job, not an assistant's"]],
  "GET /api/v1/webhooks": ["listWebhooks", "list_webhooks", [null, "setting up where events go is the person's job, not an assistant's"]],
  "POST /api/v1/webhooks": ["createWebhook", "create_webhook", [null, "an assistant must never choose where a workspace's events are sent"]],
  "GET /api/v1/webhooks/{id}": ["getWebhook", "get_webhook", [null, "setting up where events go is the person's job, not an assistant's"]],   // R13-D415
  "DELETE /api/v1/webhooks/{id}": ["deleteWebhook", "delete_webhook", [null, "removing a destination for events is a person's decision, not an assistant's"]],
  "POST /api/v1/webhooks/{id}/test": ["testWebhook", "test_webhook", [null, "testing a destination belongs with setting it up, which is a person's job"]],
  "POST /api/v1/webhooks/{id}/rotate": ["rotateWebhookSecret", "rotate_webhook_secret", [null, "a signing secret is shown once to a person and never to an assistant"]],
  "GET /api/v1/webhooks/{id}/deliveries": ["listWebhookDeliveries", "list_webhook_deliveries", [null, "delivery logs belong with the destinations, which are a person's concern"]],
  "GET /api/v1/webhooks/{id}/relay": ["fetchRelayEvents", "fetch_relay_events", [null, "the relay hands a developer's own computer the signed events; an assistant has no localhost to forward them to"]],
  "POST /api/v1/drafts": ["startDraft", "start_draft", "start_draft"],
  "POST /api/v1/drafts/{draftRef}/answers": ["answerDraft", "answer_draft", "answer_questions"],
  // Run 9
  "GET /api/v1/search": ["search", "search", "search_documents"],
  "GET /api/v1/payments": ["listPayments", "list_payments", "list_payments"],
  "POST /api/v1/payments/{id}/refund": ["refundPayment", "refund_payment", [null, "a refund moves money back to a person; that is a person's decision, made in the app or by a direct API call, never by an assistant"]],
  // Run 9 Part 4R: the template library, packs (playbooks) and drafts from a template
  "GET /api/v1/templates/library": ["listLibraryTemplates", "list_library_templates", "list_library_templates"],
  "GET /api/v1/templates/library/{slug}": ["getLibraryTemplate", "get_library_template", "get_library_template"],
  "POST /api/v1/templates/library/{slug}/documents": ["draftFromLibraryTemplate", "draft_from_library_template", "draft_from_library_template"],
  "POST /api/v1/templates/library/{slug}/customize": ["customizeLibraryTemplate", "customize_library_template", [null, "a customized copy is a new template that counts toward the plan's monthly limit; a person decides that in the app or by a direct API call"]],
  "DELETE /api/v1/documents/{id}": ["deleteDraft", "delete_draft", [null, "deleting is permanent; an agent leaves an unwanted draft for a person to delete in the app or by a direct API call (R13-D385)"]],
  "POST /api/v1/playbooks/{name}/enable": ["setPlaybookOn", "set_playbook_on", [null, "switching a pack on changes what Scribe offers first for the whole workspace; a person does that in the app or by a direct API call"]],
};
const py = fs.readFileSync(new URL("../sdk/python/docustay/client.py", import.meta.url), "utf8");
const mcp = new Set(buildTools(new Docustay("gl_test_x" + "x".repeat(20))).map((t) => t.name));
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok", name); };

t("every OpenAPI operation is mapped here, and nothing mapped is missing from the OpenAPI file", () => {
  assert.deepEqual(ops.filter((o) => !MAP[o]), [], "an operation with no SDK/MCP decision");
  assert.deepEqual(Object.keys(MAP).filter((o) => !ops.includes(o)), [], "a mapped operation the API no longer has");
});
t("the published document names every operation (operationId = the JS SDK method), with unique names, a server, headers and three code samples", () => {
  for (const [o, [js, pyName]] of Object.entries(MAP)) assert.deepEqual(OPERATIONS[o], [js, pyName], `${o}: src/developer/operations.mjs and this table disagree`);
  assert.deepEqual(Object.keys(OPERATIONS).filter((o) => !MAP[o]), [], "a named operation this table does not know");
  const ids = new Set();
  for (const o of ops) { const [m, p] = o.split(" "); const op = doc.paths[p][m.toLowerCase()]; assert.equal(op.operationId, MAP[o][0], o); assert.ok(!ids.has(op.operationId), `${o}: duplicate operationId`); ids.add(op.operationId); assert.equal(op["x-codeSamples"].length, 3, o); assert.ok(op["x-codeSamples"].every((c) => c.source.length > 30), o); }
  assert.match(doc.servers[0].url, /^https:\/\/\{host\}$/); assert.equal(doc.info.contact.email, "support@docustay.app");
  assert.ok(doc.components.headers["Docustay-Version"] && doc.components.headers["RateLimit-Remaining"]);
  assert.match(doc.paths["/api/v1/documents/{id}/send"].post.description, /Idempotency-Key/); assert.ok(doc.paths["/api/v1/documents/{id}/send"].post.responses["202"], "draft-only keys get a documented 202");
});
t("every operation has a key scope (documents:read for reads, documents:write for writes)", () => {
  for (const o of ops) { const [m, p] = o.split(" "); const key = `${m} ${p.replace(/\{(\w+)\}/g, ":$1")}`; const sc = ROUTE_SCOPES[key]; assert.ok(sc, `${key} has no scope`); const family = /^\/api\/v1\/webhooks/.test(p) ? "webhooks" : /^\/api\/v1\/plays|^\/api\/v1\/playbooks|^\/api\/v1\/automations/.test(p) ? "plays" : /^\/api\/v1\/drafts/.test(p) ? "drafts" : /^\/api\/v1\/embedded/.test(p) ? "embedded" : "documents"; if (family === "embedded") assert.equal(sc, "embedded:write", key); else if (family === "webhooks") assert.equal(sc, m === "GET" ? "webhooks:read" : "webhooks:write", key); else if (family === "drafts") assert.equal(sc, "drafts:write", key); else if (family === "plays") assert.equal(sc, m === "GET" || /test$/.test(p) ? "plays:read" : "plays:write", key); else if (m === "POST" && !/(check|detect-fields|preflight)$/.test(p)) assert.equal(sc, "documents:write", key); else if (/(detect-fields|preflight)$/.test(p)) assert.equal(sc, "documents:read", `${key}: it reads and stores nothing, so a read scope is enough`); }
});
t("every operation has a JavaScript SDK method and a Python SDK method", () => {
  for (const [o, [js, pyName]] of Object.entries(MAP)) { assert.equal(typeof Docustay.prototype[js], "function", `${o}: JS ${js}`); assert.match(py, new RegExp(`def ${pyName}\\(`), `${o}: Python ${pyName}`); }
});
t("every operation has an MCP tool, or a written reason it has none", () => {
  for (const [o, [, , tool]] of Object.entries(MAP)) { if (Array.isArray(tool)) { assert.equal(tool[0], null); assert.ok(tool[1].length > 20, `${o}: say why`); } else assert.ok(mcp.has(tool), `${o}: MCP ${tool}`); }
});
t("what changes the world over MCP is safe: emailing needs confirm, no tool signs, pays or deletes", () => {
  const names = [...mcp]; for (const bad of ["sign", "pay", "refund", "delete", "charge"]) assert.ok(!names.some((x) => new RegExp(`^${bad}(_|$)`).test(x)), `no ${bad} tool`);
  const src = fs.readFileSync(new URL("../sdk/mcp/src/tools.js", import.meta.url), "utf8");
  for (const tool of ["send_document", "send_draft", "remind", "void_document"]) assert.match(src.slice(src.indexOf(`name: "${tool}"`), src.indexOf(`name: "${tool}"`) + 900), /confirm/, `${tool} asks first`);
  assert.doesNotMatch(src.slice(src.indexOf('name: "create_document"'), src.indexOf('name: "create_document"') + 700), /sendNow/, "create_document never sends");
});
t("the new routes are documented: the creates need an idempotency key, the payment status names the three states, the wizard names the currencies", () => {
  const j = JSON.stringify(doc.paths);
  assert.match(doc.paths["/api/v1/documents"].post.description, /Idempotency-Key/);
  assert.match(doc.paths["/api/v1/documents/{id}/revise"].post.description, /id changes/);
  assert.match(doc.paths["/api/v1/payments/status"].get.description, /needs_attention/);
  assert.match(doc.paths["/api/v1/ai/wizard"].get.description, /currencies/);
  assert.ok(j.includes("WizardBrief") || j.includes("payer_role"), "the brief and its payment are in the API description");
});
const seen = []; const fake = async (url, init) => { seen.push({ url: String(url).replace("https://x.example", ""), method: init.method, body: init.body ? JSON.parse(init.body) : undefined, key: init.headers["idempotency-key"] ?? init.headers["Idempotency-Key"] }); return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); };
const d = new Docustay("gl_test_" + "k".repeat(20), { baseUrl: "https://x.example", fetch: fake });
const U = "6f1c1f0e-7a0c-4d1d-9b5e-2f0a7b1c3d4e";
await d.createDocument({ title: "T", source: { type: "doc", content: [] }, people: [{ name: "A", email: "a@b.co" }], variableValues: { fee: "5" } });
await d.reviseDocument(U, { source: { type: "doc", content: [] } }); await d.sendDraft(U); await d.useTemplate(U, { people: [{ name: "A", email: "a@b.co" }], variableValues: { fee: "5" } });
await d.setTemplateDefaults(U, { message: "hi" }); await d.editWithAi({ request: "shorter", source: { type: "doc", content: [] }, variables: [{ key: "fee" }] }); await d.cancelAiJob(U);
await d.getWizard(); await d.paymentsStatus(); await d.getDraftSource(U); await d.checkDocument({ source: { type: "doc", content: [] } });
await d.draftWithAi({ brief: { type: "nda", final: "x".repeat(12), payment: { collect: true, amount: "1500", currency: "usd", description: "deposit" } } });
const want = [["POST", "/api/v1/documents"], ["POST", `/api/v1/documents/${U}/revise`], ["POST", `/api/v1/documents/${U}/send`], ["POST", `/api/v1/templates/${U}/documents`], ["POST", `/api/v1/templates/${U}/defaults`], ["POST", "/api/v1/documents/ai/edit"], ["POST", `/api/v1/documents/ai/jobs/${U}/cancel`], ["GET", "/api/v1/ai/wizard"], ["GET", "/api/v1/payments/status"], ["GET", `/api/v1/documents/${U}/source`], ["POST", "/api/v1/documents/check"], ["POST", "/api/v1/documents/ai/draft"]];
t("JS SDK request shapes", () => { assert.deepEqual(seen.map((x) => [x.method, x.url]), want); for (const x of seen.filter((y) => y.method === "POST")) assert.ok(x.key && x.key.length >= 8, `${x.url} carries an idempotency key`); assert.equal(seen[0].body.variableValues.fee, "5"); assert.equal(seen.at(-1).body.brief.payment.amount, "1500"); assert.equal(seen[5].body.variables[0].key, "fee"); });
console.log(`\n${n} passed`);
