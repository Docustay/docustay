-- 0273_a_credit_unlocks_as_its_installment_is_paid
-- Spec 02 (Items) §3, task 2.7 — FINDING 3 (Ty ruled, 22 Sep 2026, gap-list §14 #7).
--
-- Ty, verbatim: "Installments: credits unlock AS EACH INSTALLMENT IS PAID." Resolves MOCKUPS §24:688 /
-- open decision #7 — option B of the gap-list's three (gate usage to the paid fraction), not A (full
-- usage immediately) or C (leave the toggle inert).
--
-- ★ Reuses keystone.entitlement_credit — THE quantity schedule this codebase already has (one row per
--   credit, db/migrations/0015_…:194-219, src/money/writes.mjs:339 createEntitlement) — rather than
--   inventing a second counter. "Unlock" means exactly: a credit ROW moves from 'pending' to 'available',
--   the same state credit_one_per_booking/credit_state_shape already govern for 'reserved'/'consumed'.

ALTER TABLE keystone.entitlement
  ADD COLUMN installments_total integer CHECK (installments_total IS NULL OR installments_total > 1),
  ADD COLUMN installments_paid  integer NOT NULL DEFAULT 0 CHECK (installments_paid >= 0);

-- installments_total IS NULL: an ordinary, non-installment entitlement (paid in full) — every credit is
-- 'available' at creation, exactly today's createEntitlement behaviour, unchanged.
-- installments_total IS NOT NULL: entitlement was created on the FIRST installment succeeding (spec 02
-- §9 point 2c — createEntitlement only ever runs after a successful payment), so installments_paid
-- starts at 1, never 0.
ALTER TABLE keystone.entitlement ADD CONSTRAINT entitlement_installment_shape CHECK (
  (installments_total IS NULL AND installments_paid = 0) OR
  (installments_total IS NOT NULL AND installments_paid BETWEEN 1 AND installments_total));

ALTER TABLE keystone.entitlement_credit
  ADD COLUMN unlocks_at_installment integer CHECK (unlocks_at_installment IS NULL OR unlocks_at_installment > 1);

-- ★ Widen the existing status CHECK (the unnamed inline CHECK on status carries Postgres's own default
--   name, "entitlement_credit_status_check") to add exactly one new state.
ALTER TABLE keystone.entitlement_credit DROP CONSTRAINT entitlement_credit_status_check;
ALTER TABLE keystone.entitlement_credit ADD CONSTRAINT entitlement_credit_status_check
  CHECK (status IN ('available','reserved','consumed','returned','pending'));

-- 'pending' holds no booking, same shape as 'available'/'returned', but MUST carry the installment number
-- that unlocks it — the one thing that makes a 'pending' row provable rather than merely intended.
ALTER TABLE keystone.entitlement_credit DROP CONSTRAINT credit_state_shape;
ALTER TABLE keystone.entitlement_credit ADD CONSTRAINT credit_state_shape CHECK (
  (status IN ('available','returned') AND booking_id IS NULL AND consumed_at IS NULL) OR
  (status = 'pending'  AND booking_id IS NULL AND consumed_at IS NULL AND unlocks_at_installment IS NOT NULL) OR
  (status = 'reserved' AND booking_id IS NOT NULL AND consumed_at IS NULL) OR
  (status = 'consumed' AND booking_id IS NOT NULL AND consumed_at IS NOT NULL)
);

CREATE INDEX entitlement_credit_pending ON keystone.entitlement_credit (tenant_id, entitlement_id)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT "UNLOCK" MEANS, IN FULL, AND WHERE IT HAPPENS — spec 02 §3's 0273 write-up / §10, not built by
-- this migration:
--
-- 1. The split is proportional, computed CUMULATIVELY, never re-derived from a fraction that could
--    round differently each time. src/items/writes.mjs's new pure function resolveInstallmentUnlock({
--    totalCredits, installmentsTotal, installmentsPaid }) -> { unlockedCount } computes
--    unlockedCount = floor(totalCredits * installmentsPaid / installmentsTotal) — the cumulative count
--    unlocked THROUGH the given installment.
-- 2. At entitlement creation (spec 05's createEntitlement, src/money/writes.mjs:339, called after the
--    FIRST installment succeeds) — extended (spec 05's own task, not this migration) to accept
--    installmentsTotal = null and split the inserted credit rows available/pending per
--    resolveInstallmentUnlock's output.
-- 3. On every LATER installment succeeding — spec 05's payment_intent.succeeded webhook handler calls a
--    new unlockNextInstallment(tx, { tenantId, entitlementId, actorUserId }) (spec 05's own file,
--    src/money/writes.mjs — contract only, not built here) exactly once per successful installment,
--    inside that webhook's own transaction, idempotently.
-- 4. A credit in 'pending' is never counted "available" — the existing entitlement_credit_available
--    partial index (0015_…:215, WHERE status = 'available') already excludes it, unchanged.
--
-- This spec's own scope stops at resolving WHICH credit becomes eligible (resolveInstallmentUnlock);
-- the money-side unlock write itself (createEntitlement's installmentsTotal extension,
-- unlockNextInstallment) is spec 05's, unmodified by this task.
