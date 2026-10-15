-- 0067 — P1.2 · THE COMPOSITE PREDICATE, AND SEEDING THE SHIPPED ROLES WITHOUT WIDENING `app_signup`.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ PART 1 · `keystone.user_may()` — AND THE ONE WORD IN IT THAT IS THE WHOLE POINT.
--
--     A person may hold several roles. The obvious way to combine them is to take the strongest verb
--     and the widest scope:
--
--         role A = (edit, owned)        →  strongest verb = edit
--         role B = (view, everything)   →  widest scope   = everything
--         combined                      =  (edit, EVERYTHING)
--
--     ★★★ NOBODY GRANTED THAT. Role A said "edit, but only your own"; role B said "look, don't
--     touch". Taking the two maxima INDEPENDENTLY synthesises a permission strictly stronger than
--     either, and the holder may now edit every record in the practice. It is silent, it reads like
--     correct union semantics, and it is a privilege escalation.
--
--   ★★ THE FIX IS `EXISTS`. Both halves must be satisfied by **ONE ROW** — the same grant. That is
--      what the EXISTS below expresses and what `allows()` in src/permissions/resolve.mjs expresses;
--      `db/gates/p1_scope_axis.mjs` asserts the two agree rather than trusting they were written
--      from the same idea.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE FUNCTION keystone.user_may(p_user_id uuid, p_object text, p_verb text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM keystone.user_role ur
      JOIN keystone.role_permission rp
        ON rp.role_id = ur.role_id AND rp.tenant_id = ur.tenant_id
     WHERE ur.user_id = p_user_id
       AND rp.object  = p_object
       -- The verb ladder: `delete` implies `edit` implies `view`.
       AND array_position(ARRAY['none','view','edit','delete'], rp.verb)
           >= array_position(ARRAY['none','view','edit','delete'], p_verb)
       -- ★ …AND the scope, ON THE SAME ROW.
       AND keystone.scope_allows(rp.scope, p_owner_id, p_user_id)
  )
$$;

COMMENT ON FUNCTION keystone.user_may(uuid, text, text, uuid) IS
  'P1.2 — may this person do this to a row owned by that person? ★★★ The EXISTS is load-bearing: '
  'the verb and the scope must come from THE SAME grant. Taking the strongest verb across roles and '
  'the widest scope across roles independently would synthesise a permission nobody granted — '
  '(edit, owned) + (view, everything) becomes (edit, everything) — which is a privilege escalation '
  'that reads like correct union semantics. Mirrored in JS by allows() in src/permissions/resolve.mjs.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ PART 2 · SEEDING, THROUGH A DEFINER, BECAUSE THE ALTERNATIVE WAS TO WIDEN `app_signup`.
--
--     A practice must have roles from the moment it exists — a tenant created with no roles has
--     nobody who can do anything, and the fix would have to be a manual one. So seeding belongs in
--     `createTenantWithAdmin`'s transaction (src/provisioning/prefix.mjs), which runs as `app_signup`.
--
--   ★★ BUT `app_signup` DELIBERATELY HAS NO SELECT POLICY ON ANYTHING (0025/0026, and the reasoning
--      is written out at prefix.mjs:57 and :198). Seeding needs to read back a role's id to attach
--      its eleven permissions and the admin's grant. Granting that role SELECT would widen — for the
--      convenience of one statement — the exact thing three migrations were written to keep narrow.
--
--   ★★★ SO THE PRIVILEGE MOVES INTO A FUNCTION INSTEAD OF ONTO THE ROLE. The definer reads and
--       writes as the owner; `app_signup` gains the ability to seed ROLES and nothing else.
--
--   ★ AND IT TAKES THE ROLE CONTENT AS AN ARGUMENT. The four shipped roles live in
--     `src/permissions/defaults.mjs` and are passed in as jsonb. A copy of them in SQL would be two
--     truths about one thing, and the copy would be the one nobody updated.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE FUNCTION keystone.seed_builtin_roles(p_tenant_id uuid, p_roles jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
-- ★ Pinned search_path: a definer that resolves unqualified names through the CALLER's path is the
--   classic definer escalation. Everything below is schema-qualified as well; this is the belt.
SET search_path = keystone, pg_catalog
AS $$
DECLARE
  r          jsonb;
  perm       record;
  v_role_id  uuid;
  v_seeded   integer := 0;
BEGIN
  -- ★★★ THE DEFINER'S OWN GUARD, AND IT IS THE REASON THIS IS SAFE TO GRANT.
  --     Without it, ANY caller holding EXECUTE could write roles into ANY tenant — a definer that
  --     takes a tenant_id and trusts it is a cross-tenant write with extra steps. The caller must
  --     already be inside the tenant it is seeding, which the signup prefix arranges one statement
  --     before it calls this (prefix.mjs sets keystone.tenant_id as soon as the tenant row exists).
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

    -- ★ Read back rather than RETURNING, so a re-run of an already-seeded tenant finds the EXISTING
    --   role instead of silently attaching permissions to an id that was never inserted. That is
    --   what makes this idempotent rather than merely conflict-free.
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

  RETURN v_seeded;
END;
$$;

REVOKE ALL ON FUNCTION keystone.seed_builtin_roles(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.seed_builtin_roles(uuid, jsonb) TO app_signup, app_rw;

COMMENT ON FUNCTION keystone.seed_builtin_roles(uuid, jsonb) IS
  'P1.2 — writes the shipped roles into a tenant. SECURITY DEFINER so that `app_signup` can seed '
  'without being granted SELECT on anything (0025/0026 keep that role deliberately blind). ★★ It '
  'refuses any tenant other than the one the calling transaction is already inside — a definer that '
  'takes a tenant_id and trusts it is a cross-tenant write with extra steps. ★ The role CONTENT is '
  'an argument, not a copy: it comes from src/permissions/defaults.mjs, which stays the only place '
  'the four defaults are written down.';

-- ★ The admin grant is a separate, ordinary statement — it needs no privilege the signup path does
--   not already have on `user_role`, and keeping it out of the definer keeps the definer's job to
--   exactly one sentence.
GRANT INSERT ON keystone.user_role TO app_signup;

-- ★★ …and the INSERT policy it needs, which is the ordinary tenant one. `app_signup` still gets NO
--    select policy here; it writes the grant and cannot read it back, exactly as it writes app_user.
CREATE POLICY signup_insert_user_role ON keystone.user_role
  FOR INSERT TO app_signup
  WITH CHECK (tenant_id = keystone.require_tenant_id());
