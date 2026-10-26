-- 0528 — RP.2 (RECONCILE de-code, 27 Sep 2026): personal roles (R-30) and custom roles (R-33).
-- FORCE RLS on keystone.role already covers these new columns — no new policy.
ALTER TABLE keystone.role
  ADD COLUMN rank text NOT NULL DEFAULT 'member' CHECK (rank IN ('owner','admin','member')),
  ADD COLUMN personal_for_user_id uuid NULL,
  ADD COLUMN based_on_role_id uuid NULL;

ALTER TABLE keystone.role
  ADD CONSTRAINT role_personal_needs_based_on
    CHECK (personal_for_user_id IS NULL OR based_on_role_id IS NOT NULL);

ALTER TABLE keystone.role
  ADD CONSTRAINT role_personal_for_user_fk
    FOREIGN KEY (tenant_id, personal_for_user_id) REFERENCES keystone.app_user(tenant_id, id);
ALTER TABLE keystone.role
  ADD CONSTRAINT role_based_on_role_fk
    FOREIGN KEY (tenant_id, based_on_role_id) REFERENCES keystone.role(tenant_id, id);

CREATE UNIQUE INDEX role_one_personal_per_user_idx
  ON keystone.role (tenant_id, personal_for_user_id) WHERE personal_for_user_id IS NOT NULL;

-- ★ Backfill rank from the built-in key for every existing role (owner/admin/member per
--   L13.3's own rename — this migration is written to apply AFTER 0525, so 'coach' is already gone;
--   if it somehow runs first, the WHERE clause below still catches the pre-rename key, harmlessly).
UPDATE keystone.role SET rank = 'owner' WHERE key = 'owner' AND is_builtin;
UPDATE keystone.role SET rank = 'admin' WHERE key = 'admin' AND is_builtin;
UPDATE keystone.role SET rank = 'member' WHERE key IN ('member', 'coach') AND is_builtin;

ALTER TABLE keystone.role_permission ADD COLUMN overridden boolean NOT NULL DEFAULT false;
ALTER TABLE keystone.role_action ADD COLUMN overridden boolean NOT NULL DEFAULT false;

DO $self_check$
DECLARE v_leftover integer;
BEGIN
  SELECT count(*) INTO v_leftover FROM keystone.role WHERE is_builtin AND rank NOT IN ('owner','admin','member');
  IF v_leftover > 0 THEN
    RAISE EXCEPTION '0528: % built-in role row(s) still have no rank after backfill', v_leftover;
  END IF;
END
$self_check$;
