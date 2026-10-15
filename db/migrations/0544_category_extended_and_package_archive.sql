-- 0544_category_extended_and_package_archive
--
-- FOLLOW-UP BRIEF — Part 2 ("extend Categories to packages/plans"), a small piece of Part 8
-- (Family Coaching's minimum-term plan), and a small piece of Part 9 (package needs an archived
-- state before it can be archived at all). Three independent, purely additive changes, bundled in
-- one file because none needs its own self-check beyond "the column exists and the FK is sound" —
-- 0410/0088's own pattern for a plain ALTER ADD COLUMN, not CT-F52 (that checklist is for NEW
-- TABLES; these three tables already carry FORCE RLS and the correct policies).
--
-- ★★★ ADDITIVE. Every existing read/write of `package`/`plan` is unaffected whether or not this
--     migration has been applied — every new column is NULL-able with no default that changes
--     existing behaviour.

-- §1 — category_id on package/plan. MEASURED: 0410 gave `service.category_id` only; `package` and
--     `plan` have never had a category. Mirrors 0410's own FK shape exactly.
ALTER TABLE keystone.package ADD COLUMN category_id uuid NULL;
ALTER TABLE keystone.package
  ADD CONSTRAINT package_category_id_fkey FOREIGN KEY (tenant_id, category_id)
    REFERENCES keystone.service_category (tenant_id, id) ON DELETE SET NULL (category_id);

ALTER TABLE keystone.plan ADD COLUMN category_id uuid NULL;
ALTER TABLE keystone.plan
  ADD CONSTRAINT plan_category_id_fkey FOREIGN KEY (tenant_id, category_id)
    REFERENCES keystone.service_category (tenant_id, id) ON DELETE SET NULL (category_id);

COMMENT ON COLUMN keystone.package.category_id IS '0544: which service category this package groups under — extends 0410''s service-only category to package, per Part 2.';
COMMENT ON COLUMN keystone.plan.category_id    IS '0544: see keystone.package.category_id.';

-- §2 — plan.minimum_term_months, for Part 8's Family Coaching plan (a subscription that cannot be
--     cancelled before N billing cycles). NULL = no minimum (every existing plan's real behaviour
--     today), so this is a pure addition, never a behaviour change for an existing row.
ALTER TABLE keystone.plan ADD COLUMN minimum_term_months integer NULL
  CHECK (minimum_term_months IS NULL OR minimum_term_months >= 1);
COMMENT ON COLUMN keystone.plan.minimum_term_months IS
  '0544: the plan cannot be cancelled before this many billing cycles have run. NULL = month-to-month, no minimum.';

-- §3 — package gets archived_at/archived_by, same shape 0088 gave service/plan/etc, so Part 9's
--     "archive a package" has a column to write to. MEASURED (items/editors.mjs header, this
--     session): `package` and `coupon` are the two catalogue tables 0088 left out.
ALTER TABLE keystone.package ADD COLUMN archived_at timestamptz NULL;
ALTER TABLE keystone.package ADD COLUMN archived_by uuid NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL;
COMMENT ON COLUMN keystone.package.archived_at IS '0544: same archive-not-delete shape as 0088 gave service/plan — Part 9.';

-- ── SELF-CHECK ─────────────────────────────────────────────────────────────────────────────────
DO $self_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='keystone' AND table_name='package' AND column_name='category_id') THEN
    RAISE EXCEPTION '0544: keystone.package.category_id was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='keystone' AND table_name='plan' AND column_name='category_id') THEN
    RAISE EXCEPTION '0544: keystone.plan.category_id was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='keystone' AND table_name='plan' AND column_name='minimum_term_months') THEN
    RAISE EXCEPTION '0544: keystone.plan.minimum_term_months was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='keystone' AND table_name='package' AND column_name='archived_at') THEN
    RAISE EXCEPTION '0544: keystone.package.archived_at was not created';
  END IF;
  RAISE NOTICE '0544: package.category_id, plan.category_id, plan.minimum_term_months, package.archived_at/archived_by all created';
END
$self_check$;
