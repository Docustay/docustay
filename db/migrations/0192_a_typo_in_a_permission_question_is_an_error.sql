-- 0192_a_typo_in_a_permission_question_is_an_error
-- Stage 7 task 7.10 · pins keystone.user_may's search_path and turns a misspelled object argument
-- (or a nonsense verb) into a raised error instead of a quiet `false`.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS REPLACES. keystone.user_may (0067:24-42, EXECUTED against production:
--     prosecdef = f, no proconfig) is `LANGUAGE sql`, unpinned, and answers `false` for ANY
--     p_object it doesn't recognise — a typo in a list's predicate ("persons" for "person") reads
--     exactly like "this viewer holds no grant", and the screen renders empty forever. That is
--     F294's failure mode: a permission question with a typo in it, mistaken for a real "no".
--
-- ★★ THE FIX HAS TWO PARTS. (1) `p_object` must exist in keystone.permission_object (task 7.2,
--    0182) or the call raises — a typo is now loud at the first request, not silent forever.
--    (2) `p_verb = 'none'` also raises: asking "may they do nothing" and getting `true` back is a
--    silent grant, the same argument src/permissions/resolve.mjs:77-80 already makes for `allows()`.
--
-- ★★★ WHAT MUST NOT CHANGE. The per-GRANT EXISTS (F142 — the verb and the scope must come from the
--     SAME row of role_permission; splitting them into two independent maxima synthesises a
--     permission nobody granted). That line of the body survives verbatim in meaning below.
--
-- ★ LANGUAGE plpgsql, not sql — a RAISE needs it. STILL NOT SECURITY DEFINER: it must run as the
--   caller so RLS keeps scoping keystone.user_role and keystone.role_permission to the caller's
--   tenant; a definer here would need its own tenant re-check for no benefit. `SET search_path = ''`
--   with every reference schema-qualified, matching every other pinned function in this schema
--   (EXECUTED 21 Sep 2026: all five SECURITY DEFINER functions on production carry
--   `search_path=""`) and db/gates/p21a_definer_search_path.mjs's expectation — CT-048's
--   `SET search_path = pg_catalog, keystone` is NOT used here; this is the recorded deviation.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.user_may(p_user_id uuid, p_object text, p_verb text, p_owner_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  -- ★★★ A typo in p_object must not read as "no permission granted" — it must fail loudly, once,
  --     at the first call, rather than rendering an empty screen forever (F294).
  IF NOT EXISTS (SELECT 1 FROM keystone.permission_object o WHERE o.key = p_object) THEN
    RAISE EXCEPTION '"%" is not a permission object', p_object USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ★ 'none' is a real value in the verb ladder's CHECK, but asking "may they do nothing" is never
  --   a real question a caller should ask, and answering it `true` would be a silent grant — the
  --   same argument src/permissions/resolve.mjs:77-80 makes for allows().
  IF NOT (p_verb = ANY (ARRAY['view','edit','delete'])) THEN
    RAISE EXCEPTION '"%" is not a verb anybody performs', p_verb USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM keystone.user_role ur
      JOIN keystone.role_permission rp
        ON rp.role_id = ur.role_id AND rp.tenant_id = ur.tenant_id
     WHERE ur.user_id = p_user_id
       AND rp.object  = p_object
       -- The verb ladder: `delete` implies `edit` implies `view`.
       AND array_position(ARRAY['none','view','edit','delete'], rp.verb)
           >= array_position(ARRAY['none','view','edit','delete'], p_verb)
       -- ★★★ …AND the scope, ON THE SAME ROW (F142). The verb and the scope must be satisfied by
       --     ONE grant, never by the strongest verb across one role and the widest scope across
       --     another — that would synthesise a permission nobody granted.
       AND keystone.scope_allows(rp.scope, p_owner_id, p_user_id)
  );
END;
$$;

COMMENT ON FUNCTION keystone.user_may(uuid, text, text, uuid) IS
  'Stage 7 task 7.10. Same name, same four arguments, same return type, same per-GRANT EXISTS as '
  '0067 (F142 is unchanged: the verb and the scope must come from the same role_permission row). '
  'New here: SET search_path = '''' with every reference schema-qualified, and a first check that '
  'p_object names a real keystone.permission_object row and p_verb is view/edit/delete — a typo used '
  'to read as a quiet "no" and render an empty screen forever (F294); now it raises '
  '''invalid_parameter_value'' at the first call. NOT SECURITY DEFINER: runs as the caller so RLS '
  'keeps scoping user_role and role_permission to the caller''s own tenant.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- SELF-CHECK — the shape this file claims is the shape the function now has.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $user_may_check$
DECLARE
  v_raised  boolean := false;
  v_answer  boolean;
  v_cfg     text;
BEGIN
  -- (1) a misspelled object raises rather than answering false.
  BEGIN
    PERFORM keystone.user_may(NULL, 'persons', 'view', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '0192: keystone.user_may(NULL, ''persons'', ''view'', NULL) did not raise for an unknown object';
  END IF;

  -- (2) the positive control: a real object, correctly spelled, still answers a boolean without raising.
  SELECT keystone.user_may(NULL, 'person', 'view', NULL) INTO v_answer;
  IF v_answer IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0192: keystone.user_may(NULL, ''person'', ''view'', NULL) must answer false (no user, no grant), got %', v_answer;
  END IF;

  -- (3) search_path is pinned.
  SELECT coalesce(array_to_string(p.proconfig, ' '), '') INTO v_cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'keystone' AND p.proname = 'user_may';
  IF v_cfg !~ 'search_path=' THEN
    RAISE EXCEPTION '0192: keystone.user_may has no pinned search_path (proconfig = %)', v_cfg;
  END IF;

  RAISE NOTICE '0192: keystone.user_may raises on an unknown object and an unknown verb; a correctly-spelled call still answers; search_path is pinned (%).', v_cfg;
END $user_may_check$;
