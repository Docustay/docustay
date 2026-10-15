-- 0062 — U25 AT THE PRIVILEGE LAYER. **THIS IS A PRODUCTION SECURITY FIX**, found by P21A.3.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT WAS WRONG. MEASURED 2026-09-14 by comparing the GRANT layer on local against deployed:
--
--   | cell                                    | local | DEPLOYED |
--   |-----------------------------------------|-------|----------|
--   | app_rw UPDATE keystone.signature_record | false | **TRUE** |
--   | app_rw DELETE keystone.signature_record | false | **TRUE** |
--   | app_rw DELETE keystone.document_pdf     | false | **TRUE** |
--   | app_rw DELETE esign_disclosure_acceptance | false | **TRUE** |
--
--   So on the DEPLOYED database the application role could **edit or withdraw a signature**, **destroy
--   the archived PDF of an executed instrument**, and **un-accept a disclosure**. U25's privilege-layer
--   guarantee did not exist where it mattered.
--
-- ★★★ WHY IT HAPPENED, AND IT IS THE MOST ORDINARY REASON THERE IS: **THE REVOKES WERE NEVER A
--     MIGRATION.** `grep -c REVOKE db/migrations/*.sql` finds sixteen files and NOT ONE of them names
--     these three tables. Somebody ran the REVOKEs by hand against their local database during
--     P15C.11 and the deployed database simply never heard about it. Local then looked correct
--     forever after, and every gate in the project agreed with local.
--
-- ★★★ WHY NOTHING CAUGHT IT FOR SIX PHASES. Every gate reads `KEYSTONE_DATABASE_URL`, which is LOCAL.
--     `catalog-conformance` compares the catalog to the rules — on local. P21A.2 compared RLS between
--     local and deployed and they matched perfectly, which is exactly the trap: **RLS and GRANTS are
--     independent mechanisms that fail independently.** A flawless policy on a table the role was
--     never granted is moot, and a flawlessly granted table with no policy is wide open. Checking one
--     and inferring the other is how this survived.
--
-- ★★ WHAT THIS DOES NOT CLAIM. The TRIGGER half of U25 (P15C.11) was in a migration and therefore did
--    reach production, so an executed instrument was not actually editable through the app. This
--    restores the SECOND, independent barrier — the one that cannot be switched off by anyone holding
--    the right to disable a trigger. Two mechanisms for one rule, as U25 requires; one of them had
--    quietly been running on one leg in production.
--
-- ★ REVOKE is idempotent, so applying this to the local database (where the state is already correct)
--   is a no-op and not an error. That is deliberate: the migration states the desired end state rather
--   than assuming which database it is running against.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · A SIGNATURE CANNOT BE EDITED OR WITHDRAWN.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ INSERT is deliberately left in place. Immutability must not be achieved by making the table
--    unwritable — that would be a broken feature wearing a guard's clothes, and
--    `db/gates/p21a_role_matrix.mjs` asserts the INSERT survives as its positive control.
REVOKE UPDATE, DELETE ON keystone.signature_record FROM app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · THE ARCHIVED PDF OF AN EXECUTED INSTRUMENT CANNOT BE DESTROYED.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ UPDATE stays granted here and that is not an oversight: the archive row legitimately gains its
--   storage key and checksum after the object lands (P18.4). What it may never do is vanish.
REVOKE DELETE ON keystone.document_pdf FROM app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3 · A DISCLOSURE CANNOT BE UN-ACCEPTED.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ This is the ESIGN Act's consumer-consent record. Its whole evidentiary value is that it cannot
--    be removed after the fact — a deletable consent record proves nothing about what the signer was
--    shown, which is the only question it exists to answer.
REVOKE DELETE ON keystone.esign_disclosure_acceptance FROM app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ AND STOP IT COMING BACK THROUGH THE SIDE DOOR. If a future migration says
--    `GRANT ALL ON ALL TABLES IN SCHEMA keystone TO app_rw` — which is exactly how somebody clears a
--    permission error in a hurry — these three would be silently re-granted. DEFAULT PRIVILEGES do not
--    help, because they apply only to tables created later. There is no catalogue-level way to pin a
--    negative grant in Postgres, so the guard is the gate: `db/gates/p21a_role_matrix.mjs` asserts all
--    four cells, and `verify/p21a_deployed_rls.mjs` section 4 now compares every grant cell between
--    local and deployed so a production-only drift can never again be invisible.
COMMENT ON TABLE keystone.signature_record IS
  'One row per party per document. ★★★ IMMUTABLE BY TWO INDEPENDENT MECHANISMS: a trigger (P15C.11) '
  'and the ABSENCE of UPDATE/DELETE privilege for app_rw (0062). ★ The privilege half was missing on '
  'the DEPLOYED database from P15C.11 until 2026-09-14 because the REVOKEs were run by hand locally '
  'and never written as a migration — found by P21A.3 comparing the grant layer across both.';
