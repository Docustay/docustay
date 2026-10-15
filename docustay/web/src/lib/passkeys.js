// Passkeys in the browser (WebAuthn), speaking to /api/auth/passkeys/*. The server holds the public key; the device holds the private one. No library: the JSON shapes are small.
import { api } from "./api.js";
import { t } from "$lib/i18n/index.svelte.js";

const enc = (buf) => { const u = new Uint8Array(buf); let s = ""; for (const b of u) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const dec = (s) => { const p = String(s).replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(p + "=".repeat((4 - (p.length % 4)) % 4)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

export const passkeysSupported = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
/** Is the server willing? (the feature flag) */
export async function passkeysEnabled() { try { const r = await fetch("/api/auth/passkeys/status", { cache: "no-store" }); const b = await r.json(); return (b?.data ?? b)?.enabled === true; } catch { return false; } }

const refusal = (e) => (e?.name === "NotAllowedError" ? t("The passkey request was cancelled or timed out.") : e?.name === "InvalidStateError" ? t("This device already has a passkey for your account.") : (e?.message || t("Passkeys did not work on this device.")));

/** Add a passkey to the signed-in person's account. */
export async function registerPasskey(name) {
  const b = await api("/api/auth/passkeys/register/begin", { method: "POST", body: {} });
  if (!b.ok) throw new Error(b.error ?? t("Passkeys are not available right now."));
  const { ticket, options } = b.json;
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: { ...options, challenge: dec(options.challenge), user: { ...options.user, id: dec(options.user.id) }, excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({ ...c, id: dec(c.id) })) } });
  } catch (e) { throw new Error(refusal(e)); }
  const r = cred.response;
  const response = { id: cred.id, rawId: enc(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment ?? undefined, clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: { clientDataJSON: enc(r.clientDataJSON), attestationObject: enc(r.attestationObject), transports: r.getTransports?.() ?? [] } };
  const f = await api("/api/auth/passkeys/register/finish", { method: "POST", body: { ticket, response, name } });
  if (!f.ok) throw new Error(f.error ?? t("That passkey could not be added."));
}

/** Can this browser offer passkeys in the email box's autofill list (how Google and GitHub do it)? */
export const conditionalSupported = async () => { try { return passkeysSupported() && (await PublicKeyCredential.isConditionalMediationAvailable?.()) === true; } catch { return false; } };

/**
 * Sign in with a passkey: returns an ID token to hand to login().
 * Modal (the button): the browser shows its own sheet. With a passkey on this device it asks for Touch ID, Face ID, Windows Hello or the PIN; with none it can only offer a phone (QR code) or a security key.
 * Conditional ({ conditional: true, signal }): the passkey appears in the email box's autofill list, and picking it asks for the same unlock. Nothing shows if the device has none.
 */
export async function passkeyIdToken(exchange, { conditional = false, signal } = {}) {
  const b = await api("/api/auth/passkeys/login/begin", { method: "POST", body: {} });
  if (!b.ok) throw new Error(b.error ?? t("Passkeys are not available right now."));
  const { ticket, options } = b.json;
  let cred;
  try { cred = await navigator.credentials.get({ ...(conditional ? { mediation: "conditional" } : {}), ...(signal ? { signal } : {}), publicKey: { ...options, challenge: dec(options.challenge), allowCredentials: (options.allowCredentials ?? []).map((c) => ({ ...c, id: dec(c.id) })), hints: ["client-device", "hybrid", "security-key"] } }); }
  catch (e) { if (e?.name === "AbortError") throw e; throw new Error(conditional ? refusal(e) : (e?.name === "NotAllowedError" ? t("No passkey was used. If this device has none for Docustay yet, sign in with your password, then add one under Security.") : refusal(e))); }
  const r = cred.response;
  const response = { id: cred.id, rawId: enc(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment ?? undefined, clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: { clientDataJSON: enc(r.clientDataJSON), authenticatorData: enc(r.authenticatorData), signature: enc(r.signature), userHandle: r.userHandle ? enc(r.userHandle) : undefined } };
  const f = await api("/api/auth/passkeys/login/finish", { method: "POST", body: { ticket, response } });
  if (!f.ok) throw new Error(f.error ?? t("That passkey could not be used to sign in."));
  return f.json.idToken ?? exchange(f.json.customToken);
}
