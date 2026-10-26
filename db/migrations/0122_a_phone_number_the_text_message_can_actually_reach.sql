-- 0122_a_phone_number_the_text_message_can_actually_reach
-- MS-18.6 — ONE CANONICAL PHONE FORMAT, ENFORCED AT WRITE, IN THE DATABASE.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY THIS IS A MIGRATION AND NOT A FORM VALIDATOR. Phone numbers are about to become an
--     AUTHENTICATION factor: Firebase phone sign-in sends a code to a number and returns a uid for
--     whoever answers it. Firebase speaks E.164 and nothing else — `+15105550100`. The CRM would
--     happily store `(510) 555-0100`, `510-555-0100` and `+1 510 555 0100` as three different
--     strings for one human being. None of those three matches the Firebase identity, so the person
--     ends up as two records with no way to tell which is real, and the one who cannot sign in
--     finds out at the worst possible moment.
--   ★★ A FORM CANNOT FIX THIS AND MUST NOT BE TRUSTED TO. There are already writers that never see
--      a form — the seed scripts, the gates, `bulkCreate`-shaped paths, and every future import. A
--      rule that lives in one of six writers is a rule that holds five-sixths of the time. It goes
--      where every writer must pass: a BEFORE trigger and a CHECK constraint.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT IS ACTUALLY IN THESE COLUMNS TODAY, MEASURED BEFORE WRITING A LINE OF THIS FILE.
--     [MEASURED 2026-09-15, local (107 app_user rows) AND the deployed database (3 rows)]
--         mobile_phone NOT NULL ............ 0
--         home_phone NOT NULL .............. 0
--         emergency_contact_phone NOT NULL . 0
--         values failing the E.164 shape ... 0
--         duplicate mobile numbers ......... 0
--     Every phone column is 100% NULL everywhere. `src/records/lists/people.mjs` already says in
--     its own comment that the product "could not store a phone number … until a form can set
--     them", and the data agrees: nothing has ever written one.
--   ★★★ SO THE MIGRATION IS CLEAN, AND THE "EXISTING ROWS WILL BREAK" RISK IS MEASURED AT ZERO
--       RATHER THAN ARGUED AWAY. The CHECKs below can be added VALID immediately (no row violates
--       them — NULL passes a CHECK), and the unique index can be built immediately (no duplicates
--       exist to refuse). There is no historical data to convert, so THERE IS NO BACKFILL TO RUN.
--       The backfill "plan" is one sentence: the three people on the deployed database have no
--       number, and each will supply one the first time they are asked.
--
-- ★★★ AND THE COLUMN STAYS NULLABLE TODAY — Ty's ruling, and the measurement supports it. NOT NULL
--     would refuse every one of the 107 local rows and all 3 deployed ones on their next UPDATE,
--     for a value none of them has. "Required for NEW accounts" is a rule for the signup path to
--     enforce, not a column constraint, precisely because it must not retroactively invalidate
--     people who already exist. Do not add NOT NULL here without a backfill that has actually run.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · THE NORMALISER
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHEN IT CANNOT DECIDE, IT REFUSES — IT NEVER GUESSES. This is the whole safety argument of
--     the function. An input it cannot confidently canonicalise is returned UNCHANGED, which means
--     it still fails the CHECK constraint below and the write fails LOUDLY at the point of insert.
--   ★★ A WRONG PHONE NUMBER IS STRICTLY WORSE THAN NO PHONE NUMBER. A number silently coerced into
--      something plausible is a verification code — and later, appointment reminders containing a
--      client's name and session time — delivered to a stranger who never consented to receive
--      them. Refusing the write costs somebody thirty seconds; guessing costs a confidentiality
--      breach that nobody detects, because from the inside it looks like the message was sent.
--
-- ★★ THE `+1` ASSUMPTION IS STATED, NOT HIDDEN. A bare 10-digit number is read as North American.
--    That is an ASSUMPTION about the customer base, not a fact about phone numbers, and it is the
--    one line in this file that would need revisiting for a non-NANP tenant. It is confined to a
--    single branch so it can be found. Anything already carrying a `+` is respected as-is and the
--    assumption never applies to it.
CREATE FUNCTION keystone.normalise_phone_e164(p_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v      text;
  digits text;
BEGIN
  IF p_raw IS NULL THEN RETURN NULL; END IF;
  v := btrim(p_raw);
  -- ★ Empty and whitespace-only collapse to NULL. "Absent" must have ONE representation, or
  --   `WHERE mobile_phone IS NOT NULL` silently disagrees with `WHERE mobile_phone <> ''` and the
  --   unique index below stops covering the rows people think it covers.
  IF v = '' THEN RETURN NULL; END IF;

  -- ★ `00` is the ITU international access prefix — `0044…` means `+44…`. Handled before the
  --   digit strip so it is not mistaken for a national number with leading zeros.
  IF v ~ '^00[0-9]' THEN
    v := '+' || substring(v from 3);
  END IF;

  digits := regexp_replace(v, '[^0-9]', '', 'g');
  -- ★ No digits at all (someone typed "n/a"). Hand it back untouched; the CHECK refuses it.
  IF digits = '' THEN RETURN v; END IF;

  -- ★ Already international: keep the country code the caller gave, drop the decoration only.
  IF left(v, 1) = '+' THEN
    RETURN '+' || digits;
  END IF;

  -- ★ THE NANP CONVENIENCE BRANCH — the stated assumption, and the only one.
  IF length(digits) = 10 THEN
    RETURN '+1' || digits;
  END IF;
  IF length(digits) = 11 AND left(digits, 1) = '1' THEN
    RETURN '+' || digits;
  END IF;

  -- ★★ UNDECIDABLE. Eight digits with no country code could be half a dozen countries. Returned
  --    unchanged on purpose so the CHECK below rejects the write rather than inventing a prefix.
  RETURN v;
END $$;

COMMENT ON FUNCTION keystone.normalise_phone_e164(text) IS
  'MS-18.6 — one canonical phone format (E.164) for every writer. ★ Returns its input UNCHANGED '
  'when it cannot confidently canonicalise, so the app_user_*_e164 CHECK constraints refuse the '
  'write loudly instead of storing a guessed number: a wrong number sends a verification code, and '
  'later a client''s name and appointment time, to a stranger. ★ A bare 10-digit number is assumed '
  'North American — the only assumption in the function, confined to one branch.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · THE TRIGGER — so no writer can route around the normaliser
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ BEFORE, so it runs ahead of the CHECK constraints (Postgres evaluates row constraints after
--   BEFORE triggers). A normaliser in an AFTER trigger could not change the stored value at all.
CREATE FUNCTION keystone.app_user_normalise_phones()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.mobile_phone            := keystone.normalise_phone_e164(NEW.mobile_phone);
  NEW.home_phone              := keystone.normalise_phone_e164(NEW.home_phone);
  NEW.emergency_contact_phone := keystone.normalise_phone_e164(NEW.emergency_contact_phone);
  RETURN NEW;
END $$;

CREATE TRIGGER app_user_normalise_phones_trg
  BEFORE INSERT OR UPDATE ON keystone.app_user
  FOR EACH ROW EXECUTE FUNCTION keystone.app_user_normalise_phones();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3 · THE SHAPE — the backstop the trigger cannot be trusted without
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ THE CHECK IS NOT REDUNDANT WITH THE TRIGGER. A trigger can be disabled (`ALTER TABLE …
--    DISABLE TRIGGER`), replaced, or bypassed by `COPY … (FREEZE)`-shaped paths; a CHECK constraint
--    is evaluated on every row regardless. The trigger makes good input canonical; the CHECK makes
--    bad input impossible. Two mechanisms, two different failure modes.
-- ★ `[1-9]` on the first digit: E.164 country codes never begin with 0, so this also rejects the
--   `+0…` a naive "just add a plus" normaliser produces. Max 15 digits total, per E.164.
ALTER TABLE keystone.app_user
  ADD CONSTRAINT app_user_mobile_phone_e164
    CHECK (mobile_phone IS NULL OR mobile_phone ~ '^\+[1-9][0-9]{1,14}$'),
  ADD CONSTRAINT app_user_home_phone_e164
    CHECK (home_phone IS NULL OR home_phone ~ '^\+[1-9][0-9]{1,14}$'),
  ADD CONSTRAINT app_user_emergency_phone_e164
    CHECK (emergency_contact_phone IS NULL OR emergency_contact_phone ~ '^\+[1-9][0-9]{1,14}$');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4 · UNIQUENESS — AND THE SCOPE IS A REAL DECISION, NOT A DEFAULT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ PER TENANT, NOT GLOBAL, AND THE REASONING MATTERS BECAUSE THE OBVIOUS ANSWER IS WRONG.
--     The instinct is "Firebase allows one identity per phone number, so make the column globally
--     unique." That would BREAK a case this codebase explicitly supports. `src/auth/login.mjs:82-85`
--     states it outright: the constraint is UNIQUE (tenant_id, firebase_uid), so **one person MAY
--     legitimately belong to several tenants**. One human, one phone, one Firebase uid, and one
--     app_user row in EACH practice they attend. A global unique index refuses the second row and
--     locks a real client out of their second practice.
--   ★★ What must be refused is TWO DIFFERENT PEOPLE sharing a number inside ONE practice — which is
--      the duplicate-record defect, and which this index does refuse. Across tenants the same
--      number is indistinguishable from the legitimate multi-practice case, so it is not the
--      database's call to make.
--   ★ This matches `app_user_tenant_firebase_uid_key` exactly — same shape, same partial predicate,
--     same reasoning — which is not a coincidence: a phone number and a uid are the same kind of
--     thing here, an identity handle that may be absent.
--
-- ★★ PARTIAL, `WHERE mobile_phone IS NOT NULL`. Without the predicate, NULLs are distinct in a
--    btree and the index would appear to work while the interesting rows are exactly the ones it
--    does not constrain. Stated because it is the half that gets dropped in a rewrite.
CREATE UNIQUE INDEX app_user_tenant_mobile_phone_key
  ON keystone.app_user (tenant_id, mobile_phone)
  WHERE mobile_phone IS NOT NULL;

COMMENT ON INDEX keystone.app_user_tenant_mobile_phone_key IS
  'MS-18.6 — one mobile number identifies at most one person WITHIN a practice. ★ Deliberately NOT '
  'global: login.mjs:82-85 records that one identity may belong to several tenants, so one human '
  'with one phone legitimately has a row in each practice they attend, and a global unique index '
  'would lock them out of the second. Partial so that absent numbers stay unconstrained.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ PROVE ALL FOUR CLAIMS BEFORE COMMITTING. Same ritual as 0019/0121: FORCE off for the fixture,
--     back on after, and the restoration asserted.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.tenant   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t1 uuid; t2 uuid;
  v  text;
  refused boolean;
BEGIN
  -- ── (a) THE NORMALISER, INDEPENDENT OF ANY TABLE ────────────────────────────────────────────
  -- ★ POSITIVE CONTROL FIRST: the shapes a human actually types must all land on ONE string.
  FOR v IN SELECT unnest(ARRAY[
      '(510) 555-0100', '510-555-0100', '510.555.0100', '5105550100',
      '+1 510 555 0100', '+1 (510) 555-0100', '15105550100', '001 510 555 0100',
      '  +1-510-555-0100  '
  ]) LOOP
    IF keystone.normalise_phone_e164(v) IS DISTINCT FROM '+15105550100' THEN
      RAISE EXCEPTION
        'NORMALISER: % became % — every one of these is the same telephone, and two spellings of '
        'one number is how a person becomes two records', v,
        COALESCE(keystone.normalise_phone_e164(v), '<null>');
    END IF;
  END LOOP;

  -- ★ A non-NANP number keeps its own country code; the +1 branch must not touch it.
  IF keystone.normalise_phone_e164('+44 20 7946 0958') IS DISTINCT FROM '+442079460958' THEN
    RAISE EXCEPTION 'NORMALISER: a +44 number was not preserved — got %',
      COALESCE(keystone.normalise_phone_e164('+44 20 7946 0958'), '<null>');
  END IF;

  -- ★ Absent has exactly one representation.
  IF keystone.normalise_phone_e164('')    IS NOT NULL THEN RAISE EXCEPTION 'empty string did not become NULL'; END IF;
  IF keystone.normalise_phone_e164('   ') IS NOT NULL THEN RAISE EXCEPTION 'whitespace did not become NULL'; END IF;
  IF keystone.normalise_phone_e164(NULL)  IS NOT NULL THEN RAISE EXCEPTION 'NULL did not stay NULL'; END IF;

  -- ── (b) UNDECIDABLE INPUT IS REFUSED BY THE WRITE, NOT GUESSED ──────────────────────────────
  INSERT INTO keystone.tenant (slug, name, timezone, status)
  VALUES ('m0122-a', 'M0122 A', 'UTC', 'active'), ('m0122-b', 'M0122 B', 'UTC', 'active');
  SELECT id INTO t1 FROM keystone.tenant WHERE slug = 'm0122-a';
  SELECT id INTO t2 FROM keystone.tenant WHERE slug = 'm0122-b';

  refused := false;
  BEGIN
    INSERT INTO keystone.app_user (tenant_id, email, display_name, role, mobile_phone)
    VALUES (t1, 'junk@example.invalid', 'Junk', 'adult_client', 'not a phone number');
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION
      'a value the normaliser could not canonicalise was STORED — the CHECK is not refusing, so '
      'unreachable numbers will accumulate silently';
  END IF;

  -- ── (c) POSITIVE CONTROL FOR (b): a good number still goes in, NORMALISED ────────────────────
  -- ★ Without this, (b) passes just as well on a table that refuses every phone number.
  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, mobile_phone)
  VALUES (t1, 'a@example.invalid', 'A', 'adult_client', '(510) 555-0100');
  SELECT mobile_phone INTO v FROM keystone.app_user WHERE tenant_id = t1 AND email = 'a@example.invalid';
  IF v IS DISTINCT FROM '+15105550100' THEN
    RAISE EXCEPTION 'the TRIGGER did not normalise on INSERT — stored %', COALESCE(v, '<null>');
  END IF;

  -- ★ and on UPDATE too. A trigger declared INSERT-only is the classic half-fix.
  UPDATE keystone.app_user SET mobile_phone = '510.555.0199'
   WHERE tenant_id = t1 AND email = 'a@example.invalid';
  SELECT mobile_phone INTO v FROM keystone.app_user WHERE tenant_id = t1 AND email = 'a@example.invalid';
  IF v IS DISTINCT FROM '+15105550199' THEN
    RAISE EXCEPTION 'the TRIGGER did not normalise on UPDATE — stored %', COALESCE(v, '<null>');
  END IF;

  -- ── (d) UNIQUENESS: REFUSED INSIDE A TENANT ─────────────────────────────────────────────────
  refused := false;
  BEGIN
    INSERT INTO keystone.app_user (tenant_id, email, display_name, role, mobile_phone)
    VALUES (t1, 'b@example.invalid', 'B', 'adult_client', '+1 (510) 555-0199');
  EXCEPTION WHEN unique_violation THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION
      'two people in ONE practice hold the same mobile number — Firebase will return one uid for '
      'it and the second person can never sign in';
  END IF;

  -- ── (e) AND PERMITTED ACROSS TENANTS — the case a global unique index would break ────────────
  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, mobile_phone)
  VALUES (t2, 'a@example.invalid', 'A', 'adult_client', '+15105550199');

  -- ★ Two NULLs must not collide either, or every person without a phone blocks the next one.
  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, mobile_phone)
  VALUES (t1, 'n1@example.invalid', 'N1', 'adult_client', NULL),
         (t1, 'n2@example.invalid', 'N2', 'adult_client', NULL);

  DELETE FROM keystone.app_user WHERE tenant_id IN (t1, t2);
  DELETE FROM keystone.tenant   WHERE id        IN (t1, t2);
END $$;

ALTER TABLE keystone.tenant   FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user FORCE ROW LEVEL SECURITY;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone'
     AND c.relname IN ('tenant', 'app_user')
     AND NOT c.relforcerowsecurity;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY was not restored on: %', bad;
  END IF;
END $$;
