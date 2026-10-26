-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0510 · B-3 — a service that needs a signature holds the booking until it is signed (F793).
-- specs/de-code/CONTRACTS.md §1: `booking.state` CHECK gains `pending_signature`; `booking.
-- hold_expires_at timestamptz NULL`; `booking.hold_instance_id uuid NULL REFERENCES
-- document_instance` — the instance the hold waits on.
--
-- ★★★ WIDENS `booking.state`, DOES NOT REPLACE IT — same idiom 0309 (CT-116, `pending_consent`)
--     already used on this exact column/constraint: every existing value is carried forward, only
--     `pending_signature` is new. `pending_signature` is NON-TERMINAL like `pending_payment` and
--     `pending_consent` — it transitions forward only, to `confirmed` (the agreement is executed,
--     `src/booking/holds.mjs` `confirmHeldBookings`) or `cancelled` (the hold expires unsigned,
--     `releaseExpiredHolds`) — enforced by application code, not this migration.
-- ★★ `hold_instance_id` follows the SAME pattern `booking.document_instance_id` already uses on this
--    table (0399:15) — a nullable pointer at `document_instance`, `ON DELETE SET NULL` so a deleted
--    instance clears the pointer rather than blocking or cascading into the booking itself.
-- ★ Idempotent: the CHECK swap is guarded by a check for `pending_signature` already being present
--   in the live constraint definition; both new columns use `ADD COLUMN IF NOT EXISTS`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- §a · the CHECK swap — same naming rule 0309's own header measures: `booking_state_check` is the
-- live name (0013's original inline CHECK, re-created without a name by 0309's own drop-and-reunion).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.booking'::regclass
       AND conname  = 'booking_state_check'
       AND pg_get_constraintdef(oid) LIKE '%pending_signature%'
  ) THEN
    ALTER TABLE keystone.booking DROP CONSTRAINT booking_state_check;
    ALTER TABLE keystone.booking ADD CONSTRAINT booking_state_check
      CHECK (state = ANY (ARRAY['pending_payment','pending_consent','pending_signature',
                                 'confirmed','cancelled','completed','no_show']));
  END IF;
END
$$;

-- §b · the two new columns.
ALTER TABLE keystone.booking
  ADD COLUMN IF NOT EXISTS hold_expires_at  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS hold_instance_id uuid NULL
    REFERENCES keystone.document_instance(id) ON DELETE SET NULL;

COMMENT ON COLUMN keystone.booking.hold_expires_at IS
  'B-3 (F793) — set only while state = pending_signature: the moment the hold releases and the
   booking is cancelled (cancellation_reason = signature_not_received) if the agreement is still
   unsigned. NULL otherwise. src/booking/holds.mjs releaseExpiredHolds reads this.';
COMMENT ON COLUMN keystone.booking.hold_instance_id IS
  'B-3 (F793) — the document_instance a pending_signature hold is waiting on. src/booking/holds.mjs
   confirmHeldBookings moves every booking with this instance id to confirmed once it executes.
   ON DELETE SET NULL — deleting the instance clears the pointer, never the booking.';

-- §c · shape check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'hold_expires_at'
  ) THEN
    RAISE EXCEPTION '0510: keystone.booking.hold_expires_at missing after ALTER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'booking' AND column_name = 'hold_instance_id'
  ) THEN
    RAISE EXCEPTION '0510: keystone.booking.hold_instance_id missing after ALTER';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'keystone.booking'::regclass AND conname = 'booking_state_check')
     NOT LIKE '%pending_signature%' THEN
    RAISE EXCEPTION '0510: booking_state_check does not admit pending_signature';
  END IF;
  -- ★ Positive control: the ORIGINAL values are still legal too, so this is a widening, not a
  --   replacement — the same check 0309's own migration would fail if it had dropped a value.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'keystone.booking'::regclass AND conname = 'booking_state_check')
     NOT LIKE '%confirmed%' THEN
    RAISE EXCEPTION '0510: booking_state_check lost an existing value — this must be a widening';
  END IF;
  RAISE NOTICE '0510: booking.state admits pending_signature; hold_expires_at/hold_instance_id present.';
END
$$;

