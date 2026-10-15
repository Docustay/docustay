-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0522 · six money audit actions that code already writes (R7, RECONCILE 27 Sep 2026).
--
-- writeAudit() refuses an action not in AUDIT_ACTIONS (src/permissions/audit.mjs:50) and
-- keystone.audit_entry.action is FK'd to keystone.audit_action(key). Six callers wrote actions that
-- existed in neither, so every one of these operations threw AuditViolation and rolled back whole:
--   invoice.marked_paid          src/money/invoiceActions.mjs  (Mark paid)
--   invoice.marked_uncollectible src/money/invoiceActions.mjs  (Mark uncollectible)
--   invoice.duplicated           src/money/invoiceActions.mjs  (Duplicate)
--   invoice.payment_attached     src/money/invoiceActions.mjs  (Attach payment)
--   dispute.closed               src/money/disputes.mjs        (Accept / close dispute)
--   credit_note.issued           src/money/creditNotes.mjs     (Issue credit note)
-- The JS list gains the same six in this change. Bracket idiom: 0427's, verbatim (audit_action is
-- ENABLE+FORCE with a SELECT-only policy; FORCE is suspended for the seed and proven back on).
-- No BEGIN/COMMIT — db/migrate.mjs owns the transaction (R8).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.audit_action NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.audit_action (key) VALUES
  ('invoice.marked_paid'),
  ('invoice.marked_uncollectible'),
  ('invoice.duplicated'),
  ('invoice.payment_attached'),
  ('dispute.closed'),
  ('credit_note.issued')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE keystone.audit_action FORCE ROW LEVEL SECURITY;

DO $$
DECLARE forced boolean; k text;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.audit_action'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0522: FORCE ROW LEVEL SECURITY was not restored on keystone.audit_action';
  END IF;
  FOREACH k IN ARRAY ARRAY['invoice.marked_paid','invoice.marked_uncollectible','invoice.duplicated',
                           'invoice.payment_attached','dispute.closed','credit_note.issued'] LOOP
    IF NOT EXISTS (SELECT 1 FROM keystone.audit_action WHERE key = k) THEN
      RAISE EXCEPTION '0522: % was not seeded into keystone.audit_action', k;
    END IF;
  END LOOP;
END $$;
