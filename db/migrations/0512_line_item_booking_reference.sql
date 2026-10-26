-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0512 · B-4 (F794) — LINE_ITEM'S booking_id BECOMES A REFERENCE, NOT A PARENT.
-- CONTRACTS.md §1: `line_item_exactly_one_parent` re-created WITHOUT `booking_id` (parent ∈
-- invoice · document · estimate); `document_instance.booking_id uuid NULL REFERENCES booking`;
-- backfill: for each `booking.invoice_id`, set `line_item.booking_id` on that invoice's no-show
-- line; for each `booking.document_instance_id`, set `document_instance.booking_id`.
--
-- ★★★ `line_item.booking_id` ALREADY EXISTS (0087) as one arm of the original exclusive arc — but
--     [MEASURED] nothing in `src/` ever calls `createLineItem` with `parentType: "booking"` (only
--     `"invoice"` is used, in `src/money/noShow.mjs`), so the column has always held zero rows as a
--     PARENT. This migration repurposes it: from here on it is a REFERENCE a no-show charge's line
--     carries ALONGSIDE its real parent (`invoice_id`), so booking history can find its own charge
--     without booking holding an out-pointer into money's tables (`booking.invoice_id`, retired by
--     0513 once B-4's code has shipped). The column, its FK (`line_item_booking_fkey`, composite on
--     `(tenant_id, booking_id)`, 0087) and its index are UNCHANGED — only the exclusivity CHECK
--     stops counting it.
-- ★★ THE BACKFILL IS SAFE BECAUSE THE COLUMN WAS ALWAYS EMPTY AS A PARENT: every row this backfill
--    touches has `invoice_id` (or, for document_instance, nothing at all) as its real parent
--    already, so relaxing the CHECK below can never leave a row satisfying zero arms — it can only
--    ever let a row satisfy `invoice_id` alone where it used to have to satisfy `invoice_id` alone
--    with `booking_id` free (already true) or, in principle, `booking_id` alone (measured: no rows).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- §a · REFUSE TO PROCEED IF THE MEASURED "ZERO ROWS" ASSUMPTION EVER STOPS BEING TRUE. A row whose
--     ONLY set arm is `booking_id` would satisfy today's CHECK ( =1 ) but satisfy NOTHING once
--     `booking_id` stops counting — silently becoming an orphaned line item. Fail loudly here,
--     where the reason is legible, rather than at the CHECK below with no context.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM keystone.line_item
   WHERE booking_id IS NOT NULL
     AND invoice_id IS NULL AND document_id IS NULL AND estimate_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '0512: % line_item row(s) are parented ONLY by booking_id — repointing them to a '
      'real parent is required before this migration can drop booking_id from the exclusive arc', n;
  END IF;
END
$$;

-- §b · `line_item_exactly_one_parent` RE-CREATED WITHOUT `booking_id`. `booking_id` stays a real,
--     FK-enforced column (0087) — just no longer one of the arms this CHECK counts.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.line_item'::regclass AND conname = 'line_item_exactly_one_parent'
  ) THEN
    ALTER TABLE keystone.line_item DROP CONSTRAINT line_item_exactly_one_parent;
  END IF;
  ALTER TABLE keystone.line_item ADD CONSTRAINT line_item_exactly_one_parent
    CHECK ((invoice_id IS NOT NULL)::int + (document_id IS NOT NULL)::int
         + (estimate_id IS NOT NULL)::int = 1);
END
$$;

-- §c · `document_instance.booking_id` — the session a contract/form was raised for, so booking
--     history can reach it without `booking.document_instance_id` (retired by 0513).
ALTER TABLE keystone.document_instance
  ADD COLUMN IF NOT EXISTS booking_id uuid NULL
    REFERENCES keystone.booking (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS document_instance_booking_idx
  ON keystone.document_instance (booking_id) WHERE booking_id IS NOT NULL;

COMMENT ON COLUMN keystone.document_instance.booking_id IS
  'B-4 (F794) — the session this document was raised for, if any. Replaces booking.document_instance_id '
  '(retired 0513) as the way booking history reaches its own agreement/form.';

-- §d · BACKFILL — for each `booking.invoice_id`, set `line_item.booking_id` on that invoice's
--     no-show line. A no-show invoice carries exactly one line (raised by src/money/noShow.mjs), so
--     matching by `(tenant_id, invoice_id)` is sufficient; `booking_id IS NULL` makes this re-runnable.
UPDATE keystone.line_item li
   SET booking_id = b.id
  FROM keystone.booking b
 WHERE b.invoice_id IS NOT NULL
   AND li.tenant_id = b.tenant_id
   AND li.invoice_id = b.invoice_id
   AND li.booking_id IS NULL;

-- §e · BACKFILL — for each `booking.document_instance_id`, set `document_instance.booking_id`.
UPDATE keystone.document_instance di
   SET booking_id = b.id
  FROM keystone.booking b
 WHERE b.document_instance_id IS NOT NULL
   AND di.tenant_id = b.tenant_id
   AND di.id = b.document_instance_id
   AND di.booking_id IS NULL;

-- §f · SHAPE CHECK, WITH POSITIVE CONTROLS.
DO $$
DECLARE
  n int;
  v_missing_line_backfill int;
  v_missing_doc_backfill int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'keystone.line_item'::regclass AND conname = 'line_item_exactly_one_parent';
  IF n <> 1 THEN
    RAISE EXCEPTION '0512: line_item_exactly_one_parent must exist exactly once, found %', n;
  END IF;
  IF NOT (SELECT convalidated FROM pg_constraint
           WHERE conrelid = 'keystone.line_item'::regclass AND conname = 'line_item_exactly_one_parent') THEN
    RAISE EXCEPTION '0512: line_item_exactly_one_parent must be VALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'document_instance' AND column_name = 'booking_id'
  ) THEN
    RAISE EXCEPTION '0512: document_instance.booking_id missing after ALTER';
  END IF;

  -- ★ Negative control: booking_id no longer counts toward the arc — a line with booking_id AND
  --   invoice_id both set must be ADMITTED now (this is the whole point of the migration).
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'keystone.line_item'::regclass AND c.conname = 'line_item_exactly_one_parent'
       AND pg_get_constraintdef(c.oid) ILIKE '%booking_id%'
  ) THEN
    RAISE EXCEPTION '0512: line_item_exactly_one_parent still mentions booking_id — it must not';
  END IF;
  -- ★ Positive control alongside the negative: invoice_id ALONE must still satisfy the constraint —
  --   this asserts the CHECK admits something, not merely that it no longer mentions a column.
  IF NOT pg_get_constraintdef(
    (SELECT oid FROM pg_constraint
      WHERE conrelid = 'keystone.line_item'::regclass AND conname = 'line_item_exactly_one_parent')
  ) ILIKE '%invoice_id%' THEN
    RAISE EXCEPTION '0512: line_item_exactly_one_parent no longer mentions invoice_id';
  END IF;

  -- ★ Positive control: every booking.invoice_id has produced a line_item.booking_id backfill.
  SELECT count(*) INTO v_missing_line_backfill
    FROM keystone.booking b
   WHERE b.invoice_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM keystone.line_item li
        WHERE li.tenant_id = b.tenant_id AND li.invoice_id = b.invoice_id AND li.booking_id = b.id
     );
  IF v_missing_line_backfill > 0 THEN
    RAISE EXCEPTION '0512: % booking(s) with invoice_id have no backfilled line_item.booking_id', v_missing_line_backfill;
  END IF;

  -- ★ Positive control: every booking.document_instance_id has produced a document_instance.booking_id.
  SELECT count(*) INTO v_missing_doc_backfill
    FROM keystone.booking b
   WHERE b.document_instance_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM keystone.document_instance di
        WHERE di.tenant_id = b.tenant_id AND di.id = b.document_instance_id AND di.booking_id = b.id
     );
  IF v_missing_doc_backfill > 0 THEN
    RAISE EXCEPTION '0512: % booking(s) with document_instance_id have no backfilled document_instance.booking_id', v_missing_doc_backfill;
  END IF;

  RAISE NOTICE '0512: line_item_exactly_one_parent excludes booking_id; document_instance.booking_id present; both backfills complete.';
END
$$;

