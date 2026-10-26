-- 0534_price_stripe_archive — Ty, 29 Sep 2026 (Change price ruling): "Stripe prices can't be
-- edited, so create a new Stripe Price, make it the active one, and archive the old one."
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE GAP THIS CLOSES. `src/money/catalogue.mjs`'s `syncProductAndPrices` already does the
--     "create a new Stripe Price" half exactly right (§Z4's supersede law means a re-priced
--     service already gets a brand-new `keystone.price` row, and this file's own PRICE paragraph
--     already gives it a brand-new, immutable Stripe Price to match — "a changed amount is always
--     a NEW price row ... and therefore a NEW, separate Stripe Price — never an edit to the old
--     one, on either side"). It NEVER did the second half: the sync loop reads only
--     `WHERE effective_to IS NULL` (the open row), so once `createPrice`'s supersede closes the
--     old row, that row's Stripe Price is never looked at again — left `active: true` on Stripe's
--     side forever, alongside the new one. A practice looking at its own Stripe dashboard, or a
--     Payment Link built off "the product's active prices", would see two live prices for one
--     service.
--
-- ★★ `stripe_archived_at` IS THE STORED FACT, NOT A LIVE STRIPE READ, for the same reason every
--    other mirror column in this table already is one: `syncProductAndPrices`'s whole design is
--    "read the local mirror column first: an id already there means already done, full stop" (that
--    file's own header). Without a stored marker, every sync of every subject would have to
--    re-scan its entire closed price history and re-ask Stripe about each one, forever, to find
--    out which are already archived — the exact unbounded-rescan shape this design otherwise
--    avoids everywhere else.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.price ADD COLUMN stripe_archived_at timestamptz;

COMMENT ON COLUMN keystone.price.stripe_archived_at IS
  '0534: set once syncProductAndPrices has called Stripe to mark this price''s stripe_price_id '
  'inactive (active=false), after a later price row superseded it. NULL for an open (current) '
  'row, for a superseded row not yet archived, and for a row with no stripe_price_id at all '
  '(never synced — nothing to archive).';

-- ── SELF-CHECK ─────────────────────────────────────────────────────────────────────────────────
DO $price_stripe_archive_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'price' AND column_name = 'stripe_archived_at'
  ) THEN
    RAISE EXCEPTION '0534: keystone.price.stripe_archived_at was not created';
  END IF;
  RAISE NOTICE '0534: keystone.price.stripe_archived_at added';
END
$price_stripe_archive_check$;
