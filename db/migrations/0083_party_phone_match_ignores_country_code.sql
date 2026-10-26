-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2.4 (correction to 0082) — THE TELEPHONE GUARD COMPARED TOO MUCH OF THE NUMBER.
--
-- ★★★ 0082's guard stripped punctuation and then required the digit strings to be EQUAL. [EXECUTED]
--     a client stored as `+1-555-0142` normalises to `15550142`; the same telephone typed into a
--     party as `(555) 0142` normalises to `5550142`. **Not equal — so the write was ACCEPTED**, and
--     the client's own mobile number came to rest on a network party after all. The guard read as
--     installed and was not, for the one input a person is most likely to type.
--
--   ★★ CAUGHT BY test/p15b_network_writes.test.mjs, which asserts the punctuation case ON PURPOSE:
--      "a rule that can be defeated by a hyphen is a rule that will be." It was defeated by a
--      country code instead — the same class, one digit further left.
--
-- ★ SO IT MATCHES ON THE SUBSCRIBER NUMBER: the last 7 digits, which is the part that identifies a
--   line regardless of how much of the prefix somebody typed. Seven rather than ten because a
--   7-digit local number is a legitimate way to write one; fewer than seven is not a telephone
--   number and is left alone rather than generating false refusals against short codes.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.network_party_contact_is_not_a_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner text;
  v_digits text;
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
    v_digits := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
    -- ★ Below seven digits it is not a telephone line, and comparing it would refuse legitimate
    --   short codes and extensions. Say nothing rather than guess.
    IF length(v_digits) >= 7 THEN
      SELECT u.display_name INTO v_owner
        FROM keystone.app_user u
       WHERE u.tenant_id = NEW.tenant_id
         AND length(regexp_replace(COALESCE(u.mobile_phone, ''), '[^0-9]', '', 'g')) >= 7
         -- ★★ THE LAST SEVEN DIGITS — the subscriber number. Comparing the whole string made
         --    `+1-555-0142` and `(555) 0142` different telephones, which is how this guard shipped
         --    broken in 0082. Comparing the tail makes the country code and the trunk prefix
         --    irrelevant, which is what a human means by "the same number".
         AND right(regexp_replace(COALESCE(u.mobile_phone, ''), '[^0-9]', '', 'g'), 7)
             = right(v_digits, 7)
       LIMIT 1;
      IF v_owner IS NOT NULL THEN
        RAISE EXCEPTION
          'that telephone number belongs to %, who is a person in this practice — put it on their '
          'record and name them as the contact, so their contact preferences still apply', v_owner
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;
