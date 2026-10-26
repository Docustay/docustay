-- ★★★ STAGE 4 TASK 3, FIX ROUND 1 — F513, SCOPED TO 'worker' ONLY (review's own recommended smallest fix).
--     [MEASURED, local, 18 Sep 2026] keystone_meta.alert_transition()'s `SELECT ... FOR UPDATE` (0128)
--     locks only a row that ALREADY EXISTS. Two callers racing to write the very FIRST-EVER row for a
--     key both take the `NOT FOUND` branch and both attempt the INSERT; the loser raises
--     `duplicate key value violates unique constraint "alert_state_pkey"` instead of resolving to
--     'quiet'. Reproduced live in test/s4_app_watches_worker.test.mjs with two real connections calling
--     worker_alert_transition('problem', 60) concurrently against an empty alert_state (FINDINGS.md F513).
--
-- ★★ THE FIX SHARED 0128 CODE (alert_transition itself) IS NOT TOUCHED HERE — it is reused by every
--    other IMMEDIATE_KEYS check (outbox, queue, backup, restore, stripe_webhooks, n8n, app, database)
--    and widening its own INSERT to `ON CONFLICT (key) DO UPDATE` is a separate, bigger task someone
--    else owns next (see FINDINGS.md F513's FIX note). This migration closes the race for 'worker'
--    alone, the cheapest possible fix scoped to the one key this task actually introduced:
--    SEED THE ROW ONCE, so the 'worker' key can never again be a "first-ever row" race target. Once
--    this row exists, `FOR UPDATE` genuinely IS the lock the header of 0146/0128 already claims it is.
--
-- ★ Why the other IMMEDIATE_KEYS don't need the same seed here: every one of them is written ONLY by
--   watch_system (src/queue/tasks.mjs), which runs as a single job inside the worker process — there is
--   never more than one concurrent caller for 'app'/'database'/'outbox'/'queue'/'backup'/'restore'/
--   'stripe_webhooks'/'n8n' at once, so their first-ever row can never race. 'worker' is the only key
--   with a genuine multi-caller path (every keystone-app replica ticks it independently, 07 §6), which
--   is exactly why Stage 4 Task 3 introduced it and exactly why it alone needs this seed.
--
-- ★ ON CONFLICT (key) DO NOTHING, not a plain INSERT: this migration must be safe to write against a
--   database where 'worker' already has a real row (any local database that already ran 0146's own
--   functional DO $$ block, or any environment where the worker's own watch_system tick already wrote
--   one) — it must never overwrite a real state/last_sent_at/changed_at with a fresh 'ok' baseline.
INSERT INTO keystone_meta.alert_state (key, state, last_sent_at, changed_at)
VALUES ('worker', 'ok', NULL, now())
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM keystone_meta.alert_state WHERE key = 'worker') THEN
    RAISE EXCEPTION '0148: the worker alert_state row was not seeded';
  END IF;
END $$;
