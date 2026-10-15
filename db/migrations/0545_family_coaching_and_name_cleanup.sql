-- 0545_family_coaching_and_name_cleanup
--
-- FOLLOW-UP BRIEF — Part 7 ("clean '(Life Coaching)' from names") and Part 8 ("build Family
-- Coaching"). Docustay only, same footing as 0536's own catalogue seed. DEPENDS ON 0543 (keystone.program
-- must exist) — ordered after it by migration number, same as every other dependency in this
-- pending set.
--
-- ★★★ Part 7's reasoning: the "(Life Coaching)" suffix on the four services/packages 0536 seeded
--     existed because coaching_group was a hidden column with no visible UI of its own — the name
--     was the only place a person could SEE which group an item was in. Once Program is a real,
--     visible, clickable field (Part 1/3/4), the suffix is redundant. Renaming is NOT an
--     archive/delete (HELD's "don't archive or delete any existing real service/package/plan"
--     is unaffected — these four rows keep their ids, prices and history, only the name column
--     changes) and is reversible (nothing here is one-way).
-- ★★★ Part 8's reasoning: Family Coaching is a THIRD program, sitting beside Life/Recovery exactly
--     as Part 1 intends — no new coaching_group value needed (that enum is being retired, not
--     extended), no code change needed beyond what Part 1/2/4 already built. `keystone.plan`'s
--     `minimum_term_months` (migration 0544) makes the $1,800/month plan not cancellable before its
--     minimum term. "Intake" is `service.intake_form_id` — already a real, editable field
--     (ServiceEditor.jsx) — left NULL here since no intake FORM TEMPLATE exists yet to point at;
--     the maintainer attaches one through the editor once he has written the form, same as any other service.

SELECT set_config('keystone.tenant_id', '01a09bfe-481c-7cbe-9f80-d28b613e5bba', true);

DO $family_coaching_seed$
DECLARE
  foundry_tenant_id uuid := '01a09bfe-481c-7cbe-9f80-d28b613e5bba';
  life_program_id uuid;
  family_category_id uuid;
  parent_service_id uuid;
  young_service_id uuid;
  family_session_service_id uuid;
  family_plan_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM keystone.tenant_timezones_for_health() WHERE id = foundry_tenant_id) THEN
    RAISE NOTICE '0545: foundry tenant % not present in this database — skipping (schema changes, if any, still applied by earlier migrations)', foundry_tenant_id;
    RETURN;
  END IF;

  -- ── PART 7 — rename the four life-coaching items, if they still carry the old suffix. ─────────
  UPDATE keystone.service SET name = 'Single Session'
    WHERE tenant_id = foundry_tenant_id AND name = 'Single Session (Life Coaching)';
  UPDATE keystone.package SET name = '4 Sessions'
    WHERE tenant_id = foundry_tenant_id AND name = '4 Sessions (Life Coaching)';
  UPDATE keystone.package SET name = '8 Sessions'
    WHERE tenant_id = foundry_tenant_id AND name = '8 Sessions (Life Coaching)';
  UPDATE keystone.package SET name = '12 Sessions'
    WHERE tenant_id = foundry_tenant_id AND name = '12 Sessions (Life Coaching)';

  -- ── PART 8 — Family Coaching (TY'S DECISION, 30 Sep 2026; corrected by chat before apply) ──────
  --   Program: Life Coaching · Category: Family. Three 60-minute services (Parent / Young person /
  --   Family session) + plan "Family Coaching" $1,800/month, monthly credits 4 + 4 + 2, minimum
  --   term 3 months. Idempotent on the plan name.
  IF EXISTS (SELECT 1 FROM keystone.plan WHERE tenant_id = foundry_tenant_id AND lower(name) = 'family coaching') THEN
    RAISE NOTICE '0545: Family Coaching plan already exists for foundry — skipping the seed half';
    RETURN;
  END IF;

  SELECT id INTO life_program_id FROM keystone.program WHERE tenant_id = foundry_tenant_id AND lower(name) = 'life coaching';
  IF life_program_id IS NULL THEN
    RAISE EXCEPTION '0545: foundry has no "Life Coaching" program — 0543 must run before this migration';
  END IF;
  SELECT id INTO family_category_id FROM keystone.service_category WHERE tenant_id = foundry_tenant_id AND lower(name) = 'family';
  IF family_category_id IS NULL THEN
    RAISE EXCEPTION '0545: foundry has no "Family" category';
  END IF;

  parent_service_id := keystone.uuid_generate_v7();
  young_service_id := keystone.uuid_generate_v7();
  family_session_service_id := keystone.uuid_generate_v7();
  INSERT INTO keystone.service
    (id, tenant_id, name, duration_minutes, price_minor, currency, bookable, active, coaching_group,
     program_id, category_id, portal_bookable, public_bookable, description)
  VALUES
    (parent_service_id, foundry_tenant_id, 'Parent session', 60, 13000, 'USD', true, true, 'life',
     life_program_id, family_category_id, true, false, 'One hour with the parent, as part of family coaching.'),
    (young_service_id, foundry_tenant_id, 'Young person session', 60, 13000, 'USD', true, true, 'life',
     life_program_id, family_category_id, true, false, 'One hour with the young person, as part of family coaching.'),
    (family_session_service_id, foundry_tenant_id, 'Family session', 60, 13000, 'USD', true, true, 'life',
     life_program_id, family_category_id, true, false, 'One hour with the parent and young person together.');

  family_plan_id := keystone.uuid_generate_v7();
  INSERT INTO keystone.plan
    (id, tenant_id, name, currency, interval, coaching_group, program_id, category_id, minimum_term_months,
     rollover_mode, description)
  VALUES
    (family_plan_id, foundry_tenant_id, 'Family Coaching', 'USD', 'month', 'life',
     life_program_id, family_category_id, 3, 'none',
     'Each month: four parent sessions, four young person sessions and two family sessions. $1,800 a month, three-month minimum term.');
  INSERT INTO keystone.plan_line (id, tenant_id, plan_id, service_id, quantity_per_cycle)
  VALUES
    (keystone.uuid_generate_v7(), foundry_tenant_id, family_plan_id, parent_service_id, 4),
    (keystone.uuid_generate_v7(), foundry_tenant_id, family_plan_id, young_service_id, 4),
    (keystone.uuid_generate_v7(), foundry_tenant_id, family_plan_id, family_session_service_id, 2);

  INSERT INTO keystone.price (id, tenant_id, subject_type, subject_id, amount_minor, currency, active)
  VALUES
    (keystone.uuid_generate_v7(), foundry_tenant_id, 'service', parent_service_id, 13000, 'USD', true),
    (keystone.uuid_generate_v7(), foundry_tenant_id, 'service', young_service_id, 13000, 'USD', true),
    (keystone.uuid_generate_v7(), foundry_tenant_id, 'service', family_session_service_id, 13000, 'USD', true),
    (keystone.uuid_generate_v7(), foundry_tenant_id, 'plan', family_plan_id, 180000, 'USD', true);

  INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor, sample)
  VALUES
    (foundry_tenant_id, 'items.service.created', 'items', 'service', parent_service_id, '{}'::jsonb, 'system', false),
    (foundry_tenant_id, 'items.service.created', 'items', 'service', young_service_id, '{}'::jsonb, 'system', false),
    (foundry_tenant_id, 'items.service.created', 'items', 'service', family_session_service_id, '{}'::jsonb, 'system', false),
    (foundry_tenant_id, 'items.plan.created', 'items', 'plan', family_plan_id, '{}'::jsonb, 'system', false);

  RAISE NOTICE '0545: renamed the four life-coaching items · seeded Family Coaching (3 services + plan, Life Coaching / Family) for foundry';
END
$family_coaching_seed$;

DO $self_check$
BEGIN
  IF EXISTS (SELECT 1 FROM keystone.service WHERE tenant_id = '01a09bfe-481c-7cbe-9f80-d28b613e5bba' AND name LIKE '%(Life Coaching)%') THEN
    RAISE EXCEPTION '0545: a service still carries the "(Life Coaching)" suffix after the rename';
  END IF;
  IF EXISTS (SELECT 1 FROM keystone.package WHERE tenant_id = '01a09bfe-481c-7cbe-9f80-d28b613e5bba' AND name LIKE '%(Life Coaching)%') THEN
    RAISE EXCEPTION '0545: a package still carries the "(Life Coaching)" suffix after the rename';
  END IF;
END
$self_check$;
