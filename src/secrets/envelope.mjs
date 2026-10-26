// P2.15 — SECRETS: capture-at-creation · envelope encryption · AAD bound to tenant_id.
//
// ★★★ AAD ON tenant_id IS THE POINT OF THIS FILE.
// Additional Authenticated Data is covered by the auth tag but NOT stored in the ciphertext. So a
// ciphertext encrypted for tenant A **cannot be decrypted in tenant B's context** — the tag check
// fails and decryption throws, rather than returning plaintext.
// Without AAD, a ciphertext copied between rows (a bad migration, a restored backup, an ORM bug
// writing to the wrong row) would decrypt perfectly happily under another tenant. ★ RLS protects
// the ROW; AAD protects the VALUE if it ever escapes its row.
//
// ★★ ENVELOPE: each secret gets its own random data key (DEK). The DEK is encrypted by the master
// key (KEK) and stored beside the ciphertext. Rotating the KEK then means re-wrapping N small
// DEKs, not re-encrypting every secret — and a single leaked DEK exposes ONE secret, not all of them.
//
// ★ CAPTURE-AT-CREATION: several providers show a token EXACTLY ONCE (Resend, a Stripe webhook
// signing secret). If it is not persisted at the moment of creation it is unrecoverable and the only fix is to create a
// second credential and orphan the first. Hence `captureAtCreation`, which refuses to silently
// drop a value it was asked to keep.

import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "node:crypto";
import { tokenPepper } from "../auth/apiToken.mjs";

const ALG = "aes-256-gcm";
const IV_BYTES = 12;   // GCM standard
const TAG_BYTES = 16;

// ★★★ CT-062 — THE CLOSED PURPOSE LIST. `purpose` is folded into the AAD (`buildAad`, below), so a
// typo in a purpose string produces a secret that decrypts under NOTHING ever again — the failure
// surfaces months later, at the worst possible time. A frozen, closed set turns that typo into an
// immediate, loud throw instead of a silent, unrecoverable one. ★ CC-5: the three purposes tests
// used that no production code did ("resend", "stripe", "documenso") are RENAMED to members of this
// set, never added to it — a frozen set that grows to fit a fixture is not frozen.
export const SECRET_PURPOSES = Object.freeze(new Set([
  "webhook_hmac",
  "google_refresh_token",
  "n8n_service",
  "stripe_connect_account",
  "mailbox_microsoft",
  "calendar_microsoft",
  "totp_secret",
  // QUEUE §23.3.4 — the Documents island's own secrets (an organisation's SMTP password), held in keystone.document_secret
  "document_smtp_password",
  // shared document engine (design §6) — a workspace's own AI provider key, held in keystone.document_ai_secret
  "document_ai_key",
  // Run 9 Part 4.4 — a workspace's data key for its stored document files, held in keystone.workspace_file_key
  "workspace_file_key",
]));

/** ★ Throws by NAME — a purpose is not a secret, so it is safe (and useful) to print. */
function assertKnownPurpose(purpose) {
  if (!SECRET_PURPOSES.has(purpose)) {
    throw new Error(`unknown secret purpose ${JSON.stringify(purpose)} — must be one of: ${[...SECRET_PURPOSES].join(", ")}`);
  }
}

// ★ CT-063 — the key IDENTIFIER lives here (moved from src/webhooks/outbound.mjs:51, which keeps its
// own copy until Stage 9 task 9.7 deletes it and imports this one; both coexist for one stage). `v: 1`
// on the envelope is a FORMAT version and never changes; this is the KEK generation, tracked per row
// by the storing table's own `kek_version` column and by `keystone_meta.kek_version` (migration 0212).
// ★★★ BUMPED 1 → 2, 24 Sep 2026 — `keystone-master-key` rotation (a raw value was printed to a tool
// result mid-session and immediately self-flagged; rotating is the correct response even though
// nothing outside this session ever saw it). MUST deploy together with setting
// `KEYSTONE_MASTER_KEY_PREVIOUS` to the OLD key value first — see envelope.mjs's own
// `loadMasterKey` header: version 2 reads `KEYSTONE_MASTER_KEY` (the new value), and every row still
// at `kek_version = 1` falls through to `KEYSTONE_MASTER_KEY_PREVIOUS` (the old value) until
// `rewrapSecrets`/`rewrap_secrets` (src/secrets/rewrap.mjs, task 9.12) moves it to version 2.
// ★★★ BUMPED 2 → 3, 22 Oct 2026 — the security rotation after the 20 Oct exposure. Deploy together with the new KEYSTONE_MASTER_KEY and the OLD value in KEYSTONE_MASTER_KEY_PREVIOUS;
// scripts/rotate/rewrap-kek.mjs then re-wraps every stored data key (all eight envelope columns, not only the five REWRAP_TABLES) and the previous key is removed. While both keys are set,
// openSecret() tries the key for the stated version first and the other key second, so a row whose version label is stale (a NULL, or a row mid-sweep) still opens.
export const CURRENT_KEK_VERSION = 3;

/**
 * Load the master key. ★ Fail loud — never a hardcoded or generated-on-the-fly fallback.
 * ★ `version` selects WHICH key: `CURRENT_KEK_VERSION` reads `KEYSTONE_MASTER_KEY`; any earlier
 * version reads `KEYSTONE_MASTER_KEY_PREVIOUS`, so a KEK can be rotated by (1) setting a new
 * `KEYSTONE_MASTER_KEY`, (2) moving the old value to `KEYSTONE_MASTER_KEY_PREVIOUS`, and (3) leaving
 * every row sealed under the old version openable until it is re-wrapped (9.12).
 */
export function loadMasterKey(env = process.env, { version = CURRENT_KEK_VERSION } = {}) {
  const varName = version === CURRENT_KEK_VERSION ? "KEYSTONE_MASTER_KEY" : "KEYSTONE_MASTER_KEY_PREVIOUS";
  const raw = env[varName];
  if (!raw) {
    throw new Error(
      `${varName} is not set. Refusing to run. ` +
        "A generated-at-startup key would encrypt secrets that no later process can ever read."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${varName} must be 32 bytes base64-encoded (got ${key.length})`);
  }
  return key;
}

/**
 * Encrypt `plaintext` for exactly one tenant and one purpose.
 * ★ `purpose` is part of the AAD too — a Stripe key cannot be decrypted as if it were a Resend key.
 */
export function sealSecret({ plaintext, tenantId, purpose }, { masterKey } = {}) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("sealSecret: refusing to seal an empty secret");
  }
  if (!tenantId || !purpose) throw new Error("sealSecret: tenantId and purpose are required for AAD");
  assertKnownPurpose(purpose);
  const kek = masterKey ?? loadMasterKey();

  // ── the data key ──────────────────────────────────────────────────────────
  const dek = randomBytes(32);
  const aad = buildAad(tenantId, purpose);

  const dIv = randomBytes(IV_BYTES);
  const dCipher = createCipheriv(ALG, dek, dIv);
  dCipher.setAAD(aad);
  const ct = Buffer.concat([dCipher.update(plaintext, "utf8"), dCipher.final()]);
  const dTag = dCipher.getAuthTag();

  // ── wrap the data key with the master key, under the SAME AAD ─────────────
  // ★ The wrap is bound too. Otherwise a DEK could be lifted from tenant A's row and used to
  // unwrap in tenant B's context, and the binding would only be as strong as its weakest layer.
  const kIv = randomBytes(IV_BYTES);
  const kCipher = createCipheriv(ALG, kek, kIv);
  kCipher.setAAD(aad);
  const wrapped = Buffer.concat([kCipher.update(dek), kCipher.final()]);
  const kTag = kCipher.getAuthTag();

  dek.fill(0); // ★ scrub the plaintext DEK from memory as soon as it is wrapped

  return {
    v: 1,
    tenantId,
    purpose,
    ciphertext: ct.toString("base64"),
    iv: dIv.toString("base64"),
    tag: dTag.toString("base64"),
    wrappedKey: wrapped.toString("base64"),
    keyIv: kIv.toString("base64"),
    keyTag: kTag.toString("base64"),
    // ★ A fingerprint for audit/dedup that reveals nothing about the value. ★★ CC-2 — HMAC-SHA-256
    // WITH THE TOKEN PEPPER, not a bare hash: a bare sha-256 of the plaintext is a dictionary an
    // attacker with the ciphertext-adjacent row (but not the pepper) could use to CONFIRM a guessed
    // value offline; keying it with `KEYSTONE_TOKEN_PEPPER` (a different blast radius from the KEK —
    // same reasoning `src/auth/apiToken.mjs` and `src/auth/session.mjs` already apply) closes that.
    // New seals only, no backfill: 0 rows carried the old sha-256 fingerprint when this changed.
    fingerprint: createHmac("sha256", tokenPepper()).update(plaintext, "utf8").digest("hex").slice(0, 16),
  };
}

/**
 * ★ `tenantId` and `purpose` are supplied BY THE CALLER'S CONTEXT, not read from the envelope.
 * Reading them from the stored record would make the AAD self-certifying and therefore useless:
 * an attacker who moved the row would move the claimed tenant with it.
 */
export function openSecret(envelope, { tenantId, purpose, kekVersion = CURRENT_KEK_VERSION } = {}, { masterKey } = {}) {
  if (!envelope || envelope.v !== 1) throw new Error("openSecret: unsupported envelope version");
  if (!tenantId || !purpose) throw new Error("openSecret: tenantId and purpose are required");
  assertKnownPurpose(purpose);
  const aad = buildAad(tenantId, purpose);

  let dek;
  try {
    // ★ The key resolution lives INSIDE this try too now: a missing/short KEYSTONE_MASTER_KEY_PREVIOUS
    // for a row asking for an earlier `kekVersion` is a SecretOpenError, not a crash — the same
    // "one message for every failure mode" reasoning below, extended to "wrong/absent key version".
    // ★ The stated version's key first; during a rotation (both KEYSTONE_MASTER_KEY and KEYSTONE_MASTER_KEY_PREVIOUS set) the other one second. A wrong key can never open a GCM-authenticated wrap,
    //   so trying a second key widens nothing; it only forgives a stale version label.
    // ★★★ D563 — a key that is not configured is skipped, not fatal. A self-host has ONE master key (the file in its data volume) and no
    //     KEYSTONE_MASTER_KEY_PREVIOUS, yet its rows keep the KEK generation they were sealed under (here 2) while the code moved on to 3:
    //     asking for generation 2 threw "KEYSTONE_MASTER_KEY_PREVIOUS is not set" before the current key was ever tried, and the install could no
    //     longer open its own files or secrets after an upgrade (Run 13 soak, Railway self-host, 25 Oct 2026). Now: the stated generation's key
    //     first, then the current one, then the previous one, each only if configured, duplicates dropped; none configured is still an error.
    let tryKeys;
    if (masterKey) tryKeys = [masterKey];
    else {
      tryKeys = [];
      for (const v of [kekVersion, CURRENT_KEK_VERSION, CURRENT_KEK_VERSION - 1]) {
        try { const k = loadMasterKey(process.env, { version: v }); if (!tryKeys.some((x) => x.equals(k))) tryKeys.push(k); } catch { /* not configured on this install */ }
      }
      if (tryKeys.length === 0) tryKeys.push(loadMasterKey(process.env, { version: kekVersion }));   // throws the real reason
    }
    for (const kek of tryKeys) {
      try {
        const kDecipher = createDecipheriv(ALG, kek, Buffer.from(envelope.keyIv, "base64"));
        kDecipher.setAAD(aad);
        kDecipher.setAuthTag(Buffer.from(envelope.keyTag, "base64"));
        dek = Buffer.concat([kDecipher.update(Buffer.from(envelope.wrappedKey, "base64")), kDecipher.final()]);
        break;
      } catch (e) { if (kek === tryKeys[tryKeys.length - 1]) throw e; }
    }
  } catch {
    // ★ One message for every failure mode. Distinguishing "wrong tenant" from "wrong key" from
    // "tampered" would be an oracle.
    throw new SecretOpenError(tenantId, purpose);
  }

  try {
    const dDecipher = createDecipheriv(ALG, dek, Buffer.from(envelope.iv, "base64"));
    dDecipher.setAAD(aad);
    dDecipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const pt = Buffer.concat([dDecipher.update(Buffer.from(envelope.ciphertext, "base64")), dDecipher.final()]);
    return pt.toString("utf8");
  } catch {
    throw new SecretOpenError(tenantId, purpose);
  } finally {
    dek.fill(0);
  }
}

export class SecretOpenError extends Error {
  constructor(tenantId, purpose) {
    super(`could not open secret for tenant=${tenantId} purpose=${purpose}`);
    this.name = "SecretOpenError";
  }
}

function buildAad(tenantId, purpose) {
  return Buffer.from(`keystone:v1:${tenantId}:${purpose}`, "utf8");
}

/**
 * P2.15 capture-at-creation.
 * ★ Throws rather than returning null when a provider gave us a once-only token we failed to
 * persist. A silent null here is unrecoverable: the credential exists at the provider, we cannot
 * read it, and the only remedy is a second credential plus an orphaned first.
 */
export async function captureAtCreation({ tenantId, purpose, value }, persist, opts = {}) {
  if (value == null || value === "") {
    throw new Error(
      `captureAtCreation(${purpose}): the provider returned no value to capture. ` +
        `This token is shown once — failing loudly now is recoverable; storing nothing is not.`
    );
  }
  const envelope = sealSecret({ plaintext: String(value), tenantId, purpose }, opts);
  await persist(envelope);
  return { stored: true, fingerprint: envelope.fingerprint };
}
