// P2.2 runner · P2.3 forward-only · P2.17 FAULT_INJECT crash testing.
//
// ★★★ THE CRASH WINDOW THIS EXISTS TO SURVIVE (P2.17):
//   1. we call the provider,
//   2. the provider succeeds,
//   3. ★ THE PROCESS DIES BEFORE THE RESPONSE IS RECORDED.
// The remote object now exists and our database has no idea. On restart the step is still
// `pending` or `running`, so the runner tries again — and the ONLY thing that stops a duplicate
// is `already_exists` classifying as SUCCESS and resolving through `find()` (P2.4).
//
// ★ `FAULT_INJECT=crash_after_call:<step>` reproduces exactly that window, per step, so the
// recovery path is exercised rather than assumed. P2.17 says EVERY step, not a representative one,
// because the window differs per provider: some return an id we can re-find, some do not.
//
// ★★ FORWARD-ONLY (P2.3). There is no automatic compensation. A step that fails leaves the run
// `partial`, never "rolled back" — the vendors cannot be cleanly undone (Twenty soft-deletes and
// holds the subdomain forever, a Stripe delete is permanent on a live account). ★ Documenso was a
// third example of this and is retired (S2 Task 3, 01 default 9); the argument does not depend on
// it — two vendors that resist cleanup are enough to rule out automatic rollback on their own.
// "Automatic rollback turns one stuck step into six."

import { Outcome, isSuccess, classify, backoffMs } from "./classify.mjs";

export class InjectedCrash extends Error {
  constructor(step, phase) {
    super(`FAULT_INJECT: simulated crash ${phase} during step "${step}"`);
    this.name = "InjectedCrash";
    this.injected = true;
  }
}

/** Parse FAULT_INJECT. Format: `crash_after_call:<step>` or `crash_before_record:<step>`. */
export function parseFaultInjection(env = process.env) {
  const raw = env.FAULT_INJECT;
  if (!raw) return null;
  const [mode, step] = String(raw).split(":");
  if (!mode || !step) return null;
  if (!["crash_after_call", "crash_before_record"].includes(mode)) return null;
  return { mode, step };
}

/**
 * Execute one step, forward-only.
 *
 * @param ctx.db        a client already inside the tenant's context (or privileged for the prefix)
 * @param ctx.runId
 * @param step          {name, segment}
 * @param perform       async () => ({outcome, externalId, ...}) — the provider call
 */
export async function executeStep(ctx, step, perform, opts = {}) {
  const { db, runId } = ctx;
  const fault = opts.fault ?? parseFaultInjection(opts.env);

  const cur = await db.query(
    `SELECT state, attempts, max_attempts, external_id
       FROM keystone.provisioning_step WHERE run_id=$1 AND name=$2`,
    [runId, step.name]
  );
  const row = cur.rows[0];
  if (!row) throw new Error(`executeStep: no step "${step.name}" on run ${runId}`);

  // ★ Already finished — never re-run. This is the FIRST line of duplicate protection, before
  // any provider-level idempotency.
  if (row.state === "succeeded") {
    return { skipped: true, reason: "already succeeded", externalId: row.external_id };
  }
  // ★ A human-blocked step is never retried. See P2.7.
  if (row.state === "awaiting_human") {
    return { skipped: true, reason: "awaiting human" };
  }
  if (row.attempts >= row.max_attempts) {
    return { skipped: true, reason: "attempt budget exhausted" };
  }

  await db.query(
    `UPDATE keystone.provisioning_step
        SET state='running', started_at=COALESCE(started_at, now()), attempts = attempts + 1
      WHERE run_id=$1 AND name=$2`,
    [runId, step.name]
  );

  let result;
  try {
    result = await perform();
  } catch (err) {
    if (err?.injected) throw err; // a fault injection must propagate, not be classified
    result = { outcome: classify(step.provider ?? "unknown", err), error: err };
  }

  // ★★★ THE CRASH WINDOW. The provider call has RETURNED; nothing is recorded yet.
  if (fault && fault.mode === "crash_after_call" && fault.step === step.name) {
    throw new InjectedCrash(step.name, "after the provider call, before recording");
  }

  const { outcome, externalId = null } = result;

  if (fault && fault.mode === "crash_before_record" && fault.step === step.name) {
    throw new InjectedCrash(step.name, "immediately before the database write");
  }

  if (isSuccess(outcome)) {
    await db.query(
      `UPDATE keystone.provisioning_step
          SET state='succeeded', external_id=COALESCE($3, external_id), completed_at=now(), last_error=NULL
        WHERE run_id=$1 AND name=$2`,
      [runId, step.name, externalId]
    );
    return { ok: true, outcome, externalId, resolvedByFind: result.resolvedByFind ?? false };
  }

  if (outcome === Outcome.AWAITING_HUMAN) {
    await db.query(
      `UPDATE keystone.provisioning_step SET state='awaiting_human' WHERE run_id=$1 AND name=$2`,
      [runId, step.name]
    );
    return { ok: false, outcome };
  }

  const retryable = outcome === Outcome.RETRYABLE;
  await db.query(
    `UPDATE keystone.provisioning_step
        SET state=$3, last_error=$4, last_error_retryable=$5
      WHERE run_id=$1 AND name=$2`,
    [runId, step.name, retryable ? "pending" : "failed",
     String(result.error?.message ?? outcome).slice(0, 1000), retryable]
  );
  return { ok: false, outcome, retryable, retryAfterMs: retryable ? backoffMs(row.attempts + 1) : null };
}

/**
 * Recompute the run's state from its steps. ★ Forward-only: this never deletes or undoes anything.
 */
export async function reconcileRunState(db, runId) {
  const { rows } = await db.query(
    `SELECT name, segment, state FROM keystone.provisioning_step WHERE run_id=$1`,
    [runId]
  );
  const prefixFailed = rows.some((r) => r.segment === "prefix" && r.state === "failed");
  // ★ `skipped` is DONE — a step the product deliberately does not perform (0131 closed the retired
  //   documenso_team this way). Counting only `succeeded` left such a run unable to ever finish.
  const allDone = rows.every((r) => r.state === "succeeded" || r.state === "skipped");
  const anyOpen = rows.some((r) => ["pending", "running", "awaiting_human"].includes(r.state));

  // ★ 'partial' is the DESIGNED state: the tenant is live and usable, suffix work outstanding.
  const state = prefixFailed ? "failed" : allDone ? "succeeded" : anyOpen ? "partial" : "partial";

  await db.query(
    `UPDATE keystone.provisioning_run
        SET state=$2, completed_at = CASE WHEN $2='succeeded' THEN now() ELSE completed_at END
      WHERE id=$1`,
    [runId, state]
  );
  return state;
}
