-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0435 — invoice.refund LEAVES THE BUILT-IN ADMIN ROLE, BY DEFAULT (D6). Stage 15 task 15.12.
--
-- F08 §4.2 and the SetRoles frame's own sentence ("Refunds need a second pair of eyes") — a refund
-- becomes Owner-only BY DEFAULT. **A DEFAULT, not a hard-coded refusal**: a practice may grant
-- `invoice.refund` back to its Admin role at `POST /api/settings/roles/action {roleId, action:
-- "invoice.refund", granted:true}`, and that Admin's next refund executes — nothing downstream
-- tests a role KEY; `assertMay` is asked the grant question and answers a re-granted Admin yes.
--
-- ★★★ THE OWNER IS NEVER TOUCHED, AND THAT IS THE WHOLE POINT OF THIS FILE'S SHAPE. This migration
--     DELETEs ONLY `keystone.role_action` rows belonging to the BUILT-IN `admin` role. the maintainer
--     (the maintainer) is the Owner of every practice and must never be locked out of
--     a refund — the closing assertion below has TWO halves for exactly this reason: zero
--     builtin-admin `invoice.refund` rows remain, AND the Owner's `invoice.refund` row count is
--     UNCHANGED, per practice. The second half is the positive control that makes the first half
--     safe — a self-check that only asserts an absence proves nothing about what should still be
--     true.
--
-- ★★ BUILD-TIME CONFIRMATIONS — SOURCE ANALYSIS ONLY. The BUILD role that wrote this file may not
--    connect to any database, local or deployed, so both of the following are MEASURED from the
--    migration files themselves, never EXECUTED against a database:
--
--   (1) DOES app_owner HOLD A DELETE GRANT ON keystone.role_action?
--       `GRANT SELECT, INSERT, DELETE ON keystone.role_action TO app_rw;` (0190:99) names app_rw,
--       not app_owner. But `keystone.role_action` is OWNED by app_owner: `db/migrate.mjs` runs
--       every migration file as app_owner (`SET ROLE app_owner`, :179,317), so 0190's
--       `CREATE TABLE keystone.role_action` — executed as app_owner — made app_owner the table's
--       OWNER, and a table owner holds every privilege on its own table implicitly (DELETE
--       included) unless explicitly revoked. `grep -n "REVOKE" db/migrations/0190_*.sql` returns
--       nothing, and no later migration revokes anything from app_owner on this table
--       (`grep -rl "REVOKE.*app_owner" db/migrations/*.sql` names none that mention role_action).
--       CONCLUSION: app_owner can DELETE here — INFERRED from Postgres ownership semantics plus the
--       absence of any REVOKE, not EXECUTED against a database.
--
--   (2) DOES refuse_touch_reference_rows GUARD keystone.role_action FOR THE REFERENCE PRACTICE?
--       That trigger (0099) is attached to a table by an explicit
--       `CREATE TRIGGER … EXECUTE FUNCTION keystone.refuse_touch_reference_rows()` written INTO
--       that table's own creating migration — the convention every table-creating migration from
--       0381 onward follows verbatim (e.g. 0381:64-69, `location_refuse_reference_delete_trg`).
--       `grep -rl "refuse_touch_reference_rows" db/migrations/*.sql` lists 0099, 0100, 0133, 0144,
--       0151, 0189, 0369, 0381, 0382, 0385, 0386, 0400-0402, 0408-0412, 0414, 0415, 0417-0419, 0431
--       — 0190 (which creates `keystone.role`, `keystone.role_permission` and `keystone.role_action`
--       together) is NOT in that list, and no later migration attaches the trigger to `role_action`
--       either. `role_action` is also absent from `db/gates/catalog-conformance.mjs`'s `EXEMPT` map
--       (:1165-1196), which is where this project records every DELIBERATE exception the gate
--       already knows about — so this is not a named, ruled exemption, just an apparent gap this
--       task did not create and is not scoped to fix.
--       CONCLUSION: `keystone.role_action` carries NO `refuse_touch_reference_rows` trigger.
--       Therefore this migration does NOT skip the reference practice — the loop below runs over
--       EVERY practice enumerated from `keystone.tenant`, reference practice included, and the
--       closing assertion excludes none.
--
-- ★★ THE LOOP IS 0172's (`db/migrations/0172_idempotency_redaction_backfill.sql`), COPIED, NOT
--    RE-DERIVED: `keystone.role_action` is ENABLE + FORCE row level security (0190:85-86), so no
--    role this migration may assume can see it without a tenant GUC — enumerate practice ids as
--    auth_owner (0017's `tenant_health_read`; app_owner's own reference-practice-only visibility
--    would undercount), then per practice `SET LOCAL ROLE app_owner` + `set_config
--    ('keystone.tenant_id', …, true)`, prove the GUC took, act, and verify.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- A snapshot of the Owner's invoice.refund row count, taken BEFORE the delete runs, per practice —
-- what the closing block's positive control is measured against. Created while running as
-- app_owner (the ambient role db/migrate.mjs sets before this file starts), read back by the same
-- role in the closing block below, in the same transaction (db/migrate.mjs wraps each file in its
-- own BEGIN/COMMIT) — never the enumeration role, auth_owner, whose temp tables app_owner (NOINHERIT
-- toward auth_owner) could not read back.
CREATE TEMP TABLE _0435_owner_refund_before (tenant_id uuid PRIMARY KEY, n integer NOT NULL) ON COMMIT DROP;

DO $admin_refund_is_an_owner_decision$
DECLARE
  v_tenant_ids        uuid[];
  v_tenant_count      integer;
  v_tenant_id         uuid;
  v_owner_before      integer;
  v_owner_after       integer;
  v_admin_before      integer;
  v_admin_deleted     integer;
  v_total_deleted     bigint := 0;
  v_practices_changed integer := 0;
  i                   integer;
BEGIN
  -- 1 · EVERY PRACTICE, ENUMERATED AS auth_owner (0172:96-110, F490).
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0435: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  -- 2 · PER PRACTICE: SET THE GUC, PROVE IT TOOK, SNAPSHOT THE OWNER, DELETE THE ADMIN ROW, VERIFY.
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0435: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- ★★★ THE SNAPSHOT — taken BEFORE anything is deleted, and what makes the closing block's
    --     "unchanged" claim a real comparison rather than a re-statement of the same read.
    SELECT count(*) INTO v_owner_before
      FROM keystone.role_action ra JOIN keystone.role r ON r.id = ra.role_id
     WHERE r.tenant_id = v_tenant_id AND r.key = 'owner' AND r.is_builtin AND ra.action = 'invoice.refund';
    INSERT INTO _0435_owner_refund_before (tenant_id, n) VALUES (v_tenant_id, v_owner_before);

    SELECT count(*) INTO v_admin_before
      FROM keystone.role_action ra JOIN keystone.role r ON r.id = ra.role_id
     WHERE r.tenant_id = v_tenant_id AND r.key = 'admin' AND r.is_builtin AND ra.action = 'invoice.refund';

    DELETE FROM keystone.role_action ra USING keystone.role r
     WHERE ra.role_id = r.id
       AND r.tenant_id = v_tenant_id
       AND r.key = 'admin'
       AND r.is_builtin
       AND ra.action = 'invoice.refund';
    GET DIAGNOSTICS v_admin_deleted = ROW_COUNT;

    IF v_admin_deleted <> v_admin_before THEN
      RAISE EXCEPTION '0435: practice % — expected to delete % builtin-admin invoice.refund row(s), deleted % — the delete did not reach every row it counted (RLS?)',
        v_tenant_id, v_admin_before, v_admin_deleted;
    END IF;

    -- ★★★ IMMEDIATE SANITY, SAME LOOP TURN — an admin-scoped DELETE must never move the Owner's row.
    SELECT count(*) INTO v_owner_after
      FROM keystone.role_action ra JOIN keystone.role r ON r.id = ra.role_id
     WHERE r.tenant_id = v_tenant_id AND r.key = 'owner' AND r.is_builtin AND ra.action = 'invoice.refund';
    IF v_owner_after <> v_owner_before THEN
      RAISE EXCEPTION '0435: practice % — the OWNER''S invoice.refund row count changed (% before, % after) — this migration must never touch the Owner role',
        v_tenant_id, v_owner_before, v_owner_after;
    END IF;

    IF v_admin_deleted > 0 THEN
      v_practices_changed := v_practices_changed + 1;
    END IF;
    v_total_deleted := v_total_deleted + v_admin_deleted;
  END LOOP;

  -- ★ Transaction-local GUC would unwind anyway; cleared explicitly so nothing later in this
  --   transaction runs under the last practice's context.
  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0435: % practice(s) enumerated · % builtin-admin invoice.refund row(s) deleted · % practice(s) held one · every Owner row confirmed unchanged in the same turn',
    v_tenant_count, v_total_deleted, v_practices_changed;
END
$admin_refund_is_an_owner_decision$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CLOSING ASSERTION — AN INDEPENDENT RE-READ (0172:194-206), NOT THE COUNTERS ABOVE. It
--     re-enumerates the practices AGAIN as auth_owner and re-reads each one under its own GUC as
--     app_owner, so a bug in the loop above (wrong WHERE clause, a role key typo) is not simply
--     re-asked the same question through the same variables.
--
--   TWO HALVES, BOTH REQUIRED, PER PRACTICE:
--     HALF 1 — zero builtin-admin `invoice.refund` rows remain (what should be ABSENT).
--     HALF 2 — POSITIVE CONTROL — the Owner's `invoice.refund` row count now equals the snapshot
--       taken before the delete ran, `_0435_owner_refund_before` (what should still be TRUE). A
--       self-check that only asserts an absence is exactly the shape MEASURED tonight in 0409 —
--       a self-check that forbade the very path its own stage was building. This file's assertion
--       is never that shape: the second half asserts a fact holds, not only that one is missing.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $admin_refund_owner_untouched_and_admin_clear$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_id    uuid;
  v_n            integer;
  v_snapshot     integer;
  v_admin_left   bigint := 0;
  v_owner_now    bigint := 0;
  v_owner_before bigint := 0;
  v_practices    integer := 0;
  i              integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0435: the tenant context did not take effect for practice % during the closing re-read (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;
    v_practices := v_practices + 1;

    -- HALF 1 — zero builtin-admin invoice.refund rows remain.
    SELECT count(*) INTO v_n
      FROM keystone.role_action ra JOIN keystone.role r ON r.id = ra.role_id
     WHERE r.tenant_id = v_tenant_id AND r.key = 'admin' AND r.is_builtin AND ra.action = 'invoice.refund';
    v_admin_left := v_admin_left + v_n;

    -- HALF 2 — the Owner's row count now, versus the snapshot taken before the delete.
    SELECT count(*) INTO v_n
      FROM keystone.role_action ra JOIN keystone.role r ON r.id = ra.role_id
     WHERE r.tenant_id = v_tenant_id AND r.key = 'owner' AND r.is_builtin AND ra.action = 'invoice.refund';
    v_owner_now := v_owner_now + v_n;

    SELECT n INTO v_snapshot FROM _0435_owner_refund_before WHERE tenant_id = v_tenant_id;
    IF v_snapshot IS NULL THEN
      RAISE EXCEPTION '0435: practice % has no owner-refund snapshot from the first pass — the two loops did not see the same practices',
        v_tenant_id;
    END IF;
    v_owner_before := v_owner_before + v_snapshot;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_admin_left <> 0 THEN
    RAISE EXCEPTION '0435: % builtin-admin role(s) still hold invoice.refund across % practice(s) — the default did not take',
      v_admin_left, v_practices;
  END IF;

  IF v_owner_now <> v_owner_before THEN
    RAISE EXCEPTION '0435: the OWNER''S invoice.refund row count changed across the % practice(s) checked (% before, % now) — the positive control failed: an Owner may have lost invoice.refund',
      v_practices, v_owner_before, v_owner_now;
  END IF;

  RAISE NOTICE '0435: confirmed — 0 builtin-admin invoice.refund row(s) remain across % practice(s); the Owner''s invoice.refund row count is unchanged (% before = % now)',
    v_practices, v_owner_before, v_owner_now;
END
$admin_refund_owner_untouched_and_admin_clear$;
