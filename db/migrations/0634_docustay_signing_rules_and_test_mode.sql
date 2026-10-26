-- 0634 · PART 30 (items 5 and 8) — the schema the signing rules and test mode need. Additive only.
--  · document_audit_event.kind gains 'delegated' (a signer passed their turn to someone else), 'reopened' (a signer took back their answers before the document finished) and 'downloaded'
--    (the signed copy was fetched through a download link). The constraint is replaced, never loosened for anything else.
--  · document_party gains the reason a person gave for signing (when the organisation requires one) and, after a delegation, who was first invited (name and email live on the PARTY row,
--    never in the audit event's `detail`, which by rule carries no personal data).
--  · document_instance.is_test marks a document made in test mode: it is excluded from usage, billing and reports, mails only its sender, and carries a TEST watermark.
--  · link_token gains the purpose 'pdf_download' — an expirable link to the sealed copy.
ALTER TABLE keystone.document_audit_event DROP CONSTRAINT document_audit_event_kind_check;
ALTER TABLE keystone.document_audit_event ADD CONSTRAINT document_audit_event_kind_check CHECK (kind = ANY (ARRAY[
  'opened','link_clicked','verified','signed','sent','declined','executed','consented','delivered','bounced','complained','uploaded','reminded','voided','reassigned','expired','viewed','saved',
  'link_reissued','changes_requested','test_sent','scheduled','approved','rejected','acknowledged','assisted','erased','delegated','reopened','downloaded']));

ALTER TABLE keystone.document_party
  ADD COLUMN IF NOT EXISTS sign_reason          text,
  ADD COLUMN IF NOT EXISTS delegated_from_name  text,
  ADD COLUMN IF NOT EXISTS delegated_from_email text,
  ADD COLUMN IF NOT EXISTS delegated_at         timestamptz;
ALTER TABLE keystone.document_party ADD CONSTRAINT document_party_sign_reason_len CHECK (sign_reason IS NULL OR length(sign_reason) <= 500);

ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS document_instance_live_idx ON keystone.document_instance (tenant_id, created_at DESC) WHERE NOT is_test;

ALTER TABLE keystone.link_token DROP CONSTRAINT link_token_purpose_check;
ALTER TABLE keystone.link_token ADD CONSTRAINT link_token_purpose_check CHECK (purpose = ANY (ARRAY[
  'document_signature','invite','client_invite','waitlist_claim','invoice_view','estimate_accept','card_update','pdf_signature','pdf_test','pdf_download']));
