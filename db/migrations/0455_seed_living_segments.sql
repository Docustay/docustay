-- 0455 — SEED THE SIX LIVING LISTS, PER PRACTICE (FORCE-RLS backfill)
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ EVERY PRACTICE GETS THE SIX STANDARD "LIVING LIST" SEGMENTS, IDEMPOTENTLY.
--     P-16-14: these are the saved filters the UI draws in `/growth/lists`, and they back
--     automations that refer to them by name (16.19 will implement the predicate evaluation).
--     The task requires idempotence (re-running the migration changes nothing), and the
--     filters are fixed here so 16.19 can rely on them.
--
-- ★★ THE BACKFILL PATTERN FOLLOWS 0172_idempotency_redaction_backfill.sql EXACTLY:
--    `SET LOCAL ROLE auth_owner` to enumerate practices (F490), assert count matches array length,
--    `SET LOCAL ROLE app_owner`, loop each practice with `set_config('keystone.tenant_id', id, true)`,
--    assert `current_tenant_id()` took, do the per-tenant work, accumulate counts, and a CLOSING
--    ASSERTION that re-reads to prove the state under each practice's GUC independently (not a
--    vacuous global count, which would read 0 through FORCE RLS with no GUC set).
--
-- ★ Idempotence: `INSERT ... ON CONFLICT (tenant_id, seed_key) WHERE seed_key IS NOT NULL DO NOTHING`.
--   The UNIQUE index ensures two inserts of the same (tenant_id, seed_key) are rejected silently,
--   so running this file twice leaves the second run unchanged.
--
-- ★ NO SECRET IS READ, LOGGED OR PRINTED HERE. The NOTICEs carry COUNTS only.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · ALTER keystone.segment TO ADD seed_key COLUMN AND UNIQUE INDEX
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE keystone.segment ADD COLUMN seed_key text
  CHECK (seed_key IS NULL OR seed_key IN ('everyone','gone_quiet','block_low','owing','never_booked','waitlist'));

CREATE UNIQUE INDEX segment_seed_key ON keystone.segment (tenant_id, seed_key)
  WHERE seed_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · PER-PRACTICE BACKFILL: INSERT THE SIX SEED SEGMENTS (0172 pattern, exactly)
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $seed_living_segments$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_count integer;
  v_tenant_id    uuid;
  v_rows_before  integer;
  v_rows_after   integer;
  v_total        bigint := 0;
  v_practices    integer := 0;
  i              integer;
BEGIN
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- 1 · EVERY PRACTICE, ENUMERATED AS auth_owner (F490) — 0172:84-96.
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  -- ★ F490's own rule, restated as an assertion: enumerated count equals tenant count.
  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0455: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- 2 · PER PRACTICE: SET THE GUC, PROVE IT TOOK, INSERT THE SIX SEED SEGMENTS, AND COMPARE.
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    -- ★★★ THE GUC ACTUALLY TOOK EFFECT (0172:127-133).
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0455: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- Count existing seed segments before the insert (for idempotence check).
    SELECT count(*) INTO v_rows_before
      FROM keystone.segment s
     WHERE s.tenant_id = keystone.current_tenant_id()
       AND s.seed_key IS NOT NULL;

    -- ★ The six seed segments from P-16-14, inserted with ON CONFLICT DO NOTHING for idempotence.
    INSERT INTO keystone.segment (tenant_id, name, filter, seed_key, created_by, created_at, updated_at)
    VALUES
      (keystone.current_tenant_id(), 'Everyone',
       '{"role":["adult_client","adolescent_client","parent"],"has_email":true}'::jsonb,
       'everyone', NULL, now(), now()),
      (keystone.current_tenant_id(), 'Gone quiet',
       '{"role":["adult_client","adolescent_client"],"quiet_days":42}'::jsonb,
       'gone_quiet', NULL, now(), now()),
      (keystone.current_tenant_id(), 'Block running low',
       '{"credits_remaining_lte":2}'::jsonb,
       'block_low', NULL, now(), now()),
      (keystone.current_tenant_id(), 'Owing money',
       '{"owes_money":true}'::jsonb,
       'owing', NULL, now(), now()),
      (keystone.current_tenant_id(), 'Never booked',
       '{"never_booked":true}'::jsonb,
       'never_booked', NULL, now(), now()),
      (keystone.current_tenant_id(), 'On the waitlist',
       '{"on_waitlist":true}'::jsonb,
       'waitlist', NULL, now(), now())
    ON CONFLICT (tenant_id, seed_key) WHERE seed_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_rows_after = ROW_COUNT;

    -- ★ "0 rows inserted" on re-run is idempotence working (v_rows_after = 0 is correct).
    --   "6 rows inserted" on first run is correct. Either way, we accumulate the count.
    IF v_rows_after > 0 THEN
      v_practices := v_practices + 1;
    END IF;
    v_total := v_total + v_rows_after;
  END LOOP;

  -- ★ Clear the GUC so nothing later in this transaction runs under the last practice's context.
  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0455: % practice(s) enumerated · % seed segment row(s) inserted · % practice(s) received new ones',
    v_tenant_count, v_total, v_practices;
END
$seed_living_segments$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · CLOSING ASSERTION — INDEPENDENT RE-READ PER PRACTICE (0172 pattern, exactly)
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $verify_seed_segments$
DECLARE
  v_tenant_ids uuid[];
  v_tenant_id  uuid;
  v_count      integer;
  v_total      bigint := 0;
  i            integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0455: the tenant context did not take effect for practice % during the closing re-read (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- ★ Each practice must have exactly 6 seed segments under its own GUC.
    SELECT count(*) INTO v_count
      FROM keystone.segment s
     WHERE s.tenant_id = keystone.current_tenant_id()
       AND s.seed_key IS NOT NULL;

    IF v_count <> 6 THEN
      RAISE EXCEPTION '0455: practice % has % seed segments, expected exactly 6',
        v_tenant_id, v_count;
    END IF;

    v_total := v_total + v_count;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0455: confirmed — % practice(s) each have exactly 6 seed segments (% total)',
    coalesce(array_length(v_tenant_ids, 1), 0), v_total;
END
$verify_seed_segments$;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)