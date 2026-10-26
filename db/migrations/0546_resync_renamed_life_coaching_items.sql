-- 0546_resync_renamed_life_coaching_items
--
-- Follow-up brief, Part 1's own verify step — MEASURED against live Stripe (read-only API call,
-- this session): the four items 0545 renamed locally ("Single Session", "4/8/12 Sessions") are
-- STILL showing their old "(Life Coaching)" suffix on Stripe — `updated` on each Stripe product
-- equals its `created`, proving no sync has ever run against it since creation. Root cause: 0545's
-- rename UPDATEs (Part 7) had no accompanying `emit()` — unlike 0536's own "re-sync every existing
-- row" step at its own end, which this migration copies the shape of. A rename that never reaches
-- Stripe leaves a customer-facing product name wrong indefinitely; the worker's own
-- catalogue_stripe_sync job does the actual work once these events land.
--
-- GLRS only, additive (an INSERT into keystone.event only — no schema change, no data change
-- beyond the resync it requests).

SELECT set_config('keystone.tenant_id', '01a09bfe-481c-7cbe-9f80-d28b613e5bba', true);

DO $resync$
DECLARE
  glrs_tenant_id uuid := '01a09bfe-481c-7cbe-9f80-d28b613e5bba';
  n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM keystone.tenant_timezones_for_health() WHERE id = glrs_tenant_id) THEN
    RAISE NOTICE '0546: glrs tenant % not present — nothing to resync', glrs_tenant_id;
    RETURN;
  END IF;

  INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor, sample)
  SELECT glrs_tenant_id, 'items.service.updated', 'items', 'service', id, '{}'::jsonb, 'system', false
    FROM keystone.service
   WHERE tenant_id = glrs_tenant_id AND name = 'Single Session' AND stripe_product_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor, sample)
  SELECT glrs_tenant_id, 'items.package.updated', 'items', 'package', id, '{}'::jsonb, 'system', false
    FROM keystone.package
   WHERE tenant_id = glrs_tenant_id AND name IN ('4 Sessions', '8 Sessions', '12 Sessions')
     AND stripe_product_id IS NOT NULL;

  SELECT count(*) INTO n FROM keystone.event
   WHERE tenant_id = glrs_tenant_id AND topic IN ('items.service.updated','items.package.updated')
     AND created_at > now() - interval '1 minute';
  RAISE NOTICE '0546: enqueued % catalogue resync event(s) for the renamed life-coaching items', n;
END
$resync$;
