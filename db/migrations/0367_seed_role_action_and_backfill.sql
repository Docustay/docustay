-- 0367_seed_role_action_and_backfill
--
-- F1 [24 Sep 2026] — keystone.seed_builtin_roles() has never written keystone.role_action, even
-- though defaults.mjs's BUILTIN_ROLES has carried an `actions` array per role since Task 1.3. Every
-- tenant created via /api/signup landed with 0 role_action rows — a brand-new Owner could not
-- perform any of the 13 named actions (person.create, document.sign, invoice.refund, ...).
-- MEASURED against the deployed DB: y1-alpha, y1-bravo and example (seeded/backfilled by hand before
-- this migration existed) each hold 29 role_action rows; every tenant signed up since then holds 0.
--
-- This migration (1) replaces seed_builtin_roles() so every NEW tenant is seeded correctly, and
-- (2) backfills every EXISTING built-in role that currently holds 0 role_action rows, using the
-- same fixed action lists defaults.mjs assigns per role key (OWNER_ACTIONS/ADMIN_ACTIONS/COACH_ACTIONS).

CREATE OR REPLACE FUNCTION keystone.seed_builtin_roles(
  p_tenant_id      uuid,
  p_roles          jsonb,
  p_grant_user_id  uuid DEFAULT NULL,
  p_grant_role_key text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r          jsonb;
  perm       record;
  v_action   text;
  v_role_id  uuid;
  v_seeded   integer := 0;
BEGIN
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

    SELECT id INTO v_role_id
      FROM keystone.role WHERE tenant_id = p_tenant_id AND key = r->>'key';

    FOR perm IN SELECT key AS obj, value->>'verb' AS verb, value->>'scope' AS scope
                  FROM pg_catalog.jsonb_each(r->'permissions') LOOP
      INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
      VALUES (p_tenant_id, v_role_id, perm.obj, perm.verb, perm.scope)
      ON CONFLICT (tenant_id, role_id, object) DO NOTHING;
    END LOOP;

    -- ★ F1 FIX — the loop role_permission never had: seed role_action from r->'actions'.
    FOR v_action IN SELECT * FROM pg_catalog.jsonb_array_elements_text(coalesce(r->'actions', '[]'::jsonb)) LOOP
      INSERT INTO keystone.role_action (tenant_id, role_id, action)
      VALUES (p_tenant_id, v_role_id, v_action)
      ON CONFLICT (tenant_id, role_id, action) DO NOTHING;
    END LOOP;

    v_seeded := v_seeded + 1;
  END LOOP;

  IF p_grant_user_id IS NOT NULL THEN
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

-- ── BACKFILL — every existing built-in role with 0 role_action rows ─────────────────────────────
-- Fixed action lists, matching defaults.mjs's OWNER_ACTIONS/ADMIN_ACTIONS/COACH_ACTIONS exactly.
DO $backfill$
DECLARE
  role_rec record;
  v_action text;
  owner_actions text[] := ARRAY['person.create','team.invite','team.remove','staff_role.change',
    'document.sign','document.execute','template.author','record.archive','record.restore',
    'booking.waive_charge','discount.apply','invoice.refund','setting.billing'];
  admin_actions text[] := ARRAY['person.create','team.invite','team.remove','staff_role.change',
    'document.sign','document.execute','template.author','record.archive','record.restore',
    'booking.waive_charge','discount.apply','invoice.refund'];
  coach_actions text[] := ARRAY['person.create','template.author','document.sign'];
BEGIN
  FOR role_rec IN
    SELECT r.id, r.tenant_id, r.key
      FROM keystone.role r
      WHERE r.is_builtin = true
        AND r.key IN ('owner', 'admin', 'coach')
        AND NOT EXISTS (SELECT 1 FROM keystone.role_action ra WHERE ra.role_id = r.id)
  LOOP
    IF role_rec.key = 'owner' THEN
      FOREACH v_action IN ARRAY owner_actions LOOP
        INSERT INTO keystone.role_action (tenant_id, role_id, action)
        VALUES (role_rec.tenant_id, role_rec.id, v_action)
        ON CONFLICT (tenant_id, role_id, action) DO NOTHING;
      END LOOP;
    ELSIF role_rec.key = 'admin' THEN
      FOREACH v_action IN ARRAY admin_actions LOOP
        INSERT INTO keystone.role_action (tenant_id, role_id, action)
        VALUES (role_rec.tenant_id, role_rec.id, v_action)
        ON CONFLICT (tenant_id, role_id, action) DO NOTHING;
      END LOOP;
    ELSIF role_rec.key = 'coach' THEN
      FOREACH v_action IN ARRAY coach_actions LOOP
        INSERT INTO keystone.role_action (tenant_id, role_id, action)
        VALUES (role_rec.tenant_id, role_rec.id, v_action)
        ON CONFLICT (tenant_id, role_id, action) DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;
END;
$backfill$;
