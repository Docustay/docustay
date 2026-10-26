-- CT-F13, F13 §2.5, R-1; production + local support_access = 0 rows, MEASURED 25 Sep
CREATE TABLE keystone.operator_access_request (
  id                uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id         uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  operator_grant_id uuid        NOT NULL,   -- keystone_auth.operator_grant.id; no FK (deny_all table), same as audit_entry.actor_operator_grant_id
  operator_label    text        NOT NULL CHECK (btrim(operator_label) <> '' AND char_length(operator_label) <= 120),
  why               text        NOT NULL CHECK (char_length(btrim(why)) BETWEEN 10 AND 1000),
  duration_minutes  integer     NOT NULL CHECK (duration_minutes IN (60, 120, 240, 480)),
  read_only         boolean     NOT NULL DEFAULT true CHECK (read_only),
  state             text        NOT NULL DEFAULT 'asked' CHECK (state IN ('asked','approved','denied','withdrawn')),
  asked_at          timestamptz NOT NULL DEFAULT now(),
  answered_at       timestamptz NULL,
  answered_by       uuid        NULL,
  support_access_id uuid        NULL REFERENCES keystone.support_access(id) ON DELETE RESTRICT,
  CONSTRAINT oar_answered_shape CHECK ((state IN ('approved','denied')) = (answered_at IS NOT NULL AND answered_by IS NOT NULL)),
  CONSTRAINT oar_approved_has_access CHECK ((state = 'approved') = (support_access_id IS NOT NULL)),
  CONSTRAINT oar_answered_by_fkey FOREIGN KEY (tenant_id, answered_by) REFERENCES keystone.app_user (tenant_id, id)
);
CREATE UNIQUE INDEX operator_access_request_one_open ON keystone.operator_access_request (tenant_id, operator_grant_id) WHERE state = 'asked';
CREATE INDEX operator_access_request_tenant_idx ON keystone.operator_access_request (tenant_id, asked_at DESC);
ALTER TABLE keystone.operator_access_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.operator_access_request FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.operator_access_request FOR SELECT USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.operator_access_request FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.operator_access_request FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
GRANT SELECT, INSERT, UPDATE ON keystone.operator_access_request TO app_rw;
-- support_access: read-only and never notes, by constraint (0 rows today — nothing to violate)
ALTER TABLE keystone.support_access ADD CONSTRAINT support_access_never_notes CHECK (allow_private_notes = false);
ALTER TABLE keystone.support_access ADD CONSTRAINT support_access_read_only  CHECK (allow_changes = false);
-- the audit verb for "no" (0249 pattern verbatim: NO FORCE → INSERT → FORCE → assert)
ALTER TABLE keystone.audit_action NO FORCE ROW LEVEL SECURITY;
INSERT INTO keystone.audit_action (key) VALUES ('operator.grant_denied') ON CONFLICT (key) DO NOTHING;
ALTER TABLE keystone.audit_action FORCE ROW LEVEL SECURITY;
-- the operator's display name, for "with your name on it"
SET LOCAL ROLE app_owner;  -- (already the migration role; stated for the GRANT below — 0250:58-59 precedent)
GRANT SELECT (display_name) ON keystone.app_user TO auth_owner;
SET LOCAL ROLE auth_owner;
CREATE FUNCTION keystone.operator_display_name(p_operator_grant_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.display_name
    FROM keystone_auth.operator_grant g
    JOIN keystone.app_user u ON u.firebase_uid = g.firebase_uid
    JOIN keystone.tenant t ON t.id = u.tenant_id AND t.is_platform
   WHERE g.id = p_operator_grant_id
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION keystone.operator_display_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.operator_display_name(uuid) TO app_rw;
SET LOCAL ROLE app_owner;
-- self-checks (DO blocks, RAISE EXCEPTION on failure): relforcerowsecurity true on the new table and on audit_action;
-- 'operator.grant_denied' present; both support_access constraints present (pg_constraint);
-- operator_display_name owned by auth_owner, prosecdef, proacl not null, search_path set (0363:93-121 shape).
