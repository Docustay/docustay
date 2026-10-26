// src/documents/frontDoor.mjs — the maintainer, 29 Sep 2026 (Docustay brief, §2.3): "One front door — a small
// set of exported functions... everything outside asks through these." This is that door for
// EVERY caller outside src/documents/ that is not the app's own central route table (routes/*.mjs
// wiring up handler functions the same way it wires up every other domain's is the app's normal
// routing pattern, not a wall crossing — see this file's own header note below).
//
// ★★★ SCOPE. Measured, 29 Sep 2026: `grep -rl "from [\"']\.\./documents/" src/routes src/queue
//   src/automations` found 13 files. Seven of those (writes.mjs and the documentsX.mjs route
//   modules — documentsAi/documentsPublish/documentsPdfImport/documentsPublic/documentsClauses/
//   documentsRecords.mjs) ARE documents' own HTTP delivery layer, just filed under src/routes/ per
//   this project's one convention (every domain's routes live there, not under its own src/<domain>/
//   folder) — importing documents' handler functions directly is what every other domain's route
//   wiring already does, and singling documents out would be inconsistent, not walled-off. The
//   real crossings are the other six: OTHER DOMAINS' business logic reaching into documents'
//   internals directly — notes.mjs, app.mjs, index.mjs, settings.mjs, queue/tasks.mjs,
//   automations/engine.mjs. This file is their door. Pure re-export, zero logic changed — a
//   relocation of WHERE the import comes from, exactly D1's own posture (documents/api.mjs).
//
// ★★ documents/api.mjs (D1, 27 Sep) is a NARROWER, older door — specifically booking's own four
//   functions. This file is the general one the brief asks for; api.mjs is unchanged and still
//   correct for what it does.
// ★ ISLAND-PROGRAMS §2 plan (c) — Documents DECLARES what it contributes to the cross-cutting registries
//   (delete/archive/merge/shell/ownership/linkToken/sandbox/redact); those consumers import it from here.
//   ★ KEEP THIS LINE FIRST: three consumers (records/archive, permissions/ownership, auth/linkToken) sit in a
//   cycle with this file's own closure and read DOCUMENTS_DOMAIN at module top level — domain.mjs imports
//   nothing, so listing it first guarantees it is evaluated before anything that could loop back.
export { DOCUMENTS_DOMAIN } from "./domain.mjs";
export { notInDocustay, notOnHostedDocustay } from "./notInDocustay.mjs";   // Docustay v1: routes the hosted product no longer offers
export { noteAccess, listAccess, accessCsv } from "./accessLog.mjs";   // Run 7 part 6: the access log (always on)
export { listEmails, ratesFor as emailRates, guardState as emailGuardState } from "./emailLog.mjs";
export { referenceFilter, documentEventReference, saveTemplateReference, cleanReference } from "./reference.mjs";
export { shareNote } from "./noteShare.mjs";
// ★ DOCUSTAY WALL FIX (round 3) — db/gates/documents_wall.mjs's own SQL-clause check (added
//   separately from the import check, specifically because "booking was reading the document
//   tables directly") caught src/queue/recipientResolvers.mjs's "document" recipient lookup: a raw
//   `tx.query` on `keystone.document_instance`, no import at all. `instanceCreatedBy` (api.mjs) is
//   the door now; re-exported here since recipientResolvers.mjs is a general caller, not booking's
//   own four-function door (api.mjs's original, narrower scope — see this file's header).
export { documentAgingRelation, instanceCreatedBy, instanceNotificationFacts, instanceAnalyticsFacts, documentNoticeFacts, inboxFacts, declineFacts, personHasRecentDocument, peopleWithRecentDocuments } from "./api.mjs";
export { instrumentSnapshot } from "./preview.mjs";
// ★ Shared document engine (design §6): the worker runs a queued AI draft through this one function.
export { runAiJob, runAiJobDetached, rescueStaleAiJobs, createAiJob, getAiJob, cancelAiJob, readAiConfig } from "./engine/ai/jobs.mjs";
// AI cost and usage (AI-COST-AND-USAGE-SPEC): the bar's numbers, the platform's ceiling view, the test provider's guard
export { usageView as aiUsageView, platformStatus as aiPlatformStatus } from "./engine/ai/gateway.mjs";
export { platformSummary as aiPlatformSummary, platformEventsCsv as aiPlatformEventsCsv, levelsReached as aiLevelsReached } from "./engine/ai/platform.mjs";
export { pruneChatsForTenant } from "./chat/chat.mjs";
export { saveSourceTemplate } from "./engine/creation.mjs";
// B10 (7 Oct 2026): the v2 flow for an API key: people-first create, use a template, revise, send a draft, check, defaults, the wizard's questions
export { apiCreateDocument, apiUseTemplate, apiReviseDocument, apiSendDraft, apiDraftSource, apiCheckSource, apiTemplateDefaults, apiWizard } from "./pdfApiV2.mjs";
export { acceptDisclosure, recordSignature, executeIfComplete, createInstance, sendInstance, createDocumentCategory, createDocumentType, declineInstance, executeInstance, withdrawDisclosure } from "./writes.mjs";
export { sendDocument } from "./sendDocument.mjs";
export { ensureAgreementType, seedStarterTemplate } from "./starterTemplates.mjs";
export { createTemplate, newTemplateVersion, updateTemplateBody } from "./templates.mjs";
export { fetchArchivedPdf, archiveExecutedPdf } from "./archive.mjs";
export { staleUnarchivedDocuments, untimestampedSealedDocuments } from "./pdfArchive.mjs";
export { ersdTextFor } from "./disclosure.mjs";
export { SIGNER_CONFIGS, AUDIENCES, DIVISIONS, APPLIES_TO, ASSIGNMENT_TARGETS } from "./vocabulary.mjs";
// ★ DOCUSTAY WALL FIX (round 2) — db/gates/documents_wall.mjs's own first run found this crossing
//   too: src/settings/reach.mjs imported variableCatalogue.mjs directly, to name which practice
//   setting a template variable is bound to (a read-only lookup, no new coupling).
export { VARIABLES } from "./variableCatalogue.mjs";
// ★ DOCUSTAY WALL FIX (round 2) — document_lapsed/document_reminder_due relocated out of
//   src/time/due.mjs into their own domain file, same shape as money/reminders.mjs's own due-fact
//   exports; time/due.mjs imports them through here rather than reaching into documents/ directly.
export { DOCUMENT_LAPSED_FACT, DOCUMENT_REMINDER_DUE_FACT } from "./dueFacts.mjs";
export { sendCheckFor } from "./sendCheck.mjs";   // Run 9: the check before sending
// Run 9 Part 3.4 — the contract repository's key dates: read into the repository by the sweep, and the Pro renewal reminder

// QUEUE §23.3.6 — the retention guard and what a person's delete does to their documents (the shared Delete asks the island; it never names the tables).
export { documentDeleteBlockers } from "./retention.mjs";
export { prepareForPersonDelete as prepareDocumentsForPersonDelete, personDeleteDocumentPlan } from "./parties.mjs";

// QUEUE §23.3.4 — the organisation's sending identity: one function sends any email with it (the signed-copy email, notices); the rest serve the settings screen and the provider's delivery events.
export { alreadyEmailed as documentEmailAlreadySent } from "./emailLog.mjs";
export { sentenceCase } from "./settings.mjs";
export { removeDomain as removeEmailDomain } from "./emailIdentity.mjs";   // R13-D015: Settings → Domains and email, "Remove" on the sending domain
export { sendMail as sendDocumentMail, noteEmailDelivery, identityStatus as emailIdentityStatus, startDomain as startEmailDomain, verifyDomain as verifyEmailDomain, saveSmtpPassword, sendTestEmail, startMailbox as startEmailMailbox, removeMailbox as removeEmailMailbox } from "./emailIdentity.mjs";

// QUEUE §23.4 — uploaded documents: upload and read the pages, the draft (autosave, people, checks), send / track / remind / void, the recipient's side, and the pure shapes the browser shares.
export { acceptUpload, readFileBytes, filesOf, sniffUpload, ACCEPTED_FORMATS } from "./files.mjs";
export { getPdfDocument, savePdfDocument, deletePdfDraft, searchRecipients, savePdfTemplate, createPdfFromTemplate, sendAgainPdf } from "./pdfDocs.mjs";
export { sendPdfDocument, sendTestToSender, remindPdfParties, signNowLink, reassignParty, voidPdfDocument, trackPdfDocument, mintPartyLink, advanceSequence } from "./pdfSend.mjs";
export { openForParty, openAsTest, savePartyProgress, signAsParty, declineAsParty, delegateAsParty, PDF_CONSENT, PAYMENT_HOLD_LAPSED_FACT } from "./pdfSigning.mjs";
export { signingPolicy, signatureIdOf } from "./signingPolicy.mjs";
export { shareDownloadLink, mintDownloadLink, withSignedCopyLink, openDownload, sendDownloadCode, verifyDownloadCode, readDownload, DOWNLOAD_PURPOSE } from "./downloads.mjs";
export { richTemplateForm, createDraftFromRichTemplate } from "./richDrafts.mjs";
export { startUpload, uploadStatus, putPart, completeUpload, PART_BYTES } from "./uploads.mjs";

/** The public verify page's one read (QUEUE §23.5.1): facts about an executed uploaded document, only when the code in the QR matches. → object or null. */
export { evidencePackage, auditLogCsv } from "./evidence.mjs";
export { sendCodeForParty, verifyForParty, requestChangesAsParty, decideAsApprover, acknowledgeAsViewer, assistAsParty, uploadFileForField, readAttachmentForParty } from "./pdfSigning.mjs";
export { removeAttachment } from "./files.mjs";
export { createFromHtml, createTemplateFromSource } from "./templateSources.mjs";
export { TAG_TYPES } from "./textTags.mjs";
export { STARTERS, starter, starterFields } from "./starters/index.mjs";
export { createTemplateFromStarter, starterCatalogue } from "./starters/clone.mjs";
export { embedOriginsForParty, assertEmbedOrigin } from "./pdfSend.mjs";
export { listTeams, createTeam, renameTeam, deleteTeam, setTeamMembers, assignTeam, teamOf } from "./teams.mjs";
export { kioskTemplates, kioskStart } from "./pdfKiosk.mjs";
export { extendParty, remindDueParties, nextReminderAt } from "./pdfSend.mjs";
export { bulkSend, BULK_MAX_ROWS } from "./proDoors.mjs";
export { readSelfServe, selfServeOwner, startSelfServe } from "./pdfSelfServe.mjs";
export { startPayment, confirmPayment, refundPayment, recordCheckoutCompleted, recordSubscriptionEvent, recordDisputeEvent, recordPaymentFailed, refreshStripeFees, listWorkspacePayments, paidOnProThisMonth, sendReceiptsForSend, PAYMENT_RECEIPT_DUE_FACT, PAYMENT_FEE_DUE_FACT } from "./pdfPayments.mjs";
export { exportOrganization, personReport, erasePerson, documentsCreatedBy } from "./pdfData.mjs";
export { apiTestSign, apiListDocuments, apiGetDocument, apiTemplates, apiSendFromTemplate, setSendValues, DOCUMENT_STATES, apiVoid, apiSignedCopy, apiTemplate, apiRemind, apiEmbedSession, assertTestKeyMay } from "./pdfApi.mjs";
export { listPdfTemplates, getPdfTemplate, readTemplateFile, updatePdfTemplateMeta, newPdfTemplateVersion, diffPdfTemplates, clonePdfTemplate, approvePdfTemplate, rejectPdfTemplate, retirePdfTemplate } from "./pdfTemplates.mjs";

/** Uploaded documents whose scheduled send time has come (the worker's sweep has no viewer; policy `system_scheduled_read` lets it list exactly these). → [{id, created_by}] */
export async function dueScheduledDocuments(tx) {
  const { rows } = await tx.query(`SELECT id, created_by FROM keystone.document_instance WHERE builder = 'pdf' AND state = 'draft' AND scheduled_send_at IS NOT NULL AND scheduled_send_at <= now() AND package_lead_id IS NULL`);
  return rows;
}

export async function verifyFacts(tx, { tenantId, instanceId, code }) {
  // the narrow RLS policies (migration 0610) open exactly this one document, in this transaction only
  await tx.query(`SELECT set_config('keystone.verify_ref', $1, true)`, [String(instanceId)]);
  const { rows: [r] } = await tx.query(`SELECT keystone.document_verify_facts($1, $2, $3) AS facts`, [tenantId, instanceId, String(code ?? "")]);
  return r?.facts ?? null;
}
export { signingWords } from "./signingWords.mjs";

// Part 30 item 9 — the fourteen languages: the list, their names and directions, and the signing-email frame for the ten added ones (the host's email module reads them here, never from the island's files).
export { LANGUAGES, LANG_META, EMAIL as EMAIL_LANGUAGE_WORDS, languageLabel, isRtl } from "./languages.mjs";

// People (saved signers)
export { listContacts, getContact, addContact, updateContact, deleteContact, contactsCsv, personTimeline } from "./contacts.mjs";
export { searchWorkspace } from "./search.mjs";   // Run 9: ⌘K search

// Run 9 Part 4R — the template library: the built-in Document and Form templates, sending from one, customizing one, the seed job
export { listLibrary, getLibraryTemplate, libraryEntry, useBuiltin, customizeBuiltin, ensureBuiltin, seedLibrary, LIBRARY_VERSION, BUILTIN_READONLY } from "./library.mjs";
export { guidanceFor, guidanceForModel, templateGuidance } from "./starters/guidance.mjs";
// plays and playbooks (FINAL PUSH Stage 4): the host's developer API and its MCP/SDK reach them only here
export { listPlays, getPlay, savePlay, publishPlay, archivePlay, duplicatePlay, testPlaySource, listPlaybooks, savePlaybook, setPlaybookEnabled, archivePlaybook, enabledPackContents, setPlayOn } from "./plays/store.mjs";
export { BUILTIN_PACKS } from "./plays/packs.mjs";
export { startDraftFromTemplate, assertPlaysApi } from "./plays/draft.mjs";

export { currentKeyId, policyFor, policiesByKey, savePolicy as saveKeyPolicy, countAgainstLimit, requestSendApproval, listApprovals, decideApproval } from "./apiKeyPolicy.mjs";   // FP-G1

export { detectUpload } from "./detect/api.mjs";
export { createDetectJob, getDetectJob, cancelDetectJob, applyDetectJob, runDetectPage, stalePagesOf } from "./detect/aiFind.mjs";
export { findFieldsOnDraft } from "./detect/find.mjs";
export { splitPacket } from "./detect/split.mjs";

// Round 3 (W1-4..W1-6) — pure text safety for callers outside the island: a download name any script can travel in a header, and a typed name made safe. Pure re-export, no logic.
export { contentDisposition, cleanName } from "./textSafety.mjs";
export { proPart, needsAddon, addonReady, addonInstalled, addonVersion } from "./addon.mjs";   // Operation Live 5.1.4: the Pro add-on seam, for hosts that have their own Pro doors
