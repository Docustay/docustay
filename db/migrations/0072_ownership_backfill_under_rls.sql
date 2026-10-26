-- 0072 — P1.4 · THE BACKFILL 0071 THOUGHT IT DID.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ A DATA BACKFILL IN A MIGRATION SILENTLY AFFECTS ZERO ROWS ON ANY TABLE WITH FORCE RLS.
--
--     `db/migrate.mjs:93` runs every migration as **`app_owner`** — deliberately, so that a
--     migration cannot quietly rely on superuser powers the application does not have. And FORCE ROW
--     LEVEL SECURITY applies **to the table owner too**. A migration sets no `keystone.tenant_id`,
--     so `current_tenant_id()` is NULL, so `tenant_isolation` — `tenant_id = current_tenant_id()` —
--     matches **nothing**.
--
--     0071 ended with:
--         UPDATE keystone.app_user SET owner_user_id = id WHERE role = 'staff' AND owner_user_id IS NULL;
--     [EXECUTED as app_owner] `UPDATE 0`. **No error. Migration reported ok.** Fourteen staff rows
--     were left with a null owner, which — via `scope_allows` — means every one of them would have
--     been unable to edit their own profile under "Owned only".
--
--   ★★★ THIS IS D-17.19's SIGNATURE FAILURE ARRIVING IN A MIGRATION: *"three UPDATEs matched
--       nothing, raised nothing, and the caller reported success."* The same shape that
--       `setSetting()` and `reparentTeam()` were written to refuse, in the one place nobody thought
--       to look, because `migrate.mjs` prints `ok` for a statement that did nothing.
--
--   ★ MEASURED, and NOT over-claimed: the seven older migrations containing a top-level backfill are
--     NOT affected. `app_user` did not get FORCE RLS until 0019/0021, well after 0010's backfill, and
--     [EXECUTED] there are **0** staff rows with a null `staff_role` and **0** provisioning_steps
--     whose run has a tenant while the step does not. **The hazard is live for every backfill
--     written from now on, not a defect sitting in the existing ones.**
--
-- ★★ THE FIX IS TO RESPECT RLS, NOT TO EVADE IT. `SET LOCAL row_security = off` would work and needs
--    BYPASSRLS; `NO FORCE ROW LEVEL SECURITY` would work and leaves the table exposed if the
--    migration fails halfway. Looping the tenants and setting the GUC is what the APPLICATION does,
--    so the backfill runs under exactly the policies everything else runs under.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $backfill$
DECLARE
  t          record;
  v_updated  integer := 0;
  v_rows     integer;
  v_expected integer;
BEGIN
  -- ★★★ COUNT WHAT SHOULD CHANGE **BEFORE** CHANGING IT, so the assertion at the end has something
  --     to compare against. Without this the DO block would be as silent as the statement it
  --     replaces — a loop that updates nothing looks exactly like a loop with nothing to update.
  --   ★ Counted as the DEFINER of this block (app_owner, no GUC) would also see zero, so it is
  --     counted per-tenant inside the loop instead and accumulated below.
  v_expected := 0;
  FOR t IN SELECT id FROM keystone.tenant LOOP
    PERFORM set_config('keystone.tenant_id', t.id::text, true);
    SELECT count(*) INTO v_rows FROM keystone.app_user
      WHERE role = 'staff' AND owner_user_id IS NULL;
    v_expected := v_expected + v_rows;
  END LOOP;

  FOR t IN SELECT id FROM keystone.tenant LOOP
    -- ★ `true` = LOCAL: the setting is scoped to this transaction and unwinds with it, so a failure
    --   half way cannot leave a connection pinned to some tenant's context.
    PERFORM set_config('keystone.tenant_id', t.id::text, true);
    UPDATE keystone.app_user SET owner_user_id = id
     WHERE role = 'staff' AND owner_user_id IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_updated := v_updated + v_rows;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  -- ★★★ AND IT REFUSES TO PASS QUIETLY. If the counts disagree the backfill did not do what it
  --     measured, and the migration ABORTS rather than reporting `ok` over a no-op — which is the
  --     entire lesson of this file.
  IF v_updated <> v_expected THEN
    RAISE EXCEPTION
      'ownership backfill updated % row(s) but % needed it — a backfill that changes fewer rows '
      'than it measured has hit a policy, not a shortage of work',
      v_updated, v_expected
      USING ERRCODE = 'check_violation';
  END IF;

  RAISE NOTICE 'ownership backfill: % staff row(s) now own themselves', v_updated;
END;
$backfill$;

-- ★★ AND A STANDING ASSERTION, because the trigger only fires on INSERT/UPDATE and says nothing
--    about rows that existed before it. A staff row with no owner is not a data-quality nit — it is
--    a person who cannot edit their own profile under "Owned only", and it would present as a
--    permission bug with no obvious cause.
DO $verify$
DECLARE
  t      record;
  v_bad  integer := 0;
  v_rows integer;
BEGIN
  FOR t IN SELECT id FROM keystone.tenant LOOP
    PERFORM set_config('keystone.tenant_id', t.id::text, true);
    SELECT count(*) INTO v_rows FROM keystone.app_user
      WHERE role = 'staff' AND owner_user_id IS NULL;
    v_bad := v_bad + v_rows;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'after the backfill, % staff row(s) still have no owner', v_bad
      USING ERRCODE = 'check_violation';
  END IF;
END;
$verify$;
