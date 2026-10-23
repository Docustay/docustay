// Stage 4 Task 8 — ★★★ EVERY GIVE-UP HAS AN OWNER. Spec 07 §4 rule 6 (`a person-facing task (coach/owner/admin per`
// 02 §6) or Platform Jobs for system-only work. No job may give up with nowhere to show it"), 07 §7 (where failures
// surface to practices), 02 §6 (the Task column), plan Task 8.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ONE ROW PER JOB TYPE AND ONE PER DISPATCHER LISTENER, AND NO DEFAULT.
//   · `platform` — system-only work. Its give-up is shown on Platform Jobs: a job's ledger row
//     (keystone_meta.job_failure, via keystone.platform_list_job_failures) or a listener's job.gave_up platform fact.
//   · `person`   — somebody in the practice can act on it. On the give-up ONE task is opened in THAT practice, on the
//     subject the failure is about, assigned to the role the row names. The Platform Jobs entry stands as well: the
//     platform still sees every give-up; the practice sees the ones it can do something about.
//   ★★ The task list refuses to load if a job type or a listener has no row, or a row names nothing
//      (assertGiveUpOwners, called from src/queue/tasks.mjs) — and db/gates/s4_give_up_owner fails on the same.
//
// ★★★ DE-DUPLICATION IS THE DATABASE'S. The task's topic is `jobs.<job>.gave_up` / `listeners.<listener>.gave_up`
//     and `task_open_key` (0055: tenant, subject type, subject, topic WHERE open) makes a second give-up of the same
//     (type, practice, subject) while the task is open a no-op — task-6-report §8 Q3: one open give-up, not one a minute.
//
// ★★ WHO: `admin` is the practice's first admin (earliest created, not archived) — the practice has no separate
//    "owner" rank (staff ranks are admin/coach; super_admin ranks are platform-only, 0010), and 02 §6's "owner" is
//    the person who set the practice up. `coach` is the session's host for a booking, else the host of the person's
//    most recent non-cancelled session (the only coach relationship the schema records — records/queries.mjs), else
//    the admin.
//
// ★★ WHAT: a document-related give-up is filed on the DOCUMENT itself (fix round 1, I-2). It used to be filed on the
//    PERSON the document is about, because keystone.task_subject_exists('document', …) ran with no viewer and
//    document_is_visible() failed closed, so the orphan-task sweeper read every sent/signed document as GONE and
//    closed a document-subject task within a minute. ★ Task 8b / migration 0157 (F527) fixed that with
//    keystone.document_exists_in_practice(), so `document` is a safe subject again — and it is the RIGHT one: filed on
//    the person, two different documents of the same client collapsed into ONE task (task_open_key is per subject), so
//    the second failure was invisible and closing the task closed both.
//
// ★★★ AND THE KIND OF FAILURE DECIDES AS MUCH AS THE JOB TYPE (fix round 1, I-1). Every `person` row lists the
//     failure kinds (src/http/errors.mjs ErrorKind) a PRACTICE CAN ACT ON. Everything else — our credentials refused
//     (unauthenticated), the provider down (dependency), too slow (timeout), told to slow down (rate_limited), a fault
//     in our code (internal), in doubt — is ours, and goes to Platform Jobs ONLY. ★ Without this, one revoked Resend
//     key opened "An email to Robin couldn't be sent — check the address" in every practice at once: a false accusation
//     at scale, and a hundred people looking at an address that is perfectly fine.
//   ★ The give-up is never silent either way: the ledger row (Platform Jobs) is written before any of this runs.
//
// ★★★ AND A PRACTICE-OWNED GIVE-UP IS HANDED OFF (fix round 1, R69b). When the task opens, that ONE give-up — this
//     job's own identity, or its counted repeat — is recorded against the task through
//     keystone_meta.hand_off_job_failure (0158), in the SAME transaction: the task and the hand-off commit together or
//     neither does. It is NOT an acknowledgement (acknowledged_at is untouched; F511's system path is unchanged): the
//     queue check stops counting a row only once EVERY give-up counted on it has an owner.
//
// ★★ WHEN THE SUBJECT CANNOT BE NAMED (a notification that no longer exists, an event about nothing a task can hang
//    on): no task, one loud log line — and the Platform Jobs entry, which is always written, is the owner. Never
//    silent, never a task on a made-up subject.
//
// ★ SAMPLE subjects get tasks (tasks are internal work — the maintainer's Stage 3 ruling); nothing here sends anything.
// ★ THE REFERENCE PRACTICE is SKIPPED: it is the template and demo practice, its rows cannot be deleted (the reference
//   guard, 0133/0144), and a system-made task there would sit forever in the practice every demo shows. Its give-up
//   is on Platform Jobs like any other.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

import { withTenant } from "../db/index.mjs";
import { asViewer } from "../db/viewer.mjs";
import { openChainTask } from "../tasks/writes.mjs";
import { emit } from "../events/outbox.mjs";
import { instanceById } from "../documents/api.mjs";

export const OWNER_ROLES = Object.freeze(["admin", "member"]);
export const SUBJECT_KINDS = Object.freeze(["notification_recipient", "document", "booking", "event_subject"]);
// ★ The task subject types a give-up may be filed on — keystone.task's own CHECK (0055). `document` is back (0157).
const TASKABLE = new Set(["person", "account", "document", "booking", "entitlement", "run_schedule_item"]);

/**
 * ★★★ I-1 — THE KINDS A PRACTICE CAN ACT ON. Nothing else may reach a person.
 *   · `validation` — the request itself was refused as invalid: the address is not deliverable, the document is not
 *     something the provider will accept, the booking's own data is wrong. Somebody in the practice fixes the record
 *     and it works. 07 §7 calls exactly this out ("Email couldn't send / mailbox disconnected → Needs you task").
 *   · `not_found` — the thing the job needed is not there any more (a deleted recipient, a removed file). The practice
 *     is the only one who can say what should have been there.
 *   ★ Deliberately NOT here: unauthenticated / forbidden (our credentials — the practice cannot reach them),
 *     dependency / timeout / rate_limited (the provider — waiting is the only answer, and a task says otherwise),
 *     conflict and internal (our code). All of them are Platform Jobs' and the maintainer's.
 */
export const PRACTICE_ACTIONABLE = Object.freeze(["validation", "not_found"]);
/** The kinds no `person` row may ever claim, whatever it lists — the load-time guard enforces it. */
const NEVER_THE_PRACTICE = Object.freeze(["unauthenticated", "forbidden", "dependency", "timeout", "rate_limited", "internal"]);

// ── titles: one plain line each, names read from the current record (02 §2.4 — never from a payload) ────────────────
const TITLES = Object.freeze({
  email_not_sent: ({ first }) => first
    ? `An email to ${first} couldn't be sent — check the address`
    : "An email couldn't be sent — check the recipient's address",
  pdf_not_saved: ({ docTitle, first }) =>
    `The signed PDF of “${docTitle ?? "a document"}”${first ? ` for ${first}` : ""} couldn't be saved — it shows as “PDF pending” until it is`,
  sign_request_not_sent: ({ docTitle, first }) =>
    `${first ?? "The signer"} wasn't told “${docTitle ?? "a document"}” is ready to sign — send it again`,
  reminder_not_sent: ({ when }) =>
    `The reminder for the session on ${when ?? "its date"} couldn't be sent — remind the client yourself`,
  reminder_not_set: ({ when }) =>
    `The reminder for the session on ${when ?? "its date"} couldn't be set up — remind the client yourself`,
  hold_not_released: ({ when }) =>
    `The 24-hour consent hold on the session on ${when ?? "its date"} couldn't be released automatically — check it by hand`,
  tasks_not_updated: ({ first }) =>
    `Tasks for ${first ?? "this record"} couldn't be updated automatically — check them by hand`,
  webhook_not_sent: ({ first }) =>
    `An update${first ? ` about ${first}` : ""} couldn't be sent to your connected apps — check Settings → Developer`,
  // ★ Stage 12 task 12.9. Added 25 Sep 2026 by the coordinator — see the two rows below that use it.
  //   Same voice as its siblings: name what did not happen, then the one thing the practice can do.
  //   ★ It says "the partner", never the partner's name: a referral's recipient is an outside party and
  //   this sentence is read by whoever picks the task up, not by the person the referral is about.
  referral_not_sent: ({ first }) =>
    `The referral${first ? ` for ${first}` : ""} couldn't be sent to the partner — send it again, or check their address`,
  // ★ Task 13.15. Same voice as their siblings above: name what did not happen, then the one thing
  //   the practice can do. All three name the booking (`when`), the same fact `hold_not_released` uses.
  waitlist_offer_not_sent: ({ when }) =>
    `A waitlist offer for the session on ${when ?? "its date"} couldn't be sent — offer the slot by hand`,
  waitlist_offer_not_returned: ({ when }) =>
    `An unclaimed waitlist offer for the session on ${when ?? "its date"} couldn't be returned to the list — check it by hand`,
  hold_lapse_not_notified: ({ when }) =>
    `The hold on the session on ${when ?? "its date"} lapsed, but nobody was told — check it by hand`,
  // ★ B-5b — the copy named by the task (B-5 field 4). Same voice as its siblings: name what did not
  //   happen, then the one thing the practice can do.
  subscription_not_started: ({ first }) =>
    `A subscription didn't start after ${first ?? "the client"} signed — open it to retry.`,
  // ★ F836, "7 missing emails" brief, 1 Oct 2026. Same voice as their siblings above.
  expiry_notice_not_sent: ({ docTitle }) =>
    `“${docTitle ?? "A document"}” lapsed unsigned, but the sender wasn't told — check it by hand`,
  decline_notice_not_sent: ({ docTitle }) =>
    `“${docTitle ?? "A document"}” was declined, but the sender wasn't told — check it by hand`,
  credit_note_notice_not_sent: ({ first }) =>
    `A credit note for ${first ?? "a client"} was issued, but they weren't told — check it by hand`,
  package_notice_not_sent: ({ first }) =>
    `${first ?? "A client"} bought a package, but weren't told — check it by hand`,
});

const platform = (why) => Object.freeze({ owner: "platform", why });
/** ★ `kinds`: the failure kinds THIS row's practice can act on (I-1). Every other kind is Platform Jobs' alone. */
const person = (role, subject, title, kinds, why) =>
  Object.freeze({ owner: "person", role, subject, title, kinds: Object.freeze([...kinds]), why });

/** ★★★ One row per registered job type (src/queue/jobPolicy.mjs JOB_POLICY / TASK_LIST). */
export const JOB_OWNERS = Object.freeze({
  dispatch_outbox: platform("delivers every event of a practice; a listener that dies is owned per listener below"),
  sweep_tenants: platform("the once-a-minute sweep for all practices — system work, no practice can act on it"),
  deliver_notification_email: person("admin", "notification_recipient", "email_not_sent", PRACTICE_ACTIONABLE,
    "02 §6 email.failed → 'reconnect email' (owner); 07 §7 'Email couldn't send / mailbox disconnected → Needs you " +
    "task'. ★ ONLY when the message itself was refused as invalid (a bad address) or the recipient is gone: a refused " +
    "API key or a Resend outage is ours, and 07 §7's row for that is the red Settings card, not a task per client."),
  // ★ RULED — the maintainer, 25 Sep 2026: the six coordinator-added `person` rows (this one, send_waitlist_offer,
  //   waitlist_offer_expiry, notify_referral_sent, notify_waitlist_offer, notify_hold_expired) are
  //   ACCEPTED as built. They are PRACTICE_ACTIONABLE only, so validation/not_found reaches a practice
  //   while a revoked key or provider outage never can, and the guard was untouched. Settled, not
  //   accepted-under-protest.
  // ★ Stage 12 task 12.9 (the referral email). Added 25 Sep 2026 by the coordinator, NOT by 12.9's builder:
  //   `assertGiveUpOwners` refuses to load `tasks.mjs` unless every TASK_LIST job has a row here, and
  //   STAGE-12-PLAN.md §12.9 never names this file (grepped: zero hits), so registering the job broke the
  //   module for everyone. Modelled on `deliver_notification_email` directly above — it is the same kind
  //   of failure: one outbound email, refused.
  //   ★ `admin`, not `coach`: a referral is a practice-level relationship with an outside party, and the
  //   schema records no coach relationship to a network party (only to a person, through their sessions).
  //   ★ PRACTICE_ACTIONABLE only, so a revoked Resend key or a provider outage stays OURS and does not open
  //   "the referral couldn't be sent" in every practice at once — I-1's false accusation at scale, which is
  //   the failure this whole file exists to prevent.
  deliver_referral_email: person("admin", "event_subject", "referral_not_sent", PRACTICE_ACTIONABLE,
    "07 §7 'Email couldn't send → Needs you task'. The partner was never told about the referral, and the " +
    "practice can re-send it or correct the address. ★ ONLY when the message itself was refused."),
  deliver_webhooks: person("admin", "event_subject", "webhook_not_sent", PRACTICE_ACTIONABLE,
    "07 §7 'Webhook endpoint failing → Developer delivery log; owner in-app'. ★ The receiver's own failures never " +
    "reach here (deliverEventToSubscribers records them per endpoint and retries): a give-up of THIS job means the " +
    "endpoint's configuration or the event's subject is wrong, which is the practice's to fix in Settings → Developer."),
  retry_webhooks: platform("re-sends a practice's failed webhooks on a timer; each endpoint's own give-up is a job.gave_up fact"),
  // ★ Task 9.14 (CT-096) — n8n delivery and retry. deliver_n8n posts to the platform-wide n8n sink;
  //   a failure is n8n being down or unreachable (dependency/timeout/rate_limited) — outside the
  //   practice's control — or the event's subject missing (not_found). Both surface on Platform Jobs;
  //   retry_n8n is the per-tenant periodic sweep, same shape as retry_webhooks.
  deliver_n8n: platform("sends an event to n8n's inbound webhook (a platform-wide sink, not per-practice)"),
  retry_n8n: platform("re-sends a practice's failed n8n deliveries on a timer; the delivery itself has no per-practice configuration"),
  archive_document_pdf: person("admin", "document", "pdf_not_saved", PRACTICE_ACTIONABLE,
    "07 §7 'Document PDF not archived → Document shows PDF pending; owner task after 1 h'. ★ Only when the document " +
    "itself is the problem (nothing to render, the record is gone); storage being down is ours."),
  seed_template_library: platform("prints the built-in template masters for the library's current version; a failure is a print or queue fault, re-run by the retry"),
  reencrypt_document_files: platform("seals each workspace's stored document files with its own key, or moves them to a newly active key; a failure is a storage or key fault, re-run by the retry"),
  close_orphan_tasks: platform("tidies tasks whose subject is gone — bookkeeping"),
  sweep_run_schedule: platform("queues a practice's due client-site pulls — bookkeeping"),
  run_pull: platform("a failed pull is recorded as a reading and shown on Client sites (P20.9); the job itself gives up only on a fault in the code"),
  prune_run_payloads: platform("retention of old pull payloads — bookkeeping"),
  prune_bookkeeping: platform("retention of settled delivery, webhook, idempotency and give-up bookkeeping"),
  // ★ Stage 17 Task 17.16 — the nightly usage reconciliation. Reconciling live usage against provider
  //   truth is a system operation; divergences are logged as events (settings.usage.reconciled) but
  //   a reconciliation failure itself is not a practice's to act on — it's a provider/system issue.
  usage_reconcile: platform("usage reconcile — Platform Usage shows the practice red"),
  document_detect_page: platform("one page of an AI look for fields; the provider's refusals and failures are written on the page itself, so a give-up here is the platform's (database or storage) and the person keeps the program's own result for that page"),
  document_ai_draft: platform("an AI draft or edit; the provider's refusals and failures are written on the draft itself, so a give-up here is the platform's (database or secrets) and the person sees the draft as failed"),
  document_ai_platform_watch: platform("the hourly check of AI spend against the ceiling; a failure means an alert email may be late, and changes nothing a workspace sees"),
  docustay_welcome: platform("the welcome series email for a new account; a failure is ours, the person simply gets no welcome mail and nothing in the product changes"),
  docustay_seat_log: platform("daily seat count for the pricing review; a failure is ours and changes nothing a workspace sees"),
  push_booking_to_calendar: platform("a session could not be put on a coach's Google Calendar; the booking itself is unaffected and the coach's calendar status shows 'needs attention' — a provider outage or a lapsed sign-in is not something a practice answers by task"),
  send_booking_reminder: person("member", "booking", "reminder_not_sent", PRACTICE_ACTIONABLE,
    `07 §7's rule for a failure the practice can answer applies: the client was not reminded, and the session's coach ` +
    "can remind them by hand. ★ Only when the booking or the client's contact details are the problem — a mail " +
    `provider outage is ours, and the coach cannot make it send.`),
  // ★ Spec 03b task 3b.4 (07 §3 line 45: "Gives up → surfaces: Owner in-app"). "Owner" maps to
  //   `admin` per this file's own convention (§★★ WHO above — the practice has no separate "owner"
  //   rank). Subject is the booking itself, reusing `bookingSubject`/`TITLES.hold_not_released`
  //   below — the same shape `send_booking_reminder`'s row uses just above.
  booking_hold_expiry: person("admin", "booking", "hold_not_released", PRACTICE_ACTIONABLE,
    "07 §3's own row for this job name: 'Retries 3 | Gives up → surfaces: Owner in-app'. Releasing a " +
    "pending_consent hold automatically failed repeatedly; the practice can check the booking by hand " +
    "and release or confirm it themselves. ★ Only when the booking's own data is the problem — a " +
    "database or queue outage is ours, never a practice's task."),
  // ★ Task 13.15, in `booking_hold_expiry`'s own shape directly above (07 §3's neighbouring row for
  //   the waitlist offer). `admin`, not `coach`: a freed slot is offered from the WAITING LIST, which
  //   is a practice-level queue, not one coach's own booking.
  send_waitlist_offer: person("admin", "booking", "waitlist_offer_not_sent", PRACTICE_ACTIONABLE,
    "07 §3's row for the waitlist offer: the offer email couldn't be sent, and the practice can offer " +
    "the freed slot to the client by hand or resend it. ★ Only when the offer's own data is the " +
    "problem — a mail provider outage is ours."),
  waitlist_offer_expiry: person("admin", "booking", "waitlist_offer_not_returned", PRACTICE_ACTIONABLE,
    "07 §3's row for the waitlist offer window: an unclaimed offer couldn't be returned to the list " +
    "automatically, and the practice can check the entry by hand. ★ Only when the entry's own data is " +
    "the problem — a database or queue outage is ours."),
  // ★ B-3b — the periodic sweep that releases an expired signature hold (`pending_signature` past
  //   `hold_expires_at`). Same shape as `booking_hold_expiry` above: `person`/`admin`/`booking`/
  //   `hold_not_released`, PRACTICE_ACTIONABLE only.
  release_signature_holds: person("admin", "booking", "hold_not_released", PRACTICE_ACTIONABLE,
    "releasing an unsigned-signature hold failed repeatedly; the practice can check the booking by " +
    "hand and release or confirm it. ★ Only when the booking's own data is the problem — a database " +
    "or queue outage is ours."),
  // QUEUE §23.4.6 — sending a scheduled document: the failure stays on the document (it remains a draft with its schedule) — platform-owned system work.
  process_deletions: platform("carries out account and workspace deletions after their cooling-off period; a failure is written on the request itself and retried on later sweeps, so a give-up here is the platform's (database, storage or identity provider)"),
  send_scheduled_documents: platform("sends uploaded documents at their chosen time; one that cannot be sent stays a draft for its author"),
  reap_orphan_jobs: platform("clears jobs of practices that no longer exist — system work"),
  sweep_due: platform("acts on a practice's due dates; each fact it emits has its own listeners"),
  watch_system: platform("the health watcher — the maintainer is alerted by its checks, not by a practice"),
  daily_summary: platform("the 7 am summary to the maintainer — nobody in a practice is involved"),
  // ★ Stage 9 task 9.12 (F622 follow-up) — the keyring re-wrap job. Global across every tenant's
  //   stored secrets, like watch_system/reap_orphan_jobs/daily_summary above: no single practice's
  //   secret is this job's subject, a master-key rotation is a platform operation, and a give-up here
  //   (a bad KEYSTONE_MASTER_KEY_PREVIOUS, a database fault) is nothing any practice could act on.
  rewrap_secrets: platform("re-wraps every tenant's stored secrets under a new master key version — a platform-operator rotation, not a practice's own work"),
  // ★★ Task 3a.4 (spec 03a §7, verbatim): "sweep_calendar_renewal, sweep_calendar_pull — platform
  //    (system-wide sweeps, no single practice's fault, same reasoning as sweep_tenants)." A single
  //    connection's OWN renewal failure is surfaced separately and immediately — the
  //    `CalendarSyncBroken` banner (read directly off `calendar_connection.status`) and the
  //    `calendar.connection.renewal_failed` event (§5) — not through this job-level give-up, which is
  //    about the SWEEP itself failing to run (a database/queue fault), never about one connection.
  //    §7's OTHER row on this same subject — "push job's give-up … — person, role coach, subject
  //    calendar_connection" — belongs to the `PUSH_TO_CALENDAR` listener task 3a.3 explicitly left
  //    unwired (F678, that task's own scope note); no `person`/`calendar_connection` row is added
  //    here for it, so as not to half-wire a listener give-up path this task does not register.
  sweep_calendar_renewal: platform("renews every practice's calendar sync channels on a timer — a single connection's own renewal failure is surfaced immediately on CalendarSyncBroken and calendar.connection.renewal_failed (spec 03a §5/§7), not through this job-level give-up"),
  sweep_calendar_pull: platform("polls every practice's connected calendars for remote changes on a timer — system-wide sweep, no single practice's fault, same reasoning as sweep_tenants (spec 03a §7)"),
  // ★ Wave C4.2 — campaign bulk-send job. If sending a batch fails (the batch/campaign is gone,
  //   the segment is invalid, or the event cannot be emitted), the job opens an admin task on
  //   the campaign event. Partial failures per-recipient are tracked on the batch but do not fail
  //   the job; re-queueing resumes from where it left off.
  deliver_campaign_batch: person("admin", "event_subject", "tasks_not_updated", PRACTICE_ACTIONABLE,
    "Wave C4 — sending a campaign batch failed; the practice can retry sending by re-queuing the " +
    "campaign_send_batch job or resuming the campaign send. ★ Only when the batch/campaign/segment " +
    "data is the problem; a network outage during partial sends is tracked on the batch."),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  run_automation_step: platform("executes a step within an automation — system work, no practice can act on a step-execution fault"),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  sweep_automations: platform("queues automations due for a practice on a timer — system-wide sweep, no single practice's fault"),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  staff_day_summary: platform("the daily staff summary — nobody in a practice is involved"),
  // ★ Task 20.21 — the workbench lifecycle sweep (nightly per tenant). System work: trial ending checks,
  //   setup-stalled detection, and usage warnings are computed per tenant but depend on provider data
  //   (Stripe subscription state) and system decisions (meter reading rules). A failure is ours.
  sweep_workbench_lifecycle: platform("workbench lifecycle sweep — checks trial ending, setup staleness, and usage within tenant, emits lifecycle/onboarding/usage events"),
  // ★★★ Stage 14 task 14.26 — the Stripe catalogue sync job. `platform`, not `person`: its subject
  //   is a service/package/plan/discount, and NONE of the four are in `TASKABLE` (this file's own
  //   set, above) — `resolveSubject`'s `event_subject` branch would return `null` for every one of
  //   them, and `openGiveUpTask` would log "its subject could not be found" for a catalogue item
  //   that is sitting right there, unread — the EXACT lie this file's own IM-6 note (above,
  //   `documentSubject`) says was already found and fixed once for documents. Rather than repeat
  //   that defect for a fifth subject kind, this stays `platform`: the realistic give-up cause is
  //   Stripe itself being unreachable (dependency/timeout) — `NEVER_THE_PRACTICE`'s own set already
  //   says that is ours, never a false accusation against a practice with nothing to click.
  catalogue_stripe_sync: platform(
    "syncs a catalogue item's Stripe product/price/coupon on the practice's own connected account; " +
    "its subject (service/package/plan/discount) is not one `openGiveUpTask` can resolve to a task " +
    "(none of the four are in TASKABLE), and the realistic failure — Stripe unreachable — is ours, " +
    "never the practice's to act on."),
  // ★ Stage 20 task 20.3 — the metadata backfill job. Failure is Stripe unreachable (dependency),
  // not a practice's to act on; the job is enqueued manually per practice.
  stripe_metadata_backfill: platform("stamps mirrored Stripe objects with metadata — manual per practice, platform-owned"),
  // ★ Stage 20 task 20.50 — the lead scoring sweep (nightly per tenant). System work: scores all leads
  //   from 90-day facts. A failure is a database/queue issue, ours to fix, never a practice's to act on.
  sweep_lead_score: platform("scores leads from 90-day facts (email, funnel, booking, consent, documents) — system-wide sweep, no single practice's fault"),
  // ★ PHASE-4 task L5.4 — the nightly money divergence sweep. `platform`: reconciling our invoice/
  //   subscription mirror against Stripe's own truth is a system operation with no manual per-
  //   practice action to take, and the realistic failure (Stripe unreachable, a database fault) is
  //   ours, same reasoning `usage_reconcile`/`catalogue_stripe_sync` above give for their own rows.
  money_divergence_sweep: platform(
    "nightly reconciliation of invoices/subscriptions against Stripe; a failure is ours, not something a practice can act on"),
  // ★ credits pipeline — the nightly catch-up of the idempotent credit grant: a failure is ours (a handler or database fault), the practice has no action to take.
  credit_catchup_sweep: platform(
    "nightly catch-up granting session credits for invoices Stripe says are paid; a failure is ours, not something a practice can act on"),
});

/** ★★★ One row per dispatcher listener (src/queue/tasks.mjs LISTENER). */
export const LISTENER_OWNERS = Object.freeze({
  notify_document_sent: person("admin", "document", "sign_request_not_sent", PRACTICE_ACTIONABLE,
    "07 §7 'Email couldn't send / mailbox disconnected → Needs you task' — the signer was not told the document is " +
    "waiting for them. ★ Only when the request itself was refused (the signer's address, a document with no subject)."),
  // ★ Stage 12 task 12.9's dispatcher listener — same reason and same reasoning as `deliver_referral_email`
  //   in JOB_OWNERS above. Added 25 Sep 2026 by the coordinator; the plan section never named this file.
  notify_referral_sent: person("admin", "event_subject", "referral_not_sent", PRACTICE_ACTIONABLE,
    "07 §7 'Email couldn't send → Needs you task' — the referral was recorded but the partner was never " +
    "told, and the practice can send it again. ★ Only when the referral's own data is the problem."),
  run_document_detect_job: platform("hands a queued AI look for fields to the worker, one task per page; the person sees the pages that failed on the job itself, so a give-up here is the platform's"),
  run_document_ai_job: platform("hands a queued AI draft or edit to the worker (a job); the person sees the draft itself as failed or done, so a give-up here is the platform's"),
  archive_document_pdf: person("admin", "document", "pdf_not_saved", PRACTICE_ACTIONABLE,
    "07 §7 'Document PDF not archived → Document shows PDF pending; owner task after 1 h'. ★ Only when the document " +
    "itself is the problem; storage being down is ours."),
  schedule_booking_reminder: person("member", "booking", "reminder_not_set", PRACTICE_ACTIONABLE,
    `07 §7's rule for a failure the practice can answer: no reminder will go out for this session, and its coach can ` +
    "remind the client. ★ Only when the booking's own data is the problem — a queue outage is ours."),
  notify_booking_reminder: person("member", "booking", "reminder_not_sent", PRACTICE_ACTIONABLE,
    `07 §7's rule for a failure the practice can answer: the reminder fired but nobody was notified, and its coach can ` +
    "remind the client. ★ Only when the booking or the client's details are the problem."),
  reschedule_booking_reminder: person("member", "booking", "reminder_not_set", PRACTICE_ACTIONABLE,
    `07 §7's rule for a failure the practice can answer: the reminder was not moved to the new time, and its coach can ` +
    "remind the client. ★ Only when the booking's own data is the problem."),
  unschedule_booking_reminder: platform(
    "send_booking_reminder re-reads the booking when it fires, so a cancelled session is never reminded; the queued job is only tidied — nobody in the practice is affected"),
  task_chains: person("admin", "event_subject", "tasks_not_updated", PRACTICE_ACTIONABLE,
    "07 §7's rule for a failure the practice can answer: a task the practice relies on was not opened or closed, and " +
    "they can check it by hand. ★ Only when the record the chain is about is the problem; a database outage is ours."),
  webhooks: person("admin", "event_subject", "webhook_not_sent", PRACTICE_ACTIONABLE,
    "07 §7 'Webhook endpoint failing → Developer delivery log; owner in-app' — the practice's connected apps missed " +
    "this update. ★ Only when the subscription or the event's subject is the problem, which is theirs in Settings."),
  // ★ Task 13.15 — the listener that ENQUEUES send_waitlist_offer/waitlist_offer_expiry. Its own
  //   give-up means neither job ever got queued at all, same reasoning schedule_booking_reminder's
  //   row above gives for the identical shape (an enqueue-only listener whose failure is invisible
  //   downstream because there is no downstream job to fail).
  notify_waitlist_offer: person("admin", "booking", "waitlist_offer_not_sent", PRACTICE_ACTIONABLE,
    "07 §3's row for the waitlist offer: the offer was never queued for sending, and the practice can " +
    "offer the freed slot to the client by hand. ★ Only when the event's own data is the problem — a " +
    "queue outage is ours."),
  // ★ Task 13.15 — the hold itself DID release (booking_hold_expiry succeeded); only the in-app
  //   notice to staff failed. `hold_lapse_not_notified` (not `hold_not_released`, which describes a
  //   different failure — the release itself not happening) says so precisely.
  notify_hold_expired: person("admin", "booking", "hold_lapse_not_notified", PRACTICE_ACTIONABLE,
    "the 24-hour consent hold already lapsed and released the slot; only the in-app notice to the " +
    "practice's admin(s) failed to send, and the practice can check the booking by hand. ★ Only when " +
    "the booking's own data is the problem — a database outage is ours."),
  // ★ Task 14.27 — the loyalty accrual listener. `platform`, not `person`: the ledger's own UNIQUE
  //   constraint (tenant_id, reason, source_type, source_id, app_user_id) makes a retry safe, so a
  //   real give-up here is a database/queue fault, not a bad record — and Stage 14 gives staff no
  //   manual point-award path to act on with a task (the `adjust` reason is Stage 15's, per
  //   src/items/loyalty.mjs's own header). A missed accrual is ours to fix, never a false accusation
  //   opened against a practice with nothing it can do (I-1's own reasoning above).
  loyalty_accrue: platform(
    "credits a practice's loyalty ledger for an attended visit; the loyalty_entry UNIQUE constraint " +
    "(14.7/0414) makes a redelivered event safe, and this stage gives staff no manual accrual to act " +
    "on — a database or queue fault is ours, never a practice's task."),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  money_emails: platform("sends payment-related emails — practice can act only on validation/not_found failures; provider outages are ours"),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  money_owner_notice: platform("owner notification related to payments — system-generated, not a practice's to resolve"),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  money_no_show: platform("no-show related to payment processing — not a practice's to act on"),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  money_loyalty: platform("loyalty ledger update — database operation, not a practice's to retry"),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  automations: platform("automation execution — practice cannot act on automation step failures"),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  enqueue_campaign_batch: platform("enqueues a campaign batch for sending — like schedule_booking_reminder, enqueue failures are platform's"),
  // ruled: platform — the maintainer, 25 Sep 2026. Never silent (the Platform Jobs ledger row always writes), never accuses a practice.
  notify_payment_received: platform("payment receipt notification — delivery failure is ours, not a false accusation"),
  // ★★★ Stage 14 task 14.26 — the listener that ENQUEUES catalogue_stripe_sync. Same `platform`
  //   reasoning as the job's own row in JOB_OWNERS above (this listener's own give-up means the job
  //   never got queued at all, same enqueue-only shape `schedule_booking_reminder`'s `person` row
  //   above describes for a DIFFERENT subject kind — but a catalogue item cannot take that shape
  //   here, since none of service/package/plan/discount are in TASKABLE; see the job row's comment).
  catalogue_sync: platform(
    "enqueues catalogue_stripe_sync for a service/package/plan/discount; its subject is not one " +
    "openGiveUpTask can resolve to a task (none of the four are in TASKABLE), and a queue fault here " +
    "is ours, never a practice's task."),
  // ★ Task 20.4 — the Stripe customer sync listener (create on person.created, sync on person.archived).
  ensure_stripe_customer: platform("identity mirror — ours"),
  // ★ B-2 (F799) — GRANT_CREDITS. `platform`: granting session credits from a paid invoice is
  //   idempotent by source (grantCredits' own entitlement dedupe), so a real give-up here is a
  //   queue or database fault, not a bad record — never a practice's task.
  grant_credits: platform(
    "granting session credits from a paid invoice is idempotent by source; a failure is a queue " +
    "or database fault, not something a practice can act on"),
  // ★ B-3b — CONFIRM_HELD_BOOKINGS. `platform`: confirming a held booking when its document is
  //   executed is idempotent system work (confirmHeldBookings' own exactly-once UPDATE), so a real
  //   give-up here is a queue or database fault, not something a practice can act on.
  // ★ PH1 — business analytics to PostHog: nothing a workspace can act on; a give-up is PostHog or network trouble for us to see.
  posthog: platform("copies a committed Docustay event to PostHog for Docustay's own analytics; a failure is a PostHog or network fault, not something a workspace can act on"),
  confirm_held_bookings: platform(
    "confirming a held booking when its document is executed is idempotent system work; a failure " +
    "is a queue or database fault, not something a practice can act on"),
  // ★ B-5b — START_SUBSCRIPTION. `person`, admin, per the task's own instruction: a subscription
  //   failed to start after its document/estimate was signed/accepted, and the practice can open the
  //   record and retry it by hand (copy: TITLES.subscription_not_started, B-5 field 4).
  //   ★★ NOTE (flagged, not silently worked around): both emit sites for money.subscription.
  //   start_failed (src/documents/writes.mjs, src/money/estimates.mjs — B-5, landed) set
  //   `subjectType: "subscription"`, `subjectId: <plan id>`. "subscription" is not in TASKABLE (only
  //   person/account/document/booking/entitlement/run_schedule_item, this file's own set above) and is
  //   not document/booking either, so `resolveSubject`'s `event_subject` branch returns null for THIS
  //   listener's own event every time — the same shape `catalogue_stripe_sync`'s own comment above
  //   describes for a different subject, where that row stayed `platform` for exactly this reason. This
  //   row is built to the letter of the task (a `person` row, admin, this title) but as wired today it
  //   can only ever resolve "no_subject", never open the task the copy describes. Fixing that needs
  //   either TASKABLE (and the task table's own CHECK, 0055) extended by a migration, or the emit sites
  //   changed to a TASKABLE subject_type — both outside this task's file list (tasks.mjs,
  //   giveUpOwners.mjs, and a new test only) — so it is recorded here rather than guessed at.
  start_subscription: person("admin", "event_subject", "subscription_not_started", PRACTICE_ACTIONABLE,
    "a subscription didn't start after the client's document or estimate was signed/accepted, and the " +
    "practice can open the record and retry the subscription by hand. ★ Only when the subscription's " +
    "own data is the problem (a bad plan, no customer) — Stripe being unreachable or our credentials " +
    "being refused is ours."),
  // ★ F836, "7 missing emails" brief, 1 Oct 2026 — same shape as notify_document_sent/
  //   notify_referral_sent above: the notification/email never went out, and the practice can see
  //   the underlying fact (the lapsed/declined document, the credit note, the package sale) and
  //   follow up by hand even though nobody was told. Only when the event's own data is the problem.
  notify_document_expired: person("admin", "event_subject", "expiry_notice_not_sent", PRACTICE_ACTIONABLE,
    "a document lapsed unsigned and the sender was never told — the practice can still see it under " +
    "Documents and follow up by hand."),
  notify_document_declined: person("admin", "event_subject", "decline_notice_not_sent", PRACTICE_ACTIONABLE,
    "a document was declined and the sender was never told — the practice can still see it under " +
    "Documents and follow up by hand."),
  notify_credit_note_issued: person("admin", "event_subject", "credit_note_notice_not_sent", PRACTICE_ACTIONABLE,
    "a credit note was issued and the client was never told — the practice can still see it on the " +
    "invoice and follow up by hand."),
  notify_package_purchased: person("admin", "event_subject", "package_notice_not_sent", PRACTICE_ACTIONABLE,
    "a client bought a package and was never told — the practice can still see the sale and follow " +
    "up by hand."),
  // ★ PART 2 ADDITION ("every email on the one system", 1 Oct 2026) — ONE listener fans out across
  //   ~71 topics (genericNotifications.mjs) whose subjects span person/document/booking/entitlement/
  //   task/message_thread — no single `person` row's role+subject+title fits all of them, and several
  //   of those subject kinds are not even in TASKABLE above. `platform`: the underlying fact each
  //   topic represents is already tracked on its own real record (the document, the booking, the
  //   task) regardless of whether this notice sends; a failed SEND here is an informational-notice
  //   miss, not a blocked practice action, so it is ours to retry/fix, never a practice task.
  generic_notice: platform(
    "fans out across ~71 heterogeneous topics (genericNotifications.mjs) whose subjects span person/" +
    "document/booking/entitlement/task/message_thread — no single role+subject fits all of them, and " +
    "the fact each topic represents is already tracked on its own real record either way; a failed " +
    "notice send is ours to retry, not a practice task."),
});

/**
 * ★★ THE LOAD-TIME GUARD — no job type or listener without a row, no row without a job type or listener, and every
 *    `person` row names a role, a subject kind and a title that exist. Throws; src/queue/tasks.mjs calls it at load.
 */
export function assertGiveUpOwners({ jobs, listeners, jobOwners = JOB_OWNERS, listenerOwners = LISTENER_OWNERS }) {
  const problems = [];
  const check = (what, names, rows) => {
    for (const n of names) if (!Object.hasOwn(rows, n)) problems.push(`${what} "${n}" has no owner row`);
    for (const n of Object.keys(rows)) if (!names.includes(n)) problems.push(`owner row "${n}" names no ${what}`);
    for (const [n, r] of Object.entries(rows)) {
      if (r?.owner === "platform") {
        if (typeof r.why !== "string" || r.why.trim().length < 10) problems.push(`${what} "${n}": platform row without a reason`);
      } else if (r?.owner === "person") {
        if (!OWNER_ROLES.includes(r.role)) problems.push(`${what} "${n}": role "${r.role}" is not one of ${OWNER_ROLES}`);
        if (!SUBJECT_KINDS.includes(r.subject)) problems.push(`${what} "${n}": subject "${r.subject}" is not one of ${SUBJECT_KINDS}`);
        if (!Object.hasOwn(TITLES, r.title)) problems.push(`${what} "${n}": title "${r.title}" does not exist`);
        // ★★★ I-1: a person row without a kinds list would silently mean "every failure is the practice's", which is
        //     the defect. An EMPTY list is refused too — a row that can never open a task should be `platform`.
        if (!Array.isArray(r.kinds) || r.kinds.length === 0) problems.push(`${what} "${n}": no failure kinds a practice can act on`);
        else for (const k of r.kinds) {
          if (NEVER_THE_PRACTICE.includes(k)) problems.push(`${what} "${n}": "${k}" is ours, never the practice's`);
          else if (!PRACTICE_ACTIONABLE.includes(k)) problems.push(`${what} "${n}": "${k}" is not a kind a practice can act on`);
        }
      } else {
        problems.push(`${what} "${n}": owner must be "person" or "platform", got ${JSON.stringify(r?.owner)}`);
      }
    }
  };
  check("job type", jobs, jobOwners);
  check("listener", listeners, listenerOwners);
  if (problems.length) {
    throw new Error(`every give-up must have an owner (spec 07 §4 rule 6) — src/queue/giveUpOwners.mjs:\n  ${problems.join("\n  ")}`);
  }
}

export const giveUpTaskTopic = (kind, name) => `${kind === "listener" ? "listeners" : "jobs"}.${name}.gave_up`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID.test(v);

async function firstAdmin(tx) {
  const { rows } = await tx.query(
    `SELECT id FROM keystone.app_user
      WHERE role = 'staff' AND staff_role IN ('owner', 'admin') AND archived_at IS NULL
      ORDER BY (staff_role = 'owner') DESC, created_at, id LIMIT 1`);
  return rows[0]?.id ?? null;
}
async function firstName(tx, userId) {
  if (!userId) return null;
  const { rows } = await tx.query(
    `SELECT coalesce(nullif(btrim(preferred_name), ''), nullif(btrim(first_name), ''),
            nullif(btrim(split_part(display_name, ' ', 1)), '')) AS first
       FROM keystone.app_user WHERE id = $1`, [userId]);
  return rows[0]?.first ?? null;
}
async function coachOf(tx, subject) {
  if (subject.type === "booking") {
    const { rows } = await tx.query(
      `SELECT h.id FROM keystone.booking b JOIN keystone.app_user h ON h.id = b.host_id
        WHERE b.id = $1 AND h.role = 'staff' AND h.archived_at IS NULL`, [subject.id]);
    return rows[0]?.id ?? null;
  }
  if (subject.type === "person") {
    const { rows } = await tx.query(
      `SELECT h.id FROM keystone.booking_participant bp
         JOIN keystone.booking b ON b.id = bp.booking_id
         JOIN keystone.app_user h ON h.id = b.host_id
        WHERE bp.app_user_id = $1 AND b.state <> 'cancelled' AND h.role = 'staff' AND h.archived_at IS NULL
        ORDER BY b.starts_at DESC LIMIT 1`, [subject.id]);
    return rows[0]?.id ?? null;
  }
  return null;
}

/**
 * The subject the task hangs on, and the facts its title needs — read from the CURRENT records, in this practice's
 * transaction (RLS). Returns null when there is nothing a task can hang on.
 */
// ★★★ IM-6 (task-14-review) — A THIRD ANSWER, BECAUSE THERE ARE THREE THINGS THAT CAN HAPPEN.
//     `resolveSubject` used to answer a subject or `null`, and `null` was logged as "its subject could not be found".
//     But a document is readable only AS A VIEWER (document_is_visible fails closed on none — F527/0157) and the only
//     viewer this path has is a practice admin. A practice with no admin therefore got "subject could not be found"
//     for a document that is sitting right there, untouched. That is F527's own mistake repeated in the log file:
//     "cannot look" written down as "looked, gone" — and it sends whoever reads it hunting for a deleted document
//     instead of for the practice's missing admin, which is the thing that actually needs doing.
const NO_ADMIN = Symbol("no_practice_admin");

async function resolveSubject(tx, kind, { payload, ev, adminId }) {
  // ★★★ I-2: the subject is the DOCUMENT, so two documents of one client are two tasks and the same document twice is
  //     one. The person is still read — the title names them — but they are no longer what the task hangs on.
  const documentSubject = async (docId) => {
    if (!isUuid(docId)) return null;
    // ★★★ IM-6 — NOT "not found". See the note above NO_ADMIN: the document is unread because there is no staff
    //     viewer to read it as, and unassignable because that same admin is who the task would go to.
    if (!adminId) return NO_ADMIN;
    // ★ A document is visible only to a viewer (document_is_visible fails closed on none); staff see all of it.
    // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
    const doc = await asViewer(tx, adminId, async () => instanceById(tx, { instanceId: docId }));
    if (!doc) return null;
    return { type: "document", id: doc.id,
             facts: { docTitle: doc.title, first: await firstName(tx, doc.subject_user_id) } };
  };
  const bookingSubject = async (bookingId) => {
    if (!isUuid(bookingId)) return null;
    const { rows } = await tx.query(
      `SELECT b.id, to_char(b.starts_at AT TIME ZONE coalesce(nullif(b.invitee_timezone, ''), t.timezone, 'UTC'), 'FMDay FMMonth FMDD') AS when
         FROM keystone.booking b JOIN keystone.tenant t ON t.id = b.tenant_id WHERE b.id = $1`, [bookingId]);
    return rows[0] ? { type: "booking", id: rows[0].id, facts: { when: rows[0].when } } : null;
  };
  const eventSubject = async (e) => {
    if (!e?.subject_id) return null;
    if (e.subject_type === "document") return documentSubject(e.subject_id);
    if (e.subject_type === "booking") return bookingSubject(e.subject_id);
    if (!TASKABLE.has(e.subject_type)) return null;
    return { type: e.subject_type, id: e.subject_id,
             facts: { first: e.subject_type === "person" ? await firstName(tx, e.subject_id) : null } };
  };

  switch (kind) {
    case "notification_recipient": {
      if (!isUuid(payload?.notificationId)) return null;
      const { rows } = await tx.query(`SELECT recipient_id FROM keystone.notification WHERE id = $1`, [payload.notificationId]);
      const id = rows[0]?.recipient_id;
      return id ? { type: "person", id, facts: { first: await firstName(tx, id) } } : null;
    }
    case "document":
      return documentSubject(payload?.instanceId ?? (ev?.subject_type === "document" ? ev.subject_id : null));
    case "booking":
      return bookingSubject(payload?.bookingId ?? (ev?.subject_type === "booking" ? ev.subject_id : null));
    case "event_subject": {
      let e = ev;
      if (!e && isUuid(payload?.eventId)) {
        e = (await tx.query(`SELECT id, subject_type, subject_id FROM keystone.event WHERE id = $1`, [payload.eventId])).rows[0] ?? null;
      }
      return eventSubject(e);
    }
    default:
      return null;
  }
}

/** ★ I-1 — is THIS failure one the practice can act on? An unknown or missing kind is OURS (never a false accusation). */
export const practiceCanAct = (row, failureKind) =>
  row?.owner === "person" && typeof failureKind === "string" && (row.kinds ?? []).includes(failureKind);

/**
 * ★★★ OPEN THE OWNER'S TASK for one give-up, inside the practice's own transaction `tx` (withTenant — RLS scopes every
 *     read and the insert to that practice). Idempotent: an open task for the same (topic, subject) is left as it is.
 *   ★★ `failureKind` (I-1) decides whether a person is involved at all. `ledger` (R69b) is the give-up's own identity
 *      in keystone_meta.job_failure — when it is given, the hand-off is recorded against the task IN THIS TRANSACTION,
 *      so the task and the hand-off commit together or neither does.
 * @param {{tenantId: string, kind: "job"|"listener", name: string, payload?: object, ev?: object,
 *          failureKind?: string|null, ledger?: {jobId: string|number, jobCreatedAt: string}|null}} g
 * @returns {Promise<{outcome: "platform"|"platform_kind"|"reference_skipped"|"no_subject"|"no_admin"|"opened"|
 *                             "already_open",
 *                    taskId?: string, handedOff?: boolean, unassigned?: boolean}>}
 */
export async function openGiveUpTask(tx, { tenantId, kind, name, payload = null, ev = null,
                                           failureKind = null, ledger = null }) {
  const row = (kind === "listener" ? LISTENER_OWNERS : JOB_OWNERS)[name];
  if (!row) throw new Error(`no give-up owner for ${kind} "${name}" (src/queue/giveUpOwners.mjs)`);
  if (row.owner === "platform") return { outcome: "platform" };
  // ★★★ I-1 — the job type says a person COULD be involved; the failure kind says whether one should be. A provider
  //     outage, a refused key, a bug: the practice cannot do anything about any of them, and a task claiming they can
  //     is worse than no task. The give-up is on Platform Jobs either way.
  if (!practiceCanAct(row, failureKind)) return { outcome: "platform_kind" };
  const { rows: [practice] } = await tx.query(`SELECT is_reference FROM keystone.tenant WHERE id = $1`, [tenantId]);
  if (!practice) return { outcome: "no_subject" };
  if (practice.is_reference) return { outcome: "reference_skipped" };

  const adminId = await firstAdmin(tx);
  const subject = await resolveSubject(tx, row.subject, { payload, ev, adminId });
  if (subject === NO_ADMIN) return { outcome: "no_admin" };
  if (!subject) return { outcome: "no_subject" };
  const assigneeId = row.role === "member" ? ((await coachOf(tx, subject)) ?? adminId) : adminId;
  // ★ Run 7: a JOB give-up has no event (only a listener's does), and openChainTask refuses a task without one (0353's de-duplication key), so every job give-up used to
  //   fail here and end as "failed" in the log. The give-up itself is now the event: written in this practice, about the subject, in the same transaction as the task.
  //   A retry finds the task already open by (subject, topic), so the extra fact is harmless.
  const anchorId = ev?.id ?? (await emit(tx, { tenantId, topic: "tasks.job.gave_up", emittedBy: "tasks", subjectType: subject.type, subjectId: subject.id, payload: { job: name }, actor: "worker" }))?.id ?? null;
  const r = await openChainTask(tx, {
    tenantId, topic: giveUpTaskTopic(kind, name), subjectType: subject.type, subjectId: subject.id,
    title: TITLES[row.title](subject.facts ?? {}), createdByEventId: anchorId, assigneeId,
  });
  // ★★★ R69b — THE HAND-OFF, for THIS give-up only. The function reads the practice from the ledger row itself and
  //     refuses unless this task is open, in this practice, with this topic (0158). It is not an acknowledgement.
  //   ★ A listener death has no ledger row (its Platform Jobs entry is a job.gave_up fact), so `ledger` is null there.
  let handedOff = false;
  if (ledger?.jobId != null && ledger.jobCreatedAt) {
    await tx.query(`SELECT keystone_meta.hand_off_job_failure($1::bigint, $2, $3::timestamptz, $4::uuid)`,
      [ledger.jobId, name, ledger.jobCreatedAt, r.id]);
    handedOff = true;
  }
  // ★★ IM-6, THE OTHER HALF. A person/booking give-up resolves its subject without needing a viewer, so with no
  //    practice admin the task still OPENS — and opens with `assignee_id IS NULL`. That was completely silent (the
  //    review's grep found zero hits for no admin|noAdmin|unassigned anywhere in src/queue/ or src/tasks/), which
  //    means the one state where a give-up task reaches nobody looked exactly like the state where it reached
  //    someone. The caller logs it; this reports it.
  return { outcome: r.created ? "opened" : "already_open", taskId: r.id, handedOff, unassigned: assigneeId == null };
}

/**
 * ★★ A JOB gave up (src/queue/jobPolicy.mjs, after the ledger row committed): open its owner's task in the job's
 *    practice, in a transaction of its own. NEVER throws — the ledger row is already on Platform Jobs, so a failure here
 *    is logged loudly and the give-up still has its platform owner.
 */
export async function ownJobGiveUp(name, payload, logger, { failureKind = null, jobId = null, jobCreatedAt = null } = {}) {
  const row = JOB_OWNERS[name];
  if (!row || row.owner === "platform") return { outcome: row ? "platform" : "no_owner_row" };
  // ★ I-1, before anything else: a failure the practice cannot act on never becomes a task, and never needs a practice
  //   transaction opened for it. It is on Platform Jobs, with its reason, like every give-up.
  if (!practiceCanAct(row, failureKind)) return { outcome: "platform_kind" };
  const tenantId = payload?.tenantId;
  if (!isUuid(tenantId)) {
    logger?.error?.(`${name} gave up with no practice named, so no practice task can be opened — it is on Platform Jobs.`);
    return { outcome: "no_subject" };
  }
  try {
    const ledger = jobId != null && jobCreatedAt ? { jobId, jobCreatedAt } : null;
    const r = await withTenant(tenantId, (tx) =>
      openGiveUpTask(tx, { tenantId, kind: "job", name, payload, failureKind, ledger }));
    // ★ minor M-7 (review): the skip is a RULING, not an absence. Without this line the logs show nothing at all for
    //   the reference practice and a reader cannot tell a skip from a failure to run.
    if (r.outcome === "reference_skipped") {
      logger?.info?.(`${name} gave up in the reference practice, so no task was opened there — it is on Platform Jobs.`);
    }
    if (r.outcome === "no_subject") {
      logger?.error?.(`${name} gave up in practice ${tenantId} but its subject could not be found, so no practice task was ` +
        `opened — it is on Platform Jobs.`);
    }
    // ★★★ IM-6 — the message that used to be a lie. This is not a missing subject: it is a practice with no active
    //     staff admin, so there is no viewer to read the subject as and nobody to hand the task to. Naming the
    //     practice and the actual remedy is the whole point of the line.
    if (r.outcome === "no_admin") {
      logger?.error?.(`${name} gave up in practice ${tenantId} but the practice has NO ACTIVE STAFF ADMIN, so there is ` +
        `nobody to read the subject as and nobody to hand the task to — no practice task was opened; it is on ` +
        `Platform Jobs. Give the practice an admin (keystone.app_user role='staff' staff_role='admin').`);
    }
    // ★★ IM-6 — and the half that DID open a task, at nobody.
    if (r.unassigned && (r.outcome === "opened" || r.outcome === "already_open")) {
      logger?.error?.(`${name} gave up in practice ${tenantId} and its task ${r.taskId} is open but UNASSIGNED — the ` +
        `practice has no active staff admin to give it to. It is also on Platform Jobs.`);
    }
    return r;
  } catch (e) {
    logger?.error?.(`${name} gave up in practice ${tenantId} and its owner's task could not be opened ` +
      `(${String(e?.message ?? e).split("\n")[0].slice(0, 200)}) — it is on Platform Jobs.`);
    return { outcome: "failed" };
  }
}
