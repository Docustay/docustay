-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0524 · the signature hold points from the DOCUMENT to the booking (R15, RECONCILE — Ty 27 Sep 2026).
--
-- 0510 put `hold_instance_id` on keystone.booking (booking → document_instance), which I29 forbids: a booking carries
-- no pointer to an invoice or a document. Ty's ruling (option a): the pointer moves to
-- keystone.document_instance.hold_booking_id — the document points at the booking it holds, the same direction B-4
-- (0512) used for line items. confirmHeldBookings (src/booking/holds.mjs) runs from the outbox listener with no viewer;
-- `system_hold_read` lets exactly that read see an EXECUTED instance that holds a booking — 0418's
-- system_reminder_read pattern, one state, one column.
-- No BEGIN/COMMIT — db/migrate.mjs owns the transaction (R8).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.document_instance
  ADD COLUMN IF NOT EXISTS hold_booking_id uuid NULL
    REFERENCES keystone.booking(id) ON DELETE SET NULL;

COMMENT ON COLUMN keystone.document_instance.hold_booking_id IS
  'R15 / 0524 — the pending_signature booking this instance holds (createBooking, B-3). When this instance is executed,
   confirmHeldBookings (src/booking/holds.mjs) confirms that booking. Replaces booking.hold_instance_id (0510), dropped here.';

CREATE INDEX IF NOT EXISTS document_instance_hold_booking_idx
  ON keystone.document_instance (tenant_id, hold_booking_id) WHERE hold_booking_id IS NOT NULL;

-- carry any existing holds across (both tables are FORCE RLS; the migration role owns them, so FORCE is suspended for
-- the copy and proven back on below — 0427's bracket)
ALTER TABLE keystone.document_instance NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking NO FORCE ROW LEVEL SECURITY;
UPDATE keystone.document_instance di
   SET hold_booking_id = b.id
  FROM keystone.booking b
 WHERE b.hold_instance_id = di.id
   AND b.tenant_id = di.tenant_id;
ALTER TABLE keystone.booking FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_instance FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.booking DROP COLUMN IF EXISTS hold_instance_id;

CREATE POLICY system_hold_read ON keystone.document_instance
  FOR SELECT
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL
         AND state = 'executed'
         AND hold_booking_id IS NOT NULL);

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.document_instance'::regclass;
  IF NOT forced THEN RAISE EXCEPTION '0524: FORCE RLS not restored on keystone.document_instance'; END IF;
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.booking'::regclass;
  IF NOT forced THEN RAISE EXCEPTION '0524: FORCE RLS not restored on keystone.booking'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'hold_instance_id') THEN
    RAISE EXCEPTION '0524: booking.hold_instance_id still exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'keystone' AND table_name = 'document_instance' AND column_name = 'hold_booking_id') THEN
    RAISE EXCEPTION '0524: document_instance.hold_booking_id missing';
  END IF;
END $$;
