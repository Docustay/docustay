// Stage 14 task 14.41 — ROUTE AGGREGATOR: THE WIRE FOR EVERY MODULE, ROUTE AND SCREEN STAGE 14 BUILT.
//
// ★★★ THIS IS THE MOST IMPORTANT TASK OF THE STAGE. Everything built tonight — every module, route
//     and screen — is unreachable until this lands (CLAUDE.md failure #1, "BUILT AND WIRED TO
//     NOTHING", measured four times on this project). `src/routes/writes.mjs` spreads
//     `STAGE14_WRITES` (below) as the LAST element of its `ROUTES` array, and `src/http/app.mjs`
//     calls `registerItemsAndDocumentsRoutes` (below) once, after `registerTaskRoutes`.
//
// ★★★ NO CYCLE. This module imports ONLY the route files this stage built — NEVER `writes.mjs`. The
//     direction is `writes.mjs → itemsAndDocuments.mjs → route files → domain modules`.
//
// ★★★ THE CHAIN DECLARATION IS THE POINT: PRACTICE AND SIGNER, NEVER PLATFORM. `runTenantScoped`
//     (`src/http/app.mjs:737`, M — plan named `:658`, drifted) for every items/documents/notes
//     route; `runSignerScoped` (`src/http/app.mjs:1115`, M — plan named `:1029-1048`, drifted) for
//     14.34's three public signing routes ONLY, via `registerPublicDocumentRoutes`. Neither function
//     is redefined here — both are passed through from the caller (`app.mjs`, where they are
//     module-local), exactly as `registerTaskRoutes(app, { runTenantScoped, tenantIsPlatform })`
//     already does for its own chain.
//
// ★★★ R-14.2, THE ONE EXCLUSION — READ TWICE. `PUBLISH_WRITES` (`documentsPublish.mjs`, task 14.36)
//     contains the starter-templates row, `POST /api/documents/starters` (`fn: seedStarterTemplate`).
//     R-14.2 rules "built here, NOT seeded until the maintainer reads it" — once mounted, anyone holding
//     `template.author` (Owner, Admin, or a coach granted it) could seed starter agreement text into
//     a live practice, and the maintainer has not yet read the words those templates put in front of a client to
//     sign. Every OTHER `PUBLISH_WRITES` row is spread in; the starters row is filtered out below BY
//     PATH, explicitly and visibly — not quietly rebuilt by hand in a way that hides what was
//     dropped. Re-enable it in one line the moment the maintainer rules: replace
//     `PUBLISH_WRITES_WITHOUT_STARTERS` below with `...PUBLISH_WRITES` directly.
//
// ★ `UPLOAD_WRITES` (`src/routes/uploads.mjs`, task 14.77, verified present) POST-DATES this task's
//   field-4 write-up, which predates it. Included in the spread below: `POST /api/uploads/ticket` is
//   the presigned-PUT door 14.68's PDF import depends on to answer at all — leaving it out would be
//   the exact "built and wired to nothing" failure this task exists to close, for a route this
//   stage's own PDF-import journey cannot work without. Said here rather than added or dropped
//   silently.

import {
  CATALOGUE_WRITES, registerCatalogueReads,
} from "./itemsCatalogue.mjs";
import {
  MODIFIER_WRITES, registerModifierReads,
} from "./itemsModifiers.mjs";
import {
  OPTION_WRITES, registerOptionReads,
} from "./itemsOptions.mjs";
import {
  IMAGE_WRITES, registerImageReads,
} from "./itemsImages.mjs";
import {
  EDITOR_WRITES, registerEditorReads,
} from "./itemsEditors.mjs";
import {
  LOYALTY_WRITES, registerLoyaltyReads,
} from "./itemsLoyalty.mjs";
import {
  GIFT_CARD_WRITES, registerGiftCardReads,
} from "./itemsGiftCards.mjs";
import {
  CLAUSE_WRITES, registerClauseReads,
} from "./documentsClauses.mjs";
import {
  PUBLISH_WRITES, registerPublishReads,
} from "./documentsPublish.mjs";
import { registerPreviewReads } from "./documentsPreview.mjs";
import { DOCUMENT_SETTINGS_WRITES, registerDocumentSettingsReads } from "./documentsSettings.mjs";
import { CUSTOM_DOMAIN_WRITES, registerCustomDomainReads } from "./customDomains.mjs";
import { MAIL_SETTINGS_WRITES, registerMailSettingsReads } from "./mailSettings.mjs";
import { DOCUSTAY_WRITES, registerDocustayReads } from "./docustay.mjs";
import { DOCUMENT_PDF_WRITES, registerDocumentPdfRoutes } from "./documentsPdf.mjs";
import { registerSelfServeRoutes } from "./publicSelfServe.mjs";
import { FORMS_WRITES, registerFormReads } from "./documentsForms.mjs";
import { registerPublicFormRoutes } from "./publicForms.mjs";
import { PLAYS_WRITES, registerPlayReads } from "./documentsPlays.mjs";
import { EMAIL_WRITES, registerEmailReads } from "./documentsEmail.mjs";
import { APPROVAL_WRITES, registerApprovalReads } from "./documentsApprovals.mjs";
import { registerAgentActivity } from "./developerActivity.mjs";
import { registerRealtime } from "./realtime.mjs";
import { registerConnectorPublic, registerConnectorSession } from "./developerConnector.mjs";
import { registerBuilderPublic } from "./developerBuilder.mjs";
import { registerPublicDocustayRoutes } from "./publicDocustay.mjs";
import { AI_WRITES } from "./documentsAi.mjs";
import { ENGINE_WRITES, registerEngineReads } from "./documentsEngine.mjs";
import { registerChatRoutes } from "./documentsChat.mjs";
import { PDF_IMPORT_WRITES } from "./documentsPdfImport.mjs";
import { UPLOAD_WRITES } from "./uploads.mjs";
import { registerDocumentRecordReads } from "./documentsRecords.mjs";
import { registerPublicDocumentRoutes } from "./documentsPublic.mjs";
import { registerNoteRoutes } from "./notes.mjs";

// ★★★ R-14.2 — see header. Filtered by path, explicitly and visibly: every other `PUBLISH_WRITES`
//     row (settings, publish) is kept; the starter-templates row (`fn: seedStarterTemplate`) is
//     dropped until the maintainer rules on the words those templates put in front of a client to sign.
const STARTERS_PATH = "/api/documents/starters";
const PUBLISH_WRITES_WITHOUT_STARTERS = Object.freeze(
  PUBLISH_WRITES.filter((row) => row.path !== STARTERS_PATH),
);

/**
 * ★★★ EVERY STAGE 14 WRITE ROW, ONE TABLE. Spread as the LAST element of `writes.mjs`'s `ROUTES`
 *     array by task 14.41's one line there. `assertVerbRoutesDeclareASubject` (`writes.mjs`) runs
 *     over the COMBINED `ROUTES` at import time — a malformed row here throws at import, named.
 */
export const STAGE14_WRITES = Object.freeze([
  ...CATALOGUE_WRITES,
  ...MODIFIER_WRITES,
  ...OPTION_WRITES,
  ...IMAGE_WRITES,
  ...EDITOR_WRITES,
  ...LOYALTY_WRITES,
  ...GIFT_CARD_WRITES,
  ...CLAUSE_WRITES,
  ...DOCUMENT_SETTINGS_WRITES,
  ...CUSTOM_DOMAIN_WRITES,
  ...MAIL_SETTINGS_WRITES,
  ...DOCUSTAY_WRITES,
  ...DOCUMENT_PDF_WRITES,
  ...FORMS_WRITES,
  ...PLAYS_WRITES,
  ...EMAIL_WRITES,
  ...APPROVAL_WRITES,
  ...PUBLISH_WRITES_WITHOUT_STARTERS, // R-14.2 — starters row deliberately absent, see header.
  ...AI_WRITES,
  ...ENGINE_WRITES,
  ...PDF_IMPORT_WRITES,
  ...UPLOAD_WRITES,
]);

/**
 * ★★★ THE ONE MOUNT CALL. `app.mjs` calls this once, after `registerTaskRoutes(app,
 *     { runTenantScoped, tenantIsPlatform })`, passing its own module-local `runTenantScoped` and
 *     `runSignerScoped` through — neither is redefined here.
 * @param {import("hono").Hono} app
 * @param {{ runTenantScoped: Function, runSignerScoped: Function, tenantIsPlatform: Function }} chains
 */
export function registerItemsAndDocumentsRoutes(app, { runTenantScoped, runSignerScoped, tenantIsPlatform }) {
  registerCatalogueReads(app, { runTenantScoped, tenantIsPlatform });
  registerModifierReads(app, { runTenantScoped, tenantIsPlatform });
  registerOptionReads(app, { runTenantScoped, tenantIsPlatform });
  registerImageReads(app, { runTenantScoped, tenantIsPlatform });
  registerEditorReads(app, { runTenantScoped, tenantIsPlatform });
  registerLoyaltyReads(app, { runTenantScoped, tenantIsPlatform });
  registerGiftCardReads(app, { runTenantScoped, tenantIsPlatform });
  registerClauseReads(app, { runTenantScoped, tenantIsPlatform });
  registerPublishReads(app, { runTenantScoped, tenantIsPlatform });
  registerPreviewReads(app, { runTenantScoped, tenantIsPlatform });
  registerEngineReads(app, { runTenantScoped, tenantIsPlatform });
  registerChatRoutes(app, { runTenantScoped, tenantIsPlatform });
  registerDocumentSettingsReads(app, { runTenantScoped, tenantIsPlatform });
  registerCustomDomainReads(app, { runTenantScoped, tenantIsPlatform });
  registerMailSettingsReads(app, { runTenantScoped, tenantIsPlatform });
  registerDocustayReads(app, { runTenantScoped, tenantIsPlatform });
  registerDocumentRecordReads(app, { runTenantScoped, tenantIsPlatform });
  registerNoteRoutes(app, { runTenantScoped, tenantIsPlatform });
  // ★★★ SIGNER, NEVER PRACTICE — 14.34's three public signing routes. `runSignerScoped` opens with a
  //     real signer identity (link token), not a staff session; routing these through
  //     `runTenantScoped` instead would quietly undo that.
  registerPublicDocumentRoutes(app, { runSignerScoped });
  registerDocumentPdfRoutes(app, { runTenantScoped, runSignerScoped, tenantIsPlatform });
  registerSelfServeRoutes(app);
  registerFormReads(app, { runTenantScoped, tenantIsPlatform });
  registerPlayReads(app, { runTenantScoped, tenantIsPlatform });
  registerEmailReads(app, { runTenantScoped, tenantIsPlatform });
  registerApprovalReads(app, { runTenantScoped, tenantIsPlatform });
  registerAgentActivity(app, { runTenantScoped, tenantIsPlatform });
  registerRealtime(app, { runTenantScoped });
  registerConnectorPublic(app);
  registerConnectorSession(app, { runTenantScoped, tenantIsPlatform });
  registerBuilderPublic(app);
  registerPublicFormRoutes(app);
  registerPublicDocustayRoutes(app);
}
