-- 0268_a_package_may_be_sellable_in_installments
-- Spec 02 (Items) §3, task 2.1.

ALTER TABLE keystone.package ADD COLUMN installments_allowed boolean NOT NULL DEFAULT false;

-- MOCKUPS §8:255 ("Can be paid in installments") is a per-package toggle this migration stores. The
-- installment SCHEDULE itself (splitting one sale into N charges) is money/Stripe machinery this
-- spec does not build — §14 records it as inert until spec 05 reads the flag, the same cross-spec
-- shape as CT-110.
