-- TASK C1.1 — BOOKING POLICY KEYS WITH PER-SERVICE OVERRIDES
--
-- ★★★ Practice defaults live in tenant_setting; per-service overrides live on booking_policy.
--      policyFor(tx, tenantId, serviceId) returns the merged policy, service winning.
--      Enforcement is SERVER-SIDE on the route (createBooking, rescheduleBooking, cancelBookingByRequest).

ALTER TABLE keystone.booking_policy
  ADD COLUMN client_may_book boolean NULL,
  ADD COLUMN client_may_reschedule boolean NULL,
  ADD COLUMN client_may_cancel boolean NULL,
  ADD COLUMN reschedule_notice_minutes integer NULL CHECK (reschedule_notice_minutes IS NULL OR reschedule_notice_minutes > 0),
  ADD COLUMN late_cancel_behaviour text NULL CHECK (late_cancel_behaviour IS NULL OR late_cancel_behaviour IN ('free', 'credit_back', 'charge_percent')),
  ADD COLUMN late_cancel_charge_percent integer NULL CHECK (late_cancel_charge_percent IS NULL OR (late_cancel_charge_percent >= 0 AND late_cancel_charge_percent <= 100)),
  ADD COLUMN card_required_at_booking boolean NULL,
  ADD COLUMN card_kept_on_file boolean NULL,
  ADD COLUMN cancel_requires_contact boolean NULL,
  ADD COLUMN policy_text text NULL CHECK (policy_text IS NULL OR length(policy_text) <= 2000);

COMMENT ON COLUMN keystone.booking_policy.client_may_book IS
  'Task C1.1. Per-service override for booking.client_may_book. NULL means use practice default from tenant_setting.';
COMMENT ON COLUMN keystone.booking_policy.client_may_reschedule IS
  'Task C1.1. Per-service override for booking.client_may_reschedule. NULL means use practice default.';
COMMENT ON COLUMN keystone.booking_policy.client_may_cancel IS
  'Task C1.1. Per-service override for booking.client_may_cancel. NULL means use practice default.';
COMMENT ON COLUMN keystone.booking_policy.reschedule_notice_minutes IS
  'Task C1.1. Per-service override for booking.reschedule_notice_minutes. NULL means use practice default.';
COMMENT ON COLUMN keystone.booking_policy.late_cancel_behaviour IS
  'Task C1.1. Per-service override: how to handle late cancellations. Values: free|credit_back|charge_percent. NULL means use practice default.';
COMMENT ON COLUMN keystone.booking_policy.late_cancel_charge_percent IS
  'Task C1.1. Per-service override: charge percent for late cancellations (0-100, only used if late_cancel_behaviour=charge_percent). NULL means use practice default.';
COMMENT ON COLUMN keystone.booking_policy.card_required_at_booking IS
  'Task C1.1. Per-service override for booking.card_required_at_booking. NULL means use practice default.';
COMMENT ON COLUMN keystone.booking_policy.card_kept_on_file IS
  'Task C1.1. Per-service override for booking.card_kept_on_file. NULL means use practice default.';
COMMENT ON COLUMN keystone.booking_policy.cancel_requires_contact IS
  'Task C1.1. Per-service override for booking.cancel_requires_contact. NULL means use practice default.';
COMMENT ON COLUMN keystone.booking_policy.policy_text IS
  'Task C1.1. Per-service override for booking.policy_text (cancellation/booking rules text shown to client, ≤2000 chars). NULL means use practice default.';
