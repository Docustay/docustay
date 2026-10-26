-- 0425_payment_method_fees_and_payout
-- Stage 15 task 15.7 — STAGE-15-PLAN.md §15.7.
--
-- Columns only, on the EXISTING `keystone.payment` table — no new table, so CT-F52's new-table
-- checklist does not apply: `payment` already carries FORCE RLS and its tenant policies (0196), and
-- a new column inherits the table's existing app_rw grant automatically. No policy is added, changed
-- or re-created here, and RLS on `payment` is not touched. The `payment_status_check` CHECK is NOT
-- touched — `p2_money_vocabulary.mjs` asserts it in both directions.
--
-- A payment row can now say it was manual (provider/method/received_at/recorded_by/note), what
-- Stripe and Mainstay each took (application_fee_minor/stripe_fee_minor/net_minor), the card that
-- paid it (card_brand/card_last_four/stripe_charge_id), and which payout carried it
-- (available_on/payout_id/fees_mirrored_at/refunded_minor/risk_score/checks).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ `payment_manual_shape` HAS THREE ARMS, NOT TWO. THE THIRD IS NOT A WIDENED SECOND.
--   provider='stripe'     — unconstrained (the mirror-from-webhook path).
--   provider='manual'     — provider_payment_id IS NULL AND recorded_by IS NOT NULL AND
--                            method IN ('cash','cheque','transfer','other') AND received_at IS NOT NULL.
--                            A STAFF MEMBER typed this in; `recorded_by` IS the audit line.
--   provider='gift_card'  — provider_payment_id IS NULL AND method='gift_card' AND
--                            received_at IS NOT NULL, and it takes NO `recorded_by` — nobody typed it
--                            in, the client presented a code (15.67, CT-F41, D25: a gift-card
--                            redemption is money leaving a stored balance and closing an invoice, one
--                            ledger, not two).
--   Widening the `manual` arm to also cover gift cards would let a STAFF-RECORDED CASH PAYMENT
--   through with NO `recorded_by` — the exact audit hole this CHECK exists to close. Three arms, as
--   written; do not collapse them.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- ★★ 0425 REPEATS 0423's `payment (tenant_id, id)` UNIQUE INDEX, IDEMPOTENTLY, AS ITS OPENING
--    STATEMENT (N5, 25 Sep). 0423 is its first creator (the stage's first migration; see 0423 and
--    15.1's field 6). This copy is `IF NOT EXISTS` and a no-op on a normal run — kept, not deleted,
--    because 0425 adds `payment_recorded_by_fk`, a composite FK of its own, and every migration in
--    this stage that depends on a composite index on `payment` states that dependency rather than
--    inheriting it silently from an earlier file a reader may not have opened. Byte-identical to
--    0423's and 0436's statement.
--
-- DATA: `payment` has 0 rows in production and 0 locally (EXECUTED read-only) — the new NOT NULL
-- DEFAULT column, the new CHECK and the new FK all validate trivially against an empty table.

CREATE UNIQUE INDEX IF NOT EXISTS payment_tenant_id_id_key
  ON keystone.payment (tenant_id, id);

ALTER TABLE keystone.payment
  ADD COLUMN provider text NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'manual', 'gift_card')),
  ADD COLUMN method text NULL
    CHECK (method IS NULL OR method IN
      ('card', 'card_present', 'bank', 'link', 'wallet', 'cash', 'cheque', 'transfer', 'gift_card', 'other')),
  ADD COLUMN received_at timestamptz NULL,
  ADD COLUMN recorded_by uuid NULL,
  ADD COLUMN note text NULL CHECK (note IS NULL OR char_length(note) <= 500),
  ADD COLUMN application_fee_minor integer NULL
    CHECK (application_fee_minor IS NULL OR application_fee_minor >= 0),
  ADD COLUMN stripe_fee_minor integer NULL
    CHECK (stripe_fee_minor IS NULL OR stripe_fee_minor >= 0),
  ADD COLUMN net_minor integer NULL,
  ADD COLUMN card_brand text NULL,
  ADD COLUMN card_last_four text NULL
    CHECK (card_last_four IS NULL OR card_last_four ~ '^[0-9]{4}$'),
  ADD COLUMN stripe_charge_id text NULL,
  ADD COLUMN available_on date NULL,
  ADD COLUMN payout_id uuid NULL REFERENCES keystone.payout(id) ON DELETE SET NULL,
  ADD COLUMN fees_mirrored_at timestamptz NULL,
  ADD COLUMN refunded_minor integer NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  ADD COLUMN risk_score smallint NULL CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  ADD COLUMN checks jsonb NULL,
  ADD CONSTRAINT payment_recorded_by_fk FOREIGN KEY (tenant_id, recorded_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (recorded_by),
  ADD CONSTRAINT payment_manual_shape CHECK (
    provider = 'stripe'
    OR (provider = 'manual' AND provider_payment_id IS NULL AND
        recorded_by IS NOT NULL AND method IN ('cash', 'cheque', 'transfer', 'other') AND
        received_at IS NOT NULL)
    OR (provider = 'gift_card' AND provider_payment_id IS NULL AND method = 'gift_card'
        AND received_at IS NOT NULL)
  );

CREATE INDEX payment_fees_pending ON keystone.payment (tenant_id)
  WHERE provider = 'stripe' AND fees_mirrored_at IS NULL;

CREATE INDEX payment_payout ON keystone.payment (tenant_id, payout_id)
  WHERE payout_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CLOSING SELF-CHECK — POSITIVE ASSERTIONS ONLY (what SHOULD be true, not what should be
--     absent — 0409's inverted self-check is the measured warning this follows).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $prove$
DECLARE
  v_missing text;
BEGIN
  -- POSITIVE: the composite unique index exists (kept, whether created here or by 0423 first).
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'payment_tenant_id_id_key' AND i.indisunique
  ) THEN
    RAISE EXCEPTION '0425: payment_tenant_id_id_key does not exist or is not UNIQUE';
  END IF;

  -- POSITIVE: every new column exists, by name.
  SELECT string_agg(expected.column_name, ', ') INTO v_missing
    FROM (VALUES
      ('provider'), ('method'), ('received_at'), ('recorded_by'), ('note'),
      ('application_fee_minor'), ('stripe_fee_minor'), ('net_minor'), ('card_brand'),
      ('card_last_four'), ('stripe_charge_id'), ('available_on'), ('payout_id'),
      ('fees_mirrored_at'), ('refunded_minor'), ('risk_score'), ('checks')
    ) AS expected(column_name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'keystone' AND c.table_name = 'payment'
        AND c.column_name = expected.column_name
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0425: missing column(s) on keystone.payment: %', v_missing;
  END IF;

  -- POSITIVE: both new named constraints exist.
  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('payment_recorded_by_fk', 'payment_manual_shape')) <> 2 THEN
    RAISE EXCEPTION '0425: payment_recorded_by_fk and/or payment_manual_shape did not get created';
  END IF;

  -- POSITIVE: both new indexes exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'keystone' AND tablename = 'payment'
      AND indexname = 'payment_fees_pending'
  ) THEN
    RAISE EXCEPTION '0425: payment_fees_pending does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'keystone' AND tablename = 'payment'
      AND indexname = 'payment_payout'
  ) THEN
    RAISE EXCEPTION '0425: payment_payout does not exist';
  END IF;

  -- POSITIVE: the status CHECK (payment_status_check, `p2_money_vocabulary.mjs`'s target) is
  -- untouched (still present) — this migration adds `provider`/`method`, it does not touch `status`.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_status_check'
  ) THEN
    RAISE EXCEPTION '0425: payment_status_check is missing — this migration must not have touched it';
  END IF;

  RAISE NOTICE '0425: all 17 new payment columns present; payment_recorded_by_fk and payment_manual_shape (three arms) present; payment_fees_pending and payment_payout present; payment_status_check untouched.';
END
$prove$;

-- Written, not applied.
