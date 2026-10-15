-- QUEUE-NOW item 7 (the maintainer, 6 Oct 2026: "when the sandbox proofs pass, SWITCH PLATFORM PRODUCTION ONTO THE SHARED SYSTEM"). Turns the per-practice switch authoring.shared_engine ON for the one real practice, Docustay.
-- Proofs: scripts/sandbox/engine-workbench-proof.mjs (23/23: the Coaching Agreement through the engine reads the same word for word, 4 pages vs 4, sent, signed, sealed; flag on and off again) and
-- scripts/sandbox/engine-workbench-browser.mjs (writer, live AI draft, save, rollback). It switches on a NEW door only: no existing template, sent document or screen is changed, and nothing is converted until someone opens a template in the new writer.
-- ROLLBACK: set the same key to false — as an admin, POST /api/settings {"key":"authoring.shared_engine","value":false}; or a migration like this one with 'false'. Templates saved through the writer stay (they are ordinary contract templates).
DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT keystone.resolve_tenant_by_slug('foundry') INTO v_tenant_id;
  IF v_tenant_id IS NULL THEN
    RAISE NOTICE '0653: no tenant with slug ''foundry'' — nothing to switch on';
    RETURN;
  END IF;
  PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant_id, 'authoring.shared_engine', 'true'::jsonb)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = 'true'::jsonb;
END $$;
