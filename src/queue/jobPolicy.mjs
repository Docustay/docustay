// Stage 4 Task 6 — ★★★ THE ONE JOB POLICY: HOW MANY TIMES, HOW LONG BETWEEN, WHAT IS WORTH RETRYING, AND WHAT A
// GIVE-UP SAYS. Spec 07 §4 rules 1a, 5, 7 · 02 §2.8 · plan Task 6.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// [MEASURED before this file] every job was added with no maxAttempts, so graphile's default of 25 applied, with its own
// backoff of exp(least(attempts, 10)) seconds (node_modules/graphile-worker/dist/sql/failJobs.js) — 2.7 s, 7.4 s, 20 s …
// capped at ~6 h — and every failure, bug or outage alike, was retried the same way. Nothing wrote the give-up ledger
// (Task 1) when an ordinary job gave up; the queue check found them only as "unrecorded".
//
// ★★ THREE THINGS LIVE HERE, AND ONLY HERE:
//   1 · JOB_POLICY — one row per registered task: max attempts, the retry schedule, a plain label.
//   2 · addJobWithPolicy — the one way a job is added. runner.enqueue calls it, and every task's `helpers.addJob` IS it
//       (policeTaskList below hands each task a helpers object whose addJob is this function). db/gates/s4_job_policy
//       fails if anything in src adds a job any other way.
//   3 · policeTaskList / the failure handler — what happens when a task throws: classify, then retry on the schedule,
//       or give up at once, and on every give-up write the Task 1 ledger with a plain-language reason.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE SCHEDULE MECHANISM — DESIGN CHOICE (task-6-report.md §1).
//   graphile's failure write sets   run_at = greatest(now(), run_at) + exp(least(attempts, 10)) seconds
//   and cannot be told a different formula. So the handler, BEFORE rethrowing, moves this job's own run_at to
//       now() + wait − exp(least(attempts, 10)) seconds
//   in ONE statement on the worker's connection. graphile's own failure write then lands on exactly now() + wait.
//   ★ Why this and not "re-add myself under the same key and complete": the job stays ONE row. graphile's own
//     `attempts` column (incremented at claim, so a crash re-run is counted too) is the truthful attempt count, the job
//     key never changes hands, and there is no window in which two rows for the same work exist. A crash at any point
//     leaves the job locked; reclaimAbandonedJobs unlocks it and it runs again as the next attempt — the task's own
//     idempotence (02 §2.6, the send claim in email/send.mjs) keeps the effect single.
//   ★ The cost, stated: it depends on graphile 0.18's failure formula. test/s4_job_retries asserts the resulting run_at
//     after every attempt, so an upgrade that changes the formula fails that test instead of silently shifting times.
//
// ★★★ ATTEMPTS = 6: the first run plus one retry after each of the five waits (60 s, 5 min, 30 min, 2 h, 12 h). The
//     same reading Stage 3 ruled for listeners and webhooks (sdd/03-stage-3-events/progress.md:138, LISTENER_MAX_ATTEMPTS
//     in events/outbox.mjs) — so the 12 h wait is actually used, and a job and a listener give up after the same story.
//
// ★★★ WHAT IS RETRIED (07 §4.5, 03's kinds, http/errors.mjs RETRYABLE): dependency · timeout · rate_limited. Everything
//     else — validation, forbidden, internal, not_found, conflict, unauthenticated — goes straight to "gave up".
//   ★★ AN UNCLASSIFIED ERROR DEFAULTS TO `internal` — NOT RETRIED. Reason (report §3): every job failure this project has
//      measured in production was a bug or a gone practice that could never succeed (F486's 139, the archive's "not
//      visible", the reminder's ReferenceError), and each was retried silently for days. Giving up at once puts it in
//      front of a person (an unacknowledged ledger row turns the queue check red) the same minute. Passing problems are
//      recognised by what they ARE, not by message text: Postgres SQLSTATE classes (connection, serialization, deadlock,
//      lock, shutdown, resources), Node/undici network codes, aborts, and our own AppError kinds.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

import { AppError, ErrorKind, toAppError } from "../http/errors.mjs";
import { RETRY_SCHEDULE_SECONDS, LISTENER_MAX_ATTEMPTS, safeErrorText } from "../events/outbox.mjs";
// ★ Task 9.5 / CT-095 — the one credential scrubber. plainText calls it FIRST, before its existing
//   address/link/truncate work, so a credential cannot survive by being truncated into shape.
import { scrubSecrets } from "../logging/scrub.mjs";
// ★★★ Stage 4 Task 8 — every give-up has an owner (07 §4 rule 6): a `person` job's give-up opens its practice's task.
import { ownJobGiveUp } from "./giveUpOwners.mjs";

/** ★ The first run + one retry per wait in RETRY_SCHEDULE_SECONDS — the listeners' own number, not a second opinion. */
export const JOB_MAX_ATTEMPTS = LISTENER_MAX_ATTEMPTS;

// ★ `periodic`: re-added by the per-minute sweep under the same key. graphile's add_job in replace mode resets
//   attempts to 0 on a waiting job (sql/000012.sql add_jobs: "always reset error/retry state"), so a failing periodic
//   job used to be retried every minute forever with its error wiped each time — never counted, never given up. For
//   these, addJobWithPolicy does NOT replace a job that is waiting between retries: its schedule and its count stand.
//
// ★★★ R65 (Task 6 fix round 1, review I-1) — A PERIODIC JOB'S RETRY IS THE NEXT SWEEP (≤ 60 s), NOT THE 07 SCHEDULE.
//   The 1 m / 5 m / 30 m / 2 h / 12 h schedule is for WORK ITEMS (an email, a PDF, a webhook). A periodic job is its
//   own retry loop: the sweep comes round every minute. Giving it the long schedule meant three passing failures of
//   `sweep_tenants` stopped EVERY practice's outbox, due facts and webhook retries — and the watcher, which it also
//   enqueues — for 30 minutes, then 2 h, then 12 h, with no give-up to show for it. So periodic rows wait 60 s, and
//   `addJobWithPolicy`'s kept branch pulls a waiting periodic job to NOW when the sweep re-adds it (graphile's own
//   backoff, e^attempts, passes 60 s at the 5th attempt and cannot be compensated below `now()`). The attempt count is
//   still graphile's own and still true: six passing failures IN A ROW (about five minutes) give up with one ledger
//   row, and the next sweep starts over.
//   ★ run_pull is flagged periodic but is re-added only when its cadence is due, so its 5th wait can be graphile's
//     e^5 ≈ 148 s rather than 60 s. It records a failed pull as a reading and does not throw for one.
export const PERIODIC_RETRY_SECONDS = Object.freeze(RETRY_SCHEDULE_SECONDS.map(() => 60));

const row = (label, { periodic = false } = {}) =>
  Object.freeze({ label, periodic, maxAttempts: JOB_MAX_ATTEMPTS,
                  retrySeconds: periodic ? PERIODIC_RETRY_SECONDS : RETRY_SCHEDULE_SECONDS });

/** Graphile priority per task (LOWER RUNS FIRST; everything not listed is 0). A signed copy never waits behind AI drafts, bulk sends, reminders or sweeps. */
export const JOB_PRIORITY = Object.freeze({ archive_document_pdf: -20, dispatch_outbox: -10, document_ai_draft: -5, document_detect_page: -5, run_document_playbooks: -5 });   // Run 9: a playbook starts as a person finishes signing; the next document goes out ahead of the minute sweeps   // a person is watching an AI draft: ahead of sweeps, bulk sends and reminders (0), behind the sealed copy

export const JOB_POLICY = Object.freeze({
  dispatch_outbox:            row("Delivering a practice's events to their listeners", { periodic: true }),
  sweep_tenants:              row("The once-a-minute sweep that queues each practice's work", { periodic: true }),
  deliver_notification_email: row("Sending a notification email"),
  deliver_webhooks:           row("Sending an event to a practice's webhook endpoints"),
  retry_webhooks:             row("Re-sending a practice's failed webhooks", { periodic: true }),
  // ★ Task 9.14 (CT-096) — n8n delivery and retry. deliver_n8n posts to n8n's webhook; retry_n8n
  //   is the per-tenant periodic sweep that retries failed deliveries.
  deliver_n8n:                row("Sending an event to n8n's inbound webhook"),
  retry_n8n:                  row("Re-sending a practice's failed n8n deliveries", { periodic: true }),
  archive_document_pdf:       row("Saving a signed document's PDF"),
  run_document_playbooks:     row("Running an automation: starting it from a signed document, or carrying on after its wait"),
  seed_template_library:      row("Bringing each workspace's built-in templates up to the library's current version"),
  reencrypt_document_files:   row("Sealing each workspace's stored document files with its own key"),
  close_orphan_tasks:         row("Closing tasks whose subject is gone", { periodic: true }),
  sweep_run_schedule:         row("Queueing a practice's due client-site pulls", { periodic: true }),
  run_pull:                   row("Pulling a client site's figures", { periodic: true }),
  prune_run_payloads:         row("Clearing old client-site pull data", { periodic: true }),
  // ★ Stage 4 Task 12 — the daily bookkeeping prune (07 §3). `periodic` for R65's reason: a failed run
  //   should get its next chance on the sweep's own 60 s cadence, not sit for 12 hours; the "once a day"
  //   part is the dated job key and the future `runAt` in sweep_tenants, never the retry schedule.
  prune_bookkeeping:          row("Clearing a practice's settled bookkeeping", { periodic: true }),
  // ★ Stage 17 Task 17.16 — the nightly usage reconciliation. `periodic` for R65's reason: a failed run
  //   should get its next chance on the sweep's own 60 s cadence, not sit for 12 hours; the "once a night"
  //   part is the dated job key and the future `runAt` in sweep_tenants, never the retry schedule.
  usage_reconcile:            row("Reconciling a practice's usage against its providers", { periodic: true }),
  docustay_seat_log:          row("Counting the people who sign in to a Docustay workspace", { periodic: true }),
  docustay_welcome:           row("Sending the next welcome email to a new Docustay account", { periodic: true }),
  document_ai_draft:          row("Writing an AI draft or edit of a document"),
  document_detect_page:       row("Looking at one page of a PDF for fields with AI"),
  document_ai_platform_watch: row("Checking the platform's AI spend against its monthly ceiling", { periodic: true }),
  send_booking_reminder:      row("Sending a session reminder"),
  push_booking_to_calendar:   row("Putting a session on a coach's Google Calendar"),
  // ★ Spec 03b task 3b.4 (07 §3 line 45) — the booking hold-expiry job. NOT periodic: one job per
  //   booking, scheduled once at +24h with its own `jobKeyMode:'replace'` job key (`holdExpiryJobKey`,
  //   src/queue/tasks.mjs), the same non-periodic shape `send_booking_reminder` above uses — not a
  //   sweep re-added every minute.
  // ★★★ SPEC-VS-MECHANISM MISMATCH, NOTED NOT SILENTLY FOLLOWED (this task's own report). 03b §7's
  //     table gives this job "Retries: 3". `row()` gives EVERY non-periodic job `JOB_MAX_ATTEMPTS`
  //     (= `LISTENER_MAX_ATTEMPTS` = 6, defined above) — there is no per-job override anywhere in
  //     this file's existing mechanism, and every other job in JOB_POLICY already follows the shared
  //     6-attempt ladder regardless of what its owning spec says. Inventing a one-off override here
  //     would make this job the only one on a different retry shape for no structural reason, which
  //     is a worse inconsistency than the mismatch itself — so this row follows the EXISTING
  //     mechanism (6, via `row()`), same as every other row in this table.
  booking_hold_expiry:        row("Releasing a booking hold whose 24-hour consent window has lapsed"),
  // ★ Task 13.15 — the waitlist offer email and its own expiry. NOT periodic: one job per offer,
  //   each with its own per-entry `jobKeyMode:'replace'` key, same non-periodic shape
  //   `booking_hold_expiry`/`send_booking_reminder` above use — not a sweep re-added every minute.
  send_waitlist_offer:        row("Sending a waitlist offer"),
  waitlist_offer_expiry:      row("Returning an unclaimed waitlist offer to the list"),
  // ★ B-3b — the periodic sweep that releases an expired signature hold. `periodic`, same R65 reason
  //   as `sweep_due`/`sweep_calendar_renewal` above: a failed attempt gets its next chance on the
  //   sweep's own 60 s cadence, not 12 hours.
  release_signature_holds:   row("Release unsigned session holds", { periodic: true }),
  // QUEUE §23.4.6 — sends an uploaded document whose chosen send time has arrived. Periodic: a failed attempt gets its next chance on the next sweep.
  send_scheduled_documents:  row("Sending documents scheduled for now", { periodic: true }),
  process_deletions:         row("Deleting accounts and workspaces whose cooling-off period has ended", { periodic: true }),
  reap_orphan_jobs:           row("Clearing jobs left by practices that no longer exist", { periodic: true }),
  sweep_due:                  row("Acting on a practice's dates that have come due", { periodic: true }),
  watch_system:               row("Checking the system's health", { periodic: true }),
  // ★ Stage 4 Task 13 — the 7 am summary (07 §6). `periodic` because a failed attempt should retry
  //   on the sweep's own 60 s cadence (R65), not wait 12 hours for its next chance the same morning;
  //   the send-once guard is `keystone_meta.claim_daily_summary` (0154), not the retry schedule.
  daily_summary:              row("Sending the 7 am summary email to the maintainer", { periodic: true }),
  // ★ Stage 9 task 9.12 (06 §6, CT-063; F622 follow-up) — the keyring re-wrap job. NOT periodic: it is
  //   an operator-triggered rotation run (field 9), not a job re-added every sweep, so it uses the
  //   existing ladder — JOB_MAX_ATTEMPTS = 6, the same 1m/5m/30m/2h/12h schedule every other
  //   non-periodic job above uses — and adds no ladder of its own (field 4).
  rewrap_secrets:             row("Re-wrapping stored secrets under a new master key version"),
  // ★ Task 3a.4 (spec 03a §7) — the renewal sweep. `periodic` for the same R65 reason as every other
  //   sweep above: a failed attempt gets its next chance on the sweep's own 60 s cadence (comfortably
  //   inside Google's 24 h `RENEWAL_HEADROOM_MS`, `src/booking/calendarSync.mjs:39`), not 12 hours.
  sweep_calendar_renewal:     row(`Renewing a coach's calendar sync channel before it expires`, { periodic: true }),
  // ★ Task 3a.4 (spec 03a §7) — the pull sweep. Same `periodic` reasoning.
  sweep_calendar_pull:        row(`Pulling changes from a coach's connected calendar`, { periodic: true }),
  // ★ Wave C4.2 — campaign bulk-send job. Processes campaign_send_batch rows in resumable chunks.
  //   NOT periodic: one job per batch, re-queuing itself for the next chunk, not a sweep re-added
  //   every minute. Each job invocation sends to the next 100 recipients and updates progress.
  deliver_campaign_batch:     row("Sending a campaign batch to the next chunk of recipients"),
  // ★ 12.9 — the referral email (partner + copied person). Not periodic: one job per referral,
  //   keyed `referral-email:<referralId>`, same shape as deliver_notification_email above.
  deliver_referral_email:     row("Send a referral email"),
  // ★ Stage 14 task 14.26 — the Stripe catalogue sync. NOT periodic: one job per catalogue subject,
  //   keyed `catalogue:<subjectId>` with `jobKeyMode:'replace'`, same non-periodic shape
  //   `deliver_referral_email`/`archive_document_pdf` above use — not a sweep re-added every minute.
  catalogue_stripe_sync:      row("Syncing a catalogue item's Stripe product, price or coupon"),
  // ★ Stage 20 task 20.3 — the Stripe metadata backfill job. NOT periodic: one job per practice,
  //   enqueued manually from the platform Jobs screen, same non-periodic shape as every on-demand job above.
  stripe_metadata_backfill:   row("Stamping mirrored Stripe objects with metadata"),
  // ★ Stage 16 task 16.32 — the automation tasks.
  run_automation_step:        row("Sending a delayed automation message"),
  sweep_automations:          row("Running a practice's time-based automations", { periodic: true }),
  // ★ Stage 18 task 18.31b — the morning day summary. Per-tenant periodic job that sends each
  //   coach a one-line summary of their sessions today at 8:00 practice time.
  staff_day_summary:          row(`Telling each coach about their day`, { periodic: true }),
  // ★ Task 20.21 — the workbench lifecycle sweep. Nightly per-tenant job that emits trial ending,
  //   setup staleness, and usage warning events.
  sweep_workbench_lifecycle:   row("Checking workbench trial, setup, and usage milestones", { periodic: true }),
  // ★ Stage 20 task 20.50 — the lead scoring sweep. Nightly per-tenant job that scores leads from
  //   90-day facts (email engagement, funnel events, bookings, documents, consent) and emits
  //   growth.lead_score.crossed when a person crosses the threshold.
  sweep_lead_score:           row("Scoring leads from 90-day engagement facts", { periodic: true }),
  // ★ PHASE-4 task L5.4 — the nightly money divergence sweep. `periodic` for the same R65 reason as
  //   `prune_bookkeeping`/`usage_reconcile` directly above: a failed run gets its next chance on the
  //   sweep's own 60 s cadence, not 12 hours; "once a night" is the dated job key sweepTenants gives
  //   it, never the retry schedule.
  money_divergence_sweep:     row("Reconcile money with Stripe", { periodic: true }),
  // ★ credits pipeline (QUEUE §12.3) — the nightly catch-up of the one idempotent credit grant; `periodic` for the same reason as the sweep above.
  credit_catchup_sweep:       row("Granting credits for paid invoices the webhook missed", { periodic: true }),
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1 · FAILURES AND THEIR CLASS
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const RETRYABLE_KINDS = new Set([ErrorKind.DEPENDENCY, ErrorKind.TIMEOUT, ErrorKind.RATE_LIMITED]);

/**
 * ★ A failure a task knows how to describe: a kind (03's closed set), a plain-language reason (07 §4.7), and — only
 *   when the caller knows better than the kind — `retryable`. The one override used: an email whose outcome is IN DOUBT
 *   is a `timeout`, and still must not be retried, because a retry could send it twice (02 §2.6).
 */
export class JobFailure extends Error {
  constructor(kind, reason, { retryable, retryAfterSeconds = null, cause } = {}) {
    super(reason, { cause });
    if (!Object.values(ErrorKind).includes(kind)) throw new Error(`JobFailure: unknown kind "${kind}"`);
    this.name = "JobFailure";
    this.kind = kind;
    this.retryable = retryable ?? RETRYABLE_KINDS.has(kind);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ★ Postgres conditions that pass on their own: connection exceptions (08), transaction rollback — serialization
//   failure and deadlock (40), insufficient resources (53), lock not available / object in use (55P03, 55006), operator
//   intervention — shutdown, crash, cannot connect now (57P0x). 57014 (statement cancelled, i.e. statement_timeout) is a
//   timeout. Everything else keeps toAppError's reading (23502 → validation, 23505/23503 → conflict, 42501 → forbidden)
//   or is `internal`.
const PG_PASSING = (code) => /^(08|40|53)/.test(code) || ["55P03", "55006", "57P01", "57P02", "57P03", "57P04", "57P05"].includes(code);
// ★ Node / undici network codes. The connect-phase ones mean the request never left; either way the failure is the
//   network's, not the job's.
const NET_TIMEOUT = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const NET_PASSING = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "ENOTFOUND", "EHOSTUNREACH",
  "ENETUNREACH", "ENETDOWN", "ECONNABORTED", "UND_ERR_SOCKET", "UND_ERR_CLOSED"]);

// ★★ R64 Q2 — node-postgres / pg-pool raise their connection-level failures as plain Errors with NO SQLSTATE and no
//    code. They are recognised by the LIBRARY'S OWN CONSTANT MESSAGE, compared whole (never a substring, never text a
//    user or a query could supply), and only on an error that carries no `code`. MEASURED, pg 8.23.0 / pg-pool 3.14.0:
//      node_modules/pg/lib/client.js:204   'Connection terminated unexpectedly'   (the server or network closed it)
//      node_modules/pg/lib/client.js:749   'Client has encountered a connection error and is not queryable'
//      node_modules/pg/lib/client.js:756   'Client was closed and is not queryable'
//      node_modules/pg-pool/index.js:224   'timeout exceeded when trying to connect'        (pool exhausted)
//      node_modules/pg-pool/index.js:276   'Connection terminated due to connection timeout'
//    ★ The two pool timeouts are unreachable today (no pool sets connectionTimeoutMillis — review Q4.2); matching
//      them is harmless and keeps a future timeout from becoming a code-fault give-up. Deliberately NOT matched:
//      the bare 'Connection terminated' (client.js:204 when WE called end()) and 'Query read timeout' (not a
//      connection failure). test/s4_task6_fix1 reads these strings back from node_modules, so an upgrade that
//      rewords one fails that test instead of silently turning a blip into a give-up.
const PG_LIB_CONNECTION = new Map([
  ["Connection terminated unexpectedly", ErrorKind.DEPENDENCY],
  ["Client has encountered a connection error and is not queryable", ErrorKind.DEPENDENCY],
  ["Client was closed and is not queryable", ErrorKind.DEPENDENCY],
  ["timeout exceeded when trying to connect", ErrorKind.TIMEOUT],
  ["Connection terminated due to connection timeout", ErrorKind.TIMEOUT],
]);

const isPgError = (e) => typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && typeof e.severity === "string";

/** ★ Redacts what a reason must never carry (a credential, an address, a URL), keeps one line, bounds it. */
export function plainText(s, max = 300) {
  return scrubSecrets(String(s ?? "")).split("\n")[0]
    .replace(/[^\s@"'<>`]+@[^\s@"'<>`]+\.[A-Za-z]{2,}/g, "[address]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[link]")
    .trim().slice(0, max);
}

/**
 * ★★ WHAT KIND OF FAILURE IS THIS — decided by what the error IS, never by reading its message.
 * @returns {{kind: string, retryable: boolean, retryAfterSeconds: number|null, detail: string}}
 */
export function classifyFailure(err) {
  if (err instanceof JobFailure) {
    return { kind: err.kind, retryable: err.retryable, retryAfterSeconds: err.retryAfterSeconds, detail: plainText(err.message) };
  }
  if (err instanceof AppError) {
    // ★ M4: an `internal` AppError that WRAPS a failure (toAppError, internal(msg, cause)) is judged by what it wraps
    //   when that is recognisably passing — a 40001 stays a 40001 however many layers carry it.
    if (err.kind === ErrorKind.INTERNAL && err.cause && err.cause !== err) {
      const inner = classifyFailure(err.cause);
      if (inner.retryable) return { ...inner, detail: plainText(`${err.message}: ${inner.detail}`) };
    }
    return { kind: err.kind, retryable: err.retryable, retryAfterSeconds: null, detail: plainText(err.message) };
  }
  if (isPgError(err)) {
    const detail = safeErrorText(err);
    if (err.code === "57014") return { kind: ErrorKind.TIMEOUT, retryable: true, retryAfterSeconds: null, detail };
    if (PG_PASSING(err.code)) return { kind: ErrorKind.DEPENDENCY, retryable: true, retryAfterSeconds: null, detail };
    const kind = toAppError(err).kind;
    return { kind, retryable: false, retryAfterSeconds: null, detail };
  }
  const netCode = err?.code ?? err?.cause?.code;
  if (typeof netCode === "string" && (NET_TIMEOUT.has(netCode) || NET_PASSING.has(netCode))) {
    return { kind: NET_TIMEOUT.has(netCode) ? ErrorKind.TIMEOUT : ErrorKind.DEPENDENCY, retryable: true,
             retryAfterSeconds: null, detail: plainText(`${netCode}: ${err?.message ?? ""}`) };
  }
  if (err instanceof Error && err.code === undefined && PG_LIB_CONNECTION.has(err.message)) {
    return { kind: PG_LIB_CONNECTION.get(err.message), retryable: true, retryAfterSeconds: null,
             detail: plainText(`the database connection failed: ${err.message}`) };
  }
  if (err?.name === "AbortError" || err?.name === "TimeoutError") {
    return { kind: ErrorKind.TIMEOUT, retryable: true, retryAfterSeconds: null, detail: plainText(err.message || err.name) };
  }
  // ★★ THE DEFAULT (see the header): not recognised as passing → internal → not retried.
  return { kind: ErrorKind.INTERNAL, retryable: false, retryAfterSeconds: null, detail: safeErrorText(err) };
}

const KIND_WORDS = Object.freeze({
  [ErrorKind.DEPENDENCY]: "an outside service or the database failed",
  [ErrorKind.TIMEOUT]: "it took too long and was stopped",
  [ErrorKind.RATE_LIMITED]: "it was told to slow down",
  [ErrorKind.VALIDATION]: "what it was asked to do is not valid",
  [ErrorKind.FORBIDDEN]: "it was not allowed",
  [ErrorKind.UNAUTHENTICATED]: "it could not sign in",
  [ErrorKind.NOT_FOUND]: "something it needed was not found",
  [ErrorKind.CONFLICT]: "it conflicted with data already there",
  [ErrorKind.INTERNAL]: "an unexpected error — a fault in the code, not a passing problem",
});

const HOURS_SPENT = (attempts, schedule) =>
  schedule.slice(0, Math.max(0, attempts - 1)).reduce((a, b) => a + b, 0) / 3600;

/** ★★ 07 §4.7 — the reason stored with a give-up. One line a person can act on; never a stack trace. */
export function giveUpReason(taskName, c, { attempts }) {
  const p = JOB_POLICY[taskName];
  const label = p?.label ?? taskName;
  if (c.retryable) {
    const h = HOURS_SPENT(attempts, p?.retrySeconds ?? RETRY_SCHEDULE_SECONDS);
    return plainText(`${label} gave up after ${attempts} attempts over about ${h < 1 ? `${Math.round(h * 60)} minutes` : `${h.toFixed(1)} hours`}` +
      ` — ${KIND_WORDS[c.kind] ?? c.kind} every time: ${c.detail}`, 500);
  }
  // ★ A normally-retryable kind the task withheld (an email IN DOUBT): the reason is not "cannot help" but "could repeat".
  if (RETRYABLE_KINDS.has(c.kind)) {
    return plainText(`${label} stopped without retrying, because a retry could repeat something that may already have happened: ${c.detail}`, 500);
  }
  return plainText(`${label} stopped without retrying, because retrying cannot help — ${KIND_WORDS[c.kind] ?? c.kind}: ${c.detail}`, 500);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2 · ADDING A JOB — THE ONE WAY, AND THE QUEUE IT GOES ON
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const TENANT_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 4 TASK 9 — ONE PRACTICE CANNOT BLOCK ANOTHER (07 §4 rule 2).
//
// ★★ THE MECHANISM IS graphile's NAMED QUEUE, and it is worth stating exactly, because the word "queue" suggests
//    something it is not. [MEASURED, graphile-worker 0.18.0, node_modules/graphile-worker/dist/sql/getJobs.js,
//    "strategy 2"] a claim may take a job only when
//        jobs.job_queue_id is null
//        OR jobs.job_queue_id in (select id from _private_job_queues where is_available = true
//                                 for update skip locked)
//    and the same statement then sets that queue row's `locked_by`/`locked_at`. **So a named queue runs exactly ONE
//    job at a time across every worker and every pool** — which is precisely "one job per practice at a time" once
//    the name is the practice.
//  ★ The queue is released by the same three writes that release the job: completeJobs, failJobs and returnJobs each
//    clear `_private_job_queues.locked_by` alongside `_private_jobs.locked_by` (dist/sql/*.js). Nothing else does —
//    see `reclaimAbandonedJobs` in runner.mjs for the one graphile does NOT do.
//
// ★★★ WHY PLATFORM-WIDE JOBS GET **NO** QUEUE NAME RATHER THAN A SHARED ONE.
//     sweep_tenants · watch_system · reap_orphan_jobs · daily_summary have no practice. Putting them on one shared
//     platform queue would serialise them AGAINST EACH OTHER, and that is worse than doing nothing:
//       · `sweep_tenants` is what enqueues every practice's work and `watch_system` is what notices when it stops.
//         A slow or hung reaper on a shared queue would hold BOTH — the sweep that feeds the whole system and the
//         watcher that is supposed to report the outage. The one job that must never be blocked would be blocked by
//         the one job whose failure mode is "it did not finish".
//       · they are already bounded: each carries its own `job_key` with `replace`, so a slow run cannot stack copies
//         (tasks.mjs sweepTenants). Serialisation would buy nothing they do not already have.
//     ★ With no name their `job_queue_id` is null, so they are claimable under any load, bounded only by the
//       worker's concurrency (5). A practice can occupy at most ONE of those five slots, so the watcher and the
//       sweep cannot be starved by one busy practice — which is the actual requirement.
//   ★★ prune_run_payloads is NOT in this list although the plan grouped it with them: [MEASURED tasks.mjs:1846] it
//      is enqueued per practice with `{tenantId}`, so it is a practice's job and gets that practice's queue.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export const PLATFORM_WIDE_JOBS = Object.freeze(new Set([
  "sweep_tenants", "watch_system", "reap_orphan_jobs", "daily_summary",
  // Run 9: both are queued once when the worker starts and go through every workspace themselves (each in its own transaction). seed_template_library (Part 4R) never ran before this line:
  // the worker's own startup note said "carries no practice id, so there is no queue to put it on" and the seed was skipped (found 12 Oct while starting the local stack for Part 5).
  "seed_template_library", "reencrypt_document_files",
]));

/** ★ The one prefix. `t:` + the practice id — short, and it cannot collide with a task name. */
export const TENANT_QUEUE_PREFIX = "t:";

/**
 * ★★★ THE QUEUE A JOB GOES ON. `null` means no named queue (platform-wide work).
 * ★★ IT REFUSES a practice job with no practice. That is deliberate and it is the F#1 guard: a job that quietly
 *    landed on NO queue would still run — it would just stop being fair, silently, for that task alone, and no
 *    test would notice. So a task that is not on the platform list must name its practice or not be added at all.
 */
export function queueNameFor(name, payload) {
  if (PLATFORM_WIDE_JOBS.has(name)) return null;
  const t = payload?.tenantId;
  if (typeof t === "string" && TENANT_SHAPE.test(t)) return `${TENANT_QUEUE_PREFIX}${t.toLowerCase()}`;
  throw new Error(
    `addJob("${name}") carries no practice id, so there is no queue to put it on. Every job that is not ` +
    `platform-wide runs on its practice's queue \`${TENANT_QUEUE_PREFIX}<tenantId>\` (07 §4 rule 2), so one ` +
    `practice's backlog cannot delay another's. Either pass { tenantId } in the payload, or — if this task really ` +
    `has no practice — add it to PLATFORM_WIDE_JOBS in src/queue/jobPolicy.mjs and say why in the report. ` +
    `Got tenantId: ${JSON.stringify(t)}`);
}

/**
 * ★★★ Every job in this system is added here. `adder` is graphile's own — WorkerUtils (runner.enqueue) or a task's
 *     original helpers — and must have `addJob`; `withPgClient` is used only to read whether a periodic job is waiting
 *     between retries.
 *  ★ Refuses a task with no policy row, and a caller trying to set its own maxAttempts: the number is the policy's.
 */
export async function addJobWithPolicy(adder, name, payload, opts = {}) {
  const p = JOB_POLICY[name];
  if (!p) {
    throw new Error(`no job policy for task "${name}" — add a row to JOB_POLICY (src/queue/jobPolicy.mjs) with its ` +
      `label and whether it is periodic. A job without a policy would retry 25 times on graphile's own clock.`);
  }
  if (opts.maxAttempts !== undefined && opts.maxAttempts !== p.maxAttempts) {
    throw new Error(`addJob("${name}") asked for maxAttempts ${opts.maxAttempts}; the policy is ${p.maxAttempts}. ` +
      `Change the policy row, not the call site.`);
  }
  // ★★★ Task 9 — the QUEUE is the policy's too, for the same reason the attempt count is: fairness that a call site
  //     can opt out of is not fairness. The one place a job is added is the one place its queue is decided.
  if (opts.queueName !== undefined) {
    throw new Error(`addJob("${name}") set its own queueName ${JSON.stringify(opts.queueName)}. The queue is the ` +
      `policy's — a practice's job goes on its practice's queue and a platform job goes on none ` +
      `(queueNameFor / PLATFORM_WIDE_JOBS, src/queue/jobPolicy.mjs).`);
  }
  const queueName = queueNameFor(name, payload);
  const finalOpts = { ...opts, maxAttempts: p.maxAttempts, ...(queueName === null ? {} : { queueName }) };
  if (p.periodic && opts.jobKey && typeof adder.withPgClient === "function") {
    // ★ A periodic job WAITING BETWEEN RETRIES keeps its count: the sweep does not replace it (which would reset it).
    //   Racy by design only in the harmless direction — if it starts running between this read and the add, the add
    //   behaves exactly as graphile always did.
    //   ★★ R65: its WAIT does not stand — the sweep's re-add is its retry, so a waiting job is pulled to now (never
    //      pushed later). One statement, so a job that is claimed meanwhile (locked_at set) is not touched.
    //   ★★★ Task 9 — UNCHANGED BY NAMED QUEUES, and it has to be checked rather than assumed. A `job_key` is GLOBAL
    //       in graphile (unique on `_private_jobs.key`, not on (queue, key) — sql/000020.sql `on conflict (key)`),
    //       so this pull-forward still finds the one job under that key whatever queue it sits on, and the job keeps
    //       its `job_queue_id`. It moves `run_at` only; being DUE and being CLAIMABLE are different questions, and
    //       the second one is the queue's — a pulled-forward job still waits for its practice's queue, which is
    //       exactly right. ★ It is also why every per-practice job key carries its practice's id (tasks.mjs): two
    //       practices sharing a key would be one job, and re-adding it would MOVE it between their queues.
    const { rows } = await adder.withPgClient((pg) => pg.query(
      `UPDATE graphile_worker._private_jobs SET run_at = least(run_at, now())
        WHERE key = $1 AND locked_at IS NULL AND attempts > 0 AND attempts < max_attempts
        RETURNING id, attempts, max_attempts`, [opts.jobKey]));
    if (rows.length) return { ...rows[0], id: rows[0].id, kept: true };
  }
  return adder.addJob(name, payload, finalOpts);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3 · RUNNING A JOB — RETRY ON THE SCHEDULE, OR GIVE UP AND SAY WHY
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

// ★ graphile 0.18's failure write adds exp(least(attempts, 10)) seconds to greatest(now(), run_at)
//   (node_modules/graphile-worker/dist/sql/failJobs.js). Subtracting the same amount here makes it land on the schedule.
const GRAPHILE_FAIL_BACKOFF_SQL = `(exp(least(j.attempts, 10)) * interval '1 second')`;

/** The wait after attempt `attempt` failed: the schedule's step, or Retry-After when that is longer. */
function waitSeconds(p, attempt, retryAfterSeconds) {
  const step = p.retrySeconds[Math.min(Math.max(attempt, 1), p.retrySeconds.length) - 1];
  const ra = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.min(retryAfterSeconds, 86_400) : 0;
  return Math.max(step, Math.ceil(ra));
}

/**
 * ★★★ THE DECISION, ON THE JOB'S OWN ROW, IN ONE TRANSACTION on the worker's connection (app_worker in production):
 *     read the row as it is NOW (not the copy graphile claimed), then either move run_at to the schedule, or give up —
 *     close the attempts and write the ledger — and commit. The caller then rethrows so graphile writes the failure.
 * ★★ Stage 4 Task 8 fix 1 (R69b): a give-up also hands back THE JOB'S OWN IDENTITY (its id and its created_at as
 *    TEXT), because the hand-off is keyed on it. ★ As text, never a JS Date: created_at is a microsecond timestamptz
 *    and a Date has milliseconds — F510 is exactly that loss, and a rounded identity matches no ledger row.
 * @returns {Promise<{verdict: "retry"|"gave_up"|"superseded"|"untracked", jobCreatedAt: string|null}>}
 */
async function decide(taskName, payload, helpers, c) {
  const job = helpers?.job;
  const out = (verdict, jobCreatedAt = null) => ({ verdict, jobCreatedAt });
  if (!job?.id || typeof helpers.withPgClient !== "function") return out("untracked");   // called directly, not by graphile
  const p = JOB_POLICY[taskName];
  return helpers.withPgClient(async (pg) => {
    await pg.query("BEGIN");
    try {
      const { rows: [r] } = await pg.query(
        `SELECT j.id, j.attempts, j.max_attempts, j.key, j.locked_by, j.created_at::text AS created_at_text
           FROM graphile_worker._private_jobs j WHERE j.id = $1 FOR UPDATE`, [job.id]);
      if (!r) { await pg.query("COMMIT"); return out("untracked"); }
      // ★ SUPERSEDED: graphile's add_jobs / remove_job clear a RUNNING job's key and close its attempts when the same key
      //   is added again (new information) or removed (cancelled). A newer job owns the work — or nobody wants it.
      const superseded = job.key != null && r.key == null;
      if (c.retryable && superseded) { await pg.query("COMMIT"); return out("superseded"); }
      // ★ A job queued BEFORE this policy carries graphile's 25; the policy's number is the one that counts, so a
      //   legacy job gives up at the 6th attempt like any other instead of retrying 12-hourly for another ten days.
      const max = Math.min(r.max_attempts, p.maxAttempts);
      if (c.retryable && r.attempts < max) {
        const wait = waitSeconds(p, r.attempts, c.retryAfterSeconds);
        await pg.query(
          `UPDATE graphile_worker._private_jobs j
              SET run_at = now() + make_interval(secs => $2) - ${GRAPHILE_FAIL_BACKOFF_SQL}
            WHERE j.id = $1`, [job.id, wait]);
        await pg.query("COMMIT");
        return out("retry");
      }
      // ★★ GIVE UP: no further attempt, and the ledger row — UNACKNOWLEDGED, a person looks (Task 1 / R59).
      if (r.attempts !== r.max_attempts) {
        await pg.query(`UPDATE graphile_worker._private_jobs SET max_attempts = attempts WHERE id = $1`, [job.id]);
      }
      const reason = giveUpReason(taskName, c, { attempts: r.attempts });
      const tenantId = typeof payload?.tenantId === "string" && TENANT_SHAPE.test(payload.tenantId) ? payload.tenantId : null;
      // ★ created_at is read by the SAME statement from the row — never through a JS Date (F510: microseconds).
      await pg.query(
        `SELECT keystone_meta.record_job_failure(j.id, $2, j.created_at, $3::uuid, $4, false, NULL)
           FROM graphile_worker._private_jobs j WHERE j.id = $1`, [job.id, taskName, tenantId, reason]);
      await pg.query("COMMIT");
      return out("gave_up", r.created_at_text);
    } catch (e) {
      await pg.query("ROLLBACK").catch(() => {});
      throw e;
    }
  });
}

const POLICED = Symbol.for("keystone.jobPolicy.policed");

/** ★ Is this task function wrapped by the policy? (db/gates/s4_job_policy asserts every TASK_LIST entry is.) */
export const isPoliced = (fn) => fn?.[POLICED] === true;

function policedTask(name, fn) {
  const policed = async function policedJob(payload, helpers) {
    // ★★ THE TASK'S helpers.addJob IS THE POLICY. Every `helpers.addJob(...)` in tasks.mjs therefore goes through
    //    addJobWithPolicy without any call site having to remember it.
    const inner = helpers
      ? Object.assign(Object.create(helpers), { addJob: (n, pl, o) => addJobWithPolicy(helpers, n, pl, o) })
      : helpers;
    try {
      return await fn(payload, inner);
    } catch (err) {
      const c = classifyFailure(err);
      let verdict, jobCreatedAt = null;
      try {
        ({ verdict, jobCreatedAt } = await decide(name, payload, helpers, c));
      } catch (e) {
        // ★ Could not record the decision: graphile's own failure path still runs (the throw below), and the queue
        //   check counts a job that reaches max_attempts with no ledger row as "unrecorded" — loud, not silent.
        helpers?.logger?.error?.(`${name}: could not record the retry decision (${safeErrorText(e)}); graphile's own backoff applies to this attempt.`);
        verdict = "undecided";
      }
      if (verdict === "superseded") {
        helpers?.logger?.info?.(`${name}: failed (${c.kind}: ${c.detail}) but a newer job with the same key has taken ` +
          `over the work (or it was cancelled) — this run ends here and the newer job carries it.`);
        return { superseded: true };
      }
      if (verdict === "untracked") throw err;   // not a graphile run: the caller sees the original error
      // ★★★ Stage 4 Task 8 — the ledger row (Platform Jobs) is committed; a `person` job also opens ONE task in its
      //     practice for the role giveUpOwners names. Never throws: its own failure is logged, and the give-up keeps
      //     its platform owner.
      // ★★★ Stage 4 Task 8 fix 1 — the KIND goes with it (I-1: a provider outage is never a practice's task), and so
      //     does the give-up's own identity (R69b: the hand-off is recorded per give-up, not per row).
      if (verdict === "gave_up") {
        await ownJobGiveUp(name, payload, helpers?.logger,
          { failureKind: c.kind, jobId: helpers?.job?.id ?? null, jobCreatedAt });
      }
      const attemptNote = verdict === "retry" ? "will retry on the schedule" : verdict === "gave_up" ? "GAVE UP" : "not decided";
      // ★ The message graphile stores in last_error: plain, one line — the stack goes to the log only.
      throw new JobFailure(c.kind, plainText(`${attemptNote} — ${KIND_WORDS[c.kind] ?? c.kind}: ${c.detail}`, 500),
        { retryable: c.retryable, cause: err });
    }
  };
  policed[POLICED] = true;
  return policed;
}

/**
 * ★★★ THE TASK LIST graphile is given, every entry wrapped. Refuses to build if any task lacks a policy row or any
 *     row names no task — so a new task cannot be registered without deciding its policy.
 */
export function policeTaskList(tasks) {
  const names = Object.keys(tasks);
  const missing = names.filter((n) => !JOB_POLICY[n]);
  const stale = Object.keys(JOB_POLICY).filter((n) => !names.includes(n));
  if (missing.length || stale.length) {
    throw new Error(`JOB_POLICY does not match the task list — no policy: [${missing.join(", ")}], no task: ` +
      `[${stale.join(", ")}] (src/queue/jobPolicy.mjs).`);
  }
  return Object.freeze(Object.fromEntries(names.map((n) => [n, policedTask(n, tasks[n])])));
}
