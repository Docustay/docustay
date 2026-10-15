-- 0503 — signup_seeds_the_living_lists
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT BROKE (MEASURED): every new-practice signup fails. `runCriticalPrefix()`
--     (src/provisioning/prefix.mjs:215) calls `seedLivingSegments(db, tenantId)`
--     (src/growth/campaigns.mjs:405), which did a plain `INSERT INTO keystone.segment …` on the
--     SIGNUP connection (role `app_signup`). `app_signup` holds no INSERT/SELECT on
--     `keystone.segment` — MEASURED on the production copy:
--       has_table_privilege('app_signup', 'keystone.segment', 'INSERT') = f
--     — so the whole signup transaction failed with "permission denied for table segment".
--
-- ★★ THE FIX MIRRORS `keystone.seed_units` EXACTLY (db/migrations/0409_service_category_and_unit.sql,
--    §C, ~lines 270-325): a SECURITY DEFINER plpgsql function, owned the same way, with a fixed
--    `search_path = ''` (db/gates/p21a_definer_search_path.mjs requires the empty search_path on
--    every definer), a guard that refuses unless `keystone.current_tenant_id()` equals the argument
--    ("a caller may only seed the tenant it is already inside" — copied verbatim in spirit from
--    `seed_units`'s own guard, which itself copies `keystone.seed_builtin_roles`'s), the INSERT with
--    `ON CONFLICT DO NOTHING`, and returns the inserted row count.
--
--    DEFINER for the SAME reason as `seed_units`: the signup role cannot read back what it inserts,
--    and here it cannot even INSERT at all — `app_signup` has no grant whatsoever on
--    `keystone.segment` (0061_growth.sql never granted it one; only `app_rw` and `app_owner`-driven
--    paths were ever meant to touch `keystone.segment`).
--
--    The six rows, their names, their `filter` jsonb and their `seed_key`s are copied VERBATIM from
--    `seedLivingSegments()` in src/growth/campaigns.mjs (today) and from 0455_seed_living_segments.sql's
--    own backfill of the same six rows — one definition, not three that can drift apart.
--
-- ★ REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO app_rw, app_signup — same as `seed_units`.
--   `app_rw` gets it too so the same function can be called from an already-active practice's own
--   context (e.g. an admin re-running provisioning) without a second code path.
--
-- ★ Do NOT apply this migration here — migrations are applied separately, at step 3 of the build
--   process, through the runner (`node db/migrate.mjs`).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.seed_living_segments(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_inserted integer := 0;
BEGIN
  IF p_tenant_id IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION
      'seed_living_segments refused: asked to seed tenant % while the transaction is in tenant % — '
      'a caller may only seed the tenant it is already inside',
      p_tenant_id, coalesce(keystone.current_tenant_id()::text, '(none)');
  END IF;

  INSERT INTO keystone.segment (tenant_id, name, filter, seed_key, created_by, created_at, updated_at)
  VALUES
    (p_tenant_id, 'Everyone',
     '{"role":["adult_client","adolescent_client","parent"],"has_email":true}'::jsonb,
     'everyone', NULL, now(), now()),
    (p_tenant_id, 'Gone quiet',
     '{"role":["adult_client","adolescent_client"],"quiet_days":42}'::jsonb,
     'gone_quiet', NULL, now(), now()),
    (p_tenant_id, 'Block running low',
     '{"credits_remaining_lte":2}'::jsonb,
     'block_low', NULL, now(), now()),
    (p_tenant_id, 'Owing money',
     '{"owes_money":true}'::jsonb,
     'owing', NULL, now(), now()),
    (p_tenant_id, 'Never booked',
     '{"never_booked":true}'::jsonb,
     'never_booked', NULL, now(), now()),
    (p_tenant_id, 'On the waitlist',
     '{"on_waitlist":true}'::jsonb,
     'waitlist', NULL, now(), now())
  ON CONFLICT (tenant_id, seed_key) WHERE seed_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted;
END;
$fn$;

REVOKE ALL ON FUNCTION keystone.seed_living_segments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.seed_living_segments(uuid) TO app_rw, app_signup;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK — modelled on 0409's own self-check for `keystone.seed_units`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $seed_living_segments_self_check$
BEGIN
  IF to_regprocedure('keystone.seed_living_segments(uuid)') IS NULL THEN
    RAISE EXCEPTION '0503: keystone.seed_living_segments(uuid) does not exist';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'keystone.seed_living_segments(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '0503: keystone.seed_living_segments is not SECURITY DEFINER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc, unnest(coalesce(proconfig, ARRAY[]::text[])) AS cfg
     WHERE oid = 'keystone.seed_living_segments(uuid)'::regprocedure
       AND cfg = 'search_path=""'
  ) THEN
    RAISE EXCEPTION '0503: keystone.seed_living_segments does not have search_path pinned to '''' ';
  END IF;

  -- ★★★ the exact defect this migration fixes: app_signup must be able to EXECUTE the definer,
  --     which is the path around its total absence of privilege on keystone.segment itself.
  IF NOT has_function_privilege('app_signup', 'keystone.seed_living_segments(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0503: app_signup is missing EXECUTE on keystone.seed_living_segments — signup would still fail';
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.seed_living_segments(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0503: app_rw is missing EXECUTE on keystone.seed_living_segments';
  END IF;

  -- Positive control: app_signup still holds no direct privilege on the table itself — the
  -- definer function, not a widened grant, is the path around the defect.
  IF has_table_privilege('app_signup', 'keystone.segment', 'INSERT') THEN
    RAISE EXCEPTION '0503: app_signup must NOT hold direct INSERT on keystone.segment — the definer function is the only path';
  END IF;
END
$seed_living_segments_self_check$;
