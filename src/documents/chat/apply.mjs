// What happens when the person ACCEPTS a suggestion that is not a change to the words in an open editor: new people, new send details, or a change to a saved draft that is not open on their screen.
// The same domain functions the screens call do the work; the previous state is kept so Undo can put it back. Pure of HTTP; `ctx.tx(fn)` runs fn in the person's own tenant transaction.
import { getPdfDocument } from "../pdfDocs.mjs";
import { apiSetDraft, apiReviseDocument } from "../pdfApiV2.mjs";
import { applyPatches } from "../engine/ai/patches.mjs";
import { validateSource } from "../engine/validate.mjs";
import { parsePdfBodyData } from "../pdfBody.mjs";

const choiceOf = (o, message) => ({ subject: o.subject ?? "", message: message ?? o.message ?? "", expiryDays: o.expiry_days ?? null, reminderDays: o.reminders?.days ?? [], signingOrder: o.order === "sequential" ? "sequential" : "any", language: o.language ?? "", internalNote: o.internal_note ?? "" });

/** What a draft holds now, in the shape the suggestion tools use, so an undo can put it back. */
async function snapshot(ctx, instanceId, keys) {
  const d = await ctx.tx((tx) => getPdfDocument(tx, { tenantId: ctx.tenantId, instanceId }));
  const labelOf = (key) => (d.body?.roles ?? []).find((r) => r.key === key)?.label ?? key;
  const people = (d.parties ?? []).map((p, i) => ({ name: p.name, email: p.email ?? "", role: labelOf(p.role), action: p.action_role ?? "signer", order: p.position ?? i + 1 }));
  const all = choiceOf(d.sendOptions ?? {}, d.message);
  const choice = keys ? Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]])) : all;
  return { people, choice, state: d.state };
}

/** @returns {Promise<{ok:true, documentId:string, previous?:object}|{ok:false, message:string}>} */
export async function applyProposal(ctx, pr) {
  const id = pr.document_id; if (!id) return { ok: false, message: "That suggestion is not about a saved document." };
  const ownerId = ctx.actorUserId, tenantId = ctx.tenantId;
  try {
    if (pr.kind === "people") {
      const was = await snapshot(ctx, id, ["signingOrder"]); if (was.state !== "draft") return { ok: false, message: `That document is ${was.state} now, so its people can no longer be changed.` };
      await ctx.tx((tx) => apiSetDraft(tx, { tenantId, ownerId, instanceId: id, people: pr.payload.people, sendChoice: pr.payload.signingOrder ? { signingOrder: pr.payload.signingOrder } : {} }));
      return { ok: true, documentId: id, previous: { people: was.people, signingOrder: was.choice.signingOrder } };
    }
    if (pr.kind === "details") {
      const keys = Object.keys(pr.payload.sendChoice ?? {}); const was = await snapshot(ctx, id, keys); if (was.state !== "draft") return { ok: false, message: `That document is ${was.state} now, so its details can no longer be changed.` };
      await ctx.tx((tx) => apiSetDraft(tx, { tenantId, ownerId, instanceId: id, sendChoice: pr.payload.sendChoice }));
      return { ok: true, documentId: id, previous: { sendChoice: was.choice } };
    }
    if (pr.kind === "pdf_fields") {
      const d = await ctx.tx((tx) => getPdfDocument(tx, { tenantId, instanceId: id })); if (d.state !== "draft" || !d.body) return { ok: false, message: "That draft is not open for changes any more." };
      const was = { fields: d.body.fields, roles: d.body.roles, suggestions: d.body.suggestions ?? null };
      const have = new Set(d.body.roles.map((r) => r.key)), roles = d.body.roles.map((r) => pr.payload.roles.find((x) => x.key === r.key) ?? r).concat(pr.payload.roles.filter((r) => !have.has(r.key)));
      const used = new Set(d.body.fields.map((f) => f.id)), fresh = pr.payload.fields.filter((f) => !used.has(f.id) && !d.body.fields.some((o) => o.page === f.page && Math.abs(o.x - f.x) < 0.01 && Math.abs(o.y - f.y) < 0.01));
      const body = { ...d.body, roles, fields: [...d.body.fields, ...fresh] }; delete body.suggestions;
      await ctx.tx((tx) => tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, updated_at = now() WHERE id = $1 AND state = 'draft'`, [id, JSON.stringify(parsePdfBodyData(body))]));
      return { ok: true, documentId: id, previous: was };
    }
    if (pr.kind === "changes") {
      const d = await ctx.tx((tx) => getPdfDocument(tx, { tenantId, instanceId: id })); if (d.state !== "draft" || !d.source) return { ok: false, message: "That draft is not open for changes any more." };
      const applied = applyPatches(d.source, pr.patches); if (!applied.ok || !applied.applied?.length) return { ok: false, message: "The words have changed since this was suggested, so it no longer fits. Ask again." };
      const chk = validateSource(applied.source, { names: [], profile: "typeset" }); if (!chk.ok) return { ok: false, message: `The changed document would not work: ${chk.errors[0]}` };
      const out = await ctx.tx((tx) => apiReviseDocument(tx, { tenantId, ownerId, instanceId: id, source: applied.source }));
      return { ok: true, documentId: out.id, previousId: id, previous: { source: d.source } };
    }
  } catch (e) { return { ok: false, message: String(e?.message ?? "That could not be applied.").slice(0, 300) }; }
  return { ok: false, message: "That kind of suggestion is applied on the screen." };
}

/** Undo what applyProposal did, from the `previous` it returned (kept on the proposal). */
export async function undoProposal(ctx, pr, previous) {
  const id = pr.document_id; const ownerId = ctx.actorUserId, tenantId = ctx.tenantId;
  try {
    if (pr.kind === "people") { await ctx.tx((tx) => apiSetDraft(tx, { tenantId, ownerId, instanceId: id, people: previous.people, sendChoice: previous.signingOrder ? { signingOrder: previous.signingOrder } : {} })); return { ok: true, documentId: id }; }
    if (pr.kind === "details") { const c = { ...previous.sendChoice }; for (const k of Object.keys(c)) if (c[k] === "" || c[k] === null) delete c[k]; await ctx.tx((tx) => apiSetDraft(tx, { tenantId, ownerId, instanceId: id, sendChoice: c })); return { ok: true, documentId: id }; }
    if (pr.kind === "pdf_fields" && previous) {
      const d = await ctx.tx((tx) => getPdfDocument(tx, { tenantId, instanceId: id })); const body = { ...d.body, roles: previous.roles, fields: previous.fields, ...(previous.suggestions ? { suggestions: previous.suggestions } : {}) };
      await ctx.tx((tx) => tx.query(`UPDATE keystone.document_instance SET template_body_snapshot = $2::jsonb, updated_at = now() WHERE id = $1 AND state = 'draft'`, [id, JSON.stringify(parsePdfBodyData(body))])); return { ok: true, documentId: id };
    }
    if (pr.kind === "changes" && previous?.source) { const out = await ctx.tx((tx) => apiReviseDocument(tx, { tenantId, ownerId, instanceId: id, source: previous.source })); return { ok: true, documentId: out.id, previousId: id }; }
  } catch (e) { return { ok: false, message: String(e?.message ?? "That could not be undone.").slice(0, 300) }; }
  return { ok: false, message: "Nothing to undo." };
}
