-- 0032_disclosure_acceptance
-- P15C.10 / P15C.0 — THE ELECTRONIC RECORDS DISCLOSURE ACCEPTANCE STORE. §M0 LAW 3's THIRD ELEMENT.
--
-- ★★★ WHY THIS TABLE EXISTS. LAW 3 requires an executed instrument to freeze the price, the terms AND
-- the disclosure text with ITS VERSION. P15B.8 had to write `disclosure: { status: "NO_STORE" }` into
-- every snapshot because there was nowhere to read an acceptance from — the text and the version came
-- with the esign port, but **the record of WHO accepted WHICH version did not exist anywhere.**
--
-- ★★ THE THING BEING RECORDED IS A FACT ABOUT A PERSON, NOT ABOUT A DOCUMENT. The ESIGN Act's
--    disclosure is collected ONCE PER SIGNER before their first signature, and it then covers the whole
--    relationship. So the row is keyed on the PERSON, and an instrument's snapshot quotes it.
--    ★ Getting this backwards — one acceptance per document — would ask a client to re-consent on every
--      agreement, which is both worse for them and not what the statute asks for.
--
-- ★★★ ONE ROW PER (PERSON, VERSION), AND OLD ROWS ARE NEVER TOUCHED.
--   · A person who accepted `2026-08-15.1` and later accepts `2027-01-02.1` has TWO rows. The old one
--     is evidence of what they agreed to at the time, and an instrument executed in between quotes it.
--   · **Editing or deleting an acceptance would retroactively change what a signed instrument says a
--     person agreed to** — the same failure §Z4's supersede law prevents for prices, one domain over.
--     So the only permitted write is an INSERT, enforced by a trigger below rather than by convention.
--
-- ★ `withdrawn_at` is how the ESIGN Act's withdrawal right (element b) is recorded. A withdrawal does
--   NOT delete the acceptance: it ends it. An instrument executed while the acceptance was live stays
--   correct, and the statute's "does not undo anything you have already signed" is true in the data.

CREATE TABLE keystone.esign_disclosure_acceptance (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id   uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  -- ★ The version string the signer actually saw, e.g. '2026-08-15.1'. NOT a boolean: "accepted" with
  --   no version points at whatever the file says today, which is the defect the version exists for.
  version       text        NOT NULL CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$'),
  -- ★★ THE TEXT AS SHOWN, FROZEN HERE TOO. The version alone would require the reader to still have
  --    the code that produced it; an instrument must be readable on its own terms years later, and so
  --    must the consent behind it.
  text_shown    jsonb       NOT NULL,
  accepted_at   timestamptz NOT NULL DEFAULT now(),
  -- ★ Evidence of the MEDIUM, which is statutory: element (g) requires consent given electronically
  --   "in a manner that reasonably demonstrates that the consumer can access information in the
  --   electronic form that will be used". The user agent and IP are what make that demonstrable.
  user_agent    text,
  accepted_ip   text,
  withdrawn_at  timestamptz,
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= accepted_at)
);

-- ★★ ONE ACCEPTANCE PER PERSON PER VERSION. A second tap on the same version is the same fact, so the
--    writer upserts on this rather than stacking duplicates that would make "when did they agree" have
--    several answers.
CREATE UNIQUE INDEX esign_acceptance_person_version
  ON keystone.esign_disclosure_acceptance (tenant_id, app_user_id, version);

-- ★ The lookup the signing surface and `executeInstance` both make: "what is this person's live
--   acceptance?" Partial, because a withdrawn one is never the answer to that question.
CREATE INDEX esign_acceptance_live
  ON keystone.esign_disclosure_acceptance (tenant_id, app_user_id, accepted_at DESC)
  WHERE withdrawn_at IS NULL;

-- ═════════════════════════════════════════════════════════════════════════════
-- ★★★ APPEND-ONLY, EXCEPT FOR WITHDRAWAL. ENFORCED, NOT INTENDED.
-- ═════════════════════════════════════════════════════════════════════════════
-- The same shape as `keystone.price_is_append_only()` (0024) and for the same reason: a consent record
-- that can be edited is not evidence of anything.
CREATE OR REPLACE FUNCTION keystone.esign_acceptance_is_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $fn$
BEGIN
  IF NEW.version <> OLD.version
     OR NEW.text_shown::text <> OLD.text_shown::text
     OR NEW.accepted_at <> OLD.accepted_at
     OR NEW.app_user_id <> OLD.app_user_id
     OR NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION
      'an electronic-records disclosure acceptance is evidence and is never edited: changing the '
      'version, the text shown, the person or the time would retroactively alter what a signer agreed '
      'to, including on instruments already executed. Insert a new acceptance, or set withdrawn_at.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- ★ A withdrawal may be set ONCE. Re-withdrawing, or un-withdrawing, are both rewrites of history:
  --   "they withdrew on the 3rd" must not become "the 9th", and a withdrawal must not vanish.
  IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
    RAISE EXCEPTION
      'this acceptance was already withdrawn at %; a withdrawal cannot be moved or undone', OLD.withdrawn_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER esign_acceptance_append_only
  BEFORE UPDATE ON keystone.esign_disclosure_acceptance
  FOR EACH ROW EXECUTE FUNCTION keystone.esign_acceptance_is_append_only();

-- ★ DELETE is refused outright. There is no legitimate reason to remove a consent record, and GDPR-style
--   erasure of a person is a separate, deliberate operation that has to reason about signed instruments
--   too — not something a stray DELETE should be able to do.
CREATE OR REPLACE FUNCTION keystone.esign_acceptance_no_delete()
  RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION
    'an electronic-records disclosure acceptance is never deleted — instruments executed while it was '
    'live quote it. Set withdrawn_at to end it.'
    USING ERRCODE = 'check_violation';
END;
$fn$;

CREATE TRIGGER esign_acceptance_no_delete
  BEFORE DELETE ON keystone.esign_disclosure_acceptance
  FOR EACH ROW EXECUTE FUNCTION keystone.esign_acceptance_no_delete();

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS — the same regime as every other tenant table.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.esign_disclosure_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.esign_disclosure_acceptance FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.esign_disclosure_acceptance
  USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ★ `app_rw` only. [MEASURED] the roles that exist are app_embed, app_owner, app_rw, app_signup,
--   auth_owner — **there is no `app_ro`**, and my first draft granted to one, which failed loudly at
--   migrate time. Recorded rather than silently corrected: inventing a role name in a grant is how a
--   migration ends up half-applied on one database and not another.
-- ★★ AND NOT `app_embed`: an embed is a public, publishable-key surface (P19.8), and a signer's
--    consent record — with their user agent and IP — is not something a public key may read.
GRANT SELECT, INSERT, UPDATE ON keystone.esign_disclosure_acceptance TO app_rw;

COMMENT ON TABLE keystone.esign_disclosure_acceptance IS
  'P15C.10 / §M0 LAW 3. One row per (person, disclosure version) recording that a signer accepted the '
  'electronic-records disclosure, WITH the text they were shown. Append-only by trigger: editing it '
  'would retroactively change what a signer agreed to on instruments already executed. A withdrawal '
  'ends an acceptance and never deletes it, because "withdrawing does not undo anything you have '
  'already signed" has to be true in the data, not only in the copy.';
