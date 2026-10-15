-- 0123_an_extension_is_not_part_of_the_number
-- MS-18.6 FOLLOW-UP — THE NORMALISER CONFIDENTLY MISREAD AN INPUT INSTEAD OF REFUSING IT.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT, MEASURED. [EXECUTED 2026-09-15, the hour 0122 shipped]
--         keystone.normalise_phone_e164('+1 (510) 555-0100 ext 22')  →  '+1510555010022'
--     The extension's digits were swallowed into the subscriber number. The result is THIRTEEN
--     digits, which is a legal E.164 length, so `app_user_mobile_phone_e164` ACCEPTED it. A number
--     that reaches nobody — or reaches somebody else — would have been stored, marked canonical,
--     and used to send a verification code.
--
-- ★★★ WHY 0122's SAFETY ARGUMENT DID NOT COVER THIS. That file's rule is "when it cannot decide, it
--     refuses" and the rule is sound. But this input was never UNDECIDABLE — it was CONFIDENTLY
--     MISREAD. `regexp_replace(v,'[^0-9]','','g')` cheerfully harvests digits out of any
--     surrounding prose, so `ext 22` looked exactly like more telephone number. The guard was in
--     the wrong place: at the end, judging the OUTPUT's shape, when what was needed was at the
--     start, judging whether the INPUT was a phone number at all.
--   ★ An extension is not an exotic input. It is on half the business cards in the world and it is
--     the first thing a receptionist types.
--
-- ★★ AND IT PASSED THE AGREEMENT TEST. `test/ms18_7_phone_normalisation_agrees_with_sql.test.mjs`
--    compares the browser normaliser against this one and went GREEN, because both implementations
--    made the identical mistake. Two things agreeing is not two things being right — the test
--    proves they do not DRIFT, and cannot prove either is correct. That limit is worth writing
--    down where the next person reads it.
--
-- ★ THE FIX IS A CHARACTER CLASS AT THE TOP, matching `looksLikePhone` in web/src/auth/phone.js so
--   that classify and normalise cannot disagree about what counts as a phone number. Anything
--   carrying a character a phone number does not have is returned UNCHANGED, so the CHECK
--   constraint refuses the write loudly and the person is asked to remove the extension.
-- ★ NO DATA TO REPAIR: [MEASURED 2026-09-15] every phone column on both the local and the deployed
--   database is still 100% NULL, so nothing was stored through the defective version.

CREATE OR REPLACE FUNCTION keystone.normalise_phone_e164(p_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v      text;
  digits text;
BEGIN
  IF p_raw IS NULL THEN RETURN NULL; END IF;
  v := btrim(p_raw);
  IF v = '' THEN RETURN NULL; END IF;

  -- ★★★ THE NEW GUARD. Only the characters a person actually types IN a phone number. `ext`, `x`,
  --     letters, or any prose means this is not a bare number, and its digits must NOT be harvested.
  --     Returned unchanged so the CHECK constraint refuses the write — see the header.
  IF v !~ '^[+()\-.[:space:]0-9]+$' THEN
    RETURN v;
  END IF;

  IF v ~ '^00[0-9]' THEN
    v := '+' || substring(v from 3);
  END IF;

  digits := regexp_replace(v, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN v; END IF;

  IF left(v, 1) = '+' THEN
    RETURN '+' || digits;
  END IF;

  IF length(digits) = 10 THEN
    RETURN '+1' || digits;
  END IF;
  IF length(digits) = 11 AND left(digits, 1) = '1' THEN
    RETURN '+' || digits;
  END IF;

  RETURN v;
END $$;

COMMENT ON FUNCTION keystone.normalise_phone_e164(text) IS
  'MS-18.6 — one canonical phone format (E.164) for every writer. ★ Refuses (returns its input '
  'unchanged, so the app_user_*_e164 CHECK rejects the write) for anything it cannot confidently '
  'canonicalise AND for anything carrying characters a phone number does not have. The second '
  'clause was added by 0123 after ''+1 (510) 555-0100 ext 22'' normalised to ''+1510555010022'' — a '
  'legal-shaped E.164 string that reaches the wrong person. ★ A bare 10-digit number is assumed '
  'North American: the only assumption in the function, confined to one branch.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ PROVE THE DEFECT IS GONE **AND** THAT THE FUNCTION STILL WORKS. The second half is not
--     optional: a normaliser that now refuses everything would satisfy the first half perfectly.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v text; bad text;
BEGIN
  -- ── THE REGRESSION ITSELF ──
  v := keystone.normalise_phone_e164('+1 (510) 555-0100 ext 22');
  IF v ~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION
      'an extension was absorbed into the number again: % — this passes the E.164 CHECK and would '
      'be stored as canonical', v;
  END IF;

  -- ★ the same shape, several ways people write it
  FOR bad IN SELECT unnest(ARRAY[
      '+1 (510) 555-0100 ext 22', '510-555-0100 x22', '5105550100 ext. 4',
      'call 510-555-0100', '510-555-0100 (mobile)', '510-555-0100/0101'
  ]) LOOP
    IF keystone.normalise_phone_e164(bad) ~ '^\+[1-9][0-9]{1,14}$' THEN
      RAISE EXCEPTION 'input % was misread as the canonical number %',
        bad, keystone.normalise_phone_e164(bad);
    END IF;
  END LOOP;

  -- ── POSITIVE CONTROL: every legitimate spelling still collapses to one string ──
  FOR v IN SELECT unnest(ARRAY[
      '(510) 555-0100', '510-555-0100', '510.555.0100', '5105550100',
      '+1 510 555 0100', '+1 (510) 555-0100', '15105550100', '001 510 555 0100',
      '  +1-510-555-0100  ', '1-510-555-0100'
  ]) LOOP
    IF keystone.normalise_phone_e164(v) IS DISTINCT FROM '+15105550100' THEN
      RAISE EXCEPTION
        'POSITIVE CONTROL FAILED: % became % — the new guard is refusing legitimate input, which is '
        'over-correction: nobody can save a phone number at all', v,
        COALESCE(keystone.normalise_phone_e164(v), '<null>');
    END IF;
  END LOOP;

  IF keystone.normalise_phone_e164('+44 20 7946 0958') IS DISTINCT FROM '+442079460958' THEN
    RAISE EXCEPTION 'POSITIVE CONTROL FAILED: international numbers no longer normalise';
  END IF;
END $$;
