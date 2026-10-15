// The assistant's state: one instance for the whole signed-in app (design: specs/AI-CHAT-SPEC-6OCT.md §1–§2). Svelte 5 runes, no dependency.
import { api } from "$lib/api.js";
import { uploadFile } from "$lib/docs.js";
import { postStream } from "./stream.js";
import { chatBridge } from "./bridge.js";

const BASE = "/api/documents/chat";
export const DOC_CHANGED = "ds:doc-changed";
const tell = (detail) => { try { window.dispatchEvent(new CustomEvent(DOC_CHANGED, { detail })); } catch { /* no window: nothing to tell */ } };
const keep = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* storage may be blocked */ } };
const kept = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };

class Chat {
  open = $state(false);
  collapsed = $state(false);
  status = $state(null);           // { enabled, allowed, agentName, reason }
  conversationId = $state(null);
  messages = $state([]);           // { id, role, text, steps: [{id,label,detail,state,summary,ms}], proposals: [proposal], error?, streaming, seq?, rating }
  busy = $state(false);
  thinkHarder = $state(false);     // the per-run "Think harder" switch (Pro): it applies to the next message only
  unread = $state(false);
  error = $state("");
  conversations = $state(null);    // the history list, loaded on demand
  attached = $state(null);         // { documentId, name } a file the person attached to start a document
  history = [];                    // what the person typed, for the ↑ key
  #abort = null; #seq = 0;
  undoToast = $state(null);        // { proposalId, label } for 10 s after an accept

  async loadStatus() { const r = await api(`${BASE}/status`); if (r.ok) this.status = r.json?.data ?? r.json; return this.status; }
  toggle() { this.open ? this.close() : this.show(); }
  async show() { this.open = true; this.collapsed = false; this.unread = false; if (!this.status) await this.loadStatus(); if (!this.conversationId && !this.messages.length) { const id = kept("ds-chat-conv"); if (id) await this.resume(id, { quiet: true }); } }
  close() { this.open = false; }
  newConversation() { this.abort(); this.conversationId = null; this.messages = []; this.error = ""; this.undoToast = null; this.attached = null; keep("ds-chat-conv", null); }
  abort() { this.#abort?.abort(); }
  recall(i) { return this.history.at(-1 - i) ?? ""; }

  async listConversations() { const r = await api(`${BASE}/conversations`); this.conversations = r.ok ? (r.json?.data ?? r.json).conversations ?? [] : []; return this.conversations; }
  /** open an earlier conversation: its words, the steps it took and its cards */
  async resume(id, { quiet = false } = {}) {
    const r = await api(`${BASE}/conversations/${id}`);
    if (!r.ok) { if (!quiet) this.error = r.error ?? ""; keep("ds-chat-conv", null); return false; }
    const d = r.json?.data ?? r.json; this.abort(); this.conversationId = id; keep("ds-chat-conv", id); this.error = ""; this.undoToast = null;
    this.messages = (d.messages ?? []).map((m, i) => ({ id: `h${i}`, role: m.role, text: m.text, steps: (m.steps ?? []).map((s, j) => ({ id: `h${i}s${j}`, label: s.label, detail: "", state: s.ok === false ? "failed" : "done", summary: "", ms: null })), proposals: (d.proposals ?? []).filter((p) => m.role === "assistant" && p.seq >= m.seqFrom && p.seq <= m.seqTo).map((p) => ({ ...p, labels: undefined })), streaming: false, seq: m.seqTo, rating: m.rating ?? 0 }));
    return true;
  }
  async remove(id) { const r = await api(`${BASE}/conversations/${id}`, { method: "DELETE", body: {} }); if (r.ok) { this.conversations = (this.conversations ?? []).filter((c) => c.id !== id); if (this.conversationId === id) this.newConversation(); } }

  async #ensureConversation(screen) {
    if (this.conversationId) return true;
    const ctx = chatBridge.context();
    const r = await api(`${BASE}/conversations`, { method: "POST", body: { screen, documentId: this.attached?.documentId ?? ctx.documentId ?? null, templateId: ctx.templateId ?? null } });
    if (!r.ok) { this.error = r.error ?? ""; return false; }
    this.conversationId = (r.json?.data ?? r.json).conversationId; keep("ds-chat-conv", this.conversationId); return true;
  }
  /** the wording that goes with the stream's events: pending → running → done | failed */
  #onEvent(upd) {
    return (ev) => {
      if (ev.type === "message.delta") upd((m) => { m.text += ev.text; });
      else if (ev.type === "step.queued") upd((m) => { if (!m.steps.some((s) => s.id === ev.id)) m.steps.push({ id: ev.id, label: ev.label, detail: "", state: "pending", summary: "", ms: null }); });
      else if (ev.type === "step.start") upd((m) => { const s = m.steps.find((x) => x.id === ev.id); if (s) { s.state = "running"; s.detail = ev.detail ?? ""; s.build = ev.build ?? null; s.t0 = Date.now(); } else m.steps.push({ id: ev.id, label: ev.label, detail: ev.detail ?? "", state: "running", summary: "", ms: null, build: ev.build ?? null, t0: Date.now() }); });
      else if (ev.type === "step.end") upd((m) => { const s = m.steps.find((x) => x.id === ev.id); if (s) { s.state = ev.ok ? "done" : "failed"; s.summary = ev.summary ?? ""; s.ms = ev.ms ?? null; } });
      else if (ev.type === "proposal") upd((m) => { m.proposals.push({ ...ev.proposal, state: ev.proposal.state ?? "proposed" }); if (ev.proposal.documentId) tell({ documentId: ev.proposal.documentId, created: ev.proposal.kind === "created" }); });
      else if (ev.type === "message.end") upd((m) => { m.streaming = false; m.seq = ev.assistantSeq ?? m.seq; if (ev.error && !m.text) m.error = ev.error; });
      else if (ev.type === "error") upd((m) => { m.error = ev.message; });
    };
  }
  async send(text, screen, { regenerate = false, answer = false } = {}) {
    text = String(text ?? "").trim(); if (!regenerate && !text || this.busy) return;
    this.error = "";
    if (!regenerate) this.history.push(text);
    if (!(await this.#ensureConversation(screen))) return;
    const id = ++this.#seq, mine = { id: `u${id}`, role: "user", text, steps: [], proposals: [], answer }, reply = { id: `a${id}`, role: "assistant", text: "", steps: [], proposals: [], streaming: true, rating: 0 };
    if (regenerate) { let k = this.messages.length - 1; while (k >= 0 && this.messages[k].role !== "user") k -= 1; this.messages = [...this.messages.slice(0, k + 1), reply]; }
    else this.messages = [...this.messages, mine, reply];
    const idx = this.messages.length - 1;
    this.busy = true; this.#abort = new AbortController();
    const upd = (fn) => { const m = this.messages[idx]; if (m) fn(m); };
    const ctx = { screen, ...chatBridge.context(), ...(this.attached ? { documentId: this.attached.documentId, ...(this.attached.read ? {} : { readFile: true }) } : {}) };
    if (this.attached) this.attached = { ...this.attached, read: true };   // its pages go to the model once, with the message that follows the attach
    const res = await postStream(`${BASE}/conversations/${this.conversationId}/messages`, { text: regenerate ? undefined : text, regenerate: regenerate || undefined, context: ctx, ...(this.thinkHarder ? { thinkHarder: true } : {}) }, { signal: this.#abort.signal, onEvent: this.#onEvent(upd) });
    upd((m) => { m.streaming = false; for (const s of m.steps) if (s.state === "pending" || s.state === "running") s.state = res.aborted ? "failed" : s.state === "running" ? "failed" : "failed"; if (res.error && !m.text && !m.error) m.error = res.status === 409 || res.status === 403 ? (res.error ?? "") : "I could not reach the assistant. Try again."; if (res.aborted && !m.text) m.error = "Stopped."; });
    this.busy = false; this.#abort = null; this.thinkHarder = false;
    if (!this.open) this.unread = true;   // finished while the panel was closed
  }
  regenerate(screen) { return this.send("", screen, { regenerate: true }); }

  async rate(message, rating) {
    if (!this.conversationId || message.seq == null) return;
    const next = message.rating === rating ? 0 : rating; message.rating = next;
    if (next) await api(`${BASE}/ratings`, { method: "POST", body: { conversationId: this.conversationId, seq: message.seq, rating: next } });
  }

  async attach(file) {
    this.error = "";
    try { const r = await uploadFile(file, { title: file.name.replace(/\.[^.]+$/, "") }); const id = r.instanceId ?? r.id; this.attached = { documentId: id, name: file.name }; tell({ documentId: id, created: true }); return id; }
    catch (e) { this.error = String(e?.message ?? "That file could not be attached."); return null; }
  }

  async decide(proposal, decision, extra = {}) {
    const r = await api(`${BASE}/proposals/${proposal.id}/${decision}`, { method: "POST", body: extra });
    if (!r.ok) { this.error = r.error ?? ""; return false; }
    const d = r.json?.data ?? r.json;
    proposal.state = d.state;
    if (d.appliedOnServer) { if (d.documentId) proposal.documentId = d.documentId; tell({ documentId: d.documentId, previousId: d.previousId ?? null }); }
    return d;
  }
  /** Accept: a change to the open editor is applied THERE first (so nothing is recorded as accepted that was not applied); people, details and a draft that is not open are applied by the server. */
  async accept(proposal) {
    const b = chatBridge.get(); const ctxDoc = chatBridge.context().documentId ?? null;
    if (proposal.kind === "changes") {
      const editorHasIt = Boolean(b?.apply) && (!proposal.documentId || !ctxDoc || proposal.documentId === ctxDoc);
      if (editorHasIt) b.apply(proposal.newSource);
      else if (!proposal.documentId) { this.error = "Open the document's editor to apply this."; return false; }
      const d = await this.decide(proposal, "accept", { editorOpen: editorHasIt }); if (!d) { if (editorHasIt && proposal.previousSource) b.apply(proposal.previousSource); return false; }
    } else if (proposal.kind === "values") {
      if (!b?.applyValues) { this.error = "Open the template's questions to apply these."; return false; }
      const now = b.getValues?.() ?? {}; proposal.prevValues = Object.fromEntries(Object.keys(proposal.values).map((k) => [k, now[k] ?? ""])); b.applyValues(proposal.values);
      if (!(await this.decide(proposal, "accept"))) { b.applyValues(proposal.prevValues); return false; }
    } else if (!(await this.decide(proposal, "accept"))) return false;
    this.undoToast = { proposalId: proposal.id, kind: proposal.kind }; const mark = proposal.id; setTimeout(() => { if (this.undoToast?.proposalId === mark) this.undoToast = null; }, 10_000);
    return true;
  }
  async acceptAll(message) { for (const p of message.proposals.filter((x) => x.state === "proposed" && x.kind !== "confirm" && x.kind !== "questions" && x.kind !== "pro")) if (!(await this.accept(p))) break; }
  async undo(proposal) {
    const b = chatBridge.get();
    if (proposal.kind === "changes" && b?.apply && !proposal.serverApplied && proposal.previousSource && (chatBridge.context().documentId ?? null) === (proposal.documentId ?? null)) { b.apply(proposal.previousSource); await this.decide(proposal, "undo", { editorOpen: true }); }
    else if (proposal.kind === "values") { b?.applyValues?.(proposal.prevValues ?? Object.fromEntries(Object.keys(proposal.values).map((k) => [k, ""]))); await this.decide(proposal, "undo"); }
    else await this.decide(proposal, "undo", { editorOpen: false });
    this.undoToast = null;
  }
  async reject(proposal) { await this.decide(proposal, "reject"); }

  /** A confirmation card's button. Only this sends, voids, reminds, copies or bulk-sends. */
  async confirm(proposal, body = {}) {
    if (proposal.pressing) return false; proposal.pressing = true; proposal.problem = "";
    const r = await api(`${BASE}/proposals/${proposal.id}/confirm`, { method: "POST", body });
    proposal.pressing = false;
    if (!r.ok) { proposal.problem = r.error ?? "That did not work."; if (r.status === 409 && /already been used/.test(proposal.problem)) proposal.state = "confirmed"; return false; }
    const d = r.json?.data ?? r.json; proposal.state = "confirmed"; proposal.result = { summary: d.summary, link: d.link ?? null, documentId: d.documentId ?? null, detail: d.detail ?? null };
    tell({ documentId: proposal.documentId ?? d.documentId ?? null, sent: proposal.action === "send" || proposal.action === "void", action: proposal.action });
    return d;
  }
}
export const chat = new Chat();
