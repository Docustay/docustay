// P18.6(b) — ★★★ graphile-worker, USED AS A QUEUE. NOT A POLL LOOP WITH A DEPENDENCY INSTALLED.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ §D5's WARNING, VERBATIM: *"'install Graphile Worker, then loop on `claimEvents()`' is incoherent.
//     It would install graphile-worker's schema and use **none** of its ten features — including the
//     exact two that fix F4 (lock expiry) and the backoff gap."*
//
// ★★ WHAT IS ACTUALLY USED HERE, NAMED, so the claim is checkable rather than asserted:
//     1 · its TABLES        — `graphile_worker.jobs`, migrated by the library itself
//     2 · `add_job`         — via `WorkerUtils.addJob`, never a hand-written INSERT
//     3 · `job_key` + `replace` — so one tenant cannot accumulate identical sweeps (`tasks.mjs`)
//     4 · RETRIES + backoff — graphile's own `attempts`/`max_attempts`/`run_at`, set by the job policy
//                             (Stage 4 Task 6, src/queue/jobPolicy.mjs): 6 attempts on the 07 schedule
//     5 · ★★★ NOT ITS LOCK EXPIRY — **BECAUSE IT DOES NOT HAVE ONE.** See the correction below.
//     6 · LISTEN/NOTIFY     — `run()` wakes on a notification rather than polling a clock
//     7 · `runOnce()`       — a deterministic single pass, which is what makes the gate a test and
//                             not a race
//     8 · its own LOGGER    — routed through `helpers.logger`, so job output is attributable
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A CORRECTION TO §D5, MEASURED — AND IT REVERSES THAT SECTION'S CONCLUSION ABOUT F4.
//
// §D5 says: *"graphile-worker expires a lock after **4 hours** by default"* and argues that installing
// graphile gives you *"the exact two features that fix F4 (4-hour lock expiry) and the backoff gap."*
//
// ★★★ [MEASURED 2026-09-13, graphile-worker 0.18.0, from information_schema] the availability of a job
//     is a GENERATED COLUMN:
//         is_available = ((locked_at IS NULL) AND (attempts < max_attempts))
//     **THERE IS NO TIME TERM.** A job locked by a worker that then died is `is_available = false`
//     FOREVER. The only recovery route in the schema is `graphile_worker.force_unlock_workers(text[])`,
//     which somebody has to CALL — and [MEASURED] there is no worker-heartbeat table, so nothing in the
//     database can tell a dead worker from a slow one on its own.
//
// ★★ SO THE PREMISE WAS WRONG IN THE DIRECTION THAT MATTERS: graphile has **the same defect F4 describes
//    in our own `claim_events`.** Installing it does not fix a stranded claim; it moves the stranding one
//    table across. ★ Migration 0040's lease — a time predicate in the claim itself — is therefore MORE
//    robust than the library that was supposed to supersede it.
//  ★★★ AND IT WAS CAUGHT ONLY BECAUSE THE GATE ASSERTED THE BEHAVIOUR RATHER THAN THE INSTALL. I had
//      already written "its lock expiry" into this header on the strength of §D5's sentence, before
//      measuring. That is the mistake this project keeps recording, made by me, one line up.
//
// ★ THE FIX IS `reclaimAbandonedJobs()` BELOW: we supply the lease graphile does not. It is the same
//   shape as 0040 — a time threshold, applied deliberately — and it is asserted by db/gates/p18_worker.mjs.
//
//   ★ NOT used: graphile's static crontab. §D5 ruling 3 and P18.6(d) both forbid it for per-account
//     work, because a crontab is read at construction and cannot express a job set that changes when
//     an account is added. The sweep is ONE job that enqueues the rest.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE ROLE PROBLEM, MEASURED AND STATED RATHER THAN PAPERED OVER.
//     A running worker needs THREE different privilege sets on ONE connection:
//       (a) DDL+DML on `graphile_worker` — to migrate and to claim jobs;
//       (b) EXECUTE on `keystone_auth.list_active_tenant_ids()` — granted to `app_worker` ONLY (0044);
//       (c) `app_rw`'s DML on `keystone.*` — to do the tenant work inside `withTenant`.
//   ★★ NO EXISTING ROLE HOLDS ALL THREE, AND THAT IS NOT AN OVERSIGHT — it is the grant model working.
//      `app_rw` is deliberately NOT granted (b), because the point of 0044 is that the application
//      cannot enumerate tenants.
//   ★★★ SO THE PRODUCTION WIRING IS A DEPLOY-TIME DECISION AND IT IS **NOT DELIVERED HERE**:
//        `app_worker` needs LOGIN, a password, `GRANT app_rw TO app_worker`, and graphile_worker DDL —
//        then `KEYSTONE_WORKER_DATABASE_URL` points at it. That is a Railway variable plus a role
//        bootstrap, and the deploy is blocked (see HANDOFF.md). ★ Recorded, with the exact grants, so
//        nobody has to re-derive them.
//   ★ Until then the runner takes its connection string as an argument. The gate passes the privileged
//     one, which is honest: it proves the QUEUE works, and does not claim the role model is wired.

import { run, runOnce, makeWorkerUtils, Logger } from "graphile-worker";
import { TASK_LIST, requestDispatchStop, resumeDispatch } from "./tasks.mjs";
import { addJobWithPolicy, isReservedTask, isFastTask } from "./jobPolicy.mjs";
import { wrapWithRunLedger } from "./runLedger.mjs";

/** ★ The one place the worker's connection string is resolved, so there is one answer to "as whom". */
export function workerConnectionString(env = process.env) {
  // ★★★ CORRECTED 2026-09-14 BY P21A.3. THE PREVIOUS COMMENT HERE WAS STALE AND SAID THE OPPOSITE OF
  //     THE TRUTH: *"today the worker genuinely does connect as app_rw, which means the tenant lister
  //     is unreachable to it and sweep_tenants will fail LOUDLY."* MEASURED against the DEPLOYED
  //     database's own `pg_stat_activity`: the worker holds three live connections as **app_worker**,
  //     the lister IS reachable, and sweeps run every 60 seconds (P20.12 timed one at 25s).
  //
  // ★★★ WHAT IS ACTUALLY TRUE — **THE WORKER PROCESS HOLDS TWO DATABASE IDENTITIES**, and neither can
  //     do the job alone. MEASURED, both directions:
  //       · `app_worker` (this string)      — USAGE on keystone/keystone_auth/graphile_worker and
  //                                           EXECUTE on list_active_tenant_ids. **ZERO table rights.**
  //       · `app_rw` (KEYSTONE_DATABASE_URL) — every table right, but **no** tenant lister and **no**
  //                                           access to the queue schema.
  //     graphile-worker runs on the first; every domain write goes through `withTenant`, which builds
  //     its pool from KEYSTONE_DATABASE_URL, on the second. One process, two identities, split by
  //     concern — which is least privilege done properly.
  //
  // ★★ SO THE FALLBACK BELOW IS A DEGRADED MODE, NOT AN EQUIVALENT. Falling back to
  //    KEYSTONE_DATABASE_URL gives a worker that can write rows but **cannot enumerate tenants**, so
  //    `sweep_tenants` fails LOUDLY with a permission error. That loud failure is correct and is why
  //    there is no `if` here softening it: a worker that quietly enumerated nothing would report
  //    healthy and move nothing — §D5's exact warning.
  //  ★★★ AND DO NOT "FIX" THAT ERROR BY GRANTING app_worker TABLE RIGHTS. That is the obvious move at
  //      2am and it would collapse the two identities into one, silently. `db/gates/p21a_role_matrix.mjs`
  //      asserts the split in BOTH directions and will go red if either half erodes.
  const url = env.KEYSTONE_WORKER_DATABASE_URL ?? env.KEYSTONE_DATABASE_URL;
  if (!url) {
    throw new Error(
      "no database url for the worker: set KEYSTONE_WORKER_DATABASE_URL (preferred — it should point " +
      "at the app_worker role, which alone may call keystone_auth.list_active_tenant_ids()) or " +
      "KEYSTONE_DATABASE_URL.");
  }
  return url;
}

/**
 * ★ Install/upgrade graphile's own schema. The library owns it; we never write its DDL.
 * ★★ Separated from `startWorker` so the gate can install once and then run deterministic passes —
 *    and so a deploy can migrate the queue without starting to consume.
 */
export async function migrateQueue({ connectionString } = {}) {
  const utils = await makeWorkerUtils({ connectionString: connectionString ?? workerConnectionString() });
  try {
    await utils.migrate();
    return true;
  } finally {
    await utils.release();
  }
}

/**
 * ★★ ENQUEUE. Through `WorkerUtils.addJob` — never a hand-written INSERT into `graphile_worker.jobs`,
 *    because the row shape is the library's and it changes between versions.
 * ★ `assertNoDestination` runs on the HANDLER side (`guardedTask`) rather than here, deliberately: a
 *   check on the enqueue path can be bypassed by calling `add_job` in SQL, and §D5 points out that
 *   anything holding app_rw can. The handler is the only place that cannot be gone around.
 */
// ★★★ Stage 4 Task 6 — THROUGH THE JOB POLICY (src/queue/jobPolicy.mjs): the policy sets maxAttempts, refuses a
//     task it has no row for, and keeps a periodic job's retry schedule. db/gates/s4_job_policy.mjs fails on any
//     other way of adding a job in src.
/** The web process holds only the app_rw identity, which has no access to the queue schema. Asked to enqueue from there, the database answers "permission denied for schema graphile_worker" — and callers used to swallow it. This turns that answer (and a missing queue url) into ONE loud, plain error that names the cause and the fix. Pure, so it is tested. */
export class QueueUnreachableError extends Error {
  constructor(task, cause) { super(`The job "${task}" could not be queued: this process cannot reach the job queue (${cause}). Set KEYSTONE_WORKER_DATABASE_URL for this service, or make the work in the process that can (the worker), as the sealed copy and AI drafts now do.`); this.name = "QueueUnreachableError"; this.task = task; }
}
export function explainQueueError(task, e) {
  const msg = String(e?.message ?? e);
  if (e?.code === "42501" || /permission denied for (schema|function|table) .*graphile_worker|permission denied for schema graphile_worker/i.test(msg)) return new QueueUnreachableError(task, "permission denied for the queue schema");
  if (/no database url for the worker/i.test(msg)) return new QueueUnreachableError(task, "no queue database url is set");
  return e;
}
export async function enqueue(name, payload, opts = {}, { connectionString } = {}) {
  let utils;
  try {
    utils = await makeWorkerUtils({ connectionString: connectionString ?? workerConnectionString() });
    return await addJobWithPolicy(utils, name, payload, opts);
  } catch (e) {
    const x = explainQueueError(name, e);
    if (x !== e) console.error(`★ QUEUE UNREACHABLE: ${x.message}`);
    throw x;
  } finally {
    if (utils) await utils.release();
  }
}

/** One long-lived adder for a process that queues many jobs (the outbox wake-up, src/queue/outboxWake.mjs): same policy path as `enqueue`, one connection kept instead of one per call. */
export async function openEnqueuer({ connectionString } = {}) {
  const utils = await makeWorkerUtils({ connectionString: connectionString ?? workerConnectionString() });
  return { add: (name, payload, opts = {}) => addJobWithPolicy(utils, name, payload, opts), release: () => utils.release() };
}

/**
 * ★★★ ONE DETERMINISTIC PASS. Used by the gate, and by any operator who wants to drain the queue once
 *     without leaving a process behind.
 */
export async function drainOnce({ connectionString, concurrency = 1 } = {}) {
  return runOnce({
    connectionString: connectionString ?? workerConnectionString(),
    taskList: wrapWithRunLedger({ ...TASK_LIST }),
    concurrency,
    noHandleSignals: true,      // ★ the caller owns process lifetime; a test must not have SIGINT stolen
  });
}

/**
 * ★★★ THE LEASE graphile DOES NOT HAVE. Unlocks jobs — AND QUEUES — held by workers that are almost certainly gone.
 *
 * ★★★ STAGE 4 TASK 9 — IT IS NOT ONLY THE JOB THAT IS LOCKED. Named queues (`t:<tenantId>`, set by
 *     src/queue/jobPolicy.mjs) mean a claim locks TWO rows: the job, and its `_private_job_queues` row
 *     [MEASURED, graphile-worker 0.18.0, dist/sql/getJobs.js: `update … _private_job_queues … set locked_by = $1,
 *     locked_at = now() … where job_queues.id = j.job_queue_id`]. And the queue row has the same defect the job row
 *     has, in the same generated column: [MEASURED, information_schema]
 *         _private_job_queues.is_available = (locked_at IS NULL)     — **no time term**
 *     So a worker that dies mid-job strands its practice's WHOLE QUEUE, not one job: every later job of that
 *     practice is unclaimable, forever, while every other practice carries on. A per-practice queue turns one
 *     stranded job into one stranded PRACTICE, which is why this function had to grow.
 *
 * ★★ TWO SOURCES OF EVIDENCE, AND THE SECOND ONE IS NOT OPTIONAL:
 *      (a) workers holding a stale JOB lock — what this function has always looked at;
 *      (b) workers holding a stale QUEUE lock **with no job of theirs left to find them by**.
 *    (b) is a real state, not a theoretical one: `graphile_worker.complete_jobs(bigint[])` — which the reaper calls
 *    to remove a departed practice's jobs — DELETES the job row and does **not** touch `_private_job_queues`
 *    (node_modules/graphile-worker/sql/000016.sql; contrast the worker's own `dist/sql/completeJobs.js`, which does
 *    clear the queue). Remove the dead worker's last job and a scan of (a) alone can never see it again.
 *    ★ `force_unlock_workers` itself handles both tables — the gap was never in graphile's function, it was in
 *      WHICH WORKERS we handed it.
 *
 * ★★ WHY A TIME THRESHOLD AND NOT SOMETHING CLEVERER: there is no heartbeat table, so "is that worker
 *    alive?" is not a question the database can answer. Elapsed lock time is the only evidence available,
 *    which is exactly the evidence migration 0040 uses for the outbox — one mechanism, two tables.
 *  ★ THE THRESHOLD MUST EXCEED THE LONGEST LEGITIMATE JOB. Too low and a slow job is unlocked while it is
 *    still running, and the same work happens twice; too high and recovery takes hours. 30 minutes is
 *    well above anything in this system (the email provider timeout is 15 SECONDS) and well below a
 *    working day. ★★ It is a PARAMETER so a future long-running job class can raise it rather than the
 *    whole queue being tuned for the slowest thing in it.
 *
 * @returns {Promise<{unlockedWorkers: string[], jobs: number, queues: number, queueOnlyWorkers: string[]}>}
 */
export async function reclaimAbandonedJobs(
  { connectionString, olderThanMinutes = 30 } = {}
) {
  const utils = await makeWorkerUtils({ connectionString: connectionString ?? workerConnectionString() });
  try {
    // ★ The distinct workers holding stale locks, on EITHER table. `locked_by` is graphile's own worker id and it
    //   is the same id in both, which is what makes one union the whole answer.
    const { rows } = await utils.withPgClient((pg) => pg.query(
      `SELECT locked_by, sum(jobs)::int AS jobs, sum(queues)::int AS queues
         FROM (
           SELECT j.locked_by, count(*)::int AS jobs, 0 AS queues
             FROM graphile_worker._private_jobs j
            WHERE j.locked_by IS NOT NULL
              AND j.locked_at < now() - make_interval(mins => $1::int)
            GROUP BY j.locked_by
           UNION ALL
           SELECT q.locked_by, 0 AS jobs, count(*)::int AS queues
             FROM graphile_worker._private_job_queues q
            WHERE q.locked_by IS NOT NULL
              AND q.locked_at < now() - make_interval(mins => $1::int)
            GROUP BY q.locked_by
         ) held
        GROUP BY locked_by`, [olderThanMinutes]));
    const workers = rows.map((r) => r.locked_by);
    const jobs = rows.reduce((n, r) => n + r.jobs, 0);
    const queues = rows.reduce((n, r) => n + r.queues, 0);
    // ★ Named separately because it is the interesting case: a worker whose QUEUE lock outlived every job it held.
    //   Nothing but this branch can ever find it, and the practice it belongs to is completely stopped until it does.
    const queueOnlyWorkers = rows.filter((r) => r.jobs === 0 && r.queues > 0).map((r) => r.locked_by);
    if (workers.length === 0) return { unlockedWorkers: [], jobs: 0, queues: 0, queueOnlyWorkers: [] };

    // ★★ THROUGH graphile's OWN FUNCTION, not a hand-written UPDATE. `force_unlock_workers` is the
    //    library's supported route and it knows what else has to be cleared alongside `locked_at`;
    //    setting the column ourselves would be guessing at its invariants.
    //  ★ [MEASURED, node_modules/graphile-worker/sql/000016.sql] it is TWO statements — one over `_private_jobs`
    //    and one over `_private_job_queues`, both `where locked_by = any(worker_ids)` — so handing it a worker
    //    clears that worker's queue locks as well as its job locks. The job of the query above is only to NAME
    //    every such worker.
    await utils.withPgClient((pg) =>
      pg.query(`SELECT graphile_worker.force_unlock_workers($1::text[])`, [workers]));
    return { unlockedWorkers: workers, jobs, queues, queueOnlyWorkers };
  } finally {
    await utils.release();
  }
}

// ★ The heartbeat's one raw database call lives in ./heartbeat.mjs (Stage 2 final review M2), so the
//   tenant-predicate lint's exemption names that small file, not this whole module. Re-exported here so
//   existing callers are unchanged.
// ★★★ F503 — the IMPORT is load-bearing, the re-export alone is not. `export { beat } from …` creates NO
//     local binding, so startWorker()'s beatNow() threw `ReferenceError: beat is not defined` and production's
//     worker crash-looped from 2026-09-18 03:05 UTC until Stage 3. test/s3_worker_process_starts starts the
//     real process to catch exactly this. (The heartbeat.mjs ↔ runner.mjs cycle is safe: each side only
//     CALLS the other's function at run time, never at module evaluation.)
import { beat } from "./heartbeat.mjs";
export { beat };

/**
 * ★★★ THE LONG-RUNNING WORKER. `run()` uses LISTEN/NOTIFY, so a job enqueued by a request is picked up
 *     immediately rather than at the next tick of a poll — which is the difference between a queue and
 *     a cron job pretending to be one.
 *
 * ★★ THE SWEEP IS ENQUEUED AS A JOB, NOT SCHEDULED AS A CRONTAB ENTRY. §D5 ruling 3 / P18.6(d):
 *    graphile's cron is STATIC, read at construction, and cannot express a set that changes when an
 *    account is added. So: one `sweep_tenants` job, and each run enqueues the next occurrence.
 *  ★ `sweepEveryMs` is the interval between sweeps; the self-rescheduling is done by the CALLER of
 *    `startWorker` rather than inside the task, so a deployment can choose to run one sweep and stop.
 */
// ★★★ STAGE 4 TASK 9 — CONCURRENCY 5, NOT 2 (07 §4 rule 2). The two numbers are one decision: a practice's jobs now
//     run one at a time (its named queue, src/queue/jobPolicy.mjs), so the old figure of 2 would mean at most TWO
//     practices making progress at once — fairness bought by making everything slower. Five slots, at most one per
//     practice, leaves room for the platform-wide jobs (the sweep, the watcher, the reaper, the summary), which
//     carry no queue name and so are never held behind a busy practice.
export async function startWorker({ connectionString, concurrency = 5, sweepEveryMs = 60_000 } = {}) {
  const cs = connectionString ?? workerConnectionString();
  // ★ Stage 3 T5 fix 1: a previous stop() in this process set the dispatch stop flag; clear it, or this
  //   runner's dispatches would claim nothing.
  resumeDispatch();
  // ★★★ D559 — RESERVED CAPACITY. Sweeps (reminders, expiry, held signatures, scheduled sends…) and the platform-wide jobs
  //     run on their OWN runner with their OWN slots, and the main runner is not given their tasks at all, so a full house
  //     of deliveries and documents can never leave a sweep without a worker. (graphile only claims jobs whose task is in the
  //     runner's task list.) `KEYSTONE_WORKER_RESERVED_SLOTS` sets the number (default 2, at least 1).
  const fullList = wrapWithRunLedger({ ...TASK_LIST });
  const reservedList = Object.fromEntries(Object.entries(fullList).filter(([name]) => isReservedTask(name)));
  const fastList = Object.fromEntries(Object.entries(fullList).filter(([name]) => isFastTask(name) && !isReservedTask(name)));
  const mainList = Object.fromEntries(Object.entries(fullList).filter(([name]) => !isReservedTask(name) && !isFastTask(name)));
  const fastSlots = Math.max(1, Number.parseInt(process.env.KEYSTONE_WORKER_FAST_SLOTS ?? "4", 10) || 4);
  const reservedSlots = Math.max(1, Number.parseInt(process.env.KEYSTONE_WORKER_RESERVED_SLOTS ?? "2", 10) || 2);
  const runnerOptions = {
    connectionString: cs,
    pollInterval: 15_000,
    noHandleSignals: true,
    logger: new Logger((scope) => (level, message, meta) => {
      if (process.env.KEYSTONE_WORKER_LOG !== "verbose" && (level === "debug" || (level === "info" && /^(Started|Completed) task /.test(String(message))))) return;   // D565: graphile also logs "Found task N" at debug level for every job, which on a busy install filled the log in minutes
      const line = `[${scope.label ?? "worker"}] ${level.toUpperCase()}: ${message}`; (level === "error" ? console.error : level === "warning" ? console.warn : console.log)(line, ...(meta && Object.keys(meta).length && level !== "info" ? [JSON.stringify(meta)] : []));
    }),
  };
  const sweepRunner = await run({ ...runnerOptions, taskList: reservedList, concurrency: reservedSlots });
  const fastRunner = await run({ ...runnerOptions, taskList: fastList, concurrency: fastSlots });
  const runner = await run({
    connectionString: cs,
    taskList: mainList,
    concurrency,
    // ★ 15s, matching the outbox lease's order of magnitude. A poll interval far longer than the lease
    //   means a reclaimed event waits for the poll rather than for the lease, and the two numbers
    //   disagreeing is how "it retried eventually" becomes "it retried in twenty minutes".
    pollInterval: 15_000,
    // ★ Graphile installed its OWN SIGTERM handler ("global graceful shutdown") that raced src/worker.mjs's: worker.mjs closed the database pool while a long job (reencrypt_document_files,
    //   seconds long) was still running, so the job died with "Cannot use a pool after calling end on the pool" and the process exited 1 instead of 0 (Run 10 SU-001, s3_worker_process_starts).
    //   worker.mjs is the one place that handles the signal: it calls stop(), which waits for in-flight jobs, and only then closes the pools.
    noHandleSignals: true,
    // Quiet by default (G1, 15 Oct 2026): graphile logs "Started task" and "Completed task" at info for EVERY run, and dispatch_outbox runs for every workspace every few seconds, so an idle local worker wrote 3.4 GB of log. Warnings and errors still reach the log; set KEYSTONE_WORKER_LOG=verbose to see everything again.
    logger: new Logger((scope) => (level, message, meta) => {
      if (process.env.KEYSTONE_WORKER_LOG !== "verbose" && (level === "debug" || (level === "info" && /^(Started|Completed) task /.test(String(message))))) return;   // D565: graphile also logs "Found task N" at debug level for every job, which on a busy install filled the log in minutes
      const line = `[${scope.label ?? "worker"}] ${level.toUpperCase()}: ${message}`; (level === "error" ? console.error : level === "warning" ? console.warn : console.log)(line, ...(meta && Object.keys(meta).length && level !== "info" ? [JSON.stringify(meta)] : []));
    }),
  });

  // ★★ THE SWEEP LOOP. Deliberately a timer in OUR process rather than graphile's crontab, for the
  //    reason above — and it is `unref`'d so it cannot hold the process open on shutdown.
  const timer = setInterval(() => {
    // ★★ THE RECLAIM RUNS FIRST, and the order is deliberate: unlocking an abandoned job before
    //    enqueueing new work means the backlog drains oldest-first rather than the stranded job waiting
    //    behind everything that arrived after it.
    reclaimAbandonedJobs({ connectionString: cs })
      .then((r) => {
        if (r.jobs > 0 || r.queues > 0) {
          console.warn(
            `[worker] reclaimed ${r.jobs} abandoned job(s) and ${r.queues} stranded practice queue(s) from ` +
            `${r.unlockedWorkers.length} dead worker(s): ${r.unlockedWorkers.join(", ")}. ★ graphile has no lock ` +
            `expiry of its own, on EITHER table — see src/queue/runner.mjs. This is NOT routine; it means a worker ` +
            `died mid-job.` +
            (r.queueOnlyWorkers.length
              ? ` ★★ ${r.queueOnlyWorkers.length} of them held a QUEUE lock with no job left to find it by ` +
                `(${r.queueOnlyWorkers.join(", ")}) — that practice had been completely stopped until now.`
              : ""));
        }
      })
      .catch((err) => console.error(`[worker] could not reclaim abandoned jobs: ${err.message}`));
    enqueue("sweep_tenants", {}, { jobKey: "sweep_tenants", jobKeyMode: "replace" }, { connectionString: cs })
      .catch((err) => console.error(`[worker] could not enqueue sweep: ${err.message}`));
  }, sweepEveryMs);
  timer.unref?.();

  // ★ Run 9 Part 4R: once per library version, bring the built-in templates' masters up to date (a self-host install prints them all; seed_template_library in tasks.mjs).
  import("../documents/frontDoor.mjs").then(({ LIBRARY_VERSION }) => enqueue("seed_template_library", {}, { jobKey: `seed_template_library:${LIBRARY_VERSION}`, jobKeyMode: "preserve_run_at" }, { connectionString: cs }))
    .catch((err) => console.error(`[worker] could not queue the template library seed: ${err.message}`));

  // ★ Run 9 Part 4.4: seal the stored document files of any workspace whose key has not been through a complete pass (reencrypt_document_files in tasks.mjs). Cheap when there is nothing to do.
  enqueue("reencrypt_document_files", {}, { jobKey: "reencrypt_document_files", jobKeyMode: "preserve_run_at" }, { connectionString: cs })
    .catch((err) => console.error(`[worker] could not queue the file sealing pass: ${err.message}`));

  // ★★ 07 heartbeat — every 30 s, independent of the sweep, so a stuck sweep and a dead process are told apart.
  const workerName = process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "worker";
  const beatNow = () => beat({ connectionString: cs, worker: workerName })
    .catch((err) => console.error(`[worker] heartbeat failed: ${err.message}`));
  beatNow();
  const beatTimer = setInterval(beatNow, 30_000);
  beatTimer.unref?.();

  return {
    runner,
    sweepRunner,
    fastRunner,
    async stop() {
      clearInterval(timer);
      clearInterval(beatTimer);
      // ★★ STAGE 3 TASK 5 — BEFORE runner.stop(): a dispatch in flight finishes the event it is on and
      //    RELEASES the rest of its claimed batch (`releaseClaim` — pending again, no failure recorded,
      //    recon §4: it was never called), instead of working through the whole batch while the deploy
      //    waits, or being cut off and leaving claims to expire after the 15-minute lease.
      requestDispatchStop();
      // ★★ `runner.stop()` lets in-flight jobs finish. It does NOT abandon them — and an abandoned job
      //    would be recovered anyway by graphile's lock expiry, which is feature (5) above and the same
      //    property migration 0040 gave the outbox.
      await fastRunner.stop();
      await runner.stop();
      await sweepRunner.stop();
    },
  };
}
