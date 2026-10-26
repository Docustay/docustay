// src/auth/totp.mjs — TASK 8.8: the second factor end to end. CT-057 / spec 04 §4, §5.
// RFC 6238 (TOTP), SHA-1, 6 digits, 30-second step, ±1 step of drift — over the `otpauth` 9.5.2
// library (L9.1). Ten one-time backup codes. F615 RESOLVED.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EVERY READ AND WRITE AGAINST `keystone_auth.totp_factor` / `keystone_auth.backup_code` GOES
//     THROUGH THE FIVE `db/migrations/0220_totp_functions.sql` SECURITY DEFINER FUNCTIONS — NEVER a
//     direct SELECT/INSERT/UPDATE/DELETE. F615: both tables are `deny_all` RLS and `app_rw` holds
//     NO privilege on either (0206/0207's own self-checks). `keystone.get_totp_factor` is the ONE
//     shared reader `confirmEnrolment`, `verifyTotp`, `hasConfirmedFactor` and
//     `countUnusedBackupCodes` all call — `sealSecret`/`openSecret` run only in Node
//     (`src/secrets/envelope.mjs`, over `node:crypto`), so the envelope always has to cross back
//     into this file to be opened; there is no SQL-side decrypt.
//
// ★★★ THE AAD TRAP (CT-061). A TOTP factor has no tenant — `tenantId` passed to `sealSecret` /
//     `openSecret` is the literal constant string `IDENTITY_AAD_TENANT` ('identity'), never a uuid.
//     A mismatch on either side makes the secret permanently unopenable (test (h) pins this).
//
// ★★★ REPLAY DEFENCE (verifyTotp). A code whose time step is <= floor(last_used_at / 30) is refused
//     even when it is arithmetically valid — computed and checked in Node, BEFORE any write.
//     `keystone.record_totp_verified` is called ONLY on a real match; a failed attempt never calls
//     it, so `last_used_at` never advances on a wrong guess.
//
// ★ SQLSTATE-BY-CODE MAPPING (the src/platform/jobActions.mjs:60 BY_SQLSTATE idiom, never a message
//   match): 23505 (a confirmed factor already exists) → conflict, 409; 22023 (a blank/malformed
//   argument) → invalid, 400.
//
// ★ `hasActiveOperatorGrant` (task 8.9, `src/auth/operatorSession.mjs`) is imported with a DYNAMIC
//   import, inside `disableTotp` only — not a top-level import. 8.9's own module calls THIS file's
//   `hasConfirmedFactor`/`verifyTotp` (field 10 of both tasks' plan sections), so a top-level import
//   here would be a circular static import; a dynamic import confines the (expected, plan-documented
//   — STAGE-8-PLAN.md task 8.8 field 5/field 10) forward dependency on 8.9 to the one function that
//   needs it, so every other export in this file stays testable before 8.9 lands.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { randomBytes } from "node:crypto";
import { TOTP, Secret } from "otpauth";
import { withCredentialLookup } from "../db/index.mjs";
import { hashSecret } from "./session.mjs";
import { sealSecret, openSecret, CURRENT_KEK_VERSION } from "../secrets/envelope.mjs";
import { getFirebaseAuth } from "./firebase.mjs";
import { invalid, forbidden, conflict, internal } from "../http/errors.mjs";
import { takeAttempt, clearAttempts, lockedError } from "./attemptLimit.mjs";

// ★★★ CT-061's AAD constant for a factor, which has no tenant. Recorded here so the open side always
//     uses the same one — a mismatch makes the secret permanently unopenable.
const IDENTITY_AAD_TENANT = "identity";
const TOTP_PURPOSE = "totp_secret";

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_DRIFT_STEPS = 1; // ±1 step — the window is [t-1, t, t+1]

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LEN = 10;
// ★ Crockford base32 — no I, L, O or U, the same alphabet src/auth/session.mjs:28 uses for a
//   token_id, so a backup code read aloud or copied by hand cannot become a different valid code.
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ─────────────────────────────────────────────────────────────────────────────
// ★★ THE DATABASE'S REFUSALS, TURNED INTO THE HTTP ANSWER THEY ALREADY MEAN (jobActions.mjs idiom).
// ─────────────────────────────────────────────────────────────────────────────
const BY_SQLSTATE = Object.freeze({
  "23505": conflict, // begin_totp_enrolment: a confirmed factor already exists
  "22023": invalid,  // a blank/malformed argument
});

function plainly(message) {
  return String(message ?? "").replace(/^[a-z_]+:\s*/, "");
}

function asAppError(err) {
  const make = BY_SQLSTATE[err?.code];
  if (!make) return err;
  return make(plainly(err.message));
}

async function q(db, sql, params) {
  try {
    return await db.query(sql, params);
  } catch (err) {
    throw asAppError(err);
  }
}

function assertUid(firebaseUid) {
  if (typeof firebaseUid !== "string" || firebaseUid.trim() === "") {
    throw internal(`totp: firebaseUid must be a non-blank string (got ${JSON.stringify(firebaseUid)})`);
  }
}

function assertCode(code) {
  if (typeof code !== "string" || code.trim() === "") {
    throw invalid("code is required");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// base32 (RFC 4648) — the shared-secret encoding an authenticator app's otpauth:// URI expects.
// ★ Deliberately NOT Crockford (that alphabet is for the backup codes, above, which people type by
//   hand) — the secret is read by a QR scanner, so the standard alphabet every authenticator app
//   assumes is the correct one here.
// ─────────────────────────────────────────────────────────────────────────────
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str ?? "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ─────────────────────────────────────────────────────────────────────────────
// RFC 6238 (TOTP over RFC 4226 HOTP), SHA-1, 6 digits, 30-second step — over the `otpauth` 9.5.2
// library (L9.1), never a hand-rolled HMAC. ★ "The clock is injected" (field 8) — every caller in
// this file accepts an optional `now` (ms epoch, defaulting to Date.now()) so a test can pin the
// window under test exactly.
// ─────────────────────────────────────────────────────────────────────────────
function totpFor(secretBytes) {
  return new TOTP({
    secret: new Secret({ buffer: secretBytes }),
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_STEP_SECONDS,
  });
}

function counterAt(nowMs) {
  return TOTP.counter({ period: TOTP_STEP_SECONDS, timestamp: nowMs });
}

/** True iff `code` is valid for `secretBytes` at exactly `counter` (a single time step — no
 *  window). Used where the caller (confirmEnrolment, verifyTotp) is doing its own step-by-step
 *  walk of the drift window, so the ±1 step allowance stays this file's own, not the library's. */
function codeValidAtCounter(secretBytes, counter, code) {
  const delta = totpFor(secretBytes).validate({ token: code, timestamp: counter * TOTP_STEP_SECONDS * 1000, window: 0 });
  return delta === 0;
}

function randomCrockfordBase32(len) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CROCKFORD_ALPHABET[bytes[i] & 31];
  return out;
}

function buildProvisioningUri({ email, secretBase32, issuer = "Workbench" }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const query = new URLSearchParams();
  query.set("secret", secretBase32);
  query.set("issuer", issuer);
  query.set("algorithm", "SHA1");
  query.set("digits", String(TOTP_DIGITS));
  query.set("period", String(TOTP_STEP_SECONDS));
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** The ONE shared reader (keystone.get_totp_factor) — at most one row per uid, confirmed or not. */
async function getFactorRow(firebaseUid) {
  return withCredentialLookup(async (db) => {
    const { rows } = await q(
      db,
      `SELECT id, secret_envelope, kek_version, confirmed_at, last_used_at, unused_backup_codes
         FROM keystone.get_totp_factor($1)`,
      [firebaseUid]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      secretEnvelope: r.secret_envelope,
      kekVersion: r.kek_version,
      confirmedAt: r.confirmed_at,
      lastUsedAt: r.last_used_at,
      unusedBackupCodes: r.unused_backup_codes,
    };
  });
}

function openFactorSecretBytes(factor) {
  const secretBase32 = openSecret(factor.secretEnvelope, {
    tenantId: IDENTITY_AAD_TENANT,
    purpose: TOTP_PURPOSE,
    kekVersion: factor.kekVersion,
  });
  return base32Decode(secretBase32);
}

/**
 * ★★★ BEGIN (OR RESTART) AN ENROLMENT. Not live until `confirmEnrolment` succeeds.
 * @param {{ firebaseUid: string, email?: string }} args  `email`: the address already on the person's account row. D-041: the built-in identity (sandbox, self-host: uid "local:…") has no Firebase to ask,
 *   so the caller passes the address it already holds; Firebase is asked only when it was not given.
 * @returns {Promise<{ factorId: string, provisioningUri: string }>}
 */
export async function beginEnrolment({ firebaseUid, email = null, issuer = "Workbench" } = {}) {
  assertUid(firebaseUid);

  // ★ Fetch the email BEFORE any write — a lookup failure must leave nothing behind.
  const user = { email: typeof email === "string" && email.trim() ? email.trim() : (await getFirebaseAuth().getUser(firebaseUid)).email };

  const secretBytes = randomBytes(20);
  const secretBase32 = base32Encode(secretBytes);
  const envelope = sealSecret({ plaintext: secretBase32, tenantId: IDENTITY_AAD_TENANT, purpose: TOTP_PURPOSE });

  const factorId = await withCredentialLookup(async (db) => {
    const { rows } = await q(
      db,
      `SELECT keystone.begin_totp_enrolment($1, $2, $3) AS id`,
      [firebaseUid, envelope, CURRENT_KEK_VERSION]
    );
    return rows[0].id;
  });

  // ★★★ THE PLAIN SECRET AND THE PROVISIONING URI ARE RETURNED ONCE, HERE, AND NEVER AGAIN. Not
  //     stored, not logged.
  const provisioningUri = buildProvisioningUri({ email: user.email, secretBase32, issuer });
  return { factorId, provisioningUri };
}

/**
 * ★★★ CONFIRM AN ENROLMENT. The typed code is checked here, in Node, against the envelope
 * `keystone.get_totp_factor` returns — SQL never sees the plain code or the plain secret.
 * @param {{ firebaseUid: string, code: string }} args
 * @param {{ now?: number }} [opts] ★ clock injection for tests.
 * @returns {Promise<{ backupCodes: string[] }>}
 */
export async function confirmEnrolment({ firebaseUid, code } = {}, { now = Date.now() } = {}) {
  assertUid(firebaseUid);
  assertCode(code);

  const factor = await getFactorRow(firebaseUid);
  if (!factor || factor.confirmedAt) {
    throw forbidden("That code was not accepted.");
  }

  const secretBytes = openFactorSecretBytes(factor);
  const currentCounter = counterAt(now);
  let matched = false;
  for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) {
    if (codeValidAtCounter(secretBytes, currentCounter + d, code)) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    throw forbidden("That code was not accepted.");
  }

  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => randomCrockfordBase32(BACKUP_CODE_LEN));
  const hashes = backupCodes.map((c) => hashSecret(c));

  await withCredentialLookup(async (db) => {
    await q(
      db,
      `SELECT keystone.confirm_totp_enrolment($1, $2, $3::bytea[])`,
      [firebaseUid, factor.id, hashes]
    );
  });

  // ★★★ THE TEN PLAIN CODES ARE RETURNED ONCE, IN THIS RESPONSE, AND EXIST NOWHERE ELSE.
  return { backupCodes };
}

/**
 * ★★★ THE SIGN-IN CHALLENGE. A confirmed TOTP factor's window first, then a fall-through to a
 * backup code. One message for every failure.
 * @param {{ firebaseUid: string, code: string }} args
 * @param {{ now?: number }} [opts] ★ clock injection for tests.
 * @returns {Promise<{ ok: true, usedBackupCode: boolean }>}
 */
export async function verifyTotp({ firebaseUid, code } = {}, { now = Date.now() } = {}) {
  assertUid(firebaseUid);
  assertCode(code);

  // ★★★ S-3 (security audit run 5, 10 Oct 2026): A PER-ACCOUNT ATTEMPT COUNTER, BEFORE ANYTHING IS CHECKED. Six digits and three accepted steps is a few
  //     chances in a million per guess; the per-IP limiter in front of the route does not follow the ACCOUNT across addresses or partial sessions. Counted
  //     and decided in one SQL statement (migration 0700) so parallel guesses cannot buy free ones; locked for 15 minutes after the budget; a success clears it.
  const lockedFor = await takeAttempt("two_step", firebaseUid);
  if (lockedFor > 0) throw lockedError(lockedFor, "Too many tries. Try again in a few minutes.");

  const factor = await getFactorRow(firebaseUid);
  if (factor && factor.confirmedAt) {
    const secretBytes = openFactorSecretBytes(factor);
    const currentCounter = counterAt(now);
    // ★★★ REPLAY DEFENCE — computed and checked BEFORE any write. A step at or before the one
    //     already recorded is refused even when it is arithmetically valid.
    const lastUsedCounter = factor.lastUsedAt ? counterAt(new Date(factor.lastUsedAt).getTime()) : -Infinity;

    for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) {
      const counter = currentCounter + d;
      if (counter <= lastUsedCounter) continue;
      if (codeValidAtCounter(secretBytes, counter, code)) {
        await withCredentialLookup(async (db) => {
          await q(db, `SELECT keystone.record_totp_verified($1, $2)`, [firebaseUid, factor.id]);
        });
        await clearAttempts("two_step", firebaseUid);
        return { ok: true, usedBackupCode: false };
      }
    }
  }

  // ─── fall through to a backup code ──────────────────────────────────────────
  // 0766: a recovery code is its own set per person (so a passkey-only person has them too); the old authenticator backup codes are still honoured by the same function
  const hash = hashSecret(String(code).toUpperCase().replace(/[\s-]/g, ""));
  const usedBackupCode = await withCredentialLookup(async (db) => {
    const { rows } = await q(db, `SELECT keystone.spend_recovery_code($1, $2) AS ok`, [firebaseUid, hash]);
    return rows[0].ok === true;
  });
  if (usedBackupCode) {
    await clearAttempts("two_step", firebaseUid);
    return { ok: true, usedBackupCode: true };
  }

  throw forbidden("That code was not accepted.");
}

/** What Platform checks (spec 04 §4, §8a). */
export async function hasConfirmedFactor(firebaseUid) {
  assertUid(firebaseUid);
  const factor = await getFactorRow(firebaseUid);
  return Boolean(factor?.confirmedAt);
}

/** What the account screen shows. */
export async function countUnusedBackupCodes(firebaseUid) {
  assertUid(firebaseUid);
  const factor = await getFactorRow(firebaseUid);
  return factor?.confirmedAt ? factor.unusedBackupCodes : 0;
}

/** F637 — one read, both facts the "On" panel needs together (not two separate getFactorRow
 *  calls for what is really one question). */
export async function getTwoStepStatus(firebaseUid) {
  assertUid(firebaseUid);
  const factor = await getFactorRow(firebaseUid);
  const enabled = Boolean(factor?.confirmedAt);
  return {
    enabled,
    since: enabled ? factor.confirmedAt : null,
    unusedBackupCodes: enabled ? factor.unusedBackupCodes : 0,
  };
}

/**
 * ★★★ TURN IT OFF. Requires a currently valid code (TOTP or backup) in the SAME call — re-verifies
 * via this module's own `verifyTotp` before ever calling `keystone.disable_totp_factor`. Refused
 * outright for an identity holding an active operator grant (spec 04 §4).
 * @param {{ firebaseUid: string, code: string }} args
 * @param {{ now?: number }} [opts] ★ clock injection for tests.
 * @returns {Promise<{ disabled: true }>}
 */
export async function disableTotp({ firebaseUid, code } = {}, { now = Date.now() } = {}) {
  assertUid(firebaseUid);

  // ★ Dynamic import — see this file's header note. Confines the forward dependency on task 8.9
  //   (src/auth/operatorSession.mjs) to this one function.
  const { hasActiveOperatorGrant } = await import("./operatorSession.mjs");
  const grant = await hasActiveOperatorGrant(firebaseUid);
  if (grant?.active) {
    throw forbidden("Two-step cannot be turned off while you hold the operator grant.");
  }

  // ★ Re-check gate — neither the code check nor the operator-grant check happens inside
  //   keystone.disable_totp_factor itself (0220's own COMMENT ON FUNCTION says so). Throws
  //   `forbidden`/`invalid` on its own if the code is missing or wrong; the factor is left alone.
  await verifyTotp({ firebaseUid, code }, { now });

  const disabled = await withCredentialLookup(async (db) => {
    const { rows } = await q(db, `SELECT keystone.disable_totp_factor($1) AS ok`, [firebaseUid]);
    return rows[0].ok === true;
  });
  if (!disabled) {
    // ★ Defensive only — verifyTotp above already proved a confirmed factor exists for this uid.
    throw forbidden("That code was not accepted.");
  }
  return { disabled: true };
}

/**
 * 0766: remove the authenticator-app factor WITHOUT asking for a code here. The caller has already proved the person's current second step (a code, a recovery code or a passkey),
 * which is why this is a separate function from `disableTotp`; the operator-grant refusal is the same.
 */
export async function removeTotpFactor({ firebaseUid } = {}) {
  assertUid(firebaseUid);
  const { hasActiveOperatorGrant } = await import("./operatorSession.mjs");
  const grant = await hasActiveOperatorGrant(firebaseUid);
  if (grant?.active) throw forbidden("Two-step cannot be turned off while you hold the operator grant.");
  return withCredentialLookup(async (db) => (await q(db, `SELECT keystone.disable_totp_factor($1) AS ok`, [firebaseUid])).rows[0].ok === true);
}

/** 0766: a person who already holds recovery codes adds an app: the ten codes that confirming it created are retired, so the person keeps the one set they saved. */
export async function retireBackupCodes({ firebaseUid } = {}) {
  assertUid(firebaseUid);
  return withCredentialLookup(async (db) => (await q(db, `SELECT keystone.retire_backup_codes($1) AS n`, [firebaseUid])).rows[0].n);
}
