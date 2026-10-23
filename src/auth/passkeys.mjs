// src/auth/passkeys.mjs — FP-E3: sign in with a passkey. STRICTLY ADDITIVE, and OFF unless KEYSTONE_PASSKEYS=1.
// A passkey belongs to an IDENTITY (the Firebase uid), like the TOTP factor. Signing in with one is: begin → the device signs a one-time challenge → finish verifies the signature
// against the stored public key and mints a Firebase CUSTOM TOKEN for that uid. The browser exchanges the token and posts the id token to /api/auth/login — the same single login path
// the emailed-code route uses, so everything login() does afterwards (two-step, memberships, sessions) is unchanged.
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { withCredentialLookup } from "../db/index.mjs";
import { getFirebaseAuth } from "./firebase.mjs";
import { localAuthEnabled, issueToken } from "./localIdentity.mjs";
import { invalid, unauthenticated, notFound, conflict, dependency } from "../http/errors.mjs";

export const passkeysEnabled = () => process.env.KEYSTONE_PASSKEYS === "1";
const RP_NAME = "Docustay";

/** Origins a passkey may be used from: the app URL plus any listed in KEYSTONE_PASSKEY_ORIGINS. The relying-party id is the origin's host. */
export function allowedOrigins(env = process.env) {
  const set = new Set();
  for (const raw of [env.KEYSTONE_DOCUSTAY_APP_URL, ...String(env.KEYSTONE_PASSKEY_ORIGINS ?? "").split(",")]) {
    try { if (raw && raw.trim()) set.add(new URL(raw.trim()).origin); } catch { /* not a URL */ }
  }
  return set;
}
export function relyingParty(originHeader, env = process.env) {
  let origin; try { origin = new URL(String(originHeader ?? "")).origin; } catch { throw invalid("This page cannot use passkeys."); }
  if (!allowedOrigins(env).has(origin)) throw invalid(`Passkeys are not available from ${origin}. Add it to KEYSTONE_PASSKEY_ORIGINS.`);
  return { origin, rpID: new URL(origin).hostname };
}
/** The web address the person is on: the Origin header when the browser sent one to us directly, else what the web app's proxy forwarded (x-forwarded-proto + x-forwarded-host).
 *  Whichever it is, it must be on the allowlist, and the device signs the real origin into the challenge response, which is what is checked. */
export function requestOrigin(c) {
  const o = c.req.header("origin") || c.req.header("x-docustay-origin");   // x-docustay-origin: set by the web app's proxy, which an edge proxy in between does not rewrite
  if (o) return o;
  const host = (c.req.header("x-forwarded-host") ?? "").split(",")[0].trim(), proto = (c.req.header("x-forwarded-proto") ?? "https").split(",")[0].trim();
  return host ? `${proto}://${host}` : undefined;
}
const gate = () => { if (!passkeysEnabled()) throw notFound("Passkeys are not available on this server."); };
const b64 = (u8) => Buffer.from(u8).toString("base64url");
const unb64 = (s) => new Uint8Array(Buffer.from(String(s), "base64url"));

const q = (fn, ...a) => withCredentialLookup((db) => fn(db, ...a));

/** Begin registering a passkey (or, with kind "security_key", a roaming security key: a USB or NFC key, no resident credential, second step only) for the signed-in person. */
export async function beginRegistration({ firebaseUid, email, origin, kind = "passkey" }) {
  gate();
  const { rpID } = relyingParty(origin);
  const existing = await q((db) => db.query(`SELECT credential_id, transports FROM keystone.list_passkeys($1)`, [firebaseUid]));
  const key = kind === "security_key";
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID, userName: email || firebaseUid, userID: new TextEncoder().encode(firebaseUid), attestationType: "none",
    excludeCredentials: existing.rows.map((r) => ({ id: r.credential_id, transports: r.transports?.length ? r.transports : undefined })),
    authenticatorSelection: key
      ? { authenticatorAttachment: "cross-platform", residentKey: "discouraged", userVerification: "preferred" }   // a security key proves possession; a PIN is used when the key has one
      : { residentKey: "required", userVerification: "required" },   // a passkey must be unlocked with Touch ID, Face ID, Windows Hello or the device PIN
  });
  const { rows: [c] } = await q((db) => db.query(`SELECT keystone.put_passkey_challenge('register', $1, $2) AS id`, [options.challenge, firebaseUid]));
  return { ticket: c.id, options };
}

export async function finishRegistration({ firebaseUid, email = null, origin, ticket, response, name, kind = "passkey" }) {
  gate();
  const { origin: expectedOrigin, rpID } = relyingParty(origin);
  const taken = await q((db) => db.query(`SELECT * FROM keystone.take_passkey_challenge($1, 'register')`, [ticket]));
  const ch = taken.rows[0];
  if (!ch || ch.firebase_uid !== firebaseUid) throw invalid("That passkey request expired. Start again.");
  const key = kind === "security_key";
  let v;
  try { v = await verifyRegistrationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin, expectedRPID: rpID, requireUserVerification: !key }); }
  catch { throw invalid(key ? "That security key could not be verified." : "That passkey could not be verified."); }
  if (!v.verified || !v.registrationInfo) throw invalid(key ? "That security key could not be verified." : "That passkey could not be verified.");
  const cred = v.registrationInfo.credential;
  try {
    const { rows: [r] } = await q((db) => db.query(`SELECT keystone.add_passkey_kind($1,$2,$3,$4,$5,$6,$7,$8) AS id`, [firebaseUid, cred.id, b64(cred.publicKey), cred.counter ?? 0, response.response?.transports ?? cred.transports ?? [], typeof name === "string" ? name : "", email, key ? "security_key" : "passkey"]));
    return { id: r.id };
  } catch (e) {
    if (e?.code === "23505") throw conflict(/at most/.test(e.message) ? "You can keep up to 10 passkeys and security keys." : "That passkey is already registered.");
    throw e;
  }
}

export async function listPasskeys({ firebaseUid }) {
  gate();
  const { rows } = await q((db) => db.query(`SELECT id, name, transports, created_at, last_used_at, kind FROM keystone.list_passkeys_kind($1)`, [firebaseUid]));
  return { passkeys: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, transports: r.transports, createdAt: r.created_at?.toISOString?.() ?? r.created_at, lastUsedAt: r.last_used_at?.toISOString?.() ?? r.last_used_at ?? null })) };
}
export async function removePasskey({ firebaseUid, id }) {
  gate();
  const { rows: [r] } = await q((db) => db.query(`SELECT keystone.delete_passkey($1, $2) AS ok`, [firebaseUid, id]));
  if (!r?.ok) throw notFound("No such passkey.");
  return { ok: true };
}
export async function renamePasskey({ firebaseUid, id, name }) {
  gate();
  const { rows: [r] } = await q((db) => db.query(`SELECT keystone.rename_passkey($1, $2, $3) AS ok`, [firebaseUid, id, String(name ?? "")]));
  if (!r?.ok) throw notFound("No such passkey.");
  return { ok: true };
}

/** Begin a sign-in: no account is named — the device offers the passkeys it holds for this site. */
export async function beginLogin({ origin }) {
  gate();
  const { rpID } = relyingParty(origin);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  const { rows: [c] } = await q((db) => db.query(`SELECT keystone.put_passkey_challenge('login', $1, NULL) AS id`, [options.challenge]));
  return { ticket: c.id, options };
}

/** Verify the signed challenge and mint a Firebase custom token for the passkey's person. */
export async function finishLogin({ origin, ticket, response }) {
  gate();
  const { origin: expectedOrigin, rpID } = relyingParty(origin);
  const taken = await q((db) => db.query(`SELECT * FROM keystone.take_passkey_challenge($1, 'login')`, [ticket]));
  const ch = taken.rows[0];
  const fail = () => unauthenticated("That passkey could not be used to sign in.");
  if (!ch || ch.firebase_uid || typeof response?.id !== "string") throw fail();   // a challenge made for a second step (it names a person) can never sign anyone in
  const { rows: [pk] } = await q((db) => db.query(`SELECT * FROM keystone.get_passkey($1)`, [response.id]));
  if (!pk) throw fail();
  let v;
  try {
    v = await verifyAuthenticationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin, expectedRPID: rpID,
      credential: { id: response.id, publicKey: unb64(pk.public_key), counter: Number(pk.counter), transports: pk.transports?.length ? pk.transports : undefined }, requireUserVerification: true });
  } catch { throw fail(); }
  if (!v.verified) throw fail();
  await q((db) => db.query(`SELECT keystone.touch_passkey($1, $2)`, [response.id, v.authenticationInfo.newCounter ?? 0]));
  // the built-in identity (self-host, sandbox) mints its own id token; Firebase installs mint a custom token the browser exchanges at Google
  if (localAuthEnabled()) return { idToken: issueToken({ uid: pk.firebase_uid, email: String(pk.email ?? "").toLowerCase(), claims: { passkey: true } }) };
  try { return { customToken: await getFirebaseAuth().createCustomToken(pk.firebase_uid, { docustay_passkey: true }) }; }   // the sign-in that follows knows a passkey was used, so it does not ask for a second step
  catch (err) { throw dependency("Sign-in by passkey is not available right now.", err); }
}

/** The second step with a passkey or a security key: the device signs a one-time challenge made for THIS person. Also used as the proof before a security change. */
export async function beginSecondStep({ firebaseUid, origin }) {
  gate();
  const { rpID } = relyingParty(origin);
  const { rows } = await q((db) => db.query(`SELECT credential_id, transports FROM keystone.list_passkeys($1)`, [firebaseUid]));
  if (!rows.length) throw invalid("No passkey or security key is set up for this account.");
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred", allowCredentials: rows.map((r) => ({ id: r.credential_id, transports: r.transports?.length ? r.transports : undefined })) });
  const { rows: [c] } = await q((db) => db.query(`SELECT keystone.put_passkey_challenge('login', $1, $2) AS id`, [options.challenge, firebaseUid]));
  return { ticket: c.id, options };
}
export async function finishSecondStep({ firebaseUid, origin, ticket, response }) {
  gate();
  const { origin: expectedOrigin, rpID } = relyingParty(origin);
  const taken = await q((db) => db.query(`SELECT * FROM keystone.take_passkey_challenge($1, 'login')`, [ticket]));
  const ch = taken.rows[0];
  const fail = () => unauthenticated("That passkey could not be used. Try again, or use another way.");
  if (!ch || ch.firebase_uid !== firebaseUid || typeof response?.id !== "string") throw fail();
  const { rows: [pk] } = await q((db) => db.query(`SELECT * FROM keystone.get_passkey($1)`, [response.id]));
  if (!pk || pk.firebase_uid !== firebaseUid) throw fail();
  let v;
  try {
    v = await verifyAuthenticationResponse({ response, expectedChallenge: ch.challenge, expectedOrigin, expectedRPID: rpID,
      credential: { id: response.id, publicKey: unb64(pk.public_key), counter: Number(pk.counter), transports: pk.transports?.length ? pk.transports : undefined }, requireUserVerification: false });
  } catch { throw fail(); }
  if (!v.verified) throw fail();
  await q((db) => db.query(`SELECT keystone.touch_passkey($1, $2)`, [response.id, v.authenticationInfo.newCounter ?? 0]));
  return { ok: true };
}
