-- 0202_invite
-- Stage 8 task 8.1 · CT-055 as amended by CCR-1, CCR-2, CCR-3, CCR-4 (CONTRACTS.md §2).
--
-- AN INVITATION IS A DURABLE ROW WITH AN EXPIRY, NOT AN EVENT. The presented token is a
-- keystone.link_token (CT-019) with purpose 'invite' or 'client_invite' whose subject_id is this
-- row's id — this table holds no secret of its own (CCR-2: no token_hash column here).
--
-- CCR-1: an invitation exists for all four roles this product has (src/people/writes.mjs:32),
--   not only staff.
-- CCR-3: citext is NOT installed on production (EXECUTED) — text + lower() in the partial unique
--   index instead.
-- No DELETE grant and no FOR DELETE policy: an invite is revoked, never removed.

CREATE TABLE keystone.invite (
  id             uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- CCR-3: citext is NOT installed on production (EXECUTED); text + lower() in the index.
  email          text NOT NULL CHECK (btrim(email) <> ''),
  -- CCR-1: an invitation exists for all four roles, not only staff.
  role           text NOT NULL CHECK (role IN ('staff','adult_client','adolescent_client','parent')),
  staff_role     text CHECK (staff_role IN ('admin','coach')),
  child_user_id  uuid,
  invited_by     uuid NOT NULL REFERENCES keystone.app_user(id),
  -- CCR-2: NO token_hash. The presented token is a CT-019 link_token whose subject_id is this id.
  expires_at     timestamptz NOT NULL,
  accepted_at    timestamptz,
  accepted_by_uid text,
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invite_role_shape
    CHECK ((role = 'staff') = (staff_role IS NOT NULL)),
  CONSTRAINT invite_parent_has_child
    CHECK ((role = 'parent') = (child_user_id IS NOT NULL)),
  CONSTRAINT invite_acceptance_shape
    CHECK ((accepted_at IS NULL AND accepted_by_uid IS NULL) OR
           (accepted_at IS NOT NULL AND accepted_by_uid IS NOT NULL)),
  CONSTRAINT invite_revocation_shape
    CHECK ((revoked_at IS NULL AND revoked_reason IS NULL) OR
           (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL)),
  CONSTRAINT invite_not_both
    CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, child_user_id)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX invite_one_open_per_email_idx
  ON keystone.invite (tenant_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invite_open_idx ON keystone.invite (tenant_id, created_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE keystone.invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.invite FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.invite
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.invite
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.invite
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No DELETE grant and no FOR DELETE policy: an invite is revoked, never removed (CT-055).
GRANT SELECT, INSERT, UPDATE ON keystone.invite TO app_rw;

COMMENT ON TABLE keystone.invite IS
  'CT-055 — an invitation that can be accepted. The presented token is a keystone.link_token with '
  'purpose invite/client_invite whose subject_id is this row (CT-019); this table holds no secret.';
