// src/routes/schemas/people.mjs — L1.5.people (RECONCILE de-code, 27 Sep 2026): body schemas for the
// people write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs).
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

export const PEOPLE_SCHEMAS = Object.freeze({
  // createPerson — src/people/writes.mjs:185
  "/api/people": z.object({
    email: z.string().nullish(),
    displayName: z.string().nullish(),
    firstName: z.string().nullish(),
    role: z.string().nullish(),
    staffRole: z.string().nullish(),
    firebaseUid: z.string().nullish(),
    invite: z.boolean().nullish(),
    isSample: z.boolean().nullish(),
    mobilePhone: z.string().nullish(),
    dateOfBirth: z.string().nullish(),
    source: z.string().nullish(),
    lifecycleStatus: z.string().nullish(),
    preferredName: z.string().nullish(),
    pronouns: z.string().nullish(),
    homePhone: z.string().nullish(),
    secondaryEmail: z.string().nullish(),
    preferredContactMethod: z.string().nullish(),
    doNotEmail: z.boolean().nullish(),
    doNotText: z.boolean().nullish(),
    doNotCall: z.boolean().nullish(),
    country: z.string().nullish(),
    addressLine1: z.string().nullish(),
    addressLine2: z.string().nullish(),
    city: z.string().nullish(),
    stateRegion: z.string().nullish(),
    postcode: z.string().nullish(),
    timezone: z.string().nullish(),
    tags: z.unknown().optional(),
    emergencyContactName: z.string().nullish(),
    emergencyContactRelationship: z.string().nullish(),
    emergencyContactPhone: z.string().nullish(),
    sobrietyDate: z.string().nullish(),
    recoveryProgramme: z.string().nullish(),
    sponsorName: z.string().nullish(),
    supportNetwork: z.string().nullish(),
    notes: z.string().nullish(),
    referredById: id.nullish(),
    referredByPartyId: id.nullish(),
  }),
  // checkDuplicatePerson — src/routes/writes.mjs:1130
  "/api/people/check-duplicate": z.object({
    displayName: z.string().nullish(),
    email: z.string().nullish(),
    mobilePhone: z.string().nullish(),
    excludePersonId: id.nullish(),
  }),
  // updatePerson — src/people/writes.mjs:484 (reads `input`); the four REFUSED_UPDATE_FIELDS (:482) are LISTED so the handler still sees and refuses them
  "/api/people/update": z.object({
    personId: id.nullish(),
    displayName: z.string().nullish(),
    email: z.string().nullish(),
    mobilePhone: z.string().nullish(),
    tags: z.unknown().optional(),
    referredById: id.nullish(),
    firebaseUid: z.unknown().optional(),
    staffRole: z.unknown().optional(),
    role: z.unknown().optional(),
    tenant: z.unknown().optional(),
  }),
  // setLifecycleStatus — src/people/writes.mjs:640
  "/api/people/stage": z.object({
    personId: id.nullish(),
    status: z.string().nullish(),
    reason: z.string().nullish(),
  }),
  // inviteWithRoleCheck — src/routes/writes.mjs:1143
  "/api/people/invite": z.object({
    email: z.string().nullish(),
    displayName: z.string().nullish(),
    // ★ [TY, RULED 2 Oct 2026] email and phone are both required for every person — see
    // inviteWithRoleCheck's own check, src/routes/writes.mjs.
    phone: z.string().nullish(),
    role: z.string().nullish(),
    staffRole: z.string().nullish(),
    childUserId: id.nullish(),
    personId: id.nullish(),
    message: z.string().nullish(),
  }),
  // cancelInvite — src/routes/writes.mjs:1218
  "/api/people/invite/cancel": z.object({
    inviteId: id.nullish(),
  }),
  // sendPortalLink — src/routes/writes.mjs — the maintainer, 29 Sep 2026
  "/api/people/portal-link": z.object({
    personId: id.nullish(),
  }),
  // setStaffRole — src/people/writes.mjs:753
  "/api/people/staff-role": z.object({
    personId: id.nullish(),
    staffRole: z.string().nullish(),
    requestId: id.nullish(),
  }),
  // linkGuardian — src/people/guardians.mjs:204
  "/api/people/guardian": z.object({
    childUserId: id.nullish(),
    guardianUserId: id.nullish(),
    relationship: z.string().nullish(),
  }),
  // unlinkGuardian — src/people/guardians.mjs:241
  "/api/people/guardian/remove": z.object({
    childUserId: id.nullish(),
    guardianUserId: id.nullish(),
  }),
  // setConsentStatus — src/people/writes.mjs:898
  "/api/people/consent-status": z.object({
    personId: id.nullish(),
    status: z.string().nullish(),
  }),
  // assignPerson — src/people/writes.mjs:957
  "/api/people/assign": z.object({
    personId: id.nullish(),
    ownerUserId: id.nullish(),
  }),
  // setLeadNextStep — src/people/writes.mjs:1014
  "/api/people/lead-next-step": z.object({
    personId: id.nullish(),
    nextStep: z.string().nullish(),
  }),
  // removeSamples — src/people/writes.mjs:1166
  "/api/people/samples/remove": z.object({}),
  // bulkArchivePeople — src/people/bulk.mjs:102
  "/api/people/bulk/archive": z.object({
    ids: z.array(id).nullish(),
    requestId: id.nullish(),
  }),
  // bulkAssignPeople — src/people/bulk.mjs:124
  "/api/people/bulk/assign": z.object({
    ids: z.array(id).nullish(),
    ownerUserId: id.nullish(),
  }),
  // bulkChangeStagePeople — src/people/bulk.mjs:134
  "/api/people/bulk/stage": z.object({
    ids: z.array(id).nullish(),
    status: z.string().nullish(),
    reason: z.string().nullish(),
  }),
  // exportPeople — src/people/bulk.mjs:157
  "/api/people/bulk/export": z.object({
    ids: z.array(id).nullish(),
    requestId: id.nullish(),
  }),
  // previewMerge — src/records/merge.mjs:164
  "/api/people/merge/preview": z.object({
    survivorId: id.nullish(),
    loserId: id.nullish(),
  }),
  // applyMerge — src/records/merge.mjs:338
  "/api/people/merge": z.object({
    survivorId: id.nullish(),
    loserId: id.nullish(),
    overrides: z.unknown().optional(),
  }),
  // undoMerge — src/records/merge.mjs:543
  "/api/people/merge/undo": z.object({
    survivorId: id.nullish(),
    loserId: id.nullish(),
  }),
  // dismissMergePair — src/records/merge.mjs:503
  "/api/people/merge/dismiss": z.object({
    personAId: id.nullish(),
    personBId: id.nullish(),
  }),
  // setLeadStage — src/people/writes.mjs:1059
  "/api/people/lead-stage": z.object({
    personId: id.nullish(),
    stage: z.string().nullish(),
  }),
});
