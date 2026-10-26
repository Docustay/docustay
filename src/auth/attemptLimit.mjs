// src/auth/attemptLimit.mjs — attempt limits that follow the ACCOUNT (security audit run 5, S-3 and S-10; migration 0700).
//
// The limiter that sits in front of the sign-in routes is per IP address; it says nothing about how many times ONE account's second factor or
// sign-in code has been guessed, from how many addresses, across how many partial sessions or freshly requested codes. These counters are keyed by the
// identity (or the partial session, or the address a code is requested for) and live in Postgres (`keystone_auth.auth_attempt`), reached only through
// two SECURITY DEFINER functions, so they hold across replicas and across restarts.
//
//   takeAttempt(...)   call BEFORE the check it limits. It counts the attempt and decides in one statement, so parallel guesses cannot buy free ones.
//                      Resolves to 0 when the attempt may go ahead, or to the number of seconds the account stays locked.
//   clearAttempts(...) call after a SUCCESS.
//
// The budgets are here, in one place, so a change is one edit and not a migration.
import { createHash } from "node:crypto";
import { withCredentialLookup } from "../db/index.mjs";
import { rateLimited } from "../http/errors.mjs";

const MIN = 60, HOUR = 60 * MIN;

/** scope → { free: attempts allowed before the first lock, lockSeconds: first lock, capSeconds: longest lock (it doubles up to this), windowSeconds: a quiet spell this long forgives everything } */
export const ATTEMPT_BUDGETS = Object.freeze({
  // wrong second-factor codes for one account, however many partial sessions: 8, then 1 guess per 15 minutes (96/day against a 3-in-a-million chance each)
  two_step:         Object.freeze({ free: 8,  lockSeconds: 15 * MIN, capSeconds: 15 * MIN, windowSeconds: 6 * HOUR }),
  // wrong codes in ONE partial session: 4, then the application ends that session and the person signs in again
  two_step_session: Object.freeze({ free: 4,  lockSeconds: 15 * MIN, capSeconds: 15 * MIN, windowSeconds: 1 * HOUR }),
  // wrong sign-in codes for one account across ALL codes (the 5-per-code limit stays): 10, then 1 guess per 15 minutes
  email_code:       Object.freeze({ free: 10, lockSeconds: 15 * MIN, capSeconds: 15 * MIN, windowSeconds: 6 * HOUR }),
  // code requests per address: 10 over any quiet-to-quiet stretch (on top of 5 per 15 minutes), then 15 min, 30 min, 1 h ... up to 6 h between requests
  email_request:    Object.freeze({ free: 10, lockSeconds: 15 * MIN, capSeconds: 6 * HOUR,  windowSeconds: 24 * HOUR }),
});

const secs = (n) => `${n} seconds`;

/** A key that never carries a secret: a partial session's presented token is hashed. */
export function attemptKeyFor(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/**
 * @param {keyof typeof ATTEMPT_BUDGETS} scope
 * @param {string} key  the identity (firebase uid), the hashed partial session, or the lower-cased address
 * @returns {Promise<number>} 0 = allowed (and counted); N > 0 = locked for N more seconds (not counted)
 */
export async function takeAttempt(scope, key) {
  const b = ATTEMPT_BUDGETS[scope];
  if (!b) throw new Error(`attemptLimit: unknown scope ${JSON.stringify(scope)}`);
  if (typeof key !== "string" || key.trim() === "") throw new Error("attemptLimit: key is required");
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT keystone.auth_attempt_take($1, $2, $3, $4::interval, $5::interval, $6::interval) AS locked_for`,
      [scope, key, b.free, secs(b.lockSeconds), secs(b.capSeconds), secs(b.windowSeconds)]);
    return Number(rows[0].locked_for);
  });
}

/** Forget the counter after a success. */
export async function clearAttempts(scope, key) {
  if (!ATTEMPT_BUDGETS[scope]) throw new Error(`attemptLimit: unknown scope ${JSON.stringify(scope)}`);
  if (typeof key !== "string" || key.trim() === "") return;
  await withCredentialLookup(async (db) => {
    await db.query(`SELECT keystone.auth_attempt_clear($1, $2)`, [scope, key]);
  });
}

/** The 429 a locked account gets (Retry-After carries the wait). */
export function lockedError(lockedForSeconds, message = "Too many tries. Try again later.") {
  const err = rateLimited(message, { retryAfterSeconds: lockedForSeconds });
  err.retryAfterSeconds = lockedForSeconds;
  return err;
}
