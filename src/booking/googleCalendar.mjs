// @ts-check
// src/booking/googleCalendar.mjs — THE GOOGLE CALENDAR CALLS THAT WERE NEVER BUILT (6 Oct 2026).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHY THIS FILE EXISTS. [MEASURED, specs/BOOKING-TEAM-AUDIT-6OCT.md §5] The calendar integration had OAuth *connect* and a
//     sealed refresh token, and then nothing: no access-token refresh, no free/busy, no event insert/patch/delete. Its own
//     seams (`calendarPush.mjs`, the pull and renewal sweeps in `queue/tasks.mjs`) take the provider call as an injected
//     function whose default throws "not wired yet". This file is that call, for Google. It changes no existing signature.
//
// ★★ THE ACCESS TOKEN. A Google connection's refresh token lives sealed on `keystone.google_identity` (purpose
//    `google_refresh_token`), reached through `calendar_connection.google_identity_id`. It is opened here, exchanged for an
//    access token (kept in memory for 50 minutes; never stored, never logged), and an `invalid_grant` marks the identity
//    `reconsent_required` through the existing `markIdentityNeedsReconsent` — the same words the Connect screen already
//    shows. Nothing here ever prints a token.
//
// ★★ OUTSIDE CALLS GO THROUGH `callOutside` (one wrapper, a time limit, no retry, no throw for a provider failure). A failed
//    free/busy read is reported as `{ ok:false }`, never as "nobody is busy": the CALLER decides what a failure means (the
//    slots read shows the slot; the create path books-and-flags — plan §3).
//
// ★ TEST SEAMS, NOT PRODUCTION SWITCHES: `GOOGLE_TOKEN_URL` and `GOOGLE_CALENDAR_API_BASE` redirect the two Google hosts to a
//   stub, honoured only when KEYSTONE_ENVIRONMENT is not "production".
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { withTenant } from "../db/index.mjs";
import { callOutside } from "../http/outside.mjs";
import { openSecret } from "../secrets/envelope.mjs";
import { markIdentityNeedsReconsent } from "../run/grants.mjs";
import { googleClientCredentials } from "./calendarConnect.mjs";

const REFRESH_PURPOSE = "google_refresh_token";
const TOKEN_TTL_MS = 50 * 60_000;
const BUSY_TTL_MS = 2 * 60_000;

/** @type {Map<string,{token:string, until:number}>} */
const tokenCache = new Map();
/** @type {Map<string,{at:number, value:any}>} */
const busyCache = new Map();
export const __caches = { tokenCache, busyCache }; // tests only

function endpoints(env = process.env) {
  const prod = env.KEYSTONE_ENVIRONMENT === "production";
  return {
    token: (!prod && env.GOOGLE_TOKEN_URL) || "https://oauth2.googleapis.com/token",
    api: ((!prod && env.GOOGLE_CALENDAR_API_BASE) || "https://www.googleapis.com/calendar/v3").replace(/\/+$/, ""),
  };
}

/** The Google connections a host has that can be used right now. */
export async function googleConnectionsFor(tx, { tenantId, hostId }) {
  const { rows } = await tx.query(
    `SELECT c.id, c.host_id, c.external_account, c.push_calendar_id, c.event_title_mode, c.google_identity_id,
            gi.refresh_envelope, gi.kek_version, gi.grant_state
       FROM keystone.calendar_connection c
       JOIN keystone.google_identity gi ON gi.id = c.google_identity_id AND gi.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.host_id = $2 AND c.provider = 'google' AND c.status = 'active'
      ORDER BY c.created_at`,
    [tenantId, hostId]);
  return rows;
}

/**
 * An access token for one connection, or `{ ok:false, needsReconnect }`.
 * @param {any} conn  a row from googleConnectionsFor
 */
async function accessTokenFor(tx, { tenantId, conn }, { outside = callOutside, now = Date.now(), env = process.env } = {}) {
  if (conn.grant_state && conn.grant_state !== "usable") return { ok: false, needsReconnect: true, error: "needs to be connected again" };
  const hit = tokenCache.get(conn.id);
  if (hit && hit.until > now) return { ok: true, token: hit.token };
  let refresh;
  try {
    refresh = openSecret(conn.refresh_envelope, { tenantId, purpose: REFRESH_PURPOSE, kekVersion: conn.kek_version });
  } catch {
    return { ok: false, needsReconnect: true, error: "the saved connection could not be opened" };
  }
  let creds;
  try { creds = googleClientCredentials(env); } catch (e) { return { ok: false, needsReconnect: false, error: "Google Calendar is not configured on this server" }; }
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: creds.clientId, client_secret: creds.clientSecret }).toString();
  const r = await outside("google_calendar_refresh", endpoints(env).token,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body }, { timeoutMs: 8_000 });
  if (!r.ok || !r.body?.access_token) {
    const code = String(r.body?.error ?? "");
    if (r.status === 400 || r.status === 401 || /invalid_grant|invalid_client|unauthorized_client/.test(code)) {
      // ★ its OWN transaction: the caller (a push job that is about to fail and be retried) rolls its transaction back, and the one fact worth keeping —
      //   "this person's calendar needs to be connected again" — must survive that.
      await withTenant(tenantId, (tx2) => markIdentityNeedsReconsent(tx2, { tenantId, identityId: conn.google_identity_id, providerError: `refresh refused: ${code || r.status}` }), { userId: null }).catch(() => {});
      return { ok: false, needsReconnect: true, error: "Google no longer accepts this connection" };
    }
    return { ok: false, needsReconnect: false, error: "Google did not answer" };
  }
  tokenCache.set(conn.id, { token: r.body.access_token, until: now + TOKEN_TTL_MS });
  return { ok: true, token: r.body.access_token };
}

/** Calendars whose events block time: the ones marked "counts as busy", else the primary calendar. */
async function busyCalendarIds(tx, { tenantId, connectionId }) {
  const { rows } = await tx.query(
    `SELECT external_calendar_id FROM keystone.calendar_watched_calendar
      WHERE tenant_id = $1 AND connection_id = $2 AND counts_as_busy = true ORDER BY created_at`,
    [tenantId, connectionId]);
  return rows.length ? rows.map((r) => r.external_calendar_id) : ["primary"];
}

/**
 * Busy intervals on one host's connected Google calendars within [from, to).
 * `{ ok:true, busy:[{start:Date,end:Date}], connected:boolean }` — `connected:false` means "no usable connection, so no
 * outside information at all" (the caller treats that as nothing to subtract, not as an error).
 * `{ ok:false }` — a connection exists but Google could not be asked.
 */
export async function busyForHost(tx, { tenantId, hostId, from, to, fresh = false }, deps = {}) {
  const outside = deps.outside ?? callOutside;
  const now = deps.now ?? Date.now();
  const conns = await googleConnectionsFor(tx, { tenantId, hostId });
  if (conns.length === 0) return { ok: true, busy: [], connected: false };
  const key = `${tenantId}|${hostId}|${from.toISOString()}|${to.toISOString()}`;
  const cached = busyCache.get(key);
  if (!fresh && cached && now - cached.at < BUSY_TTL_MS) return cached.value;

  const busy = [];
  let anyFailed = false, anyOk = false;
  for (const conn of conns) {
    const tok = await accessTokenFor(tx, { tenantId, conn }, { outside, now, env: deps.env ?? process.env });
    if (!tok.ok) { anyFailed = true; continue; }
    const ids = await busyCalendarIds(tx, { tenantId, connectionId: conn.id });
    const r = await outside("google_calendar_freebusy", `${endpoints(deps.env ?? process.env).api}/freeBusy`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: ids.map((id) => ({ id })) }),
    }, { timeoutMs: 6_000 });
    if (!r.ok) {
      if (r.status === 401) tokenCache.delete(conn.id);
      anyFailed = true;
      continue;
    }
    anyOk = true;
    for (const cal of Object.values(r.body?.calendars ?? {})) {
      // a calendar Google could not read reports `errors`; that is "unknown", not "free"
      if (Array.isArray(cal?.errors) && cal.errors.length) { anyFailed = true; continue; }
      for (const b of cal?.busy ?? []) {
        const s = new Date(b.start), e = new Date(b.end);
        if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e > s) busy.push({ start: s, end: e });
      }
    }
  }
  const value = anyFailed && !anyOk ? { ok: false, busy: [], connected: true } : { ok: true, busy, connected: true, partial: anyFailed };
  busyCache.set(key, { at: now, value });
  if (busyCache.size > 2000) busyCache.clear();
  return value;
}

/** Does [start, end) widened by the buffers overlap any busy interval? */
export function overlapsBusy(busy, start, end, { bufferBeforeMinutes = 0, bufferAfterMinutes = 0 } = {}) {
  const s = new Date(start.getTime() - bufferBeforeMinutes * 60_000);
  const e = new Date(end.getTime() + bufferAfterMinutes * 60_000);
  return busy.some((b) => s < b.end && b.start < e);
}

// ── events: the booking on the host's calendar ─────────────────────────────────────────────────
async function withToken(tx, { tenantId, conn }, deps) {
  const tok = await accessTokenFor(tx, { tenantId, conn }, deps);
  return tok;
}

/**
 * Create the event for a booking. `video` asks Google to attach a Meet link. Returns `{ ok, eventId, meetUrl }`.
 */
export async function insertEvent(tx, { tenantId, conn, calendarId = null, summary, description, startsAt, endsAt, timeZone, attendeeEmail = null, video = false, requestId }, deps = {}) {
  const outside = deps.outside ?? callOutside;
  const tok = await withToken(tx, { tenantId, conn }, { outside, env: deps.env });
  if (!tok.ok) return { ok: false, error: tok.error, needsReconnect: tok.needsReconnect };
  const cal = encodeURIComponent(calendarId || conn.push_calendar_id || "primary");
  const body = {
    summary, description,
    start: { dateTime: startsAt.toISOString(), timeZone },
    end: { dateTime: endsAt.toISOString(), timeZone },
    ...(attendeeEmail ? { attendees: [{ email: attendeeEmail }] } : {}),
    ...(video ? { conferenceData: { createRequest: { requestId: String(requestId ?? Date.now()), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
    reminders: { useDefault: true },
  };
  const q = `?conferenceDataVersion=${video ? 1 : 0}&sendUpdates=none`;
  const r = await outside("google_calendar_insert", `${endpoints(deps.env ?? process.env).api}/calendars/${cal}/events${q}`, {
    method: "POST", headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body),
  }, { timeoutMs: 10_000 });
  if (!r.ok) return { ok: false, error: `Google answered ${r.status ?? "nothing"}` };
  return { ok: true, eventId: r.body?.id ?? null, meetUrl: r.body?.hangoutLink ?? null, etag: r.body?.etag ?? null };
}

export async function patchEvent(tx, { tenantId, conn, calendarId = null, eventId, startsAt, endsAt, timeZone }, deps = {}) {
  const outside = deps.outside ?? callOutside;
  const tok = await withToken(tx, { tenantId, conn }, { outside, env: deps.env });
  if (!tok.ok) return { ok: false, error: tok.error };
  const cal = encodeURIComponent(calendarId || conn.push_calendar_id || "primary");
  const r = await outside("google_calendar_patch", `${endpoints(deps.env ?? process.env).api}/calendars/${cal}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
    method: "PATCH", headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ start: { dateTime: startsAt.toISOString(), timeZone }, end: { dateTime: endsAt.toISOString(), timeZone } }),
  }, { timeoutMs: 10_000 });
  return r.ok ? { ok: true, etag: r.body?.etag ?? null } : { ok: false, error: `Google answered ${r.status ?? "nothing"}` };
}

export async function deleteEvent(tx, { tenantId, conn, calendarId = null, eventId }, deps = {}) {
  const outside = deps.outside ?? callOutside;
  const tok = await withToken(tx, { tenantId, conn }, { outside, env: deps.env });
  if (!tok.ok) return { ok: false, error: tok.error };
  const cal = encodeURIComponent(calendarId || conn.push_calendar_id || "primary");
  const r = await outside("google_calendar_delete", `${endpoints(deps.env ?? process.env).api}/calendars/${cal}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
    method: "DELETE", headers: { authorization: `Bearer ${tok.token}` },
  }, { timeoutMs: 10_000 });
  // 404/410 = already gone: the goal (no event) is met
  return r.ok || r.status === 404 || r.status === 410 ? { ok: true } : { ok: false, error: `Google answered ${r.status ?? "nothing"}` };
}
