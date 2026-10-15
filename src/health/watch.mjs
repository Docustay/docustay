// P8.10 — THE QUEUE NOBODY WATCHES, AND THE BACKUP NOBODY TAKES.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT WAS MISSING IS NOT INSTRUMENTATION. IT IS THE ABILITY TO NOTICE. [MEASURED 2026-09-15]
//     there is no Sentry, GlitchTip, Uptime Kuma, Umami or OpenTelemetry anywhere in `src/`, and
//     `/api/platform/health` had exactly ONE check in it — calendars. The queue that carries every
//     email, every webhook and every sweep had nothing looking at it, and `scripts/backup.sh` had
//     never run and could not have been noticed not running.
//
// ★★★ THE LIMIT OF AN IN-PROCESS WATCHER, SAID PLAINLY RATHER THAN LEFT TO BE DISCOVERED:
//     **THIS CANNOT TELL YOU THE PROCESS IS DEAD.** A monitor that lives inside the thing it
//     monitors reports nothing when that thing stops, and "no alert" then looks exactly like
//     "healthy" — which is worse than no monitor, because it is reassuring. Catching total death
//     needs something OUTSIDE: a Railway healthcheck, an external pinger, a cron elsewhere.
//     Recorded as a blocker in HANDOFF.md (D-18.5), not quietly implied by a green dashboard.
//   ★★ WHAT IT DOES CATCH IS MOST INCIDENTS: degradation while alive. A queue that stopped draining,
//      jobs dying at max attempts, an outbox backing up, a backup that silently stopped. Those are
//      invisible today and they are what actually goes wrong at 2am.
//
// ★★ EVERY CHECK RETURNS `ok | problem | unknown`, NEVER A BARE BOOLEAN, and `unknown` is load-
//    bearing: "there are no jobs at all" is not "the queue is healthy", and a dashboard that paints
//    an unconfigured system green is the same lie as a list that says "no records" when it was
//    refused. This is the shape `/api/platform/health` already uses for calendars.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { REAPER_STOP_REASONS } from "./platformEvents.mjs";
import { readOnDiskMigrations, computeMigrationDrift, certificateHealth, probeStorageReadWrite } from "./probes.mjs";
import { storageIsConfigured } from "../storage/s3.mjs";
import { platformCalendarHealth } from "../booking/calendarSync.mjs";

/** ★ Jobs waiting longer than this mean the queue is not draining, not that it is busy. */
export const QUEUE_BACKLOG_MINUTES = 15;
/** ★ How stale a verified backup may be before it is a problem. */
export const BACKUP_WARN_HOURS = 36;
/** ★ Outbox events unprocessed this long mean the dispatcher is not running. */
export const OUTBOX_BACKLOG_MINUTES = 15;
/** ★ 07 §5 — a heartbeat older than this means the worker may be down (mirrors GET /healthz/worker). */
export const WORKER_HEARTBEAT_STALE_SECONDS = 120;
/** ★ 07 §5 — a signing certificate expiring within this many days is a problem, not a surprise later. */
export const CERTIFICATE_WARN_DAYS = 30;
/** ★ 07 §5 — the weekly restore test is stale past this many days. */
export const RESTORE_TEST_WARN_DAYS = 8;
/** ★ 07 §5 — email send errors above this share of resolved sends, in the 15-minute window, are a problem. */
export const EMAIL_ERROR_RATE_THRESHOLD = 0.05;

const check = (key, label, state, detail, extra = {}) =>
  Object.freeze({ key, label, state, detail, ...extra });

/**
 * ★★★ THE QUEUE. Two questions, because they mean different things and one number would hide one:
 *     is due work WAITING too long (the worker is not draining), and has any job GIVEN UP without
 *     anybody acknowledging it.
 *   ★★ A GIVE-UP IS THE QUIETEST FAILURE IN THE SYSTEM — the work will never be done and nothing will
 *      error again. But a give-up somebody has already looked at and acknowledged (07 §4.8, §11) is not
 *      news, and counting it forever made the hourly alert true and useless (F486: 139 jobs for deleted
 *      test practices kept "Job queue needs attention" firing every hour).
 *   ★★★ SO: problem = any UNACKNOWLEDGED give-up (Ruling R59 — no last-hour window: an unhandled failure
 *       must not go quiet after 60 minutes), where "unacknowledged" is
 *         · a ledger row (keystone_meta.job_failure) with no acknowledgement, PLUS
 *         · a graphile job at max_attempts the ledger has NEVER HEARD OF — a real give-up nobody recorded
 *           is never hidden by the ledger's silence.
 *       The ledger is read through keystone_meta.job_failure_health() (0145) — app_worker holds zero table
 *       rights; it passes the graphile ids and gets two counts back, nothing else.
 *   ★ A job at max_attempts is not WAITING — it will never run — so it is excluded from the backlog age.
 *     Before F486 an acknowledged give-up with an old run_at would have kept the backlog red on its own.
 */
async function queueCheck(db) {
  const { rows: [q] } = await db.query(`
    SELECT count(*) FILTER (WHERE attempts < max_attempts AND run_at <= now())::int          AS waiting,
           count(*) FILTER (WHERE attempts >= max_attempts)::int                             AS dead,
           coalesce(max(extract(epoch FROM now() - run_at))
                      FILTER (WHERE attempts < max_attempts AND run_at <= now())::int, 0)    AS oldest_seconds
      FROM graphile_worker.jobs`);
  // ★★ F510 (0147) — a give-up is matched to the ledger by its WHOLE identity (id, task, graphile's own
  //    created_at), so an old acknowledged row can never cover a new job that reused its id. The three arrays
  //    are built IN SQL from one materialised set, in one order — created_at never passes through a JS Date,
  //    which would drop its microseconds and make every job look unrecorded.
  const { rows: [l] } = await db.query(`
    WITH d AS MATERIALIZED (
      SELECT id, task_identifier, created_at FROM graphile_worker.jobs WHERE attempts >= max_attempts)
    SELECT h.unacknowledged, h.unrecorded
      FROM keystone_meta.job_failure_health(
             ARRAY(SELECT id FROM d ORDER BY id),
             ARRAY(SELECT task_identifier FROM d ORDER BY id),
             ARRAY(SELECT created_at FROM d ORDER BY id)) h`);
  // ★★★ R61b (Stage 4 Task 1 fix round 2, 0149) — THE REAPER'S CIRCUIT BREAKER, MADE VISIBLE. When
  //     reap_orphan_jobs stops itself (the reads of keystone.tenant disagree), it records a job.reaper_stopped
  //     platform fact instead of throwing. This reads the newest one under 5 minutes old: the reaper runs every
  //     minute, so a cause that persists keeps this red, and a cause that clears lets it recover by itself.
  const { rows: [stop] } = await db.query(`SELECT reason, trips FROM keystone_meta.reaper_stop_health()`);
  const facts = {
    waiting: q.waiting, dead: q.dead, oldest_seconds: q.oldest_seconds,
    unacknowledged: l.unacknowledged + l.unrecorded,
    ...(stop ? { reaper_stopped: stop.reason } : {}),
  };

  const problems = [];
  if (facts.unacknowledged > 0) {
    problems.push(
      `${facts.unacknowledged} job(s) gave up and nobody has acknowledged them — that work will not ` +
      `happen unless someone looks` +
      (l.unrecorded > 0 ? ` (${l.unrecorded} of them stopped retrying with no reason recorded)` : ""));
  }
  if (stop) {
    problems.push(
      `the orphan-job reaper stopped itself ${stop.trips} time(s) in the last 5 minutes and removed nothing — ` +
      `${REAPER_STOP_REASONS[stop.reason] ?? `reason "${stop.reason}"`}, so the reads of keystone.tenant cannot ` +
      `be trusted; check its policies and the auth_owner grants`);
  }
  if (q.oldest_seconds > QUEUE_BACKLOG_MINUTES * 60) {
    problems.push(
      `the oldest due job has waited ${Math.round(q.oldest_seconds / 60)} minute(s) ` +
      `(threshold ${QUEUE_BACKLOG_MINUTES}) — the worker is not draining`);
  }
  if (problems.length) return check("queue", "Job queue", "problem", problems.join("; "), { ...facts, problems });
  if (q.waiting === 0) {
    return check("queue", "Job queue", "ok",
      "Nothing waiting, and every job that gave up has been acknowledged.", facts);
  }
  return check("queue", "Job queue", "ok", `${q.waiting} job(s) waiting, none stale.`, facts);
}

/**
 * ★★ THE OUTBOX IS A SEPARATE QUESTION FROM THE QUEUE, and conflating them would hide a real
 *    failure: `dispatch_outbox` can be running perfectly while events pile up because every
 *    handler is throwing. Events waiting is about CONSUMERS; jobs waiting is about the WORKER.
 * ★★★ F485 [MEASURED, production 2026-09-17]: this ran on `helpers.withPgClient`, i.e. as
 *     **app_worker**, which p21a_role_matrix holds to ZERO table privileges by design — so this
 *     query always failed with "permission denied for table event" and the check has never worked.
 *     It now reads `keystone_meta.outbox_health()` (0129), a SECURITY DEFINER function that returns
 *     exactly this aggregate and nothing else; app_worker gets EXECUTE on the function, never a
 *     grant on the table itself.
 */
async function outboxCheck(db) {
  const { rows: [o] } = await db.query(`SELECT * FROM keystone_meta.outbox_health()`);

  if (o.pending === 0) return check("outbox", "Event outbox", "ok", "Every event has been processed.", { ...o });
  if (o.oldest_seconds > OUTBOX_BACKLOG_MINUTES * 60) {
    return check("outbox", "Event outbox", "problem",
      `${o.pending} event(s) unprocessed, the oldest for ${Math.round(o.oldest_seconds / 60)} ` +
      `minute(s) — notifications, webhooks and task chains are all downstream of this.`, { ...o });
  }
  return check("outbox", "Event outbox", "ok", `${o.pending} event(s) in flight, none stale.`, { ...o });
}

/**
 * ★★★ THE BACKUP CHECK IS THE POINT OF THE WHOLE ITEM. `scripts/backup.sh` is a good script that has
 *     never run, and from inside the system that is indistinguishable from nightly backups. This
 *     reads `keystone_meta.backup_run` (0114), which the script writes AFTER its restore verifies.
 *   ★★ NO ROWS IS A **PROBLEM**, NOT `unknown`. Everywhere else in this file an empty table means
 *      "nothing to judge" — here it means **this database has never been backed up**, which is the
 *      single most consequential fact the dashboard can carry. It holds other practices' client
 *      records.
 *   ★ A LOCAL-ONLY BACKUP IS NOT GREEN EITHER. `destination IS NULL` means the dump is on the
 *     machine that made it; if that machine is what fails, there is no backup. Amber, with the
 *     reason in words.
 * ★★★ F485 [MEASURED, production 2026-09-17]: same failure as the outbox check, same cause — run as
 *     app_worker, which cannot read `keystone_meta.backup_run` directly. It now reads
 *     `keystone_meta.backup_health()` (0129), a SECURITY DEFINER function returning exactly these
 *     five fields for the latest verified row (or zero rows, unchanged). Thresholds, state strings
 *     and wording below are untouched — this is a permission fix, not a behaviour change.
 */
async function backupCheck(db) {
  const { rows } = await db.query(`SELECT * FROM keystone_meta.backup_health()`);

  if (rows.length === 0) {
    // Run 8 (J5): a self-hosted Docustay is backed up by its owner with the recipe in its own docs, not by scripts/backup.sh, and holds only that owner's records.
    if (process.env.KEYSTONE_SELF_HOST === "1") return check("backup", "Database backup", "problem",
      "No verified backup has been recorded for this install. Back up the database, the file store and the app data together, as docs/self-host-backup.md shows, and test a restore.");
    return check("backup", "Database backup", "problem",
      "NO VERIFIED BACKUP HAS EVER BEEN RECORDED for this database. scripts/backup.sh exists and " +
      "works — it dumps, dumps the roles separately, checksums, and proves the dump by restoring " +
      "it — and nothing has ever run it. This database holds other practices' client records.");
  }
  const b = rows[0];
  const hours = Math.round(b.age_seconds / 3600);
  if (hours > BACKUP_WARN_HOURS) {
    return check("backup", "Database backup", "problem",
      `The last verified backup was ${hours} hour(s) ago (threshold ${BACKUP_WARN_HOURS}). ` +
      `Backups have stopped and nothing else would have said so.`, { hours });
  }
  if (!b.destination || /^local:/.test(b.destination)) {
    return check("backup", "Database backup", "problem",
      `Verified ${hours} hour(s) ago, but it is LOCAL ONLY (${b.destination ?? "no destination"}). ` +
      `A backup on the machine that might fail is half a backup — see HANDOFF.md D-18.4.`, { hours });
  }
  return check("backup", "Database backup", "ok",
    `Verified ${hours} hour(s) ago, ${Math.round(Number(b.dump_bytes) / 1024)} KB, at ${b.destination}.`,
    { hours });
}

/**
 * ★ 07 §5 row 1 — DATABASE MIGRATIONS, worker-safe. Reuses `computeMigrationDrift` — the same pure
 * comparison `src/health/probes.mjs`'s `checkMigrations()` uses for `/readyz` — so the two can never
 * disagree about what "current" means; only the SOURCE of the applied-migrations rows differs (a
 * dedicated probe pool there, the caller's own connection through a SECURITY DEFINER function here).
 * ★★★ "CAN'T READ → unknown", NOT `problem` (07 §5's own table says so, and it differs from every
 *     other check in this file): a health check that cannot see its subject has not measured a
 *     problem, it has failed to measure anything — the F2 shape inverted. So this catches its OWN
 *     failure internally rather than letting the generic per-check catch in `systemChecks` turn it
 *     into a `problem`.
 */
async function migrationsCheck(db) {
  try {
    const onDisk = await readOnDiskMigrations();
    const { rows } = await db.query("SELECT id, checksum FROM keystone_meta.schema_migrations_health()");
    const result = computeMigrationDrift(onDisk, rows);
    if (result.drift) {
      return check("migrations", "Database migrations", "problem",
        `the database and the files on disk disagree: ${result.driftIds.join(", ")}`, result);
    }
    if (result.pending > 0) {
      return check("migrations", "Database migrations", "problem",
        `${result.pending} migration(s) on disk have not been applied: ${result.pendingIds.join(", ")}`, result);
    }
    return check("migrations", "Database migrations", "ok",
      `${result.applied} migration(s) applied, matching the files on disk.`, result);
  } catch (e) {
    return check("migrations", "Database migrations", "unknown", `could not read migrations: ${e.message}`);
  }
}

/**
 * ★ 07 §5 row "Worker heartbeat" — a DISPLAY row only. The ALERTING for a stale worker already
 * belongs to Stage 4 Task 3's dedicated path (`src/health/workerWatch.mjs`, migration 0146's
 * `worker_alert_transition`, hardcoded to alert key `'worker'`) — a separate 60-second timer in the
 * APP process, built specifically because "the watcher runs inside the worker" (this very file's own
 * header) cannot report the worker's own death.
 * ★★★ SO THIS CHECK'S KEY IS `worker_heartbeat`, DELIBERATELY NOT `worker` — `worker` is already one
 *     of `alerts.mjs`'s `IMMEDIATE_KEYS`, reserved for Task 3's own alert_state row. If this check
 *     used that same key, `notifyTransitions()` below would call the GENERIC `alert_transition('worker', …)`
 *     on the SAME row Task 3's dedicated timer writes to — two independent callers racing to alert on
 *     one breach, which is exactly the double-alert the brief for this task says not to build.
 *     `worker_heartbeat` is not in `IMMEDIATE_KEYS`, so `notifyTransitions` skips it entirely; the
 *     row still shows on Platform Health and still feeds the 7am summary.
 */
async function workerHeartbeatCheck(db) {
  const { rows: [w] } = await db.query("SELECT * FROM keystone_meta.worker_heartbeat_health()");
  if (!w.ever) {
    return check("worker_heartbeat", "Worker heartbeat", "problem", "the worker has never reported a heartbeat");
  }
  if (w.age_seconds > WORKER_HEARTBEAT_STALE_SECONDS) {
    return check("worker_heartbeat", "Worker heartbeat", "problem",
      `the last heartbeat was ${Math.round(w.age_seconds)}s ago (threshold ${WORKER_HEARTBEAT_STALE_SECONDS}) — the worker may be down`,
      { age_seconds: w.age_seconds });
  }
  return check("worker_heartbeat", "Worker heartbeat", "ok",
    `last heartbeat ${Math.round(w.age_seconds)}s ago.`, { age_seconds: w.age_seconds });
}

/** ★ 07 §5 row "Restore test" — the latest weekly restore-test row for this database (0152). */
async function restoreTestCheck(db) {
  const { rows } = await db.query("SELECT * FROM keystone_meta.restore_test_health()");
  if (rows.length === 0) {
    return check("restore", "Restore test", "problem",
      "no weekly restore test has ever been recorded for this database");
  }
  const r = rows[0];
  const days = r.age_seconds / 86_400;
  if (!r.verified) {
    return check("restore", "Restore test", "problem",
      `the last weekly restore test (${new Date(r.finished_at).toISOString()}) FAILED`, { days });
  }
  if (days > RESTORE_TEST_WARN_DAYS) {
    return check("restore", "Restore test", "problem",
      `the last verified weekly restore test was ${days.toFixed(1)} day(s) ago (threshold ${RESTORE_TEST_WARN_DAYS})`, { days });
  }
  return check("restore", "Restore test", "ok", `last verified ${days.toFixed(1)} day(s) ago.`, { days });
}

/**
 * ★ 07 §5 row "Storage (SeaweedFS)" — WRITE/READ, not the HEAD `/readyz` uses (`probeStorageReadWrite`'s
 * own header explains why: F491's real 5 GB ceiling can refuse a write while still answering HEAD).
 * ★ Unconfigured is `unknown` on a developer's own local machine (no object store ever exists there)
 *   and `problem` everywhere else — staging and production must always have one configured.
 */
async function storageCheck() {
  if (!storageIsConfigured()) {
    const local = process.env.KEYSTONE_ENVIRONMENT === "local";
    return check("storage", "File storage", local ? "unknown" : "problem",
      local
        ? "not configured — local development has no object store (staging and production must have one)"
        : "object storage is not configured");
  }
  try {
    const r = await probeStorageReadWrite();
    return check("storage", "File storage", r.ok ? "ok" : "problem", r.detail);
  } catch (e) {
    return check("storage", "File storage", "problem", `could not run: ${e.message}`);
  }
}

/**
 * ★ F491 — the fill level against the 5 GB Railway volume. INVESTIGATED, not guessed: SeaweedFS's
 * master and volume servers (the only components that know a fill level) bind to 127.0.0.1 INSIDE
 * the seaweedfs container by design (`infra/seaweedfs/start.sh`'s own header, Stage 2 final review
 * I1 — opening them would expose the filer's unauthenticated file read/delete to the whole private
 * network), and `src/storage/s3.mjs` is deliberately S3-API-only (its own header, enforced by
 * `db/gates/p18_storage.mjs`) — no `/dir/status`, no volume-server call, ever. Summing every object's
 * size via ListObjectsV2 would answer the bucket's total content size, not the volume's fill level
 * against its pre-allocated slots (F491's actual failure), and would need a LIST this project has
 * already decided against for a routine health check (`probeStorage`'s own header). So: `unknown`,
 * always, until one of those changes — never `ok`, because "unmeasurable" is not "fine".
 * ★ WHAT WOULD MAKE IT MEASURABLE: a small authenticated stats endpoint added to seaweedfs and
 *   forwarded out the way :8333 already is, or a scheduled job run from a trusted context (like the
 *   backup service, which already runs `weed`-adjacent tooling) that reads volume status locally and
 *   writes a row this check could then read — the same shape `backup_run` already uses.
 */
function storageCapacityCheck() {
  return check("storage_capacity", "File storage capacity", "unknown",
    "SeaweedFS's master/volume status (ports 9333/8080) is loopback-only inside the seaweedfs " +
    "container (Stage 2 review I1 — opening it would expose the filer's unauthenticated file " +
    "read/delete to the whole private network) and src/storage/s3.mjs is S3-API-only, so fill level " +
    "cannot be measured from keystone-app today (F491). It would become measurable with a small " +
    "authenticated stats endpoint on seaweedfs, or a scheduled job from a trusted context writing a " +
    "row this check could read.");
}

/** ★ 07 §5 row "Certificate (signing)" — expiry, not merely presence (that is `assertStartupInvariants`'s job). */
async function certificateCheck() {
  try {
    const { validTo, daysRemaining } = await certificateHealth();
    if (daysRemaining <= CERTIFICATE_WARN_DAYS) {
      return check("certificate", "Signing certificate", "problem",
        `expires ${validTo.toISOString()} (${daysRemaining.toFixed(1)} day(s) from now, threshold ${CERTIFICATE_WARN_DAYS})`,
        { daysRemaining });
    }
    return check("certificate", "Signing certificate", "ok",
      `valid until ${validTo.toISOString()} (${daysRemaining.toFixed(1)} day(s) from now).`, { daysRemaining });
  } catch (e) {
    return check("certificate", "Signing certificate", "problem", `could not read the signing certificate: ${e.message}`);
  }
}

/**
 * ★ 07 §5 row "Calendar sync" — moved here from the `/platform/health` ROUTE (which read
 * `calendarHealth()` inside the calling session's own tenant scope — one practice only) so it runs
 * across every practice, as the platform role. See `platformCalendarHealth`'s own header.
 */
async function calendarsCheck(db) {
  const r = await platformCalendarHealth(db);
  return check("calendars", "Calendar connections", r.state, r.detail, { total: r.total });
}

/** ★ 07 §5 row "Email (Resend)" — cross-tenant send-error rate (15 min) and quiet-vs-unknown (24 h). */
async function emailCheck(db) {
  const { rows: [e] } = await db.query("SELECT * FROM keystone_meta.email_health()");
  if (e.recent_total === 0) {
    if (e.day_total === 0) {
      return check("email", "Email (Resend)", "unknown", "no email sends in the last 24 hours");
    }
    return check("email", "Email (Resend)", "ok",
      "no email sends in the last 15 minutes; earlier sends in the last 24 hours were fine.");
  }
  const rate = e.recent_bad / e.recent_total;
  if (rate > EMAIL_ERROR_RATE_THRESHOLD) {
    return check("email", "Email (Resend)", "problem",
      `${e.recent_bad} of ${e.recent_total} email(s) failed or were skipped in the last 15 minutes ` +
      `(${Math.round(rate * 100)}%, threshold ${Math.round(EMAIL_ERROR_RATE_THRESHOLD * 100)}%)`,
      { recent_total: e.recent_total, recent_bad: e.recent_bad });
  }
  return check("email", "Email (Resend)", "ok",
    `${e.recent_total} email(s) sent in the last 15 minutes, ${e.recent_bad} failed or skipped.`,
    { recent_total: e.recent_total, recent_bad: e.recent_bad });
}

/** ★ 07 §5 row "n8n delivery" — Stage 9 builds the n8n integration; nothing exists to check yet. */
function n8nCheck() {
  return check("n8n", "n8n delivery", "unknown", "not connected yet — Stage 9");
}

/** ★ How long the nightly mirror reconciliation may go without running before that is itself a problem. */
const STRIPE_RECONCILE_WARN_HOURS = 36;

/**
 * ★★★ 07 §5 row "Stripe webhooks" — NOW REAL (specs/STRIPE-MIRROR.md stage (f)). Until 2 Oct 2026 this
 *     was a hard-coded `unknown — not connected yet — Stage 9`, which is why every Stripe webhook could
 *     401 for FOUR DAYS (28 Sep → 2 Oct) with nothing alarming. Reads the ONE health row the webhook
 *     route and the nightly reconciliation (src/money/mirrorReconcile.mjs) write:
 *       problem — the mirror update threw on a webhook since the last clean reconcile · the last
 *                 reconcile found DRIFT (a webhook was missed and the reconcile had to heal it) or
 *                 Stripe reports FAILED DELIVERIES in the last 24h · the reconcile could not run ·
 *                 no reconcile in 36h.
 *       unknown — the mirror has never run (a fresh database).
 *     `stripe_webhooks` is in alerts.mjs IMMEDIATE_KEYS, so a problem here emails alerts@ on its own.
 */
export async function stripeWebhooksCheck(db) {
  const { rows: [h] } = await db.query(`SELECT * FROM keystone_meta.stripe_mirror_health WHERE id`);
  if (!h || (!h.last_reconcile_at && !h.last_webhook_at)) {
    return check("stripe_webhooks", "Stripe webhooks", "unknown",
      "the Stripe mirror has not run yet — no webhook received and no nightly reconciliation recorded.");
  }
  const problems = [];
  if (h.webhook_failures_since > 0) {
    problems.push(`${h.webhook_failures_since} webhook(s) could not be applied to the mirror since the last clean reconciliation`);
  }
  if (h.last_reconcile_ok === false) {
    problems.push(h.last_error
      ? `the nightly reconciliation could not run: ${h.last_error}`
      : `the last reconciliation found ${h.drift_count} drifted object(s) (a webhook was missed) and ${h.failed_deliveries} failed Stripe delivery(ies)`);
  }
  const ageHours = h.last_reconcile_at ? (Date.now() - new Date(h.last_reconcile_at).getTime()) / 3600000 : Infinity;
  if (ageHours > STRIPE_RECONCILE_WARN_HOURS) {
    problems.push(h.last_reconcile_at
      ? `the nightly reconciliation last ran ${Math.round(ageHours)}h ago`
      : "the nightly reconciliation has never run");
  }
  const extra = { last_webhook_at: h.last_webhook_at, last_reconcile_at: h.last_reconcile_at,
                  drift_count: h.drift_count, failed_deliveries: h.failed_deliveries };
  if (problems.length) return check("stripe_webhooks", "Stripe webhooks", "problem", problems.join("; ") + ".", extra);
  return check("stripe_webhooks", "Stripe webhooks", "ok",
    `mirror in step with Stripe — last reconciliation ${Math.round(ageHours)}h ago, no drift, no failed deliveries.`, extra);
}

/**
 * Every system check, in one call.
 * ★★ A CHECK THAT THROWS BECOMES A `problem` NAMING ITS OWN FAILURE, never a missing row. A health
 *    dashboard that silently drops a check it could not run reports "everything shown is fine" —
 *    which is true, and is not the question anybody is asking.
 * ★ ORDER IS "WORST NEWS FIRST" (this file's own established rule): the three original checks, then
 *   the rest of 07 §5 roughly in the spec's own table order.
 */
export async function systemChecks(db) {
  const runners = [
    ["queue", queueCheck], ["outbox", outboxCheck], ["backup", backupCheck],
    ["migrations", migrationsCheck],
    ["restore", restoreTestCheck],
    ["worker_heartbeat", workerHeartbeatCheck],
    ["n8n", n8nCheck],
    ["stripe_webhooks", stripeWebhooksCheck],
    ["email", emailCheck],
    ["calendars", calendarsCheck],
    ["storage", storageCheck],
    ["storage_capacity", storageCapacityCheck],
    ["certificate", certificateCheck],
  ];
  const out = [];
  // ★★ F498 (RUN-2, 26 Sep 2026): inside a route's TRANSACTION one failing check (app_rw has no
  //    privilege on schema graphile_worker → the queue check throws) aborted the whole transaction, so
  //    every later check AND the route's next statement failed → /platform/health 500'd for the
  //    operator. Each check now runs under a SAVEPOINT and a failure rolls back to it, recorded as that
  //    check's problem. Outside a transaction (a pool) SAVEPOINT itself is refused and the checks run
  //    as before.
  for (const [key, fn] of runners) {
    let sp = false;
    try { await db.query("SAVEPOINT system_check"); sp = true; } catch { sp = false; }
    try {
      out.push(await fn(db));
      if (sp) await db.query("RELEASE SAVEPOINT system_check");
    } catch (e) {
      if (sp) await db.query("ROLLBACK TO SAVEPOINT system_check");
      out.push(check(key, key, "problem", `this check could not run: ${e.message}`));
    }
  }
  return out;
}

/** ★ The checks that are currently a problem — what a watcher shouts about. */
export const breaches = (checks) => checks.filter((c) => c.state === "problem");
