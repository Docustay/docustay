-- 0266_a_line_item_may_remember_which_discount_it_used
-- Spec 02 (Items) §3, task 2.1.

ALTER TABLE keystone.line_item ADD COLUMN discount_id uuid REFERENCES keystone.discount(id) ON DELETE SET NULL;
CREATE INDEX line_item_discount_idx ON keystone.line_item (tenant_id, discount_id) WHERE discount_id IS NOT NULL;

-- ON DELETE SET NULL, not RESTRICT: a discount is never deleted by this spec (only retired via
-- active:false), but if a future cleanup ever removes one, an already-issued line item's own
-- discount_minor (the snapshot, unaffected) still tells the truth about what the client paid —
-- losing the discount_id back-reference loses attribution, not money. The INSERT into line_item
-- that sets this column, and the redemption-count increment beside it, are spec 05's own file
-- (src/money/writes.mjs's createLineItem) — this migration only opens the column; spec 02 §10
-- states the exact contract spec 05 builds against it.
