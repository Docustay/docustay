-- 0399_booking_flag_source_price — Stage 13 task 13.4 · CT-F29 (+ ruling R-H's three columns)
ALTER TABLE keystone.booking
  ADD COLUMN flag text NULL
    CONSTRAINT booking_flag_check CHECK (flag IS NULL OR flag IN ('longer_slot', 'first_session', 'be_careful', 'other')),
  ADD COLUMN flag_note text NULL
    CONSTRAINT booking_flag_note_length CHECK (flag_note IS NULL OR char_length(flag_note) <= 500),
  ADD COLUMN source text NOT NULL DEFAULT 'staff'
    CONSTRAINT booking_source_check CHECK (source IN ('staff', 'portal', 'public', 'waitlist', 'rwg')),
  ADD COLUMN price_id uuid NULL REFERENCES keystone.price (id) ON DELETE RESTRICT,
  ADD COLUMN no_show_at timestamptz NULL,
  -- ★★★ RULING R-H (CRITIC-D D5-4) — three columns that were each deferred to a stage which carries
  --     no migration for them. Stage 13 owns booking's shape and runs first, so they land here.
  --     All three are NULL with no default: prod 0 bookings, local 1, so nothing is backfilled.
  ADD COLUMN invoice_id uuid NULL REFERENCES keystone.invoice (id) ON DELETE SET NULL,
  ADD COLUMN document_instance_id uuid NULL REFERENCES keystone.document_instance (id) ON DELETE SET NULL,
  ADD COLUMN checked_in_at timestamptz NULL,
  ADD CONSTRAINT booking_flag_note_needs_flag CHECK (flag_note IS NULL OR flag IS NOT NULL);
ALTER TABLE keystone.app_user
  ADD COLUMN care_note text NULL
    CONSTRAINT app_user_care_note_length CHECK (care_note IS NULL OR char_length(care_note) <= 500);
COMMENT ON COLUMN keystone.app_user.care_note IS
  'F05 §2.1 "Be careful with this one" — team-visible only. Never selected by any /api/app/* or /api/public/* reader.';
COMMENT ON COLUMN keystone.booking.price_id IS
  'F05 §3 — the price row in force when booked. A move (reschedule) never changes it.';
COMMENT ON COLUMN keystone.booking.invoice_id IS
  'CT-F29 / ruling R-H. Written by Stage 15 (15.27/15.30, the no-show charge). NULL until then.';
COMMENT ON COLUMN keystone.booking.document_instance_id IS
  'CT-F29 / ruling R-H. Written by Stage 14 (CT-F07, agreement sent at booking). NULL until then.';
COMMENT ON COLUMN keystone.booking.checked_in_at IS
  'CT-F29 / ruling R-H. Written by Stage 18 (staff app "Start session"). NULL until then.';
