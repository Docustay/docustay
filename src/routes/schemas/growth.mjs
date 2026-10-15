// src/routes/schemas/growth.mjs — L1.5.growth (RECONCILE de-code, 27 Sep 2026): body schemas for the
// growth write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs).
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

export const GROWTH_SCHEMAS = Object.freeze({
  // createSegment — src/growth/campaigns.mjs:219
  "/api/growth/segments": z.object({
    name: z.unknown().optional(),
    filter: z.unknown().optional(),
    createdBy: z.string().nullish(),
  }),
  // saveCampaign — src/growth/campaigns.mjs:474 → createCampaign (:254) or updateCampaign (:437); both handlers' keys
  "/api/growth/campaigns": z.object({
    campaignId: id.nullish(),
    name: z.unknown().optional(),
    segmentId: id.nullish(),
    subject: z.unknown().optional(),
    body: z.unknown().optional(),
    channel: z.string().nullish(),
    leaveOutSegmentId: id.nullish(),
    neverMoreThanDays: z.number().nullish(),
    templateKey: z.string().nullish(),
  }),
  // sendCampaign — src/growth/campaigns.mjs:601
  "/api/growth/campaigns/send": z.object({
    campaignId: id.nullish(),
  }),
  // scheduleCampaign — src/growth/campaigns.mjs:670
  "/api/growth/campaigns/schedule": z.object({
    campaignId: id.nullish(),
    sendAt: z.string().nullish(),
  }),
  // testCampaign — src/growth/campaigns.mjs:698
  "/api/growth/campaigns/test": z.object({
    campaignId: id.nullish(),
  }),
  // updateCampaign — src/growth/campaigns.mjs:436
  "/api/growth/campaigns/update": z.object({
    campaignId: id.nullish(),
    name: z.unknown().optional(),
    segmentId: id.nullish(),
    subject: z.unknown().optional(),
    body: z.unknown().optional(),
    leaveOutSegmentId: id.nullish(),
    neverMoreThanDays: z.number().nullish(),
    templateKey: z.string().nullish(),
  }),
  // createCampaignGroup — src/growth/campaignGroups.mjs:31
  "/api/growth/campaign-groups": z.object({
    name: z.string().nullish(),
    status: z.string().nullish(),
    goal: z.string().nullish(),
    startsOn: z.string().nullish(),
    endsOn: z.string().nullish(),
  }),
  // updateCampaignGroup — src/growth/campaignGroups.mjs:94
  "/api/growth/campaign-groups/update": z.object({
    groupId: id.nullish(),
    name: z.string().nullish(),
    status: z.string().nullish(),
    goal: z.string().nullish(),
    startsOn: z.string().nullish(),
    endsOn: z.string().nullish(),
  }),
  // deleteCampaignGroup — src/growth/campaignGroups.mjs:168
  "/api/growth/campaign-groups/delete": z.object({
    groupId: id.nullish(),
  }),
  // attachToCampaignGroup — src/growth/campaignGroups.mjs:199
  "/api/growth/campaign-groups/attach": z.object({
    groupId: id.nullish(),
    kind: z.string().nullish(),
    id: id.nullish(),
  }),
  // detachFromCampaignGroup — src/growth/campaignGroups.mjs:275
  "/api/growth/campaign-groups/detach": z.object({
    groupId: id.nullish(),
    kind: z.string().nullish(),
    id: id.nullish(),
  }),
  // pauseCampaignGroup — src/growth/campaignGroups.mjs:324
  "/api/growth/campaign-groups/:id/pause": z.object({
    id: id.nullish(),
    groupId: id.nullish(),
  }),
  // createLandingPage — src/growth/landingPages.mjs:20
  "/api/growth/pages": z.object({
    slug: z.string().nullish(),
    title: z.string().nullish(),
    body: z.unknown().optional(),
    purpose: z.string().nullish(),
    ctaType: z.string().nullish(),
    bookingServiceId: id.nullish(),
    endedAt: z.string().nullish(),
  }),
  // updateLandingPage — src/growth/landingPages.mjs:100
  "/api/growth/pages/update": z.object({
    landingPageId: id.nullish(),
    slug: z.string().nullish(),
    title: z.string().nullish(),
    body: z.unknown().optional(),
    purpose: z.string().nullish(),
    ctaType: z.string().nullish(),
    bookingServiceId: id.nullish(),
    endedAt: z.string().nullish(),
  }),
  // deleteLandingPage — src/growth/landingPages.mjs:193
  "/api/growth/pages/delete": z.object({
    landingPageId: id.nullish(),
  }),
  // draftLandingPageCopy — src/growth/landingPages.mjs:239
  "/api/growth/pages/draft": z.object({
    landingPageId: id.nullish(),
    prompt: z.string().nullish(),
    responseText: z.string().nullish(),
    requestedById: id.nullish(),
  }),
  // publishLandingPage — src/growth/landingPages.mjs:312
  "/api/growth/pages/publish": z.object({
    landingPageId: id.nullish(),
    aiRequestId: id.nullish(),
  }),
});
