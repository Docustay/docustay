// Task 6.6 — EMAIL MAILBOX OAUTH CONNECT/DISCONNECT. 06-settings.md §2.8, §6, §8, §10 item 4.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIS IS THE FIRST REAL CALLER OF `upsertGoogleIdentity()` AND `resolveSender()`'s SIBLING
//     WRITER `upsertSenderIdentity()` FOR A MAILBOX-SENDING CONSENT. `src/run/grants.mjs` and
//     `src/email/senders.mjs` are reused EXACTLY as already built — no signature change, no rename
//     (06-settings.md §11) — this module only calls them; it does not edit either file.
//
// ★★★ SAME OAUTH CLIENT AS CALENDAR AND GROWTH, DELIBERATELY REUSED. §6: "Account: the existing
//     per-tenant Google OAuth client already used for Gmail-sending and Growth
//     (example-oauth-client-id/example-oauth-client-secret, Secret Manager) ... CT-114's correction
//     already established this exact client is reused, not new." `googleClientCredentials()` is
//     imported from `src/booking/calendarConnect.mjs`, which already reads the two env var names
//     this client's credentials arrive under — not duplicated here.
//
// ★★ AND THE SAME "EVERY TOKEN-SHAPED MODULE KEEPS ITS OWN STATE SIGNER" CONVENTION
//    `calendarConnect.mjs`'s own header states: a local `pepper()` copy and a local signed `state`,
//    not a shared import site. Mailbox connect is TENANT-scoped, not host-scoped (there is no
//    `host_id` on `google_identity` or `sender_identity` — §2.8's own "ZONE 1 is ANY USER'S OWN
//    mailbox` is a practice-wide mailbox everyone sees, unlike a coach's own calendar), so the`
//    signed state here carries only `tenantId`, never a host id.
//
// ★★ THE SCOPE LIST IS TWO SCOPES WIDER THAN §6 NAMES, FOR THE EXACT REASON
//    `calendarConnect.mjs:22-29` ALREADY REPORTS FOR THE SAME PROBLEM: §6 names exactly
//    `GMAIL_SENDER_SCOPES` (`src/run/blocked.mjs`) — `gmail.settings.basic` and `gmail.send` —
//    and neither carries identity. `upsertGoogleIdentity()` has a hard, pre-existing requirement
//    for `googleSubject` (the OIDC `sub`); with no scope that returns one, the call cannot be made
//    at all. `openid`/`email` are added HERE, at the authorize-URL/state-storage layer, so the
//    token exchange's `id_token` carries `sub`/`email` — `GMAIL_SENDER_SCOPES` itself is untouched
//    and still exported unchanged from `blocked.mjs` for every existing reader (the consent-screen
//    disclosure text, the enumeration gate). This is an OAuth SCOPE LIST decision, reported here
//    rather than assumed silently, same as calendar's.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createHmac } from "node:crypto";
import { callOutside } from "../http/outside.mjs";
import { invalid, dependency } from "../http/errors.mjs";
import { googleClientCredentials } from "../booking/calendarConnect.mjs";
import { upsertGoogleIdentity } from "../run/grants.mjs";
import { GMAIL_SENDER_SCOPES } from "../run/blocked.mjs";
import { enumerateGoogleSendAs } from "./senders.mjs";
import { upsertSenderIdentity } from "./writes.mjs";

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // ★ an OAuth round trip is seconds, not hours

/** ★ Local copy of `linkToken.mjs`'s / `calendarConnect.mjs`'s pepper() — this codebase's own
 *  per-module convention, not shared. */
function pepper() {
  const p = process.env.KEYSTONE_TOKEN_PEPPER;
  if (!p) throw new Error("mailboxConnect: KEYSTONE_TOKEN_PEPPER is not set");
  return p;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SIGNED `state` PARAMETER — tenant-scoped, never host-scoped. See file header.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function signMailboxOAuthState({ tenantId }) {
  if (!tenantId) throw new Error("signMailboxOAuthState needs a tenantId");
  const payload = Buffer.from(
    JSON.stringify({ tenantId, iat: Date.now() }), "utf8").toString("base64url");
  const sig = createHmac("sha256", pepper()).update(payload, "utf8").digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify + decode. Throws `invalid` (CSRF-class refusal, §2.8's own wording). */
export function verifyMailboxOAuthState(state, { maxAgeMs = STATE_MAX_AGE_MS } = {}) {
  const BAD = "that connection link has expired or was not started from Email settings. Reconnect from there.";
  if (typeof state !== "string" || !state.includes(".")) throw invalid(BAD);
  const [payload, sig] = state.split(".");
  const expected = createHmac("sha256", pepper()).update(payload, "utf8").digest("base64url");
  if (sig.length !== expected.length || sig !== expected) throw invalid(BAD);
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw invalid(BAD); }
  if (!decoded?.tenantId) throw invalid(BAD);
  if (typeof decoded.iat !== "number" || Date.now() - decoded.iat > maxAgeMs) throw invalid(BAD);
  return { tenantId: decoded.tenantId };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SCOPES, AUTHORIZE URL, TOKEN EXCHANGE. §6/§8.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★★★ `GMAIL_SENDER_SCOPES` PLUS IDENTITY — see file header. Stored on `google_identity.scopes`
 *   exactly as authorized, so a re-consent with this same set upserts the same row rather than
 *   creating a second live refresh token (`grants.mjs`'s own sort-before-storage rule). */
const MAILBOX_CONNECT_SCOPES = Object.freeze(["openid", "email", ...GMAIL_SENDER_SCOPES]);

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export function buildMailboxAuthorizeUrl({ clientId, redirectUri, state }) {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", MAILBOX_CONNECT_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline"); // ★ request a refresh token
  u.searchParams.set("prompt", "consent");      // ★ one consent, everything up front
  u.searchParams.set("state", state);
  return u.toString();
}

function decodeJwtPayload(idToken) {
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { return null; }
}

/** Returns `{ refreshToken, accessToken, googleSubject, googleEmail }`. Throws `dependency` on
 *  any provider refusal — §2.8's callback row: "on failure: 302 back with ?connectError=". */
export async function exchangeMailboxCode({ code, redirectUri, clientId, clientSecret, fetchImpl = fetch }) {
  const out = await callOutside("google_mailbox_token", GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }).toString(),
  }, { fetchImpl });
  if (!out.ok) {
    throw dependency(
      `Google did not accept the connection (${out.body?.error ?? out.status ?? "unreachable"}).`, out.body);
  }
  const refreshToken = out.body?.refresh_token;
  if (!refreshToken) {
    throw dependency(
      "Google did not return a refresh token for this connection. Remove Workbench's access in your " +
      "Google account (myaccount.google.com/permissions) and reconnect to force a fresh consent.");
  }
  const claims = decodeJwtPayload(out.body?.id_token) ?? {};
  if (!claims.sub) throw dependency("Google's response did not identify the account. Try reconnecting.");
  return {
    refreshToken, accessToken: out.body?.access_token ?? null,
    googleSubject: claims.sub, googleEmail: claims.email ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE DATABASE WRITES. `tx` is always the tenant-scoped transaction (P15B.2a).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * §2.8/§11 — upserts the ONE consent (`upsertGoogleIdentity`, unchanged), then enumerates
 * `sendAs` and upserts a `sender_identity` row per address Google reports (`upsertSenderIdentity`,
 * unchanged) so Zone 1's address list and Zone 2's picker have real rows to show, not an empty
 * list right after a fresh connect.
 *   ★ Enumeration failing (e.g. the flag flipped off mid-flow) does not lose the consent that was
 *     just granted — the identity row is already committed by the time enumeration runs, and the
 *     caller decides what to tell the browser. Callers that need this to be all-or-nothing pass
 *     their own transaction.
 */
export async function connectMailbox(tx, { tenantId, googleSubject, googleEmail, refreshToken, accessToken }) {
  const identity = await upsertGoogleIdentity(tx, {
    tenantId, googleSubject, googleEmail, scopes: MAILBOX_CONNECT_SCOPES, refreshToken,
  });
  let addresses = [];
  if (accessToken) {
    addresses = await enumerateGoogleSendAs(tenantId, accessToken);
    for (const a of addresses) {
      await upsertSenderIdentity(tx, {
        tenantId, email: a.email, displayName: a.displayName,
        googleIdentityId: identity.id, origin: "enumerated", kind: a.kind,
      });
    }
  }
  return { identityId: identity.id, addressCount: addresses.length };
}

/**
 * §2.8 — "Disconnect" / idempotent (a 200, not an error, on an already-disconnected mailbox, the
 * same idiom `revokeApiToken` uses). ★ Marks the identity `withdrawn` — never `revoked`, the same
 * distinction `grants.mjs`'s own `markIdentityNeedsReconsent` draws between Google refusing us and
 * us choosing to stop. This function records only OUR withdrawal.
 */
export async function disconnectMailbox(tx, { tenantId }) {
  const { rows } = await tx.query(
    `UPDATE keystone.google_identity
        SET grant_state = 'withdrawn', withdrawn_at = now()
      WHERE tenant_id = $1
        AND grant_state <> 'withdrawn'
        AND id IN (
          SELECT DISTINCT google_identity_id FROM keystone.sender_identity
           WHERE tenant_id = $1 AND google_identity_id IS NOT NULL
        )
      RETURNING id`,
    [tenantId]);
  return { disconnected: true, identityId: rows[0]?.id ?? null };
}
