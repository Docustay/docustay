// Stage 4 Task 13 — spec 07 §6: "7 am summary (Pacific, fixed — there is no operator time zone) of
// everything else plus trials ending, near-limit practices, gave-up jobs."
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT "EVERYTHING ELSE" MEANS. `alerts.mjs`'s IMMEDIATE_KEYS (app, database, worker, outbox,
//     queue, backup, restore, stripe_webhooks, n8n) already reach the maintainer the minute they break, and
//     repeat hourly while they stay broken. This summary is the REST of `systemChecks()` — today:
//     worker_heartbeat, email, calendars, storage, storage_capacity, certificate — reported once a
//     day rather than not at all. A check in IMMEDIATE_KEYS is deliberately NEVER repeated here: two
//     independent schedules alerting on the same row is exactly the double-alert `watch.mjs`'s own
//     header (worker_heartbeat vs. `worker`) warns against.
//
// ★★★ TRIALS AND PLAN LIMITS ARE NOT TRACKED YET. [MEASURED 18 Sep 2026] `keystone.tenant` (0001)
//     has no trial or plan column, and no migration anywhere adds one — spec 02 §2's catalogue NAMES
//     `trial.started` / `trial.ending` / `trial.ended` / `plan.changed` / `seat.limit_reached` as
//     topics (02-event-catalogue.md:121) but nothing in `src/` or `db/migrations/` emits or stores
//     them. CLAUDE.md's failure #3 is exactly this shape done wrong — "a schema built from rules
//     instead of the model, because nothing forced a field to exist." So this file does not invent a
//     query against a column that is not there: it says "not tracked yet" and names what is missing,
//     which is the brief's own instruction. When trial/plan fields exist, TRIALS_NOT_TRACKED and
//     NEAR_LIMIT_NOT_TRACKED are the two lines to replace with real queries.
//
// ★★★ ONE SEND PER DAY, EVEN IF THE JOB RUNS TWICE. `keystone_meta.daily_summary_sent` (0154) is a
//     one-row-per-date claim, taken with `keystone_meta.claim_daily_summary(date)` INSIDE THE SAME
//     TRANSACTION as the send attempt — the same shape `alerts.mjs`'s per-check transaction uses: a
//     thrown send rolls the claim back with it, so a crash or a provider error leaves the date
//     unclaimed and the job's own retry (07 §4, periodic — the next sweep, not the 1m/5m/… schedule)
//     tries again. Two workers racing for the same date each try to INSERT the same primary key;
//     Postgres serialises that, so exactly one wins the claim and sends, and the other reads `false`
//     and returns without sending. This is stronger than the job's own `job_key` (which stops the
//     graphile ROW from duplicating) because it also survives a legacy/duplicate job created any
//     other way — the guarantee lives on the fact being claimed, not on which row asked for it.
//
// ★ NOT wrapped in `guardedTask` — like `watch_system` and `reap_orphan_jobs`, its subject (the whole
//   platform) belongs to no tenant, so the tenant guard has nothing to check.
import { platformAlertTo } from "../mail/index.mjs";
import { IMMEDIATE_KEYS } from "./alerts.mjs";
import { systemChecks } from "./watch.mjs";
import { sendViaResend } from "../email/resend.mjs";
import { sendingAddress } from "../email/send.mjs";
import { redirectForEnvironment } from "../email/redirect.mjs";
import { deliverOrThrow } from "../email/deliverOrThrow.mjs";
import { JOB_POLICY, JobFailure } from "../queue/jobPolicy.mjs";
import { ErrorKind } from "../http/errors.mjs";

export const SUMMARY_TIMEZONE = "America/Los_Angeles";
export const SUMMARY_HOUR = 7;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1 · THE CLOCK — next 07:00 Pacific, DST-safe.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ★ The UTC offset (in minutes, e.g. -420 for PDT, -480 for PST) in effect at `utcInstant` in
 *   `timeZone`. Read from `Intl`'s own tzdata rather than hand-maintained DST rules, so a change to
 *   the US's DST dates (as happened in 2007) needs a Node/ICU update, not a rewrite here.
 */
function offsetMinutesAt(utcInstant, timeZone) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(utcInstant).find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(part);
  // ★★★ Stage 4 Task 8 fix 1 item 5 — NO INSTANT IN THIS MESSAGE. It becomes a give-up REASON (jobPolicy's
  //     giveUpReason → keystone_meta.record_job_failure), and 0156 counts a repeat onto the open row only when the
  //     (task, practice, reason) match EXACTLY. With the instant in it, the same broken zone wrote a NEW ledger row
  //     every single morning: one problem, listed once per day on Platform Jobs, repeat_count stuck at 1 forever.
  //   ★ What the diagnosis actually needs is kept: WHICH zone, and WHAT the platform gave back for it. Both are drawn
  //     from a small fixed set, so repeats de-duplicate; the clock added nothing a log line does not already carry.
  if (!m) throw new Error(`could not read the UTC offset for ${timeZone} (got "${part}")`);
  const sign = m[1].startsWith("-") ? -1 : 1;
  return sign * (Math.abs(parseInt(m[1], 10)) * 60 + (m[2] ? parseInt(m[2], 10) : 0));
}

/** ★ The calendar date (y/m/d) `instant` falls on on the wall clock in `timeZone`. */
function datePartsIn(instant, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(instant).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/**
 * ★★★ THE NEXT 07:00 IN `timeZone` STRICTLY AFTER `now`. Two DST transitions a year move the UTC
 *     offset under this calculation; neither can put 07:00 in the skipped or repeated hour, because
 *     both US transitions land at 02:00 local — so "07:00 Pacific" is always exactly one instant, on
 *     every calendar day, and the only thing that changes is which offset produces it.
 *   ★ HOW: read today's Y-M-D in `timeZone`, then read the offset in effect at 20:00 UTC ON THAT DATE
 *     — always inside the same Pacific calendar day, and always after the 02:00 local transition
 *     moment, so it is the RIGHT offset for that day's 07:00 even on the two days a year the offset
 *     itself changes. Apply it to build the UTC instant for that date's 07:00. If that instant is not
 *     strictly after `now`, repeat for tomorrow's date (computed the same way, so a month/year
 *     rollover is Postgres/JS's own date arithmetic, not hand-rolled).
 */
export function nextDailySummaryRunAt(now = new Date(), timeZone = SUMMARY_TIMEZONE, hour = SUMMARY_HOUR) {
  const runAtFor = ({ y, m, d }) => {
    const offset = offsetMinutesAt(new Date(Date.UTC(y, m - 1, d, 20, 0, 0)), timeZone);
    return new Date(Date.UTC(y, m - 1, d, hour, 0, 0) - offset * 60_000);
  };
  const today = datePartsIn(now, timeZone);
  const candidate = runAtFor(today);
  if (candidate > now) return candidate;
  // ★ Tomorrow's Y-M-D, read back from a UTC instant 24h past today's midday guess — never
  //   "d + 1" fed straight to Date.UTC across a month boundary without re-reading the calendar.
  const tomorrow = datePartsIn(new Date(Date.UTC(today.y, today.m - 1, today.d + 1, 20, 0, 0)), timeZone);
  return runAtFor(tomorrow);
}

/** ★ The Pacific calendar date `instant` falls on, as 'YYYY-MM-DD' — the claim key and the job key. */
export function pacificDateKey(instant = new Date(), timeZone = SUMMARY_TIMEZONE) {
  const { y, m, d } = datePartsIn(instant, timeZone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2 · THE CONTENT.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ★★★ fix round 1 (review Important #2 / F526's sibling finding) — CHECKS THAT ARE `unknown` FOR A
//     KNOWN, STATIC, DOCUMENTED REASON — NOT A TRANSIENT ONE — ARE NOT "PROBLEMS" FOR THIS SUMMARY.
//   `storage_capacity` is PERMANENTLY `unknown` (F491, watch.mjs's own header: SeaweedFS's fill level
//   cannot be measured from keystone-app today, by design, until infra changes — there is no code
//   path that will ever set it to `ok`). Before this fix, `nonImmediateProblems` treated any non-`ok`
//   state as a problem, so `storage_capacity` alone guaranteed `notOk.length >= 1` EVERY SINGLE DAY —
//   the "All clear" line `buildSummaryText` builds could never appear in production while F491
//   stands, and nobody had noticed (review I2, 18 Sep 2026).
//   `n8n` and `stripe_webhooks` are also static "not connected yet — Stage 9" unknowns (watch.mjs);
//   they are already excluded from `nonImmediateProblems` because both are in `IMMEDIATE_KEYS` today,
//   but they are listed here too so this stays correct if that ever changes (Stage 9 connects them)
//   without anyone having to remember to update two places.
//   ★ WHAT THIS IS NOT: a check that is `unknown` for a TRANSIENT reason (`email` when quiet for 24h,
//     `calendars` when a tenant has zero connections) still counts as a problem below — those can and
//     do resolve to `ok`, so painting them as "not watched yet" would be the exact lie `watch.mjs`'s
//     own header warns against ("unknown is load-bearing").
export const NOT_WATCHED_YET_KEYS = Object.freeze(["storage_capacity", "n8n"]);

/** ★ 07 §5 checks that are NOT already covered by an immediate alert (alerts.mjs IMMEDIATE_KEYS),
 *   are NOT a known/static "not watched yet" unknown (NOT_WATCHED_YET_KEYS, above), and are not OK. */
export function nonImmediateProblems(checks) {
  return checks.filter((c) => !IMMEDIATE_KEYS.includes(c.key) && !NOT_WATCHED_YET_KEYS.includes(c.key) && c.state !== "ok");
}

/** ★ The checks reported separately as "not watched yet" — see NOT_WATCHED_YET_KEYS above. */
export function notWatchedYet(checks) {
  return checks.filter((c) => NOT_WATCHED_YET_KEYS.includes(c.key));
}

/**
 * ★ Unacknowledged gave-up jobs: total, plus up to 5 task identifiers by occurrence
 *   (`keystone_meta.job_failure_summary()`, 0154 — EXECUTE app_worker; the table itself grants
 *   nothing to any application role, same shape as `job_failure_health`).
 */
export async function giveUpSummary(query) {
  const { rows } = await query("SELECT total, task_identifier, occurrences FROM keystone_meta.job_failure_summary()");
  const total = rows[0]?.total ?? 0;
  const topReasons = rows
    .filter((r) => r.task_identifier != null)
    .map((r) => ({
      task: r.task_identifier,
      label: JOB_POLICY[r.task_identifier]?.label ?? r.task_identifier,
      occurrences: r.occurrences,
    }));
  return { total, topReasons };
}

export const TRIALS_NOT_TRACKED =
  "not tracked yet — keystone.tenant has no trial-end field (spec 02 §2 names trial.ending but " +
  "nothing stores or emits it yet; see this file's header).";
export const NEAR_LIMIT_NOT_TRACKED =
  "not tracked yet — there is no plan/usage-limit field on keystone.tenant (spec 02 §2 names " +
  "seat.limit_reached but nothing stores or emits it yet; see this file's header).";

/**
 * ★★★ THE PLAIN-TEXT BODY. Sections in the brief's own order: checks not ok, unacknowledged
 *     gave-up jobs, trials ending, near-limit practices — and a single "all clear" line replacing
 *     the first two when BOTH are empty (the positive control test/s4_daily_summary.test.mjs
 *     asserts this line appears, and that the problem section headers do not, on a clean day).
 * ★ Trials/near-limit are reported every day regardless — they are not "problems", they are the
 *   summary's other named subjects (07 §6), and "all clear" would be a false claim about data this
 *   deployment cannot see at all.
 * ★★ fix round 1 (review I2) — `notWatched` (NOT_WATCHED_YET_KEYS via `notWatchedYet()`) is reported
 *    in its OWN section, always, and never counts against "all clear" — a permanent, documented
 *    unknown (storage_capacity/F491) is not news every morning, but it is also not hidden.
 */
export function buildSummaryText({ now, notOk, notWatched = [], giveUps }) {
  const dateLine = new Intl.DateTimeFormat("en-US", {
    timeZone: SUMMARY_TIMEZONE, dateStyle: "full", timeStyle: "short",
  }).format(now);
  const lines = [`Workbench daily summary — ${dateLine} Pacific`, ""];

  const allClear = notOk.length === 0 && giveUps.total === 0;
  if (allClear) {
    lines.push("All clear — every non-immediate system check is OK and there are no unacknowledged job failures.");
  } else {
    lines.push("Checks not ok (excluding the checks that already emailed you immediately):");
    if (notOk.length === 0) {
      lines.push("  - none");
    } else {
      for (const c of notOk) lines.push(`  - ${c.label} (${c.state}): ${c.detail}`);
    }
    lines.push("");
    lines.push(`Unacknowledged gave-up jobs: ${giveUps.total}`);
    if (giveUps.total > 0) {
      for (const r of giveUps.topReasons) lines.push(`  - ${r.label}: ${r.occurrences}`);
    }
  }
  lines.push("");
  lines.push(`Trials ending in 7 days: ${TRIALS_NOT_TRACKED}`);
  lines.push("");
  lines.push(`Practices near a limit: ${NEAR_LIMIT_NOT_TRACKED}`);
  lines.push("");
  lines.push("Not watched yet (known, documented reason — not counted as a problem above):");
  if (notWatched.length === 0) {
    lines.push("  - none");
  } else {
    for (const c of notWatched) lines.push(`  - ${c.label}: ${c.detail}`);
  }
  lines.push("");
  lines.push("Platform → Health shows every check; Platform → Jobs shows every gave-up job.");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3 · SEND, ONCE, UNDER THE CLAIM.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ★★★ ONE TRANSACTION: claim the date, and only if the claim is won, gather content and send.
 *     Mirrors `alerts.mjs`'s `notifyTransitions` exactly: a thrown send rolls the claim back with
 *     it, so the next attempt (this job's own periodic retry, 07 §4 R65 — the next sweep, not the
 *     1m/5m/… schedule) sees the date as never sent and tries again.
 * @param {object} opts
 * @param {{query: (sql: string, args?: any[]) => Promise<{rows: any[]}>}} opts.db  a connection
 *   inside BEGIN/COMMIT — the same shape `systemChecks(db)` (watch.mjs) already takes.
 * @param {object}   [opts.env]   defaults to process.env
 * @param {Function} [opts.send]  defaults to sendViaResend
 * @param {Date}     [opts.now]   defaults to new Date()
 * @returns {Promise<{sent: boolean, reason?: string, to?: string}>}
 */
export async function sendDailySummary({ db, env = process.env, send, now = new Date() } = {}) {
  const deliver = send ?? ((m) => sendViaResend(m, { env }));
  const query = (sql, args) => db.query(sql, args);
  const dateKey = pacificDateKey(now, SUMMARY_TIMEZONE);

  await query("BEGIN");
  try {
    const { rows } = await query("SELECT keystone_meta.claim_daily_summary($1) AS claimed", [dateKey]);
    if (rows[0]?.claimed !== true) {
      await query("COMMIT");
      return { sent: false, reason: "already sent for this date" };
    }

    const to = platformAlertTo(env);
    const canEmail = Boolean(to && to.includes("@"));
    // ★★★ fix round 1 (review Important #1) — "the retry tries again once it is set" IS NOW TRUE.
    //     A plain `Error` here used to be UNCLASSIFIED: `classifyFailure` (jobPolicy.mjs) has no
    //     branch for a bare Error and defaults it to `internal`/not-retryable, so `decide()` gave up
    //     on the FIRST attempt — the code's own comment, the report and 07's History all claimed a
    //     retry that never happened. `JobFailure(ErrorKind.DEPENDENCY, ..., {retryable:true})` is a
    //     kind `decide()` DOES retry, on `daily_summary`'s periodic schedule (jobPolicy.mjs's
    //     PERIODIC_RETRY_SECONDS — 60s between each of the first 5 waits, R65): up to
    //     JOB_MAX_ATTEMPTS (6) tries, about 5 minutes in total, before giving up with the usual
    //     Platform → Jobs ledger row. Bounded, not silent, and not a give-up every sweep tick: once
    //     this job's OWN row exhausts its attempts it gives up exactly once — the next day's summary
    //     is a brand-new job row under tomorrow's date key (sweepTenants, tasks.mjs), never this one
    //     re-added. The claim (a platform fact — a summary WAS due today) is rolled back below by the
    //     throw either way, so any retry (this job's own, or a later manual one) sees the date as
    //     never sent.
    if (!canEmail) {
      throw new JobFailure(ErrorKind.DEPENDENCY,
        "KEYSTONE_ALERT_EMAIL is not set — the 7 am summary has nothing to send to (the claim for " +
        `${dateKey} is rolled back; retried on the periodic ~60s schedule for up to 6 attempts before ` +
        "giving up and recording it in Platform → Jobs).",
        { retryable: true });
    }

    const checks = await systemChecks(db);
    const notOk = nonImmediateProblems(checks);
    const notWatched = notWatchedYet(checks);
    const giveUps = await giveUpSummary(query);
    const text = buildSummaryText({ now, notOk, notWatched, giveUps });
    const routed = redirectForEnvironment({ to, subject: "Workbench daily summary" }, env);

    // ★★ fix round 1 (F526 / review C1) — `deliverOrThrow` also throws on a RESOLVED `{ok:false}`
    //    (a real Resend 500/429/timeout — sendViaResend never throws for these on its own), which
    //    before this fix reached `COMMIT` as if it had succeeded: the claim was taken, `sent: true`
    //    was returned, and nothing recorded that the email never actually left.
    await deliverOrThrow(deliver, { to: routed.to, from: sendingAddress(env), subject: routed.subject, text });
    await query("COMMIT");
    return { sent: true, to: routed.to };
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}
