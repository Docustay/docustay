// src/auth/emailCode.mjs — TASK 8.7: request a 6-digit sign-in code, verify it, exchange it for a
// session. CT-056 / spec 04 §5.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THREE FUNCTIONS, ONE SEQUENCE. `requestEmailCode` issues a code and mails it (or pretends
//     to). `verifyEmailCode` redeems it and mints a Firebase custom token — nothing more. The
//     browser exchanges that token for an ID token at Google's own REST endpoint
//     (identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken), the same surface
//     `webui/src/routes/login/+page.svelte:95` already uses, and posts the ID token to
//     `signInWithCode`, which is a THIN PASS-THROUGH TO `login()` (src/auth/login.mjs:49) — the one
//     login path, spec 04 §11. No second session-minting path exists in this file: a `createSession`
//     call here, rather than a call to `login`, is the defect.
//
// ★★ WHY THE MODULE OWNS THE OUTCOME→WORD MAPPING. `keystone.redeem_email_code` (0204) returns a
//    smallint by design (db/gates/catalog-conformance.mjs's credential-resolver rule refuses text,
//    bytea, json, jsonb, varchar, char or name on a credential resolver's result — "nothing but
//    identifiers can travel back"). CCR-10 fixes the mapping: 0 ok · 1 no_code · 2 expired ·
//    3 too_many · 4 wrong. This file is the ONE place that number becomes a message; nothing else
//    in the codebase may repeat it.
//    ★ `test/e8_2_email_code_table.test.mjs` (task 8.2) already exports its OWN copy of this
//      mapping (`EMAIL_CODE_OUTCOME`) with a comment inviting this module to import it. That file is
//      an executable test script — it opens a real admin connection and calls `process.exit()` at
//      its own end — so importing it from production code (or from this file's own test) would run
//      the ENTIRE 8.2 suite, including `process.exit`, as a side effect of the import. That is not
//      safe here. `EMAIL_CODE_OUTCOME` is therefore declared here instead, as the one production
//      copy, and `test/e8_7_email_code.test.mjs` imports IT (not the 8.2 test file). Filed as a
//      finding (grep FINDINGS.md for "8.7" / "EMAIL_CODE_OUTCOME") rather than silently deviating.
//
// ★★ THE ENUMERATION DEFENCE, TWICE. `requestEmailCode` always returns `{ sent: true, expiresAt }`,
//    for a registered address and an unregistered one alike — an unregistered address gets a
//    synthetic `expiresAt` of the SAME shape (now + the same 10-minute TTL) and no email, rather
//    than a response that differs in any observable way. And `verifyEmailCode` collapses FOUR
//    distinct database outcomes (no_code, expired, too_many, and an unresolvable address) into the
//    SAME "expired" message as `wrong` gets its own — two messages, not five, so a caller cannot
//    learn how many tries remain, or whether the address exists at all, from the wording alone.
//
// ★ THE BUDGET IS SPENT BEFORE THE ADDRESS IS RESOLVED, deliberately, so probing an address list is
//   itself rate-limited (spec 04 §5: 5 requests / 15 minutes, per email AND per IP, both scopes
//   taken on every request, in that order).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { randomInt } from "node:crypto";
import { withCredentialLookup } from "../db/index.mjs";
import { hashSecret } from "./session.mjs";
import { getFirebaseAuth } from "./firebase.mjs";
import { localAuthEnabled, localUserByEmail, verifiedLocalToken, markLocalVerified } from "./localIdentity.mjs";
// the identity the codes are tied to: Firebase in hosted production, the built-in identity where that is on (the sandbox) — one code path either way
const identityAdmin = () => (localAuthEnabled() ? { getUserByEmail: localUserByEmail, updateUser: async () => {}, createCustomToken: null } : getFirebaseAuth());
import { login } from "./login.mjs";
import { sendAuthEmail } from "../email/authEmail.mjs";
import { invalid, forbidden, dependency, rateLimited, internal } from "../http/errors.mjs";
import { takeAttempt, clearAttempts, lockedError } from "./attemptLimit.mjs";

// ★★★ CCR-10 — THE FIXED MAPPING. `db/migrations/0204_email_code.sql:29-30` states it as the
//     contract; `test/e8_2_email_code_table.test.mjs` proves the SQL produces exactly these values.
//     This is the one production copy — see the header note above for why it is not imported from
//     that test file.
export const EMAIL_CODE_OUTCOME = Object.freeze({
  OK: 0, NO_CODE: 1, EXPIRED: 2, TOO_MANY: 3, WRONG: 4,
});

// ★ Must match 0204_email_code.sql's CHECK on `purpose` exactly — a caller reaching for a fourth
//   value is a programming error, not a user mistake, so it is refused with `internal`, the same way
//   src/auth/session.mjs:134 refuses an unregistered revoke reason.
const EMAIL_CODE_PURPOSES = Object.freeze(new Set(["verify_email", "sign_in", "recover"]));
function assertPurpose(purpose) {
  if (!EMAIL_CODE_PURPOSES.has(purpose)) {
    throw internal(
      `emailCode: purpose must be one of ${[...EMAIL_CODE_PURPOSES].join(", ")}, got ${JSON.stringify(purpose)}`);
  }
}

function normalizedEmailOf(email) {
  if (typeof email !== "string" || email.trim() === "") {
    throw invalid("email is required");
  }
  return email.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// spec 04 §5 — 5 requests / 15 minutes, per email and per IP.
// ─────────────────────────────────────────────────────────────────────────────
const REQUEST_LIMIT = 5;
const REQUEST_WINDOW_SQL = "15 minutes";
const REQUEST_WINDOW_MS = 15 * 60 * 1000;

// spec 04 §5 — the code itself lives 10 minutes.
const CODE_TTL_SQL = "10 minutes";
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MINUTES = 10;

/** Seconds remaining in the FIXED bucket `keystone.take_code_request` (0205) is keyed on — the
 *  same `floor(epoch / window) * window` boundary computed in JS so CT-004's `Retry-After` names a
 *  plausible wait without a second round trip to read the row back. */
function secondsUntilWindowEnd(windowMs, now = Date.now()) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
}

/** One scope's budget. Throws CT-001 `kind: "rate_limited"`, 429, with `detail.retryAfterSeconds`
 *  and (via `err.retryAfterSeconds`, the same mechanism src/http/rateLimit.mjs's own
 *  `withRetryAfter` uses) the `Retry-After` header, written once at src/http/app.mjs:521-522. */
export async function takeCodeRequestBudget(scope, key) {
  const allowed = await withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT keystone.take_code_request($1, $2, $3, $4::interval) AS allowed`,
      [scope, key, REQUEST_LIMIT, REQUEST_WINDOW_SQL]);
    return rows[0].allowed;
  });
  if (!allowed) {
    const retryAfterSeconds = secondsUntilWindowEnd(REQUEST_WINDOW_MS);
    const err = rateLimited("Too many code requests. Try again later.", { retryAfterSeconds });
    err.retryAfterSeconds = retryAfterSeconds;
    throw err;
  }
}

/**
 * ★★★ ISSUE A CODE. Always resolves to `{ sent: true, expiresAt }` — for a registered address AND
 *     an unregistered one. Never tells the caller "no such account"; this route is unauthenticated.
 * @param {{ email: string, purpose?: string, ip?: string|null }} args
 * @param {{ fetchImpl?: Function, env?: object }} [opts] ★ Forwarded to `sendAuthEmail` UNCHANGED —
 *   this is that sender's OWN test seam (test/e8_10_auth_email.test.mjs), not a second one. This
 *   module still calls `sendAuthEmail` by name; nothing here reimplements or wraps it.
 * @returns {Promise<{ sent: true, expiresAt: Date }>}
 */
export async function requestEmailCode({ email, purpose = "sign_in", ip, product = null, lang = null, decorate = null } = {}, { fetchImpl, env } = {}) {
  assertPurpose(purpose);
  const normalizedEmail = normalizedEmailOf(email);

  // ★★★ BUDGET FIRST — BOTH SCOPES, IN THIS ORDER, ON EVERY REQUEST, including one for an address
  //     that turns out not to exist. Otherwise probing an address list is free.
  await takeCodeRequestBudget("email", normalizedEmail);
  await takeCodeRequestBudget("ip", ip);
  // ★★★ S-10 (security audit run 5, 10 Oct 2026): BACK-OFF PER ADDRESS ON TOP OF THE 5-PER-15-MINUTES BUCKET. The bucket alone allowed 480 mails a day to one
  //     person (and a fresh code, with a fresh guess budget, every time). After 10 requests the wait between them grows 15 min, 30 min, 1 h ... up to 6 h
  //     (migration 0700). Counted for EVERY address, registered or not, so it tells a prober nothing.
  const waitFor = await takeAttempt("email_request", normalizedEmail);
  if (waitFor > 0) throw lockedError(waitFor, "Too many code requests. Try again later.");

  let uid;
  try {
    const user = await identityAdmin().getUserByEmail(normalizedEmail);
    uid = user.uid;
  } catch (err) {
    if (err?.code === "auth/user-not-found") {
      // ★★★ THE ENUMERATION DEFENCE. Same shape, no email sent, budget already spent above.
      return { sent: true, expiresAt: new Date(Date.now() + CODE_TTL_MS) };
    }
    throw err;
  }

  // ★ 6 digits from a CSPRNG, never Math.random. Zero-padded so every value is exactly 6 characters.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // ★★★ THE PLAIN CODE EXISTS IN EXACTLY THIS ONE VARIABLE. Never logged, never returned to the
  //     caller, never stored (only its HMAC crosses into the database), never put in an error.
  const hash = hashSecret(code);

  const expiresAt = await withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT expires_at FROM keystone.issue_email_code($1, $2, $3, $4::interval)`,
      [uid, purpose, hash, CODE_TTL_SQL]);
    return rows[0].expires_at;
  });

  // 21 Oct 2026: a caller may dress the mail (the password reset code adds a link for another device and its own template); the code and its limits are this function's, unchanged
  const extra = decorate ? await decorate({ email: normalizedEmail, uid }) : null;
  await sendAuthEmail({
    to: normalizedEmail,
    templateKey: extra?.templateKey ?? "auth.email_code",
    vars: { code, minutes: CODE_TTL_MINUTES, ...(extra?.vars ?? {}) },
    product, lang, variant: purpose === "verify_email" ? "verify" : null,
  }, { fetchImpl, env });

  return { sent: true, expiresAt };
}

// ★ CCR-10 — two messages, not four: the screen needs to know whether to keep the field open
//   ('wrong' — try again) or not ('expired'/'too_many'/'no_code' — ask for a new code). A fourth
//   distinct message per cause would report how many tries remain to an attacker.
const WRONG_CODE_MESSAGE = "That code was not accepted.";
const EXPIRED_CODE_MESSAGE = "That code has expired — ask for a new one.";

/**
 * ★★★ REDEEM A CODE, MINT A CUSTOM TOKEN. Nothing else — no session, no cookie. Q8-2: a
 *     misconfigured deployment (no KEYSTONE_FIREBASE_SERVICE_ACCOUNT_JSON) makes
 *     `createCustomToken` throw; that becomes CT-001 `kind: "dependency"`, 502, `retryable: true` —
 *     never a session minted by another route.
 * @param {{ email: string, code: string, purpose?: string }} args
 * @returns {Promise<{ customToken: string }>}
 */
/** Redeem a code (single use, with the same per-code and per-account guess limits) and say whose it was. No token, no session: the caller decides what the proof is for (21 Oct 2026: the password reset). */
export async function redeemEmailCode({ email, code, purpose = "sign_in" } = {}) {
  assertPurpose(purpose);
  const normalizedEmail = normalizedEmailOf(email);
  if (typeof code !== "string" || code.trim() === "") {
    throw invalid("code is required");
  }

  let uid;
  try {
    const user = await identityAdmin().getUserByEmail(normalizedEmail);
    uid = user.uid;
  } catch (err) {
    if (err?.code === "auth/user-not-found") {
      // ★ Same refusal as NO_CODE below — an unresolvable address must not be distinguishable from
      //   an address with no live code. Never "no such account".
      throw forbidden(EXPIRED_CODE_MESSAGE);
    }
    throw err;
  }

  // ★★★ S-10 (security audit run 5): THE WRONG-GUESS BUDGET FOLLOWS THE ACCOUNT, NOT THE CODE. The 5 tries per code (0204) reset every time a new code is
  //     requested; this counts every try for this identity across all codes (10, then one per 15 minutes; migration 0700), taken BEFORE the code is
  //     checked in one SQL statement. A locked identity gets the SAME answer as an address with no live code, so the lock tells a prober nothing.
  const lockedFor = await takeAttempt("email_code", uid);
  if (lockedFor > 0) throw forbidden(EXPIRED_CODE_MESSAGE);

  const hash = hashSecret(code);
  const outcome = await withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT outcome FROM keystone.redeem_email_code($1, $2, $3)`,
      [uid, purpose, hash]);
    return rows[0].outcome;
  });

  if (outcome === EMAIL_CODE_OUTCOME.WRONG) throw forbidden(WRONG_CODE_MESSAGE);
  if (outcome === EMAIL_CODE_OUTCOME.EXPIRED ||
      outcome === EMAIL_CODE_OUTCOME.TOO_MANY ||
      outcome === EMAIL_CODE_OUTCOME.NO_CODE) {
    throw forbidden(EXPIRED_CODE_MESSAGE);
  }
  if (outcome !== EMAIL_CODE_OUTCOME.OK) {
    // ★ A fifth value would mean the SQL contract (CCR-10) drifted from this file's own mapping —
    //   fail loud rather than silently treat an unrecognised number as success.
    throw internal(`keystone.redeem_email_code returned an unrecognised outcome: ${outcome}`);
  }

  await clearAttempts("email_code", uid);
  return { uid, email: normalizedEmail };
}

/** ★★★ REDEEM A CODE, MINT A CUSTOM TOKEN (see above). */
export async function verifyEmailCode({ email, code, purpose = "sign_in" } = {}) {
  const { uid, email: normalizedEmail } = await redeemEmailCode({ email, code, purpose });


  // ★★★ 12-signup-first-run-people.md §6 — GATED ON `purpose === "verify_email"`. The code has
  //     just been redeemed, so this uid's address is now proven; the sign-in path
  //     (`purpose: "sign_in"`) never reaches this branch and its behaviour is unchanged. Same
  //     `dependency()` envelope as `createCustomToken` below — 502, `retryable:true`, never a raw
  //     provider error.
  if (purpose === "verify_email") {
    try {
      await identityAdmin().updateUser(uid, { emailVerified: true });
    } catch (err) {
      throw dependency("Sign-up is not available right now.", err);
    }
  }

  // the built-in identity has no custom tokens: the proven address gets a verified token of its own, only for the sign-up proof
  if (localAuthEnabled()) {
    if (purpose !== "verify_email") throw forbidden(EXPIRED_CODE_MESSAGE);
    await markLocalVerified(normalizedEmail);   // from now on a password sign-in carries the proof too (0705)
    return { idToken: verifiedLocalToken({ uid, email: normalizedEmail }) };
  }
  let customToken;
  try {
    customToken = await getFirebaseAuth().createCustomToken(uid);
  } catch (err) {
    throw dependency("Sign-in by code is not available right now.", err);
  }
  return { customToken };
}

/**
 * ★★★ THE ONLY WAY THIS FEATURE PRODUCES A SESSION — a thin pass-through to `login()`
 *     (src/auth/login.mjs:49), spec 04 §11's "one login path". `email` and `code` are accepted for
 *     the caller's shape (verification already happened, in `verifyEmailCode`, before the browser's
 *     round trip to Google) but are not consulted here.
 * @param {{ idToken: string, tenantSlug?: string|null, email?: string, code?: string }} args
 * @returns {Promise<*>} whatever `login()` returns.
 */
export async function signInWithCode({ idToken, tenantSlug = null } = {}) {
  return login(idToken, { tenantSlug });
}
