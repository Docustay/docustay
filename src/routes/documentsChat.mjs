// THE ASSISTANT CHAT ROUTES (design: specs/AI-CHAT-SPEC-6OCT.md §3). Docustay's session routes only. The turn streams (SSE) and holds NO transaction open while the model thinks: preflight opens one, the stream uses a short tenant transaction per statement.
// A person only ever reads, continues, decides on or deletes their OWN conversations. Settings (ai.enabled, ai.who_may_use, limits) are checked here on the server for every turn.
import { scriptedStream } from "../documents/engine/ai/scripted.mjs";
import { streamSSE } from "hono/streaming";
import { invalid, forbidden, notFound, conflict } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { withTenant } from "../db/index.mjs";
import { readAiConfig, resolveKey, mayUseAi } from "../documents/engine/ai/jobs.mjs";
import { admit, fakeAllowed } from "../documents/engine/ai/gateway.mjs";
import { fakeStream } from "../documents/engine/ai/fake.mjs";
import { createConversation, ownConversation, listConversations, loadMessages, deleteConversation, runChatTurn, decideProposal, recordApplied, claimCard, settleCard, toTurns } from "../documents/chat/chat.mjs";
import { applyProposal, undoProposal } from "../documents/chat/apply.mjs";
import { executeCard } from "../documents/chat/confirm.mjs";
import { acknowledgeReview } from "../documents/chat/review.mjs";
import { chatFileBlocks } from "../documents/chat/files.mjs";
import { sendMail } from "../documents/emailIdentity.mjs";
import { parseClientSource, toolByName } from "../documents/chat/tools.mjs";
import { ports } from "../documents/ports.mjs";

const SECTION = "/documents";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v, name) => { if (typeof v !== "string" || !UUID_RE.test(v)) throw invalid(`${name} must be an id`, { field: name }); return v; };
const optId = (v, name) => (v === undefined || v === null || v === "" ? null : uuid(v, name));
const TURN_MS = 60_000;

/** Settings checks every turn: switched on, the person may use it, the provider is one the chat can use. Returns what the turn needs. */
async function preflight(db, principal, tenantId, tenantIsPlatform) {
  const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
  if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
  const cfg = await readAiConfig(db);
  const demoPort = (await ports()).demo ?? null;
  if (demoPort && (await demoPort.isDemo(db))) {   // the public demo: the assistant is on, for the one visitor; a few real prompts, then the scripted "Demo AI" (aiMode, below)
    const key = await resolveKey(db, { tenantId, provider: "anthropic" }).catch(() => null);
    return { cfg: { ...cfg, enabled: true, provider: "anthropic", whoMayUse: "owner" }, apiKey: key || null, userId: principal.appUserId, demo: true };
  }
  if (!cfg.enabled) throw conflict("The assistant is switched off for this workspace. An owner can switch it on in Settings, AI drafting.", { code: "ai_off" });
  const [me] = await (await ports()).people.byIds(db, [principal.appUserId]);
  if (!mayUseAi(cfg.whoMayUse, me?.staff_role ?? null)) throw forbidden(cfg.whoMayUse === "owner" ? "Only the owner of this workspace may use the assistant." : "Only owners and admins of this workspace may use the assistant.", { code: "ai_who" });
  const chatProvider = cfg.provider === "anthropic" || (cfg.provider === "fake" && fakeAllowed());
  if (!chatProvider) throw conflict("The assistant needs the Anthropic provider. This workspace uses another one, so only the guided builder is available.", { code: "ai_provider" });
  const apiKey = cfg.provider === "fake" ? "fake" : await resolveKey(db, { tenantId, provider: cfg.provider });
  if (!apiKey) throw conflict("The assistant needs an AI key before it can answer. An owner or admin can add this workspace's own key in Settings, AI drafting.", { code: "ai_no_key" });
  return { cfg, apiKey, userId: principal.appUserId };
}

export function registerChatRoutes(app, { runTenantScoped, tenantIsPlatform } = {}) {
  const scoped = (path, method, handler) => app[method](path, (c) => runTenantScoped(c, async (ctx) => ({ data: await handler(ctx, c) }), { bucket: "documents" }).then((r) => c.json(r)));

  scoped("/api/documents/chat/status", "get", async ({ db, principal, tenantId }) => {
    const cfg = await readAiConfig(db); const [me] = await (await ports()).people.byIds(db, [principal.appUserId]);
    if ((await (await ports()).demo?.isDemo(db)) === true) return { enabled: true, allowed: true, agentName: cfg.agentName || null, reason: null, retentionDays: cfg.chatRetentionDays, demo: true };
    const chatProvider = cfg.provider === "anthropic" || (cfg.provider === "fake" && fakeAllowed());
    const who = mayUseAi(cfg.whoMayUse, me?.staff_role ?? null);
    // Run 8 (R8-36): a workspace that switched the assistant on where no AI key is available (its own, or the service's) is told so HERE, before anyone types — not by an error on the first message
    const keyReady = cfg.enabled && chatProvider ? (cfg.provider === "fake" ? true : Boolean(await resolveKey(db, { tenantId, provider: cfg.provider }))) : false;
    const allowed = cfg.enabled && chatProvider && who && keyReady;
    return { enabled: cfg.enabled, allowed, agentName: cfg.agentName || null, reason: !cfg.enabled ? "off" : !chatProvider ? "provider" : !who ? "who" : !keyReady ? "key" : null, retentionDays: cfg.chatRetentionDays };
  });
  scoped("/api/documents/chat/conversations", "get", async ({ db, principal }) => ({ conversations: (await listConversations(db, { ownerUserId: principal.appUserId })).map((r) => ({ id: r.id, title: r.title, screen: r.screen, lastAt: r.last_at })) }));
  scoped("/api/documents/chat/conversations", "post", async ({ db, principal, tenantId }, c) => {
    await preflight(db, principal, tenantId, tenantIsPlatform);
    const b = await c.req.json().catch(() => ({}));
    const id = await createConversation(db, { tenantId, ownerUserId: principal.appUserId, screen: typeof b.screen === "string" ? b.screen : null, documentId: optId(b.documentId, "documentId"), templateId: optId(b.templateId, "templateId") });
    return { conversationId: id };
  });
  scoped("/api/documents/chat/conversations/:id", "get", async ({ db, principal }, c) => {
    const id = uuid(c.req.param("id"), "id"); const conv = await ownConversation(db, { conversationId: id, ownerUserId: principal.appUserId }); if (!conv) throw notFound("That conversation was not found.");
    const rows = await loadMessages(db, { conversationId: id });
    const { rows: props } = await db.query(`SELECT id, kind, action, summary, patches, vals, state, message_seq, document_id, payload FROM keystone.document_chat_proposal WHERE conversation_id = $1 ORDER BY message_seq`, [id]);
    const text = (content) => (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n") : String(content ?? ""));
    const isToolResult = (r) => r.role === "user" && Array.isArray(r.content) && r.content.length > 0 && r.content.every((b) => b.type === "tool_result");
    // one message per person's turn and one per answer: the answer joins every assistant row of the turn (its words, its steps), and keeps the seq range its cards belong to
    const { rows: rated } = await db.query(`SELECT message_seq, rating FROM keystone.document_chat_rating WHERE conversation_id = $1`, [id]); const ratingOf = new Map(rated.map((x) => [x.message_seq, x.rating]));
    const failed = new Set(rows.filter(isToolResult).flatMap((r) => r.content.filter((b) => { try { return JSON.parse(b.content)?.error; } catch { return false; } }).map((b) => b.tool_use_id)));
    const messages = [];
    for (const r of rows) {
      if (r.role === "user" && !isToolResult(r)) { const t = text(r.content); if (t) messages.push({ seq: r.seq, seqFrom: r.seq, seqTo: r.seq, role: "user", text: t }); continue; }
      let a = messages.at(-1); if (!a || a.role !== "assistant") { a = { seq: r.seq, seqFrom: r.seq, seqTo: r.seq, role: "assistant", text: "", steps: [] }; messages.push(a); }
      a.seqTo = r.seq;
      if (r.role === "assistant") { const t = text(r.content); if (t) a.text += (a.text ? "\n\n" : "") + t; for (const b of Array.isArray(r.content) ? r.content : []) if (b.type === "tool_use") a.steps.push({ label: toolByName(String(b.name).replace(/__/g, "."))?.step ?? "Working", ok: !failed.has(b.id) }); a.seq = r.seq; a.rating = ratingOf.get(r.seq) ?? a.rating ?? 0; }
    }
    const shown = messages.filter((m) => m.text || m.steps?.length);
    return { conversation: { id, title: conv.title, screen: conv.screen }, messages: shown, proposals: props.map((p) => ({ id: p.id, kind: p.kind, summary: p.summary, state: p.state, seq: p.message_seq, count: p.kind === "changes" ? (p.patches ?? []).length : Object.keys(p.vals ?? {}).length, action: p.action ?? undefined, documentId: p.document_id ?? undefined, card: p.payload?.card ?? undefined, needsReason: p.payload?.card?.needsReason ?? undefined })), turns: toTurns(rows).length };
  });
  app.delete("/api/documents/chat/conversations/:id", (c) => runTenantScoped(c, async ({ db, principal }) => { const ok = await deleteConversation(db, { conversationId: uuid(c.req.param("id"), "id"), ownerUserId: principal.appUserId }); if (!ok) throw notFound("That conversation was not found."); return { data: { deleted: true } }; }, { bucket: "documents" }).then((r) => c.json(r)));

  // what the route hands the apply and card code: the person's own transaction, and the person's own permission check
  const personCtx = ({ db, principal, tenantId }, extra = {}) => ({ db, tx: (fn) => fn(db), tenantId, actorUserId: principal.appUserId, can: (check, body = null) => assertMay(db, principal, check, body).then(() => true, () => false), ...extra });

  for (const decision of ["accept", "reject", "undo"]) {
    scoped(`/api/documents/chat/proposals/:id/${decision}`, "post", async (rc, c) => {
      const { db, principal, tenantId } = rc;
      await assertMay(db, principal, { object: "document", action: "template.author" });
      const body = await c.req.json().catch(() => ({}));
      const proposalId = uuid(c.req.param("id"), "id");
      const r = await decideProposal(db, { tenantId, actorUserId: principal.appUserId, proposalId, decision });
      if (r.notFound) throw notFound("That suggestion was not found.");
      if (!r.ok) throw conflict(r.message ?? "That cannot be done now.", { code: "proposal_state", state: r.state });
      const row = r.row; let applied = null;
      // people, details and a change to a saved draft that is not open in an editor are applied here, by the same functions the screens use; a failure rolls the whole decision back
      const here = row.kind === "people" || row.kind === "details" || row.kind === "pdf_fields" || (row.kind === "changes" && row.document_id && body.editorOpen !== true);
      if (here && decision !== "reject") {
        await assertMay(db, principal, { object: "document", action: "edit", subject: "documentId" }, { documentId: row.document_id });
        const ctx = personCtx(rc, { conversationId: row.conversation_id });
        applied = decision === "accept" ? await applyProposal(ctx, row) : await undoProposal(ctx, row, row.result?.previous);
        if (!applied.ok) throw conflict(applied.message ?? "That could not be applied.", { code: "apply_failed" });
        await recordApplied(db, { tenantId, proposalId, conversationId: row.conversation_id, applied: decision === "accept" ? applied : { ...applied, previous: null } });
      }
      const { row: _row, ...out } = r;
      return { ...out, ...(applied ? { appliedOnServer: true, documentId: applied.documentId, previousId: applied.previousId ?? null } : {}) };
    });
  }

  // a confirmation card's button: the ONLY way a send, a void, a resend or the rest can run from the chat
  scoped("/api/documents/chat/proposals/:id/confirm", "post", async (rc, c) => {
    const { db, principal, tenantId } = rc;
    const body = await c.req.json().catch(() => ({}));
    const proposalId = uuid(c.req.param("id"), "id");
    const claimed = await claimCard(db, { proposalId, actorUserId: principal.appUserId });
    if (claimed.notFound) throw notFound("That card was not found.");
    if (claimed.notACard) throw conflict("That is not a card with a button.", { code: "not_a_card" });
    if (claimed.alreadyDone) throw conflict("That card has already been used.", { code: "card_used", state: claimed.state });
    const row = claimed.row; const action = row.action;
    if (action !== "support") await assertMay(db, principal, row.document_id ? { object: "document", action: "edit", subject: "documentId" } : { object: "document", action: "edit" }, row.document_id ? { documentId: row.document_id } : null);
    const to = process.env.KEYSTONE_DOCUSTAY_SUPPORT_EMAIL;
    const notifySupport = async (r) => { if (!to) return; await sendMail(db, { tenantId, to, subject: `Docustay ${r.kind === "problem" ? "problem report" : "message from a customer"}`, text: `Report ${r.id}\nWorkspace: ${tenantId}\nScreen: ${r.screen ?? ""}\nDocument: ${r.documentId ?? ""}\nDocument text included: ${r.includeText ? "yes" : "no"}\n\n${r.note}` }); };
    const ctx = personCtx(rc, { conversationId: row.conversation_id, notifySupport });
    const out = await executeCard(ctx, { action, payload: row.payload ?? {}, body });
    await settleCard(db, { tenantId, actorUserId: principal.appUserId, proposalId, action, ok: true, result: { summary: out.summary, link: out.link ?? null, documentId: out.documentId ?? null } });
    return { state: "confirmed", ...out };
  });

  // thumbs: only the rating and the ids, never text
  scoped("/api/documents/chat/ratings", "post", async ({ db, principal, tenantId }, c) => {
    const b = await c.req.json().catch(() => ({})); const conversationId = uuid(b.conversationId, "conversationId");
    if (![-1, 1].includes(b.rating) || !Number.isInteger(b.seq)) throw invalid("A rating is 1 or -1 for a message.", { field: "rating" });
    const conv = await ownConversation(db, { conversationId, ownerUserId: principal.appUserId }); if (!conv) throw notFound("That conversation was not found.");
    await db.query(`INSERT INTO keystone.document_chat_rating (tenant_id, conversation_id, message_seq, user_id, rating) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, conversation_id, message_seq) DO UPDATE SET rating = EXCLUDED.rating, user_id = EXCLUDED.user_id, created_at = now()`, [tenantId, conversationId, b.seq, principal.appUserId, b.rating]);
    return { saved: true };
  });

  // ai.require_review: the sender says they read what the assistant wrote (Check step). Only the press is recorded, never text.
  scoped("/api/documents/chat/review", "post", async ({ db, principal, tenantId }, c) => {
    const b = await c.req.json().catch(() => ({})); const documentId = uuid(b.documentId, "documentId");
    await assertMay(db, principal, { object: "document", action: "edit", subject: "documentId" }, { documentId });
    return acknowledgeReview(db, { tenantId, actorUserId: principal.appUserId, instanceId: documentId });
  });

  // the turn: streamed
  app.post("/api/documents/chat/conversations/:id/messages", async (c) => {
    const id = uuid(c.req.param("id"), "id");
    const body = await c.req.json().catch(() => ({}));
    const regenerate = body.regenerate === true;
    let text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text && !regenerate) throw invalid("Say something first.", { field: "text" });
    if (text.length > 4000) throw invalid("That is too long: 4000 characters at most.", { field: "text" });
    const x = body.context && typeof body.context === "object" ? body.context : {};
    let clientSource = null; try { clientSource = parseClientSource(x.source); } catch (e) { throw invalid(e.message, { field: "context.source" }); }
    const pre = await runTenantScoped(c, async (ctx) => {
      const p = await preflight(ctx.db, ctx.principal, ctx.tenantId, tenantIsPlatform);
      const conv = await ownConversation(ctx.db, { conversationId: id, ownerUserId: ctx.principal.appUserId });
      if (!conv) throw notFound("That conversation was not found.");
      // the allowance, the request limits and the platform pause, decided in one place; a refusal is a plain sentence and is written to the ledger
      let adm = null, scripted = false;
      if (p.demo) {
        const dp = (await ports()).demo; scripted = (await dp.aiMode(ctx.db, { hasKey: Boolean(p.apiKey) })) !== "real";
        if (!scripted) { try { adm = await admit(ctx.db, { tenantId: ctx.tenantId, userId: p.userId, feature: "chat", cfg: p.cfg }); } catch { await dp.refundAiPrompt(ctx.db); scripted = true; } }
      } else adm = await admit(ctx.db, { tenantId: ctx.tenantId, userId: p.userId, feature: "chat", cfg: p.cfg });
      return { ...p, tenantId: ctx.tenantId, principal: ctx.principal, conv, adm, scripted };
    }, { bucket: "documents" });
    const { cfg, apiKey, userId, tenantId, principal, conv, adm, scripted } = pre;
    const db = { query: (sql, p) => withTenant(tenantId, (tx) => tx.query(sql, p), { userId }) };
    const can = (check, forRow = null) => withTenant(tenantId, (tx) => assertMay(tx, principal, check, forRow).then(() => true, () => false), { userId });
    const tx = (fn) => withTenant(tenantId, fn, { userId });   // a real transaction for a tool that makes a draft: short, and never open while the model thinks
    if (regenerate) {   // "regenerate": drop the last answer (and the suggestions it made that nobody has decided on) and ask the same question again
      const { rows: msgs } = await db.query(`SELECT seq, role, content FROM keystone.document_chat_message WHERE conversation_id = $1 ORDER BY seq DESC LIMIT 60`, [id]);
      const last = msgs.find((m) => m.role === "user" && !(Array.isArray(m.content) && m.content.every((b) => b?.type === "tool_result")));
      if (!last) throw invalid("There is nothing to regenerate yet.");
      text = (Array.isArray(last.content) ? last.content.filter((b) => b.type === "text").map((b) => b.text).join("\n") : String(last.content ?? "")).trim();
      await db.query(`DELETE FROM keystone.document_chat_proposal WHERE conversation_id = $1 AND message_seq >= $2 AND state = 'proposed'`, [id, last.seq]);
      await db.query(`DELETE FROM keystone.document_chat_message WHERE conversation_id = $1 AND seq >= $2`, [id, last.seq]);
    }
    const context = { screen: typeof x.screen === "string" ? x.screen.slice(0, 200) : conv.screen, documentId: optId(x.documentId, "documentId") ?? conv.document_id, templateId: optId(x.templateId, "templateId") ?? conv.template_id, clientSource, values: x.values && typeof x.values === "object" ? x.values : null, title: typeof x.title === "string" ? x.title.slice(0, 120) : null };
    // a file just attached: its pages go to the model for this one message when the workspace allows it and the person may view that document
    if (x.readFile === true && cfg.readFiles !== false && context.documentId) {
      try { if (!(await can({ object: "document", action: "view", subject: "documentId" }, { documentId: context.documentId }))) throw new Error("may not view"); const r = await withTenant(tenantId, (t) => chatFileBlocks(t, { instanceId: context.documentId, ...(adm?.policy ? { maxBytes: adm.policy.fileMb * 1048576, maxPages: adm.policy.filePages } : {}) }), { userId }); if (r.blocks.length) context.fileBlocks = r.blocks; context.fileCount = r.blocks.length; }
      catch (e) { console.error(`chat file read skipped: ${e?.message ?? e}`); }
    }
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), TURN_MS); c.req.raw.signal?.addEventListener?.("abort", () => ac.abort());
    return streamSSE(c, async (stream) => {
      let emitFailed = false;
      const emit = (ev) => stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }).catch((e) => { if (!emitFailed) { emitFailed = true; console.error(`chat emit failed on ${ev.type}: ${e?.message ?? e}`); } });
      try { await runChatTurn({ db, tx, tenantId, actorUserId: userId, can, conversationId: id, userText: text, cfg, apiKey: scripted ? "demo" : apiKey, context, emit, signal: ac.signal, adm, streamImpl: scripted ? scriptedStream : cfg.provider === "fake" ? fakeStream : undefined }); }
      catch (e) { console.error(`chat turn failed: ${e?.message ?? e}`); await emit({ type: "error", message: "Something went wrong on our side. Try again." }); }
      finally { clearTimeout(timer); }
    });
  });
}
