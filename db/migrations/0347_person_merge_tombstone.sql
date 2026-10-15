-- 0347_person_merge_tombstone
-- R2 (Round Two) — merge duplicates. The tombstone table recording every merge for 30-day undo.
--
-- ★★★ EVERY MERGE IS REVERSIBLE FOR 30 DAYS. A survivor and loser are chosen, every child row
--     reparents to the survivor, and the loser is archived. The `reparented` snapshot records
--     exactly which rows moved (table, column, ids), so `undoMerge` can reverse it precisely
--     without guessing. After 30 days the undo window closes and the merge becomes permanent.

CREATE TABLE keystone.person_merge_tombstone (
  id                uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id         uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  loser_id          uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  survivor_id       uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  merged_at         timestamptz NOT NULL DEFAULT now(),
  merged_by         uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  undo_deadline     timestamptz NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  undone_at         timestamptz,
  reparented        jsonb       NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE keystone.person_merge_tombstone IS
  'Every merge of two people: the survivor, the loser, who did it, when, and exactly what child rows moved. '
  'The reparented snapshot (array of {table, column, ids: [...]}) enables precise undo within 30 days.';

COMMENT ON COLUMN keystone.person_merge_tombstone.loser_id IS
  'The person who was merged away. Archived on merge; restored if undo happens within the deadline.';

COMMENT ON COLUMN keystone.person_merge_tombstone.survivor_id IS
  'The person who survives the merge and becomes the redirect target for the old loser id.';

COMMENT ON COLUMN keystone.person_merge_tombstone.undo_deadline IS
  'The last moment undo can reverse this merge. After this time, the merge is permanent.';

COMMENT ON COLUMN keystone.person_merge_tombstone.undone_at IS
  'NULL while the merge stands. Set to now() when undo is executed, closing this record forever.';

COMMENT ON COLUMN keystone.person_merge_tombstone.reparented IS
  'Array of {table: string, column: string, ids: uuid[]} objects, one per (table, column) pair in the '
  'FK inventory that had at least one row reparented. Enables undo to reverse exactly what changed.';

-- ★ RLS: FORCE ROW LEVEL SECURITY scoped to tenant_id, matching every other table in this schema.
ALTER TABLE keystone.person_merge_tombstone ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.person_merge_tombstone FORCE  ROW LEVEL SECURITY;

-- The predicate: current tenant can see its own merge records.
CREATE POLICY tenant_scope ON keystone.person_merge_tombstone
  USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.current_tenant_id());

CREATE INDEX person_merge_tombstone_tenant_idx
  ON keystone.person_merge_tombstone (tenant_id);

CREATE INDEX person_merge_tombstone_loser_idx
  ON keystone.person_merge_tombstone (tenant_id, loser_id)
  WHERE undone_at IS NULL;
