-- 0750 · A signer who opens their signing link and presses Decline got "insufficient privilege".
--
-- ★★★ MEASURED 15 Oct 2026 (test/s14_public_signing.test.mjs, case 6): POST /api/public/documents/decline
--   reaches declineInstance, whose UPDATE sets state='declined' on a contract- or form-builder instrument.
--   The only UPDATE policy a client-role signer has on keystone.document_instance is
--   signer_marks_partially_signed (0119), whose WITH CHECK allows exactly state='partially_signed'; the
--   execute move got its own policy (signer_marks_executed, 0418) but decline never did. The route answered
--   403 and the instrument stayed 'sent' — a customer could not refuse a document. (The pdf builder's parties
--   already can: party_marks_progress allows 'declined'.)
--
-- ★ The narrowest statement of the one extra move, shaped exactly like 0119's: the signer must already be
--   able to SEE the instrument (document_is_visible), be a client role, and the instrument must be sent or
--   partially signed and not archived (so an executed / void / already-declined / expired instrument is not
--   matched at all); the ONLY value they may leave is 'declined'. Additive and idempotent.
DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0750: must run as app_owner, running as %', current_user; END IF;
END $$;

DROP POLICY IF EXISTS signer_marks_declined ON keystone.document_instance;
CREATE POLICY signer_marks_declined ON keystone.document_instance
  FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.document_is_visible(document_instance.*)
         AND state IN ('sent', 'partially_signed')
         AND archived_at IS NULL
         AND EXISTS (SELECT 1 FROM keystone.app_user u
                      WHERE u.id = keystone.current_user_id()
                        AND u.role IN ('adult_client', 'adolescent_client')))
  WITH CHECK (tenant_id = keystone.current_tenant_id()
              AND state = 'declined');

COMMENT ON POLICY signer_marks_declined ON keystone.document_instance IS
  '0750. A signer may decline an instrument they can already see: sent or partially_signed -> declined, nothing else. Executing stays signer_marks_executed (0418); every other state change stays staff-only.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone' AND tablename='document_instance' AND policyname='signer_marks_declined') THEN
    RAISE EXCEPTION '0750: signer_marks_declined was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone' AND tablename='document_instance' AND policyname='signer_marks_partially_signed') THEN
    RAISE EXCEPTION '0750: signer_marks_partially_signed (0119) is gone; this migration must not touch it';
  END IF;
END $$;
