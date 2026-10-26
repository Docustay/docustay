-- 0352_refund_payout_dispute_tables
-- Stripe webhook data: refund, payout, and dispute tables.
--
-- ★★ WEBHOOK IDEMPOTENCY via stripe_id. A webhook can be redelivered; ON CONFLICT on
--    stripe_id ensures an upsert rather than duplicate rows. Each table tracks the state
--    and amount for webhook handlers (B1.4) to persist Stripe events.
--
-- ★ TENANT-SCOPED WITH FORCE ROW LEVEL SECURITY, following every other table in the schema.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · REFUND — a refund of a payment, tracked by Stripe refund id
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ★★★ FIX (coordinator, deploy checkpoint, 24 Sep 2026) — MEASURED against the deployed database
--   before writing this: `keystone.refund` ALREADY EXISTED (migration 0015), a simpler pre-Stripe
--   table (id, tenant_id, payment_id, amount_minor, reason, provider_refund_id, created_at) that
--   this migration's CREATE TABLE collided with on first apply attempt. EXECUTED checks before this
--   fix: `SELECT count(*) FROM keystone.refund` → 0 (empty, no data to lose); `grep -rl
--   "provider_refund_id|refund_payment\b" src/ db/` → only 0015 itself, nothing in the live
--   application reads the old shape; `grep -n "charge.refunded" src/payments/webhook.mjs` → the
--   ONLY handler already writes the NEW shape (stripe_id/state), built by B1.4 the same night — the
--   old table was genuinely dead, not in active use. Safe to retire: DROP before CREATE, through
--   the migration runner, per this project's own "migrations only, through the runner" hard rule.
DROP TABLE IF EXISTS keystone.refund CASCADE;

CREATE TABLE keystone.refund (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  stripe_id    text        NOT NULL,
  amount_minor integer     NOT NULL CHECK (amount_minor >= 0),
  state        text        NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX refund_stripe_id ON keystone.refund (tenant_id, stripe_id);
CREATE INDEX refund_tenant_idx ON keystone.refund (tenant_id);

ALTER TABLE keystone.refund ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.refund FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.refund
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.refund
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.refund TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · PAYOUT — a payout to a connected account, tracked by Stripe payout id
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE keystone.payout (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  stripe_id    text        NOT NULL,
  amount_minor integer     NOT NULL CHECK (amount_minor >= 0),
  state        text        NOT NULL CHECK (state IN ('pending', 'in_transit', 'paid', 'failed', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX payout_stripe_id ON keystone.payout (tenant_id, stripe_id);
CREATE INDEX payout_tenant_idx ON keystone.payout (tenant_id);

ALTER TABLE keystone.payout ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.payout FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.payout
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.payout
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.payout TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · DISPUTE — a chargeback or dispute, tracked by Stripe dispute id
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE keystone.dispute (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  stripe_id    text        NOT NULL,
  amount_minor integer     NOT NULL CHECK (amount_minor >= 0),
  state        text        NOT NULL CHECK (state IN ('warning_under_review', 'under_review', 'evidence_submitted', 'won', 'lost')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX dispute_stripe_id ON keystone.dispute (tenant_id, stripe_id);
CREATE INDEX dispute_tenant_idx ON keystone.dispute (tenant_id);

ALTER TABLE keystone.dispute ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.dispute FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.dispute
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.dispute
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.dispute TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: Verify FORCE is on for all three tables
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.refund'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0352: FORCE ROW LEVEL SECURITY was not enabled on keystone.refund';
  END IF;

  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.payout'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0352: FORCE ROW LEVEL SECURITY was not enabled on keystone.payout';
  END IF;

  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.dispute'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0352: FORCE ROW LEVEL SECURITY was not enabled on keystone.dispute';
  END IF;
END
$$;
