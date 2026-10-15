-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0523 · a write-off keeps its reason on the record, not in the event (R26, RECONCILE 27 Sep 2026).
--
-- markUncollectibleInvoice (src/money/invoiceActions.mjs) put the caller's free-text `reason` into the
-- money.invoice.marked_uncollectible payload; emit() refuses typed text in a payload (§2.4), so EVERY
-- "Mark uncollectible" with a reason threw and rolled back. Found by T1.15's test once R10 made the
-- Stripe double readable. Same fix 0140 made for archive/decline/stage_change: the text lives in
-- keystone.record_reason, joined to the event by id. This widens the kind CHECK by one value.
-- No BEGIN/COMMIT — db/migrate.mjs owns the transaction (R8).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.record_reason DROP CONSTRAINT record_reason_kind_check;
ALTER TABLE keystone.record_reason ADD CONSTRAINT record_reason_kind_check
  CHECK (kind IN ('archive', 'decline', 'stage_change', 'write_off'));
