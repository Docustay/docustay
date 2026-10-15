-- 0310_guardian_consent_columns
-- Spec 03b task 3b.1 · CT-116 (the teen consent gate).
--
-- ★★ ADDITIVE AND NULLABLE ONLY. `keystone.guardian` (0074) is a foundations table with no other
--    Group A/B/C spec claiming its columns (CONTRACTS-FEATURES.md, spec 03b §3's own note) — this
--    ALTER breaks nothing that reads the table today: 0077/0119/0194's document-visibility gates
--    read only `relationship` and the two id columns, untouched by this migration.
--
-- Records which document instance carried a guardian's consent for a specific child, and when it
-- executed. `consent_document_instance_id` is nulled (never left dangling) if that document instance
-- is ever deleted, per the same "never a dangling reference" discipline the rest of this schema uses
-- for a soft link to a row that may legitimately go away.

ALTER TABLE keystone.guardian
  ADD COLUMN consent_document_instance_id uuid NULL
    REFERENCES keystone.document_instance(id) ON DELETE SET NULL,
  ADD COLUMN consent_executed_at timestamptz NULL;

-- ★ Fast lookup for "which guardian edges have a consent document outstanding" — a document instance
--   is attached (subject_id set) but not yet executed. Partial, same idiom as every other "still open"
--   index in this schema (e.g. `invite_open_idx`, 0202:51-52).
CREATE INDEX guardian_consent_pending_idx ON keystone.guardian (tenant_id, consent_document_instance_id)
  WHERE consent_document_instance_id IS NOT NULL AND consent_executed_at IS NULL;

COMMENT ON COLUMN keystone.guardian.consent_document_instance_id IS
  'Spec 03b / 0310 (CT-116). The document instance carrying this guardian''s consent for this child,
   if one has been sent. NULL until a consent flow starts. ON DELETE SET NULL: this column never
   dangles if the document instance is removed.';
COMMENT ON COLUMN keystone.guardian.consent_executed_at IS
  'Spec 03b / 0310 (CT-116). When the consent document above was executed (signed). NULL means no
   consent is on file yet, regardless of whether a document instance has been attached.';
