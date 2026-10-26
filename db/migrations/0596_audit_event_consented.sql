-- 0596 · A SIGNER'S AGREEMENT TO SIGN ELECTRONICALLY IS AN EVENT ON THE DOCUMENT'S TIMELINE (QUEUE §23.2.7, the Certificate of Completion).
-- `document_audit_event.kind` gains 'consented'. ('opened' already is the "viewed" event; the consent itself and its wording version live in esign_disclosure_acceptance, which the certificate reads.)
-- Additive: widening a CHECK; no row changes.
ALTER TABLE keystone.document_audit_event DROP CONSTRAINT document_audit_event_kind_check;
ALTER TABLE keystone.document_audit_event ADD CONSTRAINT document_audit_event_kind_check
  CHECK (kind IN ('opened', 'link_clicked', 'verified', 'signed', 'sent', 'declined', 'executed', 'consented'));
