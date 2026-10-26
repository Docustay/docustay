-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- USAGE COUNTING SCHEMA & LEDGER (Task 17.12 — CT-F12 core). Widen the metric CHECK, add
-- reconciliation columns to the counter, and create the immutable usage ledger table with RLS.
-- ───────────────────────────────────────────────────────────────────────────────────────────────

-- ── Widen the metric CHECK. The name is Postgres's default for 0335's inline CHECK
--    (`mainstay_usage_counter_metric_check`, MEASURED in both databases 25 Sep 2026), but it is
--    LOOKED UP rather than typed, so a database whose constraint was ever renamed still migrates
--    and an ABSENT constraint stops the migration with a sentence that says so. ────────────────
DO $usage_metric_check_widen$
DECLARE
  v_name text;
BEGIN
  SELECT c.conname INTO v_name
    FROM pg_constraint c
   WHERE c.conrelid = 'keystone.mainstay_usage_counter'::regclass
     AND c.contype  = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%metric%';
  IF v_name IS NULL THEN
    RAISE EXCEPTION '0458: no CHECK constraint on keystone.mainstay_usage_counter mentions "metric" — 0335 created one and it is gone. Refusing to widen a constraint that is not there.';
  END IF;
  EXECUTE format('ALTER TABLE keystone.mainstay_usage_counter DROP CONSTRAINT %I', v_name);
  RAISE NOTICE '0458: dropped metric CHECK "%"', v_name;
END $usage_metric_check_widen$;

ALTER TABLE keystone.mainstay_usage_counter ADD CONSTRAINT mainstay_usage_counter_metric_check
  CHECK (metric IN ('ai_draft','marketing_email','text','esign'));
ALTER TABLE keystone.mainstay_usage_counter
  ADD COLUMN reconciled_count integer NULL CHECK (reconciled_count >= 0),
  ADD COLUMN reconciled_at    timestamptz NULL;
CREATE TABLE keystone.mainstay_usage_event (
  id            uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  metric        text NOT NULL CHECK (metric IN ('ai_draft','marketing_email','text','esign')),
  units         integer NOT NULL DEFAULT 1 CHECK (units > 0),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  provider      text NOT NULL CHECK (provider IN ('anthropic','twilio','resend','internal')),
  provider_ref  text NULL CHECK (char_length(provider_ref) <= 200),
  reconcile_state text NOT NULL DEFAULT 'pending'
                CHECK (reconcile_state IN ('pending','confirmed','missing'))
);
CREATE INDEX mainstay_usage_event_period_idx
  ON keystone.mainstay_usage_event (tenant_id, metric, occurred_at);
ALTER TABLE keystone.mainstay_usage_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.mainstay_usage_event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.mainstay_usage_event
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.mainstay_usage_event
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.mainstay_usage_event
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ── CT-F52 §3.2 point 3 — the reference-practice read policy. ──────────────────────────────────
CREATE POLICY reference_guard_read ON keystone.mainstay_usage_event
  FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ── CT-F52 §3.2 point 4 — grant ONLY what the module does. `recordUsage` inserts; the reconcile
--    job updates `reconcile_state`; NOTHING deletes a usage row, ever (it is a billing ledger),
--    so there is no DELETE grant and no `tenant_delete` policy. ────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON keystone.mainstay_usage_event TO app_rw;
GRANT SELECT                  ON keystone.mainstay_usage_event TO reference_guard;

-- ── CT-F52 §3.2 point 5 — BOTH refuse-touch triggers, each ENABLE ALWAYS. `catalog-conformance`
--    fails any relation with a tenant_id column that has neither (`db/gates/catalog-conformance.mjs:176-186`).
--    `keystone.refuse_touch_reference_rows()` exists (0099:103-116); `reference_guard` exists (0144:90-91). ──
-- ★ REHEARSAL FIX (25 Sep 2026): CREATE TRIGGER needs EXECUTE on the trigger function, which
--   reference_guard owns and lends to nobody — the 0381/0402 lend, handed back below.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER mainstay_usage_event_refuse_reference_delete_trg AFTER DELETE ON keystone.mainstay_usage_event
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.mainstay_usage_event ENABLE ALWAYS TRIGGER mainstay_usage_event_refuse_reference_delete_trg;
CREATE TRIGGER mainstay_usage_event_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.mainstay_usage_event
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.mainstay_usage_event ENABLE ALWAYS TRIGGER mainstay_usage_event_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

COMMENT ON TABLE keystone.mainstay_usage_event IS 'CT-F12 (Stage 17, task 17.12) …';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- SELF-CHECK — prove the three things this migration claims, before it commits. Every other
-- Stage-17/18 migration carries one; this is 0458's (critic S17-4). Counts and shapes only.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $usage_0458_self_check$
DECLARE
  v_def      text;
  v_cols     integer;
  v_policies integer;
  v_triggers integer;
  v_forced   boolean;
BEGIN
  -- 1 · the widened CHECK admits all four metrics and still refuses a fifth.
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'keystone.mainstay_usage_counter'::regclass
     AND c.conname  = 'mainstay_usage_counter_metric_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '0458: the widened metric CHECK was not created.';
  END IF;
  IF v_def NOT LIKE '%text%' OR v_def NOT LIKE '%esign%'
     OR v_def NOT LIKE '%ai_draft%' OR v_def NOT LIKE '%marketing_email%' THEN
    RAISE EXCEPTION '0458: metric CHECK does not admit all four metrics: %', v_def;
  END IF;
  IF v_def LIKE '%staff%' THEN
    RAISE EXCEPTION '0458: metric CHECK admits "staff", which is counted from app_user and never metered: %', v_def;
  END IF;

  -- 2 · the two reconcile columns exist and are NULLABLE (a NOT NULL here would have failed every
  --     existing row had there been any, and would refuse every live count from now on).
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'mainstay_usage_counter'
     AND column_name IN ('reconciled_count','reconciled_at')
     AND is_nullable = 'YES';
  IF v_cols <> 2 THEN
    RAISE EXCEPTION '0458: expected 2 nullable reconcile columns on mainstay_usage_counter, found %', v_cols;
  END IF;

  -- 3 · the new ledger table is FORCE-RLS with its three tenant policies. A new tenant table that
  --     enables RLS but never FORCES it is readable by its owner across every practice.
  SELECT c.relforcerowsecurity INTO v_forced
    FROM pg_class c WHERE c.oid = 'keystone.mainstay_usage_event'::regclass;
  IF v_forced IS NOT TRUE THEN
    RAISE EXCEPTION '0458: keystone.mainstay_usage_event is not FORCE ROW LEVEL SECURITY.';
  END IF;
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'mainstay_usage_event'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF v_policies <> 4 THEN
    RAISE EXCEPTION '0458: expected the 3 tenant policies + reference_guard_read on mainstay_usage_event, found %', v_policies;
  END IF;

  -- 4 · CT-F52 point 5 — both refuse-touch triggers, both ENABLE ALWAYS ('A' in tgenabled).
  SELECT count(*) INTO v_triggers
    FROM pg_trigger t
   WHERE t.tgrelid = 'keystone.mainstay_usage_event'::regclass
     AND NOT t.tgisinternal
     AND t.tgenabled = 'A';
  IF v_triggers <> 2 THEN
    RAISE EXCEPTION '0458: expected 2 ENABLE ALWAYS refuse-touch triggers on mainstay_usage_event, found %', v_triggers;
  END IF;

  -- ═════════════════════════════════════════════════════════════════════════════════════════════
  -- 5 · ★★★ THE POSITIVE CONTROL, INSIDE THE SQL (CT-F52 point 6; 0370 is the template). Every
  --     assertion above answers "is this thing there". A self-check made only of those passes on a
  --     database where NOTHING exists — so this one asserts a privilege that must be TRUE and one
  --     that must be FALSE, and a check that answered "no" to everything cannot get past it.
  -- ═════════════════════════════════════════════════════════════════════════════════════════════
  IF NOT has_table_privilege('app_rw', 'keystone.mainstay_usage_event', 'INSERT') THEN
    RAISE EXCEPTION '0458: app_rw cannot INSERT into mainstay_usage_event — the grant did not take.';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.mainstay_usage_event', 'DELETE') THEN
    RAISE EXCEPTION '0458: app_rw holds DELETE on mainstay_usage_event — a billing ledger is never deleted from.';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.mainstay_usage_event', 'SELECT') THEN
    RAISE EXCEPTION '0458: reference_guard cannot SELECT mainstay_usage_event.';
  END IF;

  RAISE NOTICE '0458: metric CHECK widened to four, reconcile columns added, usage ledger FORCE-RLS with 4 policies, 2 ENABLE ALWAYS triggers, grants proven both ways.';
END $usage_0458_self_check$;
