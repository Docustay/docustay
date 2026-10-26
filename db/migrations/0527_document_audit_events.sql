-- 0527 — D5 (RECONCILE de-code, 27 Sep 2026): the audit trail's own event log, and the two
-- verification flags a signed instance carries. "Phone verified" stays a real column, defaulted to
-- NULL ("not collected"), never a guessed boolean — see this task's own BLOCKED note on phone OTP.
ALTER TABLE keystone.document_instance
  ADD COLUMN email_verified boolean NULL,
  ADD COLUMN phone_verified boolean NULL,
  ADD COLUMN original_sha256 text NULL CHECK (original_sha256 IS NULL OR original_sha256 ~ '^[0-9a-f]{64}$');

CREATE TABLE keystone.document_audit_event (
  id          uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id uuid NOT NULL REFERENCES keystone.document_instance(id) ON DELETE RESTRICT,
  kind        text NOT NULL CHECK (kind IN ('opened', 'link_clicked', 'verified', 'signed', 'sent', 'declined', 'executed')),
  actor_role  text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_audit_event_instance_idx ON keystone.document_audit_event (tenant_id, instance_id, occurred_at);

ALTER TABLE keystone.document_audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_audit_event
  USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT ON keystone.document_audit_event TO app_rw;
GRANT SELECT ON keystone.document_audit_event TO reference_guard;
