-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0513 · B-4 (F794) — BOOKING'S OUT-POINTERS RETIRE.
-- CONTRACTS.md §1: DROP `booking.invoice_id`, `booking.document_instance_id` (after 0512 and B-4's
-- code ship; contract step).
--
-- ★★★ APPLY THIS MIGRATION ONLY AFTER 0512 HAS RUN AND B-4'S CODE HAS SHIPPED. `0512` moved the
--     data these two columns pointed to (`line_item.booking_id`, `document_instance.booking_id`),
--     and B-4's code (`src/money/noShow.mjs`, `src/booking/history.mjs`, `src/money/reads.mjs`)
--     stopped reading and writing `booking.invoice_id` / `booking.document_instance_id`. Dropping
--     these columns before either of those has happened breaks whichever one has not: a live
--     reader of `booking.invoice_id` would 500 the instant this runs, and 0512's own backfill
--     needs the columns to still hold the values it is copying FROM.
-- ★★ THE RULE THIS ENFORCES PERMANENTLY (I29, B-8): `src/booking/` holds no invoice or line_item
--    reference — money's tables are reached from money's own reads, not through a booking column.
--    `test/b4_reach_in.test.mjs` greps `src/booking/*.mjs` for exactly this after the code lands.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'invoice_id'
  ) THEN
    ALTER TABLE keystone.booking DROP COLUMN invoice_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'document_instance_id'
  ) THEN
    ALTER TABLE keystone.booking DROP COLUMN document_instance_id;
  END IF;
END
$$;

-- ── SHAPE CHECK, WITH POSITIVE CONTROLS ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'invoice_id'
  ) THEN
    RAISE EXCEPTION '0513: booking.invoice_id still exists after DROP';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'document_instance_id'
  ) THEN
    RAISE EXCEPTION '0513: booking.document_instance_id still exists after DROP';
  END IF;

  -- ★ Positive control alongside the negatives: `booking` itself, and the columns B-4 kept
  --   (host_id, price_id), are still present — this asserts the table survived, not merely that
  --   two columns are gone.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'host_id'
  ) THEN
    RAISE EXCEPTION '0513: booking.host_id is missing — this migration dropped more than intended';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'price_id'
  ) THEN
    RAISE EXCEPTION '0513: booking.price_id is missing — this migration dropped more than intended';
  END IF;

  RAISE NOTICE '0513: booking.invoice_id and booking.document_instance_id retired.';
END
$$;

