// src/developer/connectorSeal.mjs — stateless sealed values for the hosted connector (OAuth): the client id (made at registration) and the one-time code (made when a person says Allow).
// AES-256-GCM under a key derived from the install's own pepper, so nothing is stored and nothing in the browser URL can be read or altered. Every sealed value carries its own expiry.
import { createCipheriv, createDecipheriv, createHash, randomBytes, createHmac } from "node:crypto";

const key = () => { const v = process.env.KEYSTONE_TOKEN_PEPPER; if (!v) throw new Error("KEYSTONE_TOKEN_PEPPER is not set"); return createHash("sha256").update(`connector-seal:${v}`).digest(); };

export function seal(kind, obj, ttlSeconds, now = Date.now()) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  c.setAAD(Buffer.from(kind));
  const body = Buffer.concat([c.update(JSON.stringify({ ...obj, exp: Math.floor(now / 1000) + ttlSeconds }), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}
/** → the object, or null for anything forged, altered, expired or of another kind. */
export function open(kind, text, now = Date.now()) {
  try {
    const raw = Buffer.from(String(text), "base64url"); if (raw.length < 30) return null;
    const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12)); d.setAAD(Buffer.from(kind)); d.setAuthTag(raw.subarray(12, 28));
    const o = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
    return o.exp >= Math.floor(now / 1000) ? o : null;
  } catch { return null; }
}
/** PKCE S256: base64url(sha256(verifier)) */
export const pkceChallenge = (verifier) => createHash("sha256").update(String(verifier)).digest("base64url");
export const newId = () => randomBytes(12).toString("base64url");
void createHmac;
