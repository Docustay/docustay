// MS-18.7 — "IS THAT AN EMAIL OR A PHONE NUMBER?", AND ONE CANONICAL PHONE FORMAT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIS FILE IS A SECOND COPY OF A RULE THAT ALREADY EXISTS IN THE DATABASE, AND THAT IS THE
//     DANGEROUS KIND OF FILE. `keystone.normalise_phone_e164` (migration 0122) is the AUTHORITY —
//     it is what every writer passes through and what the CHECK constraint backs up. This is a
//     CONVENIENCE COPY so the browser can tell an email from a phone before it sends anything, and
//     show the person their number in the form it will actually be stored in.
//
// ★★★ SO THE TWO MUST AGREE, AND "must agree" IS NOT A COMMENT — IT IS A TEST.
//     `test/ms18_7_phone_normalisation_agrees_with_sql.test.mjs` feeds the SAME inputs to this
//     function and to the SQL function and fails if any one of them disagrees. This project's
//     recorded defect class is "two sources of truth for one fact" (two nav label tables, two token
//     stores, two mockups, two section shapes — `src/auth/Login.jsx:18-19`). A client-side
//     normaliser that drifts from the database's is the same defect wearing a different hat: the
//     form shows `+15105550100`, the database stores something else, and the number the
//     verification code goes to is neither.
//   ★ IF YOU CHANGE ONE, CHANGE BOTH, AND RUN THAT TEST. The database is the one that wins.

/**
 * ★★ DELIBERATELY PERMISSIVE, AND ONLY EVER USED TO CHOOSE A BRANCH — never to decide whether an
 *    address is real. The server and Firebase do that. A strict RFC 5322 regex here would reject
 *    valid addresses and strand real people on a login screen with no way forward, which is a far
 *    worse failure than accepting something that later fails to authenticate.
 */
function looksLikeEmail(raw) {
  if (typeof raw !== "string") return false;
  const v = raw.trim();
  // something, an @, something, a dot, something — and no spaces anywhere.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * ★ "Could this be a phone number?" — again a BRANCH decision, not a validity judgement.
 *   Requires enough digits to be a real number so that a typo'd email fragment does not silently
 *   become "a phone number" and send the person down the wrong path.
 */
function looksLikePhone(raw) {
  if (typeof raw !== "string") return false;
  const v = raw.trim();
  if (v === "") return false;
  // ★ Only the characters a person actually types in a phone number. An `@` or a letter means
  //   they meant an email, however many digits it happens to contain.
  if (!/^[+()\-.\s\d]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * The browser-side mirror of `keystone.normalise_phone_e164`.
 *
 * ★★★ RETURNS null WHEN IT CANNOT DECIDE — it never guesses, for exactly the reason migration 0122
 *     gives: a number coerced into something plausible sends a verification code, and later a
 *     client's name and appointment time, to a stranger who never consented to receive them.
 *   ★ NOTE THE ONE DELIBERATE DIFFERENCE FROM THE SQL. The SQL returns the input UNCHANGED when it
 *     cannot canonicalise, because it needs the CHECK constraint downstream to refuse the write.
 *     This returns null, because its caller is a form that must simply not submit. Both mean
 *     "no usable number"; neither invents one. The agreement test accounts for this by comparing
 *     "did it produce a valid E.164 string, and if so which one".
 */
export function normalisePhoneE164(raw) {
  if (typeof raw !== "string") return null;
  let v = raw.trim();
  if (v === "") return null;

  // ★★★ REFUSE ANYTHING CARRYING CHARACTERS A PHONE NUMBER DOES NOT HAVE — AND THIS GUARD WAS
  //     ADDED BECAUSE ITS ABSENCE PRODUCED A WRONG NUMBER, NOT BECAUSE IT LOOKED TIDY.
  //     [EXECUTED 2026-09-15] `"+1 (510) 555-0100 ext 22"` normalised to `+1510555010022`: the
  //     extension's digits were swallowed into the subscriber number, and the result PASSED the
  //     E.164 shape check because 13 digits is a legal E.164 length. Both this function and the SQL
  //     one produced it, so the agreement test went green on a number that reaches nobody — or
  //     reaches somebody else.
  //   ★★ This is the exact failure the "never guess" rule exists to prevent, arriving through the
  //      one door that rule did not cover: the input was not UNDECIDABLE, it was CONFIDENTLY
  //      MISREAD. An extension is a real thing people type into a phone field; it must be refused
  //      loudly so they remove it, never silently concatenated.
  //   ★ Same character class as `looksLikePhone`, so classify and normalise cannot disagree about
  //     what counts as a phone number.
  if (!/^[+()\-.\s\d]+$/.test(v)) return null;

  // ★ ITU international access prefix: 0044… means +44…. Handled before the digit strip so it is
  //   not mistaken for a national number with leading zeros.
  if (/^00\d/.test(v)) v = `+${v.slice(2)}`;

  const digits = v.replace(/\D/g, "");
  if (digits === "") return null;

  let candidate;
  if (v.startsWith("+")) {
    candidate = `+${digits}`;
  } else if (digits.length === 10) {
    // ★ THE NANP ASSUMPTION — the single assumption, mirroring migration 0122's single branch.
    //   A bare 10-digit number is read as North American. This is the one line that would need
    //   revisiting for a non-NANP tenant, and it is confined here so it can be found.
    candidate = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    candidate = `+${digits}`;
  } else {
    // ★ Undecidable — eight digits with no country code could be half a dozen countries.
    return null;
  }

  // ★★ THE SAME SHAPE THE DATABASE'S CHECK CONSTRAINT ENFORCES. Applied here too so the two cannot
  //    drift apart at the edges: a country code never starts with 0, and E.164 caps at 15 digits.
  return /^\+[1-9]\d{1,14}$/.test(candidate) ? candidate : null;
}

/**
 * What the person typed, classified.
 * @returns {{kind:'email'|'phone'|'unknown', value:string|null}}
 *
 * ★ EMAIL IS TESTED FIRST. An address like `1234567@x.co` contains enough digits to tempt the
 *   phone branch; the `@` settles it, and `looksLikePhone` refuses letters anyway. Order stated so
 *   a later "tidy-up" does not swap them.
 */
export function classifyIdentifier(raw) {
  if (looksLikeEmail(raw)) return { kind: "email", value: raw.trim() };
  if (looksLikePhone(raw)) {
    const e164 = normalisePhoneE164(raw);
    // ★ Looks like a phone but could not be canonicalised (e.g. 8 digits, no country code). That
    //   is NOT "unknown input" — it is a phone number we cannot dial, and the caller must say so
    //   rather than silently offering the email branch.
    return { kind: "phone", value: e164 };
  }
  return { kind: "unknown", value: null };
}
