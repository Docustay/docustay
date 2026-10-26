-- 0799_booking_source_website — A BOOKING MADE ON THE PRACTICE'S OWN WEBSITE SAYS SO (Booking everywhere, 22 Oct 2026).
--
-- The website (server-to-server door) and Mainstay's own booking pages both stored source 'public', so nothing could tell
-- them apart — and the change-or-cancel link must send a website booking back to the website's change page
-- (booking.manage_url_base) and a Mainstay-page booking to Mainstay's own /book/manage. 'website' joins the closed
-- vocabulary; existing rows are left as they are (they cannot be told apart after the fact). JS twin: BOOKING_SOURCES in
-- src/booking/createBooking.mjs.

ALTER TABLE keystone.booking DROP CONSTRAINT IF EXISTS booking_source_check;
ALTER TABLE keystone.booking ADD CONSTRAINT booking_source_check
  CHECK (source IN ('staff', 'portal', 'public', 'waitlist', 'rwg', 'website'));

DO $check$
BEGIN
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'keystone.booking'::regclass AND conname = 'booking_source_check')) !~ 'website' THEN
    RAISE EXCEPTION '0799: booking_source_check does not admit website';
  END IF;
END
$check$;
