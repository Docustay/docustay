-- ★★★ STAGE 4 TASK 3 — F504 LAYER 2 (spec 07 §5/§6). THE WORKER CANNOT REPORT ITS OWN DEATH, AND
--     NEITHER alert_transition() NOR record_platform_event() CAN BE HANDED TO THE APP DIRECTLY —
--     BOTH ARE EXECUTE TO app_worker ONLY (0128, 0138). [MEASURED, production, 18 Sep 2026] the
--     worker crash-looped for 12.5 hours in total silence: watch_system runs INSIDE the worker, so a
--     dead worker never runs the check that would alert on itself. Layer 1 (a separate task) adds an
--     outside uptime monitor; this is layer 2 — keystone-app, a SEPARATE process, reads the same
--     heartbeat row (0127) every 60 s and raises its own alert if the worker has gone quiet.
--
-- ★★ THE APP CANNOT BE HANDED alert_transition() OR record_platform_event() DIRECTLY. Either would
--    let a web request (app_rw) flip ANY key in keystone_meta.alert_state, or write ANY kind of
--    platform fact under ANY subject — reach far beyond "is the worker beating". So the app gets
--    exactly one narrow door: keystone_meta.worker_alert_transition(p_state, p_repeat_minutes). The
--    key is FIXED to 'worker' IN THE FUNCTION BODY — there is no p_key parameter, so there is no
--    value app_rw could ever pass that reaches any other row.
--
-- ★★ THE BODY IS THE SAME LOGIC notifyTransitions()/recordHealthTransition() run for every other
--    IMMEDIATE_KEYS check (src/health/alerts.mjs, src/health/platformEvents.mjs), just called from
--    inside the database rather than from JS: it calls alert_transition('worker', …) for the verdict,
--    and for a NEW problem or a recovery it records the identical platform fact
--    (health.check_failed / health.check_recovered, subject 'check:worker',
--    facts {check:'worker', state: p_state}) in the SAME statement — so app_rw can drive both writes
--    together without ever holding EXECUTE on either underlying function. Ownership carries the
--    privilege: worker_alert_transition is owned by app_owner, same as alert_transition and
--    record_platform_event, so its body runs WITH the owner's implicit rights on its own two
--    functions — no grant to app_rw on either is created or needed (and the assertion below proves
--    neither exists).
--
-- ★ Pattern of 0127/0128/0138/0145: SET search_path = '' (fully-qualified calls only), REVOKE ALL
--   FROM PUBLIC, GRANT EXECUTE to exactly one role — here app_rw, NEVER app_worker (the worker
--   already has its own door onto alert_transition/record_platform_event; giving it this one too
--   would blur which process is meant to call it, and defeat the "who supplies the condition" test).
--
-- ★ CONCURRENCY (07 §6, two app replicas must send ONE email): alert_transition's own
--   `SELECT … FOR UPDATE` on the alert_state row (0128) is the lock. Two replicas calling this
--   wrapper on a stale heartbeat at the same moment serialize on that row: the first to commit sees
--   the state change and returns 'alert'; the second, once unblocked, reads the now-'problem' row and
--   returns 'quiet'. Proven in test/s4_app_watches_worker.test.mjs with two real connections ticking
--   concurrently.

CREATE FUNCTION keystone_meta.worker_alert_transition(p_state text, p_repeat_minutes int)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_kind text; v_platform_kind text;
BEGIN
  IF p_state NOT IN ('ok', 'problem', 'unknown') THEN
    RAISE EXCEPTION 'worker_alert_transition: p_state must be ok/problem/unknown, got %', p_state;
  END IF;
  -- ★★★ THE KEY IS A LITERAL, NOT A PARAMETER. This is the entire safety argument for granting this
  --     function to app_rw: there is no input that reaches any alert_state row but 'worker'.
  v_kind := keystone_meta.alert_transition('worker', p_state, p_repeat_minutes);
  v_platform_kind := CASE
    WHEN v_kind = 'alert'     THEN 'health.check_failed'
    WHEN v_kind = 'recovered' THEN 'health.check_recovered'
    ELSE NULL
  END;
  IF v_platform_kind IS NOT NULL THEN
    PERFORM keystone_meta.record_platform_event(
      v_platform_kind, 'check:worker', jsonb_build_object('check', 'worker', 'state', p_state));
  END IF;
  RETURN v_kind;
END $$;
REVOKE ALL ON FUNCTION keystone_meta.worker_alert_transition(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_meta.worker_alert_transition(text, int) TO app_rw;

COMMENT ON FUNCTION keystone_meta.worker_alert_transition(text, int) IS
  'Stage 4 Task 3 / F504 layer 2 — the ONLY door keystone-app has into worker alerting. The key is fixed to ''worker'' in the body (no p_key parameter); calls alert_transition(''worker'', ...) and records the health.check_failed/health.check_recovered platform fact in one statement, using its owner''s (app_owner) implicit rights on both — app_rw never gets EXECUTE on either underlying function. EXECUTE to app_rw only.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ASSERT THE RESULT, NOT THE STATEMENT (0141's lesson) — grants in both directions.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r text; f text := 'keystone_meta.worker_alert_transition(text,int)';
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0146 finished as % — it must hand back to app_owner, never RESET ROLE', current_user;
  END IF;

  -- NEGATIVE: PUBLIC, app_worker, app_embed, app_signup cannot execute the wrapper.
  IF has_function_privilege('public', f, 'EXECUTE') THEN
    RAISE EXCEPTION '0146: % is executable by PUBLIC (acl %)', f, (SELECT proacl FROM pg_proc WHERE oid = f::regprocedure);
  END IF;
  FOREACH r IN ARRAY ARRAY['app_worker','app_embed','app_signup'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
      RAISE EXCEPTION '0146: % can execute % — only app_rw may (the worker already has its own door)', r, f;
    END IF;
  END LOOP;

  -- POSITIVE: app_rw can.
  IF NOT has_function_privilege('app_rw', f, 'EXECUTE') THEN
    RAISE EXCEPTION '0146: app_rw cannot execute % — keystone-app could not watch the worker', f;
  END IF;

  -- ★★★ THE UNDERLYING DOORS STAY SHUT (brief's own rule): app_rw must not get EXECUTE on
  --     alert_transition or record_platform_event themselves — the wrapper is pointless otherwise.
  IF has_function_privilege('app_rw', 'keystone_meta.alert_transition(text,text,int)', 'EXECUTE') THEN
    RAISE EXCEPTION '0146: app_rw can execute alert_transition() directly';
  END IF;
  IF has_function_privilege('app_rw', 'keystone_meta.record_platform_event(text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '0146: app_rw can execute record_platform_event() directly';
  END IF;
END $$;

-- ★★ POSITIVE CONTROL THAT RUNS THE BODY, and proves the key is fixed: an unrelated alert_state key
--    is untouched across three calls that flip 'worker' through alert → quiet → recovered. Run as
--    app_owner (the function's owner, so it needs no grant to exercise) — the catalog assertions
--    above are what prove app_rw SPECIFICALLY may call it; this proves the LOGIC.
DO $$
DECLARE v_kind text; v_worker_before record; v_other_before record; v_other_after record; had_worker boolean;
BEGIN
  SELECT * INTO v_worker_before FROM keystone_meta.alert_state WHERE key = 'worker';
  had_worker := FOUND;
  DELETE FROM keystone_meta.alert_state WHERE key = 'worker';

  INSERT INTO keystone_meta.alert_state (key, state, last_sent_at, changed_at)
    VALUES ('m0146_probe_other_key', 'ok', NULL, now() - interval '1 hour')
    ON CONFLICT (key) DO NOTHING;
  SELECT * INTO v_other_before FROM keystone_meta.alert_state WHERE key = 'm0146_probe_other_key';

  v_kind := keystone_meta.worker_alert_transition('problem', 60);
  IF v_kind <> 'alert' THEN RAISE EXCEPTION '0146: expected alert on first problem, got %', v_kind; END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone_meta.platform_event WHERE kind = 'health.check_failed' AND subject = 'check:worker') THEN
    RAISE EXCEPTION '0146: worker_alert_transition(problem) did not record health.check_failed';
  END IF;

  v_kind := keystone_meta.worker_alert_transition('problem', 60);
  IF v_kind <> 'quiet' THEN RAISE EXCEPTION '0146: expected quiet on repeat within window, got %', v_kind; END IF;

  v_kind := keystone_meta.worker_alert_transition('ok', 60);
  IF v_kind <> 'recovered' THEN RAISE EXCEPTION '0146: expected recovered, got %', v_kind; END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone_meta.platform_event WHERE kind = 'health.check_recovered' AND subject = 'check:worker') THEN
    RAISE EXCEPTION '0146: worker_alert_transition(ok) did not record health.check_recovered';
  END IF;

  SELECT * INTO v_other_after FROM keystone_meta.alert_state WHERE key = 'm0146_probe_other_key';
  IF v_other_after.state IS DISTINCT FROM v_other_before.state
     OR v_other_after.last_sent_at IS DISTINCT FROM v_other_before.last_sent_at
     OR v_other_after.changed_at IS DISTINCT FROM v_other_before.changed_at THEN
    RAISE EXCEPTION '0146: calls to worker_alert_transition changed an UNRELATED alert_state key — the key is not fixed';
  END IF;

  -- tidy the probes: they are proofs, not facts
  -- ★ Controller review (Stage 4 Task 3): delete ONLY the facts THIS block wrote. created_at defaults to now(), the
  --   transaction's start time, so `= now()` is exactly this migration's rows — never a real check:worker fact.
  DELETE FROM keystone_meta.platform_event WHERE subject = 'check:worker' AND created_at = now();
  DELETE FROM keystone_meta.alert_state WHERE key IN ('worker', 'm0146_probe_other_key');
  IF had_worker THEN
    INSERT INTO keystone_meta.alert_state (key, state, last_sent_at, changed_at)
      VALUES (v_worker_before.key, v_worker_before.state, v_worker_before.last_sent_at, v_worker_before.changed_at);
  END IF;
  RAISE NOTICE '0146: worker_alert_transition proven — alert/quiet/recovered, both platform facts, unrelated key untouched';
END $$;
