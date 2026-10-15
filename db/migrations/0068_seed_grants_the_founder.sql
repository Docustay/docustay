-- 0068 — P1.2 · THE SEED ALSO PUTS THE FOUNDER IN A ROLE.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY THIS IS A SECOND MIGRATION AND NOT AN EDIT TO 0067. 0067 shipped a two-argument
--     `seed_builtin_roles`, and the signup path then needed one more thing from it that only became
--     visible when the caller was written: **the admin's own grant**.
--
--     `app_signup` has no SELECT policy on anything, so it cannot read back the id of the role it
--     just seeded in order to insert `user_role`. The choice was to grant that role SELECT — widening
--     a role three migrations were written to keep blind — or to let the definer, which can already
--     read, finish the sentence it started.
--
--   ★★ A TENANT SEEDED WITH FOUR ROLES AND NOBODY HOLDING ONE IS THE SAME LOCKOUT AS NO ROLES AT
--      ALL, arriving one step later. The founder's grant is not a separate feature; it is the half of
--      seeding that makes the other half mean anything, and D-17.21 already had to learn this once
--      when a tenant was created `provisioning` and left un-loginable.
--
-- ★ DROP then CREATE, not CREATE OR REPLACE: adding a parameter makes a NEW signature, so a replace
--   would leave the old two-argument function in place as an overload and every call would become
--   ambiguous. The drop is deliberate and is why it is written down here rather than done by hand.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DROP FUNCTION keystone.seed_builtin_roles(uuid, jsonb);

CREATE FUNCTION keystone.seed_builtin_roles(
  p_tenant_id     uuid,
  p_roles         jsonb,
  p_grant_user_id uuid DEFAULT NULL,
  p_grant_role_key text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = keystone, pg_catalog
AS $$
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

  FOR r IN SELECT * FROM jsonb_array_elements(p_roles) LOOP
    INSERT INTO keystone.role (tenant_id, key, label, description, is_builtin)
    VALUES (p_tenant_id, r->>'key', r->>'label', r->>'description', true)
    ON CONFLICT (tenant_id, key) DO NOTHING;

    -- ★ Read back rather than RETURNING, so a re-run finds the EXISTING role instead of attaching
    --   permissions to an id that was never inserted. That is what makes this idempotent rather
    --   than merely conflict-free.
    SELECT id INTO v_role_id
      FROM keystone.role WHERE tenant_id = p_tenant_id AND key = r->>'key';

    FOR perm IN SELECT key AS obj, value->>'verb' AS verb, value->>'scope' AS scope
                  FROM jsonb_each(r->'permissions') LOOP
      -- ★★ DO NOTHING, NOT DO UPDATE. Re-seeding must never overwrite a permission the practice has
      --    since edited — KS-11 says the defaults are a STARTING POINT, and a starting point that
      --    reasserts itself is a setting the operator cannot actually change.
      INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
      VALUES (p_tenant_id, v_role_id, perm.obj, perm.verb, perm.scope)
      ON CONFLICT (tenant_id, role_id, object) DO NOTHING;
    END LOOP;

    v_seeded := v_seeded + 1;
  END LOOP;

  -- ── the founder's grant ───────────────────────────────────────────────────────────────────────
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
$$;

REVOKE ALL ON FUNCTION keystone.seed_builtin_roles(uuid, jsonb, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.seed_builtin_roles(uuid, jsonb, uuid, text) TO app_signup, app_rw;

COMMENT ON FUNCTION keystone.seed_builtin_roles(uuid, jsonb, uuid, text) IS
  'P1.2 — gives a tenant its starting roles and puts the founder in one. SECURITY DEFINER so that '
  '`app_signup` can seed without being granted SELECT on anything (0025/0026 keep that role blind). '
  '★★ Refuses any tenant other than the one the calling transaction is already inside, and refuses a '
  'role key that was never seeded rather than leaving the founder holding nothing. ★ The role '
  'CONTENT is an argument: it comes from src/permissions/defaults.mjs, the only place the four '
  'defaults are written down.';
