-- 0069 — P1.2 · THE SEED DEFINER GETS AN **EMPTY** search_path, AND `app_signup` GIVES BACK A GRANT
--          IT TURNED OUT NOT TO NEED.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ TWO GATES CAUGHT THIS, AND BOTH WERE RIGHT. 0068 shipped the definer with
--     `SET search_path = keystone, pg_catalog`, which is the textbook hardening and is NOT what this
--     project requires. [EXECUTED]
--       catalog-conformance.mjs      ✗ no empty search_path in proconfig
--       p21a_definer_search_path.mjs ✗ search_path pinned to a CALLER-INFLUENCEABLE value
--     ★★ The house rule is `SET search_path = ''` with EVERY name schema-qualified, and it is the
--        stricter rule for a reason a non-empty path cannot satisfy: an empty path resolves nothing
--        implicitly, so there is no name anywhere — not a function, not an operator, not a type —
--        that can be captured by what a caller put on their own path. Nine other definers in this
--        schema already do it (0007, 0010, 0011, …). ★ A convention held by nine functions and
--        broken by one is not a convention; it is nine functions and an exception.
--
-- ★★★ AND THE GRANT: `p21a_role_matrix.mjs` failed with
--       ✗ app_signup reaches app_user, provisioning_run, provisioning_step, tenant, USER_ROLE
--         — expected exactly app_user, provisioning_run, provisioning_step, tenant
--     0067 granted `app_signup` INSERT on `user_role` so the signup path could grant the founder
--     their role. **0068 then moved that insert INSIDE the definer**, which runs as the owner — so
--     the grant and its policy have been dead since the moment they were needed, and nothing failed
--     because nothing used them.
--   ★★ A privilege that is not needed is not harmless: it is the standing ability to write a row,
--      surviving on the argument that nothing currently does. The role matrix exists to say so, and
--      it said so on the first run. **Both are revoked here.**
--   ★ This is the ratchet working in the direction it was built for — the signup role ends this
--     migration exactly as narrow as 0025/0026 left it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS signup_insert_user_role ON keystone.user_role;
REVOKE INSERT ON keystone.user_role FROM app_signup;

CREATE OR REPLACE FUNCTION keystone.seed_builtin_roles(
  p_tenant_id      uuid,
  p_roles          jsonb,
  p_grant_user_id  uuid DEFAULT NULL,
  p_grant_role_key text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
-- ★★★ EMPTY. Every identifier below is schema-qualified, including the `pg_catalog` functions —
--     `jsonb_array_elements` and `jsonb_each` resolve to nothing without it.
SET search_path = ''
AS $fn$
DECLARE
  r          jsonb;
  perm       record;
  v_role_id  uuid;
  v_seeded   integer := 0;
BEGIN
  -- ★★★ THE DEFINER'S OWN GUARD — see 0067. A definer that takes a tenant_id and trusts it is a
  --     cross-tenant write with extra steps.
  IF p_tenant_id IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION
      'seed_builtin_roles refused: asked to seed tenant % while the transaction is in tenant % — '
      'a caller may only seed the tenant it is already inside',
      p_tenant_id, coalesce(keystone.current_tenant_id()::text, '(none)');
  END IF;

  FOR r IN SELECT * FROM pg_catalog.jsonb_array_elements(p_roles) LOOP
    INSERT INTO keystone.role (tenant_id, key, label, description, is_builtin)
    VALUES (p_tenant_id, r->>'key', r->>'label', r->>'description', true)
    ON CONFLICT (tenant_id, key) DO NOTHING;

    -- ★ Read back rather than RETURNING, so a re-run finds the EXISTING role instead of attaching
    --   permissions to an id that was never inserted. That is what makes this idempotent rather
    --   than merely conflict-free.
    SELECT id INTO v_role_id
      FROM keystone.role WHERE tenant_id = p_tenant_id AND key = r->>'key';

    FOR perm IN SELECT key AS obj, value->>'verb' AS verb, value->>'scope' AS scope
                  FROM pg_catalog.jsonb_each(r->'permissions') LOOP
      -- ★★ DO NOTHING, NOT DO UPDATE. Re-seeding must never overwrite a permission the practice has
      --    since edited — KS-11 says the defaults are a STARTING POINT, and a starting point that
      --    reasserts itself is a setting the operator cannot actually change.
      INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
      VALUES (p_tenant_id, v_role_id, perm.obj, perm.verb, perm.scope)
      ON CONFLICT (tenant_id, role_id, object) DO NOTHING;
    END LOOP;

    v_seeded := v_seeded + 1;
  END LOOP;

  -- ── the founder's grant, done HERE and not by the caller ──────────────────────────────────────
  -- ★★ This is the insert that made 0067's `GRANT INSERT ... TO app_signup` look necessary. It runs
  --    as the function owner, so the signup role needs nothing; 0069 revokes the grant above.
  IF p_grant_user_id IS NOT NULL THEN
    -- ★★★ REFUSE A ROLE KEY THAT WAS NEVER SEEDED, LOUDLY. The quiet alternative — no matching row,
    --     zero rows inserted, no error — creates a tenant whose only human holds nothing, which
    --     presents as "I can log in and every screen is empty" and is indistinguishable from a
    --     broken read. This is the `F52` shape and it is refused at the point it happens.
    SELECT id INTO v_role_id
      FROM keystone.role WHERE tenant_id = p_tenant_id AND key = p_grant_role_key;

    IF v_role_id IS NULL THEN
      RAISE EXCEPTION
        'seed_builtin_roles refused: role "%" does not exist in tenant % after seeding, so the '
        'founder would hold nothing and every screen would be empty with no error',
        coalesce(p_grant_role_key, '(null)'), p_tenant_id;
    END IF;

    INSERT INTO keystone.user_role (tenant_id, user_id, role_id, granted_by)
    VALUES (p_tenant_id, p_grant_user_id, v_role_id, p_grant_user_id)
    ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING;
  END IF;

  RETURN v_seeded;
END;
$fn$;
