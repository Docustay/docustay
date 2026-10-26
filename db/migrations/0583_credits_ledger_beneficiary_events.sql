-- 0583 · THE CREDITS PIPELINE, DATABASE HALF (QUEUE §12.3, specs/CREDITS-PIPELINE.md §3).
--
--   1 · credit_grant       — THE idempotency of "a Stripe invoice was paid → grant its credits": one row per
--                            (practice, Stripe invoice, invoice line). The grant function inserts it in the SAME
--                            transaction as the entitlements, so a second run (webhook + mirror + nightly catch-up
--                            all call it) finds the row and does nothing. Not a job key — the job key only collapses
--                            bursts; THIS is what makes a re-run harmless. (defects 1, 2, 4, 5, 8, 12, 22, 23)
--   2 · who a credit is FOR — entitlement.beneficiary_user_id (null = the whole family) and
--                            line_item.for_user_ids ("who is this for?" at sale); credit_payers_for(person) answers
--                            "whose purchases may this person spend?": themselves, their guardians, their payer-group
--                            mates. Parent pays → the young person's session finds the credit. (defects 3, 25)
--   3 · the state machine   — statuses `expired` and `voided` (terminal), and ONE transition table
--                            (credit_transition) enforced by a trigger on every UPDATE of entitlement_credit.status:
--                            no caller can make an illegal move. The same table is mirrored by the XState machine in
--                            src/money/creditMachine.mjs and a gate asserts the two agree. (defects 9, 17, 18, 19, 20)
--   4 · credit_event        — a PERMANENT ledger of every credit state change (who, when, why), written by a trigger
--                            so no code path can forget; append-only (no UPDATE, no DELETE, no FK that could cascade it away).
--   5 · grant_source 'invoice' — the new grant source.
-- Additive and idempotent. Nothing here changes a credit that already exists.

-- ── 5 · grant source ────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.entitlement DROP CONSTRAINT IF EXISTS entitlement_grant_source_check;
ALTER TABLE keystone.entitlement ADD CONSTRAINT entitlement_grant_source_check
  CHECK (grant_source IS NULL OR grant_source = ANY (ARRAY['package','subscription','manual','document','invoice']));

-- ── 2 · who it is FOR ───────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.entitlement
  ADD COLUMN IF NOT EXISTS beneficiary_user_id uuid REFERENCES keystone.app_user(id) ON DELETE CASCADE;
ALTER TABLE keystone.line_item ADD COLUMN IF NOT EXISTS for_user_ids uuid[];
COMMENT ON COLUMN keystone.entitlement.beneficiary_user_id IS
  'Who the credits are FOR (null = whoever the payer''s family covers). owner_user_id stays the payer — the money.';
COMMENT ON COLUMN keystone.line_item.for_user_ids IS
  'Who this purchase is for ("who is this for?" at sale). Exactly one → that person; none or several → the payer''s family.';

CREATE OR REPLACE FUNCTION keystone.credit_payers_for(p_person uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = keystone, pg_temp AS $f$
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[p_person]) FROM (
    SELECT p_person AS x
    UNION SELECT g.guardian_user_id FROM guardian g WHERE g.child_user_id = p_person
    UNION SELECT m2.person_id
            FROM payer_group_member m1
            JOIN payer_group_member m2 ON m2.payer_group_id = m1.payer_group_id AND m2.person_id IS NOT NULL
           WHERE m1.person_id = p_person
    UNION SELECT pg.contact_user_id
            FROM payer_group_member m1
            JOIN payer_group pg ON pg.id = m1.payer_group_id AND pg.contact_user_id IS NOT NULL
           WHERE m1.person_id = p_person
  ) t WHERE x IS NOT NULL
$f$;
GRANT EXECUTE ON FUNCTION keystone.credit_payers_for(uuid) TO app_rw, app_worker;

-- ── 1 · the grant ledger ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keystone.credit_grant (
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  stripe_invoice_id text       NOT NULL,
  line_item_id     uuid        NOT NULL,                -- no FK: the ledger must outlive a deleted invoice
  state            text        NOT NULL DEFAULT 'granted' CHECK (state IN ('granted', 'nothing_to_grant')),
  entitlement_ids  uuid[]      NOT NULL DEFAULT '{}',
  detail           jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, stripe_invoice_id, line_item_id)
);
ALTER TABLE keystone.credit_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.credit_grant FORCE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'keystone.credit_grant'::regclass AND polname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON keystone.credit_grant
      USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
  END IF;
END $p$;
GRANT SELECT, INSERT, UPDATE ON keystone.credit_grant TO app_rw, app_worker;      -- the row is claimed (INSERT) then completed (UPDATE) in one transaction

-- ── 3 · the state machine: terminal states + ONE transition table ────────────────────────────────────────────
ALTER TABLE keystone.entitlement_credit DROP CONSTRAINT IF EXISTS entitlement_credit_status_check;
ALTER TABLE keystone.entitlement_credit ADD CONSTRAINT entitlement_credit_status_check
  CHECK (status = ANY (ARRAY['available','reserved','consumed','returned','pending','expired','voided']));
ALTER TABLE keystone.entitlement_credit DROP CONSTRAINT IF EXISTS credit_state_shape;
ALTER TABLE keystone.entitlement_credit ADD CONSTRAINT credit_state_shape CHECK (
     (status IN ('available','returned','expired','voided') AND booking_id IS NULL AND consumed_at IS NULL)
  OR (status = 'pending'  AND booking_id IS NULL AND consumed_at IS NULL AND unlocks_at_installment IS NOT NULL)
  OR (status = 'reserved' AND booking_id IS NOT NULL AND consumed_at IS NULL)
  OR (status = 'consumed' AND booking_id IS NOT NULL AND consumed_at IS NOT NULL));

CREATE TABLE IF NOT EXISTS keystone.credit_transition (from_status text NOT NULL, to_status text NOT NULL, PRIMARY KEY (from_status, to_status));
INSERT INTO keystone.credit_transition (from_status, to_status) VALUES
  ('pending','available'),  ('pending','voided'),
  ('available','reserved'), ('available','expired'), ('available','voided'),
  ('returned','reserved'),  ('returned','expired'),   ('returned','voided'),
  ('reserved','consumed'),  ('reserved','returned'),  ('reserved','voided'),
  ('consumed','returned'),  ('consumed','voided')
ON CONFLICT DO NOTHING;
GRANT SELECT ON keystone.credit_transition TO app_rw, app_worker;

CREATE OR REPLACE FUNCTION keystone.credit_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = keystone, pg_temp AS $f$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT EXISTS (SELECT 1 FROM keystone.credit_transition t WHERE t.from_status = OLD.status AND t.to_status = NEW.status) THEN
    RAISE EXCEPTION 'illegal credit move: % → % (credit %). The legal moves are the rows of keystone.credit_transition.', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS entitlement_credit_transition_guard ON keystone.entitlement_credit;
CREATE TRIGGER entitlement_credit_transition_guard BEFORE UPDATE OF status ON keystone.entitlement_credit
  FOR EACH ROW EXECUTE FUNCTION keystone.credit_transition_guard();

-- ── 4 · the permanent event ledger ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keystone.credit_event (
  id             uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id      uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  credit_id      uuid        NOT NULL,                  -- no FK: history outlives the credit, the person, the booking
  entitlement_id uuid        NOT NULL,
  from_status    text,
  to_status      text        NOT NULL,
  booking_id     uuid,
  actor_user_id  uuid,
  reason         text,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_event_credit_idx ON keystone.credit_event (tenant_id, credit_id, at);
ALTER TABLE keystone.credit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.credit_event FORCE ROW LEVEL SECURITY;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'keystone.credit_event'::regclass AND polname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON keystone.credit_event
      USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
  END IF;
END $p$;
GRANT SELECT ON keystone.credit_event TO app_rw, app_worker;      -- no INSERT/UPDATE/DELETE grant: only the definer trigger writes

CREATE OR REPLACE FUNCTION keystone.credit_event_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = keystone, pg_temp AS $f$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO keystone.credit_event (tenant_id, credit_id, entitlement_id, from_status, to_status, booking_id, actor_user_id, reason)
    VALUES (NEW.tenant_id, NEW.id, NEW.entitlement_id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status,
            NEW.booking_id,
            NULLIF(current_setting('keystone.user_id', true), '')::uuid,
            NULLIF(current_setting('keystone.credit_reason', true), ''));
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS entitlement_credit_event_write ON keystone.entitlement_credit;
CREATE TRIGGER entitlement_credit_event_write AFTER INSERT OR UPDATE OF status ON keystone.entitlement_credit
  FOR EACH ROW EXECUTE FUNCTION keystone.credit_event_write();

CREATE OR REPLACE FUNCTION keystone.credit_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $f$
BEGIN
  -- the ledger leaves ONLY with its whole practice (an FK cascade fires this trigger at depth > 1); a direct UPDATE/DELETE is refused, always
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'credit_event is a permanent ledger: it is never % — correct a mistake with a new event.',
    CASE TG_OP WHEN 'DELETE' THEN 'deleted' ELSE 'changed' END USING ERRCODE = 'check_violation';
END $f$;
DROP TRIGGER IF EXISTS credit_event_no_change ON keystone.credit_event;
CREATE TRIGGER credit_event_no_change BEFORE UPDATE OR DELETE ON keystone.credit_event
  FOR EACH ROW EXECUTE FUNCTION keystone.credit_event_append_only();

-- (credits that already exist get no back-filled event: the ledger is complete from this migration forward; a first-seen row
--  would need a tenant context per practice and says nothing true about their history.)
