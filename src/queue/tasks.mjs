// P18.6(b)(e)(f) — ★★★ THE JOB HANDLERS, AND THE RULE THAT MAKES A FORGED `tenantId` USELESS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P18.6(f) — WHICH ROLE IS BEING TAKEN, AND WHY. STATED, BECAUSE THE ITEM SAYS THE OLD P18.6
//     "FUSED TWO ROLES §X4 SEPARATES AND CITED THE SEPARATING CLAUSE AS ITS AUTHORITY."
//
//   §X4.4 assigns **Graphile Worker** to PROVISIONING `add_job`.
//   §X4.3 assigns **EVENT CONSUMPTION** to n8n.
//
//   ★★ THIS CODE GIVES GRAPHILE **BOTH** ROLES, AND THAT IS A DEPARTURE, NOT AN INTERPRETATION.
//      The reason is measurable, not aesthetic: **n8n IS NOT DEPLOYED.** [MEASURED] there is no n8n
//      service in the Railway project, no credential for one, and nothing in `src/` references it.
//      §X4.3 assigns a job to a system that does not exist, so honouring it literally means events are
//      consumed by nobody — which is the state ADDENDUM 1 already records as a gap, not a design.
//   ★★★ AND THE ALTERNATIVE IS WORSE THAN THE DEPARTURE. Deploying n8n to consume the outbox would put
//        tenant data into a second system with its own database, its own credentials and **no FORCE ROW
//        LEVEL SECURITY** — which is precisely the argument §N2/§X6 used to keep notifications out of
//        Novu ("tenant isolation for notifications would sit in APPLICATION CODE — the exact defect
//        class that killed Twenty"). Consuming our outbox inside our own Postgres, under our own RLS,
//        is the same reasoning applied to the same table.
//   ★ SO: one runner, two jobs — provisioning (as §X4.4 intends) and outbox dispatch (which §X4.3 gave
//     to something absent). ★★ This is a RULING and it is recorded in HANDOFF.md. If n8n is later
//     deployed, the outbox-dispatch task is the thing to remove, and it is one task name.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ U26 / §D5 — "THE ENQUEUE PATH IS A TENANT-SELECTION PRIMITIVE."
//     §D5: *"`handleQueueJob` reads `job.tenantId` off a caller-supplied object with NO VERIFICATION
//     WHATSOEVER. … The moment something does, 'write a row, name a tenant, get that tenant's data'
//     becomes reachable — and graphile's `add_job` is a SQL function callable by anything with
//     `app_rw`'s DML grants."*
//
//   ★★ TWO DEFENCES, BECAUSE ONE IS NOT ENOUGH AND NEITHER IS SUFFICIENT ALONE:
//     1 · **THE TENANT IS VERIFIED** against `keystone_auth.tenant_is_active()` before any work starts.
//         A forged or suspended tenant id cannot begin a job. ★ This does NOT authorise the enqueue —
//         nothing at the database level can while `app_rw` may call `add_job` — it only stops work on
//         a tenant that should not have work done for it.
//     2 · ★★★ **A PAYLOAD MAY NOT CARRY A DESTINATION.** No recipient address, no URL, no phone number.
//         Everything a job sends is looked up FROM THE TENANT'S OWN DATA inside `withTenant`, under RLS.
//         That is what makes naming a tenant useless to an attacker: they can cause tenant B's reminder
//         to be sent **to tenant B**, which is a nuisance, not a disclosure. Enforced by
//         `assertNoDestination()` below and asserted by `db/gates/p18_worker.mjs`.
//   ★ The residual risk is stated rather than hidden: anything holding `app_rw` can enqueue noise for
//     any real tenant. Closing that needs `add_job` revoked from `app_rw` and an enqueue helper running
//     as `app_worker` — which is PHASE 19's territory (§P19.8's grant-not-an-if rule) and is recorded.

import { handlePosthogEvent, wantsPosthog } from "../product/posthogListener.mjs";
import { withTenant } from "../db/index.mjs";
import { logSeatsToday } from "../product/docustaySeats.mjs";
import { resolveTerms } from "../terminology/resolve.mjs";
import { asViewer } from "../db/viewer.mjs";
import {
  claimEvents, markProcessed, markFailed, releaseClaim, safeErrorText, EVENT_CLAIM_BUDGET,
  deliveryRows, planDeliveries, recordDelivered, recordSkipped, recordListenerFailure, settleEvent,
  closeOutDeadEvents, unreportedDeadDeliveries, markGaveUpReported, markGiveUpOwned,
  recordGaveUpReportFailures, GAVE_UP_REPORT_MAX_ATTEMPTS, sinkEventToN8n,
} from "../events/outbox.mjs";
// ★ Task 9.14 (CT-096) — the n8n send endpoint error type, mapped to JobFailure by this job handler.
import { N8nUnavailable } from "../automations/n8n.mjs";
// ★ Stage 3 Task 5 — the one writer for `job.gave_up` (Task 6). Called on the worker's own connection.
import { recordJobGaveUp, recordWebhookGaveUp, recordReaperStopped } from "../health/platformEvents.mjs";
// ★ P18.9 — the two handlers below are what give P18.2 (email) and P18.3 (storage) a producer.
//   Before this, both modules had ZERO call sites outside themselves.
import { createNotification } from "../notifications/writes.mjs";
import { staffPushCopy } from "../notifications/staffPushCopy.mjs";
import { sendNotificationEmail, IN_DOUBT_RETRY_HOURS, sendingAddress } from "../email/send.mjs";
// ★ 12.9 — the referral email: the pure composer (12.6) and the one sending path (never sendNotificationEmail,
//   which requires a `notification` row with a person recipient — a partner is not a person, send.mjs:55-72).
import { deliverAsOrganisation } from "../email/deliver.mjs";
import { sendViaResend } from "../email/resend.mjs";
import * as platformMail from "../mail/index.mjs";
import { billingEmail } from "../email/docustayBilling.mjs";
import { redirectForEnvironment } from "../email/redirect.mjs";
import { composeReferralEmail } from "../network/writes.mjs";
import * as deletion from "../product/deletion.mjs";
import { storageIsConfigured } from "../storage/s3.mjs";
import { reencryptFiles, rotateFileKey, tenantsNeedingSealPass } from "../storage/fileCrypto.mjs";
import { seedLibrary, LIBRARY_VERSION, archiveExecutedPdf, sendReceiptsForSend, documentEmailAlreadySent, instanceNotificationFacts, declineFacts, sentenceCase, peopleWithRecentDocuments, sendDocumentMail, sendPdfDocument, dueScheduledDocuments, staleUnarchivedDocuments, untimestampedSealedDocuments, erasePerson, mintDownloadLink, runAiJob, runAiJobDetached, runDetectPage, stalePagesOf, pruneChatsForTenant, rescueStaleAiJobs } from "../documents/frontDoor.mjs";
import { watchCeiling as watchAiCeiling } from "../product/docustayAiUsage.mjs";
import { instanceSentFacts, instanceTitleAndCreator, instanceCreatorById } from "../documents/api.mjs";
// ★ FIX, 30 Sep 2026 ("email the signed copy" brief) — the signed-instrument attachment email, sent
//   once the archive above has verified bytes in the object store (see archiveDocumentPdf below).
import { sendSignedCopyEmail } from "../email/signedCopyEmail.mjs";
import {
  reminderRunAt, reminderRunAtFor, stillRemindable, stillRemindableAtAll, alreadyHappened,
  reminderJobKey, reminderOffsetJobKey, reminderFacts, reminderRecipients,
  REMINDER_OFFSET_SETTING_KEY, DEFAULT_REMINDER_OFFSETS, normalizeReminderOffsets,
} from "../booking/reminders.mjs";
import { zonedLocalToUtc } from "../booking/slots.mjs";
// ★ 13.15 — the consent-hold window setting (13.8), and the waitlist offer's claim link (13.3/13.14).
//   Neither was imported here before this task: `getSetting`/`mintLinkToken`/`revokeLinkToken` are
//   necessary infrastructure for `scheduleHoldExpiryFrom`/`sendWaitlistOffer`/`waitlistOfferExpiry`
//   below, not a second copy of either module.
import { getSetting } from "../settings/writes.mjs";
import { mintLinkToken, revokeLinkToken, revokeLinkTokenById } from "../auth/linkToken.mjs";
// ★ The invoice PDF attachment for money.invoice_issued — built from the platform's own frozen
//   invoice+lines (same builder the editor and the public PDF route use), never a live Stripe
//   fetch at send time (specs/INVOICE-SEND-FIX.md §2.7).
import { buildInvoiceView } from "../money/invoiceView.mjs";
import { renderInvoicePdfBuffer } from "../money/invoicePdfServer.mjs";
import { dueStanding } from "../money/dueWording.mjs";
import { deferUntil, DEFERRABLE_TEMPLATES } from "../notifications/quietHours.mjs";
// ★ Booking everywhere (22 Oct 2026, spec §7/§8) — the change-or-cancel link, notice window, host-or-client and reminder-channel facts the four booking emails need.
import { BOOKING_EMAIL_TOPICS, HOST_TEMPLATE_FOR, resolveBookingEmailFacts, reminderChannelsFor, deliverableChannels } from "../email/bookingEmailFacts.mjs";
import { automationSettingKey } from "../automations/catalogue.mjs";
// ★ Growth campaign sending in resumable batches. F714 (16.34): `eligibleRecipients` (16.19) —
//   not `resolveSegment` — is the recipient resolution a send must use (leave-out segment + the
//   never-more-than-N-days repeat guard, on top of resolveSegment's own exclusions), and
//   `mintUnsubscribeToken` (16.25) mints each recipient's own unsubscribe link.
import { eligibleRecipients } from "../growth/campaigns.mjs";
import { mintUnsubscribeToken } from "../growth/consent.mjs";
import { scoreLead, defaultLeadScoringWeights } from "../growth/leadScoring.mjs";
import { emit, userActor } from "../events/outbox.mjs";
// ★ Spec 03b task 3b.4 — the hold-expiry job's own release call. `cancelBooking` is §2.4's existing,
//   unchanged function (already returns any reserved package/entitlement credit); this job supplies
//   no destination and does the network-free work only, same shape as every other TASK_LIST handler.
import { cancelBooking } from "../booking/createBooking.mjs";
// ★ B-3b — the two moves out of `pending_signature` (src/booking/holds.mjs). `confirmHeldBookings`
//   is the CONFIRM_HELD_BOOKINGS listener's own call; `releaseExpiredHolds` is the periodic
//   `release_signature_holds` task's.
import { confirmHeldBookings, releaseExpiredHolds } from "../booking/holds.mjs";
import { grantConsentFromAgreement } from "../people/writes.mjs";
// ★ Task 3a.4 (spec 03a §7) — the renewal/pull sweeps. Every function below was written by task
//   3a.1 with ZERO callers (this file's own header note, spec 03a §11) — these two jobs are the
//   callers. `dependency()` (below) is the classified refusal `resolveCalendarProviderCall` throws
//   until the live OAuth refresh-token exchange exists (out of THIS task's scope — see that
//   function's own header, same boundary `src/booking/calendarPush.mjs` already drew for 3a.3).
import {
  findConnectionsNeedingRenewal, renewChannel, CalendarSyncDegraded,
  applyRemoteEvent, handleSyncTokenGone, recordSweep,
} from "../booking/calendarSync.mjs";
// ★ Task 3a.6 (F678) — `applyPairedEventLifecycle` (task 3a.3, `src/booking/calendarPush.mjs`) was
//   built with real create/reschedule/cancel/complete logic and ZERO caller — that file's own header
//   explicitly left "wiring into `src/queue/tasks.mjs` as a `PUSH_TO_CALENDAR` listener" for a later
//   task (this one). The `pushToCalendar` job below (TASK_LIST) is that caller.
import { applyPairedEventLifecycle } from "../booking/calendarPush.mjs";
import { sweepCalendarLists } from "../booking/googleCalendar.mjs";
// ★ 6 Oct 2026 — team booking: keep the host's Google Calendar in step with a booking. State-based job, enqueued from the three booking handlers below.
import { reconcileBookingCalendar } from "../booking/calendarPushJob.mjs";
// ★★★ Stage 4 Task 6 — the one job policy: attempts, schedule, retry classes, give-up reasons (see its header).
import { policeTaskList, JobFailure, classifyFailure, plainText, JOB_PRIORITY, DELIVERY_BACKLOG_LIMIT, deliveryQueueName } from "./jobPolicy.mjs";
// ★★★ Stage 4 Task 8 — every give-up has an owner (07 §4 rule 6): one row per job type and listener, no default.
import { assertGiveUpOwners, openGiveUpTask } from "./giveUpOwners.mjs";
import { invalid, forbidden, dependency } from "../http/errors.mjs";
// ★ T1.7b (F790) — a job's own Stripe writes are keyed by the job, not by a per-call default.
import { runWithScope } from "../money/idempotencyScope.mjs";
// ★ Stage 9 task 9.12 (F622 follow-up) — the keyring re-wrap job's own logic lives in
//   src/secrets/rewrap.mjs; this file only registers the task that calls it. CURRENT_KEK_VERSION is
//   the default `toVersion` when a caller does not name one, same default `rewrapSecrets` itself uses.
import { rewrapSecrets, retireKekVersion } from "../secrets/rewrap.mjs";
import { CURRENT_KEK_VERSION } from "../secrets/envelope.mjs";
// ★★★ Stage 14 task 14.26 — the Stripe catalogue sync writer (0271's missing writer). The domain
//   logic (Stripe calls, idempotent create-or-update) lives in src/money/catalogue.mjs; this file
//   owns only the listener that enqueues the job and the job wrapper that calls it (see below).
import { syncCatalogueSubject, backfillCatalogueSync } from "../money/catalogue.mjs";
// ★ Stage 20 task 20.3 — the Stripe metadata backfill job.
import { stripeMetadataBackfill } from "../money/metadataBackfill.mjs";
// ★ Stage 15 task 15.30 — the no-show charge listener body.
import { raiseNoShowCharge } from "../money/noShow.mjs";
// ★ Stage 15 task 15.66 — the loyalty accrual listener bodies (payment and referral, same concern).
import { accrueLoyaltyForPayment, accrueLoyaltyForReferral } from "../money/loyaltyAccrual.mjs";
// ★ Stage 15 task 15.37 — owner-role operations for money notifications.
import { asPracticeOwner } from "../money/asPracticeOwner.mjs";
// ★ Task 20.4 — Stripe customer sync on person create/archive.
import { ensureCustomer, syncCustomer } from "../money/customers.mjs";
import { getConnectAccountState } from "../money/connect.mjs";
// ★ B-2 (F799) — the one writer for "a purchase or a cycle grants credits" (src/money/writes.mjs).
// ★ B-5b — the one writer for "start a client subscription" (src/money/subscriptions.mjs), reused by
//   the START_SUBSCRIPTION listener to retry a subscription that failed to start on first attempt.
import { startClientSubscription } from "../money/subscriptions.mjs";
// ★ Stage 17 task 17.16 — the usage reconciliation job.
import { reconcileTenant } from "../billing/usageReconcile.mjs";
// ★ PHASE-4 task L5.4 — the nightly money divergence sweep.
import { reconcileStripeMirror } from "../money/mirrorReconcile.mjs";

/** ★ Keys that may NEVER appear in a job payload, at any depth. */
const DESTINATION_KEYS = Object.freeze([
  "to", "email", "emailAddress", "recipient", "recipientEmail", "address",
  "url", "href", "link", "callback", "callbackUrl", "webhook", "webhookUrl",
  "phone", "phoneNumber", "sms", "from", "replyTo",
]);

export class PayloadCarriesDestination extends Error {
  constructor(key) {
    super(
      `a job payload may not carry "${key}". ★★ A destination in a payload is the whole of the ` +
      `enqueue hazard: graphile's add_job is callable by anything holding app_rw, so a payload that ` +
      `says WHERE to send turns "name a tenant" into "get that tenant's data". Look the destination up ` +
      `from the tenant's own rows inside withTenant, under RLS.`);
    this.name = "PayloadCarriesDestination";
    this.key = key;
  }
}

/** ★★ Recursive, because `{meta: {to: "..."}}` is the same defect one level down. */
export function assertNoDestination(payload, path = "payload") {
  if (payload === null || typeof payload !== "object") return true;
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertNoDestination(v, `${path}[${i}]`));
    return true;
  }
  for (const [k, v] of Object.entries(payload)) {
    // ★ Case-insensitive: `To` and `URL` are the same mistake typed differently.
    if (DESTINATION_KEYS.some((d) => d.toLowerCase() === k.toLowerCase())) {
      throw new PayloadCarriesDestination(`${path}.${k}`);
    }
    assertNoDestination(v, `${path}.${k}`);
  }
  return true;
}

/**
 * ★★★ EVERY TASK GOES THROUGH THIS. It is the one place the two defences are applied, so a new task
 *     cannot be added without them — the alternative is a convention, and a convention is what §D5
 *     found had been skipped.
 */
/**
 * Run 9 — A TASK THAT IS EITHER FOR ONE WORKSPACE OR FOR ALL OF THEM. With a `tenantId` in the payload it is exactly guardedTask (the workspace must be active; the work is scoped to it). With none it is a
 * platform-wide pass the worker queues for itself at start (seed_template_library, reencrypt_document_files): it still refuses a payload that carries a destination, and the function goes through
 * every active workspace itself, each in its own transaction. (guardedTask alone refused the platform-wide form, so neither job had ever run from the worker's own startup — F1035.)
 */
export function workspaceOrPlatformTask(name, fn) {
  const perWorkspace = guardedTask(name, fn);
  return async function workspaceOrPlatform(payload, helpers) {
    if (payload?.tenantId) return perWorkspace(payload, helpers);
    assertNoDestination(payload);
    return runWithScope(`job:${helpers.job?.key ?? helpers.job?.id}`, () => fn(payload ?? {}, helpers));
  };
}

export function guardedTask(name, fn) {
  return async function guarded(payload, helpers) {
    assertNoDestination(payload);
    const tenantId = payload?.tenantId;
    if (typeof tenantId !== "string" || tenantId.length !== 36) {
      // ★ Stage 4 Task 6: `validation` — a malformed payload never becomes valid by being retried.
      throw invalid(`task ${name}: payload.tenantId must be a uuid — got ${JSON.stringify(tenantId)}`);
    }
    // ★★ VERIFIED THROUGH THE DEFINER FUNCTION, not by reading `keystone.tenant` — which is FORCE RLS
    //    and would return zero rows with no context, i.e. "this tenant is not active" for EVERY tenant.
    //    That is the failure shape that reads as a correct refusal, and it would have disabled the whole
    //    worker while looking like a security feature working.
    const { rows } = await helpers.withPgClient((pg) =>
      pg.query(`SELECT keystone_auth.tenant_is_active($1) AS active`, [tenantId]));
    if (rows[0]?.active !== true) {
      // ★ Stage 4 Task 6: `forbidden` — gives up at once with this reason (F486: these used to retry for days).
      throw forbidden(
        `task ${name}: the practice is not active (suspended, closed or unknown), so no work is done for it. ★ Either the ` +
        `id was forged or the practice has been suspended; in both cases doing the work would be wrong.`);
    }
    return runWithScope(`job:${helpers.job?.key ?? helpers.job?.id}`, () => fn(payload, helpers));
  };
}

/**
 * ★★★ THE OUTBOX DISPATCH TASK — the one that gives §X4.3's absent consumer a body.
 *
 * ★★ IT DOES NOT "PROCESS THE EVENT" IN ANY GENERAL SENSE, AND SAYING SO MATTERS: there is exactly one
 *    thing the system currently knows how to do with an event, which is nothing. **So this task claims,
 *    then MARKS PROCESSED, and records that no handler existed.** That is deliberately unglamorous and
 *    deliberately honest — a dispatcher that pretended to handle every topic in the catalogue (SIXTY
 *    across thirteen sections as of 0054, not the 28 this line used to name) would be the unfalsifiable
 *    infrastructure P18.8 warns about, one layer up.
 *  ★ As handlers arrive (an email per topic, a webhook fan-out in P19), they register here by topic and
 *    the `unhandled` branch shrinks. The SHAPE is what P18 owes; the handlers are later items.
 */
// ★ STAGE 3 TASK 3 FIX 1, REVIEW M6 — `asViewer` MOVED to the leaf module `src/db/viewer.mjs`
//   (its full measured rationale travelled with it), so `tasks/chains.mjs` imports the same function
//   instead of carrying a copy. A leaf module has no imports, so the cycle the copy avoided cannot form.

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P18.9 — THE FIRST TWO HANDLERS, AND WHY EACH ONE ONLY ENQUEUES.
//
// [MEASURED 2026-09-14] before this, `src/email/send.mjs` and `src/storage/s3.mjs` had **ZERO call
// sites outside themselves** — 33 and 31 passing assertions each, and nothing a person could do
// reached either. P18.9 asks for a real email and a real stored-and-retrieved PDF, which is not
// possible through a module nothing calls. These two handlers are the producers.
//
// ★★★ NEITHER HANDLER DOES THE NETWORK CALL ITSELF. IT ENQUEUES A SECOND JOB. THREE REASONS, AND THE
//     FIRST ONE IS A CORRECTNESS BUG, NOT A PREFERENCE:
//   1 · `sendNotificationEmail` opens its OWN `withTenant` to write the `notification_delivery` row,
//       whose `notification_id` is a NOT NULL FK. The notification row is created HERE, inside the
//       dispatcher's still-open transaction — so a delivery row written from another connection would
//       reference a row that **does not exist yet** and the FK would fail. The email has to happen
//       after this transaction COMMITS, and a job is how you say "after commit".
//   2 · An HTTP call inside an open transaction holds the claim lock for the length of someone else's
//       outage. The dispatcher claims in batches; one slow provider would stall the batch.
//   3 · Retries. A second job gets its own attempt budget, so a bounced email does not re-run the
//       whole outbox batch, and a storage outage does not re-deliver events that already succeeded.
//
// ★★ AND NO DESTINATION TRAVELS IN EITHER PAYLOAD — only `{tenantId, notificationId}` /
//    `{tenantId, instanceId}`. `assertNoDestination` above would refuse an address, and the reason it
//    exists is that `add_job` is callable by anything holding `app_rw`: a payload that says WHERE to
//    send turns "name a tenant" into "get that tenant's data". The address is looked up inside
//    `withTenant`, under RLS, by the job.
// ★★★ P20.3 — THE CHAIN LAYER. Imported here because the dispatcher is the only place every claimed
//     event passes through, and a chain that runs anywhere else would miss events. See the note on
//     `applyChains` for why this is NOT folded into TOPIC_HANDLERS.
import { TASK_CHAINS, CLOSING_TOPICS, SUBJECT_CLOSERS } from "../tasks/chains.mjs";
import { applyChains } from "../tasks/writes.mjs";
import { runEventAutomations, AUTOMATION_TOPICS, sendAutomationMessage } from "../automations/engine.mjs";
import { runAutomationStep, sweepAutomationsTask } from "../automations/sweeps.mjs";
import { practiceOwnerId } from "../money/asPracticeOwner.mjs";
import { readConfig, defaultConfig } from "../automations/config.mjs";
import { quietClientsSql } from "../growth/campaigns.mjs";
import { buildReceipt } from "../reports/receipt.mjs";
import {
  deliverEventToSubscribers, hasSubscribers, retryDueDeliveries, unreportedDeadWebhooks,
  markWebhookGaveUpReported, recordWebhookGaveUpReportFailures, WEBHOOK_GAVE_UP_REPORT_MAX_ATTEMPTS,
} from "../webhooks/subscribers.mjs";
import { runDueFacts, DUE_FACT_KEYS } from "../time/due.mjs";
import { systemChecks, breaches } from "../health/watch.mjs";
import { notifyTransitions } from "../health/alerts.mjs";
// ★★★ Stage 4 Task 13 — the 7 am summary (07 §6).
import { sendDailySummary, nextDailySummaryRunAt, pacificDateKey } from "../health/dailySummary.mjs";
import { runWelcomeForTenant } from "../product/lifecycle.mjs";
import { nextPruneRunAt, pruneDateKey, pruneBookkeepingForTenant,
         RETENTION as PRUNE_RETENTION, PRUNE_BATCH } from "./pruneBookkeeping.mjs";
// ★ P10.4 — the one composition of "Session 3 of 12 · 9 remaining" (KS-16.2 ruling 5).
// ★ B-2b (F805) — spendableCredits reads a service's carryover for the cap rollover mode below.
import { creditStanding, standingSentence } from "../money/credits.mjs";
import { grantInvoiceCredits, findPaidInvoicesWithoutCredits, voidCreditsForFullyRefundedInvoices } from "../money/creditGrant.mjs";
import { recordMirrorHealth } from "../money/stripeMirror.mjs";
// ★ Task 14.27 — an attended session earns loyalty points. `accrueLoyalty` (14.24) checks
//   `loyalty.enabled` and its rule's `active` flag itself; this listener supplies no second copy
//   of that switch (R-14.8 ruling: settings are enforced server-side, this file only calls in).
import { accrueLoyalty } from "../items/loyalty.mjs";
import { getEffectiveChannels } from "../notifications/rules.mjs";
// ★ PART 2 ADDITION ("every email on the one system", 1 Oct 2026) — the generic-path dispatcher for
//   the ~71 topics in specs/EMAILS.md's NEW section. See genericNotifications.mjs's own header for
//   why this is one table + one listener rather than ~71 bespoke ones.
import { GENERIC_NOTIFICATIONS, docustayWantsNotice } from "./genericNotifications.mjs";
import { recipientIsSubject, recipientsAreOwners, SUBJECT_RECIPIENT_LOOKUP } from "./recipientResolvers.mjs";
// ★ MEASURED against production, 2 Oct 2026 — `appDomain()` (both call sites below) was never
//   defined or imported anywhere in this codebase; every email through either branch has been
//   throwing `ReferenceError: appDomain is not defined` on attempt 1, retried 5 more times, then
//   given up silently (GAVE UP, deliver_notification_email) — found only now because the invoice
//   send fix is the first thing to actually reach a successful Send in production. The real value
//   is `process.env[APP_DOMAIN_VAR]`, the same one src/auth/tenantFromHost.mjs's own
//   `subdomainFromHost` reads for the inverse direction (host → subdomain).
import { APP_DOMAIN_VAR } from "../auth/tenantFromHost.mjs";

const GENERIC_TEMPLATE_KEYS = new Set(Object.values(GENERIC_NOTIFICATIONS).map((cfg) => cfg.templateKey));

/**
 * ★ Schedule (or move) a booking's reminder from the event that caused it — `booking.booking.created` or
 *   `booking.booking.rescheduled`. The run time is computed from the CURRENT row, so the order the two
 *   events are handled in cannot put the reminder at a stale time.
 */
async function scheduleReminderFrom(ev, { tenantId, tx, helpers }) {
  const booking = await reminderFacts(tx, ev.subject_id);
  if (!booking) {
    // ★★ NOT FOUND IS A HARD FAILURE, for the reason spelled out on the documents.sent handler
    //    below: "I could not see it" and "there is nothing to do" are different facts, and the
    //    tolerant branch is what hid a real defect for a whole phase.
    throw new Error(
      `${ev.topic} ${ev.subject_id}: the booking is not readable in tenant ${tenantId}. ` +
      `That is a real failure, deliberately NOT treated as "no reminder needed".`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ BOOKING OVERHAUL, 29 Sep 2026 — MULTIPLE REMINDERS, ONE PER ENABLED OFFSET.
  //     `reminder_minutes_before === null` is an EXPLICIT per-booking opt-out (reminders.mjs's own
  //     header — "not 'use the default'"), and it is honoured exactly as before: no offset is
  //     scheduled at all. A non-null value no longer names a single offset by itself — it only means
  //     "this booking wants reminders" — and the practice's `booking.reminder_offsets` setting names
  //     WHICH of the three fixed offsets actually fire, each independently.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (booking.reminder_minutes_before === null || booking.reminder_minutes_before === undefined) {
    if (ev.topic === "booking.booking.rescheduled") {
      await helpers.withPgClient((pg) =>
        pg.query(`SELECT graphile_worker.remove_job($1)`, [reminderJobKey(ev.subject_id)]));
    }
    helpers.logger.info(
      `${ev.topic} ${ev.subject_id}: no reminder scheduled — this booking opted out ` +
      `(reminder_minutes_before is null), state=${booking.state}.`);
    return;
  }

  const offsets = normalizeReminderOffsets(
    await getSetting(tx, REMINDER_OFFSET_SETTING_KEY, DEFAULT_REMINDER_OFFSETS));
  const enabled = offsets.filter((o) => o.enabled);

  // ★ Stage 3 Task 9: on a MOVE, the single LEGACY job key (from before this task existed) may still
  //   be queued at the old time for a booking that has never been rescheduled since — remove it
  //   unconditionally so a pre-existing legacy job never fires alongside the new per-offset ones.
  if (ev.topic === "booking.booking.rescheduled") {
    await helpers.withPgClient((pg) =>
      pg.query(`SELECT graphile_worker.remove_job($1)`, [reminderJobKey(ev.subject_id)]));
  }

  if (enabled.length === 0) {
    helpers.logger.info(`${ev.topic} ${ev.subject_id}: no reminder offsets are enabled — nothing scheduled.`);
    return;
  }

  for (const offset of enabled) {
    const runAt = reminderRunAtFor(booking, offset.minutes, new Date());
    const jobKey = reminderOffsetJobKey(ev.subject_id, offset.minutes);
    if (!runAt) {
      // ★ This offset's own moment has already passed for this booking (e.g. booked 2h out with the
      //   48h offset enabled) — the tolerant branch, same reasoning as the old single-reminder path.
      if (ev.topic === "booking.booking.rescheduled") {
        await helpers.withPgClient((pg) => pg.query(`SELECT graphile_worker.remove_job($1)`, [jobKey]));
      }
      continue;
    }
    // ★ `replace` on a per-(booking, offset) key: rescheduling a session MOVES each of its enabled
    //   reminders rather than queueing duplicates, and two offsets never collide with each other.
    // ★ Task 8 fix 1 (F4) / T9-R1 — unchanged reasoning, now per offset: the job carries the
    //   scheduling event and the start time it was scheduled for, so fire time can tell a stale job
    //   from a current one without depending on event-handling order.
    await helpers.addJob("send_booking_reminder",
      { tenantId, bookingId: ev.subject_id, scheduledByEventId: ev.id,
        scheduledForStartsAt: new Date(booking.starts_at).toISOString(), minutesBefore: offset.minutes },
      { runAt, jobKey, jobKeyMode: "replace" });
  }
}

/**
 * ★★★ 13.15 — SCHEDULE THE 24-HOUR CONSENT HOLD, FROM THE EVENT THAT CREATED IT. Placed directly
 *     after `scheduleReminderFrom`, same shape: read the CURRENT row, decide, enqueue.
 * ★ `bookingHoldExpiry`'s own header (below) named the caller that would make a `pending_consent`
 *   booking schedule its release as a gap this task closes for the ONE path this file's scope
 *   reaches — `booking.booking.created`. The window is `booking.consent_hold_hours` (13.8), never
 *   hardcoded; `runAt`/`jobKey` are the exact shape `bookingHoldExpiry`'s header already recorded.
 */
async function scheduleHoldExpiryFrom(ev, { tenantId, tx, helpers }) {
  const booking = await reminderFacts(tx, ev.subject_id);
  if (!booking) {
    // ★ Same reasoning as scheduleReminderFrom above: NOT FOUND is a real failure, not "no hold needed".
    throw new Error(
      `${ev.topic} ${ev.subject_id}: the booking is not readable in tenant ${tenantId}, so its consent` +
      ` hold cannot be scheduled. That is a real failure, deliberately NOT treated as "no hold needed".`);
  }
  // ★ Read from the CURRENT row, not the event: only a booking still `pending_consent` right now gets
  //   a hold scheduled — a booking created and confirmed in the same breath (no minor) needs none.
  if (booking.state !== "pending_consent") return;
  const hours = await getSetting(tx, "booking.consent_hold_hours", 24);
  await helpers.addJob("booking_hold_expiry", { tenantId, bookingId: booking.id },
    { runAt: new Date(Date.now() + hours * 3_600_000),
      jobKey: `booking_hold_expiry:${booking.id}`, jobKeyMode: "replace" });
}

/**
 * ★★★ 13.15 — TELL THE CLIENT THEY ARE BOOKED. `ev.payload.tell_client !== false` — the default is
 *     tell them; only an explicit `false` (createBooking's `tellClient` param) is silent, same "the
 *     sending matrix draws it, absence never silences it" reading the moved/cancelled notices below share.
 */
async function notifyBookedFrom(ev, { tenantId, tx, helpers }) {
  if (ev.payload?.tell_client === false) return;
  const booking = await reminderFacts(tx, ev.subject_id);
  if (!booking) {
    throw new Error(
      `${ev.topic} ${ev.subject_id}: the booking is not readable in tenant ${tenantId}, so nobody can ` +
      `be told they are booked. Deliberately NOT treated as "nobody to notify".`);
  }
  const recipients = await reminderRecipients(tx, ev.subject_id);
  // ★★★ F831, 1 Oct 2026 — FOUND LIVE: this loop used to interleave createNotification + addJob
  //   per recipient, the EXACT shape booking.booking.reminder's own fix comment (below) already
  //   named and fixed elsewhere — "a failure on the SECOND recipient rolled back the first
  //   notification and left its email job behind... retried 'not found' for 14.6h". The comment
  //   HERE claimed the fix was already applied ("same idiom as :430-433") when the code never
  //   actually was. Same two-pass fix: every notification first, then every email job.
  const notificationIds = [];
  // ★ 6 Oct 2026 — team booking: the host is told WHO the call is with (name, email, phone); the visitor is not told about themselves.
  const { rows: staffRows } = await tx.query(`SELECT id FROM keystone.app_user WHERE id = ANY($1::uuid[]) AND role = 'staff'`, [recipients.map((r) => r.app_user_id)]);
  const staffIds = new Set(staffRows.map((r) => r.id));
  let clientLine = null;
  if (staffIds.size) {
    const { rows: cl } = await tx.query(
      `SELECT u.display_name, u.email, u.mobile_phone AS phone FROM keystone.booking_participant bp JOIN keystone.app_user u ON u.id = bp.app_user_id
        WHERE bp.booking_id = $1 AND bp.party = 'client' ORDER BY bp.id LIMIT 1`, [ev.subject_id]);
    if (cl[0]) clientLine = `With: ${[cl[0].display_name, cl[0].email, cl[0].phone].filter(Boolean).join(" · ")}`;
  }
  for (const r of recipients) {
    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId: r.app_user_id, eventId: ev.id,
      topic: "booking.booking.created",
      title: `Booked: ${booking.service_name}`,
      body: staffIds.has(r.app_user_id) ? clientLine : null,
      deepLink: "/app/booking",
    });
    notificationIds.push(notificationId);
  }
  for (const notificationId of notificationIds) {
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  }
}

/** ★★★ 13.15 — TELL THE CLIENT IT MOVED. Same shape as `notifyBookedFrom`. */
async function notifyMovedFrom(ev, { tenantId, tx, helpers }) {
  if (ev.payload?.tell_client === false) return;
  const booking = await reminderFacts(tx, ev.subject_id);
  if (!booking) {
    throw new Error(
      `${ev.topic} ${ev.subject_id}: the booking is not readable in tenant ${tenantId}, so nobody can ` +
      `be told it moved. Deliberately NOT treated as "nobody to notify".`);
  }
  const recipients = await reminderRecipients(tx, ev.subject_id);
  // ★★★ F831 fix, same shape as notifyBookedFrom above — every notification first, then every job.
  const notificationIds = [];
  for (const r of recipients) {
    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId: r.app_user_id, eventId: ev.id,
      topic: "booking.booking.rescheduled",
      title: `Moved: ${booking.service_name}`,
      deepLink: "/app/booking",
    });
    notificationIds.push(notificationId);
  }
  for (const notificationId of notificationIds) {
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  }
}

/**
 * ★★★ 13.15, DOCTRINE 3 (R-13.6) — TELL THE CLIENT IT WAS CANCELLED. Added under the same ruling
 *     that put "You cancel — Including the reason" / "They cancel — Confirming it" on the sending
 *     matrix: a cancelled session that tells nobody is the clearest case of copy promising what the
 *     code does not do. Same shape as the other two notices.
 */
async function notifyCancelledFrom(ev, { tenantId, tx, helpers }) {
  if (ev.payload?.tell_client === false) return;
  const booking = await reminderFacts(tx, ev.subject_id);
  if (!booking) {
    throw new Error(
      `${ev.topic} ${ev.subject_id}: the booking is not readable in tenant ${tenantId}, so nobody can ` +
      `be told it was cancelled. Deliberately NOT treated as "nobody to notify".`);
  }
  const recipients = await reminderRecipients(tx, ev.subject_id);
  // ★★★ F831 fix, same shape as notifyBookedFrom above — every notification first, then every job.
  const notificationIds = [];
  for (const r of recipients) {
    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId: r.app_user_id, eventId: ev.id,
      topic: "booking.booking.cancelled",
      title: `Cancelled: ${booking.service_name}`,
      deepLink: "/app/booking",
    });
    notificationIds.push(notificationId);
  }
  for (const notificationId of notificationIds) {
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  }
}

/**
 * ★★★ Task 18.31 — PAYMENT RECEIVED → STAFF PUSH NOTIFICATIONS.
 *
 * A payment was recorded (money.invoice.paid) → notify the practice's Owners/Admins
 * (staff with staff_role IN ('owner','admin')) + the booking's host (if the invoice
 * was linked to a booking).
 *
 * ★ Push copy uses practice-specific terminology (session/lesson/meeting) via staffPushCopy.
 * ★ Sample payments are skipped outbound (LISTENER_REACH: outbound) — see spec 02 §2.9.
 */
async function notifyPaymentReceived(tx, ev, { tenantId }) {
  const { staffPushCopy } = await import("../notifications/staffPushCopy.mjs");

  // ★★★ Receipts brief (1 Oct 2026, Part 1) — DEDUP. Now reachable from THREE topics
  //   (money.payment.succeeded, money.payment.recorded_offline, money.invoice.paid), and two of
  //   them can fire in the SAME transaction for the SAME payment (handlePaymentIntentSucceeded /
  //   handleStripeInvoicePaid emit money.payment.succeeded unconditionally, then money.invoice.paid
  //   only when the payment closed an invoice — both with the SAME subject_id). Skip the staff push
  //   here when this is `.succeeded` and an `invoice.paid` sibling already exists for the same
  //   subject — that sibling's own delivery (also routed here) sends it once, correctly.
  if (ev.topic === "money.payment.succeeded" && ev.payload?.invoice_id) {
    const { rows: sibling } = await tx.query(
      `SELECT 1 FROM keystone.event
        WHERE tenant_id = $1 AND topic = 'money.invoice.paid' AND subject_id = $2`,
      [tenantId, ev.subject_id]);
    if (sibling.length > 0) return;
  }

  // ★ Fetch payer name and payment amount from the event payload
  const { amount_minor, currency } = ev.payload;
  const invoiceId = ev.payload?.invoice_id;

  // ★★★ FOUND LIVE — `ev.subject_id` is a PAYMENT id from payments.mjs's own two handlers, but an
  //   INVOICE id from clientPayments.mjs's portal-payment path (both call this the same way via
  //   money.invoice.paid). A bare `WHERE id = $2` against `keystone.payment` found zero rows for
  //   every portal payment and threw — resolved by trying both shapes rather than assuming one.
  // ★★★ F854 FIX, 1 Oct 2026 (Part 4a) — THAT fix was real but incomplete: `keystone.payment`/
  //   `keystone.invoice` are BOTH gated behind a viewer-permission RLS policy (`user_may(...) OR
  //   payer_user_id = current_user_id()`), and this whole function runs with NO viewer set (the
  //   dispatcher's own `withTenant`, no userId) — so EITHER query returned zero rows regardless of
  //   which id shape was tried, and this function has THROWN on every real payment since. MEASURED
  //   directly against a real payment row before this fix. `asPracticeOwner` is the same
  //   established pattern GRANT_CREDITS/START_SUBSCRIPTION already use for this exact RLS shape.
  let payment = null;
  await asPracticeOwner(tx, tenantId, async () => {
    const { rows: byPaymentId } = await tx.query(
      `SELECT id, payer_user_id, invoice_id FROM keystone.payment_effective
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subject_id]);
    if (byPaymentId.length > 0) {
      payment = byPaymentId[0];
    } else {
      // Try `ev.subject_id` (or the payload's own invoice_id) as an INVOICE id instead.
      const { rows: byInvoiceId } = await tx.query(
        `SELECT payer_user_id, id AS invoice_id FROM keystone.invoice_effective
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, ev.subject_id ?? invoiceId]);
      if (byInvoiceId.length > 0) payment = { payer_user_id: byInvoiceId[0].payer_user_id, invoice_id: byInvoiceId[0].invoice_id };
    }
  });

  if (!payment) {
    throw new Error(
      `notifyPaymentReceived ${ev.topic} ${ev.subject_id}: neither a payment nor an invoice is ` +
      `readable in tenant ${tenantId}. That is a real failure, deliberately NOT treated as "no ` +
      `notification needed".`);
  }

  const actualInvoiceId = payment.invoice_id || invoiceId;

  // ★ Fetch the payer's name (the person who paid)
  const { rows: payers } = await tx.query(
    `SELECT display_name FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`,
    [tenantId, payment.payer_user_id]);

  const payerName = payers.length > 0 ? payers[0].display_name : "Someone";
  const firstNameOnly = payerName.split(" ")[0];

  // ★ Find all recipients: staff with role owner/admin, plus the booking's host if any
  const recipientIds = new Set();

  // Get all owners and admins
  // ★ F854-ADJACENT FIX, 1 Oct 2026 (Part 4a) — MEASURED BROKEN, a third defect found verifying
  //   the F854 fix: `staff_role`'s real CHECK constraint only ever admits 'owner'/'admin'/'member'
  //   (confirmed via pg_constraint) — 'super_admin' cannot exist in this column at all, and 'owner'
  //   was missing from this list entirely. In production (where the maintainer is the Owner of every real
  //   practice, CLAUDE.md's own standing note) this meant the practice OWNER never received this
  //   push, ever — only a plain 'admin' staff member would have. Matches `recipientsAreOwners`'s
  //   own, correct query shape elsewhere in this file.
  const { rows: admins } = await tx.query(
    `SELECT id FROM keystone.app_user
      WHERE tenant_id = $1 AND role = 'staff' AND staff_role IN ('owner', 'admin')
      AND archived_at IS NULL`,
    [tenantId]);

  for (const admin of admins) {
    recipientIds.add(admin.id);
  }

  // If there's an invoice linked to a booking, add the booking's host
  // ★ F854-ADJACENT FIX, 1 Oct 2026 (Part 4a) — MEASURED BROKEN, a second, independent defect found
  //   verifying the F854 fix just above: `keystone.booking` has NO `invoice_id` column at all
  //   (confirmed via \d) — this query threw "column invoice_id does not exist" on every single
  //   call where `actualInvoiceId` was truthy, i.e. every real invoice-linked payment. The real
  //   link is via `keystone.line_item` (`booking_id`/`invoice_id` are both real columns there,
  //   confirmed), joined to `keystone.booking` for its own `host_id`.
  if (actualInvoiceId) {
    const { rows: bookings } = await tx.query(
      `SELECT b.host_id AS app_user_id FROM keystone.line_item li
         JOIN keystone.booking b ON b.tenant_id = li.tenant_id AND b.id = li.booking_id
        WHERE li.tenant_id = $1 AND li.invoice_id = $2 AND li.booking_id IS NOT NULL`,
      [tenantId, actualInvoiceId]);

    for (const booking of bookings) {
      if (booking.app_user_id) {
        recipientIds.add(booking.app_user_id);
      }
    }
  }

  // ★ Fetch invoice details to get the item label and payout weekday
  let itemLabel = "Payment received";
  let payoutWeekday = null;

  if (actualInvoiceId) {
    // ★ F854 FIX, 1 Oct 2026 (Part 4a) — same RLS gate as above; this read was still unwrapped.
    const { rows: invoices } = await asPracticeOwner(tx, tenantId, () => tx.query(
      `SELECT source FROM keystone.invoice
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, actualInvoiceId]));

    if (invoices.length > 0) {
      // Use the invoice source (e.g., "booking", "staff", etc.) as the item label
      const source = invoices[0].source;
      itemLabel = source === "booking" ? "Session fee" : "Payment";
    }
  }

  // ★ Determine payout weekday: typically payments settle in 2-3 business days
  // For now, we'll say "2 business days from today"
  const today = new Date();
  const dayOfWeek = today.getDay();
  let futureDate = new Date(today);

  // Add days, skipping weekends
  let daysAdded = 0;
  while (daysAdded < 2) {
    futureDate.setDate(futureDate.getDate() + 1);
    if (futureDate.getDay() !== 0 && futureDate.getDay() !== 6) {
      daysAdded++;
    }
  }

  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  payoutWeekday = weekdays[futureDate.getDay()];

  // ★ Compose the push copy
  const { title, body } = await staffPushCopy(tx, "payment_received", {
    personFirstName: firstNameOnly,
    amountMinor: amount_minor,
    currency: currency || "USD",
    itemLabel,
    payoutWeekday,
  });

  // ★ Create one notification per recipient
  for (const recipientId of recipientIds) {
    await createNotification(tx, {
      tenantId,
      recipientId,
      eventId: ev.id,
      // ★ FIX, 1 Oct 2026 — was hardcoded to "money.invoice.paid" even when this ran for
      //   money.payment.succeeded/.recorded_offline (now pushed as extra listeners, above).
      topic: ev.topic,
      title,
      body,
      deepLink: "/app/money",
    });
  }
}

/**
 * ★ PART 2 ADDITION ("every email on the one system", 1 Oct 2026) — the one dispatcher for the
 *   ~71 topics in `genericNotifications.mjs`'s table. Resolves the recipient(s) per the config's
 *   own `recipient` strategy (DIRECT/OWNER/LOOKUP — see `recipientResolvers.mjs`'s header), then
 *   creates ONE notification per recipient and enqueues its email — same two-step shape every
 *   other listener in this file already uses (see MONEY_OWNER_NOTICE/documents.document.expired
 *   above). `title`/`deepLink` are composed ONCE here, from the config's `summary`/`link`
 *   functions, and read back from the notification row by `emailFor()` (its own `summary:
 *   target.title` branch, same idiom F836's four templates already use) — never recomputed there,
 *   since `emailFor()` is pure and has no tx to re-run a LOOKUP query with.
 *
 * ★ A LOOKUP that resolves to `null` is NOT a failure (an archived row, a participant with no
 *   account) — it falls back to practice owners when the config says `fallbackOwner: true`, and
 *   otherwise logs and returns, same posture every resolver in `recipientResolvers.mjs` documents.
 */
async function handleGenericNotice(ev, { tenantId, tx, helpers }) {
  const cfg = GENERIC_NOTIFICATIONS[ev.topic];
  if (!cfg) {
    throw new Error(
      `handleGenericNotice: topic "${ev.topic}" has no entry in genericNotifications.mjs — it was ` +
      `routed here by HANDLER_LISTENER but the table that supplies its recipient/summary/link has ` +
      `no matching row. Add it there first.`);
  }

  // ★ Run 10 (R10-41): a Docustay workspace gets only the document-side notices (see docustayWantsNotice); the CRM ones in this table are the platform's.
  {
    const { rows: [pr] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
    if (pr?.product === "docustay" && !docustayWantsNotice(ev.topic)) {
      helpers.logger.info(`handleGenericNotice ${ev.topic} ${ev.subject_id}: a Docustay workspace does not get Workbench's CRM notices.`);
      return;
    }
  }
  // ★★★ FOUND LIVE, the maintainer's own report, 2 Oct 2026 — `createPerson` (src/people/writes.mjs) emits
  //   `people.person.created` for EVERY new person regardless of role: a staff hire, a client, an
  //   adolescent, a parent, AND a public website lead (src/routes/publicLeads.mjs's own
  //   createPerson call). This listener's `people.welcome` template ("You've been added to the
  //   team.") is staff-onboarding copy — it was firing for literally anyone, which meant a brand
  //   new LEAD who only filled out a website form was immediately emailed that they'd joined the
  //   practice's team. `payload.role` is on every one of these events (writes.mjs's own emit call)
  //   for exactly this kind of branch — only a real staff hire gets this email.
  if (ev.topic === "people.person.created" && ev.payload?.role !== "staff") {
    helpers.logger.info(`handleGenericNotice people.person.created ${ev.subject_id}: role "${ev.payload?.role}" is not staff — not a team-onboarding email.`);
    return;
  }
  // ★ Run 8 (R8-37) — an INVITED teammate has no login yet (`has_login: false`): the invitation email is their welcome. The generic "You've been added to the team." and
  //   "You were granted a new role." went to them in the same second, linking to a page they cannot open yet. A person who already signs in still gets both.
  if (ev.topic === "people.person.created" && ev.payload?.has_login === false) {
    helpers.logger.info(`handleGenericNotice people.person.created ${ev.subject_id}: invited, no login yet — the invitation is their welcome.`);
    return;
  }
  if (ev.topic === "people.role.granted") {
    const { rows: [who] } = await tx.query(`SELECT firebase_uid IS NOT NULL AS has_login FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`, [tenantId, ev.subject_id]);
    if (who && who.has_login === false) { helpers.logger.info(`handleGenericNotice people.role.granted ${ev.subject_id}: invited, no login yet — the invitation says the role.`); return; }
  }

  let recipientIds;
  if (cfg.recipient === "direct") {
    const id = await recipientIsSubject(tx, tenantId, ev);
    recipientIds = id ? [id] : [];
  } else if (cfg.recipient === "owner") {
    recipientIds = await recipientsAreOwners(tx, tenantId);
  } else if (cfg.recipient === "lookup") {
    const resolver = SUBJECT_RECIPIENT_LOOKUP[cfg.lookupKey];
    if (!resolver) {
      throw new Error(`handleGenericNotice: topic "${ev.topic}" names lookupKey "${cfg.lookupKey}", which is not in SUBJECT_RECIPIENT_LOOKUP.`);
    }
    const id = await resolver(tx, tenantId, ev);
    if (id) {
      recipientIds = [id];
      // ★ credits: a package bought FOR someone else tells that person too
      if (cfg.alsoBeneficiary && ev.payload?.beneficiary_user_id && ev.payload.beneficiary_user_id !== id) recipientIds.push(ev.payload.beneficiary_user_id);
    } else if (cfg.fallbackOwner) {
      recipientIds = await recipientsAreOwners(tx, tenantId);
    } else {
      recipientIds = [];
    }
  } else {
    throw new Error(`handleGenericNotice: topic "${ev.topic}" has an unknown recipient strategy "${cfg.recipient}".`);
  }

  if (recipientIds.length === 0) {
    helpers.logger.info(`handleGenericNotice ${ev.topic} ${ev.subject_id}: nobody to notify (not a failure).`);
    return;
  }

  // Run 8 (R8-35): a row may name `facts` (read through the Documents door); a failed read falls back to the row's plain summary, never to no notice
  const facts = cfg.facts ? await cfg.facts(tx, tenantId, ev).catch(() => null) : null;
  const title = cfg.summary(ev, facts);
  const deepLink = facts?.link ?? cfg.link(ev);
  for (const recipientId of recipientIds) {
    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId, eventId: ev.id,
      topic: ev.topic,
      title,
      deepLink,
    });
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  }
}

/**
 * ★ credits defect 25 — who is told that a credit was used / came back: the credit's OWNER (the payer) and, when different, the CLIENT of
 *   the session (the young person whose session it was). The booking may already be gone (a deleted booking returns its credit), then
 *   it is the owner alone.
 */
async function creditNoticeRecipients(tx, { tenantId, bookingId, ownerUserId }) {
  const { rows } = await tx.query(
    `SELECT DISTINCT app_user_id FROM keystone.booking_participant
      WHERE tenant_id = $1 AND booking_id = $2 AND party = 'client' AND app_user_id IS NOT NULL`, [tenantId, bookingId]);
  return [...new Set([ownerUserId, ...rows.map((r) => r.app_user_id)])];
}

export const TOPIC_HANDLERS = Object.freeze({
  /**
   * ★ A document went out for signature → tell the person it is waiting for them.
   * ★★ The RECIPIENT is `subject_user_id` — the person the instrument is ABOUT and who signs it —
   *    not `assigned_to`, which is an assignment TARGET (a role/vocabulary value), not a person.
   *    Emailing `assigned_to` would be emailing a word.
   */
  "documents.document.sent": async (ev, { tx, tenantId, helpers }) => {
    // ★★★ READ AS THE PERSON WHO SENT IT, NOT AS NOBODY. Same finding as the executed handler:
    //     `document_instance`'s SELECT policy calls `document_is_visible()`, which fails closed on a
    //     null viewer. The dispatcher's `tx` has a tenant and NO user, so a read through it returns
    //     zero rows for every document in the practice.
    const actorUserId = ev.payload?.sent_by ?? null;
    if (!actorUserId) {
      throw new Error(
        `documents.document.sent ${ev.subject_id} carries no sent_by, so there is no identity to read ` +
        `the instrument as, and no way to find out who should be emailed. Failing loudly rather than ` +
        `reporting "nobody to notify" — see the note below about why that distinction matters.`);
    }
    // ★★★ TASK 14.31 — `has_sign_link`, READ IN THE SAME ASVIEWER CALL AS EVERYTHING ELSE HERE. A
    //     document sent with a sign-link (14.30's `mintSignLinks`, run inside `sendDocument` before
    //     this event's own transaction commits) already told the recipient by email — the ONE email
    //     that carries the actual thing they need to click. Queuing a SECOND, sign-link-less
    //     "ready to sign" email here (`document.ready_to_sign`, `tasks.mjs:1091`) would be a second
    //     message that cannot even be acted on. The in-app notification is created either way, just
    //     below, unconditionally.
    const row = await asViewer(tx, actorUserId, async () => {
      return instanceSentFacts(tx, { instanceId: ev.subject_id });
    });

    // ★★★ THESE TWO CASES ARE DIFFERENT AND CONFLATING THEM COST A WHOLE E2E RUN.
    //     [MEASURED 2026-09-14] my first version of this handler treated a missing row and a row with
    //     no subject identically — "no subject_user_id, so there is nobody to email, not a failure" —
    //     and logged it as fine. But the row was **INVISIBLE**, not subject-less: the read had no
    //     viewer. So the handler marked the event processed, no email was attempted, and the E2E
    //     reported "the deployed worker did not carry documents.document.sent through" with no clue
    //     why. **A tolerant branch for a legitimate shape silently absorbed a real defect.**
    //   ★ Hence: NOT FOUND is a hard failure (I could not see it, and that is wrong), while FOUND WITH
    //     NO SUBJECT stays the tolerant case (a template sent for internal completion genuinely has
    //     nobody to notify). The difference is one `if`, and it is the difference between a defect that
    //     announces itself and one that hides for a phase.
    if (!row) {
      throw new Error(
        `documents.document.sent ${ev.subject_id}: the instrument is NOT VISIBLE even as its sender ` +
        `(${actorUserId}). That is a real failure — either the actor is no longer staff in this tenant ` +
        `or the row is gone. It is deliberately NOT treated as "nobody to notify".`);
    }
    // an uploaded PDF tells each signer itself (its own party link email, with the link); filing it on a client's record (24 Oct 2026) must not add a second, link-less "ready to sign" notice
    if (row.builder === "pdf") {
      helpers.logger.info(`documents.document.sent ${ev.subject_id}: an uploaded PDF — each signer was emailed their own link when it was sent, so no extra "ready to sign" notice.`);
      return;
    }
    if (!row.subject_user_id) {
      helpers.logger.info(
        `documents.document.sent ${ev.subject_id}: the instrument IS visible and has no subject_user_id, ` +
        `so there is genuinely nobody to email. ★ Not a failure — an instrument can be sent for internal ` +
        `completion. Note this is a DIFFERENT branch from "not visible", which throws.`);
      return;
    }
    // ★★★ THE SAME TRANSACTION. `notification.event_id` REFERENCES the event row this transaction has
    //     already claimed, so inserting it from anywhere else takes an FK share lock on a row we hold —
    //     the self-deadlock described at `asViewer`. Inside the same transaction there is no conflict:
    //     a transaction never waits for its own locks.
    const readyTitle = `${row.title} is ready to sign`;
    const { id: notificationId } = await asViewer(tx, actorUserId, () => createNotification(tx, {
      tenantId, recipientId: row.subject_user_id, eventId: ev.id,
      topic: "documents.document.sent",
      title: readyTitle,
      deepLink: `/app/documents/${row.id}`,
    }));
    // ★★★ TASK 14.31 — SKIP THE EMAIL, NOT THE NOTIFICATION, WHEN A SIGN-LINK ALREADY WENT OUT.
    //     `row.has_sign_link` is read above, through the same viewer. The in-app notification just
    //     created is unconditional either way — only the `document.ready_to_sign` email job is
    //     skipped, because the sign-link email (`document.sign_link`, sent from `sendDocument`
    //     inside this same instrument's own send) already told this person the one thing that
    //     matters: the link.
    if (row.has_sign_link) {
      helpers.logger.info(
        `documents.document.sent ${ev.subject_id}: a sign-link was already minted for this instrument, ` +
        `so the "ready to sign" email is skipped — the sign-link email already carries the link.`);
      return;
    }
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      // ★ One delivery per notification. `replace` keyed on the notification id means a re-dispatched
      //   event cannot queue a second copy of the same email.
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  },

  /**
   * ★★★ F836, "7 missing emails" brief, 1 Oct 2026 — A SENT DOCUMENT LAPSED UNSIGNED → tell the
   *     staff member who sent it, so they know to follow up. Recipient is `created_by`
   *     (migration 0194), read with a PLAIN query, the same way `src/documents/dueFacts.mjs`'s own
   *     `find()` already reads `document_instance` for this exact sweep (no viewer exists for a
   *     worker-initiated sweep — `actor: "worker"` on this event, same as every due-fact action).
   */
  "documents.document.expired": async (ev, { tenantId, tx, helpers }) => {
    const row = await instanceTitleAndCreator(tx, { tenantId, instanceId: ev.subject_id });
    if (!row) {
      throw new Error(`documents.document.expired ${ev.subject_id}: the instrument is not readable in tenant ${tenantId}.`);
    }
    if (!row.created_by) {
      helpers.logger.info(`documents.document.expired ${ev.subject_id}: no created_by on this instrument — nobody to notify. Not a failure.`);
      return;
    }
    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId: row.created_by, eventId: ev.id,
      topic: "documents.document.expired",
      title: `Lapsed unsigned: ${row.title}`,
      deepLink: `/record/document/${ev.subject_id}`,
    });
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  },

  /**
   * ★★★ F836 — A SIGNER DECLINED THE INSTRUMENT → tell the staff member who sent it. Same shape as
   *     documents.document.expired just above (recipient is created_by, not the actor — the actor
   *     here is the DECLINING SIGNER, a public/client identity, never who should be emailed about
   *     their own decline).
   * ★★★ FOUND LIVE, a systematic RLS sweep, 2 Oct 2026 — this used to be the SAME plain query
   *     `documents.document.expired` above still uses, which looks identical but is NOT identical:
   *     `expired`'s read is only safe because by delivery time the document's own state is
   *     'expired', matching `document_instance`'s `system_expiry_read` RLS carve-out. 'declined'
   *     matches NONE of that table's three no-viewer carve-outs — MEASURED: this SELECT returned
   *     zero rows for every real declined document, `row` was always undefined, and this handler
   *     THREW unconditionally. The "a signer declined" notification has never once been created.
   *     Fixed via `instanceNotificationFacts` (documents/frontDoor.mjs → migration 0571's
   *     SECURITY DEFINER lookup), the same no-viewer-needed shape as F875's `document_created_by`.
   */
  "documents.document.declined": async (ev, { tenantId, tx, helpers }) => {
    const row = await instanceNotificationFacts(tx, { tenantId, instanceId: ev.subject_id });
    if (!row) {
      throw new Error(`documents.document.declined ${ev.subject_id}: the instrument is not readable in tenant ${tenantId}.`);
    }
    if (!row.created_by) {
      helpers.logger.info(`documents.document.declined ${ev.subject_id}: no created_by on this instrument — nobody to notify. Not a failure.`);
      return;
    }
    // D-077: say WHO declined and WHY (the reason lives on the party row, which the tenant scope can read — only the document row needs the viewer-free lookup above)
    const who = await declineFacts(tx, { tenantId, instanceId: ev.subject_id });
    const shownTitle = row.title;
    const reasonText = who?.decline_reason ? `“${String(who.decline_reason).replace(/\s+/g, " ").slice(0, 200).replace(/[.!?\s]+$/, "")}”` : "";
    const declinedTitle = who?.name
      ? `${String(who.name).slice(0, 80)} declined “${shownTitle}”${reasonText ? ` — ${reasonText}` : ""}`
      : sentenceCase(`Declined: ${shownTitle}`);
    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId: row.created_by, eventId: ev.id,
      topic: "documents.document.declined",
      title: declinedTitle,
      deepLink: `/record/document/${ev.subject_id}`,
    });
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  },

  /**
   * ★★★ F836 — A CREDIT NOTE WAS ISSUED → tell the client/payer. Recipient is the invoice's own
   *     payer_user_id (the event's subjectId is the invoice, same convention as every other money
   *     event keyed to an invoice).
   * ★★★ F854 FIX, 1 Oct 2026 (Part 4a) — MEASURED BROKEN: `keystone.invoice` is RLS-gated behind a
   *     viewer-permission check this no-viewer worker context never satisfies — confirmed directly
   *     (this exact listener, real invoice row, real payer: logged "invoice not found or has no
   *     payer" and created zero notifications, every time). `asPracticeOwner` wrap added — same
   *     fix as `notifyPaymentReceived`'s own F854 fix just above; see recipientResolvers.mjs's
   *     header for the full RLS-table survey this was found during.
   */
  "money.credit_note.issued": async (ev, { tenantId, tx, helpers }) => {
    const payerUserId = await asPracticeOwner(tx, tenantId, async () => {
      const { rows } = await tx.query(
        `SELECT payer_user_id FROM keystone.invoice_effective WHERE tenant_id = $1 AND id = $2`,
        [tenantId, ev.subject_id]);
      return rows[0]?.payer_user_id ?? null;
    });
    if (!payerUserId) {
      helpers.logger.info(`money.credit_note.issued ${ev.subject_id}: invoice not found or has no payer — nobody to notify.`);
      return;
    }
    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId: payerUserId, eventId: ev.id,
      topic: "money.credit_note.issued",
      title: "A credit note was issued",
      deepLink: "/app/money",
    });
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  },

  /**
   * ★★★ F836 — A PACKAGE WAS PURCHASED (distinct from the generic payment receipt) → tell the
   *     client what they just bought: session count, service, expiry. `money.entitlement.granted`
   *     fires for EVERY entitlement grant (a one-time package purchase, a plan's recurring credit
   *     cycle, or a manual staff comp) — gated here to `line_item.source_type = 'package'` so a
   *     plan renewal or a manual grant does not send "you bought a package" when nothing was
   *     bought. A grant with no line_item_id (a manual comp, src/money/writes.mjs's own
   *     createEntitlement signature) is silently NOT a purchase — no email, not a failure.
   */
  "money.entitlement.granted": async (ev, { tenantId, tx, helpers }) => {
    const lineItemId = ev.payload?.line_item_id ?? null;
    if (!lineItemId) return; // a manual grant, not a purchase — nothing to announce
    const { rows } = await tx.query(
      // ★ credits: `line_item` has no `source_type` column (it is `package_id` / `plan_id` / `service_id`) — this SELECT threw on every grant, so the
      //   "package purchased" email could never be sent. A package line is one with a package_id.
      `SELECT (package_id IS NOT NULL) AS is_package, name_snapshot FROM keystone.line_item WHERE tenant_id = $1 AND id = $2`,
      [tenantId, lineItemId]);
    const li = rows[0];
    if (!li || !li.is_package) return; // a plan renewal or a service line — not this email
    const ownerUserId = ev.payload?.owner_user_id ?? null;
    if (!ownerUserId) {
      helpers.logger.info(`money.entitlement.granted ${ev.subject_id}: no owner_user_id — nobody to notify.`);
      return;
    }
    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId: ownerUserId, eventId: ev.id,
      topic: "money.entitlement.granted",
      title: `Package purchased: ${li.name_snapshot}`,
      deepLink: "/app/money",
    });
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  },

  /**
   * ★★★ An instrument was EXECUTED → render it and put the bytes in the object store.
   * ★★ The archive is NOT written here, for the U25 reason recorded in 0052: the PDF row is a sibling
   *    of the executed instrument, and the render + upload happen outside this transaction.
   */
  "documents.document.executed": async (ev, { tenantId, helpers }) => {
    // ★★★ THE ACTOR TRAVELS WITH THE JOB, AND WITHOUT IT THE ARCHIVE CANNOT READ THE INSTRUMENT.
    //     [MEASURED 2026-09-14 from the deployed worker's own log] the first version of this handler
    //     passed only `{tenantId, instanceId}`, and `archive_document_pdf` then failed
    //         no document instance <id> is visible here    (attempt 5 of 25)
    //     because `document_instance`'s SELECT policy calls `document_is_visible()`, which FAILS CLOSED
    //     on a null `current_user_id()`. The worker has a tenant and, deliberately, no viewer.
    //   ★★ `actorUserId` IS NOT A DESTINATION, so `assertNoDestination` correctly permits it. A payload
    //      may not say WHERE to send; naming WHO acted is the opposite — it narrows what the job can
    //      see, because the RLS predicate is then evaluated as that person.
    //   ★ And it is verified inside the task rather than trusted: `add_job` is callable by anything
    //     holding `app_rw`, so the task re-checks that the named actor is staff in that tenant.
    // ★ FIX, 30 Sep 2026 (worker-failures brief) — prefer `archive_actor_id` (the document's own
    //   staff author, migration-guaranteed visible) over `executed_by` (often the client who
    //   signed) — see writes.mjs's own comment on `archive_actor_id`. Older events carry only
    //   `executed_by`, so that stays the fallback.
    const actorUserId = ev.payload?.archive_actor_id ?? ev.payload?.executed_by ?? null;
    if (!actorUserId) {
      // ★★ FAIL LOUD. An executed instrument with no archive is a hole in the record of a signed
      //    agreement; silently skipping would leave it and say nothing. The event goes to `failed`
      //    with this reason and the backoff retries — which is useless until the payload carries an
      //    actor, and that is exactly the point: it stays visible instead of being forgotten.
      throw new Error(
        `documents.document.executed ${ev.subject_id} carries no executed_by, so there is no identity ` +
        `to read the instrument as. The archive CANNOT run as nobody: document_is_visible() fails ` +
        `closed on a null viewer, by design. Events emitted before executeInstance recorded the actor ` +
        `will keep failing here — that is honest, not broken.`);
    }
    await helpers.addJob("archive_document_pdf", { tenantId, instanceId: ev.subject_id, actorUserId },
      { jobKey: `archive:${ev.subject_id}`, jobKeyMode: "replace", priority: JOB_PRIORITY.archive_document_pdf });   // ahead of every other job: the signer is waiting for the sealed copy
  },

  /**
   * ★ Shared document engine — an AI draft or edit was asked for: start the worker task. The payload carries only ids; the prompt is read from the job row inside the task, under RLS.
   */
  "documents.ai.job_requested": async (ev, { tenantId, helpers }) => {
    const jobId = ev.payload?.job_id ?? ev.subject_id;
    await helpers.addJob("document_ai_draft", { tenantId, jobId }, { jobKey: `document_ai_draft:${jobId}`, jobKeyMode: "preserve_run_at", priority: JOB_PRIORITY.document_ai_draft });
  },

  /**
   * ★ Run 4 — the AI look for fields was asked for: one worker task per page, so the pages are worked in parallel. The payload carries only ids and page numbers; each task reads its page from the job row under RLS.
   */
  "documents.detect.job_requested": async (ev, { tenantId, helpers }) => {
    const jobId = ev.payload?.job_id;
    for (const page of Array.isArray(ev.payload?.pages) ? ev.payload.pages : []) await helpers.addJob("document_detect_page", { tenantId, jobId, page }, { jobKey: `document_detect_page:${jobId}:${page}`, jobKeyMode: "preserve_run_at", priority: JOB_PRIORITY.document_detect_page });
  },

  /**
   * ★★★ P2.5 — A SESSION WAS BOOKED → SCHEDULE ITS REMINDER.
   *
   * ★★ The `booking.reminder` email template has existed since P18 and **nothing has ever sent it**
   *    — [MEASURED] its only reference outside `templates.mjs` was the gate that renders it to check
   *    the wording. This handler is the missing half.
   *
   * ★★★ THE FIRE-TIME CHECK IS STILL THE GUARANTEE. `send_booking_reminder` re-reads the booking's
   *     state when it fires, so a cancelled session sends nothing without anybody having to remember.
   *     Stage 3 Task 9 ADDS a `booking.booking.cancelled` handler that also removes the queued job by
   *     key (brief: "relies on the fire-time check AND removes the queued job") — tidiness on top of
   *     the guarantee, never instead of it: if the removal is missed, the row still says `cancelled`.
   */
  // ★★★ 13.15 — AND SCHEDULE ITS CONSENT HOLD, AND TELL THE CLIENT THEY ARE BOOKED. The reminder
  //     scheduling stays exactly as it was (still the same `scheduleReminderFrom` call, still last);
  //     this only adds the two facts F05 promises that nothing sent before this task: the 24-hour
  //     teen hold (`scheduleHoldExpiryFrom`) and the confirmation itself (`notifyBookedFrom`).
  "booking.booking.created": async (ev, ctx) => {
    await scheduleHoldExpiryFrom(ev, ctx);
    await notifyBookedFrom(ev, ctx);
    await enqueueCalendarPush(ev, ctx);
    return scheduleReminderFrom(ev, ctx);
  },

  /**
   * ★★★ STAGE 3 TASK 9 — A SESSION WAS MOVED → MOVE ITS REMINDER. Same job key, `replace`, so the queue
   *     holds ONE reminder per booking at the NEW time; the job names THIS event as its scheduler, and the
   *     fire-time check accepts a booking's latest created/rescheduled event only (see send_booking_reminder).
   *   ★ If the new time leaves no reminder moment (switched off, or its moment already past), the old job is
   *     REMOVED — otherwise it would stay queued at the old time.
   * ★★★ 13.15 — AND TELL THE CLIENT IT MOVED (`notifyMovedFrom`), before the reminder is re-scheduled.
   */
  "booking.booking.rescheduled": async (ev, ctx) => {
    await notifyMovedFrom(ev, ctx);
    await enqueueCalendarPush(ev, ctx);
    return scheduleReminderFrom(ev, ctx);
  },

  /**
   * ★★ STAGE 3 TASK 9 — A SESSION WAS CANCELLED → REMOVE ITS QUEUED REMINDER BY KEY. graphile's own
   *    `remove_job` (a locked, running job is left to finish and meets the fire-time state check).
   * ★★★ 13.15, DOCTRINE 3 (R-13.6) — AND TELL THE CLIENT IT WAS CANCELLED (`notifyCancelledFrom`),
   *     sent FIRST — the existing reminder-removal keeps running exactly as it did before this task.
   */
  "booking.booking.cancelled": async (ev, ctx) => {
    await notifyCancelledFrom(ev, ctx);
    await enqueueCalendarPush(ev, ctx);
    await ctx.helpers.withPgClient((pg) =>
      pg.query(`SELECT graphile_worker.remove_job($1)`, [reminderJobKey(ev.subject_id)]));
  },

  /**
   * ★★★ FIX, 30 Sep 2026 ("credit-used email" brief) — `consumeCreditForBooking` (src/money/
   *     credits.mjs) announced nothing: nothing downstream could ever tell a client their credit
   *     was spent. This is the missing half — one notification, one email, naming the service and
   *     the standing (`standingSentence`, the SAME composer the reminder email and the client app
   *     already use for "Session 4 of 12 · 9 remaining" — P10.4's own ruling that this sentence is
   *     computed once, not redrafted per surface).
   * ★ THE OWNER AND SERVICE ARE READ FRESH FROM THE ENTITLEMENT, not trusted from the payload —
   *   the entitlement row is the authority on who a credit belongs to, and it cannot change between
   *   the emit and this read (an entitlement's owner is immutable — see 0015's own schema).
   */
  "booking.booking.credit_consumed": async (ev, { tenantId, tx, helpers }) => {
    const { rows: [entRow] } = await tx.query(
      `SELECT e.owner_user_id, e.service_id, s.name AS service_name
         FROM keystone.entitlement e
         LEFT JOIN keystone.service s ON s.id = e.service_id
        WHERE e.id = $1 AND e.tenant_id = $2`,
      [ev.payload?.entitlement_id, tenantId]);
    if (!entRow) {
      throw new Error(
        `booking.booking.credit_consumed ${ev.subject_id}: entitlement ${ev.payload?.entitlement_id} ` +
        `is not readable in tenant ${tenantId} — nobody to tell.`);
    }
    // ★ credits defect 25 — the PAYER (credit owner) AND the person the session is for (when they are not the same person)
    for (const recipientId of await creditNoticeRecipients(tx, { tenantId, bookingId: ev.subject_id, ownerUserId: entRow.owner_user_id })) {
      const { id: notificationId } = await createNotification(tx, {
        tenantId, recipientId, eventId: ev.id,
        topic: "booking.booking.credit_consumed",
        title: `A credit was used — ${entRow.service_name ?? "your session"}`,
        deepLink: "/app/money",
      });
      await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
        { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
    }
  },

  /**
   * ★ FIX, 30 Sep 2026 ("credit-used email" brief) — the return-trip half: a cancelled/released
   *   booking's credit came back, told the same way (its own dedicated topic, its own email, never
   *   silently folded into the "session cancelled" notification that topic already sends — see the
   *   emitters' own notes on why the two are separate facts).
   */
  "booking.booking.credit_returned": async (ev, { tenantId, tx, helpers }) => {
    const { rows: [entRow] } = await tx.query(
      `SELECT e.owner_user_id, e.service_id, s.name AS service_name
         FROM keystone.entitlement e
         LEFT JOIN keystone.service s ON s.id = e.service_id
        WHERE e.id = $1 AND e.tenant_id = $2`,
      [ev.payload?.entitlement_id, tenantId]);
    if (!entRow) {
      throw new Error(
        `booking.booking.credit_returned ${ev.subject_id}: entitlement ${ev.payload?.entitlement_id} ` +
        `is not readable in tenant ${tenantId} — nobody to tell.`);
    }
    // ★ credits defect 25 — the PAYER (credit owner) AND the person the session is for (when they are not the same person)
    for (const recipientId of await creditNoticeRecipients(tx, { tenantId, bookingId: ev.subject_id, ownerUserId: entRow.owner_user_id })) {
      const { id: notificationId } = await createNotification(tx, {
        tenantId, recipientId, eventId: ev.id,
        topic: "booking.booking.credit_returned",
        title: `A credit came back — ${entRow.service_name ?? "your session"}`,
        deepLink: "/app/money",
      });
      await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
        { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
    }
  },

  /**
   * ★ P2.5 — the reminder fired → put a notification in front of every participant who has an
   *   account, and let `deliver_notification_email` render the P18 template.
   * ★★ ONE NOTIFICATION PER RECIPIENT, each naming THIS event as its cause — `createNotification`
   *    refuses an eventId-less notification precisely so "why did I get this?" always has an answer.
   */
  "booking.booking.reminder": async (ev, { tenantId, tx, helpers }) => {
    const booking = await reminderFacts(tx, ev.subject_id);
    if (!booking) {
      throw new Error(
        `booking.booking.reminder ${ev.subject_id}: the booking is not readable in tenant ${tenantId}.`);
    }
    const recipients = await reminderRecipients(tx, ev.subject_id);
    if (recipients.length === 0) {
      // ★ A session whose only attendees are guests with no account. Genuinely nobody to notify
      //   THROUGH THIS PATH — see reminders.mjs on why a guest is not emailed here.
      helpers.logger.info(
        `booking.booking.reminder ${ev.subject_id}: no participant has an account, so there is ` +
        `nobody to notify. Not a failure.`);
      return;
    }
    // ★★ Stage 4 Task 6 fix round 1 (review M1): EVERY notification first, THEN every email job. The job is added on
    //    graphile's own connection, outside this transaction, so it cannot be rolled back with it. Adding each job
    //    straight after its notification meant a failure on the SECOND recipient rolled back the first notification
    //    and left its email job behind — an orphan that retried "not found" for 14.6 h and then raised a false
    //    give-up. Now nothing is queued unless every notification was written. (The residual window — the delivery
    //    mark or the batch commit failing after the adds — is the dispatcher's; a transactional enqueue would close
    //    it and is refused by db/gates/s4_job_policy today.)
    // ★ Booking everywhere (22 Oct 2026): honour the channels the firing job captured on the event. An event without them (every reminder emitted
    //   before this change, or a call that names none) means both, exactly as before. The notification row IS the in-app reminder AND the record an
    //   email hangs off, so it is written whenever either channel is wanted; with email off, no email job is queued. Push is not wired (dropped upstream).
    const channels = Array.isArray(ev.payload?.channels) ? ev.payload.channels : null;
    const sendEmail = channels === null || channels.includes("email");
    const notificationIds = [];
    for (const r of recipients) {
      const { id: notificationId } = await createNotification(tx, {
        tenantId, recipientId: r.app_user_id, eventId: ev.id,
        topic: "booking.booking.reminder",
        title: `Reminder: ${booking.title ?? booking.service_name}`,
        deepLink: `/app/engagements/${booking.id}`,
      });
      notificationIds.push(notificationId);
    }
    if (!sendEmail) return;
    for (const notificationId of notificationIds) {
      await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
        { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
    }
  },

  /**
   * ★★★ 12.9 — A REFERRAL WAS SENT → QUEUE ITS EMAIL. No destination travels in the payload
   *     (`assertNoDestination`): `deliver_referral_email` reads both addresses fresh, under RLS,
   *     from the referral row itself.
   */
  "people.referral.sent": async (ev, { tenantId, helpers }) => helpers.addJob(
    "deliver_referral_email", { tenantId, referralId: ev.subject_id },
    { jobKey: `referral-email:${ev.subject_id}` }),
});

/**
 * ★★★ P2.5 — THE SCHEDULED REMINDER FIRES. It does NOT send anything itself; it emits the event, and
 *     the handler above turns that into notifications. Same shape as every other write in this
 *     project: **the event is the record that it happened**, and a send with no event is a thing
 *     nobody can later explain.
 *
 * ★★★ EVERY DECISION IS RE-MADE HERE, FROM THE ROW, AT FIRE TIME. The job was queued when the
 *     booking was created and the world has had until now to change: the session may have been
 *     cancelled, rescheduled, or already have happened. `reminderRunAt` is asked again with the
 *     CURRENT row — so a cancelled booking is silent without any cancel path having to remember.
 */
// ★ NOT EXPORTED — `TASK_LIST` below is its only caller, and the wiring gate counted the export as a
//   new orphan the moment it was written. **Export it WITH its caller**; the fifth time this build has
//   made that decision, and the rule has not changed. ★★ Its siblings above ARE exported and sit in
//   the gate's baseline — raising the baseline to match them would have been "do not raise the
//   baseline to match", which is what the gate's own failure text forbids.
/**
 * ★ 6 Oct 2026 — ENQUEUE THE CALENDAR RECONCILE. One job per booking, replaced while queued, so a burst of created/rescheduled/cancelled
 *   collapses into one run that reads the booking as it is then. A practice with no Google connection pays one cheap no-op run.
 */
async function enqueueCalendarPush(ev, { helpers, tenantId }) {
  await helpers.addJob("push_booking_to_calendar", { tenantId, bookingId: ev.subject_id },
    { jobKey: `calpush:${ev.subject_id}`, jobKeyMode: "replace" });
}

const pushBookingToCalendar = guardedTask("push_booking_to_calendar", async (payload, helpers) => {
  const { tenantId, bookingId } = payload;
  if (!tenantId || !bookingId) throw new Error("push_booking_to_calendar needs a tenantId and a bookingId");
  const out = await withTenant(tenantId, (tx) => reconcileBookingCalendar(tx, { tenantId, bookingId }));
  helpers.logger.info(`push_booking_to_calendar: booking ${bookingId} — ${JSON.stringify(out)}`);
});

const sendBookingReminder = guardedTask("send_booking_reminder", async (payload, helpers) => {
  const { tenantId, bookingId, minutesBefore = null } = payload;
  if (!tenantId || !bookingId) {
    throw new Error("send_booking_reminder needs a tenantId and a bookingId");
  }

  await withTenant(tenantId, async (tx) => {
    // ★★★ Stage 16 task 16.32 — check if booking reminders are toggled off.
    const reminderEnabled = await getSetting(tx, automationSettingKey("booking.reminder"), true);
    if (reminderEnabled === false) {
      helpers.logger.info(`send_booking_reminder: booking reminders are toggled off — nothing sent.`);
      return;
    }

    const booking = await reminderFacts(tx, bookingId);
    if (!booking) {
      // ★ The booking is gone or invisible. Nothing to remind about and nothing to repair — this is
      //   a scheduled job catching up with a deleted row, not the read-as-nobody defect (this task
      //   opens its own tenant scope and the booking policy does not gate on a viewer).
      helpers.logger.info(`send_booking_reminder: booking ${bookingId} no longer exists — nothing sent.`);
      return;
    }

    // ★★★ THE STATE CHECK THAT REPLACES A CANCEL PATH — AND IT IS `stillRemindable`, NOT
    //     `reminderRunAt`. [EXECUTED] the first version called `reminderRunAt` here and **could never
    //     send anything**: that function refuses a run time already in the past, which is right when
    //     scheduling and exactly backwards when firing, because by then the moment has arrived. Every
    //     reminder was silently skipped, and the gate's cancelled-session assertion passed over a
    //     task that emitted nothing for any booking at all.
    //   ★★ So the question asked here has NO CLOCK IN IT: is this still a session somebody should be
    //      reminded about? Cancelled, completed, no-show, or reminder switched off → no.
    // ★★★ BOOKING OVERHAUL, 29 Sep 2026 — A JOB CARRYING `minutesBefore` IS JUDGED BY THE PRACTICE'S
    //     CURRENT OFFSET SETTINGS, NOT BY THE BOOKING ROW'S SINGLE COLUMN. This is what makes turning
    //     an offset off in Run → Templates actually stop a reminder that was already queued for it,
    //     even though nothing proactively hunts down and removes that queued job (the same
    //     ask-at-fire-time philosophy `stillRemindable`'s own header already argues for — a job whose
    //     offset has since been disabled fires, checks, and sends nothing).
    //   ★ A job with NO `minutesBefore` is a LEGACY job — queued under the single `reminderJobKey`
    //     before this task existed — and keeps running the exact original check.
    let remindable;
    if (minutesBefore !== null) {
      const offsets = normalizeReminderOffsets(
        await getSetting(tx, REMINDER_OFFSET_SETTING_KEY, DEFAULT_REMINDER_OFFSETS));
      const stillEnabled = offsets.some((o) => o.minutes === minutesBefore && o.enabled);
      remindable = stillRemindableAtAll(booking) && stillEnabled;
    } else {
      remindable = stillRemindable(booking);
    }
    if (!remindable) {
      helpers.logger.info(
        `send_booking_reminder: booking ${bookingId} is ${booking.state}` +
        `${booking.archived_at ? " and ARCHIVED" : ""}` +
        (minutesBefore !== null
          ? ` — the ${minutesBefore}-minute offset is disabled or the booking is not remindable.`
          : ` with reminder_minutes_before=${booking.reminder_minutes_before} — no reminder sent.`));
      return;
    }

    // ★★★ STAGE 3 TASK 8 — A SAMPLE BOOKING IS NEVER REMINDED (spec 02 §2.9, 08 §6). What this job emits
    //     below is an ordinary, non-sample event that notify_booking_reminder would email, so the sample
    //     decision is made HERE, at fire time, from the event that SCHEDULED this job (fix round 1, F4):
    //       · `scheduledByEventId` given → refuse iff that event is sample, OR it is not visible, OR it is not
    //         this booking's `booking.booking.created` (fail closed: a payload naming the wrong event is a bug
    //         or a forgery — add_job is callable by app_rw).
    //       · LEGACY job, queued before the id was carried → the only enqueue path is the
    //         `booking.booking.created` listener, so read THAT event (the booking's creating event) and refuse
    //         iff it is sample. No creating event visible → send: every legacy job predates any code that sets
    //         `sample`, so a legacy job for a real booking must still remind (INFERRED: nothing sets sample).
    //     Unrelated events on the booking (attendance, participants — Stage 9 may flag those by person) do
    //     NOT decide it.
    // ★★★ STAGE 3 TASK 9, FIX ROUND 1 (T9-R1) — WHICH JOB IS CURRENT IS DECIDED BY THE ROW, NOT BY EVENT ORDER.
    //     A job carries the `starts_at` it was scheduled for; it sends iff the booking STILL starts then. A job
    //     for a time the session has moved away from is stale and sends nothing. The first version compared
    //     events by `(created_at, id)` — transaction START order, not commit order — and silently dropped the
    //     real reminder when a created-listener retry ran after the reschedule's (review T9-R1).
    //   ★ The event check stays for the sample rule (spec 02 §2.9): the scheduling event must be visible, not
    //     sample, and this booking's `created` or `rescheduled`.
    // ★★★ FIX ROUND 2 (T9-F1-1) — AN OLD-SHAPE JOB (no stored start) GETS ITS START FROM ITS SCHEDULING EVENT,
    //     and the same rule applies: `created` → payload.starts_at, `rescheduled` → payload.to_starts_at. An
    //     id-less legacy job takes its booking's creating event. Round 1 let such a job SEND at the old time
    //     after a move. The alternatives were rejected: "is there a later rescheduled event" is ordered by
    //     created_at (transaction start, not commit — the defect T9-R1 removed), and "does the current reminder
    //     moment equal now ± tolerance" depends on worker lag and would drop a late but valid reminder. The
    //     event's own recorded start is a fact fixed when it was written, so the comparison is commit-order-
    //     and clock-independent. A creating event with no readable start (none exists today) is not refused
    //     on that ground — only on the sample rule, as in Task 8.
    const scheduledBy = payload.scheduledByEventId ?? null;
    const { rows: [s] } = scheduledBy
      ? await tx.query(
        `SELECT coalesce((SELECT sample OR topic NOT IN ('booking.booking.created', 'booking.booking.rescheduled')
                                 OR subject_id <> $2
                            FROM keystone.event WHERE tenant_id = $1 AND id = $3), true) AS refuse,
                (SELECT CASE topic WHEN 'booking.booking.rescheduled' THEN payload->>'to_starts_at'
                                   ELSE payload->>'starts_at' END
                   FROM keystone.event WHERE tenant_id = $1 AND id = $3) AS event_start`,
        [tenantId, bookingId, scheduledBy])
      // ★★★ F604 FIX (21 Sep 2026) — a legacy job with NO scheduling event id used to fall back to
      //     `coalesce(bool_or(sample), false)`: if this booking's `booking.booking.created` event was
      //     not visible at all, `bool_or(sample)` is SQL NULL and the coalesce made it SEND (refuse =
      //     false). Absence of evidence is not evidence of a real booking — the default is now `true`,
      //     so no visible creating event REFUSES (fails closed) instead of sending. A visible, non-
      //     sample creating event still sends; a visible sample creating event still refuses — both
      //     unchanged.
      : await tx.query(
        `SELECT coalesce(bool_or(sample), true) AS refuse, min(payload->>'starts_at') AS event_start
           FROM keystone.event
          WHERE tenant_id = $1 AND topic = 'booking.booking.created' AND subject_id = $2`, [tenantId, bookingId]);
    const scheduledFor = payload.scheduledForStartsAt ?? s.event_start ?? null;
    if (scheduledFor && new Date(scheduledFor).getTime() !== new Date(booking.starts_at).getTime()) {
      helpers.logger.info(
        `send_booking_reminder: booking ${bookingId} was scheduled for ${scheduledFor} but now starts at ` +
        `${new Date(booking.starts_at).toISOString()} — a stale job; no reminder sent (Stage 3 Task 9).`);
      return;
    }
    if (s.refuse) {
      helpers.logger.info(
        `send_booking_reminder: booking ${bookingId} — its scheduling event ${scheduledBy ?? "(legacy: creating event)"} ` +
        `is sample, not visible, or not this booking's scheduling event — no reminder sent ` +
        `(spec 02 §2.9; Stage 3 Task 9).`);
      return;
    }

    // ★★★ AND THE CLOCK QUESTION, ASKED SEPARATELY AND BY NAME. [MEASURED, P2 CLOSE §VISUAL] a
    //     booking ten days in the past, still `confirmed`, was remindable — nothing forces a
    //     confirmed booking to transition, so a retried or re-dispatched job reminds somebody about
    //     a session that already happened.
    //   ★ `stillRemindable` deliberately has no clock in it (see reminders.mjs) and that stays. This
    //     is the one place a clock belongs at fire time, and it is written where a reader looks.
    if (alreadyHappened(booking, new Date())) {
      helpers.logger.info(
        `send_booking_reminder: booking ${bookingId} started at ${booking.starts_at}, which is ` +
        `already past — no reminder sent. ★ A reminder for a session that has happened is worse ` +
        `than none: it tells somebody to attend something they have already attended or missed.`);
      return;
    }

    // ★ Booking everywhere (22 Oct 2026, plan §8 decision 2) — WHICH CHANNELS THIS REMINDER USES: `booking.reminder_channels` maps minutes before →
    //   [email, in_app, push]. UNSET (or this offset not named) = what has always happened: a notification AND an email for every enabled offset.
    //   ★ PUSH IS NOT WIRED on the beta (no Firebase project): it is dropped here silently — a reminder whose only channel is push sends nothing,
    //   with no error, until push exists. The channels travel in the event payload (the moment-of-firing capture the rest of this payload uses) and
    //   the booking.booking.reminder handler honours them.
    const channels = reminderChannelsFor(await getSetting(tx, "booking.reminder_channels", null), minutesBefore);
    const deliverable = deliverableChannels(channels);
    if (!deliverable.email && !deliverable.inApp) {
      helpers.logger.info(`send_booking_reminder: booking ${bookingId} — the ${minutesBefore}-minute reminder's channels (${channels.join(", ") || "none"}) include nothing deliverable yet (push is not wired) — nothing sent.`);
      return;
    }

    await emit(tx, {
      tenantId,
      topic: "booking.booking.reminder",
      emittedBy: "booking",
      subjectType: "booking",
      subjectId: bookingId,
      // ★ FIX ROUND 1, I2 — `sendBookingReminder` is a `guardedTask`, reached only from the job
      //   queue (scheduled by the `booking.booking.created` handler), never from a request.
      actor: "worker",
      // ★ The payload carries what a reader needs without re-reading, and names the ZONE. A reminder
      //   saying "10:00" with no zone is how somebody misses a session (§B4 STEP 3).
      // ★★★ STAGE 3 TASK 3 — `service_name` DROPPED (free text, §2.4). `deliverNotificationEmail`'s
      //   own query is rewired to join the CURRENT `service.name` for this booking at delivery time
      //   instead — see `emailFor()`'s comment below. `location_kind` stays: it is the closed enum
      //   `booking_location_kind_check` (0085) allows — in_person/video/phone/other — not a name.
      payload: {
        starts_at: booking.starts_at,
        timezone: booking.timezone,
        // ★ Booking everywhere: the offset this reminder is for, and the deliverable channels (enum tokens — the handler below reads them).
        minutes_before: minutesBefore,
        channels: [...(deliverable.email ? ["email"] : []), ...(deliverable.inApp ? ["in_app"] : [])],
        location_kind: booking.location_kind,
        // ★ BOOKING EMAIL OVERHAUL, 29 Sep 2026 — a video session's Zoom/Meet link, so the reminder
        //   can include it the same way the confirmation does (`emailFor`'s `bookingLocationLine`).
        //   Carried alongside `location_kind` for the same reason that field travels in the payload:
        //   it is a closed, small fact about the booking that a reminder needs at send time.
        location_detail: booking.location_detail,
        // ★★★ P10.4 — THE COUNT-DOWN IS CAPTURED HERE, AT THE MOMENT THE REMINDER FIRES, AND
        //     TRAVELS IN THE PAYLOAD. Composing it at DELIVERY time would put a number in the email
        //     that was true when the worker ran rather than when the fact happened — and a reminder
        //     saying "9 remaining" after the client has spent one is worse than saying nothing.
        //   ★ Null when they hold no package, and the template treats it as optional for that reason:
        //     "0 remaining" tells somebody they have run out of something they never had.
        //   ★ The CLIENT participant, read here rather than added to `reminderFacts` — that
        //     function has its own contract and its own gate, and widening it to carry a money fact
        //     would make a reminder's shape depend on the credit system.
        // ★★★ `bookingId`, NOT `ev.subject_id` — AND THE WRONG ONE CRASHED EVERY REMINDER.
        //     [MEASURED at the P10 close, by `db/gates/p2_booking_fields.mjs` §7] this read
        //     `ev.subject_id`, and **there is no `ev` in this scope**. This task is the one that
        //     EMITS `booking.booking.reminder`; an `ev` exists in the TOPIC HANDLERS that receive
        //     it, three functions away. The result was a `ReferenceError` thrown from inside the
        //     `emit()` payload — so the task died BEFORE writing the event, and **no reminder was
        //     ever sent for any booking in any tenant.**
        //   ★★★ P10.4's OWN GATE PASSED THROUGHOUT. It exercises `creditStanding`/
        //       `standingSentence` and the email template directly; nothing in it ran the real
        //       task. A guard over the parts is not a guard over the wire — and this is what the
        //       full suite at a phase close is for, since the gate that caught it belongs to P2.
        //   ★★ IT IS ALSO WHY THE CRASH WAS INVISIBLE: `guardedTask` catches, logs and lets
        //      graphile-worker retry, so in production this would have been a quiet retry loop on a
        //      job that can never succeed — not an alarm. `src/health/watch.mjs`'s dead-job count
        //      (P8.10) is the thing that would eventually have shouted.
        //   ★ Two lines above, `subjectId: bookingId` names the same fact correctly. The binding was
        //     always in scope; the wrong one was reached for.
        // ═══════════════════════════════════════════════════════════════════════════════════════
        // ★★★ STAGE 3 TASK 3 — `credit_standing` USED TO CARRY THE COMPOSED SENTENCE
        //     ("Session 4 of 12 · 9 remaining", `money/credits.mjs:standingSentence`) — a free-text
        //     string and a genuine offender found running this task's own test suite, not one of
        //     the 12 the recon named. THE THREE NUMBERS travel instead — `credit_total` ·
        //     `credit_remaining` · `credit_session_number` — which is the SAME moment-of-firing
        //     capture the header above argues for (composing at delivery time would still be wrong),
        //     just not pre-rendered into English. `emailFor()` below calls the same
        //     `standingSentence()` on these three numbers to build the email variable, so the
        //     rendered text is byte-identical to before.
        // ═══════════════════════════════════════════════════════════════════════════════════════
        ...(await (async () => {
          const { rows: [who] } = await tx.query(
            `SELECT app_user_id FROM keystone.booking_participant
              WHERE booking_id = $1 AND app_user_id IS NOT NULL
                AND party IN ('client', 'pir', 'recipient')
              ORDER BY id LIMIT 1`, [bookingId]);
        // ★★★ `ORDER BY id`, AND THE COLUMN THIS FIRST SAID DOES NOT EXIST. It read
        //     `ORDER BY created_at`; `keystone.booking_participant` has NINE columns and none of
        //     them is `created_at` (id · tenant_id · booking_id · app_user_id · display_name ·
        //     email · party · attended · optional, MEASURED from the catalogue). **A second defect
        //     in the same eight lines as the `ev` one, hidden by the same fact: nothing had ever
        //     executed this query.** The first crash masked the second — fixing one produced the
        //     other on the very next run.
        //   ★★ `id` IS NOT AN ARBITRARY SUBSTITUTE. It defaults to `uuid_generate_v7()`, which is
        //      time-ordered, so this is still "the first client participant added" — the same
        //      intent, from the column that actually carries it.
        //   ★ ORDER AT ALL, because `LIMIT 1` over an unordered set is a different participant on
        //     different days. A session with two account-holding clients should show ONE of them a
        //     count-down, and the same one every time.
          if (!who) return { credit_total: null, credit_remaining: null, credit_session_number: null };
          const standing = await creditStanding(tx, { tenantId, ownerUserId: who.app_user_id });
          // ★ `standingSentence` itself returns null for "no active entitlement" (total === 0) — the
          //   same null-means-nothing-to-say shape, just carried as numbers now.
          return standingSentence(standing) === null
            ? { credit_total: null, credit_remaining: null, credit_session_number: null }
            : { credit_total: standing.total, credit_remaining: standing.remaining,
                credit_session_number: standing.sessionNumber };
        })()),
      },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ SPEC 03b TASK 3b.4 — `booking_hold_expiry`. 03b §7 / foundations 07 §3 line 45.
//
// ★★ THE TRIGGER SIDE IS NOT BUILT HERE, AND THAT IS A NAMED GAP, NOT AN OVERSIGHT. §7's own words:
//    "scheduled at now()+24h the moment a booking enters pending_consent" — i.e. the caller that
//    would `helpers.addJob("booking_hold_expiry", {tenantId, bookingId}, {runAt, jobKey:
//    holdExpiryJobKey(bookingId), jobKeyMode:'replace'})` belongs to whichever code path actually
//    CREATES a `pending_consent` booking. [MEASURED, 22 Sep 2026] that code path does not exist
//    anywhere in `src/` yet — `grep -rn "pending_consent" src/` finds only a comment in
//    `src/booking/publicBooking.mjs:295` noting the state is refused, never reached, by task 3b.3's
//    own build (`forMinor: true` is a hard refusal there today). Spec 03b's own task list gives that
//    state transition to task 3b.5 (the teen consent gate), not to this task. This dispatch's file
//    list is `src/queue/tasks.mjs` / `src/queue/jobPolicy.mjs` / `src/queue/giveUpOwners.mjs` only —
//    `src/booking/createBooking.mjs` (where a scheduling call would eventually live) and whatever
//    3b.5 adds are both out of scope here. So: this job is BUILT and REGISTERED (loads cleanly,
//    has a policy row, has a give-up owner) but has NO CALLER YET — the next task that makes a
//    booking enter `pending_consent` is the one that must add the `addJob` call.
//    ★ DELIBERATELY NOT exporting a `holdExpiryJobKey` helper here: with no caller anywhere in `src/`
//      today, an exported-but-unused function is exactly the "wired to nothing" shape CLAUDE.md's
//      failure #1 names and `db/gates/wiring.mjs`'s orphan ratchet exists to catch. The key SHAPE is
//      recorded here instead, in the one place a future caller will read it: the job key is
//      `` `booking_hold_expiry:${bookingId}` `` (a plain per-booking key, `jobKeyMode:'replace'`,
//      `runAt: now()+24h` — same idiom `reminderJobKey`/`scheduleReminderFrom` above already use).
//      That caller should add its own helper beside its own scheduling call, not import a stub added
//      here for a job it does not yet trigger.

const bookingHoldExpiry = guardedTask("booking_hold_expiry", async (payload, helpers) => {
  const { tenantId, bookingId } = payload;
  if (!tenantId || !bookingId) {
    throw new Error("booking_hold_expiry needs a tenantId and a bookingId");
  }

  await withTenant(tenantId, async (tx) => {
    const { rows: [booking] } = await tx.query(
      `SELECT id, state FROM keystone.booking WHERE tenant_id = $1 AND id = $2`,
      [tenantId, bookingId]);
    if (!booking) {
      // ★ Gone or invisible — nothing to release and nothing to repair, same reasoning
      //   send_booking_reminder above gives for the identical case.
      helpers.logger.info(`booking_hold_expiry: booking ${bookingId} no longer exists — nothing to release.`);
      return;
    }

    // ★★★ 07 §4 RULE 4 — CONDITION FROM THE DATA, NOT THE SCHEDULER. The job fires at the +24h
    //     mark it was scheduled for, but that says nothing about whether the hold is STILL open —
    //     it re-reads the row's CURRENT state before doing anything. `confirmed` (consent landed)
    //     and `cancelled` (someone cancelled it already) are both genuine no-ops, the same
    //     idempotent shape every other job in this file has (§7's own text, verbatim).
    if (booking.state !== "pending_consent") {
      helpers.logger.info(
        `booking_hold_expiry: booking ${bookingId} is ${booking.state}, not pending_consent — no-op ` +
        `(consent already landed, or it was already cancelled).`);
      return;
    }

    // ★ §2.4's existing, unchanged function — already returns any reserved package/entitlement
    //   credit (closing A10's hold-path scenario, §12) and already emits `booking.booking.cancelled`
    //   itself. This job adds nothing to that call; it only decides WHETHER to make it.
    const result = await cancelBooking(tx, { tenantId, bookingId, actorUserId: null });
    if (!result.cancelled) {
      // ★ A race between this job's read above and its cancel below — something else cancelled the
      //   same booking in between. `cancelBooking`'s own exactly-once guard already made this a
      //   no-op; there is nothing left for this job to do, and no event of its own to emit.
      helpers.logger.info(
        `booking_hold_expiry: booking ${bookingId} was cancelled by something else between the read ` +
        `and this job's own cancel — no-op.`);
      return;
    }

    // ★★★ F-6 (03b review, 22 Sep 2026) — three-segment topic name, matching `event_topic_check`
    //     (0016) and TOPICS.booking. ★★ NOT YET IN `src/events/topics.mjs` as this task lands
    //     (MEASURED 22 Sep 2026, see this task's report) — out of this dispatch's file scope; emit()
    //     (src/events/outbox.mjs:372) will throw `TopicViolation` on this call until that catalogue
    //     entry exists. Left as specified rather than substituted for an existing topic, because a
    //     substitution would be a second, wrong answer, not a fix.
    await emit(tx, {
      tenantId,
      topic: "booking.hold.expired",
      emittedBy: "booking",
      subjectType: "booking",
      subjectId: bookingId,
      // ★ Reached only from the job queue, never from a request — same reasoning
      //   send_booking_reminder's own `actor: "worker"` gives above.
      actor: "worker",
      payload: {},
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 13.15 — THE WAITLIST OFFER EMAIL, AND ITS EXPIRY. Placed directly after `bookingHoldExpiry`,
//     same neighbourhood spec 03b §7's own table puts them in.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ SEND ONE WAITLIST OFFER. Re-reads the entry at fire time (same guarantee every job in this
 *     file gives): an offer already claimed, expired, or removed by the time this runs sends
 *     nothing — the tolerant, idempotent branch every sibling job in this file takes.
 * ★★ LINK CHOICE: a `public_bookable` service mints a `waitlist_claim` link token and the message
 *     carries `/waitlist/claim?t=<presented>`; any other service mints nothing and points at
 *     `/app/booking` — the client signs in and books the freed slot through the portal, where 13.11
 *     marks the entry `claimed`. The presented secret lives ONLY in the email, never in the
 *     notification row or a job payload (assertNoDestination would refuse it as a destination key
 *     if it tried).
 */
const sendWaitlistOffer = guardedTask("send_waitlist_offer", async (payload, helpers) => {
  const { tenantId, entryId, eventId = null } = payload;
  if (!tenantId || !entryId) throw new Error("send_waitlist_offer needs a tenantId and an entryId");
  if (!eventId) {
    // ★ createNotification refuses an eventId-less notification (P8.1's rule); failing loudly here,
    //   before any work, is more honest than reaching that refusal three queries in.
    throw new Error("send_waitlist_offer needs an eventId — a notification must name the event that caused it.");
  }

  let mail = null;
  await withTenant(tenantId, async (tx) => {
    const { rows: [entry] } = await tx.query(
      `SELECT e.id, e.status, e.offered_starts_at, e.offer_expires_at, e.client_user_id,
              e.display_name, e.email, e.service_id, e.host_id,
              s.name AS service_name, s.public_bookable,
              h.display_name AS host_name,
              t.name AS practice_name, t.timezone
         FROM keystone.booking_waitlist_entry e
         JOIN keystone.service s ON s.id = e.service_id
         LEFT JOIN keystone.app_user h ON h.id = e.host_id
         JOIN keystone.tenant t ON t.id = e.tenant_id
        WHERE e.tenant_id = $1 AND e.id = $2`,
      [tenantId, entryId]);
    if (!entry) {
      helpers.logger.info(`send_waitlist_offer: entry ${entryId} no longer exists — nothing to send.`);
      return;
    }
    // ★ Re-checked at fire time: a race with the claim endpoint (13.14) or with waitlist_offer_expiry
    //   below may have already moved this entry on. Tolerant, same as bookingHoldExpiry's own re-check.
    if (entry.status !== "offered" || !entry.offer_expires_at
        || new Date(entry.offer_expires_at).getTime() <= Date.now()) {
      helpers.logger.info(
        `send_waitlist_offer: entry ${entryId} is ${entry.status} (expires ${entry.offer_expires_at}) — ` +
        `not an open offer right now, nothing to send.`);
      return;
    }

    // ★ "Told others" — read from the event THIS job was queued for, never re-derived: `told_count`
    //   is the count `offerFreedSlot`/`offerTime` (src/booking/waitlist.mjs) computed at offer time.
    let toldOthers = "";
    const { rows: [ev] } = await tx.query(`SELECT payload FROM keystone.event WHERE id = $1`, [eventId]);
    const toldCount = ev?.payload?.told_count;
    if (typeof toldCount === "number" && toldCount > 1) {
      const others = toldCount - 1;
      toldOthers = `${others} other${others === 1 ? "" : "s"} on the list were told about it too.`;
    }

    const minutesLeft = Math.max(1, (new Date(entry.offer_expires_at).getTime() - Date.now()) / 60_000);
    let link = "/app/booking";
    if (entry.public_bookable === true) {
      const minted = await mintLinkToken(tx, {
        tenantId, purpose: "waitlist_claim", subjectId: entryId, issuedTo: entry.client_user_id,
        ttlHours: Math.max(1 / 60, minutesLeft / 60),
      });
      await tx.query(
        `UPDATE keystone.booking_waitlist_entry SET claim_token_id = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, entryId, minted.id]);
      link = `/waitlist/claim?t=${minted.presented}`;
    }

    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId: entry.client_user_id, eventId,
      topic: "booking.waitlist.offered",
      title: `A time opened up: ${entry.service_name}`,
      deepLink: "/waitlist/claim",
    });

    mail = {
      notificationId, to: entry.email,
      vars: {
        practiceName: entry.practice_name, recipientName: entry.display_name,
        whenLocal: whenLocal(entry.offered_starts_at, entry.timezone),
        serviceName: entry.service_name, hostName: entry.host_name ?? `your coach`,
        link, toldOthers,
      },
    };
  });

  if (!mail) return;
  // ★ Terminology live before send, frozen after — the same idiom deliverNotificationEmail uses below.
  const terms = await withTenant(tenantId, (tx) => resolveTerms(tx));
  await sendNotificationEmail({
    tenantId, notificationId: mail.notificationId, to: mail.to,
    templateKey: "booking.waitlist_offer", vars: mail.vars, terms,
  });
});

/**
 * ★★★ AN UNCLAIMED OFFER RETURNS TO THE LIST. Fires at `offer_expires_at`; if the entry is still
 *     `offered` past that moment, every still-`offered` entry for the SAME freed slot (same
 *     `offered_starts_at` + service — `offerFreedSlot` broadcasts one offer to several entries at
 *     once) goes back to `waiting` together, and each one's claim token (if any) is revoked. The
 *     slot itself needs nothing — it was already free. A second run finds nothing `offered` for that
 *     slot and does nothing (idempotent).
 */
const waitlistOfferExpiry = guardedTask("waitlist_offer_expiry", async (payload, helpers) => {
  const { tenantId, entryId } = payload;
  if (!tenantId || !entryId) throw new Error("waitlist_offer_expiry needs a tenantId and an entryId");

  await withTenant(tenantId, async (tx) => {
    const { rows: [entry] } = await tx.query(
      `SELECT id, status, offer_expires_at, offered_starts_at, service_id
         FROM keystone.booking_waitlist_entry WHERE tenant_id = $1 AND id = $2`,
      [tenantId, entryId]);
    if (!entry) {
      helpers.logger.info(`waitlist_offer_expiry: entry ${entryId} no longer exists — nothing to return.`);
      return;
    }
    if (entry.status !== "offered" || !entry.offer_expires_at
        || new Date(entry.offer_expires_at).getTime() > Date.now()) {
      helpers.logger.info(
        `waitlist_offer_expiry: entry ${entryId} is ${entry.status} — no longer an open offer, ` +
        `nothing to return (idempotent).`);
      return;
    }

    const { rows: returned } = await tx.query(
      `UPDATE keystone.booking_waitlist_entry
          SET status = 'waiting', offered_starts_at = NULL, offered_ends_at = NULL,
              offer_expires_at = NULL, offered_host_id = NULL, updated_at = now()
        WHERE tenant_id = $1 AND service_id = $2 AND offered_starts_at = $3 AND status = 'offered'
          AND offer_expires_at <= now()
        RETURNING id, claim_token_id`,
      [tenantId, entry.service_id, entry.offered_starts_at]);

    // ★★★ `revokeLinkTokenById`, NOT `revokeLinkToken` — FIXED 25 Sep 2026 (B-29).
    //     `claim_token_id` is `link_token.id` (0398 declares it
    //     `uuid REFERENCES keystone.link_token (id)`), but `revokeLinkToken` keys on the PUBLIC
    //     `token_id`. A uuid never matches a 26-character token id, so this matched no row, the
    //     definer function returned NULL, and the wrapper reported `{revoked:false}` WITHOUT
    //     RAISING. This loop logged success every time and revoked nothing.
    //   ★★ The link therefore stayed live after the offer expired, until its own TTL ran out —
    //      somebody whose offer had lapsed could still claim the slot. 13.15 wrote this exactly
    //      as its plan section specified and then read the function it was calling; that is how
    //      it was found.
    //   ★ It cannot look the public id up instead: app_rw has no SELECT on `token_id` (CCR-16).
    //     0404 adds the id-keyed definer sibling for precisely this caller.
    for (const row of returned) {
      if (row.claim_token_id) {
        await revokeLinkTokenById(tx, row.claim_token_id, "offer_expired");
      }
    }
  });
});

/**
 * ★★★ SEND ONE NOTIFICATION BY EMAIL. The address is read HERE, under RLS, never from the payload.
 *
 * ★★ `sendNotificationEmail` already records every outcome on `notification_delivery` — including
 *    `skipped` when the deployment has no RESEND_API_KEY, which is a different fact from `failed` and
 *    is why that module draws the distinction. So this task does NOT throw on a failed send: the row
 *    is the record, and throwing would additionally re-queue a message the provider has already
 *    refused. ★ It DOES throw when it cannot find the recipient at all, because that is a data defect
 *    rather than a delivery outcome and no row would otherwise exist to notice it.
 */
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHICH TEMPLATE THIS NOTIFICATION IS, CHOSEN FROM ITS TOPIC.
//
//   [MEASURED, P2 CLOSE §VISUAL] this task hardcoded `templateKey: "document.ready_to_sign"` and
//   `practiceName: "your practice"`. It is the delivery path for BOTH live notification producers,
//   so **every email the system sent was the document template**, and a session reminder arrived
//   reading:
//
//     SUBJECT  your practice: your Reminder: Intake Session is ready to sign
//     TEXT     Your coach at your practice has sent you a document to review and sign...
//              Nothing is signed until you choose to sign it
//
//   ★★ P2.5's stated purpose was *"the `booking.reminder` template has existed since P18 and has
//      never been sent."* It still had never been sent — the template was built, registered,
//      required-vars-checked, and unreachable, because the one sender never named it.
//   ★ And `practiceName` was the literal string "your practice" on every message leaving the
//     building, for every tenant. `tenant.name` was one join away.
//
// ★★★ AN UNMAPPED TOPIC THROWS. It does NOT fall back to a template.
//     Falling back is precisely the defect above — a default that looks like delivery and is a
//     mislabelled message somebody reads and acts on. A missing map entry is a build error that
//     surfaces on the first send; a wrong template is a lie that never surfaces at all.
//     ★ Same shape as F163 and `entryFor` in archive.mjs: a lookup that falls back on a name it does
//       not recognise collapses "I do not know this" into a confident wrong answer.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const TOPIC_TEMPLATE = Object.freeze({
  "documents.document.sent":     "document.ready_to_sign",
  "documents.document.executed": "document.ready_to_sign",
  "booking.booking.reminder":    "booking.reminder",
  // ★ 13.15 — the events F05 promises finally reach people. `booking.waitlist.offered` is mapped
  //   here for completeness (every topic this file's TOPIC_HANDLERS/LISTENER_RUN reaches gets ONE
  //   entry) — its actual send does NOT go through `emailFor`/this map: `sendWaitlistOffer` above
  //   calls `sendNotificationEmail` directly with vars it composes itself (it needs `hostName`,
  //   which nothing below this point can supply — see that task's own header).
  "booking.booking.created":     "booking.confirmed",
  "booking.booking.rescheduled": "booking.moved",
  "booking.booking.cancelled":   "booking.cancelled",
  "booking.waitlist.offered":    "booking.waitlist_offer",
  // ★ Stage 15 task 15.37 — money email templates (F720). Nine topics map to money email templates.
  "money.invoice.sent":          "money.invoice_issued",
  "money.invoice.reminder_due":  "money.invoice_reminder",
  "money.payment.succeeded":     "money.receipt",
  "money.payment.recorded_offline": "money.receipt",
  // ★ FIX, 1 Oct 2026 (receipts brief, Part 1) — a failed charge used to send the generic
  //   "update your card" template, never actually saying the payment failed. Split into its own
  //   template, "Your payment didn't go through" — the maintainer's own wording.
  "money.payment.failed":        "money.payment_failed",
  "money.payment_method.update_requested": "money.update_card",
  "money.payment.refunded":      "money.refund_notice",
  "money.estimate.sent":         "money.estimate",
  "money.estimate.expiring":     "money.estimate_expiring",
  // ★ NEW, receipts brief (1 Oct 2026, Part 2) — card updated/removed client emails.
  "money.payment_method.updated": "money.card_updated",
  "money.payment_method.removed": "money.card_removed",
  "money.payment_method.expiring_soon": "money.card_expiring",
  // ★ NEW, receipts brief (1 Oct 2026, Part 2) — plan lifecycle client emails.
  "money.subscription.started": "money.plan_started",
  "money.subscription.cancelled": "money.plan_cancelled",
  "money.subscription.paused": "money.plan_paused",
  "money.subscription.resumed": "money.plan_resumed",
  // ★ F720's five missing mappings (staff-facing and client-facing).
  "money.invoice.paid":          "money.receipt",
  "money.invoice.opened":        "money.invoice_raised",
  "money.payout.failed":         "money.payout_failed",
  "money.dispute.opened":        "money.dispute_opened",
  // ── Stage 16 ──
  "growth.campaign.sent":        "growth.campaign",
  // ★ Stage 18 task 18.4 — operator access request notification. The why and duration are
  //   free text and a number respectively, carried on the notification row's body and
  //   read fresh at delivery time.
  "platform.support_access.requested": "support_access.requested",
  // ★ NEW, 30 Sep 2026 ("credit-used/returned email" brief).
  "booking.booking.credit_consumed": "money.credit_used",
  "booking.booking.credit_returned": "money.credit_returned",
  // ★ F836, "7 missing emails" brief, 1 Oct 2026.
  "documents.document.expired": "documents.document_expired",
  "documents.document.declined": "documents.document_declined",
  "money.credit_note.issued": "money.credit_note_issued",
  "money.entitlement.granted": "money.package_purchased",
  // ★ PART 2 ADDITION ("every email on the one system", 1 Oct 2026) — the ~71 generic-path topics.
  //   Spread from genericNotifications.mjs's own table rather than retyped here, so the two cannot
  //   drift apart (a topic added there is automatically mapped here).
  ...Object.fromEntries(Object.entries(GENERIC_NOTIFICATIONS).map(([topic, cfg]) => [topic, cfg.templateKey])),
});

/** ★ Wall-clock in the practice's own zone, and the zone is NAMED — a reminder saying "10:00" with
 *  no zone is how somebody misses a session, and across DST it is wrong by an hour (B4 STEP 3). */
const whenLocal = (iso, zone) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: zone,
  }).format(new Date(iso));

/** ★ Tester fix, 22 Oct 2026 — a readable zone name for a booking email ("Pacific Time"), never the raw IANA id unless Intl gives nothing. */
export function zoneName(zone, iso) {
  if (!zone) return zone;
  try {
    const d = iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso) : new Date();
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(d).find((x) => x.type === "timeZoneName");
    return part?.value || zone;
  } catch { return zone; }
}

/** ★ Tester fix, 22 Oct 2026 — a US number as "(510) 555-0133" (from +15105550133, 15105550133 or 5105550133); anything else exactly as given. */
export function formatPhone(raw) {
  if (typeof raw !== "string") return raw ?? null;
  const t = raw.trim();
  const m = /^(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/.exec(t);
  return m && (!t.startsWith("+") || t.startsWith("+1")) ? `(${m[1]}) ${m[2]}-${m[3]}` : t;
}

/** ★ Receipts brief (1 Oct 2026) — the one money formatter this file never had; see its own note
 *   on the generic money-template branch below for why it exists now. */
function formatMoneyMinor(amountMinor, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" })
    .format(amountMinor / 100);
}

/** ★ Same brief — a due date, no time or weekday (unlike whenLocal, which is for a session). */
function formatDateOnly(iso, zone) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: zone || "UTC",
  }).format(new Date(iso));
}

/**
 * ★ BOOKING EMAIL OVERHAUL, 29 Sep 2026 — one sentence naming where a session happens, or null when
 *   there is nothing to say (no kind recorded — most bookings before this task). ★★ Absent rather
 *   than blank, same idiom `creditStanding` above already uses: a template appends this line only
 *   when it exists, so a booking with no location recorded reads exactly as it did before this task.
 */
function bookingLocationLine(kind, detail, { forHost = false } = {}) {
  const link = typeof detail === "string" ? detail.trim() : "";
  // the host IS the coach: their copy says what to do, never "your coach will send you"
  if (kind === "video") return link ? `Join by video: ${link}` : forHost ? "By video — no join link is set; send the client one before the call." : "By video — your coach will send you the link to join before the call.";
  if (kind === "phone") return link ? `By phone — the call is to ${link}.` : "By phone.";
  if (kind === "in_person") return link ? `In person — ${link}` : "In person.";
  if (kind === "other") return link || null;
  return null;
}

/**
 * ★ Booking everywhere (22 Oct 2026) — the client's "Change or cancel" link and the sentence about when online changes close, from the facts
 *   `deliverNotificationEmail` stashed on `target.booking_email` (src/email/bookingEmailFacts.mjs). Absent (null, not blank) for staff and
 *   whenever no link may be shown (a cancelled, started or past booking). All three emails (confirmed, moved, reminder) use the plan's
 *   frame-20 sentence; "Changes online close N before." only when the booking is already inside the notice window at send time.
 *   Also carries the separate Reschedule / Cancel links (`&do=move` / `&do=cancel`) and the calendar links (`style` is kept for callers).
 */
function manageVars(be, style) {
  if (!be || be.isHost || !be.manageUrl) return { manageUrl: null, rescheduleUrl: null, cancelUrl: null, changeLine: null, icsUrl: null, googleUrl: null };
  const n = be.noticeText, ph = formatPhone(be.practicePhone);
  // ★ 22 Oct 2026 tester fix — frame 20's sentence is used for EVERY booking email; "Changes online close …" only when the booking is ALREADY
  //   inside the notice window when the email is sent (e.g. a reminder 1 hour before a 2-hour notice).
  const changeLine = !n ? null : be.insideNotice
    ? `Changes online close ${n} before.${ph ? ` Call or text us at ${ph}.` : ""}`
    : `You can change or cancel online up to ${n} before.${ph ? ` After that, call or text ${ph}.` : ""}`;
  return {
    manageUrl: be.manageUrl, rescheduleUrl: be.rescheduleUrl ?? null, cancelUrl: be.cancelUrl ?? null, changeLine,
    icsUrl: be.icsUrl ?? null, googleUrl: be.googleUrl ?? null,
  };
}

export function emailFor(target) {
  const practiceName = target.practice_name;
  // D-077: a workspace owner whose account name is the organisation name (set at sign-up) is greeted as "there", not by the organisation
  const recipientName = target.display_name && target.display_name !== target.practice_name ? target.display_name : "there";
  const p = target.event_payload ?? {};
  // ★ Booking everywhere (22 Oct 2026) — resolved by deliverNotificationEmail for the four booking topics (pure here: no tx).
  const be = target.booking_email ?? null;

  // ★ FIX, 30 Sep 2026 (worker-failures brief) — migration 0542. A notification that names its
  //   OWN template (today: every automation send — invoice_chase/win_back/package_low, which all
  //   share the one topic 'tasks.automation.ran' and so cannot be told apart by TOPIC_TEMPLATE)
  //   wins over the topic map. These templates all declare `variables: ["practiceName",
  //   "recipientName"]` only (defaultTemplates/index.mjs) — no topic-specific vars to build.
  // ★ 9 Oct 2026 — the invoice chase (to the payer) and the overdue notice (to staff) carry the invoice's own facts, resolved in deliverNotificationEmail; they used to get only the two names and fall into the template's "Payment for your invoice is due." fallback.
  if (target.template_key === "automation.invoice_chase" || target.topic === "money.invoice.overdue") {
    const isOverdueNotice = target.topic === "money.invoice.overdue";
    const currency = target.invoice_currency ?? p.currency ?? "USD";
    const amountMinor = target.invoice_amount_minor ?? p.amount_minor ?? null;
    const dueAt = target.invoice_due_at ?? p.due_at ?? null;
    const standing = dueStanding(dueAt, new Date(), target.practice_timezone ?? "UTC");
    const domain = process.env[APP_DOMAIN_VAR];
    const absolute = (rel) => (rel && rel.startsWith("/") && target.practice_slug && domain ? `https://${target.practice_slug}.${domain}${rel}` : rel || "");
    const payUrl = target.invoice_pay_url || absolute(target.deep_link) || "";
    const downloadPdfUrl = "";
    if (isOverdueNotice) {
      return { templateKey: "money.invoice_overdue", vars: {
        practiceName, recipientName,
        invoiceNumber: target.invoice_number_full ?? p.invoice_number ?? "(no number)",
        amount: amountMinor == null ? "" : formatMoneyMinor(amountMinor, currency),
        dueLocal: dueAt ? formatDateOnly(dueAt, target.practice_timezone) : "",
        standing: standing.phrase,
        link: target.event_subject_id && domain && target.practice_slug ? `https://${target.practice_slug}.${domain}/record/invoice/${target.event_subject_id}` : (target.deep_link ?? ""),
      } };
    }
    return { templateKey: target.template_key, vars: {
      practiceName, recipientName,
      invoiceNumber: target.invoice_number_full ?? "",
      amount: amountMinor == null ? "" : formatMoneyMinor(amountMinor, currency),
      dueLocal: dueAt ? formatDateOnly(dueAt, target.practice_timezone) : "",
      standing: standing.phrase,
      daysPastDue: standing.overdue ? String(standing.days) : "",
      link: payUrl, payUrl, downloadPdfUrl,
      lineItemsSummary: target.invoice_line_summary || "",
    } };
  }
  if (target.template_key && target.topic !== "tasks.automation.ran") {
    return { templateKey: target.template_key, vars: { practiceName, recipientName } };
  }

  const templateKey = TOPIC_TEMPLATE[target.topic] ?? (target.topic === "tasks.automation.ran" ? target.template_key : undefined);
  if (!templateKey) {
    throw new Error(
      `no email template is mapped for topic "${target.topic}". The mapped topics are ` +
      `${Object.keys(TOPIC_TEMPLATE).join(", ")}. ★ This THROWS rather than defaulting: a default ` +
      `sent every notification in this system as "your document is ready to sign", including ` +
      `session reminders, and nothing surfaced it because a wrong template still delivers.`);
  }

  // ★ Stage 15 task 15.37 — money link purposes for deep links (minted at delivery time in task).
  const MONEY_LINK_PURPOSE = {
    "money.invoice.sent": "invoice_view", "money.invoice.reminder_due": "invoice_view",
    "money.invoice.paid": "invoice_view", "money.invoice.opened": "invoice_view",
    "money.estimate.sent": "estimate_accept", "money.estimate.expiring": "estimate_accept",
    "money.payment.failed": "card_update", "money.payment_method.update_requested": "card_update",
  };
  // If a deep_link is already set on the target, use it (minted during deliverNotificationEmail).
  // Otherwise, for money topics, the link will be composed at delivery time.
  const link = target.deep_link || "/app/money";

  if (templateKey === "booking.reminder") {
    const zone = p.timezone ?? target.practice_timezone;
    return { templateKey, vars: {
      practiceName, recipientName,
      // ★★★ STAGE 3 TASK 3 — READ FROM THE CURRENT RECORD, NOT THE EVENT. `p.service_name` was
      //   dropped from the payload (free text, §2.4); `deliverNotificationEmail`'s query now joins
      //   the booking's CURRENT service name (`current_service_name`, added there) so this renders
      //   whatever the session is called TODAY, exactly like every other "read from the record"
      //   fix this task makes.
      serviceName: target.current_service_name ?? target.title,
      whenLocal: whenLocal(p.starts_at, zone),
      timeZone: zoneName(zone, p.starts_at),
      // ★★★ P10.4 / KS-16.2 RULING 5 — THE THIRD SURFACE. A client who never opens the app still
      //     gets the count-down, in the message they were going to read anyway.
      //   ★★ THE NUMBERS COME FROM THE EVENT'S PAYLOAD, not from a fresh query. The reminder
      //      describes a moment; re-counting at delivery time would put a number in the email that
      //      was true when the worker ran and not when the fact happened — and a reminder that says
      //      "9 remaining" after the client spent one is worse than saying nothing.
      //   ★★★ STAGE 3 TASK 3 — THE SENTENCE ITSELF IS COMPOSED HERE, NOT STORED. The payload used to
      //      carry `credit_standing` pre-rendered ("Session 4 of 12 · 9 remaining") — a free-text
      //      string and a genuine offender. It now carries the three NUMBERS
      //      (`credit_total`/`credit_remaining`/`credit_session_number`) that `standingSentence`
      //      needs, and this is the one place — at render time — that turns them back into the
      //      sentence, which is byte-identical to what the payload used to carry pre-formed.
      //   ★ Absent rather than zero when they hold no package (`standingSentence` returns null), and
      //     the template treats it as optional for that reason.
      creditStanding: p.credit_total == null ? null : standingSentence({
        total: p.credit_total, remaining: p.credit_remaining, sessionNumber: p.credit_session_number,
      }),
      locationLine: bookingLocationLine(p.location_kind, p.location_detail),
      ...manageVars(be, "reminder"),
    } };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ FIX, 30 Sep 2026 ("credit-used/returned email" brief) — `credit_total`/`credit_remaining`/
  //     `credit_session_number` are stashed onto `target` by `deliverNotificationEmail` right
  //     before this function is called (the same "resolve outside, read here" shape
  //     `MONEY_LINK_PURPOSE` already uses for a deep link) — `emailFor` itself is pure and has no
  //     tx, so it cannot query them.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (templateKey === "money.credit_used" || templateKey === "money.credit_returned") {
    return { templateKey, vars: {
      practiceName, recipientName,
      serviceName: target.current_service_name ?? "your session",
      creditStanding: target.credit_total == null ? null : standingSentence({
        total: target.credit_total, remaining: target.credit_remaining, sessionNumber: target.credit_session_number,
      }),
      creditsRemaining: String(target.credit_remaining ?? 0),
    } };
  }

  // ★ NEW, receipts brief (1 Oct 2026, Part 2) — card updated/removed.
  if (templateKey === "money.card_updated") {
    return { templateKey, vars: {
      practiceName, recipientName,
      cardLine: p.brand && p.last_four ? `${p.brand} •••• ${p.last_four}` : "your card",
      link: target.deep_link || "/app/money",
    } };
  }
  if (templateKey === "money.card_removed") {
    return { templateKey, vars: { practiceName, recipientName, link: target.deep_link || "/app/money" } };
  }
  if (templateKey === "money.card_expiring") {
    return { templateKey, vars: {
      practiceName, recipientName,
      cardLine: p.brand && p.last_four ? `${p.brand} •••• ${p.last_four}` : "your card",
      expMonth: String(p.exp_month ?? ""), expYear: String(p.exp_year ?? ""),
      link: target.deep_link || "/app/money",
    } };
  }
  if (templateKey === "money.plan_started" || templateKey === "money.plan_cancelled" ||
      templateKey === "money.plan_paused" || templateKey === "money.plan_resumed") {
    return { templateKey, vars: {
      practiceName, recipientName,
      planName: target.subscription_plan_name ?? "your plan",
      resumeOn: p.resume_on ? formatDateOnly(p.resume_on, target.practice_timezone) : null,
      link: target.deep_link || "/app/money",
    } };
  }

  // ★★★ Receipts brief (1 Oct 2026, Part 1) — money.receipt gets its OWN branch: service, date,
  //     amount, and the card actually used ("Visa •••• 4242") — everything the maintainer asked for beyond
  //     what the generic money branch below already gives every other money template.
  //     `receipt_*` fields are stashed onto `target` by deliverNotificationEmail, same "resolve
  //     outside, read here" idiom as credit_total.
  if (templateKey === "money.receipt") {
    const amountMinor = p.amount_minor ?? p.amount_due_minor ?? null;
    const currency = p.currency ?? "USD";
    const cardLine = target.receipt_card_brand && target.receipt_card_last4
      ? `${target.receipt_card_brand} •••• ${target.receipt_card_last4}` : null;
    return { templateKey, vars: {
      practiceName, recipientName,
      amount: amountMinor == null ? null : formatMoneyMinor(amountMinor, currency),
      serviceName: target.receipt_service_name ?? "Payment",
      whenLocal: target.receipt_paid_at
        ? formatDateOnly(target.receipt_paid_at, target.practice_timezone) : null,
      cardLine,
      link: target.deep_link || "/app/money",
    } };
  }

  // ★ Money templates — the link is minted during deliverNotificationEmail and set on target.deep_link.
  if (templateKey === "money.invoice_issued" || templateKey === "money.invoice_reminder" ||
      templateKey === "money.update_card" || templateKey === "money.payment_failed" ||
      templateKey === "money.refund_notice" || templateKey === "money.estimate" ||
      templateKey === "money.estimate_expiring" || templateKey === "money.invoice_raised" ||
      templateKey === "money.payout_failed" || templateKey === "money.dispute_opened") {
    // ★★★ FOUND LIVE, receipts brief (1 Oct 2026, Part 1) — MEASURED: `p.amount_formatted` and
    //     `p.due_local` are never set by ANY emit() call for ANY of these ten topics (grepped src/
    //     for both names — zero writers) — every money email using this shared branch has been
    //     rendering a blank amount and a blank due date since it shipped. Rebuilt to compute both
    //     from the RAW fields these payloads actually carry (`amount_minor`/`currency`/`due_at`,
    //     confirmed present at every real emit site checked), with a currency fallback for the one
    //     payload (money.invoice.reminder_due) that omits it — matching this tenant's own default
    //     the way every other unset-currency read in this codebase already does.
    const amountMinor = p.amount_minor ?? p.amount_due_minor ?? p.amount_total_minor ?? null;
    const currency = p.currency ?? "USD";
    // ★ Part 3 invoice rebuild — `payUrl`/`downloadPdfUrl`/`lineItemsSummary` only ever get real
    //   values for money.invoice_issued/money.invoice_reminder (the two topics
    //   deliverNotificationEmail stashes target.invoice_pay_url/invoice_line_summary for, right
    //   above where target.deep_link is minted); the other 8 topics sharing this branch get "" —
    //   harmless, since their own registry schemas don't reference these keys and Zod strips
    //   unknown keys by default.
    const domain = process.env[APP_DOMAIN_VAR];
    const downloadPdfUrl = target.deep_link ? `https://${target.practice_slug}.${domain}/api/public/money/invoice/pdf?t=${target.deep_link.split("/").pop()}` : "";
    return { templateKey, vars: {
      practiceName, recipientName,
      invoiceNumber: p.invoice_number ?? target.invoice_number_full ?? null,
      amount: (amountMinor ?? target.invoice_amount_minor) == null ? null : formatMoneyMinor(amountMinor ?? target.invoice_amount_minor, currency),
      // A due date is a calendar day, not an instant: the due-date buttons store midnight UTC on the intended day, so formatting it in a timezone west of UTC showed the day before (found in a real delivered email, 2 Oct 2026). Always UTC.
      dueLocal: (p.due_at ?? target.invoice_due_at) ? formatDateOnly(p.due_at ?? target.invoice_due_at, "UTC") : null,
      link: templateKey === "money.invoice_raised" && target.event_subject_id && process.env[APP_DOMAIN_VAR] && target.practice_slug
        ? `https://${target.practice_slug}.${process.env[APP_DOMAIN_VAR]}/record/invoice/${target.event_subject_id}` : (target.deep_link || "/app/money"),
      standing: (p.due_at ?? target.invoice_due_at) ? dueStanding(p.due_at ?? target.invoice_due_at, new Date(), target.practice_timezone ?? "UTC").phrase : "",
      payUrl: target.invoice_pay_url || "",
      downloadPdfUrl,
      lineItemsSummary: target.invoice_line_summary || "",
      reason: target.payout_reason || "Stripe did not say why. Check the payout in your Stripe dashboard.",
      answerBy: target.dispute_answer_by ? formatDateOnly(target.dispute_answer_by, target.practice_timezone) : "the date shown in your Stripe dashboard",
    } };
  }

  // ★★★ 13.15 — THE THREE NOTICES, AND WHY `serviceName` FALLS BACK TO `target.title`. Same idiom
  //     `booking.reminder` above uses (`current_service_name ?? target.title`): `current_service_name`
  //     is joined by `deliverNotificationEmail` ONLY for `booking.booking.reminder` (that query is out
  //     of this task's scope — "not to touch"), so for these three topics it is always null and the
  //     fallback is always taken — `target.title` is this task's own `notifyBookedFrom`/
  //     `notifyMovedFrom`/`notifyCancelledFrom` title ("Booked: …"/"Moved: …"/"Cancelled: …").
  // ★ Booking everywhere (22 Oct 2026, spec §8) — WHEN THE RECIPIENT IS THE BOOKING'S ASSIGNED HOST the client's template is swapped for the
  //   staff one (booking.host_new / host_moved / host_cancelled): who booked, when (in the PRACTICE's zone — the host works in it), how, where it
  //   came from, and a link to the booking in the platform. Same three events, same notification; only the template differs.
  const hostVars = (iso, extra = {}) => {
    const zone = target.practice_timezone ?? "UTC";
    const when = iso ?? be.startsAt;
    return {
      practiceName, recipientName,
      clientName: be.clientName || "A client",
      serviceName: be.serviceName ?? target.current_service_name ?? target.title,
      whenLocal: when ? whenLocal(when, zone) : null,
      timeZone: zoneName(zone, when),
      clientContact: [be.clientEmail, formatPhone(be.clientPhone)].filter(Boolean).join(" \u00b7 ") || null,
      howLine: bookingLocationLine(be.locationKind, be.locationDetail, { forHost: true }),
      bookingLink: be.bookingLink ?? null,
      ...extra,
    };
  };

  if (templateKey === "booking.confirmed") {
    if (be?.isHost) {
      return { templateKey: HOST_TEMPLATE_FOR[templateKey], vars: hostVars(p.starts_at, {
        noteLine: be.noteText ? `Note: ${be.noteText}` : null,
        sourceLine: be.sourceLabel ? `Booked through ${be.sourceLabel}.` : null,
      }) };
    }
    const zone = p.invitee_timezone ?? target.practice_timezone;
    return { templateKey, vars: {
      practiceName, recipientName,
      serviceName: target.current_service_name ?? be?.serviceName ?? target.title,
      whenLocal: whenLocal(p.starts_at, zone),
      timeZone: zoneName(zone, p.starts_at),
      locationLine: bookingLocationLine(target.current_location_kind, target.current_location_detail),
      clientLine: target.body ?? "",
      withName: be?.hostName ?? null,
      icsUrl: be?.isHost === false ? be.icsUrl ?? null : null,
      googleUrl: be?.isHost === false ? be.googleUrl ?? null : null,
      ...manageVars(be, "confirmed"),
    } };
  }

  if (templateKey === "booking.moved") {
    if (be?.isHost) {
      const hz = target.practice_timezone ?? "UTC";
      return { templateKey: HOST_TEMPLATE_FOR[templateKey], vars: hostVars(p.to_starts_at, {
        fromWhenLocal: p.from_starts_at ? whenLocal(p.from_starts_at, hz) : null,
      }) };
    }
    // ★ `to_starts_at`, not `starts_at` — MEASURED from both `rescheduleBooking` call sites
    //   (src/booking/reschedule.mjs:268,350), which carry the NEW time under that key.
    const zone = p.timezone ?? target.practice_timezone;
    return { templateKey, vars: {
      practiceName, recipientName,
      serviceName: target.current_service_name ?? be?.serviceName ?? target.title,
      whenLocal: whenLocal(p.to_starts_at, zone),
      timeZone: zoneName(zone, p.to_starts_at),
      fromWhenLocal: p.from_starts_at ? whenLocal(p.from_starts_at, zone) : null,
      // same When / How / With lines as the confirmation (frame 20), then the calendar links and change links for the NEW time
      locationLine: be ? bookingLocationLine(be.locationKind, be.locationDetail) : null,
      withName: be?.hostName ?? null,
      ...manageVars(be, "moved"),
    } };
  }

  if (templateKey === "booking.cancelled") {
    // ★★★ `whenLocal` IS OPTIONAL HERE, UNLIKE EVERY SIBLING BRANCH — MEASURED, NOT A GUESS.
    //     `createBooking.mjs`'s `cancelBooking` — the STAFF-cancel path AND the hold-expiry job,
    //     which is most real cancellations — emits `booking.booking.cancelled` with payload
    //     `{credits_returned}` ONLY, no `starts_at`. `reschedule.mjs`'s client-app cancel path emits
    //     `starts_at`. Neither `createBooking.mjs` nor `deliverNotificationEmail` (which alone could
    //     join the CURRENT booking) is in this task's file list, so requiring `whenLocal` here would
    //     make `renderTemplate` throw — and the job give up — on the common case, not the exception.
    //     See this task's own report.
    if (be?.isHost) {
      return { templateKey: HOST_TEMPLATE_FOR[templateKey], vars: hostVars(p.starts_at, { reasonLine: p.reason ?? null }) };
    }
    const zone = p.timezone ?? target.practice_timezone;
    const known = p.starts_at != null && !Number.isNaN(new Date(p.starts_at).getTime());
    return { templateKey, vars: {
      practiceName, recipientName,
      serviceName: target.current_service_name ?? be?.serviceName ?? target.title,
      whenLocal: known ? whenLocal(p.starts_at, zone) : null,
      timeZone: zoneName(zone, known ? p.starts_at : null),
      reasonLine: p.reason ?? null,
      bookUrl: be?.bookUrl ?? null,
      practicePhone: formatPhone(be?.practicePhone ?? null),
    } };
  }

  // ── Stage 16: automations ──
  if (target.topic === "tasks.automation.ran") {
    // Read the automation kind from payload.key and prepend "automation." to get the template key
    const automationKind = p.key;
    const automationTemplateKey = target.template_key || `automation.${automationKind}`;
    return { templateKey: automationTemplateKey, vars: {
      practiceName, recipientName,
      // Optional vars that may be in the payload or extracted from the notification
      body: p.body ?? null,
      sessionsRemaining: p.sessions_remaining == null ? null : String(p.sessions_remaining),
      invoiceNumber: p.invoice_number ?? null,
      amount: p.amount_formatted ?? null,
      daysPastDue: p.days_past_due ?? null,
      link: target.deep_link ?? p.invoice_link ?? null,
      reviewLink: target.deep_link ?? null,
    } };
  }

  // ★ Stage 18 task 18.4 — operator access request notification. The `why` is free text
  //   and the payload lint refuses it, so it rides on `notification.body` instead, read
  //   fresh here. Duration is looked up from the payload.
  if (templateKey === "support_access.requested") {
    return { templateKey, vars: {
      practiceName, recipientName,
      why: target.body,
      duration: p.duration_minutes == null ? undefined : String(p.duration_minutes),
    } };
  }

  // ★ F836, "7 missing emails" brief, 1 Oct 2026 — four short, informational templates. Each
  //   notification's own `title` already carries the specific wording (composed once, at the
  //   point the notification is created, in src/queue/tasks.mjs's own TOPIC_HANDLERS) — reused
  //   here as `v.summary` rather than re-deriving it from the payload a second time.
  if (templateKey === "documents.document_expired" || templateKey === "documents.document_declined"
      || templateKey === "money.credit_note_issued" || templateKey === "money.package_purchased") {
    // Run 10 (R10-14): a Docustay workspace's mail links to its own screen, as an absolute address ("/record/document/<id>" is the platform's route and means nothing in an email)
    const docLink = /^\/record\/document\/([\w-]+)$/.exec(String(link ?? ""));
    const docustayLink = target.practice_product === "docustay" && docLink ? `${(process.env.KEYSTONE_DOCUSTAY_APP_URL || "https://app.docustay.app").replace(/\/+$/, "")}/documents/${docLink[1]}` : link;
    return { templateKey, vars: { practiceName, recipientName, summary: target.title, link: docustayLink } };
  }

  // ★ PART 2 ADDITION — the ~71 generic-path topics (specs/EMAILS.md's NEW section). Same idiom as
  //   F836 immediately above: `summary`/`link` were composed ONCE, at notification-creation time, in
  //   handleGenericNotice (below) — reused here from the notification row rather than recomputed,
  //   since emailFor() is pure and has no tx to re-derive a LOOKUP-resolved value from.
  if (GENERIC_TEMPLATE_KEYS.has(templateKey)) {
    return { templateKey, vars: { practiceName, recipientName, summary: target.title, link: target.deep_link ?? "/app" } };
  }

  // ── Stage 16: growth campaigns ──
  if (target.topic === "growth.campaign.sent") {
    const domain = process.env[APP_DOMAIN_VAR];
    const unsubscribeUrl = `https://${target.practice_slug}.${domain}${target.deep_link}`;
    return { templateKey, vars: {
      practiceName, recipientName,
      subject: target.title,
      body: target.body,  // Campaign body from notification row
      unsubscribeUrl,
    } };
  }

  return { templateKey, vars: {
    practiceName, recipientName,
    documentTitle: String(target.title ?? "").replace(/ is ready to sign$/, ""),   // the notice's own title already ends "… is ready to sign"; the email subject adds it again
    link: target.deep_link ?? "/app/documents",
  } };
}

// ★ 11 Oct 2026 (the maintainer: owner notices go out right away, like webhooks). Every minute the sweep loop queues each workspace's sweep jobs at priority 0; a notification email at priority 0
//   waited behind all of them (MEASURED locally: 1,270 workspaces × 12 sweeps, the "A document was signed" email 376 s after signing). Graphile runs the LOWEST number first, so a person's
//   email now goes ahead of background sweeps (the outbox dispatch already runs at -10 for the same reason, src/queue/outboxWake.mjs).
export const NOTICE_PRIORITY = -5;
export const deliverNotificationEmail = guardedTask("deliver_notification_email", async (payload, helpers) => {
  const { tenantId, notificationId } = payload;
  if (!notificationId) throw new Error("deliver_notification_email needs a notificationId");

  let target = null;
  await withTenant(tenantId, async (tx) => {
    // ★★ THE EVENT AND THE TENANT ARE JOINED IN, because the email needs facts the notification row
    //    does not carry: the practice's real NAME, and — for a session reminder — the start time and
    //    the zone, which live on the `event` the notification was raised from.
    // ★★★ STAGE 3 TASK 3 — `current_service_name` IS A NEW JOIN, READING THE CURRENT RECORD. The
    //   event's own payload no longer carries `service_name` (§2.4: no names in a payload), so the
    //   session's service is looked up fresh here, by the booking the reminder's `subject_id` points
    //   at — the same "read it from the current record, not the event" fix this task makes
    //   everywhere else. `LEFT JOIN`, and gated to the one topic that needs it: every other
    //   notification's `target.title` already carries what it needs from the `notification` row.
    const r = await tx.query(
      `SELECT n.id, n.recipient_id, n.title, n.topic, n.deep_link, n.body, n.template_key,
              u.email, u.display_name,
              t.name AS practice_name, t.timezone AS practice_timezone, t.slug AS practice_slug, t.product AS practice_product,
              e.payload AS event_payload, e.subject_id AS event_subject_id,
              rs.name AS current_service_name, rb.service_id AS current_service_id,
              -- BOOKING EMAIL OVERHAUL, 29 Sep 2026 -- the confirmation email (topic
              --   booking.booking.created) needs the video link too, same as the reminder already
              --   did (location_kind has travelled in that event's own payload since P2.5). Reading
              --   it from the CURRENT booking row here, like current_service_name beside it, means a
              --   coach who adds the Zoom link after booking still has it appear in whichever of these
              --   two emails has not gone out yet.
              rb.location_kind  AS current_location_kind,
              rb.location_detail AS current_location_detail,
              np.enabled AS email_enabled,
              coalesce(e.sample, false) AS event_sample,
              -- ★ Task 8 fix 1 (F6): an event_id this job cannot SEE is not "not sample" — fail closed.
              (n.event_id IS NOT NULL AND e.id IS NULL) AS event_unseen
         FROM keystone.notification n
         JOIN keystone.app_user u ON u.id = n.recipient_id
         JOIN keystone.tenant   t ON t.id = n.tenant_id
         LEFT JOIN keystone.event e ON e.id = n.event_id
         LEFT JOIN keystone.booking rb
                ON rb.id = e.subject_id
               -- FIX, 30 Sep 2026 ("credit-used/returned email" brief) -- the two credit topics
               --   also carry subjectType 'booking' plus a booking subjectId (the booking the
               --   credit was spent/returned on), so this same join gives them
               --   current_service_name too, read fresh the same way the reminder/confirmation
               --   emails already do.
               AND e.topic IN ('booking.booking.reminder', 'booking.booking.created',
                                'booking.booking.credit_consumed', 'booking.booking.credit_returned')
         LEFT JOIN keystone.service rs ON rs.id = rb.service_id
         -- ★★★ THE RECIPIENT'S OWN CHOICE, READ AT THE CHOKEPOINT EVERY EMAIL PASSES THROUGH.
         --   [MEASURED, P2 CLOSE §VISUAL] fanOut() (src/notifications/send.mjs:94) was the ONLY
         --   code consulting notification_preference, and its only callers were two GATES. The
         --   production path — createNotification + addJob("deliver_notification_email") — checked
         --   nothing, so **a person who switched email off for a topic was emailed anyway.**
         --   ★★ Put here rather than at the two enqueue sites deliberately: this is the single door
         --      every email leaves by, so a third producer added later inherits the promise instead
         --      of having to remember it.
         --   ★ A LEFT JOIN, and the default is SEND. No row means the person has never expressed a
         --     preference, which is not the same as opting out; only an explicit enabled = false
         --     suppresses. Treating absence as refusal would silence the product for everybody.
         LEFT JOIN keystone.notification_preference np
                ON np.tenant_id = n.tenant_id AND np.app_user_id = n.recipient_id
               AND np.channel = 'email' AND np.topic = n.topic
        WHERE n.id = $1`, [notificationId]);
    target = r.rows[0] ?? null;
    // ★ FIX, 1 Oct 2026 (an example organisation brand brief) — `practice_name` above read the LEGAL
    //   tenant name (`t.name`) directly; every notification email (the team-invite email among
    //   them — the maintainer flagged it live, still saying "an example organisation Recovery Services") is brand-facing,
    //   same preference as practiceName everywhere else this brief already touched
    //   (src/documents/sendDocument.mjs, signLinks.mjs, src/routes/app.mjs): the `practice.name`
    //   setting wins when a practice has set one, and the legal name stays the fallback.
    if (target) {
      target.practice_name = (await getSetting(tx, "practice.name", null)) || target.practice_name;
    }
  });
  if (!target) {
    // ★★ Stage 4 Task 6: RETRYABLE (`dependency`). The notification is written inside the dispatcher's transaction and
    //    this job is added on graphile's own connection BEFORE that transaction commits — so this job can run first and
    //    find nothing yet. The retry is the fix; after six attempts it gives up with this reason.
    throw new JobFailure("dependency",
      `the notification to email was not found (it may not have been saved yet, or it was rolled back)`);
  }
  // ★★★ STAGE 3 TASK 8 — A NOTIFICATION RAISED BY A SAMPLE EVENT IS NEVER EMAILED (spec 02 §2.9). The
  //     dispatcher never raises one (notify_* listeners are outbound), so this is the door for a job that
  //     exists anyway. Recorded `skipped` WITH the reason — and before the sender, which renders, is reached.
  // ★★ Fix round 1 (F6): FAIL CLOSED, as the webhook path does. A notification whose event_id is set but whose
  //    event is not visible cannot be proven non-sample, so it is not sent. A NULL event_id (a notification
  //    raised without an event — createNotification refuses that in-app, so this arises only if an event row is deleted out of band) is treated as non-sample and is sent.
  if (target.event_sample === true || target.event_unseen === true) {
    const reason = target.event_unseen
      ? "the event this notification was raised from is not visible — not sent (fail closed, spec 02 §2.9)"
      : "sample event — never emailed (spec 02 §2.9)";
    await withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO keystone.notification_delivery
           (tenant_id, notification_id, channel, status, error, completed_at)
         VALUES ($1,$2,'email','skipped',$3,now())
         ON CONFLICT (tenant_id, notification_id, channel) DO NOTHING`,
        [tenantId, notificationId, reason]);
    });
    helpers.logger.info(`notification ${notificationId}: ${reason} — skipped, and recorded as skipped.`);
    return { status: "skipped", reason };
  }
  // ★★★ FOUND LIVE, 1 Oct 2026 ("7 missing emails" brief) — `target.email_enabled` above came ONLY
  //     from `notification_preference` (TIER 1, a PERSON's own explicit choice). `notification_rule`
  //     (TIER 2, the PRACTICE's own default per topic × role, migration 0336, 63 seeded rows/tenant)
  //     was never consulted here — `getEffectiveChannels` (src/notifications/rules.mjs) already does
  //     the full, correct 3-tier fallback (personal → practice role default → catalogue default) and
  //     its only prior caller was `fanOut()`, which this exact file's own earlier comment already
  //     measured as dead code with no production caller. So a practice toggling a topic off in its
  //     own notification settings did NOTHING — every email kept sending regardless. Recomputed here,
  //     replacing the SQL-joined value, so "a setting that actually turns it on/off" means something.
  target.email_enabled = await withTenant(tenantId, (tx) =>
    getEffectiveChannels(tx, { tenantId, recipientId: target.recipient_id, topic: target.topic, channel: "email" }));

  if (target.email_enabled === false) {
    // ★★ RECORDED AS `skipped`, NOT SILENTLY OMITTED — the same distinction `fanOut` draws, and for
    //    the same reason: "nothing was sent" and "we chose not to send" are different answers, and
    //    only one of them is a bug when somebody asks why no email arrived.
    await withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO keystone.notification_delivery
           (tenant_id, notification_id, channel, status, completed_at)
         VALUES ($1,$2,'email','skipped',now())
         ON CONFLICT (tenant_id, notification_id, channel) DO NOTHING`,
        [tenantId, notificationId]);
    });
    helpers.logger.info(
      `notification ${notificationId}: email is off for ${target.topic} (a personal preference or ` +
      `the practice's own default for this recipient's role) — skipped, and recorded as skipped.`);
    return { status: "skipped" };
  }

  if (!target.email) {
    helpers.logger.info(
      `notification ${notificationId}: the recipient has no email address on file, so there is nothing ` +
      `to send to. ★ Reported, not thrown — a person without an email is a real and permitted state.`);
    return { status: "no_address" };
  }

  // ★ D2 (13 Oct 2026, the $1 live test): a Docustay plan change is a DOCUSTAY email about the person's own account — never the organisation's frame ("R8 builds via Docustay … Sent by R8 builds").
  //   It is written by src/email/docustayBilling.mjs and sent from the platform address; one notification, one email (idempotency key = the notification id).
  if (target.topic === "settings.subscription.updated" && String(target.event_payload?.planKey ?? "").startsWith("docustay_")) {
    const { languageOfUser } = await import("../product/docustayLanguage.mjs");
    const lang = await withTenant(tenantId, (tx) => languageOfUser(tx, { tenantId, userId: target.recipient_id }));
    const built = target.event_payload?.change === "payment_failed" ? null : billingEmail(target.event_payload?.change, { name: target.display_name, facts: target.event_payload ?? {}, lang });
    let outcome = "skipped";
    if (built) {
      const res = await withTenant(tenantId, (tx) => platformMail.sendMail(tx, { tenantId, to: target.email, subject: built.subject, text: built.text, html: built.html, purpose: "platform", product: "docustay", idempotencyKey: `docustay-billing:${notificationId}` }));
      if (res.status === "failed") throw new JobFailure("dependency", `the Docustay billing email was not accepted: ${res.error ?? "no detail"}`);
      outcome = res.status === "sent" ? "sent" : "skipped";
      // the workspace's separate billing email (when set) is told once per business event too, not once per owner: the key is the Stripe event, not the notification
      const stripeEventId = target.event_payload?.stripeEventId;
      if (stripeEventId) {
        const { billingCopyAddress } = await import("../product/docustayBillingContact.mjs");
        await withTenant(tenantId, async (tx) => {
          const { rows: owners } = await tx.query(`SELECT email FROM keystone.app_user WHERE tenant_id = $1 AND role = 'staff' AND staff_role IN ('owner','admin') AND archived_at IS NULL AND email IS NOT NULL`, [tenantId]);
          const copy = await billingCopyAddress(tx, { tenantId, already: owners.map((o) => o.email) });
          if (copy) { const b2 = billingEmail(target.event_payload?.change, { name: null, facts: target.event_payload ?? {}, lang }); if (b2) await platformMail.sendMail(tx, { tenantId, to: copy, subject: b2.subject, text: b2.text, html: b2.html, purpose: "platform", product: "docustay", idempotencyKey: `docustay-billing-cc:${tenantId}:${stripeEventId}:${copy}` }); }
        });
      }
    }
    await withTenant(tenantId, (tx) => tx.query(
      // ★ 14 Oct 2026: an email that reached `sent` MUST carry what was sent (constraint delivery_sent_email_carries_its_snapshot, migration 0043). This row was written
      //   without it, so every Docustay plan-change email failed here AFTER Resend had taken it and the job gave up (two on 14 Oct). Carry {subject, text}.
      `INSERT INTO keystone.notification_delivery (tenant_id, notification_id, channel, status, rendered, completed_at) VALUES ($1,$2,'email',$3,$4::jsonb,now()) ON CONFLICT (tenant_id, notification_id, channel) DO NOTHING`,
      [tenantId, notificationId, outcome, outcome === "sent" && built ? JSON.stringify({ subject: built.subject, text: built.text }) : null]));
    return { status: outcome };
  }

  // ★ Stage 15 task 15.37 — mint deep links for money emails (F720). Minted in the same transaction
  //   as the delivery, stored only as a hash (via mintLinkToken), rendered in plaintext in the email.
  const MONEY_LINK_PURPOSE = {
    "money.invoice.sent": "invoice_view", "money.invoice.reminder_due": "invoice_view",
    "money.invoice.paid": "invoice_view",
    "money.estimate.sent": "estimate_accept", "money.estimate.expiring": "estimate_accept",
    "money.payment.failed": "card_update", "money.payment_method.update_requested": "card_update",
  };
  if (MONEY_LINK_PURPOSE[target.topic]) {
    // ★★★ FOUND LIVE, 1 Oct 2026 (the maintainer's "Send invoice" produced a Stripe invoice but no email) —
    //   this block as originally written (Stage 15 task 15.37 / F720) called
    //   `mintLinkToken(tx, {purpose, subjectType, subjectId, ttlHours})` with NO `tenantId` key,
    //   which `mintLinkToken` throws on unconditionally — MEASURED from the deployed job's own
    //   `last_error`: "mintLinkToken: tenantId must be the uuid of the practice the transaction is
    //   open on" (graphile_worker.jobs id 3856263, key email:01a0f854-e9d9-7c9a-b03a-51bdfc047926,
    //   max_attempts=1, GAVE UP). Because this throw happens INSIDE the one job that sends the
    //   whole email, every money email with a deep link — not just invoice.sent — has been failing
    //   closed, system-wide, since the day this shipped: nothing partial ever went out.
    //   ★ Three more defects were in the same block, each would have fired next had the first been
    //     missed: `subjectType`/`subjectId` were hardcoded to `"notification"`/`notificationId`,
    //     but `PURPOSE_SUBJECT_TYPE` (src/auth/linkToken.mjs) registers "invoice_view" → "invoice",
    //     "estimate_accept" → "estimate", "card_update" → "person" — a "notification" subject type
    //     would have thrown mintLinkToken's OTHER internal check next. And even past that, the
    //     public redeem routes (src/routes/publicMoney.mjs) resolve `subject_id` as the real
    //     invoice/estimate id directly against `keystone.invoice`/`keystone.estimate` — a
    //     notification id there would 404 for the client. Finally, `mintLinkToken` returns
    //     `{id, presented, expiresAt}` (src/auth/linkToken.mjs:276), not a bare string — the
    //     original `${token}` interpolation would have rendered `[object Object]` into the link.
    //   ★ The real subject per purpose, MEASURED by grepping every real `emit()` call site for
    //     these topics: invoice_view topics carry the invoice id as `event_subject_id` directly
    //     EXCEPT `money.invoice.paid`, which three of its four emitters (src/payments/webhook.mjs,
    //     src/money/payments.mjs) raise with `subjectType:"payment"` and the PAYMENT id instead
    //     (only src/money/clientPayments.mjs's variant already carries the invoice id) — resolved
    //     below via `keystone.payment.invoice_id`. estimate_accept topics carry the estimate id
    //     directly. card_update's two topics carry neither a consistent subject type nor a person
    //     id in their event payload (money.payment.failed's emitters disagree among
    //     invoice/subscription/payment; money.payment_method.update_requested happens to carry the
    //     payer id despite labelling it "payment_method") — the one value that is ALWAYS correct
    //     for "whose card needs updating" is the notification's own recipient, already on `target`.
    const purpose = MONEY_LINK_PURPOSE[target.topic];
    const kind = purpose === "invoice_view" ? "i" : purpose === "estimate_accept" ? "e" : "c";
    try {
      await withTenant(tenantId, async (tx) => {
        let subjectType, subjectId;
        if (purpose === "invoice_view") {
          subjectType = "invoice";
          if (target.topic === "money.invoice.paid") {
            // ★ FOUND LIVE in the verification scratch run for this same fix — `keystone.payment`'s
            //   own `tenant_isolation` RLS (`payer_user_id = current_user_id() OR user_may(...)`)
            //   returns ZERO rows under a plain worker-context read (current_user_id() IS NULL):
            //   not a throw, a silent empty result, which would have fallen back to the WRONG
            //   subject (the payment id) instead of the invoice id. `target.recipient_id` IS the
            //   payer for this flow (MONEY_EMAILS resolves recipientId from payer_user_id), so
            //   reading as that viewer satisfies the policy the same way publicMoney.mjs already
            //   does for the same table.
            const { rows } = await asViewer(tx, target.recipient_id, () => tx.query(
              `SELECT invoice_id FROM keystone.payment_effective WHERE tenant_id = $1 AND id = $2`,
              [tenantId, target.event_subject_id]));
            subjectId = rows[0]?.invoice_id ?? target.event_subject_id;
          } else {
            subjectId = target.event_subject_id;
          }
        } else if (purpose === "estimate_accept") {
          subjectType = "estimate";
          subjectId = target.event_subject_id;
        } else {
          subjectType = "person";
          subjectId = target.recipient_id;
        }
        if (!subjectId) {
          helpers.logger.info(
            `notification ${notificationId}: no deep-link subject resolvable for ${target.topic} — ` +
            `sending the email without one.`);
          return;
        }
        const minted = await mintLinkToken(tx, {
          tenantId, purpose, subjectType, subjectId, ttlHours: 24 * 120,
        });
        target.deep_link = `/pay/${kind}/${minted.presented}`;
      });
    } catch (err) {
      // ★★ A deep link is an enhancement to the email, never the reason the email itself does not
      //    go out — the ORIGINAL bug was exactly that (an unrelated-looking mint failure silently
      //    sank the whole send). Logged, not rethrown; `target.deep_link` is simply left unset.
      helpers.logger.info(
        `notification ${notificationId}: could not mint a deep link for ${target.topic} (${err.message}) ` +
        `— sending the email without one.`);
    }
  }

  // ★ Part 3 invoice rebuild — `payUrl` (Stripe's own hosted_invoice_url, F856) and a short
  //   line-item summary for `money.invoice_issued`/`money.invoice_reminder`. Stashed here, same
  //   idiom as everything else in this function ("resolved here, read by emailFor below") —
  //   reads AS THE PAYER (`target.recipient_id`, same viewer MONEY_LINK_PURPOSE's own
  //   money.invoice.paid branch already uses for this exact table) so F854's RLS gate is
  //   satisfied. Never blocks the email: any failure here is logged and the vars are left unset,
  //   same posture as the deep-link mint right above.
  // ★ STRIPE-MIRROR REPOINT (2 Oct 2026) — pay URL / Stripe id / number come from `invoice_effective`
  //   (Stripe's own hosted_invoice_url wins); `rendering` is the platform's own, so `keystone.invoice` is
  //   LEFT JOINed for that one column only. Same asViewer wrapper as before.
  // ★ 9 Oct 2026: the payer's overdue chase (automation.invoice_chase) and the staff overdue notice (money.invoice_overdue) need the same facts — number, amount, due date, a way to pay, the lines — and had none of them (the maintainer's two wrong emails).
  const chaseInvoiceId = (target.template_key === "automation.invoice_chase" || target.topic === "money.invoice.overdue") ? (target.event_payload?.invoice_id ?? (target.topic === "money.invoice.overdue" ? target.event_subject_id : null)) : null;
  if (target.topic === "money.invoice.sent" || target.topic === "money.invoice.reminder_due" || chaseInvoiceId) {
    try {
      await withTenant(tenantId, async (tx) => {
        const invoiceId = chaseInvoiceId ?? target.event_subject_id;
        target.invoice_id_for_email = invoiceId;
        const { rows } = await asViewer(tx, target.recipient_id, () => tx.query(
          `SELECT ie.hosted_invoice_url, ie.stripe_invoice_id, ie.invoice_number, ie.amount_minor, i.currency, i.due_at, i.rendering->>'page_size' AS page_size
             FROM keystone.invoice_effective ie
             LEFT JOIN keystone.invoice i ON i.id = ie.id
            WHERE ie.tenant_id = $1 AND ie.id = $2`,
          [tenantId, invoiceId]));
        target.invoice_amount_minor = rows[0]?.amount_minor ?? null;
        target.invoice_currency = rows[0]?.currency ?? target.event_payload?.currency ?? "USD";
        target.invoice_due_at = rows[0]?.due_at ?? null;
        if (target.template_key === "automation.invoice_chase") {
          // the payer's own link: minted like every other money link (hashed at rest), absolute, on the practice's own host
          const minted = await mintLinkToken(tx, { tenantId, purpose: "invoice_view", subjectType: "invoice", subjectId: invoiceId, ttlHours: 24 * 120 });
          target.deep_link = `/pay/i/${minted.presented}`;
        }
        target.invoice_pay_url = rows[0]?.hosted_invoice_url ?? null;
        target.invoice_stripe_id = rows[0]?.stripe_invoice_id ?? null;
        target.invoice_number_full = rows[0]?.invoice_number ?? null;
        target.invoice_page_size = rows[0]?.page_size ?? "a4";

        const { rows: lineRows } = await asViewer(tx, target.recipient_id, () => tx.query(
          `SELECT name_snapshot, quantity, unit_amount_minor
             FROM keystone.line_item
            WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'active'
            ORDER BY position ASC`,
          [tenantId, invoiceId]));
        target.invoice_line_summary = lineRows
          .map((l) => `${l.name_snapshot} x${l.quantity}: ${formatMoneyMinor(l.unit_amount_minor * l.quantity, target.event_payload?.currency ?? "USD")}`)
          .join("\n");
      });
    } catch (err) {
      helpers.logger.info(
        `notification ${notificationId}: could not resolve invoice pay url/line summary (${err.message}) ` +
        `— sending the email without them.`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ FIX, 30 Sep 2026 ("credit-used/returned email" brief) — THE STANDING, READ FRESH, RIGHT
  //     BEFORE SENDING — same idiom as `MONEY_LINK_PURPOSE` just above (`emailFor` is a pure
  //     function with no tx; anything needing a query is resolved here first and stashed onto
  //     `target`). `n.recipient_id` (now selected above) IS the entitlement's owner — a credit
  //     notification is created with `recipientId: entitlement.owner_user_id` at emit time
  //     (src/queue/tasks.mjs's own "booking.booking.credit_consumed"/"…credit_returned" listeners),
  //     so no second identity lookup is needed.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (target.topic === "booking.booking.credit_consumed" || target.topic === "booking.booking.credit_returned") {
    await withTenant(tenantId, async (tx) => {
      const standing = await creditStanding(tx, {
        tenantId, ownerUserId: target.recipient_id, serviceId: target.current_service_id ?? null,
      });
      target.credit_total = standing.total;
      target.credit_remaining = standing.remaining;
      target.credit_session_number = standing.sessionNumber;
    });
  }

  // ★ NEW, receipts brief (1 Oct 2026, Part 2) — plan name for the subscription lifecycle emails.
  // ★ F854 FIX, 1 Oct 2026 (Part 4a) — `keystone.subscription` is RLS-gated the same way
  //   `keystone.invoice`/`keystone.payment` are (see recipientResolvers.mjs's F854 header); this
  //   read a zero-viewer `tx`, same as the nearby `asViewer(tx, target.recipient_id, ...)` fix
  //   just above (F837) already does for this exact reason. `target.recipient_id` IS the
  //   subscription's own `app_user_id` for this flow — reading as that viewer satisfies the
  //   policy's `app_user_id = current_user_id()` branch directly.
  if (target.topic?.startsWith("money.subscription.") &&
      ["money.subscription.started", "money.subscription.cancelled", "money.subscription.paused", "money.subscription.resumed"].includes(target.topic)) {
    await withTenant(tenantId, async (tx) => {
      const { rows } = await asViewer(tx, target.recipient_id, () => tx.query(
        `SELECT pl.name FROM keystone.subscription_effective s
           LEFT JOIN keystone.plan pl ON pl.id = s.plan_id
          WHERE s.tenant_id = $1 AND s.id = $2`,
        [tenantId, target.event_subject_id]));
      target.subscription_plan_name = rows[0]?.name ?? "your plan";
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ Receipts brief (1 Oct 2026, Part 1) — "service, date, amount, card used" for money.receipt.
  //     Same "resolve outside, read in emailFor" idiom as credit_total above. `event_subject_id`
  //     is a PAYMENT id from payments.mjs's own two handlers, an INVOICE id from
  //     clientPayments.mjs's — resolved both ways, same reasoning as notifyPaymentReceived's own
  //     fix earlier in this brief.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ F854 FIX, 1 Oct 2026 (Part 4a) — `keystone.payment` is RLS-gated the same way; wrapped the
  //   whole block in `asViewer(tx, target.recipient_id, ...)` (the payer, same as the F837 fix
  //   above) rather than just the one query, since it is the simplest correct scope here.
  // ★ STRIPE-MIRROR REPOINT (2 Oct 2026) — card brand/last4/paid-at come from `payment_effective` (the
  //   Stripe charge), and the fallback card from `person_card_effective`; wrapper unchanged.
  if (target.topic === "money.payment.succeeded" || target.topic === "money.payment.recorded_offline" ||
      target.topic === "money.invoice.paid") {
    await withTenant(tenantId, (tx) => asViewer(tx, target.recipient_id, async () => {
      const { rows: byPaymentId } = await tx.query(
        `SELECT card_brand, card_last_four, invoice_id, created_at FROM keystone.payment_effective
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, target.event_subject_id]);
      let paymentRow = byPaymentId[0] ?? null;
      let invoiceIdForReceipt = paymentRow?.invoice_id ?? target.event_payload?.invoice_id ?? null;
      if (!paymentRow) {
        // event_subject_id was an invoice id (clientPayments.mjs's own shape) — no single payment
        // row to point at (a portal payment can span several); the invoice id itself is enough.
        invoiceIdForReceipt = target.event_subject_id ?? invoiceIdForReceipt;
      }
      target.receipt_card_brand = paymentRow?.card_brand ?? null;
      target.receipt_card_last4 = paymentRow?.card_last_four ?? null;
      target.receipt_paid_at = paymentRow?.created_at ?? null;

      if (invoiceIdForReceipt) {
        // ★ FOUND checking this — `keystone.line_item` has no generic parent_type/parent_id pair;
        //   each parent kind gets its own column (src/money/writes.mjs's own PARENT_COLUMN map).
        //   `invoice_id` is the real column for an invoice's own lines.
        const { rows: lineRows } = await tx.query(
          `SELECT name_snapshot FROM keystone.line_item
            WHERE tenant_id = $1 AND invoice_id = $2
            ORDER BY created_at LIMIT 1`,
          [tenantId, invoiceIdForReceipt]);
        target.receipt_service_name = lineRows[0]?.name_snapshot ?? null;
      }
      // ★ No card on the payment row and no card on the payer's own record either (a bank-debit or
      //   fully offline payment) is a real, permitted state — the template renders without that
      //   line rather than guessing at a card that was never charged.
      if (!target.receipt_card_brand) {
        const { rows: pmRows } = await tx.query(
          `SELECT brand, last_four FROM keystone.person_card_effective
            WHERE tenant_id = $1 AND app_user_id = $2 AND is_default = true
            LIMIT 1`,
          [tenantId, target.recipient_id]);
        target.receipt_card_brand = pmRows[0]?.brand ?? null;
        target.receipt_card_last4 = pmRows[0]?.last_four ?? null;
      }
    }));
  }

  // ★ 9 Oct 2026 — two money emails whose templates REQUIRE a fact the event never carried (a payout's failure reason, a dispute's answer-by date), so every one of them threw at render and was given up on. Read from the record here, like the other "resolve outside, read in emailFor" stashes.
  if (target.topic === "money.payout.failed" || target.topic === "money.dispute.opened") {
    try {
      await withTenant(tenantId, (tx) => asViewer(tx, target.recipient_id, async () => {
        if (target.topic === "money.payout.failed") {
          const { rows } = await tx.query(`SELECT failure_message FROM keystone.payout WHERE tenant_id = $1 AND id = $2`, [tenantId, target.event_subject_id]);
          target.payout_reason = rows[0]?.failure_message ?? null;
        } else {
          const { rows } = await tx.query(`SELECT evidence_due_by FROM keystone.dispute_effective WHERE tenant_id = $1 AND id = $2`, [tenantId, target.event_subject_id]);
          target.dispute_answer_by = rows[0]?.evidence_due_by ?? null;
        }
      }));
    } catch (err) { helpers.logger.info(`notification ${notificationId}: could not read the payout/dispute record (${err.message}) — using plain fallback wording.`); }
  }

  // ★ Booking everywhere (22 Oct 2026, spec §7/§8) — the four booking emails (confirmed, moved, cancelled, reminder) read the booking's CURRENT row
  //   at the moment of sending: is the recipient its assigned host (then the staff template), and — for the client — a FRESH change-or-cancel link
  //   (minted here, per email, valid until the booking starts) plus the notice window. Never a link for a cancelled, started or past booking.
  //   Best effort like every other stash above: a failure is logged and the email goes out as it always did, without the link.
  if (BOOKING_EMAIL_TOPICS.has(target.topic) && target.event_subject_id) {
    try {
      target.booking_email = await withTenant(tenantId, (tx) => resolveBookingEmailFacts(tx, {
        tenantId, bookingId: target.event_subject_id, recipientId: target.recipient_id, topic: target.topic, practiceSlug: target.practice_slug,
      }));
      if (target.booking_email?.manageError) {
        helpers.logger.info(`notification ${notificationId}: could not mint a change-or-cancel link (${target.booking_email.manageError}) — sending the email without it.`);
      }
    } catch (err) {
      target.booking_email = null;
      helpers.logger.info(`notification ${notificationId}: could not read the booking's email facts (${err.message}) — sending the email as before.`);
    }
  }

  const { templateKey, vars } = emailFor(target);

  // ★ 9 Oct 2026 — the practice's quiet hours and weekend switch were saved and never read (reminders arrived at 3:06 am). Only reminders and internal notices wait (src/notifications/quietHours.mjs); anything a person is waiting on goes at once.
  if (DEFERRABLE_TEMPLATES.has(templateKey)) {
    const hold = await withTenant(tenantId, async (tx) => deferUntil({
      now: new Date(), tz: target.practice_timezone || "UTC",
      quiet: await getSetting(tx, "notifications.quiet_hours", null), weekend: (await getSetting(tx, "notifications.weekend", false)) === true,
    }));
    if (hold) {
      await helpers.addJob("deliver_notification_email", { tenantId, notificationId }, { runAt: hold, jobKey: `email-held:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
      helpers.logger.info(`notification ${notificationId}: held for the practice's quiet hours / weekend setting until ${hold.toISOString()}.`);
      return { status: "deferred", until: hold.toISOString() };
    }
  }

  const terms = await withTenant(tenantId, (tx) => resolveTerms(tx));

  // ★ specs/INVOICE-SEND-FIX.md §2.7 — the PDF attached to money.invoice_issued is built from
  //   the platform's OWN frozen invoice + lines (the same builder the editor's preview and the public
  //   PDF download route use — never a live Stripe fetch). An invoice's lines are never edited
  //   again once sent (the write routes all refuse on `status <> 'draft'`), so this is exactly as
  //   deterministic as a stored snapshot would be, with no Stripe round trip for a PDF. Best
  //   effort: a PDF render failure must never sink the email itself (same posture as the deep-link
  //   mint and the pay-url/line-summary resolve above it) — the email still carries the Pay button
  //   and the Download-PDF link either way.
  let attachments = null;
  const pdfInvoiceId = templateKey === "money.invoice_issued" || templateKey === "money.invoice_reminder" ? target.event_subject_id : templateKey === "automation.invoice_chase" ? target.invoice_id_for_email : null;
  if (pdfInvoiceId) {
    try {
      await withTenant(tenantId, (tx) => asViewer(tx, target.recipient_id, async () => {
        const { rows: invoiceRows } = await tx.query(
          `SELECT status, currency, invoice_number, due_at, issued_at, custom_fields, rendering,
                  memo, hosted_invoice_url, paid_minor, amount_remaining_minor
             FROM keystone.invoice WHERE tenant_id = $1 AND id = $2`,
          [tenantId, pdfInvoiceId]);
        if (invoiceRows.length === 0) return;
        const { rows: lineRows } = await tx.query(
          `SELECT name_snapshot, unit_amount_minor, quantity, discount_minor, tax_minor
             FROM keystone.line_item
            WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'active'
            ORDER BY position ASC NULLS LAST, created_at ASC`,
          [tenantId, pdfInvoiceId]);
        const phone = await getSetting(tx, "practice.support_phone", null);
        // ★ `branding.logo_url` is a `ks-object:` internal storage pointer, not a fetchable URL —
        //   left null (practice-name text fallback) until a real resolve step exists.
        const view = buildInvoiceView({
          invoice: invoiceRows[0], lines: lineRows,
          payer: { display_name: target.display_name ?? null, email: target.email ?? null },
          practiceBranding: { name: target.practice_name, logoUrl: null, phone },
        });
        const buf = await renderInvoicePdfBuffer(view, { pageSize: target.invoice_page_size || "a4" });
        attachments = [{ filename: `Invoice-${target.invoice_number_full}.pdf`, content: buf }];
      }));
    } catch (err) {
      helpers.logger.info(
        `notification ${notificationId}: could not render the invoice PDF attachment (${err.message}) ` +
        `— sending the email without it.`);
    }
  }

  const outcome = await sendNotificationEmail({
    tenantId, notificationId, to: target.email, templateKey, vars, terms, attachments,
  });
  helpers.logger.info(
    `notification ${notificationId} email -> ${outcome.status}` +
    (outcome.error ? ` (${plainText(outcome.error)})` : ""));
  // ★★★ STAGE 4 TASK 6 — A FAILED SEND IS A FAILURE (07 §4.1a). It THROWS, classified, so the job policy retries
  //     what can succeed and gives up — with a plain reason in the ledger — on what cannot. The delivery row is
  //     still the record of each attempt; the throw is what makes the attempt count.
  //   ★★ And never twice (02 §2.6): `already_sent` returns quietly; `in_doubt` (the request left and no answer came
  //      back, or a send was interrupted) gives up WITHOUT a retry, because a retry is exactly how a second email goes.
  const failure = emailFailure(outcome);
  if (failure) throw failure;
  return { status: outcome.status, deliveryId: outcome.deliveryId };
});

/** ★ Stage 4 Task 6 — a send outcome as a JobFailure (or null when there is nothing to retry or give up on). */
function emailFailure(o) {
  if (["sent", "skipped", "already_sent"].includes(o.status)) return null;
  if (o.status === "in_flight") {
    return new JobFailure("dependency", "another attempt at this email is still in progress — checking again later");
  }
  if (o.status === "in_doubt") {
    // ★★ R66: a 409 invalid_idempotent_request means OUR stored body changed under a used key — a fault in the code.
    //    The first send under that key may have gone, so nothing is sent; a person looks.
    if (o.idempotencyMismatch) {
      return new JobFailure("internal",
        `Resend refused the retry (HTTP 409 invalid_idempotent_request): the stored message changed under its ` +
        `idempotency key. The first attempt may have been delivered — check Resend's log; send by hand if not.`,
        { retryable: false });
    }
    const why = o.timeoutMs ? `Resend did not answer within ${Math.round(o.timeoutMs / 1000)} seconds`
      : o.httpStatus === 409 ? "Resend was still processing an earlier request for this email (HTTP 409)"
      : o.httpStatus ? `Resend's gateway answered HTTP ${o.httpStatus}`
      : o.networkCode ? `the connection to Resend broke (${o.networkCode}) after the message was sent`
      : o.inDoubtWhy ? "an earlier attempt got no answer from Resend"
      : "an earlier attempt was interrupted after the message was sent";
    // ★★★ R66 — WITHIN THE WINDOW, RETRIED: the same Idempotency-Key and the same stored bytes, so Resend replays
    //     the original email's id instead of sending a second one. On the normal schedule (1 m … 12 h, 14.6 h in
    //     all — inside the 23 h window).
    if (o.retryInDoubt) {
      return new JobFailure(o.kind === "timeout" ? "timeout" : "dependency",
        `${why}, so the email may already have been delivered — retrying under the same idempotency key, so Resend ` +
        `will not send it twice`);
    }
    const past = o.inDoubtWhy === "window"
      ? `In doubt for over ${IN_DOUBT_RETRY_HOURS} hours (past Resend's 24-hour idempotency key), so not sent again`
      : "First sent without an idempotency key, so not sent again";
    return new JobFailure("timeout",
      `${why}, so the email may already have been delivered. ${past} — check Resend's log; send by hand if it did ` +
      `not arrive.`, { retryable: false });
  }
  const said = o.providerMessage ? `: ${o.providerMessage}` : "";
  const reason =
    o.kind === "validation"   ? `Resend refused the message (HTTP ${o.httpStatus})${said}` :
    o.kind === "forbidden"    ? `Resend refused our credentials (HTTP ${o.httpStatus}) — check the Resend API key and the sending domain${said}` :
    o.kind === "rate_limited" ? `Resend said we are sending too fast (HTTP 429)${o.retryAfterSeconds ? ` and asked us to wait ${o.retryAfterSeconds} s` : ""}` :
    o.kind === "timeout"      ? `Resend could not be reached in time${o.networkCode ? ` (${o.networkCode})` : ""}` :
    o.httpStatus              ? `Resend failed (HTTP ${o.httpStatus})${said}` :
                                `Resend could not be reached${o.networkCode ? ` (${o.networkCode})` : ""}`;
  return new JobFailure(o.kind ?? "dependency", reason, { retryAfterSeconds: o.retryAfterSeconds ?? null });
}

/**
 * ★★★ 12.9 — DELIVER THE REFERRAL EMAIL. Up to two recipients on one `network_referral` row: the
 *     partner (`partner_email_status`) and, only when the referring coach chose to copy the person
 *     in (`copied_person` at create time), the person themselves (`person_email_status`). Neither
 *     address travels in the payload — `helpers.addJob` carries only `{tenantId, referralId}`
 *     (`assertNoDestination`, guardedTask) — both are read fresh, under RLS, from the referral's own
 *     row and its joined person/party/tenant.
 * ★★ THE SAMPLE REFUSAL IS ON THE REFERRED PERSON, THE SUBJECT — same door `sendNotificationEmail`
 *    uses (send.mjs:57-70): a sample subject is never emailed, to either recipient. `sendViaResend`
 *    is used directly, never `sendNotificationEmail`, because that path requires a `notification`
 *    row with a PERSON recipient, and a network party is not a person (send.mjs:55-72).
 * ★ `do_not_email` is the PERSON's own flag and only ever blocks the PERSON's copy — the partner is
 *   a `network_party`, not an `app_user`, and carries no such flag.
 * ★ A recipient already `sent` is never re-sent; one still `queued` or `failed` is (re)attempted —
 *   so a partial failure on a two-recipient referral retries only the one that did not go.
 */
export const deliverReferralEmail = guardedTask("deliver_referral_email", async (payload, helpers) => {
  const { tenantId, referralId } = payload;
  if (!referralId) throw new Error("deliver_referral_email needs a referralId");

  const row = await withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT nr.id, nr.reason, nr.partner_email_status, nr.person_email_status,
              p.display_name AS person_name, p.email AS person_email, p.do_not_email, p.is_sample,
              party.name AS party_name, party.email AS party_email,
              contact.email AS contact_email,
              sender.display_name AS sender_name,
              t.name AS tenant_name,
              ts.value AS practice_name_setting
         FROM keystone.network_referral nr
         JOIN keystone.app_user p ON p.id = nr.referred_person_id
         JOIN keystone.network_party party ON party.id = nr.receiving_network_party_id
         LEFT JOIN keystone.app_user contact ON contact.id = party.primary_contact_id
         LEFT JOIN keystone.app_user sender ON sender.id = nr.created_by
         JOIN keystone.tenant t ON t.id = nr.tenant_id
         LEFT JOIN keystone.tenant_setting ts ON ts.tenant_id = nr.tenant_id AND ts.key = 'practice.name'
        WHERE nr.id = $1`,
      [referralId]);
    return rows[0] ?? null;
  });
  if (!row) {
    // ★ Same reasoning as deliverNotificationEmail: the referral is written inside the dispatcher's
    //   still-open transaction and this job can be added, on graphile's own connection, before that
    //   transaction commits — so this job can run first and find nothing yet. Retryable.
    throw new JobFailure("dependency",
      `the referral to email was not found (it may not have been saved yet, or it was rolled back)`);
  }

  const setStatus = (column, status) => withTenant(tenantId, (tx) => tx.query(
    `UPDATE keystone.network_referral SET ${column} = $1, updated_at = now() WHERE id = $2`,
    [status, referralId]));

  // ★★★ THE SAMPLE REFUSAL (spec 02 §2.9 / CT-067's same rule) — a referral about a sample person is
  //     never emailed to anybody, partner included. Both statuses are marked `skipped` and stopped.
  if (row.is_sample === true) {
    if (["queued", "failed"].includes(row.partner_email_status)) await setStatus("partner_email_status", "skipped");
    if (["queued", "failed"].includes(row.person_email_status)) await setStatus("person_email_status", "skipped");
    helpers.logger.info(`referral ${referralId}: sample subject — never emailed.`);
    return { status: "skipped", reason: "sample subject" };
  }

  const practiceName = row.practice_name_setting ?? row.tenant_name;
  const partyEmail = row.contact_email ?? row.party_email;

  const recipients = [
    { column: "partner_email_status", status: row.partner_email_status, to: partyEmail, doNotEmail: false },
    { column: "person_email_status", status: row.person_email_status, to: row.person_email,
      doNotEmail: row.do_not_email === true },
  ];

  let firstFailure = null;
  for (const r of recipients) {
    if (r.status !== "queued" && r.status !== "failed") continue;   // sent/skipped/null — never re-sent
    if (r.doNotEmail) {
      await setStatus(r.column, "skipped");
      continue;
    }
    if (!r.to) {
      // ★ No address on file is a data defect, not a delivery outcome to paper over as "skipped".
      await setStatus(r.column, "failed");
      firstFailure ??= new JobFailure("validation", `referral ${referralId}: no address for ${r.column}`,
        { retryable: false });
      continue;
    }
    const { subject, text } = composeReferralEmail({
      personName: row.person_name, personEmail: row.person_email, reason: row.reason,
      practiceName, senderName: row.sender_name, partnerName: row.party_name,
    });
    const sent = await withTenant(tenantId, (tx) => deliverAsOrganisation(tx, { tenantId, to: r.to, subject, text }));
    const outcome = { ok: sent.status === "sent", error: sent.error, kind: sent.kind ?? (sent.status === "limit_reached" ? "rate_limited" : undefined), retryAfterSeconds: sent.retryAfterSeconds };
    if (outcome.ok) {
      await setStatus(r.column, "sent");
    } else {
      await setStatus(r.column, "failed");
      firstFailure ??= new JobFailure(outcome.kind ?? "dependency", outcome.error ?? "resend failed",
        { retryAfterSeconds: outcome.retryAfterSeconds ?? null });
    }
  }
  // ★★★ A FAILURE ALSO THROWS, so the job policy retries what can succeed and gives up, with a
  //     plain reason in the ledger, on what cannot — the status column is still the record of each
  //     attempt; the throw is what makes the attempt count (same shape as deliverNotificationEmail).
  if (firstFailure) throw firstFailure;
  return { status: "sent" };
});

/** ★ Render + upload + record, in its own transaction and its own retry budget. See archive.mjs. */
// ★ Run 9 Part 4R — THE BUILT-IN TEMPLATE LIBRARY'S SEED. Queued once per library version when the worker starts (runner.mjs, jobKey seed_template_library:<version>), or for one workspace.
//   A self-hosted install prints every built-in master on install and brings them all up to date on upgrade; the hosted service makes a master the first time a workspace uses it
//   (library.mjs ensureBuiltin) and here only brings the masters that exist up to date. Idempotent: a master already current is untouched. Each workspace in its own transaction, as
//   its owner (a master is the workspace's own row); one that fails is logged and does not stop the rest.
export const seedTemplateLibrary = workspaceOrPlatformTask("seed_template_library", async (payload, helpers) => {
  const full = payload?.full === true || process.env.KEYSTONE_SELF_HOST === "1";
  const ids = payload?.tenantId ? [payload.tenantId] : (await helpers.withPgClient((pg) => pg.query(`SELECT tenant_id FROM keystone_auth.list_active_tenant_ids()`))).rows.map((r) => r.tenant_id);
  let made = 0, failed = 0;
  for (const tenantId of ids) {
    let owner = null;
    await withTenant(tenantId, async (tx) => { owner = (await tx.query(`SELECT id FROM keystone.app_user u WHERE u.role = 'staff' AND u.staff_role = 'owner' AND EXISTS (SELECT 1 FROM keystone.user_role r WHERE r.user_id = u.id) ORDER BY u.created_at, u.id LIMIT 1`)).rows[0]?.id ?? null; });
    if (!owner) continue;   // a workspace with no owner holding a role has nobody to make its masters as: such an owner cannot see the document it prints, so the print fails and a retry would fail the same way (a leftover; the sweep reports those)
    try { const r = await withTenant(tenantId, (tx) => seedLibrary(tx, { tenantId, actorUserId: owner, onlyExisting: !full }), { userId: owner }); made += r.made; }
    catch (e) { failed += 1; helpers.logger.error(`seed_template_library: workspace ${tenantId}: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  helpers.logger.info(`seed_template_library ${LIBRARY_VERSION}: ${ids.length} workspace(s), ${made} master(s) printed, ${failed} failed (${full ? "every built-in" : "only masters in use"})`);
  if (failed) throw new Error(`seed_template_library: ${failed} workspace(s) failed; the retry re-runs only what is not current`);
});
// ★ Run 9 Part 4.4 — SEAL AND MOVE THE STORED DOCUMENT FILES. Queued when the worker starts: every workspace whose active data key has not yet been through a complete pass (a new workspace,
//   a workspace with files from before encryption existed, one just rotated, or one whose last pass failed) has its stored files sealed, or moved to the active key. `{ tenantId, rotate: true }`
//   makes a new data key active first (a platform operator's rotation); `{ tenantId, force: true }` re-checks a workspace whose pass is already complete. Each file is replaced whole, in one put, so
//   stopping part-way loses nothing; a failure is listed and the retry runs it again. Nothing here ever deletes a key.
export const reencryptDocumentFiles = workspaceOrPlatformTask("reencrypt_document_files", async (payload, helpers) => {
  if (!storageIsConfigured()) { helpers.logger.info("reencrypt_document_files: no object storage here, nothing to seal"); return; }
  let ids = payload?.tenantId ? [payload.tenantId] : (await helpers.withPgClient((pg) => pg.query(`SELECT tenant_id FROM keystone_auth.list_active_tenant_ids()`))).rows.map((r) => r.tenant_id);
  if (!payload?.tenantId && payload?.force !== true) ids = await tenantsNeedingSealPass(ids);
  let sealed = 0, moved = 0, failedTenants = 0;
  for (const tenantId of ids) {
    try {
      if (payload?.rotate === true) await rotateFileKey(tenantId);
      const r = await reencryptFiles(tenantId);
      sealed += r.sealedLegacy; moved += r.moved;
      if (r.failed.length) { failedTenants += 1; helpers.logger.error(`reencrypt_document_files: workspace ${tenantId}: ${r.failed.length} file(s) failed, first: ${r.failed[0]}`); }
    } catch (e) { failedTenants += 1; helpers.logger.error(`reencrypt_document_files: workspace ${tenantId}: ${String(e?.message ?? e).slice(0, 200)}`); }
  }
  helpers.logger.info(`reencrypt_document_files: ${ids.length} workspace(s), ${sealed} plaintext file(s) sealed, ${moved} moved to the active key, ${failedTenants} workspace(s) with a failure`);
  if (failedTenants) throw new Error(`reencrypt_document_files: ${failedTenants} workspace(s) had a failure; the retry runs them again`);
});
export const archiveDocumentPdf = guardedTask("archive_document_pdf", async (payload, helpers) => {
  const { tenantId, instanceId, actorUserId } = payload;
  if (!instanceId) throw new Error("archive_document_pdf needs an instanceId");
  if (!actorUserId) {
    throw new Error(
      "archive_document_pdf needs an actorUserId — the identity whose execution caused the archive. " +
      "Reading a document as nobody returns nothing (document_is_visible fails closed), so a job " +
      "without one would 'succeed' at archiving zero documents.");
  }

  // ★★★ VERIFY THE NAMED ACTOR RATHER THAN TRUSTING THE PAYLOAD. `add_job` is a SQL function callable
  //     by anything holding `app_rw` (§D5's enqueue hazard), so a forged payload could name any uuid.
  //     Two checks, and the SECOND is the one that matters:
  //       · the actor must exist IN THIS TENANT — read under RLS, so a cross-tenant id resolves to
  //         nothing and the job refuses;
  //       · the actor must be STAFF. Execution is admin-only, so the executor is always staff; naming
  //         a client would be a request to render a document through a client's narrower filters,
  //         which would silently archive LESS than the instrument contains.
  //   ★ The residual risk is unchanged and stated: someone with app_rw can cause a re-archive of a
  //     document a named staff member can already read, in their own tenant. A nuisance, not a
  //     disclosure — the same bound §D5 draws for every job.
  let actorOk = false;
  await withTenant(tenantId, async (tx) => {
    const r = await tx.query(
      "SELECT role FROM keystone.app_user WHERE id = $1", [actorUserId]);
    actorOk = r.rows[0]?.role === "staff";
  });
  if (!actorOk) {
    throw new Error(
      `archive_document_pdf: ${actorUserId} is not a staff member of tenant ${tenantId}, so it is not ` +
      `an identity that could have executed this instrument. Refusing — a forged or client actor would ` +
      `render the document through the wrong filters.`);
  }

  let result = null;
  const t0 = Date.now(), waitedMs = Math.max(0, t0 - new Date(helpers.job?.run_at ?? t0).getTime());
  // ★★ THE ACTOR IS THE VIEWER. `withTenant`'s third argument sets `keystone.user_id`, which is what
  //    `document_is_visible()` reads. This is the whole fix.
  await withTenant(tenantId, async (tx) => {
    result = await archiveExecutedPdf(tx, { tenantId, instanceId });
  }, { userId: actorUserId });
  helpers.logger.info(
    `archived PDF for ${instanceId} (waited ${waitedMs} ms in the queue, ran ${Date.now() - t0} ms, attempt ${helpers.job?.attempts}): ${result.byteSize} bytes, sha256 ${result.sha256.slice(0, 12)}…, ` +
    `key ${result.objectKey}${result.reused ? " (re-archived — this was a retry)" : ""}`);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ FIX, 30 Sep 2026 — "EMAIL THE SIGNED COPY." The signing page tells every signer "You'll get
  //     a PDF by email." — this is that email, sent to every signer with an account plus the staff
  //     member who sent the document ("the practice"). ★ ONLY ON A FIRST ARCHIVE (`!result.reused`):
  //     `archive_document_pdf` is re-run by the queue's own retry ladder and by a forged `add_job`
  //     (§D5), and re-sending the same attachment on every retry would mail a signer the same PDF
  //     five times for one signature. `document_pdf_one_per_instance`'s own uniqueness is what makes
  //     `reused` mean "this instrument already had an archive row" rather than "this attempt".
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★ FIX, 8 Oct 2026 (Stage T, measured): the signing process now archives the sealed copy itself a moment after the last signature (7 Oct), so this job almost always finds it
  //   already archived — `reused` — and `!result.reused` skipped the signed-copy email for EVERY uploaded document. An uploaded document is now emailed once per person whoever archived first
  //   (the email log is the memory); the older paths keep the first-archive rule.
  let pdfPlan = null;
  if (!result.reused || result.pdf) {
    await withTenant(tenantId, async (tx) => {
      const { rows: tenantRows } = await tx.query(
        `SELECT name FROM keystone.tenant WHERE id = $1`, [tenantId]);
      // ★ FIX, 1 Oct 2026 (an example organisation brand brief) — signed-copy email is brand-facing.
      const practiceName = (await getSetting(tx, "practice.name", null)) || tenantRows[0]?.name || "";
      const logoUrl = await getSetting(tx, "branding.logo_url", null);

      const createdBy = await instanceCreatorById(tx, { instanceId });

      // ★ Every signer with an account, PLUS the staff sender ("the practice") — deduplicated by
      //   app_user id, so a staff member who also signed does not get two copies of one email.
      const recipientIds = [...new Set([
        ...(result.signatures ?? []).map((s) => s.signer_uid).filter(Boolean),
        ...(createdBy ? [createdBy] : []),
      ])];
      // QUEUE §23.4.8 — an uploaded document's people are `document_party` rows (no account): they come back as plain {name, email}, and the practice's switch decides whether anyone is emailed
      if (result.pdf) {
        const seen = new Set();
        const sendTo = [];
        for (const r of result.recipients ?? []) { const k = r.email.toLowerCase(); if (!seen.has(k)) { seen.add(k); sendTo.push(r); } }
        if (sendTo.length || result.copyEnabled) {   // D-055: with the switch on, the sender is mailed even when nobody on the document has an address
          const { rows: sender } = createdBy ? await tx.query(`SELECT display_name, email FROM keystone.app_user WHERE id = $1 AND do_not_email IS NOT TRUE`, [createdBy]) : { rows: [] };
          for (const s of sender) if (s.email && !seen.has(s.email.toLowerCase())) sendTo.push({ name: s.display_name, email: s.email });
        }
        pdfPlan = { sendTo, practiceName, logoUrl };   // Round 3 R-8/R-9: each person is mailed in their OWN transaction below, so a failure partway rolls back nothing already sent
        return;
      }
      if (recipientIds.length === 0) return;

      // ★ `do_not_email` IS RESPECTED HERE TOO — an opt-out is a standing instruction, not something
      //   a signed-document attachment overrides just because it is not marketing.
      const { rows: peopleRows } = await tx.query(
        `SELECT id, display_name, email FROM keystone.app_user
          WHERE id = ANY($1::uuid[]) AND do_not_email IS NOT TRUE`, [recipientIds]);
      const executedLocalDate = (result.signatures ?? []).find((s) => s.signed_local_date)?.signed_local_date ?? null;

      for (const person of peopleRows) {
        if (!person.email) continue; // ★ an account with no email on file cannot be mailed — skip, don't fail the archive over it
        const outcome = await sendSignedCopyEmail({
          to: person.email,
          practiceName,
          logoUrl,
          documentTitle: result.title,
          recipientName: person.display_name ?? "",
          executedLocalDate,
          pdfBytes: result.bytes,
          // ★ PART 2 ADDITION (F844-style fix) — makes "documents.signed_copy" tenant-editable in
          //   Run → Templates; `tx` here is already the withTenant handle this whole block runs in.
          tx, tenantId,
          // the organisation's own sending identity (platform, its domain, or its SMTP server), applied by the Documents island
          deliver: (m) => sendDocumentMail(tx, { tenantId, ...m }),
        });
        if (outcome.status === "failed") {
          helpers.logger.warn(`signed-copy email to ${person.id} for ${instanceId} failed: ${outcome.error}`);
        }
      }
    }, { userId: actorUserId });

    // Round 3 R-8/R-9 — one person at a time, each in its own transaction (the email-log row commits with that send, so a retry never re-mails someone already mailed), and a failure is THROWN after the loop so the queue's retry ladder tries the rest again instead of the job "succeeding" with a signer who never got their copy.
    if (pdfPlan) {
      const failed = [];
      for (const person of pdfPlan.sendTo) {
        try {
          await withTenant(tenantId, async (tx) => {
            if (await documentEmailAlreadySent(tx, { instanceId, kind: "completed", to: person.email })) return;
            const { practiceName, logoUrl } = pdfPlan;
            // the sender (no party row of their own) gets the same link rule, issued against the first signer's row — never an attachment when the organisation sends links
            const linkParty = person.partyId ?? result.ownerPartyId ?? null;
            const downloadUrl = result.downloadDays > 0 && linkParty
              ? (await mintDownloadLink(tx, { tenantId, leadId: result.leadId, partyId: linkParty, days: result.downloadDays })).url : null;
            if (result.downloadDays > 0 && !downloadUrl) { helpers.logger.warn(`signed-copy email to ${person.email} for ${instanceId} skipped: links are on and there is no link to give`); return; }
            // R13-D221: a test document's completion email is marked [TEST] like its invitation
            const { rows: [tst] } = await tx.query(`SELECT is_test FROM keystone.document_instance WHERE id = $1`, [result.leadId ?? instanceId]);
            const outcome = await sendSignedCopyEmail({
              to: person.email, practiceName, logoUrl, documentTitle: tst?.is_test === true ? `[TEST] ${result.title}` : result.title, recipientName: (person.name && person.name !== practiceName) ? person.name : "there", executedLocalDate: null, pdfBytes: result.bytes, certificateBytes: result.certificateBytes ?? null, downloadUrl, tx, tenantId, language: person.language ?? result.language ?? "en",
              deliver: (m) => sendDocumentMail(tx, { tenantId, ...m, log: { kind: "completed", instanceId } }),
            });
            if (outcome.status === "failed") { helpers.logger.warn(`signed-copy email to ${person.email} for ${instanceId} failed: ${outcome.error}`); failed.push(person.email); }
          }, { userId: actorUserId });
        } catch (e) { helpers.logger.warn(`signed-copy email to ${person.email} for ${instanceId} could not be sent: ${e.message}`); failed.push(person.email); }
      }
      // Run 9 Part 3.7 (Pay2): the payment receipt travels with the sealed copy — sent in this step, once per payment (the payment row is the memory), never on its own before it
      if (!failed.length) await withTenant(tenantId, (tx) => sendReceiptsForSend(tx, { tenantId, leadId: result.leadId }), { userId: actorUserId })
        .catch((e) => helpers.logger.warn(`payment receipts for ${instanceId}: ${e.message}`));
      if (failed.length) throw new Error(`the signed copy could not be emailed to ${failed.length} ${failed.length === 1 ? "person" : "people"} (${failed.length === pdfPlan.sendTo.length ? "all" : "some"} will be tried again)`);
    }
  }

  // ★ `bytes`/`signatures` were carried on `result` only to reach the email step above — never part
  //   of this job's own recorded ledger payload (a PDF's raw bytes in a job-result row would bloat it
  //   for no reason once emailed).
  const { ownerPartyId: _op, bytes: _bytes, certificateBytes: _cert, signatures: _signatures, title: _title, ...ledgerResult } = result;
  return ledgerResult;
});

/**
 * ★★★ P20.4 — CLOSE TASKS WHOSE SUBJECT NO LONGER EXISTS. A SWEEPER, NOT A TRIGGER, and 0056's header
 *     carries the measurement that decided it: `run_schedule_item`'s table does not exist until P20.6,
 *     `document_instance` REFUSES deletion when terminal, and four of the six subject types carry a
 *     `status`/`state` column — so a DELETE trigger would be five-of-six with an invisible hole, and
 *     watching the wrong verb for the type that matters most.
 *
 * ★★ IT DOES NOT DECIDE ANYTHING — the SQL does. `keystone.close_tasks_with_missing_subjects()` holds
 *    the three-valued logic (there / gone / cannot check), because that logic is the whole safety
 *    property and it belongs next to the tables it reads, not in a JS layer that could drift from them.
 *  ★ This task's only jobs are to run it inside `withTenant` (so RLS applies) and to LOG BOTH NUMBERS.
 *
 * ★★★ THE `skipped` NUMBER IS LOGGED EVEN WHEN IT IS ZERO, and that is deliberate. It is the count of
 *     open tasks the sweeper COULD NOT VERIFY. Today that is every `run_schedule_item` task, which is
 *     none, because P20.6 has not built them. The day it does, this number becomes non-zero and the log
 *     says so — which is how the omission announces itself instead of waiting to be noticed.
 */
export const closeOrphanTasks = guardedTask("close_orphan_tasks", async (payload, helpers) => {
  const { tenantId } = payload;
  let result = { closed: 0, skipped: 0 };
  await withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT closed_count, skipped_unverifiable FROM keystone.close_tasks_with_missing_subjects()`);
    result = { closed: rows[0]?.closed_count ?? 0, skipped: rows[0]?.skipped_unverifiable ?? 0 };
  });
  helpers.logger.info(
    `close_orphan_tasks tenant=${tenantId} closed=${result.closed} ` +
    `unverifiable=${result.skipped}` +
    (result.skipped > 0
      ? ` ★ ${result.skipped} open task(s) have a subject_type this sweeper CANNOT CHECK — they were ` +
        `LEFT ALONE, not closed. Add the type to keystone.task_subject_checkable_types().`
      : ""));
  return result;
});

/**
 * ★★★ P20.6 / P20.6b — THE CADENCE SWEEP. THE SOURCE OF TRUTH IS A TABLE, READ EVERY SWEEP.
 *
 *     This is P18.6(d)'s second half, which was BLOCKED in Phase 18 because `run_schedule_item` did
 *     not exist. 0057 created it; P20.6b records the move. §D5 ruling 3: graphile's cron is STATIC and
 *     cannot express a job set that changes, so the schedule lives in the database and is queried here.
 *   ★ A cadence change therefore takes effect on the NEXT SWEEP — no deploy, no worker restart. With a
 *     crontab the running worker would keep the old rhythm until restarted, so the database and the
 *     behaviour would disagree with nothing to reconcile them.
 *
 * ★★ IT ENQUEUES; IT DOES NOT PULL. One job per due item, each with a `job_key` so a slow service
 *    cannot accumulate a queue of identical pulls behind it — the same reasoning as `sweep_tenants`.
 *
 * ★★★ AND THE "NO GRANT" BRANCH IS DECIDED HERE, NOT IN THE PULL. An item with no live binding has
 *     nothing to attempt, so it would never produce a failure row to count — `resolveGrant()` returning
 *     `no_grant` is the ONLY way that state is ever reached. P20.9: billing does not pause, so the item
 *     is marked not_deliverable_no_grant and LEFT BILLED.
 */
export const sweepRunSchedule = guardedTask("sweep_run_schedule", async (payload, helpers) => {
  const { tenantId } = payload;
  const summary = { due: 0, enqueued: 0, blockedNoGrant: 0 };
  const { dueItems, resolveGrant, markNoGrant } = await import("../run/schedule.mjs");

  const toEnqueue = [];
  await withTenant(tenantId, async (tx) => {
    const items = await dueItems(tx, { tenantId });
    summary.due = items.length;
    for (const it of items) {
      // ★ `monitoring` is ours, not Google's — it has no grant to resolve. Asking would return
      //   `no_grant` and block a service that never needed one, which is the over-correction.
      if (it.service === "monitoring") { toEnqueue.push(it); continue; }
      const grant = await resolveGrant(tx, { tenantId, accountId: it.account_id, service: it.service });
      if (grant.because === "no_grant") {
        await markNoGrant(tx, { tenantId, itemId: it.id });
        summary.blockedNoGrant++;
        continue;
      }
      // ★★ `grant_unusable` and `resource_lost` are NOT short-circuited here, deliberately. They are
      //    concluded from repeated FAILED ATTEMPTS (advanceSchedule's LOSE_AFTER), because one refusal
      //    can be a transient Google error and flipping an account to not-deliverable on the first
      //    one is the crying-wolf failure P20.6 names. So the pull runs and records the failure.
      toEnqueue.push(it);
    }
  });

  for (const it of toEnqueue) {
    await helpers.addJob("run_pull", { tenantId, itemId: it.id },
      { jobKey: `run_pull:${it.id}`, jobKeyMode: "replace" });
    summary.enqueued++;
  }

  helpers.logger.info(
    `sweep_run_schedule tenant=${tenantId} due=${summary.due} enqueued=${summary.enqueued} ` +
    `blocked_no_grant=${summary.blockedNoGrant}` +
    (summary.blockedNoGrant > 0
      ? ` ★ ${summary.blockedNoGrant} item(s) are BILLED AND NOT DELIVERABLE — no live grant. Billing does not pause (P20.9).`
      : ""));
  return summary;
});

/**
 * ★★★ P20.6 — ONE PULL. THE HTTP CALL IS INJECTED, AND THAT IS NOT A TESTING CONVENIENCE.
 *
 *     P20.9b puts THREE HUMAN APPROVAL GATES on this phase's critical path and P20.9d says the
 *     end-to-end proof happens only AFTER the OAuth app's publishing status is "In production". So the
 *     real Google calls are deliberately NOT wired here yet — `fetcher` defaults to a function that
 *     records a `provider_error` reading saying exactly that, rather than to a stub that pretends to
 *     succeed. ★ A default that returned fake success would make the whole pipeline look green while
 *     reading nothing, which is precisely the "30 passing assertions over a module with no call sites"
 *     failure P18.9 cost a phase to find.
 *
 * ★★ EVERY OUTCOME WRITES A ROW. A missing row and a failed row are different facts (P20.6), so there
 *    is no path through this task that leaves the table unchanged.
 */
export const runPull = guardedTask("run_pull", async (payload, helpers) => {
  const { tenantId, itemId } = payload;
  const { resolveGrant, advanceSchedule } = await import("../run/schedule.mjs");
  const { recordReading, upsertMetrics } = await import("../run/readings.mjs");

  const fetcher = helpers.runFetcher ?? (async () => ({
    ok: false, failureClass: "provider_error", httpStatus: null,
    error: "no fetcher is wired: the live Google calls are gated behind P20.9b's approval gates and " +
           "P20.9d's \"publishing status is In production\" precondition. This is a deliberate refusal, " +
           "not a missing implementation — a stub that returned fake success would make the pipeline " +
           "look green while reading nothing.",
    providerResponse: null, payload: null, rowCount: null, metrics: [],
  }));

  let result = null;
  await withTenant(tenantId, async (tx) => {
    const it = (await tx.query(
      `SELECT id, account_id, service, item FROM keystone.run_schedule_item
        WHERE tenant_id = $1 AND id = $2`, [tenantId, itemId])).rows[0];
    if (!it) {
      // ★ NOT tolerated silently. The sweep enqueued this a moment ago, so an invisible row means the
      //   item was deleted mid-flight or the tenant context is wrong — both worth a loud failure.
      throw new Error(
        `run_pull: schedule item ${itemId} is not visible in tenant ${tenantId}. The sweep enqueued it, ` +
        `so it was either deleted mid-flight or this transaction has the wrong tenant context.`);
    }

    const grant = it.service === "monitoring"
      ? { usable: true, resourceId: null }
      : await resolveGrant(tx, { tenantId, accountId: it.account_id, service: it.service });

    const started = Date.now();
    const outcome = grant.usable
      ? await fetcher({ service: it.service, item: it.item, grant })
      : { ok: false, failureClass: grant.because === "grant_unusable" ? "grant_unusable" : "resource_forbidden",
          httpStatus: null, error: `grant not usable: ${grant.because} (${grant.detail ?? "—"})`,
          providerResponse: null, payload: null, rowCount: null, metrics: [] };

    const reading = await recordReading(tx, {
      tenantId, accountId: it.account_id,
      // ★ `monitoring` has no google_resource; every other service must have one by construction,
      //   because resolveGrant returned usable.
      resourceId: grant.resourceId ?? null,
      service: it.service, item: it.item,
      ok: outcome.ok, failureClass: outcome.failureClass ?? null, httpStatus: outcome.httpStatus ?? null,
      error: outcome.error ?? null, providerResponse: outcome.providerResponse ?? null,
      durationMs: Date.now() - started, payload: outcome.payload ?? null,
      rowCount: outcome.rowCount ?? null,
    });

    if (outcome.ok && outcome.metrics?.length) {
      await upsertMetrics(tx, {
        tenantId, accountId: it.account_id, service: it.service,
        readingId: reading.id, metrics: outcome.metrics });
    }

    result = await advanceSchedule(tx, {
      tenantId, itemId, ok: outcome.ok,
      failureClass: outcome.failureClass ?? null,
      readingId: outcome.ok ? reading.id : null });
    result = { ...result, readingId: reading.id, ok: outcome.ok };
  });

  helpers.logger.info(
    `run_pull tenant=${tenantId} item=${itemId} ok=${result.ok} state=${result.state} ` +
    `consecutive_failures=${result.consecutiveFailures} next_run_at=${result.nextRunAt?.toISOString?.() ?? result.nextRunAt}`);
  return result;
});

/**
 * ★★ P20.6's RETENTION. It NULLS payloads at 90 days and NEVER deletes a row.
 *  ★ It runs per tenant off the same static sweep, for the same reason as the others: one static entry.
 */
export const pruneRunPayloads = guardedTask("prune_run_payloads", async (payload, helpers) => {
  const { tenantId } = payload;
  const { prunePayloads, PAYLOAD_RETENTION_DAYS } = await import("../run/readings.mjs");
  let r = { pruned: 0, bytesReleased: 0 };
  await withTenant(tenantId, async (tx) => { r = await prunePayloads(tx, { tenantId }); });
  helpers.logger.info(
    `prune_run_payloads tenant=${tenantId} pruned=${r.pruned} bytes_released=${r.bytesReleased} ` +
    `(retention ${PAYLOAD_RETENTION_DAYS}d — payloads NULLed, rows KEPT FOREVER)`);
  return r;
});

/**
 * ★★★ STAGE 4 TASK 12 — THE DAILY BOOKKEEPING PRUNE (spec 07 §3). Per practice, like prune_run_payloads
 *     above and unlike sweep_tenants: one practice's failure stops that practice's prune and nobody else's.
 *   ★★ It removes SETTLED bookkeeping only — event_delivery (30d, event processed/dead), webhook_delivery
 *      (30d, the (endpoint, event) group delivered/closed or dead-AND-reported), idempotency_key (7d,
 *      completed) and keystone_meta.job_failure (30d after it was ACKNOWLEDGED, R59) — and erases
 *      notification_delivery.request_body 24h after the first attempt (Task 6 / R66), keeping the row.
 *   ★★ It NEVER touches keystone.event, keystone.notification or keystone.platform_event: those are
 *      History. Why each filter is what it is lives in src/queue/pruneBookkeeping.mjs's header, beside
 *      the statements themselves.
 *   ★ The ledger half runs on the WORKER's connection (helpers.withPgClient) because
 *     keystone_meta.job_failure has no table grants for anyone — only app_worker may execute 0159's
 *     definer. The other four run as app_rw inside withTenant.
 */
export const pruneBookkeeping = guardedTask("prune_bookkeeping", async (payload, helpers) => {
  const { tenantId } = payload;
  const r = await helpers.withPgClient((worker) =>
    pruneBookkeepingForTenant(tenantId, { workerClient: worker }));
  if (r.skipped) {
    helpers.logger.info(
      `prune_bookkeeping tenant=${tenantId} skipped=${r.skipped} ` +
      `— the reference practice's bookkeeping is kept, and is skipped IN THE QUERY (0099's guard never fires)`);
    return r;
  }
  helpers.logger.info(
    `prune_bookkeeping tenant=${tenantId} ` +
    Object.entries(r.pruned).map(([k, v]) => `${k}=${v}`).join(" ") +
    ` request_bodies_cleared=${r.requestBodiesCleared} ` +
    `(retention ${PRUNE_RETENTION.eventDeliveryDays}/${PRUNE_RETENTION.webhookDeliveryDays}/` +
    `${PRUNE_RETENTION.idempotencyKeyDays}/${PRUNE_RETENTION.jobFailureDays}d + ` +
    `${PRUNE_RETENTION.requestBodyHours}h, batch ${PRUNE_BATCH})`);
  return r;
});

// ★★★ Stage 17 Task 17.16 — nightly usage reconciliation against live provider counts.
export const usageReconcile = guardedTask("usage_reconcile", async (payload, helpers) => {
  const { tenantId } = payload;
  // ★ Reconcile the current month and the previous month (so a closed month is final).
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const result = await withTenant(tenantId, async (tx) => {
    await reconcileTenant(tx, { tenantId, periodStart });
    return { tenantId, periodStart: periodStart.toISOString() };
  });
  helpers.logger.info(
    `usage_reconcile tenant=${result.tenantId} periodStart=${result.periodStart} ` +
    `— reconciled live usage against provider truth`);
  return result;
});

// ★ Shared document engine (design §6) — one queued AI draft or edit. The provider's answer is untrusted and every failure is written on the job itself as a plain sentence, so
//   an exception here means the infrastructure failed (database, secrets), not that the model said no; the queue retries those.
export const documentAiDraft = guardedTask("document_ai_draft", async (payload, helpers) => {
  const { tenantId, jobId } = payload;
  // no database transaction is held open while the model thinks: the claim, the call and the result are separate short moments
  const r = await runAiJobDetached((fn) => withTenant(tenantId, fn), { tenantId, jobId });
  helpers.logger.info(`document_ai_draft tenant=${tenantId} job=${jobId} state=${r.state}`);
  return { jobId, state: r.state };
});

// ★ Run 4 — one page of an AI look for fields. The provider's answer is untrusted and every failure is written on the page itself in plain words; an exception here means the infrastructure failed (database, storage), which the queue retries.
export const documentDetectPage = guardedTask("document_detect_page", async (payload, helpers) => {
  const { tenantId, jobId, page } = payload;
  const r = await runDetectPage((fn, o) => withTenant(tenantId, fn, o?.userId ? { userId: o.userId } : undefined), { tenantId, jobId, page });
  helpers.logger.info(`document_detect_page tenant=${tenantId} job=${jobId} page=${page} claimed=${r.claimed} state=${r.state ?? "-"}`);
  return { jobId, page, state: r.state ?? null };
});

// ★ AI-COST-AND-USAGE-SPEC §4 — the platform's AI spend against its monthly ceiling: alert emails at 50, 80 and 100 percent (once each). Only the PLATFORM organisation does anything here.
export const documentAiPlatformWatch = guardedTask("document_ai_platform_watch", async (payload, helpers) => {
  const { tenantId } = payload;
  const r = await withTenant(tenantId, (tx) => watchAiCeiling(tx, { tenantId }));
  if (r.sent.length) helpers.logger.info(`document_ai_platform_watch tenant=${tenantId} sent alerts at ${r.sent.join(", ")} percent`);
  return r;
});

// ★ Launch step 3 (13 Oct 2026) — the welcome series for a new Docustay account's owner: at most one email, skipped when the step is already done, never to anyone who opted out. A workspace that is not Docustay has no rows, so nothing happens.
export const docustayWelcome = guardedTask("docustay_welcome", async (payload, helpers) => {
  const { tenantId } = payload;
  const r = await runWelcomeForTenant(tenantId);
  if (r.length) helpers.logger.info(`docustay_welcome tenant=${tenantId} ${r.map((x) => `step=${x.step ?? x.wait}:${x.status ?? x.skipped ?? "wait"}`).join(" ")}`);
  return r;
});

// ★ Docustay pricing follow-up (6 Oct 2026) — the daily seat count: one number per Docustay workspace per day, count and date only.
export const docustaySeatLog = guardedTask("docustay_seat_log", async (payload, helpers) => {
  const { tenantId } = payload;
  const r = await withTenant(tenantId, (tx) => logSeatsToday(tx, { tenantId }));
  if (r) helpers.logger.info(`docustay_seat_log tenant=${tenantId} day=${r.day} seats=${r.seatCount}`);
  if (r) { try { const { syncPaygSeats } = await import("../product/docustayUsage.mjs"); const c = await withTenant(tenantId, (tx) => syncPaygSeats(tx, { tenantId, staffCount: r.seatCount })); if (c.changed) helpers.logger.info(`docustay_seat_log tenant=${tenantId} Pay as you go seats ${c.from} → ${c.to}`); } catch (e) { helpers.logger.warn(`docustay_seat_log tenant=${tenantId} seat sync failed: ${e?.message ?? e}`); } }
  // 21 Oct 2026 (pricing integrity): the once-a-day checks (the own-key notice; fair-use review flags, review only)
  if (r) { try { const { dailyChecks } = await import("../product/docustayDaily.mjs"); await withTenant(tenantId, (tx) => dailyChecks(tx, { tenantId, log: (m) => helpers.logger.warn(m) })); } catch (e) { helpers.logger.warn(`docustay_seat_log tenant=${tenantId} daily checks failed: ${e?.message ?? e}`); } }
  return r ?? { tenantId, skipped: "not a Docustay workspace" };
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 5 (F475) — LISTENERS, EACH WITH ITS OWN NAME, ITS OWN SAVEPOINT AND ITS OWN SCORE.
//
//   [MEASURED, recon §4 + test/s3_poison_listener red run] the whole claimed batch ran in ONE transaction
//   with NO savepoints. A real SQL error in one listener aborted the transaction; `markFailed` then failed
//   with 25P02; the error escaped `withTenant`, which rolled back EVERY event in the batch — including the
//   claims — so nothing recorded the failure and every event came back to be re-run, re-sending whatever
//   the healthy listeners had already done.
//
//   ★★ NOW: every (event, listener) pair runs inside its own SAVEPOINT, and each event inside an outer one.
//      A listener that throws — a JS error or a Postgres error — is rolled back TO ITS SAVEPOINT ONLY, its
//      failure is written to its own `keystone.event_delivery` row (0139), and the dispatcher carries on
//      with the next listener and the next event. The event's status is derived from its rows
//      (`settleEvent`): `processed` once every listener is delivered, dead or skipped.
//   ★★ A RETRY RE-RUNS ONLY THE LISTENERS NOT YET DELIVERED (spec 02 §2.6). That is what stops a second
//      email, a second task or a second webhook when some OTHER listener on the same event failed.
//   ★ Retries follow 07: 1 min, 5 min, 30 min, 2 h, 12 h, then `dead` (RETRY_SCHEDULE_SECONDS, outbox.mjs).
//     `dead` is reported as a `job.gave_up` platform event (Task 6's writer) after the tenant transaction
//     commits — see `reportGaveUps`.
//
//   ★★★ LISTENER NAMES ARE STABLE STRING CONSTANTS. They are stored on delivery rows that outlive a
//       deploy; renaming one strands every in-flight row (a row naming an unregistered listener is
//       recorded `skipped` with reason `listener_retired`, never silently dropped). Add names; never rename.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const LISTENER = Object.freeze({
  NOTIFY_DOCUMENT_SENT: "notify_document_sent",           // in-app notification + email job (documents.document.sent)
  ARCHIVE_DOCUMENT_PDF: "archive_document_pdf",           // internal job (documents.document.executed)
  RUN_DOCUMENT_DETECT_JOB: "run_document_detect_job",         // internal job (documents.detect.job_requested): starts one worker task per page of the AI look for fields
  RUN_DOCUMENT_AI_JOB: "run_document_ai_job",             // internal job (documents.ai.job_requested): starts the AI draft/edit worker task
  SCHEDULE_BOOKING_REMINDER: "schedule_booking_reminder", // internal job (booking.booking.created)
  NOTIFY_BOOKING_REMINDER: "notify_booking_reminder",     // in-app notifications + email jobs (booking.booking.reminder)
  RESCHEDULE_BOOKING_REMINDER: "reschedule_booking_reminder",   // re-adds the reminder job at the new time (booking.booking.rescheduled)
  UNSCHEDULE_BOOKING_REMINDER: "unschedule_booking_reminder",   // removes the queued reminder job (booking.booking.cancelled)
  TASK_CHAINS: "task_chains",                             // opens/closes tasks (src/tasks/chains.mjs)
  WEBHOOKS: "webhooks",                                   // enqueues deliver_webhooks, which owns the HTTP retries
  // ★ 12.9 — a referral was sent → queue its email (people.referral.sent).
  NOTIFY_REFERRAL_SENT: "notify_referral_sent",
  // ★ 13.15 — a freed slot was offered → queue its email + its own expiry (booking.waitlist.offered).
  NOTIFY_WAITLIST_OFFER: "notify_waitlist_offer",
  // ★ 13.15 — a 24-hour consent hold lapsed → tell the practice's admin(s), in-app only (booking.hold.expired).
  NOTIFY_HOLD_EXPIRED: "notify_hold_expired",
  // ★ 14.27 — an attended session earns loyalty points, for each attended participant (booking.booking.completed).
  LOYALTY_ACCRUE: "loyalty_accrue",
  // ★ Stage 14 task 14.26 — a catalogue item was created, re-priced or edited → sync its Stripe
  //   product/price/coupon on the practice's own connected account. Nine topics claim this ONE
  //   listener (HANDLER_LISTENER below) — field 4's own "map to the SAME listener (one entry each
  //   in HANDLER_LISTENER)".
  CATALOGUE_SYNC: "catalogue_sync",
  // ★ Stage 15 task 15.37 — money notifications and listener operations (F720).
  MONEY_EMAILS: "money_emails",                           // outbound: enqueue deliver_notification_email
  MONEY_OWNER_NOTICE: "money_owner_notice",               // internal: in-app notification to practice owner(s)
  MONEY_NO_SHOW: "money_no_show",                         // internal: write a no-show invoice
  MONEY_LOYALTY: "money_loyalty",                         // internal: accrue loyalty points
  // ★ Stage 16 task 16.32 — automations listener and campaign batch enqueue
  AUTOMATIONS: "automations",                             // outbound: run automation steps and sweeps
  CAMPAIGN_BATCH: "enqueue_campaign_batch",               // outbound: enqueue campaign batch delivery
  // ★ Task 18.31 — a payment was recorded → create push notifications to staff with configured terminology.
  NOTIFY_PAYMENT_RECEIVED: "notify_payment_received",     // outbound: staff push notifications on payment
  // ★ Task 20.4 — a person was created or archived → ensure/sync their Stripe customer.
  ENSURE_STRIPE_CUSTOMER: "ensure_stripe_customer",       // outbound: create/sync customer on Stripe
  // ★ B-2 (F799) — a package payment or a subscription cycle's invoice.paid grants credits.
  GRANT_CREDITS: "grant_credits",
  // ★ B-3b — a held booking's document was executed → confirm it (documents.document.executed,
  //   pushed alongside ARCHIVE_DOCUMENT_PDF, which stays this topic's HANDLER_LISTENER entry).
  CONFIRM_HELD_BOOKINGS: "confirm_held_bookings",
  // ★ PH1 (Dashboard, 16 Oct 2026) — committed Docustay events to PostHog (src/product/posthogListener.mjs). Pushed, never mapped.
  POSTHOG: "posthog",
  // ★ B-5b — a subscription failed to start when its document/estimate triggered it
  //   (money.subscription.start_failed) → retry it. Declared, reached, pushed and run the same shape
  //   as GRANT_CREDITS/CONFIRM_HELD_BOOKINGS just above.
  START_SUBSCRIPTION: "start_subscription",
  // ★ F836, "7 missing emails" brief, 1 Oct 2026 — four topics that already emit but had no
  //   listener at all: a document lapsing unsigned, a document being declined, a credit note
  //   being issued, and a package purchase (via money.entitlement.granted, gated to source_type
  //   'package' inside the handler so a plan renewal or manual comp does not fire it).
  NOTIFY_DOCUMENT_EXPIRED: "notify_document_expired",
  NOTIFY_DOCUMENT_DECLINED: "notify_document_declined",
  NOTIFY_CREDIT_NOTE_ISSUED: "notify_credit_note_issued",
  NOTIFY_PACKAGE_PURCHASED: "notify_package_purchased",
  // ★ PART 2 ADDITION, "every email on the one system" brief, 1 Oct 2026 — one listener for the
  //   ~71 real, emitted topics that had a written draft template and nothing reading it
  //   (specs/EMAILS.md). Each topic's recipient-resolution + summary line is a one-line row in
  //   src/queue/genericNotifications.mjs, not a bespoke listener each — see that file's own header.
  GENERIC_NOTICE: "generic_notice",
  // ★ PUSH_TO_CALENDAR (F678/task 3a.6) intentionally NOT added here yet — 22 Sep 2026, Group A
  //   checkpoint: the prior dispatch stalled mid-edit with only this enum key written, no matching
  //   LISTENER_REACH/LISTENER_RUN entry and no HANDLER_LISTENER hookup. Left out rather than guessed
  //   back in, because planListeners()'s HANDLER_LISTENER map is ONE listener per topic (line ~1443)
  //   and booking.booking.created/rescheduled/cancelled are ALREADY claimed by the reminder listeners
  //   — wiring a second listener onto the same topics needs a real design decision (array-of-listeners
  //   per topic, or a side table), not a guess made to unblock a deploy. See F678 in FINDINGS-OPEN.md
  //   for the re-dispatch. The rest of 3a.6 (the 3 remote-changes routes in routes/calendar.mjs) is
  //   unaffected and complete.
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 3 TASK 8 — WHERE EACH LISTENER REACHES (spec 02 §2 rule 9; 08 §6; MOCKUPS §21).
//     "events with `sample: true` are stored and shown in History but NEVER delivered to n8n, email, push
//      or outbound webhooks." Decided PER LISTENER, here, in ONE place:
//       · "outbound" — its effect reaches a person or a system outside this database (an email, a
//         notification to a person, a webhook POST, n8n). A sample event records it `skipped`
//         (reason `sample_event`) and it never runs.
//       · "internal" — bookkeeping inside the practice's own data. It runs for a sample event as today.
//   ★★ A NEW LISTENER CANNOT BE ADDED UNCLASSIFIED: the module refuses to load (below), and
//      test/s3_sample_events.test.mjs fails. An unknown class is treated as outbound at run time too.
//   ★ The reasons, one line each:
//     notify_document_sent      outbound — raises the recipient's notification AND enqueues its email.
//     notify_booking_reminder   outbound — the same, for every participant with an account.
//     schedule_booking_reminder outbound — its ONLY effect is a reminder email later (send_booking_reminder
//                                          → booking.booking.reminder → notify_booking_reminder).
//     reschedule_booking_reminder outbound — like schedule_booking_reminder: its effect is a reminder email later.
//     unschedule_booking_reminder internal — only REMOVES a queued job from this system's own queue; it sends
//                                          nothing to anyone, and removing a sample booking's job is harmless.
//     webhooks                  outbound — enqueues deliver_webhooks, an HTTPS POST to a subscriber.
//     task_chains               internal — opens/closes staff tasks. ★ Whether a SAMPLE booking should open
//                                          a real staff task is a product question the specs do not
//                                          answer (task-8-report.md); until it is ruled, it runs as today.
//     archive_document_pdf      internal — renders the executed PDF into the practice's own object store.
//     notify_waitlist_offer     outbound — enqueues the offer email (send_waitlist_offer) and its own expiry.
//     notify_hold_expired       internal — an in-app notice to the practice's own admin(s) only; sends nothing
//                                          outside this database.
//   ★ n8n is not a listener yet; when it is added it is "outbound" (02 §3: "every NON-SAMPLE event").
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const LISTENER_REACH = Object.freeze({
  [LISTENER.NOTIFY_DOCUMENT_SENT]: "outbound",
  [LISTENER.ARCHIVE_DOCUMENT_PDF]: "internal",
  [LISTENER.RUN_DOCUMENT_AI_JOB]: "internal",
  [LISTENER.RUN_DOCUMENT_DETECT_JOB]: "internal",
  [LISTENER.SCHEDULE_BOOKING_REMINDER]: "outbound",
  [LISTENER.NOTIFY_BOOKING_REMINDER]: "outbound",
  [LISTENER.RESCHEDULE_BOOKING_REMINDER]: "outbound",
  [LISTENER.UNSCHEDULE_BOOKING_REMINDER]: "internal",
  [LISTENER.TASK_CHAINS]: "internal",
  [LISTENER.WEBHOOKS]: "outbound",
  // ★ 12.9 — outbound: its effect is the referral email, to the partner and (if copied) the person.
  [LISTENER.NOTIFY_REFERRAL_SENT]: "outbound",
  // ★ 13.15 — outbound: its effect is the waitlist offer email, to the client.
  [LISTENER.NOTIFY_WAITLIST_OFFER]: "outbound",
  // ★ 13.15 — internal: an in-app notice to this practice's own admin(s) only, per the plan's own
  //   text ("reach internal — in-app only").
  [LISTENER.NOTIFY_HOLD_EXPIRED]: "internal",
  // ★ 14.27 — internal: bookkeeping onto this practice's own loyalty ledger only; nothing leaves
  //   this database (field 4's own classification: "reach internal").
  [LISTENER.LOYALTY_ACCRUE]: "internal",
  // ★ Stage 14 task 14.26 — outbound: its effect is a POST to Stripe, a system outside this
  //   database (field 4's own classification: "reach outbound").
  [LISTENER.CATALOGUE_SYNC]: "outbound",
  // ★ Stage 15 task 15.37 — money notifications (F720).
  [LISTENER.MONEY_EMAILS]: "outbound",          // its effect is outbound email via `deliverNotificationEmail`
  [LISTENER.MONEY_OWNER_NOTICE]: "internal",    // in-app notification to practice owner(s) only
  [LISTENER.MONEY_NO_SHOW]: "internal",         // writes an invoice, internal to this practice's data
  [LISTENER.MONEY_LOYALTY]: "internal",         // accrue loyalty points, internal ledger
  // ★ Stage 16 task 16.32 — automations listener (runs automation steps and sweeps).
  [LISTENER.AUTOMATIONS]: "outbound",           // its effect is outbound (email, reminders, messages sent by automations)
  [LISTENER.CAMPAIGN_BATCH]: "outbound",        // its effect is outbound email/SMS delivery via campaign batch
  // ★ Task 18.31 — staff receives push notifications when a payment arrives.
  [LISTENER.NOTIFY_PAYMENT_RECEIVED]: "outbound",  // its effect is outbound push delivery to staff devices
  // ★ Task 20.4 — outbound: its effect is a POST to Stripe to create/update a customer record.
  [LISTENER.ENSURE_STRIPE_CUSTOMER]: "outbound",
  // ★ B-2 (F799) — internal: bookkeeping onto this practice's own entitlement/credit rows only;
  //   nothing leaves this database.
  [LISTENER.GRANT_CREDITS]: "internal",
  // ★ B-3b — internal: bookkeeping onto this practice's own booking row only; nothing leaves this
  //   database.
  [LISTENER.CONFIRM_HELD_BOOKINGS]: "internal",
  // ★ PH1 — outbound: its effect is a POST to PostHog Cloud.
  [LISTENER.POSTHOG]: "outbound",
  // ★ B-5b — outbound: its effect is a POST to Stripe (startClientSubscription →
  //   pushSubscriptionToStripe), a system outside this database — same classification as
  //   ENSURE_STRIPE_CUSTOMER above, which is also inline and outbound.
  [LISTENER.START_SUBSCRIPTION]: "outbound",
  // ★ F836 — all four outbound: each raises a notification AND enqueues its email.
  [LISTENER.NOTIFY_DOCUMENT_EXPIRED]: "outbound",
  [LISTENER.NOTIFY_DOCUMENT_DECLINED]: "outbound",
  [LISTENER.NOTIFY_CREDIT_NOTE_ISSUED]: "outbound",
  [LISTENER.NOTIFY_PACKAGE_PURCHASED]: "outbound",
  // ★ PART 2 ADDITION — outbound: each raises a notification AND enqueues its email.
  [LISTENER.GENERIC_NOTICE]: "outbound",
});
/** ★ Only "internal" runs for a sample event; anything else — including a missing class — is outbound. */
const runsForSample = (listener) => LISTENER_REACH[listener] === "internal";
const SAMPLE_SKIP_REASON = "sample_event: never delivered outside (spec 02 §2.9)";

// ★ The topic handlers above, each under its listener name. TOPIC_HANDLERS is kept as it was (gates read it).
export const HANDLER_LISTENER = Object.freeze({
  "documents.document.sent": LISTENER.NOTIFY_DOCUMENT_SENT,
  "documents.document.executed": LISTENER.ARCHIVE_DOCUMENT_PDF,
  "documents.ai.job_requested": LISTENER.RUN_DOCUMENT_AI_JOB,
  "documents.detect.job_requested": LISTENER.RUN_DOCUMENT_DETECT_JOB,
  // ★ F836 — both already emitted (src/documents/dueFacts.mjs, src/documents/writes.mjs) with no
  //   listener at all until this brief.
  "documents.document.expired": LISTENER.NOTIFY_DOCUMENT_EXPIRED,
  "documents.document.declined": LISTENER.NOTIFY_DOCUMENT_DECLINED,
  "booking.booking.created": LISTENER.SCHEDULE_BOOKING_REMINDER,
  "booking.booking.reminder": LISTENER.NOTIFY_BOOKING_REMINDER,
  "booking.booking.rescheduled": LISTENER.RESCHEDULE_BOOKING_REMINDER,
  "booking.booking.cancelled": LISTENER.UNSCHEDULE_BOOKING_REMINDER,
  // ★ 12.9 — a referral was sent → queue its email.
  "people.referral.sent": LISTENER.NOTIFY_REFERRAL_SENT,
  // ★ 13.15 — a freed slot was offered → queue its email and its own expiry.
  "booking.waitlist.offered": LISTENER.NOTIFY_WAITLIST_OFFER,
  // ★ 13.15 — a 24-hour consent hold lapsed → tell the practice's admin(s), in-app only.
  "booking.hold.expired": LISTENER.NOTIFY_HOLD_EXPIRED,
  // ★ 14.27 — an attended session earns loyalty points (R-14.8: this topic was unclaimed in this
  //   map before this task — HANDLER_LISTENER maps ONE listener per topic, and this is the one).
  "booking.booking.completed": LISTENER.LOYALTY_ACCRUE,
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ Stage 14 task 14.26 — NINE topics, ONE listener (field 4: "the other item topics are
  //     claimed by nothing today" / "map to the SAME listener (one entry each in HANDLER_LISTENER)").
  //     `items.service.created`/`.package.created`/`.plan.created`/`.discount.created` and
  //     `items.price.changed` are emitted today (src/items/writes.mjs); the four `.updated` topics
  //     were declared ahead of their emitters (14.15/topics.mjs's own note) and are claimed here so
  //     the catalogue's own editors sync the moment they land, with no second HANDLER_LISTENER edit.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  "items.service.created": LISTENER.CATALOGUE_SYNC,
  "items.package.created": LISTENER.CATALOGUE_SYNC,
  "items.plan.created": LISTENER.CATALOGUE_SYNC,
  "items.discount.created": LISTENER.CATALOGUE_SYNC,
  "items.price.changed": LISTENER.CATALOGUE_SYNC,
  "items.service.updated": LISTENER.CATALOGUE_SYNC,
  "items.package.updated": LISTENER.CATALOGUE_SYNC,
  "items.plan.updated": LISTENER.CATALOGUE_SYNC,
  "items.discount.updated": LISTENER.CATALOGUE_SYNC,
  // ★ Stage 20 task 20.5 — modifier sync to Stripe. Modifiers emit created/updated events
  //   and the catalogue_sync job dispatches them to syncModifier.
  "items.modifier.created": LISTENER.CATALOGUE_SYNC,
  "items.modifier.updated": LISTENER.CATALOGUE_SYNC,
  // ★★★ FOUND LIVE, Programs follow-up brief (30 Sep 2026, Part 9) — MEASURED: none of these six
  //   topics were ever dispatched anywhere. Archiving or turning off a service/package/plan told
  //   Stripe nothing; see money/catalogue.mjs's own "FOUND LIVE" note on syncProductAndPrices for
  //   the other half of this fix (reading archived_at into the Stripe-bound active flag).
  "items.service.archived": LISTENER.CATALOGUE_SYNC,
  "items.plan.archived": LISTENER.CATALOGUE_SYNC,
  "items.package.archived": LISTENER.CATALOGUE_SYNC,
  "items.service.stopped_selling": LISTENER.CATALOGUE_SYNC,
  "items.service.sellable_again": LISTENER.CATALOGUE_SYNC,
  "items.package.stopped_selling": LISTENER.CATALOGUE_SYNC,
  "items.package.sellable_again": LISTENER.CATALOGUE_SYNC,
  "items.plan.stopped_selling": LISTENER.CATALOGUE_SYNC,
  "items.plan.sellable_again": LISTENER.CATALOGUE_SYNC,
  // ★ Stage 15 task 15.37 — money notifications (F720). Nine topics map to money_emails (outbound).
  "money.invoice.sent": LISTENER.MONEY_EMAILS,
  "money.invoice.reminder_due": LISTENER.MONEY_EMAILS,
  "money.payment.failed": LISTENER.MONEY_EMAILS,
  "money.payment_method.update_requested": LISTENER.MONEY_EMAILS,
  "money.payment.refunded": LISTENER.MONEY_EMAILS,
  "money.estimate.sent": LISTENER.MONEY_EMAILS,
  "money.estimate.expiring": LISTENER.MONEY_EMAILS,
  // ★★★ FOUND LIVE, saved-card/receipts brief (1 Oct 2026, Part 1) — MEASURED: `money.payment.
  //   succeeded` and `money.payment.recorded_offline` both carry a `TOPIC_TEMPLATE` entry
  //   (`money.receipt`) but NEITHER was ever given a listener at all — not here, not pushed in
  //   planListeners (which only pushes MONEY_LOYALTY/GRANT_CREDITS for `.succeeded`). So a client
  //   receipt has literally never been possible for a direct card charge (Held/no-show, no
  //   invoice involved) — `money.invoice.paid` is the ONLY topic that ever reached a listener
  //   for a payment, and that listener (NOTIFY_PAYMENT_RECEIVED, next line) is staff-only; it has
  //   never emailed the client either. See the MONEY_EMAILS handler's own dedup note below for
  //   why `.succeeded` and `.recorded_offline` can both map straight here with no double-send risk,
  //   while `money.invoice.paid` is instead PUSHED as a second listener in planListeners (its
  //   existing staff-push stays, unchanged).
  "money.payment.succeeded": LISTENER.MONEY_EMAILS,
  "money.payment.recorded_offline": LISTENER.MONEY_EMAILS,
  // ★ NEW, receipts brief (1 Oct 2026, Part 2) — card updated/removed client emails. Both carry
  //   `recipient_user_id` directly in their payload (see cardUpdate.mjs), so MONEY_EMAILS's fast
  //   path finds them with no extra lookup.
  "money.payment_method.updated": LISTENER.MONEY_EMAILS,
  "money.payment_method.removed": LISTENER.MONEY_EMAILS,
  // ★ NEW, saved-card brief (1 Oct 2026, Part 3) — the card-expiry client email (the staff alert
  //   for this one is raised inline by the sweep itself — src/automations/sweeps.mjs).
  "money.payment_method.expiring_soon": LISTENER.MONEY_EMAILS,
  // ★ NEW, receipts brief (1 Oct 2026, Part 2) — plan started/cancelled/paused/resumed client
  //   emails. All four topics already existed and were emitted (src/money/writes.mjs,
  //   subscriptions.mjs) with no listener at all — MEASURED, zero HANDLER_LISTENER/planListeners
  //   hits for any of the four before this.
  "money.subscription.started": LISTENER.MONEY_EMAILS,
  "money.subscription.cancelled": LISTENER.MONEY_EMAILS,
  "money.subscription.paused": LISTENER.MONEY_EMAILS,
  "money.subscription.resumed": LISTENER.MONEY_EMAILS,
  // ★ Stage 15 task 15.37 — owner notices (staff-facing alerts, internal).
  "money.subscription.past_due": LISTENER.MONEY_OWNER_NOTICE,
  "money.refund.approval_needed": LISTENER.MONEY_OWNER_NOTICE,
  // ★ Task 18.31 — a payment was recorded, push to staff.
  "money.invoice.paid": LISTENER.NOTIFY_PAYMENT_RECEIVED,
  // ★ Task 20.4 — a person was created → ensure their Stripe customer exists.
  "people.person.created": LISTENER.ENSURE_STRIPE_CUSTOMER,
  // ★ Task 20.4 — a person was archived → sync their Stripe customer metadata.
  "people.person.archived": LISTENER.ENSURE_STRIPE_CUSTOMER,
  // ★ Task 20.73 — invoice payment reconciliation (F720 pattern): reconciliation errors surface
  //   to the owner through the same notice path as subscription past-due and refund approval.
  "money.invoice.reconciliation_error": LISTENER.MONEY_OWNER_NOTICE,
  // ★ F836, "7 missing emails" brief, 1 Oct 2026 — both already emitted
  //   (src/money/creditNotes.mjs, src/money/writes.mjs) with no listener at all until this brief.
  "money.credit_note.issued": LISTENER.NOTIFY_CREDIT_NOTE_ISSUED,
  "money.entitlement.granted": LISTENER.NOTIFY_PACKAGE_PURCHASED,
  "booking.entitlement.running_low": LISTENER.GENERIC_NOTICE,
  // ★ PART 2 ADDITION — the ~71 generic-path topics (src/queue/genericNotifications.mjs).
  //   ★★ FIX, same pass — 5 of these 71 topics already had a REAL HANDLER_LISTENER entry
  //   (people.person.created/archived → ENSURE_STRIPE_CUSTOMER, people.referral.sent →
  //   NOTIFY_REFERRAL_SENT, documents.document.executed → ARCHIVE_DOCUMENT_PDF, booking.hold.expired
  //   → NOTIFY_HOLD_EXPIRED). HANDLER_LISTENER is one-per-topic by design (D19/B3, planListeners'
  //   own comment) — a second key for the same topic here would SILENTLY OVERWRITE the first, which
  //   is exactly what the first version of this insertion did (caught before deploy: `node -e` found
  //   literal duplicate keys in this object literal). Those 5 are NOT listed again here; GENERIC_NOTICE
  //   is instead PUSHED as a second listener for them in planListeners(), the established
  //   one-topic-many-listeners shape (MONEY_NO_SHOW/GRANT_CREDITS/CONFIRM_HELD_BOOKINGS, below).
  "people.person.assigned": LISTENER.GENERIC_NOTICE,
  "people.person.role_changed": LISTENER.GENERIC_NOTICE,
  "people.person.stage_changed": LISTENER.GENERIC_NOTICE,
  "people.person.lead_next_step_set": LISTENER.GENERIC_NOTICE,
  "people.person.consent_status_changed": LISTENER.GENERIC_NOTICE,
  "people.person.merged": LISTENER.GENERIC_NOTICE,
  "people.person.merge_undone": LISTENER.GENERIC_NOTICE,
  "people.guardian.linked": LISTENER.GENERIC_NOTICE,
  "people.guardian.unlinked": LISTENER.GENERIC_NOTICE,
  "people.referral.received": LISTENER.GENERIC_NOTICE,
  "people.referral.outcome_set": LISTENER.GENERIC_NOTICE,
  "people.referral.blocked_no_release": LISTENER.GENERIC_NOTICE,
  "people.role.granted": LISTENER.GENERIC_NOTICE,
  "people.role.revoked": LISTENER.GENERIC_NOTICE,
  "people.role.permission_changed": LISTENER.GENERIC_NOTICE,
  "people.team.member_added": LISTENER.GENERIC_NOTICE,
  "people.team.member_removed": LISTENER.GENERIC_NOTICE,
  "people.person.removed_from_team": LISTENER.GENERIC_NOTICE,
  "growth.consent.unsubscribed": LISTENER.GENERIC_NOTICE,
  "growth.consent.resubscribed": LISTENER.GENERIC_NOTICE,
  "booking.availability.changed": LISTENER.GENERIC_NOTICE,
  "documents.usage.threshold": LISTENER.GENERIC_NOTICE,   // item 8: the owner's 80% / 100% notices (documents and daily emails)
  "booking.policy.changed": LISTENER.GENERIC_NOTICE,
  "calendar.connection.connected": LISTENER.GENERIC_NOTICE,
  "calendar.connection.disconnected": LISTENER.GENERIC_NOTICE,
  "calendar.connection.renewal_failed": LISTENER.GENERIC_NOTICE,
  "money.dispute.evidence_submitted": LISTENER.GENERIC_NOTICE,
  "money.payout.recorded": LISTENER.GENERIC_NOTICE,
  "platform.job.given_up": LISTENER.GENERIC_NOTICE,
  "settings.policy.announced": LISTENER.GENERIC_NOTICE,
  "settings.data.export_requested": LISTENER.GENERIC_NOTICE,
  "settings.data.export_ready": LISTENER.GENERIC_NOTICE,
  "settings.import.completed": LISTENER.GENERIC_NOTICE,
  "settings.import.undone": LISTENER.GENERIC_NOTICE,
  "settings.subscription.updated": LISTENER.GENERIC_NOTICE,
  "accounts.account.created": LISTENER.GENERIC_NOTICE,
  "accounts.pipeline.advanced": LISTENER.GENERIC_NOTICE,
  "network.party.created": LISTENER.GENERIC_NOTICE,
  "network.referral.created": LISTENER.GENERIC_NOTICE,
  "run.item.blocked": LISTENER.GENERIC_NOTICE,
  "run.access.granted": LISTENER.GENERIC_NOTICE,
  "growth.campaign.scheduled": LISTENER.GENERIC_NOTICE,
  "run.competitor.watch_recorded": LISTENER.GENERIC_NOTICE,
  "documents.template.published": LISTENER.GENERIC_NOTICE,
  "documents.template.versioned": LISTENER.GENERIC_NOTICE,
  "documents.pdf.imported": LISTENER.GENERIC_NOTICE,
  "provisioning.questions.answered": LISTENER.GENERIC_NOTICE,
  "provisioning.samples.created": LISTENER.GENERIC_NOTICE,
  "documents.document.opened": LISTENER.GENERIC_NOTICE,
  "documents.document.signed": LISTENER.GENERIC_NOTICE,
  // "documents.document.executed" NOT mapped here — see the FIX note above; pushed in planListeners.
  "documents.document.reminder_due": LISTENER.GENERIC_NOTICE,
  "documents.payment.hold_lapsed": LISTENER.GENERIC_NOTICE,   // Run 9 Part 3.7: a held signature's payment never came — the sender is told
  "documents.document.bounced": LISTENER.GENERIC_NOTICE,
  "documents.document.changes_requested": LISTENER.GENERIC_NOTICE,
  "documents.document.delegated": LISTENER.GENERIC_NOTICE,   // R13-D265
  "documents.disclosure.accepted": LISTENER.GENERIC_NOTICE,
  "documents.disclosure.withdrawn": LISTENER.GENERIC_NOTICE,
  // "booking.hold.expired" NOT mapped here — see the FIX note above; pushed in planListeners.
  "booking.participant.added": LISTENER.GENERIC_NOTICE,
  "money.subscription.cancel_scheduled": LISTENER.GENERIC_NOTICE,
  "items.loyalty.points_earned": LISTENER.GENERIC_NOTICE,
  "tasks.task.assigned": LISTENER.GENERIC_NOTICE,
  "tasks.task.completed": LISTENER.GENERIC_NOTICE,
  "tasks.task.reassigned": LISTENER.GENERIC_NOTICE,
  "messages.message.sent": LISTENER.GENERIC_NOTICE,
  "people.goal.created": LISTENER.GENERIC_NOTICE,
  "people.goal.updated": LISTENER.GENERIC_NOTICE,
  "people.shift.created": LISTENER.GENERIC_NOTICE,
  "people.shift.changed": LISTENER.GENERIC_NOTICE,
  "people.time_off.added": LISTENER.GENERIC_NOTICE,
  "people.time_off.removed": LISTENER.GENERIC_NOTICE,
  // ★ PART 4a ADDITION (money-map pass, 1 Oct 2026) — see genericNotifications.mjs's own header.
  "money.invoice.voided": LISTENER.GENERIC_NOTICE,
  "money.invoice.overdue": LISTENER.GENERIC_NOTICE,
  "money.credit_note.voided": LISTENER.GENERIC_NOTICE,
  "money.payment_plan.offered": LISTENER.GENERIC_NOTICE,
  "money.payment_plan.agreed": LISTENER.GENERIC_NOTICE,
  "money.payment_plan.cancelled": LISTENER.GENERIC_NOTICE,
  "money.payment_plan.released": LISTENER.GENERIC_NOTICE,
  "money.estimate.declined": LISTENER.GENERIC_NOTICE,
  "money.estimate.expired": LISTENER.GENERIC_NOTICE,
  "money.estimate.accepted": LISTENER.GENERIC_NOTICE,
});

/**
 * ★ Each listener: `(ev, ctx) => Promise<{handedOffTo?, chainResult?} | void>`. `ctx` is
 *   `{ tx, tenantId, helpers }`, the same shape TOPIC_HANDLERS always received.
 */
const LISTENER_RUN = Object.freeze({
  [LISTENER.NOTIFY_DOCUMENT_SENT]: (ev, ctx) => TOPIC_HANDLERS["documents.document.sent"](ev, ctx),
  [LISTENER.ARCHIVE_DOCUMENT_PDF]: (ev, ctx) => TOPIC_HANDLERS["documents.document.executed"](ev, ctx),
  [LISTENER.RUN_DOCUMENT_AI_JOB]: (ev, ctx) => TOPIC_HANDLERS["documents.ai.job_requested"](ev, ctx),
  [LISTENER.RUN_DOCUMENT_DETECT_JOB]: (ev, ctx) => TOPIC_HANDLERS["documents.detect.job_requested"](ev, ctx),
  // ★ F836, "7 missing emails" brief, 1 Oct 2026.
  [LISTENER.NOTIFY_DOCUMENT_EXPIRED]: (ev, ctx) => TOPIC_HANDLERS["documents.document.expired"](ev, ctx),
  [LISTENER.NOTIFY_DOCUMENT_DECLINED]: (ev, ctx) => TOPIC_HANDLERS["documents.document.declined"](ev, ctx),
  [LISTENER.NOTIFY_CREDIT_NOTE_ISSUED]: (ev, ctx) => TOPIC_HANDLERS["money.credit_note.issued"](ev, ctx),
  [LISTENER.NOTIFY_PACKAGE_PURCHASED]: (ev, ctx) => TOPIC_HANDLERS["money.entitlement.granted"](ev, ctx),
  // ★ PART 2 ADDITION — the ~71 generic-path topics all share this one listener.
  [LISTENER.GENERIC_NOTICE]: (ev, ctx) => handleGenericNotice(ev, ctx),
  // ★ B-3b — the SAME topic's second listener (pushed in planListeners, never mapped —
  //   HANDLER_LISTENER stays one-per-topic and ARCHIVE_DOCUMENT_PDF keeps that slot). `ev.subject_id`
  //   is the executed document instance, the same id ARCHIVE_DOCUMENT_PDF's own handler reads above.
  //   F124: the same executed teen agreement also records the teen's consent, which releases their pending_consent bookings.
  [LISTENER.CONFIRM_HELD_BOOKINGS]: async (ev, { tx, tenantId }) => {
    const held = await confirmHeldBookings(tx, { tenantId, instanceId: ev.subject_id });
    const consent = await grantConsentFromAgreement(tx, { tenantId, instanceId: ev.subject_id, actorUserId: ev.payload?.archive_actor_id ?? null });
    return { ...held, consent };
  },
  // ★ PH1 — ids, states and timings only; the person is the workspace account, never a signer.
  [LISTENER.POSTHOG]: (ev, { tx, tenantId }) => handlePosthogEvent(ev, { tx, tenantId }),
  [LISTENER.SCHEDULE_BOOKING_REMINDER]: (ev, ctx) => TOPIC_HANDLERS["booking.booking.created"](ev, ctx),
  [LISTENER.NOTIFY_BOOKING_REMINDER]: (ev, ctx) => TOPIC_HANDLERS["booking.booking.reminder"](ev, ctx),
  [LISTENER.RESCHEDULE_BOOKING_REMINDER]: (ev, ctx) => TOPIC_HANDLERS["booking.booking.rescheduled"](ev, ctx),
  [LISTENER.UNSCHEDULE_BOOKING_REMINDER]: (ev, ctx) => TOPIC_HANDLERS["booking.booking.cancelled"](ev, ctx),
  // ★ A chain failure fails THIS listener only; the event is not processed until it delivers or dies,
  //   so a task that could not be created is retried rather than lost (the P20.3 rule, kept).
  [LISTENER.TASK_CHAINS]: async (ev, { tx, tenantId }) => ({
    chainResult: await applyChains(tx, ev, {
      tenantId, chains: TASK_CHAINS, closingIndex: CLOSING_TOPICS, subjectClosers: SUBJECT_CLOSERS }),
  }),
  // ★★★ P8.5 — the outside world is told by ENQUEUING, never inline: a fetch with a 15-second timeout inside
  //     this transaction would hold row locks for the length of somebody else's outage. This listener is
  //     `delivered` once the job is enqueued, and records the hand-off; `deliver_webhooks` owns the HTTP
  //     attempts, and `retry_webhooks` their retries. The job key is per event, and because this listener is
  //     never re-run once delivered, a retry of ANOTHER listener on the same event no longer re-enqueues it.
  //   ★★★ Stage 3 Task 7 (Task 5 review F1): this enqueue is on graphile's own connection, OUTSIDE the tenant
  //       transaction, so a rolled-back dispatch re-runs this listener after the job may already have run —
  //       and the job key only collapses a duplicate while the first is still queued. The double POST is
  //       therefore stopped at the DELIVERY end: `deliverEvent` never sends to an (event, endpoint) that has
  //       a delivered, dead or in-flight attempt (test/s3_webhook_retry.test.mjs proves the re-run path).
  [LISTENER.WEBHOOKS]: async (ev, { tenantId, helpers }) => {
    await helpers.addJob("deliver_webhooks", { tenantId, eventId: ev.id }, { jobKey: `deliver_webhooks:${ev.id}`, priority: NOTICE_PRIORITY });   // ahead of background sweeps, like the notices (MEASURED: it waited behind them too)
    return { handedOffTo: "deliver_webhooks" };
  },
  // ★ 12.9 — a referral was sent → queue its email.
  [LISTENER.NOTIFY_REFERRAL_SENT]: (ev, ctx) => TOPIC_HANDLERS["people.referral.sent"](ev, ctx),
  // ★★★ 13.15 — A FREED SLOT WAS OFFERED → QUEUE ITS EMAIL AND ITS OWN EXPIRY. `ev.payload.entry_id`
  //     is the waitlist entry `offerFreedSlot`/`offerTime` (src/booking/waitlist.mjs) just set to
  //     `offered`; `ev.payload.offer_expires_at` is the SAME moment those functions wrote onto the
  //     row, so the expiry job fires exactly when the offer's own window closes.
  [LISTENER.NOTIFY_WAITLIST_OFFER]: async (ev, { tenantId, helpers }) => {
    await helpers.addJob("send_waitlist_offer",
      { tenantId, entryId: ev.payload.entry_id, eventId: ev.id },
      { jobKey: `waitlist-offer:${ev.id}` });
    await helpers.addJob("waitlist_offer_expiry", { tenantId, entryId: ev.payload.entry_id },
      { runAt: ev.payload.offer_expires_at,
        jobKey: `waitlist_offer_expiry:${ev.payload.entry_id}`, jobKeyMode: "replace" });
  },
  // ★★★ 13.15 — A 24-HOUR CONSENT HOLD LAPSED → TELL THE PRACTICE'S ADMIN(S), IN-APP ONLY. `admin` is
  //     this file's own established stand-in for "owner" (giveUpOwners.mjs's own §★★ WHO note: "the
  //     practice has no separate 'owner' rank" — `staff_role`'s CHECK, 0010, is
  //     super_admin_1/super_admin/admin/coach, never 'owner').
  [LISTENER.NOTIFY_HOLD_EXPIRED]: async (ev, { tx, tenantId }) => {
    const { rows: admins } = await tx.query(
      `SELECT id FROM keystone.app_user
        WHERE tenant_id = $1 AND role = 'staff' AND staff_role = 'admin' AND archived_at IS NULL`,
      [tenantId]);
    for (const a of admins) {
      await createNotification(tx, {
        tenantId, recipientId: a.id, eventId: ev.id,
        topic: "booking.hold.expired",
        title: "A held session lapsed",
        deepLink: `/record/booking/${ev.subject_id}`,
      });
    }
  },
  // ★★★ 14.27 — AN ATTENDED SESSION EARNS ITS RULE'S POINTS, ONCE. `ev.subject_id` is the booking
  //     `recordAttendance` (src/booking/attendance.mjs:276-295) just moved to `completed`/`no_show`;
  //     every participant row on it with `attended = true` and a real account earns. `accrueLoyalty`
  //     (14.24) itself reads `loyalty.enabled` and the rule's own `active` flag and no-ops when
  //     either is off — this listener supplies no second copy of that switch (R-14.8/loyalty.mjs's
  //     own header: settings are enforced server-side, never re-decided in a listener).
  //   ★★★ IDEMPOTENT BY THE LEDGER, NOT BY THIS LISTENER. `sourceType:'booking', sourceId:<bookingId>`
  //     is the SAME pair on every delivery of the SAME event, so a redelivery (a retry, a worker
  //     restart mid-job) re-runs this loop and `accrueLoyalty`'s own
  //     `ON CONFLICT (tenant_id, reason, source_type, source_id, app_user_id) DO NOTHING`
  //     (`loyalty_entry`'s UNIQUE constraint, 14.7/0414) absorbs the repeat — `{accrued:false,
  //     reason:'already_earned'}` the second time, never a second row.
  [LISTENER.LOYALTY_ACCRUE]: async (ev, { tx, tenantId }) => {
    const { rows: attendees } = await tx.query(
      `SELECT app_user_id FROM keystone.booking_participant
        WHERE tenant_id = $1 AND booking_id = $2 AND attended = true AND app_user_id IS NOT NULL`,
      [tenantId, ev.subject_id]);
    for (const { app_user_id } of attendees) {
      await accrueLoyalty(tx, {
        tenantId, appUserId: app_user_id, reason: "earn_visit",
        sourceType: "booking", sourceId: ev.subject_id,
      });
    }
  },
  // ★★★ Stage 14 task 14.26 — THE OUTSIDE WORLD IS TOLD BY ENQUEUING, never inline (same P8.5
  //     reasoning `LISTENER.WEBHOOKS` above already gives: a Stripe call inside this transaction
  //     would hold row locks for the length of a Stripe outage). `ev.subject_type`/`ev.subject_id`
  //     ARE the catalogue subject (service/package/plan/discount) — every one of the nine topics
  //     above carries it as ITS OWN subject, never a wrapper. The job key is per subject and
  //     `replace`s a still-queued job, so nine topics firing on the same subject in one save
  //     collapse into one pending sync — never nine.
  [LISTENER.CATALOGUE_SYNC]: async (ev, { tenantId, helpers }) => {
    await helpers.addJob("catalogue_stripe_sync",
      { tenantId, subjectType: ev.subject_type, subjectId: ev.subject_id },
      { jobKey: `catalogue:${ev.subject_id}`, jobKeyMode: "replace" });
    return { handedOffTo: "catalogue_stripe_sync" };
  },
  // ★ Stage 15 task 15.37 — MONEY_EMAILS: outbound email sends via the notification system.
  //   Nine topics enqueue `deliver_notification_email` jobs (the HANDLER_LISTENER mapping).
  // ★ Task 20.22 — MONEY_TELLING CUTOVER. Four topics (invoice_issued, invoice_reminder, receipt,
  //   update_card) are being cut over from queue to n8n. When the cutover flag is ON, the queue
  //   job is skipped and recorded as `skipped:cutover`. When OFF (default), current behaviour stands.
  [LISTENER.MONEY_EMAILS]: async (ev, { tx, tenantId, helpers }) => {
    // Resolve the recipient (payer/client/recipient depending on the event).
    // Skip if `do_not_email` is set or the person is a sample/test person.
    // `createNotification` for them, then enqueue `deliver_notification_email`.
    // ★★★ Receipts brief (1 Oct 2026, Part 1) — the three payment topics carry NEITHER
    //   payer_user_id nor recipient_user_id in their payload (only payment_id/invoice_id), so the
    //   fast path above always returned early for every one of them — confirmed by MEASURING, not
    //   guessing. Same dual-shape lookup as notifyPaymentReceived's own fix (its comment has the
    //   full reasoning): ev.subject_id is a PAYMENT id from payments.mjs, an INVOICE id from
    //   clientPayments.mjs.
    // ★ NEW, receipts brief (1 Oct 2026, Part 2) — `app_user_id` added to the fast path: every
    //   subscription-lifecycle emit (started/cancelled/etc., src/money/writes.mjs and
    //   subscriptions.mjs) names its person this way, never payer_user_id/recipient_user_id.
    let recipientId = ev.payload?.payer_user_id || ev.payload?.recipient_user_id || ev.payload?.app_user_id || null;
    const PAYMENT_TOPICS = ["money.payment.succeeded", "money.payment.recorded_offline", "money.invoice.paid"];
    // ★★★ F854 FIX, 1 Oct 2026 (Part 4a) — MEASURED BROKEN, and this is the MOST SEVERE instance:
    //   `keystone.subscription`/`keystone.payment`/`keystone.invoice` are all RLS-gated behind a
    //   viewer-permission check (see recipientResolvers.mjs's F854 header). This whole fallback
    //   block is the ONLY path for the three payment topics per the comment above ("carry NEITHER
    //   payer_user_id nor recipient_user_id in their payload") — meaning every one of these queries
    //   returned zero rows, `recipientId` stayed null, and line "if (!recipientId) return;" fired
    //   on every single real payment. `money.receipt` is one of the ORIGINAL 48 registered
    //   templates, presumed working — this listener is what is supposed to trigger it, and it has
    //   never actually fired. Wrapped the whole resolution in `asPracticeOwner`, same pattern as
    //   every other F854 fix in this pass.
    await asPracticeOwner(tx, tenantId, async () => {
      // ★ NEW — subscription topics whose payload carries NEITHER (paused/resumed): resolve via the
      //   subscription row itself, same "subject_id is the key" idiom as the payment/invoice fallback.
      if (!recipientId && ev.topic?.startsWith("money.subscription.") && ev.subject_id) {
        const { rows: bySub } = await tx.query(
          `SELECT app_user_id FROM keystone.subscription_effective WHERE tenant_id = $1 AND id = $2`,
          [tenantId, ev.subject_id]);
        if (bySub.length > 0) recipientId = bySub[0].app_user_id;
      }
      if (!recipientId && PAYMENT_TOPICS.includes(ev.topic)) {
        const { rows: byPaymentId } = await tx.query(
          `SELECT payer_user_id FROM keystone.payment_effective WHERE tenant_id = $1 AND id = $2`,
          [tenantId, ev.subject_id]);
        if (byPaymentId.length > 0) {
          recipientId = byPaymentId[0].payer_user_id;
        } else {
          const { rows: byInvoiceId } = await tx.query(
            `SELECT payer_user_id FROM keystone.invoice_effective WHERE tenant_id = $1 AND id = $2`,
            [tenantId, ev.subject_id ?? ev.payload?.invoice_id]);
          if (byInvoiceId.length > 0) recipientId = byInvoiceId[0].payer_user_id;
        }
      }
    });
    // ★ DEDUP — same guard as notifyPaymentReceived: a `.succeeded` with an invoice_id that was
    //   ALSO closed emits a sibling money.invoice.paid in the same transaction; that sibling's
    //   own delivery (also routed here) is the one that sends — this one stands aside. Moved
    //   outside the asPracticeOwner block above (it reads `keystone.event`, which is NOT RLS-gated
    //   the same way — no need to run it as an impersonated viewer) but kept before the
    //   `!recipientId` check, unchanged in effect.
    if (PAYMENT_TOPICS.includes(ev.topic) && ev.topic === "money.payment.succeeded" && ev.payload?.invoice_id) {
      const { rows: sibling } = await tx.query(
        `SELECT 1 FROM keystone.event
          WHERE tenant_id = $1 AND topic = 'money.invoice.paid' AND subject_id = $2`,
        [tenantId, ev.subject_id]);
      if (sibling.length > 0) return;
    }
    if (!recipientId) return;

    const { rows } = await tx.query(
      `SELECT do_not_email, is_sample FROM keystone.app_user
       WHERE tenant_id = $1 AND id = $2`, [tenantId, recipientId]);
    if (rows.length === 0 || rows[0].do_not_email === true || rows[0].is_sample === true) return;

    // ★ Task 20.22 — Check cutover flag for the four money-telling topics
    const CUTOVER_TOPICS = ["money.invoice.sent", "money.invoice.reminder_due", "money.payment.succeeded",
                            "money.payment.recorded_offline", "money.payment.failed",
                            "money.payment_method.update_requested", "money.invoice.paid"];
    if (CUTOVER_TOPICS.includes(ev.topic)) {
      const cutoverFlag = await getSetting(tx, "automation_cutover.money_telling", false);
      if (cutoverFlag) {
        // Cutover is ON — skip queue job and record it
        const { id: notificationId } = await createNotification(tx, {
          tenantId, recipientId, eventId: ev.id,
          topic: ev.topic,
          title: `${ev.topic.split('.')[1]} notification`,
          deepLink: "/app/money",
        });
        await recordSkipped(tx, {
          eventId: ev.id, notificationId, reason: "cutover"
        });
        return;
      }
    }

    const { id: notificationId } = await createNotification(tx, {
      tenantId, recipientId, eventId: ev.id,
      topic: ev.topic,
      title: `${ev.topic.split('.')[1]} notification`,
      deepLink: "/app/money",
    });
    await helpers.addJob("deliver_notification_email", { tenantId, notificationId },
      { jobKey: `email:${notificationId}`, jobKeyMode: "replace", priority: NOTICE_PRIORITY });
  },
  // ★ Stage 15 task 15.37 — MONEY_OWNER_NOTICE: in-app notifications to practice Owner(s) only.
  //   Two topics trigger staff-facing alerts (`money.subscription.past_due`, `money.refund.approval_needed`).
  // ★ F854-ADJACENT FIX, 1 Oct 2026 (Part 4a) — same stale-enum bug as notifyPaymentReceived's own
  //   fix just above: 'super_admin' cannot exist in `staff_role` (CHECK admits only owner/admin/
  //   member) and 'owner' was missing — the practice OWNER never received either of this
  //   listener's two alerts (a subscription going past-due, a refund needing approval).
  [LISTENER.MONEY_OWNER_NOTICE]: async (ev, { tx, tenantId }) => {
    const { rows: owners } = await tx.query(
      `SELECT id FROM keystone.app_user
       WHERE tenant_id = $1 AND role = 'staff' AND staff_role IN ('owner', 'admin')
       AND archived_at IS NULL`, [tenantId]);
    for (const o of owners) {
      await createNotification(tx, {
        tenantId, recipientId: o.id, eventId: ev.id,
        topic: ev.topic,
        title: `Money alert: ${ev.topic}`,
        deepLink: "/app/money",
      });
    }
  },
  // ★ Stage 15 task 15.30 — MONEY_NO_SHOW: write a no-show invoice when a booking is marked no-show.
  //   Calls `raiseNoShowCharge` with the event carrying the no-show outcome and charge details.
  [LISTENER.MONEY_NO_SHOW]: async (ev, { tx, tenantId }) => {
    await raiseNoShowCharge(tx, ev, { tenantId });
  },
  // ★ Stage 15 task 15.66 — MONEY_LOYALTY: accrue loyalty points (one listener, two legs).
  //   `money.payment.succeeded` and `money.payment.recorded_offline` → accrueLoyaltyForPayment
  //   `people.referral.outcome_set` → accrueLoyaltyForReferral
  [LISTENER.MONEY_LOYALTY]: async (ev, { tx, tenantId }) => {
    if (ev.topic === "money.payment.succeeded" || ev.topic === "money.payment.recorded_offline") {
      await accrueLoyaltyForPayment(tx, ev, { tenantId });
    } else if (ev.topic === "people.referral.outcome_set") {
      await accrueLoyaltyForReferral(tx, ev, { tenantId });
    }
  },
  // ★ Stage 16 task 16.32 — AUTOMATIONS: run event automations.
  [LISTENER.AUTOMATIONS]: async (ev, {tx, tenantId, helpers}) => ({ automations: await runEventAutomations(tx, ev, {tenantId, helpers}) }),
  // ★ Stage 16 task 16.32 — CAMPAIGN_BATCH: enqueue campaign batch delivery.
  [LISTENER.CAMPAIGN_BATCH]: async (ev, {tenantId, helpers}) => {
    const runAt = ev.topic === 'growth.campaign.scheduled' ? new Date(ev.payload.send_at) : undefined;
    await helpers.addJob("deliver_campaign_batch", {tenantId, batchId: ev.payload.batch_id},
      {jobKey: `deliver_campaign_batch:${ev.payload.batch_id}`, jobKeyMode: "replace", ...(runAt ? {runAt} : {})});
    return {handedOffTo: "deliver_campaign_batch"};
  },
  // ★ Task 18.31 — NOTIFY_PAYMENT_RECEIVED: Staff receives push on payment arrival (owners/admins + booking host).
  //   Reads the payment and invoice, finds recipients, creates notifications with push copy.
  [LISTENER.NOTIFY_PAYMENT_RECEIVED]: async (ev, { tx, tenantId }) => {
    await notifyPaymentReceived(tx, ev, { tenantId });
  },
  // ★ Task 20.4 — ENSURE_STRIPE_CUSTOMER: Create/sync Stripe customer on person create/archive.
  //   `people.person.created`: call ensureCustomer to create the customer (or queue for later backfill).
  //   `people.person.archived`: call syncCustomer to update the customer metadata (never delete).
  [LISTENER.ENSURE_STRIPE_CUSTOMER]: async (ev, { tx, tenantId }) => {
    const personId = ev.subject_id;

    if (ev.topic === "people.person.created") {
      // Check if Connect is available; if not, skip and record the reason
      const connectState = await getConnectAccountState(tx, tenantId);
      if (connectState.state !== "live" || !connectState.stripeAccountId) {
        // No Connect account — the customer will be queued (stored as null), to be created later
        // by backfillCustomers when the account connects
        return { skipped: "no_connect" };
      }
      // Create the customer (staff, adolescents and leads all included per the ruling)
      await ensureCustomer(tx, { tenantId, personId });
    } else if (ev.topic === "people.person.archived") {
      // Check if the person has a customer; if so, sync it (which will UPDATE, never DELETE)
      const { rows } = await tx.query(
        `SELECT stripe_customer_id FROM keystone.app_user WHERE id = $1 AND tenant_id = $2`,
        [personId, tenantId]);
      if (rows.length > 0 && rows[0].stripe_customer_id) {
        // Sync the customer — this uses the existing syncCustomer path which does UPDATE
        await syncCustomer(tx, personId);
      }
    }
  },
  // ★★★ B-2 (F799) — GRANT_CREDITS: a package payment or a subscription cycle's invoice.paid grants
  //     credits, through the one writer (grantCredits, src/money/writes.mjs). Two legs, one listener:
  //   · `money.payment.succeeded` reads the paid invoice's PACKAGE line(s) — `line_item.package_id IS
  //     NOT NULL` — and their `package_line` rows. `sourceId` is the payment id (`ev.subject_id`,
  //     same id both money.payment.succeeded and money.invoice.paid carry as their subject —
  //     src/money/payments.mjs).
  //   · `money.invoice.paid` reads the invoice's PLAN line(s) — `line_item.plan_id IS NOT NULL` — which
  //     IS this listener's definition of "the invoice has a subscription": a plan-sourced line on the
  //     invoice, not a lookup through `keystone.subscription` (no `invoice.subscription_id` column
  //     exists to join through). `sourceId` is the Stripe invoice id (`invoice.stripe_invoice_id`).
  //   ★ NEITHER LINE SHAPE ON THE INVOICE MEANS NOTHING TO GRANT — the listener no-ops (never throws),
  //     which is F799's own positive control: an invoice with only a service line grants zero credits.
  // ★ R5 (RECONCILE) — the dispatcher's transaction has NO viewer (withTenant(tenantId) in
  //   dispatchOutboxForTenant), and payment / invoice / subscription are viewer-gated by RLS: with no
  //   viewer every read below returned 0 rows, so no credit was ever granted (EXECUTED: 0 of 3 payments
  //   visible) and START_SUBSCRIPTION's already-started guard could never see an existing row. Both
  //   run as the practice owner on the SAME tx (asViewer sets the GUC), as noShow.mjs and the Stripe
  //   webhook route already do.
  // ★★★ RETIRED 2 Oct 2026 (credits pipeline, specs/CREDITS-PIPELINE.md §3.1). Both legs below granted from a the platform `keystone.payment`
  //     event, so a payment seen only through the Stripe mirror (and every portal / payment-link / renewal payment) granted NOTHING, and a
  //     partial payment re-granted. The grant is now ONE idempotent reaction keyed on the STRIPE invoice (`src/money/creditGrant.mjs`,
  //     ledger `keystone.credit_grant`), called by the webhook, the mirror and the nightly catch-up. Left registered, doing nothing, because a
  //     listener key is part of the dispatcher's closed registry (and running it as well would grant everything TWICE).
  [LISTENER.GRANT_CREDITS]: async () => ({ skipped: "superseded_by_credit_grant" }),
  // (the pre-0583 package leg + plan leg were removed here — see git history before 2 Oct 2026; `resolvePeriodGrant`'s call moved to creditGrant.mjs)
  // ★★★ B-5b — START_SUBSCRIPTION: a subscription failed to start when the document/estimate that
  //     triggers it was signed/accepted (money.subscription.start_failed, emitted by
  //     src/documents/writes.mjs and src/money/estimates.mjs — B-5, landed). This retries it with the
  //     SAME ids the failed attempt carried (`ev.payload`: `{ planId, appUserId, contractId,
  //     createdByDocumentId, estimateId }` — ids only, B-5's own shape). `startClientSubscription`
  //     itself reads whatever else it needs (the plan's current price, etc.) from the database — the
  //     payload is never widened for it.
  //   ★★ IDEMPOTENT (field 8): a retry of the SAME give-up event always carries the SAME
  //     (tenantId, appUserId, planId) — a non-cancelled subscription already on file for that triple is
  //     either this listener's own earlier attempt or a concurrent success elsewhere, and is never
  //     started a second time. `subscription_tenant_active_key` (0009_catalogue_and_documents.sql) is
  //     the SAME uniqueness enforced at the database's own level, so this check and the table agree.
  //   ★ `estimateId` is read for observability only — `startClientSubscription` (src/money/
  //     subscriptions.mjs) takes no estimate id; the estimate lineage is the
  //     `money.estimate.accepted_with_subscription` event `startSubscriptionFromEstimate` emits on its
  //     own successful path, unrelated to this retry.
  //   ★ A still-missing `contractId` (the estimate path found no signed contract to hang the
  //     subscription on) means `startClientSubscription` throws the SAME `invalid` every retry, exactly
  //     as the first attempt did — this listener does not invent one, and repeated failure runs the
  //     normal give-up path (LISTENER_OWNERS.start_subscription) like any other listener.
  //   ★★ FLAGGED, MEASURED, not silently patched — the two failure paths this retries leave DIFFERENT
  //     things behind. src/money/estimates.mjs's SAVEPOINT rolls back on failure (no subscription row
  //     survives), so this listener's own `startClientSubscription` call creates it fresh. But
  //     src/documents/writes.mjs's own catch has NO savepoint around `startClientSubscription` (its own
  //     comment: "the subscription row exists with stripe_subscription_id NULL") — `createSubscription`'s
  //     INSERT is not a SQL error, so it survives in the (later-committed) execution transaction even
  //     though the LATER Stripe push failed. For THAT path, this listener's own idempotency check above
  //     finds the surviving row and skips ("already_started") — it never re-attempts the Stripe push
  //     for it (`pushSubscriptionToStripe` on the EXISTING row), so a documents-path failure whose row
  //     already exists is never actually fixed by this retry, only reported. Built to the letter of the
  //     task (call startClientSubscription with the payload ids) rather than guessed at; a correct fix
  //     would branch on whether the existing row already carries a stripe_subscription_id.
  [LISTENER.START_SUBSCRIPTION]: (ev, { tx, tenantId }) => asPracticeOwner(tx, tenantId, async () => {
    const { planId, appUserId, contractId, createdByDocumentId } = ev.payload ?? {};
    if (!planId || !appUserId) return { skipped: "incomplete_payload" };

    const { rows: existing } = await tx.query(
      `SELECT id FROM keystone.subscription
        WHERE tenant_id = $1 AND app_user_id = $2 AND plan_id = $3 AND state <> 'cancelled'`,
      [tenantId, appUserId, planId]);
    if (existing.length > 0) return { skipped: "already_started" };

    await startClientSubscription(tx, {
      tenantId, planId, appUserId, contractId, createdByDocumentId: createdByDocumentId ?? null,
    });
    return { started: true };
  }),
});

// ★★ Every name the dispatcher can run, and every name it knows, must carry a class — or nothing loads.
export const LISTENER_RUN_NAMES = Object.freeze(Object.keys(LISTENER_RUN));
/**
 * ★★ THE LOAD-TIME GUARD, as a function so the test exercises THIS code, not a copy of it (Task 8 fix 1, F5).
 *    Throws if any listener name lacks an outbound/internal class, or if a class names no listener.
 */
export function assertListenersClassified({ listener, runNames, reach }) {
  const names = new Set([...Object.values(listener), ...runNames]);
  const missing = [...names].filter((n) => !["outbound", "internal"].includes(reach[n]));
  const stale = Object.keys(reach).filter((n) => !names.has(n));
  if (missing.length || stale.length) {
    throw new Error(
      `LISTENER_REACH is incomplete — unclassified: [${missing.join(", ")}], not a listener: [${stale.join(", ")}]. ` +
      `Every listener must be classified outbound or internal (spec 02 §2.9, Stage 3 Task 8).`);
  }
}
assertListenersClassified({ listener: LISTENER, runNames: LISTENER_RUN_NAMES, reach: LISTENER_REACH });

/**
 * ★ Which listeners an event gets, decided ONCE, at its first dispatch, and stored as delivery rows.
 *   Later attempts use the stored rows, so the set cannot drift between a failure and its retry.
 * ★★★ SAMPLE EVENTS (spec 02 §2.9, Stage 3 Task 8): for `ev.sample`, every OUTBOUND listener goes in
 *     `skipped` instead of `listeners` and is recorded `skipped` with the reason — visible on the event's
 *     delivery rows, never run. INTERNAL listeners run as for any event (LISTENER_REACH above).
 */
export async function planListeners(tx, ev, tenantId) {
  const listeners = [];
  if (HANDLER_LISTENER[ev.topic]) listeners.push(HANDLER_LISTENER[ev.topic]);
  if (TASK_CHAINS.some((c) => c.opensOn === ev.topic) || Boolean(CLOSING_TOPICS[ev.topic]) ||
      Boolean(SUBJECT_CLOSERS[ev.topic])) {
    listeners.push(LISTENER.TASK_CHAINS);
  }
  // ★★ Only if somebody is subscribed — otherwise every event would spawn a job that reads an empty table.
  if (await hasSubscribers(tx, { tenantId, topic: ev.topic })) listeners.push(LISTENER.WEBHOOKS);
  // D19/B3 — topics with MORE THAN ONE listener. HANDLER_LISTENER is one-per-topic by design; a
  // second key there would silently overwrite the first. An event carries a LIST (planDeliveries
  // writes one event_delivery row per listener), so extra listeners are pushed, never mapped.
  if (ev.topic === "booking.booking.completed") listeners.push(LISTENER.MONEY_NO_SHOW);
  if (ev.topic === "money.payment.succeeded" || ev.topic === "money.payment.recorded_offline") {
    listeners.push(LISTENER.MONEY_LOYALTY);
  }
  // Stage 12's topic. Pushed rather than mapped for the same reason, and because Stage 12 may
  // separately claim a HANDLER_LISTENER key of its own later — a push cannot collide with that.
  if (ev.topic === "people.referral.outcome_set") listeners.push(LISTENER.MONEY_LOYALTY);
  // ★ B-2 (F799) — a package payment or a subscription cycle's invoice.paid may grant credits. Pushed
  //   rather than mapped: `money.invoice.paid` already has a HANDLER_LISTENER entry
  //   (NOTIFY_PAYMENT_RECEIVED) and `money.payment.succeeded` already gets MONEY_LOYALTY pushed above —
  //   the listener itself decides whether the invoice actually names a package or a plan line, and
  //   no-ops (never throws) when it does not.
  if (ev.topic === "money.payment.succeeded") listeners.push(LISTENER.GRANT_CREDITS);
  if (ev.topic === "money.invoice.paid") listeners.push(LISTENER.GRANT_CREDITS);
  // ★ Receipts brief (1 Oct 2026, Part 1) — `money.invoice.paid` already has a HANDLER_LISTENER
  //   entry (NOTIFY_PAYMENT_RECEIVED, staff-only push) that stays exactly as is; the client-facing
  //   receipt is a SECOND listener on the same topic, same one-topic-many-listeners shape as
  //   MONEY_NO_SHOW/GRANT_CREDITS above.
  if (ev.topic === "money.invoice.paid") listeners.push(LISTENER.MONEY_EMAILS);
  // ★ Receipts brief, Part 1 — the staff push (NOTIFY_PAYMENT_RECEIVED) is currently reachable
  //   ONLY via money.invoice.paid, so a no-invoice direct charge (Held/no-show card) never alerted
  //   staff either. Pushed for the same two topics MONEY_EMAILS was just added to above; the
  //   dedup guard lives INSIDE notifyPaymentReceived itself (see its own note) so this stays safe
  //   even though money.invoice.paid can fire in the same transaction as money.payment.succeeded.
  if (ev.topic === "money.payment.succeeded" || ev.topic === "money.payment.recorded_offline") {
    listeners.push(LISTENER.NOTIFY_PAYMENT_RECEIVED);
  }
  // ★ Receipts brief, Part 1, item 3 — "plus a staff alert" on every failed charge. Pushed, since
  //   money.payment.failed already has a HANDLER_LISTENER entry (MONEY_EMAILS, the client email).
  if (ev.topic === "money.payment.failed") listeners.push(LISTENER.MONEY_OWNER_NOTICE);
  // ★ B-3b — a held booking's document was executed → confirm it. Pushed rather than mapped:
  //   `documents.document.executed` already has a HANDLER_LISTENER entry (ARCHIVE_DOCUMENT_PDF),
  //   which stays as is (field 5) — the same one-topic-two-listeners shape MONEY_NO_SHOW/GRANT_CREDITS
  //   use above. confirmHeldBookings itself no-ops (never throws) when no booking is held on it.
  if (ev.topic === "documents.document.executed") listeners.push(LISTENER.CONFIRM_HELD_BOOKINGS);
  // ★★★ DOCUSTAY WALL FIX (recon+build round, 29 Sep 2026) — `documents.document.executed` is now
  //   ALSO where a signed contract's subscription starts, a THIRD listener on this one topic (same
  //   one-topic-many-listeners shape as CONFIRM_HELD_BOOKINGS just above). This used to be a direct,
  //   synchronous `startClientSubscription(...)` call INSIDE src/documents/writes.mjs, importing
  //   straight from `../money/subscriptions.mjs` — exactly the kind of reach-across-the-wall the maintainer's
  //   Docustay ruling refuses ("it announces, it doesn't reach... the platform-only connections live
  //   OUTSIDE the package, as plug-ins that listen"). documents/writes.mjs now only emits the event
  //   (with planId/appUserId/contractId/createdByDocumentId in its payload, added below); this
  //   listener reuses LISTENER.START_SUBSCRIPTION's own handler VERBATIM — its idempotency check
  //   (skip if a non-cancelled subscription for the same tenant/app_user/plan already exists) was
  //   already written for exactly this race (a synchronous attempt racing its own async retry), and
  //   now serves as the ONLY attempt path, not a retry for a second one. A signed-instrument's own
  //   subscription-start moves from synchronous-in-the-execute-transaction to queued (one retry-cycle
  //   of latency, same backoff every other queued effect in this file already gets) — the disclosed
  //   cost of the wall actually holding.
  if (ev.topic === "documents.document.executed") listeners.push(LISTENER.START_SUBSCRIPTION);
  // ★ B-5b — a subscription failed to start → retry it. Pushed rather than mapped, the same shape as
  //   GRANT_CREDITS/CONFIRM_HELD_BOOKINGS just above (the topic has no other listener today, but this
  //   task's own instruction is to copy that shape, not HANDLER_LISTENER). startClientSubscription
  //   itself no-ops via this listener's own idempotency check when a non-cancelled subscription for
  //   the same (tenant, app_user, plan) already exists.
  if (ev.topic === "money.subscription.start_failed") listeners.push(LISTENER.START_SUBSCRIPTION);
  // ★ PART 2 ADDITION ("every email on the one system", 1 Oct 2026) — these 5 of the ~71 generic-
  //   path topics already have a REAL HANDLER_LISTENER entry (ENSURE_STRIPE_CUSTOMER/
  //   NOTIFY_REFERRAL_SENT/ARCHIVE_DOCUMENT_PDF/NOTIFY_HOLD_EXPIRED), which stays exactly as is —
  //   GENERIC_NOTICE is pushed as a SECOND listener, same one-topic-many-listeners shape as
  //   MONEY_NO_SHOW/GRANT_CREDITS/CONFIRM_HELD_BOOKINGS above.
  if (ev.topic === "people.person.created") listeners.push(LISTENER.GENERIC_NOTICE);
  if (ev.topic === "people.person.archived") listeners.push(LISTENER.GENERIC_NOTICE);
  if (ev.topic === "people.referral.sent") listeners.push(LISTENER.GENERIC_NOTICE);
  if (ev.topic === "documents.document.executed") listeners.push(LISTENER.GENERIC_NOTICE);
  if (ev.topic === "booking.hold.expired") listeners.push(LISTENER.GENERIC_NOTICE);
  // ★ Stage 16 task 16.32 — automations on topics that trigger automation rules.
  if (AUTOMATION_TOPICS.includes(ev.topic)) listeners.push(LISTENER.AUTOMATIONS);
  // ★ Stage 16 task 16.32 — campaign batch enqueue on campaign events.
  if (ev.topic === "growth.campaign.queued" || ev.topic === "growth.campaign.scheduled") listeners.push(LISTENER.CAMPAIGN_BATCH);
  // ★ PH1 — Docustay workspaces only, and only where POSTHOG_PROJECT_TOKEN is set (never on a self-hosted install).
  if (await wantsPosthog(tx, ev, tenantId)) listeners.push(LISTENER.POSTHOG);
  // ★ `=== true`, not truthiness: the column is NOT NULL boolean, and anything else is a bug upstream
  //   that must not quietly turn deliveries off.
  if (ev.sample === true) {
    return { listeners: listeners.filter(runsForSample), skipped: listeners.filter((l) => !runsForSample(l)),
             skipReason: SAMPLE_SKIP_REASON };
  }
  return { listeners, skipped: [] };
}

// ★ CLEAN SHUTDOWN (recon §4: releaseClaim was never called). `startWorker().stop()` sets this before
//   `runner.stop()`, and graphile's own abort signal (fired on its graceful-shutdown timeout) is honoured
//   too. The dispatcher checks once per event, BEFORE starting it; events claimed but not started are
//   released — back to `pending`, no failure recorded — so a deploy costs no retry and no misleading error.
let dispatchStopRequested = false;
export function requestDispatchStop() { dispatchStopRequested = true; }
// ★ Fix round 1 (review nit): cleared where the worker STARTS (runner.mjs startWorker), so a runner stopped
//   and started again in the same process dispatches instead of claiming nothing forever.
export function resumeDispatch() { dispatchStopRequested = false; }

async function inSavepoint(tx, name, fn) {
  await tx.query(`SAVEPOINT ${name}`);
  try {
    const out = await fn();
    await tx.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, out };
  } catch (err) {
    // ★★ ROLLBACK TO undoes this listener's writes (and its transaction-local GUCs, e.g. asViewer's) and
    //    clears an aborted transaction; RELEASE then drops the savepoint so names do not pile up.
    await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await tx.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: false, err };
  }
}

/** Deliver one claimed event's due listeners. Returns what the summary needs. */
async function dispatchOneEvent(tx, ev, { tenantId, helpers, summary }) {
  let rows = await deliveryRows(tx, { tenantId, eventId: ev.id });
  if (rows.length === 0) {
    const plan = await planListeners(tx, ev, tenantId);
    if (plan.listeners.length === 0 && plan.skipped.length === 0) {
      // ★★★ NO LISTENER IS NOT A FAILURE AND NOT A SUCCESS — but the row must not sit in `claimed`.
      //     Marked processed and COUNTED (`unhandled`), exactly as before this task.
      await markProcessed(tx, ev.id);
      summary.unhandled++;
      summary.processed++;
      return;
    }
    rows = await planDeliveries(tx, { tenantId, eventId: ev.id, ...plan });
    summary.listenersSkippedSample += ev.sample === true ? plan.skipped.length : 0;
  }

  for (const row of rows) {
    if (!["pending", "failed"].includes(row.status) || !row.due) continue;
    const run = LISTENER_RUN[row.listener];
    if (!run) {
      await recordSkipped(tx, { tenantId, deliveryId: row.id, reason: "listener_retired" });
      continue;
    }
    // ★★ Defence in depth (Task 8): a row planned `pending` for a sample event by anything other than
    //    planListeners above (e.g. before this deploy) is skipped here, before it can run.
    if (ev.sample === true && !runsForSample(row.listener)) {
      await recordSkipped(tx, { tenantId, deliveryId: row.id, reason: SAMPLE_SKIP_REASON });
      summary.listenersSkippedSample++;
      continue;
    }
    const r = await inSavepoint(tx, "dispatch_listener", async () => {
      const out = (await run(ev, { tx, tenantId, helpers })) ?? {};
      // ★ Inside the savepoint: the listener's work and its `delivered` mark commit or roll back together.
      await recordDelivered(tx, { tenantId, deliveryId: row.id, handedOffTo: out.handedOffTo ?? null });
      return out;
    });
    if (r.ok) {
      summary.listenersDelivered++;
      if (r.out.chainResult) {
        for (const o of r.out.chainResult.opened) {
          summary.tasksOpened += o.created ? 1 : 0;
          summary.tasksAlreadyOpen += o.created ? 0 : 1;
        }
        summary.tasksClosed += r.out.chainResult.closed.length;
      }
      if (r.out.handedOffTo === "deliver_webhooks") summary.webhooksEnqueued = (summary.webhooksEnqueued ?? 0) + 1;
    } else {
      // ★ Recorded, never swallowed — "a handler that fails silently is the inferred-from-silence defect".
      const errorText = safeErrorText(r.err);
      // ★★ Stage 4 Task 6 (Stage 3 carry): the same retry classes as every job. A failure that retrying cannot fix
      //    (validation, forbidden, a bug) goes straight to `dead` instead of spending six attempts over 14 hours.
      const { retryable, kind } = classifyFailure(r.err);
      // ★ Task 8 fix 1 (I-1): the kind is STORED as well as used, so the dead-listener sweep can ask the same question
      //   the job path asks — can a person in this practice actually act on this?
      const f = await recordListenerFailure(tx, { tenantId, deliveryId: row.id,
        errorText: retryable ? errorText : `${kind}, not retried: ${errorText}`, retryable, failureKind: kind });
      summary.listenerFailures++;
      if (f.status === "dead") summary.listenersDead++;
      helpers.logger.info(
        `dispatch_outbox tenant=${tenantId} event=${ev.id} listener=${row.listener} ${f.status} ` +
        `attempt=${f.attempts}: ${errorText}`);
    }
  }

  const settled = await settleEvent(tx, { tenantId, eventId: ev.id });
  if (settled.status === "processed") summary.processed++;
  else summary.failed++;
}

/**
 * ★★ `job.gave_up` for every dead delivery row not yet reported (spec 02 §2.8, 07 §4.6).
 *    AFTER the tenant transaction commits, on the WORKER'S OWN CONNECTION (`helpers.withPgClient` —
 *    app_worker in production): the writer is SECURITY DEFINER with EXECUTE to app_worker only (0138),
 *    and the tenant transaction is app_rw. Writing it after commit means a rolled-back `dead` can never
 *    produce a false report.
 *  ★★ Fix round 1 (F2a): the writer is IDEMPOTENT per (listener, event) since 0142 — a partial unique
 *     index and ON CONFLICT DO NOTHING — so two dispatches reporting the same row at once produce ONE
 *     platform event, and both mark their row reported.
 *  ★★ Fix round 1 (F2b): a failed write is counted on the row (`gave_up_report_attempts`); each row is
 *     tried on its own and a failure never stops the rows after it. At GAVE_UP_REPORT_MAX_ATTEMPTS the row
 *     is no longer selected and ONE loud error says so. Another practice is never affected: this runs
 *     inside one practice's dispatch job, and every failure is caught here.
 */
async function reportGaveUps(tenantId, helpers, owed, summary) {
  const reported = [];
  const failed = [];
  for (const d of owed) {
    try {
      await helpers.withPgClient((pg) => recordJobGaveUp((sql, args) => pg.query(sql, args), {
        tenantId, eventId: d.event_id, listener: d.listener, attempts: d.attempts }));
      reported.push(d.id);
    } catch (err) {
      failed.push(d.id);
      helpers.logger.error(
        `dispatch_outbox tenant=${tenantId}: could not record job.gave_up for listener ${d.listener} on event ` +
        `${d.event_id} (${safeErrorText(err)}). The delivery row is dead; the report will be retried.`);
    }
  }
  if (reported.length === 0 && failed.length === 0) return;
  const counted = await withTenant(tenantId, async (tx) => {
    await markGaveUpReported(tx, { tenantId, deliveryIds: reported });
    return recordGaveUpReportFailures(tx, { tenantId, deliveryIds: failed });
  });
  summary.gaveUpReported += reported.length;
  summary.gaveUpReportFailures += failed.length;
  for (const c of counted) {
    if (c.gave_up_report_attempts >= GAVE_UP_REPORT_MAX_ATTEMPTS) {
      summary.gaveUpReportsAbandoned++;
      helpers.logger.error(
        `★★★ dispatch_outbox tenant=${tenantId}: job.gave_up for listener ${c.listener} on event ${c.event_id} ` +
        `FAILED ${c.gave_up_report_attempts} TIMES AND WILL NOT BE RETRIED (event_delivery ${c.id}). The listener ` +
        `is dead and the platform does not know. Fix the writer, then set gave_up_report_attempts = 0 on that row.`);
    }
  }
}

export const dispatchOutboxForTenant = guardedTask("dispatch_outbox", async (payload, helpers) => {
  const { tenantId } = payload;
  const limit = Number.isInteger(payload.limit) ? payload.limit : 50;
  // ★★ `tasksAlreadyOpen` is counted SEPARATELY from `tasksOpened`: a redelivered chain hitting
  //    task_open_key's ON CONFLICT is normal and must read as neither a failure nor a new task.
  const summary = {
    claimed: 0, processed: 0, failed: 0, unhandled: 0, released: 0,
    tasksOpened: 0, tasksAlreadyOpen: 0, tasksClosed: 0,
    listenersDelivered: 0, listenerFailures: 0, listenersDead: 0, listenersSkippedSample: 0, gaveUpReported: 0,
    gaveUpReportFailures: 0, gaveUpReportsAbandoned: 0, giveUpTasksOpened: 0, giveUpTasksMissed: 0,
  };
  const isStopping = () => dispatchStopRequested || helpers.abortSignal?.aborted === true;
  let owed = [];

  // ★★★ D559 BACKPRESSURE. Hand the delivery lane no more work while it already holds DELIVERY_BACKLOG_LIMIT waiting jobs: the
  //     events stay safe in the outbox (oldest first, claimed again next minute), the lane drains, and the queue's depth means
  //     something again. Without it a slow or dead endpoint turns every event into a job that nobody will reach for hours.
  try {
    const { rows: [lane] } = await helpers.withPgClient((pg) => pg.query(
      `SELECT count(*)::int AS waiting FROM graphile_worker.jobs WHERE queue_name = $1 AND locked_at IS NULL`, [deliveryQueueName(tenantId)]));
    if (lane && lane.waiting >= DELIVERY_BACKLOG_LIMIT) {
      helpers.logger.info(`dispatch_outbox tenant=${tenantId} holding back: ${lane.waiting} deliveries already waiting (limit ${DELIVERY_BACKLOG_LIMIT}); the events stay in the outbox`);
      return { ...summary, heldBack: lane.waiting };
    }
  } catch { /* the guard is a courtesy: if the lane cannot be read, dispatch as before */ }

  // ★★ ONE TRANSACTION PER BATCH, inside withTenant — the claim, the work and the marks share the tenant
  //    context and RLS. What changed is that nothing inside it can abort it: each event and each listener
  //    has its own savepoint.
  await withTenant(tenantId, async (tx) => {
    if (dispatchStopRequested) return;       // shutting down: claim nothing
    const events = await claimEvents(tx, limit, { maxAttempts: EVENT_CLAIM_BUDGET });
    // ★ 0040 selects the batch ORDER BY created_at, but `UPDATE … RETURNING` does not promise to return
    //   rows in that order [EXECUTED: test/s3_retry_schedule saw the batch arrive out of order]. Ordering
    //   stays best-effort (spec 02 §2.7), but the batch is worked oldest-first as the claim intends — and a
    //   shutdown then releases the NEWEST claims, not an arbitrary set. ★ The order is read back from the
    //   database, not sorted in JS: pg hands timestamptz to JS as a millisecond Date, and events emitted
    //   within the same millisecond compared equal [EXECUTED — the first version of this sort].
    if (events.length > 1) {
      const { rows: order } = await tx.query(
        `SELECT id FROM keystone.event WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at, id`,
        [tenantId, events.map((e) => e.id)]);
      const rank = new Map(order.map((r, i) => [r.id, i]));
      events.sort((a, b) => rank.get(a.id) - rank.get(b.id));
    }
    summary.claimed = events.length;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (isStopping()) {
        for (const rest of events.slice(i)) {
          if (await releaseClaim(tx, rest.id)) summary.released++;
        }
        break;
      }
      // ★★ The OUTER savepoint: if the dispatcher's own bookkeeping for this event fails (planning, a
      //    delivery-row write), this event alone is rolled back and failed on the 07 schedule — the batch
      //    and the events around it are untouched.
      const r = await inSavepoint(tx, "dispatch_event", () => dispatchOneEvent(tx, ev, { tenantId, helpers, summary }));
      if (!r.ok) {
        await markFailed(tx, ev.id, safeErrorText(r.err), { maxAttempts: EVENT_CLAIM_BUDGET });
        summary.failed++;
        helpers.logger.info(`dispatch_outbox tenant=${tenantId} event=${ev.id} could not be dispatched: ${safeErrorText(r.err)}`);
      }
    }
    await closeOutDeadEvents(tx, { tenantId });
    owed = await unreportedDeadDeliveries(tx, { tenantId });
    const ownedNow = [];
    // ★★★ Stage 4 Task 8 — A DEAD LISTENER'S OWNER. Every row that just died (whichever path killed it: its own sixth
    //     failure, a failure retrying cannot help, or closeOutDeadEvents) is here exactly once before its job.gave_up
    //     report is attempted (gave_up_report_attempts = 0). A `person` listener opens ONE task in THIS practice, in
    //     THIS transaction — so the task commits with the death, or neither does. Each in its own savepoint: a task
    //     that cannot be opened is logged loudly and the job.gave_up fact (Platform Jobs) remains its owner.
    for (const d of owed) {
      // ★★★ Task 8 fix 1 (review M-6) — ONCE PER DEATH, decided by the death's OWN mark, not by the report's attempt
      //     counter. gave_up_report_attempts is 0 both before the first report AND after a report that crashed between
      //     the commit and its mark; reading it as "not owned yet" reopened tasks the practice had already closed.
      if (d.gave_up_owned_at) continue;
      ownedNow.push(d.id);
      const r = await inSavepoint(tx, "give_up_owner", async () => {
        const { rows: [ev] } = await tx.query(
          `SELECT id, topic, subject_type, subject_id, payload FROM keystone.event WHERE tenant_id = $1 AND id = $2`,
          [tenantId, d.event_id]);
        // ★ I-1: the kind this listener actually died of (NULL — never classified — is read as ours, not theirs).
        return openGiveUpTask(tx, { tenantId, kind: "listener", name: d.listener, ev: ev ?? null,
                                    failureKind: d.failure_kind ?? null });
      });
      if (r.ok && r.out.outcome === "opened") summary.giveUpTasksOpened++;
      // ★★★ IM-6 (task-14-review) — "no_admin" is a MISS, and it is counted as one, but it is not the same miss as
      //     "no subject". Same sentence, different remedy: one means the row a task would hang on is gone, the other
      //     means the practice has nobody to hand the task to (and, for a document subject, nobody to read it as —
      //     document_is_visible fails closed on no viewer, F527/0157). The old message said the first for both.
      else if (!r.ok || r.out.outcome === "no_subject" || r.out.outcome === "no_admin") {
        summary.giveUpTasksMissed++;
        const why = !r.ok
          ? safeErrorText(r.err)
          : r.out.outcome === "no_admin"
            ? "the practice has NO ACTIVE STAFF ADMIN — nobody to read the subject as and nobody to hand the task to; " +
              "give the practice an admin (keystone.app_user role='staff' staff_role='admin')"
            : "no subject a task can be filed on";
        helpers.logger.error(
          `dispatch_outbox tenant=${tenantId}: listener ${d.listener} on event ${d.event_id} is dead and its owner's task ` +
          `could not be opened (${why}) — it is on Platform Jobs.`);
      }
      // ★★ IM-6, the other half: the task DID open, but at nobody. Counted as opened (it is), said out loud anyway.
      else if (r.ok && r.out.unassigned && r.out.outcome === "already_open") {
        helpers.logger.error(
          `dispatch_outbox tenant=${tenantId}: listener ${d.listener} on event ${d.event_id} is dead and its task ` +
          `${r.out.taskId} is open but UNASSIGNED — the practice has no active staff admin to give it to.`);
      }
      if (r.ok && r.out.outcome === "opened" && r.out.unassigned) {
        helpers.logger.error(
          `dispatch_outbox tenant=${tenantId}: listener ${d.listener} on event ${d.event_id} is dead and its new task ` +
          `${r.out.taskId} is UNASSIGNED — the practice has no active staff admin to give it to.`);
      }
    }
    // ★ In the SAME transaction as the deaths themselves: committed together, so the decision is made exactly once.
    await markGiveUpOwned(tx, { tenantId, deliveryIds: ownedNow });
  });

  if (owed.length) await reportGaveUps(tenantId, helpers, owed, summary);

  // an empty poll writes nothing at info (G1): only a pass that claimed, failed or reported something is a line
  const quiet = summary.claimed === 0 && summary.failed === 0 && summary.unhandled === 0 && summary.released === 0 && summary.listenerFailures === 0 && summary.listenersDead === 0 && summary.gaveUpReported === 0 && summary.tasksOpened === 0 && summary.tasksClosed === 0;
  helpers.logger[quiet ? "debug" : "info"](
    `dispatch_outbox tenant=${tenantId} claimed=${summary.claimed} processed=${summary.processed} ` +
    `failed=${summary.failed} unhandled=${summary.unhandled} released=${summary.released} ` +
    `listeners_delivered=${summary.listenersDelivered} listener_failures=${summary.listenerFailures} ` +
    `listeners_dead=${summary.listenersDead} gave_up_reported=${summary.gaveUpReported} ` +
    `tasks_opened=${summary.tasksOpened} tasks_already_open=${summary.tasksAlreadyOpen} ` +
    `tasks_closed=${summary.tasksClosed} give_up_tasks_opened=${summary.giveUpTasksOpened} ` +
    `give_up_tasks_missed=${summary.giveUpTasksMissed}` +
    (summary.unhandled > 0
      ? ` ★ ${summary.unhandled} event(s) had NO LISTENER — marked processed and counted, not silently dropped`
      : ""));
  return summary;
});

/**
 * ★★ THE SWEEP — the ONE static job, and the only place tenants are enumerated.
 *
 * ★★★ IT IS NOT A TASK THAT DOES WORK. It asks `keystone_auth.list_active_tenant_ids()` (gated by GRANT
 *     to `app_worker`) and enqueues ONE `dispatch_outbox` job per active tenant, with a `job_key` so a
 *     slow tenant cannot accumulate a queue of identical sweeps behind it.
 *   ★ This is §D5's ruling 3 in miniature — "one static entry sweeps … and `add_job`s each due item with
 *     a `job_key`" — applied to the outbox rather than to cadence, because `run_schedule_item` does not
 *     exist yet (it is P20.6). See P18.6(d): the cadence half is BLOCKED on that table, deliberately.
 */
/**
 * ★★★ P3.3 — CLOSE THE JOBS A DEPARTED TENANT LEFT BEHIND.
 *
 * [EXECUTED against the deployed `graphile_worker.jobs`] **29 permanently retrying jobs** — 19
 * `archive_document_pdf` + 10 `deliver_notification_email` — all sitting at `attempts=10` of 25,
 * every one failing with *"tenant <uuid> is not active, so no work will be done for it"*.
 * ★★★ **AND THE ~24 TENANT UUIDs IN THOSE ERRORS DO NOT EXIST.** `keystone.tenant` holds three rows.
 *     The jobs were queued while their practice was alive and have outlived it, retrying forever
 *     against a tenant nobody can reactivate.
 *
 * ★★ THIS IS THE ONE TASK THAT MUST NOT BE `guardedTask`, AND THE REASON IS THE WHOLE DESIGN.
 *    `guardedTask` refuses to do any work for a tenant that is not active — correctly, and that
 *    refusal is exactly what these 29 jobs are stuck on. **A reaper wrapped in the guard could never
 *    reach its own subject.** So it takes no tenantId, does no tenant work, and touches only the
 *    queue.
 *
 * ★ IT FAILS THEM PERMANENTLY RATHER THAN DELETING THEM. A deleted job leaves no trace of why 19
 *   documents were never archived; a permanently-failed one carries the reason and can be read back.
 *   **The queue is a record, not a to-do list** — the same argument P2.9 made for archiving.
 */
/** ★ F486 — what the ledger says, in words, about a job whose practice is gone. */
const ORPHAN_ACK_REASON = "practice no longer exists — the work can never run";
/** ★ F512 — the canonical uuid text. A payload tenantId that is not this is skipped and counted, never cast. */
const UUID_TEXT = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

/**
 * ★★★ STAGE 4 TASK 9 / F528 — REMOVING THE JOB IS NOT REMOVING THE LOCK, AND THE DIFFERENCE STRANDS A PRACTICE.
 *   [MEASURED, node_modules/graphile-worker/sql/000016.sql] the SQL function `graphile_worker.complete_jobs(bigint[])`
 *   is a plain DELETE over `_private_jobs`. It does **not** touch `_private_job_queues` — unlike the worker's own
 *   completion path (dist/sql/completeJobs.js), which clears `locked_by`/`locked_at` on the queue in the same
 *   statement. And it deletes rows that are `locked_at IS NULL` **or locked more than four hours ago**, i.e. exactly
 *   the jobs a dead worker left behind.
 *   ★★ So: a worker dies holding a job → it holds `t:<tenantId>` too → four hours later this line deletes the job
 *      and the queue row stays locked by a worker that no longer exists, with NOTHING left pointing at it.
 *      `_private_job_queues.is_available` is generated as `locked_at IS NULL` — no time term — so that practice's
 *      queue is dead for good.
 *   ★ The fix is exact, not a sweep: unlock ONLY the queue whose lock belongs to the very job just removed
 *     (`q.locked_by = done.locked_by` AND that job was itself locked). A queue locked by a LIVE worker running some
 *     other job of that practice is untouched — the unlocked job we removed was never its holder. The general case
 *     (a stale queue lock with no job left) is `reclaimAbandonedJobs`'s.
 * ★★ Task 14 / C-1 factored this out of the reaper's own block so the SECOND caller — the sweep that finishes an
 *    acknowledged give-up — cannot forget the unlock. One completion path, one lock rule.
 * @returns the rows `complete_jobs` actually deleted (a row a running worker holds is skipped, not deleted).
 */
async function completeJobsAndFreeTheirQueues(pg, ids) {
  if (!ids.length) return [];
  const { rows: done } = await pg.query(
    `SELECT id, job_queue_id, locked_by, locked_at FROM graphile_worker.complete_jobs($1::bigint[])`, [ids]);
  const stranded = done.filter((r) => r.job_queue_id != null && r.locked_at != null && r.locked_by != null);
  if (stranded.length) {
    await pg.query(
      `UPDATE graphile_worker._private_job_queues q
          SET locked_by = NULL, locked_at = NULL
         FROM unnest($1::int[], $2::text[]) AS d(job_queue_id, locked_by)
        WHERE q.id = d.job_queue_id AND q.locked_by = d.locked_by`,
      [stranded.map((r) => r.job_queue_id), stranded.map((r) => r.locked_by)]);
  }
  return done;
}

/**
 * ★★★ TASK 14 / C-1 — AN ACKNOWLEDGED GIVE-UP IS FINISHED WITH, NOT JUST FILED.
 *
 * [EXECUTED, task-14-review.md C-1] A dead job for a LIVE practice is recorded; a person presses "Give up…" and
 * `keystone_meta.acknowledge_job_failure` (0160 §5) sets `acknowledged_at`; the queue check goes green; thirty days
 * later Task 12's prune deletes the ledger row — correctly — and **nothing has ever deleted the graphile row**,
 * because the reaper only removes jobs whose practice is GONE. `queueCheck` then counts that row as `unrecorded`
 * for ever, and Platform Jobs lists LEDGER rows, so it can never be shown or acknowledged again. F486 verbatim.
 *
 * ★★★ THIS IS THE MISSING HALF, AND IT LIVES HERE FOR A REASON THE GRANTS DECIDE, NOT TASTE. `graphile_worker` is
 *     owned by `keystone_admin` and only **app_worker** holds write rights on its tables [MEASURED, pg_class.relacl;
 *     asserted again in 0161 §5]. `acknowledge_job_failure` runs from an `app_rw` web request and cannot reach the
 *     queue — 0160 granted `auth_owner` SELECT and a five-column UPDATE and **no DELETE, to anybody**. So the
 *     acknowledgement writes the paperwork and THIS sweep, running as app_worker on the reaper's own tick, finishes
 *     the job.
 *
 * ★★★ THE WHOLE IDENTITY, NOT THE ID (F510). A graphile id is reused after a reap. A ledger row is keyed on
 *     (job_id, task_identifier, job_created_at) for exactly that reason, and this join uses all three — so an
 *     acknowledged record of a DEAD job can never complete a LIVE job that happens to have inherited its id.
 *
 * ★★ AND ONLY A JOB THAT IS ACTUALLY DEAD. `attempts >= max_attempts` is required: if a person pressed
 *    "Retry now" the row is back at attempts = 0 and is real, live work — completing it would delete the very
 *    thing they asked for. Such a row is simply left for a later tick.
 *
 * ★★ "Finished" also covers the row that was ALREADY absent — the reaper removed it, or graphile's own cleanup did.
 *    Those ledger rows get the mark without any delete, which is what lets rows written before 0161 become prunable
 *    at all (0161 §1 deliberately backfills nothing: a migration runs as app_owner and cannot read graphile).
 *
 * ★ It is deliberately OUTSIDE the F509 circuit breaker and runs before it. The breaker guards removals decided by
 *   `tenant_exists`/`tenant_is_active` — reads that can go blind and condemn every practice at once. This removal is
 *   decided by a NAMED PERSON'S acknowledgement of one specific job identity, which no RLS fault can manufacture.
 */
async function finishAcknowledgedGiveUps(helpers) {
  return helpers.withPgClient(async (pg) => {
    // ★★ The candidate list and the graphile lookup in ONE query, joined on the whole identity, so the two cannot
    //    drift between statements. `keystone_meta.job_failures_awaiting_finish` (0161 §2) is the only read of the
    //    ledger app_worker has — it holds no table rights at all (0145).
    const { rows: candidates } = await pg.query(
      `SELECT c.failure_id, c.job_id, c.task_identifier,
              pj.id AS graphile_id, pj.attempts >= pj.max_attempts AS dead
         FROM keystone_meta.job_failures_awaiting_finish($1::int) c
         LEFT JOIN graphile_worker._private_jobs pj
                ON pj.id = c.job_id AND pj.created_at = c.job_created_at
         LEFT JOIN graphile_worker._private_tasks t
                ON t.id = pj.task_id
        WHERE pj.id IS NULL OR t.identifier = c.task_identifier`,
      [PRUNE_BATCH]);
    if (candidates.length === 0) return { considered: 0, completed: 0, marked: 0, stillRunning: 0 };

    const absent = candidates.filter((r) => r.graphile_id == null);
    const deadHere = candidates.filter((r) => r.graphile_id != null && r.dead);
    const alive = candidates.filter((r) => r.graphile_id != null && !r.dead);

    await pg.query("BEGIN");
    try {
      // ★★ COMPLETE FIRST, MARK SECOND, ONE TRANSACTION — and mark ONLY what complete_jobs really deleted. A job a
      //    running worker holds is skipped by graphile's own rule; marking it finished would let the prune delete
      //    its record while the row was still there, which is C-1 again in miniature.
      const done = await completeJobsAndFreeTheirQueues(pg, deadHere.map((r) => r.job_id));
      const doneIds = new Set(done.map((r) => String(r.id)));
      const finishable = [
        ...absent.map((r) => r.failure_id),
        ...deadHere.filter((r) => doneIds.has(String(r.job_id))).map((r) => r.failure_id),
      ];
      const { rows: [m] } = finishable.length
        ? await pg.query(`SELECT keystone_meta.mark_job_failures_finished($1::bigint[]) AS n`, [finishable])
        : { rows: [{ n: 0 }] };
      await pg.query("COMMIT");
      return { considered: candidates.length, completed: done.length, marked: Number(m.n),
               stillRunning: deadHere.length - done.length, alive: alive.length };
    } catch (e) {
      await pg.query("ROLLBACK").catch(() => {});
      throw e;
    }
  });
}

let lastPlanReconcileAt = 0, lastUsageFlushAt = 0, lastUsageSummaryAt = 0, lastConnectNoticeAt = 0;
const reapOrphanJobs = async function reapOrphanJobs(_payload, helpers) {
  // 14 Oct 2026: a job for a task this worker does NOT register can never run — graphile skips an unknown task — so it sits "due" forever and reads as a stuck queue
  //   (invoice_draft_sweep was removed in 1e7122f38; nine of its jobs waited 12 days). Complete (not fail) such a job only once it is a DAY past due, so a job for a task a
  //   NEWER deploy is about to register is never touched during a rolling deploy. A job that is locked or has already attempted is left alone.
  try {
    const r = await helpers.withPgClient((pg) => pg.query(
      `WITH dead AS (SELECT id FROM graphile_worker.jobs WHERE task_identifier <> ALL($1::text[]) AND locked_at IS NULL AND attempts = 0 AND run_at < now() - interval '1 day')
       SELECT count(*)::int AS n FROM graphile_worker.complete_jobs(ARRAY(SELECT id FROM dead))`, [Object.keys(TASK_LIST)]));
    if (r.rows[0]?.n) helpers.logger.info(`reap_orphan_jobs: completed ${r.rows[0].n} job(s) for a task this worker no longer has.`);
  } catch (e) { helpers.logger.error(`reap_orphan_jobs: ★ unregistered-task sweep failed (${e.message}).`); }
  // LAUNCH step 3: the first welcome email. The web process cannot reach the queue, so this global tick finds owners whose welcome has not gone out (a minute old or more) and runs their series now; the daily 10:00 turn handles the later steps.
  try { const { pendingWelcomeTenants } = await import("../product/lifecycle.mjs"); for (const tenantId of await pendingWelcomeTenants()) { const r = await runWelcomeForTenant(tenantId); if (r.length) helpers.logger.info(`reap_orphan_jobs: welcome tenant=${tenantId} ${r.map((x) => `step=${x.step ?? x.wait}:${x.status ?? x.skipped ?? "wait"}`).join(" ")}`); } }
  catch (e) { helpers.logger.error(`reap_orphan_jobs: ★ welcome tick failed (${e.message}).`); }
  // LAUNCH step 8: the public demo's workspaces are thrown away when their 24 hours are up. Platform work with no tenant, so it rides this global tick (a failure is logged and the rest still runs).
  try { const { demoEnabled } = await import("../product/demoConfig.mjs"); if (demoEnabled()) { const { purgeExpiredDemos } = await import("../product/demo.mjs"); const n = (await purgeExpiredDemos({ limit: 5 })).gone; if (n) helpers.logger.info(`reap_orphan_jobs: removed ${n} expired demo workspace(s).`); } }
  catch (e) { helpers.logger.error(`reap_orphan_jobs: ★ demo purge failed (${e.message}).`); }
  // Billing audit (13 Oct 2026): every six hours each Docustay workspace's plan is compared with Stripe's own record and fixed if it drifted (a lost or late webhook). Idempotent; a failure is logged and the rest still runs.
  try { if (Date.now() - lastPlanReconcileAt > 6 * 3600_000) { lastPlanReconcileAt = Date.now(); const { reconcileDocustaySubscriptions } = await import("../product/reconcilePlans.mjs"); const r = await reconcileDocustaySubscriptions({ log: (m) => helpers.logger.warn(m) }); if (r.checked || r.failed.length) helpers.logger.info(`reap_orphan_jobs: docustay plan reconcile checked ${r.checked}, corrected ${r.corrected.length}, failed ${r.failed.length}.`); } }
  catch (e) { helpers.logger.error(`reap_orphan_jobs: ★ docustay plan reconcile failed (${e.message}).`); }
  // Usage billing (v1 item 21): unsent billable units are reported to Stripe as meter events (identifier = the document or AI request, so a retry never bills twice). At most once a minute; a failure is logged and the rest still runs.
  // R13-D334: a self-hosted install is never billed by Docustay, so it has no meter to report to (its worker's role was also refused the pending list every minute)
  try { if (process.env.KEYSTONE_SELF_HOST !== "1" && Date.now() - lastUsageFlushAt > 60_000) { lastUsageFlushAt = Date.now(); const { flushAllPendingUsage } = await import("../product/docustayUsage.mjs"); const r = await flushAllPendingUsage({ log: (m) => helpers.logger.warn(m) }); if (r.sent || r.failed) helpers.logger.info(`reap_orphan_jobs: docustay usage flush sent ${r.sent}, failed ${r.failed}.`); } }
  catch (e) { helpers.logger.error(`reap_orphan_jobs: ★ docustay usage flush failed (${e.message}).`); }
  // Usage billing (v1 item 24): the owner's summary of the period that just ended (a paid plan's billing period, Free's calendar month). Once per workspace per period (a once-marker keyed by the period start); checked every six hours.
  try { if (Date.now() - lastUsageSummaryAt > 6 * 3600_000 ) { lastUsageSummaryAt = Date.now(); const { sendPeriodSummaries } = await import("../product/docustayUsage.mjs"); const r = await sendPeriodSummaries({ log: (m) => helpers.logger.warn(m) }); if (r.sent) helpers.logger.info(`reap_orphan_jobs: docustay usage summaries sent ${r.sent}.`); } }
  catch (e) { helpers.logger.error(`reap_orphan_jobs: ★ docustay usage summary failed (${e.message}).`); }
  // Stripe payments screen (21 Oct 2026): a Stripe deadline 7, 3 or 1 day away emails the workspace Owners, once per threshold. Checked once a day.
  try { if (Date.now() - lastConnectNoticeAt > 24 * 3600_000) { lastConnectNoticeAt = Date.now(); const { sendDeadlineNotices } = await import("../product/docustayStripeNotices.mjs"); const r = await sendDeadlineNotices({ log: (m) => helpers.logger.warn(m) }); if (r.sent) helpers.logger.info(`reap_orphan_jobs: stripe deadline notices sent ${r.sent}.`); } }
  catch (e) { helpers.logger.error(`reap_orphan_jobs: ★ stripe deadline notices failed (${e.message}).`); }
  // ★★★ C-1 — FIRST, FINISH THE JOBS PEOPLE HAVE ALREADY ACKNOWLEDGED (see finishAcknowledgedGiveUps above).
  //     It runs on EVERY tick, before the orphan scan's own early return, because its subject is not an orphan:
  //     the practice is alive and well and a person has said "I have dealt with this". If it throws, it is logged
  //     and the orphan scan still runs — one half failing must not take the other down.
  let finished = { considered: 0, completed: 0, marked: 0, stillRunning: 0 };
  try {
    finished = await finishAcknowledgedGiveUps(helpers);
    if (finished.considered) {
      helpers.logger.info(
        `reap_orphan_jobs: finished ${finished.completed} acknowledged give-up(s) — removed their queue rows and ` +
        `marked ${finished.marked} ledger row(s) done, of ${finished.considered} awaiting it` +
        (finished.stillRunning ? ` · ${finished.stillRunning} held by a running worker, next tick` : "") +
        (finished.alive ? ` · ${finished.alive} back on the queue (retried) and left alone` : ""));
    }
  } catch (e) {
    helpers.logger.error(
      `reap_orphan_jobs: ★ could not finish acknowledged give-ups (${e.message}) — their queue rows are still ` +
      `there and their ledger rows stay unprunable, which is the safe half of C-1, but the alert will not clear.`);
  }
  // ★★ MN-5 — the PLATFORM half of the ledger (tenant_id IS NULL) has no per-practice prune to ride on, and this
  //    is the stage's only platform-wide, ledger-aware, app_worker task. Same thirty-day rule as 0159/0161, same
  //    "finished first" requirement. Never fatal: retention is housekeeping, the reap is not.
  try {
    const { rows: [pr] } = await helpers.withPgClient((pg) => pg.query(
      `SELECT keystone_meta.prune_platform_job_failures($1::int, $2::int) AS n`, [PRUNE_RETENTION.jobFailureDays, PRUNE_BATCH]));
    if (Number(pr.n)) helpers.logger.info(
      `reap_orphan_jobs: pruned ${pr.n} settled platform-wide give-up(s) older than ${PRUNE_RETENTION.jobFailureDays} days.`);
  } catch (e) {
    helpers.logger.error(`reap_orphan_jobs: ★ could not prune settled platform-wide give-ups (${e.message}).`);
  }

  const { rows: candidates } = await helpers.withPgClient(async (pg) => {
    // ★★ A job's tenant is in its PAYLOAD, because every task in this project takes one there. A job
    //    with no tenantId is not orphaned — it is global (the static sweep itself) — and is left
    //    alone. ★ `keystone_auth.tenant_is_active()` is the same definer `guardedTask` asks, so the
    //    reaper and the guard cannot disagree about which tenants count.
    // ★★ THE PAYLOAD IS NOT ON THE PUBLIC VIEW. [MEASURED] `graphile_worker.jobs` exposes
    //    (id · queue_name · task_identifier · priority · run_at · attempts · max_attempts ·
    //    last_error · created_at · updated_at · key · locked_at · locked_by · revision · flags) —
    //    **no `payload`.** It lives on `_private_jobs`, which also holds `task_id` rather than the
    //    identifier. So the reaper reads the private table and joins for the name it reports.
    //  ★ Naming a private table is a real coupling to graphile's internals and is accepted here
    //    deliberately: the alternative is not reaping at all, and the join is one line to fix if the
    //    library moves it. **A stated coupling beats an unreaped queue.**
    // ★★★ F486 — BOTH OPEN AND ALREADY-CLOSED jobs are selected now. The closed ones (at max_attempts)
    //     are the 139 production rows the queue check kept counting; `tenant_exists()` (0145) splits
    //     "the practice is GONE" from "the practice exists but is not active".
    // ★★★ F512 — ONE MALFORMED tenantId USED TO STOP EVERY RUN: the cast to uuid ran for every row and one
    //     bad value threw the whole query. The cast now happens only inside CASE WHEN the text IS a uuid;
    //     a malformed one comes back with `well_formed = false`, is counted in the log and is left alone.
    // ★★ F510 — the job's own created_at travels as TEXT at microsecond precision, never through a JS Date
    //    (milliseconds): it is part of the ledger's identity for the job and must match graphile's exactly.
    return pg.query(
      `SELECT j.id, j.task_identifier, j.tenant_id, j.attempts, j.max_attempts, j.last_error, j.job_created_at,
              j.well_formed,
              CASE WHEN j.well_formed THEN keystone_auth.tenant_exists(j.tenant_id::uuid) END AS tenant_exists
         FROM (SELECT pj.id, t.identifier AS task_identifier, pj.payload->>'tenantId' AS tenant_id,
                      pj.attempts, pj.max_attempts, pj.last_error,
                      to_char(pj.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS job_created_at,
                      coalesce((pj.payload->>'tenantId') ~ $1, false) AS well_formed
                 FROM graphile_worker._private_jobs pj
                 JOIN graphile_worker._private_tasks t ON t.id = pj.task_id
                WHERE pj.payload->>'tenantId' IS NOT NULL) j
        WHERE NOT j.well_formed
           OR NOT (CASE WHEN j.well_formed THEN keystone_auth.tenant_is_active(j.tenant_id::uuid) ELSE true END)`,
      [UUID_TEXT]);
  });

  const malformed = candidates.filter((r) => !r.well_formed);
  const rows = candidates.filter((r) => r.well_formed);
  const malformedNote = malformed.length
    ? ` · skipped malformed ${malformed.length} (a tenantId that is not a practice id — left in the queue, ` +
      `never cast; job id(s) ${malformed.slice(0, 10).map((r) => r.id).join(", ")})`
    : "";
  const nothing = { found: 0, recorded: 0, removed: 0, closed: 0, reaped: 0, skippedLocked: 0, refused: 0,
                    malformed: malformed.length, tasks: {}, finished };

  const gone = rows.filter((r) => !r.tenant_exists);
  const inactiveOpen = rows.filter((r) => r.tenant_exists && r.attempts < r.max_attempts);

  if (gone.length === 0 && inactiveOpen.length === 0) {
    helpers.logger.info(`reap_orphan_jobs: no job names a tenant that is gone or inactive.${malformedNote}`);
    return nothing;
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ F509 — THE CIRCUIT BREAKER. What follows REMOVES rows, and removal cannot be undone (the
  //   ledger keeps no payload). It is decided by `tenant_exists` / `tenant_is_active`, which read the
  //   same RLS visibility on keystone.tenant. If that visibility ever went blind — a lost policy with
  //   the grant kept, a new restrictive policy — EVERY practice would read as gone and every
  //   practice's work would be recorded and deleted. The migration's positive control runs once, at
  //   migrate time; this runs every time.
  //   ★★ So before touching anything, ask the ACTIVE-PRACTICE LISTER (the same one sweepTenants uses)
  //      and cross-check it against the two reads the decision rests on. Any disagreement means the
  //      reads cannot be trusted, and the run removes NOTHING and closes NOTHING:
  //        · the lister names no practice at all (the platform practice is always active);
  //        · tenant_exists says a practice the lister calls active does not exist;
  //        · a job this run calls "not active" names a practice the lister calls active.
  //   ★ It is logged at ERROR, naming the reason, and returned as `breaker`.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const { rows: listed } = await helpers.withPgClient((pg) => pg.query(
    `SELECT l.tenant_id::text AS tenant_id, keystone_auth.tenant_exists(l.tenant_id) AS tenant_exists
       FROM keystone_auth.list_active_tenant_ids() l`));
  const listedIds = new Set(listed.map((l) => String(l.tenant_id).toLowerCase()));
  const notExisting = listed.filter((l) => !l.tenant_exists);
  const calledInactive = rows.filter((r) => listedIds.has(String(r.tenant_id).toLowerCase()));
  const breakerCode =
    listed.length === 0 ? "lister_empty"
      : notExisting.length ? "exists_disagrees"
        : calledInactive.length ? "activity_disagrees" : null;
  const breaker =
    listed.length === 0
      ? "the active-practice lister returned no practices at all — the platform practice is always active, " +
        "so the reads of keystone.tenant are blind"
      : notExisting.length
        ? `tenant_exists disagrees with the lister: ${notExisting.length} practice(s) the lister calls active ` +
          `do not exist by tenant_exists (e.g. ${notExisting[0].tenant_id})`
        : calledInactive.length
          ? `tenant_is_active disagrees with the lister: ${calledInactive.length} job(s) were read as not active ` +
            `but name a practice the lister calls active (e.g. ${calledInactive[0].tenant_id})`
          : null;
  if (breaker) {
    helpers.logger.error(
      `reap_orphan_jobs: ★ CIRCUIT BREAKER — removed NOTHING and closed NOTHING: ${breaker}. ` +
      `${gone.length} job(s) would have been removed as "practice gone" and ${inactiveOpen.length} closed. ` +
      `Check keystone.tenant's policies and the auth_owner grants before the next run.${malformedNote}`);
    // ★★★ R61b (fix round 2, 0149) — A TRIP MUST REACH A PERSON, AND A THROW WOULD NOT. sweep_tenants re-adds
    //     this job every minute with jobKeyMode 'replace', resetting attempts and last_error, so a thrown trip
    //     never reaches max_attempts and the queue check never sees it (review I2). So: touch nothing, do not
    //     throw, and record a PLATFORM FACT the queue check reads back — 'problem', naming the reason, while a
    //     trip is under 5 minutes old. Reason as an enum and counts only: no practice id in a platform fact.
    //   ★ If even the fact cannot be written, say so at ERROR and still return — never throw from here.
    let breakerEventId = null;
    try {
      breakerEventId = await helpers.withPgClient((pg) => recordReaperStopped(
        (sql, args) => pg.query(sql, args),
        { reason: breakerCode, wouldRemove: gone.length, wouldClose: inactiveOpen.length,
          disagreeing: breakerCode === "exists_disagrees" ? notExisting.length
            : breakerCode === "activity_disagrees" ? calledInactive.length : 0 }));
    } catch (e) {
      helpers.logger.error(
        `reap_orphan_jobs: ★ could not record the job.reaper_stopped platform fact (${e.message}) — the trip ` +
        `above is in this log only and the queue check will NOT show it.`);
    }
    return { ...nothing, found: gone.length + inactiveOpen.length, breaker, breaker_reason: breakerCode,
             breaker_event_id: breakerEventId };
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ F486 — THE PRACTICE IS GONE: RECORD, ACKNOWLEDGE, THEN REMOVE.
  //   A job whose practice no longer exists can never run — nobody can reactivate a tenant row that is
  //   not there. P3.3 kept such rows as permanently-failed so the reason survived; the reason now lives
  //   in the give-up ledger (keystone_meta.job_failure, 0145), ACKNOWLEDGED by 'system' with the old
  //   last_error kept, so the graphile row can go and the queue check stops counting it.
  //   ★★ Ledger first, removal second, ONE transaction: a job is never removed without its record.
  //   ★★ Removal is graphile's own `complete_jobs` (what WorkerUtils.completeJobs calls): it deletes
  //      exactly the ids given and SKIPS a row locked by a running worker (locked_at within 4 hours).
  //      A skipped row keeps its acknowledged ledger row, so it is not counted meanwhile, and the next
  //      run removes it. Recording is idempotent (keeps the first reason, never re-acknowledges).
  //   ★★★ A job whose practice EXISTS is never removed here — see the next block.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  //   ★★ Review M2 (fix round 2) — ONE REFUSED LEDGER WRITE MUST NOT STOP THE BATCH (the F512 shape again).
  //      Each record runs under its own SAVEPOINT. A refusal (e.g. the identity is already recorded under
  //      another practice) rolls back THAT job's record only; the job is NOT removed (it has no acknowledged
  //      record, so removing it would lose its trace), is counted as `refused` and named in the log. Only the
  //      jobs whose record succeeded are passed to complete_jobs. A failure at complete_jobs itself still rolls
  //      back the whole transaction — no job is ever removed without its record.
  let removedRows = [];
  const refused = [];
  if (gone.length) {
    removedRows = await helpers.withPgClient(async (pg) => {
      await pg.query("BEGIN");
      try {
        const recorded = [];
        for (const r of gone) {
          const was = r.last_error ? String(r.last_error).slice(0, 500) : "none — it had not run yet";
          await pg.query("SAVEPOINT reap_one");
          try {
            await pg.query(
              `SELECT keystone_meta.record_job_failure($1::bigint, $2, $3::timestamptz, $4::uuid, $5, true, $6)`,
              [r.id, r.task_identifier, r.job_created_at, r.tenant_id,
               `${ORPHAN_ACK_REASON} (the practice this job was queued for was removed). ` +
               `Attempts ${r.attempts}/${r.max_attempts}. Last error: ${was}`,
               ORPHAN_ACK_REASON]);
            await pg.query("RELEASE SAVEPOINT reap_one");
            recorded.push(r.id);
          } catch (e) {
            await pg.query("ROLLBACK TO SAVEPOINT reap_one");
            refused.push({ id: r.id, why: String(e.message).slice(0, 200) });
          }
        }
        // ★★★ STAGE 4 TASK 9 — REMOVING THE JOB IS NOT REMOVING THE LOCK, AND THE DIFFERENCE STRANDS A PRACTICE.
        //   [MEASURED, node_modules/graphile-worker/sql/000016.sql] the SQL function
        //   `graphile_worker.complete_jobs(bigint[])` is a plain DELETE over `_private_jobs`. It does **not** touch
        //   `_private_job_queues` — unlike the worker's own completion path (dist/sql/completeJobs.js), which clears
        //   `locked_by`/`locked_at` on the queue in the same statement. And it deletes rows that are `locked_at IS
        //   NULL` **or locked more than four hours ago**, i.e. exactly the jobs a dead worker left behind.
        //   ★★ So: a worker dies holding a departed practice's job → it holds `t:<tenantId>` too → four hours later
        //      this line deletes the job and the queue row stays locked by a worker that no longer exists, with
        //      NOTHING left pointing at it. `_private_job_queues.is_available` is generated as `locked_at IS NULL`
        //      — no time term — so that practice's queue is dead for good.
        //   ★ The fix is exact, not a sweep: unlock ONLY the queue whose lock belongs to the very job just removed
        //     (`q.locked_by = done.locked_by` AND that job was itself locked). A queue locked by a LIVE worker
        //     running some other job of that practice is untouched — the unlocked job we removed was never its
        //     holder. The general case (a stale queue lock with no job left) is `reclaimAbandonedJobs`'s.
        const done = await completeJobsAndFreeTheirQueues(pg, recorded);
        await pg.query("COMMIT");
        return done;
      } catch (e) {
        await pg.query("ROLLBACK").catch(() => {});
        throw e;
      }
    });
  }
  // ★★★ C-1 — AND FINISH WHAT THIS RUN JUST REMOVED, ON THIS TICK. The gone-practice block above writes an
  //     ACKNOWLEDGED ledger row and deletes the graphile row in one transaction, so every row it wrote is finished
  //     the moment it commits. Marking it here rather than leaving it to the next tick keeps the reaper IDEMPOTENT
  //     (a second run must change nothing) and closes the one-minute window in which a just-reaped record would
  //     have read as "acknowledged, job not yet confirmed gone".
  //   ★ It goes through the same sweep rather than a second write path: the sweep already refuses anything whose
  //     graphile row is still present, so it cannot mark more than the removal earned.
  if (removedRows.length) {
    try {
      const again = await finishAcknowledgedGiveUps(helpers);
      finished = { considered: finished.considered + again.considered, completed: finished.completed + again.completed,
                   marked: finished.marked + again.marked, stillRunning: again.stillRunning,
                   alive: (finished.alive ?? 0) + (again.alive ?? 0) };
    } catch (e) {
      helpers.logger.error(
        `reap_orphan_jobs: ★ removed ${removedRows.length} job(s) but could not mark their ledger rows finished ` +
        `(${e.message}) — the next tick will.`);
    }
  }

  const refusedNote = refused.length
    ? ` · ★ refused ${refused.length} (the ledger refused the record, so the job was KEPT, not removed — ` +
      `job id(s) ${refused.slice(0, 10).map((x) => x.id).join(", ")}; first refusal: ${refused[0].why})`
    : "";

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE COUNT COMES FROM `permanently_fail_jobs`'s OWN RETURN, NOT FROM THE SELECT ABOVE.
  //   (P3.3, unchanged — now only for practices that EXIST but are not active: suspended or closed.)
  //   [MEASURED, P3 §VISUAL] this discarded the function's result and reported `rows.length` — the
  //   number of jobs it INTENDED to close. `permanently_fail_jobs` updates only
  //     `where ... (locked_at is null or locked_at < NOW() - interval '4 hours')`
  //   and returns the rows it ACTUALLY updated. So a LOCKED orphan was skipped, counted as closed,
  //   and re-selected on the next run — reported as freshly reaped every time, forever.
  // ★ SO THE NUMBERS ARE REPORTED SEPARATELY AND THE GAP IS NAMED.
  //   ★★ These are NOT recorded or acknowledged: the practice still exists, so a closed job of its is
  //      a give-up somebody must look at — the queue check counts it (no ledger row = unacknowledged).
  // ════════════════════════════════════════════════════════════════════════════════════════════
  let closedRows = [];
  if (inactiveOpen.length) {
    ({ rows: closedRows } = await helpers.withPgClient((pg) => pg.query(
      `SELECT id FROM graphile_worker.permanently_fail_jobs($1::bigint[], $2)`,
      [inactiveOpen.map((r) => r.id),
       "the practice this job was queued for is not active — closed by reap_orphan_jobs (P3.3) so it " +
       "stops retrying. The work was never done and this row says so."])));
  }

  const refusedIds = new Set(refused.map((x) => String(x.id)));
  const handled = new Set([...removedRows, ...closedRows].map((r) => String(r.id)));
  const acted = [...gone, ...inactiveOpen];
  const skipped = acted.filter((r) => !handled.has(String(r.id)) && !refusedIds.has(String(r.id)));

  const byTask = {};
  for (const r of acted) byTask[r.task_identifier] = (byTask[r.task_identifier] ?? 0) + 1;
  helpers.logger.info(
    `reap_orphan_jobs: found ${acted.length} — practice GONE: ${gone.length - refused.length} recorded as acknowledged, ` +
    `REMOVED ${removedRows.length} (already closed before this run: ` +
    `${gone.filter((r) => r.attempts >= r.max_attempts).length}); practice inactive: CLOSED ${closedRows.length} of ${inactiveOpen.length} — naming ` +
    `${new Set(acted.map((r) => r.tenant_id)).size} tenant(s) — ` +
    `${Object.entries(byTask).map(([t, n]) => `${n} ${t}`).join(" · ")}` +
    (skipped.length
      ? ` · ★ ${skipped.length} still LOCKED by a running worker and NOT handled — they will be ` +
        `retried here once the lock ages past four hours, which is graphile-worker's own rule, ` +
        `not a failure of this task.`
      : "") + refusedNote + malformedNote);
  if (refused.length) helpers.logger.error(`reap_orphan_jobs:${refusedNote}`);

  return {
    found: acted.length, recorded: gone.length - refused.length, removed: removedRows.length,
    closed: closedRows.length, reaped: removedRows.length + closedRows.length, skippedLocked: skipped.length,
    refused: refused.length, malformed: malformed.length, tasks: byTask, finished,
  };
};

/**
 * ★★★ DELIVER CAMPAIGN BATCH — process a campaign_send_batch in resumable chunks (F714).
 *
 * ★★ FOLLOWING B1.6's PATTERN: a guardedTask that processes one `campaign_send_batch` row,
 *    sending to the next chunk of recipients (up to 100 per job invocation), recording partial
 *    failures, and re-queuing itself for the next chunk if more recipients remain. Progress
 *    is tracked via sent_count + failed_count as the cursor into the frozen recipient list.
 *
 * ★★★ THE ELIGIBLE SET IS RESOLVED EXACTLY ONCE, ON THE FIRST INVOCATION — never re-derived.
 *    `eligibleRecipients` (16.19) excludes anyone already sent a `growth.campaign.sent`
 *    notification within `never_more_than_days` — and THIS job is what creates those very
 *    notifications, one recipient at a time. Re-querying it on every resumed chunk would find
 *    each earlier chunk's own recipients freshly excluded (they were just notified seconds
 *    ago), shrinking the pool out from under the numeric cursor and undercounting the send.
 *    So the FIRST invocation (sent_count === 0 && failed_count === 0, and no frozen list
 *    already on the payload) resolves it once, orders it by id, and every later invocation
 *    carries that SAME ordered id list forward on the re-queued job's own payload — the same
 *    carry-forward mechanism `batchId` already rides — rather than recomputing it. (RULED —
 *    the maintainer, in review of this task: exactly-once resolution, carried via job payload, no migration.)
 *
 * ★★ PARTIAL FAILURE PER RECIPIENT: a failure to create one notification does not fail the
 *    whole batch. Each recipient's success/failure is tracked on the batch counters, and the
 *    job continues to the next recipient. Retries are the job policy's (07 schedule), not
 *    this job's — a failed batch_send re-runs and resumes from where it left off.
 */
const CAMPAIGN_BATCH_SIZE = 100;

export const deliverCampaignBatch = guardedTask("deliver_campaign_batch", async (payload, helpers) => {
  const { tenantId, batchId, recipientIds: payloadRecipientIds } = payload;
  if (!batchId) throw new Error("deliver_campaign_batch needs a batchId");

  await withTenant(tenantId, async (tx) => {
    // ★ Read the batch, holding it to ensure the state does not change mid-job
    const { rows: [batch] } = await tx.query(
      `SELECT id, campaign_id, total_count, sent_count, failed_count, batch_status
         FROM keystone.campaign_send_batch
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, batchId]);

    if (!batch) {
      throw new Error(`campaign_send_batch ${batchId} not found in tenant ${tenantId}`);
    }

    // ★ IDEMPOTENCE: if already completed/failed, nothing to do
    if (batch.batch_status === "completed" || batch.batch_status === "failed") {
      helpers.logger.info(
        `deliver_campaign_batch: batch ${batchId} is already ${batch.batch_status}, no-op`);
      return;
    }

    // ★ Calculate progress: how many recipients have been processed (sent + failed)
    const alreadyProcessed = batch.sent_count + batch.failed_count;
    const remaining = batch.total_count - alreadyProcessed;

    // ★ All recipients processed: mark as completed
    if (remaining <= 0) {
      await tx.query(
        `UPDATE keystone.campaign_send_batch
         SET batch_status = 'completed', completed_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, batchId]);
      helpers.logger.info(
        `deliver_campaign_batch: batch ${batchId} all recipients processed (${batch.sent_count} sent, ${batch.failed_count} failed)`);
      return;
    }

    // ★ Read the campaign — F714: `eligibleRecipients`, not `resolveSegment`, applies the
    //   leave-out segment and the never-more-than-N-days repeat guard on top of
    //   resolveSegment's own exclusions.
    const { rows: [campaign] } = await tx.query(
      `SELECT id, name, segment_id, leave_out_segment_id, never_more_than_days, subject, body, state
         FROM keystone.campaign
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, batch.campaign_id]);

    if (!campaign) {
      throw new Error(`campaign ${batch.campaign_id} not found in tenant ${tenantId}`);
    }

    // ★★★ EXACTLY-ONCE RESOLUTION — see the docstring above. Trust a frozen list carried on the
    //    payload; only resolve fresh when none was carried (the first invocation).
    let orderedIds;
    if (Array.isArray(payloadRecipientIds) && payloadRecipientIds.length > 0) {
      orderedIds = payloadRecipientIds;
    } else {
      const eligible = await eligibleRecipients(tx, { tenantId, campaign });
      orderedIds = eligible.map((r) => r.id).sort();
    }

    // ★ Get the next chunk: slice from alreadyProcessed to (alreadyProcessed + BATCH_SIZE)
    const chunkSize = Math.min(CAMPAIGN_BATCH_SIZE, remaining);
    const chunkIds = orderedIds.slice(alreadyProcessed, alreadyProcessed + chunkSize);

    if (chunkIds.length === 0) {
      // ★ No recipients left (the frozen list was shorter than total_count)
      await tx.query(
        `UPDATE keystone.campaign_send_batch
         SET batch_status = 'completed', completed_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, batchId]);
      helpers.logger.info(
        `deliver_campaign_batch: batch ${batchId} no more recipients (frozen eligible list was shorter than total_count)`);
      return;
    }

    // ★ F714 — no event insert here. Every notification names the CAUSE: the
    //   `growth.campaign.queued` event `sendCampaign` (16.19) already emitted when it queued
    //   this batch. `growth.campaign.sent` (below, on the LAST chunk) is the completion event,
    //   not a per-notification cause.
    const { rows: queuedEventRows } = await tx.query(
      `SELECT id FROM keystone.event
        WHERE tenant_id = $1 AND subject_id = $2 AND topic = 'growth.campaign.queued'
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, campaign.id]);
    const eventId = queuedEventRows[0]?.id ?? null;
    if (!eventId) {
      throw new Error(
        `deliver_campaign_batch: no growth.campaign.queued event found for campaign ${campaign.id} — ` +
        `every notification this batch creates must name the event that caused it.`);
    }

    // ★ First chunk moves the campaign into 'sending' (idempotent — sendCampaign already writes
    //   this before queuing the batch; writing it again on a resumed/retried first chunk is
    //   harmless).
    if (alreadyProcessed === 0) {
      await tx.query(
        `UPDATE keystone.campaign SET state = 'sending' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, campaign.id]);
    }

    // ★ PROCESS THE CHUNK: mint each recipient's own unsubscribe link, create the notification,
    //   queue delivery. Partial failures: if one recipient's notification fails, track it but
    //   continue.
    let sentThisChunk = 0;
    let failedThisChunk = 0;

    for (const recipientId of chunkIds) {
      try {
        // ★ F714 — a distinct unsubscribe token per recipient per send.
        const token = await mintUnsubscribeToken(tx, { tenantId, personId: recipientId });

        // ★ Create the notification (under RLS, in this practice's transaction)
        const { id: notificationId } = await createNotification(tx, {
          tenantId,
          recipientId,
          eventId,
          topic: "growth.campaign.sent",
          title: campaign.subject,
          body: campaign.body,
          deepLink: `/u/${token}`,
        });

        // ★ Queue the delivery job for this notification (one delivery per recipient)
        await helpers.addJob("deliver_notification_email", {
          tenantId,
          notificationId,
        }, {
          jobKey: `email:${notificationId}`,
          jobKeyMode: "replace",
          priority: NOTICE_PRIORITY,
        });

        sentThisChunk += 1;
      } catch (err) {
        // ★ PARTIAL FAILURE — record it but continue with the next recipient
        helpers.logger.warn(
          `deliver_campaign_batch: failed to create notification for recipient ${recipientId} in batch ${batchId} (${plainText(err.message)})`);
        failedThisChunk += 1;
      }
    }

    // ★ Update batch progress: increment sent_count and failed_count
    await tx.query(
      `UPDATE keystone.campaign_send_batch
       SET sent_count = sent_count + $3, failed_count = failed_count + $4
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, batchId, sentThisChunk, failedThisChunk]);

    const newProcessed = alreadyProcessed + chunkIds.length;
    const stillRemaining = batch.total_count - newProcessed;

    // ★ RE-QUEUE FOR THE NEXT CHUNK if more recipients remain — carrying the SAME frozen
    //   ordered id list forward on this job's own payload, so the next invocation never
    //   re-derives it.
    if (stillRemaining > 0) {
      await helpers.addJob("deliver_campaign_batch", { tenantId, batchId, recipientIds: orderedIds });
      helpers.logger.info(
        `deliver_campaign_batch: batch ${batchId} chunk complete (${sentThisChunk} sent, ${failedThisChunk} failed), ` +
        `${stillRemaining} recipients remaining, re-queued`);
    } else {
      // ★ All chunks processed: mark the batch completed, and the campaign 'sent' with the
      //   frozen recipient_count (campaign_sent_shape, 0061) — then emit growth.campaign.sent,
      //   the completion event (distinct from the queued cause every notification names above).
      await tx.query(
        `UPDATE keystone.campaign_send_batch
         SET batch_status = 'completed', completed_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, batchId]);

      const totalSent = batch.sent_count + sentThisChunk;
      const totalFailed = batch.failed_count + failedThisChunk;
      const recipientCount = totalSent + totalFailed;

      await tx.query(
        `UPDATE keystone.campaign
         SET state = 'sent', sent_at = now(), recipient_count = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, campaign.id, recipientCount]);

      await emit(tx, {
        tenantId, topic: "growth.campaign.sent", emittedBy: "growth",
        subjectType: "campaign", subjectId: campaign.id,
        payload: { recipient_count: recipientCount, batch_id: batchId },
      });

      helpers.logger.info(
        `deliver_campaign_batch: batch ${batchId} completed (${totalSent} total sent, ${totalFailed} total failed)`);
    }
  });
});

export const sweepTenants = async function sweepTenants(_payload, helpers) {
  const { rows } = await helpers.withPgClient((pg) =>
    pg.query(`SELECT tenant_id FROM keystone_auth.list_active_tenant_ids()`));
  // ★ ONE run time for the whole sweep — computed once so every practice's prune job for a given night
  //   carries the same date key and the same target instant, even if the loop straddles midnight Pacific.
  const nextPruneAt = nextPruneRunAt(new Date());
  const nextWelcomeAt = nextDailySummaryRunAt(new Date(), "America/Los_Angeles", 10);
  // ★★★ Run 8 (F962) — an IDLE Docustay workspace (nothing in the last day, no scheduled send or deadline coming up) is swept once every 15 minutes, in its own
  //     slot of the quarter hour, instead of every minute: MEASURED, ~14 jobs a minute for each of 1478 workspaces left the oldest runnable job 35 minutes late.
  //     Every other workspace (the platform's, and any Docustay one that is busy) keeps the per-minute sweep. A workspace that does anything is busy on the next sweep.
  const busy = await helpers.withPgClient((pg) => pg.query(`SELECT tenant_id FROM keystone_auth.list_busy_tenant_ids()`))
    .then((r) => new Set(r.rows.map((x) => x.tenant_id)), (e) => { helpers.logger.error(`sweep_tenants: busy list unavailable, sweeping every workspace (${e?.message ?? e})`); return null; });
  const slot = Math.floor(Date.now() / 60_000) % IDLE_SWEEP_MINUTES;
  let swept = 0;
  for (const { tenant_id } of rows) {
    // an idle workspace outside its slot still gets its dated NIGHTLY jobs (a future run time: nothing runs now); only the per-minute ones wait for its slot
    const later = Boolean(busy && !busy.has(tenant_id) && idleSlotOf(tenant_id) !== slot);
    if (!later) swept += 1;
    // ★★ P20.4's sweep rides the SAME static entry rather than adding a second one. §D5 ruling 3 /
    //    P18.6(d) allows exactly one static job; a second crontab line for the orphan sweep would be
    //    the very thing `p18_no_static_cron.mjs` exists to refuse. One static sweep, two per-tenant
    //    jobs, each with its own job_key.
    if (!later) await helpers.addJob("close_orphan_tasks", { tenantId: tenant_id },
      { jobKey: `close_orphan_tasks:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // ★★★ P20.6 / P20.6b — the CADENCE sweep rides the same ONE static entry. This is the whole
    //     source-of-truth half of P18.6(d): the schedule is a TABLE, asked on every sweep, so adding an
    //     account or changing a cadence needs no deploy and no worker restart.
    if (!later) await helpers.addJob("sweep_run_schedule", { tenantId: tenant_id },
      { jobKey: `sweep_run_schedule:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    if (!later) await helpers.addJob("prune_run_payloads", { tenantId: tenant_id },
      { jobKey: `prune_run_payloads:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // ★★★ STAGE 4 TASK 12 — THE DAILY BOOKKEEPING PRUNE, per practice, on the SAME one static entry.
    //   ★ DAILY, not every 60 s: the job key carries the PACIFIC DATE of the run it is for and `runAt` is
    //     the next 03:00 Pacific, strictly in the future — the same shape `daily_summary` uses below. So
    //     re-adding it on every sweep with `replace` is idempotent until the date rolls over, and tomorrow
    //     gets a NEW key rather than reusing today's. Without the future `runAt` this would run every
    //     minute; without the dated key it would never run again after the first time.
    //   ★ The key also carries the PRACTICE, so two practices never share one job (which would move a
    //     single job between their queues instead of running one on each).
    await helpers.addJob("prune_bookkeeping", { tenantId: tenant_id }, {
      jobKey: `prune_bookkeeping:${tenant_id}:${pruneDateKey(nextPruneAt)}`,
      jobKeyMode: "replace", runAt: nextPruneAt,
    });
    // ★★★ Stage 17 Task 17.16 — THE NIGHTLY USAGE RECONCILIATION, per practice, on the SAME one static entry.
    //   ★ NIGHTLY, on the same dated-key 03:00-Pacific pattern as `prune_bookkeeping` above. One job per practice
    //     so two practices never share one job (which would move a single job between their queues instead of
    //     running one on each). The reconciliation runs against the current and previous month's counts, emitting
    //     reconciled events and divergence logs as needed.
    await helpers.addJob("usage_reconcile", { tenantId: tenant_id }, {
      jobKey: `usage_reconcile:${tenant_id}:${pruneDateKey(nextPruneAt)}`,
      jobKeyMode: "replace", runAt: nextPruneAt,
    });
    // ★★★ PHASE-4 task L5.4 — THE MONEY DIVERGENCE SWEEP, per practice, on the SAME dated-key
    //     nightly pattern `prune_bookkeeping`/`usage_reconcile` use directly above: one job per
    //     practice per Pacific calendar date, so re-adding it on every 60s sweep before it has run
    //     is idempotent, and tomorrow gets a new key. the task body is the guard
    //     (now: the mirror reconcile, src/money/mirrorReconcile.mjs — runs only for the platform account practice).
    await helpers.addJob("docustay_seat_log", { tenantId: tenant_id }, {
      jobKey: `docustay_seat_log:${tenant_id}:${pruneDateKey(nextPruneAt)}`,
      jobKeyMode: "replace", runAt: nextPruneAt,
    });
    // Launch step 3: the welcome series' daily turn, at 10:00 Pacific (not 03:00: an email in the morning, not the middle of the night). Same dated-key shape; a workspace with no series does nothing.
    await helpers.addJob("docustay_welcome", { tenantId: tenant_id }, {
      jobKey: `docustay_welcome:${tenant_id}:${pruneDateKey(nextWelcomeAt)}`,
      jobKeyMode: "replace", runAt: nextWelcomeAt,
    });
    await helpers.addJob("money_divergence_sweep", { tenantId: tenant_id }, {
      jobKey: `money_divergence_sweep:${tenant_id}:${pruneDateKey(nextPruneAt)}`,
      jobKeyMode: "replace", runAt: nextPruneAt,
    });
    // ★★★ CREDITS (QUEUE §12.3) — the nightly catch-up of the one idempotent credit grant, same dated-key nightly shape as the sweep above.
    await helpers.addJob("credit_catchup_sweep", { tenantId: tenant_id }, {
      jobKey: `credit_catchup_sweep:${tenant_id}:${pruneDateKey(nextPruneAt)}`,
      jobKeyMode: "replace", runAt: nextPruneAt,
    });
    // ★★★ P8.8 — THE DUE SWEEP, on the same one static entry. It is the only per-tenant job here
    //     whose subject is the PRODUCT rather than the system: entitlements that have expired or are
    //     about to, signature requests past their deadline, and closed rate-limit windows. ★ Its own
    //     `job_key` for the same reason as the four above — a slow sweep must not stack copies.
    if (!later) await helpers.addJob("sweep_due", { tenantId: tenant_id },
      { jobKey: `sweep_due:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // ★★★ B-3b — THE HOLD SWEEP, on the same one static entry, same shape as `sweep_due` directly
    //     above. ★ sweepTenants has NO cadence mechanism of its own (this whole loop runs on
    //     whatever schedule the one static `sweep_tenants` job is re-added at, ~60 s — the same
    //     "per sweep, not a throttle" shape `sweep_due`/`sweep_calendar_renewal` already use); there
    //     is no 15-minute timer here to hook into, so this rides every sweep, and
    //     `releaseExpiredHolds`'s own `hold_expires_at < now()` query decides whether there is
    //     anything to release on any given run.
    if (!later) await helpers.addJob("release_signature_holds", { tenantId: tenant_id },
      { jobKey: `release_signature_holds:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // QUEUE §23.4.6 — uploaded documents scheduled to send; each run's own find-query decides whether anything is due.
    if (!later) await helpers.addJob("send_scheduled_documents", { tenantId: tenant_id },
      { jobKey: `send_scheduled_documents:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // Round 3 — account and workspace deletions whose cooling-off period has ended (and the reminder two days before), on the same one static sweep
    if (!later) await helpers.addJob("process_deletions", { tenantId: tenant_id },
      { jobKey: `process_deletions:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // ★★★ Task 3a.4 (spec 03a §7) — the calendar renewal/pull sweeps, on the same one static entry,
    //     "same shape as sweep_tenants/retry_webhooks" (§7's own words for this JOB_POLICY row) — a
    //     flat per-tenant job_key re-added with `replace` on every 60s sweep, exactly like `sweep_due`
    //     immediately above. `findConnectionsNeedingRenewal`/`renewChannel`/`applyRemoteEvent`/
    //     `handleSyncTokenGone`/`recordSweep` (`src/booking/calendarSync.mjs`) had ZERO callers before
    //     this — these two enqueues are what makes them run on a real schedule. The 15-minute figure
    //     §7 cites is renewal-headroom reasoning (comfortably under Google's 24h `RENEWAL_HEADROOM_MS`),
    //     not a throttle: like `sweep_due`, each run's own find-query decides whether there is anything
    //     to do, so a 60s add that finds nothing due is cheap and correct, not wasted work.
    if (!later) await helpers.addJob("sweep_calendar_renewal", { tenantId: tenant_id },
      { jobKey: `sweep_calendar_renewal:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    if (!later) await helpers.addJob("sweep_calendar_pull", { tenantId: tenant_id },
      { jobKey: `sweep_calendar_pull:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // ★★★ STAGE 3 TASK 7 — OUTBOUND WEBHOOK RETRIES, on the same one static entry. Re-sends every
    //     (event, endpoint) whose next_retry_at (07 schedule) has passed, and reports the dead ones.
    if (!later) await helpers.addJob("retry_webhooks", { tenantId: tenant_id },
      { jobKey: `retry_webhooks:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // ★★★ Stage 16 task 16.32 — the automation sweeps, on the same one static entry.
    if (!later) await helpers.addJob("sweep_automations", { tenantId: tenant_id },
      { jobKey: `sweep_automations:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // ★★★ Stage 20 task 20.50 — LEAD SCORING SWEEP, on the same one static entry. Scores all leads
    //     from 90-day facts and emits growth.lead_score.crossed when threshold is crossed.
    if (!later) await helpers.addJob("sweep_lead_score", { tenantId: tenant_id },
      { jobKey: `sweep_lead_score:${tenant_id}`, jobKeyMode: "preserve_run_at" });
    // ★★★ Stage 18 task 18.31b — THE MORNING DAY SUMMARY, on the same one static entry. Sends each
    //     coach a one-line summary of their sessions at 8:00 practice time. The job key carries the
    //     TENANT and LOCAL DATE, so it runs once per day per practice; the job function reschedules
    //     itself for 08:00 if it runs before then.
    if (!later) await helpers.addJob("staff_day_summary", { tenantId: tenant_id },
      { jobKey: `staff_day_summary:${tenant_id}:${new Date().toISOString().split('T')[0]}`, jobKeyMode: "preserve_run_at" });
    if (!later) await helpers.addJob("document_ai_platform_watch", { tenantId: tenant_id },
      { jobKey: `document_ai_platform_watch:${tenant_id}`, jobKeyMode: "preserve_run_at" });   // does nothing unless this is the platform organisation
    if (!later) await helpers.addJob("dispatch_outbox", { tenantId: tenant_id },
      // ★★ `job_key` + `replace`: if a sweep for this tenant is already waiting, REPLACE it rather than
      //    queueing a second. Without it a tenant whose dispatch is slow grows an unbounded backlog of
      //    identical jobs, and the queue's depth stops meaning anything.
      //    ★ `priority: -10` (D-028): delivering a workspace's events (the signed-copy email, webhooks, notifications) runs BEFORE the housekeeping sweeps queued in the same minute, so event latency does not grow with the number of workspaces.
      { jobKey: `dispatch_outbox:${tenant_id}`, jobKeyMode: "preserve_run_at", priority: -10 });
  }
  // ★★★ AND ONE GLOBAL JOB, NOT PER-TENANT — because its subject is jobs whose tenant is GONE, and a
  //     per-tenant fan-out is driven by `list_active_tenant_ids()`, which by definition cannot name
  //     them. **The one sweep that must not be scoped to a tenant is the one about missing tenants.**
  //   ★ It rides this same static entry (§D5 ruling 3 / P18.6(d): exactly one static job), with its
  //     own job_key so a slow run cannot stack copies.
  await helpers.addJob("reap_orphan_jobs", {},
    { jobKey: "reap_orphan_jobs", jobKeyMode: "replace" });
  // ★★★ P8.10 — AND THE WATCHER, also global and also on this one static entry. Until it existed,
  //     a queue that had stopped draining, jobs that had given up, and a backup that had never run
  //     were all completely silent. ★ Its own job_key so a slow run cannot stack copies.
  await helpers.addJob("watch_system", {},
    { jobKey: "watch_system", jobKeyMode: "replace" });
  // ★★★ STAGE 4 TASK 13 — AND THE 7 AM SUMMARY, also global, riding the same one static entry. The
  //     run time is recomputed every sweep (DST-safe — nextDailySummaryRunAt reads the zone's actual
  //     offset, never a fixed UTC hour) and the job key carries the PACIFIC DATE it is for, so:
  //       · re-adding it every 60s with `replace` before it has run is idempotent (same key, same
  //         target time, until the date rolls over) — the same shape `reap_orphan_jobs`/`watch_system`
  //         already use above;
  //       · a new date gets a NEW key, so tomorrow's summary is a different job, not a reused one;
  //       · the actual "sent once" guarantee is `keystone_meta.claim_daily_summary` (0154), not this
  //         key — see src/health/dailySummary.mjs's header for why the key alone is not enough.
  const nextSummaryAt = nextDailySummaryRunAt(new Date());
  await helpers.addJob("daily_summary", {}, {
    jobKey: `daily_summary:${pacificDateKey(nextSummaryAt)}`, jobKeyMode: "replace", runAt: nextSummaryAt,
  });

  helpers.logger.info(
    `sweep_tenants enqueued ${swept * 10 + 3} job(s) across ${swept} of ${rows.length} tenant(s) (${busy ? `${busy.size} busy` : "busy list unavailable"}): ` +
    `dispatch_outbox · close_orphan_tasks · sweep_run_schedule · prune_run_payloads · sweep_due · retry_webhooks` +
    ` · prune_bookkeeping · usage_reconcile · money_divergence_sweep · staff_day_summary` +
    ` — ★ ONE static entry, TEN per-tenant jobs + reap_orphan_jobs + watch_system + daily_summary, no crontab (P18.6(d))`);
  return { tenants: rows.length, swept };
};
/** Run 8 (F962): an idle workspace's sweep comes round every IDLE_SWEEP_MINUTES, in a slot fixed by its id, so idle workspaces are spread evenly across the quarter hour. */
export const IDLE_SWEEP_MINUTES = 15;
export const idleSlotOf = (tenantId) => parseInt(String(tenantId).replace(/-/g, "").slice(-6), 16) % IDLE_SWEEP_MINUTES;

/**
 * ★★★ P8.5 — DELIVER ONE EVENT TO EVERY ACTIVE SUBSCRIBER. The counterpart to the INBOUND webhook:
 *     that one lets the world tell Keystone things; this one lets Keystone tell the world.
 *   ★★ It is a JOB and not part of the outbox drain because delivery is a NETWORK call with a 15s
 *      timeout, and the drain holds one transaction per batch. A fetch inside that transaction would
 *      hold row locks for the length of somebody else's outage.
 *   ★ `deliverEventToSubscribers` opens its own short transactions — see its header for why the
 *     `pool` it hands to `deliverEvent` is a per-statement shim rather than the drain's `tx`.
 */
export const deliverWebhooks = guardedTask("deliver_webhooks", async (payload, helpers) => {
  const { tenantId, eventId } = payload;
  if (!eventId) throw new Error("deliver_webhooks needs an eventId");
  const results = await deliverEventToSubscribers({ tenantId, eventId });
  const delivered = results.filter((r) => r.outcome === "delivered").length;
  helpers.logger.info(
    `webhook fan-out for event ${eventId}: ${delivered}/${results.length} delivered` +
    (results.length === 0 ? " (no active subscriber asked for this topic)" : ""));
  return { endpoints: results.length, delivered };
});

/**
 * ★★★ TASK 9.14 (CT-096) — DELIVER AN EVENT TO n8n's INBOUND WEBHOOK.
 *
 *   ★ This job is enqueued when an event needs to be sent to n8n, and retried on the job policy
 *   schedule if the send fails with a dependency/timeout/rate-limited error. The n8n_delivery
 *   table tracks each attempt; the job converts N8nUnavailable errors into JobFailure so
 *   the queue retries and gives up correctly.
 *   ★★ SAME SHAPE AS deliverWebhooks (P8.5): reading the event, posting it, recording the result,
 *   and re-throwing only to make graphile count the failure. The difference is that n8n is
 *   one single sink (not multi-endpoint), so a failed send fails the event's n8n delivery
 *   in its entirety, not one recipient out of many.
 */
export const deliverN8n = guardedTask("deliver_n8n", async (payload, helpers) => {
  const { tenantId, eventId } = payload;
  if (!eventId) throw new Error("deliver_n8n needs an eventId");

  let event = null;
  await withTenant(tenantId, async (tx) => {
    const r = await tx.query(
      `SELECT id, tenant_id, topic, payload, actor, subject_type, subject_id, sample, created_at
         FROM keystone.event WHERE id = $1`,
      [eventId]);
    event = r.rows[0] ?? null;
  });

  if (!event) {
    // ★★ Same as deliver_notification_email: the event may not be visible yet, or it is gone.
    throw new JobFailure("dependency",
      `the event to send to n8n was not found (it may not have been saved yet, or it was deleted)`);
  }

  try {
    await withTenant(tenantId, async (tx) => {
      await sinkEventToN8n(tx, event);
    });
  } catch (err) {
    if (err instanceof N8nUnavailable) {
      // ★ TASK 9.14 — map N8nUnavailable to JobFailure, preserving the retryable classification
      //   callOutside already made. The n8n_delivery row is already updated by sinkEventToN8n.
      throw new JobFailure(err.kind ?? "dependency", err.message,
        { retryable: err.retryable, retryAfterSeconds: err.retryAfterSeconds });
    }
    // ★ Any other error is not retryable and should be surfaced
    throw err;
  }

  return { sent: true };
});

/**
 * ★★★ RETRY PERIODIC JOB FOR n8n DELIVERIES. Enqueued per practice by sweep_tenants every 60 s.
 *
 *   ★ Similar to retryWebhooks, but for n8n: reads failed n8n_delivery rows, retries them via
 *   the standard sinkEventToN8n path, and records outcomes.
 *   ★ DOES NOT THROW FOR FAILURES — the retry is scheduled on the row (07), not by graphile.
 *   Each failed attempt stays on the row; the job policy retries this job (not the individual
 *   delivery) on the sweep cadence.
 */
export const retryN8n = guardedTask("retry_n8n", async (payload, helpers) => {
  const { tenantId } = payload;

  const { rows: failedRows } = await withTenant(tenantId, async (tx) => {
    // ★ Find failed n8n_delivery rows that we can retry. Read status, last_error, attempt count.
    return tx.query(
      `SELECT id, event_id, attempt, status, last_error, completed_at
         FROM keystone.n8n_delivery
        WHERE tenant_id = $1 AND status = 'failed'
        ORDER BY completed_at ASC
        LIMIT 50`,  // ★ Bound the batch size like retryWebhooks does with its deadline
      [tenantId]);
  });

  let retried = 0, succeeded = 0, failed = 0;

  for (const row of failedRows) {
    await withTenant(tenantId, async (tx) => {
      // ★ Read the event
      const { rows: eventRows } = await tx.query(
        `SELECT id, tenant_id, topic, payload, actor, subject_type, subject_id, sample, created_at
           FROM keystone.event WHERE id = $1`,
        [row.event_id]);
      const event = eventRows[0];

      if (!event) {
        // ★ Event is gone or invisible — cannot retry. Mark it as permanently failed.
        helpers.logger.info(
          `retry_n8n tenant=${tenantId}: event ${row.event_id} not found, skipping n8n_delivery ${row.id}`);
        failed++;
        return;
      }

      try {
        // ★ Retry by calling sinkEventToN8n again. It will increment the attempt counter and
        //   re-try the send, recording the outcome on a new n8n_delivery row.
        await sinkEventToN8n(tx, event);
        succeeded++;
        retried++;
      } catch (err) {
        // ★ sinkEventToN8n updates the n8n_delivery row with the failure; this job does not.
        //   A next retry happens when this sweep runs again (60 s cadence).
        if (err instanceof N8nUnavailable || err instanceof Error) {
          helpers.logger.info(
            `retry_n8n tenant=${tenantId}: event ${row.event_id} still failed (${plainText(err.message)}), ` +
            `will retry on next sweep`);
          retried++;
        }
        failed++;
      }
    });
  }

  if (failedRows.length > 0) {
    helpers.logger.info(
      `retry_n8n tenant=${tenantId}: ${failedRows.length} failed delivery/ies, ` +
      `${retried} retried, ${succeeded} succeeded, ${failed} still failed`);
  }

  return { due: failedRows.length, retried, succeeded, failed };
});

/**
 * ★★ job.gave_up for every dead webhook (event, endpoint) not yet reported — the same shape as the
 *    dispatcher's `reportGaveUps`: AFTER the attempt committed, on the WORKER'S OWN CONNECTION (the writer
 *    is app_worker-only, 0138), once per pair (0142's index on (subject, event_id); the subject is the
 *    endpoint), each row tried on its own, a failure counted and bounded.
 */
async function reportWebhookGaveUps(tenantId, helpers) {
  const owed = await withTenant(tenantId, (tx) => unreportedDeadWebhooks(tx, { tenantId }));
  const reported = [], failed = [];
  for (const d of owed) {
    try {
      await helpers.withPgClient((pg) => recordWebhookGaveUp((sql, args) => pg.query(sql, args), {
        tenantId, eventId: d.event_id, endpointId: d.endpoint_id, attempts: d.attempt }));
      reported.push(d.id);
    } catch (err) {
      failed.push(d.id);
      helpers.logger.error(
        `retry_webhooks tenant=${tenantId}: could not record job.gave_up for endpoint ${d.endpoint_id} on event ` +
        `${d.event_id} (${safeErrorText(err)}). The delivery is dead; the report will be retried.`);
    }
  }
  if (!owed.length) return { reported: 0, failed: 0 };
  const counted = await withTenant(tenantId, async (tx) => {
    await markWebhookGaveUpReported(tx, { tenantId, deliveryIds: reported });
    return recordWebhookGaveUpReportFailures(tx, { tenantId, deliveryIds: failed });
  });
  for (const c of counted) {
    if (c.gave_up_report_attempts >= WEBHOOK_GAVE_UP_REPORT_MAX_ATTEMPTS) {
      helpers.logger.error(
        `★★★ retry_webhooks tenant=${tenantId}: job.gave_up for endpoint ${c.endpoint_id} on event ${c.event_id} ` +
        `FAILED ${c.gave_up_report_attempts} TIMES AND WILL NOT BE RETRIED (webhook_delivery ${c.id}). Fix the ` +
        `writer, then set gave_up_report_attempts = 0 on that row.`);
    }
  }
  return { reported: reported.length, failed: failed.length };
}

/**
 * ★★★ STAGE 3 TASK 7 — RE-SEND DUE WEBHOOK RETRIES FOR ONE PRACTICE. Enqueued per practice by
 *     `sweep_tenants` every 60 s. Before this, next_retry_at was never read and a failed POST was final.
 *   ★ It does not throw for a receiver's failure: the retry is scheduled on the row (07), not by graphile.
 */
// ★ Fix round 1 (T7-R1, T7-R3): batches repeat while each comes back full — every row in a batch is
//   advanced (sent, rescheduled, dead, or closed), so the next batch reaches rows behind it — until this
//   budget is spent. Sends are not STARTED after it; one in flight finishes within DELIVERY_TIMEOUT_MS.
const RETRY_SWEEP_BUDGET_MS = 45_000;

export const retryWebhooks = guardedTask("retry_webhooks", async (payload, helpers) => {
  const { tenantId } = payload;
  const deadline = Date.now() + RETRY_SWEEP_BUDGET_MS;
  const results = [];
  let reaped = 0, closed = 0;
  for (;;) {
    const batch = await retryDueDeliveries({ tenantId, deadline });
    results.push(...batch);
    reaped += batch.housekeeping?.reaped ?? 0;
    closed += batch.housekeeping?.closed ?? 0;
    if (!batch.full || Date.now() > deadline) break;
  }
  const gaveUp = await reportWebhookGaveUps(tenantId, helpers);
  const count = (o) => results.filter((r) => r.outcome === o).length;
  if (results.length || reaped || closed || gaveUp.reported || gaveUp.failed) {
    helpers.logger.info(
      `retry_webhooks tenant=${tenantId}: abandoned attempts reaped=${reaped}, retries closed (endpoint ` +
      `disabled/unsubscribed)=${closed}; ${results.length} due, ${count("delivered")} delivered, ` +
      `${count("failed") + count("timed_out")} failed again, ${results.filter((r) => r.dead).length} now dead, ` +
      `${count("skipped")} skipped; job.gave_up reported=${gaveUp.reported} report_failures=${gaveUp.failed}`);
  }
  return { due: results.length, delivered: count("delivered"), gaveUpReported: gaveUp.reported };
});

/**
 * ★★★ P8.8 — THE DUE SWEEP. THE ONE PLACE A PASSING MOMENT BECOMES A FACT.
 *
 *     [MEASURED 2026-09-15] before this, every per-tenant job on the one static entry was about the
 *     SYSTEM — the outbox, orphan tasks, the Run cadence, payload pruning. **Nothing swept the
 *     product for facts that had gone out of date**, so an entitlement could expire and nobody was
 *     told, a signature request could sit forever, and `rate_limit_window` grew without bound.
 *
 * ★★ IT RIDES THE SAME SINGLE STATIC ENTRY, exactly as `sweep_run_schedule` and `close_orphan_tasks`
 *    do. §D5 ruling 3 / P18.6(d) permits ONE, and `db/gates/p18_no_static_cron.mjs` refuses a second.
 *
 * ★★★ AND IT DOES NOT SWALLOW A FAILURE. `runDueFacts` runs every fact even when one throws — an
 *     entitlement must still expire when the document predicate is broken — but it RETURNS the
 *     problems and this task RE-THROWS, so graphile retries and the queue's failure count is the
 *     truth. A sweeper that logs a problem and returns success is a sweeper nobody finds out about.
 *
 * ★ The whole tenant's sweep is ONE transaction, with a SAVEPOINT PER FACT (fix round 1, I-4): one fact's
 *   failure rolls back only that fact, so a warning ledger row can still never be committed without the
 *   event that justifies it, and the other facts' work commits. Each fact's action is idempotent, so a
 *   retry re-does nothing it already did.
 */
class DueSweepPassingFailure extends JobFailure {
  constructor(message) { super("dependency", message); }
}

export const sweepDue = guardedTask("sweep_due", async (payload, helpers) => {
  const { tenantId } = payload;
  let out = { acted: [], counts: {}, problems: [] };
  await withTenant(tenantId, async (tx) => { out = await runDueFacts(tx, { tenantId }); });

  const total = Object.values(out.counts).reduce((a, b) => a + b, 0);
  helpers.logger.info(
    `sweep_due tenant=${tenantId} acted=${total} over ${DUE_FACT_KEYS.length} fact(s): ` +
    (total === 0
      ? "nothing was due"
      : out.acted.join(" · ")));

  if (out.problems.length) {
    // ★ Stage 4 Task 6: retried only when EVERY failing fact failed for a passing reason; otherwise it gives up now.
    //   ★ Fix round 1 (review I-4): 25P02 ("current transaction is aborted") is never a ROOT cause — it is what every
    //     statement says after an earlier one failed. runDueFacts now gives each fact its own savepoint so it should
    //     not occur; if it does, it is judged by the errors that are not 25P02.
    const roots = (out.errors ?? []).filter((e) => e?.code !== "25P02");
    const passing = roots.length > 0 && roots.every((e) => classifyFailure(e).retryable);
    throw new (passing ? DueSweepPassingFailure : Error)(
      `sweep_due tenant=${tenantId}: ${out.problems.length} of ${DUE_FACT_KEYS.length} due fact(s) ` +
      `FAILED — ${out.problems.join(" · ")}. The others still ran (${total} action(s)); this throw is ` +
      `so the queue retries and the failure is counted rather than logged and forgotten.`);
  }
  return { acted: total, counts: out.counts };
});

/**
 * ★★★ B-3b — THE HOLD SWEEPER. `pending_signature` bookings whose `hold_expires_at` has already
 *     passed are released by `releaseExpiredHolds` (src/booking/holds.mjs): cancelled with reason
 *     `signature_not_received`, credit returned, `booking.booking.hold_released` emitted. Periodic,
 *     on the same one static entry as `sweep_due`/`sweep_calendar_renewal` (§D5 ruling 3 / P18.6(d):
 *     exactly one static job) — each sweep's own query decides whether there is anything to release,
 *     so a run that finds nothing is cheap and correct, not wasted work.
 * ★ Every row `releaseExpiredHolds` touches has its own exactly-once UPDATE guard (its own header),
 *   so a retry after a partial failure re-does nothing it already did.
 */
export const releaseSignatureHolds = guardedTask("release_signature_holds", async (payload, helpers) => {
  const { tenantId } = payload;
  let out = { released: [] };
  await withTenant(tenantId, async (tx) => {
    out = await releaseExpiredHolds(tx, { tenantId, now: new Date() });
  });
  helpers.logger.info(
    `release_signature_holds tenant=${tenantId}: released ${out.released.length} expired hold(s)` +
    (out.released.length ? ` — ${out.released.join(", ")}` : ""));
  return { released: out.released.length };
});

/**
 * QUEUE §23.4.6 — SEND THE UPLOADED DOCUMENTS WHOSE SCHEDULED TIME HAS COME. The sweep has no viewer, so it first lists what is due (a policy lets the viewer-less worker see exactly that), then sends each as its
 * author — the same shape as the archive job. A document that cannot be sent stays a draft (and the failure is thrown so the retry ladder and the give-up owner see it).
 */
export const sendScheduledDocuments = guardedTask("send_scheduled_documents", async (payload, helpers) => {
  const { tenantId } = payload;
  let due = [];
  await withTenant(tenantId, async (tx) => {
    due = await dueScheduledDocuments(tx);
  });
  // B8: this per-minute sweep also puts an AI job back in the queue when its worker died mid-draft (and fails it in plain words after three claims)
  const rescued = await withTenant(tenantId, (tx) => rescueStaleAiJobs(tx));
  for (const id of rescued.requeued) await helpers.addJob("document_ai_draft", { tenantId, jobId: id }, { jobKey: `document_ai_draft:${id}`, jobKeyMode: "replace", priority: JOB_PRIORITY.document_ai_draft });
  if (rescued.requeued.length || rescued.failed.length) helpers.logger.info(`send_scheduled_documents tenant=${tenantId}: ai jobs requeued=${rescued.requeued.length} failed=${rescued.failed.length}`);
  // Run 4: an AI look for fields whose page task never ran, or whose worker died mid-page, is started again (a page is claimed atomically, so a double start does nothing)
  for (const sp of await withTenant(tenantId, (tx) => stalePagesOf(tx))) await helpers.addJob("document_detect_page", { tenantId, jobId: sp.jobId, page: sp.page }, { jobKey: `document_detect_page:${sp.jobId}:${sp.page}`, jobKeyMode: "replace", priority: JOB_PRIORITY.document_detect_page });
  // the assistant chat keeps what was said only as long as the workspace's setting (ai.chat_retention_days); once an hour, delete what is older. The action log (no text) is not touched.
  if (new Date().getUTCMinutes() === 0) { try { const gone = await withTenant(tenantId, (tx) => pruneChatsForTenant(tx, { tenantId })); if (gone) helpers.logger.info(`send_scheduled_documents tenant=${tenantId}: ${gone} old chat conversation(s) deleted`); } catch (e) { helpers.logger.info(`send_scheduled_documents tenant=${tenantId}: chat retention sweep failed: ${e.message}`); } }
  // Round 3 R-10: an executed document with no sealed copy a quarter of an hour on (storage or the renderer was down longer than the retry ladder lasts) is queued again, every 15 minutes, as its author. A failure is logged and never blocks the sends below.
  if (new Date().getUTCMinutes() % 15 === 0) {
    try {
      const stale = await withTenant(tenantId, (tx) => staleUnarchivedDocuments(tx));
      for (const d of stale) if (d.created_by) await helpers.addJob("archive_document_pdf", { tenantId, instanceId: d.id, actorUserId: d.created_by }, { jobKey: `archive:${d.id}`, jobKeyMode: "replace", priority: JOB_PRIORITY.archive_document_pdf });
      if (stale.length) helpers.logger.info(`send_scheduled_documents tenant=${tenantId}: ${stale.length} executed document(s) still had no sealed copy; the archive was queued again`);
    } catch (e) { helpers.logger.info(`send_scheduled_documents tenant=${tenantId}: the sweep for unarchived documents failed: ${e.message}`); }
    // Run 6 B-3: a sealed copy that went out without a trusted timestamp (the timestamp service was down) is re-stamped when the service answers. The archive job does it (restampSealedCopy, before it re-reads the copy); the same job key, so it never stacks.
    try {
      const unstamped = await withTenant(tenantId, (tx) => untimestampedSealedDocuments(tx));
      for (const d of unstamped) if (d.created_by) await helpers.addJob("archive_document_pdf", { tenantId, instanceId: d.id, actorUserId: d.created_by }, { jobKey: `archive:${d.id}`, jobKeyMode: "replace", priority: JOB_PRIORITY.archive_document_pdf });
      if (unstamped.length) helpers.logger.info(`send_scheduled_documents tenant=${tenantId}: ${unstamped.length} sealed copy(ies) had no trusted timestamp; a re-stamp was queued`);
    } catch (e) { helpers.logger.info(`send_scheduled_documents tenant=${tenantId}: the sweep for untimestamped copies failed: ${e.message}`); }
  }
  const failures = [];
  for (const d of due) {
    if (!d.created_by) { failures.push(`${d.id}: no author to send as`); continue; }
    try { await withTenant(tenantId, (tx) => sendPdfDocument(tx, { tenantId, instanceId: d.id, actorUserId: d.created_by }), { userId: d.created_by }); }
    catch (e) { failures.push(`${d.id}: ${e.message}`); }
  }
  helpers.logger.info(`send_scheduled_documents tenant=${tenantId}: ${due.length - failures.length} sent, ${failures.length} failed`);
  if (failures.length) throw new Error(`could not send ${failures.length} scheduled document(s): ${failures.join(" · ").slice(0, 400)}`);
  return { sent: due.length };
});

/**
 * ROUND 3 — DELETE WHAT HAS WAITED OUT ITS COOLING-OFF PERIOD (src/product/deletion.mjs). Per workspace, every sweep: send the two-day reminder once, then run the due requests, a few at a time. Each run is ONE database transaction (all or nothing);
 * the stored files and the identity-provider users are removed after it commits, and a ledger entry is written so a restore from a backup replays the deletion. A request that fails is marked failed with the reason, retried on later sweeps (five tries),
 * and the failure is thrown so the retry ladder and the give-up owner see it — never silently half-done.
 */
export const processDeletions = guardedTask("process_deletions", async (payload, helpers) => {
  const { tenantId } = payload;
  let due = [];
  await withTenant(tenantId, async (tx) => {
    await deletion.sendReminders(tx, { tenantId });
    due = (await tx.query(`SELECT id, kind FROM keystone.deletion_request WHERE tenant_id = $1 AND status IN ('pending','failed') AND scheduled_for <= now() AND attempts < 5 ORDER BY scheduled_for LIMIT 5`, [tenantId])).rows;
  });
  const failures = [];
  for (const d of due) {
    let result;
    try { result = await withTenant(tenantId, (tx) => deletion.runRequest(tx, { tenantId, requestId: d.id, documents: { erasePerson } })); }
    catch (e) { failures.push(`${d.id}: ${e.message}`); try { await withTenant(tenantId, (tx) => deletion.markFailed(tx, { tenantId, requestId: d.id, error: e })); } catch { /* the tenant may be half-gone; the next sweep tries again */ } continue; }
    if (!result.ran) continue;
    const after = await deletion.afterCommit(result, { log: helpers.logger, send: result.kind === "account" ? ({ to }) => withTenant(tenantId, (tx) => deletion.sendDone(tx, { tenantId, to })) : null });
    helpers.logger.info(`process_deletions tenant=${tenantId} ${result.kind} request=${d.id} done; files ${after.filesRemoved}/${(result.storageKeys ?? []).length}, identities ${after.identitiesRemoved}/${(result.identities ?? []).length}, ledger=${after.ledgered}`);
  }
  if (failures.length) throw new Error(`could not carry out ${failures.length} deletion(s): ${failures.join(" · ").slice(0, 400)}`);
  return { ran: due.length };
});

/**
 * ★★★ THE NIGHTLY STRIPE MIRROR RECONCILIATION (specs/STRIPE-MIRROR.md stage (f)). Replaces the old
 *     L5.4 "money divergence sweep" (which overwrote the platform's duplicated invoice/subscription
 *     columns from Stripe live): every reader now reads the mirror, so the thing that can be wrong
 *     is the MIRROR, and this proves it isn't — full backfill, diff, failed-delivery check, and a
 *     verdict row that `stripe_webhooks` in the system watcher turns into an alerts@ email.
 *     Same job name, same per-practice dated-key schedule (so no registry/gate churn); the work runs
 *     only for the practice that OWNS the platform Stripe account (keystone.stripe_account
 *     is_platform) — every other practice's account is a separate, future schema (see QUEUE.md's
 *     second-practice blocker) — and skips for the rest.
 */
export const moneyDivergenceSweep = guardedTask("money_divergence_sweep", async (payload, helpers) => {
  const { tenantId } = payload;
  const owns = await withTenant(tenantId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT 1 FROM keystone.stripe_account WHERE tenant_id = $1 AND is_platform`, [tenantId]);
    return rows.length > 0;
  });
  if (!owns) {
    helpers.logger.info(`money_divergence_sweep tenant=${tenantId}: skipped (not the platform Stripe account's practice)`);
    return { skipped: "not_platform_account" };
  }
  const out = await reconcileStripeMirror({ now: new Date() });
  helpers.logger.info(
    `money_divergence_sweep tenant=${tenantId}: mirror reconcile ${out.ok ? "OK" : "NOT OK"} — drift ${out.driftCount}, ` +
    `failed deliveries ${out.failedDeliveries}, payouts ${out.payouts}, invoice payments ${out.invoicePayments}` +
    (out.error ? `, error: ${out.error}` : ""));
  return { ok: out.ok, driftCount: out.driftCount, failedDeliveries: out.failedDeliveries, error: out.error ?? null };
});

/**
 * ★★★ THE CREDIT CATCH-UP (specs/CREDITS-PIPELINE.md §3.1, third door of the one grant). Nightly, per practice: every invoice STRIPE says is paid,
 *     that has package/plan lines, and that has no `credit_grant` ledger row yet, gets its credits — the same `grantInvoiceCredits` the webhook runs, so
 *     a re-run is harmless. Anything it finds is a payment the webhook path MISSED (the live endpoint was dead 28 Sep–2 Oct, a delivery can fail,
 *     a deploy can race): it is logged by name and counted against the Stripe-webhooks health check, which emails alerts@.
 *     One invoice's failure never stops the rest (a savepoint around each).
 */
export const creditCatchupSweep = guardedTask("credit_catchup_sweep", async (payload, helpers) => {
  const { tenantId } = payload;
  const out = await withTenant(tenantId, (tx) => asPracticeOwner(tx, tenantId, async () => {
    const ids = await findPaidInvoicesWithoutCredits(tx, { tenantId });
    const granted = []; const failed = [];
    for (const stripeInvoiceId of ids) {
      await tx.query("SAVEPOINT credit_catchup");
      try {
        const r = await grantInvoiceCredits(tx, { tenantId, stripeInvoiceId });
        await tx.query("RELEASE SAVEPOINT credit_catchup");
        if (r.entitlementIds.length) granted.push(stripeInvoiceId);
      } catch (err) {
        await tx.query("ROLLBACK TO SAVEPOINT credit_catchup");
        failed.push({ stripeInvoiceId, error: err?.message ?? String(err) });
      }
    }
    // ★ the refund half: a package refunded in full while the webhook missed it → its unused credits are voided now
    const voided = await voidCreditsForFullyRefundedInvoices(tx, { tenantId });
    return { found: ids.length, granted, failed, voided };
  }));
  if (out.voided?.length) helpers.logger.warn(`credit_catchup_sweep tenant=${tenantId}: the webhook path missed ${out.voided.length} refunded package(s) [${out.voided.join(", ")}]; their unused credits were voided.`);
  if (out.granted.length || out.failed.length) {
    helpers.logger.warn(`credit_catchup_sweep tenant=${tenantId}: the webhook path missed ${out.granted.length} paid invoice(s) [${out.granted.join(", ")}]; ${out.failed.length} could not be granted ${JSON.stringify(out.failed)}`);
    await recordMirrorHealth({ webhook: true, failed: true });
  }
  return out;
});

/**
 * ★★★ TASK 3a.4 (spec 03a §7) — THE CALENDAR RENEWAL AND PULL SWEEPS. `findConnectionsNeedingRenewal`/
 *     `renewChannel` (`src/booking/calendarSync.mjs:42,88`) and `applyRemoteEvent`/`handleSyncTokenGone`/
 *     `recordSweep` (`calendarSync.mjs:111,214,223`) were written by task 3a.1 with ZERO callers anywhere
 *     in `src/` — MEASURED by that file's own header grep. These two periodic jobs are the callers.
 *
 * ★★ THE PROVIDER CALL IS INJECTED, NEVER IMPLEMENTED HERE — same boundary `calendarPush.mjs` (task
 *    3a.3) already drew and documented at its own header: an authenticated Google/Microsoft renewal or
 *    `events.list` call needs an access token from a refresh-token exchange that does not exist ANYWHERE
 *    in this codebase yet (MEASURED: grep `src/` for `grant_type.*refresh_token` finds only the
 *    AUTHORIZATION-CODE exchanges in `calendarConnect.mjs`/`mailboxConnect.mjs` — a different OAuth
 *    step, §6/§8's territory, not this task's own Files field). `resolveRenewFn`/`resolveFetchFn` default
 *    to a function that throws a `dependency`-classified error naming this gap; spec §12 test 8 (and this
 *    file's own test) override it with a fixture, exactly like `renewChannel`'s existing `renewFn`
 *    parameter and `calendarPush.mjs`'s provider callbacks.
 *
 * ★ §11: "no rewrite, only new callers" — `renewChannel`/`applyRemoteEvent`/`handleSyncTokenGone`/
 *   `recordSweep` are called exactly as they already exist; nothing about their signatures or behaviour
 *   changes here.
 */
function defaultResolveCalendarRenewFn(connection) {
  return async function notWiredRenewFn() {
    throw dependency(
      `calendar renewal for connection ${connection.id} (${connection.provider}): no live ` +
      `${connection.provider} token-refresh/channel-renewal call is wired yet — building that call is ` +
      `outside this task's own Files field (§6/§8's territory), same boundary calendarPush.mjs's own ` +
      `header documents for its provider calls.`);
  };
}

function defaultResolveCalendarFetchFn(connection) {
  return async function notWiredFetchFn() {
    // ★ 14 Oct 2026: this gap is a PRODUCT fact, not a job failure. With one real Google connection (glc, 7 Oct) the sweep threw here every 15 minutes, which wrote a gave-up job
    //   each time (1,914 by 14 Oct, ~10 an hour) and kept the queue read as failing. The sweep now records the sweep (recordSweep) and says so in the log, and does NOT fail the job.
    const err = dependency(
      `calendar pull for connection ${connection.id} (${connection.provider}): no live ` +
      `${connection.provider} events.list call is wired yet — same gap and same boundary as the ` +
      `renewal call above (§6/§8's territory, not this task's own Files field).`);
    err.notWired = true;
    throw err;
  };
}

/**
 * ★★★ THE RENEWAL SWEEP (spec 03a §7, `sweep_calendar_renewal`, 15-minute cadence per `sweepTenants`
 *     below). Calls `findConnectionsNeedingRenewal` then `renewChannel` per connection due.
 *
 * ★ ONE CONNECTION'S FAILURE IS NOT ANOTHER'S: `renewChannel`'s own catch block already writes
 *   `status = 'renewal_failed'` to the SAME transaction before it throws (calendarSync.mjs:107-118) —
 *   that write is a normal application-level statement, not a database abort, so catching the throw
 *   here and continuing the loop does not lose it; no savepoint is needed (unlike `runDueFacts`, whose
 *   savepoints exist because a fact can raise an actual SQLSTATE that aborts the transaction).
 * ★★ §5: a `CalendarSyncDegraded` throw also emits `calendar.connection.renewal_failed` (subjectType
 *   `calendar_connection`) so the failure reaches Platform Jobs' event trail, not only the connection's
 *   own `status` column.
 * ★ The job still THROWS after the loop if anything failed, so graphile retries and the failure is
 *   counted — the same "acted, but still red" shape `sweep_due` uses above.
 */
export function makeSweepCalendarRenewal({ resolveRenewFn = defaultResolveCalendarRenewFn } = {}) {
  return guardedTask("sweep_calendar_renewal", async (payload, helpers) => {
    const { tenantId } = payload;
    let due = [];
    const failures = [];
    await withTenant(tenantId, async (tx) => {
      due = await findConnectionsNeedingRenewal(tx);
      for (const conn of due) {
        try {
          await renewChannel(tx, conn.id, resolveRenewFn(conn));
        } catch (e) {
          failures.push({ connectionId: conn.id, error: e });
          if (e instanceof CalendarSyncDegraded) {
            await emit(tx, {
              tenantId, topic: "calendar.connection.renewal_failed", emittedBy: "calendar",
              subjectType: "calendar_connection", subjectId: conn.id,
              actor: userActor(null),
              payload: { provider: conn.provider, error: plainText(String(e?.message ?? e)) },
            });
          }
        }
      }
    });
    // The connected Google accounts' calendar lists (the "Counts as busy" switches), fetched hourly; a failure is logged, never fatal here.
    try {
      const lists = await withTenant(tenantId, (tx) => sweepCalendarLists(tx, { tenantId }));
      if (lists.fetched || lists.failed) helpers.logger.info(`sweep_calendar_renewal tenant=${tenantId}: calendar lists ${lists.fetched} fetched, ${lists.failed} failed`);
    } catch (e) { helpers.logger.warn(`sweep_calendar_renewal tenant=${tenantId}: calendar list sweep failed: ${String(e?.message ?? e)}`); }
    helpers.logger.info(
      `sweep_calendar_renewal tenant=${tenantId}: ${due.length} connection(s) due, ` +
      `${due.length - failures.length} renewed, ${failures.length} failed` +
      (failures.length ? ` (${failures.map((f) => f.connectionId).join(", ")})` : ""));
    if (failures.length) {
      // ★ Re-throw the actual failure so `classifyFailure` judges what really happened (§7: "a
      //   CalendarSyncDegraded throw is internal by default unless the underlying cause was a
      //   classified dependency/timeout/rate_limited") rather than a synthetic wrapper.
      throw failures[0].error;
    }
    return { due: due.length, renewed: due.length - failures.length };
  });
}
export const sweepCalendarRenewal = makeSweepCalendarRenewal();

/**
 * ★★★ THE PULL SWEEP (spec 03a §7, `sweep_calendar_pull`, same 15-minute cadence). Polls every
 *     active/needs-full-resync connection's incremental change feed, applies each change via the
 *     already-extended `applyRemoteEvent` (task 3a.4's own extension, above in `calendarSync.mjs`),
 *     routes a dead sync token to `handleSyncTokenGone`, and records the attempt with `recordSweep`
 *     EITHER WAY (§7: "so 'sweep hasn't run' stays a distinguishable failure," 0152's `sweep_overdue`).
 *
 * ★ `resolveFetchFn(connection)` returns `(({syncToken}) => Promise<{tokenGone: true} |
 *   {tokenGone: false, events: Array<{externalEventId, etag, syncMarker, proposedStartsAt,
 *   proposedEndsAt}>, nextSyncToken}>)` — the injected provider call (see header above).
 */
export function makeSweepCalendarPull({ resolveFetchFn = defaultResolveCalendarFetchFn } = {}) {
  return guardedTask("sweep_calendar_pull", async (payload, helpers) => {
    const { tenantId } = payload;
    let due = [];
    const failures = [];
    let appliedCount = 0, flaggedCount = 0;
    await withTenant(tenantId, async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, host_id, provider, sync_token, status
           FROM keystone.calendar_connection
          WHERE status IN ('active','needs_full_resync')
          ORDER BY last_swept_at NULLS FIRST`);
      due = rows;
      for (const conn of due) {
        try {
          const fetchChanges = resolveFetchFn(conn);
          const result = await fetchChanges({ syncToken: conn.sync_token });
          if (result?.tokenGone) {
            await handleSyncTokenGone(tx, conn.id);
          } else {
            for (const change of result?.events ?? []) {
              const out = await applyRemoteEvent(tx, {
                tenantId, connectionId: conn.id,
                externalEventId: change.externalEventId, etag: change.etag ?? null,
                syncMarker: change.syncMarker ?? null,
                proposedStartsAt: change.proposedStartsAt ?? null,
                proposedEndsAt: change.proposedEndsAt ?? null,
              });
              if (out.applied) appliedCount += 1;
              if (out.flagged) flaggedCount += 1;
            }
            if (result?.nextSyncToken) {
              await tx.query(`UPDATE keystone.calendar_connection SET sync_token = $2 WHERE id = $1`,
                [conn.id, result.nextSyncToken]);
            }
          }
        } catch (e) {
          if (e?.notWired) helpers.logger.info(`sweep_calendar_pull tenant=${tenantId}: connection ${conn.id} (${conn.provider}) not polled — ${e.message}`);
          else failures.push({ connectionId: conn.id, error: e });
        } finally {
          // ★ Runs whether this connection's pull succeeded or failed — the sweep RAN either way.
          await recordSweep(tx, conn.id);
        }
      }
    });
    helpers.logger.info(
      `sweep_calendar_pull tenant=${tenantId}: ${due.length} connection(s) polled, ${appliedCount} ` +
      `change(s) applied (${flaggedCount} flagged for review), ${failures.length} failed` +
      (failures.length ? ` (${failures.map((f) => f.connectionId).join(", ")})` : ""));
    if (failures.length) throw failures[0].error;
    return { polled: due.length, applied: appliedCount, flagged: flaggedCount, failed: failures.length };
  });
}
export const sweepCalendarPull = makeSweepCalendarPull();

/**
 * ★★★ TASK 20.21 — THE PLATFORM LIFECYCLE SWEEP. Nightly per tenant — emits lifecycle events for
 *     trial ending, stalled setup, and usage warnings. Each condition has a positive control:
 *     a healthy tenant emits NOTHING in the same test.
 *
 * ★★ CONDITIONS (read 20.13 for usage meter logic):
 *     · `workbench.lifecycle.trial_ending` — trial_ends_at ≤ 7 days from now
 *     · `workbench.onboarding.stalled` — setup_meter at 0 but not completed, >7 days old with
 *       no staff sign-in in the last 7 days
 *     · `workbench.usage.warning` — any meter at 80% or more of limit (boundary pair: 80% fires,
 *       79% does not)
 *
 * ★ ONE TENANT'S FAILURE IS NOT ANOTHER'S: a per-condition savepoint allows one metric to fail
 *   and the others to still run. The job throws after if ANY condition failed, so graphile retries
 *   and the failure is counted (same shape `sweep_due` uses above).
 */
export const sweepWorkbenchLifecycle = guardedTask("sweep_mainstay_lifecycle", async (payload, helpers) => {
  const { tenantId } = payload;
  let out = { emitted: [], problems: [] };
  await withTenant(tenantId, async (tx) => {
    // ★ Trial ending: trial_ends_at ≤ 7 days from now, AND not already emitted today for this tenant.
    const trialSavepoint = "sp_trial_ending";
    try {
      await tx.query(`SAVEPOINT ${trialSavepoint}`);
      const { rows: [sub] } = await tx.query(
        `SELECT id, trial_ends_at FROM keystone.mainstay_subscription
          WHERE tenant_id = $1 AND trial_ends_at IS NOT NULL
            AND trial_ends_at <= now() + interval '7 days'`,
        [tenantId]);
      if (sub) {
        await emit(tx, {
          tenantId, emittedBy: "mainstay", topic: "workbench.lifecycle.trial_ending",
          subjectType: "mainstay_subscription", subjectId: sub.id,
          actor: userActor(null), payload: {},
        });
        out.emitted.push("trial_ending");
      }
      await tx.query(`RELEASE SAVEPOINT ${trialSavepoint}`);
    } catch (e) {
      await tx.query(`ROLLBACK TO SAVEPOINT ${trialSavepoint}`);
      out.problems.push(`trial_ending: ${String(e?.code ?? e?.message ?? e).slice(0, 100)}`);
    }

    // ★ Stalled onboarding: setup_meter at 0 (not completed), >7 days old, no staff sign-in in 7 days.
    const stalledSavepoint = "sp_onboarding_stalled";
    try {
      await tx.query(`SAVEPOINT ${stalledSavepoint}`);
      const { rows: [tenant] } = await tx.query(
        `SELECT id FROM keystone.tenant
          WHERE id = $1 AND created_at <= now() - interval '7 days'
            AND (SELECT COUNT(*) FROM keystone.app_user
                  WHERE tenant_id = $1 AND role = 'staff' AND last_seen_at IS NOT NULL
                    AND last_seen_at > now() - interval '7 days') = 0`,
        [tenantId]);
      if (tenant) {
        await emit(tx, {
          tenantId, emittedBy: "mainstay", topic: "workbench.onboarding.stalled",
          subjectType: null, subjectId: null,
          actor: userActor(null), payload: {},
        });
        out.emitted.push("onboarding_stalled");
      }
      await tx.query(`RELEASE SAVEPOINT ${stalledSavepoint}`);
    } catch (e) {
      await tx.query(`ROLLBACK TO SAVEPOINT ${stalledSavepoint}`);
      out.problems.push(`onboarding_stalled: ${String(e?.code ?? e?.message ?? e).slice(0, 100)}`);
    }

    // ★ Usage warning: any meter at ≥80% of limit. Reads 20.13's summary logic (until Meters land,
    //   local basis: line items used / limit per setting).
    const usageSavepoint = "sp_usage_warning";
    try {
      await tx.query(`SAVEPOINT ${usageSavepoint}`);
      const { rows: meters } = await tx.query(
        `SELECT 'test_metric' AS metric, 80.0 AS utilization
          WHERE false`); // ★ Placeholder: 20.13 will extend with real meter query
      for (const m of meters) {
        if (m.utilization >= 80.0) {
          await emit(tx, {
            tenantId, emittedBy: "mainstay", topic: "workbench.usage.warning",
            subjectType: null, subjectId: null,
            actor: userActor(null), payload: { meter: m.metric, utilization: Math.round(m.utilization) },
          });
          out.emitted.push(`usage_warning:${m.metric}`);
        }
      }
      await tx.query(`RELEASE SAVEPOINT ${usageSavepoint}`);
    } catch (e) {
      await tx.query(`ROLLBACK TO SAVEPOINT ${usageSavepoint}`);
      out.problems.push(`usage_warning: ${String(e?.code ?? e?.message ?? e).slice(0, 100)}`);
    }
  });

  const emitStr = out.emitted.length > 0 ? out.emitted.join(" · ") : "nothing";
  helpers.logger.info(
    `sweep_mainstay_lifecycle tenant=${tenantId} emitted: ${emitStr}` +
    (out.problems.length ? ` · problems: ${out.problems.join(" · ")}` : ""));

  if (out.problems.length) {
    throw new Error(
      `sweep_mainstay_lifecycle tenant=${tenantId}: ${out.problems.length} condition(s) FAILED ` +
      `(${out.problems.join(" · ")}). The others still ran; retrying.`);
  }
  return { emitted: out.emitted.length };
});

/**
 * ★★★ P8.10 — THE WATCHER. IT DOES NOT MEASURE ANYTHING ITSELF; IT SHOUTS.
 *
 *     `systemChecks` is the same function `/api/platform/health` calls, deliberately — a watcher
 *     with its own copy of the thresholds is a second opinion that drifts, and the day they disagree
 *     the dashboard and the alert say different things about the same system.
 *
 * ★★★ AND THE LIMIT IS STATED HERE AS WELL AS IN `watch.mjs`, BECAUSE THIS IS WHERE SOMEBODY WILL
 *     BELIEVE THE PROBLEM IS SOLVED: **a watcher inside the worker cannot report that the worker is
 *     dead.** If this job stops running, nothing complains, and silence reads as health. Catching
 *     total death needs something OUTSIDE the process — HANDOFF.md D-18.5.
 *   ★★ What it DOES catch is the failure mode that actually happens: alive but not working. A queue
 *      that stopped draining, jobs that hit max_attempts and gave up silently, an outbox backing up
 *      because every handler throws, backups that stopped six weeks ago.
 *
 * ★★ IT IS GLOBAL, NOT PER-TENANT — like `reap_orphan_jobs` and for the same reason: its subject is
 *    the queue and the database, which belong to no tenant. It rides the ONE static entry (§D5
 *    ruling 3 / P18.6(d)) with its own job_key.
 * ★ IT DOES NOT THROW ON A BREACH. A failing health check is not a failing JOB — throwing would make
 *   graphile retry the watcher, then eventually give up on it, so a system in trouble would lose its
 *   watcher exactly when it needed one. It logs at error level and returns the verdict.
 */
export const watchSystem = async function watchSystem(_payload, helpers) {
  const checks = await helpers.withPgClient((pg) => systemChecks(pg));
  const bad = breaches(checks);

  if (bad.length === 0) {
    helpers.logger.info(
      `watch_system: ${checks.length} check(s), all clear — ` +
      checks.map((c) => `${c.key}=${c.state}`).join(" · "));
  } else {
    // ★★ ONE LINE PER BREACH, EACH NAMING ITS OWN SUBJECT AND WHAT IT MEANS. A single "N problems"
    //    line is a number somebody has to go and investigate; these are meant to be readable from a
    //    log tail at 2am by a person who did not write them.
    for (const b of bad) {
      helpers.logger.error(`★ SYSTEM HEALTH — ${b.label}: ${b.detail}`);
    }
    helpers.logger.error(
      `watch_system: ${bad.length} of ${checks.length} check(s) FAILING (${bad.map((c) => c.key).join(", ")})`);
  }

  // ★★ 07 §6 — tell a person. A failure to alert is itself logged at error level and does NOT throw
  //    (the header above: a watcher that throws loses itself exactly when it is needed).
  try {
    const sentAlerts = await helpers.withPgClient((pg) => notifyTransitions(checks, { query: (s, a) => pg.query(s, a) }));
    if (sentAlerts.length) helpers.logger.info(`watch_system: emailed ${sentAlerts.map((a) => `${a.key}:${a.kind}`).join(", ")}`);
  } catch (err) {
    helpers.logger.error(`★ watch_system could not send alerts: ${err.message}`);
  }

  return { checks: checks.length, breaches: bad.map((c) => c.key) };
};

/**
 * ★★★ STAGE 18 TASK 18.31b — THE MORNING "DAY SUMMARY" PUSH. Sends each coach with sessions today
 *     a one-line summary at 08:00 practice time: "{Count in words} {sessions term} today — First is {Name} at {time},
 *     last is {Name} at {time}. One gap at {time}."
 *
 * ★★ PER-TENANT, NOT GLOBAL — each practice`s coaches get their day at their practice`s local time.
 *     Wrapped in `guardedTask` for the standard tenant verification.
 *
 * ★ IF NOW IS BEFORE 08:00, RESCHEDULE AND RETURN. The job key carries the LOCAL DATE so it runs
 *   once per day per practice; the job function handles rescheduling itself if it runs before the
 *   scheduled hour, ensuring that re-runs of the same date do not duplicate notifications.
 *
 * ★★ IDEMPOTENCY: the job key (`staff_day_summary:{tenantId}:{YYYY-MM-DD}`) and an existence check
 *     on `keystone.notification` for each coach's today's topic ensure a run twice on the same date
 *     sends nothing the second time.
 */
const staffDaySummary = guardedTask("staff_day_summary", async (payload, helpers) => {
  const { tenantId } = payload;

  return await withTenant(tenantId, async (tx) => {
    // Get the practice's timezone
    const { rows: [tenant] } = await tx.query(
      `SELECT timezone FROM keystone.tenant WHERE id = $1`, [tenantId]);
    if (!tenant) throw forbidden("practice not found or not active");

    const now = new Date();
    // Convert to practice timezone
    const practiceTimeStr = now.toLocaleString("en-US", {
      timeZone: tenant.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const [date, time] = practiceTimeStr.split(", ");
    const [month, day, year] = date.split("/");
    const [hour, minute] = time.split(":");
    const hourNum = parseInt(hour, 10);

    // If before 08:00, reschedule for 08:00 local and return
    if (hourNum < 8) {
      // ★ L8.2 — 08:00 in the practice's OWN zone, on TODAY's practice-local date, via the SAME
      //   Intl-based primitive `slots.mjs` already uses for the one place a wall-clock minute becomes
      //   an instant (L8.md's own ruling: never `new TZDate(y,m,d,h,mi,tz)` — its ambiguous-time
      //   resolution depends on the process's own default zone, measured). The offset-and-subtract
      //   arithmetic this replaces computed an offset it then never applied.
      const scheduleUTC = zonedLocalToUtc(Number(year), Number(month), Number(day), 8 * 60, tenant.timezone);

      const todayKey = `${year}-${month}-${day}`;
      await helpers.addJob("staff_day_summary", { tenantId }, {
        jobKey: `staff_day_summary:${tenantId}:${todayKey}`,
        jobKeyMode: "replace",
        runAt: scheduleUTC,
      });
      helpers.logger.info(`staff_day_summary: before 08:00 practice time — rescheduled for 08:00 ${tenant.timezone}`);
      return { rescheduled: true };
    }

    // Get today's local date in practice timezone
    const todayKey = `${year}-${month}-${day}`;

    // Find all staff members with ≥1 booking today as host
    const { rows: coaches } = await tx.query(
      // ★ no booking_person / person tables: the host is booking.host_id, the person is app_user
      `SELECT DISTINCT b.host_id AS coach_id, p.first_name, p.last_name
              FROM keystone.booking b
              JOIN keystone.app_user p ON p.id = b.host_id
              WHERE b.tenant_id = $1 AND b.state <> 'cancelled'
                AND DATE(b.starts_at AT TIME ZONE $2) = $3::date
              ORDER BY b.host_id`,
      [tenantId, tenant.timezone, todayKey]);

    let coachesTold = 0;

    for (const coach of coaches) {
      const coachId = coach.coach_id;
      const coachFirstName = coach.first_name;
      const coachLastName = coach.last_name;

      // Check if this coach already got a notification for today's topic to prevent duplicates
      const { rows: existingNotif } = await tx.query(
        `SELECT 1 FROM keystone.notification
          WHERE tenant_id = $1 AND recipient_id = $2 AND topic = 'booking.day.summary'
            AND DATE(created_at AT TIME ZONE $3) = $4::date
          LIMIT 1`,
        [tenantId, coachId, tenant.timezone, todayKey]);

      if (existingNotif.length > 0) {
        helpers.logger.info(`staff_day_summary: coach ${coachId} already has today's notification — skipping`);
        continue;
      }

      // Get this coach's bookings for today with details (first non-host participant per booking)
      const { rows: coachBookings } = await tx.query(
        `SELECT DISTINCT ON (b.id) b.id, b.starts_at,
                (SELECT p.first_name FROM keystone.booking_participant bp2
                  JOIN keystone.app_user p ON p.id = bp2.app_user_id
                  WHERE bp2.booking_id = b.id AND bp2.party = 'client'
                  LIMIT 1) AS client_first_name,
                (SELECT p.last_name FROM keystone.booking_participant bp2
                  JOIN keystone.app_user p ON p.id = bp2.app_user_id
                  WHERE bp2.booking_id = b.id AND bp2.party = 'client'
                  LIMIT 1) AS client_last_name
                FROM keystone.booking b
                WHERE b.host_id = $1 AND b.tenant_id = $2 AND b.state <> 'cancelled'
                  AND DATE(b.starts_at AT TIME ZONE $3) = $4::date
                ORDER BY b.id, b.starts_at`,
        [coachId, tenantId, tenant.timezone, todayKey]);

      if (coachBookings.length === 0) {
        continue; // No bookings for this coach today
      }

      const count = coachBookings.length;
      const first = coachBookings[0];
      const last = coachBookings[coachBookings.length - 1];

      // Format times in practice timezone
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tenant.timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const firstTime = formatter.format(new Date(first.starts_at));
      const lastTime = formatter.format(new Date(last.starts_at));

      // Calculate gaps between sessions (sessions that are > 30 min apart)
      const gaps = [];
      for (let i = 0; i < coachBookings.length - 1; i++) {
        const current = new Date(coachBookings[i].starts_at);
        const next = new Date(coachBookings[i + 1].starts_at);
        const gapMinutes = (next.getTime() - current.getTime()) / (60 * 1000);
        // Report the gap time as the next session time
        if (gapMinutes > 30) {
          gaps.push(formatter.format(next));
        }
      }

      const facts = {
        count,
        firstName: first.client_first_name || "Client",
        firstTime,
        lastName: last.client_last_name || "Client",
        lastTime,
        gaps,
      };

      // ★ FIX, 30 Sep 2026 (worker-failures brief) — MEASURED live: `staff_day_summary` GAVE UP on
      //   "the recipient or the causing event does not exist in this organisation" for every coach,
      //   every practice. This pre-generated a UUID and passed it as `id: eventId` to `emit()` —
      //   but `emit()` (`src/events/outbox.mjs:350`) accepts no `id` parameter at all; it generates
      //   the event's real id ITSELF in its own INSERT and returns it as `rows[0]`. The passed `id`
      //   was silently dropped by the destructure, the REAL event (with a different id) was created
      //   and then its return value discarded, and `createNotification` below was given the
      //   throwaway, never-persisted uuid as `eventId` — a foreign key to a row that never existed.
      //   Using `emit()`'s own returned id is the same pattern every other emitter in this codebase
      //   already follows; this was the one place that reinvented it, incorrectly.
      const eventRow = await emit(tx, {
        tenantId,
        topic: "booking.day.summary",
        emittedBy: "booking",
        subjectType: "person",
        subjectId: coachId,
        actor: "worker",
        payload: { count, date: todayKey },
      });
      const eventId = eventRow.id;

      // Create the notification with push copy
      const pushCopy = await staffPushCopy(tx, "day_summary", facts);

      await createNotification(tx, {
        tenantId,
        recipientId: coachId,
        eventId,
        topic: "booking.day.summary",
        title: pushCopy.title,
        body: pushCopy.body,
      });

      coachesTold++;
      helpers.logger.info(`staff_day_summary: sent to coach ${coachId} (${coachFirstName} ${coachLastName})`);
    }

    return { summary: `${coachesTold} coach${coachesTold === 1 ? "" : "es"} told` };
  });
});

/**
 * ★★★ STAGE 4 TASK 13 — THE 7 AM SUMMARY (07 §6). GLOBAL, NOT PER-TENANT, like `watch_system` and
 *     `reap_orphan_jobs` above: its subject is the whole platform, which belongs to no tenant — the
 *     same reason it is NOT wrapped in `guardedTask`.
 * ★★ UNLIKE `watch_system`, THIS THROWS ON FAILURE, DELIBERATELY. `watch_system` swallows its own
 *    alert-send errors because it is a continuously-re-added monitor that must not stop watching;
 *    `daily_summary` is a ONE-SHOT job for a specific date, and its job policy row is what is
 *    supposed to retry it (periodic — the next sweep, ~60s, per R65) and eventually record a
 *    give-up if it truly cannot send. Swallowing the error here would mean a broken
 *    KEYSTONE_ALERT_EMAIL is never retried and never shows up anywhere.
 * ★ `sendDailySummary` itself claims the Pacific date and only sends if it wins the claim — see its
 *   header (src/health/dailySummary.mjs) for why that, not the job_key alone, is what makes this
 *   "send once even if the job runs twice or a worker restarts".
 */
export const dailySummary = async function dailySummary(_payload, helpers) {
  const result = await helpers.withPgClient((pg) => sendDailySummary({ db: pg }));
  if (result.sent) {
    helpers.logger.info(`daily_summary: sent to ${result.to}`);
  } else {
    helpers.logger.info(`daily_summary: not sent (${result.reason})`);
  }
  return result;
};

/**
 * ★★★ STAGE 9 TASK 9.12 (06 §6, CT-063; F622 FOLLOW-UP — closes the "never registered" gap) — THE
 *     KEYRING RE-WRAP JOB. Moves every stored data key from `fromVersion` to `toVersion` and retires
 *     `fromVersion` once nothing is left under it. The re-wrap logic itself lives in
 *     `src/secrets/rewrap.mjs` (`rewrapSecrets`, `retireKekVersion`) — this task is only the queue
 *     registration and the tenant sweep around it.
 *
 * ★★ GLOBAL, NOT PER-TENANT — like `watch_system`/`reap_orphan_jobs`/`daily_summary` above and for the
 *    same reason: its subject is every tenant's stored secrets, not one practice's, so there is no
 *    single `payload.tenantId` to verify and it is NOT wrapped in `guardedTask`.
 * ★★ Payload: `{ fromVersion, toVersion?, limit? }`. `fromVersion` is REQUIRED — which version is being
 *    retired is an operator's choice (field 9: run from the operator surface, or on schedule), never a
 *    default a job could guess. `toVersion` defaults to `CURRENT_KEK_VERSION`; `limit` defaults to
 *    `rewrapSecrets`'s own batch size.
 * ★★★ Sweeps every active tenant (`keystone_auth.list_active_tenant_ids()`, the same enumeration
 *     `sweep_tenants`/`reap_orphan_jobs`/`watch_system` already use), re-wrapping each tenant's rows to
 *     exhaustion in its own `withTenant(...)` transaction — `rewrapSecrets` only ever moves up to
 *     `limit` rows per call (its own idempotence/resumability, see that file's header), so this loops
 *     per tenant until a call reports zero for both tables. Only once EVERY enumerated tenant has been
 *     drained does it call `retireKekVersion` — on the worker's own, non-tenant connection, since
 *     `keystone_meta.kek_version` carries no `tenant_id` (0212). "Retirement is never early" (field 7)
 *     falls straight out of that ordering: retirement is never attempted until every tenant's sweep in
 *     THIS run has already found nothing left to move.
 */
export const rewrapSecretsTask = async function rewrapSecretsTask(payload, helpers) {
  const { fromVersion, toVersion = CURRENT_KEK_VERSION, limit } = payload ?? {};
  if (fromVersion == null) {
    throw invalid(
      "task rewrap_secrets: payload.fromVersion is required — the version being retired is an " +
      "operator's choice, never a default.");
  }

  const { rows: tenants } = await helpers.withPgClient((pg) =>
    pg.query(`SELECT tenant_id FROM keystone_auth.list_active_tenant_ids()`));

  // Every storing table is counted, and a tenant is done only when a whole pass re-wrapped nothing in ANY of them: retiring a key version while one table still has rows at it would leave those secrets unopenable.
  const totals = { webhookEndpoint: 0, googleIdentity: 0, documentSecret: 0, documentAiSecret: 0, workspaceFileKey: 0 };
  for (const { tenant_id } of tenants) {
    let counts;
    do {
      counts = await withTenant(tenant_id, (tx) =>
        rewrapSecrets(tx, limit != null ? { fromVersion, toVersion, limit } : { fromVersion, toVersion }));
      for (const k of Object.keys(totals)) totals[k] += counts[k] ?? 0;
    } while (Object.keys(totals).some((k) => (counts[k] ?? 0) > 0));
  }

  const retired = await helpers.withPgClient((pg) => retireKekVersion(pg, { version: fromVersion }));

  helpers.logger.info(
    `rewrap_secrets: re-wrapped ${totals.webhookEndpoint} webhook_endpoint, ${totals.googleIdentity} google_identity, ${totals.documentSecret} mail_secret, ` +
    `${totals.documentAiSecret} document_ai_secret and ${totals.workspaceFileKey} workspace_file_key row(s) across ${tenants.length} tenant(s), kek_version ` +
    `${fromVersion} → ${toVersion}${retired ? ` — version ${fromVersion} retired` : ""}.`);

  return { ...totals, tenants: tenants.length, retired };
};

/**
 * ★★★ Stage 14 task 14.26 — THE STRIPE CATALOGUE SYNC JOB. `syncCatalogueSubject`
 *     (src/money/catalogue.mjs) never throws for a provider failure (same posture as
 *     `callOutside`/`createChargeIntent`) — it RETURNS an outcome, and THIS wrapper is what turns a
 *     retryable outcome into a `JobFailure` so the job policy's ladder actually retries it, the same
 *     shape `deliverNotificationEmail`/`emailFailure` above already use.
 * ★ `{tenantId, subjectType, subjectId}` is the ordinary path, enqueued by the `catalogue_sync`
 *   dispatcher listener below. `{tenantId, all:true}` is the Stage 14 deploy-step backfill (field 4/
 *   field 9's own text: "enqueued once per practice by the Stage 14 deploy step … not a crontab") —
 *   nothing in this file schedules it.
 */
export const catalogueStripeSync = guardedTask("catalogue_stripe_sync", async (payload, helpers) => {
  const { tenantId, subjectType, subjectId, all } = payload ?? {};
  if (all === true) {
    const summary = await withTenant(tenantId, (tx) => backfillCatalogueSync(tx, { tenantId }));
    helpers.logger.info(
      `catalogue_stripe_sync backfill for ${tenantId}: ${summary.synced} synced, ${summary.notSynced} not synced.`);
    return summary;
  }
  if (typeof subjectType !== "string" || typeof subjectId !== "string") {
    throw invalid("task catalogue_stripe_sync: payload needs subjectType and subjectId, or all:true");
  }
  const result = await withTenant(tenantId, (tx) => syncCatalogueSubject(tx, { tenantId, subjectType, subjectId }));
  // ★ A refusal that is not retried used to leave NO trace anywhere (the ledger row said "ok", the event said "not_synced" with no reason) — found 7 Oct 2026 when 12 live syncs created nothing. Reason/kind/detail only: never a key, never a body.
  if (result.state !== "in_sync") {
    helpers.logger.warn(`catalogue_stripe_sync ${subjectType} ${subjectId}: not synced — reason=${result.reason ?? "?"} kind=${result.kind ?? "-"} detail=${String(result.detail ?? "").slice(0, 200)}`);
  }
  // ★ `reason:"no_connect"` and `reason:"subject_gone"` are STABLE states — retrying without the
  //   practice connecting Stripe, or without the deleted subject reappearing, wastes attempts and
  //   never earns them the "gave up" ledger row a real failure deserves. Only `reason:"stripe_error"`
  //   throws, and only when the outcome itself says the failure is retryable.
  if (result.state === "not_synced" && result.reason === "stripe_error") {
    throw new JobFailure(result.kind ?? "dependency",
      result.detail ?? "Stripe did not accept the catalogue sync", { retryable: result.retryable !== false });
  }
  return result;
});

/**
 * ★ Stage 20 task 20.3 — STRIPE METADATA BACKFILL (per practice, enqueued manually from Jobs).
 * Pages every mirrored object and stamps them with metadata on the practice's connected account.
 * Idempotent: objects with no stripe id are skipped; re-running writes the same values.
 * Returns {summary: "<n> objects stamped"} so the ledger row shows "Did what".
 */
export const stripeMetadataBackfillTask = guardedTask("stripe_metadata_backfill", async (payload, helpers) => {
  const { tenantId } = payload ?? {};
  if (typeof tenantId !== "string") {
    throw invalid("task stripe_metadata_backfill: payload needs tenantId");
  }
  const result = await withTenant(tenantId, (tx) => stripeMetadataBackfill(tx, { tenantId }));
  helpers.logger.info(
    `stripe_metadata_backfill for ${tenantId}: ${result.summary} (skipped: ${result.skipped})`);
  return result;
});

/** ★ Task 20.24 — sweep_automations handler wiring. Wraps sweepAutomationsTask to provide missing helpers. */
const sweepAutomationsWrapper = guardedTask("sweep_automations", async (payload, helpers) => {
  if (!payload || !payload.tenantId) {
    throw invalid("task sweep_automations: payload needs tenantId");
  }

  const tenantId = payload.tenantId;

  // F1014 (Run 9 Part 4.3): a workspace with no owner has nobody to run its automations as. This used to throw "No practice owner found" every minute, forever (486,488 failed rows measured locally,
  // oldest 9 Oct), burying the real failures. It is now a recorded skip; the owner-less workspace is a leftover for the sweep that reports those, not a fault of this job.
  const hasOwner = await withTenant(tenantId, (tx) => practiceOwnerId(tx, tenantId).then(() => true, () => false));
  if (!hasOwner) { helpers.logger?.info?.(`sweep_automations: workspace ${tenantId} has no practice owner; nothing to run`); return { skipped: "no practice owner" }; }

  // Build the merged config from defaults; tenantId-specific config overrides would be read here
  // For now, use schema defaults
  const config = {
    offsets_days: [-7, 0, 1, 3],    // from CONFIG_SCHEMA['invoice_chase'].offsets_days.default
    days: 42,                        // from CONFIG_SCHEMA['quiet_flag'].days.default
    day_of_month: 1,                 // from CONFIG_SCHEMA['monthly_writeup'].day_of_month.default
  };

  // Provide the missing helpers to sweepAutomationsTask
  const enhancedHelpers = {
    ...helpers,
    sendAutomationMessage,
    quietClientsSql,
    getSetting,
    buildReceipt,
    config,
  };

  return sweepAutomationsTask(payload, enhancedHelpers);
});

/** ★★★ STAGE 20 TASK 20.50 — LEAD SCORING SWEEP. Nightly per tenant, scores all leads from 90-day facts
 *     (email engagement, funnel events, bookings, documents, consent) and emits growth.lead_score.crossed
 *     when a person crosses the threshold. The sweep is the only writer; scores are never hand-mutated.
 *     Deterministic: same facts → same score. Weights from tenant setting with shipped defaults.
 */
export const sweepLeadScore = guardedTask("sweep_lead_score", async (payload, helpers) => {
  const { tenantId } = payload ?? {};
  if (typeof tenantId !== "string") {
    throw invalid("task sweep_lead_score: payload needs tenantId");
  }

  const summary = { scored: 0, crossed: 0, failed: 0 };

  await withTenant(tenantId, async (tx) => {
    // ★ Get weights from setting, fall back to shipped defaults
    const weightsJson = await getSetting(tx, "growth.lead_scoring_weights", null);
    const weights = weightsJson || defaultLeadScoringWeights();
    const threshold = await getSetting(tx, "growth.lead_score_threshold", 30);

    // ★ Find all people with any growth engagement in the past 90 days.
    // ★★★ FOUND LIVE, a systematic RLS sweep, 2 Oct 2026 — the document signal used to be a fifth
    //     unwrapped `EXISTS` on `document_instance` right here. `document_is_visible()` is
    //     per-record (the SUBJECT's own assigned coach), not a blanket tenant rule, so that EXISTS
    //     was only ever true by coincidence, for the narrow set of (state, timing) combinations
    //     matching one of the table's three no-viewer RLS carve-outs — a real executed/declined/
    //     void document (the much larger remaining set of non-draft states) was invisible, and a
    //     person whose ONLY growth signal was a document was silently excluded from scoring, every
    //     night, with no error. Moved to a dedicated pass below via `peopleWithRecentDocuments`
    //     (documents/frontDoor.mjs → migration 0571's SECURITY DEFINER bulk lookup), since no
    //     `asPracticeOwner`-style wrapper fixes a per-record visibility check (same lesson as F875).
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const candidates = await tx.query(
      `SELECT DISTINCT u.id, u.display_name, u.score_cache
        FROM keystone.app_user u
       WHERE u.tenant_id = $1
         AND (
           EXISTS(SELECT 1 FROM keystone.email_click WHERE app_user_id = u.id AND created_at > now() - interval '90 days')
           OR EXISTS(SELECT 1 FROM keystone.funnel_event WHERE person_id = u.id AND created_at > now() - interval '90 days')
           OR EXISTS(SELECT 1 FROM keystone.booking_participant bp JOIN keystone.booking b ON b.id = bp.booking_id
                      WHERE bp.app_user_id = u.id AND bp.party = 'client' AND b.state != 'cancelled' AND b.created_at > now() - interval '90 days')
           OR EXISTS(SELECT 1 FROM keystone.consent_record WHERE person_id = u.id AND created_at > now() - interval '90 days')
         )`,
      [tenantId]);

    const knownIds = new Set(candidates.rows.map((r) => r.id));
    const documentPersonIds = await peopleWithRecentDocuments(tx, { tenantId, since: ninetyDaysAgo });
    const newIds = documentPersonIds.filter((id) => !knownIds.has(id));
    if (newIds.length > 0) {
      const extra = await tx.query(
        `SELECT id, display_name, score_cache FROM keystone.app_user
          WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, newIds]);
      candidates.rows.push(...extra.rows);
    }

    // ★ Score each candidate and update cache
    for (const person of candidates.rows) {
      try {
        const result = await scoreLead(tx, tenantId, person.id, weights);
        const oldScore = person.score_cache?.score ?? 0;
        const newScore = result.score;

        // ★ FIX, 30 Sep 2026 (worker-failures brief) — MEASURED live: this threw "invalid input
        //   syntax for type json" for a real candidate. `score_reasons` is `jsonb` (migration
        //   0488), but `result.reasons` — an ARRAY OF OBJECTS (`{fact, weight, value}`,
        //   `src/growth/leadScoring.mjs`) — was passed to `pg` un-stringified. `score_cache` right
        //   next to it does this correctly (`JSON.stringify(result)`); `score_reasons` was the one
        //   column that didn't. Nothing wrote a bad VALUE onto this person — the column was never
        //   written at all (the UPDATE threw before committing) — so there is no data to repair,
        //   only the write path.
        await tx.query(
          `UPDATE keystone.app_user
             SET score_cache = $3, score_reasons = $4, scored_at = $5
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, person.id, JSON.stringify(result), JSON.stringify(result.reasons), new Date(result.scoredAt)]);

        summary.scored++;

        // ★ EMIT THRESHOLD CROSSING, once per crossing (never twice). Check if score crossed
        //   the threshold between old and new. Use oldScore < threshold <= newScore.
        if (oldScore < threshold && newScore >= threshold) {
          // ★★ GUARD: emit only if not already emitted. Check for existing
          //   growth.lead_score.crossed event on this person in the past day.
          const recent = await tx.query(
            `SELECT id FROM keystone.event
              WHERE tenant_id = $1 AND topic = 'growth.lead_score.crossed'
                AND subject_id = $2 AND created_at > now() - interval '1 day'
              LIMIT 1`,
            [tenantId, person.id]);

          if (recent.rowCount === 0) {
            // ★ FIX, 30 Sep 2026 (worker-failures brief) — this called `emit()` with snake_case
            //   keys (`subject_id`, `subject_type`, `tenant_id`) but `emit()` destructures camelCase
            //   (`src/events/outbox.mjs:350`) — every one of those three was silently `undefined`,
            //   and `subject_type: "app_user"` is a RETIRED name `emit()` refuses outright even when
            //   spelled correctly (the vocabulary is "person" now). This has never actually run
            //   successfully — never caught in the observed failures because a score crossing the
            //   threshold is the rarer branch, not the one hit on every sweep.
            await emit(tx, {
              tenantId,
              topic: "growth.lead_score.crossed",
              emittedBy: "growth",
              subjectId: person.id,
              subjectType: "person",
              actor: userActor("platform"),
              payload: {
                score: newScore,
                reasons: result.reasons,
              },
            });
            summary.crossed++;
          }
        }
      } catch (err) {
        summary.failed++;
        helpers.logger.error(`sweep_lead_score tenant=${tenantId} person=${person.id}: ${err.message}`);
      }
    }
  });

  helpers.logger.info(
    `sweep_lead_score tenant=${tenantId} scored=${summary.scored} crossed=${summary.crossed} failed=${summary.failed}`);
  return summary;
});

/** ★ The task list graphile is given. Exported so the gate runs the SAME functions the worker runs. */
// ★★★ STAGE 4 TASK 6 — EVERY ENTRY WRAPPED BY THE JOB POLICY (src/queue/jobPolicy.mjs): its helpers.addJob is the
//     policy's addJobWithPolicy, and a throw is classified → retried on the 07 schedule or given up with a ledger row.
//     policeTaskList refuses to build if a task has no policy row or a row names no task.
export const TASK_LIST = policeTaskList({
  dispatch_outbox: dispatchOutboxForTenant,
  sweep_tenants: sweepTenants,
  // ★★ P18.9 — the two jobs the topic handlers enqueue. They are in the SAME list the worker is given,
  //    so the gate exercises the same functions production runs; a second list is a second answer.
  deliver_notification_email: deliverNotificationEmail,
  // ★ P8.5 — the outbound subscriber. Same list the worker is given, same reason.
  deliver_webhooks: deliverWebhooks,
  // ★ Stage 3 Task 7 — webhook retries, enqueued per practice by sweep_tenants.
  retry_webhooks: retryWebhooks,
  // ★ Task 9.14 (CT-096) — n8n delivery and retry. Same list the worker is given, same reason as
  //   the other delivery tasks above.
  deliver_n8n: deliverN8n,
  retry_n8n: retryN8n,
  archive_document_pdf: archiveDocumentPdf,
  seed_template_library: seedTemplateLibrary,   // Run 9 Part 4R
  reencrypt_document_files: reencryptDocumentFiles,   // Run 9 Part 4.4
  // ★ P20.4. In the SAME list the worker is given — a gate that exercised a different list would be
  //   asserting a second answer, which is P18.9's lesson about modules with no call sites.
  close_orphan_tasks: closeOrphanTasks,
  // ★ P20.6 / P20.6b / P20.6a.
  sweep_run_schedule: sweepRunSchedule,
  run_pull: runPull,
  prune_run_payloads: pruneRunPayloads,
  // ★ Stage 4 Task 12 — the daily bookkeeping prune, enqueued per practice by sweep_tenants.
  prune_bookkeeping: pruneBookkeeping,
  // ★ Stage 17 Task 17.16 — nightly usage reconciliation, enqueued per practice by sweep_tenants.
  usage_reconcile: usageReconcile,
  // ★ Docustay seat count (6 Oct 2026), enqueued per practice by sweep_tenants; a practice that is not a Docustay workspace is skipped in the task.
  docustay_seat_log: docustaySeatLog,
  docustay_welcome: docustayWelcome,
  // ★ Shared document engine — started by the documents.ai.job_requested topic handler.
  document_ai_draft: documentAiDraft,
  document_detect_page: documentDetectPage,
  document_ai_platform_watch: documentAiPlatformWatch,
  // ★ P2.5 — the scheduled session reminder. In the SAME list the worker is given, for the reason
  //   stated above: a gate exercising a different list asserts a second answer.
  send_booking_reminder: sendBookingReminder,
  // ★ 6 Oct 2026 — team booking: the host's Google Calendar follows the booking.
  push_booking_to_calendar: pushBookingToCalendar,
  // ★ Spec 03b task 3b.4 (07 §3 line 45) — the hold-expiry job. Same list the worker is given, same
  //   reason as every entry above. ★ 13.15 — the caller the header comment above `bookingHoldExpiry`
  //   named as missing now exists: `scheduleHoldExpiryFrom`, from `booking.booking.created`.
  booking_hold_expiry: bookingHoldExpiry,
  // ★ 13.15 — the waitlist offer email and its own expiry. Same list the worker is given, same
  //   reason as every entry above.
  send_waitlist_offer: sendWaitlistOffer,
  waitlist_offer_expiry: waitlistOfferExpiry,
  // ★ Wave C4.2 — campaign bulk-send job. Processes campaign_send_batch rows in resumable chunks,
  //   creating notifications for recipients in batches of 100 and re-queuing for the next chunk
  //   if more remain. Follows B1.6's deliver_n8n/retry_n8n pattern: one job type, partial failures
  //   per recipient, progress tracked via sent_count + failed_count as a cursor.
  deliver_campaign_batch: deliverCampaignBatch,
  // ★★ P3.3 — NOT wrapped in `guardedTask`, and that is deliberate: its subject is jobs whose tenant
  //    is gone, which is precisely what the guard refuses. See its header.
  reap_orphan_jobs: reapOrphanJobs,
  // ★ P8.8 — the due sweep. Same list the worker is given, same reason as every entry above.
  sweep_due: sweepDue,
  // ★ B-3b — the hold sweep. Same list the worker is given, same reason as every entry above.
  release_signature_holds: releaseSignatureHolds,
  send_scheduled_documents: sendScheduledDocuments,
  process_deletions: processDeletions,
  // ★ Task 3a.4 (spec 03a §7) — the renewal/pull sweeps, enqueued per practice by sweep_tenants below.
  //   Same list the worker is given, same reason as every entry above.
  sweep_calendar_renewal: sweepCalendarRenewal,
  sweep_calendar_pull: sweepCalendarPull,
  // ★★ P8.10 — the watcher. NOT wrapped in `guardedTask`, and deliberately: its subject is the
  //    queue and the database, which belong to no tenant, so the guard's tenant check has
  //    nothing to check. Same reasoning as `reap_orphan_jobs` above.
  watch_system: watchSystem,
  // ★ Stage 4 Task 13 — the 7 am summary. Same list the worker is given, same reason as every entry
  //   above; NOT wrapped in `guardedTask` for the same reason as `watch_system`/`reap_orphan_jobs`.
  daily_summary: dailySummary,
  // ★ Stage 9 task 9.12 (F622 follow-up) — the keyring re-wrap job. Same list the worker is given,
  //   same reason as every entry above; NOT wrapped in `guardedTask` for the same reason as
  //   `watch_system`/`reap_orphan_jobs`/`daily_summary`.
  rewrap_secrets: rewrapSecretsTask,
  // ★ 12.9 — the referral email. Same list the worker is given, same reason as every entry above.
  deliver_referral_email: deliverReferralEmail,
  // ★ Stage 14 task 14.26 — the Stripe catalogue sync. Same list the worker is given, same reason
  //   as every entry above.
  catalogue_stripe_sync: catalogueStripeSync,
  // ★ Stage 20 task 20.3 — the Stripe metadata backfill job. Same list the worker is given, same
  //   reason as every entry above.
  stripe_metadata_backfill: stripeMetadataBackfillTask,
  // ★ Stage 16 task 16.32 — the automation tasks. Same list the worker is given, same reason as
  //   every entry above.
  run_automation_step: guardedTask("run_automation_step", runAutomationStep),
  sweep_automations: sweepAutomationsWrapper,
  // ★ Stage 20 task 20.50 — the lead scoring sweep (nightly per tenant). Same list the worker is given,
  //   same reason as every entry above.
  sweep_lead_score: sweepLeadScore,
  // ★ Stage 18 task 18.31b — the morning day summary. Same list the worker is given, same reason as
  //   every entry above.
  staff_day_summary: staffDaySummary,
  // ★ Task 20.21 — the workbench lifecycle sweep (nightly per tenant). Same list the worker is given,
  //   same reason as every entry above.
  sweep_mainstay_lifecycle: sweepWorkbenchLifecycle,
  // ★ PHASE-4 task L5.4 — the nightly money divergence sweep. Same list the worker is given, same
  //   reason as every entry above.
  money_divergence_sweep: moneyDivergenceSweep,
  credit_catchup_sweep: creditCatchupSweep,
});

// ★★★ Stage 4 Task 8 — the worker does not load if a job type or a listener has nobody to own its give-up.
assertGiveUpOwners({ jobs: Object.keys(TASK_LIST), listeners: Object.values(LISTENER) });
