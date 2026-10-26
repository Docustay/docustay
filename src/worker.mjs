#!/usr/bin/env node
// P18.9 — keystone-worker. ★★★ IT NOW ACTUALLY STARTS THE RUNNER. IT DID NOT BEFORE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TWO DEFECTS WERE MEASURED HERE ON 2026-09-14, AND BOTH ARE THE SAME SHAPE AS F5.
//
//   1 · **THE `keystone-worker` SERVICE WAS RUNNING THE APP.** Both services share one image, whose
//       `CMD` is `node src/server.mjs`, and the worker service had **no start command of its own**.
//       [MEASURED from the deployed worker's log] it printed
//           `keystone-app listening on :8080`
//       — a second copy of the HTTP server, on a service with no domain, answering nobody. It looked
//       perfectly healthy the whole time. Fixed by setting `startCommand: node src/worker.mjs`.
//
//   2 · ★★★ AND THEN THE WORKER TURNED OUT TO BE A STUB. This file was written at P12.4 and said so
//       honestly: *"NO QUEUE IS DRAINED"*, because at the time `emit()` had no producers (F5),
//       `claim_events()` had no lease (F4), and there was no legal tenant lister (D5). It logged that
//       sentence and then slept until SIGTERM. **P18.6 built the entire runner — and nothing ever
//       called `startWorker()`.**
//
// ★★ SO THE QUEUE HAD A CONSUMER THAT WAS NEVER STARTED, WHICH IS **EXACTLY THE DEFECT `tasks.mjs`
//    WARNS ABOUT, ONE LAYER UP.** Its header says a dispatcher with no handlers "passes every health
//    check and moves nothing"; this was a WORKER with handlers that was never launched. The gates for
//    P18.6(a)–(f) all passed, because they call `TASK_LIST`'s functions directly — which is the right
//    way to test them and is precisely why it does not notice that production never runs them.
//  ★ The general lesson, recorded because it has now cost two findings in one phase: **a gate proves a
//    function works. Only a deploy proves it RUNS.** That is the whole of Evidence Level 3.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE THREE OBJECTIONS THE OLD VERSION RAISED ARE CLOSED, AND EACH IS NAMED WITH WHAT CLOSED IT —
//   because "the comment said not to start it" is the only reason it was not started, and deleting
//   that comment without answering it would be the wrong fix:
//
//   F5 · emit() had no producer  → CLOSED by P18.8 (a real route emits) and now by P18.9's two topic
//        handlers, which consume `documents.document.sent` and `documents.document.executed`.
//   F4 · claim_events() had no lease → CLOSED by migration 0040 (lease + `next_attempt_at` + backoff),
//        and 0041 which dropped the old overload that 0040 had left reachable.
//   D5 · a poll cannot enumerate tenants → CLOSED by migration 0044's
//        `keystone_auth.list_active_tenant_ids()`, a gated SECURITY DEFINER lister GRANTed to
//        `app_worker` only. `sweep_tenants` is its one caller.

import "./logging/install.mjs";   // Run 7 part 6: every log line leaves without credentials or email addresses
import { settingsReport, holdsToManifest } from "./health/requiredSettings.mjs";
import { assertStartupInvariants } from "./health/index.mjs";
import { healthDeps, closeProbePool, pingDatabase } from "./health/probes.mjs";
import { closePool } from "./db/index.mjs";
import { startWorker } from "./queue/runner.mjs";
import { startOutboxWake } from "./queue/outboxWake.mjs";
import { TASK_LIST } from "./queue/tasks.mjs";
import { installHostDocumentsPorts } from "./ports/documents.mjs";
// ★ the Documents island asks its host for mail / brand / people / facts / price / usage — plugged in ONCE, here, at startup (src/documents/ports.mjs)
installHostDocumentsPorts();
import { installHostMailPorts } from "./ports/mail.mjs";
// ★ the mail module (one sending identity per organisation) asks its host for the provider, sender, brand and secrets — plugged in ONCE, here
installHostMailPorts();

async function main() {
  const deps = healthDeps();

  // ★ THE SAME INVARIANTS AS THE APP, for the same reason: a worker with a wrong tenant timezone
  //   produces plausible wrong scheduling, silently. Unchanged from P12.4 and still right.
  try {
    await assertStartupInvariants({
      env: process.env,
      readCertificate: deps.readCertificate,
      queryTenantTimezones: deps.queryTenantTimezones,
    });
  } catch (err) {
    console.error("\n★ STARTUP INVARIANTS FAILED — keystone-worker refuses to start:\n");
    for (const f of err.failures ?? [err.message]) console.error(`  ✗ ${f}`);
    await shutdown(1);
    return;
  }

  const reachable = await pingDatabase();
  if (!reachable) {
    // ★★ FAIL LOUD. A worker that starts without a database polls nothing and reports healthy — the
    //    exact state the old version of this file was written to avoid, arriving from a different
    //    direction. Better a crash-loop Railway shows than a green service moving nothing.
    console.error("keystone-worker: the database is NOT reachable. Refusing to start a runner that " +
                  "cannot claim anything — a worker polling an unreachable database looks healthy.");
    await shutdown(1);
    return;
  }

  // ★★★ THE TASK LIST IS LOGGED BY NAME AT BOOT. Not decoration: the two defects above were both
  //     invisible because nothing said what this process was actually going to do. A start line that
  //     names the jobs makes "the worker is running but the job is not registered" a visible state
  //     rather than an inferred one.
  console.log(
    `keystone-worker: starting the runner. ${Object.keys(TASK_LIST).length} task(s) registered: ` +
    `${Object.keys(TASK_LIST).join(", ")}`);

  const { stop } = await startWorker({});
  const wake = await startOutboxWake({}).catch((e) => { console.error(`keystone-worker: outbox wake not started (${e.message}) — events wait for the minute sweep`); return null; });
  { const r = holdsToManifest() ? settingsReport(process.env, "worker") : { missing: [], missingWarn: [] };
    if (r.missing.length) console.error(`keystone-worker: REQUIRED SETTING(S) MISSING: ${r.missing.join(", ")} — jobs that need them will fail`);
    if (r.missingWarn.length) console.warn(`keystone-worker: recommended settings unset: ${r.missingWarn.join(", ")}`); }
  console.log("keystone-worker: runner started. LISTEN/NOTIFY is live and the tenant sweep is armed.");

  // ★ Graceful stop: `runner.stop()` lets in-flight jobs finish rather than abandoning them. An
  //   abandoned job is recoverable (that is what 0040's lease and `reclaimAbandonedJobs` are for) but
  //   recovering from a shutdown we control would be sloppiness, not resilience.
  await new Promise((resolve) => {
    const bye = (sig) => { console.log(`keystone-worker: ${sig} — finishing in-flight jobs`); resolve(); };
    process.on("SIGTERM", () => bye("SIGTERM"));
    process.on("SIGINT", () => bye("SIGINT"));
  });
  await wake?.stop().catch(() => {});
  await stop().catch((e) => console.error(`keystone-worker: stop failed: ${e.message}`));
  await shutdown(0);
}

async function shutdown(code) {
  await closeProbePool().catch(() => {});
  await closePool().catch(() => {});
  process.exit(code);
}

main().catch(async (err) => {
  console.error(`FATAL: ${err.stack ?? err.message}`);
  await shutdown(1);
});
