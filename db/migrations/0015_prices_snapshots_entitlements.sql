-- 0015_prices_snapshots_entitlements
-- P8.2–P8.6, P8.8, P8.9 — §Z4's tables, and the three rules that make them worth having.
--
-- ══ ★★ THIS MIGRATION CORRECTS EARLIER PHASES, DELIBERATELY ═══════════════
-- P5.7 (migration 0009) put `price_minor` directly on `service`, `package` and `plan`. §Z4 is
-- explicit that this is wrong: **"`service` … ★ DEFINITION ONLY — NO PRICE ON IT"**, with a
-- separate `price` table as the PricebookEntry equivalent.
-- ★ The earlier shape was not unreasonable — it is what every simple catalogue does — but it
-- cannot express two things §Z requires: a price with EFFECTIVE DATES, and a thing that is
-- defined but NOT CURRENTLY SELLABLE. [DOC, Z0.1] "A product is sellable only when Product2 is
-- active AND an active PricebookEntry exists." Those are different facts and they need two rows.
-- ★★ Expand/contract: the price columns are COPIED into `price` here and left in place. They are
-- dropped in a later contract migration, once nothing reads them — never in the same migration
-- that stops writing them.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · price — the PricebookEntry equivalent
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.price (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- ★ Points at a service, a package or a plan. A polymorphic parent is used rather than three
  -- near-identical tables because the QUESTION ("what does this cost today?") is the same for
  -- all three, and three tables would mean three places to get effective dating wrong.
  subject_type  text        NOT NULL CHECK (subject_type IN ('service','package','plan')),
  subject_id    uuid        NOT NULL,
  amount_minor  integer     NOT NULL CHECK (amount_minor >= 0),
  currency      text        NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- ★★ EFFECTIVE DATES ARE THE POINT. Raising a price is a NEW ROW, not an UPDATE — which is
  -- what makes §Z6 check 1 ("raise a price, assert history unchanged") possible at all.
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_window_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX price_lookup ON keystone.price (tenant_id, subject_type, subject_id, effective_from DESC);

COMMENT ON TABLE keystone.price IS
  '§Z4 — the PricebookEntry equivalent. ★ A thing is SELLABLE only when its definition is active AND an active price row exists. Raising a price is a NEW ROW.';

-- ★ "What does this cost right now?" — one implementation, so effective dating cannot be got
-- right in one caller and wrong in another.
CREATE OR REPLACE FUNCTION keystone.current_price(
  p_subject_type text, p_subject_id uuid, p_at timestamptz DEFAULT now()
) RETURNS TABLE (amount_minor integer, currency text, price_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT p.amount_minor, p.currency, p.id
    FROM keystone.price p
   WHERE p.tenant_id = keystone.current_tenant_id()
     AND p.subject_type = p_subject_type
     AND p.subject_id   = p_subject_id
     AND p.active
     AND p.effective_from <= p_at
     AND (p.effective_to IS NULL OR p.effective_to > p_at)
   ORDER BY p.effective_from DESC
   LIMIT 1
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · contracted_price — a PER-ACCOUNT override that does NOT fork the plan
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ [DOC, Z1.9] "Contracted prices are a PER-ACCOUNT override of regular price." A Run tier gets
-- a negotiated rate for one account WITHOUT duplicating the plan — because a forked plan drifts:
-- the next feature is added to one copy and not the other.
CREATE TABLE keystone.contracted_price (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  account_id    uuid        REFERENCES keystone.account(id) ON DELETE CASCADE,
  app_user_id   uuid        REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  subject_type  text        NOT NULL CHECK (subject_type IN ('service','package','plan')),
  subject_id    uuid        NOT NULL,
  amount_minor  integer     NOT NULL CHECK (amount_minor >= 0),
  currency      text        NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- ★ An override belongs to exactly one party. "Both or neither" is not a negotiated rate,
  -- it is an ambiguity about who the rate is for.
  CONSTRAINT contracted_price_one_party CHECK (
    (account_id IS NOT NULL AND app_user_id IS NULL) OR
    (account_id IS NULL AND app_user_id IS NOT NULL)
  ),
  CONSTRAINT contracted_window_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX contracted_price_lookup
  ON keystone.contracted_price (tenant_id, subject_type, subject_id, account_id, app_user_id);

-- ★★ §Z5 P1: "resolve price: contracted_price if one exists, ELSE the active price row."
-- ★ One function, so the precedence is stated once.
CREATE OR REPLACE FUNCTION keystone.resolve_price(
  p_subject_type text, p_subject_id uuid,
  p_account_id uuid DEFAULT NULL, p_app_user_id uuid DEFAULT NULL,
  p_at timestamptz DEFAULT now()
) RETURNS TABLE (amount_minor integer, currency text, source text, source_id uuid)
LANGUAGE plpgsql STABLE AS $$
DECLARE r record;
BEGIN
  SELECT cp.amount_minor, cp.currency, cp.id INTO r
    FROM keystone.contracted_price cp
   WHERE cp.tenant_id = keystone.current_tenant_id()
     AND cp.subject_type = p_subject_type
     AND cp.subject_id   = p_subject_id
     AND (  (p_account_id  IS NOT NULL AND cp.account_id  = p_account_id)
         OR (p_app_user_id IS NOT NULL AND cp.app_user_id = p_app_user_id))
     AND cp.effective_from <= p_at
     AND (cp.effective_to IS NULL OR cp.effective_to > p_at)
   -- ★ A PERSON's rate beats an ACCOUNT's. The more specific party wins; the alternative is a
   -- negotiated individual rate silently overridden by their employer's.
   ORDER BY (cp.app_user_id IS NOT NULL) DESC, cp.effective_from DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT r.amount_minor, r.currency, 'contracted'::text, r.id;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT cp2.amount_minor, cp2.currency, 'list'::text, cp2.price_id
      FROM keystone.current_price(p_subject_type, p_subject_id, p_at) cp2;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · ★★★ line_item — THE SNAPSHOT. ONE PARENT, NEVER SHARED.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ [DOC, Z3.14-15] HubSpot's documented trap: "deleting a quote deletes its line items, and
-- if those line items are associated with a deal, THE DEAL'S LINE ITEMS ARE DELETED TOO."
-- ★★ So: **NEVER SHARE A LINE ITEM ROW ACROSS TWO PARENTS. COPY IT.** A booking's line item, an
-- invoice's and a contract's are THREE ROWS, even when every field is identical. The single
-- `parent_type`/`parent_id` pair makes sharing unrepresentable — there is nowhere to put a
-- second parent.
CREATE TABLE keystone.line_item (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  parent_type   text        NOT NULL CHECK (parent_type IN ('booking','invoice','contract','quote')),
  parent_id     uuid        NOT NULL,

  -- ★ What it CAME FROM, for traceability — NOT what it reads at render time.
  source_type   text        NOT NULL CHECK (source_type IN ('service','package','plan')),
  source_id     uuid        NOT NULL,

  -- ★★★ THE SNAPSHOT. [DOC, Z0.2] "PRICE IS NEVER READ LIVE AT TRANSACTION TIME."
  -- These columns are copies, taken once, and NOTHING updates them afterwards. Changing the
  -- catalogue must not rewrite an executed document, an open invoice or an active subscription
  -- — §Z6 check 1 exists precisely to prove that.
  name_snapshot      text    NOT NULL,
  unit_amount_minor  integer NOT NULL CHECK (unit_amount_minor >= 0),
  quantity           integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  discount_minor     integer NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor          integer NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  currency           text    NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- ★ Which price row it was taken from, so "why did this cost that?" is answerable years later.
  price_id           uuid    REFERENCES keystone.price(id) ON DELETE SET NULL,
  contracted_price_id uuid   REFERENCES keystone.contracted_price(id) ON DELETE SET NULL,

  -- ★ §Z5 P1: an unpaid hold marks the line item VOID. ★★ NEVER DELETE IT — a deleted line item
  -- cannot explain why a slot was held and released.
  status        text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','void','refunded')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX line_item_parent ON keystone.line_item (tenant_id, parent_type, parent_id);
CREATE INDEX line_item_source ON keystone.line_item (tenant_id, source_type, source_id);

COMMENT ON TABLE keystone.line_item IS
  '§Z4/§Z3.15 — a transaction SNAPSHOT with EXACTLY ONE parent. Never shared, always copied: HubSpot documents that sharing one across a quote and a deal makes deleting the quote delete the deal''s line items.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · entitlement + entitlement_credit — THE ASSET and the QUANTITY SCHEDULE
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ [DOC, Z1.6-8] Salesforce separates a QUANTITY schedule (when it is DELIVERED) from a
-- REVENUE schedule (when it is PAID FOR) — a magazine billed annually and delivered monthly.
-- ★★ "THAT IS OUR PACKAGE, EXACTLY. The credit rows ARE the quantity schedule; the single
-- payment IS the revenue schedule." And Z1.8: **the balance is an ASSET, not a counter on an
-- invoice** — the customer's contracted state, which outlives the invoice that created it.
CREATE TABLE keystone.entitlement (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  owner_user_id uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  -- ★ The line item that CREATED it — the bridge from revenue to quantity, kept as a row
  -- reference so the asset can always name the transaction that bought it.
  line_item_id  uuid        REFERENCES keystone.line_item(id) ON DELETE RESTRICT,
  service_id    uuid        NOT NULL REFERENCES keystone.service(id) ON DELETE RESTRICT,
  total_credits integer     NOT NULL CHECK (total_credits > 0),
  expires_at    timestamptz,
  status        text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','exhausted','expired','refunded')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entitlement_owner ON keystone.entitlement (tenant_id, owner_user_id, status);

CREATE TABLE keystone.entitlement_credit (
  id             uuid       PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id      uuid       NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  entitlement_id uuid       NOT NULL REFERENCES keystone.entitlement(id) ON DELETE CASCADE,
  -- ★★★ §Z5 P2's four states, exactly. `reserved` matters: a requested-but-unconfirmed booking
  -- must hold the credit without consuming it, or two bookings take the same one.
  status         text       NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available','reserved','consumed','returned')),
  booking_id     uuid       REFERENCES keystone.booking(id) ON DELETE RESTRICT,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- ★ `available` and `returned` hold no booking; `reserved` and `consumed` must.
  CONSTRAINT credit_state_shape CHECK (
    (status IN ('available','returned') AND booking_id IS NULL AND consumed_at IS NULL) OR
    (status = 'reserved' AND booking_id IS NOT NULL AND consumed_at IS NULL) OR
    (status = 'consumed' AND booking_id IS NOT NULL AND consumed_at IS NOT NULL)
  ),
  -- ★★ ONE CREDIT PER BOOKING. What makes "returns EXACTLY once" provable rather than hoped for.
  CONSTRAINT credit_one_per_booking UNIQUE (tenant_id, booking_id)
);
CREATE INDEX entitlement_credit_available
  ON keystone.entitlement_credit (tenant_id, entitlement_id) WHERE status = 'available';

COMMENT ON TABLE keystone.entitlement_credit IS
  '§Z4/§Z1.7 — ★★★ ONE ROW PER CREDIT. This is the QUANTITY schedule; the single payment that bought it is the REVENUE schedule. §Z5: cancellation is ASSERTED ON THE ROW, NOT A COUNT.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · invoice — ★★ SCOPED TO ITS PERIOD. NEVER A RUNNING BALANCE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.invoice (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  payer_user_id uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  -- ★★ [DOC, Z2.11] "Each invoice amount stays specific to its period rather than showing a
  -- running balance." Square keeps invoicing while a subscription is ACTIVE regardless of
  -- whether previous invoices were paid.
  period_start  timestamptz,
  period_end    timestamptz,
  amount_minor  integer     NOT NULL CHECK (amount_minor >= 0),
  currency      text        NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status        text        NOT NULL DEFAULT 'open'
                  CHECK (status IN ('draft','open','paid','void','uncollectible')),
  provider_invoice_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_period_ordered CHECK (
    period_end IS NULL OR period_start IS NULL OR period_end > period_start)
);
CREATE INDEX invoice_payer ON keystone.invoice (tenant_id, payer_user_id, period_start);
CREATE UNIQUE INDEX invoice_provider_id ON keystone.invoice (tenant_id, provider_invoice_id)
  WHERE provider_invoice_id IS NOT NULL;

-- ★★★ OUTSTANDING BALANCE IS A DERIVED VIEW, NEVER A FIELD. [DOC, Z2.11]
-- ★ A stored balance is a cached sum that must be updated by every path that touches an invoice,
-- and the path that forgets is the one that ships. This cannot go stale because it is the sum.
CREATE VIEW keystone.outstanding_balance
WITH (security_invoker = true) AS
SELECT i.tenant_id, i.payer_user_id, i.currency,
       sum(i.amount_minor) FILTER (WHERE i.status = 'open')::bigint AS outstanding_minor,
       count(*)   FILTER (WHERE i.status = 'open')::integer         AS open_invoices
  FROM keystone.invoice i
 GROUP BY i.tenant_id, i.payer_user_id, i.currency;

COMMENT ON VIEW keystone.outstanding_balance IS
  '§Z2.11 — outstanding balance is a DERIVED VIEW, never a field on an invoice. A stored balance is a cached sum, and the code path that forgets to update it is the one that ships.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6 · payment · refund · payment_method
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.payment_method (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id   uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  -- ★ The PROVIDER's id. ★★ No PAN, no CVV, no expiry — nothing that is card data lives here.
  provider_payment_method_id text NOT NULL,
  last_four     text        CHECK (last_four ~ '^[0-9]{4}$'),
  brand         text,
  is_default    boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_payment_method_id)
);
CREATE UNIQUE INDEX payment_method_one_default
  ON keystone.payment_method (tenant_id, app_user_id) WHERE is_default;

CREATE TABLE keystone.payment (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  invoice_id    uuid        REFERENCES keystone.invoice(id) ON DELETE RESTRICT,
  payer_user_id uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  amount_minor  integer     NOT NULL CHECK (amount_minor > 0),
  currency      text        NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  status        text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded')),
  provider_payment_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- ★★ THE WEBHOOK'S IDEMPOTENCY. [DOC, Z2.12] payment status is tracked by WEBHOOK, not polling —
-- and a webhook is delivered AT LEAST once. Without this, a redelivered `payment_intent.succeeded`
-- writes a second payment row and the invoice looks overpaid.
CREATE UNIQUE INDEX payment_provider_id ON keystone.payment (tenant_id, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE INDEX payment_invoice ON keystone.payment (tenant_id, invoice_id);

CREATE TABLE keystone.refund (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  payment_id    uuid        NOT NULL REFERENCES keystone.payment(id) ON DELETE RESTRICT,
  amount_minor  integer     NOT NULL CHECK (amount_minor > 0),
  reason        text,
  provider_refund_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refund_provider_id ON keystone.refund (tenant_id, provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;
CREATE INDEX refund_payment ON keystone.refund (tenant_id, payment_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7 · ★★★ SUBSCRIPTION — contract_id REQUIRED AND NOT NULLABLE
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ §Z0.5: "THE SIGNED AGREEMENT IS THE BRIDGE TO BILLING … NO SIGNATURE, NO RECURRING CHARGE."
-- ★★ `NOT NULL` is the whole enforcement. A nullable column with a comment saying "always set
-- this" is a recurring charge waiting to happen against an unsigned agreement — which is a
-- conversation with a client about money they never agreed to pay.
ALTER TABLE keystone.subscription
  ADD COLUMN contract_id uuid REFERENCES keystone.document_instance(id) ON DELETE RESTRICT,
  ADD COLUMN snapshot_amount_minor integer CHECK (snapshot_amount_minor >= 0),
  ADD COLUMN payment_method_id uuid REFERENCES keystone.payment_method(id) ON DELETE SET NULL,
  ADD COLUMN current_period_end timestamptz,
  ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false;

-- ★ Existing rows first (there are none in production, but the migration must be safe anyway),
-- then the constraint. Expand/contract discipline: never add NOT NULL to a column with rows.
DO $$
DECLARE n integer;
BEGIN
  ALTER TABLE keystone.subscription NO FORCE ROW LEVEL SECURITY;
  SELECT count(*) INTO n FROM keystone.subscription WHERE contract_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      '% subscription row(s) have no contract_id. §Z0.5: no signature, no recurring charge. '
      'These must be resolved by hand before this constraint can be added.', n;
  END IF;
  ALTER TABLE keystone.subscription FORCE ROW LEVEL SECURITY;
END $$;

ALTER TABLE keystone.subscription
  ADD CONSTRAINT subscription_requires_contract CHECK (contract_id IS NOT NULL) NOT VALID;
-- ★ VALIDATE separately so the check is enforced going forward AND verified against what exists.
ALTER TABLE keystone.subscription VALIDATE CONSTRAINT subscription_requires_contract;

COMMENT ON CONSTRAINT subscription_requires_contract ON keystone.subscription IS
  '§Z0.5 — NO SIGNATURE, NO RECURRING CHARGE. A nullable contract_id with a comment saying "always set this" is a recurring charge against an unsigned agreement.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8 · RLS on everything new
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['price','contracted_price','line_item','entitlement',
                           'entitlement_credit','invoice','payment','refund','payment_method'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON keystone.%I
                      USING (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_insert ON keystone.%I
                      FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;

GRANT SELECT ON keystone.outstanding_balance TO app_rw;

CREATE TRIGGER entitlement_touch BEFORE UPDATE ON keystone.entitlement
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
CREATE TRIGGER invoice_touch BEFORE UPDATE ON keystone.invoice
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
CREATE TRIGGER payment_touch BEFORE UPDATE ON keystone.payment
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9 · EXPAND: copy existing prices into `price`. The columns stay until a contract migration.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ Run with FORCE suspended — the same lesson as 0010: a migration's backfill sees NO rows under
-- FORCE RLS because the owner is filtered too, and a count-based guard is blinded identically.
DO $$
DECLARE n integer;
BEGIN
  ALTER TABLE keystone.service  NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE keystone.package  NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE keystone.plan     NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE keystone.price    NO FORCE ROW LEVEL SECURITY;

  INSERT INTO keystone.price (tenant_id, subject_type, subject_id, amount_minor, currency)
    SELECT s.tenant_id, 'service', s.id, s.price_minor, s.currency FROM keystone.service s;
  INSERT INTO keystone.price (tenant_id, subject_type, subject_id, amount_minor, currency)
    SELECT p.tenant_id, 'package', p.id, p.price_minor, p.currency FROM keystone.package p;
  INSERT INTO keystone.price (tenant_id, subject_type, subject_id, amount_minor, currency)
    SELECT pl.tenant_id, 'plan', pl.id, pl.price_minor, pl.currency FROM keystone.plan pl;

  SELECT count(*) INTO n FROM keystone.price;
  RAISE NOTICE 'expand: % price row(s) copied from the definition tables', n;

  ALTER TABLE keystone.service FORCE ROW LEVEL SECURITY;
  ALTER TABLE keystone.package FORCE ROW LEVEL SECURITY;
  ALTER TABLE keystone.plan    FORCE ROW LEVEL SECURITY;
  ALTER TABLE keystone.price   FORCE ROW LEVEL SECURITY;
END $$;

-- ★★ Prove FORCE came back on all four, or the migration fails. The 0010 lesson, applied.
DO $$
DECLARE t text; forced boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['service','package','plan','price'] LOOP
    SELECT relforcerowsecurity INTO forced
      FROM pg_class WHERE oid = ('keystone.' || t)::regclass;
    IF NOT forced THEN
      RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY was not restored on keystone.%', t;
    END IF;
  END LOOP;
END $$;
