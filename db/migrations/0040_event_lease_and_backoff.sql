-- 0040_event_lease_and_backoff
-- P18.6(a) — ★★★ F4: `claim_events()` HAS NO LEASE. A CRASHED WORKER LOSES ITS EVENT FOREVER, SILENTLY.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT IS IN THE SQL AND NO RUNNER FIXES IT. §D5's ruling puts this first, before installing
--     any worker, and it is right to: a runner built on a claim primitive that cannot recover a claim is
--     a runner that loses work and reports healthy.
--
-- [MEASURED 2026-09-13 against the shipped 0016]
--   · `claim_events` selects `WHERE status IN ('pending','failed')`. **`'claimed'` is not in that list.**
--   · `claimed_at` is WRITTEN at `0016:72` and **READ BY NOTHING, anywhere in the project.**
--   · The only path back to claimable is an explicit `markFailed` (`outbox.mjs:205`, which nulls
--     `claimed_at`) — **and a crash never reaches it.**
--   ⇒ A worker that claims an event and dies leaves the row in `claimed` **for the rest of time**, where
--     it reads as "in progress" to every query and every operator. Nothing retries it and nothing says so.
--   · There is also NO time predicate on retry: `'failed'` is re-claimed immediately, so five attempts
--     burn in a tight spin and the row is `dead` in well under a second. **A retry budget spent instantly
--     is not a retry policy.**
--
-- ★ For scale: graphile-worker expires a lock after four hours by default. This project had no expiry
--   at all.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHERE THIS MIGRATION DEPARTS FROM §D5's LITERAL WORDING, AND WHY — STATED, NOT SLIPPED IN.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §D5 lists as a defect that «`attempts` increments **on claim**, so an event dies on the 5th *claim*,
-- not the 5th *failure*». **I am keeping the increment on claim, deliberately, and the reason is the
-- other half of the same sentence:** «a crash-after-claim does not even consume the budget».
--
--   ★★ THOSE TWO COMPLAINTS PULL IN OPPOSITE DIRECTIONS, AND ONLY ONE RESOLUTION IS SAFE.
--      Count only FAILURES, and a **poison event that kills the worker** is immortal: claim → crash →
--      lease expires → claim → crash, forever, consuming a worker slot each time and never reaching any
--      limit, because nothing ever records a failure. That is strictly worse than the bug being fixed —
--      it converts a silently-stuck row into a live crash loop.
--      Count CLAIMS, and every start of work — including one that ends in a crash — costs budget, so a
--      poison event dies after `p_max_attempts` and says so.
--   ★ Once the lease exists, **a claim IS an attempt**, which is what makes counting claims correct
--     rather than merely convenient. Under the old code a claim was not an attempt, because a crashed
--     claim was never tried again; that is exactly the bug.
--   ★★ So §D5's real complaint — "a crash-after-claim does not consume the budget" — is FIXED, and its
--      suggested mechanism is not adopted. graphile-worker resolves it the same way: `attempts`
--      increments per attempt, `run_at` carries the backoff.
--
-- ★ AND THE BUDGET IS NOW ENFORCED AT CLAIM TIME, so a row that has used it becomes `dead` WITH A
--   REASON, rather than being quietly skipped by a `WHERE` clause. A row nothing will ever process
--   must not sit in a state that reads as "waiting".

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · `next_attempt_at` — THE COLUMN §D5 SAYS DOES NOT EXIST. IT DID NOT.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ DEFAULT now() so every EXISTING row and every new emit is immediately eligible. A default of
--   NULL would make `next_attempt_at <= now()` false for every row already in the table and the
--   queue would go silent on deploy — the migration itself becoming the outage.
ALTER TABLE keystone.event
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN keystone.event.next_attempt_at IS
  'P18.6(a) — the earliest moment this event may be claimed again. Set forward by markFailed with '
  'exponential backoff, and by claim_events to now()+lease so a crashed claim is not re-taken instantly.';

COMMENT ON COLUMN keystone.event.claimed_at IS
  'P18.6(a) — WHEN THE LEASE STARTED. Until 0040 this column was written and read by nothing, which is '
  'what made a crashed claim permanent. claim_events now treats claimed_at < now()-lease as reclaimable.';

COMMENT ON COLUMN keystone.event.attempts IS
  'P18.6(a) — ATTEMPTS STARTED, not failures recorded. Incremented on CLAIM, deliberately: a poison '
  'event that crashes its worker must consume budget, or it loops forever once a lease exists.';

-- ★★ THE CLAIMABILITY INDEX. The old `event_pending` index covers only ('pending','failed') and so
--    cannot serve the lease branch at all — an expired claim would be found by a sequential scan.
--    ★ tenant_id FIRST, as always: a leading non-tenant column is the leak shape P15C's 0037 fixed.
CREATE INDEX event_claimable ON keystone.event (tenant_id, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed', 'claimed');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · ★★★ THE CLAIM FUNCTION, WITH A LEASE, A BACKOFF GATE AND A REAPER.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ Still NOT `SECURITY DEFINER`, and that is deliberate: it must run as the CALLER under RLS, so a
--   worker holding `app_rw` can only ever claim its own tenant's events. Making this definer would
--   hand every caller every tenant's outbox — which is precisely the enqueue-path hazard §D5 closes
--   with U26.
-- ★★ `plpgsql` rather than `sql` because it now does two things in order, and the order matters: reap
--    first, so an exhausted row cannot be counted as a claimable one in the same call.
CREATE OR REPLACE FUNCTION keystone.claim_events(
  p_limit         integer  DEFAULT 100,
  -- ★ FIFTEEN MINUTES, not graphile's four hours. These events drive email, documents and money
  --   notifications; a user waiting on one should not wait half a working day because a container was
  --   recycled. ★ It is a PARAMETER so a slow job class can ask for longer rather than the whole queue
  --   being tuned for the slowest thing in it.
  p_lease         interval DEFAULT interval '15 minutes',
  p_max_attempts  integer  DEFAULT 5
)
RETURNS SETOF keystone.event
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  -- ══════════════════════════════════════════════════════════════════════════
  -- ★★★ STEP 1 — REAP. A ROW THAT HAS SPENT ITS BUDGET BECOMES `dead`, AND SAYS WHY.
  -- ══════════════════════════════════════════════════════════════════════════
  -- ★★ Without this the exhausted row would simply fail the `attempts < p_max_attempts` predicate
  --    below and sit in `pending` or `claimed` forever — which is the ORIGINAL BUG wearing a
  --    different status. "Nothing will ever process this" must be a state, not an absence.
  -- ★ `|| …::text` on every append. [MEASURED at 0038/0039] an unknown-typed literal on the right of
  --   `||` resolves to the ARRAY form and raises `malformed array literal`, turning a correct action
  --   into a crash. One cast per append, every time.
  UPDATE keystone.event e
     SET status     = 'dead',
         claimed_at = NULL,
         last_error = coalesce(e.last_error || ' | '::text, ''::text)
                      || 'gave up after '::text || e.attempts::text
                      || ' attempt(s); budget was '::text || p_max_attempts::text
   WHERE e.tenant_id = keystone.current_tenant_id()
     AND e.status IN ('pending', 'failed', 'claimed')
     AND e.attempts >= p_max_attempts
     -- ★ A row still inside a live lease is NOT reaped: a worker may be about to finish it. Only an
     --   EXPIRED claim counts as abandoned.
     AND (e.status <> 'claimed' OR e.claimed_at < now() - p_lease);

  -- ══════════════════════════════════════════════════════════════════════════
  -- ★★★ STEP 2 — CLAIM. THREE WAYS A ROW IS ELIGIBLE, AND THE THIRD IS THE FIX.
  -- ══════════════════════════════════════════════════════════════════════════
  RETURN QUERY
  UPDATE keystone.event e
     SET status     = 'claimed',
         claimed_at = now(),
         attempts   = e.attempts + 1,
         -- ★★ THE LEASE IS ALSO THE NEXT ATTEMPT TIME. If this worker dies, the row becomes eligible
         --    again exactly when the lease expires — one clock, not two that can disagree.
         next_attempt_at = now() + p_lease
   WHERE e.id IN (
     SELECT id FROM keystone.event
      WHERE tenant_id = keystone.current_tenant_id()
        -- ★ The budget, checked here as well as in the reaper, because the reaper only sees rows whose
        --   lease has expired — a row at max inside a live lease must still not be re-claimed.
        AND attempts < p_max_attempts
        -- ★★ THE BACKOFF GATE. Until this existed, `'failed'` was re-claimed instantly and five
        --    attempts burned in under a second.
        AND next_attempt_at <= now()
        AND (
              status IN ('pending', 'failed')
              -- ★★★ AND THIS LINE IS F4's FIX. An expired lease returns the event to the queue with
              --     no cooperation from the process that lost it — which is the whole point, because
              --     the process that lost it is dead and will never run another statement.
              OR (status = 'claimed' AND claimed_at < now() - p_lease)
            )
      ORDER BY created_at
      -- ★ SKIP LOCKED so two workers take DIFFERENT rows; plain FOR UPDATE makes the second wait and
      --   then reprocess what the first already took.
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit)
  RETURNING e.*;
END $$;

COMMENT ON FUNCTION keystone.claim_events(integer, interval, integer) IS
  'P18.6(a) — claim with a LEASE. Eligible = pending, or failed past its backoff, or a claim whose '
  'lease expired (F4). Reaps rows past p_max_attempts to dead WITH A REASON first. Runs as the caller '
  'under RLS on purpose: a worker may only ever claim its own tenant''s events.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · A DEAD ROW IS NEVER SILENT.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ `dead` with no `last_error` is a row that gave up and will not say why — the failure shape this
--    project keeps meeting, one table over. The reaper above always writes a reason; this makes it a
--    RULE rather than a habit of one function.
ALTER TABLE keystone.event
  ADD CONSTRAINT event_dead_states_its_reason
  CHECK (status <> 'dead' OR (last_error IS NOT NULL AND length(btrim(last_error)) > 0));
