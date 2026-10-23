// P17.9 / P2.18 / P2.5 — THE SIGNUP ROUTE. NEW, AND ITS ABSENCE IS D-17.8.
//
// ★★★ WHY THIS FILE HAD TO EXIST BEFORE P2.18 COULD BE DONE BY ANYONE. [MEAS 2026-09-13] the only
// mutating routes in the whole application were `/api/auth/login` and `/api/auth/logout`.
// `runCriticalPrefix` and `createRun` were real, gated, tested modules **with no wire attached** —
// so P2.18's *"the maintainer creates Super Admin 1 / Docustay THROUGH THE REAL FLOW"* named a flow that had never
// been built. Same shape as D-17.2: a module that works, reachable by nothing.
//
// ★★ IT IS REGISTERED OUTSIDE THE TENANT MACHINERY, like the auth routes and for the same reason:
// this is the one request that has no tenant yet, by definition. It therefore does NOT go through
// `runTenantScoped` — there is no session, no principal and no GUC to read.
//
// ★★★ AND IT IS THE ONE ROUTE THAT WRITES AS A ROLE OTHER THAN app_rw. See `withSignupConnection`
// and migration 0025 for why that role is `app_signup` and not the superuser (D-17.9).

import { randomUUID } from "node:crypto";
import { withSignupConnection, withCredentialLookup } from "../db/index.mjs";
import { validateSubdomain } from "../provisioning/subdomain.mjs";
import { createRun, runCriticalPrefix } from "../provisioning/prefix.mjs";
import { verifyIdToken, getFirebaseAuth } from "../auth/firebase.mjs";
import { invalid, forbidden, internal, dependency, conflict } from "../http/errors.mjs";
import { parse, CreateTenant, CreateAdminUser, SignupQuestionsAnswers } from "../http/validate.mjs";
import { requireIdempotencyKey } from "../http/idempotency.mjs";
import { verifyTurnstile, assertBotCheckConfigured } from "../http/turnstile.mjs";
import { formSubmitLimiter } from "../http/rateLimit.mjs";
import { requestEmailCode, verifyEmailCode } from "../auth/emailCode.mjs";
import { unsubscribeByToken } from "../product/lifecycle.mjs";
import { assertMayStartFree } from "../product/docustayIntegrity.mjs";
import { trackEvent } from "../product/analytics.mjs";
import { localAuthEnabled, ensureLocalIdentity } from "../auth/localIdentity.mjs";
// ★★★ TASK 12.3 — `12-signup-first-run-people.md` §2/§4/§3.5/§3.6. `POST /api/signup/questions`
//     (added at the bottom of `registerSignupRoutes`, below) is the ONE route in this file that IS
//     authenticated and tenant-scoped — the person has just auto-logged in by the time SignupQuestions
//     renders. It reuses `runTenantScoped` (the SAME wrapper `registerRoutes`/`registerWriteRoutes`/…
//     already receive from `src/http/app.mjs`) rather than a hand-rolled second implementation of
//     tenant resolution, idempotency and the statement/deadline bounds — see this file's own guard,
//     a few lines below `registerSignupRoutes`'s signature, for what happens if the caller has not
//     wired it in yet.
import { createStarterServices, createSampleClients } from "../provisioning/sampleContent.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { searchBusinesses, businessDetail } from "../growth/places.mjs";

/**
 * ★ The bootstrap secret that designates the PLATFORM tenant. D-17.10.
 * ★★ READ AT CALL TIME, NOT AT MODULE LOAD. A module-level read would capture `undefined` in any
 *    process that imports this file before its environment is populated — and the failure mode is
 *    the worst possible one: the check silently never matches and the platform can never be created.
 */
function platformBootstrapToken() {
  return process.env.KEYSTONE_PLATFORM_BOOTSTRAP_TOKEN || null;
}

/**
 * ★★★ CONSTANT-TIME-ISH COMPARISON, AND WHY IT IS NOT THEATRE HERE. This token is presented by a
 * browser over the network and a length-revealing early return would leak its size. `timingSafeEqual`
 * needs equal lengths, so the length is compared first — which leaks only the length, and the token
 * is 32 random bytes so the length is not a secret.
 */
async function isPlatformBootstrap(presented) {
  const expected = platformBootstrapToken();
  if (!expected || typeof presented !== "string" || presented.length !== expected.length) return false;
  const { timingSafeEqual } = await import("node:crypto");
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/**
 * ★★★ CT-073/CT-108 — is the Turnstile bot check ON at all, right now, for EVERY practice?
 * ★★ Read DIRECTLY (`keystone.feature_flag.default_on`), not through `flagIsOn()`
 *    (`src/platform/flags.mjs`) — that function `assertTenantTx`s a real tenant transaction, and
 *    there is no tenant at any of these unauthenticated signup routes (`12-signup-first-run-people.md`
 *    §4). `withCredentialLookup` is the same no-tenant door `slug-available` above already uses.
 * ★ An UNKNOWN key raises rather than reading as "off" — the same discipline `flagIsOn` itself
 *   uses (CT-072): a typo in the seed must not silently disable the bot check for every signup.
 */
async function isTurnstileEnabled() {
  return withCredentialLookup(async (db) => {
    const { rows } = await db.query(
      `SELECT default_on FROM keystone.feature_flag WHERE key = $1`,
      ["turnstile_enabled"]
    );
    if (rows.length === 0) {
      throw internal(`isTurnstileEnabled: "turnstile_enabled" is not a known feature flag — seed it first`);
    }
    return rows[0].default_on === true;
  });
}

// ★★★ TASK 12.3 — `runTenantScoped` is now an OPTIONAL second argument, additive to the existing
//     zero-argument call `src/http/app.mjs:299` makes today (`registerSignupRoutes(app)`). Every
//     route ABOVE this comment is completely unaffected — none of them reads it.
//
// ★★★ STOP-AND-REPORT, LEFT VISIBLE RATHER THAN SILENTLY WORKED AROUND — task 12.3's own Files field
//     (`FEATURES-COMBINED-PLAN.md:496-499`) lists `src/http/validate.mjs`, this file,
//     `src/provisioning/sampleContent.mjs` and the two migrations. It does NOT list `src/http/app.mjs`,
//     and per this build's own hard rule ("edit only the files the section lists") that file was left
//     untouched. But `POST /api/signup/questions`, below, cannot be Owner-only, tenant-scoped and
//     idempotent (`12-signup-first-run-people.md` §2/§4 — the row it writes lives in a FORCE-RLS table
//     keyed by `keystone.current_tenant_id()`) without SOME tenant-transaction wrapper, and
//     `runTenantScoped` is the one every other authenticated write in this codebase already uses — a
//     second, hand-rolled copy of its session/tenant resolution, idempotency claim and deadline race
//     would be exactly the risk `runTenantScoped`'s own comments (`src/http/app.mjs:652-745`) were
//     written to prevent. The ONE remaining wire is a single, additive line:
//         src/http/app.mjs:299   registerSignupRoutes(app);
//                            →   registerSignupRoutes(app, { runTenantScoped });
//     Until that line lands, the guard immediately inside the route below throws a loud 500 naming
//     this exact comment, rather than silently accepting a request it cannot actually authorise.
export function registerSignupRoutes(app, { runTenantScoped } = {}) {
  // ★ TY, 2026-09-16 — GET /api/signup/slug-available?slug= — live check while typing the acronym.
  //   The unique index on tenant.slug remains the real guarantee at creation.
  app.get("/api/signup/slug-available", async (c) => {
    c.header("cache-control", "no-store");
    const v = validateSubdomain(String(c.req.query("slug") ?? "").trim().toLowerCase());
    if (!v.ok) return c.json({ available: false, slug: v.slug, reason: v.failures.map((f) => f.explain).join("; ") });
    const rows = await withCredentialLookup(async (db) =>
      (await db.query("SELECT 1 FROM keystone.resolve_login_branding_by_slug($1)", [v.slug])).rows);
    return c.json(rows.length
      ? { available: false, slug: v.slug, reason: "that acronym is already taken" }
      : { available: true, slug: v.slug });
  });

  // ★★★ TASK 17.36 — GET /api/signup/find?q= — search for a business by name using Google Places.
  //     Public, Turnstile-guarded like POST /api/signup, rate-limited on the signup bucket.
  //     Returns `{available:false}` when the key is missing or the API fails, never an empty list.
  app.get("/api/signup/find", async (c) => {
    c.header("cache-control", "no-store");
    const q = String(c.req.query("q") ?? "").trim();

    // ── TURNSTILE GATE ──────────────────────────────────────────────────────────────────────────
    if (await isTurnstileEnabled()) {
      assertBotCheckConfigured();
      const ip = c.get("clientIp") ?? null;
      const outcome = await verifyTurnstile(c.req.query("turnstileToken"), ip);
      if (outcome.reason === "rejected") {
        throw forbidden("We could not verify you are not a robot. Try again.");
      }
      if (outcome.reason === "unreachable") {
        formSubmitLimiter("signup", ip);
      }
    }

    // ── RATE LIMIT (signup bucket, same as POST /api/signup) ─────────────────────────────────────
    const ip = c.get("clientIp") ?? null;
    formSubmitLimiter("signup", ip);

    // ── SEARCH ─────────────────────────────────────────────────────────────────────────────────────
    const result = await searchBusinesses({ query: q });
    return c.json(result);
  });

  // ★★★ TASK 17.36 — GET /api/signup/find/:placeId — get detailed information about a business.
  //     Returns `{available:false}` when the key is missing or the API fails.
  app.get("/api/signup/find/:placeId", async (c) => {
    c.header("cache-control", "no-store");
    const placeId = String(c.req.param("placeId") ?? "").trim();
    const result = await businessDetail({ placeId });
    return c.json(result);
  });

  app.post("/api/signup", async (c) => {
    // a self-hosted install does not take public sign-ups: its owner is created once, through the setup token (POST /api/setup/owner)
    if (process.env.KEYSTONE_SELF_HOST === "1") throw forbidden("This install does not take public sign-ups.");
    const headers = Object.fromEntries(c.req.raw.headers);

    // ★★ AN IDEMPOTENCY KEY IS REQUIRED HERE TOO, AND IT MATTERS MORE THAN ELSEWHERE. A retried
    //    signup that ran twice would claim two subdomains for one customer, and the second is
    //    permanent from the outside. ★ The full stored-replay (`withIdempotency`) needs a tenant to
    //    scope the key to and there is none yet; the UNIQUE constraint on `tenant.slug` is what
    //    actually makes this operation idempotent, and `runCriticalPrefix` already converts that
    //    violation into a 409. The header is still required so a client cannot omit it and then
    //    claim it retried safely.
    requireIdempotencyKey(headers);

    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON");
    }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");

    // ── 0 · THE BOT CHECK, BEFORE ANYTHING ELSE IS SPENT. CT-073/CT-108 — `turnstile_enabled` ─
    //     gates whether the check runs AT ALL; when it does, `verifyTurnstile`'s existing 3-outcome
    //     contract decides the rest (`src/http/turnstile.mjs`, unchanged by this task). Only an
    //     explicit "rejected" verdict refuses the request — a MISSING token, or Cloudflare itself
    //     being unreachable, is "unreachable" and fails OPEN, same as every other adopter of this
    //     module. The "unreachable" leg still spends the tighter per-form/per-IP budget
    //     (`formSubmitLimiter`, `src/http/rateLimit.mjs`) that exists for exactly this case.
    if (await isTurnstileEnabled()) {
      assertBotCheckConfigured();
      const ip = c.get("clientIp") ?? null;
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") {
        throw forbidden("We could not verify you are not a robot. Try again.");
      }
      if (outcome.reason === "unreachable") {
        formSubmitLimiter("signup", ip);
      }
    }

    // ── 1 · IDENTITY COMES FROM THE VERIFIED TOKEN. NEVER FROM THE BODY. ─────────────────────
    // ★★★ §D2: "the client SDK obtains a token and nothing more." A body-supplied email would let
    //     any caller create an organisation in someone else's name and then own it.
    const decoded = await verifyIdToken(body.idToken, { checkRevoked: true });
    const firebaseUid = decoded?.uid;
    const email = decoded?.email;
    if (!firebaseUid) throw internal("the verified token carries no uid");
    if (!email) {
      // ★ FAIL CLOSED AND SAY WHY. A Firebase user can exist with no email (phone, anonymous), and
      //   `app_user.email` is NOT NULL with a UNIQUE (tenant_id, lower(email)) key. Guessing one
      //   would create a row nobody can ever match.
      throw invalid(
        "this sign-in has no email address. An organisation's first user is identified by email, " +
        "so sign up with an email-and-password account."
      );
    }
    if (decoded?.email_verified !== true) {
      throw invalid(
        "this email address has not been confirmed yet. Open the link Firebase sent you, then " +
        "sign up again.",
        { fields: { email: "not confirmed yet" } }
      );
    }

    // ── 2 · PLATFORM OR ORDINARY. The header decides intent; the SCHEMA decides legality. ────
    const wantsPlatform = await isPlatformBootstrap(headers["x-keystone-bootstrap"]);
    // ★★★ FIX (12-signup-first-run-people.md §1/§11) — `staff_role` is only raised to
    //     super_admin_1 for a platform bootstrap. Everything else is 'owner', NOT 'admin':
    //     migration 0188 narrowed the CHECK to ('owner','admin',`coach`) and `enforce_last_owner()`
    //     fires only on DELETE/UPDATE of staff_role — never on INSERT — so an 'admin' first row
    //     gave every practice created through this route zero Owners from the moment it existed.
    //     `coach` is still wrong for the same reason `prefix.mjs` gives at length (a tenant whose
    //     only staff member is a coach is locked out at creation).
    const staffRole = wantsPlatform ? "super_admin_1" : "owner";
    // ★★★ IF A BOOTSTRAP WAS ATTEMPTED AND THE TOKEN DID NOT MATCH, REFUSE THE WHOLE REQUEST rather
    //     than silently downgrading to an ordinary signup. A silent downgrade would hand the
    //     operator a tenant that LOOKS like the platform and is not — and they would discover it
    //     when /platform returned 403 for reasons nobody could see.
    if (headers["x-keystone-bootstrap"] !== undefined && !wantsPlatform) {
      throw forbidden("the platform bootstrap token presented is not valid");
    }

    // ★★★ VALIDATE BEFORE A RUN ROW EXISTS — D-17.22. ORDERING, NOT CONTENT.
    //     [EXECUTED 2026-09-13 against the deployed app] two identical requests carrying an INVALID
    //     slug, one after the other:
    //         1st → 400 validation, "letters, digits and hyphens only"   ← and yet it PERSISTED a run
    //         2nd → 409 "a signup for … is already in progress"
    //     `createRun` ran BEFORE `runCriticalPrefix` validated, so a REFUSED request left a durable
    //     `provisioning_run` row, and the row then blocked the retry. ★★ The user-visible effect: a
    //     typo in the workspace address permanently locks you out of the name you actually wanted,
    //     and the second message blames a signup "in progress" that never started.
    // ★★ I FIRST READ THIS WRONG. My own probe differed in two variables at once (the bootstrap
    //    header AND the call order) and the tempting reading was "the bootstrap header skips
    //    validation". It does not. The variable that mattered was which call came first — the sort of
    //    cause that is INFERRED from the first difference noticed rather than MEASURED.
    // ★ `runCriticalPrefix` still parses both objects itself. That is deliberate duplication: it must
    //   never depend on a caller having checked, and this call is about WHEN, not whether.
    parse(CreateTenant, body.tenant, "tenant");
    parse(CreateAdminUser, { email, displayName: String(body?.admin?.displayName ?? email) }, "admin user");

    // ★★★ [TY, RULED 1 Oct 2026] THE POLICY CHECKBOX — same "validate before a run row exists"
    //   ordering as everything else in this section. `policyAccepted` is a plain top-level field,
    //   not folded into `CreateTenant`/`CreateAdminUser` — those two are explicitly "frozen" (task
    //   12.3's own header, above) and widened only by a new schema, never by loosening them. The
    //   VERSION recorded is always the server's current one (src/legal/policies.mjs); the client
    //   confirms agreement, it does not get to assert which version it agreed to.
    if (body.policyAccepted !== true) {
      throw invalid(
        "you must agree to the Terms of Service, Privacy Policy and Data Processing Addendum to create an account.",
        { fields: { policyAccepted: "must be accepted" } }
      );
    }

    // ★★★ TASK 17.36 — merge optional listing data into tenant, storing only what was present.
    // The listing comes from Google Places; we use what's there and invent nothing.
    const tenantForRun = { ...body.tenant };
    if (body.listing && typeof body.listing === "object") {
      if (body.listing.name && typeof body.listing.name === "string") tenantForRun.name = body.listing.name;
      if (body.listing.timezone && typeof body.listing.timezone === "string") tenantForRun.timezone = body.listing.timezone;
      if (body.listing.phone && typeof body.listing.phone === "string") tenantForRun.phone = body.listing.phone;
      if (body.listing.address && typeof body.listing.address === "string") tenantForRun.address = body.listing.address;
    }

    // 21 Oct 2026 (pricing integrity): the web page says this is a Docustay workspace; one Free workspace per person, no temporary addresses (checked again when the workspace is switched on, so leaving this field out gains nothing)
    if (body.product === "docustay") await withSignupConnection((db) => assertMayStartFree((sql, p) => db.query(sql, p), { email, alias: false }));

    const runId = await withSignupConnection(async (db) => {
      const id = await createRun(db, {
        slug: String(tenantForRun?.slug ?? "").toLowerCase(),
        name: String(tenantForRun?.name ?? ""),
      });
      return id;
    });

    const result = await withSignupConnection(async (db) =>
      runCriticalPrefix(db, {
        runId,
        tenant: tenantForRun,
        // ★ `email` from the token, `displayName` from the body. The first is identity and is not
        //   the caller's to state; the second is a preference and is.
        admin: { email, displayName: String(body?.admin?.displayName ?? email) },
        firebaseUid,
        isPlatform: wantsPlatform,
        staffRole,
        // ★ [TY, RULED 1 Oct 2026] Validated truthy above; this is the record of it.
        policyAcceptance: { ip: c.get("clientIp") ?? null, userAgent: headers["user-agent"] ?? null },
      })
    );

    // ── 3 · THE ORG CLAIM. Without it the person cannot log in to what they just created. ────
    // ★★★ [MEAS] a token minted by Firebase sign-up carries NO custom claims, and `login()` resolves
    //     the tenant from `orgSlugFromClaims(decoded)`. So a signup that stopped at step 2 would
    //     create an organisation its owner could never enter — the same class of unreachable state
    //     `prefix.mjs` exists to prevent, one layer up.
    // ★★ The claim is `orgId` — the LITERAL key, named once, from firebase.mjs. D2.1 records that
    //    the live token also carries a claim called `tenantId` whose value is the SAME hardcoded
    //    string for every user, and that reading it would set everyone to one context.
    // ★ It is set AFTER the commit, deliberately. A claim pointing at a tenant that failed to commit
    //   would be a durable lie in Google's system that we cannot roll back; a committed tenant whose
    //   claim failed is recoverable by signing in again, because the app_user row already carries
    //   the firebase_uid.
    // ★ The response carries NO uid, NO email and NO run id. A 201 states what was made and its
    //   public handle, and nothing that was not already the caller's.
    return c.json({
      tenantId: result.tenantId,
      slug: String(body.tenant.slug).toLowerCase(),
      isPlatform: wantsPlatform,
    }, 201);
  });

  // ── "Email me a code" — SignupForm's alternative to a password (12-signup-first-run-people.md
  //    §2/§6). Two new routes, both unauthenticated by necessity (no tenant yet, same reasoning as
  //    the routes above). NEITHER goes through `runTenantScoped`.
  //
  // ★★★ POST /api/signup/verify/request — same Turnstile gate as POST /api/signup (§4: "at any of
  //     these four routes"), then ensures a Firebase identity exists for the address so
  //     `requestEmailCode`'s own `getUserByEmail` lookup can find it (§6's "Firebase-user-creation
  //     step" — `createUser({..., emailVerified:false})`), then issues a code with
  //     `purpose: "verify_email"`. This is the SAME `requestEmailCode` the sign-in path calls
  //     (`src/auth/emailCode.mjs:123`) — new purpose value only, nothing in that function changed.
  //     Re-used unchanged for "send again" too (§2).
  app.post("/api/signup/verify/request", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON");
    }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");

    // ── THE BOT CHECK, BEFORE ANYTHING ELSE IS SPENT — same shape as POST /api/signup above. ──
    if (await isTurnstileEnabled()) {
      assertBotCheckConfigured();
      const ip = c.get("clientIp") ?? null;
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") {
        throw forbidden("We could not verify you are not a robot. Try again.");
      }
      if (outcome.reason === "unreachable") {
        formSubmitLimiter("signup", ip);
      }
    }

    // Launch (13 Oct 2026): the sign-up page asks for an email and nothing else, so the name is optional here (the workspace is named from the address and renamed in the first-run checklist)
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) throw invalid("email is required");
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("Enter a valid email address.", { field: "email" });

    // 21 Oct 2026 (pricing integrity): Docustay's Free plan is one workspace per person and never a temporary address. Asked BEFORE an identity is made or a code is sent. The exact same address is simply someone coming back (it signs in), so only another spelling
    // of an address that already has a Free workspace is turned away here; the workspace itself is checked again when it is made.
    if (body.product === "docustay" && process.env.KEYSTONE_SELF_HOST !== "1") await withSignupConnection((db) => assertMayStartFree((sql, p) => db.query(sql, p), { email, alias: true }));

    // ★ `auth/email-already-exists` is ORDINARY here — "use the existing identity", the SAME
    //   principle the password path already applies to the same Firebase error (§6,
    //   `webui/src/routes/signup/+page.svelte:138-151`). Any other failure is a dependency failure,
    //   the same envelope `verifyEmailCode`'s `createCustomToken` catch already uses
    //   (`src/auth/emailCode.mjs:220-226`) — never a raw provider error.
    // the identity is made here for both kinds: the built-in one (the sandbox) gets a random password nobody sees, Firebase gets a user with no password
    if (localAuthEnabled()) {
      // a self-hosted install does not take public sign-ups (its owner is made once, through the setup token); an unknown address there simply gets no code, like any unknown address
      if (process.env.KEYSTONE_SELF_HOST !== "1") await ensureLocalIdentity(email);
    } else {
      try {
        await getFirebaseAuth().createUser({ email, ...(name ? { displayName: name } : {}), emailVerified: false });
      } catch (err) {
        if (err?.code !== "auth/email-already-exists") {
          throw dependency("Sign-up is not available right now.", err);
        }
      }
    }

    const ip = c.get("clientIp") ?? null;
    // Docustay's own page asks for the code in its own words and language; anything else keeps the platform default
    const product = body.product === "docustay" ? "docustay" : null;
    const lang = typeof body.lang === "string" && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(body.lang) ? body.lang : null;
    const result = await requestEmailCode({ email, purpose: "verify_email", ip, product, lang });
    if (product === "docustay") void trackEvent("signup_started");   // Launch step 6: no email or address in the event
    return c.json(result);
  });

  // ★★★ POST /api/signup/verify/verify — redeems the code and mints a Firebase custom token, same
  //     shape as `/api/auth/code/verify` (`src/auth/install.mjs:439-443`). NO Turnstile gate here —
  //     §2 names no such error for this route, and the redeem path already has its own defence
  //     (`keystone.redeem_email_code`'s attempt counter). `verifyEmailCode` validates email/code
  //     itself; nothing is duplicated here. `purpose: "verify_email"` is what makes
  //     `emailCode.mjs:220-226` also call `updateUser(uid, {emailVerified:true})` before returning
  //     the custom token — the sign-in path's `purpose: "sign_in"` call is completely unchanged.
  app.post("/api/signup/verify/verify", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON");
    }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");

    const result = await verifyEmailCode({ email: body.email, code: body.code, purpose: "verify_email" });
    return c.json(result);
  });

  // Launch step 3: the one-click unsubscribe from a welcome email (the link opens /unsubscribe on the web app, which posts the token here; a mail client's own "Unsubscribe" button posts to the same link).
  // No session: the token is the proof. The answer is always the same, so a guessed or stale token learns nothing.
  app.post("/api/lifecycle/unsubscribe", async (c) => {
    let body = {}; try { body = await c.req.json(); } catch { /* a mail client's one-click post carries a form body, not JSON */ }
    const token = typeof body?.token === "string" ? body.token : new URL(c.req.url).searchParams.get("t");
    formSubmitLimiter("unsubscribe", c.get("clientIp") ?? null);
    return c.json(await unsubscribeByToken(token));
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TOUCH-UP · WORKSTREAM 12, TY 23 SEP 2026 — THE SIGNUP WIZARD BECOMES TWO STEPS, NOT ONE.
  //     Step 1 "What do you need the platform for?" (PRACTICE/WIRE/RUN, multi-select, ticking nothing
  //     means everything) is its own route below, `POST /api/signup/needs`, because it writes to a
  //     DIFFERENT store (`tenant_setting`, editable, read by `GET /api/nav`) than step 2's
  //     `tenant_intake` (write-once — migration 0229 grants it no UPDATE). Splitting the write is
  //     also what makes "leaving and coming back resumes" true for free: step 1's answer is durable
  //     the moment it is submitted, `GET /api/signup/questions/state` (below) tells the client which
  //     step to render on return, and step 2 is untouched below except for its widened `coachingType`
  //     (§ the schema change, `SignupQuestionsAnswers` in `src/http/validate.mjs`, and migration
  //     0341's matching CHECK-constraint widening).
  //
  //   ★ OWNER ONLY, same direct-role-check reasoning as step 2 below (see that route's own comment
  //     for why this is not `assertMay`).
  // ★ PART 4 [TY, RULED 23 Sep 2026] — the separate "what do you need the platform for?" step
  //   (`POST /api/signup/needs`, WORKSTREAM 12) is GONE. `shape` is now asked alongside coaching
  //   type/team size/moving from, in the one `POST /api/signup/questions` step below.

  // ★ RESUME STATE — lets SignupQuestions.svelte know, on mount, whether the wizard's one question
  //   step has already been answered (a person who left mid-wizard and came back). Owner-only,
  //   read-only. ★★★ TASK 17.36 — also returns the stored answers including movingFrom.
  app.get("/api/signup/questions/state", (c) => {
    if (typeof runTenantScoped !== "function") {
      throw internal(
        "GET /api/signup/questions/state is not wired: src/http/app.mjs must call " +
        "registerSignupRoutes(app, { runTenantScoped }) — see the comment on registerSignupRoutes " +
        "in src/routes/signup.mjs."
      );
    }
    return runTenantScoped(c, async ({ db, principal, tenantId }) => {
      if (principal.user?.role !== "staff" || principal.user?.staff_role !== "owner") {
        throw forbidden("only the practice's Owner may view this");
      }
      const { rows } = await db.query(
        `SELECT shape, coaching_type, team_size, moving_from, sample_clients_requested
         FROM keystone.tenant_intake WHERE tenant_id = $1`, [tenantId]);

      if (rows.length === 0) {
        return { intakeAnswered: false };
      }

      const intake = rows[0];
      return {
        intakeAnswered: true,
        answers: {
          shape: intake.shape,
          coachingType: intake.coaching_type,
          teamSize: intake.team_size,
          movingFrom: intake.moving_from,
          sampleClientsRequested: intake.sample_clients_requested,
        },
      };
      // ★ D2 [TY, RULED 23 Sep 2026] — "read" is not in RATE_BUCKETS (src/http/rateLimit.mjs:38),
      //   which 500'd every call to this route. No bucket falls through to runTenantScoped's own
      //   documented default, "api".
    }, { status: 200 }).then((result) => c.json(result));
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ POST /api/signup/questions — 12-signup-first-run-people.md §2/§3.1/§3.4-§3.8/§4. STEP 2 OF
  //     THE WIZARD (WORKSTREAM 12 above). By the time SignupQuestions renders, `POST /api/signup`
  //     has already committed the tenant and the caller has auto-logged in (`POST /api/auth/login`,
  //     existing, unchanged) — a session and a tenant both already exist, unlike every route above
  //     this one in this file.
  //
  //   ★ OWNER ONLY — a direct role check, NOT `assertMay(db, principal, {object:"tenant_intake",
  //     action:"tenant_intake.create"})`, which is the literal call §4 names. [MEASURED against
  //     `src/permissions/assertMay.mjs:41-48,105-122`] that call would throw before any query ran:
  //     `"tenant_intake.create"` is in neither `NAMED_ACTIONS` (a fixed 13-word vocabulary checked
  //     against `keystone.role_action`) nor `VERB_ACTIONS` (`view`/`edit`/`delete`, checked against
  //     `keystone.user_may`) — and `keystone.role_permission` (the table §4 says to seed a new row
  //     into) holds a VERB per object, never a dot-named ACTION; `"create"` is not a legal
  //     `role_permission.verb` value either. §4 conflates `role_permission` with `role_action`. Full
  //     note left on migration 0229 itself. `assertMay.mjs` belongs to a different task/stage
  //     (7.12b) and is not this task's file to extend.
  //
  //   ★ THE PK VIOLATION IS THE IDEMPOTENCY, not a separate check — `keystone.tenant_intake.tenant_id`
  //     is the PRIMARY KEY (migration 0229), so a second submission for the same tenant hits 23505
  //     and this route turns that into 409, matching §2's own error table.
  app.post("/api/signup/questions", (c) => {
    if (typeof runTenantScoped !== "function") {
      // ★ See the STOP-AND-REPORT comment on `registerSignupRoutes` above — this fires only until
      //   `src/http/app.mjs:299` passes `{ runTenantScoped }` in.
      throw internal(
        "POST /api/signup/questions is not wired: src/http/app.mjs must call " +
        "registerSignupRoutes(app, { runTenantScoped }) — see the comment on registerSignupRoutes " +
        "in src/routes/signup.mjs."
      );
    }
    return runTenantScoped(c, async ({ db, principal, body, tenantId }) => {
      const answers = parse(SignupQuestionsAnswers, body, "signup questions");

      if (principal.user?.role !== "staff" || principal.user?.staff_role !== "owner") {
        throw forbidden("only the practice's Owner may answer these questions");
      }
      const submittedBy = principal.appUserId;

      try {
        await db.query(
          `INSERT INTO keystone.tenant_intake
             (tenant_id, shape, coaching_type, team_size, moving_from, sample_clients_requested, submitted_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, answers.shape, answers.coachingType, answers.teamSize, answers.movingFrom,
           answers.sampleClientsRequested, submittedBy]
        );
      } catch (err) {
        if (err?.code === "23505") throw conflict("You've already answered these");
        throw err;
      }
      // ★ PART 4.5 — the OPERATIONAL column (migration 0343), not the audit-trail one above. Every
      //   route that gates the nav (`GET /api/nav`, `src/routes/index.mjs`) reads THIS.
      await db.query(`UPDATE keystone.tenant SET shape = $1 WHERE id = $2`, [answers.shape, tenantId]);

      const starterServices = await createStarterServices(db, {
        tenantId, coachingType: answers.coachingType,
      });

      let sampleClientsCreated = 0;
      if (answers.sampleClientsRequested === true) {
        const samples = await createSampleClients(db, { tenantId, actorUserId: submittedBy });
        sampleClientsCreated = 3;
        // ★ subject is the sample adult client — a sample person, so `emit()`'s own `is_sample`
        //   derivation (outbox.mjs:340-344) marks this event `sample:true` automatically; nothing
        //   here computes that itself.
        await emit(db, {
          tenantId, topic: "provisioning.samples.created", emittedBy: "provisioning",
          subjectType: "person", subjectId: samples.adult.id,
          payload: {
            adultId: samples.adult.id, adolescentId: samples.adolescent.id, parentId: samples.parent.id,
          },
          actor: userActor(submittedBy),
        });
      }

      await emit(db, {
        tenantId, topic: "provisioning.questions.answered", emittedBy: "provisioning",
        subjectType: "person", subjectId: submittedBy,
        payload: {
          coachingType: answers.coachingType, teamSize: answers.teamSize,
          movingFrom: answers.movingFrom, sampleClientsRequested: answers.sampleClientsRequested,
        },
        actor: userActor(submittedBy),
      });

      return {
        ok: true,
        starterServices: starterServices.map(({ id, name }) => ({ id, name })),
        sampleClientsCreated,
      };
    }, { bucket: "write", status: 200 }).then((result) => c.json(result));
  });
}
