-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.6 — `invoice`: A SCREEN WAS PRESENTING A SERVICE BOUNDARY AS A PAYMENT OBLIGATION.
--
-- ★★★ THE DEFECT IS NOT THE MISSING FIELDS — IT IS THE LABEL ON THE ONES THERE ARE. [MEASURED]
--     `src/records/lists.mjs:451` reads `{ field: 'period_end', label: 'Due' }`, and the list is
--     ordered by it. **`period_end` is the end of a SERVICE PERIOD. It is not a payment deadline.**
--     A practice reading that column is being told when money is owed by a value that has never
--     meant that, and there was **no due-date column to fix it with** — so the label could not be
--     corrected without this migration.
--   ★★ Worse in the one direction that matters: the two coincide often enough to look right. A
--      monthly subscription invoice whose period ends on the 31st and is payable on the 31st reads
--      correctly; the one with fourteen days' terms does not, and nothing on the screen says which
--      kind you are looking at.
--
-- ★★★ AND `money.invoice_issued` CANNOT BE SENT. [MEASURED] `src/email/templates.mjs:109` defines it
--     and :123 requires `invoiceNumber` — **no column supplies one.** It is the SECOND orphan
--     template found in two items (F157 was `booking.reminder`), and it fails one step earlier: that
--     one had no sender, this one has no DATA. A template requiring a variable nothing can produce is
--     unsendable even once somebody writes the sender.
--
-- ★ EVERYTHING HERE IS NULLABLE EXCEPT THE MONEY, and the money columns default to 0 rather than
--   NULL: an invoice with an unknown tax is a different thing from one with no tax, and every
--   existing invoice genuinely has no tax and no discount.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · ★★★ THE DUE DATE — the column the label needed ──────────────────────────────────────────
-- ★★ SEPARATE FROM `period_end` AND THAT IS THE WHOLE POINT. One says what was covered; the other
--    says when to pay. Terms of 14 or 30 days make them different dates, and a practice chasing
--    payment needs the second one.
--  ★ NULL means no deadline has been set — a draft, or an invoice settled immediately at the point
--    of sale. It is NOT "due now"; a list that sorted a null into "overdue" would invent an
--    obligation, which is the same class of error this migration exists to fix.
ALTER TABLE keystone.invoice ADD COLUMN due_at timestamptz;

-- ★ Payment terms in days, kept BESIDE the computed date rather than instead of it. The date is what
--   a person is owed an answer about; the terms are how it was arrived at, and a changed policy must
--   not silently move a deadline on an invoice already sent.
ALTER TABLE keystone.invoice ADD COLUMN payment_terms_days integer;

ALTER TABLE keystone.invoice
  ADD CONSTRAINT invoice_terms_are_positive
  CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0);

-- ── 2 · ★★★ THE INVOICE NUMBER — human-facing, per practice, and never reused ───────────────────
-- ★★ NOT the uuid and NOT Stripe's id. A person telephoning about "invoice 2026-0043" is not holding
--    either. `provider_invoice_id` is the ORCHESTRATOR's identifier and belongs to Stripe; this is
--    the practice's own.
--  ★★★ UNIQUE PER TENANT, and that is a correctness requirement rather than tidiness: two invoices
--      sharing a number cannot be told apart in a conversation, in a bank reference, or in a ledger.
ALTER TABLE keystone.invoice ADD COLUMN invoice_number text;

CREATE UNIQUE INDEX invoice_number_unique_per_tenant
  ON keystone.invoice (tenant_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

-- ★ A shape, not a format. The SERIES a practice uses is theirs; what the database refuses is a
--   number with spaces or punctuation that would break a bank reference or a CSV export.
ALTER TABLE keystone.invoice
  ADD CONSTRAINT invoice_number_shape
  CHECK (invoice_number IS NULL OR invoice_number ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,30}$');

-- ── 3 · WHAT THE TOTAL IS MADE OF ───────────────────────────────────────────────────────────────
-- ★★★ `amount_minor` ALREADY EXISTS AND STAYS THE TOTAL. These three are the WORKING, and they are
--     added as columns rather than derived because an invoice is a FROZEN STATEMENT: the tax rate
--     that applied when it was issued must not change because a setting did. The same reasoning the
--     document layer uses for a template snapshot.
--   ★★ NOT ENFORCED AS `subtotal - discount + tax = amount`. Rounding, multi-rate tax and
--      provider-side adjustments all make that sum false in ways that are correct, and a CHECK that
--      is right 95% of the time is a CHECK that gets dropped the first time it blocks a real
--      invoice. **P8's reconciliation is where the arithmetic is reported, not refused.**
ALTER TABLE keystone.invoice ADD COLUMN subtotal_minor integer NOT NULL DEFAULT 0;
ALTER TABLE keystone.invoice ADD COLUMN tax_minor      integer NOT NULL DEFAULT 0;
ALTER TABLE keystone.invoice ADD COLUMN discount_minor integer NOT NULL DEFAULT 0;

ALTER TABLE keystone.invoice
  ADD CONSTRAINT invoice_components_are_not_negative
  CHECK (subtotal_minor >= 0 AND tax_minor >= 0 AND discount_minor >= 0);

-- ── 4 · WHERE IT IS BILLED, AND WHAT IT SAYS ────────────────────────────────────────────────────
-- ★★ THE ADDRESS IS COPIED ONTO THE INVOICE, NOT JOINED FROM THE PAYER. An invoice is a statement
--    made at a moment; a client who moves house next year must not retroactively change the address
--    on a document their accountant already filed. **Frozen on purpose** — the same rule as the
--    price and the disclosure version on an executed instrument.
ALTER TABLE keystone.invoice ADD COLUMN billing_line1        text;
ALTER TABLE keystone.invoice ADD COLUMN billing_line2        text;
ALTER TABLE keystone.invoice ADD COLUMN billing_city         text;
ALTER TABLE keystone.invoice ADD COLUMN billing_state_region text;
ALTER TABLE keystone.invoice ADD COLUMN billing_postcode     text;
ALTER TABLE keystone.invoice ADD COLUMN billing_country      text;

-- ★ The note on the invoice itself — a purchase-order number, "thank you", the reference a client's
--   finance team asked for. Distinct from any internal note, which does not belong on a document
--   that gets sent.
ALTER TABLE keystone.invoice ADD COLUMN memo text;

-- ── 5 · ★★ THE LIFECYCLE DATES, AND THE ONE CHECK THAT MATTERS ──────────────────────────────────
ALTER TABLE keystone.invoice ADD COLUMN sent_at   timestamptz;
ALTER TABLE keystone.invoice ADD COLUMN paid_at   timestamptz;
ALTER TABLE keystone.invoice ADD COLUMN voided_at timestamptz;
ALTER TABLE keystone.invoice ADD COLUMN void_reason text;

-- ★★ A void reason with no void is a statement about nothing — the same shape as P2.5's
--    `booking_reason_needs_cancellation`, and for the same reason.
ALTER TABLE keystone.invoice
  ADD CONSTRAINT invoice_reason_needs_void
  CHECK (void_reason IS NULL OR voided_at IS NOT NULL);

-- ★★★ AN INVOICE CANNOT BE BOTH PAID AND VOID. That is not a tidy-data rule: those two facts
--     contradict each other about whether money changed hands, and a report summing either one would
--     be wrong depending which it trusted.
ALTER TABLE keystone.invoice
  ADD CONSTRAINT invoice_not_paid_and_void
  CHECK (paid_at IS NULL OR voided_at IS NULL);

ALTER TABLE keystone.invoice ADD COLUMN created_by uuid;

ALTER TABLE keystone.invoice
  ADD CONSTRAINT invoice_created_by_fkey
  FOREIGN KEY (tenant_id, created_by) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (created_by);

CREATE INDEX invoice_due_idx ON keystone.invoice (tenant_id, due_at)
  WHERE due_at IS NOT NULL;

COMMENT ON COLUMN keystone.invoice.due_at IS
  'P2.6 — WHEN PAYMENT IS OWED. ★★★ src/records/lists.mjs labelled `period_end` "Due" and ordered '
  'the money list by it; period_end is the end of a SERVICE PERIOD and has never meant this. NULL is '
  '"no deadline set", NOT "due now" — a list that sorted a null into overdue would invent an '
  'obligation.';

COMMENT ON COLUMN keystone.invoice.invoice_number IS
  'P2.6 — the PRACTICE''s own human-facing number, unique per tenant, never reused. ★★ Not the uuid '
  'and not provider_invoice_id, which belongs to Stripe. The money.invoice_issued email template has '
  'required this variable since P18 and no column supplied it.';

COMMENT ON COLUMN keystone.invoice.billing_line1 IS
  'P2.6 — COPIED onto the invoice, never joined from the payer. A client who moves house must not '
  'retroactively change the address on a statement their accountant has already filed.';
