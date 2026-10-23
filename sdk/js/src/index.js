// Docustay JavaScript/TypeScript SDK. No dependencies: uses the platform's fetch and Web Crypto (Node 18+, browsers, Deno, Bun).
// Written from the public OpenAPI document (docustay/web/static/api/openapi.json); every method below is one operation in it.

export class DocustayError extends Error {
  constructor(status, body, headers) {
    const e = body?.error ?? {};
    super(e.message ?? `Docustay request failed (${status})`);
    this.name = "DocustayError";
    this.status = status;
    this.kind = e.kind ?? "unknown";
    this.requestId = e.requestId ?? headers?.get?.("x-request-id") ?? null;
    this.retryable = e.retryable === true;
    this.retryAfterSeconds = Number(headers?.get?.("retry-after")) || null;
    this.detail = e.detail ?? null;
    // a plan limit (403 forbidden): "plan_document_limit", "plan_signer_limit" or "plan_template_limit", with detail.used, detail.limit and detail.resetsAt (the first of next month, UTC)
    this.code = typeof e.detail?.code === "string" ? e.detail.code : null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-sdk`);
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o ?? {})) { if (v === undefined || v === null) continue; if (k === "metadata" && typeof v === "object") { for (const [mk, mv] of Object.entries(v)) p.set(`metadata[${mk}]`, String(mv)); continue; } p.set(k, String(v)); } const s = p.toString(); return s ? `?${s}` : ""; };

export class Docustay {
  /**
   * @param {string} apiKey  a key from Settings → Developers ("dsk_live_…", or "dsk_test_…" for test mode; older "gl_" keys still work)
   * @param {{ baseUrl?: string, maxRetries?: number, timeoutMs?: number, fetch?: typeof fetch }} [options]
   */
  constructor(apiKey, options = {}) {
    if (!apiKey || typeof apiKey !== "string") throw new TypeError("Docustay: an API key is required");
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? "https://app.docustay.app").replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this._fetch = options.fetch ?? globalThis.fetch;
    this.testMode = /^(?:gl|dsk)_test_/.test(apiKey);
  }

  async _request(method, path, { query, body, idempotencyKey, raw } = {}) {
    const needsKey = method === "POST";
    const key = needsKey ? (idempotencyKey ?? newKey()) : null; // one key for every retry of this call, so a retry never sends twice
    let attempt = 0;
    for (;;) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      let res;
      try {
        res = await this._fetch(`${this.baseUrl}${path}${qs(query)}`, {
          method, signal: ctl.signal,
          headers: { authorization: `Bearer ${this.apiKey}`, accept: raw ? "*/*" : "application/json", "user-agent": "docustay-js/0.2.0", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        clearTimeout(timer);
        if (attempt < this.maxRetries) { await sleep(backoff(attempt++)); continue; }
        throw e;
      } finally { clearTimeout(timer); }
      if (res.ok) {
        if (raw) return res;
        const okText = await res.text();
        try { return JSON.parse(okText); } catch { throw new DocustayError(res.status, { error: { kind: "bad_response", message: `The server at ${this.baseUrl} answered with something that is not Docustay's API (${(res.headers.get("content-type") ?? "no content type").split(";")[0]}, ${okText.length} bytes). Check the baseUrl option: the default is https://app.docustay.app, and a self-hosted or sandbox server needs its own address.` } }, res.headers); }
      }
      const text = await res.text(); let parsed = null; try { parsed = JSON.parse(text); } catch { /* not json */ }
      const err = new DocustayError(res.status, parsed, res.headers);
      const retry = (res.status === 429 || res.status >= 500) && attempt < this.maxRetries;
      if (!retry) throw err;
      await sleep(err.retryAfterSeconds ? Math.min(err.retryAfterSeconds, 30) * 1000 : backoff(attempt));
      attempt += 1;
    }
  }

  // ── documents ──
  /** Send a template to people. `parties`: [{ seat, name, email }]. Returns { id, state }. */
  sendDocument(request, { idempotencyKey } = {}) { return this._request("POST", "/api/v1/documents/send", { body: request, idempotencyKey }); }
  getDocument(id) { return this._request("GET", `/api/v1/documents/${encodeURIComponent(id)}`); }
  /** One page: { documents, page: { limit, nextCursor, hasMore } }. */
  listDocuments(params = {}) { return this._request("GET", "/api/v1/documents", { query: params }); }
  /** Every document, page after page. `for await (const d of docustay.eachDocument({ state: "executed" })) …` */
  async *eachDocument(params = {}) {
    let cursor;
    do { const page = await this.listDocuments({ ...params, cursor }); yield* page.documents; cursor = page.page?.nextCursor ?? undefined; } while (cursor);
  }
  /** The signed PDF as an ArrayBuffer (only once the document is finished). */
  async downloadSignedPdf(id) { return (await this._request("GET", `/api/v1/documents/${encodeURIComponent(id)}/signed.pdf`, { raw: true })).arrayBuffer(); }
  /** The audit log as CSV text. */
  async auditLogCsv(id) { return (await this._request("GET", `/api/v1/documents/${encodeURIComponent(id)}/audit-log.csv`, { raw: true })).text(); }
  /** A one-hour embedded signing session for a seat that was sent in `embedded`: { id, seat, url, expiresAt }. `origin` is the website that will show it. */
  embedSession(id, { seat, origin }, { idempotencyKey } = {}) { return this._request("POST", `/api/v1/documents/${encodeURIComponent(id)}/embed-session`, { body: { seat, origin }, idempotencyKey }); }
  /** The embeddable template builder: a one-hour link for an iframe or <docustay-builder> on one of your allowed websites. */
  /** Scribe in your own app: a one-hour link for an iframe or <docustay-scribe>. Draft-only: it can make drafts and ask for a send to be approved, never send. */
  scribeSession({ origin, name }, { idempotencyKey } = {}) { return this._request("POST", "/api/v1/embedded/scribe-session", { body: { origin, ...(name ? { name } : {}) }, idempotencyKey }); }
  builderSession({ origin, name }, { idempotencyKey } = {}) { return this._request("POST", "/api/v1/embedded/builder-session", { body: { origin, ...(name ? { name } : {}) }, idempotencyKey }); }
  remind(id, { seat, idempotencyKey } = {}) { return this._request("POST", `/api/v1/documents/${encodeURIComponent(id)}/remind`, { body: seat ? { seat } : {}, idempotencyKey }); }
  /** TEST MODE ONLY: sign one seat of a test document with sample answers (FP-D2). A live key is refused by the server. */
  testSign(id, seat, { decline, reason, idempotencyKey } = {}) { return this._request("POST", `/api/v1/documents/${encodeURIComponent(id)}/test-sign`, { body: { seat, ...(decline ? { decline: true } : {}), ...(reason ? { reason } : {}) }, idempotencyKey }); }
  listEmails(params = {}) { return this._request("GET", "/api/v1/emails", { query: params }); }
  // ── webhooks ──
  listWebhookTopics() { return this._request("GET", "/api/v1/webhooks/topics"); }
  listWebhooks() { return this._request("GET", "/api/v1/webhooks"); }
  /** Add a webhook: `{ url, eventTypes, name? }`, or `{ relay: true, eventTypes }` for one that `docustay listen` fetches to your computer. The secret is in the answer once. */
  createWebhook(body, { idempotencyKey } = {}) { return this._request("POST", "/api/v1/webhooks", { body, idempotencyKey }); }
  deleteWebhook(id) { return this._request("DELETE", `/api/v1/webhooks/${encodeURIComponent(id)}`); }
  testWebhook(id, topic) { return this._request("POST", `/api/v1/webhooks/${encodeURIComponent(id)}/test`, { body: topic ? { topic } : {} }); }
  rotateWebhookSecret(id, windowHours) { return this._request("POST", `/api/v1/webhooks/${encodeURIComponent(id)}/rotate`, { body: windowHours ? { windowHours } : {} }); }
  listWebhookDeliveries(id) { return this._request("GET", `/api/v1/webhooks/${encodeURIComponent(id)}/deliveries`); }
  /** For `docustay listen`: deliveries a relay webhook has stored since `after`, waiting up to `wait` seconds for one. */
  fetchRelayEvents(id, params = {}) { return this._request("GET", `/api/v1/webhooks/${encodeURIComponent(id)}/relay`, { query: params }); }
  deleteDraft(id) { return this._request("DELETE", `/api/v1/documents/${encodeURIComponent(id)}`); }   // a draft that was never sent; a sent one is voided
  voidDocument(id, reason, { idempotencyKey } = {}) { return this._request("POST", `/api/v1/documents/${encodeURIComponent(id)}/void`, { body: reason ? { reason } : {}, idempotencyKey }); }

  // ── templates ──
  listTemplates() { return this._request("GET", "/api/v1/documents/templates"); }
  getTemplate(id) { return this._request("GET", `/api/v1/templates/${encodeURIComponent(id)}`); }
  /** Make a template from HTML with text tags. Returns { templateId, fields, warnings }. */
  createTemplateFromHtml({ name, html, paper }, { idempotencyKey } = {}) { return this._request("POST", "/api/v1/templates/html", { body: { name, html, ...(paper ? { paper } : {}) }, idempotencyKey }); }
  /** Keep a document source (shared-editor JSON) as a template. Returns { templateId, profile, version, hash, warnings }. Needs an idempotency key (one is made if you give none). */
  createTemplateFromSource({ name, source, profile, paper }, { idempotencyKey } = {}) { return this._request("POST", "/api/v1/templates/source", { body: { name, source, ...(profile ? { profile } : {}), ...(paper ? { paper } : {}) }, idempotencyKey }); }
  // ── the v2 flow: words and people ──
  /** Make a document from a source and people (people first: { name, email, role?, action?, order? }). A draft unless `sendNow: true`. Returns { id, state, roles, warnings }. */
  createDocument({ title, source, people, facts, variableValues, paper, send, description, sendNow, metadata, externalId }, { idempotencyKey } = {}) { return this._request("POST", "/api/v1/documents", { body: { title, source, people, ...(metadata ? { metadata } : {}), ...(externalId ? { externalId } : {}), ...(facts ? { facts } : {}), ...(variableValues ? { variableValues } : {}), ...(paper ? { paper } : {}), ...(send ? { send } : {}), ...(description ? { description } : {}), ...(sendNow ? { sendNow: true } : {}) }, idempotencyKey }); }
  /** What a person would be told before saving: { ok, errors, warnings, roles }. */
  checkDocument({ source, facts, people, variableValues, requireSignature, forTemplate }) { return this._request("POST", "/api/v1/documents/check", { body: { source, ...(facts ? { facts } : {}), ...(people ? { people } : {}), ...(variableValues ? { variableValues } : {}), ...(requireSignature === undefined ? {} : { requireSignature }), ...(forTemplate ? { forTemplate: true } : {}) } }); }
  /** The words, people, roles and choices of a draft. */
  getDraftSource(id) { return this._request("GET", `/api/v1/documents/${encodeURIComponent(id)}/source`); }
  /** Change the words of a draft. A NEW draft takes the people and choices and the old one is deleted: use the returned id. */
  reviseDocument(id, { source, facts, variableValues, roleMap }, { idempotencyKey } = {}) { return this._request("POST", `/api/v1/documents/${encodeURIComponent(id)}/revise`, { body: { source, ...(facts ? { facts } : {}), ...(variableValues ? { variableValues } : {}), ...(roleMap ? { roleMap } : {}) }, idempotencyKey }); }
  /** Send a draft. */
  sendDraft(id, { idempotencyKey } = {}) { return this._request("POST", `/api/v1/documents/${encodeURIComponent(id)}/send`, { body: {}, idempotencyKey }); }
  /** Use a written template for people, answering its questions in `variableValues`. A draft unless `sendNow: true`. */
  useTemplate(templateId, { title, people, variableValues, facts, send, sendNow, metadata, externalId }, { idempotencyKey } = {}) { return this._request("POST", `/api/v1/templates/${encodeURIComponent(templateId)}/documents`, { body: { ...(title ? { title } : {}), ...(metadata ? { metadata } : {}), ...(externalId ? { externalId } : {}), people, ...(variableValues ? { variableValues } : {}), ...(facts ? { facts } : {}), ...(send ? { send } : {}), ...(sendNow ? { sendNow: true } : {}) }, idempotencyKey }); }
  /** What a document made from the template starts with: { description, clientDescription, message, send }. */
  setTemplateDefaults(templateId, defaults) { return this._request("POST", `/api/v1/templates/${encodeURIComponent(templateId)}/defaults`, { body: defaults }); }
  /** Ask the assistant to change a document. Returns { jobId, state }; the result is PROPOSED changes (patches.applied) and, with `variables`, proposed answers (patches.values). */
  editWithAi({ request, source, mode, variables }) { return this._request("POST", "/api/v1/documents/ai/edit", { body: { request, source, ...(mode ? { mode } : {}), ...(variables ? { variables } : {}) } }); }
  cancelAiJob(jobId) { return this._request("POST", `/api/v1/documents/ai/jobs/${encodeURIComponent(jobId)}/cancel`, { body: {} }); }
  /** The wizard's questions (with the payment questions and currencies). */
  getWizard() { return this._request("GET", "/api/v1/ai/wizard"); }
  /** Is Stripe ready to take a payment? { status: "connected" | "needs_attention" | "not_connected", mode }. */
  aiUsage() { return this._request("GET", "/api/v1/ai/usage"); }
  paymentsStatus() { return this._request("GET", "/api/v1/payments/status"); }

  // ── the template library: the 54 built-in templates (every plan) ──
  /** The built-in templates: { templates: [{ slug, kind, title, summary, seats, fieldCount, guidance, templateId }], shown }. */
  listLibraryTemplates({ kind } = {}) { return this._request("GET", `/api/v1/templates/library${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`); }
  /** One built-in in full: its fields (who fills each one) and its guidance (questions, facts, checklist, when not to use it). */
  getLibraryTemplate(slug) { return this._request("GET", `/api/v1/templates/library/${encodeURIComponent(slug)}`); }
  /** A draft straight from a built-in (no copy; it does not count toward the monthly new templates). Add people and send it as any draft. */
  draftFromLibraryTemplate(slug, { title } = {}) { return this._request("POST", `/api/v1/templates/library/${encodeURIComponent(slug)}/documents`, { body: title ? { title } : {} }); }
  /** Your own editable copy of a built-in, as a new template (counts toward Free's 5 new templates a month). */
  customizeLibraryTemplate(slug, { name } = {}) { return this._request("POST", `/api/v1/templates/library/${encodeURIComponent(slug)}/customize`, { body: name ? { name } : {} }); }

  // ── skills (plays), playbooks (packs) and drafts (Pro) ──
  /** Skills: the built-in add-ons and house styles and your published skills: { plays: [{ name, title, description, kind }] }. `kind` is addon, house_style or skill. */
  listPlays({ kind, category } = {}) { const q = new URLSearchParams(); if (kind) q.set("kind", kind); if (category) q.set("category", category); return this._request("GET", `/api/v1/plays${q.size ? `?${q}` : ""}`); }
  getPlay(name) { return this._request("GET", `/api/v1/plays/${encodeURIComponent(name)}`); }
  /** A dry run of a play file: every problem, and what the picker would use. Creates nothing. */
  testPlay(source) { return this._request("POST", "/api/v1/plays/test", { body: { source } }); }
  /** Save a play file (Markdown with a YAML block on top) as a new version; publish it to use it. */
  savePlay(source) { return this._request("POST", "/api/v1/plays", { body: { source } }); }
  publishPlay(name, version) { return this._request("POST", `/api/v1/plays/${encodeURIComponent(name)}/publish`, { body: version ? { version } : {} }); }
  duplicatePlay(name, as) { return this._request("POST", `/api/v1/plays/${encodeURIComponent(name)}/duplicate`, { body: as ? { as } : {} }); }
  archivePlay(name) { return this._request("DELETE", `/api/v1/plays/${encodeURIComponent(name)}`); }
  /** Packs: the built-in ones and yours, each with its skills, its templates and whether it is switched on. */
  listPlaybooks() { return this._request("GET", "/api/v1/playbooks"); }
  /** Save a pack: up to 12 skills and 24 templates (`builtin:<slug>` or your template's family id), at least one of either. */
  savePlaybook({ name, title, description, plays = [], templates = [] }) { return this._request("POST", "/api/v1/playbooks", { body: { name, title, ...(description ? { description } : {}), plays, templates } }); }
  /** Switch a pack on or off for the workspace. */
  setPlaybookOn(name, on) { return this._request("POST", `/api/v1/playbooks/${encodeURIComponent(name)}/enable`, { body: { enabled: on === true } }); }
  /** Start a draft from a built-in Document template, guided by its own questions. Returns { status: "needs_input", draftRef, questions } until the must-ask ones are answered, then { status: "draft", documentId }. Nothing is ever sent. */
  startDraft({ template, people, title, answers, values, useDefaults }) { return this._request("POST", "/api/v1/drafts", { body: { template, people, ...(title ? { title } : {}), ...(answers ? { answers } : {}), ...(values ? { values } : {}), ...(useDefaults ? { useDefaults } : {}) } }); }
  answerDraft(draftRef, answers, { useDefaults, values } = {}) { return this._request("POST", `/api/v1/drafts/${encodeURIComponent(draftRef)}/answers`, { body: { answers, ...(values ? { values } : {}), ...(useDefaults ? { useDefaults } : {}) } }); }

  // ── Run 9: search, payments ──
  /** The app's ⌘K search: documents, templates and people, best first. `per` is how many of each kind (1 to 20). */
  search(q, { per } = {}) { const s = new URLSearchParams({ q: String(q ?? "") }); if (per) s.set("per", String(per)); return this._request("GET", `/api/v1/search?${s}`); }
  /** Payments taken through documents, newest first, with this month's figures. Page with `before` (the previous page's `next`). */
  listPayments({ before, limit } = {}) { const s = new URLSearchParams(); if (before) s.set("before", before); if (limit) s.set("limit", String(limit)); return this._request("GET", `/api/v1/payments${s.size ? `?${s}` : ""}`); }
  /** Refund a payment through Stripe: leave out `amountMinor` for the rest of it. `reason` is required (it goes on the payer's receipt and in the audit trail). */
  refundPayment(id, { amountMinor, reason }, { idempotencyKey } = {}) { return this._request("POST", `/api/v1/payments/${encodeURIComponent(id)}/refund`, { body: { ...(amountMinor != null ? { amountMinor } : {}), reason }, idempotencyKey }); }

  /** Ask for an AI-written draft. Returns { jobId, state }. The draft is a suggestion for a person to read; nothing is saved or sent. Refused when AI drafting is off. */
  draftWithAi({ prompt, brief, mode }) { return this._request("POST", "/api/v1/documents/ai/draft", { body: { ...(prompt ? { prompt } : {}), ...(brief ? { brief } : {}), ...(mode ? { mode } : {}) } }); }
  /** Read an AI draft job: { id, state, message, source, patches }. */
  getAiDraft(jobId) { return this._request("GET", `/api/v1/documents/ai/jobs/${encodeURIComponent(jobId)}`); }
  /** Poll getAiDraft until the job is done, failed or cancelled, or the time runs out (throws). */
  async waitForAiDraft(jobId, { timeoutMs = 300000, intervalMs = 2000 } = {}) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.getAiDraft(jobId);
      if (["done", "failed", "cancelled"].includes(job.state)) return job;
      if (Date.now() + intervalMs > end) throw new Error(`AI draft ${jobId} did not finish within ${timeoutMs} ms (last state: ${job.state})`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  /** Make a template from a PDF (Uint8Array/ArrayBuffer/Buffer); text tags in the file place the fields. */
  createTemplateFromFile({ name, fileName, file, fields, minConfidence }, { idempotencyKey } = {}) { return this._request("POST", "/api/v1/templates/file", { body: { name, fileName, file: toBase64(file), ...(fields ? { fields } : {}), ...(minConfidence != null ? { minConfidence } : {}) }, idempotencyKey }); }

  /** Find the fields on a PDF or a page photo (nothing is stored): signature, initials, date, text and tick boxes with their boxes, confidence and signer. */
  detectFields({ file, fileName, minConfidence, ocr } = {}) { return this._request("POST", "/api/v1/documents/detect-fields", { body: { file: toBase64(file), ...(fileName ? { fileName } : {}), ...(minConfidence != null ? { minConfidence } : {}), ...(ocr === false ? { ocr: false } : {}) } }); }

  /** Documents sent this allowance period (the billing period on a paid plan, the calendar month on Free; `periodStart` and `periodEnd`) and emails sent today, against the plan's limits. */
  usage() { return this._request("GET", "/api/v1/usage"); }

  /** Ask BEFORE acting: may I, what does it cost, what are my options. `action` is one of send_document, bulk_send (documents), invite_person or remove_person (people), ai_draft, ai_edit, ai_read_file, create_template, upload (bytes), use_feature (item) or connect_payments. Reads only: nothing is sent, charged or stored. Answers `allowed`, `cost.minor` (whole cents), `severity` (none, info, warn, limit, blocked), `reason` (the refusal code the action would carry), `options` (cheapest first) and `message`. */
  preflight({ action, documents, people, bytes, item, recipients } = {}) { return this._request("POST", "/api/v1/preflight", { body: { action, ...(documents != null ? { documents } : {}), ...(people != null ? { people } : {}), ...(bytes != null ? { bytes } : {}), ...(item ? { item } : {}), ...(Array.isArray(recipients) ? { recipients } : {}) } }); }

  // ── teams ──
  listTeams() { return this._request("GET", "/api/v1/teams"); }
}

function backoff(attempt) { return Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 200); }
function toBase64(data) {
  if (typeof data === "string") return data; // already base64
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Check a webhook delivery (Standard Webhooks). `secret` is the endpoint secret ("whsec_…"); `headers` can be a Headers
 * object or a plain object; `body` is the RAW request text, not parsed JSON. Resolves to the parsed event, or throws.
 */
export async function verifyWebhook(secret, headers, body, { toleranceSeconds = 300, now = Date.now() } = {}) {
  const h = (n) => (typeof headers.get === "function" ? headers.get(n) : headers[n] ?? headers[n.toLowerCase()]);
  const id = h("webhook-id"), ts = h("webhook-timestamp"), sig = h("webhook-signature");
  if (!id || !ts || !sig) throw new Error("missing webhook headers");
  if (Math.abs(now / 1000 - Number(ts)) > toleranceSeconds) throw new Error("webhook timestamp outside the tolerance");
  const raw = String(secret).replace(/^whsec_/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!raw || !/^[A-Za-z0-9+/]+=*$/.test(raw)) throw new Error("that webhook secret is not in the whsec_… form; copy it again from the endpoint's page");
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const key = await globalThis.crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  let s = ""; for (const b of mac) s += String.fromCharCode(b);
  const expected = btoa(s);
  const ok = String(sig).split(" ").some((part) => { const [v, val] = part.split(","); return v === "v1" && timingSafeEqual(val ?? "", expected); });
  if (!ok) throw new Error("webhook signature does not match");
  return JSON.parse(body);
}
function timingSafeEqual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i += 1) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
