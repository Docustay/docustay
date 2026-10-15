-- 0718 · RUN 9, PART 3.3 — what conditions, signing groups and witnesses need in the database. Additive only.
--  · document_audit_event.kind gains 'hidden_by_rule' (a box or page left out of the document because its rule did not hold), 'witnessed' (a witness signed straight after the signer, on the
--    same device) and 'group_closed' (someone else in a signing group signed for the seat, so this person's turn ended). The constraint is replaced, never loosened for anything else.
--  · document_party gains `group_label` (a SIGNING GROUP, Pro: several people share one seat; the first of them to sign fills it) and `witness_required` (the seat's signature is witnessed).
--    Its status gains 'closed': a group member whose seat someone else in the group already signed.
--  · The signer's own UPDATE policy on document_instance lets a document execute when every signer has signed — a closed group member counts as done, so the policy is replaced with
--    'closed' added and nothing else changed.
--  · document_witness: who witnessed a signature, with their mark's SHA-256 — evidence, append-only like document_field_value, FORCED row-level security.

ALTER TABLE keystone.document_audit_event DROP CONSTRAINT document_audit_event_kind_check;
ALTER TABLE keystone.document_audit_event ADD CONSTRAINT document_audit_event_kind_check CHECK (kind = ANY (ARRAY[
  'opened','link_clicked','verified','signed','sent','declined','executed','consented','delivered','bounced','complained','uploaded','reminded','voided','reassigned','expired','viewed','saved',
  'link_reissued','changes_requested','test_sent','scheduled','approved','rejected','acknowledged','assisted','erased','delegated','reopened','downloaded','embed_session','seal_untimestamped',
  'seal_restamped','hidden_by_rule','witnessed','group_closed']));

ALTER TABLE keystone.document_party
  ADD COLUMN IF NOT EXISTS group_label      text,
  ADD COLUMN IF NOT EXISTS witness_required boolean NOT NULL DEFAULT false;
ALTER TABLE keystone.document_party ADD CONSTRAINT document_party_group_label_len CHECK (group_label IS NULL OR length(btrim(group_label)) BETWEEN 1 AND 80);
ALTER TABLE keystone.document_party DROP CONSTRAINT document_party_status_check;
ALTER TABLE keystone.document_party ADD CONSTRAINT document_party_status_check CHECK (status = ANY (ARRAY['pending','viewed','signed','approved','rejected','declined','bounced','closed']));

DROP POLICY party_marks_progress ON keystone.document_instance;
CREATE POLICY party_marks_progress ON keystone.document_instance FOR UPDATE USING (
  tenant_id = keystone.current_tenant_id() AND builder = 'pdf' AND state IN ('sent','partially_signed') AND archived_at IS NULL
  AND EXISTS (SELECT 1 FROM keystone.document_party p
               WHERE p.id = keystone.current_user_id() AND p.tenant_id = document_instance.tenant_id AND p.instance_id = COALESCE(document_instance.package_lead_id, document_instance.id)))
WITH CHECK (
  tenant_id = keystone.current_tenant_id() AND builder = 'pdf' AND (
       state IN ('partially_signed','declined')
    OR (state = 'executed' AND NOT EXISTS (SELECT 1 FROM keystone.document_party q
                                            WHERE q.instance_id = COALESCE(document_instance.package_lead_id, document_instance.id) AND q.action_role IN ('signer','approver')
                                              AND q.status NOT IN ('signed','approved','closed')))));

CREATE TABLE keystone.document_witness (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id uuid        NOT NULL REFERENCES keystone.document_instance(id) ON DELETE CASCADE,   -- the document (each member of a package gets its own row)
  party_id    uuid        NOT NULL REFERENCES keystone.document_party(id) ON DELETE CASCADE,      -- whose signature was witnessed
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  email       text        NULL CHECK (email IS NULL OR length(email) <= 254),
  mark_image  text        NULL CHECK (mark_image IS NULL OR (mark_image LIKE 'data:image/png;base64,%' AND length(mark_image) <= 204800)),
  mark_sha256 text        NULL CHECK (mark_sha256 IS NULL OR mark_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at   timestamptz NOT NULL,
  ip          text        NULL,
  user_agent  text        NULL CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instance_id, party_id)
);
CREATE INDEX document_witness_by_instance ON keystone.document_witness (tenant_id, instance_id);
ALTER TABLE keystone.document_witness ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_witness FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation   ON keystone.document_witness USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert      ON keystone.document_witness FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY workspace_deletion ON keystone.document_witness FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id));
GRANT SELECT, INSERT ON keystone.document_witness TO app_rw;
GRANT SELECT ON keystone.document_witness TO app_worker;
CREATE TRIGGER document_witness_no_update BEFORE UPDATE ON keystone.document_witness FOR EACH ROW EXECUTE FUNCTION keystone.document_field_value_is_immutable();
CREATE TRIGGER document_witness_no_delete BEFORE DELETE ON keystone.document_witness FOR EACH ROW EXECUTE FUNCTION keystone.document_field_value_is_immutable();
CREATE TRIGGER ks_notify_change AFTER INSERT OR DELETE OR UPDATE ON keystone.document_witness FOR EACH ROW EXECUTE FUNCTION keystone.ks_notify_change('documents');
