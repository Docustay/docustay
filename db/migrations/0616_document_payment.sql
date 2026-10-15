-- 0616 — PAYING WHILE SIGNING (QUEUE §23.5.11). One row per payment field a signer pays: which document, which person, which field, how much, and the Stripe PaymentIntent that carries it.
-- ★ Stripe is the source of truth for whether the money moved: `status` here is only what the island last confirmed FROM Stripe (it is re-read from Stripe at signing). The row exists so a payment can be tied to a
--   person and a field, shown on the document's Track page, and refunded; it is never the evidence that a card was charged.
-- ★ Never deleted: ON DELETE RESTRICT on both parents, no DELETE policy and no DELETE grant — a document with a payment on it cannot be removed out from under the money record.
-- Additive: one new table. Row-level security FORCED: staff see every row of their tenant; a signer (the party id is the viewer inside a signing link) sees only their own.
CREATE TABLE keystone.document_payment (
  id                uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id         uuid        NOT NULL REFERENCES keystone.tenant(id),
  instance_id       uuid        NOT NULL REFERENCES keystone.document_instance(id) ON DELETE RESTRICT,
  party_id          uuid        NOT NULL REFERENCES keystone.document_party(id) ON DELETE RESTRICT,
  field_id          text        NOT NULL CHECK (length(field_id) BETWEEN 1 AND 64),
  amount_minor      integer     NOT NULL CHECK (amount_minor > 0),
  currency          text        NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  payment_intent_id text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','partially_refunded','refunded')),
  paid_at           timestamptz,
  refunded_minor    integer     NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  refunded_at       timestamptz,
  refund_reason     text        CHECK (refund_reason IS NULL OR length(refund_reason) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_payment_refund_within_amount CHECK (refunded_minor <= amount_minor),
  CONSTRAINT document_payment_one_per_field UNIQUE (instance_id, party_id, field_id),
  CONSTRAINT document_payment_intent_key UNIQUE (tenant_id, payment_intent_id)
);
CREATE INDEX document_payment_by_instance ON keystone.document_payment (tenant_id, instance_id);
ALTER TABLE keystone.document_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_payment FORCE  ROW LEVEL SECURITY;
CREATE POLICY staff_or_own_read   ON keystone.document_payment FOR SELECT
  USING (tenant_id = keystone.current_tenant_id() AND (party_id = keystone.current_user_id() OR EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = keystone.current_user_id() AND u.role = 'staff')));
CREATE POLICY staff_or_own_insert ON keystone.document_payment FOR INSERT
  WITH CHECK (tenant_id = keystone.require_tenant_id() AND (party_id = keystone.current_user_id() OR EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = keystone.current_user_id() AND u.role = 'staff')));
CREATE POLICY staff_or_own_update ON keystone.document_payment FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id() AND (party_id = keystone.current_user_id() OR EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = keystone.current_user_id() AND u.role = 'staff')))
  WITH CHECK (tenant_id = keystone.current_tenant_id() AND (party_id = keystone.current_user_id() OR EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = keystone.current_user_id() AND u.role = 'staff')));
GRANT SELECT, INSERT, UPDATE ON keystone.document_payment TO app_rw;
GRANT SELECT ON keystone.document_payment TO app_worker;
COMMENT ON TABLE keystone.document_payment IS 'A payment a signer made (or is making) through a payment field on an uploaded document. Stripe is the source of truth; this row ties the PaymentIntent to a person and a field. Never deleted.';
