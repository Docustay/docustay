// src/auth/twoStep.mjs — the pieces of two-step sign-in that are not the authenticator-app code itself (migration 0766).
// A person's second steps: an authenticator app (src/auth/totp.mjs), passkeys and security keys (src/auth/passkeys.mjs), and recovery codes. This module holds what they share:
//   · what a person has, in ONE database read (`summary`) — so sign-in and the Security page never make a connection per question;
//   · recovery codes (a set per PERSON, only hashes stored; the old authenticator backup codes are still honoured and counted);
//   · remembered devices: a random token in an HttpOnly cookie, only its hash stored; it skips the SECOND step for the same person for 30 days and is deleted on every two-step change;
//   · the short list of recent security activity.
// Every database call is one short `withCredentialLookup` (a pooled connection held for a single statement): nothing here holds a connection while the person types a code or waits for a device.
import { randomBytes, createHash } from "node:crypto";
import { withCredentialLookup } from "../db/index.mjs";
import { hashSecret } from "./session.mjs";
import { passkeysEnabled } from "./passkeys.mjs";

export const TRUST_COOKIE = "ds_td";
export const TRUST_DAYS = 30;
export const RECOVERY_COUNT = 10;
const RECOVERY_LEN = 10;
// the same alphabet the old backup codes use (Crockford: no I, L, O, U), so a code read aloud or copied by hand cannot become a different valid code
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const one = async (sql, params) => withCredentialLookup(async (db) => (await db.query(sql, params)).rows[0] ?? null);
const many = async (sql, params) => withCredentialLookup(async (db) => (await db.query(sql, params)).rows);

/** Everything the sign-in and the Security page need to know about one person's second steps, in one read. */
export async function summary(uid) {
  const r = await one(`SELECT * FROM keystone.two_step_summary($1)`, [uid]);
  const keys = passkeysEnabled() ? (r?.passkeys ?? 0) + (r?.security_keys ?? 0) : 0;
  const totp = r?.totp_confirmed_at ?? null;
  return {
    on: Boolean(totp) || keys > 0,
    authenticatorApp: Boolean(totp), authenticatorSince: totp ? new Date(totp).toISOString() : null,
    passkeys: passkeysEnabled() ? (r?.passkeys ?? 0) : 0, securityKeys: passkeysEnabled() ? (r?.security_keys ?? 0) : 0,
    recoveryLeft: r?.recovery_left ?? 0, remembered: r?.remembered ?? 0,
  };
}
/** True when sign-in must ask this person for a second step. */
export async function hasSecondFactor(uid) { return (await summary(uid)).on; }

// ── recovery codes ─────────────────────────────────────────────────────────────────────────────────
const randomCode = () => { const b = randomBytes(RECOVERY_LEN); let out = ""; for (let i = 0; i < RECOVERY_LEN; i++) out += ALPHABET[b[i] & 31]; return out; };
/** Ten new recovery codes (the unused old ones stop working). The plain codes are returned ONCE, here; only their hashes are stored. */
export async function newRecoveryCodes(uid) {
  const codes = Array.from({ length: RECOVERY_COUNT }, randomCode);
  await one(`SELECT keystone.replace_recovery_codes($1, $2::bytea[]) AS n`, [uid, codes.map((c) => hashSecret(c))]);
  return codes;
}
/** A code as a person types it: upper case, spaces and dashes ignored. */
export const normaliseCode = (s) => String(s ?? "").toUpperCase().replace(/[\s-]/g, "");
export async function spendRecoveryCode(uid, code) {
  const r = await one(`SELECT keystone.spend_recovery_code($1, $2) AS ok`, [uid, hashSecret(normaliseCode(code))]);
  return r?.ok === true;
}

// ── remembered devices ─────────────────────────────────────────────────────────────────────────────
const sha = (t) => createHash("sha256").update(String(t)).digest();
/** → { token, expires }. The token goes in the cookie; only its SHA-256 is stored. */
export async function rememberDevice(uid, label = "This device") {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + TRUST_DAYS * 86400_000);
  await one(`SELECT keystone.add_trusted_device($1, $2, $3, $4) AS id`, [uid, sha(token), label, expires]);
  return { token, expires };
}
export async function isTrustedDevice(uid, token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return false;
  const r = await one(`SELECT keystone.check_trusted_device($1, $2) AS ok`, [uid, sha(token)]);
  return r?.ok === true;
}
/** Forget every remembered device of a person (the default) or one of them. */
export async function forgetDevices(uid, id = null) { const r = await one(`SELECT keystone.revoke_trusted_devices($1, $2) AS n`, [uid, id]); return r?.n ?? 0; }
export async function listDevices(uid) {
  return (await many(`SELECT id, label, created_at, last_used_at, expires_at FROM keystone.list_trusted_devices($1)`, [uid]))
    .map((d) => ({ id: d.id, label: d.label, createdAt: new Date(d.created_at).toISOString(), lastUsedAt: d.last_used_at ? new Date(d.last_used_at).toISOString() : null, expiresAt: new Date(d.expires_at).toISOString() }));
}
/** The Set-Cookie value for the remembered-device cookie (HttpOnly, SameSite=Lax; Secure on https). */
export function trustCookie(token, expires, { secure = true } = {}) {
  return `${TRUST_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`;
}
export const clearTrustCookie = ({ secure = true } = {}) => `${TRUST_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
/** The remembered-device token from a Cookie header, or null. */
export function trustTokenFrom(cookieHeader) {
  for (const part of String(cookieHeader ?? "").split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === TRUST_COOKIE) return part.slice(i + 1).trim() || null; }
  return null;
}

// ── recent security activity ───────────────────────────────────────────────────────────────────────
/** Never throws: a failure to note an event must not undo what just happened. */
export async function recordEvent(uid, kind, detail = {}) {
  try { await one(`SELECT keystone.record_security_event($1, $2, $3::jsonb)`, [uid, kind, JSON.stringify(detail ?? {})]); } catch { /* the activity list is best effort */ }
}
export async function listEvents(uid, limit = 20) {
  return (await many(`SELECT id, kind, detail, at FROM keystone.list_security_events($1, $2)`, [uid, limit])).map((e) => ({ id: e.id, kind: e.kind, detail: e.detail ?? {}, at: new Date(e.at).toISOString() }));
}

/** Remove every second step of a person (turning it off, or an owner resetting a teammate). → true when there was one. */
export async function clearAll(uid) { const r = await one(`SELECT keystone.clear_second_factors($1) AS had`, [uid]); return r?.had === true; }
/** Which of these people have any second step. → Set of uids. */
export async function secondFactorUids(uids) {
  if (!uids?.length) return new Set();
  return new Set((await many(`SELECT firebase_uid FROM keystone.second_factor_uids($1::text[])`, [uids])).map((r) => r.firebase_uid));
}
