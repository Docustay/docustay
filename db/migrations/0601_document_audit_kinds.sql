-- 0601 · THE TIMELINE LEARNS THE UPLOAD FLOW'S EVENTS (QUEUE §23.4.7, §23.4.11). New kinds on `document_audit_event` — uploaded, reminded, voided, reassigned, expired, viewed, saved, link_reissued, changes_requested,
-- test_sent, scheduled — and a small `detail` object for facts that are not personal data (a file's hash, a page count, a reminder number). Additive: the old kinds and rows are untouched.
ALTER TABLE keystone.document_audit_event DROP CONSTRAINT document_audit_event_kind_check;
ALTER TABLE keystone.document_audit_event ADD  CONSTRAINT document_audit_event_kind_check CHECK (kind = ANY (ARRAY[
  'opened','link_clicked','verified','signed','sent','declined','executed','consented','delivered','bounced','complained',
  'uploaded','reminded','voided','reassigned','expired','viewed','saved','link_reissued','changes_requested','test_sent','scheduled']));
ALTER TABLE keystone.document_audit_event ADD COLUMN detail jsonb NULL CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object');
