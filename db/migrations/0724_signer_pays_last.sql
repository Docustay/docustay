-- Run 9 Part 3.7 — THE SIGNER PAYS LAST (R9-l; boards Pay1–Pay4).
-- A signer with a payment to make signs first: everything the signing page checks is checked, then the signature is HELD on their party row (`awaiting_payment`) while they pay in Stripe's
-- embedded Checkout. The document completes only when Stripe confirms the payment; the held signature then becomes the real one, signed at the moment they pressed Sign. A hold lapses after
-- 7 days with no payment: it is cleared (nothing of it is kept) and the signer and sender are told.
-- The Payments page reads Stripe's own fee and any dispute from Stripe, stored on the payment row as Stripe said them; the receipt goes out with the sealed copy (`receipt_sent_at`).
ALTER TABLE keystone.document_party
  ADD COLUMN IF NOT EXISTS held_signature  jsonb       NULL,
  ADD COLUMN IF NOT EXISTS held_at         timestamptz NULL,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz NULL;
ALTER TABLE keystone.document_party DROP CONSTRAINT IF EXISTS document_party_status_check;
ALTER TABLE keystone.document_party ADD CONSTRAINT document_party_status_check CHECK (status = ANY (ARRAY['pending','viewed','signed','approved','rejected','declined','bounced','closed','awaiting_payment']));
ALTER TABLE keystone.document_party DROP CONSTRAINT IF EXISTS document_party_hold_shape;
ALTER TABLE keystone.document_party ADD CONSTRAINT document_party_hold_shape CHECK (
  (status = 'awaiting_payment') = (held_signature IS NOT NULL)
  AND (held_signature IS NULL) = (held_at IS NULL) AND (held_signature IS NULL) = (hold_expires_at IS NULL)
  AND (held_signature IS NULL OR (jsonb_typeof(held_signature) = 'object' AND pg_column_size(held_signature) <= 1048576 AND hold_expires_at > held_at)));
CREATE INDEX IF NOT EXISTS document_party_hold_due_idx ON keystone.document_party (tenant_id, hold_expires_at) WHERE status = 'awaiting_payment';

ALTER TABLE keystone.document_payment
  ADD COLUMN IF NOT EXISTS stripe_fee_minor integer     NULL CHECK (stripe_fee_minor IS NULL OR stripe_fee_minor >= 0),
  ADD COLUMN IF NOT EXISTS dispute_status   text        NULL CHECK (dispute_status IS NULL OR char_length(dispute_status) <= 40),
  ADD COLUMN IF NOT EXISTS dispute_id       text        NULL CHECK (dispute_id IS NULL OR dispute_id ~ '^dp_[A-Za-z0-9]+$'),
  ADD COLUMN IF NOT EXISTS receipt_sent_at  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS stripe_fee_checked_at timestamptz NULL;   -- when Stripe was last asked for this payment's fee (it comes a little after the payment)

ALTER TABLE keystone.document_audit_event DROP CONSTRAINT IF EXISTS document_audit_event_kind_check;
ALTER TABLE keystone.document_audit_event ADD CONSTRAINT document_audit_event_kind_check CHECK (kind = ANY (ARRAY['opened','link_clicked','verified','signed','sent','declined','executed','consented','delivered','bounced',
  'complained','uploaded','reminded','voided','reassigned','expired','viewed','saved','link_reissued','changes_requested','test_sent','scheduled','approved','rejected','acknowledged','assisted','erased',
  'delegated','reopened','downloaded','embed_session','seal_untimestamped','seal_restamped','hidden_by_rule','witnessed','group_closed',
  'held_for_payment','hold_lapsed','paid','refunded','disputed']));

-- The signer is told when their hold lapses (the sender is told in the app and by the owner notice): a ninth editable message, and its email-log kind.
ALTER TABLE keystone.document_email_message DROP CONSTRAINT IF EXISTS document_email_message_kind_check;
ALTER TABLE keystone.document_email_message ADD CONSTRAINT document_email_message_kind_check CHECK (kind IN ('invitation','reminder','completed','declined','voided','expired','code','receipt','form_response','hold_lapsed'));
ALTER TABLE keystone.document_email_log DROP CONSTRAINT IF EXISTS document_email_log_kind_check;
ALTER TABLE keystone.document_email_log ADD CONSTRAINT document_email_log_kind_check CHECK (kind IN ('invitation','reminder','completed','declined','voided','expired','code','receipt','form_response','hold_lapsed','other'));

-- THE WORKER'S VIEW (no signed-in person; the due sweep). It sees ONLY what the two payment sweeps need, in the shape 0112 / 0418 / 0721 set:
--   · a payment that is paid and has no receipt yet (or was stamped in this very transaction — now() is fixed for a transaction — so the stamp stays visible to the worker setting it, and to nobody after);
--   · the documents those payments are on, and the documents of a send whose hold is due to lapse (or was cleared in this very transaction), for the signer's email and the trail.
DROP POLICY IF EXISTS system_receipt_read  ON keystone.document_payment;
DROP POLICY IF EXISTS system_receipt_write ON keystone.document_payment;
CREATE POLICY system_receipt_read  ON keystone.document_payment FOR SELECT USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
                                     AND status IN ('paid','partially_refunded','refunded') AND (receipt_sent_at IS NULL OR receipt_sent_at = now()));
CREATE POLICY system_receipt_write ON keystone.document_payment FOR UPDATE USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
                                     AND status IN ('paid','partially_refunded','refunded') AND (receipt_sent_at IS NULL OR receipt_sent_at = now()))
                                     WITH CHECK (tenant_id = keystone.current_tenant_id() AND (receipt_sent_at IS NULL OR receipt_sent_at = now()));
-- Stripe attaches a charge's fee a little after the payment, so the due sweep asks again for a paid payment whose fee is still unknown (at most every 15 minutes, for 30 days). The sweep runs with no
-- viewer: it may see exactly those rows, and may only write a row it stamps as asked in this very transaction (stripe_fee_checked_at = now()), in the 0712/0721 pattern.
DROP POLICY IF EXISTS system_fee_read  ON keystone.document_payment;
DROP POLICY IF EXISTS system_fee_write ON keystone.document_payment;
CREATE POLICY system_fee_read  ON keystone.document_payment FOR SELECT USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
                                 AND status IN ('paid','partially_refunded','refunded') AND checkout_session_id IS NOT NULL AND paid_at > now() - interval '30 days'
                                 AND (stripe_fee_minor IS NULL OR stripe_fee_checked_at = now()));
CREATE POLICY system_fee_write ON keystone.document_payment FOR UPDATE USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
                                 AND status IN ('paid','partially_refunded','refunded') AND checkout_session_id IS NOT NULL AND paid_at > now() - interval '30 days' AND stripe_fee_minor IS NULL)
                                 WITH CHECK (tenant_id = keystone.current_tenant_id() AND stripe_fee_checked_at = now());
DROP POLICY IF EXISTS system_payment_sweep_read ON keystone.document_instance;
CREATE POLICY system_payment_sweep_read ON keystone.document_instance FOR SELECT USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL AND (
  EXISTS (SELECT 1 FROM keystone.document_payment p WHERE p.instance_id = document_instance.id AND p.status IN ('paid','partially_refunded','refunded') AND (p.receipt_sent_at IS NULL OR p.receipt_sent_at = now()))
  OR EXISTS (SELECT 1 FROM keystone.document_party hp WHERE hp.instance_id = COALESCE(document_instance.package_lead_id, document_instance.id)
             AND ((hp.status = 'awaiting_payment' AND hp.hold_expires_at <= now()) OR (hp.status = 'viewed' AND hp.updated_at = now())))));
