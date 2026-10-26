-- 0638 · PART 30 item 4 — document_audit_event.kind gains 'embed_session' (an embedded signing session was started for a seat; the allowed website is in `detail`, which carries no personal data).
ALTER TABLE keystone.document_audit_event DROP CONSTRAINT document_audit_event_kind_check;
ALTER TABLE keystone.document_audit_event ADD CONSTRAINT document_audit_event_kind_check CHECK (kind = ANY (ARRAY[
  'opened','link_clicked','verified','signed','sent','declined','executed','consented','delivered','bounced','complained','uploaded','reminded','voided','reassigned','expired','viewed','saved',
  'link_reissued','changes_requested','test_sent','scheduled','approved','rejected','acknowledged','assisted','erased','delegated','reopened','downloaded','embed_session']));
