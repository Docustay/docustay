-- 0041_drop_the_unfixed_claim_events
-- P18.6(a) — ★★★ 0040 SHIPPED THE FIX AND LEFT THE BROKEN FUNCTION IN PLACE, STILL BEING CALLED.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT WENT WRONG, MEASURED, ONE MIGRATION LATER — AND ITS OWN GATE CAUGHT IT.
--
-- 0040 wrote `CREATE OR REPLACE FUNCTION keystone.claim_events(p_limit, p_lease, p_max_attempts)`.
-- **In Postgres a different argument list is an OVERLOAD, not a replacement.** So after 0040 there
-- were TWO functions [MEASURED from pg_proc]:
--     oid 18200   claim_events(p_limit integer)                                    ← the ORIGINAL, unfixed
--     oid 18580   claim_events(p_limit integer, p_lease interval, p_max_attempts integer)
--
-- ★★★ AND THE ONLY CALLER IN THE CODEBASE CALLS IT WITH ONE ARGUMENT.
--     `claimEvents()` (`src/events/outbox.mjs`) issues `SELECT * FROM keystone.claim_events($1)`.
--     Postgres resolves an EXACT arity match in preference to filling defaults, so every real call
--     went to **oid 18200 — the version with no lease, no backoff and no reaper.**
--   ★★ THE FIX WAS PRESENT, TESTED, AND UNREACHABLE. Migration applied, gate green on the new
--      function, F4 still live in production. That is the worst available outcome, because it looks
--      exactly like success — and it is the same shape as the deploy that ships a bundle nobody
--      serves, and as the shared `.cjs` fix that only reaches redeployed functions.
--   ★ It was caught because `db/gates/p18_queue_lease.mjs` reads the LEASE PREDICATE OUT OF THE
--     CATALOG (`pg_get_functiondef`) instead of trusting the migration file, and the definition it
--     got back had no lease branch in it. **A gate that had asserted "migration 0040 is applied"
--     would have passed.**
--
-- ★★ SO: ONE claim path, by name, and nothing left behind to resolve to.
DROP FUNCTION keystone.claim_events(integer);

-- ★ And the surviving function's defaults must cover the one-argument call, or dropping the overload
--   would break `claimEvents()` instead of fixing it. `p_lease` and `p_max_attempts` both carry
--   defaults (0040), so `claim_events(100)` now resolves to the leased version. The gate asserts the
--   one-argument form returns leased behaviour, which is the assertion that makes this safe.

COMMENT ON FUNCTION keystone.claim_events(integer, interval, integer) IS
  'P18.6(a) — THE ONLY claim path. 0041 dropped the one-argument overload 0040 accidentally left '
  'behind, which every existing caller was resolving to. Eligible = pending, or failed past its '
  'backoff, or a claim whose lease expired (F4). Reaps rows past p_max_attempts to dead with a reason.';
