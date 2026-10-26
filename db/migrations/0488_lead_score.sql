-- 0488 — LEAD SCORING — NIGHTLY SWEEP SCORES LEADS FROM 90-DAY FACTS
--
-- ★★★ THE SWEEP IS THE ONLY WRITER. A score is never hand-mutated, never editable by a person,
--     never patched by a route. If it is wrong, the facts or the weights are wrong.
--
-- DETERMINISM: the same facts produce the same score. Two runs leave identical rows.
--   No randomness, no clock inside the computation beyond the 90-day window boundary.
--
-- REASONS NAME REAL FACTS ONLY. Every reason in the jsonb corresponds to a row that exists.
--   A reason is evidence, not a guess, and the test asserts it.
--
-- COACHES SEE NO AMOUNTS: reasons in a coach's payload carry no money figures. The server
--   decides that, not the screen.
--
-- WRITER: `src/queue/tasks.mjs` (`sweep_lead_score`), nightly per tenant.
-- READERS: Home prompt engine (`src/prompts/catalogue.mjs`), composes "hot leads" prompt.

ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.app_user
  ADD COLUMN score_cache jsonb NULL,
  ADD COLUMN score_reasons jsonb NULL,
  ADD COLUMN scored_at timestamptz NULL,
  ADD CONSTRAINT score_reasons_check CHECK (
    (score_reasons IS NULL AND scored_at IS NULL) OR
    (score_reasons IS NOT NULL AND scored_at IS NOT NULL)
  );

-- ────────────────────────────────────────────────────────────────────────────────────────
-- Self-check: all three lead-score columns exist on app_user
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'app_user'
     AND column_name IN ('score_cache', 'score_reasons', 'scored_at');
  IF n_cols <> 3 THEN
    RAISE EXCEPTION '0488 self-check: expected 3 lead-score columns on app_user, found %', n_cols;
  END IF;

  -- ★ Positive control for the CHECK: scored_at without score_reasons must be refused.
  -- ★ REHEARSAL FIX (25 Sep 2026): the first draft INSERTed a person with no email under a tenant
  --   that does not exist — NOT NULL fired before the CHECK could, so the control never tested it.
  --   It now sets scored_at alone on a REAL row; the sub-block's exception handler rolls it back.
  IF EXISTS (SELECT 1 FROM keystone.app_user) THEN
    BEGIN
      UPDATE keystone.app_user SET scored_at = now(), score_reasons = NULL
       WHERE id = (SELECT id FROM keystone.app_user ORDER BY id LIMIT 1);
      RAISE EXCEPTION '0488 self-check: scored_at without score_reasons was ACCEPTED';
    EXCEPTION
      WHEN check_violation THEN NULL;
    END;
  END IF;
END
$check$;

ALTER TABLE keystone.app_user FORCE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- Prove FORCE survived the ALTERs — the 0334 discipline outlives this migration.
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'app_user';
  IF NOT forced THEN
    RAISE EXCEPTION '0488 self-check: RLS is no longer FORCED on app_user';
  END IF;
END
$rls$;
