// src/home/bands.mjs — Stage 17 task 17.27: independent band runners for /api/home.
//
// `runBand(db, name, fn)` wraps a band query in a SAVEPOINT, so one band's failure
// never blanks another. On success, returns the fn's result; on throw, catches the error
// and returns `{ error: { kind, requestId } }` so the response can carry multiple bands
// with some succeeding and some failed.
//
// ★★★ SEQUENTIAL ONLY — one pg client cannot run savepoints in parallel. The handler
//     calls these in order, never Promise.all().

import { ErrorKind } from "../http/errors.mjs";

/**
 * Run a function inside a database SAVEPOINT named `band_<name>`.
 * On success, return the function's result.
 * On throw, rollback to the savepoint and return `{ error: { kind, requestId } }`.
 *
 * @param {object} db — a pg client inside withTenant's transaction
 * @param {string} name — the band name (e.g. "hero", "prompts", "money")
 * @param {function} fn — async () => any, the band computation
 * @param {string} requestId — request ID for error context (optional)
 * @returns {Promise<any>} — fn's result, or { error: { kind, requestId } }
 */
export async function runBand(db, name, fn, requestId = null) {
  // The savepoint name is safe for all band names (alphanumeric + underscore)
  // because the spec lists the bands and they're all identifiers.
  const savepointName = `band_${name}`;

  try {
    // Create the savepoint
    await db.query(`SAVEPOINT ${savepointName}`);

    // Run the band computation
    const result = await fn();

    // Release the savepoint on success
    await db.query(`RELEASE SAVEPOINT ${savepointName}`);
    return result;
  } catch (err) {
    // ★ Logged: a band that fails quietly looks like an empty band (the owner hero rendered "—" with
    //   nothing in any log, 26 Sep 2026). The reader still sees the band's own error panel.
    console.error(`[${requestId ?? "-"}] home band "${name}" failed: ${err?.message ?? err}`);
    // Rollback to the savepoint on any error
    try {
      await db.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
    } catch (rollbackErr) {
      // If rollback itself fails, something is very wrong — but we still
      // return the original error's context, not the rollback failure.
      console.error(`Failed to rollback savepoint ${savepointName}:`, rollbackErr);
    }

    // Return the error in the band-error shape: { error: { kind, requestId } }
    const kind = err.kind || ErrorKind.INTERNAL;
    return {
      error: {
        kind,
        requestId: requestId ?? null,
      },
    };
  }
}
