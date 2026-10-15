-- 0443_automation_config_and_run — Stage 16 task 16.2 · CT-F10
--
-- Automation configuration storage (one row per automation type per tenant) and the run log
-- (append-only audit trail of every automation execution). The run log's "never-twice" guard
-- on (tenant_id, key, guard_key) for non-dropped state is a database constraint, not an
-- application responsibility — a retried webhook or redelivery cannot create duplicate rows.
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
CREATE TABLE keystone.automation_config (
  tenant_id  uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  key        text NOT NULL CONSTRAINT automation_config_key_shape CHECK (key ~ '^[a-z]+\.[a-z_]+$'),
  config     jsonb NOT NULL CONSTRAINT automation_config_is_object CHECK (jsonb_typeof(config) = 'object'),
  updated_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE keystone.automation_run (
  id                uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  key               text NOT NULL,
  subject_type      text NOT NULL CHECK (subject_type IN ('person','entitlement','booking','invoice','tenant')),
  subject_id        uuid NOT NULL,
  person_id         uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  guard_key         text NOT NULL CHECK (btrim(guard_key) <> ''),
  trigger_event_id  uuid REFERENCES keystone.event(id) ON DELETE RESTRICT,
  action            text NOT NULL CHECK (action IN ('told_client','task_opened','told_client_and_task','flagged','written_up')),
  state             text NOT NULL DEFAULT 'done' CHECK (state IN ('queued','done','dropped','failed')),
  run_at            timestamptz NOT NULL DEFAULT now(),
  notification_id   uuid REFERENCES keystone.notification(id) ON DELETE SET NULL,
  task_id           uuid REFERENCES keystone.task(id) ON DELETE SET NULL,
  outcome           text CHECK (outcome IN ('bought_again','moved_to_plan','nothing_yet')),
  outcome_detail    jsonb CHECK (outcome_detail IS NULL OR jsonb_typeof(outcome_detail) = 'object'),
  outcome_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_run_outcome_shape CHECK ((outcome IS NULL) = (outcome_at IS NULL))
);

CREATE UNIQUE INDEX automation_run_once ON keystone.automation_run (tenant_id, key, guard_key)
  WHERE state <> 'dropped';

CREATE INDEX automation_run_recent ON keystone.automation_run (tenant_id, key, run_at DESC);

CREATE INDEX automation_run_open_outcome ON keystone.automation_run (tenant_id, run_at)
  WHERE outcome IS NULL AND state = 'done';

-- ── TRIGGERS: touch_updated_at ─────────────────────────────────────────────────────────────
CREATE TRIGGER automation_config_touch BEFORE UPDATE ON keystone.automation_config
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

CREATE TRIGGER automation_run_touch BEFORE UPDATE ON keystone.automation_run
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.automation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.automation_config FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.automation_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.automation_run FORCE ROW LEVEL SECURITY;

-- ── POLICIES: automation_config ────────────────────────────────────────────────────────────
CREATE POLICY tenant_isolation ON keystone.automation_config
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.automation_config
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.automation_config
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ── POLICIES: automation_run ───────────────────────────────────────────────────────────────
CREATE POLICY tenant_isolation ON keystone.automation_run
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.automation_run
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.automation_run
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ── GRANTS ─────────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON keystone.automation_config TO app_rw;
GRANT SELECT, INSERT, UPDATE ON keystone.automation_run TO app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CLOSING SELF-CHECK — POSITIVE ASSERTIONS ONLY (what SHOULD be true)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
DO $prove$
DECLARE
  v_config_exists boolean;
  v_run_exists boolean;
  v_config_force_rls boolean;
  v_run_force_rls boolean;
  v_config_can_insert boolean;
  v_config_can_delete boolean;
  v_run_can_insert boolean;
  v_run_can_delete boolean;
BEGIN
  -- POSITIVE: tables exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'keystone' AND table_name = 'automation_config'
  ) INTO v_config_exists;
  IF NOT v_config_exists THEN
    RAISE EXCEPTION '0443: automation_config table does not exist';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'keystone' AND table_name = 'automation_run'
  ) INTO v_run_exists;
  IF NOT v_run_exists THEN
    RAISE EXCEPTION '0443: automation_run table does not exist';
  END IF;

  -- POSITIVE: FORCE ROW LEVEL SECURITY is on
  SELECT relforcerowsecurity FROM pg_class
   WHERE oid = 'keystone.automation_config'::regclass
   INTO v_config_force_rls;
  IF NOT v_config_force_rls THEN
    RAISE EXCEPTION '0443: FORCE ROW LEVEL SECURITY is not enabled on keystone.automation_config';
  END IF;

  SELECT relforcerowsecurity FROM pg_class
   WHERE oid = 'keystone.automation_run'::regclass
   INTO v_run_force_rls;
  IF NOT v_run_force_rls THEN
    RAISE EXCEPTION '0443: FORCE ROW LEVEL SECURITY is not enabled on keystone.automation_run';
  END IF;

  -- POSITIVE: app_rw can INSERT but not DELETE on both tables
  SELECT has_table_privilege('app_rw', 'keystone.automation_config', 'INSERT')
   INTO v_config_can_insert;
  IF NOT v_config_can_insert THEN
    RAISE EXCEPTION '0443: app_rw cannot INSERT on keystone.automation_config';
  END IF;

  SELECT has_table_privilege('app_rw', 'keystone.automation_config', 'DELETE')
   INTO v_config_can_delete;
  IF v_config_can_delete THEN
    RAISE EXCEPTION '0443: app_rw should not be able to DELETE on keystone.automation_config';
  END IF;

  SELECT has_table_privilege('app_rw', 'keystone.automation_run', 'INSERT')
   INTO v_run_can_insert;
  IF NOT v_run_can_insert THEN
    RAISE EXCEPTION '0443: app_rw cannot INSERT on keystone.automation_run';
  END IF;

  SELECT has_table_privilege('app_rw', 'keystone.automation_run', 'DELETE')
   INTO v_run_can_delete;
  IF v_run_can_delete THEN
    RAISE EXCEPTION '0443: app_rw should not be able to DELETE on keystone.automation_run';
  END IF;

  RAISE NOTICE '0443: automation_config and automation_run tables created; FORCE RLS enabled on both; app_rw can INSERT but not DELETE on both.';
END
$prove$;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)