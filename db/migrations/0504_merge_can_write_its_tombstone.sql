-- 0504_merge_can_write_its_tombstone
--
-- ★★★ WHAT BROKE (EXECUTED): merging two people always fails. `applyMerge`
--     (src/records/merge.mjs:~487) does `INSERT INTO keystone.person_merge_tombstone …`;
--     `undoMerge` SELECTs it (~575) and `UPDATE … SET undone_at = now()` (~616). The app's runtime
--     role `app_rw` had NO privilege on that table at all — MEASURED on keystone_dev:
--     `information_schema.role_table_grants` lists only `app_owner` as grantee for
--     `person_merge_tombstone` — so every merge raised `42501 permission denied for table
--     person_merge_tombstone` and the API answered 403 "insufficient privilege".
--
-- ★★ THE FIX: grant `app_rw` exactly what applyMerge/undoMerge actually do to this table — SELECT
--    (undoMerge's lookup), INSERT (applyMerge's tombstone row) and UPDATE (undoMerge's
--    `undone_at`). NOT DELETE: nothing in this file ever deletes a tombstone — it is a permanent
--    history row, only ever marked `undone_at` — matching the same reasoning
--    `0386_person_merge_dismissal.sql` already used for its own no-UPDATE grant, the other
--    direction.
--
-- ★ RLS CHECK (read from 0347_person_merge_tombstone.sql:42-49): the table carries ONE policy,
--   `tenant_scope`, written with no `FOR` clause — a policy with no `FOR` clause applies to ALL
--   commands (SELECT, INSERT, UPDATE, DELETE alike), and it already has both a USING and a WITH
--   CHECK clause on `tenant_id = keystone.current_tenant_id()`. That already covers INSERT and
--   UPDATE for any role holding the underlying table grant — there is no gap to fill and no new
--   policy is added here. The id column defaults from `keystone.uuid_generate_v7()`, not a
--   sequence/identity, so there is no USAGE grant to add either.
--
-- ★ Do NOT apply this migration here — migrations are applied separately, at step 3 of the build
--   process, through the runner (`node db/migrate.mjs`).

GRANT SELECT, INSERT, UPDATE ON keystone.person_merge_tombstone TO app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK — modelled on 0503's own self-check (has_table_privilege positive + negative control).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $merge_can_write_its_tombstone_self_check$
BEGIN
  IF NOT has_table_privilege('app_rw', 'keystone.person_merge_tombstone', 'SELECT') THEN
    RAISE EXCEPTION '0504: app_rw is missing SELECT on keystone.person_merge_tombstone — undoMerge''s lookup would still fail';
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.person_merge_tombstone', 'INSERT') THEN
    RAISE EXCEPTION '0504: app_rw is missing INSERT on keystone.person_merge_tombstone — applyMerge would still fail';
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.person_merge_tombstone', 'UPDATE') THEN
    RAISE EXCEPTION '0504: app_rw is missing UPDATE on keystone.person_merge_tombstone — undoMerge''s undone_at write would still fail';
  END IF;

  -- Positive control alongside the negative: DELETE must NOT be granted — nothing in
  -- src/records/merge.mjs ever deletes a tombstone, only inserts and marks it undone.
  IF has_table_privilege('app_rw', 'keystone.person_merge_tombstone', 'DELETE') THEN
    RAISE EXCEPTION '0504: app_rw must NOT hold DELETE on keystone.person_merge_tombstone — a tombstone is permanent history, only ever marked undone';
  END IF;
END
$merge_can_write_its_tombstone_self_check$;
