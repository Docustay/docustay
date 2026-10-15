-- 0547_practice_display_name
--
-- Follow-up brief, Part 1's own "Practice name" recon — MEASURED: `practice.name`
-- (src/settings/keys.mjs:388) has no ruledDefault and no migration has ever set it for Docustay, so
-- every reader that prefers it — the lead email (src/routes/publicLeads.mjs:192), public booking
-- (src/booking/publicBooking.mjs:170), and now documents (src/documents/variableCatalogue.mjs's
-- `practice.name` variable, fixed in this same commit to also prefer the setting) — has always
-- fallen through to `tenant.name`, the LEGAL name "an example organisation Recovery Services LLC". the maintainer's own
-- instruction: the brand is "an example organisation"; keep the legal name only where legally
-- required (invoices, which read `tenant.name`/billing fields directly and are untouched here).
--
-- Same footing as 0541 — a data migration because this session has no authenticated Docustay session
-- to click through Settings with; Docustay matched by slug, no-op elsewhere.

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT keystone.resolve_tenant_by_slug('foundry') INTO v_tenant_id;
  IF v_tenant_id IS NULL THEN
    RAISE NOTICE '0547: no tenant with slug ''foundry'' — nothing to set';
    RETURN;
  END IF;
  PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant_id, 'practice.name', '"Example Practice Coaching"'::jsonb)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = '"Example Practice Coaching"'::jsonb;

  RAISE NOTICE '0547: practice.name set to "Example Practice Coaching" for foundry';
END $$;
