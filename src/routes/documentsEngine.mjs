// THE SHARED DOCUMENT ENGINE — THE WIRE (design: specs/SHARED-DOCUMENT-ENGINE-DESIGN-6OCT.md). Both products' screens (Docustay's Svelte hub, the platform's React editor) and the public API call
// these, and nothing else reaches the engine's creation service. Same shape as documentsAi.mjs / documentsSettings.mjs: write ROWS spread into writes.mjs's ROUTES (via
// itemsAndDocuments.mjs) and one register function for the reads.
//   POST /api/documents/engine/check               a source → what saving it would say (no write)
//   POST /api/documents/engine/templates           a source → a template (profile typeset | contract)
//   POST /api/documents/engine/templates/version   a new version of a source template
//   POST /api/documents/engine/templates/defaults  what a template starts a document with (notes, message, subject, reminders, expiry, language, who plays each role)
//   POST /api/documents/engine/documents          a source → a one-off document draft (optionally also kept as a template)
//   POST /api/documents/engine/documents/revise   new words for a draft made from words (a new draft id comes back; people and choices are carried over)
//   POST /api/documents/engine/patches/apply       a source + chosen changes → the changed source (for accept/reject of an AI edit)
//   POST /api/documents/engine/guided              answers → a source, no model
//   POST /api/documents/engine/import/markdown     markdown text (+ who signs) → a source, for importing a written agreement
//   POST /api/documents/engine/ai/jobs             ask for a draft (from a wizard `brief`, or a plain prompt) or for changes (returns a job id at once)
//   POST /api/documents/engine/ai/jobs/cancel
//   POST /api/documents/engine/ai/key | /ai/key/clear     the workspace's own provider key (sealed; never returned)
//   GET  /api/documents/engine/templates/:id/source        the source, for the editor
//   GET  /api/documents/engine/ai/jobs/:id                 a job's state and result (poll)
//   GET  /api/documents/engine/ai/status                   is AI on, which provider, usage, own key present (never the key)
//   GET  /api/documents/engine/clauses                     the clause library as source pieces, for the writer's Clauses tab
//   GET  /api/documents/engine/guided/questions            the guided builder's questions (the same list both screens draw)
import { invalid, forbidden } from "../http/errors.mjs";
import { ports as documentsPorts } from "../documents/ports.mjs";
import { getDocumentSetting } from "../documents/settings.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { checkSource, saveSourceTemplate, saveSourceVersion, getTemplateSource, createSourceDocument, listClauseFragments, saveTemplateDefaults } from "../documents/engine/creation.mjs";
import { reviseSourceDocument } from "../documents/engine/revise.mjs";
import { applyPatches } from "../documents/engine/ai/patches.mjs";
import { assembleGuided, GUIDED_QUESTIONS } from "../documents/engine/ai/guided.mjs";
import { markdownToSource } from "../documents/engine/fromMarkdown.mjs";
import { parseSource } from "../documents/engine/source.mjs";
import { createAiJob, getAiJob, cancelAiJob, storeOwnKey, clearOwnKey, ownKeyStatus, readAiConfig, aiUsage, testOwnConnection } from "../documents/engine/ai/jobs.mjs";
import { usageView } from "../documents/engine/ai/gateway.mjs";
import { recordAiOutcome, listAiActions } from "../documents/engine/ai/actionLog.mjs";

const SECTION = "/documents";
const SETTINGS_SECTION = "/documents/settings";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FACT_KEYS = ["org.name", "org.address", "sender.name", "sender.email", "document.title"];
/** Facts a reusable typeset document may be printed with: only the few the caller names, only text. */
const cleanFacts = (f) => { const out = {}; for (const k of FACT_KEYS) if (typeof f?.[k] === "string" && f[k].length <= 300) out[k] = f[k]; for (const [k, v] of Object.entries(f ?? {})) if (/^custom\.[a-z][a-z0-9_]{0,40}$/.test(k) && typeof v === "string" && v.length <= 300) (out.custom ??= {})[k.slice(7)] = v;   /* Docustay flow v2: a value the sender fills in before sending */ return out; };

/** What the workspace itself knows about the merge fields org.name, org.address, sender.name and sender.email, read here so the page never has to send them (it never did, so any draft that used one
 *  was refused with "no value"). What the page does send still wins. A fact the workspace has not set (no address line yet) is left out and is named in the refusal. */
async function workspaceFacts(tx, a) {
  const out = {};
  try {
    const P = await documentsPorts();
    const { practiceName } = await P.brand.get(tx, { tenantId: a.tenantId });
    const sender = a.actorUserId ? (await P.people.byIds(tx, [a.actorUserId]))[0] : null;
    const address = String((await getDocumentSetting(tx, "signed_copy.address_line")) ?? "").trim();
    if (practiceName) out["org.name"] = practiceName;
    if (address) out["org.address"] = address;
    if (sender?.display_name || practiceName) out["sender.name"] = sender?.display_name || practiceName;
    if (sender?.email) out["sender.email"] = sender.email;
  } catch { /* the page's own facts are used alone */ }
  return out;
}
const factsFor = async (tx, a) => ({ ...(await workspaceFacts(tx, a)), ...cleanFacts(a.facts) });
const uuid = (v, field) => { if (!UUID_RE.test(String(v ?? ""))) throw invalid(`${field} must be an id`, { field }); return v; };

const check = async (tx, a) => checkSource({ source: a.source, profile: a.profile, facts: await factsFor(tx, a), requireSignature: a.requireSignature !== false, forTemplate: a.forTemplate === true });
const cleanValues = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, x]) => /^[a-z][a-z0-9_]{0,40}$/.test(k) && typeof x === "string" && x.length <= 300)) : null);
const saveTemplate = async (tx, a) => saveSourceTemplate(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId, name: a.name, source: a.source, profile: a.profile, origin: a.origin, kind: "document", paper: a.paper === "a4" ? "a4" : "letter", facts: await factsFor(tx, a), requireSignature: a.requireSignature !== false, description: a.description ?? null });
const saveVersion = async (tx, a) => saveSourceVersion(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId, templateId: uuid(a.templateId, "templateId"), source: a.source, facts: await factsFor(tx, a), requireSignature: a.requireSignature !== false, changeNote: a.changeNote ?? null });
const saveDefaults = (tx, a) => saveTemplateDefaults(tx, { templateId: uuid(a.templateId, "templateId"), description: a.description, clientDescription: a.clientDescription, message: a.message, sendDefaults: a.sendDefaults, aiRules: a.aiRules });
const revise = async (tx, a) => reviseSourceDocument(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId, instanceId: uuid(a.instanceId, "instanceId"), source: a.source, facts: await factsFor(tx, a), paper: a.paper ?? null, variableValues: a.variableValues === undefined ? undefined : cleanValues(a.variableValues), roleMap: a.roleMap && typeof a.roleMap === "object" && !Array.isArray(a.roleMap) ? Object.fromEntries(Object.entries(a.roleMap).filter(([k, v]) => typeof v === "string" && k.length <= 120 && v.length <= 120)) : {} });
const guided = async (_tx, a) => { const r = assembleGuided(a.answers ?? {}); if (!r.ok) throw invalid(r.errors[0], { field: "answers", details: r.errors }); return { title: r.title, source: r.source, notes: r.notes }; };
const importMarkdown = async (_tx, a) => {
  if (typeof a.markdown !== "string" || !a.markdown.trim()) throw invalid("Paste or upload the text to import.", { field: "markdown" });
  if (a.markdown.length > 400_000) throw invalid("That text is too long to import.", { field: "markdown" });
  const slots = Array.isArray(a.signatureSlots) ? a.signatureSlots : [];
  const p = parseSource(markdownToSource(a.markdown, { signatureSlots: slots, skipUntilRule: a.skipUntilRule === true }));
  if (!p.ok) throw invalid(`The text could not be turned into a document: ${p.errors[0]}`, { field: "markdown", details: p.errors.slice(0, 8) });
  return { source: p.source };
};
const saveDocument = async (tx, a) => createSourceDocument(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId, title: a.title, source: a.source, facts: await factsFor(tx, a), paper: a.paper === "a4" ? "a4" : "letter", saveAsTemplate: a.saveAsTemplate === true, requireSignature: a.requireSignature !== false, variableValues: cleanValues(a.variableValues) });
const patchesApply = async (_tx, a) => {
  const p = parseSource(a.source); if (!p.ok) throw invalid(`The document is not valid: ${p.errors[0]}`, { field: "source" });
  const r = applyPatches(p.source, a.patches); if (!r.ok) throw invalid(`Those changes would break the document: ${r.errors[0]}`, { field: "patches" });
  return { source: r.source, applied: r.applied.length, rejected: r.rejected };
};
const aiJob = (tx, a) => createAiJob(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId, prompt: a.prompt, mode: a.mode, vocabulary: a.vocabulary, kind: a.kind, baseSource: a.baseSource ?? null, baseTemplateId: a.baseTemplateId ? uuid(a.baseTemplateId, "baseTemplateId") : null, brief: a.brief ?? null, variables: Array.isArray(a.variables) ? a.variables : null });
const aiCancel = (tx, a) => cancelAiJob(tx, { jobId: uuid(a.jobId, "jobId") });
const nat = (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? v : 0);
const aiOutcome = (tx, a) => recordAiOutcome(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId, jobId: uuid(a.jobId, "jobId"), accepted: nat(a.accepted), rejected: nat(a.rejected), undone: a.undone === true, targetType: a.targetType ?? null, targetId: a.targetId && UUID_RE.test(a.targetId) ? a.targetId : null });
const aiKey = (tx, a) => storeOwnKey(tx, { tenantId: a.tenantId, key: a.key, actorUserId: a.actorUserId });
const aiKeyClear = (tx, a) => clearOwnKey(tx, { tenantId: a.tenantId });

export const ENGINE_WRITES = Object.freeze([
  { path: "/api/documents/engine/check", section: SECTION, fn: check, object: "document", action: "template.author" },
  { path: "/api/documents/engine/templates", section: SECTION, fn: saveTemplate, object: "document", action: "template.author" },
  { path: "/api/documents/engine/templates/version", section: SECTION, fn: saveVersion, object: "document", action: "template.author" },
  { path: "/api/documents/engine/templates/defaults", section: SECTION, fn: saveDefaults, object: "document", action: "template.author" },
  { path: "/api/documents/engine/guided", section: SECTION, fn: guided, object: "document", action: "template.author" },
  { path: "/api/documents/engine/documents", section: SECTION, fn: saveDocument, object: "document", action: "template.author" },
  { path: "/api/documents/engine/documents/revise", section: SECTION, fn: revise, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/engine/patches/apply", section: SECTION, fn: patchesApply, object: "document", action: "template.author" },
  { path: "/api/documents/engine/import/markdown", section: SECTION, fn: importMarkdown, object: "document", action: "template.author" },
  { path: "/api/documents/engine/ai/jobs", section: SECTION, fn: aiJob, object: "document", action: "template.author" },
  { path: "/api/documents/engine/ai/jobs/cancel", section: SECTION, fn: aiCancel, object: "document", action: "template.author" },
  { path: "/api/documents/engine/ai/outcome", section: SECTION, fn: aiOutcome, object: "document", action: "template.author" },
  { path: "/api/documents/engine/ai/test", section: SETTINGS_SECTION, fn: (tx, a) => testOwnConnection(tx, { tenantId: a.tenantId }), object: "setting", action: "edit", subject: null },
  { path: "/api/documents/engine/ai/key", section: SETTINGS_SECTION, fn: aiKey, object: "setting", action: "edit", subject: null },
  { path: "/api/documents/engine/ai/key/clear", section: SETTINGS_SECTION, fn: aiKeyClear, object: "setting", action: "edit", subject: null },
]);

async function guard(db, principal, tenantId, tenantIsPlatform, { section = SECTION, author = true } = {}) {
  const decision = authoriseSection(principal.user, section, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
  if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
  if (author) await assertMay(db, principal, { object: "document", action: "template.author" });
}

export function registerEngineReads(app, { runTenantScoped, tenantIsPlatform } = {}) {
  const read = (path, handler, { section, author } = {}) => app.get(path, (c) => runTenantScoped(c, async (ctx) => {
    await guard(ctx.db, ctx.principal, ctx.tenantId, tenantIsPlatform, { section, author });
    return { data: await handler(ctx, c) };
  }, { bucket: "documents" }).then((r) => c.json(r)));

  read("/api/documents/engine/templates/:id/source", ({ db }, c) => getTemplateSource(db, { templateId: uuid(c.req.param("id"), "id") }));
  read("/api/documents/engine/ai/jobs/:id", ({ db }, c) => getAiJob(db, { jobId: uuid(c.req.param("id"), "id") }));
  read("/api/documents/engine/clauses", async ({ db }) => ({ clauses: await listClauseFragments(db) }));
  read("/api/documents/engine/guided/questions", () => ({ questions: GUIDED_QUESTIONS }));
  read("/api/documents/engine/ai/log", async ({ db }, c) => {
    const rows = await listAiActions(db, { limit: Number(c.req.query("limit") ?? 50) });
    const people = rows.length ? await (await import("../documents/ports.mjs")).ports().then((P) => P.people.byIds(db, [...new Set(rows.map((r) => r.actor_user_id).filter(Boolean))])) : [];
    const who = new Map(people.map((p) => [p.id, p.display_name || p.email || "Someone"]));
    return { actions: rows.map((r) => ({ id: r.id, at: r.at, kind: r.kind, action: r.action, jobId: r.job_id, targetType: r.target_type, targetId: r.target_id, counts: r.counts, provider: r.provider, model: r.model, inputTokens: r.input_tokens, outputTokens: r.output_tokens, note: r.note, by: r.actor_user_id ? (who.get(r.actor_user_id) ?? "Someone") : null })) };
  }, { section: SETTINGS_SECTION, author: false });
  // what the usage bar shows: the allowance, what is used, when it resets, by kind of work — everyone who can use the writer sees their workspace's own bar
  read("/api/documents/ai/usage", async ({ db, tenantId, principal }) => usageView(db, { tenantId, userId: principal.appUserId ?? null, cfg: await readAiConfig(db) }), { author: false });
  read("/api/documents/engine/ai/status", async ({ db, tenantId }) => {
    const [cfg, key, usage] = await Promise.all([readAiConfig(db), ownKeyStatus(db, { tenantId }), aiUsage(db, { tenantId })]);
    return { enabled: cfg.enabled, provider: cfg.provider, model: cfg.model || null, limitPerDay: cfg.perDay, limitPerMonth: cfg.perMonth, agentName: cfg.agentName || null, whoMayUse: cfg.whoMayUse, allowDraft: cfg.allowDraft, allowEdit: cfg.allowEdit, requireReview: cfg.requireReview, agentKinds: cfg.agentKinds, chatRetentionDays: cfg.chatRetentionDays, usedToday: usage.today, usedThisMonth: usage.month, ownKey: key.present, ownKeyUsable: key.usable, ownKeyPlanNeeded: Boolean(key.planNeeded), ownKeyKeptUntil: key.keptUntil ?? null, ownKeyStopped: Boolean(key.stopped), serviceKey: Boolean(process.env.ANTHROPIC_API_KEY) && cfg.provider === "anthropic" };
  });
}
