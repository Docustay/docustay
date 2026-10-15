-- 0429_subscription_stripe_pause_dunning
-- Stage 15 task 15.6 — STAGE-15-PLAN.md §15.6.
--
-- Columns only, on three EXISTING tables (`subscription`, `payment_method`, `plan`) — no new table,
-- so CT-F52's new-table checklist does not apply: each already carries RLS/FORCE and tenant policies
-- (`subscription`/`payment_method`/`plan` all predate this migration), and a new column inherits the
-- table's existing app_rw grant automatically. No policy is added, changed or re-created here, and
-- RLS on these three tables is not touched.
--
-- `subscription` — what it needs to live on Stripe (stripe_subscription_id/stripe_price_id/
-- current_period_start), to be paused and resumed (paused_at/resume_on/pauses_used_year), to dun a
-- failing card (failed_attempts/first_failed_at/next_retry_at/failing_stripe_invoice_id), and to
-- remember who started it and on what terms (created_by_document_id/price_minor_override/
-- staff_note). `payment_method` gets card expiry (exp_month/exp_year), its kind, and when it was
-- detached. `plan` gets the per-plan pause allowance the pause writer (15.19-15.21) enforces against.
--
-- NOT TOUCHED: `subscription_requires_contract`, the `subscription_state_check` CHECK, every policy
-- on all three tables.
--
-- ★ `keystone.plan` real current columns were re-read against migration files on disk (Stage 14,
-- 0410, built the same night) before this migration was written: 0410 added `description`,
-- `billing_day`, `allow_client_pause`, `max_pauses_per_year`, `max_pause_months`, `dunning_retries`,
-- `dunning_days`, `dunning_pause_after` to `keystone.plan`. NEITHER of those is named
-- `pause_allowance_per_year` nor `pause_max_days` — no name collision with this migration's two new
-- `plan` columns, so this is a straight ADD COLUMN, not an overwrite. (The semantic overlap between
-- 0410's `max_pauses_per_year`/`max_pause_months` and this migration's `pause_allowance_per_year`/
-- `pause_max_days` is reported, not resolved, by this task — see the BUILD report.)
--
-- DATA: prod subscription/payment_method 0/0 rows, local 1/1 (EXECUTED counts, read before build) —
-- the local subscription row will read `failed_attempts = 0` (its DEFAULT) once this applies. `plan`
-- rows take their new columns' constant DEFAULTs; no UPDATE needed.

ALTER TABLE keystone.subscription
  ADD COLUMN stripe_subscription_id text NULL,
  ADD COLUMN stripe_price_id text NULL,
  ADD COLUMN current_period_start timestamptz NULL,
  ADD COLUMN paused_at timestamptz NULL,
  ADD COLUMN resume_on date NULL,
  ADD COLUMN pauses_used_year integer NOT NULL DEFAULT 0 CHECK (pauses_used_year >= 0),
  ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  ADD COLUMN first_failed_at timestamptz NULL,
  ADD COLUMN next_retry_at timestamptz NULL,
  ADD COLUMN failing_stripe_invoice_id text NULL,
  ADD COLUMN created_by_document_id uuid NULL
    REFERENCES keystone.document_instance(id) ON DELETE RESTRICT,
  ADD COLUMN price_minor_override integer NULL
    CHECK (price_minor_override IS NULL OR price_minor_override >= 0),
  ADD COLUMN staff_note text NULL
    CHECK (staff_note IS NULL OR char_length(staff_note) <= 1000);

CREATE UNIQUE INDEX subscription_stripe_id ON keystone.subscription (tenant_id, stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX subscription_retry_due ON keystone.subscription (tenant_id, next_retry_at)
  WHERE next_retry_at IS NOT NULL;

ALTER TABLE keystone.payment_method
  ADD COLUMN exp_month smallint NULL CHECK (exp_month IS NULL OR exp_month BETWEEN 1 AND 12),
  ADD COLUMN exp_year smallint NULL CHECK (exp_year IS NULL OR exp_year BETWEEN 2000 AND 2100),
  ADD COLUMN kind text NULL
    CHECK (kind IS NULL OR kind IN ('card', 'us_bank_account', 'link', 'other')),
  ADD COLUMN detached_at timestamptz NULL;

ALTER TABLE keystone.plan
  ADD COLUMN pause_allowance_per_year integer NOT NULL DEFAULT 2
    CHECK (pause_allowance_per_year BETWEEN 0 AND 12),
  ADD COLUMN pause_max_days integer NOT NULL DEFAULT 31
    CHECK (pause_max_days BETWEEN 1 AND 92);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CLOSING SELF-CHECK — POSITIVE ASSERTIONS ONLY (what SHOULD be true, not what should be
--     absent — 0409's inverted self-check is the measured warning this follows).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $prove$
DECLARE
  v_missing text;
BEGIN
  -- POSITIVE: every new column on all three tables exists, by name.
  SELECT string_agg(expected.table_name || '.' || expected.column_name, ', ') INTO v_missing
    FROM (VALUES
      ('subscription', 'stripe_subscription_id'), ('subscription', 'stripe_price_id'),
      ('subscription', 'current_period_start'), ('subscription', 'paused_at'),
      ('subscription', 'resume_on'), ('subscription', 'pauses_used_year'),
      ('subscription', 'failed_attempts'), ('subscription', 'first_failed_at'),
      ('subscription', 'next_retry_at'), ('subscription', 'failing_stripe_invoice_id'),
      ('subscription', 'created_by_document_id'), ('subscription', 'price_minor_override'),
      ('subscription', 'staff_note'),
      ('payment_method', 'exp_month'), ('payment_method', 'exp_year'),
      ('payment_method', 'kind'), ('payment_method', 'detached_at'),
      ('plan', 'pause_allowance_per_year'), ('plan', 'pause_max_days')
    ) AS expected(table_name, column_name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'keystone' AND c.table_name = expected.table_name
        AND c.column_name = expected.column_name
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0429: missing column(s): %', v_missing;
  END IF;

  -- POSITIVE: both new partial indexes exist, with the right predicate kept.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'keystone' AND tablename = 'subscription'
       AND indexname = 'subscription_stripe_id'
       AND indexdef LIKE '%WHERE (stripe_subscription_id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION '0429: subscription_stripe_id does not exist or lost its WHERE clause';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'keystone' AND tablename = 'subscription'
       AND indexname = 'subscription_retry_due'
       AND indexdef LIKE '%WHERE (next_retry_at IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION '0429: subscription_retry_due does not exist or lost its WHERE clause';
  END IF;

  -- POSITIVE: subscription_requires_contract and the state CHECK are untouched (still present).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_state_check'
  ) THEN
    RAISE EXCEPTION '0429: subscription_state_check is missing — this migration must not have touched it';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_requires_contract'
  ) THEN
    RAISE EXCEPTION '0429: subscription_requires_contract is missing — this migration must not have touched it';
  END IF;

  RAISE NOTICE '0429: all 19 new columns present (13 subscription, 4 payment_method, 2 plan); both partial indexes present with their WHERE clauses intact; subscription_state_check untouched.';
END
$prove$;

-- Written, not applied.
