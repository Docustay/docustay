-- 0552_booking_fee_claim
--
-- Team/no-show-merge brief (1 Oct 2026), Part 1 — "merge the two no-show charge paths... so a
-- client can never be charged twice... idempotency key per booking + fee type, checked in the
-- database."
--
-- ★★★ THE BUG THIS CLOSES, FOUND BY READING BOTH PATHS SIDE BY SIDE: `src/booking/settleBooking.mjs`
--     (staff-interactive: credit → card → invoice → none, the "Held"/settle modal) and
--     `src/money/noShow.mjs::raiseNoShowCharge` (automatic: a LISTENER on `booking.booking.completed`,
--     fired by `POST /api/bookings/:id/complete` — a SEPARATE route, src/routes/bookingLifecycle.mjs,
--     that marks a session's outcome with no payment decision at all) both react to the SAME event,
--     with NO shared knowledge of each other. `raiseNoShowCharge`'s own idempotency check only looks
--     for an existing `line_item.invoice_id` on the booking — but settleBooking's CARD and CREDIT
--     payment methods create no line item at all. So: a staff member settles a no-show by charging
--     the card on file through the modal → `recordAttendance` still emits `booking.booking.completed`
--     → the automatic listener sees no invoice line item → raises a SECOND charge (an invoice, or a
--     Stripe InvoiceItem on the next bill) for the SAME missed session. Confirmed by tracing the code;
--     not executed against a real charge (HELD-adjacent discipline — Ty tests real charges).
--
-- ★ ONE TABLE, NOT A FLAG ON `booking`: a fee type (`no_show` today, `late_cancel` added in the same
--   migration since this brief adds it) is a FACT ABOUT A CHARGE DECISION, not a property of the
--   booking's lifecycle state the way `state`/`outcome` are — and a second fee type later (an
--   instalment-plan penalty, say) should not need a new boolean column each time.
-- ★ UNIQUE (tenant_id, booking_id, fee_type) IS THE WHOLE MECHANISM: whichever caller's INSERT lands
--   first wins; Postgres's own uniqueness check is atomic, so there is no race for two concurrent
--   callers (the interactive settle and the automatic listener, firing within the same commit
--   window) to both "win" and both charge.

CREATE TABLE keystone.booking_fee_claim (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  booking_id  uuid        NOT NULL REFERENCES keystone.booking(id) ON DELETE RESTRICT,
  fee_type    text        NOT NULL CHECK (fee_type IN ('no_show', 'late_cancel')),
  claimed_by  uuid        REFERENCES keystone.app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, booking_id, fee_type)
);

CREATE INDEX booking_fee_claim_booking_idx ON keystone.booking_fee_claim (tenant_id, booking_id);

ALTER TABLE keystone.booking_fee_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_fee_claim FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.booking_fee_claim
  USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT ON keystone.booking_fee_claim TO app_rw;
-- ★ No UPDATE, no DELETE: a claim is not amended or revoked by application code, same "a fact,
--   not a flag you can toggle back" shape as other append-only decision rows in this schema (the
--   audit log, the event outbox). If a charge genuinely needs reversing, that is a refund against
--   the payment it produced — never deleting the fact that a decision was made.

DO $self_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'keystone' AND table_name = 'booking_fee_claim'
  ) THEN
    RAISE EXCEPTION '0552: keystone.booking_fee_claim was not created';
  END IF;
  RAISE NOTICE '0552: keystone.booking_fee_claim created (no_show/late_cancel idempotency)';
END
$self_check$;
