// src/auth/oidc.mjs — FP-E7/H5: sign in with the organisation's own OpenID Connect provider (Keycloak, Authentik, Entra…). SELF-HOST ONLY: it needs the built-in identity (KEYSTONE_LOCAL_AUTH) and is off unless
// DOCUSTAY_OIDC_ISSUER, _CLIENT_ID and _CLIENT_SECRET are all set. Authorization-code flow with PKCE, state and nonce; the id token is verified by openid-client (signature, issuer, audience, nonce, expiry).
// The provider must say email_verified = true. The person must ALREADY have an identity in this install (they signed up or accepted an invitation): SSO is another way in, never a way to create someone.
// Two-step sign-in rules are unchanged: the id token this returns goes through the same login route as a password does.
import { createHmac, timingSafeEqual } from "node:crypto";
import * as client from "openid-client";
import { withCredentialLookup } from "../db/index.mjs";
import { localAuthEnabled, issueToken } from "./localIdentity.mjs";
import { unauthenticated } from "../http/errors.mjs";

export const oidcEnabled = () => localAuthEnabled() && !!(process.env.DOCUSTAY_OIDC_ISSUER && process.env.DOCUSTAY_OIDC_CLIENT_ID && process.env.DOCUSTAY_OIDC_CLIENT_SECRET);
export const oidcLabel = () => (process.env.DOCUSTAY_OIDC_LABEL || "your identity provider").slice(0, 60);
const COOKIE = "docustay_oidc", TTL_S = 600;
const key = () => process.env.KEYSTONE_LOCAL_AUTH_SECRET;
const sign = (p) => createHmac("sha256", key()).update(p).digest("base64url");
export const sealState = (o) => { const p = Buffer.from(JSON.stringify({ ...o, exp: Math.floor(Date.now() / 1000) + TTL_S })).toString("base64url"); return `${p}.${sign(p)}`; };
export function openState(v) {
  const [p, s] = String(v ?? "").split("."); if (!p || !s) return null;
  const a = Buffer.from(sign(p)), b = Buffer.from(s); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.exp > Date.now() / 1000 ? o : null; } catch { return null; }
}
export const stateCookie = (v, secure) => `${COOKIE}=${v}; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=${TTL_S}${secure ? "; Secure" : ""}`;
export const clearStateCookie = () => `${COOKIE}=; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=0`;
export const readStateCookie = (header) => openState(String(header ?? "").split(/;\s*/).map((x) => x.split("=")).find(([k]) => k === COOKIE)?.[1]);

let cached = null;
async function configuration() {
  if (cached && cached.at > Date.now() - 3600_000) return cached.c;
  const allowHttp = /^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)/.test(process.env.DOCUSTAY_OIDC_ISSUER);
  const c = await client.discovery(new URL(process.env.DOCUSTAY_OIDC_ISSUER), process.env.DOCUSTAY_OIDC_CLIENT_ID, process.env.DOCUSTAY_OIDC_CLIENT_SECRET, undefined, allowHttp ? { execute: [client.allowInsecureRequests] } : undefined);
  cached = { c, at: Date.now() }; return c;
}
const callbackUrl = (publicUrl) => `${publicUrl.replace(/\/+$/, "")}/api/auth/oidc/callback`;

/** → { url, state } : where to send the browser, and what to remember in the cookie. */
export async function beginOidc({ publicUrl }) {
  const c = await configuration();
  const verifier = client.randomPKCECodeVerifier(), state = client.randomState(), nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(c, { redirect_uri: callbackUrl(publicUrl), scope: process.env.DOCUSTAY_OIDC_SCOPES || "openid email profile", code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state, nonce });
  return { url: url.href, sealed: sealState({ verifier, state, nonce }) };
}
/** → { idToken } for the person's existing identity. One generic refusal for every failure. */
export async function finishOidc({ publicUrl, currentUrl, sealed }) {
  const fail = () => unauthenticated("That sign-in could not be completed.");
  if (!sealed) { console.warn("oidc: refused, the sign-in started in another browser or took too long (no saved state)"); throw fail(); }
  let claims;
  try {
    const c = await configuration();
    const tokens = await client.authorizationCodeGrant(c, new URL(currentUrl), { pkceCodeVerifier: sealed.verifier, expectedState: sealed.state, expectedNonce: sealed.nonce });
    claims = tokens.claims();
    // Many providers (Entra, Okta, node-oidc-provider) keep email in the userinfo answer, not the ID token. Ask for it, and trust it only for the same subject.
    if (!claims.email || claims.email_verified === undefined) { const ui = await client.fetchUserInfo(c, tokens.access_token, claims.sub); claims = { ...claims, ...(ui.sub === claims.sub ? { email: claims.email ?? ui.email, email_verified: claims.email_verified ?? ui.email_verified } : {}) }; }
  } catch (e) { console.warn(`oidc: the provider's answer was refused (${e?.name}: ${String(e?.message).slice(0, 160)})`); throw fail(); }
  const email = String(claims?.email ?? "").toLowerCase();
  if (!email || claims.email_verified !== true) { console.warn(`oidc: refused, ${email ? "the provider does not vouch for the email" : "no email in the token"}`); throw fail(); }
  const row = await withCredentialLookup(async (db) => (await db.query(`SELECT * FROM keystone.local_credential_get($1)`, [email])).rows[0] ?? null);
  if (!row) { console.warn("oidc: refused, no account here has that email"); throw fail(); }
  return { idToken: issueToken({ uid: row.uid, email }) };
}
