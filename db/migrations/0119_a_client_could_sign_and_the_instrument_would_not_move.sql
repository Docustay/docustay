-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P10.1 — A SIGNATURE THAT LANDED IN A SIDE TABLE AND LEFT THE INSTRUMENT SAYING `sent`.
--
-- ★★★ MEASURED 2026-09-15, driving the real `/api/app/documents/sign` handler as a real client:
--     the `signature_record` row was WRITTEN — its table's only policy is `tenant_isolation`, so a
--     client may insert one — and `recordSignature`'s closing statement
--
--         UPDATE keystone.document_instance SET state = 'partially_signed' WHERE id = $1
--
--     **matched ZERO ROWS and raised nothing.** `document_instance` has exactly one UPDATE policy
--     for a person, `staff_write`, and it requires `app_user.role = 'staff'`. A client is not staff.
--
--   ★★ SO THE INSTRUMENT STAYED `sent` FOREVER WITH A SIGNATURE SITTING BESIDE IT. Every screen
--      reads `state`; the signature is in a table screens do not scan. **The document says nobody has
--      signed it, and somebody has.** Of the two, the state is what the product believes.
--
-- ★★★ THIS IS `F315` AGAIN, ONE PHASE LATER: a write the policies do not permit, failing silently
--     because an `UPDATE` matching no rows is not an error in Postgres. There it was the due sweep
--     with no viewer; here it is a client with the wrong role. **The class is "who is allowed to
--     make this write, and has anybody checked that they can?"**
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE POLICY IS THE NARROWEST STATEMENT OF THE ONE MOVE A SIGNER MAY MAKE.
--
--     Read the conditions as a list of things it CANNOT be used for:
--       `document_is_visible(row)`      → the signer must already be able to SEE the instrument,
--                                         which is the subject-or-guardian rule plus audience plus
--                                         assignment. This policy adds no new reach; it permits a
--                                         write on a row they could already read.
--       role is a CLIENT role           → staff keep `staff_write`; this is not a second door for them.
--       old state IN (sent, partially)  → a draft, an executed, a declined, a void or an expired
--                                         instrument is not visible through it AT ALL. **The standing
--                                         limit — nothing changes on a signed instrument — is
--                                         enforced here as well as in U25's trigger.**
--       WITH CHECK state = partially    → the ONLY value they may leave. A client cannot execute,
--                                         void, decline, retitle, reassign or un-send anything.
--
--   ★★ AND `executed` REMAINS STAFF-ONLY, DELIBERATELY. Execution freezes the price, the terms and
--      the disclosure version onto the instrument (§M0 LAW 3); it is the practice's act, not the
--      signer's. A client signs; the instrument is executed by the people who issued it.
--
-- ★ THE `USING` CLAUSE REPEATS `document_is_visible` RATHER THAN TRUSTING THE SELECT POLICY. For an
--   UPDATE, Postgres checks the UPDATE policy's own USING against the old row — a permissive policy
--   that omitted it would let a client move an instrument they cannot read.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE POLICY signer_marks_partially_signed ON keystone.document_instance
  FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.document_is_visible(document_instance.*)
         AND state IN ('sent', 'partially_signed')
         AND archived_at IS NULL
         AND EXISTS (SELECT 1 FROM keystone.app_user u
                      WHERE u.id = keystone.current_user_id()
                        AND u.role IN ('adult_client', 'adolescent_client', 'parent')))
  WITH CHECK (tenant_id = keystone.current_tenant_id()
              AND state = 'partially_signed');

COMMENT ON POLICY signer_marks_partially_signed ON keystone.document_instance IS
  'P10.1 (0119). The ONE write a signer may make: an instrument they can already see, in sent or partially_signed, to partially_signed. Executing stays staff-only — execution freezes the price and the disclosure version, and that is the practice''s act.';
