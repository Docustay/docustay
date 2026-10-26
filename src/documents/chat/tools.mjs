// THE ASSISTANT'S TOOLS (design §6). Namespaced `docustay.*`, each with the permission the PERSON must hold (checked on the server, never trusted from the model).
// read tools look; proposal tools make a suggestion a person accepts or rejects — the server NEVER changes a document from the chat. There is deliberately no tool that sends, signs, pays, bills or deletes; test/chat_tools.test.mjs fails if a name ever matches FORBIDDEN_NAME.
import { findScreens, NAV } from "./nav.mjs";
import { numberBlocks, applyPatches } from "../engine/ai/patches.mjs";
import { parseSource } from "../engine/source.mjs";
import { validateSource } from "../engine/validate.mjs";
import { variablesOf, getTemplateSource } from "../engine/creation.mjs";
import { apiDraftSource, apiCheckSource } from "../pdfApiV2.mjs";
import { sendBlockersFor } from "../pdfSend.mjs";
import { ports } from "../ports.mjs";
import { OBJ, AUTHOR, EDIT, ID, docIdOf, isId, loadOpen, markSenderOnly } from "./toolkit.mjs";
import { READ_TOOLS } from "./toolsRead.mjs";
import { DRAFT_TOOLS } from "./toolsDraft.mjs";
import { CONFIRM_TOOLS } from "./toolsConfirm.mjs";
import { ASK_TOOLS } from "./toolsAsk.mjs";
import { PLAY_TOOLS } from "./toolsPlays.mjs";
import { PDF_TOOLS } from "./toolsPdf.mjs";


const CORE = [
  { name: "docustay.nav.find", kind: "read", permission: null, step: "Finding the right screen",
    description: `Find the Docustay screens that answer a how-to or where-is question. Returns up to 3 screens from a fixed table (title, path, one line). Never guess a path: only link to what this returns. The table holds: ${NAV.map((n) => n.title).join("; ")}.`,
    input_schema: OBJ({ query: { type: "string", description: "the person's question in a few words" } }, ["query"]),
    run: async (ctx, input) => { const screens = findScreens(String(input?.query ?? "").slice(0, 300), { documentId: ctx.documentId ?? null }); return { result: { screens, note: screens.some((s) => s.needsDocument) ? "A screen marked needsDocument has no link because no document is open." : undefined } }; } },
  { name: "docustay.doc.get", kind: "read", permission: AUTHOR, step: "Looking at your document",
    description: "Read a document the person can edit: its blocks as numbered text, its variables, and for a saved draft who is on it and its send choices. With no input it reads the document that is open; with documentId it reads that saved draft.",
    input_schema: OBJ({ documentId: ID() }),
    run: async (ctx, input) => { const d = await loadOpen(ctx, isId(input?.documentId) ? input.documentId : null); if (!d) return { result: { open: false, note: "No written document or template is open on this screen." } }; return { result: { open: true, from: d.from, title: d.title ?? null, blocks: markSenderOnly(d.source, numberBlocks(d.source)).slice(0, 400), variables: variablesOf(d.source).map((v) => ({ key: v.key, label: v.label, kind: v.kind, value: ctx.values?.[v.key] ?? v.default ?? null })).slice(0, 60), ...(d.documentId ? { documentId: d.documentId } : {}), ...(d.people ? { people: d.people } : {}) } }; } },
  { name: "docustay.doc.run_check", kind: "read", permission: AUTHOR, step: "Running the checks",
    description: "Run the same checks the Check step runs on a document's words (the open one, or a saved draft by documentId): errors that stop it, warnings, and the roles it names.",
    input_schema: OBJ({ documentId: ID() }),
    run: async (ctx, input) => { const d = await loadOpen(ctx, isId(input?.documentId) ? input.documentId : null); if (!d) return { result: { open: false, note: "No written document is open, so there is nothing to check." } }; const r = apiCheckSource({ source: d.source, facts: d.facts ?? {}, variableValues: ctx.values ?? d.variableValues ?? null, forTemplate: d.isTemplate === true }); return { result: { ok: r.ok, errors: r.errors.slice(0, 20), warnings: r.warnings.slice(0, 20), roles: r.roles } }; } },
  { name: "docustay.doc.explain_blockers", kind: "read", permission: AUTHOR, step: "Finding what stops it being sent",
    description: "List, in plain sentences, everything that currently stops the open DRAFT being sent (people, signature fields, payment needs a connected Stripe, deadlines, plan limits). Changes nothing. Needs a saved draft (the open one, or documentId).",
    input_schema: OBJ({ documentId: ID() }),
    run: async (ctx, input) => {
      const did = docIdOf(ctx, input);
      if (!did) return { result: { open: false, note: "No saved draft is open, so there is nothing to check for sending. Open the document first." } };
      const r = await sendBlockersFor(ctx.db, { tenantId: ctx.tenantId, instanceId: did });
      const problems = [...r.problems];
      try { await (await ports()).entitlements?.assertMaySend?.(ctx.db, { tenantId: ctx.tenantId }); } catch (e) { problems.push(String(e?.message ?? "Your plan does not allow another send right now.")); }
      return { result: { sendable: problems.length === 0, problems: problems.slice(0, 20) } };
    } },
  { name: "docustay.doc.propose_changes", kind: "proposal", permission: AUTHOR, step: "Preparing a suggestion", needs: "edit",
    description: "Propose changes to the open document's words. Each patch addresses a block by its number from docustay.doc.get and carries the words it expects to find. ops: replace_text {block, before, after}, insert_block {after, node}, replace_block {block, node}, remove_block {block}. Block numbers are those docustay.doc.get showed; send every patch for one request in ONE call (inserts after the same block keep the order given). A node is a block object: {\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"...\"}]} or {\"type\":\"heading\",\"attrs\":{\"level\":2},\"content\":[{\"type\":\"text\",\"text\":\"...\"}]}. The person sees the change and accepts or rejects it; nothing changes until they accept. Keep it to what was asked.",
    input_schema: OBJ({ documentId: ID(), summary: { type: "string", description: "one plain sentence on what the change does" }, patches: { type: "array", items: { type: "object" }, maxItems: 25 } }, ["summary", "patches"]),
    run: async (ctx, input) => {
      const base = isId(input?.documentId) ? await loadOpen(ctx, input.documentId) : await loadOpen(ctx);
      if (!base?.source) return { result: { proposed: false, note: "No written document is open and no draft was named, so nothing can be changed. Ask the person to open the document, or give its id." } };
      const applied = applyPatches(base.source, input?.patches);
      if (!applied.ok || !applied.applied?.length) return { result: { proposed: false, errors: (applied.errors ?? []).slice(0, 3), rejected: (applied.rejected ?? []).map((r) => r.why).slice(0, 5) } };
      const chk = validateSource(applied.source, { names: [], profile: "typeset" });
      if (!chk.ok) return { result: { proposed: false, errors: [`The changed document would not work: ${chk.errors[0]}`] } };
      return { proposal: { kind: "changes", summary: String(input?.summary ?? "").slice(0, 300), patches: applied.applied, rejected: (applied.rejected ?? []).map((r) => r.why).slice(0, 10), previousSource: base.source, newSource: applied.source, documentId: base.documentId ?? null, serverApply: base.from !== "editor" }, result: { proposed: true, applied: applied.applied.length, rejected: (applied.rejected ?? []).map((r) => r.why).slice(0, 5), note: "The person has been shown the change and will accept or reject it." } };
    } },
  { name: "docustay.doc.propose_values", kind: "proposal", permission: AUTHOR, step: "Preparing the answers", needs: "variables",
    description: "Propose answers for the open template's questions (variables). Keys must be the variable keys from docustay.doc.get. The person checks each answer before it is used.",
    input_schema: OBJ({ summary: { type: "string" }, values: { type: "object", additionalProperties: { type: "string" } } }, ["summary", "values"]),
    run: async (ctx, input) => {
      const d = await loadOpen(ctx); if (!d) return { result: { proposed: false, note: "No template or document with questions is open." } };
      const known = new Map(variablesOf(d.source).map((v) => [v.key, v])); const values = {}, rejected = [];
      for (const [k, v] of Object.entries(input?.values ?? {})) { if (known.has(k) && typeof v === "string" && v.length <= 2000) values[k] = v; else rejected.push(k); }
      if (!Object.keys(values).length) return { result: { proposed: false, note: "None of those keys are questions in this document.", unknown: rejected.slice(0, 10) } };
      return { proposal: { kind: "values", summary: String(input?.summary ?? "").slice(0, 300), values, labels: Object.fromEntries(Object.keys(values).map((k) => [k, known.get(k).label ?? k])), rejected }, result: { proposed: true, count: Object.keys(values).length, unknown: rejected.slice(0, 10), note: "The person has been shown these answers and will accept or reject them." } };
    } },
];
const TOOLS = Object.freeze([...CORE, ...READ_TOOLS, ...DRAFT_TOOLS, ...CONFIRM_TOOLS, ...ASK_TOOLS, ...PLAY_TOOLS, ...PDF_TOOLS]);
export const TOOL_TABLE = Object.freeze(TOOLS.map((t) => Object.freeze({ name: t.name, kind: t.kind, permission: t.permission ?? null })));

export const TOOL_DEFS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
export const toolByName = (n) => TOOLS.find((t) => t.name === n) ?? null;

/** Run one tool for a person. `ctx.toolOverrides[name]` replaces a tool's body for the eval suite and tests only (the product never sets it). Checks the permission FIRST (a refusal is a result the model reads, never a crash), then runs; every failure is a plain result, never a stack. */
export async function runTool(name, input, ctx) {
  const tool = toolByName(name);
  if (!tool) return { result: { error: "That is not a tool I have." } };
  if (tool.permission) {
    const docId = tool.permission.subject ? docIdOf(ctx, input) : null;   // a per-document check names the row; with no document in play, the plain verb is asked
    const check = tool.permission.subject && !docId ? { object: tool.permission.object, action: tool.permission.action } : tool.permission;
    if (!(await ctx.can(check, docId ? { [tool.permission.subject]: docId } : null))) return { result: { error: "You do not have permission to do that here." }, denied: true };
  }
  try { const over = ctx.toolOverrides?.[name]; return over ? await over(ctx, input ?? {}) : await tool.run(ctx, input ?? {}); } catch (e) { const d = e?.detail; const plan = typeof d?.code === "string" && /^plan_/.test(d.code) ? { code: d.code, used: d.used ?? null, limit: d.limit ?? null, resetsAt: d.resetsAt ?? null } : null; return { result: { error: String(e?.message ?? "That did not work.").slice(0, 300), ...(plan ?? {}) }, failed: true }; }   // a plan limit keeps its code, so the chat can show the limit card
}

/** Parse a source the browser sent: data, never trusted. null when absent; throws a plain error when present but not a valid source. */
export function parseClientSource(raw) {
  if (raw === undefined || raw === null) return null;
  const p = parseSource(raw); if (!p.ok) throw new Error(`The open document could not be read (${p.errors[0]}).`);
  return p.source;
}
