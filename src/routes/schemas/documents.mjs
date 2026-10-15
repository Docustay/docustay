// src/routes/schemas/documents.mjs — L1.5.documents (RECONCILE de-code, 27 Sep 2026): body schemas for the
// documents write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs, and the Stage 14 rows spread into it).
//
// ★ THE L1 RULE (specs/de-code/build/respec/L1-money.md): a schema is the handler's destructured parameter
//   list with a TYPE on each key, and NOTHING MORE. Every key is `.nullish()` (required-ness and value rules
//   stay in the handler — frozen test/c_required_fields asserts the handler's own 422s); unknown keys are
//   stripped (Zod's default) EXCEPT on a row whose handler takes `...rest` (z.looseObject — they pass
//   through, as today); `tenantId`, `actorUserId`, `principal` are never listed (the runner stamps them
//   after the parse); a key the handler only passes through, or wraps in String(), is
//   `z.unknown().optional()` — never a bare `z.unknown()`, which Zod 4 makes REQUIRED.
import { z } from "zod";

const id = z.guid();

export const DOCUMENT_SCHEMAS = Object.freeze({
  // createDocumentCategory — src/documents/writes.mjs:135
  "/api/documents/categories": z.object({
    key: z.string().nullish(),
    label: z.string().nullish(),
    sortOrder: z.number().nullish(),
  }),
  // createDocumentType — src/documents/writes.mjs:179
  "/api/documents/types": z.object({
    key: z.string().nullish(),
    label: z.string().nullish(),
    categoryId: id.nullish(),
    subCategory: z.string().nullish(),
    signerConfig: z.string().nullish(),
    audience: z.unknown().optional(),
    division: z.string().nullish(),
    appliesTo: z.unknown().optional(),
    defaultAssignedTo: z.unknown().optional(),
    isSessionNote: z.boolean().nullish(),
  }),
  // seedStarterTemplate — src/documents/starterTemplates.mjs:301
  "/api/documents/starters": z.object({
    key: z.string().nullish(),
  }),
  // createInstance — src/documents/writes.mjs:244
  "/api/documents/instances": z.object({
    builder: z.string().nullish(),
    title: z.string().nullish(),
    typeId: id.nullish(),
    templateId: id.nullish(),
    subjectUserId: id.nullish(),
    assignedTo: z.unknown().optional(),
  }),
  // sendDocument — src/documents/sendDocument.mjs:67 (reads args.instanceId/personId/template/sendMode/remind) → sendInstance (src/documents/writes.mjs:316, overrideBody)
  "/api/documents/send": z.object({
    instanceId: id.nullish(),
    personId: id.nullish(),
    template: z.string().nullish(),
    sendMode: z.string().nullish(),
    remind: z.boolean().nullish(),
    overrideBody: z.unknown().optional(),
    // ★ SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 — the Send wizard's own Details step: this
    //   ONE document's name/description/message, "filled in from the template, editable" (only
    //   read on the create-branch — {personId, template} — never on a re-send of an existing draft).
    title: z.string().nullish(),
    description: z.string().nullish(),
    message: z.string().nullish(),
    customValues: z.record(z.string(), z.string()).nullish(),   // QUEUE §23.3.3 — this send's custom.<key> merge values
  }),
  // recordSignature — src/documents/writes.mjs:539
  "/api/documents/sign": z.object({
    instanceId: id.nullish(),
    role: z.string().nullish(),
    signerName: z.string().nullish(),
    signerUid: z.unknown().optional(),
    signedLocalDate: z.string().nullish(),
    signerTimezone: z.string().nullish(),
    userAgent: z.string().nullish(),
    signerIp: z.string().nullish(),
    markSha256: z.string().nullish(),
    markImage: z.string().nullish(),
  }),
  // declineInstance — src/documents/writes.mjs:753
  "/api/documents/decline": z.object({
    instanceId: id.nullish(),
    role: z.string().nullish(),
    reason: z.string().nullish(),
  }),
  // executeInstance — src/documents/writes.mjs:809
  "/api/documents/execute": z.object({
    instanceId: id.nullish(),
    priceRef: z.string().nullish(),
    terms: z.string().nullish(),
  }),
  // inline → createTemplate — src/documents/templates.mjs:67 (the route forces builder:"contract")
  "/api/documents/contracts/templates": z.object({
    name: z.string().nullish(),
    body: z.unknown().optional(),
    sellsType: z.string().nullish(),
    sellsId: id.nullish(),
    // ★ SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 (migration 0539) — see templates.mjs's own
    //   createTemplate for what each means: description is internal, clientDescription/message are
    //   the defaults a sent document starts with.
    description: z.string().nullish(),
    clientDescription: z.string().nullish(),
    message: z.string().nullish(),
  }),
  // inline → createTemplate — src/documents/templates.mjs:67 (the route forces builder:"form")
  "/api/documents/forms/templates": z.object({
    name: z.string().nullish(),
    body: z.unknown().optional(),
    sellsType: z.string().nullish(),
    sellsId: id.nullish(),
    description: z.string().nullish(),
    clientDescription: z.string().nullish(),
    message: z.string().nullish(),
  }),
  // newTemplateVersion — src/documents/templates.mjs:122
  "/api/documents/templates/version": z.object({
    templateId: id.nullish(),
    body: z.unknown().optional(),
    name: z.string().nullish(),
    sellsType: z.string().nullish(),
    sellsId: id.nullish(),
    description: z.string().nullish(),
    clientDescription: z.string().nullish(),
    message: z.string().nullish(),
  }),
  // updateTemplateBody — src/documents/templates.mjs:232
  "/api/documents/templates/body": z.object({
    templateId: id.nullish(),
    body: z.unknown().optional(),
  }),
  // acceptDisclosure — src/documents/writes.mjs:1108
  "/api/documents/disclosure/accept": z.object({
    appUserId: id.nullish(),
    version: z.string().nullish(),
    textShown: z.unknown().optional(),
    userAgent: z.string().nullish(),
    acceptedIp: z.string().nullish(),
  }),
  // withdrawDisclosure — src/documents/writes.mjs:1166
  "/api/documents/disclosure/withdraw": z.object({
    appUserId: id.nullish(),
    version: z.string().nullish(),
  }),
  // createClause — src/documents/clauses.mjs:176
  "/api/documents/clauses": z.object({
    name: z.string().nullish(),
    gist: z.string().nullish(),
    blocks: z.unknown().optional(),
    kind: z.string().nullish(),
  }),
  // updateClause — src/documents/clauses.mjs:219
  "/api/documents/clauses/update": z.object({
    id: id.nullish(),
    name: z.string().nullish(),
    gist: z.string().nullish(),
    kind: z.string().nullish(),
    blocks: z.unknown().optional(),
  }),
  // insertClause — src/documents/clauses.mjs:293
  "/api/documents/clauses/insert": z.object({
    templateId: id.nullish(),
    clauseId: id.nullish(),
    position: z.number().nullish(),
    owner: z.string().nullish(),
    requiresSignature: z.boolean().nullish(),
  }),
  // setTemplateSettings — src/documents/publish.mjs:232
  "/api/documents/templates/settings": z.object({
    templateId: id.nullish(),
    requiresParentUnder18: z.boolean().nullish(),
    reSignMonths: z.number().nullish(),
    createsSubscriptionPlanId: id.nullish(),
    teenTemplateId: id.nullish(),
    typeId: id.nullish(),
    draft: z.boolean().nullish(),
    material: z.boolean().nullish(),
    description: z.string().nullish(),
    clientDescription: z.string().nullish(),
    message: z.string().nullish(),
    signedCopy: z.record(z.string(), z.unknown()).nullish(),   // QUEUE §23.2.8 — per-template signed-copy override; null clears
    labels: z.array(z.string()).nullish(),
  }),
  // publishTemplate — src/documents/publish.mjs:347
  // setDocumentSetting — src/documents/settings.mjs (QUEUE §23.2.2): one key per call; null resets it to its default
  "/api/documents/settings": z.object({
    key: z.string().nullish(),          // nothing is required here (the L1 rule: an empty body parses); the handler refuses a missing key by name
    value: z.unknown().optional(),
  }),
  // QUEUE §23.3.4 — email sending (every key nullish: an empty body parses; the handler names what is missing)
  "/api/documents/email/domain": z.object({ domain: z.string().nullish() }),
  "/api/documents/email/domain/verify": z.object({}),
  "/api/documents/email/smtp-password": z.object({ password: z.string().nullish() }),
  "/api/documents/email/test": z.object({ to: z.string().nullish() }),
  "/api/documents/templates/publish": z.object({
    templateId: id.nullish(),
    askEveryoneToResign: z.boolean().nullish(),
  }),
  // aiDraft — src/documents/ai.mjs:247
  "/api/documents/ai/draft": z.object({
    prompt: z.string().nullish(),
    templateId: id.nullish(),
  }),
  // aiCheck — src/documents/ai.mjs:289
  "/api/documents/ai/check": z.object({
    templateId: id.nullish(),
  }),
  // recordImport — src/documents/pdfImport.mjs:117
  "/api/documents/pdf-imports": z.object({
    fileName: z.string().nullish(),
    pageCount: z.number().nullish(),
    textSha256: z.string().nullish(),
    detectedFields: z.unknown().optional(),
    s3Key: z.string().nullish(),
  }),
  // confirmImport — src/documents/pdfImport.mjs:224
  "/api/documents/pdf-imports/confirm": z.object({
    importId: id.nullish(),
    confirmedFields: z.unknown().optional(),
    paragraphs: z.unknown().optional(),
  }),
  // createUploadTicket — src/routes/uploads.mjs:63
  "/api/uploads/ticket": z.object({
    kind: z.string().nullish(),
    contentType: z.string().nullish(),
    bytes: z.number().nullish(),
  }),
});
