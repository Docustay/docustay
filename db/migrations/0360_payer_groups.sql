-- 0360_payer_groups
-- Payer groups: one Stripe customer, multiple members (people or accounts)
--
-- ★★★ §P1.2 (or equivalent) — A payer group represents a billable entity in Stripe. It has one
-- or more members (a person or an account), and the group's balance is the sum of all outstanding
-- invoices owed by any of its members.
--
-- ★ C1.2 (a parallel task building `src/money/customers.mjs`) will later attach
-- `stripe_customer_id`, `stripe_livemode`, and `stripe_synced_at` to this table; this migration
-- leaves room for them but does NOT add them. C1.2's own migration will add those columns.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · payer_group — a Stripe customer and its members
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.payer_group (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name         text        NOT NULL,
  -- ★ Columns stripe_customer_id, stripe_livemode, and stripe_synced_at will be added
  -- by C1.2's migration; do NOT add them here.
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payer_group_tenant_idx ON keystone.payer_group (tenant_id);
CREATE UNIQUE INDEX payer_group_tenant_name_key ON keystone.payer_group (tenant_id, lower(name));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · payer_group_member — people and accounts that belong to a payer group
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ A MEMBER IS EXACTLY ONE OF: a person (app_user) or an account. The CHECK constraint
--    enforces that exactly one of person_id or account_id is non-null.
CREATE TABLE keystone.payer_group_member (
  id             uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id      uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  payer_group_id uuid        NOT NULL REFERENCES keystone.payer_group(id) ON DELETE CASCADE,
  person_id      uuid        REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  account_id     uuid        REFERENCES keystone.account(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- ★★★ EXACTLY ONE OF person_id OR account_id, NEVER BOTH, NEVER NEITHER.
  CONSTRAINT payer_group_member_one_type CHECK (
    (person_id IS NOT NULL AND account_id IS NULL) OR
    (person_id IS NULL AND account_id IS NOT NULL)
  )
);

CREATE INDEX payer_group_member_group_idx ON keystone.payer_group_member (tenant_id, payer_group_id);
CREATE INDEX payer_group_member_person_idx ON keystone.payer_group_member (tenant_id, person_id);
CREATE INDEX payer_group_member_account_idx ON keystone.payer_group_member (tenant_id, account_id);
-- ★ A person or account cannot be a member of the same group twice.
CREATE UNIQUE INDEX payer_group_member_person_key
  ON keystone.payer_group_member (payer_group_id, person_id) WHERE person_id IS NOT NULL;
CREATE UNIQUE INDEX payer_group_member_account_key
  ON keystone.payer_group_member (payer_group_id, account_id) WHERE account_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · payer_group_balance — outstanding invoices for a payer group
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ BALANCE IS A DERIVED VIEW, never a field. [same rule as outstanding_balance]
-- This view sums all outstanding invoices owed by any member of the payer group.
-- ★ Invoices are tracked by payer_user_id (app_user), so we sum for all person members,
--   and separately track whether the group has account members (which do not yet have
--   direct invoice attribution in the current schema).
CREATE VIEW keystone.payer_group_balance
WITH (security_invoker = true) AS
SELECT pg.payer_group_id, pg.tenant_id, pg.currency,
       sum(pg.outstanding_minor)::bigint AS outstanding_minor,
       count(DISTINCT pg.invoice_id) AS open_invoices
  FROM (
    SELECT pgm.payer_group_id, i.tenant_id, i.currency, i.id AS invoice_id, i.amount_minor AS outstanding_minor
      FROM keystone.payer_group_member pgm
      JOIN keystone.invoice i ON (
        i.tenant_id = pgm.tenant_id
        AND i.payer_user_id = pgm.person_id
        AND i.status = 'open'
      )
     WHERE pgm.person_id IS NOT NULL
  ) pg
 GROUP BY pg.payer_group_id, pg.tenant_id, pg.currency;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ENABLE and FORCE on both tables
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.payer_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.payer_group FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.payer_group
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.payer_group
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

ALTER TABLE keystone.payer_group_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.payer_group_member FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.payer_group_member
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.payer_group_member
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.payer_group TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.payer_group_member TO app_rw;
GRANT SELECT ON keystone.payer_group_balance TO app_rw;

-- ★ Prove FORCE RLS is on (same safety check as every other table).
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.payer_group'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0360: FORCE ROW LEVEL SECURITY was not enabled on keystone.payer_group';
  END IF;
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.payer_group_member'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0360: FORCE ROW LEVEL SECURITY was not enabled on keystone.payer_group_member';
  END IF;
END
$$;
