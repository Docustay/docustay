// src/health/workerWatch.mjs — F504 layer 2 (07 §5/§6). keystone-app watches the worker's own
// heartbeat, because the worker cannot report its own death (watch_system runs INSIDE it).
//
// ★★★ WHY THIS FILE EXISTS. [MEASURED, production, 18 Sep 2026] the worker crash-looped for 12.5
//     hours in total silence — nothing outside the worker was watching it. Layer 1 (a separate task)
//     adds an external uptime monitor; this is layer 2: a SEPARATE process (keystone-app) reads the
//     same heartbeat row (0127, via defaultWorkerBeatAge) every 60 s and raises its own alert.
//
// ★★ THE DOOR IS ONE FUNCTION, keystone_meta.worker_alert_transition() (migration 0146) — the key is
//    fixed to 'worker' inside it, so app_rw can never flip any other alert. Everything else here is
//    the same shape as src/health/alerts.mjs's notifyTransitions: BEGIN → the SQL verdict → send only
//    if the verdict is news → COMMIT, and a thrown send ROLLS BACK so the next tick retries (the same
//    rule as alerts.mjs — an alert lost to a send failure must not go quiet for REPEAT_MINUTES).
//
// ★ SKIPPED ENTIRELY when KEYSTONE_ENVIRONMENT is 'local' — a developer's machine has no worker
//   heartbeat, no Resend key and usually no KEYSTONE_ALERT_EMAIL, so the timer would fire every 60 s
//   and log nothing but noise. `force: true` is the injectable escape hatch a test uses to enable it.
//
// ★★★ THIS FILE OPENS ITS OWN RAW pg CONNECTION (app_rw / KEYSTONE_DATABASE_URL), which is why it is
//     named in db/gates/tenant-predicate-lint.mjs's allow-list rather than routed through
//     withTenant() — the same reasoning src/queue/heartbeat.mjs states for its own one call: this is
//     a single SECURITY DEFINER call with no tenant context, not a tenant-scoped query.

import { dbSsl } from "../db/ssl.mjs";
import { platformAlertTo } from "../mail/index.mjs";
import pg from "pg";
import { sendViaResend } from "../email/resend.mjs";
import { sendingAddress } from "../email/send.mjs";
import { redirectForEnvironment } from "../email/redirect.mjs";
import { deliverOrThrow } from "../email/deliverOrThrow.mjs";
import { defaultWorkerBeatAge } from "./probes.mjs";

/** ★ Same threshold /healthz/worker uses (src/http/app.mjs, the `age < 120` check) and the same
 *   number spec 07 §5 states ("Heartbeat row older than 2 min"). Restated here rather than imported:
 *   that route owns its own response shape and this module owns its own retry/email shape, so a
 *   change to one is never silently a change to the other. */
export const WORKER_STALE_SECONDS = 120;
// ★ TY, 2 Oct 2026 — same rule as alerts.mjs: a reminder is once every 24h (was hourly), there is NO 'recovered' email, and only PRODUCTION emails.
const REPEAT_MINUTES = 24 * 60;
// ★ Not exported: nothing outside this module needs the literal, and an export with no non-test
//   importer is exactly the orphan class db/gates/wiring.mjs exists to catch.
const TICK_MS = 60_000;

/**
 * One tick: read the heartbeat's age, transition the (fixed) 'worker' alert, send only when the
 * verdict is news. Exported standalone — not folded into startWorkerWatch — so tests drive it
 * directly with injected deps and no real timer.
 *
 * @param {object}   deps
 * @param {() => Promise<number|null>} [deps.getAge]  defaults to defaultWorkerBeatAge (probes.mjs)
 * @param {(sql: string, args?: any[]) => Promise<{rows: any[]}>} deps.query  a connection with
 *   EXECUTE on keystone_meta.worker_alert_transition (app_rw)
 * @param {(msg: object) => Promise<any>} [deps.send]  defaults to sendViaResend; injected in tests
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {(msg: string) => void} [deps.log]  defaults to console.error; injected in tests. Called
 *   (never thrown) when the verdict is newsworthy but KEYSTONE_ALERT_EMAIL is missing/invalid — the
 *   same silence gap alerts.mjs's Stage 3 Task 6 fix closes for every other IMMEDIATE_KEYS check.
 * @returns {Promise<{state: 'ok'|'problem', age: number|null, kind: string}>}
 */
export async function tickWorkerWatch({ getAge = defaultWorkerBeatAge, query, send, env = process.env, log = console.error } = {}) {
  if (typeof query !== "function") throw new Error("tickWorkerWatch requires a query(sql, args) function");
  const age = await getAge();
  const state = age === null || age > WORKER_STALE_SECONDS ? "problem" : "ok";
  const to = platformAlertTo(env);
  const canEmail = Boolean(to && to.includes("@")) && (env.KEYSTONE_ENVIRONMENT ?? "") === "production";
  const deliver = send ?? ((m) => sendViaResend(m, { env }));

  await query("BEGIN");
  try {
    const { rows } = await query(
      "SELECT keystone_meta.worker_alert_transition($1, $2) AS kind", [state, REPEAT_MINUTES]
    );
    const kind = rows[0].kind;
    if (kind !== "quiet" && kind !== "recovered" && canEmail) {
      const envName = env.KEYSTONE_ENVIRONMENT ?? "unknown";
      const subject = `Workbench ${envName}: Worker needs attention`;
      const routed = redirectForEnvironment({ to, subject }, env);
      const detail = state === "problem"
        ? age === null
          ? "The worker has never sent a heartbeat."
          : `The worker's last heartbeat was ${age}s ago (threshold ${WORKER_STALE_SECONDS}s).`
        : "The worker's heartbeat is healthy again.";
      // ★★★ IF THIS THROWS, worker_alert_transition's write for THIS tick must not survive it — the
      //     catch below rolls back, so the NEXT tick sees the same problem as still-new and retries.
      // ★★ fix round 1 (F526 / review C1) — `deliverOrThrow` also throws on a RESOLVED `{ok:false}`
      //    (a real Resend 500/429/timeout), which `sendViaResend` never throws for on its own. See
      //    src/email/deliverOrThrow.mjs's header for the full defect.
      await deliverOrThrow(deliver, {
        to: routed.to, from: sendingAddress(env), subject: routed.subject,
        text: `${detail}\n\nPlatform → Health shows every check.`,
      });
    } else if (kind !== "quiet" && kind !== "recovered" && !canEmail && (env.KEYSTONE_ENVIRONMENT ?? "") === "production") {
      // ★★★ fix round 1, item 2 (review Important #2) — SILENT UNDER-ALERTING WHEN EMAIL IS
      //     UNCONFIGURED. alerts.mjs's Stage 3 Task 6 fix throws AFTER its loop specifically so
      //     watch_system's logger records "could not send alerts" when KEYSTONE_ALERT_EMAIL is
      //     missing — this used to have no equivalent, so a misconfigured keystone-app would go
      //     right back into the exact blind spot layer 2 exists to end, with nothing in Railway's
      //     logs to say so. LOGGED, NOT THROWN: the transition already committed the platform fact
      //     inside worker_alert_transition and must stay committed — a throw here would roll it back
      //     via the catch below, re-introducing a lost fact on top of the lost email.
      log(`tickWorkerWatch: KEYSTONE_ALERT_EMAIL is not set or invalid — worker health problems cannot reach a person (kind=${kind}, platform fact was still recorded)`);
    }
    await query("COMMIT");
    return { state, age, kind };
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }
}

/**
 * Opens one short-lived app_rw connection, runs one tick, closes it. A fresh connection per tick —
 * the same reasoning as src/queue/heartbeat.mjs's `beat()` — not a shared pool: this is one function
 * call, not queue traffic, and giving each tick its own connection is what makes the BEGIN/COMMIT
 * boundary unambiguous even when two app replicas tick at the same moment. The alert_state row's
 * `FOR UPDATE` lock (0128), not the connection, is what serializes them into exactly one send — proven
 * in test/s4_app_watches_worker.test.mjs with two real connections ticking concurrently.
 */
async function tickWithOwnConnection({ connectionString, env }) {
  const client = new pg.Client({ connectionString, ssl: dbSsl() });
  await client.connect();
  try {
    return await tickWorkerWatch({ query: (sql, args) => client.query(sql, args), env });
  } finally {
    await client.end();
  }
}

/**
 * Starts the 60 s timer in keystone-app. Call from src/server.mjs AFTER the listener binds; call the
 * returned function on shutdown.
 * ★ Skips entirely when KEYSTONE_ENVIRONMENT is 'local', unless `force: true` (a test's escape hatch).
 * @returns {() => void} stop
 */
export function startWorkerWatch({
  env = process.env,
  connectionString = env.KEYSTONE_DATABASE_URL,
  everyMs = TICK_MS,
  force = false,
} = {}) {
  if (env.KEYSTONE_ENVIRONMENT === "local" && !force) {
    return () => {};
  }
  const t = setInterval(() => {
    tickWithOwnConnection({ connectionString, env }).catch((err) => {
      // ★★★ NEVER THROWS OUT OF THE TIMER. A thrown tick here would take down keystone-app over a
      //     transient database or Resend blip — the exact opposite of what a watcher should do.
      console.error(`workerWatch tick failed: ${err.stack ?? err.message}`);
    });
  }, everyMs);
  t.unref();
  return () => clearInterval(t);
}
