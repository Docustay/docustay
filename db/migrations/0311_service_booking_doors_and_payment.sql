-- 0311_service_booking_doors_and_payment
-- Spec 03b task 3b.1 · CT-118 (CONTRACTS-FEATURES.md — touches spec 02's table, recorded there so
-- spec 02 reads these columns rather than re-declaring a door/payment-mode set under a different
-- name).
--
-- ★★★ `keystone.service` IS A SPEC-02-OWNED TABLE. This ALTER is additive/nullable-or-defaulted
--    only, adds no CHECK spec 02's own writes must satisfy, and spec 02 does not need to build or
--    read these columns itself — `EngOnlineBooking` (spec 03b §2.3) is the only screen that writes
--    them. CT-118 records the split so it is not duplicated.
--
-- portal_bookable / public_bookable are the "two doors" MOCKUPS §10 names: an existing, already-
-- authenticated client books through the portal door; a stranger books through the new public door
-- (spec 03b task 3b.3). Both default to today's actual behaviour: every service is portal-bookable
-- today (nothing else exists), and NO service is public-bookable until an Owner explicitly turns the
-- new door on — the public booking surface is net-new and must not silently expose every service the
-- moment this migration applies.
ALTER TABLE keystone.service
  ADD COLUMN portal_bookable boolean NOT NULL DEFAULT true,
  ADD COLUMN public_bookable boolean NOT NULL DEFAULT false;

-- payment_mode / deposit_amount_minor: stored and shown only (spec 03b §9 — "no charge is ever
-- initiated by this spec"). 'free' is the only mode this spec's own code can actually honour; the
-- others are captured for `EngOnlineBooking`'s per-service toggle now so spec 05 (Group B, Stripe
-- Connect) has somewhere to read a practice's prior choice from once it lands the charge call.
ALTER TABLE keystone.booking_policy
  ADD COLUMN payment_mode text NOT NULL DEFAULT 'free'
    CHECK (payment_mode IN ('free', 'card_on_file', 'deposit', 'pay_in_full')),
  ADD COLUMN deposit_amount_minor integer NULL
    CHECK (deposit_amount_minor IS NULL OR deposit_amount_minor >= 0);

COMMENT ON COLUMN keystone.service.portal_bookable IS
  'Spec 03b / 0311 (CT-118). Bookable by an already-authenticated portal client. Defaults true:
   every service is portal-bookable today, unchanged by this migration.';
COMMENT ON COLUMN keystone.service.public_bookable IS
  'Spec 03b / 0311 (CT-118, CT-117). Bookable by an unauthenticated stranger through the new public
   booking door (task 3b.3). Defaults false: the public door is net-new and exposes nothing until an
   Owner opts a service in via EngOnlineBooking.';
COMMENT ON COLUMN keystone.booking_policy.payment_mode IS
  'Spec 03b / 0311 (CT-118). Stored and shown only — no charge is ever initiated by spec 03b (§9).
   The actual charge call belongs to spec 05 (Money/Stripe Connect); EngOnlineBooking''s per-service
   toggle refuses to turn on any mode but ''free'' while Stripe Connect is not connected.';
COMMENT ON COLUMN keystone.booking_policy.deposit_amount_minor IS
  'Spec 03b / 0311 (CT-118). Minor-units deposit amount for payment_mode = ''deposit''. NULL for
   every other mode. Never charged by spec 03b''s own code.';
