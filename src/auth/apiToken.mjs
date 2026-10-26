// P19.3 / P19.4 — API TOKENS: THE HASH ONLY, NEVER THE KEY.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE SALT DILEMMA, AND WHY THE OBVIOUS ANSWER IS THE WRONG ONE.
//     "Hash your credentials with bcrypt/argon2" is correct advice about PASSWORDS and wrong here.
//     A per-row salt makes the digest a function of (secret, salt), so **it cannot be an index key**:
//     to find the row you must try every row's KDF, which means every authenticated request becomes
//     O(n) in tokens-in-existence, running a deliberately-expensive function n times. That is
//     disqualifying on performance before any security argument is reached.
//   ★★ THE RESOLUTION IS A PUBLIC LOOKUP ID IN THE PRESENTED STRING:
//        gl_<env>_<token_id>_<secret>
//      Lookup is a unique-index probe on `token_id`; verification is a digest comparison. One row,
//      one hash.
//   ★ HMAC-SHA256 WITH A PEPPER, not a KDF: the secret is 256 CSPRNG bits, not a human password, so
//     a work factor multiplies an already-infeasible search. **The pepper buys something real** — a
//     stolen database dump cannot be used to confirm a guessed token offline, because
//     `KEYSTONE_TOKEN_PEPPER` lives in a different blast radius (the same argument envelope.mjs
//     makes for KEYSTONE_MASTER_KEY).
//   ★ And bcrypt truncates at 72 bytes, silently discarding entropy — a quiet way to weaken a key
//     while appearing to strengthen it.
//
// ★★★ P19.4 — SHOWN ONCE, AT CREATION, NEVER AGAIN. `generate()` is the ONLY place the secret
//     exists, and it is never written anywhere: the database stores the HMAC digest and `last_four`.
//     There is no function in the schema and no path in this module that can return it afterwards.
//     ★ That is a stronger statement than "the route does not return it" — it is not reachable.
//
// ★★ WHAT THIS MODULE DOES NOT DO: it does not open a transaction, decide authorisation, or read the
//    database directly. `app_rw` has NO privilege on keystone_auth.api_token — every touch goes
//    through a SECURITY DEFINER function whose return type is a bare uuid.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { crc32 } from "node:zlib";

/** ★ Crockford base32: no I, L, O or U — so a human reading a key aloud cannot produce a different one. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TOKEN_ID_LENGTH = 26;                 // matches the CHECK on api_token.token_id
const SECRET_BYTES = 32;                    // 256 bits
export const ENVIRONMENTS = Object.freeze(["live", "test"]);
export const CLASSES = Object.freeze(["secret", "publishable"]);

export class TokenError extends Error {
  constructor(message) { super(message); this.name = "TokenError"; this.statusCode = 401; }
}
export class TokenConfigError extends Error {
  constructor(message) { super(message); this.name = "TokenConfigError"; this.statusCode = 500; }
}

/**
 * ★★ THE PEPPER, READ AT CALL TIME AND FATAL IF ABSENT.
 *    Never `process.env.X || 'literal'`: a fallback pepper would make every deployment that forgot to
 *    set it verify tokens against a value an attacker can read in this file. The failure must arrive
 *    at the first verification, loudly, naming the variable.
 *  ★ A pepper that is present but trivially short is also refused — an 8-character pepper is a
 *    rounding error against a 256-bit secret and creates a false sense of a second factor.
 */
export function tokenPepper(env = process.env) {
  const p = env.KEYSTONE_TOKEN_PEPPER;
  if (typeof p !== "string" || p.trim() === "") {
    throw new TokenConfigError(
      "KEYSTONE_TOKEN_PEPPER is not set, so no API token can be created or verified. ★ There is " +
      "deliberately NO fallback: a hardcoded pepper would let anyone with this source confirm a " +
      "guessed token against a stolen database dump, which is the one thing the pepper exists to stop.");
  }
  if (p.trim().length < 32) {
    throw new TokenConfigError(
      `KEYSTONE_TOKEN_PEPPER is only ${p.trim().length} characters. It must be at least 32. ★ A short ` +
      `pepper is not a weak second factor, it is the ABSENCE of one wearing its clothes.`);
  }
  return p.trim();
}

/** ★ 26 Crockford characters from CSPRNG bytes, rejection-sampled so the distribution stays uniform. */
function randomTokenId() {
  let out = "";
  // ★★ REJECTION SAMPLING, NOT `% 32`. A modulo over 256 would be uniform here only because 256 is a
  //    multiple of 32 — true today, and silently false the moment the alphabet changes length. The
  //    loop is correct for any alphabet, so a future edit cannot introduce a quiet bias.
  while (out.length < TOKEN_ID_LENGTH) {
    for (const b of randomBytes(TOKEN_ID_LENGTH)) {
      if (b >= 256 - (256 % CROCKFORD.length) && 256 % CROCKFORD.length !== 0) continue;
      out += CROCKFORD[b % CROCKFORD.length];
      if (out.length === TOKEN_ID_LENGTH) break;
    }
  }
  return out;
}

/** The HMAC digest that is stored. 32 raw bytes — the column CHECKs `octet_length = 32`. */
export function hashSecret(secret, env = process.env) {
  if (typeof secret !== "string" || secret === "") throw new TokenError("no secret to hash");
  return createHmac("sha256", tokenPepper(env)).update(secret, "utf8").digest();
}

const BRANDS = ["gl", "dsk"];
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Six base-62 characters from the CRC-32 of the text (FP-F6). Public by design: it proves a string is shaped like one of our keys, nothing more. */
function checksum6(text) {
  let n = crc32(text) >>> 0, out = "";
  for (let i = 0; i < 6; i++) { out = B62[n % 62] + out; n = Math.floor(n / 62); }
  return out;
}

/**
 * ★★★ GENERATE. THE ONLY MOMENT THE SECRET EXISTS.
 *
 * Returns `presented` (give it to the human exactly once), plus the three things that ARE stored:
 * `tokenId`, `secretHash`, `lastFour`. ★ The caller must not persist `presented` or `secret`
 * anywhere — not in a log line, not in an idempotency record, not in an event payload.
 */
export function generateToken({ environment = "test", brand = "gl" } = {}, env = process.env) {
  if (!ENVIRONMENTS.includes(environment)) {
    throw new TokenError(`environment must be one of ${ENVIRONMENTS.join(", ")}, got "${environment}"`);
  }
  const tokenId = randomTokenId();
  // ★ base64url: safe in a header, a URL and a shell argument without re-encoding — and re-encoding
  //   is how half a secret ends up in a log.
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  if (!BRANDS.includes(brand)) throw new TokenError(`brand must be one of ${BRANDS.join(", ")}`);
  const prefix = `${brand}_${environment}_`;
  // FP-F6 — a Docustay key (dsk_) ends in a six-character checksum of everything before it, so a secret scanner can tell a real key from a look-alike without calling us. The checksum is NOT part of the secret.
  const body = `${prefix}${tokenId}_${secret}`;
  return Object.freeze({
    presented: brand === "dsk" ? `${body}${checksum6(body)}` : body,
    prefix,
    environment,
    tokenId,
    secret,                                        // ★ returned ONCE; never store it
    secretHash: hashSecret(secret, env),
    lastFour: secret.slice(-4),
  });
}

/**
 * ★★ PARSE — AND FAIL THE SAME WAY FOR EVERY MALFORMED SHAPE.
 *    Every rejection here raises the same message. A parser that says "unknown environment" for one
 *    input and "bad token id" for another is an oracle that tells an attacker which half of a guess
 *    was right. ★ The detail goes in `reason`, which is for OUR logs, never for a response body.
 */
export function parseToken(presented) {
  const fail = (reason) => {
    const e = new TokenError("the API token is not valid");
    e.reason = reason;
    throw e;
  };
  if (typeof presented !== "string") fail("not a string");
  const text = presented.trim();
  const m = /^gl_(live|test)_([0-9A-HJKMNP-TV-Z]{26})_([A-Za-z0-9_-]{43})$/.exec(text);
  if (m) return Object.freeze({ environment: m[1], tokenId: m[2], secret: m[3] });
  const d = /^(dsk_(live|test)_([0-9A-HJKMNP-TV-Z]{26})_([A-Za-z0-9_-]{43}))([0-9A-Za-z]{6})$/.exec(text);
  if (!d || checksum6(d[1]) !== d[5]) fail("shape does not match <gl|dsk>_<env>_<26 char token_id>_<43 char secret>[checksum]");
  return Object.freeze({ environment: d[2], tokenId: d[3], secret: d[4] });
}

/**
 * ★★★ RESOLVE THE TENANT FROM A PRESENTED TOKEN — THROUGH THE DEFINER FUNCTION, NEVER A TABLE READ.
 *
 * @param {{query: Function}} client a connection with NO tenant context yet — that is the point:
 *        this call is what discovers the tenant, so it necessarily runs before `withTenant()`.
 * @param {string|null} [scope] the scope the route needs (CT-016 `ROUTE_SCOPES`), or null/undefined for
 *        "no scope required". ★ It travels INTO the database, which answers yes or no — the key's stored
 *        scopes never travel back out.
 * @returns {Promise<{tenantId: string, tokenId: string, environment: "live"|"test", scopes: string[]}|null>}
 *        CT-014's shape on success. ★★★ **NULL — NOT AN OBJECT WITH A NULL tenantId — ON EVERY FAILURE.**
 *        `db/gates/p19_api_token.mjs` asserts `=== null` after a revoke, an expiry and a publishable key
 *        presented as a secret one, and `src/auth/install.mjs` / `src/paths/index.mjs` already read a
 *        falsy result as "no valid API token". The database cannot distinguish "no such token",
 *        "revoked", "expired", "wrong class", "wrong environment", "test key outside a sandbox" or "scope
 *        not held" for the caller, because a caller that can tell those apart can enumerate.
 *        ★ `environment` is the presented string's OWN prefix (Q0-10) — `parseToken` already had it and
 *        this function used to throw it away. `scopes` is the singleton set that was PROVEN (or `[]`
 *        when no scope was required), never a list fetched from the database.
 * @throws {TokenError} a malformed token; {TokenConfigError} no pepper; {TypeError} a scope that is
 *        neither a string nor null — a caller bug, and it must fail closed rather than mean "no scope".
 */
export async function resolveTenantForToken(client, presented, env = process.env, scope = null) {
  if (scope !== null && scope !== undefined && (typeof scope !== "string" || scope === "")) {
    throw new TypeError("resolveTenantForToken: scope must be a non-empty string, or null for no scope");
  }
  const { environment, tokenId, secret } = parseToken(presented);
  const hash = hashSecret(secret, env);
  const requiredScope = scope ?? null;
  const { rows } = await client.query(
    `SELECT keystone.authorize_api_token($1::text, $2::bytea, $3::text, $4::boolean) AS tenant_id`,
    [tokenId, hash, requiredScope, environment === "live"]);
  const tenantId = rows[0]?.tenant_id ?? null;
  if (!tenantId) return null;
  return Object.freeze({
    tenantId,
    tokenId,
    environment,
    scopes: Object.freeze(requiredScope === null ? [] : [requiredScope]),
  });
}

/** The publishable sibling. A SEPARATE function with a SEPARATE grant — never one call with a flag. */
export async function resolveTenantForPublishableKey(client, presented, env = process.env) {
  const { tokenId, secret } = parseToken(presented);
  const hash = hashSecret(secret, env);
  const { rows } = await client.query(
    `SELECT keystone.resolve_publishable_key($1, $2) AS tenant_id`, [tokenId, hash]);
  return rows[0]?.tenant_id ?? null;
}

/**
 * ★ Constant-time comparison, exported because a future caller WILL want to compare two digests and
 *   the obvious `===` leaks timing. Both operands must be 32-byte Buffers; a length mismatch is
 *   answered `false` rather than thrown, because throwing on length is itself a signal.
 */
export function digestsMatch(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * ★★ CREATE — through `keystone.create_api_token`, which takes NO tenant argument.
 *    The tenant comes from `current_tenant_id()` inside the definer function, so a caller cannot mint
 *    a key into another tenant's account even by passing the wrong id: there is no id to pass.
 *  ★ Returns the new row id AND the `presented` string. The presented string is the ONLY copy and
 *    the caller must hand it to the human and forget it.
 *  ★★★ 7.22 (Q7-20, option (a)) — `rankCeiling` IS REQUIRED, NOT DEFAULTED. A key is a non-person
 *    practice principal (7.23) whose effective authority is `scopes ∩ ceiling`; a caller that forgets
 *    to supply it must not be able to mint a key with no ceiling at all — that would be a key with an
 *    unbounded rank, the opposite of the property 7.23 depends on. It THROWS rather than silently
 *    filling in the lowest (or highest) rank, so a forgotten call site fails loudly, at mint time, not
 *    later at request time. ★ The value itself is the minter's OWN authority — see the one call site,
 *    `src/routes/developer.mjs`'s mint handler, which supplies `principal.user.staff_role` (the
 *    `app_user` row the request already loaded inside the tenant transaction, P13.6) — never a token
 *    claim and never a body field. Who supplies "a minter cannot name a ceiling above its own": the
 *    APPLICATION, at that one call site.
 */
export async function createApiToken(tx, {
  environment = "test", tokenClass = "secret", name, scopes, createdBy = null, expiresAt = null,
  rankCeiling, brand = "gl",
} = {}, env = process.env) {
  if (!CLASSES.includes(tokenClass)) throw new TokenError(`class must be one of ${CLASSES.join(", ")}`);
  if (typeof name !== "string" || name.trim() === "") throw new TokenError("a token needs a name");
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new TokenError("a token with no scopes can do nothing — refuse it at creation rather than " +
      "shipping a key that fails on first use");
  }
  // ★ Inline, not a shared export: `keystone.app_user.staff_role`'s own CHECK set (0188, 7.7), not
  //   re-derived from the role model — a key's ceiling is its own vocabulary.
  const RANK_CEILINGS = ["owner", "admin", "member"];   // the current built-in role keys (0751): keystone.role_may matches keystone.role.key
  if (!RANK_CEILINGS.includes(rankCeiling)) {
    throw new TokenError(
      `rankCeiling must be one of ${RANK_CEILINGS.join(", ")}, got ${JSON.stringify(rankCeiling)} — ` +
      "a key minted with no ceiling would carry unbounded rank, which is the exact escalation P0.5 exists to refuse.");
  }
  const t = generateToken({ environment, brand }, env);
  // ★★★ 7.22/7.23 — `rankCeiling` TRAVELS AS `$10`, THE TENTH ARGUMENT, TO 7.23's
  //     `keystone.create_api_token` (migration 0199). This call site is written against that
  //     signature; until 0199 is applied the definer only accepts nine arguments and this call fails
  //     at the database — see this task's dispatch note on the `rank_ceiling` dependency.
  const { rows } = await tx.query(
    `SELECT keystone.create_api_token($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id`,
    [environment, tokenClass, t.tokenId, t.secretHash, t.lastFour, name.trim(), scopes, createdBy, expiresAt,
      rankCeiling]);
  return Object.freeze({ id: rows[0].id, presented: t.presented, lastFour: t.lastFour, tokenId: t.tokenId });
}

/** ★ Revoke. Idempotent by construction — a second call matches no row and returns null. */
export async function revokeApiToken(tx, { id, revokedBy = null } = {}) {
  const { rows } = await tx.query(`SELECT keystone.revoke_api_token($1,$2) AS id`, [id, revokedBy]);
  return rows[0]?.id ?? null;
}

/** ★ List for the management screen. Carries no secret material — see 0046's comment for why. */
export async function listApiTokens(tx) {
  const { rows } = await tx.query(`SELECT * FROM keystone.list_api_tokens()`);
  return rows;
}
