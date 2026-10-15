// Part 29 step 3 (A6) — self-hosted Docustay: the Pro licence check and the anonymous usage ping.
// Plain words: a self-hosted install asks docustay.app "is this licence key good?" and gets back a short signed note (an ENTITLEMENT) saying "Pro until <date>". The note is signed with a private key only we hold; the install ships the
// matching public key, so it can check the note itself and keeps working for up to 30 days if our server is unreachable. This is a commercial-honour mechanism, not copy protection: anyone can edit open-source code.
import { createHash, randomBytes, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";
import { invalid, unauthenticated } from "../http/errors.mjs";

const OFFLINE_DAYS = 30;
const DAY = 86_400_000;
const hashKey = (key) => createHash("sha256").update(String(key)).digest("hex");
const b64u = (buf) => Buffer.from(buf).toString("base64url");

/** A fresh licence: returns the plaintext key ONCE (never stored). */
export async function issueLicense(tx, { tenantId, subscriptionId = null, expiresAt, note = null }) {
  if (!(expiresAt instanceof Date) || Number.isNaN(+expiresAt)) throw invalid("expiresAt must be a date");
  const key = `dsl_${randomBytes(24).toString("base64url").slice(0, 32)}`;
  await tx.query(`INSERT INTO keystone.docustay_license (key_hash, tenant_id, subscription_id, expires_at, note) VALUES ($1,$2,$3,$4,$5)`, [hashKey(key), tenantId, subscriptionId, expiresAt, note]);
  return { key, expiresAt };
}

const signingKey = () => {
  const pem = process.env.KEYSTONE_DOCUSTAY_LICENSE_SIGNING_KEY;
  if (!pem) return null;
  return createPrivateKey(pem.includes("BEGIN") ? pem : Buffer.from(pem, "base64").toString("utf8"));
};

/** Sign a note: { v, plan, installId, issuedAt, expiresAt }. The note ends at the earlier of the licence's own end and OFFLINE_DAYS from now. */
function signEntitlement({ installId, licenseExpiresAt, now = Date.now() }) {
  const key = signingKey();
  if (!key) return null;
  const note = { v: 1, plan: "pro", installId, issuedAt: new Date(now).toISOString(), expiresAt: new Date(Math.min(+licenseExpiresAt, now + OFFLINE_DAYS * DAY)).toISOString() };
  const payload = b64u(JSON.stringify(note));
  return { entitlement: payload, signature: b64u(edSign(null, Buffer.from(payload), key)), expiresAt: note.expiresAt };
}

/** What a self-hosted install runs against the note it holds: the signature is ours, it is for this install, and it has not run out. */
export function verifyEntitlement({ entitlement, signature }, publicPem, { installId, now = Date.now() } = {}) {
  try {
    if (!edVerify(null, Buffer.from(entitlement), createPublicKey(publicPem), Buffer.from(signature, "base64url"))) return { ok: false, reason: "bad_signature" };
    const note = JSON.parse(Buffer.from(entitlement, "base64url").toString("utf8"));
    if (installId && note.installId !== installId) return { ok: false, reason: "other_install" };
    if (Date.parse(note.expiresAt) <= now) return { ok: false, reason: "expired" };
    return { ok: true, note };
  } catch { return { ok: false, reason: "unreadable" }; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /license: a key + this install's own id → a signed note, or the same plain refusal for every bad key (so the route cannot be used to find out which keys exist). */
export async function checkLicense(tx, { tenantId, key, installId, now = Date.now() }) {
  if (typeof key !== "string" || key.length < 16 || key.length > 80) throw unauthenticated("that licence key is not valid");
  if (typeof installId !== "string" || !UUID.test(installId)) throw invalid("installId must be the install's own id");
  const { rows: [lic] } = await tx.query(`SELECT key_hash, install_id, expires_at, revoked_at FROM keystone.docustay_license WHERE tenant_id = $1 AND key_hash = $2 FOR UPDATE`, [tenantId, hashKey(key)]);
  if (!lic || lic.revoked_at || +new Date(lic.expires_at) <= now) throw unauthenticated("that licence key is not valid");
  if (lic.install_id && lic.install_id !== installId) throw unauthenticated("that licence key is not valid");   // one key, one install (moving it is a support step)
  await tx.query(`UPDATE keystone.docustay_license SET install_id = $3, last_seen_at = now() WHERE tenant_id = $1 AND key_hash = $2`, [tenantId, lic.key_hash, installId]);
  const out = signEntitlement({ installId, licenseExpiresAt: lic.expires_at, now });
  if (!out) throw Object.assign(new Error("the licence signing key is not configured on this server"), { status: 503 });
  return out;
}

const COUNT_KEYS = ["documentsSentThisMonth", "documentsSigned", "workspaces", "users", "uptimeDays"];
/** POST /ping: counts only. Anything but the five known whole numbers and a short version string is dropped, so a ping cannot carry a name, an email or a document. */
export async function recordPing(tx, { tenantId, installId, version, counts }) {
  if (typeof installId !== "string" || !UUID.test(installId)) throw invalid("installId must be the install's own id");
  const clean = {};
  for (const k of COUNT_KEYS) { const v = counts?.[k]; if (Number.isSafeInteger(v) && v >= 0 && v < 1e9) clean[k] = v; }
  const ver = typeof version === "string" && /^[0-9A-Za-z.+-]{1,32}$/.test(version) ? version : null;
  await tx.query(
    `INSERT INTO keystone.docustay_install (install_id, tenant_id, version, counts) VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (tenant_id, install_id) DO UPDATE SET last_seen_at = now(), version = EXCLUDED.version, counts = EXCLUDED.counts, pings = keystone.docustay_install.pings + 1`,
    [installId, tenantId, ver, JSON.stringify(clean)]);
  return { ok: true };
}
