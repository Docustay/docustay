// Stage 5 task 5.5 — SIGNED LINK TOKENS: MINT, REDEEM, PEEK, REVOKE.
// CT-018 / CT-019 · CCR-9 (revoke takes no tenant argument) · CCR-10 (peek) · CCR-15 · CCR-16.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE FOURTH CREDENTIAL TYPE, AND IT IS DELIBERATELY THE SAME SHAPE AS THE OTHER THREE.
//     `kl_<26 Crockford base32>_<43 base64url>` — an id that is PUBLIC and a secret that is never
//     stored. The id makes the lookup a unique-index probe; the secret is compared as a 32-byte
//     HMAC digest. That is the salt dilemma's resolution, argued in full at src/auth/session.mjs:3-20
//     and src/auth/apiToken.mjs:4-20, and this module deliberately copies it rather than re-deriving
//     it — and re-deriving it differently — in a fourth place.
//   ★ The digest is HMAC-SHA256 under KEYSTONE_TOKEN_PEPPER: a stolen database dump cannot be used
//     to confirm a guessed link offline, because the pepper lives in a different blast radius.
//
// ★★★ WHAT IS DIFFERENT ABOUT A LINK TOKEN: THE PRESENTER HAS NO SESSION AND NO PRACTICE.
//     A client opens an email on a phone with no cookie. So the redeem runs through
//     `withCredentialLookup` — the one door with NO tenant GUC set — and DISCOVERING the practice is
//     the point of the call. `keystone.redeem_link_token` is therefore not tenant-scoped and
//     `link_token_credential_read` is `USING (true)`. What stands between a stranger and a practice's
//     row is the 43-character secret, nothing else.
//
// ★★ THE COMPARISON HAPPENS IN POSTGRES, ON A bytea, AS AN INDEX PROBE — never in JavaScript.
//    A JS comparison would mean returning `secret_hash` to app_rw, which is exactly what
//    db/gates/catalog-conformance.mjs:668 forbids and what CCR-16's column-level SELECT (which
//    excludes token_id and secret_hash) makes impossible. src/auth/session.mjs:125-129 keeps a
//    `digestsEqual` for its gate and says the same thing in its comment: it is not on the hot path.
//    This module has no such function because it has no caller for one, and an export nothing
//    imports is what db/gates/wiring.mjs counts.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THREE THINGS STAGE-5-PLAN TASK 5.5 LEFT OPEN. DECIDED HERE, ON THE RECORD, WITH REASONS.
//
// DECISION 1 — `mintLinkToken` AND `revokeLinkToken` TAKE THE TENANT TRANSACTION AS THEIR FIRST
//   ARGUMENT (`tx`), NOT A `tenantId`. They are `mintLinkToken(tx, {...})` and
//   `revokeLinkToken(tx, tokenId, reason)`.
//   ★ The precedent is exact: `createApiToken(tx, {...})` and `revokeApiToken(tx, {...})`
//     (src/auth/apiToken.mjs:205,222) take the tenant-scoped connection, and :199-201 gives the
//     reason — "the tenant comes from `current_tenant_id()` inside the definer function, so a caller
//     cannot mint a key into another tenant's account even by passing the wrong id: THERE IS NO ID
//     TO PASS."
//   ★★ A `tenantId` PARAMETER WOULD BE A LIE HERE. Both SQL functions decide the practice from
//      `keystone.current_tenant_id()` — mint RAISES unless p_tenant matches it, revoke scopes its
//      WHERE on it. A `tenantId` argument that disagreed with the transaction could therefore only
//      ever produce a refusal, and one that agreed would be decoration. The transaction is the
//      tenant, so the transaction is the argument.
//   ★★ AND IT IS WHY `revoke` CANNOT MISS ITS OWN AND CANNOT TOUCH ANOTHER'S: `assertTenantTx`
//      (src/db/index.mjs:59) refuses a pool or a raw client BY NAME at the call, so the GUC is
//      always set; `token_id` is GLOBALLY unique (CCR-15), so within one practice it names at most
//      one row and the WHERE finds it; and the SQL's `tenant_id = keystone.current_tenant_id()`
//      means a token belonging to another practice matches nothing at all.
//   ★ WHAT THIS DEPARTS FROM — reported, not absorbed: CT-019 and STAGE-5-PLAN task 5.5 field 4
//     write `mintLinkToken({ tenantId, ... })` and `revokeLinkToken(tokenId, reason)`, and
//     STAGE-8-PLAN.md:1350 calls `revokeLinkToken(tenantId, tokenId, reason)`. All three become a
//     leading `tx`. Stage 8's call site is NOT edited by this task.
//
// DECISION 2 — EVERY REFUSAL IS ONE OBJECT: `forbidden(LINK_TOKEN_REFUSED)`, 403, not retryable,
//   the same message every time. Unknown token, malformed string, wrong pepper, wrong purpose,
//   spent, expired, revoked — all of them.
//   ★★★ IT CANNOT BE `not_found` FOR "UNKNOWN", WHICH IS WHAT CT-019 ASKS FOR, BECAUSE THE
//       INFORMATION DOES NOT EXIST IN THIS PROCESS. `keystone.redeem_link_token` returns zero rows
//       for ALL SEVEN causes — that is its design, and the one property the feature's safety rests
//       on. To tell "unknown" from "expired" the JS would have to ask a SECOND question, and a
//       function that answers "that token exists but is spent" IS the enumeration oracle the
//       undifferentiated refusal exists to deny. So the distinction is not merely unimplemented; it
//       is unimplementable without giving away the thing being protected.
//   ★★ WHY `forbidden` AND NOT `unauthenticated`: 401 is load-bearing in both front ends — it means
//      "your session is gone, sign in again" (web/src/App.jsx:229,671,1014 and
//      webui/src/lib/app/appState.svelte.js:153,285,309 all redirect on it). A link presenter HAS no
//      session, so a 401 would send them to a sign-in screen they can never satisfy. 403 says "this
//      link will not do that", which is the truth and is what spec 03 §7's friendly "send me a new
//      link" page renders. It also matches the sibling refusals Stage 8 already writes
//      (STAGE-8-PLAN.md:1327,1477-1479 use `kind: "forbidden"`).
//   ★ The message names NO cause. It is the same string for a typo and for a revoked link, and
//     test (g)/(k) compare the thrown objects side by side rather than reading one.
//
// DECISION 3 — `keystone.revoke_link_token` REQUIRES `revoked_at IS NULL AND redeemed_at IS NULL`,
//   so `revokeLinkToken` returns `{ revoked: false }` for a token that is already spent or already
//   revoked.
//   ★ Revoking a spent token would stamp `revoked_at` on a row whose story is already told, and the
//     honest answer to "did I revoke something" is then NO. Reporting `true` there would make the
//     return value meaningless — `revokeApiToken` (src/auth/apiToken.mjs:221-225) is idempotent the
//     same way and by the same mechanism: a second call matches no row and returns null.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { randomBytes, createHmac } from "node:crypto";
import { withCredentialLookup, assertTenantTx } from "../db/index.mjs";
import { forbidden, internal } from "../http/errors.mjs";
import { DOCUMENTS_DOMAIN } from "../documents/frontDoor.mjs";

// ★ Crockford base32 — the alphabet in 0169's CHECK on link_token.token_id. No I, L, O or U, so a
//   link read aloud or copied by hand cannot become a different valid link.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TOKEN_ID_LEN = 26;
const SECRET_BYTES = 32; // 256 bits → 43 base64url characters

/**
 * ★★★ THE PURPOSE REGISTER, JS HALF (Q5-7, RULED by the maintainer 21 Sep 2026; CONTRACTS Q0-24).
 *     Its keys must be exactly the values in 0169's `CHECK (purpose IN (…))` — test (j) compares
 *     the two sets by reading `pg_get_constraintdef`, so neither can be extended without the other.
 *   ★★ WHY IT EXISTS AT ALL: `redeem_link_token` returns uuids and NOTHING ELSE
 *      (db/gates/catalog-conformance.mjs:668 refuses a text result on a credential resolver), so the
 *      row cannot tell the JS which purpose matched. The caller asserts the purposes it will accept;
 *      this map turns that assertion into a subject type. **The subject type returned is the one the
 *      caller asserted, never one the row taught it.**
 *   ★ Stage 8's 0203 adds 'invite' and 'client_invite' to the CHECK and adds them here in the same
 *     task. FROZEN so a caller cannot register a purpose at runtime.
 */
export const PURPOSE_SUBJECT_TYPE = Object.freeze({
  // spec 03 §7 "sign document"; STAGE-7-PLAN Q7-2's four signer routes authorise on a link "scoped
  // to the one instance". `document_signature` is DECLARED BY DOCUMENTS (src/documents/domain.mjs).
  ...DOCUMENTS_DOMAIN.linkTokenPurposes,
  // ★ Stage 8, 0203. BOTH invite purposes map to the SAME subject type, deliberately: task 8.6's
  //   acceptInvite calls redeemLinkToken(presented, ['invite','client_invite']), and a multi-member
  //   expectedPurposes whose members map to DIFFERENT subject types throws internal at the call
  //   (see subjectTypeFor below) — so if the two purposes disagreed, every acceptance would 500,
  //   identically for a good token and a bad one. The subject type is "invite", the table
  //   keystone.invite (CT-055), which is also the value 0203's rows hold in
  //   keystone.link_token.subject_type.
  invite:        "invite",
  client_invite: "invite",
  // ★ Stage 13, 0315 (CT-106). A single-redemption, short-TTL link sent when a waitlist slot opens
  //   (`booking.waitlist.offered`). The subject is the waitlist queue row itself — the offer's own
  //   shape (which slot, which service, when it lapses) lives on that row, not on a second table —
  //   so `subject_id` is a `keystone.booking_waitlist_entry.id`, the same one 0398's `claim_token_id`
  //   points back at.
  waitlist_claim: "booking_waitlist_entry",
  // ★ Stage 15, 0427 (CT-F40/CT-F41), task 15.4. Three money-flow purposes, minted at email time
  //   (task 15.37 — the presented token is never stored in plaintext) and redeemed by task 15.34.
  invoice_view:    "invoice",
  estimate_accept: "estimate",
  // ★ The payer whose card is updated, not a payment method — the link takes the payer to a card-
  //   update flow scoped to THEM, so the subject is the person row, the same way every other purpose
  //   here names the thing the link is scoped to.
  card_update:     "person",
  // ★ 22 Oct 2026 (booking everywhere), 0794. "Change or cancel" for ONE booking, minted fresh per email and per booked page,
  //   valid until the booking starts, read with peekLinkToken (never spent). src/booking/manageLinks.mjs.
  booking_manage:  "booking",
});

/**
 * Resolve the subject type for a set of asserted purposes — and FAIL LOUDLY when it cannot.
 * ★★ Q5-7's ruling, in one function: every member must be a registered purpose, and they must all
 *    map to the SAME subject type. Two purposes with different subject types is a PROGRAMMING error
 *    at the call site (a route asking a question with no single answer), never a bad link, so it is
 *    `internal` — the same choice src/auth/session.mjs:116 makes for a revoke reason outside its set.
 *  ★ An empty list is refused too: a caller that asserts nothing would accept anything.
 *
 * ★★ THE SECOND PARAMETER, AND WHY IT EXISTS — A FOURTH DECISION, RECORDED LIKE THE OTHER THREE.
 *    `register` defaults to PURPOSE_SUBJECT_TYPE and HAS EXACTLY ONE SUPPLIER IN PRODUCTION: the
 *    default. Nothing in src/ passes it. It exists because STAGE-5-PLAN test (j) requires the
 *    "two purposes that map to DIFFERENT subject types throws at the call" branch to be proved, and
 *    says to prove it "by adding a temporary second entry to the map, never by editing the shipped
 *    one" — which is impossible against an `Object.freeze`d map, and the map must stay frozen.
 *    With one registered purpose that branch is otherwise unreachable until Stage 8's 0203 adds
 *    two more, i.e. it would ship untested for a whole stage.
 *  ★ It is a lookup table for a subject-type STRING, not a permission: the SQL decides what
 *    redeems, and `expectedPurposes` still travels to `p_purposes` unchanged, so a bespoke register
 *    cannot widen what any link token will do.
 */
export function subjectTypeFor(expectedPurposes, register = PURPOSE_SUBJECT_TYPE) {
  if (!Array.isArray(expectedPurposes) || expectedPurposes.length === 0) {
    throw internal(
      "expectedPurposes must be a non-empty array of registered link-token purposes. ★ It is " +
      "REQUIRED rather than defaulted: a caller that asserts no purpose would accept a link minted " +
      "for any other one.");
  }
  const types = new Set();
  for (const p of expectedPurposes) {
    if (!Object.prototype.hasOwnProperty.call(register, p)) {
      throw internal(
        `"${p}" is not a registered link-token purpose. Registered: ` +
        `${Object.keys(register).join(", ")}. ★ The register is 0169's CHECK and the ` +
        `PURPOSE_SUBJECT_TYPE map together — a purpose is added to BOTH, in one migration and one ` +
        `edit, or a link is minted that nothing can name.`);
    }
    types.add(register[p]);
  }
  if (types.size !== 1) {
    throw internal(
      `expectedPurposes ${JSON.stringify(expectedPurposes)} map to ${types.size} different subject ` +
      `types (${[...types].join(", ")}). ★ redeem_link_token returns uuids only, so the JS cannot ` +
      `know WHICH purpose matched — it can only return the type the caller asserted. Asserting two ` +
      `purposes that disagree about the subject is a question with no single answer, and it fails ` +
      `here rather than returning a subjectType that may be wrong.`);
  }
  return [...types][0];
}

/**
 * ★★ THE PEPPER, READ AT CALL TIME AND FATAL IF ABSENT — src/auth/session.mjs:31-40, verbatim in
 *    reasoning. A missing pepper must never silently degrade to an unpeppered HMAC: every link
 *    minted in that window would be verifiable from a database dump alone, and nothing would look
 *    wrong. A present-but-trivially-short pepper is the ABSENCE of a second factor wearing its
 *    clothes, so it is refused by length too.
 */
function pepper() {
  const p = process.env.KEYSTONE_TOKEN_PEPPER;
  if (!p || p.length < 32) {
    throw internal(
      "KEYSTONE_TOKEN_PEPPER is unset or shorter than 32 chars — refusing to mint or verify a link token");
  }
  return p;
}

/** The digest that is stored, and the only form of the secret that ever reaches Postgres. */
export function hashSecret(secret) {
  return createHmac("sha256", pepper()).update(secret, "utf8").digest();
}

function newTokenId() {
  // ★ Rejection-free: 32 is a power of two, so masking 5 bits is uniform over the alphabet.
  const bytes = randomBytes(TOKEN_ID_LEN);
  let out = "";
  for (let i = 0; i < TOKEN_ID_LEN; i++) out += ALPHABET[bytes[i] & 31];
  return out;
}

// ★ The presented shape. The 26-character id and the 43-character secret are both pinned: a shorter
//   secret is not a shorter credential, it is a weaker one, and `{20,}` would accept it silently.
const PRESENTED = /^kl_([0-9A-HJKMNP-TV-Z]{26})_([A-Za-z0-9_-]{43})$/;

/** ★ Returns null rather than throwing — a malformed string is simply not a link, and the caller
 *  turns that into the SAME refusal every other cause produces (decision 2). */
export function parsePresented(raw) {
  const m = PRESENTED.exec(String(raw ?? ""));
  return m ? { tokenId: m[1], secret: m[2] } : null;
}

/**
 * ★★★ THE ONE REFUSAL. Seven causes, one object, one message, one status.
 *     Any difference between these — a second message, a different kind, even a different length of
 *     time spent — is an oracle that tells a stranger which of their guesses was closer.
 */
const LINK_TOKEN_REFUSED =
  "That link is not valid. It may have been used already, expired, or been cancelled — ask for a new one.";

const refuse = () => forbidden(LINK_TOKEN_REFUSED);

/**
 * MINT — the only way a link comes into existence. `tx` is the tenant transaction (decision 1).
 * ★★ THE PRESENTED STRING IS RETURNED ONCE, HERE, AND IS NEVER RETRIEVABLE AGAIN. The row holds a
 *    32-byte HMAC and no part of the secret, and there is no function in the schema and no path in
 *    this module that can return it afterwards — a stronger statement than "the route does not".
 */
export async function mintLinkToken(tx, {
  tenantId, purpose, subjectType, subjectId = null, issuedTo = null, ttlHours,
} = {}) {
  assertTenantTx(tx, "mintLinkToken");
  // ★ tenantId is still taken and still checked — by keystone.mint_link_token, which RAISES unless
  //   it equals current_tenant_id(). Two mechanisms, deliberately (0170 §1): the argument is the
  //   caller SAYING which practice it believes it is in, and the transaction is the truth.
  if (typeof tenantId !== "string" || tenantId === "") {
    throw internal("mintLinkToken: tenantId must be the uuid of the practice the transaction is open on");
  }
  // ★ One asserted purpose at mint time: a row carries exactly one, so `subjectTypeFor` is used
  //   here with a single-member list to get the same register, the same errors, one code path.
  const registeredType = subjectTypeFor([purpose]);
  if (subjectType !== undefined && subjectType !== registeredType) {
    // ★★ THE ROW MUST NOT BE ABLE TO DISAGREE WITH THE MAP. redeem returns the map's answer, so a
    //    row minted with a different subject_type would make that answer a lie about this very row.
    throw internal(
      `mintLinkToken: subjectType "${subjectType}" disagrees with PURPOSE_SUBJECT_TYPE["${purpose}"] ` +
      `= "${registeredType}". redeemLinkToken returns the registered type, so a row minted with a ` +
      `different one would be described incorrectly by every redeem of it.`);
  }
  if (typeof ttlHours !== "number" || !Number.isFinite(ttlHours) || ttlHours <= 0) {
    // ★ A zero or negative ttl mints a link that is born expired — refused at the call, where it is
    //   a visible mistake, rather than becoming a support ticket about a link that never worked.
    throw internal(`mintLinkToken: ttlHours must be a positive number (got ${JSON.stringify(ttlHours)})`);
  }

  const tokenId = newTokenId();
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  // ★ `expires_at` comes back from the SAME statement that computes it, so what is returned to the
  //   caller is what is in the row — this module never reads keystone.link_token itself (CCR-16).
  const { rows } = await tx.query(
    `SELECT keystone.mint_link_token($1,$2,$3,$4,$5,$6,$7, ($8::float8 * interval '1 hour')) AS id,
            now() + ($8::float8 * interval '1 hour') AS expires_at`,
    [tenantId, tokenId, hashSecret(secret), purpose, registeredType, subjectId, issuedTo, ttlHours]);

  return Object.freeze({
    id: rows[0].id,
    presented: `kl_${tokenId}_${secret}`,
    expiresAt: rows[0].expires_at,
  });
}

/**
 * ★★★ THE SPEND. This is the one call in the link-token path that runs with NO tenant context —
 *     because it is the call that PRODUCES the tenant. Single-use, in one SQL statement, so the
 *     find and the spend cannot race.
 * @returns {{tenantId: string, subjectType: string, subjectId: string|null, issuedTo: string|null}}
 * @throws {AppError} forbidden — the same object for every cause (decision 2).
 */
export async function redeemLinkToken(presented, expectedPurposes) {
  // ★ subjectTypeFor FIRST, and it throws `internal`, not the refusal: a route asserting an
  //   unregistered purpose is a bug in the route and must not be reported as a bad link.
  const subjectType = subjectTypeFor(expectedPurposes);
  const parsed = parsePresented(presented);
  if (!parsed) throw refuse();

  const row = await withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT tenant_id, subject_id, issued_to FROM keystone.redeem_link_token($1, $2, $3)`,
      [parsed.tokenId, hashSecret(parsed.secret), expectedPurposes]);
    return rows[0];
  });
  if (!row) throw refuse();

  return Object.freeze({
    tenantId: row.tenant_id,
    // ★ THE PURPOSE THE CALLER ASSERTED, NEVER ONE THE ROW TAUGHT IT (CT-019, Q5-7).
    subjectType,
    subjectId: row.subject_id,
    issuedTo: row.issued_to,
  });
}

/**
 * ★★ PEEK — `redeemLinkToken` WITHOUT THE SPEND (CCR-10). Same arguments, same answer, same
 *    refusal; it sets no `redeemed_at` and changes no row, so Stage 8 can render "you have been
 *    invited to X as Y — accept?" without burning the invitation on page load. The SQL half is
 *    STABLE, so "it cannot write" is a property of the function and not a promise in a comment.
 *  ★★★ CONDITION 1 TRAVELS WITH IT (CONTRACTS §11 CCR-11): peek is an UNAUTHENTICATED EXISTENCE
 *      ORACLE — "does this link exist" becomes answerable without spending anything — so the route
 *      that eventually mounts it MUST be rate-limited on the SAME bucket as redeem. No route mounts
 *      either in Stage 5; this is RECORDED here for Stage 7 and Stage 8 to read, and Stage 5's
 *      obligation is the record, not the enforcement.
 */
export async function peekLinkToken(presented, expectedPurposes) {
  const subjectType = subjectTypeFor(expectedPurposes);
  const parsed = parsePresented(presented);
  if (!parsed) throw refuse();

  const row = await withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT tenant_id, subject_id, issued_to FROM keystone.peek_link_token($1, $2, $3)`,
      [parsed.tokenId, hashSecret(parsed.secret), expectedPurposes]);
    return rows[0];
  });
  if (!row) throw refuse();

  return Object.freeze({
    tenantId: row.tenant_id,
    subjectType,
    subjectId: row.subject_id,
    issuedTo: row.issued_to,
  });
}

/**
 * REVOKE — kill a link that has not been spent, in the practice `tx` is open on (decision 1).
 * ★ Takes the PUBLIC token_id (the 26 characters in the middle of the presented string), which is
 *   the same identifier redeem and peek look up, so the module has one way to name a link. A staff
 *   screen has it; nobody needs the secret to cancel something.
 * ★★ Idempotent by construction: a second call, or a call for a link another practice minted,
 *    matches no row and reports `false` — never an error, and never a pretend success.
 * @returns {{revoked: boolean}}
 */
export async function revokeLinkToken(tx, tokenId, reason = null) {
  assertTenantTx(tx, "revokeLinkToken");
  const { rows } = await tx.query(
    `SELECT keystone.revoke_link_token($1, $2) AS id`, [tokenId, reason]);
  return Object.freeze({ revoked: Boolean(rows[0]?.id) });
}

/**
 * Revoke a link token by its PRIMARY KEY (`link_token.id`), not by the public `token_id`.
 *
 * ★★★ THIS EXISTS BECAUSE A REVOKE WAS SILENTLY DOING NOTHING (25 Sep 2026, B-29).
 *     `booking_waitlist_entry.claim_token_id` (0398) stores `link_token.id` — a uuid — and the
 *     waitlist offer-expiry job passed it straight to `revokeLinkToken` above, which keys on the
 *     PUBLIC `token_id`. A uuid never matches a 26-character token id, so the UPDATE touched no
 *     row, the function returned NULL, and the wrapper reported `{ revoked: false }` **without
 *     raising**. The job logged success and the link stayed live until its own TTL expired —
 *     meaning somebody whose offer had lapsed could still claim the slot.
 *   ★★ The caller CANNOT simply look the public id up instead: `app_rw`'s column-level SELECT on
 *      `link_token` deliberately excludes `token_id` and `secret_hash` (0169:47-50, CCR-16). It
 *      holds the primary key and nothing else, so the primary key is what this takes.
 *   ★ `revokeLinkToken` above is NOT changed: `src/auth/invite.mjs` passes a real `token_id` and
 *     is correct. Two identifiers, two functions — better than one function guessing which it was
 *     handed, which is how this defect read as working code in the first place.
 * ★★ Same idempotence as its sibling: a second call, an already-spent link, or another practice's
 *    token matches no row and reports `false` — never an error, never a pretend success.
 * @returns {{revoked: boolean}}
 */
export async function revokeLinkTokenById(tx, id, reason = null) {
  assertTenantTx(tx, "revokeLinkTokenById");
  const { rows } = await tx.query(
    `SELECT keystone.revoke_link_token_by_id($1, $2) AS id`, [id, reason]);
  return Object.freeze({ revoked: Boolean(rows[0]?.id) });
}
