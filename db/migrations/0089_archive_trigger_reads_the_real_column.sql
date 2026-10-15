-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.9 (correction to 0088) — THE REFUSAL TRIGGER NAMED A COLUMN THAT DOES NOT EXIST.
--
-- ★★★ 0088's `document_instance` branch read `signature_record.document_id`. [MEASURED from
--     information_schema, after the gate refused to seed a signature] **the column is
--     `instance_id`.** `signature_record` is
--     (id · tenant_id · instance_id · role · signer_order · signer_uid · signer_name · signed_at ·
--      signed_local_date · signer_timezone · user_agent · signer_ip · mark_sha256 · prev_hash ·
--      row_hash · created_at).
--
--   ★★ PL/pgSQL RESOLVES COLUMN REFERENCES AT EXECUTION, so this did not fail at migration time. It
--      would have failed on the FIRST ATTEMPT TO DELETE A DOCUMENT, with
--      `column s.document_id does not exist` — a nonsense error in place of the intended
--      "it has been signed. Archive it instead." **Loud, but wrong**: the protection would have held
--      by accident, for a reason no reader could act on.
--
--   ★ THE RULE THIS BREAKS IS THE HOUSE'S OWN: dump the object and print its keys before claiming
--     anything about its shape. `document_id` was assumed from the other two branches, which use
--     `payer_user_id` and `signer_uid` — and neither of those is a document reference.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

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
    -- ★ `instance_id`, not `document_id`. See the header.
    IF EXISTS (SELECT 1 FROM keystone.signature_record s WHERE s.instance_id = OLD.id) THEN
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
