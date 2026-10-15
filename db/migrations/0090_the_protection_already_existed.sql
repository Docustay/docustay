-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.9 (correction to 0088/0089) — THE REFUSAL TRIGGER CAN NEVER FIRE. IT IS DROPPED.
--
-- ★★★ [EXECUTED] `refuse_delete_if_signed_or_paid` was written to refuse a DELETE of anything
--     carrying a signature or a payment, with a message naming the remedy. **All three of its
--     branches are unreachable.** A direct test in a transaction, on fresh rows:
--
--       DELETE FROM keystone.app_user WHERE id = <a signer>
--       → refused by: update or delete on table "app_user" violates foreign key constraint
--         "signature_record_signer_uid_fkey" on table "signature_record"
--
--     The BEFORE DELETE trigger never spoke. MEASURED from `pg_constraint.confdeltype`, all three
--     relationships it guards are already `ON DELETE RESTRICT` (`r`):
--         signature_record.signer_uid  -> app_user   RESTRICT
--         signature_record.instance_id -> document_instance RESTRICT
--         payment.payer_user_id        -> app_user   RESTRICT
--         payment.invoice_id           -> invoice    RESTRICT
--
-- ★★★ SO THE RULING WAS ALREADY TRUE AND NOBODY HAD WRITTEN IT DOWN. The item's own evidence said
--     *"protection today is incidental — ON DELETE RESTRICT on signature_record.signer_uid"*, and
--     read `incidental` as `insufficient`. It is not insufficient; it is **undocumented and
--     untested**, which is a different defect with a different fix. What P2.9 genuinely adds is the
--     ARCHIVE half — the column, the writer, the event, the list filtering — not a second refusal.
--
-- ★★ AND SHIPPING IT ANYWAY WOULD HAVE BEEN THE EXACT THING THIS ITEM EXISTS TO REMOVE. P2.9 opens
--    by cataloguing three pieces of machinery that did nothing: a topic with no producer, a column
--    read and never written, a policy nobody called. **Adding a fourth would be absurd**, and it
--    would be the worse kind: one that LOOKS like the enforcement while the real enforcement is
--    elsewhere, so a future reader "improving" the FK to CASCADE would believe the trigger still had
--    them covered.
--
-- ★ WHAT IS LOST, STATED. The trigger's message named the remedy ("Archive it instead"); the FK's
--   names a constraint. That remedy belongs at the WRITE layer, when a delete control exists to
--   catch 23503 and phrase it — and **there is no delete control anywhere in the product today**,
--   which is the honest reason there is nothing to attach it to. P6/P7 own it when they build one.
-- ★ AND ONE DISTINCTION BECOMES UNREACHABLE: 0088 wanted an invoice whose only payment FAILED to be
--   deletable. `payment.invoice_id` is RESTRICT regardless of status, so any payment ROW pins its
--   invoice. That is stricter than the design and is left alone — relaxing a money FK to permit a
--   convenience is the wrong direction.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS app_user_refuse_delete_trg          ON keystone.app_user;
DROP TRIGGER IF EXISTS document_instance_refuse_delete_trg ON keystone.document_instance;
DROP TRIGGER IF EXISTS invoice_refuse_delete_trg           ON keystone.invoice;
DROP FUNCTION IF EXISTS keystone.refuse_delete_if_signed_or_paid();
