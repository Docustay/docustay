// CONFIRMATION CARDS. A model tool can only PREPARE a card (this file validates it and writes what will happen in plain words); nothing runs until the person presses the button on the card, and the click
// calls `executeCard`, which re-checks the permission and the state and then calls the SAME domain function the screen calls. Sending, voiding, resending and the rest can run from nowhere else.
import { getPdfDocument } from "../pdfDocs.mjs";
import { sendBlockersFor, trackPdfDocument } from "../pdfSend.mjs";
import { REVIEW_PROBLEM, acknowledgeReview } from "./review.mjs";
import { apiSendDraft, apiUseTemplate, apiCreateDocument } from "../pdfApiV2.mjs";
import { apiRemind, apiVoid } from "../pdfApi.mjs";
import { bulkSend, BULK_MAX_ROWS } from "../proDoors.mjs";
import { getTemplateSource } from "../engine/creation.mjs";
import { getDocumentSetting } from "../settings.mjs";
import { ports } from "../ports.mjs";
import { isId } from "./toolkit.mjs";
import { readPeople } from "./people.mjs";
import { SCRIBE_ACTIONS } from "./pro.mjs";
import { remindPdfParties, setDocumentReminders } from "../pdfSend.mjs";
import { savePdfTemplate } from "../pdfDocs.mjs";

const DAY_MS = 864e5;
/** Run 9 — "remind everyone who hasn't signed a lease yet": the documents still out for signature whose title has every word asked for (a plural asks for the singular too) or that wait on that person.
 *  → [{ documentId, title, sentAt, lastRemindedAt, people:[names], checked }] — one reminded in the last day starts unticked. At most 20. */
async function waitingDocuments(ctx, { query = null, waitingOn = null, ids = null }) {
  const words = String(query ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !["the", "a", "an", "my", "all", "yet", "who", "not", "signed", "unsigned", "sign", "everyone", "documents", "document"].includes(w)).slice(0, 4).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w).replace(/[\\%_]/g, "\\$&"));
  const who = String(waitingOn ?? "").trim().slice(0, 80).replace(/[\\%_]/g, "\\$&") || null;
  const { rows } = await ctx.db.query(
    `SELECT i.id, i.title, i.sent_at FROM keystone.document_instance i
      WHERE i.builder = 'pdf' AND i.archived_at IS NULL AND (i.package_lead_id IS NULL OR i.package_lead_id = i.id) AND i.state IN ('sent','partially_signed')
        AND (cardinality($1::text[]) = 0 OR (SELECT bool_and(i.title ILIKE '%' || w || '%') FROM unnest($1::text[]) w))
        AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM keystone.document_party p WHERE p.instance_id = i.id AND p.name ILIKE '%' || $2 || '%' AND p.status IN ('pending','viewed')))
        AND ($3::uuid[] IS NULL OR i.id = ANY($3::uuid[]))
      ORDER BY i.sent_at NULLS LAST, i.id LIMIT 20`, [words, who, ids]);
  const out = [];
  for (const r of rows) {
    let t; try { t = await ctx.tx((tx) => trackPdfDocument(tx, { tenantId: ctx.tenantId, instanceId: r.id })); } catch { continue; }
    const up = (t.parties ?? []).filter((p) => p.canRemind); if (!up.length) continue;
    const { rows: [lr] } = await ctx.db.query(`SELECT max(last_reminded_at) AS at FROM keystone.document_party WHERE instance_id = $1`, [r.id]);
    const last = lr?.at ? new Date(lr.at) : null;
    out.push({ documentId: r.id, title: r.title, sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null, lastRemindedAt: last ? last.toISOString() : null, people: up.map((p) => p.name), checked: !(last && Date.now() - last.getTime() < DAY_MS) });
  }
  return out;
}
const cleanDays = (d) => (Array.isArray(d) ? d : []).map(Number);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const bad = (error) => ({ error });

/** @returns {Promise<{error:string}|{payload:object, card:object, documentId:string|null}>} */
export async function prepareCard(ctx, action, input) {
  const id = isId(input?.documentId) ? input.documentId : (isId(ctx.documentId) ? ctx.documentId : null);
  const doc = async () => { try { return await ctx.tx((tx) => getPdfDocument(tx, { tenantId: ctx.tenantId, instanceId: id })); } catch { return null; } };
  switch (action) {
    case "send": {
      if (!id) return bad("Which draft? Give its id, or open it first."); const d = await doc(); if (!d) return bad("That document was not found.");
      if (d.state !== "draft") return bad(`That document is ${d.state}, so it cannot be sent again.`);
      const bl = await ctx.tx((tx) => sendBlockersFor(tx, { tenantId: ctx.tenantId, instanceId: id }));
      const test = d.sendOptions?.test === true || (await getDocumentSetting(ctx.db, "test_mode.on").catch(() => false)) === true;
      const needsRead = (bl.problems ?? []).includes(REVIEW_PROBLEM);
      const problems = (bl.problems ?? []).filter((x) => x !== REVIEW_PROBLEM);
      if (!test) { try { await (await ports()).entitlements?.assertMaySend?.(ctx.db, { tenantId: ctx.tenantId }); } catch (e) { problems.push(String(e?.message ?? "Your plan does not allow another send right now.")); } }
      if (problems.length) return { ...bad("It cannot be sent yet."), problems: problems.slice(0, 12) };
      const who = (d.parties ?? []).filter((p) => ["signer", "approver", "viewer", "cc", "assistant"].includes(p.action_role ?? "signer"));
      const o = d.sendOptions ?? {};
      return { documentId: id, payload: { documentId: id }, card: { kind: "send", docTitle: d.title, n: who.length, people: who.map((p) => ({ action: p.action_role ?? "signer", name: p.name, email: p.email ?? null })), subject: o.subject || null, expiryDays: o.expiry_days ?? null, reminderDays: o.reminders?.days ?? [], sequential: o.order === "sequential", needsRead, title: `Send “${d.title}”`, summary: test ? "This is a TEST: it goes only to you and is stamped TEST. Nobody else receives anything." : `This sends the document for signature to ${plural(who.length, "person", "people")} now.`, test, button: test ? "Send test" : "Send now",
        lines: [...who.map((p) => ({ label: p.action_role ?? "signer", value: `${p.name} <${p.email ?? "no email"}>` })), { label: "Subject", value: o.subject || `Please sign: ${d.title}` }, ...(o.expiry_days ? [{ label: "Expires", value: `after ${o.expiry_days} days` }] : [{ label: "Expires", value: o.expiry_days === 0 ? "never" : "the workspace default" }]), ...((o.reminders?.days ?? []).length ? [{ label: "Reminders", value: `after ${o.reminders.days.join(", ")} days` }] : []), ...(o.order === "sequential" ? [{ label: "Order", value: "one after the other" }] : [])], link: `/documents/${id}/edit?step=send` } };
    }
    case "remind": case "resend": {
      if (!id) return bad("Which document? Give its id, or open it first.");
      let t; try { t = await ctx.tx((tx) => trackPdfDocument(tx, { tenantId: ctx.tenantId, instanceId: id })); } catch { return bad("That document was not found."); }
      if (!["sent", "partially_signed"].includes(t.state)) return bad(`That document is ${t.state}, so there is nobody to remind.`);
      const seat = typeof input?.seat === "string" ? input.seat : null;
      const up = t.parties.filter((p) => p.canRemind && (!seat || p.seat === seat || p.name.toLowerCase() === String(seat).toLowerCase()));
      if (action === "resend" && !seat) return bad("Which person? Give their seat or name.");
      if (!up.length) return bad(seat ? "That person has nothing left to do on this document." : "Nobody is waiting to be reminded.");
      return { documentId: id, payload: { documentId: id, ...(seat ? { seat: up[0].seat } : {}) }, card: { kind: action, docTitle: t.title, name: up[0].name, n: up.length, people: up.map((p) => ({ action: p.actionRole, name: p.name, email: p.email })), title: action === "resend" ? `Resend the signing email to ${up[0].name}` : `Send a reminder on “${t.title}”`, summary: `${plural(up.length, "person gets", "people get")} an email now.`, button: action === "resend" ? "Resend" : "Send reminder", test: t.test === true, lines: up.map((p) => ({ label: p.actionRole, value: `${p.name} <${p.email}>` })), link: `/documents/${id}` } };
    }
    case "void": {
      if (!id) return bad("Which document? Give its id, or open it first.");
      let t; try { t = await ctx.tx((tx) => trackPdfDocument(tx, { tenantId: ctx.tenantId, instanceId: id })); } catch { return bad("That document was not found."); }
      if (!["sent", "partially_signed"].includes(t.state)) return bad(`That document is ${t.state}; only one that is out for signature can be voided.`);
      const reason = String(input?.reason ?? "").trim().slice(0, 500);
      return { documentId: id, payload: { documentId: id, ...(reason ? { reason } : {}) }, card: { kind: "void", docTitle: t.title, people: t.parties.map((p) => ({ action: p.actionRole, name: p.name, status: p.status })), title: `Void “${t.title}”`, summary: "Voiding stops it: nobody can sign any more and the people are told it was cancelled. This cannot be undone.", button: "Void it", danger: true, needsReason: true, reason, lines: t.parties.map((p) => ({ label: p.actionRole, value: `${p.name} — ${p.status}` })), link: `/documents/${id}` } };
    }
    case "copy": {
      if (!id) return bad("Which document? Give its id, or open it first.");
      const { rows: [r] } = await ctx.db.query(`SELECT title, source FROM keystone.document_instance WHERE id = $1 AND builder = 'pdf' AND archived_at IS NULL`, [id]);
      if (!r) return bad("That document was not found."); if (!r.source?.content) return bad("That document was made from an uploaded file, so it cannot be copied here; use Create, then Upload.");
      return { documentId: id, payload: { documentId: id }, card: { kind: "copy", docTitle: r.title, title: `Copy “${r.title}”`, summary: "Makes a new draft with the same words, people and choices. Nothing is sent.", button: "Make a copy", lines: [], link: `/documents/${id}` } };
    }
    case "use_template": {
      if (!isId(input?.templateId)) return bad("Give the template's id (docustay.templates.list shows them).");
      let t; try { t = await ctx.tx((tx) => getTemplateSource(tx, { templateId: input.templateId })); } catch { return bad("That template was not found, or it is an uploaded-file template: those are used from the Templates screen."); }
      const test = input?.test === true;
      const { people, errors } = readPeople(input?.people, { test }); if (errors.length || !people.length) return bad(errors[0] ?? "Add at least one person.");
      const answers = input?.answers && typeof input.answers === "object" ? input.answers : {};
      const missing = (t.variables ?? []).filter((v) => !String(answers[v.key] ?? v.default ?? "").trim()).map((v) => `${v.key} (${v.label ?? v.key})`);
      if (missing.length) return bad(`Ask the person these questions first: ${missing.join(", ")}`);
      const title = String(input?.title ?? t.name).slice(0, 120);
      return { documentId: null, payload: { templateId: input.templateId, title, people, answers, test, sendChoice: input?.sendChoice ?? {} }, card: { kind: "use_template", docTitle: title, people: people.map((p) => ({ action: p.action ?? "signer", role: p.role || null, name: p.name, email: p.email })), title: `Make “${title}” from the template`, summary: "Makes a new draft for these people from the template. Nothing is sent; you can open and change it first.", button: "Make the draft", test, lines: people.map((p) => ({ label: p.role || p.action, value: `${p.name} <${p.email}>` })) } };
    }
    case "bulk_send": {
      if (!isId(input?.templateId)) return bad("Give the template's id (docustay.templates.list shows them).");
      const rows = (Array.isArray(input?.rows) ? input.rows : []).slice(0, BULK_MAX_ROWS + 1).map((r) => ({ name: String(r?.name ?? ""), email: String(r?.email ?? "") }));
      let dry; try { dry = await ctx.tx((tx) => bulkSend(tx, { tenantId: ctx.tenantId, actorUserId: ctx.actorUserId, templateId: input.templateId, rows, dryRun: true })); } catch (e) { return bad(String(e?.message ?? "That list cannot be sent.").slice(0, 300)); }
      const okRows = dry.results.filter((r) => r.ok); if (!okRows.length) return { ...bad("None of those rows can be sent."), problems: dry.results.filter((r) => !r.ok).slice(0, 8).map((r) => `row ${r.row}: ${r.error}`) };
      return { documentId: null, payload: { templateId: input.templateId, rows }, card: { kind: "bulk_send", n: okRows.length, failed: dry.failed ?? 0, rows: okRows.slice(0, 8).map((r) => ({ name: r.name, email: r.email })), more: Math.max(okRows.length - 8, 0), title: `Send to a list of ${plural(okRows.length, "person", "people")}`, summary: `${plural(okRows.length, "document goes", "documents go")} out now, one to each person${dry.failed ? `; ${plural(dry.failed, "row cannot", "rows cannot")} be sent and will be skipped` : ""}. Each is a real send.`, button: `Send ${okRows.length}`, lines: okRows.slice(0, 8).map((r) => ({ label: "to", value: `${r.name} <${r.email}>` })).concat(okRows.length > 8 ? [{ label: "and", value: `${okRows.length - 8} more` }] : []), problems: dry.results.filter((r) => !r.ok).slice(0, 5).map((r) => `row ${r.row}: ${r.error}`) } };
    }
    case "remind_many": {
      const ids = Array.isArray(input?.documentIds) ? input.documentIds.filter(isId).slice(0, 20) : null;
      const list = await waitingDocuments(ctx, { query: input?.query ?? null, waitingOn: input?.waitingOn ?? null, ids: ids?.length ? ids : null });
      if (!list.length) return bad(input?.query || input?.waitingOn ? "Nothing like that is waiting for a signature, so there is nobody to remind." : "Nothing is waiting for a signature, so there is nobody to remind.");
      const ticked = list.filter((x) => x.checked).length;
      return { documentId: null, payload: { documents: list.map((x) => x.documentId) }, card: { kind: "remind_many", title: `Send ${plural(ticked, "reminder", "reminders")}`, summary: "Uses your normal reminder email. Nothing is sent until you press Send.", button: `Send ${plural(ticked, "reminder", "reminders")}`, choices: list, messageEditable: true, lines: [] } };
    }
    case "make_template": {
      if (!id) return bad("Which document? Give its id, or open it first."); const d = await doc(); if (!d) return bad("That document was not found.");
      if (!d.body?.file) return bad("That document has no pages to keep as a template.");
      const name = String(input?.name ?? d.title).trim().slice(0, 120) || d.title;
      return { documentId: id, payload: { documentId: id, name }, card: { kind: "make_template", docTitle: d.title, name, boxes: d.body.fields?.length ?? 0, title: `Make a template from “${d.title}”`, summary: "Saves its pages, boxes and who fills each one as a template, named below. The people on it are not saved, and nothing is sent.", button: "Make the template", lines: [{ label: "Name", value: name }, { label: "Boxes", value: String(d.body.fields?.length ?? 0) }], link: `/documents/${id}` } };
    }
    case "set_reminders": {
      if (!id) return bad("Which document? Give its id, or open it first."); const d = await doc(); if (!d) return bad("That document was not found.");
      if (!["draft", "sent", "partially_signed"].includes(d.state)) return bad(`That document is ${d.state}, so its reminders cannot change.`);
      const days = [...new Set(cleanDays(input?.days))].sort((a, b) => a - b);
      if (days.some((x) => !Number.isInteger(x) || x < 1 || x > 60) || days.length > 3) return bad("Reminders are up to 3 different whole days between 1 and 60.");
      return { documentId: id, payload: { documentId: id, days }, card: { kind: "set_reminders", docTitle: d.title, current: d.sendOptions?.reminders?.days ?? [], title: `Reminders for “${d.title}”`, summary: days.length ? `Each person who has not finished gets a reminder ${days.join(", ")} days after they were sent it.` : "No automatic reminders. You can still remind people yourself.", button: days.length ? "Set reminders" : "Turn reminders off", days, lines: [{ label: "Now", value: (d.sendOptions?.reminders?.days ?? []).length ? `after ${d.sendOptions.reminders.days.join(", ")} days` : "none" }], link: `/documents/${id}` } };
    }
    case "support": {
      const kind = input?.kind === "problem" ? "problem" : "person"; const note = String(input?.note ?? "").trim().slice(0, 1000);
      return { documentId: id, payload: { kind, note, screen: String(ctx.screen ?? "").slice(0, 200) }, card: { kind: "support", which: kind, screen: String(ctx.screen ?? "").slice(0, 120) || null, documentId: id, title: kind === "problem" ? "Report a problem" : "Talk to a person", summary: "This sends the screen you are on and the ids of what is open, plus what you wrote. It does not send any of your document's words unless you tick the box.", button: "Send", offerText: Boolean(id), note, lines: [{ label: "Screen", value: String(ctx.screen ?? "(unknown)").slice(0, 120) }, ...(id ? [{ label: "Document id", value: id }] : [])] } };
    }
    default: return bad("That is not something I can prepare.");
  }
}

/** The person pressed the button. `row` is the stored card (payload, document_id). Returns {ok, summary, link?} or throws a plain error the route turns into a 4xx. */
export async function executeCard(ctx, { action, payload, body = {} }) {
  const { tenantId, actorUserId: ownerId } = ctx; const iid = payload?.documentId;
  // Run 9: Scribe acting for the person is Pro — checked again at the click, so a card made on Pro does nothing once Pro has ended (the route's transaction leaves the card unused)
  if (SCRIBE_ACTIONS.has(action)) await (await ports()).entitlements?.assertEntitled?.(ctx.db, { tenantId, item: "scribe_actions" });
  switch (action) {
    case "send": {
      // ai.require_review: the person ticks "I have read it" on the card; that tick is recorded, then the same send the screen makes runs (it still refuses if the assistant changed the draft since)
      if (body.read === true) await ctx.tx((tx) => acknowledgeReview(tx, { tenantId, actorUserId: ownerId, instanceId: iid }));
      const r = await ctx.tx((tx) => apiSendDraft(tx, { tenantId, ownerId, instanceId: iid }));
      // Run 8 F985 scope: the card said "Sent." when nobody was emailed (the day's limit); say who was not, and why
      const missed = r.notEmailed ?? [];
      const why = missed.some((m) => m.reason === "limit_reached") ? "today's email limit was reached; send a reminder after midnight UTC" : "the email could not be sent; check Settings → Email, then send a reminder";
      const summary = missed.length ? `Sent, but ${plural(missed.length, "person was", "people were")} not emailed: ${why}.` : r.emailed ? `Sent. ${plural(r.emailed, "email", "emails")} went out.` : "Sent.";
      return { ok: true, summary, detail: { emailed: r.emailed ?? 0, notEmailed: missed }, link: `/documents/${iid}` }; }
    case "remind": case "resend": { const r = await ctx.tx((tx) => apiRemind(tx, { tenantId, instanceId: iid, seat: payload.seat ?? null })); return { ok: true, summary: `${plural(r.reminded ?? r.count ?? 0, "reminder", "reminders")} sent.`, detail: { reminded: r.reminded ?? r.count ?? 0 }, link: `/documents/${iid}` }; }
    case "void": { const reason = String(body.reason ?? payload.reason ?? "").trim().slice(0, 500); if (reason.length < 3) { const e = new Error("Say why it is being voided (a few words)."); e.status = 400; throw e; } await ctx.tx((tx) => apiVoid(tx, { tenantId, instanceId: iid, reason, ownerId })); return { ok: true, summary: "Voided. The people were told it was cancelled.", link: `/documents/${iid}` }; }
    case "copy": {
      const made = await ctx.tx(async (tx) => {
        const d = await getPdfDocument(tx, { tenantId, instanceId: iid }); const { rows: [r] } = await tx.query(`SELECT source, source_facts, variable_values, source_paper FROM keystone.document_instance WHERE id = $1`, [iid]);
        if (!r?.source?.content) { const e = new Error("That document has no written words to copy."); e.status = 409; throw e; }
        const labelOf = (key) => (d.body?.roles ?? []).find((x) => x.key === key)?.label ?? key;
        const people = (d.parties ?? []).filter((p) => p.email).map((p, i) => ({ name: p.name, email: p.email, role: labelOf(p.role), action: p.action_role ?? "signer", order: p.position ?? i + 1 }));
        if (!people.length) { const e = new Error("That document has no people with an email to copy."); e.status = 409; throw e; }
        const o = d.sendOptions ?? {};
        return apiCreateDocument(tx, { tenantId, ownerId, title: `Copy of ${d.title}`.slice(0, 120), source: r.source, people, facts: {}, variableValues: r.variable_values ?? null, paper: r.source_paper ?? "letter", baseOptions: { ...(o.subject ? { subject: o.subject } : {}), ...(o.expiry_days !== undefined ? { expiry_days: o.expiry_days } : {}), ...(o.reminders ? { reminders: o.reminders } : {}), ...(o.order ? { order: o.order } : {}) }, send: false, test: d.sendOptions?.test === true });
      });
      return { ok: true, summary: "Copied. The new draft is ready to open.", link: `/documents/${made.id}/edit?step=prepare`, documentId: made.id };
    }
    case "use_template": { const made = await ctx.tx((tx) => apiUseTemplate(tx, { tenantId, ownerId, templateId: payload.templateId, title: payload.title, people: payload.people, variableValues: payload.answers ?? null, sendChoice: payload.sendChoice ?? {}, send: false, test: payload.test === true })); return { ok: true, summary: "The draft is made from the template.", link: `/documents/${made.id}/edit?step=prepare`, documentId: made.id }; }
    case "bulk_send": { const r = await ctx.tx((tx) => bulkSend(tx, { tenantId, actorUserId: ownerId, templateId: payload.templateId, rows: payload.rows, dryRun: false })); return { ok: true, summary: `Sent ${r.sent}${r.failed ? `; ${r.failed} could not be sent` : ""}${r.notEmailed ? `; ${plural(r.notEmailed, "person was", "people were")} not emailed (today's email limit) — send them a reminder after midnight UTC` : ""}.`, detail: { sent: r.sent, failed: r.failed, notEmailed: r.notEmailed ?? 0, errors: r.results.filter((x) => !x.ok).slice(0, 5).map((x) => `row ${x.row}: ${x.error}`) }, link: "/documents" }; }
    case "remind_many": {
      const allowed = new Set(payload.documents ?? []);
      const chosen = (Array.isArray(body.selected) ? body.selected : []).filter((x) => allowed.has(x));
      if (!chosen.length) { const e = new Error("Tick at least one document to remind."); e.status = 400; throw e; }
      const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 2000) : null;
      let reminded = 0, emailed = 0; const skipped = [];
      for (const docId of chosen) {
        // each document under its own savepoint: one that cannot be reminded (finished meanwhile, nobody up) is skipped without undoing the others
        await ctx.db.query("SAVEPOINT remind_one");
        try { const r = await ctx.tx((tx) => remindPdfParties(tx, { tenantId, instanceId: docId, message })); reminded += r.reminded ?? 0; emailed += r.sent ?? 0; await ctx.db.query("RELEASE SAVEPOINT remind_one"); }
        catch (e) { await ctx.db.query("ROLLBACK TO SAVEPOINT remind_one"); skipped.push(String(e?.message ?? "could not be reminded").slice(0, 120)); }
      }
      // Run 8 F985: say what was EMAILED, and who was not
      const notEmailed = reminded - emailed;
      return { ok: true, summary: `${plural(emailed, "reminder", "reminders")} sent${notEmailed > 0 ? `; ${plural(notEmailed, "person was", "people were")} not emailed (today's email limit, or email is not set up)` : ""}${skipped.length ? `; ${plural(skipped.length, "document was", "documents were")} skipped (${skipped[0]})` : ""}.`, detail: { reminded, emailed, documents: chosen.length, skipped }, link: "/documents" };
    }
    case "make_template": { const r = await ctx.tx((tx) => savePdfTemplate(tx, { tenantId, instanceId: iid, name: payload.name ?? null, actorUserId: ownerId, kind: "document" })); return { ok: true, summary: "Template made. It is with your templates.", link: "/templates", templateId: r.templateId }; }
    case "set_reminders": { const r = await ctx.tx((tx) => setDocumentReminders(tx, { tenantId, instanceId: iid, days: payload.days ?? [] })); return { ok: true, summary: r.reminders.on ? `Reminders set: after ${r.reminders.days.join(", ")} days.` : "Automatic reminders are off.", link: `/documents/${iid}` }; }
    case "support": {
      let text = null;
      if (body.includeText === true && iid) { const { rows: [r] } = await ctx.tx((tx) => tx.query(`SELECT source FROM keystone.document_instance WHERE id = $1`, [iid])); if (r?.source?.content) text = JSON.stringify(r.source).replace(/"(type|attrs|content|marks)":/g, "").slice(0, 20000); }
      const { rows: [row] } = await ctx.tx((tx) => tx.query(`INSERT INTO keystone.document_chat_report (tenant_id, conversation_id, reporter_id, kind, screen, document_id, include_text, note, document_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [tenantId, ctx.conversationId ?? null, ownerId, payload.kind, payload.screen || null, iid ?? null, body.includeText === true, (payload.note || "").slice(0, 2000) || null, text]));
      await ctx.notifySupport?.({ id: row.id, kind: payload.kind, screen: payload.screen, documentId: iid ?? null, note: payload.note ?? "", includeText: body.includeText === true }).catch(() => {});
      return { ok: true, summary: payload.kind === "problem" ? "Thank you. The problem is reported with the screen and ids." : "Thank you. A person will get back to you by email.", detail: { which: payload.kind } };
    }
    default: { const e = new Error("That is not something I can do."); e.status = 400; throw e; }
  }
}
