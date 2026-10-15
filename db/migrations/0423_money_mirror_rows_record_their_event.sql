-- 0423_money_mirror_rows_record_their_event
-- Stage 15 (F08), task 15.1 — STAGE-15-PLAN.md §15.1.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS REPAIRS: `src/payments/webhook.mjs`'s five refund/payout/dispute handlers already
--     write `external_event_id` — a column that DOES NOT EXIST on `keystone.refund`, `keystone.payout`
--     or `keystone.dispute` (0352 created all three WITHOUT it; MEASURED, grepped every migration).
--     This migration adds it, plus the detail columns the screens need, and gives the conflict arm a
--     WHERE clause so `ins.rowCount === 0` — previously UNREACHABLE, because `ON CONFLICT … DO UPDATE
--     … RETURNING id` returns a row on both the insert path and the update path — finally means what
--     the code around it has always claimed: a genuine replay writes nothing and emits nothing, and a
--     LATER event about the same object still updates and emits once.
--
-- ★★★ 0423 IS THE STAGE'S FIRST MIGRATION AND IT CREATES THE `payment (tenant_id, id)` UNIQUE INDEX,
--     AS ITS OPENING STATEMENT (N5, 25 Sep 2026, STAGE-15-PLAN.md §15.1).
--   MEASURED 25 Sep: `keystone.app_user`, `keystone.booking` and `keystone.invoice` each carry
--   `(tenant_id, id)` UNIQUE, but `keystone.payment` does not — its only unique indexes are
--   `payment_pkey (id)` and `payment_provider_id (tenant_id, provider_payment_id)`
--   (`0015_prices_snapshots_entitlements.sql:295`), plus non-unique `payment_invoice` (`:297`). FOUR
--   Stage-15 migrations reference `keystone.payment` — 0423 (twice), 0434 and 0436 — and without this
--   index a COMPOSITE FK is not creatable against it. Creating the index here, first, is what lets
--   every one of them be composite.
--   ★ COMPOSITE IS NOT COSMETIC: a single-column `REFERENCES keystone.payment(id)` lets a `refund` or
--     `dispute` row in tenant A point at a payment in tenant B, and on a FORCE-RLS schema that is a
--     tenant hole. `IF NOT EXISTS` so the later copies in 0425/0436 are no-ops and no ordering or
--     partial apply can fail.
--   DATA for this statement: `payment` — 0 rows production, 0 local (EXECUTED read-only, M13), so it
--   builds on an empty table and cannot find a duplicate.
--
-- ★ NO NEW TABLE. Every column added below lands on `keystone.refund`/`payout`/`dispute`, all three
--   already `ENABLE`d **and** `FORCE`d (`0352_refund_payout_dispute_tables.sql`) with
--   `tenant_isolation`/`tenant_insert` policies keyed on `keystone.current_tenant_id()` — the FORCED
--   policies already cover new columns on an existing table, so CT-F52's new-table checklist does not
--   apply here and no grant changes (`app_rw` already holds SELECT/INSERT/UPDATE on all three,
--   `0352…sql:46,70,94`).
--
-- DATA: prod refund/payout/dispute 0/0/0 rows, local 0/0/0 (EXECUTED) — no backfill needed.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · THE `payment (tenant_id, id)` UNIQUE INDEX — MUST COME FIRST ──────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS payment_tenant_id_id_key
  ON keystone.payment (tenant_id, id);

-- ── 2 · `keystone.refund` — the columns the webhook handler and the screens need ───────────────────
ALTER TABLE keystone.refund
  ADD COLUMN external_event_id text NULL,
  ADD COLUMN stripe_charge_id  text NULL,
  ADD COLUMN payment_id        uuid NULL,
  ADD CONSTRAINT refund_payment_fk FOREIGN KEY (tenant_id, payment_id)
    REFERENCES keystone.payment(tenant_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX refund_external_event_id ON keystone.refund (tenant_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- ── 3 · `keystone.payout` — the columns the webhook handler and the screens need ───────────────────
ALTER TABLE keystone.payout
  ADD COLUMN external_event_id     text NULL,
  ADD COLUMN arrival_date          date NULL,
  ADD COLUMN statement_descriptor text NULL,
  ADD COLUMN failure_message      text NULL,
  ADD COLUMN method                text NULL
    CHECK (method IS NULL OR method IN ('standard','instant')),
  ADD COLUMN bank_name             text NULL,
  ADD COLUMN bank_last4            text NULL
    CHECK (bank_last4 IS NULL OR bank_last4 ~ '^[0-9]{4}$'),
  ADD COLUMN fee_minor             integer NULL
    CHECK (fee_minor IS NULL OR fee_minor >= 0),
  ADD COLUMN itemised_at           timestamptz NULL;

CREATE UNIQUE INDEX payout_external_event_id ON keystone.payout (tenant_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- ── 4 · `keystone.dispute` — the columns the webhook handler and the screens need ──────────────────
ALTER TABLE keystone.dispute
  ADD COLUMN external_event_id     text NULL,
  ADD COLUMN stripe_charge_id      text NULL,
  ADD COLUMN reason                text NULL,
  ADD COLUMN evidence_due_by       timestamptz NULL,
  ADD COLUMN evidence_submitted_at timestamptz NULL,
  ADD COLUMN payment_id            uuid NULL,
  ADD COLUMN fee_minor             integer NULL
    CHECK (fee_minor IS NULL OR fee_minor >= 0),
  ADD CONSTRAINT dispute_payment_fk FOREIGN KEY (tenant_id, payment_id)
    REFERENCES keystone.payment(tenant_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX dispute_external_event_id ON keystone.dispute (tenant_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CLOSING SELF-CHECK — POSITIVE ASSERTIONS ONLY (what SHOULD be true, not what should be
--     absent — 0409's inverted self-check is the measured warning this follows).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $prove$
DECLARE
  v_missing_cols text;
BEGIN
  -- POSITIVE: the new `payment (tenant_id, id)` unique index exists and is UNIQUE.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'payment_tenant_id_id_key' AND i.indisunique
  ) THEN
    RAISE EXCEPTION '0423: payment_tenant_id_id_key does not exist or is not UNIQUE';
  END IF;

  -- POSITIVE: every new column on all three tables exists, by name.
  SELECT string_agg(expected.col, ', ') INTO v_missing_cols
    FROM (VALUES
      ('refund',  'external_event_id'), ('refund',  'stripe_charge_id'), ('refund',  'payment_id'),
      ('payout',  'external_event_id'), ('payout',  'arrival_date'), ('payout',  'statement_descriptor'),
      ('payout',  'failure_message'), ('payout',  'method'), ('payout',  'bank_name'),
      ('payout',  'bank_last4'), ('payout',  'fee_minor'), ('payout',  'itemised_at'),
      ('dispute', 'external_event_id'), ('dispute', 'stripe_charge_id'), ('dispute', 'reason'),
      ('dispute', 'evidence_due_by'), ('dispute', 'evidence_submitted_at'), ('dispute', 'payment_id'),
      ('dispute', 'fee_minor')
    ) AS expected(tbl, col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'keystone' AND table_name = expected.tbl AND column_name = expected.col
   );
  IF v_missing_cols IS NOT NULL THEN
    RAISE EXCEPTION '0423: missing expected column(s): %', v_missing_cols;
  END IF;

  -- POSITIVE: FORCE ROW LEVEL SECURITY is still on for all three tables (unchanged by this migration,
  -- proved rather than assumed).
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.refund'::regclass) THEN
    RAISE EXCEPTION '0423: FORCE ROW LEVEL SECURITY is not enabled on keystone.refund';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.payout'::regclass) THEN
    RAISE EXCEPTION '0423: FORCE ROW LEVEL SECURITY is not enabled on keystone.payout';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.dispute'::regclass) THEN
    RAISE EXCEPTION '0423: FORCE ROW LEVEL SECURITY is not enabled on keystone.dispute';
  END IF;

  RAISE NOTICE '0423: payment_tenant_id_id_key present and UNIQUE; refund/payout/dispute carry every new column; FORCE RLS intact on all three.';
END
$prove$;
