// src/mail/mailbox.mjs — SENDING FROM THE ORGANISATION'S OWN MAILBOX. Google (Gmail API) and Microsoft (Graph), connected by the ordinary OAuth 2.0 authorization-code flow with PKCE.
// What lives where: the address, provider and health are a row in keystone.mail_mailbox; the REFRESH TOKEN is a sealed envelope in mail_secret ('mailbox_refresh_token'), never returned to anyone. An access token is asked for at each
// send and thrown away. Nothing here reaches the host except through ports.mjs (the OAuth client credentials come from `oauthClient`).
//   scopes are the least that work: Google `gmail.send` (send only; no reading), Microsoft `Mail.Send` (+ `User.Read` for the address, `offline_access` for the refresh token).
//   a mailbox that stops working (the person revoked access, the password changed, the admin removed the app) is marked needs_reconnect, the send reports it, and the screen says so — it is never quietly replaced by the platform address.
import { createHmac, createHash, randomBytes } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { ports } from "./ports.mjs";
import { invalid, dependency, conflict } from "../http/errors.mjs";

const MAILBOX_SECRET = "mailbox_refresh_token";
// the host's closed list of secret purposes already names these two refresh-token kinds; the envelope is bound to the organisation and the purpose
const SEAL_PURPOSE = Object.freeze({ google: "google_refresh_token", microsoft: "mailbox_microsoft" });
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export const PROVIDERS = Object.freeze({
  google: { label: "Google", scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
    auth: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", api: "https://gmail.googleapis.com" },
  microsoft: { label: "Microsoft", scopes: ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Send"],
    auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", api: "https://graph.microsoft.com" },
});
/** The provider's addresses, overridable for the sandbox and for tests (KEYSTONE_MAIL_<PROVIDER>_AUTH_URL / _TOKEN_URL / _API_URL). */
export function endpoints(provider, env = process.env) {
  const p = PROVIDERS[provider]; if (!p) throw invalid("Choose Google or Microsoft", { field: "provider" });
  const k = provider.toUpperCase();
  return { ...p, auth: env[`KEYSTONE_MAIL_${k}_AUTH_URL`] || p.auth, token: env[`KEYSTONE_MAIL_${k}_TOKEN_URL`] || p.token, api: (env[`KEYSTONE_MAIL_${k}_API_URL`] || p.api).replace(/\/+$/, "") };
}

const pepper = () => { const p = process.env.KEYSTONE_TOKEN_PEPPER; if (!p) throw new Error("mailbox: KEYSTONE_TOKEN_PEPPER is not set"); return p; };
const b64 = (b) => Buffer.from(b).toString("base64url");
const mac = (s) => createHmac("sha256", pepper()).update(s, "utf8").digest("base64url");

/** The signed `state` of one connect attempt: who started it, for which organisation and provider, and a nonce the PKCE verifier is derived from (so the verifier is never stored and never in a URL). */
export function signState({ tenantId, userId = null, provider, now = Date.now() }) {
  const payload = b64(JSON.stringify({ t: tenantId, u: userId, p: provider, n: randomBytes(16).toString("base64url"), iat: now }));
  return `${payload}.${mac(payload)}`;
}
export function verifyState(state, { now = Date.now(), maxAgeMs = STATE_MAX_AGE_MS } = {}) {
  const BAD = "That connection link has expired or was not started from Email settings. Start again from there.";
  if (typeof state !== "string" || !state.includes(".")) throw invalid(BAD);
  const [payload, sig] = state.split(".");
  const want = mac(payload);
  if (!sig || sig.length !== want.length || !createHash("sha256").update(sig).digest().equals(createHash("sha256").update(want).digest())) throw invalid(BAD);
  let d; try { d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw invalid(BAD); }
  if (!d?.t || !PROVIDERS[d.p] || typeof d.iat !== "number" || now - d.iat > maxAgeMs || now < d.iat - 60_000) throw invalid(BAD);
  return { tenantId: d.t, userId: d.u ?? null, provider: d.p, nonce: d.n };
}
const verifierFor = (nonce) => createHmac("sha256", pepper()).update(`pkce|${nonce}`, "utf8").digest("base64url");
const challengeFor = (verifier) => createHash("sha256").update(verifier).digest("base64url");

async function client(provider) {
  const P = await ports();
  const c = P.oauthClient ? await P.oauthClient(provider) : null;
  if (!c?.clientId || !c?.clientSecret) throw conflict(`Connecting ${PROVIDERS[provider].label} mailboxes is not set up on this server yet (no ${PROVIDERS[provider].label} OAuth client is configured). Ask the person who runs this server to add one.`);
  return c;
}

/** The address to send the person to, to give consent. */
export async function beginConnect({ tenantId, userId = null, provider, redirectUri, loginHint = null }) {
  const e = endpoints(provider), c = await client(provider);
  const state = signState({ tenantId, userId, provider });
  const { nonce } = verifyState(state);
  const u = new URL(e.auth);
  u.searchParams.set("client_id", c.clientId); u.searchParams.set("redirect_uri", redirectUri); u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", PROVIDERS[provider].scopes.join(" ")); u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challengeFor(verifierFor(nonce))); u.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") { u.searchParams.set("access_type", "offline"); u.searchParams.set("prompt", "consent"); u.searchParams.set("include_granted_scopes", "false"); }
  else u.searchParams.set("prompt", "select_account");
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return { url: u.toString(), provider };
}

const form = (o) => new URLSearchParams(o).toString();
const claims = (jwt) => { try { return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8")); } catch { return {}; } };

/** The provider's answer to the consent: exchange the code, learn the address, keep the refresh token sealed. Returns what the screen shows. */
export async function completeConnect(tx, { state, code, redirectUri, outside = null }) {
  const { tenantId, userId, provider, nonce } = verifyState(state);
  if (typeof code !== "string" || !code) throw invalid("The provider did not send a code. Start again from Email settings.");
  const P = await ports(), e = endpoints(provider), c = await client(provider);
  const call = outside ?? P.outside;
  const t = await call(`${provider}_mailbox_token`, e.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: c.clientId, client_secret: c.clientSecret, code_verifier: verifierFor(nonce) }) }, { timeoutMs: 15_000 });
  if (!t.ok) throw dependency(`${PROVIDERS[provider].label} did not accept the connection (${t.body?.error ?? t.status ?? "unreachable"}).`);
  if (!t.body?.refresh_token) throw dependency(`${PROVIDERS[provider].label} did not return a refresh token. Remove this app's access in your ${PROVIDERS[provider].label} account and connect again.`);
  const granted = String(t.body.scope ?? "").split(/[\s,]+/).filter(Boolean);
  const mustHave = provider === "google" ? "https://www.googleapis.com/auth/gmail.send" : "mail.send";
  if (granted.length && !granted.some((s) => s.toLowerCase() === mustHave)) throw invalid(`Sending permission was not granted. Connect again and allow ${PROVIDERS[provider].label} to let this app send email for you.`);
  let email = null, displayName = null;
  if (provider === "google") { const cl = claims(t.body.id_token); email = cl.email ?? null; displayName = cl.name ?? null; }
  else {
    const me = await call("microsoft_mailbox_profile", `${e.api}/v1.0/me?$select=mail,userPrincipalName,displayName`, { headers: { authorization: `Bearer ${t.body.access_token}`, accept: "application/json" } }, { timeoutMs: 15_000 });
    if (!me.ok) throw dependency("Microsoft connected, but would not say which address this is. Try again.");
    email = me.body?.mail || me.body?.userPrincipalName || null; displayName = me.body?.displayName ?? null;
  }
  if (!email || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) throw dependency(`${PROVIDERS[provider].label} did not say which address was connected. Try again.`);
  await storeRefresh(tx, { tenantId, provider, token: t.body.refresh_token });
  await tx.query(
    `INSERT INTO keystone.mail_mailbox (tenant_id, provider, email, display_name, scopes, status, last_error, connected_by, connected_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'connected',NULL,$6, now(), now())
     ON CONFLICT (tenant_id) DO UPDATE SET provider = EXCLUDED.provider, email = EXCLUDED.email, display_name = EXCLUDED.display_name, scopes = EXCLUDED.scopes, status = 'connected', last_error = NULL, connected_by = EXCLUDED.connected_by, connected_at = now(), updated_at = now()`,
    [tenantId, provider, email.toLowerCase(), displayName, granted, userId]);
  // connecting a mailbox is choosing it: the identity now sends from it
  await tx.query(`INSERT INTO keystone.mail_identity (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  await tx.query(`UPDATE keystone.mail_identity SET mode = 'mailbox', from_address = $2, from_name = CASE WHEN from_name = '' OR from_name IS NULL THEN coalesce($3, '') ELSE from_name END, updated_by = $4, updated_at = now() WHERE tenant_id = $1`, [tenantId, email.toLowerCase(), displayName, userId]);
  return { tenantId, provider, email: email.toLowerCase(), displayName };
}

async function storeRefresh(tx, { tenantId, provider, token }) {
  const P = await ports();
  const sealed = P.secrets.seal({ tenantId, purpose: SEAL_PURPOSE[provider], plaintext: token });
  await tx.query(
    `INSERT INTO keystone.mail_secret (tenant_id, name, secret_envelope, kek_version, secret_fingerprint) VALUES ($1,$2,$3::jsonb,$4,$5)
     ON CONFLICT (tenant_id, name) DO UPDATE SET secret_envelope = EXCLUDED.secret_envelope, kek_version = EXCLUDED.kek_version, secret_fingerprint = EXCLUDED.secret_fingerprint, updated_at = now()`,
    [tenantId, MAILBOX_SECRET, JSON.stringify(sealed.envelope), sealed.kekVersion, sealed.fingerprint]);
}

export async function mailboxRow(tx) {
  const { rows: [r] } = await tx.query(`SELECT provider, email, display_name, status, last_error, connected_at, last_used_at, scopes FROM keystone.mail_mailbox WHERE tenant_id = keystone.current_tenant_id() LIMIT 1`);
  return r ?? null;
}

/** Stop using the mailbox: the row and the sealed token go; an identity that was set to the mailbox goes back to the platform address — said out loud to the caller, not left to a silent fallback. */
export async function disconnect(tx, { tenantId, updatedBy = null }) {
  const gone = await tx.query(`DELETE FROM keystone.mail_mailbox WHERE tenant_id = $1 RETURNING email`, [tenantId]);
  await tx.query(`DELETE FROM keystone.mail_secret WHERE tenant_id = $1 AND name = $2`, [tenantId, MAILBOX_SECRET]);
  const rev = await tx.query(`UPDATE keystone.mail_identity SET mode = 'platform', updated_by = $2, updated_at = now() WHERE tenant_id = $1 AND mode = 'mailbox' RETURNING 1`, [tenantId, updatedBy]);
  return { disconnected: gone.rowCount > 0, revertedToPlatform: rev.rowCount > 0 };
}

class NeedsReconnect extends Error { constructor(msg) { super(msg); this.name = "MailboxNeedsReconnect"; } }

async function markBroken(tx, { tenantId, reason }) {
  await tx.query(`UPDATE keystone.mail_mailbox SET status = 'needs_reconnect', last_error = $2, updated_at = now() WHERE tenant_id = $1`, [tenantId, String(reason).slice(0, 300)]);
}

/** A short-lived access token for this organisation's mailbox. Rotated refresh tokens (Microsoft) are kept. Throws NeedsReconnect when the provider says the grant is gone. */
async function accessToken(tx, { tenantId, row, outside = null }) {
  const P = await ports(), e = endpoints(row.provider), c = await client(row.provider);
  const { rows: [s] } = await tx.query(`SELECT secret_envelope, kek_version FROM keystone.mail_secret WHERE tenant_id = $1 AND name = $2`, [tenantId, MAILBOX_SECRET]);
  if (!s) { await markBroken(tx, { tenantId, reason: "The saved connection is missing." }); throw new NeedsReconnect("Your connected mailbox needs to be connected again."); }
  let refresh;
  try { refresh = P.secrets.open({ envelope: s.secret_envelope, tenantId, purpose: SEAL_PURPOSE[row.provider], kekVersion: s.kek_version }); }
  catch { await markBroken(tx, { tenantId, reason: "The saved connection could not be opened." }); throw new NeedsReconnect("Your connected mailbox needs to be connected again."); }
  const call = outside ?? P.outside;
  const r = await call(`${row.provider}_mailbox_refresh`, e.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form({ grant_type: "refresh_token", refresh_token: refresh, client_id: c.clientId, client_secret: c.clientSecret }) }, { timeoutMs: 15_000 });
  if (!r.ok) {
    const code = String(r.body?.error ?? "");
    if (r.status === 400 || r.status === 401 || /invalid_grant|invalid_client|unauthorized_client/.test(code)) { await markBroken(tx, { tenantId, reason: `${PROVIDERS[row.provider].label} refused the saved connection (${code || r.status}).` }); throw new NeedsReconnect("Your connected mailbox needs to be connected again."); }
    throw Object.assign(new Error(`${PROVIDERS[row.provider].label} could not be reached for a sending token. It will be tried again.`), { transient: true });
  }
  if (r.body?.refresh_token && r.body.refresh_token !== refresh) await storeRefresh(tx, { tenantId, provider: row.provider, token: r.body.refresh_token });
  if (!r.body?.access_token) throw Object.assign(new Error(`${PROVIDERS[row.provider].label} did not give a sending token.`), { transient: true });
  return r.body.access_token;
}

const addr = (name, email) => `"${String(name ?? "").replace(/["\r\n]/g, "").trim()}" <${email}>`;

/** One email, sent as the connected mailbox. Returns { status: 'sent'|'failed', providerMessageId, error, needsReconnect? } — never throws for a delivery failure. */
export async function sendViaMailbox(tx, { tenantId, identity, routed, html, text, attachments, replyTo = null, outside = null }) {
  const row = await mailboxRow(tx);
  if (!row) return { status: "failed", providerMessageId: null, error: "No mailbox is connected.", needsReconnect: true };
  if (row.status !== "connected") return { status: "failed", providerMessageId: null, error: "Your connected mailbox needs to be connected again.", needsReconnect: true };
  const P = await ports(), e = endpoints(row.provider), call = outside ?? P.outside;
  let token;
  try { token = await accessToken(tx, { tenantId, row, outside }); }
  catch (err) { return { status: "failed", providerMessageId: null, error: err.message, needsReconnect: err.name === "MailboxNeedsReconnect" }; }
  const from = addr(identity.fromName || row.display_name || "", row.email);
  let res;
  if (row.provider === "google") {
    const raw = await new MailComposer({ from, to: routed.to, subject: routed.subject, html: html ?? undefined, text, ...(replyTo ? { replyTo } : {}),
      ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "base64") })) } : {}) }).compile().build();
    res = await call("gmail_send", `${e.api}/gmail/v1/users/me/messages/send`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }) }, { timeoutMs: 30_000 });
  } else {
    const message = { subject: routed.subject, body: { contentType: html ? "HTML" : "Text", content: html ?? text }, toRecipients: [].concat(routed.to).map((a) => ({ emailAddress: { address: a } })),
      ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo } }] } : {}),
      ...(attachments?.length ? { attachments: attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.filename, contentBytes: a.content })) } : {}) };
    res = await call("graph_send_mail", `${e.api}/v1.0/me/sendMail`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ message, saveToSentItems: true }) }, { timeoutMs: 30_000 });
  }
  if (res.ok) { await tx.query(`UPDATE keystone.mail_mailbox SET last_used_at = now(), last_error = NULL WHERE tenant_id = $1`, [tenantId]); return { status: "sent", providerMessageId: row.provider === "google" ? (res.body?.id ?? null) : null, error: null }; }
  const msg = String(res.body?.error?.message ?? res.body?.error ?? res.status ?? "unreachable").slice(0, 240);
  if (res.status === 401 || res.status === 403) { await markBroken(tx, { tenantId, reason: `${PROVIDERS[row.provider].label} would not let this app send (${msg}).` }); return { status: "failed", providerMessageId: null, error: "Your connected mailbox needs to be connected again.", needsReconnect: true }; }
  return { status: "failed", providerMessageId: null, error: `${PROVIDERS[row.provider].label} did not send the message (${msg}).` };
}
