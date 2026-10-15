import { t, i18n } from "$lib/i18n/index.svelte.js";
// Docustay sign-in and sign-up, speaking to the same backend as every other client: Firebase REST for identity (no Firebase SDK), then /api/auth/login for the session. A deployment with no Firebase project uses the built-in identity.
import { api, newKey } from "./api.js";

/** An error whose `kind` tells the page what to offer next: "exists" (sign in or reset instead), "credentials", "weak", "email", "limit", "disabled", "network", "noworkspace". Nobody ever sees the identity provider's name or its raw codes. */
export class AuthError extends Error { constructor(message, kind = "other") { super(message); this.kind = kind; } }
const codeOf = (p) => String(p?.error?.message ?? "").split(/[\s:]/)[0];
/** Map the identity provider's error code to words that say what to do next. */
export function plainError(p, fallback) {
  const c = codeOf(p);
  if (c === "EMAIL_EXISTS") return new AuthError(t("An account with this email already exists. Sign in instead, or reset your password if you have forgotten it."), "exists");
  if (c === "WEAK_PASSWORD") return new AuthError(t("That password is too short or too easy to guess. Use at least 6 characters; a longer phrase is better."), "weak");
  if (c === "INVALID_EMAIL" || c === "MISSING_EMAIL") return new AuthError(t("That email address does not look right. Check it for typing mistakes and try again."), "email");
  if (c === "TOO_MANY_ATTEMPTS_TRY_LATER" || c.includes("BLOCKED")) return new AuthError(t("Too many attempts. Wait a few minutes and try again, or reset your password."), "limit");
  if (c === "USER_DISABLED") return new AuthError(t("This account has been turned off. Contact us and we will look into it."), "disabled");
  if (["EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "MISSING_PASSWORD"].includes(c)) return new AuthError(t("That email and password were not accepted. Check them, or reset your password."), "credentials");
  if (c === "OPERATION_NOT_ALLOWED") return new AuthError(t("Sign-up is not available right now. Try again later."), "other");
  return new AuthError(fallback ?? t("Something went wrong. Try again in a moment."), "other");
}
const networkError = () => new AuthError(t("We could not reach the sign-in service. Check your connection and try again."), "network");
/** Words from our own server can name the identity provider; show them only when they do not. */
const cleanServer = (m, fallback) => (!m || /firebase|identity ?toolkit|oob|id ?token/i.test(String(m)) ? fallback : String(m));

let cfg = null;
export async function authConfig() {
  if (cfg) return cfg;
  const r = await fetch("/api/auth/config", { cache: "no-store" }); const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(b?.error?.message ?? t("Sign-in is not available right now."));
  const bot = b.data.turnstile?.siteKey ?? null;   // the bot check's public site key; null when this deployment has none
  cfg = b.data.mode === "local" ? { local: true, selfHost: b.data.selfHost === true, signupCode: b.data.signupCode === true, demo: b.data.demo === true, botKey: bot } : { local: false, apiKey: b.data.firebase.apiKey, signupCode: b.data.signupCode === true, demo: b.data.demo === true, google: b.data.google?.clientId ?? null, botKey: bot };
  return cfg;
}
/** The bot check (Cloudflare Turnstile): the page shows the widget only when this deployment has a site key, hands the token over here, and exactly ONE server call spends it (a token works once). */
export const botCheckSiteKey = async () => { try { return (await authConfig()).botKey ?? null; } catch { return null; } };
let botToken = null;
export const setBotToken = (v) => { botToken = v || null; };
const botTokenOnce = () => { const v = botToken; botToken = null; return v ? { turnstileToken: v } : {}; };
const idt = (path, apiKey, body) => fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${path}?key=${apiKey}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => { throw networkError(); });

export async function passwordIdToken(email, password) {
  const c = await authConfig();
  const res = c.local ? await fetch("/api/auth/local/signin", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }).catch(() => { throw networkError(); }) : await idt("signInWithPassword", c.apiKey, { email, password, returnSecureToken: true });
  const p = await res.json().catch(() => null);
  // Run 4 round 2: a throttled attempt (429) and a server fault (5xx) were both shown as "not accepted", so a person with the right password was told it was wrong (and offered "Create one") while the limiter was holding them back
  if (!res.ok) { if (c.local) { if (res.status === 429) throw new AuthError(t("Too many attempts. Wait a few minutes and try again, or reset your password."), "limit"); if (res.status >= 500) throw new AuthError(t("Something went wrong. Try again in a moment."), "other"); throw new AuthError(t("That email and password were not accepted. Check them, or reset your password."), "credentials"); } throw plainError(p, t("That email and password were not accepted. Check them, or reset your password.")); }
  return p.idToken;
}
export async function login(idToken, tenantSlug = null) {
  const r = await api("/api/auth/login", { method: "POST", body: { idToken, ...(tenantSlug ? { tenantSlug } : {}) } });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new AuthError(t("You are signed in, but this account has no workspace yet. Finish creating your account to continue."), "noworkspace");
    throw new AuthError(cleanServer(r.error, t("Sign-in failed. Try again.")), "other");
  }
  return r.json;
}
export const requestCode = async (email) => { const r = await api("/api/auth/code/request", { method: "POST", body: { email, product: "docustay", lang: i18n.lang } }); if (!r.ok) throw new Error(r.json?.error?.kind === "rate_limited" ? t("Too many attempts for that address. Try again in a few minutes.") : (r.error ?? t("Sign-in by code is not available right now."))); };
export async function codeIdToken(email, code) {
  const v = await api("/api/auth/code/verify", { method: "POST", body: { email, code } });
  if (!v.ok) throw new Error(v.error ?? t("That code was not accepted."));
  const c = await authConfig();
  const res = await idt("signInWithCustomToken", c.apiKey, { token: v.json.customToken, returnSecureToken: true });
  if (!res.ok) throw new Error(t("Sign-in by code is not available right now."));
  return (await res.json()).idToken;
}
/** A Firebase custom token (from a passkey sign-in) exchanged for the ID token login() takes. */
export async function customTokenIdToken(token) {
  const c = await authConfig();
  const res = await idt("signInWithCustomToken", c.apiKey, { token, returnSecureToken: true });
  if (!res.ok) throw new Error(t("Sign-in by passkey is not available right now."));
  return (await res.json()).idToken;
}
export const requestReset = async (email) => { const r = await api("/api/auth/password-reset/request", { method: "POST", body: { email, product: "docustay", lang: i18n.lang } }); if (!r.ok) throw new Error(r.error ?? t("Could not send the email. Try again.")); };
export async function finishReset(oobCode, newPassword) {
  const c = await authConfig();
  if (c.local) { const r = await api("/api/auth/local/reset", { method: "POST", body: { token: oobCode, password: newPassword } }); if (!r.ok) throw new Error(r.error ?? t("That link has expired or was already used. Ask for a new one.")); return; }
  const res = await idt("resetPassword", c.apiKey, { oobCode, newPassword }); const p = await res.json().catch(() => null);
  if (!res.ok) { const m = p?.error?.message ?? ""; throw new AuthError(/EXPIRED|INVALID_OOB/.test(m) ? t("That link has expired or was already used. Ask for a new one.") : /WEAK_PASSWORD/.test(m) ? plainError(p).message : t("Could not set the new password. Ask for a new link and try again."), /EXPIRED|INVALID_OOB/.test(m) ? "expired" : "other"); }
}
const ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles"; } catch { return "America/Los_Angeles"; } })();
const slugOf = (n) => n.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "docs";
const claimsOf = (idToken) => { try { return JSON.parse(atob(String(idToken).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return {}; } };
let pending = null;   // { name, email, idToken, policy } between "make the account" and "enter the code we emailed"
/** Step 1 of sign-up: make the identity with its password, then email a 6-digit code to prove the address. Resolves { needsCode: true } — or goes straight through when the address is already proven (a returning person). */
export const minPassword = async () => ((await authConfig()).local ? 8 : 6);
export async function beginSignUp({ name, email, password, policy }) {
  const c = await authConfig(); let created;
  if (c.local) {
    const lr = await fetch("/api/auth/local/signup", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }).catch(() => { throw networkError(); });
    created = await lr.json().catch(() => null);
    if (!lr.ok) throw new AuthError(cleanServer(created?.error?.message, t("Could not create the account. Check the details and try again.")), "other");
  } else {
    created = await (await idt("signUp", c.apiKey, { email, password, returnSecureToken: true })).json().catch(() => null);
    if (created?.error) {
      if (codeOf(created) !== "EMAIL_EXISTS") throw plainError(created, t("That email and password could not be used to create an account."));
      // The address already has a login. With the right password this is either a person who already has a workspace (sign them in) or a half-made account from an earlier try (carry on creating the workspace). A wrong password is an ordinary "you already have an account".
      const back = await idt("signInWithPassword", c.apiKey, { email, password, returnSecureToken: true }); const bp = await back.json().catch(() => null);
      if (!back.ok) { const e = plainError(bp); throw e.kind === "limit" ? e : new AuthError(t("An account with this email already exists, and that password does not match it. Sign in instead, or reset your password."), "exists"); }
      created = bp;
      try { await login(created.idToken); return { needsCode: false, signedIn: true }; } catch (err) { if (err?.kind !== "noworkspace") throw err; /* no workspace yet: resume below */ }
    }
  }
  pending = { name, email, idToken: created.idToken, policy };
  // the emailed-code step is asked for wherever the server says it is switched on; an address already proven (a returning, half-made account) goes straight on
  if (!c.signupCode || claimsOf(created.idToken).email_verified === true) { await finishSignUp(); return { needsCode: false }; }
  await sendSignUpCode();
  return { needsCode: true };
}
const limitedOrOther = (r, fallback) => (r.json?.error?.kind === "rate_limited" ? t("Too many attempts for that address. Try again in a few minutes.") : cleanServer(r.error, fallback));
/** Email the code again (or the first time). */
export async function sendSignUpCode() {
  if (!pending) throw new AuthError(t("Start again: fill in the form first."));
  const r = await api("/api/signup/verify/request", { method: "POST", body: { name: pending.name.trim(), email: pending.email, product: "docustay", lang: i18n.lang, ...(botTokenOnce()) } });
  if (!r.ok) throw new AuthError(limitedOrOther(r, t("The code could not be sent. Check the address and try again.")), r.json?.error?.kind === "rate_limited" ? "limit" : "other");
}
/** Step 2: the person types the code; the address is proven, then the workspace is made and they are signed in. */
export async function finishSignUp(code = null) {
  if (!pending) throw new AuthError(t("Start again: fill in the form first."));
  const c = await authConfig(); let { name, email, idToken, policy } = pending;
  if (code !== null) {
    const v = await api("/api/signup/verify/verify", { method: "POST", body: { email, code: String(code).replace(/\s+/g, "") } });
    if (!v.ok) throw new AuthError(r_codeWords(v), "code");
    if (c.local) idToken = v.json.idToken;
    else { const res = await idt("signInWithCustomToken", c.apiKey, { token: v.json.customToken, returnSecureToken: true }); if (!res.ok) throw new AuthError(t("That code worked, but we could not finish signing you in. Try again."), "other"); idToken = (await res.json()).idToken; }
    pending = { ...pending, idToken };
  }
  const su = await api("/api/signup", { method: "POST", body: { ...(c.signupCode ? {} : botTokenOnce()), idToken, tenant: { slug: `${slugOf(name)}-${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), timezone: ZONE }, admin: { displayName: name.trim() }, policyAccepted: policy } });
  if (!su.ok) {
    if (/not been confirmed|confirmed yet/i.test(String(su.error))) throw new AuthError(t("Confirm your email address first. We emailed you a six-digit code."), "unconfirmed");
    throw new AuthError(cleanServer(su.error, t("Could not create the workspace. Try again in a moment.")), "other");
  }
  await login(idToken);
  const act = await api("/api/product/docustay/activate", { method: "POST", body: { lang: i18n.lang } });
  pending = null;
  if (!act.ok) throw new AuthError(t("Your workspace was created, but setting it up did not complete. Sign in and try again."), "other");
}
// ── LAUNCH (13 Oct 2026): sign-up by emailed code alone — an email, then six digits. No password is asked for or chosen; the person can set one later in Account, and can always sign in with a new code.
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "mail.com", "fastmail.com", "hey.com", "zoho.com"]);
/** The workspace's first name, from the address: a company domain names the company ("acme.com" → "Acme"); a personal mailbox names the person ("the maintainer" → "Example's workspace"). Renamed in the first-run checklist. */
export function workspaceNameFromEmail(email) {
  const [local = "", domain = ""] = String(email).trim().toLowerCase().split("@");
  const pretty = (s) => s.split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  if (domain && !FREE_MAIL.has(domain)) { const org = pretty(domain.split(".").slice(0, -1).join(" ")); if (org) return org.slice(0, 60); }
  const who = pretty(local.replace(/\+.*$/, ""));
  return who ? `${who.slice(0, 40)}'s workspace` : "My workspace";
}
/** Step 1: email the six-digit code (the server makes the identity if the address is new). */
export async function emailCodeStart(email) {
  const r = await api("/api/signup/verify/request", { method: "POST", body: { email: String(email).trim(), product: "docustay", lang: i18n.lang, ...botTokenOnce() } });
  if (r.status === 0) throw networkError();
  if (!r.ok) throw new AuthError(limitedOrOther(r, t("The code could not be sent. Check the address and try again.")), r.json?.error?.kind === "rate_limited" ? "limit" : r.status === 403 ? "bot" : r.json?.error?.kind === "validation" ? "email" : "other");
}
/** Step 2: the code is entered. The address is proven; an address that already has a workspace is signed in (→ { created: false }); a new one gets a workspace made and set up (→ { created: true }). `policy` must be true to create one. */
export async function emailCodeFinish(email, code, { policy = false, onStep = () => {} } = {}) {
  const c = await authConfig(); email = String(email).trim();
  const v = await api("/api/signup/verify/verify", { method: "POST", body: { email, code: String(code).replace(/\D/g, "") } });
  if (v.status === 0) throw networkError();
  if (!v.ok) throw new AuthError(r_codeWords(v), "code");
  let idToken;
  if (c.local) idToken = v.json.idToken;
  else { const res = await idt("signInWithCustomToken", c.apiKey, { token: v.json.customToken, returnSecureToken: true }); if (!res.ok) throw new AuthError(t("That code worked, but we could not finish signing you in. Try again."), "other"); idToken = (await res.json()).idToken; }
  onStep("verified");
  return finishWithIdToken(idToken, { email, policy, onStep });
}
/** Whoever proved who they are (a code, Google): signed in if they already have a workspace; otherwise a workspace is made and set up (`policy` must be true to make one). → { created }. */
async function finishWithIdToken(idToken, { email, policy = false, onStep = () => {} } = {}) {
  try { await login(idToken); return { created: false }; } catch (err) { if (err?.kind !== "noworkspace") throw err; }
  if (!policy) throw new AuthError(t("Please agree to the Terms, Privacy Policy and Data Processing Addendum."), "policy");
  onStep("creating");
  const name = workspaceNameFromEmail(email);
  const su = await api("/api/signup", { method: "POST", body: { idToken, tenant: { slug: `${slugOf(name)}-${Math.random().toString(36).slice(2, 6)}`, name, timezone: ZONE }, admin: { displayName: name }, policyAccepted: true } });
  if (su.status === 0) throw networkError();
  if (!su.ok) throw new AuthError(cleanServer(su.error, t("Could not create the workspace. Try again in a moment.")), "other");
  await login(idToken);
  const act = await api("/api/product/docustay/activate", { method: "POST", body: { lang: i18n.lang } });
  if (!act.ok) throw new AuthError(t("Your workspace was created, but setting it up did not complete. Sign in and try again."), "other");
  return { created: true };
}
/** "Continue with Google": Google's one-tap button hands over a credential (a Google ID token); Firebase's Google provider trades it for ours, and the rest is the same as after a code. */
export async function googleIdToken(credential) {
  const c = await authConfig();
  if (c.local || !c.apiKey) throw new AuthError(t("Google sign-in is not available here."), "other");
  const res = await idt("signInWithIdp", c.apiKey, { postBody: `id_token=${encodeURIComponent(credential)}&providerId=google.com`, requestUri: location.origin, returnIdpCredential: true, returnSecureToken: true });
  const p = await res.json().catch(() => null);
  if (!res.ok || !p?.idToken) throw new AuthError(t("Google sign-in did not finish. Try again, or use your email."), "other");
  return { idToken: p.idToken, email: p.email ?? "" };
}
export async function googleFinish(credential, { policy = false, onStep = () => {} } = {}) {
  const g = await googleIdToken(credential);
  onStep("verified");
  return finishWithIdToken(g.idToken, { email: g.email, policy, onStep });
}
function r_codeWords(v) { return v.json?.error?.kind === "rate_limited" ? t("Too many wrong codes. Wait a few minutes, then ask for a new one.") : t("That code was not right, or it has expired. Check it, or send a new code."); }

/** A teammate's invitation (the link in the invite email): what it is for, read without spending it. */
export async function previewInviteToken(token) {
  const r = await api(`/api/auth/invite/${encodeURIComponent(token)}`);
  if (!r.ok) throw new Error(r.error ?? t("This invitation is no longer valid. It may have already been used, expired, or been cancelled."));
  return r.json?.data ?? r.json;
}
/** Accept it: make (or sign in to) the identity for the invited address, then join the workspace and be signed in. A person who already has an account uses their own password. */
export async function acceptInviteWithPassword({ token, email, password }) {
  const c = await authConfig(); let idToken;
  if (c.local) {
    let lr = await fetch("/api/auth/local/signup", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (!lr.ok) { lr = await fetch("/api/auth/local/signin", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); if (!lr.ok) throw new Error(t("That email already has an account, and the password did not match it.")); }
    idToken = (await lr.json()).idToken;
  } else {
    let created = await (await idt("signUp", c.apiKey, { email, password, returnSecureToken: true })).json();
    if (created?.error) {
      if (!String(created.error.message ?? "").startsWith("EMAIL_EXISTS")) throw new Error(t("That email and password could not be used to create an account."));
      const back = await idt("signInWithPassword", c.apiKey, { email, password, returnSecureToken: true });
      if (!back.ok) throw new Error(t("That email already has an account, and the password did not match it.")); created = await back.json();
    }
    idToken = created.idToken;
  }
  const r = await api("/api/auth/invite/accept", { method: "POST", body: { token, idToken } });
  if (!r.ok) throw new Error(r.error ?? t("The invitation could not be accepted."));
  return r.json;
}
