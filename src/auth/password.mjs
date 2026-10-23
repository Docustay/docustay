// src/auth/password.mjs — EVERYTHING ABOUT A PERSON'S PASSWORD, in one place (21 Oct 2026, the maintainer): change it while signed in, set one when you only ever used emailed codes, and forget it (reset by a six-digit code).
//
// ONE RULE: at least 8 characters, at most 200 (MIN_PASSWORD). Why 8: it is the minimum NIST SP 800-63B gives for a password a person chooses, the built-in identity already demanded 8, and the old "6" was only
//   Firebase's default floor. Length matters more than symbols, so there are no character-class rules; the check is the same on every route and on every screen (the web reads it from /api/auth/config's sibling
//   constant in lib/auth.js). 200 stops a megabyte "password" from costing a hash.
//
// NO NEW STORAGE AND NO NEW TABLE. The reset code is the existing emailed-code system (emailCode.mjs) with its own purpose, "recover", so its limits apply unchanged: 5 requests per 15 minutes per address and
// per IP, then back-off; 5 guesses per code and 10 per account (then one per 15 minutes); a code works once and lives 10 minutes. A correct code buys a GRANT: a second single-use value stored the same way
// (so it expires in 10 minutes and is spent when the new password is set). The code is never in a URL and never in a log.
//
// A RESET NEVER SIGNS ANYONE IN. After a reset (or a change) the person signs in the normal way, so two-step sign-in is still asked for; every other session is revoked and every remembered device is forgotten.
import { randomBytes } from "node:crypto";
import { withCredentialLookup, withTenant } from "../db/index.mjs";
import { getFirebaseAuth } from "./firebase.mjs";
import { localAuthEnabled, signInLocal, issueLocalReset, redeemLocalReset } from "./localIdentity.mjs";
import { requestEmailCode, redeemEmailCode } from "./emailCode.mjs";
import { hashSecret, revokeSessionsForUid, revokeSessionsForUser } from "./session.mjs";
import * as ts from "./twoStep.mjs";
import { sendAuthEmail } from "../email/authEmail.mjs";
import { invalid, forbidden, dependency, internal } from "../http/errors.mjs";
import { callOutside } from "../http/outside.mjs";
import { takeAttempt, clearAttempts, lockedError } from "./attemptLimit.mjs";

export const MIN_PASSWORD = 8, MAX_PASSWORD = 200;
export const PASSWORD_WORDS = `Choose a password of at least ${MIN_PASSWORD} characters.`;
/** The one rule. Throws `invalid` with the same sentence everywhere. */
export function assertPassword(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) throw invalid(PASSWORD_WORDS, { field: "password" });
  if (pw.length > MAX_PASSWORD) throw invalid(`Use a password of at most ${MAX_PASSWORD} characters.`, { field: "password" });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const when = () => new Date().toUTCString();
const baseUrl = (product, env = process.env) => ((product === "docustay" ? env.KEYSTONE_DOCUSTAY_APP_URL : env.KEYSTONE_APP_URL) || env.KEYSTONE_PUBLIC_URL || "").replace(/\/+$/, "");
const GRANT_TTL = "10 minutes";
const WEB_KEY = () => process.env.KEYSTONE_FIREBASE_WEB_API_KEY;

// ── forgot password: the code ────────────────────────────────────────────────────────────────────────────────────────────────
/** Email a six-digit code (and, for another device, the old link). ALWAYS the same answer, for an address with an account and one without. */
export async function requestPasswordRecovery({ email, ip = null, product = null, lang = null }, deps = {}) {
  const to = String(email ?? "").trim().toLowerCase();
  const answer = { sent: true };
  if (!EMAIL.test(to) || to.length > 254) return answer;
  const base = baseUrl(product, deps.env);
  if (!/^https?:\/\//i.test(base)) throw internal("KEYSTONE_DOCUSTAY_APP_URL (or KEYSTONE_PUBLIC_URL) is not set, so no reset email is sent");
  await (deps.requestCode ?? requestEmailCode)({
    email: to, purpose: "recover", ip, product, lang,
    // the fallback link, made only for an address that has an account (the code mail carries it)
    decorate: async ({ email: addr }) => {
      let oob = null;
      if (localAuthEnabled(deps.env)) oob = await issueLocalReset({ email: addr });
      else { try { oob = new URL(await (deps.auth ?? getFirebaseAuth()).generatePasswordResetLink(addr)).searchParams.get("oobCode"); } catch { oob = null; } }
      return { templateKey: "auth.password_reset_code", vars: { link: oob ? `${base}/reset?oobCode=${encodeURIComponent(oob)}` : `${base}/login` } };
    },
  }, deps.mail ?? {});
  return answer;
}

/** The typed code, redeemed. → { grant } good for 10 minutes and one use. The same refusals as a sign-in code ("not accepted" for a wrong one, "expired" for the rest). */
export async function verifyRecoveryCode({ email, code }) {
  const { uid } = await redeemEmailCode({ email, code: String(code ?? "").replace(/\s+/g, ""), purpose: "recover" });
  const grant = randomBytes(32).toString("base64url");
  await withCredentialLookup(async (db) => { await db.query(`SELECT expires_at FROM keystone.issue_email_code($1, $2, $3, $4::interval)`, [uid, "recover", hashSecret(grant), GRANT_TTL]); });
  return { grant, expiresInSeconds: 600 };
}

// ── setting the password ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function writePassword({ uid, email, password }) {
  assertPassword(password);
  if (localAuthEnabled()) {
    const token = await issueLocalReset({ email });
    if (!token) throw invalid("That could not be changed. Ask for a new code.");
    await redeemLocalReset({ token, password });
    return;
  }
  try { await getFirebaseAuth().updateUser(uid, { password }); await getFirebaseAuth().revokeRefreshTokens(uid); }
  catch (err) { throw dependency("Your password could not be changed right now. Try again in a moment.", err); }
}

/** What follows every password change: other sessions end (or all of them), remembered devices are forgotten, it is noted, and the person is emailed. Two-step is untouched, so it is still asked at the next sign-in. */
export async function afterPasswordChange({ uid, email, how, signOut = "all", tenantId = null, appUserId = null, exceptTokenId = null, product = "docustay" }) {
  let signedOut = false;
  try {
    if (signOut === "all") { await revokeSessionsForUid(uid, "password_changed"); signedOut = true; }
    else if (signOut === "others" && tenantId && appUserId) { await withTenant(tenantId, (db) => revokeSessionsForUser(db, tenantId, appUserId, "password_changed", { exceptTokenId })); signedOut = true; }
  } catch (err) { console.error(`password change: could not end the other sessions: ${err?.message ?? err}`); }
  await ts.forgetDevices(uid).catch(() => 0);
  await ts.recordEvent(uid, "password_changed", { how, signedOutOthers: signedOut });
  const link = `${baseUrl(product)}/forgot`;
  await sendAuthEmail({ to: email, templateKey: "auth.password_changed", vars: { when: when(), signedOut: signedOut ? "yes" : "no", link }, product }).catch(() => null);
  return { signedOut };
}

/** A forgotten password, finished: the grant from the code, and the new password. Signs nobody in. */
export async function resetWithGrant({ email, grant, password, product = "docustay" }) {
  assertPassword(password);
  if (typeof grant !== "string" || grant.length < 20) throw forbidden("That code has expired. Ask for a new one.");
  const { uid, email: addr } = await redeemEmailCode({ email, code: grant, purpose: "recover" });
  await writePassword({ uid, email: addr, password });
  await afterPasswordChange({ uid, email: addr, how: "reset_by_code", signOut: "all", product });
  return { changed: true };
}

/** The old emailed link, now finished on the server too (so it also signs the other devices out and emails the person). Firebase: the server spends the one-time code at Google's own endpoint. */
export async function resetWithLink({ oobCode, password, product = "docustay" }, { fetchImpl = globalThis.fetch } = {}) {
  assertPassword(password);
  if (typeof oobCode !== "string" || oobCode.length < 10) throw invalid("That link has expired or was already used. Ask for a new one.");
  if (localAuthEnabled()) { await redeemLocalReset({ token: oobCode, password }); return { changed: true }; }
  const key = WEB_KEY(); if (!key) throw internal("Sign-in is not configured on this deployment");
  const r = await callOutside("identity-reset", `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ oobCode, newPassword: password }) }, { fetchImpl });
  const j = parseJson(r.body);
  if (r.status == null) throw dependency("Your password could not be changed right now. Try again in a moment.");
  if (!r.ok) throw invalid(/WEAK_PASSWORD/.test(j?.error?.message ?? "") ? PASSWORD_WORDS : "That link has expired or was already used. Ask for a new one.");
  const addr = String(j?.email ?? "").toLowerCase();
  if (addr) { try { const u = await getFirebaseAuth().getUserByEmail(addr); await afterPasswordChange({ uid: u.uid, email: addr, how: "reset_by_link", signOut: "all", product }); } catch (err) { console.error(`reset by link: follow-up failed: ${err?.message ?? err}`); } }
  return { changed: true };
}

// ── a signed-in person ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Does this identity have a password it can be proven with? Firebase says; the built-in identity cannot (a code-only sign-up gets a random one), so → null ("unknown"). */
export async function hasPassword(self) {
  if (localAuthEnabled()) return null;
  try { return (await getFirebaseAuth().getUser(self.firebaseUid)).providerData.some((p) => p.providerId === "password"); } catch { return null; }
}

const parseJson = (b) => { if (b && typeof b === "object") return b; try { return JSON.parse(String(b ?? "")); } catch { return null; } };
async function currentPasswordIsRight({ email, password }, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof password !== "string" || password === "") return false;
  if (localAuthEnabled()) { try { await signInLocal({ email, password }); return true; } catch { return false; } }
  const key = WEB_KEY(); if (!key) throw internal("Sign-in is not configured on this deployment");
  const r = await callOutside("identity-signin", `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: false }) }, { fetchImpl });
  if (r.status == null) throw dependency("Your password could not be checked right now. Try again in a moment.");
  if (r.ok) return true;
  const code = String(parseJson(r.body)?.error?.message ?? "");
  if (/TOO_MANY_ATTEMPTS/.test(code)) throw lockedError(900, "Too many tries. Try again in a few minutes.");
  return false;
}

/**
 * Change (or set) the password of the person signed in. `self` is loadSelf's answer. Two ways to show it is them: the current password, or `grant` (the emailed code, for a person with no password yet or who forgot it).
 * Two-step, when on, is proven by the caller BEFORE this (requireProof), because a stolen session alone must not be able to take the account.
 */
export async function changePassword({ self, currentPassword = null, grant = null, newPassword, signOutOthers = true }) {
  assertPassword(newPassword);
  if (grant) {
    const { uid, email } = await redeemEmailCode({ email: self.email, code: String(grant), purpose: "recover" });
    if (uid !== self.firebaseUid) throw forbidden("That code was not accepted.");
    await writePassword({ uid, email, password: newPassword });
  } else {
    const wait = await takeAttempt("email_code", `pw:${self.firebaseUid}`);   // wrong current-password guesses are counted per person (their own bucket, so they never lock the second step)
    if (wait > 0) throw lockedError(wait, "Too many tries. Try again in a few minutes.");
    if (!(await currentPasswordIsRight({ email: self.email, password: currentPassword }))) throw forbidden("That is not your current password.");
    if (currentPassword === newPassword) throw invalid("Choose a password that is different from the current one.", { field: "password" });
    await clearAttempts("email_code", `pw:${self.firebaseUid}`);
    await writePassword({ uid: self.firebaseUid, email: self.email, password: newPassword });
  }
  const done = await afterPasswordChange({ uid: self.firebaseUid, email: self.email, how: grant ? "set_by_code" : "changed", signOut: signOutOthers ? "others" : "none", tenantId: self.tenantId, appUserId: self.appUserId, exceptTokenId: self.tokenId, product: self.product ?? "docustay" });
  return { changed: true, signedOutOthers: done.signedOut };
}
