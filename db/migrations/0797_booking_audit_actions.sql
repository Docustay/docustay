-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0797 · four audit actions for booking everywhere (22 Oct 2026; spec BOOKING-EVERYWHERE §5.4): a booking address claimed or
-- renamed, a custom page created/changed/deleted, a service's booking settings changed, and who delivers a service changed.
-- Written by src/routes/bookingPagesAdmin.mjs; declared in src/permissions/audit.mjs AUDIT_ACTIONS.
--
-- Bracket idiom: 0522's, verbatim (as 0554). No BEGIN/COMMIT — db/migrate.mjs owns the transaction (R8).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.audit_action NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.audit_action (key) VALUES
  ('booking.address_changed'),
  ('booking.page_changed'),
  ('booking.service_booking_changed'),
  ('booking.hosts_changed')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE keystone.audit_action FORCE ROW LEVEL SECURITY;

DO $$
DECLARE forced boolean; k text;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.audit_action'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0797: FORCE ROW LEVEL SECURITY was not restored on keystone.audit_action';
  END IF;
  FOREACH k IN ARRAY ARRAY['booking.address_changed','booking.page_changed','booking.service_booking_changed','booking.hosts_changed'] LOOP
    IF NOT EXISTS (SELECT 1 FROM keystone.audit_action WHERE key = k) THEN
      RAISE EXCEPTION '0797: % was not seeded into keystone.audit_action', k;
    END IF;
  END LOOP;
END $$;
