-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0136 — HISTORY FINDS PEOPLE AND DOCUMENTS (Stage 3 Task 2, F474).
--
-- ★★★ THE MEASURED DEFECT. `src/records/queries.mjs` `ACTIVITY_SQL` reads a record's History tab by
--     `WHERE e.subject_type = $1 AND e.subject_id = $2`, and its own `ACTIVITY_SUBJECT` map says a
--     person's rows are `subject_type = 'person'` and a document's are `subject_type = 'document'`.
--     [MEASURED, recon §3] every write to a person before this task's application-code fix used
--     `app_user` (`people/writes.mjs`, `documents/writes.mjs`, `notifications/writes.mjs`) or `user`
--     (`permissions/writes.mjs`, `teams/writes.mjs`, `people/guardians.mjs`); every write to a
--     document used `document_instance` (`documents/writes.mjs`, `time/due.mjs`). So a person's or a
--     document's History tab was empty BY CONSTRUCTION — the two record types a coach opens most.
--
-- ★★ THIS MIGRATION IS THE ONE-TIME REPAIR FOR ROWS THAT ALREADY EXIST. The application code
--    (`emit()`, every writer, `records/archive.mjs`) was fixed first, in the same task, so this
--    migration is closing the gap for events already sitting in the table — 02-event-catalogue.md
--    §11: "existing `subject_type` values are migrated to the fixed vocabulary so old History
--    appears on records." This is explicitly THE ONE PERMITTED REWRITE of an old event: §11 also
--    says event `payload` is never rewritten in place, but `subject_type` is called out as the one
--    column that is, for exactly this reason.
--
-- ★★★ HOW A MIGRATION CAN TOUCH EVERY TENANT'S ROWS AT ALL (F490). `keystone.event` is
--     `ENABLE + FORCE ROW LEVEL SECURITY` under `tenant_isolation ON keystone.event USING (tenant_id
--     = current_tenant_id())` (0016), and `db/migrate.mjs` runs every file as `app_owner` with no
--     tenant GUC set — so a bare `UPDATE keystone.event SET subject_type = ...` here would match
--     ZERO rows in EVERY tenant and COMMIT SUCCESSFULLY having done nothing (F484's exact silent-
--     success shape, confirmed again in 0131). The fix is the same one 0131 used:
--       1. Enumerate every tenant as `auth_owner`, which holds `tenant_health_read FOR SELECT
--          USING (true)` on `keystone.tenant` (0017) — `app_owner` is a MEMBER of `auth_owner`, so
--          `SET LOCAL ROLE auth_owner` is permitted from here.
--       2. For EACH tenant, `SET LOCAL ROLE app_owner`, set `keystone.tenant_id` to that tenant, and
--          UPDATE under app_owner's own `tenant_isolation` policy, which now admits exactly that
--          tenant's rows.
--       3. Count BEFORE (a SELECT under the same per-tenant GUC, as app_owner) and rows actually
--          UPDATED, and assert they match, per tenant AND in total.
--    ★ Ids and tenant ids are collected into PL/pgSQL ARRAYS, not a temp table: a temp table created
--      while `SET LOCAL ROLE auth_owner` is in effect is OWNED BY auth_owner, and this session's
--      `app_owner` is NOINHERIT (17 Sep 2026 hardening) — it cannot read a table it does not own and
--      was not granted, so the temp table would be invisible the moment the role switches back. This
--      is the exact trap 0131's header documents having been caught by first.
--
-- ★ NO RESET ROLE (F482). `db/migrate.mjs` sets `app_owner` before this file runs and restores it
--   before the next one; a bare `RESET ROLE` would hand later objects to the connecting superuser.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $rewrite_subject_types$
DECLARE
  v_tenant_ids   uuid[];
  v_total_before integer := 0;
  v_total_after  integer := 0;
  v_tenant_id    uuid;
  v_before       integer;
  v_updated      integer;
  i              integer;
BEGIN
  -- 1 · EVERY TENANT, READ AS auth_owner (the one role with a platform-wide read on keystone.tenant).
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  -- 2 · PER TENANT, UNDER ITS OWN GUC: count what SHOULD change, change it, and check the two agree.
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    SELECT count(*) INTO v_before
      FROM keystone.event
     WHERE subject_type IN ('app_user', 'user', 'document_instance');

    UPDATE keystone.event
       SET subject_type = CASE subject_type
                             WHEN 'app_user'          THEN 'person'
                             WHEN 'user'               THEN 'person'
                             WHEN 'document_instance'  THEN 'document'
                           END
     WHERE subject_type IN ('app_user', 'user', 'document_instance');
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> v_before THEN
      RAISE EXCEPTION
        '0136: tenant % — expected to rewrite % row(s), rewrote % — the update did not reach every row it counted (RLS?)',
        v_tenant_id, v_before, v_updated;
    END IF;

    v_total_before := v_total_before + v_before;
    v_total_after  := v_total_after + v_updated;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_total_before <> v_total_after THEN
    RAISE EXCEPTION
      '0136: totals disagree — % counted before, % rewritten', v_total_before, v_total_after;
  END IF;

  -- 3 · NONE LEFT ANYWHERE. Re-read as auth_owner (event_health_read, 0129, FOR SELECT USING true)
  --     so "none left" is itself a read that CAN see every tenant's rows, not app_owner's own
  --     zero-with-no-GUC silent success repeating one layer up.
  SET LOCAL ROLE auth_owner;
  DECLARE
    v_remaining integer;
  BEGIN
    SELECT count(*) INTO v_remaining
      FROM keystone.event
     WHERE subject_type IN ('app_user', 'user', 'document_instance');
    IF v_remaining <> 0 THEN
      RAISE EXCEPTION
        '0136: % row(s) still carry a retired subject_type (app_user/user/document_instance) after the rewrite',
        v_remaining;
    END IF;
  END;
  SET LOCAL ROLE app_owner;

  RAISE NOTICE '0136: rewrote % event row(s) across % tenant(s) — app_user/user -> person, document_instance -> document',
    v_total_after, coalesce(array_length(v_tenant_ids, 1), 0);
END
$rewrite_subject_types$;
