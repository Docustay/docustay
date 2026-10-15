-- 0615 — an erasure request leaves a note on each document it touched (QUEUE §23.15.3): the audit trail gains the kind `erased`.
-- Additive: the same list as before plus one kind; no row changes.
ALTER TABLE keystone.document_audit_event DROP CONSTRAINT document_audit_event_kind_check;
ALTER TABLE keystone.document_audit_event ADD  CONSTRAINT document_audit_event_kind_check CHECK (kind = ANY (ARRAY['opened', 'link_clicked', 'verified', 'signed', 'sent', 'declined', 'executed', 'consented', 'delivered', 'bounced', 'complained', 'uploaded', 'reminded', 'voided', 'reassigned', 'expired', 'viewed', 'saved', 'link_reissued', 'changes_requested', 'test_sent', 'scheduled', 'approved', 'rejected', 'acknowledged', 'assisted', 'erased']));
