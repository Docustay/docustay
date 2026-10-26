export interface Party { seat: string; name: string; email: string; }
export interface SendRequest { templateId: string; parties: Party[]; title?: string; message?: string | null; subject?: string; expiryDays?: number; metadata?: Metadata; externalId?: string; embedded?: string[]; /** The sender's own boxes and send-time amounts by key, e.g. { effective_date: "2026-11-01" }. */ values?: Record<string, string>; }
/** Your own key-value text on a document (up to 20 keys, values up to 500 characters). */
export type Metadata = Record<string, string>;
export interface DocumentSummary { externalId: string | null; metadata: Metadata; test: boolean; id: string; title: string; state: string; parties: number; createdAt: string | null; sentAt: string | null; executedAt: string | null; expiresAt: string | null; }
export interface Page { limit: number; nextCursor: string | null; hasMore: boolean; }
export interface Template { id: string; name: string; [k: string]: unknown; }
export interface TemplateMade { templateId: string; fields: number; warnings: unknown[]; }
export interface PlanLimitDetail { code: "plan_document_limit" | "plan_signer_limit" | "plan_template_limit"; used: number; limit: number; resetsAt: string; }
export interface Options { baseUrl?: string; maxRetries?: number; timeoutMs?: number; fetch?: typeof fetch; }
export interface Call { idempotencyKey?: string; }

export interface AiDraftJob { id: string; state: "queued" | "running" | "done" | "failed" | "cancelled"; message?: string | null; source?: Record<string, unknown> | null; patches?: { notes?: unknown; title?: unknown } | null }

export interface WebhookEndpoint { id: string; name: string; url: string | null; relay: boolean; eventTypes: string[]; status: "active" | "paused" | "disabled"; disabledReason: string | null; consecutiveFailures: number; fingerprint: string; createdAt: string }

export class DocustayError extends Error {
  status: number; kind: string; requestId: string | null; retryable: boolean; retryAfterSeconds: number | null; detail: unknown;
  /** A plan limit: "plan_document_limit" (the plan's documents this period are used) or "plan_template_limit" (Free: 5 and Pay as you go: 25 new templates a month) or "plan_signer_limit" (Free: 15 different signers a month). `detail` is then a PlanLimitDetail. */
  code: "plan_document_limit" | "plan_signer_limit" | "plan_template_limit" | string | null;
}
export class Docustay {
  /** `apiKey` may be `process.env.DOCUSTAY_API_KEY` as it stands (R13-D360: strict TypeScript refused `string | undefined`); a missing key throws "Docustay: an API key is required". */
  constructor(apiKey: string | undefined, options?: Options);
  readonly testMode: boolean;
  sendDocument(request: SendRequest, call?: Call): Promise<{ id: string; state: string }>;
  getDocument(id: string): Promise<Record<string, unknown> & { id: string; state: string; test: boolean }>;
  listDocuments(params?: { state?: string; limit?: number; cursor?: string; externalId?: string; metadata?: Metadata }): Promise<{ documents: DocumentSummary[]; page: Page }>;
  eachDocument(params?: { state?: string; limit?: number }): AsyncGenerator<DocumentSummary>;
  downloadSignedPdf(id: string): Promise<ArrayBuffer>;
  auditLogCsv(id: string): Promise<string>;
  builderSession(body: { origin: string; name?: string }, call?: Call): Promise<{ url: string; expiresAt: string }>;
  scribeSession(body: { origin: string; name?: string }, call?: Call): Promise<{ url: string; expiresAt: string }>;
  remind(id: string, options?: { seat?: string } & Call): Promise<{ id: string; reminded: number }>;
  /** TEST MODE ONLY: sign one seat of a test document with sample answers. */
  testSign(id: string, seat: string, call?: Call & { decline?: boolean; reason?: string }): Promise<{ id: string; seat: string; signed: boolean; declined?: boolean; state: string; progress: { signed: number; of: number }; finished: boolean }>;
  listWebhookTopics(): Promise<{ topics: string[] }>;
  listWebhooks(): Promise<{ webhooks: WebhookEndpoint[] }>;
  /** `{ url, eventTypes }` for a public address, or `{ relay: true, eventTypes }` for one `docustay listen` fetches. `secret` is in the answer once. */
  createWebhook(body: { url?: string; relay?: boolean; name?: string; eventTypes: string[] }, opts?: { idempotencyKey?: string }): Promise<WebhookEndpoint & { secret: string }>;
  getWebhook(id: string): Promise<WebhookEndpoint>;
  deleteWebhook(id: string): Promise<{ ok: true }>;
  testWebhook(id: string, topic?: string): Promise<{ outcome: string; status: number | null; durationMs: number; responseExcerpt: string | null; error: string | null; topic: string }>;
  rotateWebhookSecret(id: string, windowHours?: number): Promise<{ secret: string; fingerprint: string; previousValidUntil: string }>;
  listWebhookDeliveries(id: string): Promise<{ deliveries: { id: string; event: string; attempt: number; status: string; responseStatus: number | null; error: string | null; attemptedAt: string }[] }>;
  fetchRelayEvents(id: string, params?: { after?: string; wait?: number; limit?: number }): Promise<{ events: { id: string; topic: string | null; headers: Record<string, string>; body: string; at: string }[]; cursor: string | null }>;
  listEmails(params?: { documentId?: string; to?: string; status?: string; kind?: string; limit?: number; cursor?: string }): Promise<{ emails: Record<string, unknown>[]; nextCursor: string | null }>;
  /** Deletes a draft that was never sent. A sent document answers 409: void it instead. */
  deleteDraft(id: string): Promise<{ id: string; deleted: boolean }>;
  voidDocument(id: string, reason?: string, call?: Call): Promise<{ id: string; state: string }>;
  listTemplates(): Promise<{ templates: Template[] }>;
  /** The 54 built-in templates (Run 9 Part 4R). */
  listLibraryTemplates(params?: { kind?: "document" }): Promise<{ templates: Array<{ slug: string; kind: "document"; title: string; summary: string; seats: string[]; fieldCount: number; senderFields: number; templateId: string | null; guidance: Record<string, unknown> | null }>; shown: boolean; version: string }>;
  getLibraryTemplate(slug: string): Promise<Record<string, unknown>>;
  draftFromLibraryTemplate(slug: string, options?: { title?: string }): Promise<{ instanceId?: string; templateId: string; builtin: string; kind: "document" }>;
  customizeLibraryTemplate(slug: string, options?: { name?: string }): Promise<{ templateId: string; from: string; kind: "document" }>;
  listPlays(params?: { kind?: "addon" | "house_style" | "skill"; category?: string }): Promise<{ plays: Array<{ name: string; title: string; description: string; kind: "addon" | "house_style" | "skill"; category: string | null }> }>;
  getPlay(name: string): Promise<Record<string, unknown>>;
  testPlay(source: string): Promise<{ ok: boolean; errors?: string[] } & Record<string, unknown>>;
  savePlay(source: string): Promise<{ id: string; name: string; version: number; published: boolean }>;
  publishPlay(name: string, version?: number): Promise<{ name: string; published: boolean; version: number }>;
  duplicatePlay(name: string, as?: string): Promise<{ id: string; name: string; version: number }>;
  archivePlay(name: string): Promise<{ name: string; archived: boolean }>;
  listPlaybooks(): Promise<{ playbooks: Array<{ name: string; title: string; description: string; plays: string[]; templates: string[]; enabled: boolean; builtin: boolean }> }>;
  savePlaybook(input: { name: string; title: string; description?: string; plays?: string[]; templates?: string[] }): Promise<{ id: string; name: string }>;
  setPlaybookOn(name: string, on: boolean): Promise<{ name: string; enabled: boolean; builtin: boolean }>;
  startDraft(input: { template: string; people: Array<{ name: string; email?: string; role?: string; action?: "signer" | "approver" | "viewer" | "cc" }>; title?: string; answers?: Record<string, string | string[]>; values?: Record<string, string>; useDefaults?: boolean }): Promise<{ status: "needs_input"; draftRef: string; questions: Array<{ key: string; question: string; multiSelect: boolean; options: Array<{ label: string; description?: string; recommended?: boolean }> }>; remaining: number } | { status: "draft"; documentId: string; title: string; playRef: string; notes: Array<{ topic: string; note: string }>; checklist: string[] }>;
  answerDraft(draftRef: string, answers: Record<string, string | string[]>, options?: { useDefaults?: boolean; values?: Record<string, string> }): Promise<Record<string, unknown>>;
  getTemplate(id: string): Promise<Template>;
  createTemplateFromHtml(input: { name: string; html: string; paper?: string }, call?: Call): Promise<TemplateMade>;
  createTemplateFromSource(input: { name: string; source: Record<string, unknown>; profile?: "typeset" | "contract"; paper?: "letter" | "a4" }, call?: Call): Promise<{ templateId: string; profile: string; version: number; hash: string; warnings: unknown[] }>;
  draftWithAi(input: { prompt: string; mode?: "template" | "document" }): Promise<{ jobId: string; state: string }>;
  getAiDraft(jobId: string): Promise<AiDraftJob>;
  waitForAiDraft(jobId: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<AiDraftJob>;
  createTemplateFromFile(input: { name: string; fileName: string; file: Uint8Array | ArrayBuffer | string }, call?: Call): Promise<TemplateMade>;
  usage(): Promise<{ plan: string | null; period: { start: string; end: string } | null; documents: { used: number; limit: number | null } | null; emails: { usedToday: number; limitPerDay: number; resetsAt: string } | null; templates?: { used: number; limit: number | null; resetsAt: string | null } | null }>;
  preflight(input: { action: "send_document" | "bulk_send" | "invite_person" | "remove_person" | "ai_draft" | "ai_edit" | "ai_read_file" | "create_template" | "upload" | "use_feature" | "connect_payments"; documents?: number; people?: number; bytes?: number; item?: string; recipients?: string[] }): Promise<{ action: string; allowed: boolean; plan: { key: string; name: string } | null; period: { start: string; end: string; resets: string; kind: string } | null; meter: Record<string, unknown> | null; cost: { minor: number; currency: string; units: number; perUnitMinor: number | null; per: string | null; prorated: boolean; feePercent?: number }; afterThis: Record<string, unknown> | null; severity: "none" | "info" | "warn" | "limit" | "blocked"; reason: string | null; options: { key: "payg" | "pro" | "lifetime" | "raise_budget" | "wait"; label: string; priceMinor: number | null; per: string | null; founders?: boolean; unlocks: string[] }[]; message: string; allowedCount?: number }>;
  listTeams(): Promise<{ teams: { id: string; name: string; members: unknown[] }[] }>;
}
export function verifyWebhook(secret: string, headers: Headers | Record<string, string>, body: string, options?: { toleranceSeconds?: number; now?: number }): Promise<Record<string, unknown>>;

