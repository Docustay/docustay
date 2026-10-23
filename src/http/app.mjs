// P12.2 / P12.7 / P12.8 / P12.9 / P12.16 — THE HONO APPLICATION AND THE MIDDLEWARE CHAIN.
//
// ★★★ THE FIRST HTTP SERVER THIS PROJECT HAS EVER HAD. [MEAS 2026-09-12, before this file]
// zero `createServer`, zero `.listen(`, zero routes, zero `fetch(` in src/. The 26 gates were
// the only caller — every one of them opened a raw pg.Client and called the modules directly.
// Nothing ever needed a server, so nothing built one, and every phase closed green.
//
// ★★ NO EXPRESS — AND NOT FOR THE REASON §D1 GAVE. §D1 banned Express because "Express 4's error
// handling swallows async rejections". [DOC expressjs.com/en/guide/error-handling, 2026-09-12]
// EXPRESS 5 AUTO-FORWARDS REJECTED PROMISES to error middleware, so that sentence is true of a
// version you would not install and false of the one you would — a ban whose stated reason is
// false invites its own reversal. The reasons that actually hold, both measured:
//   · Express 5.2.1 resolves to 63 transitive packages against a runtime whose entire dependency
//     list is `pg` + `zod`. [EXECUTED] hono@4.13.7 and @hono/node-server@2.1.1 declare ZERO
//     dependencies between them — 2 packages, 0 transitive.
//   · it ships CommonJS with no `exports` map, against "type": "module".
//
// ★★★ EVERY ROUTE GOES THROUGH src/paths/index.mjs. The four path functions are
// transport-agnostic — (descriptor, fn) => Promise — and take no req/res, so the adapter is not
// an obstacle. A route that opens its own pg.Client is the defect the tenant-predicate lint
// exists to catch (P12.14).

import { reportError } from "../product/posthog.mjs";
import { googleSignInConfig } from "./googleConfig.mjs";
import { botCheckPublicConfig } from "./turnstile.mjs";
import { isMailConfigProblem, alertMailConfig, MAIL_DOWN_MESSAGE } from "../health/configAlert.mjs";
import { indexingGuard } from "./indexing.mjs";
import { securityHeaders } from "./securityHeaders.mjs";
import { bodiless, methodIndex, specMethodIndex, allowHeader } from "./methodGuard.mjs";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { metricsMiddleware, metricsResponse } from "../observability/metrics.mjs";
import { publicStatus } from "../health/publicStatus.mjs";
// ★ P17.2 — the front end. serveStatic reads from disk relative to process.cwd(), which is /app
//   in the image; the shell is read through readShell() below so a missing bundle says so.
import { serveStatic } from "@hono/node-server/serve-static";
// ★★★ THE MIGRATION BOUNDARY, DECLARED ONCE (src/nav/stillOnReact.mjs) AND READ BY BOTH SIDES.
//     This server serves the REACT shell for these paths; the Svelte app refuses to draw them and
//     says why. A path in one list and not the other is a screen that either 404s or lies.
import { readFile } from "node:fs/promises";

import {
  handleBrowserRequest, handleApiTokenRequest, NoTenantContext,
} from "../paths/index.mjs";
import {
  toAppError, resolveRequestId, unauthenticated, forbidden, notFound, rateLimited, invalid,
  AppError, ErrorKind, configurationStatement, jsonBodyFault,
} from "./errors.mjs";
import { checkIpLimit, checkTenantLimit, sweepIpWindows, checkSharedIpLimit, sharedBucketOf, ipLimitFor } from "./rateLimit.mjs";
import { requireIdempotencyKey, fingerprint, withIdempotency } from "./idempotency.mjs";
import { trustedClientIp, defaultTrustedHops, isPrivateAddress } from "./trustedIp.mjs";
import { customHostGuard } from "./customHost.mjs";
import { healthz, readyz } from "../health/index.mjs";
import { healthDeps, defaultWorkerBeatAge } from "../health/probes.mjs";
import {
  authoriseSuperAdminRequest, isSuperAdminRoute, isElevationRequest, loadSuperAdmins,
} from "../superadmin/namespace.mjs";
import { registerRoutes, tenantIsPlatform } from "../routes/index.mjs";
// ★★★ CT-119 (spec 03b §2.2/§4.2, task 3b.2) — `runSignerScoped`'s own two primitives. `withTenant`
//   is the SAME function every authenticated route already opens its transaction through (spec 03b
//   §4.2 step 3); `redeemLinkToken` is the tenant-less redemption spec 03b's Q7-2 signer routes
//   already call (`src/routes/writes.mjs:36`) — imported here, not redefined.
import { withTenant } from "../db/index.mjs";
import { redeemLinkToken, peekLinkToken } from "../auth/linkToken.mjs";
// ★ 7.23 — `WRITE_ROUTES` is read for the route's DECLARED object/action (7.1's inventory), which is
//   the ceiling half of `scopes ∩ ceiling`. This file edits nothing in writes.mjs.
import { registerWriteRoutes, WRITE_ROUTES } from "../routes/writes.mjs";
// ★ 7.23 — the developer-API vocabulary (7.21). Imported only; never edited here.
import { ROUTE_SCOPES, NEVER_DELEGABLE, SCOPED_BUT_CLOSED } from "../developer/scopes.mjs";
// ★ P16.11 — the CLIENT APP's read side. One namespace for all three client roles; §K's anti-fork rule
//   applied to the server, so a role difference is expressed by the DATA and never by a second route.
import { registerAppRoutes } from "../routes/app.mjs";
// ★ C2 — CLIENT PORTAL FEATURES: payments (C2.3), profile (C2.5) and messages (C2.6) are all
//   registered inside registerAppRoutes itself now — see the fix notes at that call site.
import { registerDeveloperRoutes } from "../routes/developer.mjs";
import { registerPlatformRoutes } from "../routes/platform.mjs";
// ★ C3.7 — Platform grant access routes. Operator support access management.
import { registerPlatformGrantAccessRoutes } from "../routes/platformGrantAccess.mjs";
import { registerSupportAccessRoutes } from "../routes/supportAccess.mjs";
import { registerPlatformSupportViewRoutes } from "../routes/platformSupportView.mjs";
import { registerPlatformPracticesRoutes } from "../routes/platformPractices.mjs";
import { registerDeviceRoutes } from "../routes/devices.mjs";
import { registerSettingsRoutes } from "../routes/settings.mjs";
import { enforceRequiredTwoStep } from "../auth/requireTwoStep.mjs";
import { registerPromptRoutes } from "../routes/prompts.mjs";
// ★ Task 20.42 — growth templates: list, edit, versions, activate, test-send
import { registerGrowthTemplatesRoutes } from "../routes/growthTemplates.mjs";
// ★ Task 3a.2 (spec 03a §2) — OAuth connect/disconnect + sync-direction writes for calendar sync.
import { registerCalendarRoutes } from "../routes/calendar.mjs";
// ★ Task 13.27b — mount the four Stage-13 route modules built but not yet registered. Real file
//   names measured 25 Sep 2026 (STAGE-13-PLAN.md's names for the files differ; these do not):
//   `registerWaitlistRoutes`/`registerHoursRoutes` from `../routes/engagementsWaitlist.mjs` /
//   `../routes/engagementsHours.mjs` (13.12/13.14, 13.22), `registerCalendarRangeRoutes` from
//   `../routes/engagementsCalendar.mjs` (13.23), `registerBookingReadRoutes` from
//   `../routes/engagementsBooking.mjs` (13.25) — all four take `(app, { runTenantScoped })`, same
//   chain as `registerCalendarRoutes` above.
import { registerWaitlistRoutes } from "../routes/engagementsWaitlist.mjs";
import { registerHoursRoutes } from "../routes/engagementsHours.mjs";
import { registerCalendarRangeRoutes } from "../routes/engagementsCalendar.mjs";
import { registerBookingReadRoutes } from "../routes/engagementsBooking.mjs";
// ★ Task 3b.7 (spec 03b §2.3) — a coach's own persistent booking link (`EngMyLink`).
import { registerBookingLinksRoutes } from "../routes/bookingLinks.mjs";
import { registerTeamBookingAdminRoutes } from "../routes/teamBookingAdmin.mjs";
import { registerPracticeLinksRoutes } from "../routes/practiceLinks.mjs";
import { registerLocationAssignmentRoutes } from "../routes/locationAssignments.mjs";
import { registerSecurityPolicyRoutes } from "../routes/securityPolicy.mjs";
import { registerDocumentTeamRoutes } from "../routes/documentTeams.mjs";
// ★ Task 20.28 — check-in and complete routes for booking session lifecycle.
import { registerBookingLifecycleRoutes } from "../routes/bookingLifecycle.mjs";
// ★★★ Task 3b.7 — WIRING FIX FOR A PRE-EXISTING GAP, NOT THIS TASK'S OWN ROUTE FILE. [MEASURED]
//     `registerPublicBookingRoutes` (task 3b.3's own deliverable, `src/routes/public.mjs`, 9 routes
//     incl. `GET /api/public/book/practice|coach` and `POST /api/public/book`) had ZERO callers
//     anywhere in `src/` — the entire public booking door was unreachable over HTTP. This task's own
//     Done line ("a coach's `EngMyLink` produces a real shareable booking URL that, when visited,
//     redirects to that coach's public booking door") is false unless that door is reachable, so the
//     one-line registration below is added here rather than left for a later task to rediscover.
//     Reported explicitly in this task's own build report — see that file's own header, untouched.
import { registerPublicBookingRoutes } from "../routes/public.mjs";
// ★ Task 13.27b — the public waitlist claim/decline door (13.14). Real export name measured:
//   `registerPublicWaitlistRoutes`, `../routes/public.mjs`, takes `(app)` only — same file as
//   `registerPublicBookingRoutes` above, same no-`runTenantScoped` reasoning (link-token gated,
//   resolves its own tenant).
import { registerPublicWaitlistRoutes } from "../routes/public.mjs";
// ★ Task 16.25 — consent and unsubscribe: the token path, resubscribe, and /go/* registered.
//   Like booking and waitlist above, tenant is resolved from Host header.
import { registerPublicGrowthRoutes } from "../routes/public.mjs";
// ★ Task 15.34 — the public money routes (invoices, estimates, cards, payment links, gift cards).
//   Like booking and waitlist above, tenant is resolved from link token or Host header.
import { registerPublicMoneyRoutes } from "../routes/publicMoney.mjs";
// ★ lead-intake brief, 30 Sep 2026 — the public lead-intake door (GET .../options, POST .../leads),
//   mounted the same way as the public routes above: tenant resolved from the Host header, no
//   runTenantScoped. The one addition this door needs that none of the others did is real CORS,
//   registered inside the module itself (the website that calls it is a separate deployment).
import { registerPublicLeadsRoutes } from "../routes/publicLeads.mjs";
import { registerPublicBookingS2SRoutes } from "../routes/publicBookingS2S.mjs";
import { registerDocustayContactRoutes } from "../routes/docustayContact.mjs";
import { isLeadFormCrossOriginAllowed } from "./publicCorsAllowlist.mjs";
// ★ site-readiness brief, Part 3, 1 Oct 2026 — the platform's own Privacy/Terms/DPA pages.
import { registerLegalRoutes } from "../routes/legal.mjs";
// ★ C3.4 — Payer groups list, create, and member management routes.
import { registerPayerGroupsRoutes } from "../routes/payerGroups.mjs";
// ★ Task 15.33 — Money staff routes (read surfaces for invoices, payments, subscriptions, etc.)
import { registerMoneyRoutes } from "../routes/money.mjs";
// ★ Task 12.2 — practice locations routes.
import { registerLocationRoutes } from "../routes/locations.mjs";
// ★ Task 12.3 — scheduling routes.
import { registerSchedulingRoutes } from "../routes/scheduling.mjs";
// ★ Task 12.7 — network (referral partner) routes.
import { registerNetworkRoutes } from "../routes/network.mjs";
// ★ Task 12.10 — people record routes.
import { registerPeopleRecordRoutes } from "../routes/peopleRecord.mjs";
// ★ Reports home dashboard route. Assembles money, work and people stats from existing views.
import { registerReportsRoutes } from "../routes/reports.mjs";
// ★ P20.3 — Task write routes. Creating and snoozing tasks.
import { registerTaskRoutes } from "../routes/tasks.mjs";
// ★★★ Task 14.41 — the Stage 14 route aggregator. Registers every items/documents/notes read and
//   the three public signing routes; the write rows are mounted separately via `writes.mjs`'s
//   `STAGE14_WRITES` spread (imported there, not here — no cycle).
import { registerItemsAndDocumentsRoutes } from "../routes/itemsAndDocuments.mjs";
import { registerSignupRoutes } from "../routes/signup.mjs";
import { demoEnabled } from "../product/demoConfig.mjs";
import { refuseInDemo } from "../product/demo.mjs";
import { registerDemoRoutes } from "../routes/demo.mjs";
import { registerLocalAuthRoutes } from "../routes/localAuth.mjs";
import { localAuthEnabled, signupEmailCodeRequired } from "../auth/localIdentity.mjs";
import { registerWebhookRoutes } from "../routes/webhooks.mjs";
import { registerAutomationsCallbackRoutes } from "../routes/automationsCallback.mjs";
import { registerAuthRoutes } from "../auth/install.mjs";
import { registerQaRoutes } from "../auth/qaSession.mjs";
// ★★★ Task 6.5 (spec 06 §9) — the read-only-after-billing-trouble guard. See its own call site
//     below for exactly where (immediately after the ceiling check, still inside the open tenant
//     transaction, before any mutating handler runs).
import { assertPracticeWritable } from "../billing/guard.mjs";
// ★ 6.14 — every authenticated request records that its session is alive.
// ★ 11.1 — `resolveSession` is the default `resolveOperatorSession` implementation's own call
//   (§5 middleware below): the caller's live grant/tenantless facts come from the session
//   resolver, never from the request.
import { touchSession, resolveSession } from "../auth/session.mjs";
import { enforceIdleSignOut } from "../auth/idleSignOut.mjs";
// ★ Task 9.5 / CT-095 — the one credential scrubber, used by the process logger (the error sink)
//   only. Nothing else in this file changes.
import { scrubSecrets } from "../logging/scrub.mjs";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * ★ Build the app. Dependencies are injected so a gate can drive it in-process with no network —
 *   the same reason `readyz` takes deps. Nothing here reads a global on the hot path.
 */
export function createApp({
  resolvePrincipal,            // (c) => Promise<{tenantId, user, sessionId} | null>   — PHASE 13
  deps = healthDeps(),
  superAdmins = loadSuperAdmins(process.env),
  // ★ 11.1 — the caller's live operator-grant/tenantless facts, read from the session resolver,
  //   never from the request. Injectable so in-process gates keep driving the app with no
  //   database. Default: resolve the presented session and compute both facts from it; when the
  //   resolver finds nothing, { operatorGrantId: null, tenantless: false }.
  resolveOperatorSession = async (sessionId) => {
    const session = await resolveSession(sessionId);
    if (!session) return { operatorGrantId: null, tenantless: false };
    return {
      operatorGrantId: session.operatorGrantId ?? null,
      tenantless: (session.tenantId ?? null) === null,
    };
  },
  ipLimit,                     // { limit, windowMs } — overridable so a gate can drive the edge
  authRoutes,                  // { loginImpl } — the gate injects a stub verifier; the server does not
  // ★ P17.2 — the front end. OFF BY DEFAULT so an in-process gate drives the API with no
  //   filesystem dependency; src/server.mjs turns it on. A gate that had to have a built bundle on
  //   disk to test /api/nav would couple two unrelated things.
  serveFrontEnd = false,
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ the maintainer, 28 Sep 2026 — THE FRONT END IS REACT, AND ONLY REACT. `web/reactdist`. Svelte
  //     (`webui/`, `web/webdist`) is deleted, not kept as a fallback — "there must be one front
  //     end, so nothing can pick between two versions of a screen." `KEYSTONE_STATIC_ROOT`, the
  //     environment-variable switch this default used to defer to, is gone with it: there is
  //     nothing left to switch between, so this is now a plain default with no override.
  //
  //   `readShell()` reads `${staticRoot}/app.html`, and Vite's build writes its SPA fallback under
  //   exactly that name — so the handler below, its no-store header and its fail-loud 503 are all
  //   unchanged by this.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  staticRoot = "./web/reactdist",
  // ★★★ 10b.4 — `authRoot` IS RETIRED. `authui/` (the separate SvelteKit project the parameter
  //     existed for) is deleted; the auth screens are two routes of the SAME bundle `staticRoot`
  //     already points at, and no caller anywhere in the tree ever passed a distinct `authRoot`
  //     [MEASURED 22 Sep 2026: `grep -rn "authRoot" --include="*.mjs"` outside this file, zero
  //     hits]. The login/signup handler below reads `staticRoot` directly.
  //
  // ★★ THE FILENAMES ARE UNCHANGED (`login.html`, `signup.html`) because SvelteKit's adapter-static
  //    writes a prerendered page per route under exactly that name. **So the handler below, its
  //    no-store header and its fail-loud 503 are all untouched.** Only the redundant parameter
  //    is gone; nothing about the serving logic did.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
} = {}) {
  const app = new Hono();

  // ───────────────────────────────────────────────────────────────────────────
  // 1 · REQUEST ID.  ★ resolveRequestId(headers), NOT hono/request-id.
  //     errors.mjs:83 validates length AND charset before echoing an inbound value; Hono's
  //     middleware does not. An unbounded attacker-controlled header echoed into every log line
  //     is a log-injection vector and a storage problem.
  // ───────────────────────────────────────────────────────────────────────────
  app.use("*", async (c, next) => {
    const headers = Object.fromEntries(c.req.raw.headers);
    c.set("requestId", resolveRequestId(headers));
    c.set("headers", headers);
    c.header("x-request-id", c.get("requestId"));
    await next();
  });

  // Part 30 item 0 — HSTS, nosniff, referrer, permissions and framing headers on every response (src/http/securityHeaders.mjs).
  app.use("*", securityHeaders());

  // Search engines: only docustay.app, www and app may be indexed; every other host sends noindex and a disallow-all robots.txt (src/http/indexing.mjs).
  app.use("*", indexingGuard());

  // §25.4 — a hostname a workspace attached serves only the public pages; an unknown host is a 404 (src/http/customHost.mjs)
  app.use("*", customHostGuard());

  // ───────────────────────────────────────────────────────────────────────────
  // 2 · PER-IP RATE LIMIT, on the TRUSTED client address (U28 / P12.8).
  //     ★ Runs before authentication and before any database round trip — a per-IP limiter that
  //       queries Postgres to decide whether to reject is an amplifier, not a limiter.
  //     ★ CT-010 / Q0-15 — mounted on "/api/*", NOT "*". Health probes (/healthz, /readyz, the worker
  //       beat) and the static front end sit outside it, so a monitor polling from one address, or a
  //       page load pulling many assets, can never spend the budget the API depends on.
  //       `clientIp` is set inside it and read by nothing today [MEASURED 21 Sep 2026: one grep hit,
  //       the setter]; a later reader adds its own "*" setter with it.
  // ───────────────────────────────────────────────────────────────────────────
  app.use("/api/*", async (c, next) => {
    const socket = c.env?.incoming?.socket?.remoteAddress;
    const ip = trustedClientIp(c.req.raw.headers, socket);
    c.set("clientIp", ip);
    // the live-screen stream is ONE long-lived request per open tab (a reconnect is one more); it must not spend the budget the API calls depend on — and a 429 on it would silence every live screen
    // A request that carries an API key has its own per-key budget (600 a minute, documented): holding it to the 120 a minute every browser visitor gets would make that budget unreachable from one server. Its own bucket, with a ceiling of twice the key budget so a flood of made-up keys from one address is still stopped.
    if (!(c.req.method === "GET" && c.req.path === "/api/realtime")) {
      const keyed = !ipLimit && /^Bearer\s+(dsk|gl)_/i.test(c.req.header("authorization") ?? "");
      checkIpLimit(keyed ? `${ip}|key` : ip, keyed ? { limit: 1200 } : ipLimit ?? { limit: ipLimitFor() });
    }
    // Part 30 item 14 — sign-in, public signing, download links and public verification also count in a table every instance shares
    const shared = sharedBucketOf(c.req.path, c.req.method);
    if (shared) await checkSharedIpLimit(ip, shared);
    await next();
  });
  // ★ RUN-2 (26 Sep 2026): the public pages (/go/*, /book/*, …) READ clientIp for their form limiter
  //   (src/routes/public.mjs formSubmitLimiter) but sit outside "/api/*", so they always got
  //   undefined. Set it — without the per-IP API budget — for every path the block above missed.
  app.use("*", async (c, next) => {
    if (c.get("clientIp") === undefined) {
      c.set("clientIp", trustedClientIp(c.req.raw.headers, c.env?.incoming?.socket?.remoteAddress));
    }
    await next();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3 · BODY LIMIT.  ★ [EXECUTED, §D1's table] under bare node:http a declared 5 MB body
  //     returns 200 — Node never inspects it. This is one of the eight subsystems Hono supplies
  //     that a hand-rolled router would have had to write, none of them gate-covered.
  // ───────────────────────────────────────────────────────────────────────────
  // ★ FIX, 30 Sep 2026 (lead-intake brief) — MEASURED: an OPTIONS request (a CORS preflight — no
  //   route in this app took cross-origin browser traffic before this brief, so nothing ever sent
  //   one) 500ed on EVERY route: `TypeError: Cannot read private member #state from an object
  //   whose class did not declare it`, thrown inside hono's own bodyLimit middleware
  //   (node_modules/hono/dist/middleware/body-limit/index.js:47, `new Request(...)`) — a
  //   known Hono/Node-undici Request-identity mismatch for a request with no body. A preflight
  //   carries no body to limit, so it is refused here rather than reaching bodyLimit at all.
  // R13-D348: the API takes a whole PDF as base64 in one JSON body (templates/file, detect-fields) and an HTML body of up to 2 MB, so those routes get
  //   room for the biggest file the system accepts (100 MB, base64 is 4/3 of it) or the HTML; the plan's own cap is then checked in words by the upload code.
  //   Everything else keeps 1 MB. The web app's own uploads arrive in parts under 1 MB.
  const limitOf = (maxSize) => bodyLimit({ maxSize, onError: (c) => { const { body } = invalid("request body too large").toResponse(); return c.json({ ...body, error: { ...body.error, requestId: c.get("requestId") } }, 413); } });
  const fileBodyLimit = limitOf(Math.ceil((100 * 1024 * 1024 * 4) / 3) + 256 * 1024), htmlBodyLimit = limitOf(3 * 1024 * 1024);
  const FILE_BODY_ROUTES = /^\/api\/v1\/(templates\/file|documents\/detect-fields)\/?$/, HTML_BODY_ROUTES = /^\/api\/v1\/(templates\/(html|source)|documents|documents\/check|documents\/[^/]+\/revise)\/?$/;
  const bodyLimitMiddleware = bodyLimit({
    maxSize: 1024 * 1024,
    // ★ CT-003 — built from CT-001's own shape (so `retryable` is present), not by hand. `onError` cannot
    //   throw into the sink, so the body is built here; the STATUS is 413, not the 400 `invalid` carries.
    onError: (c) => {
      const { body } = invalid("request body too large").toResponse();
      return c.json({ ...body, error: { ...body.error, requestId: c.get("requestId") } }, 413);
    },
  });
  // a bodiless DELETE hits the same Hono/undici mismatch as OPTIONS (found 7 Oct 2026: every /api/v1 DELETE 500ed) — no content-length and no transfer-encoding means no body to limit
  app.use("*", (c, next) => (bodiless(c) ? next() : (FILE_BODY_ROUTES.test(c.req.path) ? fileBodyLimit : HTML_BODY_ROUTES.test(c.req.path) ? htmlBodyLimit : bodyLimitMiddleware)(c, next)));

  // ───────────────────────────────────────────────────────────────────────────
  // HEALTH — mounted BEFORE auth, and deliberately outside the tenant machinery.
  // ★★ NOT "unchanged" (F2). All four deps are supplied; readyz now fails CLOSED on an absent
  //    probe. See src/health/probes.mjs.
  // ───────────────────────────────────────────────────────────────────────────
  // FP-H4 — Prometheus metrics (off unless KEYSTONE_METRICS_TOKEN is set)
  app.use("*", metricsMiddleware());
  app.get("/metrics", metricsResponse);
  app.get("/healthz", (c) => { const r = healthz(); return c.json(r.body, r.status); });
  // FP-I — the public status page's data: component names and up/down only (15-second cache)
  app.get("/api/public/status", async (c) => { c.header("cache-control", "public, max-age=15"); return c.json(await publicStatus(deps)); });
  // LAUNCH (G6 load test): /readyz runs every check (database, migrations, storage, settings…) and is open to anyone, so a few hundred callers at once starved the API of its database connections. One answer is shared by every caller for 3 seconds; callers that arrive while it is being worked out wait for that same answer (a probe never sees an answer older than 3 s).
  let readyzAt = 0, readyzPending = null, readyzLast = null;
  const sharedReadyz = () => { if (readyzLast && Date.now() - readyzAt < 3000) return Promise.resolve(readyzLast); if (!readyzPending) readyzPending = readyz(deps).then((r) => { readyzLast = r; readyzAt = Date.now(); return r; }).finally(() => { readyzPending = null; }); return readyzPending; };
  app.get("/readyz", async (c) => {
    const r = structuredClone(await sharedReadyz());
    // ★ INFORMATIONAL ONLY, NEVER AFFECTS THE STATUS (a private address here is normal for Railway's own
    //   probes). Answers "does clientIp resolve to a real visitor, or to the proxy?" without printing an
    //   address: with KEYSTONE_TRUSTED_PROXY_HOPS unset on Railway every visitor resolved to Railway's
    //   proxy and ONE rate-limit bucket was shared by the whole world (found 2 Oct 2026). A public caller
    //   (a browser, curl) must read "public"; "private" from a public caller means the hops are wrong.
    const ip = trustedClientIp(c.req.raw.headers, c.env?.incoming?.socket?.remoteAddress);
    r.body.client_ip = { hops: defaultTrustedHops(), resolved: ip ? (isPrivateAddress(ip) ? "private" : "public") : "none" };
    return c.json(r.body, r.status);
  });

  // ★★ 07 §6 — the address the OUTSIDE monitor watches. Reads the newest beat; never touches a tenant.
  app.get("/healthz/worker", async (c) => {
    try {
      const age = await (deps.workerBeatAgeSeconds ?? defaultWorkerBeatAge)();
      if (age === null) return c.json({ status: "never", ageSeconds: null }, 503);
      return c.json({ status: age < 120 ? "ok" : "stale", ageSeconds: age }, age < 120 ? 200 : 503);
    } catch (e) {
      return c.json({ status: "unknown", error: "heartbeat unreadable" }, 503);
    }
  });

  // ★★ 08 §5.0 — THE SIGN-IN PAGE ASKS THE SERVER WHICH FIREBASE PROJECT THIS IS. Vite used to inline the
  //    key at build time, so an image built for staging could never be promoted to production. A Firebase
  //    web API key is a public project identifier (Firebase's own docs), so serving it is not a disclosure.
  app.get("/api/auth/config", (c) => {
    // ★ The deprecated `VITE_FIREBASE_API_KEY` fallback was REMOVED on 17 Sep 2026 (Stage 2, 01
    //   default 8). It existed for one rename, the rename is done — `KEYSTONE_FIREBASE_WEB_API_KEY`
    //   is set on keystone-app — and a fallback nobody takes is a second name for one secret, which
    //   is the duplicate-truth defect F478 is about. The variable is removed from both services in
    //   the same change, so there is no deployment left for the fallback to rescue.
    const projectId = process.env.KEYSTONE_FIREBASE_PROJECT_ID;
    const apiKey = process.env.KEYSTONE_FIREBASE_WEB_API_KEY;
    c.header("Cache-Control", "no-store");
    if ((!projectId || !apiKey) && localAuthEnabled()) return c.json({ data: { mode: "local", selfHost: process.env.KEYSTONE_SELF_HOST === "1", signupCode: signupEmailCodeRequired(), demo: demoEnabled(), ...botCheckPublicConfig() } });   // Batch B — the built-in identity
    if (!projectId || !apiKey) {
      // ★ CT-003 — the same envelope as everything else. ★★ R-5-18 (RULED 21 Sep 2026, Option A): this fixed
      //   sentence is a CONFIGURATION STATEMENT — no SQL, table, vendor key or stack — so it is built with
      //   `configurationStatement()`, the one exemption from 5.1's generic-500 rule, and IS sent. It is also
      //   logged below, as before. `internal`/`dependency`/`timeout` keep the generic message everywhere else.
      const requestId = c.get("requestId") ?? null;
      const appErr = configurationStatement("Sign-in is not configured on this deployment", { requestId });
      console.error(`[${requestId}] ${c.req.method} ${c.req.path} -> 503`, appErr.message);
      return c.json(appErr.toResponse().body, 503);
    }
    return c.json({ data: { firebase: { projectId, apiKey }, signupCode: signupEmailCodeRequired(), demo: demoEnabled(), ...googleSignInConfig(), ...botCheckPublicConfig() } });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3b · SAME-ORIGIN CHECK on every state-changing /api request (CT-020 / Q5-3, RULED 21 Sep 2026).
  //     ★ Refuse ONLY when `Origin` or `Referer` is PRESENT and MISMATCHES the deployment's own origin.
  //       A request carrying NEITHER header passes to the credential check — a server-to-server caller
  //       (a webhook, an API token client) has no browser to forge, and the credential still decides.
  //       `Origin` wins when both are present. An unparseable `Referer` counts as a mismatch.
  //     ★ The own origin is the request's `Host` plus the forwarded protocol — no new environment
  //       variable, so staging works unchanged. Login, logout and signup are all under /api, so they are
  //       inside it. Mounted BEFORE auth (below) so a cross-site POST is refused before any rank check.
  // ───────────────────────────────────────────────────────────────────────────
  app.use("/api/*", async (c, next) => {
    if (MUTATING.has(c.req.method)) {
      const origin = c.req.header("origin");
      const referer = c.req.header("referer");
      if (origin !== undefined || referer !== undefined) {
        const reqUrl = new URL(c.req.url);
        const fwdProto = (c.req.header("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
        const proto = fwdProto === "http" || fwdProto === "https" ? fwdProto : reqUrl.protocol.replace(/:$/, "");
        const host = (c.req.header("host") ?? reqUrl.host).trim().toLowerCase();
        const own = `${proto}://${host}`;
        let presented;
        if (origin !== undefined) {
          presented = origin.trim().toLowerCase();
        } else {
          try { presented = new URL(referer).origin.toLowerCase(); } catch { presented = null; }
        }
        // ★ FIX, 30 Sep 2026 (lead-intake brief) — the ONE named exception. See
        //   publicCorsAllowlist.mjs's own header for why this is a shared list, not a second one.
        if (presented !== own && !(await isLeadFormCrossOriginAllowed(reqUrl.pathname, presented, c))) {
          throw forbidden("cross-site request refused");
        }
      }
    }
    await next();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4 · AUTH — resolve the path descriptor.
  //     ★ PHASE 12 ships the CHAIN; PHASE 13 supplies `resolvePrincipal` (Firebase). Until then
  //       an unauthenticated request is exactly that — refused — which is what P12.13 asserts.
  // ───────────────────────────────────────────────────────────────────────────
  app.use("/api/*", async (c, next) => {
    const principal = resolvePrincipal ? await resolvePrincipal(c) : null;
    c.set("principal", principal);
    await next();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5 · THE PLATFORM NAMESPACE (U14 / P12.16).
  //     ★★★ CHECKED SERVER-SIDE, IN ITS OWN NAMESPACE — "not permission-hidden inside the tenant
  //     app. A tenant admin must not reach it by guessing a URL." It runs BEFORE the handler, so
  //     no platform handler ever executes for a non-platform principal.
  //     ★ {superAdmins} is passed EXPLICITLY. Without the second argument the function reads
  //       process.env — an env dependency the §A2 table used to hide.
  // ───────────────────────────────────────────────────────────────────────────
  app.use("/api/platform/*", async (c, next) => {
    const principal = c.get("principal");
    const path = c.req.path.replace(/^\/api/, "");
    if (!isSuperAdminRoute(path)) throw notFound();

    // ★★★ 11.1 — THE BOOTSTRAP EXEMPTION. The request that asks for elevation cannot itself
    //     require the elevation it grants, so it is let through the namespace guard BEFORE the
    //     platform check runs. No `platformPrincipal` is set — the route does not read one, it
    //     uses `loadSelf` (src/auth/install.mjs:621-625) — and nothing is weakened: the route's
    //     own gate (`openPlatformSession`, src/auth/operatorSession.mjs:92-95) still refuses
    //     without an active grant. This is NOT the two-step request/approve flow becoming
    //     reachable — that path is not built (F740).
    if (isElevationRequest(c.req.method, path)) { await next(); return; }

    // ★ 11.1 — the caller's live operator-grant/tenantless facts, read from the session resolver,
    //   never from the request. Only computed when the principal carries a session token; an
    //   allow-list principal (no tokenId, no tenantId) leaves both at their default and is
    //   unaffected.
    let operatorGrantId = null;
    let tenantless = false;
    if (principal?.tokenId) {
      ({ operatorGrantId, tenantless } = await resolveOperatorSession(principal.sessionId));
    }

    // ★★★ IT THROWS. IT DOES NOT RETURN A DECISION. namespace.mjs:60-62 is explicit —
    //     "Returns the principal, or throws. It never returns a 'denied' object a caller might
    //     ignore." Written as `const d = authorise…(); if (!d.allowed) …` the refusal branch is
    //     UNREACHABLE and the happy path runs for everyone, because the function either threw
    //     (never reaching the if) or returned {subject, namespace} whose `.allowed` is undefined.
    //     [EXECUTED] that mis-wiring produced a 401 from deep inside the handler instead of the
    //     403 U14 requires — a refusal that happened for the wrong reason, in the wrong place.
    //
    // ★★ AND NOTE WHAT IT REFUSES: a principal carrying a `tenantId` is rejected outright —
    //    "a tenant session cannot access the platform namespace … otherwise a compromised tenant
    //    session would be a compromised platform." So a platform principal is a DIFFERENT SHAPE,
    //    not a tenant principal with a flag. That is §A9's "its own route namespace" expressed
    //    in the type.
    const platform = authoriseSuperAdminRequest({ path, principal, operatorGrantId, tenantless }, { superAdmins });
    c.set("platformPrincipal", platform);
    await next();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE ROUTES.
  // ───────────────────────────────────────────────────────────────────────────
  // ★ Auth routes FIRST and OUTSIDE the tenant machinery: /api/auth/login is the one request
  //   that has no session yet, by definition.
  registerAuthRoutes(app, authRoutes ?? {});
  // ★ Test-access brief, 1 Oct 2026 — same "no session yet" reasoning as the auth routes just
  //   above: registered outside runTenantScoped because this route IS what mints the session.
  //   Refuses itself (plain 404) unless KEYSTONE_QA_LOGIN_ENABLED="true" — see that file's header.
  registerQaRoutes(app);
  // ★★★ P17.9 — SIGNUP, AND IT IS REGISTERED HERE FOR THE SAME REASON THE AUTH ROUTES ARE: it is
  //     the one request that has NO TENANT YET, so it cannot go through runTenantScoped (no
  //     session, no principal, no GUC to read). It writes as `app_signup`, its own narrowly-granted
  //     role — see withSignupConnection and migration 0025.
  registerSignupRoutes(app, { runTenantScoped });
  registerDemoRoutes(app, { runTenantScoped });
  registerLocalAuthRoutes(app);   // Batch B — built-in identity + self-host first-run (both off unless the deployment turns them on)
  // ★★★ P8.2 — THE INBOUND WEBHOOK, REGISTERED HERE FOR THE SAME REASON AS THE TWO ABOVE AND ONE
  //     MORE: it has no session, no principal, and **no tenant yet — the tenant is what this path
  //     RESOLVES**, from a signed payload, after verifying the signature. Inside `runTenantScoped`
  //     it could not run at all. See `src/routes/webhooks.mjs` and `paths/index.mjs:118-131`.
  registerWebhookRoutes(app);
  // ★ Task 20.17 — n8n automation callback. Registered outside `runTenantScoped` like webhooks:
  //   no session, no principal; tenant is in the request body; auth is n8n service credential.
  registerAutomationsCallbackRoutes(app);
  registerRoutes(app, { runTenantScoped });
  // ★★★ THE MUTATING ROUTES — P15B.13. Registered through the SAME `runTenantScoped`, which is what
  //     gives every one of them the Idempotency-Key requirement and the stored replay without any
  //     route having to remember. [MEASURED] before this, the application had exactly ONE mutating
  //     route (`/api/signup`), so ten write modules were unreachable over HTTP.
  registerWriteRoutes(app, { runTenantScoped, tenantIsPlatform });
  // ★ The same `scoped` wrapper the CRM read routes use — one request pipeline, not a parallel one.
  // ★ FIX (coordinator, deploy checkpoint, 24 Sep 2026): C2.3's payments routes are now registered
  //   INSIDE registerAppRoutes itself (src/routes/app.mjs), not called separately here — a route
  //   registered from a second call site never entered this function's own tracked route set, so
  //   the nav/route consistency check reported a real, live route as missing and crashed production
  //   on boot. See the note on registerAppPaymentsRoutes. C2.5's profile routes are registered the
  //   same way, inside registerAppRoutes, for the same reason — see the note where its old stub
  //   used to be in src/routes/app.mjs. C2.6's messages routes are registered the same way, inside
  //   registerAppRoutes — see the note in appMessages.mjs (a real client/server path mismatch was
  //   fixed there too, not just the registration site).
  registerAppRoutes(app, { scoped: (c, fn, opts) => runTenantScoped(c, fn, opts).then((r) => c.json(r)) });
  // ★★★ P19.11 — THE DEVELOPER SURFACE, AND THE FIRST BEARER-AUTHENTICATED ROUTES IN THE PROJECT.
  //     `/api/developer/*` is SESSION auth (managing keys is a staff act; a key must never mint a
  //     key) and `/api/v1/*` is BEARER auth. Two regimes, separate handlers — never one handler with
  //     an `if (bearer)`.
  // ★ `tenantIsPlatform` is passed for the SAME reason `registerWriteRoutes` gets it: the platform
  //   namespace is checked first and separately inside `authoriseSection`. P0.4.
  registerDeveloperRoutes(app, { runTenantScoped, tenantIsPlatform });
  registerPlatformRoutes(app, { runTenantScoped, tenantIsPlatform });
  // ★ C3.7 — Platform support access grant routes. Operator-only, no params needed.
  registerPlatformGrantAccessRoutes(app);
  // ★★★ P6.B12 — THE SETTINGS SURFACE, AND THE ROUTE THAT CLOSES `setSetting`'s ZERO CALLERS.
  //     Six form-shaped settings rows read here, and `POST /api/settings` is the first HTTP tap the
  //     tenant setting store has ever had: ten catalogued keys, ten validators, and until this line
  //     not one of them settable from the product. Same wrapper contract as the developer routes —
  //     `runTenantScoped` for the chain, `tenantIsPlatform` because `authoriseSection` checks the
  //     platform namespace first and separately.
  registerSettingsRoutes(app, { runTenantScoped, tenantIsPlatform });
  // ★ Task 20.42 — growth templates: list, edit, versions, activate, test-send
  registerGrowthTemplatesRoutes(app, { runTenantScoped });
  // ★★★ Task 3a.2 (spec 03a §2) — calendar OAuth connect/disconnect + sync-direction writes. Same
  //     `runTenantScoped` chain as every other authenticated route; no `tenantIsPlatform` needed —
  //     this surface is not nav-gated (see `src/routes/calendar.mjs`'s own header for why).
  registerCalendarRoutes(app, { runTenantScoped });
  // ★★★ Task 13.27b — THE FOUR STAGE-13 ROUTE MODULES, MOUNTED. `registerWaitlistRoutes`,
  //     `registerHoursRoutes`, `registerCalendarRangeRoutes`, `registerBookingReadRoutes` existed
  //     with zero callers anywhere in src/ before this line — same "built and wired to nothing"
  //     shape 3b.7's own note above already found once. Same `runTenantScoped` chain as
  //     `registerCalendarRoutes`, no `tenantIsPlatform` — these are nav-gated staff/coach surfaces,
  //     not platform routes.
  registerWaitlistRoutes(app, { runTenantScoped });
  registerHoursRoutes(app, { runTenantScoped });
  registerCalendarRangeRoutes(app, { runTenantScoped });
  registerBookingReadRoutes(app, { runTenantScoped });
  // ★★★ Task 3b.7 (spec 03b §2.3) — `EngMyLink`'s own routes. Same `runTenantScoped` chain, no
  //     `tenantIsPlatform` needed — not nav-gated (see `src/routes/bookingLinks.mjs`'s own header).
  registerBookingLinksRoutes(app, { runTenantScoped });
  registerTeamBookingAdminRoutes(app, { runTenantScoped });
  // ★ Stage 20 §4 (0496) — the practice's SCOPED booking links (admin CRUD; public read is in
  //   `routes/public.mjs`'s `/api/public/book/link`). Same standalone-floor mounting as the line above.
  registerPracticeLinksRoutes(app, { runTenantScoped });
  // ★ Stage 20 §5 (0497) — service-to-location and staff-to-location, the one writer + reader.
  registerLocationAssignmentRoutes(app, { runTenantScoped });
  registerSecurityPolicyRoutes(app, { runTenantScoped });
  registerDocumentTeamRoutes(app, { runTenantScoped });
  // ★ Task 20.28 — check-in and complete for booking lifecycle. Staff routes (coach/admin only).
  registerBookingLifecycleRoutes(app, { runTenantScoped });
  // ★★★ Task 3b.7 — see the import comment above: this call did not exist before this task. §2.2's
  //     public, unauthenticated booking door (task 3b.3) resolves its OWN tenant from the Host
  //     header (CT-117) — it takes no `runTenantScoped` chain, by design (`public.mjs`'s own header).
  registerPublicBookingRoutes(app);
  // ★★★ Task 13.27b — the public waitlist claim/decline door (13.14), mounted the same way 3b.7
  //     mounted `registerPublicBookingRoutes` above: no `runTenantScoped` chain, tenant resolved
  //     from the Host header inside the module itself.
  registerPublicWaitlistRoutes(app);
  // ★ Task 16.25 — consent and unsubscribe: the token path, resubscribe, and /go/* registered.
  //   Mounted the same way: public routes, tenant resolved from Host header, no runTenantScoped.
  registerPublicGrowthRoutes(app);
  // ★ Task 15.34 — public money routes, same pattern as booking and waitlist above: resolves
  //   tenant from link token or Host header, no runTenantScoped.
  registerPublicMoneyRoutes(app);
  // ★ lead-intake brief, 30 Sep 2026 — see the import comment above.
  registerPublicLeadsRoutes(app);
  registerPublicBookingS2SRoutes(app);
  // Part 30 website — the Docustay Contact form (emails the platform address; stores nothing)
  registerDocustayContactRoutes(app);
  // ★ site-readiness brief, Part 3, 1 Oct 2026 — the platform's own legal pages, same no-tenant,
  //   no-runTenantScoped mounting as every other public route above, registered well before the
  //   SPA catch-all further down this function so these three paths are never swallowed by it.
  registerLegalRoutes(app);
  // ★ C3.4 — Payer groups staff routes. Gated through authoriseSection to the money section.
  registerPayerGroupsRoutes(app, { runTenantScoped, tenantIsPlatform });
  // ★ Task 15.33 — Money staff read routes. Invoices, payments, subscriptions, payouts, disputes.
  registerMoneyRoutes(app, { runTenantScoped, tenantIsPlatform });
  // ★ Task 12.35 — mount the four Stage-12 route modules built but not yet registered.
  registerLocationRoutes(app, { runTenantScoped, tenantIsPlatform });
  registerSchedulingRoutes(app, { runTenantScoped, tenantIsPlatform });
  registerNetworkRoutes(app, { runTenantScoped, tenantIsPlatform });
  registerPeopleRecordRoutes(app, { runTenantScoped, tenantIsPlatform });
  // ★ Reports dashboard. Assembles stats from existing report views and queries.
  registerReportsRoutes(app, { runTenantScoped, tenantIsPlatform });
  // ★ P20.3 — Task write routes. Creating and snoozing tasks.
  registerTaskRoutes(app, { runTenantScoped, tenantIsPlatform });
  registerSupportAccessRoutes(app, { runTenantScoped, tenantIsPlatform });
  registerPlatformSupportViewRoutes(app);
  registerPlatformPracticesRoutes(app);
  registerDeviceRoutes(app, { runTenantScoped });
  // ★★★ Task 14.41 — every Stage 14 items/documents/notes read, plus 14.34's three public signing
  //     routes via `runSignerScoped`. The write rows are already in `ROUTES` (writes.mjs's own
  //     `STAGE14_WRITES` spread) and answer through `registerWriteRoutes` below, same as every
  //     other write in this stage's own field-4 note.
  registerItemsAndDocumentsRoutes(app, { runTenantScoped, runSignerScoped, tenantIsPlatform });
  registerPromptRoutes(app, { runTenantScoped }); // ★ Stage 11 task 11.5 — D9 prompts (CT-F01).

  // ───────────────────────────────────────────────────────────────────────────
  // 5b · P17.2 — THE FRONT END. SERVED LAST, SO IT CAN NEVER SHADOW AN API ROUTE.
  //
  // ★★★ THIS DID NOT EXIST, AND ITS ABSENCE IS D-17.2. [MEAS 2026-09-13] zero hits for
  //     `serveStatic`, `index.html`, `sendFile` or `web/dist` anywhere in src/. The server
  //     answered /healthz, /readyz and /api/* and HAD NO `/` ROUTE AT ALL — so a deploy would
  //     have served a working JSON API and nothing a browser could open, and P17.10(a) ("the
  //     served URL returns the shell") would have failed at the last possible moment.
  //
  // ★★ REGISTRATION ORDER IS THE SECURITY PROPERTY HERE. Hono matches in order, so these two
  //    handlers sit AFTER every real route: an `app.get("*")` registered earlier would swallow
  //    /api/nav and answer HTML, and the front end would receive `<!doctype html>` where it
  //    expected JSON — which presents as an inexplicable parse error, not as a routing mistake.
  // ───────────────────────────────────────────────────────────────────────────
  if (serveFrontEnd) {
    // ★ Hashed asset filenames (app-BWRJkYyY.js) are content-addressed, so they are immutable and
    //   safe to cache hard. app.html deliberately is NOT — see below.
    // ★ Hashed asset filenames are content-addressed, so they are immutable and safe to cache hard.
    //   `app.html` deliberately is NOT — see the no-store header below.
    // ★★★ `/webapp/*` IS SVELTEKIT'S `appDir`, AND THE NAME IS NOT ARBITRARY. The React bundle owns
    //     `/assets/*` and the auth screens own `/authapp/*`; a third framework claiming either would
    //     collide, and the failure would be a 200 serving the WRONG BUNDLE'S chunk — which presents
    //     as an inexplicable JavaScript error rather than as a routing mistake.
    app.use("/webapp/*", serveStatic({ root: staticRoot }));
    // ★ `/assets/*` (the React build's route) is retired here at 10b.7 — `web/dist` no longer
    //   exists in the tree. Left UNREGISTERED rather than pointed somewhere harmless, same as
    //   `/authapp/*` above: a route that serves nothing is worse than a 404, because a 404 is
    //   diagnosable.

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ `/fonts/*` AND `/photos/*` — SvelteKit's `static/` DIRECTORY, WHICH HAD **NO ROUTE AT
    //     ALL** AND THEREFORE FELL THROUGH TO THE SPA FALLBACK.
    //
    //   MEASURED 2026-09-16 against the DEPLOYED origin:
    //       GET /fonts/Inter-400-normal.woff2
    //         → HTTP 200 · content-type: text/html · 1,753 bytes · `<!doctype html>`
    //   The file is in the image (`web/webdist/fonts/`, seven woff2, 423KB). It is simply not
    //   reachable: only `/webapp/*` and `/assets/*` were registered, and `app.get("*")` answers
    //   everything else with the shell.
    //
    // ★★★ THE CONSEQUENCE IS THE ONE THIS SESSION KEEPS MEETING, AND IT IS THE THIRD INSTANCE:
    //     **THE ENTIRE SELF-HOSTED TYPE SYSTEM HAS NEVER LOADED A SINGLE FONT FILE.** The
    //     `@font-face` rules are correct and deployed; the browser requests the woff2, receives
    //     `text/html`, rejects it as a font, and silently falls through to the system stack. The
    //     product has been rendering in `system-ui` while every check said Inter was shipped —
    //     because every check asserted the STRING in the stylesheet, never the ASSET over the wire.
    //   ★★ F458 was the same shape (the CSS was right, the ATTRIBUTE was wrong). This is F458 one
    //      layer further out: the CSS is right and the FILE IS NOT SERVED. **"It is in the bundle"
    //      and "a browser can fetch it" are different claims, and only the second one matters.**
    //   ★ `.level3.mjs` now fetches the file itself and checks the byte count and content-type,
    //     which is the only version of this check that could ever have failed.
    //
    // ★ Registered BEFORE the SPA fallback, for the reason stated forty lines above: Hono matches
    //   in order, and `app.get("*")` would otherwise answer a font request with HTML — which is
    //   exactly the defect being fixed.
    // ★ Both are content-addressed by deploy rather than by filename, so they are cached for a day
    //   rather than immutably: a replaced photo must be able to reach a returning browser.
    // ═════════════════════════════════════════════════════════════════════════════════════════
    app.use("/fonts/*", serveStatic({ root: staticRoot }));
    app.use("/photos/*", serveStatic({ root: staticRoot }));
    // §23.5.8 — the embed script a practice puts on its own website (`/embed/docustay.js`); static like fonts, never the SPA shell
    app.use("/embed/*", serveStatic({ root: staticRoot }));

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // MS-19 · THE AUTH SCREENS — SVELTEKIT, PRERENDERED, AND SERVED FROM **THIS SAME ORIGIN**.
    //
    // ★★★ SERVING THEM HERE IS THE WHOLE SECURITY ARGUMENT, NOT A DEPLOYMENT CONVENIENCE.
    //     `ks_session` is a HOST-ONLY HttpOnly cookie (auth/install.mjs — no `Domain=` anywhere in
    //     src/). Because /login is the SAME ORIGIN as the React app, the cookie the server sets on
    //     the sign-in POST is the cookie the app sends back: NO TOKEN IS CARRIED ACROSS A BOUNDARY
    //     and there is nothing for a redirect to leak.
    //   ★ The two alternatives were both worse. A `Domain=.example.com` cookie would transmit
    //     every tenant's session to every other tenant's host and to the marketing service — it
    //     converts a per-tenant boundary into a shared one. A one-time handoff code would mean
    //     minting, expiring and replay-protecting a brand-new credential type. Neither is needed
    //     once the page is same-origin.
    //
    // ★★ REGISTERED **BEFORE** THE SPA FALLBACK, AND THAT ORDERING IS LOAD-BEARING. Hono matches in
    //    order; `app.get("*")` below would otherwise answer /login with the React shell, and the
    //    React shell renders its own login — two sign-in screens for one product, which is exactly
    //    the "two sources of truth" defect this codebase keeps meeting.
    // ═════════════════════════════════════════════════════════════════════════════════════════
    // ★ `/authapp/*` IS RETIRED. The folded auth routes are part of the one Svelte bundle and load
    //   their chunks from `/webapp/*`, which is already served above. The old path is left
    //   UNREGISTERED rather than pointed somewhere harmless: a route that serves nothing is worse
    //   than a 404, because a 404 is diagnosable. ★★ Nothing can be holding a stale reference — the
    //   sign-in HTML is served `no-store` precisely so a cached copy cannot name old chunks.

    for (const [route, file] of [["/login", "login.html"], ["/signup", "signup.html"], ["/setup", "signup.html"]]) {
      app.get(route, async (c) => {
        const html = await readFile(`${staticRoot}/${file}`, "utf8").catch(() => null);
        if (html === null) {
          // ★★ FAIL LOUD AND NAME THE FILE, exactly as the shell handler does. A blank 200 here is
          //    the worst outcome: the deploy looks healthy and nobody can sign in.
          return c.text(
            // ★ "the platform", not the codename: a 503 is a page a customer can land on.
            `The Workbench sign-in screens are not present. Expected ${staticRoot}/${file}. ` +
            `Build them with: cd webreact && npm run build`,
            503
          );
        }
        // ★ no-store on the HTML only — it names hashed asset files, so a cached copy would keep
        //   requesting the previous deploy's chunks. The chunks themselves are immutable.
        c.header("cache-control", "no-store");
        return c.html(html);
      });
    }

    // ★ THE REACT FALLBACK IS RETIRED HERE AT 10b.7. `STILL_ON_REACT` (`src/nav/stillOnReact.mjs`)
    //   was already emptied by the ports that cleared its eight entries, so `STILL_ON_REACT_PATHS`
    //   was `[]` here — this loop was dead code before `web/dist` was even deleted; it is removed
    //   now rather than left iterating nothing. ★ the maintainer, 28 Sep 2026 — Svelte itself is gone, so the
    //   migration boundary `stillOnReact.mjs` existed to coordinate is retired below, not left
    //   pointing at a `Screen.svelte` that no longer exists.

    app.get("*", async (c, next) => {
      const p = c.req.path;
      // ★★★ AN UNMATCHED /api PATH MUST STAY JSON. Falling through to the SPA shell would turn a
      //     404 on a mistyped endpoint into a 200 with an HTML body — and every client error
      //     handler downstream would then report "unexpected token <" instead of "no such route".
      //     next() carries it to app.notFound(), which answers with a real error object.
      if (p.startsWith("/api/") || p === "/healthz" || p === "/readyz") return next();

      // ★★ THE SPA FALLBACK. Every nav row is a real URL the user can bookmark, reload or be deep
      //    linked into — /documents/contracts/templates is a page, not a fragment — so any
      //    non-API GET returns the shell and the client router resolves it.
      //    ★ The SERVER still decides what that shell may then load: the shell immediately calls
      //      /api/nav, which is authorised, and every subsequent read is authorised again (U16).
      //      Serving the shell to an anonymous request leaks nothing; it renders a login form.
      const html = await readShell(staticRoot);
      if (html === null) {
        // ★★ FAIL LOUD AND SAY WHICH FILE. A blank 200 here is the worst outcome: the deploy looks
        //    healthy, the browser shows nothing, and the cause (an image built without the bundle)
        //    is invisible. This names the path it looked in.
        return c.text(
          // ★ "the platform", not the codename: a 503 is a page a customer can land on.
          `The Workbench front end is not present. Expected ${staticRoot}/app.html. ` +
          `Build it with: cd webreact && npm run build`,
          503
        );
      }
      // ★ no-store on the SHELL ONLY. It names the hashed asset files, so a cached shell would go
      //   on requesting the previous deploy's chunks — a stale front end that is invisible to the
      //   staleness checkers because the ASSETS are current. The assets themselves are immutable.
      c.header("cache-control", "no-store");
      return c.html(html);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6 · THE ERROR SINK.
  //     ★★★ `.toResponse()`, NOT `toAppError` ALONE. toAppError returns an AppError OBJECT;
  //     AppError#toResponse() (errors.mjs:59) is what yields {status, body}. A route following
  //     the previous §D1 chain literally would have returned an Error to the transport.
  //     ★ app.onError catches handlers AND middleware, and next() never throws — which is the
  //       property §D1's table credits Hono with.
  // ───────────────────────────────────────────────────────────────────────────
  app.onError((err, c) => {
    if (isMailConfigProblem(err)) {
      const requestId = c.get("requestId");
      const text = scrubSecrets(String(err?.stack || err?.message || err));
      console.error(`[${requestId}] ${c.req.method} ${c.req.path} -> 503 (mail not configured)`, text);
      void alertMailConfig({ requestId, method: c.req.method, path: c.req.path, message: scrubSecrets(String(err?.message ?? err)).slice(0, 400) });
      return c.json({ error: { kind: "dependency", message: MAIL_DOWN_MESSAGE, requestId, retryable: true } }, 503);
    }
    const appErr = jsonBodyFault(err, { method: c.req.method, contentType: c.req.header("content-type"), requestId: c.get("requestId") }) ?? toAppError(err, c.get("requestId"));   // Round 3: a malformed JSON body is a 400, not a 500
    const { status, body } = appErr.toResponse();
    if (status >= 500) {
      // ★ Task 9.5 / CT-095 — 06 §2 names this as a place provider text reaches a log unfiltered.
      //   Scrubbed before it is written; the request line itself never carries a credential.
      const logged = appErr.cause ?? appErr;
      // a provider's parsed error body is a plain object: log the error's own message and the body's text, never "[object Object]" (R13-D182)
      const text = (logged && typeof logged === "object" && (logged.stack || logged.message)) || (logged && typeof logged === "object" ? `${appErr.message} ${JSON.stringify(logged).slice(0, 600)}` : String(logged));
      console.error(
        `[${c.get("requestId")}] ${c.req.method} ${c.req.path} -> ${status}`,
        scrubSecrets(text)
      );
      // ★ PH1 — error tracking: the route PATTERN (never the path with its ids or query), the status, and the scrubbed error. No body, no headers.
      //   Docustay requests only (the app also serves the platform); no workspace id on an error.
      if (/docustay/i.test(c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "")) reportError(logged, { route: c.req.routePath, status });
    }
    // ★ CT-004 — the ONLY place `Retry-After` is written. 5.2 puts the integer on the error.
    if (appErr.retryAfterSeconds != null) c.header("Retry-After", String(appErr.retryAfterSeconds));
    return c.json(body, status);
  });

  const routerMethods = methodIndex(app), specMethods = specMethodIndex(app);   // Run 12: a path that exists answers a method it does not have with 405 and an Allow header (src/http/methodGuard.mjs)
  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api/")) {
      const allow = c.req.path.startsWith("/api/v1/") ? (await specMethods(c.req.path)) ?? [] : routerMethods(c.req.path);
      if (allow.length && !allow.includes(c.req.method)) {
        const { body } = invalid(`${c.req.method} is not supported here; use ${allow.join(", ")}`).toResponse();
        c.header("Allow", allowHeader(allow));
        return c.json({ ...body, error: { ...body.error, kind: "method_not_allowed", requestId: c.get("requestId") } }, 405);
      }
    }
    const { status, body } = notFound(`no route for ${c.req.method} ${c.req.path}`)
      .toResponse();
    return c.json({ ...body, error: { ...body.error, requestId: c.get("requestId") } }, status);
  });

  return app;
}

/**
 * ★★★ THE INSIDE OF THE CHAIN — D1.1, AND THE PREVIOUS ORDER WAS NOT IMPLEMENTABLE.
 *
 * The old order was `requestId → rateLimit(ip, tenant) → auth → requireIdempotencyKey → parse →
 * withTenant → toAppError`. Three things are wrong with it:
 *
 *   ★ `checkTenantLimit` CANNOT run before auth. Its own docstring (rateLimit.mjs:53-56) says
 *     "Must be called INSIDE withTenant()" — it needs a `db` handle and a `tenantId`. tenantId
 *     comes from auth; db comes from withTenant(). It is necessarily inside the handler.
 *   ★ `withIdempotency` was omitted entirely. `requireIdempotencyKey(headers)` only validates a
 *     header STRING. The stored replay — which the module's own header calls the part that
 *     "matters more than the key" — is withIdempotency(db, tenantId, key, fp, operation), and it
 *     too needs db + tenantId.
 *   ★ `toAppError()` does not end the chain. See the onError note above.
 */
// ★ CT-020 / Q5-5 (the maintainer, 21 Sep 2026) — the two request bounds. 25 s inside 30 s ON PURPOSE: a runaway query
//   is cancelled by Postgres first (57014, mapped below) and the wall-clock deadline is the net under the
//   parts of a handler that are not a query. The worker keeps its own budget and is out of scope here.
const STATEMENT_TIMEOUT_MS = 25_000;
const REQUEST_DEADLINE_MS = 30_000;

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 7.23 — THE CEILING HALF OF `scopes ∩ ceiling`, AND WHY IT IS A SECOND CHECK AND NOT THE FIRST.
//
//     A key holding a route's scope is NECESSARY, NEVER SUFFICIENT. The scope says "the practice
//     agreed this key may touch this route"; the ceiling says "the person who minted it could do
//     this themselves". Both must hold, which is an INTERSECTION. A union — either one admitting —
//     would let an Owner-scoped toggle on a coach-minted key act as an Owner.
//
//   ★★ THE OBJECT AND ACTION COME FROM 7.1's ROUTE TABLE, NOT FROM THE REQUEST. `WRITE_ROUTES`
//      declares them per route; nothing a client sends can choose which permission is asked about.
//      [MEASURED 21 Sep 2026] 54 entries, 51 with a declared action.
//   ★★★ 26 OF THE 75 DELEGABLE ROUTES DECLARE NO OBJECT/ACTION, AND THAT IS NOT A HOLE — IT IS THE
//       OTHER MAP'S JOB. [MEASURED] of `ROUTE_SCOPES`' 82 entries, 75 are delegable (not
//       NEVER_DELEGABLE, not SCOPED_BUT_CLOSED, not PER_VIEW); 49 of those match a declared
//       object/action and 26 do not — 23 reads (including `GET /api/v1/people` and
//       `GET /api/v1/whoami`) and 3 settings POSTs. For those 26 the SCOPE alone governs.
//       ★ Refusing them for want of a declared object would regress every read a key already had.
//         **Absent from `ROUTE_SCOPES` is a refusal (below); absent from 7.1's inventory is not.**
//         The two maps answer two different questions and must not be collapsed into one.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const KEY_CEILING_ROUTES = new Map(
  WRITE_ROUTES
    .filter((r) => r.action)
    .map((r) => [`POST ${r.path}`, { object: r.object ?? null, action: r.action }]),
);

// ★ The three ladder verbs. Anything else in a route's `action` is one of CT-092's 13 NAMED actions,
//   which `keystone.role_may` answers from `keystone.role_action` instead of the verb ladder.
//   `db/gates/s7_every_route_declares_a_permission.mjs:129-130` already refuses any other value, so
//   there is no third case to handle here.
const LADDER_VERBS = new Set(["view", "edit", "delete"]);

/**
 * ★★★ 7.23 — MAY A KEY CARRYING THIS CEILING DO WHAT THIS ROUTE DOES?
 *
 * ★★ IT RUNS INSIDE THE TENANT TRANSACTION, and that is load-bearing twice over:
 *    · `keystone.role_may` is INVOKER (Q7-18), so RLS on `keystone.role`/`role_permission`/
 *      `role_action` is what scopes it to this practice — there is no tenant argument to get wrong.
 *      Called outside `withTenant` it would see no rows and refuse everything.
 *    · `keystone.api_token_rank_ceiling` is the ONLY read path to `rank_ceiling`
 *      (`keystone_auth.api_token` is deny_all under RLS with no grant to app_rw, 0045:104-105), and
 *      it is nested INSIDE the invoker call on purpose: a definer calling `role_may` would run it as
 *      `auth_owner`, which holds no SELECT on the role tables at all.
 *
 * ★ A NULL ceiling — revoked key, expired key, no row — is a REFUSAL, not a pass. Fail closed.
 */
async function assertKeyCeiling(db, apiKey, routeKey) {
  const declared = KEY_CEILING_ROUTES.get(routeKey);
  // ★ No declared object/action: this route is governed by its scope alone (see the note above).
  if (!declared) return;
  // ★ A ladder verb with no object is unanswerable, so it is refused rather than guessed. MEASURED
  //   21 Sep 2026: no such route exists today; this is the fail-closed answer if one is ever added.
  if (LADDER_VERBS.has(declared.action) && !declared.object) {
    throw forbidden("this key is not permitted");
  }
  const { rows } = await db.query(
    `SELECT keystone.role_may(
              keystone.api_token_rank_ceiling($1::text, $2::bytea), $3::text, $4::text
            ) AS allowed`,
    [apiKey.tokenId, apiKey.secretHash, declared.object, declared.action],
  );
  // ★ `!== true` and not `=== false`: NULL (no live key row) must refuse too.
  if (rows[0]?.allowed !== true) throw forbidden("this key is not permitted");
}

// ★ CCR-13 — `redactReplayFields` is the middle link of 5.3's redaction chain: the route states the extra
//   names (5.11 → `["key"]`), `session`'s `...opts` forwards them untouched, and this hands them to
//   `withIdempotency`. Default `[]`: a route that says nothing gets the frozen eight and no more.
// ★ CT-006 (main-session ruling, 21 Sep 2026) — `status` is DECLARED BY THE ROUTE, never inferred from the
//   method. It is the status the route then sends on the wire, and it is what `withIdempotency` stores and
//   replays: a route passes ONE value to both, so a replay cannot answer 200 to a request that answered 201.
//   Integer 200-299, default 200; anything else is a TypeError at call time, before any work.
async function runTenantScoped(c, handler, { bucket = "api", idempotent = null, redactReplayFields = [], status = 200 } = {}) {
  if (!Number.isInteger(status) || status < 200 || status > 299) {
    throw new TypeError(`runTenantScoped: status must be an integer 200-299 (got ${JSON.stringify(status)})`);
  }
  const principal = c.get("principal");
  if (!principal) throw unauthenticated("You are signed out. Sign in again to continue.");   // R8-72: a person reads this (it used to be the engineer's own words)

  const method = c.req.method;
  const headers = c.get("headers");

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 7.23 — A DEVELOPER KEY IS A NON-PERSON PRACTICE PRINCIPAL ON THIS ORDINARY PATH (Q7-11 (a)).
  //     Not a mirrored `/api/v1/*` router — the SAME path, so a key inherits every request bound
  //     this function already applies: the 25 s statement timeout, the 30 s deadline, the tenant
  //     limiter, the idempotency claim. A mirror would be four more places for one fact to drift.
  //
  //   ★★★ THE SCOPE IS LOOKED UP BY THE ROUTER'S OWN REGISTERED PATH, NEVER THE RAW URL.
  //       `c.req.routePath` is the pattern the router matched (`/api/records/:type/:id`), so a raw
  //       URL like `/api/people?x=/api/v1/whoami` cannot be made to choose a different scope.
  //   ★★★ ABSENT FROM `ROUTE_SCOPES` IS A REFUSAL, NOT A PASS. A route nobody mapped is a route no
  //       key may call; 7.27's gate is what makes "absent" impossible for a route that should be
  //       delegable. `null` is a MAPPED value meaning "a valid key, no scope needed"
  //       (`GET /api/v1/whoami`) and is deliberately NOT treated as absent —
  //       `Object.prototype.hasOwnProperty` is the test, never truthiness.
  //   ★★ 403 BEFORE 400, ON PURPOSE. This block sits ABOVE `requireIdempotencyKey`: a key that may
  //      not touch a route is refused whether or not it sent the header, so the 400 cannot be used
  //      to probe which routes exist.
  //   ★ ONE MESSAGE FOR EVERY REFUSAL — "this key is not permitted". Never which of the four
  //     reasons applied; an error body that distinguishes them is a map of the route table.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const apiKey = principal.apiKey ?? null;
  const routeKey = `${method} ${c.req.routePath}`;
  let keyScope = null;
  if (apiKey) {
    const mapped = Object.prototype.hasOwnProperty.call(ROUTE_SCOPES, routeKey);
    if (!mapped
        || NEVER_DELEGABLE.has(routeKey)
        || SCOPED_BUT_CLOSED.has(routeKey)
        || ROUTE_SCOPES[routeKey] === "PER_VIEW") {
      throw forbidden("this key is not permitted");
    }
    keyScope = ROUTE_SCOPES[routeKey];
  }

  // ★ The KEY is validated out here — it is a header check and needs no database. The stored
  //   REPLAY happens inside, where db and tenantId exist.
  const idemKey = MUTATING.has(method) ? requireIdempotencyKey(headers) : null;
  const body = idempotent === false ? null : await readJsonBody(c);

  // ★★★ P13.6 — THE PERSON IS LOADED FROM THE DATABASE ROW, INSIDE THE TENANT TRANSACTION.
  //     NEVER FROM THE TOKEN. A token claim is Google's assertion about IDENTITY; `role` and
  //     `staff_role` are OUR statements about what someone may do, they live in app_user where a
  //     tenant admin can change them, and a token-carried role is a permission the holder keeps
  //     for an hour after we revoke it — and one we cannot see.
  //     ★★ MEASURED: live tokens carry `role:'pir'`, which is not in app_user's CHECK set and not
  //        on authorise.mjs's RANK ladder, so trusting the claim would refuse that user EVERY
  //        section while looking like an authorisation bug.
  //     ★★★ AND RUNNING IT HERE — inside withTenant — IS A SECOND INDEPENDENT CHECK. The join is
  //        subject to RLS on app_user, so if the session somehow named a person in another
  //        tenant, this returns ZERO ROWS and the request is refused. The definer resolves the
  //        session; the PREDICATE confirms the person belongs where the session says.
  const loadPerson = async (db) => {
    if (!principal.tokenId) return null;          // the gate's stub principal supplies `user`
    const { rows } = await db.query(
      `SELECT u.id, u.role, u.staff_role, u.display_name, u.tenant_id, u.lifecycle_status, u.firebase_uid,
              s.viewing_as_app_user_id,
              EXISTS (SELECT 1 FROM keystone.guardian g WHERE g.guardian_user_id = u.id) AS is_guardian
         FROM keystone.resolve_session($1, $2) s
         JOIN keystone.app_user u ON u.id = s.app_user_id`,
      [principal.tokenId, principal.secretHash]
    );
    return rows[0] ?? null;
  };

  // ★★★ THE TENANT ID IS HANDED TO THE HANDLER — D-17.28. IT USED TO HAVE TO GO LOOKING.
  //     [EXECUTED 2026-09-13] three routes (`/api/nav`, `/api/list/*`, `/api/section/*`) each ran
  //         SELECT is_platform FROM keystone.tenant WHERE id = $1   with   principal.tenantId
  //     and `principal.tenantId` IS DELIBERATELY NEVER SET — the comment forty lines below says so
  //     in capitals ("AND A PRINCIPAL CANNOT CARRY ONE"). So the parameter was `undefined`, pg sent
  //     NULL, the query matched nothing, and `rows[0]?.is_platform === true` evaluated to FALSE.
  //     ★★ CONSEQUENCE, MEASURED ON THE DEPLOYED APP: `tenantIsPlatform` was false on EVERY request
  //        ever made. The `/platform` section never appeared in anyone's nav — including Super
  //        Admin 1 inside the platform tenant, which is the only identity it exists for — and every
  //        `foundryOnly` row was refused to everyone. `/api/section/platform` answered
  //        `not_platform_tenant` about a tenant whose `is_platform` column reads TRUE.
  //     ★★★ AND IT WAS SILENT, in the exact shape this project keeps meeting: ZERO ROWS READ AS A
  //         NEGATIVE ANSWER. "I could not find the tenant" and "the tenant is not a platform
  //         tenant" are different facts, and `?.` collapsed them into the second one.
  //     ★ So the id is PASSED IN, from the GUC that was actually set. A route cannot reach for the
  //       wrong property if it is handed the right value — removing the opportunity beats
  //       remembering the rule.
  let scopedTenantId = null;

  const run = async (db) => {
    let user = principal.user;
    // ★★★ A PLATFORM PRINCIPAL HAS NO PERSON, AND THAT IS CORRECT, NOT A GAP.
    //     §A9's platform namespace is operated by a SUBJECT from KEYSTONE_SUPER_ADMIN_SUBJECTS —
    //     configuration, not a tenant-writable table (namespace.mjs:27-29: "a bug that fails to
    //     load the list must LOCK EVERYONE OUT, never let everyone in"). There is deliberately no
    //     `app_user` row for it: one would be a tenant-scoped record granting platform authority,
    //     which is the exact confusion `authoriseSuperAdminRequest` refuses when it rejects any
    //     principal carrying a tenantId.
    //     ★ [EXECUTED] requiring a person unconditionally regressed the P12 gate the moment
    //       Phase 13 added the lookup: the listed super admin got 401 "session does not resolve
    //       to a person in its tenant". Platform routes never call authoriseSection, so they
    //       need no rank.
    // ★★★ 7.23 — `&& !apiKey`: A KEY HAS NO PERSON, AND THAT IS ITS DEFINING PROPERTY.
    //     A key authenticates a PRACTICE. `loadPerson` already returns null for it (it guards on
    //     `!principal.tokenId`), so without this conjunct every key request would die here on
    //     "session does not resolve to a person in its tenant" — a 401 for a credential that is
    //     perfectly valid. The platform principal takes the same exemption for the same reason.
    if (!user && !principal.platformTenantId && !apiKey) {
      const person = await loadPerson(db);
      if (!person) {
        // ★ The session resolved a tenant but the person is not visible inside it. Fail CLOSED,
        //   and say nothing about which half was wrong.
        throw unauthenticated("Your session has ended. Sign in again to continue.");   // R8-72: the session no longer belongs to a person in this workspace
      }
      // ★★★ the maintainer's brief, 1 Oct 2026 — suspendTeamMember (src/people/offboard.mjs) revokes every
      //     session the person holds AT THAT MOMENT, but a session minted by signing back in
      //     AFTER that would have sailed straight through with none of this gate's ancestors
      //     ever reading `lifecycle_status` at all. This is the one place every tenant-scoped
      //     request for a STAFF person passes through, so it is the one place that can actually
      //     make "suspended" mean something for the whole of the next request, not just the
      //     session that existed the moment someone clicked the button.
      //   ★ CLIENTS are deliberately exempt here — `paused`/`former` are ordinary relationship
      //     stages for a client (a client who "paused" still owns their own documents/history and
      //     nothing in this brief asked for client sign-in to be gated on it); this is scoped to
      //     `role === "staff"` only, which is the actual ask ("suspend a team member").
      // ★★★ FOUND LIVE, 1 Oct 2026 — same regression as login.mjs's matching check: `!== "active"`
      //     refuses every staff row never explicitly moved off the column's actual default ('lead',
      //     0076), not just a genuinely suspended one. Check for 'paused'/'former' explicitly —
      //     the only two states suspendTeamMember/offboardTeamMember ever produce.
      if (person.role === "staff" && (person.lifecycle_status === "paused" || person.lifecycle_status === "former")) {
        throw unauthenticated(
          person.lifecycle_status === "paused"
            ? "this team member's access has been suspended"
            : "this team member is no longer with this practice");
      }
      // Part 30 item 5 — a workspace that requires two-step sign-in refuses staff without a confirmed factor (setup screens excepted)
      await enforceRequiredTwoStep(db, { tenantId: person.tenant_id, person, path: c.req.path });
      // Launch step 8: a demo workspace cannot reach what costs money, makes a credential, sends mail outside itself or removes the workspace (one list: src/product/demo.mjs DEMO_BLOCKED)
      await refuseInDemo(db, { method: c.req.method, path: c.req.path });
      user = { role: person.role, staff_role: person.staff_role, tenant_id: person.tenant_id, is_guardian: person.is_guardian };
      principal.user = user;
      principal.appUserId = person.id;
      principal.displayName = person.display_name;
      // ★ Task 1.4 / CT-112 — display data only (see the note at loadPerson above and at
      //   src/routes/index.mjs's `/api/nav` `viewingAs` field). `null` when no claim is live or it
      //   has expired (resolve_session already NULLs an expired one, 0250) — never read by any
      //   write path as an identity to act as (§4's own explicit invariant).
      principal.viewingAsAppUserId = person.viewing_as_app_user_id ?? null;
    }
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ P1.7 — `appUserId` IS RESOLVED FOR EVERY TENANT PRINCIPAL, NOT ONLY THE ONES THAT ARRIVE
    //     WITHOUT A `user`. The block above sets it as a SIDE EFFECT of loading the person, and it
    //     only loads the person when `user` is absent — so a principal that already carries `user`
    //     reached the handlers with **no `appUserId` at all**.
    //   ★★ That was harmless right up until P1.7 made `appUserId` the viewer bound into every list
    //      and record query. Then it became: **every scoped read returns nothing, and the screen is
    //      empty with no error.** [EXECUTED] `p12_server` caught it as a positive-control failure —
    //      `staff → 404` on a record the fixture had always been able to read.
    //   ★ Production's own resolver returns no `user` (src/auth/install.mjs), so the live path was
    //     never broken — which is exactly why this needed a gate to find it and not a reading.
    // ★ 7.23 — same exemption, same reason: there is no `appUserId` to resolve for a key, and
    //   P1.7's viewer binding is a person's, not a practice's.
    if (!principal.appUserId && !principal.platformTenantId && !apiKey) {
      const person = await loadPerson(db);
      if (person) {
        principal.appUserId = person.id;
        principal.displayName ??= person.display_name;
        // ★ Task 1.4 — same P1.7 lesson applied to this fact too: a principal that reaches this
        //   branch (arrives with `user` already set) must not be the one shape `viewingAs` is
        //   silently missing from.
        principal.viewingAsAppUserId ??= person.viewing_as_app_user_id ?? null;
      }
    }
    return handler({ db, c, principal, body, tenantId: scopedTenantId });
  };

  // ★★★ CT-020 — THE WALL-CLOCK BOUND. `run(db)` is raced against REQUEST_DEADLINE_MS; on expiry the
  //     request answers TIMEOUT (504, retryable — `RETRYABLE` already holds it, no new decision here).
  //   ★★ A race does not STOP the loser. Once the deadline has answered, `withTenant` rolls back and hands
  //      the pooled connection to the next request — and a handler still running would go on issuing
  //      `db.query` on it, INSIDE SOMEONE ELSE'S TRANSACTION. So the handle given to `run` (and so to the
  //      handler) refuses every query issued after expiry. `withIdempotency`'s own bookkeeping keeps the
  //      unguarded handle: it must still be able to mark the row failed.
  //   ★ The guard spreads `db` so the TENANT_TX brand (an own enumerable symbol) survives — `emit(tx, …)`
  //     refuses an unbranded handle.
  const runBounded = (db) => {
    let timer;
    let expired = false;
    const deadlineError = () =>
      new AppError(ErrorKind.TIMEOUT, "the request took too long", { requestId: c.get("requestId") });
    const guarded = {
      ...db,
      query: (text, params) => (expired ? Promise.reject(deadlineError()) : db.query(text, params)),
    };
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(deadlineError()); }, REQUEST_DEADLINE_MS);
    });
    return Promise.race([run(guarded), deadline]).finally(() => clearTimeout(timer));
  };

  // ★ P15B.13a — carried out of the transaction so it can be thrown after the COMMIT.
  let deferredFailure = null;

  // ★ CT-020 — a Postgres 57014 (`query_canceled`), raised by the `statement_timeout` set below, is the
  //   same TIMEOUT kind as the deadline. ★ A LOCAL mapping, not an arm in `errors.mjs`'s `toAppError`: that
  //   file is 5.1's and this task does not edit it. It always throws: it is applied to the transaction's
  //   own rejection AND to the after-COMMIT `deferredFailure` re-throw below.
  const timeoutFrom57014 = (err) => {
    if (err?.code === "57014") {
      throw new AppError(ErrorKind.TIMEOUT, "the request took too long", { cause: err, requestId: c.get("requestId") });
    }
    throw err;
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 7.23 — WHICH ENTRY PATH OPENS THE TRANSACTION. THE BODY BELOW IS IDENTICAL FOR BOTH.
  //
  //     A key principal has NO `sessionId`, so `handleBrowserRequest({ sessionId: undefined }, …)`
  //     resolves no tenant and answers 401. That is why this indirection exists and not for tidiness:
  //     without it every key request dies here no matter what the rest of this task does.
  //
  //   ★★ IT IS A BINDING, NOT A SECOND CALLBACK. The callback is written ONCE and handed to whichever
  //      path is chosen, so the tenant limiter, the session touch, the idempotency claim and the
  //      statement timeout are literally the same lines for a browser session and for a key. A
  //      second copy of this body is how the two paths would drift.
  //   ★★★ `handleApiTokenRequest` IS THE SINGLE ENFORCEMENT POINT for the credential (CT-090): it
  //       calls `keystone.authorize_api_token(token_id, secret_hash, scope, expect_live)`, which is
  //       where the SCOPE half of `scopes ∩ ceiling` is actually enforced in the database. This
  //       file adds no second credential check — the head above only decides WHICH scope to ask for.
  //   ★ `expectLive` is NOT passed: `resolveTenantForToken` derives it from the presented prefix
  //     itself (apiToken.mjs:159-177). One fact, one source.
  //   ★ The authorization header is re-read here rather than carried on the principal, so the raw
  //     secret never travels on an object that reaches handlers, logs or error envelopes.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const dispatch = apiKey
    ? (fn) => handleApiTokenRequest({ authorization: c.req.header("authorization"), scope: keyScope }, fn)
    : (fn) => handleBrowserRequest({ sessionId: principal.sessionId }, fn);

  const outcome = await dispatch(async (db) => {
    // ★★★ CT-020 / Q5-5 — THE DATABASE BOUND. `SET LOCAL`, so it dies with this transaction and cannot leak
    //     onto the pooled connection the next request receives — that is the whole reason for `LOCAL`.
    //     First thing, after `withTenant` has opened the transaction and set the tenant GUC and before any
    //     work, so the tenant-limit upsert and the idempotency claim are bounded too.
    await db.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);

    // ★★★ THE TENANT IS READ FROM THE GUC THAT WAS ACTUALLY SET, NOT FROM THE PRINCIPAL.
    //     This is both the correct source and P13.7c's assertion made structural:
    //       · CORRECT SOURCE — `handleBrowserRequest` resolves the session and calls
    //         `withTenant(session.tenantId, …)`, which issues the `set_config`. Reading the GUC
    //         back is reading what the database is ACTUALLY enforcing, not what the request
    //         layer believed. If the two ever disagreed, every RLS predicate would follow the
    //         GUC and the rate-limit/idempotency rows would follow the principal — two different
    //         tenants in one transaction, silently.
    //       · AND A PRINCIPAL CANNOT CARRY ONE. An earlier draft took
    //         `principal.tenantId ?? principal.platformTenantId` and threw when both were absent —
    //         which is every real session, because the whole design is that the SESSION TOKEN
    //         travels and the tenant is resolved from it. [EXECUTED] that produced
    //         "principal carries no tenant context" (401) on every authenticated request.
    //     ★ A caller-supplied tenant id would be tenant selection BY THE CALLER — the defect §D5
    //       names on the queue path. There is nowhere here for one to be supplied.
    const { rows: ctx } = await db.query(
      `SELECT current_setting('keystone.tenant_id', true) AS tenant_id`);
    const tenantId = ctx[0]?.tenant_id;
    if (!tenantId) {
      // ★ Fail CLOSED and loudly. An empty GUC inside withTenant would mean set_config did not
      //   take, and every subsequent read would return zero rows — which reads as "no data".
      throw unauthenticated("tenant context was not established inside the transaction");
    }
    c.set("tenantId", tenantId);
    // ★ And hand it to the handler directly — see the D-17.28 note above `run`.
    scopedTenantId = tenantId;

    // ★ HERE. Not before auth.
    await checkTenantLimit(tenantId, bucket);

    // ★★ BOOKKEEPING, NOT A GUARD. A failed touch must never fail a request: the session is already
    //    proved valid by resolve_session at this point, and last_seen_at is a display value on the
    //    devices screen. touchSession() swallows its own errors and returns false (6.6). It takes
    //    its own connection through withCredentialLookup, so it is not part of this transaction —
    //    exactly as revokeSessionsForUid does (src/records/archive.mjs:147) — and it is not awaited,
    //    so it never sits on the request's latency path.
    // Run 7 part 6 — a session idle past the workspace's limit is ended here, before this request counts as activity (src/auth/idleSignOut.mjs)
    await enforceIdleSignOut(db, { tenantId, sessionId: apiKey ? null : principal.sessionId });
    void touchSession(principal.sessionId);

    // ★★★ 7.23 — THE CEILING, HERE, INSIDE THE TRANSACTION AND BEFORE ANY HANDLER RUNS.
    //     `keystone.role_may` is INVOKER, so it needs the tenant GUC `withTenant` has just set;
    //     `keystone.api_token_rank_ceiling` is the only read path to the column. See the helper's
    //     own notes above. Nothing for a browser session: this is the key's second gate, and the
    //     scope was the first (enforced by `keystone.authorize_api_token` inside the dispatch).
    if (apiKey) await assertKeyCeiling(db, apiKey, routeKey);

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ Task 6.5 (spec 06 §9) — A PRACTICE THAT HAS STOPPED PAYING STOPS WRITING.
    //     `assertPracticeWritable(tx, tenantId, routeKey)` refuses every MUTATING route for a
    //     tenant whose `workbench_subscription.status` is `'past_due'`/`'canceled'` — except the
    //     billing routes themselves (`/api/settings/billing/*`, `/api/settings/plans/*`) and
    //     `POST /api/auth/logout`, which the guard's own exemption list carries (see
    //     `src/billing/guard.mjs`, so this call site never hand-lists the exceptions a second
    //     time). Placed HERE: inside the open tenant transaction (so it reads the same row every
    //     other statement in this request would), after the key ceiling (a credential check comes
    //     first) and before any handler runs. §9's own wording: "called from `runTenantScoped`
    //     … immediately after `MUTATING.has(method)` is true and the tenant transaction is open".
    // ★ NOTHING for a non-mutating method — a read-only practice must still be able to READ its
    //   own data (§9: "Client-app reads stay unaffected"; this call site is staff-only regardless,
    //   see the header comment on `guard.mjs`).
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    if (MUTATING.has(method)) await assertPracticeWritable(db, tenantId, routeKey, { staffRole: principal?.user?.staff_role ?? null, role: principal?.user?.role ?? null });

    if (!idemKey) return runBounded(db);

    // ★★★ P15B.13a — THE FAILURE IS RETURNED, AND IT IS RE-THROWN AFTER THE COMMIT.
    //     `withIdempotency` no longer throws when the operation fails, because a throw here
    //     would reach `withTenant`, roll the transaction back, and erase the claim row and the
    //     `failed` marker it had just written — leaving an immediate retry free to execute the
    //     operation a second time. The operation's own writes are already undone by the
    //     savepoint; what must SURVIVE is the record that it was attempted.
    // ★★★ THE OPERATION'S RESULT IS WRAPPED AS { status, body } — D-15B.13b.
    //     [EXECUTED 2026-09-13, by the P15B.13 gate] `withIdempotency` stores `result.status` and
    //     `result.body`, and the handler returns a DOMAIN OBJECT with neither. So `response_body` was
    //     stored as **NULL** and the replay handed the retrying client
    //     `{replayed:true, status:200, body:null}` — the stored-replay half of P15B.13 was doing
    //     nothing at all, while the exactly-once half worked perfectly and made it look fine.
    //   ★★ WORSE, THE FIRST CALLER GOT THE WRAPPER TOO: `return outcome` handed
    //      `{replayed:false,…}` back to the route instead of the created row, so a successful create
    //      answered with no id. A gate that only checked "did it run once" would never have seen it.
    const outcome = await withIdempotency(
      db,
      tenantId,
      idemKey,
      fingerprint(method, c.req.path, body),
      async () => ({ status, body: await runBounded(db) }),
      // ★ CCR-13 — the route's extra redaction names, as the SIXTH argument. Default `[]` (see the
      //   destructure): a route that says nothing behaves exactly as before.
      redactReplayFields
    );
    if (outcome.failed) {
      // ★ Stash it on the returned value. Throwing before COMMIT is the whole defect.
      deferredFailure = outcome.error;
      return null;
    }
    // ★ Observable to the client without changing the body: a retrying caller can tell that its
    //   second attempt was answered from the store rather than executed again.
    c.header("idempotent-replay", outcome.replayed === true ? "true" : "false");
    // ★★ UNWRAPPED. The route — and therefore the client — receives what the operation returned, on
    //    the first call and on every replay, which is the only way the two can be identical.
    return outcome.body;
  }).catch(timeoutFrom57014);

  // ★★★ HERE, AND ONLY HERE. The transaction has committed, so the claim row and the `failed`
  //     marker are durable; re-throwing now produces the right HTTP status without undoing them.
  //     (`timeoutFrom57014` always throws, so a 57014 held here becomes the TIMEOUT kind too.)
  if (deferredFailure) return timeoutFrom57014(deferredFailure);
  return outcome;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CT-119 — `runSignerScoped`, A SIBLING TO `runTenantScoped`, NOT A REWRITE OF IT.
//
//     Task 3b.2 (spec 03b §2.2/§4.2, §10 item 1). Built because `runTenantScoped` (above) and
//     `resolvePrincipal` both require an ALREADY-RESOLVED PRINCIPAL — a bearer token or a
//     `ks_session` cookie — before ANY write-route handler runs. A genuinely anonymous signer (Q7-2's
//     own example: "a client opens an email on a phone with no cookie") has neither, and so cannot
//     reach a handler through that path at all. This function is the other door: it never asks for a
//     principal, because a signer never has one.
//
// ★★ THE ORDER IS THE WHOLE DESIGN, and it is the same order the public-booking trust boundary uses
//    (spec 03b §4.2 step 3 — "the write — `withTenant(tenantId, fn, { userId: null })` … the SAME
//    function every authenticated route already opens its transaction through"):
//      1. Redeem the presented link token FIRST, OUTSIDE any tenant transaction — `redeemLinkToken`
//         (`src/auth/linkToken.mjs:276`) is tenant-less by construction; it is what PRODUCES the
//         tenant, not a check run once a tenant is already assumed. There is nowhere for a
//         caller-supplied tenant id to enter here — there is no tenant yet.
//      2. Open the transaction with `withTenant(redeemed.tenantId, …, { userId: redeemed.issuedTo })`
//         — the value the DATABASE resolved from the secret, never a value read from the body, a
//         header, or a URL segment. `userId` is the token's own person, not null, now (task 14.32,
//         R-14.4): RLS answers every query inside this transaction as that person, the same as any
//         authenticated route; the redeemed token's own fields (below) are the identity.
//      3. Dispatch to the handler with the SAME shape `runTenantScoped` hands its own handler —
//         `{ db, c, principal, body, tenantId }` — so a caller already written against that contract
//         (every `route.fn(db, args)` closure in `src/routes/writes.mjs`) needs no second copy of
//         itself to be reachable through this door too. No new signing logic lives here.
//
// ★ `principal` carries no session-derived fields (no `role`, no `staff_role` — there is no session).
//   `principal.appUserId` is the redeemed token's OWN `issuedTo` (who the link was minted for), set
//   from the token, never from anything the caller claims — the same overwrite-not-check discipline
//   `assertSignerForInstance` already used (`src/routes/writes.mjs:369-370`) before this function
//   existed. `redeemed` is handed through in full (`{ tenantId, subjectType, subjectId, issuedTo }`)
//   so a handler needing the subject the link names (a document instance, today) reads it from the
//   token's own answer, not from a body field a caller could have set to anything.
//
// ★ DELIBERATELY NARROWER THAN `runTenantScoped`. No idempotency store, no per-tenant rate-limit
//   check, no wall-clock race, no statement timeout — none of that is named in spec 03b's own
//   description of this function, and this function does not invent machinery the spec did not ask
//   for. Q7-2's four signer routes are the reason this exists; giving them more than the spec states
//   would be improvising an API, which is the one thing this task was told not to do.
// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ★ Task 14.32 (R-14.4) — same literal as `linkToken.mjs`'s own (not-exported) `LINK_TOKEN_REFUSED`,
//   mirrored, never imported — the same idiom `src/routes/writes.mjs`'s `SIGNER_LINK_REFUSED`
//   already uses for the same reason: one refusal, every cause, no oracle.
const SIGNER_LINK_REFUSED_TEXT =
  "That link is not valid. It may have been used already, expired, or been cancelled — ask for a new one.";

async function runSignerScoped(c, handler, { expectedPurposes, spend = true } = {}) {
  if (!Array.isArray(expectedPurposes) || expectedPurposes.length === 0) {
    throw new TypeError(
      `runSignerScoped: expectedPurposes must be a non-empty array (got ${JSON.stringify(expectedPurposes)})`);
  }

  const body = await readJsonBody(c);
  // ★ Tenant-less by construction — see the header note above. Throws `forbidden(LINK_TOKEN_REFUSED)`
  //   for every cause (unknown, malformed, wrong purpose, spent, expired, revoked) — the same
  //   undifferentiated refusal `linkToken.mjs`'s own header names as decision 2, so this door leaks
  //   no more to a prober than the redemption call it wraps already refuses to. `spend: false` calls
  //   `peekLinkToken` instead (task 14.32) — same refusal, same shape, no `redeemed_at` set (CCR-10)
  //   — for a caller that only needs to read (14.34's `/view`), never to consume the link's one use.
  const redeemed = spend
    ? await redeemLinkToken(body?.presented, expectedPurposes)
    : await peekLinkToken(body?.presented, expectedPurposes);

  // ★★★ R-14.4, RULED — A LINK ISSUED TO NOBODY IS REFUSED. "A signing link that resolves to no
  //     person is a credential with no owner": nothing downstream — `principal.appUserId`, the RLS
  //     person this transaction opens as, an audit row — has anyone to name it for. Refused with the
  //     SAME one sentence every other cause gives (decision 2), never a distinct "no signer" variant
  //     that would tell a prober which of their guesses was closer.
  if (redeemed.issuedTo == null) throw forbidden(SIGNER_LINK_REFUSED_TEXT);

  return withTenant(redeemed.tenantId, (db) => {
    // ★ No session, so no `role`/`staff_role` — a signer authenticates no `app_user` row. Only the
    //   token's own answer travels forward.
    const principal = { appUserId: redeemed.issuedTo ?? null, user: null };
    return handler({ db, c, principal, body, tenantId: redeemed.tenantId, redeemed });
  }, { userId: redeemed.issuedTo });
}

async function readJsonBody(c) {
  if (!MUTATING.has(c.req.method)) return null;
  const ct = c.req.header("content-type") ?? "";
  if (!ct.includes("application/json")) return null;
  try { return await c.req.json(); } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// P12.9 / F24 — THE IP-WINDOW SWEEPER.
// ★★ sweepIpWindows() had NO PRODUCTION CALLER [MEAS]. So the in-process Map grew without
//    bound — which is the exact failure its own docstring (rateLimit.mjs:38) claims to prevent:
//    "Bounded cleanup so the map cannot grow without limit under a distributed flood."
//    A distributed flood is precisely when it matters, and precisely when nothing was calling it.
// ★ `unref()` so a pending timer cannot hold the process open at shutdown.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ★ Read the SPA shell, cached after the first successful read.
 * ★★ THE CACHE IS ONLY POPULATED ON SUCCESS, DELIBERATELY. Caching a null would make a container
 *    that started one second before the bundle was readable serve a 503 forever, and a restart
 *    would "fix" it — the least diagnosable class of failure. A miss is retried.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ THE CACHE IS **PER ROOT**, AND IT WAS NOT. REGISTERED AS F375.
 *
 *   This was `let _shell = null` — ONE variable for ALL roots — with `if (_shell !== null) return
 *   _shell;` BEFORE the root was ever used. So the function took a `root` argument and, after the
 *   first successful call, **ignored it completely**: whichever shell was requested first was
 *   returned for every subsequent request, from any directory.
 *
 * ★★ IT WAS HARMLESS FOR AS LONG AS THERE WAS EXACTLY ONE CALLER WITH EXACTLY ONE ROOT, which is
 *    why it survived. The migration adds a SECOND root — `./web/dist` for the eight rows still on
 *    the React screen, beside `./web/webdist` for everything else — and the defect becomes live
 *    the moment it does.
 *
 * ★★★ AND THE FAILURE WOULD HAVE BEEN SILENT AND ORDER-DEPENDENT. Whichever path a visitor hit
 *     first would win: land on `/people/all` first and every legacy row serves the SVELTE shell
 *     (which refuses to draw them, so the "Open it" link loops back on itself); land on
 *     `/settings/roles` first and **the entire CRM serves the REACT shell** and none of this
 *     migration is visible at all. Two different broken products from the same build, decided by
 *     whoever loaded which page first after a restart.
 *   ★ A `Map` keyed on the root is the whole fix, and the argument the function already declared
 *     is what it is keyed on.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
const _shells = new Map();
async function readShell(root) {
  if (_shells.has(root)) return _shells.get(root);
  try {
    const html = await readFile(`${root}/app.html`, "utf8");
    _shells.set(root, html);
    return html;
  } catch {
    return null;
  }
}

export function startIpWindowSweeper({ everyMs = 60_000 } = {}) {
  const t = setInterval(() => {
    try { sweepIpWindows(); } catch { /* a sweep failure must never take the process down */ }
  }, everyMs);
  t.unref();
  return () => clearInterval(t);
}

export { runTenantScoped, runSignerScoped };
