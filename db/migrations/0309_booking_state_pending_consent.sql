-- 0309_booking_state_pending_consent
-- Spec 03b task 3b.1 · CT-116 (the teen consent gate) · CONTRACTS-FEATURES.md §0 block 0309–0333.
--
-- ★★★ WIDENS keystone.booking.state, DOES NOT REPLACE IT. 0013_booking_model.sql:111-112 shipped
--    the column with an inline, unnamed CHECK — Postgres auto-names an inline CHECK
--    `<table>_<column>_check`, so the constraint being dropped here is `booking_state_check`
--    (the same naming rule 0203's own header measures for `link_token_purpose_check`, an identical
--    shape: an inline CHECK on a text column with no explicit CONSTRAINT name). Same drop-and-reunion
--    idiom as 0203: every existing value is carried forward, only 'pending_consent' is new — dropping
--    the CHECK and re-adding it without one of the old values would silently illegalise every booking
--    already sitting in that state.
--
-- ★★ `pending_consent` joins the set of NON-TERMINAL states, exactly like `pending_payment` already
--    is (spec 03b §3, "Never deleted / frozen vs editable"). It transitions forward only:
--    `pending_consent` → `confirmed` (guardian consent executes, `booking.booking.confirmed`) or
--    `pending_consent` → `cancelled` (24h hold expiry, `booking_hold_expiry` job, or an explicit
--    cancel) — enforced by application code (the consent-gate/hold-expiry job, task 3b.5/3b.4), not
--    by this migration; this migration only legalises the value and gives the sweep a fast index.
--
-- ★ `cancelled_shape` (0013:120-123) and the EXCLUDE guard's `WHERE (state <> 'cancelled')` (0013:136)
--   both already treat every non-'cancelled' state uniformly, so neither needs to change for a new
--   non-terminal value to be safe.

ALTER TABLE keystone.booking DROP CONSTRAINT booking_state_check;
ALTER TABLE keystone.booking ADD CONSTRAINT booking_state_check
  CHECK (state IN ('pending_payment', 'pending_consent', 'confirmed', 'cancelled', 'completed', 'no_show'));
--               ^^^^^^^^^^^^^^^^^^^ ^^^^^^^^^^^ ^^^^^^^^^ ^^^^^^^^^^^^ 0013's five original values,
--               carried forward unchanged. 'pending_consent' is the only new member.

-- ★★★ THE HOLD-EXPIRY SWEEP'S INDEX. `booking_hold_expiry` (spec 03b §7, task 3b.4) re-reads every
--    booking still `pending_consent` at its scheduled +24h fire time; this partial index keeps that
--    read cheap regardless of table size, the same reasoning every other partial "still-open" index
--    in this schema already uses (e.g. `invite_open_idx`, 0202:51-52).
CREATE INDEX booking_pending_consent_idx ON keystone.booking (tenant_id, id)
  WHERE state = 'pending_consent';

COMMENT ON CONSTRAINT booking_state_check ON keystone.booking IS
  'Spec 03b / 0309 (CT-116). Widened from 0013''s five original values to add pending_consent: a
   booking for an adolescent client holds here until a guardian executes a consent document
   (task 3b.5) or the 24h hold expires (booking_hold_expiry, task 3b.4). Non-terminal, like
   pending_payment; cancelled_shape and the EXCLUDE guard already treat every non-cancelled state
   uniformly, so neither needed to change for this addition.';
