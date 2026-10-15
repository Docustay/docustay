-- 0482 — A SESSION HAS A LIFECYCLE (Task 20.28).
--
-- ★★★ THE COLUMN. A booking may be checked in before it starts, so `checked_in_at` is orthogonal
--     to the `booking.state` machine — a pending_payment or confirmed session may be checked in, and
--     the column reads NULL until someone calls `POST /api/bookings/:id/check-in`. A complete or
--     no_show session may have no check-in (a no-show with no check-in is a session the coach did
--     not open at all). The column belongs to `booking`, not to the state: you may check in, then
--     not check out; you may check in, cancel the session, and it still says when; you may complete
--     without checking in, leaving `checked_in_at` NULL.
--
-- ★ WRITER: `POST /api/bookings/:id/check-in` (src/routes/bookingLifecycle.mjs), idempotent;
--   sets checked_in_at once, does nothing if already set. READERS: the check-in column on the
--   session screen, once it exists.
-- ★ NULLABLE ON PURPOSE: a session that was not checked in explicitly should read NULL, not a time.
--
-- DATA: `keystone.booking` rows exist for the maintainer's build tenants (the platform is not live); the new
-- column reads NULL until checked in. No UPDATE needed; the column is self-check-populated.

ALTER TABLE keystone.booking NO FORCE ROW LEVEL SECURITY;

-- ★ REHEARSAL FIX (25 Sep 2026): 0399 already added booking.checked_in_at timestamptz NULL — the
--   same column this file wants. IF NOT EXISTS keeps the file correct on both histories; the
--   self-check below still proves exactly one such column.
ALTER TABLE keystone.booking
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz NULL;

-- ── Self-check, run while NO FORCE is still in effect (the migration role owns the table, so the
--    probe reaches the new column instead of being stopped by a forced RLS policy first). ─────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'booking'
     AND column_name = 'checked_in_at';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0482 self-check: expected checked_in_at column, found %', n_cols;
  END IF;
END
$check$;

ALTER TABLE keystone.booking FORCE ROW LEVEL SECURITY;

-- ── And prove FORCE survived the ALTER ────────────────────────────────────────────────────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'booking';
  IF NOT forced THEN
    RAISE EXCEPTION '0482 self-check: RLS is no longer FORCED on booking';
  END IF;
END
$rls$;
