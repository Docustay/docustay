// src/auth/localIdentity.mjs — A BUILT-IN EMAIL + PASSWORD IDENTITY for deployments with no Firebase project (the Docustay self-host package; the sandbox). Batch B.
// OFF by default: it needs KEYSTONE_LOCAL_AUTH=1 AND a KEYSTONE_LOCAL_AUTH_SECRET of 32+ characters, so a production deployment (Firebase) can never mint or accept a local token.
// It plugs in at ONE place: `verifyIdToken` (src/auth/firebase.mjs) also accepts a token this module issued, and everything downstream (signup, login, sessions) is unchanged.
//   password → scrypt (random salt, constant-time compare, a dummy compare for an unknown email so timing does not say whether an address exists)
//   token    → "ks-local.<payload>.<hmac>" · payload {uid,email,email_verified,iat,exp (10 minutes)} · HMAC-SHA256 with the secret
// TRUST: a local identity's email is not proven (there is no mailbox check here). That is right for a self-hoster creating their own owner account and for the sandbox, and it is why this is never
// switched on where strangers sign up with other people's addresses — hosted production uses Firebase, whose email verification this does not replace.
import { randomBytes, scryptSync, timingSafeEqual, createHmac, randomUUID, createHash } from "node:crypto";
import { withCredentialLookup } from "../db/index.mjs";
import { unauthenticated, invalid } from "../http/errors.mjs";

const N = 16384, R = 8, P = 1, KEYLEN = 32, TTL_S = 600;
const secret = (env = process.env) => (typeof env.KEYSTONE_LOCAL_AUTH_SECRET === "string" && env.KEYSTONE_LOCAL_AUTH_SECRET.length >= 32 ? env.KEYSTONE_LOCAL_AUTH_SECRET : null);
export const localAuthEnabled = (env = process.env) => env.KEYSTONE_LOCAL_AUTH === "1" && secret(env) !== null;
/** the maintainer, 8 Oct 2026: production sign-up works as it is (Firebase), so the emailed-code step (F922) is OFF unless this is switched on; the sandbox turns it on. */
export const signupEmailCodeRequired = (env = process.env) => env.KEYSTONE_SIGNUP_EMAIL_CODE === "1";
export const isLocalToken = (t) => typeof t === "string" && t.startsWith("ks-local.");

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${scryptSync(password, salt, KEYLEN, { N, r: R, p: P }).toString("base64")}`;
}
export function checkPassword(password, stored) {
  const [alg, n, r, p, salt, hash] = String(stored ?? "").split("$");
  if (alg !== "scrypt" || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = scryptSync(password, Buffer.from(salt, "base64"), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}
const DUMMY = hashPassword("not-a-real-password");

const b64 = (b) => Buffer.from(b).toString("base64url");
const sign = (payload, env) => createHmac("sha256", secret(env)).update(payload).digest("base64url");
export function issueToken({ uid, email, verified = true }, { env = process.env, now = Date.now() } = {}) {
  const payload = b64(JSON.stringify({ uid, email, email_verified: verified === true, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + TTL_S }));
  return `ks-local.${payload}.${sign(payload, env)}`;
}
/** → {uid, sub, email, email_verified} or throws unauthenticated. Same shape the Firebase verifier returns for the fields the platform reads. */
export function verifyLocalToken(token, { env = process.env, now = Date.now() } = {}) {
  if (!localAuthEnabled(env)) throw unauthenticated("invalid credential");
  const [, payload, mac] = String(token).split(".");
  const want = Buffer.from(sign(payload ?? "", env)), got = Buffer.from(mac ?? "");
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw unauthenticated("invalid credential");
  let d; try { d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw unauthenticated("invalid credential"); }
  if (!d?.uid || !String(d.uid).startsWith("local:") || !(d.exp > Math.floor(now / 1000))) throw unauthenticated("invalid credential");
  return { uid: d.uid, sub: d.uid, email: d.email, email_verified: d.email_verified === true };
}

const looksLikeEmail = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
/** Create an identity. → {idToken}. Refuses a weak password and an address that already has one (without saying more than that). */
export async function signUpLocal({ email, password }) {
  if (!looksLikeEmail(email)) throw invalid("Enter a valid email address.", { field: "email" });
  if (typeof password !== "string" || password.length < 8) throw invalid("Choose a password of at least 8 characters.", { field: "password" });
  const uid = `local:${randomUUID()}`;
  const ok = await withCredentialLookup(async (db) => (await db.query(`SELECT keystone.local_credential_create($1,$2,$3,$4) AS ok`, [uid, email, hashPassword(password), !signupEmailCodeRequired()])).rows[0].ok);
  if (!ok) throw invalid("That email already has an account. Sign in instead.", { field: "email" });
  // ★ NOT verified: like a Firebase user who has just signed up, the address is unproven until the emailed code is entered (POST /api/signup/verify/verify). /api/signup refuses an unverified identity.
  return { idToken: issueToken({ uid, email: email.toLowerCase(), verified: !signupEmailCodeRequired() }) };
}
/** Launch (13 Oct 2026): the sign-up page asks for an email and a code only. The identity is created here without a password the person knows (a random one nobody sees), UNPROVEN until the emailed
 *  code is entered; an address that already has an identity is left exactly as it is (the code then signs that person in). → true when one was created. */
export async function ensureLocalIdentity(email) {
  if (!looksLikeEmail(email)) throw invalid("Enter a valid email address.", { field: "email" });
  const uid = `local:${randomUUID()}`;
  return withCredentialLookup(async (db) => (await db.query(`SELECT keystone.local_credential_create($1,$2,$3,$4) AS ok`, [uid, email, hashPassword(randomBytes(32).toString("base64url")), false])).rows[0].ok === true);
}
/** The identity admin the emailed-code flow needs, for the built-in identity: look an address up (Firebase's getUserByEmail shape) and mint a VERIFIED token once the code has been redeemed. */
export async function localUserByEmail(email) {
  const row = looksLikeEmail(email) ? await withCredentialLookup(async (db) => (await db.query(`SELECT * FROM keystone.local_credential_get($1)`, [email])).rows[0] ?? null) : null;
  if (!row) { const e = new Error("no such user"); e.code = "auth/user-not-found"; throw e; }
  return { uid: row.uid };
}
export const verifiedLocalToken = ({ uid, email }) => issueToken({ uid, email: String(email).toLowerCase(), verified: true });
/** Prove an identity. → {idToken}; one generic refusal for every failure. */
export async function signInLocal({ email, password }) {
  const row = looksLikeEmail(email) && typeof password === "string"
    ? await withCredentialLookup(async (db) => (await db.query(`SELECT * FROM keystone.local_credential_get($1)`, [email])).rows[0] ?? null) : null;
  const ok = checkPassword(typeof password === "string" ? password : "", row?.password_hash ?? DUMMY) && row !== null;
  if (!ok) throw unauthenticated("That email and password combination was not accepted.");
  // the token says the address is proven only if it IS (the emailed sign-up code or reset link): a login made with someone else's address, never proven, must not be able to sign in its way past the proof (0705)
  return { idToken: issueToken({ uid: row.uid, email: String(email).toLowerCase(), verified: row.verified === true }) };
}
/** The emailed sign-up code was entered: the address is proven (0705). */
export async function markLocalVerified(email) {
  if (!looksLikeEmail(email)) return false;
  return withCredentialLookup(async (db) => (await db.query(`SELECT keystone.local_credential_mark_verified($1) AS ok`, [email])).rows[0].ok);
}

// ── password reset for the built-in identity (D-006) ──
const RESET_TTL_S = 3600;
const sha = (t) => createHash("sha256").update(String(t)).digest("hex");
/** → a one-time token string when the address has an identity, null when it has none (the caller answers the same either way). Only the token's SHA-256 is stored. */
export async function issueLocalReset({ email }) {
  if (!looksLikeEmail(email)) return null;
  const token = randomBytes(32).toString("base64url");
  const ok = await withCredentialLookup(async (db) => (await db.query(`SELECT keystone.local_credential_reset_issue($1,$2,$3) AS ok`, [email, sha(token), RESET_TTL_S])).rows[0].ok);
  return ok ? token : null;
}
/** Spend a reset token and set the new password. One generic refusal for unknown, used and expired tokens. */
export async function redeemLocalReset({ token, password }) {
  if (typeof password !== "string" || password.length < 8) throw invalid("Choose a password of at least 8 characters.", { field: "password" });
  if (typeof token !== "string" || token.length < 20) throw invalid("That link has expired or was already used. Ask for a new one.");
  const ok = await withCredentialLookup(async (db) => (await db.query(`SELECT keystone.local_credential_reset_redeem($1,$2) AS ok`, [sha(token), hashPassword(password)])).rows[0].ok);
  if (!ok) throw invalid("That link has expired or was already used. Ask for a new one.");
  return { ok: true };
}
