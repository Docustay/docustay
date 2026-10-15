// Task 3a.2 — CALENDAR OAUTH CONNECT ROUTES (Google/Outlook) + SYNC-DIRECTION WRITES.
// Spec: specs/03-engagements/03a-calendar-and-sync.md §2 (routes), §4 (permissions), §5 (events).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EVERY ROUTE HERE IS A COACH'S OWN SURFACE. §4: "Coach may act only on own `host_id` rows —
//     an APPLICATION check, never RLS alone." So every handler below is host-scoped to
//     `principal.appUserId`, and the ownership check lives inside `src/booking/calendarConnect.mjs`
//     (`ownedConnection`), never re-derived here. Owner/Admin cross-coach viewing is `CalendarTeam`
//     (§2's own separate row), out of this task's scope — nothing here accepts a caller-chosen
//     `hostId`.
//
// ★★★ NOT MOUNTED UNDER `guarded()`/`authoriseSection`, ON PURPOSE. `src/routes/settings.mjs`'s
//     `guarded()` keys its authorisation on a NAV ROW (`authoriseSection(user, navPath, …)`), and
//     this task deliberately does not add one — `FEATURES-COMBINED-PLAN.md` §0.4's cross-spec
//     file-overlap table does not list spec 03a among the specs permitted to touch
//     `src/nav/sections.mjs` or `src/nav/buildState.mjs` (grepped: none of 03a's five tasks touch
//     either file). So authorisation here is the standalone floor `atLeastRank(user, 'coach')`
//     (`src/nav/authorise.mjs:164`, no nav-row dependency) plus the host-ownership check inside the
//     write functions — exactly §4's stated design, not a nav-row substitute for it.
//
// ★★★ THE OAUTH CALLBACK RUNS THROUGH THE ORDINARY SESSION DOOR, NOT A TENANT-LESS ONE.
//     `GET …/connect/:provider` is requested by the coach's own authenticated browser, on the same
//     origin the tenant subdomain serves; Google/Microsoft redirect the SAME browser back to
//     `…/callback` on that SAME origin, so the session cookie is present on both legs and
//     `runTenantScoped` resolves the principal exactly as it does for any other authenticated GET.
//     The signed `state` parameter is not the SOURCE of tenant context here — the session already
//     supplies that — it is the CSRF-class check that the callback belongs to the flow that started
//     it (§2's own error row: "invalid (state mismatch/expired)"), verified against the resolved
//     principal's own `tenantId`/`appUserId` below.
//   ★★ THIS IS A DELIBERATE, REPORTED DESIGN DECISION, NOT A GUESS: nothing in §2/§4/§6 states how
//      tenant context reaches the callback, and per-tenant-subdomain redirect URIs mean each
//      practice's OAuth round trip returns to `https://<slug>.<domain>/api/engagements/calendar/
//      connect/<provider>/callback` — the provider's OWN redirect-URI allowlist must therefore admit
//      either a wildcard or every practice subdomain, an OAuth-console/DNS configuration concern
//      outside this BUILD task (same class as the Azure AD app registration §6 already flags as not
//      yet created). Called out explicitly in this task's own build report.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { atLeastRank } from "../nav/authorise.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { invalid, forbidden } from "../http/errors.mjs";
import {
  signCalendarOAuthState, verifyCalendarOAuthState,
  googleClientCredentials, microsoftClientCredentials,
  buildGoogleAuthorizeUrl, buildMicrosoftAuthorizeUrl,
  exchangeGoogleCode, exchangeMicrosoftCode,
  connectGoogleConnection, connectMicrosoftConnection,
  listConnections, disconnectConnection,
  setWatchedCalendars, setPushTarget, setEventTitleMode,
} from "../booking/calendarConnect.mjs";
import { listRemoteChanges, acceptRemoteChange, rejectRemoteChange } from "../booking/calendarSync.mjs";
import { found, publicOrigin } from "../http/redirect.mjs";

/** ★ Same origin the browser is already on — see the file header note on why this, not a config var. */
function originOf(c) {
  return publicOrigin(c);
}

/** ★ Where the browser lands after either leg of the flow finishes (frame's own screen path). */
const SETTINGS_PATH = "/settings/calendar";

function landingUrl(origin, { connected, provider, error } = {}) {
  const u = new URL(SETTINGS_PATH, origin);
  if (connected) u.searchParams.set("connected", provider);
  if (error) u.searchParams.set("calendar_error", error);
  return u.toString();
}


/** ★ Is this provider's OAuth client set on this server? (Never returns the values.) The Calendar screen hides Connect when it is not. */
function providerConfigured(read) {
  try { read(); return true; } catch { return false; }
}

/** ★ A connect or callback leg must never answer a raw JSON error page to a browser navigation: any failure lands back on the Calendar screen with a plain message. */
async function landOnScreen(c, run, { origin, notConfiguredKey }) {
  try {
    return await run();
  } catch (e) {
    const msg = String(e?.message ?? "");
    if (/not configured yet/i.test(msg)) return found(landingUrl(origin, { error: notConfiguredKey }));
    if (/redirect_uri_mismatch/i.test(msg)) return found(landingUrl(origin, { error: "redirect_uri_mismatch" }));
    if (e?.status === 401 || e?.status === 403 || e?.kind === "unauthorized" || e?.kind === "forbidden") throw e;
    return found(landingUrl(origin, { error: "something_went_wrong" }));
  }
}

/** ★ Every write below emits the SAME shape: `calendar` section, `calendar_connection` subject,
 *  the `settings.changed` audit reuse §5 names (CT-105 pattern — no new AUDIT_ACTIONS member). */
async function recordConnectionChange(db, { tenantId, appUserId, connectionId, topic, action }) {
  await emit(db, {
    tenantId, topic, emittedBy: "calendar",
    subjectType: "calendar_connection", subjectId: connectionId,
    actor: userActor(appUserId),
    payload: { connectionId },
  });
  await writeAudit(db, {
    tenantId, action: "settings.changed", object: "calendar.connection",
    subjectId: connectionId, actorUserId: appUserId, reason: null,
  });
}

export function registerCalendarRoutes(app, { runTenantScoped }) {
  /** ★ The one floor every route here shares — see the file header. */
  const requireCoach = (ctx) => atLeastRank(ctx.principal.user, "member");

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — GET /api/engagements/calendar/connections
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/calendar/connections", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      const connections = await listConnections(ctx.db, {
        tenantId: ctx.tenantId, hostId: ctx.principal.appUserId,
      });
      // ★★★ F664 (findings register) — `calendar_subscribe_token`'s access layer (the SECURITY
      //     DEFINER lookup function `calendar_subscribe_token_resolve`) has no exact SQL specified
      //     anywhere in 03a §3 beyond prose. Minting/resetting the link and the `.ics` fetch route
      //     are NOT built by this task (see this task's own build report). `subscribeLink` is
      //     therefore honestly reported as unavailable rather than a fabricated URL.
      return { connections, subscribeLink: null, providersConfigured: { google: providerConfigured(googleClientCredentials), microsoft: providerConfigured(microsoftClientCredentials) } };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — GET /api/engagements/calendar/connect/google  (redirect to Google's consent screen)
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/calendar/connect/google", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      return landOnScreen(c, async () => {
      if (!(await flagIsOn(ctx.db, "google_calendar_enabled", ctx.tenantId))) {
        return found(landingUrl(originOf(c), { error: "google_calendar_disabled" }));
      }
      const { clientId } = googleClientCredentials();
      const origin = originOf(c);
      const state = signCalendarOAuthState({
        tenantId: ctx.tenantId, hostId: ctx.principal.appUserId, provider: "google",
      });
      const url = buildGoogleAuthorizeUrl({
        clientId, state,
        redirectUri: `${origin}/api/engagements/calendar/connect/google/callback`,
      });
      return found(url);
      }, { origin: originOf(c), notConfiguredKey: "google_not_configured" });
    }, { bucket: "api" }));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — GET /api/engagements/calendar/connect/google/callback  ?code=&state=
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/calendar/connect/google/callback", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      return landOnScreen(c, async () => {
      const origin = originOf(c);
      const code = c.req.query("code");
      const stateRaw = c.req.query("state");
      if (c.req.query("error")) {
        return found(landingUrl(origin, { error: "google_declined" }));
      }
      let verified;
      try {
        verified = verifyCalendarOAuthState(stateRaw, { provider: "google" });
      } catch {
        return found(landingUrl(origin, { error: "invalid_state" }));
      }
      // ★★★ THE STATE MUST MATCH THE SESSION THAT STARTED THE FLOW — see file header. Not a
      //     tolerant "close enough": a mismatched tenant or host is exactly the CSRF §2 refuses.
      if (verified.tenantId !== ctx.tenantId || verified.hostId !== ctx.principal.appUserId) {
        return found(landingUrl(origin, { error: "invalid_state" }));
      }
      if (!code) return found(landingUrl(origin, { error: "invalid_state" }));

      const { clientId, clientSecret } = googleClientCredentials();
      let exchanged;
      try {
        exchanged = await exchangeGoogleCode({
          code, clientId, clientSecret,
          redirectUri: `${origin}/api/engagements/calendar/connect/google/callback`,
        });
      } catch {
        return found(landingUrl(origin, { error: "google_unreachable" }));
      }
      const row = await connectGoogleConnection(ctx.db, {
        tenantId: ctx.tenantId, hostId: ctx.principal.appUserId,
        googleSubject: exchanged.googleSubject, googleEmail: exchanged.googleEmail,
        refreshToken: exchanged.refreshToken,
      });
      await recordConnectionChange(ctx.db, {
        tenantId: ctx.tenantId, appUserId: ctx.principal.appUserId, connectionId: row.id,
        topic: "calendar.connection.connected", action: "settings.changed",
      });
      return found(landingUrl(origin, { connected: "google" }));
      }, { origin: originOf(c), notConfiguredKey: "google_not_configured" });
    }, { bucket: "api" }));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — GET /api/engagements/calendar/connect/microsoft  (redirect to Microsoft's consent screen)
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/calendar/connect/microsoft", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      return landOnScreen(c, async () => {
      if (!(await flagIsOn(ctx.db, "outlook_calendar_enabled", ctx.tenantId))) {
        return found(landingUrl(originOf(c), { error: "outlook_calendar_disabled" }));
      }
      const { clientId } = microsoftClientCredentials();
      const origin = originOf(c);
      const state = signCalendarOAuthState({
        tenantId: ctx.tenantId, hostId: ctx.principal.appUserId, provider: "microsoft",
      });
      const url = buildMicrosoftAuthorizeUrl({
        clientId, state,
        redirectUri: `${origin}/api/engagements/calendar/connect/microsoft/callback`,
      });
      return found(url);
      }, { origin: originOf(c), notConfiguredKey: "outlook_not_configured" });
    }, { bucket: "api" }));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — GET /api/engagements/calendar/connect/microsoft/callback  ?code=&state=
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/calendar/connect/microsoft/callback", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      return landOnScreen(c, async () => {
      const origin = originOf(c);
      const code = c.req.query("code");
      const stateRaw = c.req.query("state");
      if (c.req.query("error")) {
        return found(landingUrl(origin, { error: "microsoft_declined" }));
      }
      let verified;
      try {
        verified = verifyCalendarOAuthState(stateRaw, { provider: "microsoft" });
      } catch {
        return found(landingUrl(origin, { error: "invalid_state" }));
      }
      if (verified.tenantId !== ctx.tenantId || verified.hostId !== ctx.principal.appUserId) {
        return found(landingUrl(origin, { error: "invalid_state" }));
      }
      if (!code) return found(landingUrl(origin, { error: "invalid_state" }));

      const { clientId, clientSecret } = microsoftClientCredentials();
      let exchanged;
      try {
        exchanged = await exchangeMicrosoftCode({
          code, clientId, clientSecret,
          redirectUri: `${origin}/api/engagements/calendar/connect/microsoft/callback`,
        });
      } catch {
        return found(landingUrl(origin, { error: "microsoft_unreachable" }));
      }
      const row = await connectMicrosoftConnection(ctx.db, {
        tenantId: ctx.tenantId, hostId: ctx.principal.appUserId,
        accountEmail: exchanged.accountEmail, refreshToken: exchanged.refreshToken,
      });
      await recordConnectionChange(ctx.db, {
        tenantId: ctx.tenantId, appUserId: ctx.principal.appUserId, connectionId: row.id,
        topic: "calendar.connection.connected", action: "settings.changed",
      });
      return found(landingUrl(origin, { connected: "microsoft" }));
      }, { origin: originOf(c), notConfiguredKey: "outlook_not_configured" });
    }, { bucket: "api" }));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — POST /api/engagements/calendar/watched-calendars  {connectionId, watched:[…]}
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/engagements/calendar/watched-calendars", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      return setWatchedCalendars(ctx.db, {
        tenantId: ctx.tenantId, hostId: ctx.principal.appUserId,
        connectionId: ctx.body.connectionId, watched: ctx.body.watched,
      });
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — POST /api/engagements/calendar/push-target  {connectionId, pushCalendarId}
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/engagements/calendar/push-target", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      return setPushTarget(ctx.db, {
        tenantId: ctx.tenantId, hostId: ctx.principal.appUserId,
        connectionId: ctx.body.connectionId, pushCalendarId: ctx.body.pushCalendarId,
      });
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — POST /api/engagements/calendar/event-title-mode  {connectionId, mode}
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/engagements/calendar/event-title-mode", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      return setEventTitleMode(ctx.db, {
        tenantId: ctx.tenantId, hostId: ctx.principal.appUserId,
        connectionId: ctx.body.connectionId, mode: ctx.body.mode,
      });
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 — POST /api/engagements/calendar/disconnect  {connectionId}
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/engagements/calendar/disconnect", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      const result = await disconnectConnection(ctx.db, {
        tenantId: ctx.tenantId, hostId: ctx.principal.appUserId, connectionId: ctx.body.connectionId,
      });
      await recordConnectionChange(ctx.db, {
        tenantId: ctx.tenantId, appUserId: ctx.principal.appUserId, connectionId: result.id,
        topic: "calendar.connection.disconnected", action: "settings.changed",
      });
      return { disconnected: true };
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ★ TASK 3a.6 (spec 03a §2, F686) — THE REMOTE-CHANGES CONFLICT QUEUE.
  //   `?hostId=` follows `CalendarBusy`'s OWN established shape (§2's row: "self by default; Owner/
  //   Admin may pass another coach's id"), including its EXACT `forbidden` wording, so a coach
  //   passing someone else's id gets the same denial the rest of this spec already uses — not a
  //   newly invented message.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ★★★ TWO LIVE BUGS FIXED HERE, 25 Sep 2026. BOTH MEASURED, BOTH IN THIS ONE FOUR-LINE FUNCTION.
  //     Found by the task building the hours routes, which read this as a model and declined to
  //     copy it.
  //
  //  1. ★★★ `ctx.req` DID NOT EXIST. `runTenantScoped` hands handlers
  //     `handler({ db, c, principal, body, tenantId })` (`src/http/app.mjs:857`) — there is no
  //     `req` key on it. So `ctx.req.query("hostId")` threw
  //     `Cannot read properties of undefined (reading 'query')` and
  //     `GET /api/engagements/calendar/remote-changes` answered **500 on EVERY call**, for every
  //     role, with or without a `hostId`. The Hono context is reached as `ctx.c.req`, which is what
  //     `src/routes/scheduling.mjs:43` already does for the identical job.
  //
  //  2. ★★★ THE RANK CHECK WAS INVERTED, AND IT IS THE HOUSE SPECIALITY: A GUARD THAT FIRES WHEN
  //     IT SHOULD NOT. `atLeastRank` (`src/nav/authorise.mjs:164-171`) **THROWS** on refusal and
  //     returns **`undefined`** on success — it does not return a boolean. So `!atLeastRank(…)` is
  //     `!undefined` → `true` **whenever the caller DOES hold the rank**, and the function threw
  //     "You can only view your own calendar." at precisely the Owners and Admins who are allowed
  //     to look. A caller WITHOUT the rank never reached that line, because `atLeastRank` had
  //     already thrown its own refusal. Net effect: **nobody could ever read another host's
  //     calendar** — the whole team-calendar capability was dead, and it failed CLOSED, which is
  //     why it looked like correct security instead of a defect.
  //   ★★ `atLeastRank` IS CALLED FOR ITS THROW, NEVER FOR ITS VALUE — and its refusal is
  //      translated rather than passed through, because the comment above is a real constraint:
  //      this spec deliberately uses ONE wording for this denial, and `atLeastRank`'s own
  //      "requires admin or higher" is a different sentence that would leak the rank ladder into a
  //      message about whose calendar you may read. The catch is narrow by construction —
  //      `atLeastRank` throws `forbidden` and nothing else.
  function resolveHostId(ctx) {
    const requested = ctx.c.req.query("hostId");
    if (!requested || requested === ctx.principal.appUserId) return ctx.principal.appUserId;
    try {
      atLeastRank(ctx.principal.user, "admin");
    } catch {
      throw forbidden("You can only view your own calendar.");
    }
    return requested;
  }

  // §2 — GET /api/engagements/calendar/remote-changes  ?hostId=
  app.get("/api/engagements/calendar/remote-changes", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      const hostId = resolveHostId(ctx);
      return listRemoteChanges(ctx.db, { tenantId: ctx.tenantId, hostId });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // §2 — POST /api/engagements/calendar/remote-changes/accept  {bookingId, externalEventId}
  app.post("/api/engagements/calendar/remote-changes/accept", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      return acceptRemoteChange(ctx.db, {
        tenantId: ctx.tenantId, bookingId: ctx.body.bookingId, externalEventId: ctx.body.externalEventId,
        actorUserId: ctx.principal.appUserId,
      });
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // §2 — POST /api/engagements/calendar/remote-changes/reject  {bookingId, externalEventId}
  app.post("/api/engagements/calendar/remote-changes/reject", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      return rejectRemoteChange(ctx.db, {
        tenantId: ctx.tenantId, bookingId: ctx.body.bookingId, externalEventId: ctx.body.externalEventId,
        actorUserId: ctx.principal.appUserId,
      });
    }, { bucket: "write" }).then((r) => c.json(r, 200)));
}
