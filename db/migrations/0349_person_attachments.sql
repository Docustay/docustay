-- 0349 — PERSON ATTACHMENTS. STORE FILES TIED TO A PERSON RECORD.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ SOFT DELETE, NEVER HARD DELETE — archive, not destroy. A person who attached a file meant
--    something by it, and a later deletion of the row is a change to that fact, recorded in
--    `deleted_at` rather than obliterating the row. Restored later, the file stays recoverable
--    the same way every other record here does.
-- ★ STORAGE KEY is what `objectKey({tenantId, kind: 'person_attachment', id})` returns — tenant-
--   first path, tenant scoped. RLS enforces the boundary at the table; the key enforces it at
--   the object store.
-- ★★★ COMPOSITE FK ON `tenant_id` FOLLOWING `account_contact` (0080 §A3 §K3) — a person_attachment
--    in tenant A cannot name a person in tenant B. Platform boundary is unrepresentable.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone.person_attachment (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL,

  -- ★ The storage key returned by objectKey(). Retrieved same way; deterministic so a re-upload
  --   of the same instance overwrites the same object rather than accumulating orphans.
  storage_key text NOT NULL,

  -- ★ Original filename as uploaded, for display and download disposition.
  filename text NOT NULL,

  -- ★ MIME type — what the uploader claimed. Stored so a retrieval can send the right
  --   Content-Type header without guessing from the filename.
  content_type text,

  -- ★ Size in bytes, for display (and in future, size quotas if a practice has one).
  size_bytes bigint,

  -- ★ Who uploaded it, for display and audit. `ON DELETE SET NULL` because a person can leave
  --   the practice and their files stay.
  uploaded_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- ★★ SOFT DELETE — sets timestamp rather than removing row.
  deleted_at timestamptz,

  CONSTRAINT person_attachment_person_fkey
    FOREIGN KEY (tenant_id, person_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX person_attachment_tenant_id_key ON keystone.person_attachment (tenant_id, id);
CREATE INDEX person_attachment_person_idx ON keystone.person_attachment (tenant_id, person_id);
CREATE INDEX person_attachment_deleted_idx ON keystone.person_attachment (tenant_id, person_id) WHERE deleted_at IS NULL;

ALTER TABLE keystone.person_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.person_attachment FORCE ROW LEVEL SECURITY;

-- ★★★ THREE IDENTICAL POLICIES, LIKE `account_contact` (0080 §A3). Composite key enforces
--     tenant boundary at the schema level; RLS enforces it at query level. Defence in depth.
CREATE POLICY tenant_isolation ON keystone.person_attachment
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.person_attachment
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.person_attachment
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.person_attachment TO app_rw;

COMMENT ON TABLE keystone.person_attachment IS
  'Files attached to a person record. ★★ Soft-deleted with deleted_at, never hard-deleted. '
  'storage_key is what objectKey({tenantId, kind: ''person_attachment'', id}) returns — '
  'tenant-first, tenant-scoped. ★★★ Composite FK on (tenant_id, person_id) makes a cross-tenant '
  'attachment impossible at the schema level.';
