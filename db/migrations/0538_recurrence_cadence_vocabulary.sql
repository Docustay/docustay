-- 0538 — BOOKING OVERHAUL, 29 Sep 2026 — WIDEN recurrence_cadence FOR REAL RECURRING SESSIONS.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ 0085 shipped `recurrence_cadence`/`recurrence_group_id` for "P7.19's job" — a real writer that
--     turns one booking into a series — and constrained the cadence to a 3-value enum:
--     'weekly' | 'fortnightly' | 'monthly'. [MEASURED, 29 Sep 2026 recon] nothing in `src/` ever wrote
--     either column: no caller of createBooking ever set recurrenceCadence, on any of the three
--     booking-creation paths (staff, public, client portal). P7.19 never happened.
--
-- ★★★ THIS MIGRATION IS THAT WRITER'S SCHEMA. `src/booking/createRecurringBookings.mjs` is the first
--     real caller, and Ty's own ask — "every week, every N weeks, set weekdays" — does not fit the
--     three-value enum: "every N weeks" needs a number (weekly/fortnightly are N=1/N=2 of ONE
--     pattern, not two separate words) and "specific weekdays" needs to name WHICH days, which no
--     fixed word can carry. The two patterns below are exactly `createRecurringBookings.mjs`'s own
--     `parseCadence` vocabulary — this constraint and that function's parser must never disagree
--     about what a valid cadence string looks like.
--
-- ★ SAFE TO REPLACE, NOT WIDEN. [MEASURED] since nothing ever wrote a cadence, there are zero rows
--   using 'weekly'/'fortnightly'/'monthly' in any real data — replacing the enum outright is not a
--   breaking migration for existing rows, only for a vocabulary nothing ever produced.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.booking DROP CONSTRAINT booking_recurrence_cadence_check;

ALTER TABLE keystone.booking
  ADD CONSTRAINT booking_recurrence_cadence_check
  CHECK (
    recurrence_cadence IS NULL
    OR recurrence_cadence ~ '^every_[0-9]{1,2}_weeks$'
    OR recurrence_cadence ~ '^weekdays:[A-Z]{2}(,[A-Z]{2}){0,6}$'
  );

-- ★ booking_recurrence_is_whole (0085) — cadence and group-id travel together — is untouched: this
--   migration only widens WHICH strings are a valid cadence, not the whole/whole-not rule around it.
