-- 0421_repair_0367_role_action_backfill
-- Found and written 25 Sep 2026, on the main thread, during Stage 14. Not a planned task.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ 0367's BACKFILL INSERTED NOTHING, REPORTED SUCCESS, AND HAS BEEN APPLIED SINCE.
--
--     `0367:86-126` loops over the built-in roles and gives each its named actions:
--
--         FOR role_rec IN
--           SELECT r.id, r.tenant_id, r.key FROM keystone.role r
--            WHERE r.is_builtin = true AND r.key IN ('owner','admin','coach')
--              AND NOT EXISTS (SELECT 1 FROM keystone.role_action ra WHERE ra.role_id = r.id)
--         LOOP …
--
--     ★★★ THAT SELECT RETURNS ZERO ROWS WHEN THE MIGRATION RUNS. Four facts, each MEASURED:
--       · `keystone.role` is `ENABLE` **and `FORCE` ROW LEVEL SECURITY` (`0066:208-209`). FORCE means
--         the table OWNER is filtered too — this is the same reasoning `0172`'s own header spells
--         out: "FORCE means the OWNER is filtered too, so `app_owner` with no GUC sees NOTHING."
--       · Its only policies are `tenant_isolation` / `tenant_insert` / `tenant_update`
--         (`0066:215-221`), all keyed on `keystone.current_tenant_id()`. There is no permissive
--         owner or guard policy on this table — grepped every migration.
--       · `db/migrate.mjs:179` does `SET ROLE app_owner`. The runner is NOT superuser, so RLS is not
--         bypassed.
--       · **0367 never sets `keystone.tenant_id`.** It has no `set_config` call and no per-practice
--         loop, so `current_tenant_id()` is NULL throughout and every row of `keystone.role` is
--         filtered out.
--     ★★ So the FOR loop body never executed once. No error, no warning — an empty loop is a
--        successful loop. This is F490's exact shape, and it is the failure mode CLAUDE.md warns
--        about for guards: **nothing supplied the condition the code was checking.**
--
-- ★★★ WHO IS ACTUALLY AFFECTED — AND IT IS NOT EVERYONE, WHICH IS WHY NOBODY SAW IT.
--     `keystone.seed_builtin_roles()` (the function, `0367:56`) inserts `role_action` rows itself and
--     runs **inside a tenant's own transaction** from the application's signup path, so **every
--     practice created after 0367 applied is correct.** Only practices that already existed at that
--     moment were meant to be repaired by the broken loop, and they were not. For those, the built-in
--     roles hold **no named actions at all** — so `person.create`, `team.invite`, `document.execute`,
--     `invoice.refund` and the rest are refused for their Owner as much as for anyone else.
--   ★ Production is Ty's own build environment (CLAUDE.md, 22 Sep 2026: not live, GLRS and test
--     practices only), which is why a silent, total loss of named actions on the older practices has
--     gone unnoticed rather than being reported as a product failure.
--
-- ★★★ WHY THIS IS A NEW MIGRATION AND NOT AN EDIT TO 0367. 0367 is APPLIED. Editing an applied
--     migration changes nothing in any database that has already run it and silently diverges the
--     file from reality — the repair has to be a forward step. 0367 is left exactly as it is, as the
--     record of what happened.
--
-- ★★ IDEMPOTENT, AND DELIBERATELY NOT A COPY OF 0367's GUARD. 0367 skipped any role that already had
--    **any** `role_action` row (`NOT EXISTS …`). Copying that would be wrong now: `0416` (task 14.9)
--    runs before this file and grants `loyalty.manage`/`gift_card.manage` to owner and admin, so
--    those roles DO have rows and 0367's guard would skip them while their other twelve actions
--    stayed missing. This file instead inserts each action individually with
--    `ON CONFLICT DO NOTHING`, so it repairs a partly-populated role and disturbs nothing 0416 added.
--
-- ★ NO SCHEMA CHANGE. No DDL at all — this migration only writes rows.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $repair$
DECLARE
  v_tenant_ids  uuid[];
  v_tenant_id   uuid;
  i             integer;
  v_role        record;
  v_action      text;
  v_expected    text[];
  v_have        integer;
  v_practices   integer := 0;
  v_repaired    integer := 0;
  -- ★ The three sets, copied VERBATIM from 0367:89-96 so this repair restores exactly what that
  --   migration intended — never a set someone re-derived from memory tonight.
  owner_actions text[] := ARRAY['person.create','team.invite','team.remove','staff_role.change',
    'document.sign','document.execute','template.author','record.archive','record.restore',
    'booking.waive_charge','discount.apply','invoice.refund','setting.billing'];
  admin_actions text[] := ARRAY['person.create','team.invite','team.remove','staff_role.change',
    'document.sign','document.execute','template.author','record.archive','record.restore',
    'booking.waive_charge','discount.apply','invoice.refund'];
  coach_actions text[] := ARRAY['person.create','template.author','document.sign'];
BEGIN
  -- ── 1 · EVERY PRACTICE, ENUMERATED AS auth_owner (F490) ────────────────────────────────────────
  -- ★★ THIS IS THE STEP 0367 SKIPPED. `app_owner` cannot see `keystone.tenant`'s rows either; 0172
  --    MEASURED the difference in production — app_owner → 0 practices, auth_owner → 3. Collected
  --    into a PL/pgSQL array rather than a temp table, because a temp table created under a borrowed
  --    role is owned by that role (0172's own note).
  SET LOCAL ROLE auth_owner;
  SELECT array_agg(t.id ORDER BY t.id) INTO v_tenant_ids FROM keystone.tenant t;
  SET LOCAL ROLE app_owner;

  v_practices := coalesce(array_length(v_tenant_ids, 1), 0);
  IF v_practices = 0 THEN
    RAISE EXCEPTION '0421: enumerated ZERO practices as auth_owner — that is the very blindness this migration exists to repair, so it must not proceed';
  END IF;

  -- ── 2 · PER PRACTICE, INSIDE ITS OWN TENANT CONTEXT ────────────────────────────────────────────
  FOR i IN 1 .. v_practices LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    -- ★★★ PROVE THE GUC TOOK BEFORE WRITING A SINGLE ROW. Without this line a future edit that
    --     breaks the context would reproduce 0367's own failure exactly — silently doing nothing.
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0421: tenant context did not take for practice % — refusing to write blind', v_tenant_id;
    END IF;

    FOR v_role IN
      SELECT r.id, r.key FROM keystone.role r
       WHERE r.is_builtin = true AND r.key IN ('owner', 'admin', 'coach')
    LOOP
      v_expected := CASE v_role.key
                      WHEN 'owner' THEN owner_actions
                      WHEN 'admin' THEN admin_actions
                      ELSE coach_actions
                    END;
      FOREACH v_action IN ARRAY v_expected LOOP
        INSERT INTO keystone.role_action (tenant_id, role_id, action)
        VALUES (v_tenant_id, v_role.id, v_action)
        ON CONFLICT (tenant_id, role_id, action) DO NOTHING;
      END LOOP;
      v_repaired := v_repaired + 1;
    END LOOP;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  RAISE NOTICE '0421: visited % practice(s), touched % built-in role(s).', v_practices, v_repaired;
END
$repair$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CLOSING PROOF — A SECOND, INDEPENDENT PASS, NOT THE WRITER'S OWN ROW COUNT.
--     0367 "succeeded" because nothing re-read what it claimed to have written. This block
--     re-enumerates every practice from scratch, re-enters each tenant context, and READS BACK.
--   ★★ It asserts the POSITIVE and the NEGATIVE together: every built-in role holds its full set
--      (positive), AND coach does not hold an owner-only action (negative). A repair that granted
--      everything to everyone would satisfy the positive half alone — which is exactly why the
--      negative half is here.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $prove$
DECLARE
  v_tenant_ids uuid[];
  v_tenant_id  uuid;
  i            integer;
  v_missing    integer;
  v_leaked     integer;
  v_checked    integer := 0;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT array_agg(t.id ORDER BY t.id) INTO v_tenant_ids FROM keystone.tenant t;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0421 proof: tenant context did not take for practice %', v_tenant_id;
    END IF;

    -- POSITIVE: an owner role with fewer than its thirteen named actions is a failed repair.
    SELECT count(*) INTO v_missing
      FROM keystone.role r
     WHERE r.is_builtin = true AND r.key = 'owner'
       AND (SELECT count(*) FROM keystone.role_action ra
             WHERE ra.role_id = r.id
               AND ra.action IN ('person.create','team.invite','team.remove','staff_role.change',
                 'document.sign','document.execute','template.author','record.archive',
                 'record.restore','booking.waive_charge','discount.apply','invoice.refund',
                 'setting.billing')) < 13;
    IF v_missing > 0 THEN
      RAISE EXCEPTION '0421 proof: practice % still has an owner role missing named actions', v_tenant_id;
    END IF;

    -- NEGATIVE, with the positive above as its control: coach must NOT hold an owner-only action.
    SELECT count(*) INTO v_leaked
      FROM keystone.role r
      JOIN keystone.role_action ra ON ra.role_id = r.id
     WHERE r.is_builtin = true AND r.key = 'coach'
       AND ra.action IN ('setting.billing', 'invoice.refund', 'team.remove');
    IF v_leaked > 0 THEN
      RAISE EXCEPTION '0421 proof: practice % granted a coach an owner-only action — the repair over-granted', v_tenant_id;
    END IF;

    v_checked := v_checked + 1;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  IF v_checked = 0 THEN
    RAISE EXCEPTION '0421 proof: checked zero practices — the proof proved nothing';
  END IF;
  RAISE NOTICE '0421: proved % practice(s) — every built-in owner holds its 13 named actions, no coach holds an owner-only one.', v_checked;
END
$prove$;
