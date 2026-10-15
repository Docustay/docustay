// READ tools: they look, they never change anything. Each returns plain facts the assistant can say in a sentence.
import { OBJ, STR, ID, VIEW, VIEW_ALL, docIdOf, done, refuse, numberBlocks, markSenderOnly } from "./toolkit.mjs";
import { apiGetDocument } from "../pdfApi.mjs";
import { auditTrailFor } from "../auditTrail.mjs";
import { listPdfTemplates } from "../pdfTemplates.mjs";
import { aiUsage } from "../engine/ai/jobs.mjs";
import { SETUP_TOPICS, setupHelp } from "./help.mjs";
import { sendCheckFor } from "../sendCheck.mjs";
import { readFileBytes } from "../files.mjs";
import { pdfTextRuns } from "../pdfProcess.mjs";

// Run 9 — ASK YOUR DOCUMENTS (Free): "which NDAs from September aren't signed", "what is waiting on Dana", "which contracts end before March". One query over the person's own documents (RLS decides which),
// with the key dates of signed ones; the card lists exactly what was found, so the answer on screen never depends on the model's wording.
const FIND_STATES = Object.freeze({ waiting: ["sent", "partially_signed"], not_signed: ["draft", "sent", "partially_signed", "declined", "expired"], signed: ["executed"], draft: ["draft"], declined: ["declined"], void: ["void"], expired: ["expired"] });
const DATE_COL = Object.freeze({ made: "i.created_at", sent: "i.sent_at", signed: "i.executed_at" });
const isoDay = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const likeWords = (q) => String(q ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1).slice(0, 4).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w).replace(/[\\%_]/g, "\\$&"));
const PLAIN_WORDS_NOTE = "This is a plain-words summary, not legal advice.";

/** A clause of a document, found by its heading or by words in it → { heading, text, page? } or null. Written documents read their blocks; an uploaded file reads its pages' words. */
async function findClause(ctx, id, clause) {
  const want = String(clause ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 160); if (want.length < 3) return null;
  const { rows: [r] } = await ctx.db.query(`SELECT title, source, template_body_snapshot->'file'->>'file_id' AS file_id FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [id]);
  if (!r) return null;
  if (r.source?.content) {
    const blocks = markSenderOnly(r.source, numberBlocks(r.source)).filter((b) => !b.senderOnly);
    const at = blocks.findIndex((b) => b.type === "heading" && b.text.toLowerCase().includes(want)) ;
    const i = at >= 0 ? at : blocks.findIndex((b) => b.text.toLowerCase().replace(/\s+/g, " ").includes(want));
    if (i < 0) return null;
    const heading = blocks[i].type === "heading" ? blocks[i].text : ([...blocks.slice(0, i)].reverse().find((b) => b.type === "heading")?.text ?? clause);
    const body = []; for (let k = blocks[i].type === "heading" ? i + 1 : i; k < blocks.length && blocks[k].type !== "heading" && body.join(" ").length < 1500; k += 1) body.push(blocks[k].text);
    return { heading: heading.slice(0, 160), text: body.join("\n").slice(0, 1500) };
  }
  if (!r.file_id) return null;
  let pages = []; try { pages = await pdfTextRuns((await readFileBytes(ctx.db, { fileId: r.file_id })).bytes, { maxPages: 30 }); } catch { return null; }
  for (const pg of pages) {
    const runs = pg.runs.map((x) => x.str);
    const i = runs.findIndex((x) => x.toLowerCase().replace(/\s+/g, " ").includes(want));
    // the heading is the sentence that names the clause, not the whole line
    if (i >= 0) return { heading: (runs[i].trim().split(/(?<=[.:;])\s+/).find((x) => x.toLowerCase().includes(want)) ?? runs[i].trim()).replace(/[.:;]$/, "").slice(0, 160), text: runs.slice(i, i + 12).join(" ").replace(/\s+/g, " ").slice(0, 1500), page: pg.page };
  }
  return null;
}

const STATES = ["draft", "sent", "partially_signed", "executed", "declined", "void", "expired"];
const clamp = (n, lo, hi, d) => { const v = Number.isInteger(n) ? n : d; return Math.min(Math.max(v, lo), hi); };
const iso = (d) => (d ? new Date(d).toISOString() : null);

export const READ_TOOLS = [
  { name: "docustay.docs.list", kind: "read", permission: VIEW_ALL, step: "Looking through your documents",
    description: `List the person's documents, newest first (at most 20): id, title, state (${STATES.join(", ")}), when it was made, sent and finished, and who it is still waiting on. Filters: state; query (words in the title); waitingOn (part of a person's name: only documents still waiting on someone with that name); sinceDays (made in the last N days). Use it for "what is waiting on Dana?", "what did I send last week?", "who has not signed?".`,
    input_schema: OBJ({ state: { type: "string", enum: STATES }, query: STR("words in the title"), waitingOn: STR("part of a person's name"), sinceDays: { type: "integer", minimum: 1, maximum: 365 }, limit: { type: "integer", minimum: 1, maximum: 20 } }),
    run: async (ctx, input) => {
      const state = STATES.includes(input?.state) ? input.state : null, q = String(input?.query ?? "").trim().slice(0, 80) || null, who = String(input?.waitingOn ?? "").trim().slice(0, 80) || null;
      const since = Number.isInteger(input?.sinceDays) ? new Date(Date.now() - clamp(input.sinceDays, 1, 365, 7) * 86400000).toISOString() : null; const limit = clamp(input?.limit, 1, 20, 10);
      const esc = (s) => (s ? s.replace(/[\\%_]/g, "\\$&") : s);
      const { rows } = await ctx.db.query(
        `SELECT i.id, i.title, i.state, i.is_test, i.created_at, i.sent_at, i.executed_at,
                (SELECT string_agg(p.name, ', ' ORDER BY p.position, p.created_at) FROM keystone.document_party p WHERE p.instance_id = coalesce(i.package_lead_id, i.id) AND p.status IN ('pending','viewed') AND p.action_role IN ('signer','approver') AND i.state IN ('sent','partially_signed')) AS waiting_on
           FROM keystone.document_instance i
          WHERE i.builder = 'pdf' AND i.archived_at IS NULL AND (i.package_lead_id IS NULL OR i.package_lead_id = i.id)
            AND ($1::text IS NULL OR i.state = $1) AND ($2::text IS NULL OR i.title ILIKE '%' || $2 || '%') AND ($3::timestamptz IS NULL OR i.created_at >= $3)
            AND ($4::text IS NULL OR (i.state IN ('sent','partially_signed') AND EXISTS (SELECT 1 FROM keystone.document_party p WHERE p.instance_id = coalesce(i.package_lead_id, i.id) AND p.name ILIKE '%' || $4 || '%' AND p.status IN ('pending','viewed') AND p.action_role IN ('signer','approver'))))
          ORDER BY i.created_at DESC, i.id LIMIT $5`, [state, esc(q), since, esc(who), limit]);
      return done({ count: rows.length, documents: rows.map((r) => ({ id: r.id, title: r.title, state: r.state, test: r.is_test === true, madeAt: iso(r.created_at), sentAt: iso(r.sent_at), finishedAt: iso(r.executed_at), waitingOn: r.waiting_on ?? null, link: `/documents/${r.id}` })) });
    } },
  { name: "docustay.docs.status", kind: "read", permission: VIEW, step: "Checking where it stands",
    description: "Where one document stands: its state, each person's status (waiting, viewed, signed, declined), progress, and the last events. Never returns a signing link.",
    input_schema: OBJ({ documentId: ID() }),
    run: async (ctx, input) => {
      const id = docIdOf(ctx, input); if (!id) return refuse("Which document? Give its id, or open it first.");
      let d; try { d = await apiGetDocument(ctx.db, { tenantId: ctx.tenantId, instanceId: id }); } catch { return refuse("That document was not found."); }
      return done({ id, title: d.title, state: d.state, test: d.test, progress: d.progress, sentAt: d.sentAt, executedAt: d.executedAt, voidReason: d.voidReason, people: d.parties.map((p) => ({ name: p.name, email: p.email, does: p.role, status: p.status, viewedAt: p.viewedAt, completedAt: p.completedAt, declineReason: p.declineReason })), recent: d.events.slice(-12), link: `/documents/${id}` });
    } },
  { name: "docustay.docs.read", kind: "read", permission: VIEW, step: "Reading the document",
    description: "Read the words of a written document of the person's, whatever its state (draft, sent, signed): numbered blocks as text. An uploaded file has no readable words here; only its title and people are known. Use it to summarise a signed document. Blocks marked senderOnly are for the sender; do not repeat them to someone who says they are a signer.",
    input_schema: OBJ({ documentId: ID() }),
    run: async (ctx, input) => {
      const id = docIdOf(ctx, input); if (!id) return refuse("Which document? Give its id, or open it first.");
      const { rows: [r] } = await ctx.db.query(`SELECT title, state, source FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [id]);
      if (!r) return refuse("That document was not found.");
      if (!r.source?.content) return done({ id, title: r.title, state: r.state, readable: false, note: "This document was made from an uploaded file, so its words are not available to read here. Only its title, state and people are known." });
      const blocks = markSenderOnly(r.source, numberBlocks(r.source)).slice(0, 400);
      return done({ id, title: r.title, state: r.state, readable: true, blocks });
    } },
  { name: "docustay.docs.audit", kind: "read", permission: VIEW, step: "Reading the audit trail",
    description: "The audit trail of one document (who did what and when) and how to read the certificate of completion. Never includes signing links or addresses of devices.",
    input_schema: OBJ({ documentId: ID() }),
    run: async (ctx, input) => {
      const id = docIdOf(ctx, input); if (!id) return refuse("Which document? Give its id, or open it first.");
      let ev; try { ev = await auditTrailFor(ctx.db, { tenantId: ctx.tenantId, instanceId: id }); } catch { return refuse("That document was not found."); }
      const rows = Array.isArray(ev) ? ev : (ev?.events ?? []);
      return done({ id, events: rows.slice(-60).map((e) => ({ at: iso(e.occurred_at ?? e.at), what: e.kind, by: e.actor_role ?? e.who ?? null })), certificate: "When everyone has signed, Docustay seals the document and adds a certificate page: who signed, their email, the time and zone, the document's fingerprint (SHA-256) and the audit trail. The seal is a digital signature, so any change after signing breaks it and PDF readers show that." });
    } },
  { name: "docustay.docs.find", kind: "read", permission: VIEW_ALL, step: "Looking through your documents",
    description: "Find the person's documents to answer a question (\"which NDAs from September aren't signed\", \"which contracts end before March\"): title or template words, state (waiting = out for signature), a person, dates made/sent/signed, an end or notice date before a day. Up to 25, with key dates; the person sees the list as a card.",
    input_schema: OBJ({ words: STR("title words"), state: { type: "string", enum: Object.keys(FIND_STATES) }, person: STR("name or email"), from: STR("YYYY-MM-DD"), to: STR("YYYY-MM-DD"), dateOf: { type: "string", enum: Object.keys(DATE_COL) }, endsBefore: STR("YYYY-MM-DD"), noticeBefore: STR("YYYY-MM-DD"), question: STR("the question, briefly") }),
    run: async (ctx, input) => {
      const words = likeWords(input?.words), states = FIND_STATES[input?.state] ?? null, who = String(input?.person ?? "").trim().slice(0, 80).replace(/[\\%_]/g, "\\$&") || null;
      const col = DATE_COL[input?.dateOf] ?? "i.created_at", from = isoDay(input?.from), to = isoDay(input?.to), ends = isoDay(input?.endsBefore), notice = isoDay(input?.noticeBefore);
      if (input?.from && !from || input?.to && !to || input?.endsBefore && !ends || input?.noticeBefore && !notice) return refuse("Give dates as YYYY-MM-DD.");
      const { rows } = await ctx.db.query(
        `SELECT i.id, i.title, i.state, i.created_at, i.sent_at, i.executed_at, count(*) OVER () AS total,
                (SELECT string_agg(p.name, ', ' ORDER BY p.position, p.created_at) FROM keystone.document_party p WHERE p.instance_id = i.id AND p.status IN ('pending','viewed') AND p.action_role IN ('signer','approver') AND i.state IN ('sent','partially_signed')) AS waiting_on,
                (SELECT k.date_value FROM keystone.document_key_date k WHERE k.instance_id = i.id AND k.kind = 'end') AS ends_on,
                (SELECT k.date_value FROM keystone.document_key_date k WHERE k.instance_id = i.id AND k.kind = 'notice') AS notice_on
           FROM keystone.document_instance i LEFT JOIN keystone.document_template t ON t.id = i.template_id
          WHERE i.builder = 'pdf' AND i.archived_at IS NULL AND (i.package_lead_id IS NULL OR i.package_lead_id = i.id)
            AND (cardinality($1::text[]) = 0 OR (SELECT bool_and(i.title ILIKE '%' || w || '%' OR coalesce(t.name, '') ILIKE '%' || w || '%') FROM unnest($1::text[]) w))
            AND ($2::text[] IS NULL OR i.state = ANY($2::text[]))
            AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM keystone.document_party p WHERE p.instance_id = i.id AND (p.name ILIKE '%' || $3 || '%' OR p.email ILIKE '%' || $3 || '%')))
            AND ($4::date IS NULL OR ${col} >= $4::date) AND ($5::date IS NULL OR ${col} < $5::date + 1)
            AND ($6::date IS NULL OR EXISTS (SELECT 1 FROM keystone.document_key_date k WHERE k.instance_id = i.id AND k.kind = 'end' AND k.date_value < $6::date))
            AND ($7::date IS NULL OR EXISTS (SELECT 1 FROM keystone.document_key_date k WHERE k.instance_id = i.id AND k.kind = 'notice' AND k.date_value < $7::date))
          ORDER BY ${col} DESC NULLS LAST, i.id LIMIT 25`, [words, states, who, from, to, ends, notice]);
      const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
      const docs = rows.map((r) => ({ id: r.id, title: r.title, state: r.state, madeAt: iso(r.created_at), sentAt: iso(r.sent_at), signedAt: iso(r.executed_at), waitingOn: r.waiting_on ?? null, ends: day(r.ends_on), notice: day(r.notice_on), link: `/documents/${r.id}` }));
      const total = Number(rows[0]?.total ?? 0);
      const question = String(input?.question ?? "").trim().slice(0, 140) || null;
      return done({ count: total, shown: docs.length, documents: docs, note: "The person sees this list as a card. Say how many, and name a few; do not invent any that are not here." },
        { proposal: { kind: "results", state: "confirmed", summary: question ?? "Documents found", card: { kind: "results", question, total, rows: docs.map(({ id, title, state, sentAt, signedAt, waitingOn, ends, notice }) => ({ id, title, state, sentAt, signedAt, waitingOn, ends, notice })) } } });
    } },
  { name: "docustay.docs.explain_clause", kind: "read", permission: VIEW, step: "Reading the clause",
    description: "Explain one clause in plain words: its heading or a few of its words, and 2–3 sentences in the person's language on what it means (never advice). Refused when the clause is not in the document; the card adds the not-legal-advice line.",
    input_schema: OBJ({ documentId: ID(), clause: STR("heading or words", { maxLength: 160 }), explanation: STR("2–3 plain sentences", { maxLength: 900 }) }, ["clause", "explanation"]),
    run: async (ctx, input) => {
      const id = docIdOf(ctx, input); if (!id) return refuse("Which document? Give its id, or open it first.");
      const explanation = String(input?.explanation ?? "").trim().slice(0, 900); if (explanation.length < 10) return refuse("Write the explanation (two or three short sentences).");
      const c = await findClause(ctx, id, input?.clause);
      if (!c) return refuse("That clause is not in this document. Read the document (docustay.docs.read) and use a heading or words that are in it.");
      return done({ shown: true, heading: c.heading, note: `The person sees the clause, your explanation and "${PLAIN_WORDS_NOTE}". Do not repeat the explanation; one short sentence is enough.` },
        { proposal: { kind: "explain", state: "confirmed", documentId: id, summary: `Explain “${c.heading}”`.slice(0, 300), card: { kind: "explain", heading: c.heading, quote: c.text, page: c.page ?? null, explanation, note: PLAIN_WORDS_NOTE } } });
    } },
  { name: "docustay.doc.check_before_sending", kind: "read", permission: VIEW, step: "Checking it before it goes",
    description: "For a saved draft: signature boxes, signing order, required boxes with someone to fill them, and the email against the document. Changes nothing.",
    input_schema: OBJ({ documentId: ID() }),
    run: async (ctx, input) => {
      const id = docIdOf(ctx, input); if (!id) return refuse("Which draft? Give its id, or open it first.");
      let r; try { r = await sendCheckFor(ctx.db, { tenantId: ctx.tenantId, instanceId: id }); } catch { return refuse("That document was not found."); }
      if (r.notDraft) return done({ draft: false, note: "That document has already been sent, so there is nothing to check before sending." });
      return done({ ok: r.ok, rows: r.rows.map((x) => ({ ok: x.ok, kind: x.kind, text: x.text, fixOn: x.fix?.step ?? null })), link: `/documents/${id}/edit?step=check` });
    } },
  { name: "docustay.templates.list", kind: "read", permission: VIEW_ALL, step: "Looking at your templates",
    description: "List the workspace's templates (id, name, kind, how many times used when known). Filter by words in the name. At most 20.",
    input_schema: OBJ({ query: STR("words in the template's name") }),
    run: async (ctx, input) => {
      const r = await listPdfTemplates(ctx.db, { q: String(input?.query ?? "").slice(0, 80) }); const list = Array.isArray(r) ? r : (r?.templates ?? r?.rows ?? []);
      return done({ count: list.length, templates: list.slice(0, 20).map((t) => ({ id: t.id, name: t.name, kind: t.builder ?? t.kind ?? null, link: `/templates` })) });
    } },
  { name: "docustay.ai.usage", kind: "read", permission: null, step: "Checking your AI use",
    description: "How many AI drafts this workspace has used today and this month, against its limits. Read only; nobody's text is included.",
    input_schema: OBJ({}),
    run: async (ctx) => { const u = await aiUsage(ctx.db, { tenantId: ctx.tenantId }); return done({ today: u.today, thisMonth: u.month, dailyLimit: ctx.cfg?.perDay || null, monthlyLimit: ctx.cfg?.perMonth || null, note: "Each suggestion or draft the assistant makes counts as one. Plain answers count as nothing." }); } },
  { name: "docustay.help.setup", kind: "read", permission: null, step: "Finding the setup steps",
    description: `Exact steps and the right screen for a setup topic. Topics: ${SETUP_TOPICS.join(", ")}. The assistant only explains: it never changes a setting, key, billing or person.`,
    input_schema: OBJ({ topic: { type: "string", enum: SETUP_TOPICS } }, ["topic"]),
    run: async (ctx, input) => { const h = setupHelp(input?.topic); return h ? done(h) : refuse(`I only have setup steps for: ${SETUP_TOPICS.join(", ")}.`); } },
];
