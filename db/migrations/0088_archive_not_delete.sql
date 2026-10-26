-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.9 — ARCHIVE, NOT DELETE. DECIDED, WITH A REASON, AND ENFORCED RATHER THAN INTENDED.
--
-- ★★★ THE MEASURED STATE: PROPERTY 5 WAS DECIDED FOR NONE OF THE SIX OBJECTS, AND WHAT EXISTED WAS
--     THREE PIECES OF MACHINERY THAT DID NOTHING.
--       · `people.person.archived` — a declared topic with **no producer**. Nothing has ever emitted
--         it, so nothing has ever been archived.
--       · `document_instance.deleted` — **read in 12 places across src/ and WRITTEN IN NONE.** Every
--         document query carries `AND NOT deleted`, filtering on a column that is `false` on every
--         row in the project.
--       · a `staff_delete` RLS policy on `document_instance` — permitting a hard DELETE that no code
--         path calls.
--     ★★ So the protection today is INCIDENTAL: `ON DELETE RESTRICT` on `signature_record.signer_uid`
--        stops a signer being removed, and nothing else stops anything. **A mistyped person is
--        permanent, and a departed client is indistinguishable from an active one** — the same
--        column fixes both, and neither is fixed today.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE RULING — Q3's recommended default, built.
--     **ARCHIVE EVERYWHERE. DELETE IS RESERVED FOR RECORDS THAT CARRY NO SIGNATURE AND NO PAYMENT.**
--
--   ★★ AND "RESERVED" IS A TRIGGER, NOT A CONVENTION. A rule that lives in a writer is a rule the
--      next `DELETE FROM` goes around — and this schema already contains a DELETE policy for exactly
--      that. The refusal is CONDITIONAL on the dependents that actually exist, which is what the
--      item's own words ask for: *"delete reserved for records with no signed instrument."*
--   ★★★ THAT CONDITIONALITY IS LOAD-BEARING IN BOTH DIRECTIONS. An unconditional refusal would be
--       easier to write and would break every gate's teardown — and a project whose tests cannot
--       clean up grows a `TRUNCATE` somewhere, which removes the protection entirely. **A guard that
--       makes legitimate work impossible is a guard that gets disabled.** Fixture rows have no
--       signatures and no payments; they delete freely. A client who has signed cannot be erased.
--
-- ★ ARCHIVING IS NOT DELETION AND MUST NOT READ AS IT. `archived_at` is a TIMESTAMP, not a boolean:
--   "when" answers a question a person will ask and `true` does not.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1 · THE COLUMN, ON EVERY OBJECT THAT CAN BE RETIRED ─────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_user', 'account', 'network_party', 'booking', 'invoice',
                           'service', 'plan', 'subscription', 'document_instance']
  LOOP
    EXECUTE format('ALTER TABLE keystone.%I ADD COLUMN archived_at timestamptz', t);
    EXECUTE format('ALTER TABLE keystone.%I ADD COLUMN archived_by uuid', t);
    -- ★★ COMPOSITE, and SET NULL naming its own column (F144). The person who archived something may
    --    themselves be archived later; losing WHO is acceptable, losing the tenant is not.
    EXECUTE format(
      'ALTER TABLE keystone.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, archived_by) '
      'REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (archived_by)',
      t, t || '_archived_by_fkey');
    EXECUTE format(
      'CREATE INDEX %I ON keystone.%I (tenant_id) WHERE archived_at IS NULL',
      t || '_not_archived_idx', t);
  END LOOP;
END $$;

-- ── 2 · ★★★ CONVERGE `document_instance.deleted` ONTO `archived_at` ─────────────────────────────
-- ★★ TWO COLUMNS FOR ONE FACT IS THE `DUPLICATE-TRUTH` CLASS, and this register has recorded it five
--    times. Leaving `deleted` beside `archived_at` would guarantee a sixth: twelve read sites would
--    keep filtering on the boolean while every new one used the timestamp, and the two would part
--    company the first time somebody archived a document through the writer.
--  ★ The backfill is written even though [MEASURED] no row has `deleted = true` — a migration that
--    only works on the data that happens to exist is one that fails when it meets data that does.
UPDATE keystone.document_instance
   SET archived_at = coalesce(updated_at, created_at, now())
 WHERE deleted = true;

ALTER TABLE keystone.document_instance DROP COLUMN deleted;

-- ★★ AND THE DELETE POLICY GOES WITH IT. It permitted a hard DELETE that no code path calls, on the
--    one table in the project that holds signed instruments. A permission nobody exercises is not
--    harmless — it is the thing that is exercised the day somebody writes a cleanup script.
DROP POLICY IF EXISTS staff_delete ON keystone.document_instance;

-- ── 3 · ★★★ THE REFUSAL — conditional, on dependents that actually exist ────────────────────────
--
-- ★★ WHAT COUNTS AS "CANNOT BE DELETED", MEASURED FROM `pg_constraint` RATHER THAN ASSUMED:
--      app_user          → signature_record.signer_uid · payment.payer (they signed, or they paid)
--      document_instance → signature_record.document_id (it has been signed)
--      invoice           → payment.invoice_id, where the payment SUCCEEDED
--    ★ A FAILED payment does not pin an invoice. An invoice whose only payment attempt was declined
--      is a mistake somebody should be able to remove; one that took money is a record.
CREATE OR REPLACE FUNCTION keystone.refuse_delete_if_signed_or_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text := NULL;
BEGIN
  IF TG_TABLE_NAME = 'app_user' THEN
    IF EXISTS (SELECT 1 FROM keystone.signature_record s WHERE s.signer_uid = OLD.id) THEN
      v_reason := 'they have signed an instrument';
    ELSIF EXISTS (SELECT 1 FROM keystone.payment p WHERE p.payer_user_id = OLD.id) THEN
      v_reason := 'they have made a payment';
    END IF;

  ELSIF TG_TABLE_NAME = 'document_instance' THEN
    IF EXISTS (SELECT 1 FROM keystone.signature_record s WHERE s.document_id = OLD.id) THEN
      v_reason := 'it has been signed';
    END IF;

  ELSIF TG_TABLE_NAME = 'invoice' THEN
    IF EXISTS (SELECT 1 FROM keystone.payment p
                WHERE p.invoice_id = OLD.id AND p.status = 'succeeded') THEN
      v_reason := 'it has been paid';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION
      'this % cannot be deleted because %. Archive it instead — the record stays and stops '
      'appearing in day-to-day lists.', TG_TABLE_NAME, v_reason
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END $$;

REVOKE ALL ON FUNCTION keystone.refuse_delete_if_signed_or_paid() FROM PUBLIC;

CREATE TRIGGER app_user_refuse_delete_trg
  BEFORE DELETE ON keystone.app_user
  FOR EACH ROW EXECUTE FUNCTION keystone.refuse_delete_if_signed_or_paid();

CREATE TRIGGER document_instance_refuse_delete_trg
  BEFORE DELETE ON keystone.document_instance
  FOR EACH ROW EXECUTE FUNCTION keystone.refuse_delete_if_signed_or_paid();

CREATE TRIGGER invoice_refuse_delete_trg
  BEFORE DELETE ON keystone.invoice
  FOR EACH ROW EXECUTE FUNCTION keystone.refuse_delete_if_signed_or_paid();

-- ── 4 · AND ARCHIVING IS NOT A ONE-WAY DOOR ─────────────────────────────────────────────────────
-- ★ `archived_by` without `archived_at` is a claim about an event that did not happen. The pair
--   travels together, in both directions, so un-archiving has to clear both.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_user', 'account', 'network_party', 'booking', 'invoice',
                           'service', 'plan', 'subscription', 'document_instance']
  LOOP
    EXECUTE format(
      'ALTER TABLE keystone.%I ADD CONSTRAINT %I CHECK (archived_by IS NULL OR archived_at IS NOT NULL)',
      t, t || '_archived_pair');
  END LOOP;
END $$;

COMMENT ON COLUMN keystone.document_instance.archived_at IS
  'P2.9 — REPLACES the `deleted` boolean, which was read in 12 places and written in none. ★★ A '
  'TIMESTAMP, not a flag: "when" answers a question a person will ask and `true` does not. ★ The '
  'staff_delete RLS policy went with it — a hard-delete permission nobody exercised, on the one '
  'table holding signed instruments.';
