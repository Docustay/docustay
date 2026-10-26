-- 0162_a_definer_pinned_everywhere_else_is_pinned_here_too
-- Stage 4 Task 14 · Phase B · task-14-review.md IM-5.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE DRIFT. Every SECURITY DEFINER this stage created carries `SET search_path = ''` — 0145, 0147,
-- 0149, 0155, 0156, 0157, 0158, 0159, 0160, 0161. Two do not: `keystone_meta.job_failure_summary()`
-- and `keystone_meta.claim_daily_summary(date)` (0154) carry `search_path = pg_catalog, keystone_meta`.
--
-- ★★ NOTHING IS UNSAFE TODAY, and that is the point worth writing down rather than glossing:
--    MEASURED — both bodies are fully schema-qualified (`keystone_meta.job_failure`,
--    `keystone_meta.daily_summary_sent`, `pg_catalog.count`), so no name in either resolves through
--    the search_path at all. The pinning is what makes that true for the NEXT edit, not for this one.
--    A definer runs as its owner; a definer whose path is not empty is one careless unqualified name
--    away from resolving that name in a schema the CALLER controls.
--
-- ★★★ WHY THE FIX IS ALSO AN ASSERTION. 0154 is the only migration in 0145–0161 with no
--     owner/prosecdef/proconfig/proacl shape check at its end (0149:58, 0156:232+249, 0157:199,
--     0158:249+269 all have one). That absence is exactly why the drift went unnoticed for a stage.
--     So this migration does not merely ALTER: it asserts the shape of BOTH functions, and probes
--     both at runtime as app_worker — the role that actually calls them (src/health/dailySummary.mjs
--     :151 and :244) — because an ALTER that pinned the path and broke the body would otherwise be
--     discovered by the 7 am summary, in production, at 7 am.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ───────────────────────────────────────────────────────────────────────────
DO $precondition$
DECLARE
  n int;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0162: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.oid IN ('keystone_meta.job_failure_summary()'::regprocedure,
                   'keystone_meta.claim_daily_summary(date)'::regprocedure)
     AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'app_owner';
  IF n <> 2 THEN
    RAISE EXCEPTION '0162: expected 2 app_owner-owned SECURITY DEFINER functions from 0154, found %', n;
  END IF;
END
$precondition$;

-- ── §1 · THE PIN ─────────────────────────────────────────────────────────────────────────────────
ALTER FUNCTION keystone_meta.job_failure_summary()   SET search_path = '';
ALTER FUNCTION keystone_meta.claim_daily_summary(date) SET search_path = '';

-- ── §2 · THE SHAPE ASSERTION 0154 NEVER HAD ──────────────────────────────────────────────────────
DO $assert$
DECLARE
  f record;
  v_total int; v_claimed boolean; v_again boolean;
  v_probe_date date := DATE '1900-01-02';           -- ★ a date the product can never produce a summary for
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0162 finished as % — it must hand back to app_owner, never RESET ROLE', current_user;
  END IF;

  FOR f IN
    SELECT p.oid::regprocedure::text AS sig,
           pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
           has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
           has_function_privilege('app_rw',     p.oid, 'EXECUTE') AS rw,
           has_function_privilege('app_embed',  p.oid, 'EXECUTE') AS embed,
           has_function_privilege('app_signup', p.oid, 'EXECUTE') AS signup,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public
      FROM pg_proc p
     WHERE p.oid IN ('keystone_meta.job_failure_summary()'::regprocedure,
                     'keystone_meta.claim_daily_summary(date)'::regprocedure)
  LOOP
    IF f.owner <> 'app_owner' OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION '0162: % is owner=% definer=% proconfig=% — expected app_owner / true / {search_path=""}',
        f.sig, f.owner, f.prosecdef, f.proconfig;
    END IF;
    -- ★ app_worker is the ONLY caller (0154's own grant); the web-facing roles must not reach either.
    IF NOT f.worker OR f.rw OR f.embed OR f.signup OR f.public THEN
      RAISE EXCEPTION '0162: % EXECUTE is wrong — worker=% rw=% embed=% signup=% PUBLIC=%',
        f.sig, f.worker, f.rw, f.embed, f.signup, f.public;
    END IF;
  END LOOP;

  -- ★★ RUNTIME PROBE, as app_worker, with the path now empty. An unqualified name left in either body
  --    would raise here — inside the migration's own transaction — instead of at 7 am in production.
  SET LOCAL ROLE app_worker;
  SELECT s.total INTO v_total FROM keystone_meta.job_failure_summary() s LIMIT 1;
  v_claimed := keystone_meta.claim_daily_summary(v_probe_date);
  v_again   := keystone_meta.claim_daily_summary(v_probe_date);   -- ★ second claim for the same date
  SET LOCAL ROLE app_owner;

  IF v_total IS NULL THEN
    RAISE EXCEPTION '0162: job_failure_summary() returned no total row as app_worker with search_path=""';
  END IF;
  IF NOT v_claimed OR v_again THEN
    RAISE EXCEPTION '0162: claim_daily_summary is not once-per-date under the new path — first=% second=%',
      v_claimed, v_again;
  END IF;

  -- ★ The probe wrote a row. Take it back out: this migration must leave no summary claim behind.
  DELETE FROM keystone_meta.daily_summary_sent WHERE summary_date = v_probe_date;
  IF EXISTS (SELECT 1 FROM keystone_meta.daily_summary_sent WHERE summary_date = v_probe_date) THEN
    RAISE EXCEPTION '0162: the probe claim for % survived its own cleanup', v_probe_date;
  END IF;
END
$assert$;

COMMENT ON FUNCTION keystone_meta.job_failure_summary() IS
  'Unacknowledged give-up count plus the top 5 task identifiers, for the 7 am summary. SECURITY DEFINER, '
  'search_path pinned empty (0162 — 0154 shipped it pinned to pg_catalog,keystone_meta); EXECUTE: app_worker only.';
COMMENT ON FUNCTION keystone_meta.claim_daily_summary(date) IS
  'Claims the one send for a date; TRUE to exactly one caller. SECURITY DEFINER, search_path pinned empty '
  '(0162 — 0154 shipped it pinned to pg_catalog,keystone_meta); EXECUTE: app_worker only.';
