// Stage 3 Task 3 fix 1, review M6 — ONE `asViewer`, IN A LEAF MODULE.
// ★ It used to live in `src/queue/tasks.mjs`, and `src/tasks/chains.mjs` carried a byte-for-byte copy
//   (`asViewerHere`) because importing it from `queue/tasks.mjs` would form a cycle (that file imports
//   `TASK_CHAINS` from chains.mjs). This file imports NOTHING, so both can depend on it.

/**
 * ★★★ RUN A HANDLER'S READS AND WRITES **AS A VIEWER, ON THE DISPATCHER'S OWN TRANSACTION.**
 *
 * ★★★ WHY THIS EXISTS AND WHY THE OBVIOUS ALTERNATIVE SELF-DEADLOCKS — MEASURED, NOT REASONED.
 *     My first version of the `documents.document.sent` handler called `withTenant(...)` inside the
 *     dispatcher, i.e. it opened a SECOND connection and a SECOND transaction, to get a `userId` set.
 *     The result, [MEASURED on the deployed database]:
 *         documents.document.created | pending | attempts 0
 *         documents.document.sent    | pending | attempts 0      ← claimed, then UNCLAIMED
 *         documents.document.executed| processed | attempts 1
 *     The `sent` and `created` rows came back to `pending` **with attempts 0**, which is not a failure
 *     state — it is the state of a row that was **never claimed**, because the CLAIM ITSELF WAS
 *     ROLLED BACK.
 *   ★★ THE MECHANISM: the dispatcher's transaction has already `UPDATE`d those `event` rows (that is
 *      what claiming is), so it holds row locks on them. The inner transaction then INSERTs a
 *      `notification` whose `event_id` REFERENCES `keystone.event` — and an FK check must take a share
 *      lock on the referenced row. So the inner transaction waits for the outer's lock while the outer
 *      waits for the inner to return. **A self-deadlock across two connections in one logical unit.**
 *   ★★★ AND ITS SIGNATURE IS ALMOST INVISIBLE: no error in the harness, no `failed` row, no
 *      `last_error` — just events sitting `pending` at 0 attempts looking untouched, and a worker log
 *      reporting `claimed=0` on the next sweep. It reads exactly like "the worker never saw them".
 *      The `executed` handler was unaffected because it only calls `helpers.addJob`, which uses
 *      graphile's own connection and never references the event row.
 *
 * ★ SO: ONE TRANSACTION. `set_config(..., true)` is transaction-local, which is precisely the tool —
 *   the viewer is set for the duration of this handler and restored before the next event in the batch,
 *   so one event's actor can never leak into another's.
 * ★★ The restore is unconditional (`finally`), and it restores to the EMPTY string rather than
 *   deleting the setting, because `current_user_id()` is `nullif(current_setting(...), '')::uuid` —
 *   an empty string is how "no viewer" is spelled here, and a stray uuid left behind would silently
 *   widen what the next handler in the same batch can see.
 */
export async function asViewer(tx, userId, fn) {
  const prev = (await tx.query("SELECT current_setting('keystone.user_id', true) AS v")).rows[0].v ?? "";
  await tx.query("SELECT set_config('keystone.user_id', $1, true)", [userId]);
  // ★★ STAGE 3 TASK 5 — THE RESTORE MUST NOT HIDE THE REAL ERROR. [EXECUTED, test/s3_poison_listener]
  //    with an unconditional `finally`, a SQL error inside `fn` left the transaction aborted, the restore
  //    query then failed with 25P02 "current transaction is aborted", and THAT error replaced the real one
  //    — the dispatcher recorded "in_failed_sql_transaction" instead of the cause. On the error path the
  //    restore is attempted and its own failure ignored; the original error is rethrown. The viewer does
  //    not leak: the dispatcher's ROLLBACK TO SAVEPOINT reverts the transaction-local GUC to its value at
  //    the savepoint, and any other caller's transaction is rolled back whole by withTenant.
  let result;
  try {
    // ★ R25 (RECONCILE, found by R1's done-test) — `fn` gets the SAME tx. `asPracticeOwner`'s contract
    //   says "receives tx", and 10 callers (noShow.mjs ×7, loyaltyAccrual.mjs ×3) read their `ownerTx` /
    //   `txOwner` argument — with `fn()` it was undefined, so every no-show charge and every loyalty
    //   accrual threw "Cannot read properties of undefined (reading 'query')". Callers that ignore the
    //   argument are unaffected.
    result = await fn(tx);
  } catch (err) {
    await tx.query("SELECT set_config('keystone.user_id', $1, true)", [prev]).catch(() => {});
    throw err;
  }
  await tx.query("SELECT set_config('keystone.user_id', $1, true)", [prev]);
  return result;
}
