// P15B.13 — THE MUTATING ROUTES. Every one goes through `runTenantScoped`, so every one inherits the
//           whole D1.1 chain: auth → tenant from the GUC → rate limit → **Idempotency-Key required and
//           the stored response replayed** → savepoint → error mapping.
//
// ═════════════════════════════════════════════════════════════════════════════
// ★★★ WHY THIS FILE EXISTS, MEASURED FIRST
// ═════════════════════════════════════════════════════════════════════════════
// P15B.13 says "EVERY mutating route requires an Idempotency-Key header … stored response replayed",
// and its red-first is "issue the same mutating request TWICE AS TWO SEPARATE HTTP REQUESTS."
//   ★★ [MEASURED 2026-09-13] before this file there was **exactly ONE mutating route in the whole
//      application** — `POST /api/signup` — and it deliberately does not use `withIdempotency` because
//      no tenant exists yet to scope the key to. So P15B.4–.12 had built ten write MODULES that **no
//      HTTP request could reach**, and P15B.13's claim had nothing real to bind to: it would have been
//      a statement about zero routes, which is true and worthless.
//   ★ P15B.15's end-to-end also requires them ("create a person → create a service → price it → send a
//     document → execute it → a subscription appears → set availability → take a booking → an invoice
//     exists"), and that journey is unreachable from a browser without these.
//
// ★★★ NOTHING HERE OPENS A TRANSACTION, TAKES A tenantId FROM THE CALLER, OR VALIDATES MONEY. The write
//     modules do all of that — these are the wire, and a route that re-implemented a rule would be a
//     second place for it to drift. Each handler: authorise the section, hand the body over, return.

// ★ Task 12.14 adds `conflict` — the seat-cap refusal (409), same kind `src/people/offboard.mjs`
//   already uses for "the only Owner" (that file's own header note on the missing 422 kind).
import { invalid, forbidden, outOfScope, notFound, conflict, AppError, ErrorKind } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { runWithScope } from "../money/idempotencyScope.mjs";
// ★★★ 7.12a / Q7-21 — THE REPLACEMENT FOR `assertRank`. `assertMay` asks the grant 7.1/7.9 declared;
//     `NAMED_ACTIONS` is the closed vocabulary that tells this file's `catch` below whether a
//     refusal is a CAPABILITY question (stays `forbidden`) or a VERB question over a specific row
//     (becomes `outOfScope`/`not_found` — 05 §2b.5). `src/permissions/assertMay.mjs` is 7.12b's file,
//     imported here, not edited here.
// ★★★ F690 — `subjectIdFor` is the ONE place that decides which body field names the row a write is
//     about. Imported here so the `outOfScope`-vs-`forbidden` decision below and `assertMay`'s own
//     owner lookup read the SAME id; a second copy of that expression is how the two would drift.
import { assertMay, subjectIdFor, NAMED_ACTIONS } from "../permissions/assertMay.mjs";
// ★★★ 7.12a / Q7-5 — THE OPERATOR-GRANT CHECK FOR `platform: true` ROUTES. `src/db/index.mjs` is
//     7.6/7.12b's file; this is an import, not a redefinition — a second copy of "is this caller the
//     operator" is exactly the drift F594 found and closed.
import { callerIsPlatform } from "../db/index.mjs";
// ★★★ Q7-2 — THE SIGNER PATH. `src/auth/linkToken.mjs` is Stage 5's file; imported here, not edited.
import { redeemLinkToken } from "../auth/linkToken.mjs";
// ★★★ TASK 8.12 / F626 gap 2 — the invite row's WRAPPER needs 8.6's row-and-token writer, 8.10's
//     sign-in-only sender, and the deployment's own domain (the SAME read `src/auth/login.mjs:29`
//     and `src/routes/settings.mjs:117` already use) to compose the accept link. None of the three
//     is edited here — imports only.
import { createInvite, resendInvite, revokeInvite } from "../auth/invite.mjs";
import { sendAuthEmail } from "../email/authEmail.mjs";
import { sendClientInviteEmail, sendClientPortalLinkEmail } from "../email/clientInviteEmail.mjs";
import { APP_DOMAIN_VAR } from "../auth/tenantFromHost.mjs";
// ★ Task 12.14 — ONE function for seat usage (src/people/seats.mjs), so `inviteWithRoleCheck`'s
//   cap check below and `GET /api/people/team/seats` (src/routes/index.mjs) can never disagree.
import { teamSeatUsage } from "../people/seats.mjs";
import { assertEntitled } from "../product/docustay.mjs";

import { createPerson, updatePerson, inviteTeamMember, setStaffRole, setLifecycleStatus,
         setConsentStatus, assignPerson, setLeadNextStep, setLeadStage, readLeadBoard, removeSamples, findPossibleDuplicate, phoneRequiredFor } from "../people/writes.mjs";
// ★★★ TOUCH-UP GROUP A, WORKSTREAM 4.2/4.3 — the list workspace's bulk actions. `src/people/bulk.mjs`
//     is this task's own new file; imported here, not redefined — same pattern as every other write
//     module this table already wires.
import { bulkArchivePeople, bulkAssignPeople, bulkChangeStagePeople, exportPeople } from "../people/bulk.mjs";
// ★★★ TASK 8.13 — `linkGuardian`/`unlinkGuardian` are the wrapper this task adds beside
//     `addGuardian`/`removeGuardian` (untouched); imported here, not redefined — CT-060.
import { linkGuardian, unlinkGuardian } from "../people/guardians.mjs";
import { completeTask, reassignTask } from "../tasks/writes.mjs";
import { createAccount, updateAccount, createAccountPipeline, advanceStage } from "../accounts/writes.mjs";
import { createNetworkParty, updateNetworkParty } from "../network/writes.mjs";
import {
  createService, createPackage, createPlan, createPrice, setContractedPrice,
  // ★★★ TASK 2.4 — additive: 2.2/2.3's own imports above/beside this are unchanged.
  createDiscount, setDiscountActive, addPromotionCode, deactivatePromotionCode, attachAgreementRequirement, detachAgreementRequirement,
  // ★★★ TASK 2.5 — additive: `setItemActive` is the "Stop selling"/"Sell again" write, the one
  //     named in §1 point 3 as having FIVE item routes and not one that ever set `active`.
  setItemActive,
} from "../items/writes.mjs";
import {
  createDocumentCategory, createDocumentType, createInstance,
  recordSignature, declineInstance, executeInstance, acceptDisclosure, withdrawDisclosure,
} from "../documents/frontDoor.mjs";
// ★ TASK 14.31 — the one send path for both an existing draft (`{instanceId}`) and create-and-send
//   (`{personId, template}`). `sendInstance` itself moved out of this file's import list: nothing else
//   here calls it directly any more (the ROUTES row below now points at `sendDocument`, which calls
//   `sendInstance` internally, `src/documents/sendDocument.mjs`).
import { sendDocument } from "../documents/frontDoor.mjs";
import { ensureAgreementType, seedStarterTemplate } from "../documents/frontDoor.mjs";
// ★ P15C.4/.5/.8 — the two builders' write path. A separate module from `documents/writes.mjs`
//   because a TEMPLATE and an INSTANCE are different objects with different laws: a template is
//   versioned and never edited after it is sent against; an instance moves through states.
import { createTemplate, newTemplateVersion, updateTemplateBody } from "../documents/frontDoor.mjs";
import { setTemplateType } from "../documents/api.mjs";
import {
  createAvailabilityRule, endAvailabilityRule, upsertDateOverride,
  setBookingPolicy, addBookingParticipant, setAttendance,
  // ★ 13.16's flag write, added with its ROUTES entry below once 13.16 landed — see the comment
  //   on `/api/engagements/bookings/flag` for why 13.27a could not add either half itself.
  setBookingFlag,
} from "../booking/writes.mjs";
// ★ 13.27a — 13.12/13.14's waitlist module, wired here for the first time (until this lands, F05
//   §2.4's waitlist is built and wired to nothing).
import { addToWaitlist, removeFromWaitlist, offerTime } from "../booking/waitlist.mjs";
// ★ 13.27a — 13.17's calendar-block module, wired here for the first time.
import { createBlock, stopBlock, skipBlockDay } from "../booking/blocks.mjs";
// ★ 13.27a — 13.22's weekly-hours module, wired here for the first time.
import { setWeekHours } from "../booking/hours.mjs";
import { createBooking } from "../booking/createBooking.mjs";
import { createRecurringBookings, cancelRecurringSeries } from "../booking/createRecurringBookings.mjs";
import { settleBooking } from "../booking/settleBooking.mjs";
import { rescheduleBooking, cancelBookingByRequest } from "../booking/reschedule.mjs";
import { archiveRecord, restoreRecord } from "../records/archive.mjs";
import { deleteRecord } from "../records/delete.mjs";
import { bulkRecords } from "../records/bulk.mjs";
import { previewMerge, applyMerge, undoMerge, dismissMergePair } from "../records/merge.mjs";
import { setCustomFieldValue } from "../fields/custom.mjs";
import { pauseScheduleItems, resumeScheduleItems } from "../run/schedule.mjs";
import {
  createInvoice, createLineItem, updateLineItem, voidLineItem, createPaymentMethod,
  createEntitlement,
} from "../money/writes.mjs";
import {
  updateInvoiceDraft, setLinePositions, recomputeDraftTotals, voidInvoice,
} from "../money/invoices.mjs";
import { createFinancialConnectionsSession } from "../money/financialConnections.mjs";
import { sendInvoice } from "../money/invoiceSend.mjs";
import { toggleInvoiceReminders } from "../money/reminders.mjs";
import { recordManualPayment } from "../money/payments.mjs";
import { requestRefund, approveRefundRequest, declineRefundRequest, cancelRefund } from "../money/refunds.mjs";
// ★ P3.S11 — approve a held payment (Radar review).
import { approveFraudReview } from "../money/fraud.mjs";
import { issueCreditNote, voidCreditNote } from "../money/creditNotes.mjs";
import {
  createEstimate, updateEstimateDraft, sendEstimate, cancelEstimate,
} from "../money/estimates.mjs";
import {
  startClientSubscription, pushSubscriptionToStripe, cancelClientSubscription,
  pauseClientSubscription, resumeClientSubscription, removeSubscriptionDiscount,
} from "../money/subscriptions.mjs";
import { requestCardUpdate, detachPaymentMethod } from "../money/cardUpdate.mjs";
import { offerPaymentPlan, agreePaymentPlan, cancelPaymentPlan } from "../money/paymentPlans.mjs";
import { createPaymentLink, deactivatePaymentLink } from "../money/paymentLinks.mjs";
import { createTerminalIntent, processPaymentIntent, cancelAction, setReaderDisplay, refundPayment } from "../money/terminal.mjs";
import { activateTapToPay, createConnectionToken, createTapIntent } from "../money/tapToPay.mjs";
import { registerReader, deactivateDevice, renameDevice } from "../money/devices.mjs";
import { createComponentSession } from "../money/stripeComponents.mjs";
import { stageDisputeEvidence, acceptDispute, closeDispute } from "../money/disputes.mjs";
import { markPaidInvoice, markUncollectibleInvoice, duplicateInvoice, attachPaymentToInvoice, deleteDraftInvoice } from "../money/invoiceActions.mjs";
// ★ L1.0 — body schemas for the invoice rows (src/money/schemas/invoices.mjs), attached to each row below.
import { INVOICE_SCHEMAS } from "../money/schemas/invoices.mjs";
import { DOCUMENT_SCHEMAS } from "./schemas/documents.mjs";
import { ITEM_SCHEMAS } from "./schemas/items.mjs";
// ★ L1.5.stage14 — the Stage 14 rows' schemas, by path (the rows live in 12 route files that are not edited).
const STAGE14_SCHEMAS = Object.freeze({ ...ITEM_SCHEMAS, ...DOCUMENT_SCHEMAS });
import { PLATFORM_SCHEMAS } from "./schemas/platform.mjs";
import { SETTINGS_SCHEMAS } from "./schemas/settings.mjs";
import { ENGAGEMENT_SCHEMAS } from "./schemas/engagements.mjs";
import { GROWTH_SCHEMAS } from "./schemas/growth.mjs";
import { RECORD_SCHEMAS } from "./schemas/records.mjs";
import { NETWORK_SCHEMAS } from "./schemas/network.mjs";
import { ACCOUNT_SCHEMAS } from "./schemas/accounts.mjs";
import { TASK_SCHEMAS } from "./schemas/tasks.mjs";
import { PEOPLE_SCHEMAS } from "./schemas/people.mjs";
import { CATALOGUE_AND_LINK_SCHEMAS } from "../money/schemas/catalogueAndLinks.mjs";
import { TERMINAL_SCHEMAS } from "../money/schemas/terminal.mjs";
import { PAYMENT_SCHEMAS } from "../money/schemas/payments.mjs";
import { SUBSCRIPTION_SCHEMAS } from "../money/schemas/subscriptions.mjs";
import { adjustCredit, listCreditEntries } from "../money/customerCredit.mjs";
// ★ Task 20.65 — tax identity CRUD for B2B payers and accounts
import { createTaxId, updateTaxId, deleteTaxId } from "../money/taxIds.mjs";
import { getSetting } from "../settings/writes.mjs";
// ★ Task 20.64 — apply/remove coupon on a person
import { applyPersonCoupon, removePersonCoupon } from "../money/discountApply.mjs";
import {
  createNotification, setNotificationPreference, markNotificationRead,
  markAllNotificationsRead, sendTestNotification,
  // ★ TASK 6.3 — the practice's own default channel matrix write, `/api/settings/notifications/rule`.
  setNotificationRule,
} from "../notifications/writes.mjs";
import { advanceProvisioningRun } from "../provisioning/advance.mjs";
// ★ Stage 4 Task 10 — the two platform-only actions on a give-up row (07 §4 rule 8, MOCKUPS §20).
import { retryJobNow, giveUpJobFailure } from "../platform/jobActions.mjs";
// ★ C3.2 — Landing pages CRUD + AI draft route
import { createLandingPage, updateLandingPage, deleteLandingPage, draftLandingPageCopy, publishLandingPage } from "../growth/landingPages.mjs";
// ★ Task 16.36 — growth campaigns and segments (forward dependencies on 16.19's campaign writers)
import { saveCampaign, createSegment, sendCampaign, scheduleCampaign, testCampaign, updateCampaign } from "../growth/campaigns.mjs";
// ★ Task 20.43 — campaign groups (container for campaigns, pages, segments; attach/detach)
import { createCampaignGroup, updateCampaignGroup, deleteCampaignGroup, attachToCampaignGroup, detachFromCampaignGroup, pauseCampaignGroup } from "../growth/campaignGroups.mjs";
import { recordCompetitorWatchForTenant } from "../run/competitorWatch.mjs";
// ★★★ Task 14.41 — every Stage 14 write row, one table (`STAGE14_WRITES`), spread as the LAST
//     element of `ROUTES` below. `itemsAndDocuments.mjs` imports ONLY the route files — never this
//     file — so the direction stays `writes.mjs → itemsAndDocuments.mjs → route files`, no cycle.
import { STAGE14_WRITES } from "./itemsAndDocuments.mjs";

/**
 * ★★★ THE ROUTE TABLE. `section` is the NAV PATH whose authorisation governs the write.
 *
 * ★★ AUTHORISATION REUSES `authoriseSection`, THE SAME FUNCTION THE READ ROUTES USE, AND THAT IS THE
 *    POINT: if a rank may not SEE a section it must not be able to WRITE to it, and two separate
 *    permission tables would diverge the first time one was edited. §K3 — "the server decides, every
 *    time, on every request."
 * ★★★ 7.12a / Q7-21 — `minRank` IS GONE FROM THIS TABLE. Every write below is authorised on the
 *     `object`/`action` pair 7.1 declared, through `assertMay` (`src/permissions/assertMay.mjs`) —
 *     never on a `staff_role` string. A person`s details are visible to a coach; changing somebody`s
 *     STAFF RANK is not a coach's business, so `setStaffRole`'s `staff_role.change` is a role_action
 *     no coach's role carries, even though `/people/team` is readable below that. The two entries
 *     under "platform · the job queue" below keep a literal `minRank: "super_admin_1"` as INERT
 *     METADATA ONLY — nothing in `registerWriteRoutes` reads it (platform routes authorise on
 *     `callerIsPlatform(db)` alone) — because `test/s4_platform_job_actions.test.mjs:568` asserts
 *     the field's presence and this task does not touch, weaken or delete an existing test.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ `subject` — F690. EVERY VERB ROW BELOW SAYS WHICH BODY FIELD NAMES THE ROW IT ACTS ON, AND
 *     SAYING NOTHING IS NO LONGER ALLOWED (`assertVerbRoutesDeclareASubject`, below this table,
 *     throws at module load). Before this, the dispatcher read `body.id` — a field **no handler in
 *     this file's 67 routes reads as its subject** — so the owner check resolved whichever row the
 *     CALLER named in `id` while the write went to the row named in `personId`/`accountId`/
 *     `bookingId`/`instanceId`. A Coach could set `id` to one of their own clients and edit a
 *     colleague's. See `src/permissions/assertMay.mjs`'s `subjectIdFor` for the full note.
 *
 *   ★★ THE RULE FOR FILLING IT IN, AND IT IS NARROW ON PURPOSE. `assertMay` resolves the owner as
 *      `SELECT <ownerExpr(object)> FROM keystone.<OWNERSHIP[object].table> WHERE id = $1`. So a
 *      `subject` may only name a field that carries an id of a row in the PERMISSION OBJECT'S OWN
 *      TABLE (`person`→`app_user`, `account`→`account`, `engagement`→`booking`,
 *      `document`→`document_instance`, `invoice`→`invoice`). Naming a field that holds some other
 *      table's id would look like a check and resolve to `null` — and naming a field the handler
 *      does not use for its subject would re-open the forgery itself.
 *   ★★★ `subject: null` IS A REAL ANSWER, NOT A GAP, and every one below carries its reason: a
 *       CREATE (no existing row to inherit an owner from), an ownerless object (`item`, `discount`,
 *       `setting`, `network_party` — `ownership.mjs`), a bulk action with no single subject, or a
 *       subject id that lives in a table this object's grant cannot resolve. It yields `ownerId =
 *       null`, which only `scope = 'everything'` can carry (`scope_allows`, 0070:181) — i.e. the
 *       conservative answer, and exactly the behaviour every one of these rows already had.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
const ROUTES = Object.freeze([
  // ── people ────────────────────────────────────────────────────────────────
  { path: "/api/people", schema: PEOPLE_SCHEMAS["/api/people"],                     section: "/people",             fn: createPerson,
    object: "person", action: "person.create" },
  // ★ Check for duplicates BEFORE creating. Read-shaped POST, no write. Returns possible match or null.
  { path: "/api/people/check-duplicate", schema: PEOPLE_SCHEMAS["/api/people/check-duplicate"],     section: "/people",             fn: checkDuplicatePerson,
    object: "person", action: "person.create" },
  // ★★★ F690 — `subject: "personId"`: `updatePerson` destructures `personId` and UPDATEs
  //     `app_user WHERE id = personId` (`src/people/writes.mjs:304,323`). `id` is not in its
  //     `REFUSED_UPDATE_FIELDS` (`:296`), so before this the coarse check read a row the update
  //     never touched. This is the exact route the F690 forgery was measured on.
  { path: "/api/people/update", schema: PEOPLE_SCHEMAS["/api/people/update"],              section: "/people",             fn: updatePerson,
    object: "person", action: "edit", subject: "personId" },
  // ★★★ P8.9 — THE MOVE FROM LEAD TO CLIENT, WHICH NOTHING COULD MAKE. [MEASURED] all 55 people in
  //     the database held `lifecycle_status = 'lead'` because no write path accepted the column.
  //   ★ NOT admin-only, deliberately: converting a lead is the coach's own job on their own caseload,
  //     and `/people` is already scope-filtered to what they may see. Requiring admin would put a
  //     manager in the middle of the commonest thing a coach does.
  // ★ F690 — `setLifecycleStatus` requires and reads `personId` (`src/people/writes.mjs:412-414`).
  { path: "/api/people/stage", schema: PEOPLE_SCHEMAS["/api/people/stage"],               section: "/people",             fn: setLifecycleStatus,
    object: "person", action: "edit", subject: "personId" },
  // ★ TASK 8.12 / F626 gap 2 — `fn` is now the wrapper (`inviteWithRoleCheck`, below); `object`/
  //   `action` are UNCHANGED (migration 0226 is what widens who clears this gate, not this row).
  { path: "/api/people/invite", schema: PEOPLE_SCHEMAS["/api/people/invite"],              section: "/people/team",        fn: inviteWithRoleCheck,
    object: "person", action: "team.invite" },
  // ★★★ TASK 1.2 (spec 01 §11, §2) — TeamList's "Cancel invite" row action. `object`/`action` match
  //     `/api/people/invite` above (same coarse gate; `cancelInvite` asks the same STAFF-only second
  //     question `inviteWithRoleCheck` asks, using the invite's own `role` column).
  { path: "/api/people/invite/cancel", schema: PEOPLE_SCHEMAS["/api/people/invite/cancel"],       section: "/people/team",        fn: cancelInvite,
    object: "person", action: "team.invite" },
  // ★ the maintainer, 29 Sep 2026 — "Send portal link", the third state of the record-page button. Same gate
  //   as the invite routes above: whoever may invite this person may remind them where to sign in.
  { path: "/api/people/portal-link", schema: PEOPLE_SCHEMAS["/api/people/portal-link"],         section: "/people/team",        fn: sendPortalLink,
    object: "person", action: "team.invite" },
  // ★★ `admin` REQUIRED: a rank change is a privilege change, and a coach who could grant ranks could
  //    grant themselves one. The read side of /people/team is deliberately more open than this.
  { path: "/api/people/staff-role", schema: PEOPLE_SCHEMAS["/api/people/staff-role"],          section: "/people/team",        fn: setStaffRole,
    object: "person", action: "staff_role.change" },
  // ★★★ TASK 8.13 / CT-060 — `keystone.guardian` (0074) had NO application importer: its only
  //     callers were a gate and a test (`db/gates/p1_guardian.mjs`, `test/s3_payload_privacy.
  //     test.mjs`). These two rows are the first. `object`/`action` are the NAMED ACTION
  //     `person.create` — owner, admin AND coach all hold it (0190:229-231) — because the wire body
  //     (`{ childUserId, guardianUserId, relationship? }`) carries no `id` for this row's own coarse
  //     gate to resolve an owner from; the REAL per-child `person`/`edit` scope question (a Coach may
  //     only act on their own caseload) is asked a second time, with the real subject, INSIDE
  //     `linkGuardian`/`unlinkGuardian` themselves — see `src/people/guardians.mjs`'s own comment.
  { path: "/api/people/guardian", schema: PEOPLE_SCHEMAS["/api/people/guardian"],            section: "/people",             fn: linkGuardian,
    object: "person", action: "person.create" },
  { path: "/api/people/guardian/remove", schema: PEOPLE_SCHEMAS["/api/people/guardian/remove"],     section: "/people",             fn: unlinkGuardian,
    object: "person", action: "person.create" },
  // ★★★ TASK 12.4 (`12-signup-first-run-people.md` §2, §4) — three new person-mutating routes, same
  //     `object:"person", action:"edit"` pair `/api/people/update`/`/api/people/stage` already use
  //     above (§4's own text: "the SAME action every other person-editing route already uses").
  //   ★★ THE GAP 12.4's OWN COMMENT RECORDED HERE IS NOW CLOSED — F690/F675. It read: "these three
  //      bodies carry the target as `personId` (§2's own wire contract) … so `assertMay`'s coarse
  //      owner resolution (`body?.id`) always sees `undefined` and resolves `ownerId = null`, and a
  //      Coach (`person: owned`) therefore cannot pass the coarse gate even on a person they
  //      genuinely own … fixing it means editing `src/permissions/assertMay.mjs`, shared by every
  //      write route and not on this task's file list." That edit is what `subject` below is: the
  //      field is declared, the owner resolves against the row actually written, and the same
  //      change closes the forgery half (a caller-chosen `body.id`) at the same time.
  { path: "/api/people/consent-status", schema: PEOPLE_SCHEMAS["/api/people/consent-status"],      section: "/people",             fn: setConsentStatus,
    object: "person", action: "edit", subject: "personId" },
  { path: "/api/people/assign", schema: PEOPLE_SCHEMAS["/api/people/assign"],              section: "/people",             fn: assignPerson,
    object: "person", action: "edit", subject: "personId" },
  { path: "/api/people/lead-next-step", schema: PEOPLE_SCHEMAS["/api/people/lead-next-step"],      section: "/people",             fn: setLeadNextStep,
    object: "person", action: "edit", subject: "personId" },
  // ★★★ TASK 12.5 (`12-signup-first-run-people.md` §2, §3.7, §4) — FirstRunHome's "Remove samples".
  //     Same `object:"person", action:"edit"` pair the three rows above already use (§4's own text:
  //     "the SAME action every other person-editing route already uses"). Body is `{}` — no
  //     `personId` (this is a bulk, tenant-wide action, not a per-record one) — so there is no
  //     subject to declare and `subject: null` says so: `ownerId` resolves to `null` and only
  //     `scope: everything` carries it. §12's own acceptance scenario only exercises this as Owner
  //     (`scope: everything`, unaffected), which is the intended audience for a tenant-wide wipe.
  { path: "/api/people/samples/remove", schema: PEOPLE_SCHEMAS["/api/people/samples/remove"],      section: "/people",             fn: removeSamples,
    object: "person", action: "edit", subject: null },

  // ── people · list workspace bulk actions (touch-up GROUP A, workstream 4.2/4.3) ────────────
  // ★★★ `subject: null` ON ALL FOUR — A BULK BODY CARRIES N IDS, NOT ONE, SO THERE IS NO SINGLE
  //     SUBJECT THIS COARSE GATE CAN RESOLVE (see `src/people/bulk.mjs`'s own header, which is the
  //     full reasoning — repeated as a pointer here, not re-argued). `ownerId` therefore resolves
  //     `null` and only `scope: 'everything'` (Owner/Admin) passes THIS gate; `bulk.mjs` itself asks
  //     the real per-row question a second time, with the real subject, before touching each row.
  { path: "/api/people/bulk/archive", schema: PEOPLE_SCHEMAS["/api/people/bulk/archive"],        section: "/people",             fn: bulkArchivePeople,
    object: "person", action: "edit", subject: null },
  { path: "/api/people/bulk/assign", schema: PEOPLE_SCHEMAS["/api/people/bulk/assign"],         section: "/people",             fn: bulkAssignPeople,
    object: "person", action: "edit", subject: null },
  { path: "/api/people/bulk/stage", schema: PEOPLE_SCHEMAS["/api/people/bulk/stage"],          section: "/people",             fn: bulkChangeStagePeople,
    object: "person", action: "edit", subject: null },
  // ★ Export is a READ of the selected rows plus one audit row (`export.performed`) — still routed
  //   through the mutating table (POST, Idempotency-Key required) because writing that audit row IS
  //   a mutation, and a retried export must not double-audit.
  { path: "/api/people/bulk/export", schema: PEOPLE_SCHEMAS["/api/people/bulk/export"],         section: "/people",             fn: exportPeople,
    object: "person", action: "edit", subject: null },

  // ── people · merge duplicates (R2) ────────────────────────────────────────
  // ★★★ R2 — MERGE DUPLICATES. Three routes: preview the changes, apply the merge, and undo within
  //     30 days. All three are admin-only (owner/admin have `record.archive`; coach does not) — a
  //     coach cannot merge duplicates of anybody's records. The authorization reuses the existing
  //     `record.archive` named action, which is owner/admin-only, rather than inventing a new action
  //     that would require a database migration (0190's role_action_action_check).
  //   ★★★ FIX (coordinator review, 23 Sep 2026) — `record.archive` is a NAMED_ACTIONS entry (a flat
  //      capability check with no scope/owner resolution; `assertMay`'s first branch returns before
  //      `subjectIdFor` is ever reached), so `assertVerbRoutesDeclareASubject`'s own rule (this
  //      file, ~line 590) forbids declaring `subject` on it at all — a field nothing reads, exactly
  //      like the comment there says. The original `subject: "survivorId"` on merge/undo below was
  //      well-intentioned (by analogy to the ordinary edit/view routes above) but tripped this
  //      guard at module load, crashing every route import — caught by the checkpoint's suite run.
  //      Preview, merge and undo all take no subject; the action gate is the binding constraint.
  { path: "/api/people/merge/preview", schema: PEOPLE_SCHEMAS["/api/people/merge/preview"],       section: "/people",             fn: previewMerge,
    object: "person", action: "record.archive" },
  { path: "/api/people/merge", schema: PEOPLE_SCHEMAS["/api/people/merge"],               section: "/people",             fn: applyMerge,
    object: "person", action: "record.archive" },
  { path: "/api/people/merge/undo", schema: PEOPLE_SCHEMAS["/api/people/merge/undo"],          section: "/people",             fn: undoMerge,
    object: "person", action: "record.archive" },
  // ★ TASK 12.12 — "not the same person". Same authorisation as the three routes above: no subject
  //   (record.archive is a NAMED_ACTIONS entry; declaring `subject` here would trip
  //   `assertVerbRoutesDeclareASubject` exactly as the comment above explains for merge/undo).
  { path: "/api/people/merge/dismiss", schema: PEOPLE_SCHEMAS["/api/people/merge/dismiss"],       section: "/people",             fn: dismissMergePair,
    object: "person", action: "record.archive" },

  // ── tasks + leads ─────────────────────────────────────────────────────────
  { path: "/api/tasks/complete", schema: TASK_SCHEMAS["/api/tasks/complete"],             section: "/tasks",              fn: completeTask,
    object: "task", action: "edit", subject: "taskId" },
  { path: "/api/tasks/reassign", schema: TASK_SCHEMAS["/api/tasks/reassign"],             section: "/tasks",              fn: reassignTask,
    object: "task", action: "edit", subject: "taskId" },
  { path: "/api/people/lead-stage", schema: PEOPLE_SCHEMAS["/api/people/lead-stage"],          section: "/people/leads",       fn: setLeadStage,
    object: "person", action: "edit", subject: "personId" },

  // ── growth · campaigns + segments (Stage 16) ────────────────────────────────
  { path: "/api/growth/segments", schema: GROWTH_SCHEMAS["/api/growth/segments"],            section: "/growth/lists",        fn: createSegment,
    object: "campaign", action: "edit", subject: null },
  { path: "/api/growth/campaigns", schema: GROWTH_SCHEMAS["/api/growth/campaigns"],           section: "/growth/campaigns",    fn: saveCampaign,
    object: "campaign", action: "edit", subject: null },
  { path: "/api/growth/campaigns/send", schema: GROWTH_SCHEMAS["/api/growth/campaigns/send"],      section: "/growth/campaigns",    fn: sendCampaign,
    object: "campaign", action: "edit", subject: null },
  { path: "/api/growth/campaigns/schedule", schema: GROWTH_SCHEMAS["/api/growth/campaigns/schedule"],  section: "/growth/campaigns",    fn: scheduleCampaign,
    object: "campaign", action: "edit", subject: null },
  { path: "/api/growth/campaigns/test", schema: GROWTH_SCHEMAS["/api/growth/campaigns/test"],      section: "/growth/campaigns",    fn: testCampaign,
    object: "campaign", action: "edit", subject: null },
  // ★ T1.23 (F804) — the dedicated update path the React port calls (saveCampaign's own /api/growth/campaigns
  //   already updates when campaignId is present; this is the same updateCampaign(), a second door for it).
  { path: "/api/growth/campaigns/update", schema: GROWTH_SCHEMAS["/api/growth/campaigns/update"],    section: "/growth/campaigns",    fn: updateCampaign,
    object: "campaign", action: "edit", subject: "campaignId" },

  // ── growth · campaign groups (Task 20.43) ──────────────────────────────────
  { path: "/api/growth/campaign-groups", schema: GROWTH_SCHEMAS["/api/growth/campaign-groups"],     section: "/growth/campaigns",    fn: createCampaignGroup,
    object: "campaign", action: "edit", subject: null },
  { path: "/api/growth/campaign-groups/update", schema: GROWTH_SCHEMAS["/api/growth/campaign-groups/update"], section: "/growth/campaigns", fn: updateCampaignGroup,
    object: "campaign", action: "edit", subject: "groupId" },
  { path: "/api/growth/campaign-groups/delete", schema: GROWTH_SCHEMAS["/api/growth/campaign-groups/delete"], section: "/growth/campaigns", fn: deleteCampaignGroup,
    object: "campaign", action: "edit", subject: "groupId" },
  { path: "/api/growth/campaign-groups/attach", schema: GROWTH_SCHEMAS["/api/growth/campaign-groups/attach"], section: "/growth/campaigns", fn: attachToCampaignGroup,
    object: "campaign", action: "edit", subject: null },
  { path: "/api/growth/campaign-groups/detach", schema: GROWTH_SCHEMAS["/api/growth/campaign-groups/detach"], section: "/growth/campaigns", fn: detachFromCampaignGroup,
    object: "campaign", action: "edit", subject: null },
  { path: "/api/growth/campaign-groups/:id/pause", schema: GROWTH_SCHEMAS["/api/growth/campaign-groups/:id/pause"], section: "/growth/campaigns", fn: pauseCampaignGroup,
    object: "campaign", action: "edit", subject: null },

  // ── accounts ──────────────────────────────────────────────────────────────
  // ★ F690 — a CREATE: there is no existing account yet to inherit an owner from.
  { path: "/api/accounts", schema: ACCOUNT_SCHEMAS["/api/accounts"],                   section: "/accounts",           fn: createAccount,
    object: "account", action: "edit", subject: null },
  // ★ `updateAccount` UPDATEs `account WHERE id = accountId` (`src/accounts/writes.mjs:68-70`).
  { path: "/api/accounts/update", schema: ACCOUNT_SCHEMAS["/api/accounts/update"],            section: "/accounts",           fn: updateAccount,
    object: "account", action: "edit", subject: "accountId" },
  // ★ A pipeline is created ON an account; `accountId` is the `account` row being added to
  //   (`src/accounts/writes.mjs:111-146`), and the account is the ownable thing here.
  { path: "/api/accounts/pipeline", schema: ACCOUNT_SCHEMAS["/api/accounts/pipeline"],          section: "/accounts",           fn: createAccountPipeline,
    object: "account", action: "edit", subject: "accountId" },
  // ★★ `subject: null` DESPITE HAVING A REAL SUBJECT FIELD. `advanceStage` acts on `pipelineId`
  //    (`src/accounts/writes.mjs:179-187`), which is an `account_pipeline` id — NOT an `account`
  //    id, and `account_pipeline` is not a permission object. Declaring `subject: "pipelineId"`
  //    would read `keystone.account WHERE id = <a pipeline id>`, match nothing, and look like a
  //    check while resolving `null` anyway. Left null, honestly: `everything` only, as today.
  //    Resolving it properly needs an owner-through-another-table mechanism this fix does not add.
  { path: "/api/accounts/pipeline/advance", schema: ACCOUNT_SCHEMAS["/api/accounts/pipeline/advance"],  section: "/accounts",           fn: advanceStage,
    object: "account", action: "edit", subject: null },

  // ── run schedule · P8.9 ───────────────────────────────────────────────────
  // ★★★ `paused` HAD ZERO WRITERS. [MEASURED 2026-09-15] the string appeared twice for this table —
  //     in `SCHEDULE_STATES` and in a comment explaining that paused items are skipped — and nothing
  //     could ever set it. These two routes are the first and only way in.
  //   ★★ A PAUSE IS NOT A NOT-DELIVERABLE, and they are kept apart on purpose: not-deliverable means
  //      *we cannot*, paused means *we chose not to*. `rearmBlockedItems` (which a client re-consent
  //      triggers) deliberately cannot un-pause, or a deliberate hold would be undone by a routine
  //      grant write.
  // ★ F690 — `accountId` is the real (and optional) filter both handlers apply
  //   (`src/run/schedule.mjs:196-206,222-232`). Omitted, it is a tenant-wide pause: no single
  //   subject, `ownerId` null, `everything` only — which is the right floor for a blanket hold.
  { path: "/api/accounts/run/pause", schema: ACCOUNT_SCHEMAS["/api/accounts/run/pause"],         section: "/accounts/all",       fn: pauseScheduleItems,
    object: "account", action: "edit", subject: "accountId" },
  { path: "/api/accounts/run/resume", schema: ACCOUNT_SCHEMAS["/api/accounts/run/resume"],        section: "/accounts/all",       fn: resumeScheduleItems,
    object: "account", action: "edit", subject: "accountId" },

  // ── network ───────────────────────────────────────────────────────────────
  // ★ ownerless (`ownership.mjs:76`) → scope must be `everything` — 7.12a's enforcement, not this table's.
  //   F690: `subject: null` because the object has no owner AT ALL — `resolveOwnerId` returns null
  //   on `ownable: false` before any id is consulted, so naming `partyId` here would be decoration.
  { path: "/api/network", schema: NETWORK_SCHEMAS["/api/network"],                    section: "/network",            fn: createNetworkParty,
    object: "network_party", action: "edit", subject: null },
  { path: "/api/network/update", schema: NETWORK_SCHEMAS["/api/network/update"],             section: "/network",            fn: updateNetworkParty,
    object: "network_party", action: "edit", subject: null },

  // ── items and services ────────────────────────────────────────────────────
  // ★ ownerless (`ownership.mjs:78`). F690: `subject: null` on all ten item/discount rows below —
  //   `resolveOwnerId` short-circuits on `ownable: false`, so there is no owner for any id to
  //   resolve to, and `everything` is the only scope that can carry the catalogue. Unchanged
  //   behaviour; stated rather than omitted so the next catalogue route cannot inherit a guess.
  { path: "/api/items/services", schema: ITEM_SCHEMAS["/api/items/services"],             section: "/items/services",     fn: createService,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/packages", schema: ITEM_SCHEMAS["/api/items/packages"],             section: "/items/packages",     fn: createPackage,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/plans", schema: ITEM_SCHEMAS["/api/items/plans"],                section: "/items/plans",        fn: createPlan,
    object: "item", action: "edit", subject: null },
  // ★★★ PRICING IS ADMIN-ONLY. §Z4 makes a price change permanent and it is what an invoice is computed
  //     from; a coach changing one would move money without anyone approving it.
  { path: "/api/items/prices", schema: ITEM_SCHEMAS["/api/items/prices"],               section: "/items/services",     fn: createPrice,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/contracted-prices", schema: ITEM_SCHEMAS["/api/items/contracted-prices"],    section: "/items/services",     fn: setContractedPrice,
    object: "item", action: "edit", subject: null },

  // ── items · discounts + agreements (Task 2.4, 02-items.md §2/§4) ───────────
  // ★★★ `object: "discount"`, `action: "edit"` — 02-items.md §4: "Create/retire a discount, edit its
  //     definition | object:"discount", action:"edit" | owner, admin" (`0190:145,167`). Distinct from
  //     `discount.apply` (`NAMED_ACTIONS`, `assertMay.mjs:45`), which is a DIFFERENT question — using
  //     an already-saved discount on a line item — asked entirely inside spec 05's own `createLineItem`
  //     (§4/§10), never here.
  { path: "/api/items/coupons", schema: ITEM_SCHEMAS["/api/items/coupons"],              section: "/items/coupons",      fn: createDiscount,
    object: "discount", action: "edit", subject: null },
  { path: "/api/items/coupons/active", schema: ITEM_SCHEMAS["/api/items/coupons/active"],       section: "/items/coupons",      fn: setDiscountActive,
    object: "discount", action: "edit", subject: null },
  { path: "/api/items/promotion-codes", schema: ITEM_SCHEMAS["/api/items/promotion-codes"],      section: "/items/coupons",      fn: addPromotionCode,
    object: "discount", action: "edit", subject: null },
  { path: "/api/items/promotion-codes/deactivate", schema: ITEM_SCHEMAS["/api/items/promotion-codes/deactivate"], section: "/items/coupons", fn: deactivatePromotionCode,
    object: "discount", action: "edit", subject: null },
  // ★ `object: "item"`, `action: "edit"` — 02-items.md §4: "Attach/detach an agreement requirement |
  //   object:"item", action:"edit" | owner, admin | same tier as every other catalogue-definition
  //   write." `section: "/items/services"` — the same catch-all every other POLYMORPHIC item route
  //   above (`/api/items/prices`, `/api/items/contracted-prices`) already uses, since a single static
  //   `section` cannot vary per request body's `itemType`.
  // ★★ THE SPEC NAMES `DELETE /api/items/agreements/:id` FOR DETACH. Every mutating route in this
  //    file is `POST` (`registerWriteRoutes` below only registers `app.post`, P15B.13's
  //    Idempotency-Key contract) — there is no `DELETE` verb anywhere in this codebase. Wired here as
  //    `POST /api/items/agreements/detach`, the same "detach an association" idiom
  //    `/api/people/guardian/remove` already uses, rather than inventing raw `DELETE` support this
  //    task's file list does not cover. Reported to Opus, not silently substituted.
  { path: "/api/items/agreements", schema: ITEM_SCHEMAS["/api/items/agreements"],           section: "/items/services",     fn: attachAgreementRequirement,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/agreements/detach", schema: ITEM_SCHEMAS["/api/items/agreements/detach"],    section: "/items/services",     fn: detachAgreementRequirement,
    object: "item", action: "edit", subject: null },

  // ── items · stop selling / sell again (Task 2.5, 02-items.md §1 point 3 / §2 / §4) ─────────
  // ★★★ `object: "item"`, `action: "edit"` — 02-items.md §4: "Stop selling / sell again |
  //     object:"item", action:"edit" | owner, admin | mirrors createService/createPackage/
  //     createPlan's own {object:"item",action:"edit"} rows." `section: "/items/services"` — the
  //     same polymorphic-route catch-all `/api/items/prices` and `/api/items/agreements` already
  //     use above, since one static `section` cannot vary per request body's `itemType`.
  { path: "/api/items/active", schema: ITEM_SCHEMAS["/api/items/active"],               section: "/items/services",     fn: setItemActive,
    object: "item", action: "edit", subject: null },

  // ── platform · provisioning (P6.79) ───────────────────────────────────────
  // ★★★ 7.12a / Q7-5 — `platform: true` ROUTES AUTHORISE ON THE OPERATOR GRANT ALONE:
  //     `callerIsPlatform(db)` (`src/db/index.mjs`), asked instead of `authoriseSection`/a rank, in
  //     `registerWriteRoutes` below. A rank string cannot be revoked mid-session; the grant is
  //     re-read on every call and fails closed on an empty GUC.
  // ★★ These are the first callers `executeStep`/`reconcileRunState` have ever had — they were
  //    written with the retry budget, the backoff and the error classification, and NOTHING in the
  //    product ran them, which is why the deployed database holds a run stuck since signup.
  // ★ S2 TASK 3 — `/api/platform/provisioning/handoff` is DELETED with it (01 default 9: Documenso
  //   retired). It existed for exactly one purpose: recording that a person had created a Documenso
  //   team by hand. There is no other human-only provisioning step in the product today, so there is
  //   nothing left for that route to do. The one stranded production row is Task 9's job, not this
  //   route's.
  { path: "/api/platform/provisioning/advance", schema: PLATFORM_SCHEMAS["/api/platform/provisioning/advance"],  section: "/platform/provisioning", fn: advanceProvisioningRun,
    platform: true },

  // ── platform · the job queue (Stage 4 Task 10, 07 §4 rule 8) ──────────────
  // ★★★ THEY LIVE ON THE TENANT APP, NOT UNDER `/api/platform/*`, AND THAT IS A REQUIREMENT RATHER
  //     THAN A PREFERENCE. `job_failure.acknowledged_by` is a uuid (0145) and F511's person half is
  //     the whole point of "Give up…" — so the write must carry WHO. The `/api/platform/*` console
  //     namespace admits no person and therefore has no `appUserId` to acknowledge with. Platform
  //     Jobs is already served through the tenant app to a `super_admin_1` inside the PLATFORM
  //     practice (src/routes/index.mjs), and that is the same identity `caller_is_platform()`
  //     recognises inside the database.
  // ★★ 7.12a / Q7-5 — `section: "/platform/jobs"` is NAV METADATA ONLY now (it still governs what
  //    the sidebar shows); the WRITE authorises on `callerIsPlatform(db)` alone, in
  //    `registerWriteRoutes` below. `keystone.caller_is_platform()` inside all four
  //    `retryJobNow`/`giveUpJobFailure` SQL functions (0160) is the half that cannot be routed around
  //    at all — a route check is one `if`; the definer is not. `minRank: "super_admin_1"` on these
  //    two entries is inert (see the table's own header comment above).
  { path: "/api/jobs/retry", schema: PLATFORM_SCHEMAS["/api/jobs/retry"],                     section: "/platform/jobs",        fn: retryJobNow,                minRank: "super_admin_1",
    platform: true },
  { path: "/api/jobs/give-up", schema: PLATFORM_SCHEMAS["/api/jobs/give-up"],                   section: "/platform/jobs",        fn: giveUpJobFailure,           minRank: "super_admin_1",
    platform: true },

  // ── platform · growth (Stage 16 competitor watch) ────────────────────────────
  { path: "/api/platform/run/competitor-watch", schema: PLATFORM_SCHEMAS["/api/platform/run/competitor-watch"],  section: "/platform",            fn: recordCompetitorWatchForTenant, minRank: "super_admin_1",
    platform: true },

  // ── documents ─────────────────────────────────────────────────────────────
  // ★ ownerless; scope `everything` only (`0066:116-117`). F690: `subject: null`, same reasoning as
  //   the catalogue rows above — `setting` has no owner for any id to resolve to.
  { path: "/api/documents/categories", schema: DOCUMENT_SCHEMAS["/api/documents/categories"],       section: "/settings/documents", fn: createDocumentCategory,
    object: "setting", action: "edit", subject: null },
  { path: "/api/documents/types", schema: DOCUMENT_SCHEMAS["/api/documents/types"],            section: "/settings/documents", fn: createDocumentType,
    object: "setting", action: "edit", subject: null },
  { path: "/api/documents/starters", schema: DOCUMENT_SCHEMAS["/api/documents/starters"],         section: "/documents",          fn: seedStarterTemplate,
    object: "document", action: "edit", subject: null },
  // ★ F690 — a CREATE: `createInstance` (`src/documents/writes.mjs:232`) takes no instance id.
  { path: "/api/documents/instances", schema: DOCUMENT_SCHEMAS["/api/documents/instances"],        section: "/documents",          fn: createInstance,
    object: "document", action: "edit", subject: null },
  // ★ F690 — `sendDocument` (task 14.31) acts on `instanceId` when one is given — a
  //   `document_instance` id, which is exactly `OWNERSHIP.document.table`. Its owner resolves
  //   through `ownerVia` → the subject person's owning coach (`ownership.mjs:61`). When no
  //   `instanceId` is given (create-and-send, `{personId, template}`), `subjectIdFor` resolves
  //   `null` — a CREATE, same as every other `subject: null` route (`:149-154` above) — and
  //   `sendDocument` itself asks the sharper `person: view` question before creating anything
  //   (`src/documents/sendDocument.mjs`).
  { path: "/api/documents/send", schema: DOCUMENT_SCHEMAS["/api/documents/send"],             section: "/documents",          fn: sendDocument,
    object: "document", action: "edit", subject: "instanceId", createWhenNoSubject: true },
  // ★ Q7-2 — reached through a signed link (`link_token`, purpose `document_signature`), never a
  //   client session; `signer: true` per `db/migrations/0169_link_token.sql:17`, checked at BUILD.
  { path: "/api/documents/sign", schema: DOCUMENT_SCHEMAS["/api/documents/sign"],             section: "/documents",          fn: recordSignature,
    object: "document", action: "document.sign", signer: true },
  { path: "/api/documents/decline", schema: DOCUMENT_SCHEMAS["/api/documents/decline"],          section: "/documents",          fn: declineInstance,
    object: "document", action: "document.sign", signer: true },
  // ★★ EXECUTION IS ADMIN-ONLY. It freezes a price and terms into an instrument that can never be
  //    edited again (U25 / §M0 LAW 3) — the least reversible write in the product.
  { path: "/api/documents/execute", schema: DOCUMENT_SCHEMAS["/api/documents/execute"],          section: "/documents/executed", fn: executeInstance,
    object: "document", action: "document.execute" },
  // ★★★ THE DISCLOSURE, P15C.10. NOT admin-gated and NOT rank-laddered above `coach`, because the
  //     person who accepts is the SIGNER — a client tapping "I agree" on their own signing surface.
  //     Gating it at admin would make the statutory consent something staff perform on a client's
  //     behalf, which is the one thing 15 U.S.C. 7001(c)(1) is about not doing.
  //   ★ Both routes take `appUserId`, so a signer's own surface passes their own id; authorisation
  //     that the id IS theirs is the signing surface's (P15C.12), not this table's.
  // ★★★ THE TWO BUILDERS GET TWO ROUTES, and the builder comes from THE PATH — never from the body.
  //     §A5's separation is only real if the route decides: a form body posted to the contract route
  //     must be refused, which is P15C.5's second red-first. The handler passes the literal through,
  //     so there is no code path in which a caller's `kind` selects the tool.
  //   ★ Authoring is ADMIN work. A coach uses templates; they do not write the practice's contracts.
  // ★★★ F777 — an authored contract takes the practice's agreement type (ensureAgreementType), in the same
  //     transaction. Without a type every instance made from it is invisible to staff and cannot be sent.
  { path: "/api/documents/contracts/templates", schema: DOCUMENT_SCHEMAS["/api/documents/contracts/templates"], section: "/documents/contracts",
    fn: async (tx, args) => {
      const created = await createTemplate(tx, { ...args, builder: "contract" });
      const typeId = await ensureAgreementType(tx, { tenantId: args.tenantId, actorUserId: args.actorUserId });
      await setTemplateType(tx, { tenantId: args.tenantId, templateId: created.id, typeId });
      return { ...created, typeId };
    },
    object: "document", action: "template.author" },
  { path: "/api/documents/forms/templates", schema: DOCUMENT_SCHEMAS["/api/documents/forms/templates"],     section: "/documents/forms",
    fn: (tx, args) => createTemplate(tx, { ...args, builder: "form" }),
    object: "document", action: "template.author" },
  // ★★ VERSIONING AND EDITING TAKE THE BUILDER FROM THE EXISTING ROW, not from the caller — a template
  //    cannot change tool, so asking would only create a way to get it wrong.
  { path: "/api/documents/templates/version", schema: DOCUMENT_SCHEMAS["/api/documents/templates/version"],   section: "/documents",
    fn: newTemplateVersion, object: "document", action: "template.author" },
  { path: "/api/documents/templates/body", schema: DOCUMENT_SCHEMAS["/api/documents/templates/body"],      section: "/documents",
    fn: updateTemplateBody, object: "document", action: "template.author" },
  // ★ Q7-2 — reached through a signed link, never a client session; `signer: true`.
  { path: "/api/documents/disclosure/accept", schema: DOCUMENT_SCHEMAS["/api/documents/disclosure/accept"],   section: "/documents", fn: acceptDisclosure,
    object: "document", action: "document.sign", signer: true },
  { path: "/api/documents/disclosure/withdraw", schema: DOCUMENT_SCHEMAS["/api/documents/disclosure/withdraw"], section: "/documents", fn: withdrawDisclosure,
    object: "document", action: "document.sign", signer: true },

  // ── engagements ───────────────────────────────────────────────────────────
  // ★ owner = `availability.host_id`, `ridesOn: "engagement"` (`ownership.mjs:72-73`).
  // ★★★ F690 — ALL THREE AVAILABILITY ROWS ARE `subject: null`, AND THE REASON IS THE TABLE, NOT AN
  //     OVERSIGHT. These routes hold the grant `engagement`, whose table is `booking`. Their real
  //     subjects are an `app_user` id (`hostId`, `src/booking/writes.mjs:46,131`) and an
  //     `availability_rule` id (`ruleId`, `:100`) — neither is a `booking` id, so neither can be
  //     resolved through this grant's own table. The forgery is closed either way (nothing reads
  //     `body.id` any more); what remains is that a Coach still needs `everything` here, exactly as
  //     before. Resolving a host's OWN calendar properly needs an owner-through-another-object
  //     mechanism (`OWNERSHIP.availability` already has `ridesOn: "engagement"` waiting for one),
  //     which is deliberately outside this fix — widening a grant is the direction that must not be
  //     guessed at.
  // ★★★ RUN-2 R1 (the maintainer RULED 26 Sep 2026: coaches book and set hours on their OWN calendar) — the
  //     owner-through-another-object mechanism is `host` (assertMay.mjs hostOwnerId): the owner is the
  //     host named by `hostId`, or the host of `ruleId`'s rule. subject stays null (no booking id).
  { path: "/api/engagements/availability", schema: ENGAGEMENT_SCHEMAS["/api/engagements/availability"],         section: "/engagements/booking",          fn: createAvailabilityRule,
    object: "engagement", action: "edit", subject: null, host: { field: "hostId" } },
  { path: "/api/engagements/availability/end", schema: ENGAGEMENT_SCHEMAS["/api/engagements/availability/end"],     section: "/engagements/booking",          fn: endAvailabilityRule,
    object: "engagement", action: "edit", subject: null, host: { field: "ruleId", table: "availability_rule" } },
  { path: "/api/engagements/date-overrides", schema: ENGAGEMENT_SCHEMAS["/api/engagements/date-overrides"],       section: "/engagements/booking",          fn: upsertDateOverride,
    object: "engagement", action: "edit", subject: null, host: { field: "hostId" } },
  // ★ ownerless `setting` (`ownership.mjs:144`) — no owner for any id to resolve to.
  { path: "/api/engagements/booking-policy", schema: ENGAGEMENT_SCHEMAS["/api/engagements/booking-policy"],       section: "/engagements/booking/settings", fn: setBookingPolicy,
    object: "setting", action: "edit", subject: null },
  // ★ the CREATE gap — 7.18's job, not this table's. F690: a CREATE has no existing booking.
  { path: "/api/engagements/bookings", schema: ENGAGEMENT_SCHEMAS["/api/engagements/bookings"],             section: "/engagements/calendar",         fn: createBooking, positional: true,
    object: "engagement", action: "edit", subject: null, host: { field: "hostId" } },
  // ★ BOOKING OVERHAUL, 29 Sep 2026 — same shape as the single-booking row above: a CREATE has no
  //   existing booking to ask about (F690), so `subject: null`, and the same `hostId` ownership gate.
  { path: "/api/engagements/bookings/recurring", schema: ENGAGEMENT_SCHEMAS["/api/engagements/bookings/recurring"], section: "/engagements/calendar", fn: createRecurringBookings, positional: true,
    object: "engagement", action: "edit", subject: null, host: { field: "hostId" } },
  // ★ `subject: null` — a series spans many `booking` rows, not one, so there is no single id for the
  //   coarse gate to re-ask about (same reasoning as the waitlist routes below).
  { path: "/api/engagements/bookings/recurring/cancel", schema: ENGAGEMENT_SCHEMAS["/api/engagements/bookings/recurring/cancel"], section: "/engagements/calendar", fn: cancelRecurringSeries,
    object: "engagement", action: "edit", subject: null },
  // ★★ STAGE 3 TASK 9 (R41 option A) — cancel and move, under the SAME section as creation: whoever may
  //    book a session may cancel or move one. Actor from the session only (F494), like every route here.
  // ★ checks `view` today — 7.18's job, not this table's.
  // ★ F690 — `bookingId` is a `booking` id, and `booking` IS `OWNERSHIP.engagement.table`, owned by
  //   `host_id`. These three already re-ask the real subject's scope INSIDE the handler
  //   (`lockVisibleBooking`, `src/booking/reschedule.mjs:38-47`); declaring it here makes the coarse
  //   gate ask about the same row instead of one the caller named.
  { path: "/api/engagements/bookings/cancel", schema: ENGAGEMENT_SCHEMAS["/api/engagements/bookings/cancel"],      section: "/engagements/calendar",         fn: cancelBookingByRequest,
    object: "engagement", action: "edit", subject: "bookingId" },
  { path: "/api/engagements/bookings/reschedule", schema: ENGAGEMENT_SCHEMAS["/api/engagements/bookings/reschedule"],  section: "/engagements/calendar",         fn: rescheduleBooking,
    object: "engagement", action: "edit", subject: "bookingId" },
  { path: "/api/engagements/participants", schema: ENGAGEMENT_SCHEMAS["/api/engagements/participants"],         section: "/engagements/calendar",         fn: addBookingParticipant,
    object: "engagement", action: "edit", subject: "bookingId" },
  // ★★★ F690 — `subject: null`, AND THE TEMPTING ANSWER HERE IS THE BUG ITSELF. `setAttendance` has
  //     TWO shapes (`src/booking/writes.mjs:331-345`): `{bookingId, outcome, participants}` and
  //     `{participantId, attended}`. In the PARTICIPANT shape `bookingId` is read by nothing — the
  //     UPDATE is `booking_participant WHERE id = participantId` (`:350-353`). So declaring
  //     `subject: "bookingId"` would re-create the exact forgery this fix closes: a Coach naming
  //     their own booking in `bookingId` while `participantId` points at a colleague's session.
  //     `participantId` cannot be declared either — it is a `booking_participant` id, not a
  //     `booking` id. Null until the route is split or the participant's booking is resolved first.
  { path: "/api/engagements/attendance", schema: ENGAGEMENT_SCHEMAS["/api/engagements/attendance"],           section: "/engagements/sessions",         fn: setAttendance,
    object: "engagement", action: "edit", subject: null },

  // ★ BOOKING OVERHAUL, 29 Sep 2026 — the Held/No-show confirmation modal's own route: records
  //   attendance exactly as `/api/engagements/attendance` above, then (only when no package credit
  //   already covers it) charges the card on file, sends an invoice, or spends a credit found at
  //   settle time — see src/booking/settleBooking.mjs. `subject: "bookingId"` is safe here (unlike
  //   the route above) because this body always names a real booking, never the ambiguous
  //   single-participant shape.
  { path: "/api/engagements/attendance/settle", schema: ENGAGEMENT_SCHEMAS["/api/engagements/attendance/settle"], section: "/engagements/sessions", fn: settleBooking,
    object: "engagement", action: "edit", subject: "bookingId" },

  // ★★★ 13.27a — CLOSING THE WIRING HOLE 13.12/13.14 MEASURED AND REPORTED: these three had no
  //     `ROUTES` entry, so `POST /api/engagements/waitlist*` did not exist. `subject: null` for the
  //     same reason as the availability rows above — the grant is `engagement` (table `booking`),
  //     but the real subject here is a `hostId`/`entryId`, neither of which is a `booking` id.
  { path: "/api/engagements/waitlist", schema: ENGAGEMENT_SCHEMAS["/api/engagements/waitlist"],             section: "/engagements/waitlist",         fn: addToWaitlist,
    object: "engagement", action: "edit", subject: null },
  { path: "/api/engagements/waitlist/remove", schema: ENGAGEMENT_SCHEMAS["/api/engagements/waitlist/remove"],      section: "/engagements/waitlist",         fn: removeFromWaitlist,
    object: "engagement", action: "edit", subject: null },
  { path: "/api/engagements/waitlist/offer", schema: ENGAGEMENT_SCHEMAS["/api/engagements/waitlist/offer"],       section: "/engagements/waitlist",         fn: offerTime,
    object: "engagement", action: "edit", subject: null },
  // ★★★ 13.27a — CLOSING THE WIRING HOLE 13.17 MEASURED AND REPORTED: `POST /api/engagements/blocks*`
  //     did not exist. `subject: null` — a block's real owner is `hostId` (an `app_user` id), not a
  //     `booking` id, same reasoning as availability above.
  // ★ `positional: true` (same knob `/api/engagements/bookings` already uses, :480) — `createBlock`
  //   (`src/booking/blocks.mjs:216-217`, MEASURED) requires `startsAt`/`endsAt` to be real `Date`
  //   instances and throws a `TypeError` otherwise; a JSON body carries them as strings. Without
  //   this, the 13.17 acceptance scenario's plain-JSON body (field 9) cannot reach 201.
  { path: "/api/engagements/blocks", schema: ENGAGEMENT_SCHEMAS["/api/engagements/blocks"],               section: "/engagements/calendar",         fn: createBlock, positional: true,
    object: "engagement", action: "edit", subject: null },
  { path: "/api/engagements/blocks/stop", schema: ENGAGEMENT_SCHEMAS["/api/engagements/blocks/stop"],          section: "/engagements/calendar",         fn: stopBlock,
    object: "engagement", action: "edit", subject: null },
  { path: "/api/engagements/blocks/skip", schema: ENGAGEMENT_SCHEMAS["/api/engagements/blocks/skip"],          section: "/engagements/calendar",         fn: skipBlockDay,
    object: "engagement", action: "edit", subject: null },
  // ★★★ 13.27a — CLOSING THE WIRING HOLE 13.22 MEASURED AND REPORTED: `POST /api/engagements/hours`
  //     did not exist. `subject: null` — `src/booking/hours.mjs:161`'s own comment names THIS task
  //     and THIS `subject: null` as the only place the per-row question is asked for this POST;
  //     `mayActOnHours` inside `setWeekHours` re-asks "your own hours" from `hostId`, an `app_user`
  //     id, not a `booking` id this grant's table can resolve.
  { path: "/api/engagements/hours", schema: ENGAGEMENT_SCHEMAS["/api/engagements/hours"],                section: "/engagements/calendar",         fn: setWeekHours,
    object: "engagement", action: "edit", subject: null },

  // ★★★ 13.27a's EIGHTH ENTRY, ADDED BY THE MAIN THREAD ONCE 13.16 LANDED (25 Sep 2026).
  //     13.27a correctly BLOCKED this one: the plan's field 4 tells it to import `setBookingFlag`
  //     from `../booking/writes.mjs`, and that export did not exist yet — it is 13.16's, appended
  //     after `setAttendance`. Importing a name that does not exist would have failed the module
  //     load for **every write route in the product**, the same class of breakage that took
  //     `tasks.mjs` down earlier tonight when a job was registered without its owner row.
  //   ★★ 13.16 has since landed: `setBookingFlag` is exported (MEASURED, `LOADS 10 export(s)`,
  //      up from 13.10's measured 9), so the import now resolves and the entry belongs here.
  //   ★★★ WITHOUT IT, `setBookingFlag` AND 13.28's `CalendarFlagModal` ARE BOTH BUILT AND WIRED TO
  //        NOTHING — failure #1, with the modal drawn and the write unreachable.
  //   ★ `subject: null`, matching every sibling above: the grant's scope question is re-asked
  //     inside the function against the booking's own host, and there is no owner this table can
  //     resolve a `booking` id to at route level.
  //   ★ **This was a plan ordering defect**: 13.27a's Needs column said `none` while its field 4
  //     depended on 13.16. Recorded in RUN-TRACKER.md so the next stage's plan check catches it.
  { path: "/api/engagements/bookings/flag", schema: ENGAGEMENT_SCHEMAS["/api/engagements/bookings/flag"],        section: "/engagements/calendar",         fn: setBookingFlag,
    object: "engagement", action: "edit", subject: null },

  // ── money ─────────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ F690 — EVERY MONEY ROW IS `subject: null`, AND NOT ONE OF THEM IS AN OVERSIGHT. All six
  //     hold the grant `invoice`, whose table is `invoice`. Their real subject fields are:
  //       · `createInvoice`  — a CREATE; no invoice exists yet (`src/money/writes.mjs:439`).
  //       · `createLineItem` — `parentId`, POLYMORPHIC over `parentType` ('invoice' | 'quote',
  //         `:105-115`). It is an invoice id only sometimes, and a `subject` that resolves on one
  //         request shape and silently not on another is the ambiguity this field exists to kill.
  //       · `createSubscription` — a CREATE (`:188`); `appUserId` is an `app_user` id.
  //       · `cancelSubscription` — `subscriptionId`, a `subscription` id (`:240`), not an invoice.
  //       · `createPaymentMethod` — `appUserId`, an `app_user` id (`:280`).
  //       · `createEntitlement`  — `ownerUserId`, an `app_user` id (`:339`).
  //     None is an id in `keystone.invoice`, so none can be resolved through this grant's own
  //     table. The forgery is closed regardless (nothing reads `body.id`); these six keep exactly
  //     the floor they already had — `scope: everything`, i.e. Owner/Admin. Widening money to a
  //     caseload scope is a decision, not a side effect of a permission-check repair.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  { path: "/api/money/invoices",             section: "/money/invoices",
    schema: INVOICE_SCHEMAS["/api/money/invoices"],
    // ★ T1.17/F783 — a new invoice is always a draft; a body `status` is ignored so the route
    //   cannot mint anything other than `draft` (the Stripe webhook path calls `createInvoice`
    //   directly, not through this row, and keeps passing its own explicit status).
    fn: (tx, body) => createInvoice(tx, { ...body, status: "draft" }),
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/line-items",           section: "/money/invoices",      fn: createLineItem,
    schema: INVOICE_SCHEMAS["/api/money/line-items"],
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/line-items/update",    section: "/money/invoices",      fn: updateLineItem,
    schema: INVOICE_SCHEMAS["/api/money/line-items/update"],
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/line-items/void",      section: "/money/invoices",      fn: voidLineItem,
    schema: INVOICE_SCHEMAS["/api/money/line-items/void"],
    object: "invoice", action: "edit", subject: null },
  // ★ `payment` rides on `invoice` (`ownership.mjs:132`).
  { path: "/api/money/payment-methods", schema: PAYMENT_SCHEMAS["/api/money/payment-methods"],      section: "/money/payments",      fn: createPaymentMethod,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/entitlements", schema: PAYMENT_SCHEMAS["/api/money/entitlements"],         section: "/money/subscriptions", fn: createEntitlement,
    object: "invoice", action: "edit", subject: null },

  // ★ Task 15.33 — money rows stay subject:null — same reasons as the block above
  { path: "/api/money/invoices/update",             section: "/money/invoices",      fn: updateInvoiceDraft,
    schema: INVOICE_SCHEMAS["/api/money/invoices/update"],
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/invoices/lines/order",       section: "/money/invoices",      fn: setLinePositions,
    schema: INVOICE_SCHEMAS["/api/money/invoices/lines/order"],
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/invoices/recompute",         section: "/money/invoices",      fn: recomputeDraftTotals,
    schema: INVOICE_SCHEMAS["/api/money/invoices/recompute"],
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/invoices/send",              section: "/money/invoices",      fn: sendInvoice,
    schema: INVOICE_SCHEMAS["/api/money/invoices/send"],
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/invoices/void",              section: "/money/invoices",      fn: voidInvoice,
    schema: INVOICE_SCHEMAS["/api/money/invoices/void"],
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/invoices/reminders/toggle",  section: "/money/invoices",      fn: toggleInvoiceReminders,
    schema: INVOICE_SCHEMAS["/api/money/invoices/reminders/toggle"],
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/payments/record", schema: PAYMENT_SCHEMAS["/api/money/payments/record"],            section: "/money/payments",
    fn: (tx, body) => body.invoiceId ? markPaidInvoice(tx, { ...body }) : recordManualPayment(tx, body),
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/payments/attach", schema: PAYMENT_SCHEMAS["/api/money/payments/attach"],            section: "/money/payments",      fn: attachPaymentToInvoice,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/refund", schema: PAYMENT_SCHEMAS["/api/money/refund"],                     section: "/money/payments",      fn: requestRefund,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/refund/approve", schema: PAYMENT_SCHEMAS["/api/money/refund/approve"],             section: "/money/payments",      fn: approveRefundRequest,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/refund/decline", schema: PAYMENT_SCHEMAS["/api/money/refund/decline"],             section: "/money/payments",      fn: declineRefundRequest,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/estimates", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/estimates"],                  section: "/money/estimates",     fn: createEstimate,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/estimates/update", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/estimates/update"],           section: "/money/estimates",     fn: updateEstimateDraft,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/estimates/send", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/estimates/send"],             section: "/money/estimates",     fn: sendEstimate,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/estimates/cancel", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/estimates/cancel"],           section: "/money/estimates",     fn: cancelEstimate,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/subscriptions/start", schema: SUBSCRIPTION_SCHEMAS["/api/money/subscriptions/start"],        section: "/money/subscriptions", fn: startClientSubscription,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/subscriptions/stripe", schema: SUBSCRIPTION_SCHEMAS["/api/money/subscriptions/stripe"],       section: "/money/subscriptions", fn: pushSubscriptionToStripe,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/subscriptions/stop", schema: SUBSCRIPTION_SCHEMAS["/api/money/subscriptions/stop"],         section: "/money/subscriptions", fn: cancelClientSubscription,
    object: "invoice", action: "edit", subject: null },
  // ★ Staff pausing on a client's behalf is not the client's own pause — force byClient false
  { path: "/api/money/subscriptions/pause", schema: SUBSCRIPTION_SCHEMAS["/api/money/subscriptions/pause"],        section: "/money/subscriptions", fn: (tx, body) =>
    pauseClientSubscription(tx, { ...body, byClient: false }),
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/subscriptions/resume", schema: SUBSCRIPTION_SCHEMAS["/api/money/subscriptions/resume"],       section: "/money/subscriptions", fn: resumeClientSubscription,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/subscriptions/update-card", schema: SUBSCRIPTION_SCHEMAS["/api/money/subscriptions/update-card"],  section: "/money/subscriptions", fn: requestCardUpdate,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/subscriptions/remove-discount", schema: SUBSCRIPTION_SCHEMAS["/api/money/subscriptions/remove-discount"],  section: "/money/subscriptions", fn: removeSubscriptionDiscount,
    object: "invoice", action: "edit", subject: null },
  // ★ P3.S8 — Remove a saved card. object:"person" per the row spec: the card belongs to the
  //   person, not an invoice — this is not a money-object row like the ones around it.
  { path: "/api/money/payment-methods/detach", schema: PAYMENT_SCHEMAS["/api/money/payment-methods/detach"], section: "/money/subscriptions", fn: detachPaymentMethod,
    object: "person", action: "edit", subject: null },
  { path: "/api/money/payment-plans/offer", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/payment-plans/offer"],        section: "/money/invoices",      fn: offerPaymentPlan,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/payment-plans/agree", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/payment-plans/agree"],        section: "/money/invoices",      fn: agreePaymentPlan,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/payment-links", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/payment-links"],              section: "/money/payment-links", fn: createPaymentLink,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/payment-links/deactivate", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/payment-links/deactivate"],   section: "/money/payment-links", fn: deactivatePaymentLink,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/terminal/intent", schema: TERMINAL_SCHEMAS["/api/money/terminal/intent"],            section: "/money/virtual-terminal", fn: createTerminalIntent,
    object: "invoice", action: "edit", subject: null },
  // ★★★ TASK 20.70 — Four Stripe Terminal reader actions. All require coach with money capability
  //     (verified in the handler); movesMoney TRUE on process/refund, FALSE on cancel/display.
  //     The attempt-emitted-first order holds: charge.attempted emitted BEFORE the call, and
  //     ChargePathDisabled fires while the flag is off, which the screen surfaces honestly.
  { path: "/api/money/terminal/process", schema: TERMINAL_SCHEMAS["/api/money/terminal/process"],            section: "/money/payments",         fn: processPaymentIntent,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/terminal/cancel", schema: TERMINAL_SCHEMAS["/api/money/terminal/cancel"],             section: "/money/payments",         fn: cancelAction,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/terminal/display", schema: TERMINAL_SCHEMAS["/api/money/terminal/display"],            section: "/money/payments",         fn: setReaderDisplay,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/terminal/refund", schema: TERMINAL_SCHEMAS["/api/money/terminal/refund"],             section: "/money/payments",         fn: refundPayment,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/tap/activate", schema: TERMINAL_SCHEMAS["/api/money/tap/activate"],               section: "/money/payments",      fn: activateTapToPay,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/tap/connection-token", schema: TERMINAL_SCHEMAS["/api/money/tap/connection-token"],       section: "/money/payments",      fn: createConnectionToken,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/tap/intent", schema: TERMINAL_SCHEMAS["/api/money/tap/intent"],                 section: "/money/payments",      fn: createTapIntent,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/devices/register", schema: TERMINAL_SCHEMAS["/api/money/devices/register"],           section: "/settings/money",      fn: registerReader,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/devices/deactivate", schema: TERMINAL_SCHEMAS["/api/money/devices/deactivate"],         section: "/settings/money",      fn: deactivateDevice,
    object: "invoice", action: "edit", subject: null },
  // ★ P3.S12 — rename a reader (Stripe label + local row); "/settings/money" section to match
  //   the two devices rows immediately above (there is no registered "/money/devices" nav section).
  { path: "/api/money/devices/rename", schema: TERMINAL_SCHEMAS["/api/money/devices/rename"],             section: "/settings/money",      fn: renameDevice,
    object: "setting", action: "edit", subject: null },
  { path: "/api/money/stripe/component-session", schema: TERMINAL_SCHEMAS["/api/money/stripe/component-session"],   section: "/money/payments",      fn: createComponentSession,
    object: "invoice", action: "view", subject: null },
  { path: "/api/money/disputes/evidence", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/disputes/evidence"],          section: "/money/disputes",      fn: stageDisputeEvidence,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/disputes/accept", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/disputes/accept"],            section: "/money/disputes",      fn: acceptDispute,
    object: "invoice", action: "edit", subject: null },

  // ★★ TASK 20.61 — MORE-ACTIONS MENU FOR INVOICES AND DISPUTES
  // ★ mark-paid: records payment offline, marks status paid, calls Stripe if present
  { path: "/api/money/invoices/mark-paid",        section: "/money/invoices",      fn: markPaidInvoice,
    schema: INVOICE_SCHEMAS["/api/money/invoices/mark-paid"],
    object: "invoice", action: "edit", subject: null },
  // ★ mark-uncollectible: bad debt, status transition from open only (draft/paid → 409)
  { path: "/api/money/invoices/mark-uncollectible", section: "/money/invoices",    fn: markUncollectibleInvoice,
    schema: INVOICE_SCHEMAS["/api/money/invoices/mark-uncollectible"],
    object: "invoice", action: "edit", subject: null },
  // ★ duplicate: copies row and lines to DRAFT with fresh number, NO stripe id
  { path: "/api/money/invoices/duplicate",        section: "/money/invoices",      fn: duplicateInvoice,
    schema: INVOICE_SCHEMAS["/api/money/invoices/duplicate"],
    object: "invoice", action: "edit", subject: null },
  // ★ close-dispute: concedes with typed confirmation, state set to lost
  { path: "/api/money/disputes/close", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/disputes/close"],            section: "/money/disputes",      fn: closeDispute,
    object: "invoice", action: "edit", subject: null },

  { path: "/api/money/bank-verify-session", schema: PAYMENT_SCHEMAS["/api/money/bank-verify-session"],        section: "/money/payments",      fn: createFinancialConnectionsSession,
    object: "invoice", action: "edit", subject: null },

  // ★★★ TASK 20.66 — CUSTOMER CREDIT ADJUSTMENTS
  // ★ Admin only: adjusting credit is not a coach action. The adjust route requires a note
  //   (audit trail). The list route is for reading the ledger.
  { path: "/api/money/credits/adjust", schema: PAYMENT_SCHEMAS["/api/money/credits/adjust"],             section: "/money/payments",      fn: adjustCredit,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/credits/list",               section: "/money/payments",      fn: listCreditEntries,
    object: "invoice", action: "view", subject: null },
  // ★ P3.S10 — Cancel a pending refund (Stripe cancels only refunds still in requires_action).
  { path: "/api/money/refunds/cancel", schema: PAYMENT_SCHEMAS["/api/money/refunds/cancel"],             section: "/money/payments",      fn: cancelRefund,
    object: "invoice", action: "edit", subject: null },
  // ★ P3.S11 — Approve a held payment (Stripe Radar review).
  { path: "/api/money/fraud/approve", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/fraud/approve"],              section: "/money/payments",      fn: approveFraudReview,
    object: "dispute", action: "edit", subject: null },

  // ── credit notes · task 20.62 ─────────────────────────────────────────────────
  // ★ Admin only: issuing and voiding credit notes. Destinations: refund (0434 approval path),
  //   credit (20.66 ledger), out_of_band (record only). Over-credit 409 with remaining.
  { path: "/api/money/credit-notes/issue", schema: PAYMENT_SCHEMAS["/api/money/credit-notes/issue"],        section: "/money/invoices",      fn: issueCreditNote,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/money/credit-notes/void", schema: PAYMENT_SCHEMAS["/api/money/credit-notes/void"],         section: "/money/invoices",      fn: voidCreditNote,
    object: "invoice", action: "edit", subject: null },

  // ── tax identities · task 20.65 ────────────────────────────────────────────────
  // ★ Tax IDs belong to payer accounts or business persons. The CLIENT APP NEVER WRITES
  //   a tax ID — there is no client-facing route for it, deliberately. Admin only.
  { path: "/api/tax-ids", schema: PAYMENT_SCHEMAS["/api/tax-ids"],                         section: "/money/invoices",      fn: createTaxId,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/tax-ids/update", schema: PAYMENT_SCHEMAS["/api/tax-ids/update"],                  section: "/money/invoices",      fn: updateTaxId,
    object: "invoice", action: "edit", subject: null },
  { path: "/api/tax-ids/delete", schema: PAYMENT_SCHEMAS["/api/tax-ids/delete"],                  section: "/money/invoices",      fn: deleteTaxId,
    object: "invoice", action: "edit", subject: null },

  // ── money · apply/remove coupon (Task 20.64) ───────────────────────────────
  // ★ Apply or remove a coupon from a person. The coupon appears on the person's
  //   next subscription create. `object: "discount", action: "edit"` — same pair as
  //   the coupon creation and management routes (`/api/items/coupons*`).
  //   Both use POST; the DELETE method was removed in favour of POST idiom.
  { path: "/api/money/coupons/:couponId/apply-to-person", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/coupons/:couponId/apply-to-person"],     section: "/money/invoices",      fn: applyPersonCoupon,
    object: "discount", action: "edit", subject: null },
  { path: "/api/money/coupons/:couponId/remove-from-person", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/coupons/:couponId/remove-from-person"],  section: "/money/invoices",      fn: removePersonCoupon,
    object: "discount", action: "edit", subject: null },

  // ── P3.S1 — delete a draft invoice ──────────────────────────────────────────
  // ★ Only a draft can be deleted (409 otherwise). Archived, never hard-deleted (P2.9).
  { path: "/api/money/invoices/delete-draft",     section: "/money/invoices",      fn: deleteDraftInvoice,
    schema: INVOICE_SCHEMAS["/api/money/invoices/delete-draft"],
    object: "invoice", action: "edit", subject: null },

  // ── P3.S7 — cancel a payment plan ───────────────────────────────────────────
  // ★ Releases the Stripe subscription schedule (paymentPlans.mjs:508) and marks the
  //   plan cancelled; emits money.payment_plan.cancelled.
  { path: "/api/money/payment-plans/cancel", schema: CATALOGUE_AND_LINK_SCHEMAS["/api/money/payment-plans/cancel"],      section: "/money/invoices",      fn: cancelPaymentPlan,
    object: "invoice", action: "edit", subject: null },

  // ── archive · P2.9 ────────────────────────────────────────────────────────
  // ★★★ ONE ROUTE FOR ALL NINE OBJECTS, because the DECISION is one decision. Nine endpoints would
  //     re-derive "archive, never delete" nine times and diverge the same way nine per-object
  //     archive functions would. The `object` travels in the body and is checked against the frozen
  //     `ARCHIVABLE` map, which THROWS on a name it does not know (F163's lesson, applied).
  //   ★★ `record.archive`/`record.restore` are NAMED ACTIONS (`assertMay.mjs`'s `NAMED_ACTIONS`),
  //      granted to Admin and Owner and not to Coach — archiving removes a record from every list in
  //      the practice; a coach deciding a client is gone is a conversation, not a permission.
  //   ★ Its `section` is /people because that is where the control lands first (P6.3). The
  //     authorisation is the GRANT; the section names which screen the route belongs to.
  // ★ 7.1: the object is NOT static here — it travels in the body and is resolved through
  //   `ARCHIVABLE` (`src/records/archive.mjs:31`) then `permissionObjectFor` (`ownership.mjs:252`),
  //   never one of the 21 names directly. `objectFromBody: true` records that, in place of a
  //   static `object`; 7.12a is what makes it an enforcement input, not this table.
  { path: "/api/records/archive", schema: RECORD_SCHEMAS["/api/records/archive"],            section: "/people/all",             fn: archiveRecord,
    objectFromBody: true, action: "record.archive" },
  { path: "/api/records/restore", schema: RECORD_SCHEMAS["/api/records/restore"],            section: "/people/all",             fn: restoreRecord,
    objectFromBody: true, action: "record.restore" },
  // ── delete · QUEUE §3 A (the maintainer, 2 Oct 2026) ──────────────────────────────────
  // ★★★ THE ONE DELETE ROUTE. `object` travels in the body and is checked against `DELETABLE`
  //     (src/records/delete.mjs), which THROWS on a name it does not know. The cascades are the DATABASE's
  //     (migration 0581); this route only says which record types exist. Gated by `record.archive` — Owner and
  //     Admin hold it, Coach does not — so "who may archive may delete", with no second grant to drift.
  //     Without `confirm: true` it returns the PLAN (what else goes, what blocks) for the confirm dialog.
  { path: "/api/records/delete", schema: RECORD_SCHEMAS["/api/records/delete"],                section: "/people/all",             fn: deleteRecord,
    objectFromBody: true, action: "record.archive" },

  // ── bulk · QUEUE §13.3 (the maintainer, 2 Oct 2026) ───────────────────────────────────
  // ★ ONE route for bulk Delete / Archive / Restore on any list: `object` + `ids` in the body, each id independent, the result lists successes AND
  //   refusals. It runs the single-record functions above, so every rule is theirs. Same gate as delete/archive (`record.archive`: Owner/Admin) for all
  //   three actions — restore needs no softer gate than the archive it undoes.
  { path: "/api/records/bulk", schema: RECORD_SCHEMAS["/api/records/bulk"],                    section: "/people/all",             fn: bulkRecords,
    objectFromBody: true, action: "record.archive" },

  // ── records · custom fields ───────────────────────────────────────────────
  // ★ Custom field value write. `object: "setting", action: "edit"` — setting a value on a record
  //   is a data edit for the practice, and the per-record scope question is answered by
  //   setCustomFieldValue's own predicate (via RLS on the value table).
  { path: "/api/records/custom-field-value", schema: RECORD_SCHEMAS["/api/records/custom-field-value"],             fn: setCustomFieldValue,
    object: "setting", action: "edit", subject: null },

  // ── notifications ─────────────────────────────────────────────────────────
  // ★ ownerless `setting` — no owner for any id to resolve to (F690).
  { path: "/api/notifications", schema: SETTINGS_SCHEMAS["/api/notifications"],              section: "/settings/notifications", fn: createNotification,
    object: "setting", action: "edit", subject: null },
  // own row: scope `owned` suffices — 7.12a's enforcement, not this table's.
  // ★★ F690 — `appUserId` IS an `app_user` id (`OWNERSHIP.person.table`), and a staff row owns
  //    itself (`app_user_staff_owns_self_trg`, 0071), so a Coach's own preference now resolves to
  //    the Coach and the `owned` scope carries it — which is what "own row" above always claimed.
  //    Naming somebody else is still refused by `setNotificationPreference`'s own second check
  //    (`src/notifications/writes.mjs:143-147`, the F282 fix): that stays the real authority.
  { path: "/api/notifications/preferences", schema: SETTINGS_SCHEMAS["/api/notifications/preferences"],  section: "/settings/mine", fn: setNotificationPreference,
    object: "person", action: "edit", subject: "appUserId" },
  // ★★ F690 — `subject: null`: `markNotificationRead` acts on `notificationId`
  //    (`src/notifications/writes.mjs:275`), a `notification` id, not an `app_user` id, and
  //    `notification` is not a permission object. Its `recipient_id = $2` predicate (`:293-295`,
  //    the F277 fix) is the real per-row authority and is untouched here.
  // ★★★ F775 — `/settings/mine`, NOT `/settings/notifications`: that section inherits `/settings`' ADMIN floor, so a
  //     Team member was refused marking THEIR OWN notification read while the bell showed it to them. The write
  //     acts on the caller's own row only (recipient_id predicate) — the same shape as /preferences above.
  { path: "/api/notifications/read", schema: SETTINGS_SCHEMAS["/api/notifications/read"],         section: "/settings/mine", fn: markNotificationRead,
    object: "person", action: "edit", subject: null, host: { field: "notificationId", table: "notification" } },
  // ★★★ TASK 6.3 (06-settings.md §2.3) — the PRACTICE's own default, not a person's. `section:
  //     "/settings/notifications"` inherits the admin-only floor `/settings` itself declares
  //     (`src/nav/sections.mjs:50`, `src/nav/authorise.mjs:70-84`'s child-inherits-parent rule) —
  //     no extra rank code is needed here, unlike the two person-scoped routes above.
  //   ★ `object: "setting", action: "edit"` — the SAME pair `POST /api/notifications` (createNotification,
  //     directly above) already uses; this is a setting write like that one, not a new permission shape.
  { path: "/api/settings/notifications/rule", schema: SETTINGS_SCHEMAS["/api/settings/notifications/rule"], section: "/settings/notifications", fn: setNotificationRule,
    object: "setting", action: "edit", subject: null },

  // ── notifications · wave 2.1 (mark all read, send test) ───────────────────
  // ★ `subject: null` — a bulk action over "all my unread notifications", no single object. Acts on
  //   the caller's own account only (recipient_id predicate in the write function).
  { path: "/api/notifications/read-all", schema: SETTINGS_SCHEMAS["/api/notifications/read-all"],  section: "/settings/mine", fn: markAllNotificationsRead, // F775
    object: "person", action: "edit", subject: null, self: true },
  // ★ `subject: null` — acts on the caller's own account only, creating a test notification for
  //   verification. No single target object to resolve permission against.
  { path: "/api/notifications/test", schema: SETTINGS_SCHEMAS["/api/notifications/test"],      section: "/settings/mine", fn: sendTestNotification, // F775
    object: "person", action: "edit", subject: null, self: true },

  // ── growth · landing pages (C3.2) ─────────────────────────────────────────
  // ★ `subject: null` on create — no existing landing page yet to inherit an owner from.
  { path: "/api/growth/pages", schema: GROWTH_SCHEMAS["/api/growth/pages"],            section: "/growth/pages",           fn: createLandingPage,
    object: "setting", action: "edit", subject: null },
  // ★ `subject: "landingPageId"` — updateLandingPage reads and updates the landing_page by id.
  { path: "/api/growth/pages/update", schema: GROWTH_SCHEMAS["/api/growth/pages/update"],     section: "/growth/pages",           fn: updateLandingPage,
    object: "setting", action: "edit", subject: "landingPageId" },
  // ★ `subject: "landingPageId"` — deleteLandingPage deletes the landing_page by id.
  { path: "/api/growth/pages/delete", schema: GROWTH_SCHEMAS["/api/growth/pages/delete"],     section: "/growth/pages",           fn: deleteLandingPage,
    object: "setting", action: "edit", subject: "landingPageId" },
  // ★ `subject: "landingPageId"` — draftLandingPageCopy writes to growth_ai_request for the landing page.
  { path: "/api/growth/pages/draft", schema: GROWTH_SCHEMAS["/api/growth/pages/draft"],      section: "/growth/pages",           fn: draftLandingPageCopy,
    object: "setting", action: "edit", subject: "landingPageId" },
  // ★ `subject: "landingPageId"` — publishLandingPage moves the draft to published on the landing page.
  { path: "/api/growth/pages/publish", schema: GROWTH_SCHEMAS["/api/growth/pages/publish"],    section: "/growth/pages",           fn: publishLandingPage,
    object: "setting", action: "edit", subject: "landingPageId" },

  // ── task 14.41 — every Stage 14 write row, one spread ──────────────────────
  // ★ L1.5.stage14 — each Stage 14 row gets its body schema here, by path, without editing the 12 route files
  //   that hold them (test/f20_30_coupon_routes.test.mjs:44 regex-parses EDITOR_WRITES' source).
  ...STAGE14_WRITES.map((row) => (STAGE14_SCHEMAS[row.path] ? { ...row, schema: STAGE14_SCHEMAS[row.path] } : row)),
]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ F690 — THE ROUTE THAT FORGETS TO DECLARE ITS SUBJECT MUST NOT START, LET ALONE GUESS.
//
//     The defect this closes was not that `body.id` was the WRONG field for 24 routes. It was that
//     a route could say NOTHING about its subject and the dispatcher would answer anyway, from a
//     field the caller controls. Deleting the fallback without this check would only move the
//     failure: a new verb route with no `subject` would resolve `null` forever and look like a
//     working permission check while refusing every Coach — the "built and wired to nothing" shape,
//     pointed at the permission axis.
//   ★★ SO IT THROWS AT MODULE LOAD, NOT AT REQUEST TIME. `src/http/app.mjs` imports this file, so a
//      missing declaration is a start-up failure with the route's own path in the message — noticed
//      by whoever added the route, rather than by a Coach months later.
//   ★ ONLY VERB ROUTES. A `NAMED_ACTIONS` action (`record.archive`, `team.invite`, …) is a flat
//     capability question — `keystone.role_action`, no scope, no owner, no subject to resolve
//     (`assertMay.mjs`'s first branch returns before `subjectIdFor` is ever reached). Declaring a
//     `subject` on one would be a field nothing reads, so it is refused too: this table says what
//     is true or it says nothing at all.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ EXPORTED so a test can run it RED-FIRST against a fixture route that forgets its `subject` and
//   GREEN against the same fixture with one — a check nobody can see fail is not a check.
export function assertVerbRoutesDeclareASubject(routes) {
  const missing = [];
  const surplus = [];
  for (const r of routes) {
    const asksAVerb = !r.platform && !r.signer && r.action != null && !NAMED_ACTIONS.includes(r.action);
    const declared = Object.prototype.hasOwnProperty.call(r, "subject");
    if (asksAVerb && !declared) missing.push(r.path);
    if (!asksAVerb && declared) surplus.push(r.path);
    if (declared && r.subject !== null && (typeof r.subject !== "string" || r.subject === "")) {
      throw new Error(
        `ROUTES: ${r.path} declares subject ${JSON.stringify(r.subject)} — it must be the NAME of ` +
        `the body field carrying the row's id, or null.`);
    }
  }
  if (missing.length) {
    throw new Error(
      `ROUTES: ${missing.length} verb route(s) declare no \`subject\`: ${missing.join(", ")}. ` +
      `★ Name the body field the HANDLER reads as the row it acts on — and it must carry an id of ` +
      `a row in that object's own table (person→app_user, account→account, engagement→booking, ` +
      `document→document_instance, invoice→invoice). If there is no such field (a create, a bulk ` +
      `action, an ownerless object, or an id in some other table), write \`subject: null\` and say ` +
      `why. There is no default: guessing \`body.id\` is the F690 forgery this check exists to stop.`);
  }
  if (surplus.length) {
    throw new Error(
      `ROUTES: ${surplus.length} route(s) declare a \`subject\` that nothing will read: ` +
      `${surplus.join(", ")}. Only a view/edit/delete route resolves an owner; a NAMED_ACTIONS ` +
      `action, a platform route and a signer route all answer a different question.`);
  }
  return routes;
}
assertVerbRoutesDeclareASubject(ROUTES);

// ★ CT-006 — ONE constant read by BOTH the stored idempotency status (`runTenantScoped`'s `status` option) and
//   the response below, so the status a replay returns cannot diverge from the one the first call answered.
const WRITE_STATUS = 201;

// ★ TASK 8.12 — the deployment's own domain, never hardcoded; the SAME read `src/auth/login.mjs:29`
//   and `src/routes/settings.mjs:117` already use, for the SAME reason (an invite's accept link
//   must hang off this practice's real subdomain, on whichever deployment is running).
const appDomain = () => process.env[APP_DOMAIN_VAR] || "example.com";

// ★★★ Q7-2 — THE SIGNER PATH. A signer has no session; the presented link-token string is the ONLY
//     credential, carried in the body as `presented` (the codebase's one idiom for a presented secret
//     — CONTRACTS §5's redaction list already names `presented` alongside `token`/`secret`/`apiKey`).
//     `redeemLinkToken` is TENANT-LESS BY DESIGN — it PRODUCES the tenant (`src/auth/linkToken.mjs
//     :261-263`), so the redeemed tenant is checked here against the tenant this transaction is
//     already scoped to; a link minted for one practice must not spend against another's.
// ★ SAME REFUSAL, EVERY CAUSE (Q7-2's reconciliation: `linkToken.mjs`'s own decision 2, restated —
//   `LINK_TOKEN_REFUSED` itself is not exported, so this is the identical literal, mirrored, never
//   imported, the same idiom `RANK_ORDER` used for `authorise.mjs`'s `RANK` before this task). This is
//   a DELIBERATE exception to this file's own `forbidden`-vs-`outOfScope` rule below: every refusal on
//   this path is `forbidden`, 403, never `not_found` — an enumeration-oracle defense.
const SIGNER_LINK_REFUSED =
  "That link is not valid. It may have been used already, expired, or been cancelled — ask for a new one.";

// ★ REFRESH NOTE FOR THE NEXT TASK/STAGE, LEFT HERE RATHER THAN GUESSED AWAY: `runTenantScoped`
//   (`src/http/app.mjs:625-626`) and `resolvePrincipal` (`src/auth/install.mjs:50-52`) both require an
//   already-resolved principal (a bearer token or `ks_session` cookie) before ANY write-route handler
//   — including this one — runs, and neither file is in 7.12a's list (STAGE-7-PLAN.md field 2). A
//   genuinely anonymous signer (Q7-2's own example: "a client opens an email on a phone with no
//   cookie") therefore cannot reach this function's four routes through that path TODAY. The check
//   below is the correct authorisation for a signer link once the route is reachable; the
//   reachability gap itself is OUTSIDE this task's file list and is reported, not fixed, here.
async function assertSignerForInstance(db, principal, body) {
  const redeemed = await redeemLinkToken(body?.presented, ["document_signature"]);
  const { rows } = await db.query("SELECT keystone.current_tenant_id() AS id");
  if (redeemed.tenantId !== rows[0]?.id) throw forbidden(SIGNER_LINK_REFUSED);
  // ★ THE SUBJECT THE LINK NAMES, NEVER ONE THE BODY CLAIMS — the same F494 reasoning `args`'s
  //   `actorUserId` follows below, extended to the signer's own identity. `redeemed.subjectId` is
  //   always a `document_instance` id (`PURPOSE_SUBJECT_TYPE.document_signature`, `linkToken.mjs
  //   :106-110` — the only registered purpose today); `redeemed.issuedTo` is who the link was minted
  //   for. Both OVERWRITE whatever the body claimed, rather than merely checking it, for the same
  //   reason `tenantId`/`actorUserId` are set last in `args` below — a caller-supplied value must
  //   never be the one that ends up trusted.
  body.instanceId = redeemed.subjectId;
  if (redeemed.issuedTo != null) body.appUserId = redeemed.issuedTo;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 8.12 / F626 gap 2 — THE COACH-MAY-INVITE-A-CLIENT-NOT-STAFF SPLIT.
//     `assertMay(db, principal, route, body)` (below, in `registerWriteRoutes`) gates this route on
//     the row's ONE static `action` — `team.invite` — before `fn` ever runs, and cannot see
//     `body.role`. Migration 0226 grants `coach` that SAME existing action (owner/admin already
//     hold it, 0190:220,226), so the route-level gate now clears for a Coach inviting EITHER a
//     client or a staff member. The STAFF case still needs a rank a Coach never holds — that is
//     asked here, a SECOND time, against a DIFFERENT existing named action, only when it is
//     actually staff being invited. Same "coarse route gate, sharper in-module check on the SAME
//     real permission" idiom `src/booking/createBooking.mjs:149-154` (task 7.18) already uses.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Only the STAFF case needs the extra question — team.invite (checked at the route gate, above,
// before this ever runs) already answers "may this role invite at all"; staff_role.change
// (owner/admin only, 0190:220,226) answers "may this role hand out a STAFF rank", which is what
// inviting someone AS STAFF does. A raw staff_role string comparison would resurrect the
// two-ladder defect Q0-7 closed — this asks the SAME assertMay the route already trusts.
async function assertMayInviteAsRole(db, actorUserId, role) {
  if (role !== "staff") return;
  // A synthetic principal carrying only `appUserId` — the one field assertMay reads
  // (assertMay.mjs:97). `actorUserId` is already the session's own id (never the body),
  // per this file's own `args` construction below.
  await assertMay(db, { appUserId: actorUserId }, { action: "staff_role.change" });
}

/**
 * ★ F632 FIX (task 8.14b) — the tenant/actor lookup and the invite send, factored out of
 *   `inviteWithRoleCheck` so the RESEND branch below can send the identical email without a second,
 *   drifting copy of the same four queries.
 * ★ the maintainer, 29 Sep 2026 — NOW BRANCHES BY ROLE. A staff invite is unchanged (`auth.invite`, via
 *   `sendAuthEmail` — see that sender's own header for why sign-in mail is never tenant-routable).
 *   A CLIENT invite (`role !== "staff"`) sends the CLIENT-worded, Growth-Templates-editable
 *   `auth.client_invite` instead, via `sendClientInviteEmail` — that file's header explains the one
 *   deliberate difference (a tenant override can win) and the one thing that deliberately did not
 *   change (the transport, and why).
 */
async function sendInviteEmail(db, { tenantId, actorUserId, email, presented, expiresAt, message = null, role = "staff" }) {
  const { rows: tenantRows } = await db.query(
    `SELECT slug, name FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const tenant = tenantRows[0] ?? {};
  // ★ FIX, 1 Oct 2026 (an example organisation brand brief) — the maintainer flagged live: the team-invite email
  //   still said "an example organisation Recovery Services" (the LEGAL tenant name, `tenant.name` above) —
  //   this is the one real send path for it (sendAuthEmail("auth.invite"), NOT the generic
  //   notification pipeline: `people.person.invited` has no listener at all). Same preference as
  //   every other fix in this brief (sendDocument.mjs, signLinks.mjs, src/routes/app.mjs): the
  //   `practice.name` setting (the brand) wins when a practice has set one.
  const practiceName = (await getSetting(db, "practice.name", null)) || tenant.name || "";
  // a Docustay workspace is accepted in the Docustay app (its own /invite page), never on a the platform address (found 9 Oct 2026: the link pointed at <slug>.example.com)
  const { rows: prod } = await db.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const docustayBase = prod[0]?.product === "docustay" ? String(process.env.KEYSTONE_DOCUSTAY_APP_URL ?? process.env.KEYSTONE_PUBLIC_URL ?? "").replace(/\/+$/, "") : "";
  const acceptUrl = `${/^https?:\/\//i.test(docustayBase) ? docustayBase : `https://${tenant.slug}.${appDomain()}`}/invite?token=${encodeURIComponent(presented)}`;
  // Run 10 (R10-20): a Docustay invitation says the date in words ("October 21, 2026"), not the JavaScript form ("Wed Oct 21 2026"); the platform's wording is unchanged
  const isDocustay = prod[0]?.product === "docustay";
  const expiresOn = isDocustay ? new Date(expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : new Date(expiresAt).toDateString();
  // ★ Task 12.14 (OQ-12.8) — "A line from you", optional. Absent rather than a stray blank line:
  //   the same "" idiom `booking.reminder`'s own `creditStanding` var uses for an optional extra
  //   the template only prints when truthy.
  const personalLine = message ?? "";

  if (role === "staff") {
    const { rows: actorRows } = await db.query(
      `SELECT display_name FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`,
      [actorUserId, tenantId]);
    await sendAuthEmail({
      to: email,
      templateKey: "auth.invite",
      vars: {
        practiceName,
        productName: prod[0]?.product === "docustay" ? "Docustay" : "Workbench",
        // a Docustay owner is named after the workspace until they set a name: "X has invited you to join X" says nothing, so say who it is in words
        inviterName: (isDocustay && (!actorRows[0]?.display_name || actorRows[0].display_name === practiceName)) ? "A teammate" : (actorRows[0]?.display_name ?? ""),
        acceptUrl, expiresOn, personalLine,
      },
      // ★ FIX, 1 Oct 2026 (Part 2 Addition, F844) — the one named gap: a staff invite's wording was
      //   editable in Run → Templates but the edit was never read. `db` here IS the withTenant
      //   handle `inviteWithRoleCheck`/its resend branch already run inside; threading it through
      //   makes `sendAuthEmail` take the SAME resolveTemplate(tx, tenantId, key) path
      //   `sendClientInviteEmail` already uses for the client-invite sibling just below.
      tx: db, tenantId,
    });
    return;
  }

  await sendClientInviteEmail({
    tx: db, tenantId, to: email, displayName: practiceName || null,
    vars: { practiceName, acceptUrl, expiresOn, personalLine },
  });
}

/**
 * `/api/people/invite`'s handler (task 8.12). Creates the person row, then the invite row and its
 * link token (8.6's `createInvite`, F612/CT-019), then sends the invitation email (8.10's
 * `sendAuthEmail`, template `auth.invite`) — all in the SAME tenant transaction `db` already is.
 * ★ `role === 'staff'` goes through `inviteTeamMember` (`src/people/writes.mjs:478-497`, MEASURED —
 *   it hardcodes `role: 'staff'` and takes no `role` parameter of its own, so it cannot serve the
 *   other three roles `createInvite`/Q8-6 admit). Every other role calls `createPerson` (already
 *   imported above) directly, with the body's own `role` — the SAME primitive `inviteTeamMember`
 *   itself calls underneath, generalised the way Q8-6's "client and parent invitations use the
 *   same endpoint" requires. Both paths create the person and emit `people.person.invited` in one
 *   transaction — the one durable "an invitation was extended" fact either way.
 */
/**
 * `/api/people/check-duplicate` handler. Checks for a possible duplicate person before creation.
 * Returns { possible: null } if no match, or { possible: { id, display_name, email, mobile_phone, matchedOn } }
 * if a match is found. This is a read-shaped POST, callable before creating a person.
 */
// ★★ `excludePersonId` forwarded 25 Sep 2026 by the coordinator, after Stage 12 task 12.12 landed.
//   12.12 gave `findPossibleDuplicate` a dismissal filter and a self-exclusion, both keyed on
//   `excludePersonId` — but this handler, the ONLY HTTP caller, did not pass it, so over the wire
//   the filter could never fire: dismiss a suggested pair and `/api/people/check-duplicate` would
//   go on suggesting it forever. That is the "built and wired to nothing" failure — the module
//   works, its own test passes, and the one caller never supplies the input.
//   12.12's builder measured this and reported it rather than editing a handler outside its scope,
//   which was right; the forward is one parameter and belongs here.
async function checkDuplicatePerson(db, { tenantId, displayName, email, mobilePhone,
                                          excludePersonId = null }) {
  const possible = await findPossibleDuplicate(db, {
    tenantId,
    displayName,
    email,
    mobilePhone,
    excludePersonId,
  });

  return { possible };
}

async function inviteWithRoleCheck(db, { tenantId, email, displayName, phone = null, role = "staff",
                                          staffRole = "member", childUserId = null,
                                          personId = null, actorUserId = null, message = null }) {
  // ★ Part 29 (A7-4): inviting a colleague (staff) into a Docustay workspace is the Pro item "team roles"; a workspace on Free has one user, the owner. Organisations on no Docustay plan are never limited by this.
  if (role === "staff") await assertEntitled(db, { tenantId, item: "team_roles" });
  // ★ Task 12.14 (OQ-12.8) — TeamInvite's "A line from you", optional, ≤500 characters after trim.
  //   Refused up front, before either branch below runs, same as every other body-shape check in
  //   this file (`invalid`, never a silent truncation).
  if (message !== null && (typeof message !== "string" || message.trim().length > 500)) {
    throw invalid("keep the note under 500 characters", { field: "message" });
  }

  // ★★★ F632 FIX (task 8.14b) — RESEND. `personId` is present ONLY on the resend call (8.15's "Send
  //   an invitation" dialog on an EXISTING person); a plain create's body never carries one. Same
  //   route, same `team.invite` route-level gate (registerWriteRoutes, unedited) — this branch asks
  //   the SAME staff-only second question `assertMayInviteAsRole` already asks the create path, so a
  //   Coach may resend a CLIENT's invite but not a STAFF colleague's, exactly as for create.
  // ★ Task 12.14 — NO SEAT CHECK HERE. A resend reuses an ALREADY-OPEN invite's seat (revoking the
  //   old one and minting a new one is a wash — `teamSeatUsage`'s `openInvites` count is unaffected
  //   either way), so this branch is deliberately excluded from the cap below.
  if (personId) {
    const { rows } = await db.query(
      `SELECT role FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`, [personId, tenantId]);
    if (!rows[0]) throw invalid("that person does not exist", { field: "personId" });
    const targetRole = rows[0].role;
    await assertMayInviteAsRole(db, actorUserId, targetRole);

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // ★★★ the maintainer, 29 Sep 2026 — "Teens → the invite goes to their linked parent, never the teen."
    //     An adolescent has no portal login of their own in this model (`appHome.mjs`/
    //     `appProfile.mjs` both dispatch on the GUARDIAN'S session, never the teen's) — so the
    //     invite has to name the parent's address, with `childUserId` carrying the teen's id
    //     forward so acceptance (re)confirms the guardian edge (`addGuardian` is `ON CONFLICT
    //     DO NOTHING` — safe whether the link already exists, which is the common case: a
    //     "Parent" tag already means a `keystone.guardian` row is there). No parent linked at
    //     all → refuse by name rather than silently emailing nobody.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    let inviteRecipientId = personId;
    if (targetRole === "adolescent_client") {
      const { rows: guardianRows } = await db.query(
        `SELECT guardian_user_id FROM keystone.guardian
          WHERE tenant_id = $1 AND child_user_id = $2
          ORDER BY created_at LIMIT 1`,
        [tenantId, personId]);
      const guardian = guardianRows[0];
      if (!guardian) {
        throw invalid(
          "this teen has no parent linked yet — link one before sending a portal invite",
          { field: "personId" });
      }
      inviteRecipientId = guardian.guardian_user_id;
    }

    // ★ the maintainer, 29 Sep 2026 — "One-use link, expires after 30 days" for a CLIENT portal invite. Staff
    //   invites are UNCHANGED (createInvite's own 7-day default, ttlHours omitted below).
    const ttlHours = targetRole === "staff" ? undefined : 24 * 30;

    const invite = await resendInvite(db, {
      tenantId, personId: inviteRecipientId, actorUserId,
      ...(inviteRecipientId !== personId ? { childUserId: personId } : {}),
      ...(ttlHours !== undefined ? { ttlHours } : {}),
    });
    await sendInviteEmail(db, {
      tenantId, actorUserId, email: invite.email, presented: invite.presented, expiresAt: invite.expiresAt,
      message, role: targetRole,
    });
    return { id: invite.inviteId };
  }

  await assertMayInviteAsRole(db, actorUserId, role);

  // ★★★ Task 12.14 — "An invitation uses a seat — even before it's accepted." Checked here, not at
  //     the route-level gate: the `ROUTES` table's gate cannot see `body.role` (same reasoning as
  //     `assertMayInviteAsRole`, above), and only a NEW staff seat (this branch, never the resend
  //     branch above) can push `used` over `limit`.
  if (role === "staff") {
    const s = await teamSeatUsage(db);
    if (s.docustay && s.limit !== null && s.used >= s.limit && s.extraSeatPriceMinor == null) {
      throw conflict(`This workspace includes ${s.limit} ${s.limit === 1 ? "person" : "people"} who sign in to send or manage documents.`, { code: "seat_cap", used: s.used, limit: s.limit });
    }
    if (!s.docustay && s.limit !== null && s.used >= s.limit) {
      throw conflict(`That's your ${s.limit} seats — extra ones are $12 a month.`, {
        code: "seat_cap", used: s.used, limit: s.limit,
      });
    }
  }

  // ★★★ [TY, RULED 2 Oct 2026] EMAIL AND PHONE ARE BOTH REQUIRED FOR EVERY PERSON — createPerson
  //   (src/people/writes.mjs) now enforces this unconditionally, including a person created by a
  //   staff invite (this is the REAL create path — TeamInviteDrawer.jsx calls this route directly;
  //   src/auth/invite.mjs's own createPerson call only ever fires as a rare fallback when NO
  //   person row already exists by acceptance time, which this path prevents in the normal case).
  //   Run 6: a Docustay team member (staff) is invited by email only, so for them the phone is optional (phoneRequiredFor); everyone else keeps the rule.
  if (await phoneRequiredFor(db, tenantId, role) && (typeof phone !== "string" || !phone.trim())) {
    throw invalid("phone is required", { field: "phone" });
  }
  if (typeof phone === "string" && !phone.trim()) phone = null;
  const person = role === "staff"
    ? await inviteTeamMember(db, { tenantId, email, displayName, mobilePhone: phone, staffRole, actorUserId })
    : await createPerson(db, {
        tenantId, email, displayName, mobilePhone: phone, role, staffRole: null, firebaseUid: null,
        invite: true, actorUserId,
      });

  // ★ the maintainer, 29 Sep 2026 — the same 30-day TTL as the resend branch, for a client created and invited
  //   in the same request (this path is staff-only in practice today — TeamInviteDrawer.jsx is its
  //   one caller — but the create-and-invite route accepts any role, so the same ruling applies
  //   the day something else calls it for a client).
  const ttlHours = role === "staff" ? undefined : 24 * 30;
  const invite = await createInvite(db, {
    tenantId, email, role, staffRole: role === "staff" ? staffRole : null, childUserId,
    invitedByUserId: actorUserId, inviteeUserId: person.id,
    ...(ttlHours !== undefined ? { ttlHours } : {}),
  });

  await sendInviteEmail(db, {
    tenantId, actorUserId, email, presented: invite.presented, expiresAt: invite.expiresAt, message, role,
  });

  return { id: person.id };
}

/**
 * TASK 1.2 (spec 01 §11, §2) — `POST /api/people/invite/cancel`. §11's own words: "`revokeInvite`
 * already exists and has no route" (`src/auth/invite.mjs:262-283`, imported above, not edited).
 * This is the missing wire, not a new capability: TeamList's "Cancel invite" row action.
 * ★ Same staff-only second question as create/resend, above — a Coach may cancel a CLIENT's own
 *   invite (route-level `team.invite` gate already cleared that) but not a STAFF colleague's,
 *   which needs `staff_role.change` (owner/admin only). The invite's `role` column is read first
 *   for exactly that reason: `assertMayInviteAsRole` cannot ask the right question without it.
 */
async function cancelInvite(db, { tenantId, inviteId = null, actorUserId = null }) {
  if (!inviteId) throw invalid("inviteId is required", { field: "inviteId" });
  const { rows } = await db.query(
    `SELECT role FROM keystone.invite WHERE id = $1 AND tenant_id = $2`, [inviteId, tenantId]);
  if (!rows[0]) throw notFound("that invitation does not exist");
  await assertMayInviteAsRole(db, actorUserId, rows[0].role);

  return revokeInvite(db, {
    tenantId, inviteId, reason: "cancelled by staff", actorUserId,
  });
}

/**
 * `POST /api/people/portal-link` — the maintainer, 29 Sep 2026: the THIRD state of the record-page button,
 * "Send portal link", for somebody who has ALREADY signed in at least once. Not an invite — no
 * token is minted, nothing expires, nothing is one-use. It is a reminder of where to sign in;
 * their own password (already set) still gates the portal. Same guardian-redirect rule as
 * `inviteWithRoleCheck`'s resend branch: an adolescent has no portal session of their own, so this
 * goes to their linked parent.
 */
async function sendPortalLink(db, { tenantId, personId = null, actorUserId = null }) {
  if (!personId) throw invalid("personId is required", { field: "personId" });
  const { rows } = await db.query(
    `SELECT role FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`, [personId, tenantId]);
  if (!rows[0]) throw notFound("that person does not exist");
  const targetRole = rows[0].role;
  await assertMayInviteAsRole(db, actorUserId, targetRole);

  let recipientId = personId;
  if (targetRole === "adolescent_client") {
    const { rows: guardianRows } = await db.query(
      `SELECT guardian_user_id FROM keystone.guardian
        WHERE tenant_id = $1 AND child_user_id = $2
        ORDER BY created_at LIMIT 1`,
      [tenantId, personId]);
    if (!guardianRows[0]) {
      throw invalid("this teen has no parent linked yet", { field: "personId" });
    }
    recipientId = guardianRows[0].guardian_user_id;
  }

  const { rows: personRows } = await db.query(
    `SELECT email FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`, [recipientId, tenantId]);
  const recipient = personRows[0];
  if (!recipient) throw notFound("that person does not exist");

  const { rows: tenantRows } = await db.query(`SELECT slug, name FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const tenant = tenantRows[0] ?? {};
  await sendClientPortalLinkEmail({
    tx: db, tenantId, to: recipient.email, displayName: tenant.name ?? null,
    vars: { practiceName: tenant.name ?? "", portalUrl: `https://${tenant.slug}.${appDomain()}/login` },
  });
  return { sent: true, to: recipient.email };
}

/**
 * ★ L1.0 (RECONCILE de-code) — A ROW MAY CARRY `schema` (a Zod object). The body is parsed against it
 *   AFTER authorisation and immediately before the handler: a malformed field is a 400 whose message and
 *   `detail.field` name the field; an unknown key is stripped (Zod's default), so the handler sees
 *   exactly the parsed body. A row without `schema` is untouched. Schemas type keys only — every key is
 *   optional; required-ness stays in the handler (respec/L1-money.md, "The L1 rule").
 */
export function parseRouteBody(route, body) {
  if (!route.schema) return body;
  const r = route.schema.safeParse(body);
  if (r.success) return r.data;
  const issues = r.error.issues.map((i) => ({ path: i.path.join(".") || "body", code: i.code, message: i.message }));
  throw invalid(issues.map((i) => `${i.path}: ${i.message}`).join("; "), { field: issues[0]?.path ?? null, issues });
}

export function registerWriteRoutes(app, { runTenantScoped, tenantIsPlatform }) {
  for (const route of ROUTES) {
    app.post(route.path, (c) =>
      runTenantScoped(c, ({ db, principal, body, tenantId }) => runWithScope(
        c.req.header("idempotency-key") ?? null,
        async () => {
        // ★ Extract URL parameters for routes like /api/growth/campaign-groups/:id/pause
        let bodyWithParams = body || {};
        if (route.path.includes(':id')) {
          const idParam = c.req.param('id');
          if (idParam) {
            bodyWithParams = { ...bodyWithParams, id: idParam };
          }
        }

        if (!bodyWithParams || typeof bodyWithParams !== "object") {
          throw invalid("a JSON object body is required");
        }

        // ★★★ AUTHORISE BEFORE ANY WRITE, ON THE SERVER, EVERY TIME. Not "the UI only shows the button
        //     to admins" — §K3: "client-side role gating is NOT a security boundary. Hiding a tab
        //     renders nothing unreachable."
        // ★★★ 7.12a / Q0-7, Q7-2, Q7-5 — THE THREE-BRANCH REPLACEMENT FOR `assertRank`. A route is
        //     `platform: true` (the operator grant, Q7-5), `signer: true` (a redeemed link token,
        //     Q7-2), or neither — and only the third kind asks `assertMay` the object/action question
        //     7.1 declared. `isPlatform` (the TENANT'S flag) still gates the nav section for every
        //     route, including the platform ones, exactly as it did before this task.
        const isPlatform = await tenantIsPlatform(db, tenantId);
        if (route.platform) {
          if (!(await callerIsPlatform(db))) throw forbidden("refused: no_operator_grant");
        } else if (route.signer) {
          await assertSignerForInstance(db, principal, bodyWithParams);   // Stage 5's link token — REFRESH
        } else {
          const decision = authoriseSection(principal.user, route.section, { tenantIsPlatform: isPlatform });
          if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
          // ★★★ 05 §2b.5 — THE REFUSAL SHAPE. `assertMay` always throws `forbidden`; whether that
          //     surfaces as `forbidden` (a capability the role does not hold at all) or `outOfScope`
          //     / `not_found` (a SPECIFIC, EXISTING record outside the role's scope) is decided here,
          //     structurally, never by hand: a NAMED_ACTIONS refusal is a capability question and
          //     always stays `forbidden`; a VERB refusal (view/edit/delete) that names an existing row
          //     is a scope question about that one record and becomes `outOfScope`.
          // ★★★ F690 — WHICH ROW THAT IS COMES FROM `route.subject`, THE FIELD THE HANDLER ITSELF
          //     READS, through the SAME `subjectIdFor` `assertMay` uses. This line used to read
          //     `body?.id ?? null` — a field no handler reads and every caller can set, which made
          //     the owner check answerable about a row the write never touched.
          const subjectId = subjectIdFor(route, bodyWithParams);
          try {
            await assertMay(db, principal, route, bodyWithParams);
          } catch (err) {
            if (err instanceof AppError && err.kind === ErrorKind.FORBIDDEN &&
                subjectId != null && !NAMED_ACTIONS.includes(route.action)) {
              throw outOfScope();
            }
            throw err;
          }
        }

        // ★★ `tenantId` COMES FROM THE GUC, NEVER FROM THE BODY — and it is set LAST so a caller who
        //    put a tenantId in the payload cannot override it. That is the §D5 defect ("tenant
        //    selection by the caller") closed at the one place every write passes through.
        // ★★★ AND THE ACTOR COMES FROM THE SESSION, LAST, FOR THE SAME REASON — a body that claimed an
        //     `actorUserId` cannot override who is actually logged in. [MEASURED 2026-09-14] this was
        //     needed because `keystone.event` has NO actor column, so a background job that has to read
        //     what a human just did had no way to know WHO did it. See executeInstance's own note.
        // ★ TOUCH-UP GROUP A, WORKSTREAM 4.2 — `principal` RIDES ALONG TOO, ADDITIVELY. Every existing
        //   `route.fn` destructures only the named fields it already reads, so an extra key already
        //   sat here unused; the bulk writers in `src/people/bulk.mjs` are the first callers that read
        //   it, to ask `assertMay` the REAL per-row scope question their multi-id body cannot ask at
        //   this coarse gate (see that file's own header). No other route's behaviour changes.
        // ★ L1.0 — the row's schema, if it has one: AFTER authorisation (frozen test/b_money_permissions:111
        //   expects a Coach's refund with a non-uuid paymentId to be 403, not 400), BEFORE the handler.
        bodyWithParams = parseRouteBody(route, bodyWithParams);
        const args = { ...bodyWithParams, actorUserId: principal?.appUserId ?? null, tenantId, principal, requestHost: c.req.header("x-forwarded-host") ?? c.req.header("host") ?? null };   // additive, like principal: the activate route reads it

        // ★ `createBooking(tx, input, opts)` takes its input positionally and parses its own Dates.
        const result = route.positional
          ? await route.fn(db, { ...args, startsAt: new Date(bodyWithParams.startsAt), endsAt: new Date(bodyWithParams.endsAt) })
          : await route.fn(db, args);

        return result ?? { ok: true };
      }), { bucket: "write", status: WRITE_STATUS }).then((r) => c.json(r, WRITE_STATUS)));
  }
}

/** ★ Exported so a gate can enumerate what exists without importing the server. */
export const WRITE_ROUTES = Object.freeze(ROUTES.map((r) => ({
  path: r.path, section: r.section, minRank: r.minRank ?? null, fn: r.fn.name,
  // ★★★ 7.1 — the permission inventory (CONTRACTS.md UNKNOWN #1, 05 §2b.10). `object`/`action` are the
  //     tenant permission question; `platform: true` marks the three platform-only routes (Q7-5) that
  //     ask no tenant permission question at all; `signer: true` marks the four routes reached only
  //     through a signed link (Q7-2), never a client session; `objectFromBody: true` marks the two
  //     archive/restore routes whose object is resolved at request time, not declared statically here
  //     (see the ROUTES entry's own comment). Authorisation itself is unchanged by this task — 7.12a's.
  object: r.object ?? null, action: r.action ?? null,
  platform: r.platform === true, signer: r.signer === true,
  objectFromBody: r.objectFromBody === true,
  // ★★★ F690 — the declared subject field, exported so a gate or a test can assert the table is
  //     complete without importing the server. `null` here means BOTH "declared as having no
  //     resolvable subject" and "not a verb route"; `action` distinguishes the two, and
  //     `assertVerbRoutesDeclareASubject` (above) is what makes undeclared impossible in the first
  //     place — this export is the read-only view of that, never the enforcement.
  subject: r.subject ?? null,
})));

/** ★ L1.0 — every row's body schema, by path, for L1.OA's OpenAPI document. Rows without one are absent. */
export const ROUTE_SCHEMAS = Object.freeze(Object.fromEntries(
  ROUTES.filter((r) => r.schema).map((r) => [r.path, r.schema])));
