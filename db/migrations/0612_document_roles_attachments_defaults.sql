-- 0612 · RECIPIENT ROLES, PER-PERSON REMINDERS, EXTRA ATTACHMENTS AND TEMPLATE SEND DEFAULTS (QUEUE §23.5.3, §23.5.4, §23.5.16, §23.5.17). All additive.
--   · document_party.assists_role   — an ASSISTANT pre-fills the fields of this seat (never a signature, initials, date or stamp) before that person signs.
--   · document_party.reminders_sent / last_reminded_at — each person has their own reminder count (their own cadence, from `reminder_days`, measured from when they were invited).
--   · document_upload.attach_to     — an upload that becomes an extra ATTACHMENT of a draft (kind 'attachment' on `document_file`) rather than a new document.
--   · document_template.send_defaults — reminder cadence, expiry, message, language, order a template carries into each document made from it.
ALTER TABLE keystone.document_party
  ADD COLUMN assists_role     text        NULL CHECK (assists_role IS NULL OR assists_role ~ '^signer_[0-9]{1,3}$'),
  ADD COLUMN reminders_sent   integer     NOT NULL DEFAULT 0 CHECK (reminders_sent >= 0),
  ADD COLUMN last_reminded_at timestamptz NULL;
ALTER TABLE keystone.document_upload
  ADD COLUMN attach_to uuid NULL REFERENCES keystone.document_instance(id) ON DELETE SET NULL;
ALTER TABLE keystone.document_template
  ADD COLUMN send_defaults jsonb NULL CHECK (send_defaults IS NULL OR jsonb_typeof(send_defaults) = 'object');

-- the timeline learns the recipient roles' acts: an approver approves or rejects, a viewer acknowledges, an assistant fills in details for someone
ALTER TABLE keystone.document_audit_event DROP CONSTRAINT document_audit_event_kind_check;
ALTER TABLE keystone.document_audit_event ADD  CONSTRAINT document_audit_event_kind_check CHECK (kind = ANY (ARRAY[
  'opened','link_clicked','verified','signed','sent','declined','executed','consented','delivered','bounced','complained',
  'uploaded','reminded','voided','reassigned','expired','viewed','saved','link_reissued','changes_requested','test_sent','scheduled',
  'approved','rejected','acknowledged','assisted']));

-- an APPROVER can be the last act of a send: "every signer has signed" becomes "every signer has signed and every approver has approved"
DROP POLICY party_marks_progress ON keystone.document_instance;
CREATE POLICY party_marks_progress ON keystone.document_instance FOR UPDATE USING (
  tenant_id = keystone.current_tenant_id() AND builder = 'pdf' AND state IN ('sent','partially_signed') AND archived_at IS NULL
  AND EXISTS (SELECT 1 FROM keystone.document_party p
               WHERE p.id = keystone.current_user_id() AND p.tenant_id = document_instance.tenant_id AND p.instance_id = COALESCE(document_instance.package_lead_id, document_instance.id)))
WITH CHECK (
  tenant_id = keystone.current_tenant_id() AND builder = 'pdf' AND (
       state IN ('partially_signed','declined')
    OR (state = 'executed' AND NOT EXISTS (SELECT 1 FROM keystone.document_party q
                                            WHERE q.instance_id = COALESCE(document_instance.package_lead_id, document_instance.id) AND q.action_role IN ('signer','approver') AND q.status NOT IN ('signed','approved')))));

-- an ASSISTANT may write the saved-for-later values of the one seat they assist (and nothing else on that row's person)
CREATE POLICY assistant_fills ON keystone.document_party FOR UPDATE USING (
  tenant_id = keystone.current_tenant_id() AND EXISTS (SELECT 1 FROM keystone.document_party a
    WHERE a.id = keystone.current_user_id() AND a.tenant_id = document_party.tenant_id AND a.instance_id = document_party.instance_id AND a.action_role = 'assistant' AND a.assists_role = document_party.role))
WITH CHECK (
  tenant_id = keystone.current_tenant_id() AND EXISTS (SELECT 1 FROM keystone.document_party a
    WHERE a.id = keystone.current_user_id() AND a.tenant_id = document_party.tenant_id AND a.instance_id = document_party.instance_id AND a.action_role = 'assistant' AND a.assists_role = document_party.role));
