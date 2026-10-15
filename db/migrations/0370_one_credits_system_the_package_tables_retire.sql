-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0370 — ONE CREDITS SYSTEM: `package_balance` AND `package_credit` RETIRE. (Stage 11, task 11.7,
-- CT-F03, D2.)
--
-- ★★★ `entitlement` / `entitlement_credit` IS THE ONE CREDITS SYSTEM. `package_balance` and
--     `package_credit` (migration 0013) are the earlier, unused system: reserve happens at booking
--     (`createBooking.mjs:257`), consumption at completion (`attendance.mjs:303`), return on cancel
--     (`createBooking.mjs:297`) — all three already on entitlements, and `spendCredit`
--     (`createBooking.mjs`, the only writer `package_credit` ever had in `src/`) is deleted by this
--     same task. §1 below RE-ASSERTS, PER PRACTICE, AT APPLY TIME, that both tables are empty
--     everywhere — this file refuses to retire a table that still holds a row.
--
-- ★★ RETIRE, NOT DROP. "Beyond the application's reach" here means `REVOKE ALL PRIVILEGES … FROM
--    app_rw` — the role every application connection runs as — not `DROP TABLE`. The DROP is
--    **deliberately a separate, later migration** (0496, reserved in CONTRACTS.md; S11-OQ-7):
--    revoking a privilege is reversible, a DROP is not, and there is no benefit to reclaiming two
--    empty tables tonight. Policies, indexes and both guard triggers on each table are UNCHANGED.
--
-- ★ NOT MARKED `-- keystone:one-way`. It destroys no information — nothing is deleted, nothing is
--   dropped, and a privilege revoked here can be re-granted. The runner's one-way flag exists for a
--   migration a restored backup cannot undo (`db/migrate.mjs:21-25`); this is not that.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §1 · PER-PRACTICE EMPTINESS CHECK — 0172's pattern (`0172_idempotency_redaction_backfill.sql:84-`
--     `140`), copied rather than re-derived: enumerate every practice as `auth_owner`
--     (`tenant_health_read`, 0172:72-74), then per practice `SET LOCAL ROLE app_owner`, set the
--     tenant GUC, PROVE it took, and count under that practice's own policies. Abort rather than
--     retire a table that still holds a row anywhere.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $retire_package_tables$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_count integer;
  v_tenant_id    uuid;
  v_balance_n    bigint;
  v_credit_n     bigint;
  i              integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0370: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0370: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- ★ The `tenant_id = current_tenant_id()` predicate is required, not belt-and-braces (0172:128-
    --   134): `reference_guard_read` (0133) is OR'd in as a second permissive SELECT policy, and
    --   without the predicate the reference practice's rows would be counted again from inside
    --   every other practice's turn.
    SELECT count(*) INTO v_balance_n
      FROM keystone.package_balance b
     WHERE b.tenant_id = keystone.current_tenant_id();
    SELECT count(*) INTO v_credit_n
      FROM keystone.package_credit c
     WHERE c.tenant_id = keystone.current_tenant_id();

    IF v_balance_n > 0 OR v_credit_n > 0 THEN
      RAISE EXCEPTION '0370 found live package rows; a data move to entitlement must be written before these tables can be retired — practice % holds % package_balance row(s) and % package_credit row(s)',
        v_tenant_id, v_balance_n, v_credit_n;
    END IF;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0370: % practice(s) checked — package_balance and package_credit are empty everywhere',
    v_tenant_count;
END
$retire_package_tables$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §2 · BEYOND THE APPLICATION'S REACH. `app_rw` (measured today: DELETE, INSERT, SELECT, UPDATE on
--     both, granted by 0013:303) loses every privilege on both tables. `app_owner`'s ownership
--     privileges and `reference_guard`'s SELECT are untouched, so the reference guard and the
--     migration runner (which always runs as `app_owner`) are unaffected. Policies, indexes and the
--     guard triggers on each table stay exactly as they are.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL PRIVILEGES ON keystone.package_credit  FROM app_rw;
REVOKE ALL PRIVILEGES ON keystone.package_balance FROM app_rw;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §3 · THE LABEL.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE keystone.package_credit IS
  'RETIRED 25 Sep 2026 (CT-F03, D2) — entitlement/entitlement_credit is the one credits system. app_rw has no privilege here; nothing in src/ reads or writes it. Empty on every practice when retired. DROP is a separate, later migration, deliberately not bundled with the retirement.';
COMMENT ON TABLE keystone.package_balance IS
  'RETIRED 25 Sep 2026 (CT-F03, D2) — entitlement/entitlement_credit is the one credits system. app_rw has no privilege here; nothing in src/ reads or writes it. Empty on every practice when retired. DROP is a separate, later migration, deliberately not bundled with the retirement.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §4 · SELF-CHECK — an independent re-read, not the counters above. `app_rw` holds zero privileges
--     on either retired table, with a POSITIVE CONTROL in the same block
--     (`keystone.entitlement_credit` still SELECTable by `app_rw`) so a check that answered false
--     for everything cannot pass; and both tables still exist (retire, not drop).
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $package_tables_retired_not_dropped$
BEGIN
  IF has_table_privilege('app_rw', 'keystone.package_credit', 'SELECT')
     OR has_table_privilege('app_rw', 'keystone.package_credit', 'INSERT')
     OR has_table_privilege('app_rw', 'keystone.package_credit', 'UPDATE')
     OR has_table_privilege('app_rw', 'keystone.package_credit', 'DELETE') THEN
    RAISE EXCEPTION '0370: app_rw still holds a privilege on keystone.package_credit after REVOKE';
  END IF;

  IF has_table_privilege('app_rw', 'keystone.package_balance', 'SELECT')
     OR has_table_privilege('app_rw', 'keystone.package_balance', 'INSERT')
     OR has_table_privilege('app_rw', 'keystone.package_balance', 'UPDATE')
     OR has_table_privilege('app_rw', 'keystone.package_balance', 'DELETE') THEN
    RAISE EXCEPTION '0370: app_rw still holds a privilege on keystone.package_balance after REVOKE';
  END IF;

  -- ★★★ POSITIVE CONTROL — a check that answered false for every privilege above cannot pass this
  --     block if `entitlement_credit` were also (wrongly) unreadable.
  IF NOT has_table_privilege('app_rw', 'keystone.entitlement_credit', 'SELECT') THEN
    RAISE EXCEPTION '0370: positive control failed — app_rw cannot SELECT keystone.entitlement_credit, so the checks above prove nothing';
  END IF;

  IF to_regclass('keystone.package_credit') IS NULL OR to_regclass('keystone.package_balance') IS NULL THEN
    RAISE EXCEPTION '0370: a package table is gone — this migration retires, it does not drop';
  END IF;

  RAISE NOTICE '0370: confirmed — app_rw holds no privilege on package_credit or package_balance; entitlement_credit is unaffected; both retired tables still exist';
END
$package_tables_retired_not_dropped$;
