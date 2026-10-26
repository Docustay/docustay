// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STAGE 18 TASK 18.20 — JOB RUN LEDGER
//     Every background job run records task, practice, start, end, outcome and an optional short
//     summary in the platform's own facts schema (keystone_meta.job_run).
//
// ★★ WRAPPED AT THE TASK LEVEL, NOT AT THE ENQUEUE LEVEL — so the ledger records actual runs, not
//    the enqueue of a retry. A job that the graphile scheduler retries (task 4.6 — six attempts on
//    the 07 schedule) will generate six rows: one per execution. That is what the runs_7d count and
//    last_outcome field are for.
//
// ★ RECORDING FAILURES ARE SWALLOWED, NOT PROPAGATED — a failure to record a run ledger entry
//   does not fail the job. Logged so an operator notices if the recorder is down; caught and
//   swallowed so a problem with the recording path does not compound into a problem with the job.
//   (Compare: 0138's record_platform_event also has SECURITY DEFINER, which means recording cannot
//   fail for permission reasons; a failure here is a database or connection problem, which is worth
//   logging but not worth failing the job over.)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { runAsJob } from "../db/jobContext.mjs";
/**
 * ★★ THE WRAPPER. `wrapWithRunLedger(taskList, { query })` returns a new object with the same
 *     keys; each task becomes a wrapper that records its run. Each wrapped task uses
 *     `helpers.withPgClient()` to get the database query function, the same pattern
 *     `recordJobGaveUp` uses (src/health/platformEvents.mjs:57 via tasks.mjs:2426).
 *
 * @param {Object} taskList - the task object (keys = task names, values = async task functions)
 * @param {Object} options
 * @param {Function} options.query - unused (kept for signature compatibility); each task uses helpers
 * @returns {Object} wrapped task list with the same keys
 */
export function wrapWithRunLedger(taskList, { query } = {}) {
  return Object.fromEntries(
    Object.entries(taskList).map(([taskName, originalTask]) => [
      taskName,
      async (payload, helpers) => {
        const started = new Date();
        try {
          const out = await runAsJob(taskName, () => originalTask(payload, helpers));   // Run 9 (F984): every tenant transaction the task opens without a person is marked as this job
          // ★ Extract summary from the return value if present, truncate to 120 chars
          const summary = typeof out?.summary === "string"
            ? out.summary.slice(0, 120)
            : null;
          // ★ Record the successful run (fire-and-forget; failures are logged and swallowed)
          await helpers.withPgClient((pg) =>
            record((sql, args) => pg.query(sql, args), {
              task: taskName,
              tenantId: payload?.tenantId ?? null,
              started,
              finished: new Date(),
              outcome: "ok",
              summary,
            })
          ).catch((err) => {
            // ★ Log the failure but do not propagate it
            helpers.logger.error(`[job-ledger] failed to record run for task '${taskName}': ${err.message}`);
          });
          return out;
        } catch (e) {
          // ★ Record the failed run (fire-and-forget; recording failure is logged and swallowed)
          await helpers.withPgClient((pg) =>
            record((sql, args) => pg.query(sql, args), {
              task: taskName,
              tenantId: payload?.tenantId ?? null,
              started,
              finished: new Date(),
              outcome: "failed",
              summary: null,
            })
          ).catch((err) => {
            // ★ Log the failure but do not propagate it
            helpers.logger.error(`[job-ledger] failed to record run for task '${taskName}': ${err.message}`);
          });
          // ★ Re-throw the original error so the job is marked failed by graphile
          throw e;
        }
      },
    ])
  );
}

/**
 * ★ Record one job run. Calls the database definer on the app_worker connection.
 * @private
 */
async function record(query, { task, tenantId, started, finished, outcome, summary }) {
  await query(
    "SELECT keystone_meta.record_job_run($1, $2, $3, $4, $5, $6)",
    [task, tenantId, started, finished, outcome, summary]
  );
}
