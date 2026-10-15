// THE CHAT ORCHESTRATOR (design §3–§7): one turn = build the request (context.mjs), call the model (streamed), run its tools, repeat up to 8 times, store what was said exactly as sent, log the action (counts only), compact when the history outgrows its budget.
// `db` is anything with query(sql, params) → {rows}: in the route it opens a short tenant transaction per statement, so nothing is held open while the model thinks.
import { buildRequest, estimateTokens, BUDGETS, MAX_TOOL_ROUNDS, TURN_LIMIT } from "./context.mjs";
import { TOOL_DEFS, runTool, toolByName } from "./tools.mjs";
import { streamAnthropic } from "./stream.mjs";
import { logAiAction } from "../engine/ai/actionLog.mjs";
import { aiUsage, planAiCap } from "../engine/ai/jobs.mjs";
import { modelFor } from "../engine/ai/modelPolicy.mjs";
import { allowanceAllows, finish as ledgerFinish } from "../engine/ai/gateway.mjs";
import { getDocumentSetting } from "../settings.mjs";
import { stepBuild, stepDetail, stepSummary } from "./steps.mjs";
import { proGate, proUpFront, limitCard } from "./pro.mjs";

const isToolResultMsg = (m) => m.role === "user" && Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b?.type === "tool_result");

// ── store ─────────────────────────────────────────────────────────────────────────────
export async function createConversation(db, { tenantId, ownerUserId, screen = null, documentId = null, templateId = null }) {
  const { rows: [r] } = await db.query(`INSERT INTO keystone.document_chat_conversation (tenant_id, owner_user_id, screen, document_id, template_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [tenantId, ownerUserId, screen ? String(screen).slice(0, 200) : null, documentId, templateId]);
  return r.id;
}
/** The conversation, only if it belongs to this person (a person never reads another's conversation, an admin included). */
export async function ownConversation(db, { conversationId, ownerUserId }) {
  const { rows: [c] } = await db.query(`SELECT id, owner_user_id, screen, document_id, template_id, title, created_at, last_at FROM keystone.document_chat_conversation WHERE id = $1`, [conversationId]);
  return c && c.owner_user_id === ownerUserId ? c : null;
}
export async function listConversations(db, { ownerUserId, limit = 30 }) {
  const { rows } = await db.query(`SELECT id, title, screen, last_at FROM keystone.document_chat_conversation WHERE owner_user_id = $1 ORDER BY last_at DESC LIMIT $2`, [ownerUserId, Math.min(Math.max(Number(limit) || 30, 1), 100)]);
  return rows;
}
export async function loadMessages(db, { conversationId }) {
  const { rows } = await db.query(`SELECT seq, role, content FROM keystone.document_chat_message WHERE conversation_id = $1 ORDER BY seq`, [conversationId]);
  return rows;
}
export async function deleteConversation(db, { conversationId, ownerUserId }) {
  const c = await ownConversation(db, { conversationId, ownerUserId }); if (!c) return false;
  await db.query(`DELETE FROM keystone.document_chat_conversation WHERE id = $1`, [conversationId]); return true;
}
/** Group stored messages into turns (a turn starts at a user message that is not a tool result). */
export function toTurns(rows) {
  const turns = [];
  for (const r of rows) { const m = { role: r.role, content: r.content }; if (r.role === "user" && !isToolResultMsg(m)) turns.push({ messages: [m], seq: r.seq }); else if (turns.length) turns.at(-1).messages.push(m); }
  return turns;
}

// ── a turn ────────────────────────────────────────────────────────────────────────────
/**
 * @param {object} a
 * @param {{query:Function}} a.db  @param {string} a.tenantId @param {string|null} a.actorUserId @param {(check:object)=>Promise<boolean>} a.can
 * @param {string} a.conversationId @param {string} a.userText @param {object} a.cfg  readAiConfig()  @param {string} a.apiKey
 * @param {object} [a.context]  {screen, documentId, templateId, clientSource, values, title, facts}
 * @param {(ev:object)=>void} a.emit  @param {AbortSignal} [a.signal] @param {Function} [a.streamImpl] @param {string} [a.model]
 */
export async function runChatTurn({ db, tx = null, tenantId, actorUserId, can, conversationId, userText, cfg, apiKey, context = {}, emit, signal, streamImpl = streamAnthropic, model: modelArg = "", fetchImpl, toolOverrides = null, adm = null }) {
  // ★ D-015: the model is chosen at ONE place (engine/ai/modelPolicy.mjs, through the gateway's admit()); there is no model name in this file. `modelArg` is for tests.
  const model = modelArg || adm?.model || modelFor({ feature: "chat", cfgModel: cfg?.model }).model;
  const rows = await loadMessages(db, { conversationId });
  let nextSeq = rows.length ? rows.at(-1).seq + 1 : 1;
  // ★ Run 8 (the maintainer): PRO IS CHECKED THE MOMENT IT IS ASKED FOR — before the model runs and before any question. A Pro thing the plan does not include is answered at once with the card
  //   (Explore Pro, and what can be done on this plan instead); the model is never called, so nothing is asked first and no credit is used.
  const up = await proUpFront(db, { tenantId, text: userText }).catch((e) => { console.error(`pro up-front check failed (the tool backstop still applies): ${e?.message ?? e}`); return null; });   // Run 8 verify: never silent
  if (up) return answerProUpFront({ db, tx, tenantId, actorUserId, conversationId, userText, nextSeq, up, emit, adm });
  const { rows: [sum] } = await db.query(`SELECT text, covers_through_seq FROM keystone.document_chat_summary WHERE conversation_id = $1 ORDER BY covers_through_seq DESC LIMIT 1`, [conversationId]);
  const covered = sum?.covers_through_seq ?? 0;
  const turns = toTurns(rows.filter((r) => r.seq > covered));
  const toolCtx = { db, tx: tx ?? ((fn) => fn(db)), cfg, screen: context.screen ?? "", conversationId, tenantId, actorUserId, can, documentId: context.documentId ?? null, templateId: context.templateId ?? null, clientSource: context.clientSource ?? null, values: context.values ?? null, title: context.title ?? null, facts: context.facts ?? {}, toolOverrides };
  // this template's own rules: the template the person is on, or the one the open document was made from
  const templateRules = await db.query(`SELECT ai_rules FROM keystone.document_template WHERE id = COALESCE($1::uuid, (SELECT template_id FROM keystone.document_instance WHERE id = $2::uuid))`, [context.templateId ?? null, context.documentId ?? null]).then((r) => r.rows[0]?.ai_rules ?? "").catch(() => "");
  const req = buildRequest({ tools: TOOL_DEFS, agentName: cfg.agentName || "Scribe", workspaceRules: cfg.houseRules || "", templateRules, summary: sum?.text ?? "", turns, document: context.clientSource ? { source: context.clientSource, label: context.title } : null, screen: context.screen ?? "", userText });
  // files the person attached: the model sees their pages for THIS message only (never stored in the history); text inside them is data (see the rules)
  if (Array.isArray(context.fileBlocks) && context.fileBlocks.length) { const last = req.messages.at(-1); if (last?.role === "user" && Array.isArray(last.content)) last.content = [...context.fileBlocks, ...last.content]; }
  const stored = [{ role: "user", content: [{ type: "text", text: userText }] }];   // exactly what the person said; the per-turn context is rebuilt next turn, never stored
  let messages = req.messages; const usageTotal = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }; const perCall = []; let proposals = 0, created = 0, checkRuns = 0, failed = null, rounds = 0, text = "", asked = false;
  for (; rounds < MAX_TOOL_ROUNDS; rounds++) {
    if (signal?.aborted) { failed = { message: "Stopped." }; break; }
    let assistant = null, toolUses = [];
    for await (const ev of streamImpl({ apiKey, model, effort: adm?.effort ?? null, system: req.system, tools: req.tools, messages, maxTokens: Math.min(req.maxTokens ?? 2048, adm?.policy?.outputTokens ?? Infinity), signal, fetchImpl })) {
      if (ev.type === "text") { text += ev.text; emit({ type: "message.delta", text: ev.text }); }
      else if (ev.type === "tool_use") { toolUses.push(ev); emit({ type: "step.queued", id: ev.id, label: toolByName(ev.name)?.step ?? "Working" }); }
      else if (ev.type === "done") { assistant = ev; for (const k of Object.keys(usageTotal)) usageTotal[k] += ev.usage[k] ?? 0; perCall.push(ev.usage); }
      else if (ev.type === "error") { failed = ev; break; }
    }
    if (failed || !assistant) break;
    stored.push({ role: "assistant", content: assistant.content, usage: assistant.usage });
    messages = [...messages, { role: "assistant", content: assistant.content }];
    if (!toolUses.length) break;
    const results = [];
    for (const tu of toolUses) {
      const tool = toolByName(tu.name); const stepId = tu.id;
      const t0 = Date.now(); emit({ type: "step.start", id: stepId, label: tool?.step ?? "Working", tool: tu.name, detail: stepDetail(tu.name, tu.input), ...(stepBuild(tu.name, tu.input) ? { build: stepBuild(tu.name, tu.input) } : {}) });
      let out, gate = null;
      if (tu.badJson) out = { result: { error: "That request was not readable." } };
      else if ((gate = await proGate(db, { tenantId, name: tu.name, input: tu.input }))) out = { result: { error: gate.error, pro: true }, proposal: { kind: "pro", summary: gate.card.title, card: gate.card } };
      else if ((tool?.kind === "proposal" || tool?.kind === "create") && !(await withinLimits(db, tenantId, cfg, adm, tool.kind === "create" ? "draft" : "edit"))) out = { result: { error: "This workspace has reached its AI limit for now, so no more suggestions or drafts can be made today. Plain answers still work." } };
      else if (tool?.kind === "proposal" && cfg.allowEdit === false) out = { result: { error: "Suggesting changes is switched off for this workspace." } };
      else if (tool?.kind === "create" && cfg.allowDraft === false) out = { result: { error: "Making drafts is switched off for this workspace." } };
      else { if (tu.name === "docustay.doc.run_check" || tu.name.startsWith("docustay.plays.")) checkRuns += 1; out = await runTool(tu.name, tu.input, toolCtx); }
      // a plan limit (the month's new templates or documents used): the limit card on screen, and the model told to say it plainly instead of trying another way
      { const lc = !out.proposal && out.result?.code ? limitCard(out.result) : null; if (lc) { out = { ...out, result: { ...out.result, error: `${out.result.error} Tell the person this plainly, offer what they can do instead, and do not try another way around it.` }, proposal: { kind: "pro", summary: lc.title, card: lc } }; } }
      emit({ type: "step.end", id: stepId, ok: !(out.denied || out.failed || out.result?.error), ms: Date.now() - t0, summary: stepSummary(tu.name, out.result) });
      if (out.proposal) {
        const p = out.proposal; const id = await storeProposal(db, { tenantId, conversationId, seq: nextSeq + stored.length, p });
        if (!["confirm", "questions", "pro", "results", "explain"].includes(p.kind)) proposals += 1;   // Run 9: a list found or a clause explained is an answer, not a suggestion
        if (p.kind === "created") created += 1;
        if (out.ask) asked = true;
        emit({ type: "proposal", proposal: { id, kind: p.kind, action: p.action ?? undefined, state: p.state ?? "proposed", summary: p.summary, documentId: p.documentId ?? undefined, serverApply: p.serverApply ?? undefined, card: p.card ?? undefined, patches: p.patches ?? undefined, values: p.values ?? undefined, labels: p.labels ?? undefined, rejected: p.rejected ?? [], previousSource: p.kind === "changes" ? p.previousSource : undefined, newSource: p.kind === "changes" ? p.newSource : undefined } });
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out.result).slice(0, 6000) });
    }
    stored.push({ role: "user", content: results }); messages = [...messages, { role: "user", content: results }];
    if (asked) break;   // the questions are on the person's screen: this turn ends, their answers are the next message
  }
  const capped = rounds >= MAX_TOOL_ROUNDS && !failed && stored.at(-1)?.role === "user";
  if (capped) { const msg = "I took too many steps on that and stopped. What I did so far is kept; ask again more simply if you need more."; text += (text ? "\n\n" : "") + msg; emit({ type: "message.delta", text: (text === msg ? "" : "\n\n") + msg }); stored.push({ role: "assistant", content: [{ type: "text", text: msg }] }); }
  if (failed && !stored.some((m) => m.role === "assistant")) stored.push({ role: "assistant", content: [{ type: "text", text: text || failed.message }] });
  // store exactly as sent (the assistant's usage goes to its own columns, not into content)
  let assistantSeq = null;
  for (const m of stored) {
    if (m.role === "assistant") assistantSeq = nextSeq;
    await db.query(`INSERT INTO keystone.document_chat_message (tenant_id, conversation_id, seq, role, content, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
      [tenantId, conversationId, nextSeq++, m.role, JSON.stringify(m.content), m.usage?.input ?? null, m.usage?.output ?? null, m.usage?.cacheRead ?? null, m.usage?.cacheCreation ?? null, m.role === "assistant" ? model : null]);
  }
  await db.query(`UPDATE keystone.document_chat_conversation SET last_at = now(), title = coalesce(title, $2) WHERE id = $1`, [conversationId, userText.replace(/\s+/g, " ").slice(0, 80)]);
  await logAiAction(db, { tenantId, actorUserId, kind: "chat", action: failed ? "failed" : "proposed", counts: { calls: perCall.length, proposals, rounds: rounds + (stored.at(-1)?.role === "assistant" ? 0 : 0) }, provider: "anthropic", model, inputTokens: usageTotal.input + usageTotal.cacheRead + usageTotal.cacheCreation, outputTokens: usageTotal.output, note: failed ? failed.message : null }).catch((e) => console.error(`ai action log not written: ${e?.message ?? e}`));
  // the ledger: one row for the turn (what it did decides the work and so the credits: a draft made, a change suggested, a check or play run, or a plain answer that costs none), one more for any file the person attached
  if (adm) {
    const w = adm.policy?.weights ?? {};
    const think = adm.feature === "think_harder";
    const kind = think ? "think_harder" : created ? "draft" : proposals ? "edit" : checkRuns ? "check" : "chat";
    const credits = think ? (w.think_harder ?? 0) : (w[kind] ?? 0);
    await ledgerFinish(db, adm, { status: failed ? "error" : "ok", usage: { input: usageTotal.input, output: usageTotal.output, cacheRead: usageTotal.cacheRead, cacheWrite: usageTotal.cacheCreation }, code: failed ? (failed.kind ?? "error") : null, credits: failed ? 0 : credits, feature: kind });
    if (!failed && context.fileCount) await ledgerFinish(db, { ...adm, requestId: `${adm.requestId}:files` }, { status: "ok", usage: {}, credits: (w.file_read ?? 0) * context.fileCount, feature: "file_read" });
  }
  const end = { type: "message.end", assistantSeq, usage: usageTotal, calls: perCall.length, rounds, proposals, report: req.report, ...(failed ? { error: failed.message } : {}) };
  await emit(end);   // awaited: the route closes the stream when this function returns, and an unflushed final event is lost
  // compaction: when whole turns no longer fit, summarise the older ones (the full log stays)
  if (!failed && req.report.needsCompaction) await compactConversation({ db, tenantId, conversationId, apiKey, cfg, streamImpl, fetchImpl, summaryModel: cfg.summaryModel, adm }).catch((e) => console.error(`chat compaction: ${e?.message ?? e}`));
  return end;
}

/** The up-front Pro answer: the person's words and the plain sentence are stored like any turn, the card is a proposal of kind "pro", and the ledger records a turn that cost nothing.
 *  Run 8 verify: no model runs here, so the whole answer — both messages, the card, the conversation line and the AI action log — is written in ONE transaction (`tx`, the route's real
 *  transaction handle): all of it or none of it, and a log line that cannot be written fails the answer instead of vanishing. Only the credit ledger's close stays its own (it costs nothing). */
async function answerProUpFront({ db, tx = null, tenantId, actorUserId, conversationId, userText, nextSeq, up, emit, adm }) {
  emit({ type: "message.delta", text: up.text });
  const userSeq = nextSeq++, assistantSeq = nextSeq++;
  const id = await (tx ?? ((fn) => fn(db)))(async (t) => {
    await t.query(`INSERT INTO keystone.document_chat_message (tenant_id, conversation_id, seq, role, content) VALUES ($1,$2,$3,'user',$4::jsonb)`, [tenantId, conversationId, userSeq, JSON.stringify([{ type: "text", text: userText }])]);
    await t.query(`INSERT INTO keystone.document_chat_message (tenant_id, conversation_id, seq, role, content) VALUES ($1,$2,$3,'assistant',$4::jsonb)`, [tenantId, conversationId, assistantSeq, JSON.stringify([{ type: "text", text: up.text }])]);
    const pid = await storeProposal(t, { tenantId, conversationId, seq: assistantSeq, p: { kind: "pro", summary: up.card.title, card: up.card } });
    await t.query(`UPDATE keystone.document_chat_conversation SET last_at = now(), title = coalesce(title, $2) WHERE id = $1`, [conversationId, userText.replace(/\s+/g, " ").slice(0, 80)]);
    await logAiAction(t, { tenantId, actorUserId, kind: "chat", action: "proposed", counts: { calls: 0, proposals: 0, rounds: 0 }, provider: null, model: null, inputTokens: 0, outputTokens: 0, note: `pro up front: ${up.item}` });
    return pid;
  });
  emit({ type: "proposal", proposal: { id, kind: "pro", state: "proposed", summary: up.card.title, card: up.card } });
  if (adm) await ledgerFinish(db, adm, { status: "ok", usage: {}, code: "pro_up_front", credits: 0, feature: "chat" }).catch((e) => console.error(`ai ledger not closed: ${e?.message ?? e}`));
  const end = { type: "message.end", assistantSeq, usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, calls: 0, rounds: 0, proposals: 0, pro: up.item };
  await emit(end);
  return end;
}

async function withinLimits(db, tenantId, cfg, adm = null, feature = "edit") {
  if (adm?.policy && !(await allowanceAllows(db, adm, feature))) return false;   // the credit allowance and the dollar cap (engine/ai/gateway.mjs)
  const cap = adm?.policy ? null : await planAiCap(db, { tenantId });
  if (!cfg.perDay && !cfg.perMonth && cap == null) return true;
  const u = await aiUsage(db, { tenantId });
  return !(cfg.perDay && u.today >= cfg.perDay) && !(cfg.perMonth && u.month >= cfg.perMonth) && !(cap != null && u.month >= cap);
}
async function storeProposal(db, { tenantId, conversationId, seq, p }) {
  const payload = p.payload || p.card ? { ...(p.payload ?? {}), ...(p.card ? { card: p.card } : {}) } : null;
  const { rows: [r] } = await db.query(`INSERT INTO keystone.document_chat_proposal (tenant_id, conversation_id, message_seq, kind, action, summary, patches, vals, previous_source, state, payload, document_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11::jsonb,$12) RETURNING id`,
    [tenantId, conversationId, seq, p.kind, p.action ?? null, p.summary || null, p.patches ? JSON.stringify(p.patches) : null, p.values ? JSON.stringify(p.values) : null, p.kind === "changes" ? JSON.stringify(p.previousSource) : null, p.state ?? "proposed", payload ? JSON.stringify(payload) : null, p.documentId ?? null]);
  return r.id;
}

/** What the person did with a proposal. accept/reject/undo; only the owner of the conversation; the transition must make sense. A confirmation card is decided by the confirm route, never here.
 *  Returns the row too, so the route can apply what was accepted (people, details, a change to a saved draft). */
export async function decideProposal(db, { tenantId, actorUserId, proposalId, decision }) {
  const { rows: [pr] } = await db.query(`SELECT p.id, p.state, p.kind, p.action, p.conversation_id, p.previous_source, p.patches, p.vals, p.payload, p.document_id, p.result, c.owner_user_id FROM keystone.document_chat_proposal p JOIN keystone.document_chat_conversation c ON c.tenant_id = p.tenant_id AND c.id = p.conversation_id WHERE p.id = $1`, [proposalId]);
  if (!pr || pr.owner_user_id !== actorUserId) return { ok: false, notFound: true };
  if (["confirm", "created", "template", "results", "explain"].includes(pr.kind)) return { ok: false, state: pr.state, message: "That is not something to accept or reject." };
  const ok = (decision === "accept" && pr.state === "proposed") || (decision === "reject" && pr.state === "proposed") || (decision === "undo" && pr.state === "accepted");
  if (!ok) return { ok: false, state: pr.state, message: `That suggestion is already ${pr.state}.` };
  const next = decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "undone";
  await db.query(`UPDATE keystone.document_chat_proposal SET state = $2, decided_by = $3, decided_at = now() WHERE id = $1 AND state = $4`, [proposalId, next, actorUserId, pr.state]);
  const n = pr.kind === "changes" ? (Array.isArray(pr.patches) ? pr.patches.length : 0) : pr.kind === "values" ? Object.keys(pr.vals ?? {}).length : 1;
  await logAiAction(db, { tenantId, actorUserId, kind: "chat", action: decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "undone", counts: { changes: n } }).catch((e) => console.error(`ai action log not written: ${e?.message ?? e}`));
  return { ok: true, state: next, kind: pr.kind, row: pr, previousSource: decision === "undo" && pr.kind === "changes" ? pr.previous_source : undefined };
}

/** Keep what an apply returned (the previous state, for Undo) and, when a revise changed the draft's id, point the conversation's other open cards at the new id. */
export async function recordApplied(db, { tenantId, proposalId, conversationId, applied }) {
  await db.query(`UPDATE keystone.document_chat_proposal SET result = $2::jsonb, document_id = $3 WHERE id = $1`, [proposalId, JSON.stringify({ previous: applied.previous ?? null }), applied.documentId ?? null]);
  if (applied.previousId && applied.documentId && applied.previousId !== applied.documentId) {
    await db.query(`UPDATE keystone.document_chat_proposal SET document_id = $3, payload = CASE WHEN payload ? 'documentId' THEN jsonb_set(payload, '{documentId}', to_jsonb($3::text)) ELSE payload END WHERE tenant_id = $1 AND conversation_id = $4 AND document_id = $2 AND state IN ('proposed','accepted')`, [tenantId, applied.previousId, applied.documentId, conversationId]);
  }
}
/** The person pressed a card's button: claim it (once), and settle it as confirmed or back to proposed with the reason. */
export async function claimCard(db, { proposalId, actorUserId }) {
  const { rows: [pr] } = await db.query(`SELECT p.id, p.state, p.kind, p.action, p.conversation_id, p.payload, p.document_id, c.owner_user_id FROM keystone.document_chat_proposal p JOIN keystone.document_chat_conversation c ON c.tenant_id = p.tenant_id AND c.id = p.conversation_id WHERE p.id = $1`, [proposalId]);
  if (!pr || pr.owner_user_id !== actorUserId) return { notFound: true };
  if (pr.kind !== "confirm") return { notACard: true };
  const { rowCount } = await db.query(`UPDATE keystone.document_chat_proposal SET state = 'confirmed', decided_by = $2, decided_at = now() WHERE id = $1 AND state = 'proposed'`, [proposalId, actorUserId]);
  if (!rowCount) return { state: pr.state, alreadyDone: true };
  return { row: pr };
}
export async function settleCard(db, { tenantId, actorUserId, proposalId, action, ok, result }) {
  await db.query(`UPDATE keystone.document_chat_proposal SET state = $2, result = $3::jsonb WHERE id = $1`, [proposalId, ok ? "confirmed" : "proposed", JSON.stringify(result ?? {})]);
  if (ok) await logAiAction(db, { tenantId, actorUserId, kind: "chat", action: "confirmed", counts: {}, note: action }).catch((e) => console.error(`ai action log not written: ${e?.message ?? e}`));
}

// ── compaction (own summariser on a small model) ──────────────────────────────────────
async function compactConversation({ db, tenantId, conversationId, apiKey, cfg, streamImpl = streamAnthropic, fetchImpl, summaryModel, adm = null }) {
  const sm = summaryModel || modelFor({ feature: "summary" }).model; let usage = null;
  const rows = await loadMessages(db, { conversationId });
  const { rows: [sum] } = await db.query(`SELECT text, covers_through_seq FROM keystone.document_chat_summary WHERE conversation_id = $1 ORDER BY covers_through_seq DESC LIMIT 1`, [conversationId]);
  const covered = sum?.covers_through_seq ?? 0; const turns = toTurns(rows.filter((r) => r.seq > covered));
  if (turns.length <= TURN_LIMIT) return null;
  const old = turns.slice(0, turns.length - TURN_LIMIT); const through = turns[turns.length - TURN_LIMIT].seq - 1;
  const transcript = old.flatMap((t) => t.messages).map((m) => `${m.role === "user" ? "Person" : "Assistant"}: ${(Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : String(m.content)).slice(0, 1500)}`).filter((l) => l.length > 12).join("\n").slice(0, 24000);
  const system = [{ type: "text", text: "You summarise a support conversation inside a document-signing product, for the assistant to remember. In at most 700 words: what the person is trying to do, decisions made, what was proposed and whether it was accepted or rejected, and any names, ids or settings that matter. No pleasantries. Do not include more personal detail than needed." }];
  let out = "";
  for await (const ev of streamImpl({ apiKey, model: sm, system, tools: [], messages: [{ role: "user", content: [{ type: "text", text: `${sum?.text ? `Earlier summary:\n${sum.text}\n\n` : ""}New part of the conversation:\n${transcript}` }] }], maxTokens: 1200, fetchImpl })) { if (ev.type === "text") out += ev.text; if (ev.type === "done") usage = ev.usage; if (ev.type === "error") throw new Error(ev.message); }
  if (adm && usage) await ledgerFinish(db, { ...adm, feature: "summary", model: sm, effort: null, requestId: `${adm.requestId}:summary` }, { status: "ok", usage: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheCreation }, credits: 0 });
  out = out.trim().slice(0, Math.floor(BUDGETS.summary * 3.5)); if (!out) return null;
  await db.query(`INSERT INTO keystone.document_chat_summary (tenant_id, conversation_id, covers_through_seq, text, tokens, model) VALUES ($1,$2,$3,$4,$5,$6)`, [tenantId, conversationId, through, out, estimateTokens(out), sm]);
  return { through, tokens: estimateTokens(out) };
}

/** The worker sweep: delete conversations older than the retention setting (0 = keep nothing after the turn: delete anything older than a minute). */
async function pruneChats(db, { tenantId, days }) {
  const cutoff = days <= 0 ? "now() - interval '1 minute'" : `now() - ($1 || ' days')::interval`;
  const r = await db.query(`DELETE FROM keystone.document_chat_conversation WHERE tenant_id = ${days <= 0 ? "$1" : "$2"} AND last_at < ${cutoff}`, days <= 0 ? [tenantId] : [String(days), tenantId]);
  return r.rowCount ?? 0;
}

/** The hourly sweep's one call: read this workspace's retention and delete what is older. Returns how many conversations went. */
export async function pruneChatsForTenant(tx, { tenantId }) {
  const days = await getDocumentSetting(tx, "ai.chat_retention_days");
  return pruneChats(tx, { tenantId, days: Number.isInteger(days) ? days : 30 });
}
