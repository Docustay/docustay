-- 0348_import_run_id_tags_created_people
-- Task 6.4 — SetImport §2.5. Track which import_run created each person, for undo.
--
-- ★ When `runImportRun` creates a genuinely new app_user row, it TAGS the row with the
--   import_run_id. This enables undoImportRun to find exactly which rows to archive
--   when an import is undone. Existing rows (updated via fill_blank) have no tag and cannot
--   be precisely un-updated (no before-snapshot), so undo archives only created rows.

ALTER TABLE keystone.app_user
  ADD COLUMN created_by_import_run_id uuid REFERENCES keystone.import_run(id) ON DELETE SET NULL;

COMMENT ON COLUMN keystone.app_user.created_by_import_run_id IS
  'The import_run that created this person. Set only for newly created rows, never for updated ones. '
  'Enables undoImportRun to find the exact set of rows to archive when an import is reversed.';

-- Index for fast lookup: undoImportRun queries "which app_user rows match this import_run_id?"
CREATE INDEX app_user_created_by_import_run_idx
  ON keystone.app_user (tenant_id, created_by_import_run_id)
  WHERE created_by_import_run_id IS NOT NULL;
