-- 0437_booking_invoice_id_safety_net — Stage 15 task 15.30
--
-- ★★★ SAFETY NET: idempotent check that booking.invoice_id column exists.
-- This is NOT the primary migration for booking.invoice_id (Stage 13's 0399 owns that).
-- If Stage 13's migration has already run, this is a no-op. If it hasn't, this ensures
-- the column is present so Stage 15's no-show charge module can use it.

ALTER TABLE keystone.booking ADD COLUMN IF NOT EXISTS invoice_id uuid NULL;

-- ★★★ ADD THE FOREIGN KEY ONLY IF IT DOESN'T EXIST (idempotent protection)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'keystone.booking'::regclass AND conname = 'booking_invoice_fk') THEN
    ALTER TABLE keystone.booking
      ADD CONSTRAINT booking_invoice_fk FOREIGN KEY (tenant_id, invoice_id)
      REFERENCES keystone.invoice(tenant_id, id);
  END IF;
END $$;

-- ★★ Create index for efficient lookups of bookings by invoice (nullable, so filtered index)
CREATE INDEX IF NOT EXISTS booking_invoice ON keystone.booking (tenant_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

-- ★★★ SELF-CHECK: RAISE unless the column exists AND tenant_id still exists (positive control).
-- A check that passes even with everything missing is worthless — prove that if this succeeds,
-- something real is there.
DO $$
DECLARE
  col_exists boolean;
  tenant_col_exists boolean;
BEGIN
  -- Check that invoice_id column exists
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'invoice_id'
  ) INTO col_exists;

  -- Check that tenant_id column exists (positive control — both or nothing)
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'tenant_id'
  ) INTO tenant_col_exists;

  IF NOT col_exists THEN
    RAISE EXCEPTION 'Migration 0437 failed: keystone.booking.invoice_id column does not exist';
  END IF;

  IF NOT tenant_col_exists THEN
    RAISE EXCEPTION 'Migration 0437 failed: keystone.booking.tenant_id column is missing (positive control failed)';
  END IF;
END $$;
