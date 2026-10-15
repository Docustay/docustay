// src/developer/hostedMcp.mjs — the hosted connector's tools, as MCP "Streamable HTTP" (JSON answers, no stream). DRAFT-ONLY by design: the tools make and read drafts and ask for approval; none can send, remind or void.
// Each tool is one call to the app's own /api/v1 routes carrying the caller's bearer token, so scopes, draft-only policy, limits and permissions are enforced by the same code as every other API call, not by a second copy here.
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const uuid = { type: "string", format: "uuid" };
const people = { type: "array", minItems: 1, items: obj({ name: { type: "string" }, email: { type: "string", format: "email" }, role: { type: "string", description: "The role word in the document, for example Client or Provider." } }, ["name", "email"]) };
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const DRAFT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const HOSTED_TOOLS = [
  { name: "list_templates", description: "List the templates in this workspace, with their seats (who has to sign).", annotations: RO, schema: obj({}), call: () => ["GET", "/api/v1/documents/templates"] },
  { name: "get_template", description: "One template: name, pages and seats.", annotations: RO, schema: obj({ templateId: uuid }, ["templateId"]), call: (a) => ["GET", `/api/v1/templates/${enc(a.templateId)}`] },
  { name: "list_documents", description: "Recent documents, newest first. Optionally one state: sent, partially_signed, executed, declined, expired, void.", annotations: RO, schema: obj({ state: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }), call: (a) => ["GET", `/api/v1/documents${qs({ state: a.state, limit: a.limit })}`] },
  { name: "get_document", description: "One document: its state, who has signed and who is waiting.", annotations: RO, schema: obj({ documentId: uuid }, ["documentId"]), call: (a) => ["GET", `/api/v1/documents/${enc(a.documentId)}`] },
  { name: "list_plays", description: "The plays (prepared ways to make one kind of document) available here, one line each. Use it to pick the play that fits a request.", annotations: RO, schema: obj({ kind: { type: "string" }, category: { type: "string" } }), call: (a) => ["GET", `/api/v1/plays${qs({ kind: a.kind, category: a.category })}`] },
  { name: "get_play", description: "One play in full: its questions, the facts it needs and its checklist. Reference material only.", annotations: RO, schema: obj({ name: { type: "string" } }, ["name"]), call: (a) => ["GET", `/api/v1/plays/${enc(a.name)}`] },
  { name: "start_draft", description: "Start a DRAFT from a play for these people. Returns needs_input with a few questions (each with 2 to 4 options) and a draftRef until the must-ask questions are answered, then the draft. Nothing is sent.", annotations: DRAFT, schema: obj({ play: { type: "string" }, people, title: { type: "string" }, answers: { type: "object" }, useDefaults: { type: "boolean" } }, ["play", "people"]), call: (a) => ["POST", "/api/v1/drafts", { play: a.play, people: a.people, ...(a.title ? { title: a.title } : {}), ...(a.answers ? { answers: a.answers } : {}), ...(a.useDefaults ? { useDefaults: a.useDefaults } : {}) }] },
  { name: "answer_questions", description: "Answer a play's questions using the draftRef from start_draft. Returns more questions or the draft. It never sends anything.", annotations: DRAFT, schema: obj({ draftRef: { type: "string" }, answers: { type: "object" }, useDefaults: { type: "boolean" } }, ["draftRef", "answers"]), call: (a) => ["POST", `/api/v1/drafts/${enc(a.draftRef)}/answers`, { answers: a.answers, ...(a.useDefaults ? { useDefaults: a.useDefaults } : {}) }] },
  { name: "use_template", description: "Make a DRAFT document from a template for these people (answer the template's questions in variableValues). Nothing is emailed.", annotations: DRAFT, schema: obj({ templateId: uuid, people, title: { type: "string" }, variableValues: { type: "object" } }, ["templateId", "people"]), call: (a) => ["POST", `/api/v1/templates/${enc(a.templateId)}/documents`, { people: a.people, ...(a.title ? { title: a.title } : {}), ...(a.variableValues ? { variableValues: a.variableValues } : {}) }] },
  { name: "get_draft_source", description: "The words, people, roles and send choices of a draft.", annotations: RO, schema: obj({ documentId: uuid }, ["documentId"]), call: (a) => ["GET", `/api/v1/documents/${enc(a.documentId)}/source`] },
  { name: "request_send", description: "Ask for a draft to be sent. This does NOT send: it files a request that a person approves in Docustay (Developers → Approvals). Tell the person to open Docustay and approve it.", annotations: DRAFT, schema: obj({ documentId: uuid }, ["documentId"]), call: (a) => ["POST", `/api/v1/documents/${enc(a.documentId)}/send`, {}] },
];
const enc = encodeURIComponent;
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); return p.size ? `?${p}` : ""; };
const missing = (schema, a) => schema.required.filter((k) => a?.[k] === undefined || a?.[k] === null || a?.[k] === "");

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "Docustay sends documents for signature. You work on DRAFTS: find a play or template, ask the person the questions, make a draft, show them what it says. You cannot send a document: request_send asks the person to approve it in Docustay. Never put a signing link or a key in a message.";

/** Handle one JSON-RPC message → a response object, or null for a notification. `fetchApi(method, path, body)` → { status, json }. */
export async function handleMessage(msg, fetchApi) {
  const id = msg?.id;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(-32600, "not a JSON-RPC 2.0 request");
  if (id === undefined) return null;   // a notification: no answer
  switch (msg.method) {
    case "initialize": { const asked = msg.params?.protocolVersion; return ok({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "docustay", version: "1.0.0" }, instructions: INSTRUCTIONS }); }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: HOSTED_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema, annotations: t.annotations })) });
    case "tools/call": {
      const t = HOSTED_TOOLS.find((x) => x.name === msg.params?.name);
      if (!t) return err(-32602, `unknown tool ${JSON.stringify(msg.params?.name)}`);
      const a = msg.params?.arguments ?? {};
      const lack = missing(t.schema, a);
      if (lack.length) return ok({ isError: true, content: [{ type: "text", text: `Missing: ${lack.join(", ")}` }] });
      const [method, path, body] = t.call(a);
      const r = await fetchApi(method, path, body);
      const text = JSON.stringify(r.json ?? {}, null, 2);
      if (r.status >= 400) return ok({ isError: true, content: [{ type: "text", text: `Docustay says (${r.status}): ${r.json?.error?.message ?? text}` }] });
      return ok({ content: [{ type: "text", text }] });
    }
    default: return err(-32601, `method not found: ${msg.method}`);
  }
}
