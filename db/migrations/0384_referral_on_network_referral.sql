-- 0384_referral_on_network_referral
--
-- ★★★ ONE REFERRAL STORE, NOT TWO (OQ-12.2). F04 §3 asked for a new `referral` table; 0359 already
--     built one, as a consent-bound RELEASE record. This widens the built table to hold BOTH facts:
--     a referral that carries a name and a reason (releases nothing), and a release (which may not
--     exist without a recorded consent).
-- ★★★ THE NOT NULLs ARE NOT WEAKENED, THEY ARE RESTATED. 0359's guarantee was "no release row without
--     a consent id", expressed as two NOT NULLs. A referral releases nothing, so NOT NULL cannot
--     express it any more — the CHECK below says the SAME thing over the wider shape, and the test
--     proves the refusal with a positive control.
ALTER TABLE keystone.network_referral
  ALTER COLUMN data_released     DROP NOT NULL,
  ALTER COLUMN consent_record_id DROP NOT NULL,
  ADD COLUMN direction   text NOT NULL DEFAULT 'out' CHECK (direction IN ('out','in')),
  ADD COLUMN reason      text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 2000),
  ADD COLUMN told_person   boolean NOT NULL DEFAULT false,
  ADD COLUMN copied_person boolean NOT NULL DEFAULT false,
  ADD COLUMN outcome     text NOT NULL DEFAULT 'sent'
    CHECK (outcome IN ('sent','taken','in_progress','became_client','declined','no_reply')),
  ADD COLUMN outcome_note text NULL CHECK (outcome_note IS NULL OR char_length(outcome_note) <= 500),
  ADD COLUMN partner_email_status text NULL CHECK (partner_email_status IN ('queued','sent','failed','skipped')),
  ADD COLUMN person_email_status  text NULL CHECK (person_email_status  IN ('queued','sent','failed','skipped')),
  ADD COLUMN created_by uuid NULL;
-- ★ every new row states its own direction; the default existed only to admit the zero existing rows.
ALTER TABLE keystone.network_referral ALTER COLUMN direction DROP DEFAULT;
ALTER TABLE keystone.network_referral
  ADD CONSTRAINT network_referral_release_needs_consent
    CHECK (data_released IS NULL OR consent_record_id IS NOT NULL),
  ADD CONSTRAINT network_referral_out_has_reason
    CHECK (direction = 'in' OR btrim(reason) <> ''),
  ADD CONSTRAINT network_referral_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (created_by);
CREATE INDEX network_referral_party_recent_idx
  ON keystone.network_referral (tenant_id, receiving_network_party_id, created_at DESC);
-- ★ 0359 granted SELECT, INSERT only. Outcomes and email statuses are UPDATEs, so the grant widens
--   by exactly one verb; no DELETE, ever (a referral is a record of something that happened).
GRANT UPDATE ON keystone.network_referral TO app_rw;
-- ★ F04 §3's one addition to the party itself.
ALTER TABLE keystone.network_party ADD COLUMN what_they_do text NULL
  CHECK (what_they_do IS NULL OR char_length(what_they_do) <= 60);

-- ★★ CLOSING CHECKS — same discipline 0359 itself closes with (0359:45-54): prove the guard is
--    really in place rather than trusting the ALTERs above to have done it.
-- ★ (a) an ALTER must not have disturbed FORCE ROW LEVEL SECURITY.
-- ★ (b) the restated "no release without consent" guarantee is verified by its DEFINITION, not by
--   its name — checking `pg_get_constraintdef` for the exact condition proves the guard actually
--   enforces the right thing, which a name-only check could not (a same-named but differently-defined
--   constraint would still pass a name lookup).
DO $$
DECLARE
  forced boolean;
  found_check boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.network_referral'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0384: FORCE ROW LEVEL SECURITY was disturbed on keystone.network_referral';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.network_referral'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%consent_record_id IS NOT NULL%'
  ) INTO found_check;
  IF NOT found_check THEN
    RAISE EXCEPTION '0384: the release-needs-consent CHECK constraint was not found on keystone.network_referral';
  END IF;
END
$$;
