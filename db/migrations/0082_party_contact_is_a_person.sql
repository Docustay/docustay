-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.4 (correction) — A PARTY'S CONTACT IS A PERSON RECORD, NOT A STRING.
--
-- ★★★ THIS MIGRATION EXISTS BECAUSE TWO PHASES GAVE OPPOSITE INSTRUCTIONS AND BOTH WERE RIGHT.
--     0081 added `contact_person text` because P2.4's brief names "contact person" among the eleven
--     fields a network party was missing. A test pinned since P15B then went RED:
--
--       test/p15b_network_writes.test.mjs:115
--       "network_party has NO contact columns — a party is an organisation, never a person"
--       "a human's details now live outside app_user, where consent and visibility rules do not reach"
--
--   ★★ THE PINNED TEST IS NOT PEDANTRY AND IT WAS NOT WEAKENED. Its harm is concrete and lives in
--      this schema: `do_not_email`, `do_not_text` and `do_not_call` are columns on `app_user`
--      (0076). An address stored anywhere else has NO consent flags beside it, so a system that
--      mails "the contact at Marchmont Academy" cannot discover that the person behind that address
--      asked never to be mailed. **Consent is enforced where the person is, and only there.**
--
-- ★★★ SO NEITHER SIDE LOSES. The brief gets its contact; the pinned rule gets its person.
--     `contact_person text` → `primary_contact_id uuid`, a composite foreign key to `app_user` —
--     which is EXACTLY the decision P2.3 made for `account.primary_contact_id` one item earlier.
--     Two objects, one shape: a named human is a person record, always, and the thing that points
--     at them is a key.
--
-- ★★ AND THE ORGANISATION'S OWN CHANNELS STAY. `email`, `phone`, `website` and the address are a
--    SCHOOL's switchboard, not a human's mobile — canonical on an organisation in every published
--    model, and the field a practice actually fills in. What the pinned test is protecting is the
--    HUMAN, so the trigger below draws the line where the harm is rather than where the word
--    "email" appears: **a party may not carry contact details that belong to a person in this
--    tenant.** A party whose email is a client's email is that client's details living outside
--    `app_user`, which is the sentence the test wrote, enforced instead of asserted.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ★ No data migration is written for `contact_person`. [MEASURED] the column was added by 0081
--   earlier in this same session, has never been deployed, and no row anywhere carries a value —
--   verified before dropping. A column with real values would need the strings resolved to people
--   first, and that would be its own migration with its own report.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM keystone.network_party WHERE contact_person IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'refusing to drop network_party.contact_person: % row(s) carry a value. '
      'Resolve them to app_user records first — dropping would destroy contact data.', n;
  END IF;
END $$;

ALTER TABLE keystone.network_party DROP COLUMN contact_person;

ALTER TABLE keystone.network_party ADD COLUMN primary_contact_id uuid;

-- ★★ COMPOSITE, LIKE EVERY CROSS-ROW KEY HERE. RLS does not police foreign keys — the check runs as
--    the table owner — so without `tenant_id` in the key a party in tenant A could name a person in
--    tenant B. That is the platform boundary breached through the door marked "contact", and P2.3's
--    comment on `account.primary_contact_id` says the same thing about the same shape.
--  ★ SET NULL names ITS OWN COLUMN (F144). The bare form nulls `tenant_id` as well, which detaches
--    the row from its tenant rather than from its contact.
ALTER TABLE keystone.network_party
  ADD CONSTRAINT network_party_primary_contact_fkey
  FOREIGN KEY (tenant_id, primary_contact_id) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (primary_contact_id);

CREATE INDEX network_party_primary_contact_idx
  ON keystone.network_party (tenant_id, primary_contact_id)
  WHERE primary_contact_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE ENFORCEMENT THE PINNED TEST ASKED FOR, MADE REAL.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- ★★ A COLUMN-NAME RULE COULD ONLY EVER BE A PROXY. "No column called email" stops the obvious
--    spelling and nothing else — `primary_channel`, `reach_at`, `enquiries` all walk straight past
--    it. This checks the VALUE instead: if the address or number on a party is one a person in this
--    tenant owns, that person's details are living outside their record, and the write is refused.
--
-- ★ SECURITY DEFINER with an EMPTY search_path, like the other definers here. It must see `app_user`
--   rows the writer's own scope might not reach — a front-desk user adding a party must still be
--   stopped from typing a client's mobile into it, and a check that only looked at rows the WRITER
--   can see would pass precisely when the writer knows least.
CREATE OR REPLACE FUNCTION keystone.network_party_contact_is_not_a_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner text;
BEGIN
  IF NEW.email IS NOT NULL THEN
    SELECT u.display_name INTO v_owner
      FROM keystone.app_user u
     WHERE u.tenant_id = NEW.tenant_id
       AND (lower(u.email) = lower(NEW.email) OR lower(u.secondary_email) = lower(NEW.email))
     LIMIT 1;
    IF v_owner IS NOT NULL THEN
      RAISE EXCEPTION
        'that email address belongs to %, who is a person in this practice — put it on their '
        'record and name them as the contact, so their contact preferences still apply', v_owner
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.phone IS NOT NULL THEN
    -- ★ Compared on digits only. "+1-555-0142" and "(555) 0142" are the same telephone, and a rule
    --   that can be defeated by punctuation is a rule that will be.
    SELECT u.display_name INTO v_owner
      FROM keystone.app_user u
     WHERE u.tenant_id = NEW.tenant_id
       AND regexp_replace(COALESCE(u.mobile_phone, ''), '[^0-9]', '', 'g') <> ''
       AND regexp_replace(COALESCE(u.mobile_phone, ''), '[^0-9]', '', 'g')
           = regexp_replace(NEW.phone, '[^0-9]', '', 'g')
     LIMIT 1;
    IF v_owner IS NOT NULL THEN
      RAISE EXCEPTION
        'that telephone number belongs to %, who is a person in this practice — put it on their '
        'record and name them as the contact, so their contact preferences still apply', v_owner
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER network_party_contact_is_not_a_person_trg
  BEFORE INSERT OR UPDATE OF email, phone ON keystone.network_party
  FOR EACH ROW EXECUTE FUNCTION keystone.network_party_contact_is_not_a_person();

COMMENT ON COLUMN keystone.network_party.primary_contact_id IS
  'P2.4 — the named human at this organisation, as a PERSON RECORD. ★★★ Was `contact_person text` '
  'for the length of one migration; test/p15b_network_writes.test.mjs pins the rule it broke — a '
  'human whose details live outside app_user has no do_not_email/do_not_text/do_not_call beside '
  'them, so the practice cannot honour preferences it cannot see.';

COMMENT ON COLUMN keystone.network_party.email IS
  'P2.4 — the ORGANISATION''s address (enquiries@, admissions@), never a person''s. '
  '`network_party_contact_is_not_a_person_trg` refuses a value that belongs to an app_user in this '
  'tenant, which is the pinned rule enforced on the VALUE rather than proxied by a column name.';
