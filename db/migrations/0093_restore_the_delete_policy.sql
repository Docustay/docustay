-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.9 (correction to 0088) — RESTORING `staff_delete`. DROPPING IT TURNED A REFUSAL INTO SILENCE.
--
-- ★★★ 0088 DROPPED THIS POLICY AS "a hard-delete permission nobody exercises", AND THAT WAS WRONG IN
--     A WAY WORTH WRITING DOWN. Under FORCE row-level security a DELETE with NO applicable policy
--     does not RAISE — it matches zero rows and **succeeds, affecting nothing.** So removing the
--     permission did not make deletion impossible; it made it SILENT.
--
--   ★★ [MEASURED] `db/gates/p21a_u25_at_database.mjs` said so in three lines:
--        app_rw    (the application role) → DELETE was ALLOWED (0 row(s))
--        app_owner (OWNS the table)       → DELETE was ALLOWED (0 row(s))
--      Before 0088 those same statements were REFUSED, loudly, by
--      `document_instance_terminal_no_delete` — *"an executed instrument is never deleted."*
--
--   ★★★ THE POLICY WAS LOAD-BEARING FOR THE OPPOSITE REASON TO THE ONE I ASSUMED. It is what lets
--       the DELETE REACH THE ROW, so the immutability trigger can refuse it **by name, with a
--       reason**. With no policy the statement never touches a row, no trigger fires, and the caller
--       is told everything went fine. *"An UPDATE that affects nothing is not an error"* — this
--       register's own words, arriving as a DELETE.
--   ★ And `db/gates/p8_payment_checks.mjs` failed the same way from the other side: its cascade check
--     deleted a document and found the line item still there, because the delete had done nothing.
--
-- ★★ THE LESSON, AND IT GENERALISES: **REMOVING A PERMISSION IS NOT THE SAME AS ADDING A REFUSAL.**
--    In a system where the absence of a grant is silent, an explicit grant plus an explicit guard
--    is LOUDER — and louder is what a person acting on a signed instrument needs.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE POLICY staff_delete ON keystone.document_instance
  FOR DELETE
  USING (tenant_id = keystone.current_tenant_id()
         AND EXISTS (SELECT 1 FROM keystone.app_user u
                      WHERE u.id = keystone.current_user_id() AND u.role = 'staff'));
