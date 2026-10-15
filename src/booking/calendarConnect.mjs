// @ts-check
// Task 3a.2 — CALENDAR OAUTH CONNECT/DISCONNECT + SYNC-DIRECTION WRITES.
// Spec: specs/03-engagements/03a-calendar-and-sync.md §2 (routes), §3 (data), §4 (permissions),
// §6 (outside services), §8 (secrets and config).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EVERY ROUTE THIS MODULE BACKS IS SELF-SCOPED, NEVER ANOTHER COACH'S. §2's own row for the
//     load route says it plainly: `(session's own host id, always — never another coach's)`. §4:
//     "Coach may act only on own `host_id` rows... an APPLICATION check here, never RLS alone,
//     because RLS in this codebase is deliberately tenant-only." `ownedConnection()` below is that
//     check, on every function that touches an existing connection row.
//   ★★ `CalendarTeam`'s cross-coach view (`GET /api/engagements/calendar/team`, Owner/Admin only,
//      status-only) is a DIFFERENT route in §2's table, out of this task's scope — no function here
//      is called with any `hostId` other than the caller's own `principal.appUserId`.
//
// ★★★ THE OAUTH `state` PARAMETER IS SIGNED, NOT OPAQUE. It carries the tenant and host id that
//     started the flow so the callback can verify the redirect actually belongs to the session that
//     asked for it (CSRF-class refusal per §2's own error row), using the same
//     `KEYSTONE_TOKEN_PEPPER`-keyed HMAC pattern `src/auth/linkToken.mjs:177-178` already
//     establishes — a local `pepper()` copy, by this codebase's own established convention (every
//     token-shaped module keeps its own rather than sharing one import site).
//
// ★★ GOOGLE'S SCOPE LIST IS TWO SCOPES WIDER THAN §6 NAMES, AND THAT IS REPORTED HERE, NOT HIDDEN.
//    §6 names exactly `calendar.readonly` and `calendar.events`. Neither carries identity, and
//    `upsertGoogleIdentity` (`src/run/grants.mjs:62`) has a hard, pre-existing requirement for
//    `googleSubject` (the OIDC `sub`) — with no scope that returns one, the call cannot be made at
//    all. `openid`/`email` are added so the token exchange's `id_token` carries `sub`/`email`. This
//    is an OAuth SCOPE LIST, not a new grant, a new table or a new SQL function — not the class of
//    invention `03a §3`'s subscribe-token gap (F664) forbids — and it is called out explicitly in
//    this task's own build report rather than assumed silently.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createHmac } from "node:crypto";
import { callOutside } from "../http/outside.mjs";
import { sealSecret, CURRENT_KEK_VERSION } from "../secrets/envelope.mjs";
import { upsertGoogleIdentity } from "../run/grants.mjs";
import { invalid, dependency, notFound } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // ★ an OAuth round trip is seconds, not hours

/** ★ Local copy of `linkToken.mjs`'s pepper() — this codebase's own convention, not shared. */
function pepper() {
  const p = process.env.KEYSTONE_TOKEN_PEPPER;
  if (!p) throw new Error("calendarConnect: KEYSTONE_TOKEN_PEPPER is not set");
  return p;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE SIGNED `state` PARAMETER.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function signCalendarOAuthState({ tenantId, hostId, provider }) {
  if (!tenantId || !hostId || !provider) {
    throw new Error("signCalendarOAuthState needs tenantId, hostId and provider");
  }
  const payload = Buffer.from(
    JSON.stringify({ tenantId, hostId, provider, iat: Date.now() }), "utf8").toString("base64url");
  const sig = createHmac("sha256", pepper()).update(payload, "utf8").digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify + decode. Throws `invalid` (CSRF-class refusal, §2's own wording) on any mismatch. */
export function verifyCalendarOAuthState(state, { provider, maxAgeMs = STATE_MAX_AGE_MS } = {}) {
  const BAD = "that connection link has expired or was not started from Calendar settings. Reconnect from there.";
  if (typeof state !== "string" || !state.includes(".")) throw invalid(BAD);
  const [payload, sig] = state.split(".");
  const expected = createHmac("sha256", pepper()).update(payload, "utf8").digest("base64url");
  if (sig.length !== expected.length || sig !== expected) throw invalid(BAD);
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw invalid(BAD); }
  if (!decoded?.tenantId || !decoded?.hostId || decoded?.provider !== provider) throw invalid(BAD);
  if (typeof decoded.iat !== "number" || Date.now() - decoded.iat > maxAgeMs) throw invalid(BAD);
  return { tenantId: decoded.tenantId, hostId: decoded.hostId };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SCOPES, CLIENT CREDENTIALS, AUTHORIZE URLS. §6/§8.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const GOOGLE_CALENDAR_SCOPES = Object.freeze([
  "openid", "email", // ★ identity only — see the file header note
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
]);

// ★ §6 — the exact string quoted in the spec: "Calendars.ReadWrite offline_access openid".
const MICROSOFT_CALENDAR_SCOPES = Object.freeze(["Calendars.ReadWrite", "offline_access", "openid"]);

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * §8 — REUSES the existing platform OAuth client, Secret Manager `example-oauth-client-id` /
 * `example-oauth-client-secret` (project `the project secret store`). These two env var names are this task's
 * own naming choice for how that pair reaches the process (no prior reader exists anywhere in
 * `src/` — MEASURED, ground truth §1.1) — mirrors the Microsoft pair's naming below. Wiring the
 * actual Railway env var from Secret Manager is deploy-time work, not this BUILD task's.
 */
export function googleClientCredentials(env = process.env) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw dependency(
      "Google Calendar is not configured yet. GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not set.");
  }
  return { clientId, clientSecret };
}

/** §8 — new Secret Manager entries, exact names quoted there: MICROSOFT_GRAPH_OAUTH_CLIENT_ID/_SECRET. */
export function microsoftClientCredentials(env = process.env) {
  const clientId = env.MICROSOFT_GRAPH_OAUTH_CLIENT_ID;
  const clientSecret = env.MICROSOFT_GRAPH_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw dependency(
      "Outlook Calendar is not configured yet. " +
      "MICROSOFT_GRAPH_OAUTH_CLIENT_ID/MICROSOFT_GRAPH_OAUTH_CLIENT_SECRET are not set.");
  }
  return { clientId, clientSecret };
}

export function buildGoogleAuthorizeUrl({ clientId, redirectUri, state }) {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline"); // ★ request a refresh token
  u.searchParams.set("prompt", "consent");      // ★ §6 — "ask for everything up front", one consent
  u.searchParams.set("state", state);
  return u.toString();
}

export function buildMicrosoftAuthorizeUrl({ clientId, redirectUri, state }) {
  const u = new URL(MICROSOFT_AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MICROSOFT_CALENDAR_SCOPES.join(" "));
  u.searchParams.set("state", state);
  return u.toString();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TOKEN EXCHANGE. §2's callback rows: `dependency` on a provider refusal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function decodeJwtPayload(idToken) {
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { return null; }
}

/** Returns `{ refreshToken, googleSubject, googleEmail }`. Throws `dependency` on any refusal. */
export async function exchangeGoogleCode({ code, redirectUri, clientId, clientSecret, fetchImpl = fetch }) {
  const out = await callOutside("google_calendar_token", GOOGLE_TOKEN_URL, {
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
    // ★ access_type=offline + prompt=consent should always return one on a fresh consent; the real
    //   case this catches is Google withholding it on an already-granted consent.
    throw dependency(
      "Google did not return a refresh token for this connection. Remove Workbench's access in your " +
      "Google account (myaccount.google.com/permissions) and reconnect to force a fresh consent.");
  }
  const claims = decodeJwtPayload(out.body?.id_token) ?? {};
  if (!claims.sub) throw dependency("Google's response did not identify the account. Try reconnecting.");
  return { refreshToken, googleSubject: claims.sub, googleEmail: claims.email ?? null };
}

/** Returns `{ refreshToken, accountEmail }`. Throws `dependency` on any refusal. */
export async function exchangeMicrosoftCode({ code, redirectUri, clientId, clientSecret, fetchImpl = fetch }) {
  const out = await callOutside("microsoft_calendar_token", MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
      scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    }).toString(),
  }, { fetchImpl });
  if (!out.ok) {
    throw dependency(
      `Microsoft did not accept the connection (${out.body?.error ?? out.status ?? "unreachable"}).`, out.body);
  }
  const refreshToken = out.body?.refresh_token;
  if (!refreshToken) {
    throw dependency("Microsoft did not return a refresh token for this connection. Try reconnecting.");
  }
  const claims = decodeJwtPayload(out.body?.id_token) ?? {};
  const accountEmail = claims.preferred_username ?? claims.email ?? null;
  if (!accountEmail) throw dependency("Microsoft's response did not identify the account. Try reconnecting.");
  return { refreshToken, accountEmail };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE DATABASE WRITES. `tx` is always the tenant-scoped transaction — same contract `emit()` and
// `src/run/grants.mjs` already enforce (P15B.2a).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ★ §3/§8 — Microsoft's refresh token is sealed directly on `calendar_connection`, purpose
//   `calendar_microsoft` (already a member of `SECRET_PURPOSES`, zero prior writers before this).
const MICROSOFT_SECRET_PURPOSE = "calendar_microsoft";

/** §3 — Google rides the EXISTING `google_identity` consent; upsert it, then upsert the connection row. */
export async function connectGoogleConnection(tx, { tenantId, hostId, googleSubject, googleEmail, refreshToken }) {
  const identity = await upsertGoogleIdentity(tx, {
    tenantId, googleSubject, googleEmail, scopes: GOOGLE_CALENDAR_SCOPES, refreshToken,
  });
  const { rows } = await tx.query(
    `INSERT INTO keystone.calendar_connection
       (tenant_id, host_id, provider, external_account, google_identity_id, status, last_error)
     VALUES ($1, $2, 'google', $3, $4, 'active', NULL)
     ON CONFLICT (tenant_id, host_id, provider, external_account) DO UPDATE
        SET google_identity_id = EXCLUDED.google_identity_id, status = 'active', last_error = NULL
     RETURNING id, provider, external_account, status`,
    [tenantId, hostId, googleEmail, identity.id]);
  return rows[0];
}

/** §3 — Microsoft gets its own sealed token directly on this table. */
export async function connectMicrosoftConnection(tx, { tenantId, hostId, accountEmail, refreshToken }) {
  const envelope = sealSecret({ plaintext: refreshToken, tenantId, purpose: MICROSOFT_SECRET_PURPOSE });
  const { rows } = await tx.query(
    `INSERT INTO keystone.calendar_connection
       (tenant_id, host_id, provider, external_account, refresh_envelope, kek_version, token_fingerprint,
        status, last_error)
     VALUES ($1, $2, 'microsoft', $3, $4, $5, $6, 'active', NULL)
     ON CONFLICT (tenant_id, host_id, provider, external_account) DO UPDATE
        SET refresh_envelope = EXCLUDED.refresh_envelope, kek_version = EXCLUDED.kek_version,
            token_fingerprint = EXCLUDED.token_fingerprint, status = 'active', last_error = NULL
     RETURNING id, provider, external_account, status`,
    [tenantId, hostId, accountEmail, envelope, CURRENT_KEK_VERSION, envelope.fingerprint]);
  return rows[0];
}

/** §2`s load route — this coach`s own connections + their watched calendars. Never another coach's. */
export async function listConnections(tx, { tenantId, hostId }) {
  const { rows: connections } = await run(tx, db
    .selectFrom("keystone.calendar_connection")
    .select(["id", "provider", "external_account", "status", "push_calendar_id", "event_title_mode", "last_error", "last_renewed_at"])
    .where("tenant_id", "=", tenantId)
    .where("host_id", "=", hostId)
    .where("status", "<>", "revoked")
    .orderBy("created_at", "asc"));
  if (connections.length === 0) return [];
  const ids = connections.map((c) => c.id);
  const { rows: watched } = await tx.query(
    `SELECT connection_id, external_calendar_id, display_name, counts_as_busy
       FROM keystone.calendar_watched_calendar
      WHERE tenant_id = $1 AND connection_id = ANY($2::uuid[])
      ORDER BY display_name NULLS LAST, external_calendar_id`,
    [tenantId, ids]);
  return connections.map((c) => ({
    id: c.id,
    provider: c.provider,
    externalAccount: c.external_account,
    status: c.status,
    lastError: c.last_error,
    lastRenewedAt: c.last_renewed_at,
    pushCalendarId: c.push_calendar_id,
    eventTitleMode: c.event_title_mode,
    watchedCalendars: watched
      .filter((w) => w.connection_id === c.id)
      .map((w) => ({
        externalCalendarId: w.external_calendar_id,
        displayName: w.display_name,
        countsAsBusy: w.counts_as_busy,
      })),
  }));
}

/** ★ §4's own app-level ownership check — every write below runs this first. */
async function ownedConnection(tx, { tenantId, hostId, connectionId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.calendar_connection")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("host_id", "=", hostId)
    .where("id", "=", connectionId)
    .where("status", "<>", "revoked"));
  return rows[0] ?? null;
}

/**
 * §2/§3 — Disconnect. `calendar_event_map` rows deleted FIRST (no push-side history lingers
 * referencing a dead credential), then the connection moves to `'revoked'` — never deleted, so
 * `this coach used to sync Google, then stopped` stays answerable.
 */
export async function disconnectConnection(tx, { tenantId, hostId, connectionId }) {
  const row = await ownedConnection(tx, { tenantId, hostId, connectionId });
  if (!row) throw notFound(`not this coach's connection`);
  await run(tx, db
    .deleteFrom("keystone.calendar_event_map")
    .where("tenant_id", "=", tenantId)
    .where("connection_id", "=", connectionId));
  await run(tx, db
    .updateTable("keystone.calendar_connection")
    .set({ status: "revoked" })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", connectionId));
  return { id: connectionId };
}

export async function setWatchedCalendars(tx, { tenantId, hostId, connectionId, watched }) {
  const row = await ownedConnection(tx, { tenantId, hostId, connectionId });
  if (!row) throw notFound(`not this coach's connection`);
  if (!Array.isArray(watched)) throw invalid("watched must be a list of {externalCalendarId, countsAsBusy}");
  for (const w of watched) {
    if (!w?.externalCalendarId) throw invalid("each watched calendar needs an externalCalendarId");
    await tx.query(
      `INSERT INTO keystone.calendar_watched_calendar
         (tenant_id, connection_id, external_calendar_id, counts_as_busy)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (connection_id, external_calendar_id) DO UPDATE
          SET counts_as_busy = EXCLUDED.counts_as_busy`,
      [tenantId, connectionId, w.externalCalendarId, w.countsAsBusy !== false]);
  }
  const { rows } = await tx.query(
    `SELECT external_calendar_id, display_name, counts_as_busy
       FROM keystone.calendar_watched_calendar
      WHERE tenant_id = $1 AND connection_id = $2
      ORDER BY display_name NULLS LAST, external_calendar_id`,
    [tenantId, connectionId]);
  return {
    connectionId,
    watchedCalendars: rows.map((w) => ({
      externalCalendarId: w.external_calendar_id, displayName: w.display_name, countsAsBusy: w.counts_as_busy,
    })),
  };
}

export async function setPushTarget(tx, { tenantId, hostId, connectionId, pushCalendarId }) {
  const row = await ownedConnection(tx, { tenantId, hostId, connectionId });
  if (!row) throw notFound(`not this coach's connection`);
  await run(tx, db
    .updateTable("keystone.calendar_connection")
    .set({ push_calendar_id: pushCalendarId ?? null })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", connectionId));
  return { connectionId, pushCalendarId: pushCalendarId ?? null };
}

const EVENT_TITLE_MODES = Object.freeze(["session_only", "client_first_name"]);

export async function setEventTitleMode(tx, { tenantId, hostId, connectionId, mode }) {
  const row = await ownedConnection(tx, { tenantId, hostId, connectionId });
  if (!row) throw notFound(`not this coach's connection`);
  if (!EVENT_TITLE_MODES.includes(mode)) throw invalid(`mode must be one of: ${EVENT_TITLE_MODES.join(", ")}`);
  await run(tx, db
    .updateTable("keystone.calendar_connection")
    .set({ event_title_mode: mode })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", connectionId));
  return { connectionId, mode };
}
