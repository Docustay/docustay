-- 0396_booking_capacity_and_occurrence_waitlist — Stage 13 task 13.1 · G30 · CT-F05
ALTER TABLE keystone.booking
  ADD COLUMN capacity integer NULL
    CONSTRAINT booking_capacity_range CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 500);
COMMENT ON COLUMN keystone.booking.capacity IS
  'G30/CT-F05. Seats on this occurrence. NULL = one-to-one (reads as 1). taken is computed from booking_participant (party client|pir), never stored.';
ALTER TABLE keystone.service
  ADD COLUMN default_capacity integer NULL
    CONSTRAINT service_default_capacity_range CHECK (default_capacity IS NULL OR default_capacity BETWEEN 1 AND 500);
COMMENT ON COLUMN keystone.service.default_capacity IS
  'G30. "People per session" (F06 §2.2, written by Stage 14). createBooking copies it onto booking.capacity when the caller gives none.';
ALTER TABLE keystone.booking_waitlist_entry
  ADD COLUMN booking_id uuid NULL,
  ADD CONSTRAINT booking_waitlist_entry_booking_fkey FOREIGN KEY (tenant_id, booking_id)
    REFERENCES keystone.booking (tenant_id, id) ON DELETE SET NULL (booking_id);
CREATE INDEX booking_waitlist_entry_occurrence_idx
  ON keystone.booking_waitlist_entry (tenant_id, booking_id, status, position)
  WHERE booking_id IS NOT NULL;
CREATE INDEX booking_participant_seats_idx
  ON keystone.booking_participant (tenant_id, booking_id)
  WHERE party IN ('client', 'pir');
