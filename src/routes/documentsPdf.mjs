// QUEUE §23.4 — THE UPLOAD FLOW OVER HTTP. Staff routes (upload in parts, the draft, send, track, remind, void) and the recipient's public routes (open, the pages, save, sign, decline). Same shape as documentsSettings.mjs: write ROWS
// spread into writes.mjs's ROUTES (via itemsAndDocuments.mjs) and read/binary routes registered here.
//
// ★ Nothing here knows a document table: it all goes through the Documents front door.
// ★ The public routes are SIGNER-scoped: a `pdf_signature` link opens a transaction whose viewer is the recipient's own party row (migration 0604). The link is spent LAST, on the write that completes their part —
//   a failed signature never burns it; opening and saving never spend it.
import { listTeammates, waitingOnMe } from "../documents/teamRecipients.mjs";
import { pageThumb } from "../documents/thumbnail.mjs";
import { liveStateInputs, liveStateBytes } from "../documents/pdfArchive.mjs";
// the live picture of a document out for signing is drawn from a few pages at a time: keep the last drawn few (by their version key) so three page requests draw it once. No database handle is held while drawing.
const liveCache = new Map();
async function liveBytes(key, live) {
  if (liveCache.has(key)) return liveCache.get(key);
  const bytes = await liveStateBytes(live);
  liveCache.set(key, bytes); while (liveCache.size > 12) liveCache.delete(liveCache.keys().next().value);
  return bytes;
}
import { notInDocustay } from "../documents/notInDocustay.mjs";
import { listLibrary, getLibraryTemplate, useBuiltin, customizeBuiltin, ensureBuiltin } from "../documents/frontDoor.mjs";
import { enabledPackContents, packsFirst } from "../documents/plays/store.mjs";
import { replaceDraftFile } from "../documents/engine/revise.mjs";
import { forbidden, invalid, notFound } from "../http/errors.mjs";
import { ports } from "../documents/ports.mjs";
import { withTenant } from "../db/index.mjs";
import { subdomainFromRequest } from "../auth/tenantFromHost.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { redeemLinkToken } from "../auth/linkToken.mjs";
import {
  richTemplateForm, createDraftFromRichTemplate, startUpload, uploadStatus, putPart, completeUpload, PART_BYTES,
  getPdfDocument, savePdfDocument, deletePdfDraft, searchRecipients, savePdfTemplate, createPdfFromTemplate, sendAgainPdf,
  listWorkspacePayments, sendPdfDocument, sendTestToSender, remindPdfParties, signNowLink, reassignParty, voidPdfDocument, trackPdfDocument,
  readFileBytes, createDetectJob, getDetectJob, cancelDetectJob, applyDetectJob, findFieldsOnDraft, splitPacket, embedOriginsForParty, createFromHtml, createTemplateFromStarter, starterCatalogue, shareDownloadLink, delegateAsParty, openDownload, sendDownloadCode, verifyDownloadCode, readDownload, fetchArchivedPdf, verifyFacts, evidencePackage, auditLogCsv, sendCodeForParty, verifyForParty, requestChangesAsParty, bulkSend, startPayment, confirmPayment, refundPayment, exportOrganization, personReport, erasePerson, listPdfTemplates, getPdfTemplate, readTemplateFile, updatePdfTemplateMeta, newPdfTemplateVersion, diffPdfTemplates, clonePdfTemplate, approvePdfTemplate, rejectPdfTemplate, retirePdfTemplate, uploadFileForField, readAttachmentForParty, removeAttachment, extendParty, decideAsApprover, acknowledgeAsViewer, assistAsParty, kioskTemplates, kioskStart, openForParty, openAsTest, savePartyProgress, signAsParty, declineAsParty, contentDisposition,
} from "../documents/frontDoor.mjs";
import { noteAccess, listAccess, accessCsv, sendCheckFor, withSignedCopyLink } from "../documents/frontDoor.mjs";

const SECTION = "/documents";
const LINK_REFUSED_TEXT = "That link is not valid. It may have been used already, expired, or been cancelled — ask for a new one.";
const need = (v, name) => { if (typeof v !== "string" || !v.trim()) throw invalid(`${name} is required`, { field: name }); return v; };

// ── staff writes (JSON, idempotency-keyed) ───────────────────────────────────────────────────────────────
const upStart = async (tx, { tenantId, actorUserId = null, name, size, sha256 = null, packageLeadId = null, attachTo = null }) => { await (await ports()).demo?.checkUpload(tx, { bytes: Number(size) }); return startUpload(tx, { tenantId, actorUserId, name, size, sha256, packageLeadId, attachTo }) };
const unattach = (tx, a) => removeAttachment(tx, { instanceId: need(a.instanceId, "instanceId"), fileId: need(a.fileId, "fileId") });
const upComplete = (tx, { tenantId, actorUserId = null, uploadId, title = null }) => completeUpload(tx, { tenantId, actorUserId, uploadId: need(uploadId, "uploadId"), title });
const save = (tx, a) => savePdfDocument(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, instanceId: need(a.instanceId, "instanceId"), title: a.title, body: a.body, parties: a.parties, sendOptions: a.sendOptions, message: a.message, description: a.description });
const send = async (tx, a) => { const out = await sendPdfDocument(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), actorUserId: a.actorUserId ?? null }); await (await ports()).events?.firstDocumentSent(tx, { tenantId: a.tenantId }); return out; };
const test = (tx, a) => sendTestToSender(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), actorUserId: a.actorUserId ?? null, to: a.to ?? null });
const remind = (tx, a) => remindPdfParties(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), partyId: a.partyId ?? null });
const reassign = (tx, a) => reassignParty(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), partyId: need(a.partyId, "partyId"), name: a.name ?? null, email: a.email ?? null });
const signNow = (tx, a) => signNowLink(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), partyId: need(a.partyId, "partyId") });
const voidIt = (tx, a) => voidPdfDocument(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), reason: a.reason ?? null, actorUserId: a.actorUserId ?? null });
const replaceFile = (tx, a) => replaceDraftFile(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), withInstanceId: need(a.withInstanceId, "withInstanceId") });
const sendAgain = (tx, a) => sendAgainPdf(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), actorUserId: a.actorUserId ?? null });
const discard = (tx, a) => deletePdfDraft(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), actorUserId: a.actorUserId ?? null });
const saveTemplate = (tx, a) => savePdfTemplate(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), name: a.name ?? null, actorUserId: a.actorUserId ?? null, kind: "document" });
const fromTemplate = (tx, a) => createPdfFromTemplate(tx, { tenantId: a.tenantId, templateId: need(a.templateId, "templateId"), title: a.title ?? null, actorUserId: a.actorUserId ?? null });

const findFields = (tx, a) => findFieldsOnDraft(tx, { instanceId: need(a.instanceId, "instanceId") });
const detectAiStart = (tx, a) => createDetectJob(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, instanceId: need(a.instanceId, "instanceId"), secondCheck: a.secondCheck === true });
const detectAiApply = (tx, a) => applyDetectJob(tx, { jobId: need(a.jobId, "jobId") });
const detectAiCancel = (tx, a) => cancelDetectJob(tx, { jobId: need(a.jobId, "jobId") });
const splitIt = (tx, a) => splitPacket(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, instanceId: need(a.instanceId, "instanceId") });
const fromHtml = (tx, a) => createFromHtml(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, name: a.name ?? null, html: need(a.html, "html"), paper: a.paper ?? "letter" });
// Run 9 Part 4R: the template library. "Use" makes a draft straight from a built-in (no template copied); "Customize" makes the workspace's own editable copy (a new template, counted).
// A member may do both (`self`): sending from a built-in makes their own draft; their Customize is their own template, which waits for an owner's approval (Settings → Templates).
const libUse = (tx, a) => useBuiltin(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, slug: need(a.slug, "slug"), title: a.title ?? null });
const libMaster = async (tx, a) => ({ templateId: await ensureBuiltin(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, slug: need(a.slug, "slug") }) });   // an automation's step names a built-in: its master, made once
const libCustomize = (tx, a) => customizeBuiltin(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, slug: need(a.slug, "slug"), name: a.name ?? null });
const dlLink = (tx, a) => shareDownloadLink(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), partyId: a.partyId ?? null, days: a.days ?? 7 });
const richDraft = (tx, a) => createDraftFromRichTemplate(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, templateId: need(a.templateId, "templateId"), values: a.values ?? {}, title: a.title ?? null });

const extend = (tx, a) => extendParty(tx, { tenantId: a.tenantId, instanceId: need(a.instanceId, "instanceId"), partyId: need(a.partyId, "partyId"), days: a.days ?? null, expiresAt: a.expiresAt ?? null });
const tplMeta = (tx, a) => updatePdfTemplateMeta(tx, { tenantId: a.tenantId, templateId: need(a.templateId, "templateId"), name: a.name, folder: a.folder, tags: a.tags, sendDefaults: a.sendDefaults, selfServe: a.selfServe, aiRules: a.aiRules });
const tplVersion = (tx, a) => newPdfTemplateVersion(tx, { tenantId: a.tenantId, templateId: need(a.templateId, "templateId"), body: a.body, changeNote: a.changeNote ?? null, actorUserId: a.actorUserId ?? null });
const tplClone = (tx, a) => clonePdfTemplate(tx, { tenantId: a.tenantId, templateId: need(a.templateId, "templateId"), name: a.name ?? null, actorUserId: a.actorUserId ?? null });
const tplApprove = (tx, a) => approvePdfTemplate(tx, { templateId: need(a.templateId, "templateId"), actorUserId: a.actorUserId ?? null });
const tplReject = (tx, a) => rejectPdfTemplate(tx, { templateId: need(a.templateId, "templateId"), reason: a.reason, actorUserId: a.actorUserId ?? null });
const tplRetire = (tx, a) => retirePdfTemplate(tx, { templateId: need(a.templateId, "templateId") });
const bulk = (tx, a) => bulkSend(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, templateId: need(a.templateId, "templateId"), rows: a.rows, dryRun: a.dryRun === true });
// ★ §23.15.3 — a person's data request and their "remove my details". POST, so the address is never in a URL; the delete verb, so only someone who may delete documents can ask.
const dataReport = (tx, a) => personReport(tx, { email: need(a.email, "email") });
const dataErase = (tx, a) => erasePerson(tx, { tenantId: a.tenantId, email: need(a.email, "email"), actorUserId: a.actorUserId ?? null });
// §23.5.11 — a refund of a payment made while signing: the delete verb (an admin's act); the provider is asked first
const refundIt = (tx, a) => refundPayment(tx, { tenantId: a.tenantId, paymentId: need(a.paymentId, "paymentId"), amountMinor: a.amountMinor ?? null, reason: a.reason, actorUserId: a.actorUserId ?? null });
const kiosk = async (tx, a) => { await notInDocustay(tx); return kioskStart(tx, { tenantId: a.tenantId, actorUserId: a.actorUserId ?? null, templateId: need(a.templateId, "templateId"), name: a.name, email: a.email ?? null }) };

export const DOCUMENT_PDF_WRITES = Object.freeze([
  { path: "/api/documents/pdf/uploads", section: SECTION, fn: upStart, object: "document", action: "edit", subject: null, self: true },
  { path: "/api/documents/pdf/download-link", section: SECTION, fn: dlLink, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/library/use", section: SECTION, fn: libUse, object: "document", action: "edit", subject: null, self: true },
  { path: "/api/documents/library/customize", section: SECTION, fn: libCustomize, object: "document", action: "edit", subject: null, self: true },
  { path: "/api/documents/library/master", section: SECTION, fn: libMaster, object: "document", action: "template.author" },
  { path: "/api/documents/pdf/from-html", section: SECTION, fn: fromHtml, object: "document", action: "edit", subject: null },
  { path: "/api/documents/pdf/from-rich-template", section: SECTION, fn: richDraft, object: "document", action: "edit", subject: null, self: true },
  { path: "/api/documents/pdf/uploads/complete", section: SECTION, fn: upComplete, object: "document", action: "edit", subject: null, self: true },
  { path: "/api/documents/pdf/attachment/remove", section: SECTION, fn: unattach, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/replace-file", section: SECTION, fn: replaceFile, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/split-packet", section: SECTION, fn: splitIt, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/find-fields", section: SECTION, fn: findFields, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/find-fields/ai", section: SECTION, fn: detectAiStart, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/find-fields/ai/apply", section: SECTION, fn: detectAiApply, object: "document", action: "edit", subject: null },
  { path: "/api/documents/pdf/find-fields/ai/cancel", section: SECTION, fn: detectAiCancel, object: "document", action: "edit", subject: null },
  { path: "/api/documents/pdf/save", section: SECTION, fn: save, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/send", section: SECTION, fn: send, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/test", section: SECTION, fn: test, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/remind", section: SECTION, fn: remind, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/reassign", section: SECTION, fn: reassign, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/sign-now", section: SECTION, fn: signNow, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/void", section: SECTION, fn: voidIt, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/send-again", section: SECTION, fn: sendAgain, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/discard", section: SECTION, fn: discard, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/save-template", section: SECTION, fn: saveTemplate, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/from-template", section: SECTION, fn: fromTemplate, object: "document", action: "edit", subject: null, self: true },
  { path: "/api/documents/pdf/extend", section: SECTION, fn: extend, object: "document", action: "edit", subject: "instanceId" },
  { path: "/api/documents/pdf/bulk", section: SECTION, fn: bulk, object: "document", action: "edit", subject: null },
  { path: "/api/documents/pdf/templates/meta", section: SECTION, fn: tplMeta, object: "document", action: "edit", subject: null },
  { path: "/api/documents/pdf/templates/version", section: SECTION, fn: tplVersion, object: "document", action: "edit", subject: null },
  { path: "/api/documents/pdf/templates/clone", section: SECTION, fn: tplClone, object: "document", action: "edit", subject: null },
  { path: "/api/documents/pdf/templates/retire", section: SECTION, fn: tplRetire, object: "document", action: "edit", subject: null },
  // approving is an admin's act: the highest document verb
  { path: "/api/documents/pdf/templates/approve", section: SECTION, fn: tplApprove, object: "document", action: "delete", subject: null },
  { path: "/api/documents/pdf/templates/reject", section: SECTION, fn: tplReject, object: "document", action: "delete", subject: null },
  { path: "/api/documents/pdf/kiosk", section: SECTION, fn: kiosk, object: "document", action: "edit", subject: null },
  { path: "/api/documents/pdf/refund-payment", section: SECTION, fn: refundIt, object: "document", action: "delete", subject: null },
  { path: "/api/documents/pdf/data-report", section: SECTION, fn: dataReport, object: "document", action: "delete", subject: null },
  { path: "/api/documents/pdf/data-erase", section: SECTION, fn: dataErase, object: "document", action: "delete", subject: null },
]);

// ── the recipient's side: one door per verb ─────────────────────────────────────────────────────────────────
const PURPOSES = Object.freeze(["pdf_signature"]);
const TEST_PURPOSES = Object.freeze(["pdf_test"]);
const clientIp = (c) => c.get("clientIp") ?? null;
const agent = (c) => c.req.header("user-agent") ?? null;

async function spend(presented, leadId) {
  const spent = await redeemLinkToken(presented, PURPOSES);
  if (spent.subjectId !== leadId) throw forbidden(LINK_REFUSED_TEXT);
}

export function registerDocumentPdfRoutes(app, { runTenantScoped, runSignerScoped, tenantIsPlatform }) {
  const guard = async (db, principal, tenantId) => {
    const isPlatform = await tenantIsPlatform(db, tenantId);
    const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
  };
  const read = (path, fn, bucket = "documents") => app.get(path, (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); return fn({ db, tenantId, c, principal }); }, { bucket }).then((r) => c.json(r)));

  // ★ §23.5.5 — uploaded-document templates
  read("/api/documents/pdf/find-fields/ai/:jobId", ({ db, c }) => getDetectJob(db, { jobId: c.req.param("jobId") }));   // the editor polls this: "Finding fields 3 of 12 pages"
  // Run 6: say what THIS person may do with the list, so the screen does not offer Edit / Retire / Approve to a role the server will refuse (the server still decides; this only stops the offer). Same checks as the routes below: retire = document edit, approve and reject = document delete.
  const mayOnDocuments = async (db, principal, action) => (await db.query(`SELECT keystone.user_may($1, 'document', $2, NULL) AS ok`, [principal.appUserId, action])).rows[0]?.ok === true;
  read("/api/documents/pdf/templates", async ({ db, c, principal }) => ({
    ...(await listPdfTemplates(db, { q: c.req.query("q") ?? "", folder: c.req.query("folder") || null, tag: c.req.query("tag") || null, showRetired: ["1", "true"].includes(c.req.query("retired")), kind: c.req.query("kind") || null })),
    can: { retire: await mayOnDocuments(db, principal, "edit"), approve: await mayOnDocuments(db, principal, "delete") },
  }));
  read("/api/documents/rich-templates/:id/form", ({ db, tenantId, c }) => richTemplateForm(db, { tenantId, templateId: c.req.param("id") }));
  read("/api/documents/pdf/templates/:id", ({ db, c }) => getPdfTemplate(db, { templateId: c.req.param("id") }));
  read("/api/documents/pdf/templates/:id/diff", ({ db, c }) => diffPdfTemplates(db, { templateId: c.req.param("id"), againstId: c.req.query("against") || null }));
  app.get("/api/documents/pdf/templates/:id/file", async (c) => {
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); return readTemplateFile(db, { templateId: c.req.param("id") }); }, { bucket: "documents" });
    return c.body(out.bytes, 200, { "content-type": "application/pdf", "content-disposition": contentDisposition("inline", out.name), "cache-control": "private, max-age=300" });
  });
  // Run 9 Part 3.7 (Pay 3): the Payments page — every payment taken through a payment box, and this month's figures (documents the person may open only)
  read("/api/documents/payments", ({ db, tenantId, c }) => listWorkspacePayments(db, { tenantId, before: c.req.query("before") || null, limit: Number(c.req.query("limit") ?? 50) }));
  read("/api/documents/pdf/recipients", ({ db, c, principal }) => searchRecipients(db, { q: c.req.query("q") ?? "", limit: 12, selfId: principal.appUserId ?? null }));
  // 21 Oct 2026 — sending to teammates: the people of this workspace (every role may see who they can send to), and what is waiting on the signed-in person
  read("/api/documents/teammates", async ({ db, c, principal }) => ({ teammates: await listTeammates(db, { q: c.req.query("q") ?? "", limit: 50, selfId: principal.appUserId ?? null }) }));
  read("/api/documents/waiting-on-me", async ({ db, principal }) => ({ documents: principal.appUserId ? await waitingOnMe(db, { userId: principal.appUserId }) : [] }));
  read("/api/documents/pdf/uploads/:uploadId", ({ db, c }) => uploadStatus(db, { uploadId: c.req.param("uploadId") }));
  // ★ fixed-name routes BEFORE `/:id`: Hono answers in registration order, and "export.zip" / "kiosk-templates" would otherwise be taken for a document id
  // Run 9 Part 4R: the built-in library of this workspace (each built-in, with this workspace's master id once it has one) and one built-in in full (its fields and its Scribe guidance)
  read("/api/documents/library", async ({ db, c }) => {   // R13-D336: the switched-on packs' templates first, for every list that shows the library (Templates, New document, Packs)
    const out = await listLibrary(db, { kind: c.req.query("kind") || null });
    const { templates } = await enabledPackContents(db);
    return { ...out, templates: packsFirst(out.templates ?? [], templates, (t) => `builtin:${t.slug}`) };
  });
  read("/api/documents/library/:slug", ({ db, c }) => getLibraryTemplate(db, { slug: c.req.param("slug"), use: c.req.query("use") || null }));
  // the starter templates are the same for everyone (the website shows them too): no workspace data, so no sign-in is asked for
  app.get("/api/documents/starters", async (c) => c.json({ starters: await starterCatalogue({ kind: c.req.query("kind") === "form" ? "form" : "document" }) }));
  app.get("/api/documents/pdf/kiosk-templates", async (c) => c.json({ templates: await runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); return kioskTemplates(db); }, { bucket: "documents" }) }));
  // ★ §23.15.3 — every signed document of a period as one zip. Only someone who may delete documents (an admin) can take the whole organisation's records out.
  app.get("/api/documents/pdf/export.zip", async (c) => {
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); await assertMay(db, principal, { object: "document", action: "delete" }); const r = await exportOrganization(db, { tenantId, from: c.req.query("from") || null, to: c.req.query("to") || null }); await seen(db, tenantId, principal, c, "export", null, `signed documents zip (${r.count ?? 0})`); return r;; }, { bucket: "documents" });
    return c.body(out.bytes, 200, { "content-type": "application/zip", "content-disposition": `attachment; filename="signed-documents.zip"`, "cache-control": "private, no-store", "x-export-count": String(out.count), "x-export-truncated": out.truncated ? "1" : "0" });
  });
  // Run 7 part 6: the access log (always on) — staff, who, when
  const seen = (db, tenantId, principal, c, action, instanceId, what = null, title = null) => noteAccess(db, { tenantId, action, instanceId, title, what, userId: principal.appUserId ?? null, ip: c.get("clientIp") ?? null });
  read("/api/documents/access-log", async ({ db, principal, c }) => { await assertMay(db, principal, { object: "document", action: "delete" }); return listAccess(db, { instanceId: c.req.query("document") || null, before: c.req.query("before") || null }); });
  app.get("/api/documents/access-log.csv", async (c) => {
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); await assertMay(db, principal, { object: "document", action: "delete" }); return accessCsv(db, { from: c.req.query("from") || null, to: c.req.query("to") || null }); }, { bucket: "documents" });
    return c.body(out.csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${out.name}"`, "cache-control": "private, no-store" });
  });
  read("/api/documents/pdf/:id", async ({ db, tenantId, c, principal }) => { const d = await getPdfDocument(db, { tenantId, instanceId: c.req.param("id") }); await seen(db, tenantId, principal, c, "view", d.id, null, d.title); return d; });
  read("/api/documents/pdf/:id/send-check", ({ db, tenantId, c }) => sendCheckFor(db, { tenantId, instanceId: c.req.param("id") }));   // Run 9: the check before sending (the Check step's four rows)
  read("/api/documents/pdf/:id/track", async ({ db, tenantId, c, principal }) => { const t = await trackPdfDocument(db, { tenantId, instanceId: c.req.param("id") }); await seen(db, tenantId, principal, c, "view", c.req.param("id")); return t; });

  // one part of an upload — a raw body of at most PART_BYTES (the application's own body cap is 1 MiB)
  app.put("/api/documents/pdf/uploads/:uploadId/parts/:n", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId);
      const bytes = Buffer.from(await c.req.arrayBuffer());
      if (bytes.length === 0 || bytes.length > PART_BYTES) throw invalid(`a part is between 1 byte and ${PART_BYTES} bytes`, { field: "body" });
      return putPart(db, { tenantId, uploadId: c.req.param("uploadId"), n: Number(c.req.param("n")), bytes });
    }, { bucket: "documents", idempotent: false }).then((r) => c.json(r)));

  // the pages of a draft or sent document, for the editor and the Track screen (the working PDF, hash-checked)
  app.get("/api/documents/pdf/:id/file/:fileId", async (c) => {
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId);
      const doc = await getPdfDocument(db, { tenantId, instanceId: c.req.param("id") });
      if (!doc.files.some((f) => f.id === c.req.param("fileId"))) throw forbidden("that file is not part of this document");
      const { bytes, row } = await readFileBytes(db, { fileId: c.req.param("fileId") });
      await seen(db, tenantId, principal, c, "download", doc.id, `file: ${row.name ?? ""}`, doc.title);
      return { bytes, row };
    }, { bucket: "documents" });
    return c.body(out.bytes, 200, { "content-type": out.row.mime === "application/pdf" ? "application/pdf" : "application/octet-stream", "content-disposition": contentDisposition("inline", out.row.name), "cache-control": "private, max-age=300" });
  });

  // the sealed signed copy (download), only once executed
  app.get("/api/documents/pdf/:id/signed.pdf", async (c) => {
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId);
      const doc = await getPdfDocument(db, { tenantId, instanceId: c.req.param("id") });
      const r = await fetchArchivedPdf(db, { instanceId: doc.id });
      await seen(db, tenantId, principal, c, "download", doc.id, "signed copy", doc.title);
      return { bytes: r.body, title: doc.title };
    }, { bucket: "documents" });
    return c.body(out.bytes, 200, { "content-type": "application/pdf", "content-disposition": contentDisposition("attachment", `${out.title} (signed).pdf`), "cache-control": "private, no-store" });
  });

  // a page as a picture: the first page small for lists and galleries, or ?w=480|720&page=N for the document page's preview (COMBINED-STYLE-SPEC section 4); 204 when the document has no PDF page to draw (the web falls back to a drawn page)
  app.get("/api/documents/pdf/:id/thumb.png", async (c) => {
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await guard(db, principal, tenantId);
      const doc = await getPdfDocument(db, { tenantId, instanceId: c.req.param("id") });
      let bytes = null, key = null, live = null;
      if (doc.state === "executed") { const r = await fetchArchivedPdf(db, { instanceId: doc.id }).catch(() => null); if (r) { bytes = r.body; key = `sealed:${doc.id}`; } }
      // a document that is out for signing shows what it is NOW: the sender's answers and every signature so far on the pages, a pale mark on what is still waiting (it used to show the blank original)
      if (!bytes && doc.state !== "draft" && doc.state !== "executed" && c.req.query("original") !== "1" && Number(c.req.query("w")) >= 480) live = await liveStateInputs(db, doc.id).catch(() => null);
      if (live) { key = `live:${doc.id}:${live.version}`; return { live, key }; }
      if (!bytes) { const f = (doc.files ?? []).find((x) => /pdf/i.test(x.mime ?? x.content_type ?? "") || /\.pdf$/i.test(x.name ?? "")); if (f) { const r = await readFileBytes(db, { fileId: f.id }); bytes = r.bytes; key = f.sha256 ? `sha:${f.sha256}` : `file:${f.id}`; } }
      return bytes ? { bytes, key } : null;
    }, { bucket: "documents" });
    if (out?.live) { try { out.bytes = await liveBytes(out.key, out.live); } catch { out.bytes = null; } if (!out.bytes) return c.body(null, 204); }
    if (!out) return c.body(null, 204);   // 204, not 404: a missing picture is normal (the web draws a page instead) and must not show as an error in the browser's console
    const w = Number(c.req.query("w")), pg = Number(c.req.query("page"));
    const png = await pageThumb(out.key, out.bytes, { width: [120, 240, 480, 720].includes(w) ? w : 240, page: Number.isInteger(pg) && pg >= 1 && pg <= 50 ? pg : 1 });
    if (!png) return c.body(null, 204);
    return c.body(png, 200, { "content-type": "image/png", "cache-control": out.live ? "private, max-age=60" : "private, max-age=3600" });
  });

  // ★ §23.5.1 — the evidence package (zip) and the audit log (CSV), staff only
  app.get("/api/documents/pdf/:id/evidence.zip", async (c) => {
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); const r = await evidencePackage(db, { tenantId, instanceId: c.req.param("id") }); await seen(db, tenantId, principal, c, "download", c.req.param("id"), "evidence package"); return r; }, { bucket: "documents" });
    return c.body(out.bytes, 200, { "content-type": "application/zip", "content-disposition": contentDisposition("attachment", out.name), "cache-control": "private, no-store" });
  });
  app.get("/api/documents/pdf/:id/audit.csv", async (c) => {
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => { await guard(db, principal, tenantId); const r = await auditLogCsv(db, { tenantId, instanceId: c.req.param("id") }); await seen(db, tenantId, principal, c, "export", c.req.param("id"), "audit log"); return r; }, { bucket: "documents" });
    return c.body(out.csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": contentDisposition("attachment", out.name), "cache-control": "private, no-store" });
  });

  // ── recipient (public, signer-scoped) ───────────────────────────────────────────────────────────────────
  const party = (c, handler, opts = {}) => runSignerScoped(c, handler, { expectedPurposes: PURPOSES, spend: false, ...opts });
  app.post("/api/public/pdf/view", (c) => party(c, ({ db, tenantId, redeemed, body }) =>
    openForParty(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, ip: clientIp(c), userAgent: agent(c), language: typeof body?.language === "string" ? body.language.slice(0, 2).toLowerCase() : null })).then((r) => c.json(r, 200)));

  app.post("/api/public/pdf/file", async (c) => {
    const out = await party(c, async ({ db, tenantId, redeemed, body }) => {
      const view = await openForParty(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo }).catch(() => null);
      if (!view || view.gate) throw forbidden(view?.gate ? "Enter the code first." : LINK_REFUSED_TEXT);
      const doc = view.documents.find((d) => d.id === body?.documentId) ?? view.documents[0];
      const { bytes } = await readFileBytes(db, { fileId: await fileIdOf(db, doc.id) });
      return { bytes };
    });
    return c.body(out.bytes, 200, { "content-type": "application/pdf", "cache-control": "private, no-store" });
  });

  // ★ §23.5.2 — ask for the emailed code / answer the check
  app.post("/api/public/pdf/send-code", (c) => party(c, ({ db, tenantId, redeemed }) => sendCodeForParty(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo })).then((r) => c.json(r, 200)));
  app.post("/api/public/pdf/verify", (c) => party(c, ({ db, tenantId, redeemed, body }) => verifyForParty(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, code: body?.code })).then((r) => c.json(r, 200)));

  app.post("/api/public/pdf/request-changes", (c) => party(c, ({ db, tenantId, redeemed, body }) => requestChangesAsParty(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, message: body?.message })).then((r) => c.json(r, 201)));
  // ★ §23.5.16 — the other roles. The token is spent LAST, only when the act finishes the person's part (an assistant's saves do not spend it).
  app.post("/api/public/pdf/decide", (c) => party(c, async ({ db, tenantId, redeemed, body }) => {
    const out = await decideAsApprover(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, decision: body?.decision, comment: body?.comment ?? null, ip: clientIp(c), userAgent: agent(c) });
    await spend(body?.presented, redeemed.subjectId);
    return out;
  }).then((r) => c.json(r, 201)));
  app.post("/api/public/pdf/acknowledge", (c) => party(c, async ({ db, tenantId, redeemed, body }) => {
    const out = await acknowledgeAsViewer(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, ip: clientIp(c) });
    await spend(body?.presented, redeemed.subjectId);
    return out;
  }).then((r) => c.json(r, 201)));
  app.post("/api/public/pdf/assist", (c) => party(c, async ({ db, tenantId, redeemed, body }) => {
    const out = await assistAsParty(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, values: body?.values ?? {}, finish: body?.finish === true });
    if (body?.finish === true) await spend(body?.presented, redeemed.subjectId);
    return out;
  }).then((r) => c.json(r, 201)));
  app.post("/api/public/pdf/upload-file", (c) => party(c, ({ db, tenantId, redeemed, body }) => {
    const bytes = Buffer.from(String(body?.data ?? ""), "base64");
    return uploadFileForField(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, fieldId: String(body?.fieldId ?? ""), name: String(body?.name ?? "upload"), bytes });
  }).then((r) => c.json(r, 201)));
  app.post("/api/public/pdf/attachment", async (c) => {
    const out = await party(c, ({ db, redeemed, body }) => readAttachmentForParty(db, { leadId: redeemed.subjectId, partyId: redeemed.issuedTo, fileId: String(body?.fileId ?? "") }));
    return c.body(out.bytes, 200, { "content-type": out.mime, "content-disposition": contentDisposition("attachment", out.name), "cache-control": "private, no-store" });
  });
  // §23.5.11 / Part 30 item 11 — paying while signing, on Stripe's hosted Checkout: start (works the amount out on the server from the values typed, creates / re-opens the Session, answers where to go) and confirm (re-read the provider). Verified, signer-scoped, link not spent.
  // The browser says which page to come back to (its own origin + a /sign/ path); the origin must be the one this request really came to or from, so a page cannot send a signer to an address of its choosing.
  const returnOrigin = (c, claimed) => {
    let u; try { u = new URL(String(claimed ?? "")); } catch { return null; }
    const seen = new Set([c.req.header("origin"), `${c.req.header("x-forwarded-proto") ?? "https"}://${c.req.header("x-forwarded-host") ?? c.req.header("host") ?? ""}`, `http://${c.req.header("host") ?? ""}`, `https://${c.req.header("host") ?? ""}`].filter(Boolean));
    // behind a public edge the request headers name the BACKEND, never the page the signer is on: the configured public addresses of the Docustay web app are accepted too (server config, never browser input)
    for (const v of [process.env.KEYSTONE_DOCUSTAY_SIGN_URL, process.env.KEYSTONE_DOCUSTAY_APP_URL, process.env.KEYSTONE_PUBLIC_URL]) { try { if (v) seen.add(new URL(v).origin); } catch { /* not a URL */ } }
    return seen.has(u.origin) ? u.origin : null;
  };
  app.post("/api/public/pdf/payment/start", (c) => party(c, ({ db, tenantId, redeemed, body }) =>
    startPayment(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, fieldId: need(body?.fieldId, "fieldId"), values: body?.values && typeof body.values === "object" ? body.values : {},
      chosen: body?.amount ?? null, origin: returnOrigin(c, body?.returnOrigin) ?? "", returnPath: String(body?.returnPath ?? ""), embedded: body?.embedded === true })).then((r) => c.json(r, 200)));
  // Run 9 Part 3.7: when the payment completes a signature that was held for it, the link is spent here — the act that finished this person's part (a webhook that completed it first leaves the
  // link able only to show the signed document: the party is signed, so signing again is refused)
  // R13-D266: the signature that completes the document answers with the signer's own link to the signed copy
  const withDownload = (db, tenantId, redeemed, out) => withSignedCopyLink(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, out });
  app.post("/api/public/pdf/payment/confirm", (c) => party(c, async ({ db, tenantId, redeemed, body }) => {
    const out = await confirmPayment(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, fieldId: need(body?.fieldId, "fieldId") });
    if (out.hold?.signed && body?.presented) await spend(body.presented, redeemed.subjectId);
    return out.hold?.completed ? { ...out, hold: await withDownload(db, tenantId, redeemed, out.hold) } : out;
  }).then((r) => c.json(r, 200)));
  app.post("/api/public/pdf/progress", (c) => party(c, ({ db, tenantId, redeemed, body }) =>
    savePartyProgress(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, values: body?.values ?? {} })).then((r) => c.json(r, 200)));

  app.post("/api/public/pdf/sign", (c) => party(c, async ({ db, tenantId, redeemed, body }) => {
    const out = await signAsParty(db, {
      tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo,
      typedName: body?.typedName, consent: body?.consent === true, marks: body?.marks ?? {}, values: body?.values ?? {}, signerTimezone: body?.signerTimezone ?? null, ip: clientIp(c), userAgent: agent(c),
      reason: body?.reason ?? null, signatureMethod: body?.signatureMethod ?? null, witness: body?.witness && typeof body.witness === "object" ? body.witness : null, language: typeof body?.language === "string" ? body.language.slice(0, 2).toLowerCase() : null,
    });
    if (!out.held) await spend(body?.presented, redeemed.subjectId);   // Run 9 Part 3.7: a signature HELD for its payment has not finished this person's part — the link stays live for the payment
    return withDownload(db, tenantId, redeemed, out);
  }).then((r) => c.json(r, 201)));

  // Part 30 item 5 — the expirable download link to the signed copy (a link token of its own purpose; nothing here can sign or change anything)
  const dl = (c, handler) => runSignerScoped(c, handler, { expectedPurposes: ["pdf_download"], spend: false });
  app.post("/api/public/pdf/download/view", (c) => dl(c, ({ db, tenantId, redeemed }) => openDownload(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo })).then((r) => c.json(r, 200)));
  app.post("/api/public/pdf/download/send-code", (c) => dl(c, ({ db, tenantId, redeemed }) => sendDownloadCode(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo })).then((r) => c.json(r, 200)));
  app.post("/api/public/pdf/download/verify", (c) => dl(c, ({ db, tenantId, redeemed, body }) => verifyDownloadCode(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, code: body?.code })).then((r) => c.json(r, 200)));
  app.post("/api/public/pdf/download/file", async (c) => {
    const out = await dl(c, ({ db, tenantId, redeemed, body }) => readDownload(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, documentId: body?.documentId ?? null, which: body?.which === "certificate" ? "certificate" : "signed" }));
    return c.body(out.bytes, 200, { "content-type": "application/pdf", "content-disposition": contentDisposition("attachment", String(out.name)), "cache-control": "private, no-store" });
  });

  // Part 30 item 4 — the websites that may frame THIS link's signing form (empty unless the seat was sent as embedded); the signing page's server reads it for its frame-ancestors header and the form for where it may post events
  app.post("/api/public/pdf/embed-origins", (c) => party(c, ({ db, redeemed }) => embedOriginsForParty(db, { leadId: redeemed.subjectId, partyId: redeemed.issuedTo })).then((origins) => c.json({ origins }, 200)));

  // Part 30 item 5 — a signer passes their turn to someone else (when the organisation allows it)
  app.post("/api/public/pdf/delegate", (c) => party(c, async ({ db, tenantId, redeemed, body }) => {
    // R13-D053: no spend() here. delegateAsParty mints the new link, which REVOKES this person's old one inside this same transaction; spending the old link on a second connection then waited on that row lock until the lock timeout (500), the delegation rolled back, and the invitation email had already gone out.
    return delegateAsParty(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, name: body?.name, email: body?.email });
  }).then((r) => c.json(r, 201)));

  app.post("/api/public/pdf/decline", (c) => party(c, async ({ db, tenantId, redeemed, body }) => {
    const out = await declineAsParty(db, { tenantId, leadId: redeemed.subjectId, partyId: redeemed.issuedTo, reason: body?.reason ?? null });
    await spend(body?.presented, redeemed.subjectId);
    return out;
  }).then((r) => c.json(r, 201)));

  // ★ §23.5.1 — the public verify page's facts. No session: the code in the certificate's QR is the credential, and a wrong one is indistinguishable from "no such document".
  app.get("/api/public/documents/verify-facts", async (c) => {
    c.header("cache-control", "no-store");
    const [tenantId, instanceId, code] = String(c.req.query("ref") ?? "").split(".");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(tenantId ?? "") || !uuid.test(instanceId ?? "") || !/^[0-9a-f]{16}$/.test(code ?? "")) throw notFound("That reference is not valid.");
    const facts = await withTenant(tenantId, (tx) => verifyFacts(tx, { tenantId, instanceId, code }), { userId: null });
    if (!facts) throw notFound("That reference is not valid.");
    return c.json(facts);
  });

  // the sender's test link: the same page, read from the draft, signing refused
  const tparty = (c, handler) => runSignerScoped(c, handler, { expectedPurposes: TEST_PURPOSES, spend: false });
  app.post("/api/public/pdf/test/view", (c) => tparty(c, ({ db, tenantId, redeemed }) => openAsTest(db, { tenantId, leadId: redeemed.subjectId })).then((r) => c.json(r, 200)));
  app.post("/api/public/pdf/test/file", async (c) => {
    const out = await tparty(c, async ({ db, tenantId, redeemed, body }) => {
      const view = await openAsTest(db, { tenantId, leadId: redeemed.subjectId });
      const doc = view.documents.find((d) => d.id === body?.documentId) ?? view.documents[0];
      const { bytes } = await readFileBytes(db, { fileId: await fileIdOf(db, doc.id) });
      return { bytes };
    });
    return c.body(out.bytes, 200, { "content-type": "application/pdf", "cache-control": "private, no-store" });
  });
}

/** The working file of a document, from its own (already visible) body — the recipient never names a file id. */
async function fileIdOf(db, instanceId) {
  const { rows: [r] } = await db.query(`SELECT template_body_snapshot -> 'file' ->> 'file_id' AS id FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  if (!r?.id) throw forbidden(LINK_REFUSED_TEXT);
  return r.id;
}
