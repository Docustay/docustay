// P1.15 — IDEMPOTENCY: required header, (tenant_id,key) unique constraint, STORED REPLAY.
//
// ★★★ WHY THE STORED REPLAY MATTERS MORE THAN THE KEY:
// A key that merely PREVENTS re-execution and then returns an error is not idempotent — the
// caller retried because it never saw the first response, and it still has not seen one. It will
// retry again. Idempotency means the second call returns the SAME ANSWER as the first.
//
// ★★ AND THE FINGERPRINT MATTERS MORE THAN BOTH: replaying a key with a DIFFERENT body is a
// client bug. Returning the first response for a different request would silently execute the
// wrong operation and report success. That case is a 409.

import { createHash } from "node:crypto";
import { FACTS } from "../product/docustayPrices.mjs";
import { conflict, invalid } from "./errors.mjs";

export function fingerprint(method, path, body) {
  // Stable: key order must not change the fingerprint, or a JSON re-serialisation between
  // attempts would look like a different request.
  const stable = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(stable);
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  };
  return createHash("sha256")
    .update(JSON.stringify({ method, path, body: stable(body ?? null) }))
    .digest("hex");
}

export function requireIdempotencyKey(headers = {}) {
  const key = headers["idempotency-key"] ?? headers["Idempotency-Key"];
  if (typeof key !== "string" || key.length < FACTS.limits.idempotencyKeyMin || key.length > FACTS.limits.idempotencyKeyMax) {
    // ★ REQUIRED, not optional-with-a-default. A generated-if-absent key defeats the purpose:
    // the retry would generate a different one and execute twice.
    throw invalid("Idempotency-Key header is required for this operation", {
      expected: `${FACTS.limits.idempotencyKeyMin}–${FACTS.limits.idempotencyKeyMax} characters`,
    });
  }
  return key;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ S5 / 5.3 — NOTHING CREDENTIAL-SHAPED IS EVER REPLAYED (CT-007, CCR-13, F470).
//
// A stored response is handed back verbatim on a retry. A response that carried a shown-once
// secret therefore handed the secret back a SECOND time, from a table that keeps it 7 days. The
// stored copy is redacted BY KEY NAME before it is written; the FIRST response the caller gets is
// untouched (the real key must reach the person who asked for it, once).
//
// ★★ TWO LAYERS, AND THE SPLIT IS DELIBERATE (the maintainer, 21 Sep 2026):
//   · NEVER_REPLAYED — the frozen floor: exactly CT-007's eight names. `key` is NOT in it.
//   · extraNames — a per-call list a ROUTE passes for a field only it knows is a credential. The
//     minted API key is returned as `key` (src/routes/developer.mjs:203), which is far too common
//     a word to redact globally. The effective set on any call is NEVER_REPLAYED ∪ extraNames.
// ★ Matching is on the KEY NAME, case-sensitively and exactly. Not a substring and not a regex over
//   values: "looks like gl_live_…" is a prefix, and a prefix is not a category
//   (db/gates/catalog-conformance.mjs:634-637 records that mistake).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const REPLAY_PLACEHOLDER = "[not replayed]";

export const NEVER_REPLAYED = (() => {
  const s = new Set([
    "token", "secret", "apiKey", "api_key", "signingSecret", "presented", "plaintext", "clientSecret",
  ]);
  // Object.freeze alone does not stop Set#add — the entries live in an internal slot, not in
  // properties. The mutators are replaced BEFORE the freeze so the set is genuinely closed.
  for (const m of ["add", "delete", "clear"]) {
    Object.defineProperty(s, m, {
      value() { throw new TypeError(`NEVER_REPLAYED is frozen (${m})`); },
    });
  }
  return Object.freeze(s);
})();

// One walk, two answers: the redacted deep copy, and whether anything was actually replaced.
// (`withIdempotency` needs the second to set `redacted`; `redactForReplay` exposes only the first.)
function redactCore(value, names) {
  let changed = false;
  const walk = (v) => {
    if (v === null || typeof v !== "object") return v;
    // A Date or any other object that serialises itself is walked as what it serialises TO, so a
    // class instance cannot smuggle a credential-named property past the walk.
    if (!Array.isArray(v) && typeof v.toJSON === "function") {
      const j = v.toJSON();
      return j === v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walkEntry(k, x)])) : walk(j);
    }
    if (Array.isArray(v)) return v.map(walk);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walkEntry(k, x)]));
  };
  const walkEntry = (k, x) => {
    if (names.has(k)) { changed = true; return REPLAY_PLACEHOLDER; }
    return walk(x);
  };
  return { body: walk(value), changed };
}

function effectiveNames(extraNames) {
  if (!Array.isArray(extraNames) || !extraNames.every((n) => typeof n === "string")) {
    // ★ THROWS. A route that hands over something else has a programming error; a silent no-op
    //   would store the secret and report success (same class as an unknown rate-limit bucket).
    throw new TypeError("extraNames must be an array of strings");
  }
  return new Set([...NEVER_REPLAYED, ...extraNames]);
}

/**
 * Deep copy of `body` with the value of every key in NEVER_REPLAYED ∪ extraNames replaced by
 * "[not replayed]". Does not mutate its input. Non-objects come back unchanged.
 */
export function redactForReplay(body, extraNames = []) {
  return redactCore(body, effectiveNames(extraNames)).body;
}

// How long a duplicate request waits for the first one's claim before it gives its connection back (see the Round 3 note in withIdempotency).
const IDEMPOTENCY_WAIT_MS = Number(process.env.KEYSTONE_IDEMPOTENCY_WAIT_MS ?? 4000);

/**
 * Run `operation` at most once per (tenant, key).
 *
 * Must be called INSIDE withTenant(); `db` carries the tenant GUC.
 * Returns { replayed: boolean, status, body }.
 *
 * ★ `extraRedactNames` (CCR-13) is OPTIONAL and LAST on purpose: the five 5-argument calls in
 *   test/p1_14_15.test.mjs and any other caller keep working unchanged.
 */
export async function withIdempotency(db, tenantId, key, fp, operation, extraRedactNames = []) {
  // Validated up front so a bad list is a programming error BEFORE the operation runs, not after
  // its side effects have happened.
  const redactNames = effectiveNames(extraRedactNames);

  // ═══════════════════════════════════════════════════════════════════════════
  // ★★★ P15B.13a — THE IDEMPOTENCY / ROLLBACK CONFLICT, RESOLVED. READ THIS BEFORE EDITING.
  //
  // THE DEFECT, as this function was written: on failure it marked the row `failed` and RETHREW.
  // The rethrow propagated out of `fn` into `withTenant`, which ROLLS BACK (db/index.mjs) —
  // ERASING BOTH THE `failed` MARKER AND THE CLAIM ROW. So after a failure there was no record
  // at all, and an immediate retry executed the operation AGAIN. That is precisely what the
  // comment below ("deleting would let an immediate retry execute again") says it prevents.
  //
  // ★★ THE FIX IS A SAVEPOINT, AND A FAILURE IS RETURNED RATHER THAN THROWN.
  //   · the claim and the outcome live in the OUTER transaction and commit with it;
  //   · the OPERATION runs inside a SAVEPOINT, so only IT is undone when it fails;
  //   · the failure travels back as a VALUE, so `withTenant` commits instead of rolling back,
  //     and the caller re-throws AFTER the transaction has closed.
  //
  // ★★★ WHY NOT THE OTHER OPTION THE PLAN OFFERS — "a second connection for the bookkeeping":
  //   it doubles connection use per mutating request against a pool capped at 10 (db/index.mjs),
  //   and — the deciding reason — it OPENS A CRASH WINDOW THIS DESIGN DOES NOT HAVE. With two
  //   connections the operation commits on A and the outcome is written on B; die in between and
  //   the key is stuck `in_flight` forever, indistinguishable from a request still running. With
  //   one transaction there is no such instant: claim + outcome + operation commit together, or
  //   the operation alone is undone.
  //
  // ★★ AND `in_flight` REMAINS UNREACHABLE AS A READ, WHICH IS ACCEPTABLE AND IS STATED RATHER
  //   THAN HIDDEN. Under one-transaction-per-request the claim is not visible until COMMIT, so a
  //   concurrent duplicate BLOCKS on the uncommitted row rather than reading `in_flight`. When
  //   the first transaction ends it sees `succeeded` and REPLAYS — which is the right answer, and
  //   a better one than the 409 the `in_flight` branch would have given. ★ The cost is that a
  //   duplicate holds a connection while it waits; at pool max 10 that is worth knowing.
  // ═══════════════════════════════════════════════════════════════════════════

  // Claim the key. ON CONFLICT DO NOTHING makes the claim atomic — two concurrent retries
  // cannot both believe they are first.
  // ★★★ Round 3 (10 Oct 2026, MEASURED): ten duplicates of one request used to HANG THE API. Each duplicate waits on the first one's uncommitted claim row while holding a pooled connection; with the pool
  //     at 10 the first request could not get the second connection it needs to finish, so nothing ever committed (HeadersTimeout after 300 s, a connection idle in a transaction for 30 minutes).
  //     A duplicate now waits at most IDEMPOTENCY_WAIT_MS for the claim, then answers 409 "in flight, retry" and gives its connection back; the retry replays the stored answer.
  await db.query(`SET LOCAL lock_timeout = '${IDEMPOTENCY_WAIT_MS}ms'`);
  let claim;
  try {
    claim = await db.query(
      `INSERT INTO keystone.idempotency_key (tenant_id, key, request_fingerprint, state)
       VALUES ($1,$2,$3,'in_flight')
       ON CONFLICT (tenant_id, key) DO NOTHING
       RETURNING key`,
      [tenantId, key, fp]
    );
  } catch (e) {
    if (e?.code === "55P03") throw conflict("a request with this Idempotency-Key is already in flight", { hint: "wait a moment and send the same request again with the same key; the answer will be replayed", retryable: true });
    throw e;
  } finally {
    // (after a lock timeout the transaction is aborted and this reset is refused; the caller rolls back and the setting dies with the transaction)
    await db.query("SET LOCAL lock_timeout = 0").catch(() => {});
  }

  if (claim.rowCount === 0) {
    // Someone already holds this key.
    const { rows } = await db.query(
      `SELECT request_fingerprint, state, response_status, response_body
         FROM keystone.idempotency_key WHERE tenant_id=$1 AND key=$2`,
      [tenantId, key]
    );
    const prior = rows[0];

    if (prior.request_fingerprint !== fp) {
      throw conflict("Idempotency-Key reused with a different request body", {
        hint: "a key identifies one specific request; generate a new key for a new request",
      });
    }
    if (prior.state === "in_flight") {
      // ★ 409, NOT a wait-and-retry loop. The first attempt may still be running; telling the
      // caller to retry later is honest. Blocking here would hold a connection and a transaction
      // open for the duration of another request.
      throw conflict("a request with this Idempotency-Key is already in flight");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ A **FAILED** PRIOR ATTEMPT IS RETRIED, NOT REPLAYED — AND THE BUG THIS FIXES WAS SEVERE.
    //     FOUND AT P21C.5 BY MEASUREMENT, not by reading:
    //         call 1 → 400  {"kind":"validation","message":"email is required"}
    //         call 2 → 201  body: null
    //         call 3 → 201  body: null
    //     The `failed` state fell through to the stored-replay line below, which returned
    //     `status: prior.response_status` — **NULL**, because a failure never stores one — and a null
    //     status surfaced as **201 Created with an empty body.**
    //   ★★★ SO A CLIENT THAT RETRIED AFTER A VALIDATION ERROR WAS TOLD ITS RECORD HAD BEEN CREATED,
    //       FOR WORK THAT NEVER HAPPENED. Every mutating route was affected — including
    //       `/api/money/invoices`, `/api/money/payment-methods` and `/api/money/subscriptions`, where
    //       "created" is a statement about money. Fixing your request body and retrying with the same
    //       key is the most ordinary thing a caller does, and it is exactly the path that lied.
    //
    // ★★ WHY RETRY IS THE CORRECT ANSWER AND NOT MERELY THE CONVENIENT ONE. The comment on the failure
    //    path below warns that deleting the row "would let an immediate retry execute again — which is
    //    correct ONLY if the first attempt had no side effects." **Here it provably had none:** the
    //    failure path runs `ROLLBACK TO SAVEPOINT keystone_idempotent_op`, which undoes everything the
    //    operation did inside the transaction — and every outward effect in this system (email, PDF,
    //    webhook) is enqueued through the OUTBOX, which is written in that same transaction and is
    //    therefore rolled back with it. A `failed` row means **nothing happened**, so there is nothing
    //    to de-duplicate and a retry is the honest behaviour.
    //  ★ The row is re-claimed rather than deleted, so the fingerprint check above still applies: a
    //    retry with a DIFFERENT body is still the 409 it always was.
    if (prior.state === "failed") {
      const reclaim = await db.query(
        `UPDATE keystone.idempotency_key
            SET state='in_flight', response_status=NULL, response_body=NULL, completed_at=NULL
          WHERE tenant_id=$1 AND key=$2 AND state='failed'`,
        [tenantId, key]
      );
      // ★ If somebody else re-claimed it between our SELECT and this UPDATE, they are now in flight.
      if (reclaim.rowCount === 0) throw conflict("a request with this Idempotency-Key is already in flight");
      // fall through to the execute block below — we now hold the claim
    } else {
      // ★ THE STORED REPLAY. Only a SUCCEEDED prior reaches here, so `response_status` is never null.
      return { replayed: true, status: prior.response_status, body: prior.response_body };
    }
  }

  // We hold the claim — execute exactly once.
  // ★★★ THE SAVEPOINT. Everything the operation does is undone by ROLLBACK TO; the claim row
  //     above it is not, because it was written BEFORE the savepoint was taken.
  await db.query("SAVEPOINT keystone_idempotent_op");
  try {
    const result = await operation();
    await db.query("RELEASE SAVEPOINT keystone_idempotent_op");
    // ★ F470 — the STORED copy is redacted; the value returned below is not.
    const stored = redactCore(result.body ?? null, redactNames);
    await db.query(
      `UPDATE keystone.idempotency_key
          SET state='succeeded', response_status=$3, response_body=$4, redacted=$5, completed_at=now()
        WHERE tenant_id=$1 AND key=$2`,
      [tenantId, key, result.status ?? 200, stored.body, stored.changed]
    );
    return { replayed: false, status: result.status ?? 200, body: result.body ?? null };
  } catch (err) {
    // ★ Undo ONLY the operation. Without this the outer transaction is poisoned — after an error
    //   Postgres refuses every further statement with 25P02, so the `failed` UPDATE below would
    //   itself fail and the marker would be lost a second way.
    await db.query("ROLLBACK TO SAVEPOINT keystone_idempotent_op");
    // ★ Mark failed rather than deleting the row. Deleting would let an immediate retry execute
    // again — which is correct ONLY if the first attempt had no side effects, and the whole
    // reason for idempotency is that we cannot assume that.
    await db.query(
      `UPDATE keystone.idempotency_key SET state='failed', completed_at=now()
        WHERE tenant_id=$1 AND key=$2`,
      [tenantId, key]
    );
    // ★★★ RETURNED, NOT THROWN. A throw here reaches withTenant, which rolls the whole
    //     transaction back and erases the two rows we just took care to keep. The caller
    //     re-throws `failure` once the transaction has COMMITTED — see runTenantScoped.
    return { replayed: false, failed: true, error: err };
  }
}
