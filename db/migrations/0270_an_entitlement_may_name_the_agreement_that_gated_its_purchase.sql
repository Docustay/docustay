-- 0270_an_entitlement_may_name_the_agreement_that_gated_its_purchase
-- Spec 02 (Items) §3, task 2.1.

ALTER TABLE keystone.entitlement ADD COLUMN contract_id uuid REFERENCES keystone.document_instance(id) ON DELETE SET NULL;

-- Traceability only, mirroring subscription.contract_id's existing, MANDATORY
-- (subscription_requires_contract, 0015:320,342) shape — but nullable here, because most packages
-- will have no item_agreement_requirement row and buying one is not gated at all. Populated by
-- spec 05's own entitlement-creation call site (createEntitlement, src/money/writes.mjs:339) when
-- the purchase was gated; this spec does not call createEntitlement itself.
