// Shared pieces for the assistant's tools: schema helpers, the permission checks the PERSON must hold, and how a tool finds the document that is open.
import { numberBlocks } from "../engine/ai/patches.mjs";
import { getTemplateSource } from "../engine/creation.mjs";
import { apiDraftSource } from "../pdfApiV2.mjs";

export const OBJ = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
export const STR = (description, extra = {}) => ({ type: "string", description, ...extra });
export const ID = (description = "the document's id (from a document the assistant made or listed); leave out for the one that is open") => ({ type: "string", description });
// the permission the person must hold, checked on the server for the person (never trusted from the model). `subject` names the input field that carries the row's id.
export const VIEW = Object.freeze({ object: "document", action: "view", subject: "documentId" });
export const VIEW_ALL = Object.freeze({ object: "document", action: "view" });
export const EDIT = Object.freeze({ object: "document", action: "edit", subject: "documentId" });
export const EDIT_ALL = Object.freeze({ object: "document", action: "edit" });
export const AUTHOR = Object.freeze({ object: "document", action: "template.author" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The document a tool acts on: the id the model named, else the one open on the person's screen. Only a well-formed id gets through. */
export const docIdOf = (ctx, input) => { const v = input?.documentId ?? ctx.documentId ?? null; return typeof v === "string" && UUID_RE.test(v) ? v : null; };
export const isId = (v) => typeof v === "string" && UUID_RE.test(v);

/** Mark the blocks that belong to a Sender only section (a heading with audience "sender" and what follows it up to the next heading): only the sender may see those, and the assistant must not repeat them to someone who says they are a signer. */
export function markSenderOnly(source, numbered) {
  let hidden = false; const flags = source.content.map((b) => { if (b.type === "heading") hidden = b.attrs?.audience === "sender"; return hidden; });
  return numbered.map((b, i) => (flags[i] ? { ...b, senderOnly: true } : b));
}
export { numberBlocks };

/** The open document or template as a source: the editor's own text if the browser sent it (treated as data and validated), else the saved draft or template read under the person's own access. `id` names a specific saved draft. */
export async function loadOpen(ctx, id = null) {
  if (!id && ctx.clientSource) return { source: ctx.clientSource, from: "editor", title: ctx.title ?? null, facts: ctx.facts ?? {}, isTemplate: Boolean(ctx.templateId && !ctx.documentId), variableValues: ctx.values ?? null, documentId: ctx.documentId ?? null };
  const docId = id ?? ctx.documentId;
  if (docId) { try { const d = await apiDraftSource(ctx.db, { tenantId: ctx.tenantId, instanceId: docId }); return { source: d.source, from: "saved draft", title: d.title, facts: d.facts, variableValues: d.variableValues, documentId: docId, people: d.people }; } catch { return null; } }
  if (ctx.templateId) { try { const t = await getTemplateSource(ctx.db, { templateId: ctx.templateId }); return { source: t.source, from: "template", title: t.name, isTemplate: true }; } catch { return null; } }
  return null;
}
export const done = (result, extra = {}) => ({ result, ...extra });
/** A tool's plain refusal. Pass the caught error as `e` and a PLAN LIMIT keeps its code and numbers (Run 8 verify), so the chat shows the limit card from the real tool, not only from a thrown one. */
export const refuse = (error, e = null) => { const d = e?.detail; const plan = typeof d?.code === "string" && /^plan_/.test(d.code) ? { code: d.code, used: d.used ?? null, limit: d.limit ?? null, resetsAt: d.resetsAt ?? null } : null; return { result: { error, ...(plan ?? {}) } }; };
