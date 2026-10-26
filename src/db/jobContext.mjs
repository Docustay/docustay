// Run 9 Part 4.3 (F984) — WHICH BACKGROUND JOB IS RUNNING, so the database can tell the worker from a public route.
// Both run with no signed-in person (keystone.user_id unset). The `system_*` policies (expiry, reminders, scheduled sends, receipts, fees, key dates, holds, the archive sweeps …) let a
// no-person handle see exactly the rows a sweep needs; before this, ANY no-person handle got them — a public form, the verify page, a webhook. Now those policies also require
// `keystone.system_job`, which withTenant sets from this context and from nothing else: the task wrapper (src/queue/runLedger.mjs) runs every task inside `runAsJob`, so the
// application supplies the condition, never a test or a request. A request never runs inside it.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();
const NAME = /^[a-z][a-z0-9_:.-]{0,79}$/;

/** Runs `fn` as the named background job: every no-person tenant transaction opened inside it is marked with that job's name. */
export function runAsJob(name, fn) {
  if (!NAME.test(String(name))) throw new Error(`runAsJob: a job name is lower-case letters, digits and _:.- (got ${JSON.stringify(name)})`);
  return store.run({ job: String(name) }, fn);
}
/** The job this code is running inside, or null (a request, a script, a test outside a job). */
export const currentJob = () => store.getStore()?.job ?? null;
