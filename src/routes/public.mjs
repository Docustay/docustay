// @ts-check
// src/routes/public.mjs — Spec 03b task 3b.3 · CT-117, the public unauthenticated booking door.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ READ `src/booking/publicBooking.mjs`'s OWN FILE HEADER FIRST. That module holds the actual
//     tenant-isolation property; this file's only job is the HTTP edge around it: resolve the Host
//     header, open ONE tenant transaction per request with `{ userId: null }`, and dispatch.
//
// ★★ THE TWO RULES `db/gates/p03b_public_booking_boundary.mjs` (§4.2's own named static gate, spec
//    §12 "Gates" — not this task's own file to write, per this task's Files field, but the rule is
//    honoured here regardless): this file reads `c.req.header(` in exactly one place — `"host"`,
//    via `subdomainFromRequest(c)` — and never reads `body.tenantId` / `body.tenant_id` anywhere.
//    `body.practiceSlug` (present on the wire per spec §2.2's own contract row) is likewise READ
//    NOWHERE below — the tenant is the one the Host header already resolved, never a value the
//    body could name instead. Grep this file for "practiceSlug" to see it is absent on purpose.
//
// ★ REGISTERED OUTSIDE THE TENANT MACHINERY, same reasoning as `registerSignupRoutes`/
//   `registerWebhookRoutes` (`src/http/app.mjs`, right beside this file's own registration call):
//   there is no session and no tenant yet when the request arrives — resolving the tenant IS this
//   file's job, so it cannot run inside `runTenantScoped`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { publicLogoUrl } from "../branding/publicLogo.mjs";
import { withTenant } from "../db/index.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { subdomainFromRequest } from "../auth/tenantFromHost.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { getSetting } from "../settings/writes.mjs";
import { verifyTurnstile } from "../http/turnstile.mjs";
import { formSubmitLimiter } from "../http/rateLimit.mjs";
import { invalid, notFound } from "../http/errors.mjs";
import {
  resolvePublicTenantId,
  readPublicPractice,
  readPublicLink,
  readPublicCoach,
  createPublicBooking,
  PUBLIC_BOOKING_REFUSED,
} from "../booking/publicBooking.mjs";
// ★ 13.14 — the waitlist claim door. `peekLinkToken`/`redeemLinkToken`/`parsePresented` are the
//   shipped link-token machinery (CT-018/019); nothing here mints a second token mechanism.
import { peekLinkToken, redeemLinkToken, parsePresented } from "../auth/linkToken.mjs";
import { peekOffer, claimOffer, declineOffer } from "../booking/waitlist.mjs";
import { findPossibleDuplicate, createPerson } from "../people/writes.mjs";
import { emit } from "../events/outbox.mjs";
import { submitForm, getFormSubmitResponse } from "../growth/forms.mjs";

/**
 * §4.2 rule 2 + §13 — a `null` slug, an unresolved/suspended tenant, AND the flag being off all
 * collapse to the SAME generic 404. No code path here distinguishes any of the three from one
 * another — that collapsing is the enumeration-oracle discipline the whole boundary depends on.
 *
 * @returns {Promise<string>} a real tenant uuid, or throws the one generic `notFound`.
 */
async function resolveGatedTenantId(c) {
  const subdomain = subdomainFromRequest(c);
  const tenantId = await resolvePublicTenantId(subdomain);
  if (!tenantId) throw notFound(PUBLIC_BOOKING_REFUSED);

  // ★ The flag read needs a tenant transaction (`flagIsOn`'s own `assertTenantTx`) — opened here,
  //   read-only, then discarded; the route's real work opens its own transaction afterwards. Two
  //   short transactions rather than one held open across the whole handler is the same shape
  //   `isTurnstileEnabled()` (`src/routes/signup.mjs`) uses for the no-tenant-yet case; here a
  //   tenant already exists by this point, so `withTenant` (not `withCredentialLookup`) is correct.
  const enabled = await withTenant(tenantId, (tx) => flagIsOn(tx, "public_booking_enabled", tenantId), {
    userId: null,
  });
  if (!enabled) throw notFound(PUBLIC_BOOKING_REFUSED);

  // ★ 13.20/CT-F02 — "public" is a practice's own decision, enforced HERE, server-side, on every
  //   route this gate guards — never merely omitted from a list. `booking.online_enabled` (default
  //   true) is the practice's own turn-off switch (F12's "turn off online booking" modal); reading
  //   it inside its own short tenant tx, same shape as the flag read just above.
  const onlineEnabled = await withTenant(
    tenantId,
    (tx) => getSetting(tx, "booking.online_enabled", true),
    { userId: null },
  );
  if (onlineEnabled === false) throw notFound(PUBLIC_BOOKING_REFUSED);

  return tenantId;
}

export function registerPublicBookingRoutes(app) {
  // ── EngPublicPractice — GET /api/public/book/practice ──────────────────────────────────────────
  app.get("/api/public/book/practice", async (c) => {
    c.header("cache-control", "no-store");
    const tenantId = await resolveGatedTenantId(c);
    const result = await withTenant(tenantId, (tx) => readPublicPractice(tx, { tenantId }), { userId: null });
    return c.json(result);
  });

  // ── a SCOPED booking link — GET /api/public/book/link?slug= (0496, §4) ────────────────────────
  app.get("/api/public/book/link", async (c) => {
    c.header("cache-control", "no-store");
    const tenantId = await resolveGatedTenantId(c);
    const slug = String(c.req.query("slug") ?? "").trim();
    if (!slug) throw invalid("slug is required");
    const result = await withTenant(tenantId, (tx) => readPublicLink(tx, { tenantId, linkSlug: slug }), { userId: null });
    // ★ Same generic miss as every other public 404 (§4.2 rule 2) — an unknown, archived or
    //   switched-off link is indistinguishable from a practice that never existed.
    if (result === null) throw notFound(PUBLIC_BOOKING_REFUSED);
    return c.json(result);
  });

  // ── EngPublicCoach — GET /api/public/book/coach?coachSlug= ─────────────────────────────────────
  app.get(`/api/public/book/coach`, async (c) => {
    c.header("cache-control", "no-store");
    const tenantId = await resolveGatedTenantId(c);
    const coachSlug = String(c.req.query("coachSlug") ?? "").trim();
    if (!coachSlug) throw invalid("coachSlug is required");
    // ★★ 13.20's `serviceId`, FORWARDED — one line, added 25 Sep 2026. `readPublicCoach` accepts a
    //    `serviceId` and uses it to pick the service whose duration and window shape the times it
    //    offers; §13.20 field 4 says it comes from "the requested serviceId query param when
    //    given", but that field's own file list confined the task to `resolveGatedTenantId`, so it
    //    built the parameter and could not reach the handler that reads the query string. It said
    //    so rather than widening its scope — correctly. Without this the parameter existed, was
    //    documented, and was permanently null: a public visitor picking a service would have been
    //    offered times computed for a different one.
    //  ★ Empty string → null, so an absent or blank param keeps the existing default behaviour
    //    rather than asking for a service whose id is "".
    const serviceId = String(c.req.query("serviceId") ?? "").trim() || null;

    const result = await withTenant(
      tenantId, (tx) => readPublicCoach(tx, { tenantId, coachSlug, serviceId }), {
      userId: null,
    });
    // ★ §2.2's own table: an unknown slug with no redirect target either is the ONE case that is a
    //   genuine 404 on this route (everything else — a real but non-bookable coach — is 200 with
    //   `bookable:false`, per the same table). `result.redirect` (dead slug, live target) is handed
    //   back as-is; the frontend decides whether to navigate there.
    if (result === null) throw notFound(PUBLIC_BOOKING_REFUSED);
    return c.json(result);
  });

  // ── booking form submit — POST /api/public/book ─────────────────────────────────────────────────
  app.post("/api/public/book", async (c) => {
    const tenantId = await resolveGatedTenantId(c);

    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON");
    }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");

    // ── the bot check, before anything else is spent — same 3-outcome contract, same fail-open-on-
    //    unreachable ruling (`src/http/turnstile.mjs`'s own file header, the maintainer 17 Sep 2026) every other
    //    adopter of this module already applies (`src/routes/signup.mjs`). `turnstile_enabled` is
    //    read the same gated way `public_booking_enabled` was above — inside a short tenant tx.
    const turnstileOn = await withTenant(tenantId, (tx) => flagIsOn(tx, "turnstile_enabled", tenantId), {
      userId: null,
    });
    if (turnstileOn) {
      const ip = c.get("clientIp") ?? null;
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") {
        throw invalid("We could not verify you are not a robot. Try again.");
      }
      if (outcome.reason === "unreachable") {
        formSubmitLimiter("public_book", ip);
      }
    }

    // ── §9 — the guardian-consent gate (CT-116) is task 3b.5's own, later-wave, not-yet-built work.
    //    `forMinor: true` is refused here rather than silently booked as an adult or guessed into a
    //    `pending_consent` shape this task never built. See `publicBooking.mjs`'s own comment on
    //    `createPublicBooking` for the full reasoning.
    if (body.forMinor === true) {
      throw invalid(
        "Booking for someone under 18 isn't available on this page yet. Please contact the practice directly."
      );
    }

    // ── coachSlug → hostId, WITHIN the already-resolved tenant. `coachId` is accepted per §2.2's own
    //    "coachSlug or coachId" wire contract, but only ever matched inside this SAME tenant — never
    //    trusted as a bare id, for the identical reason §4.2 step 3 gives for `serviceId`.
    const coachSlug = typeof body.coachSlug === "string" ? body.coachSlug.trim() : "";
    const coachId = typeof body.coachId === "string" ? body.coachId.trim() : "";
    if (!coachSlug && !coachId) throw invalid("coachSlug or coachId is required");

    const startsAt = new Date(body.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw invalid("startsAt is required and must be a valid date/time");

    const result = await withTenant(tenantId, async (tx) => {
      let hostId = coachId || null;
      if (!hostId) {
        const { rows } = await tx.query(
          `SELECT id FROM keystone.app_user
             WHERE tenant_id = $1 AND role = 'staff' AND lower(booking_slug) = lower($2)`,
          [tenantId, coachSlug]);
        hostId = rows[0]?.id ?? null;
      }
      // ★ Same generic refusal as everywhere else on this path — an unmatched coach reference must
      //   not be distinguishable from any other refusal reason.
      if (!hostId) throw notFound(PUBLIC_BOOKING_REFUSED);

      let serviceId = typeof body.serviceId === "string" ? body.serviceId.trim() : "";
      if (!serviceId) {
        const { rows } = await run(tx, db.selectFrom("keystone.service")
          .select(["id"])
          .where("tenant_id", "=", tenantId)
          .where("public_bookable", "=", true)
          .where("bookable", "=", true)
          .where("active", "=", true)
          .orderBy("created_at", "asc")
          .limit(1));
        serviceId = rows[0]?.id ?? null;
      }
      if (!serviceId) throw invalid("serviceId is required");

      const durationRows = await run(tx, db.selectFrom("keystone.service")
        .select(["duration_minutes"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", serviceId));
      const durationMinutes = durationRows.rows[0]?.duration_minutes ?? 60;
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

      return createPublicBooking(tx, {
        tenantId, hostId, serviceId, startsAt, endsAt,
        name: body.name, email: body.email, phone: body.phone ?? null,
        whatBringsYou: body.whatBringsYou ?? null, srcTag: body.srcTag ?? null,
        // ★ 13.21 — the class-join door: an existing occurrence to join, never a new time.
        bookingId: body.bookingId ?? null,
      });
    }, { userId: null });

    // ★ No new confirmation screen is named by this task`s FRAME field — the coach page itself is`
    //   the confirmation surface, with the booking id carried as a query param so the frontend can
    //   render the "you're booked" state on the same page it was reached from.
    const confirmationUrl = coachSlug
      ? `/book/${encodeURIComponent(coachSlug)}?confirmed=${encodeURIComponent(result.bookingId)}`
      : `/book?confirmed=${encodeURIComponent(result.bookingId)}`;

    return c.json({ bookingId: result.bookingId, state: result.state, confirmationUrl }, 201);
  });
}

/**
 * Growth routes (C4.1) — public, unauthenticated landing pages and lead forms.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ READ `src/routes/public.mjs`'s FILE HEADER ABOVE. This module extends the public-facing
 *     unauthenticated boundary with the same tenant-isolation properties as the booking door.
 *
 * ★ REGISTERED OUTSIDE THE TENANT MACHINERY for the same reason: the tenant is resolved FROM
 *   the landing page slug, never passed in the request. Tenant scoping is strict: every route
 *   resolves the tenant from the slug and the context (subdomain or direct); no body.tenantId
 *   is read anywhere below.
 *
 * ★★ RATE LIMITED on all write routes (lead form, unsubscribe), using formSubmitLimiter.
 *    Turnstile is checked if enabled, same fail-open policy as the booking routes.
 *
 * ★ CONSENT IS RECORDED BEFORE THE LEAD IS STORED — consent_record is the transactional
 *   barrier; the lead data (funnel_event) is created only after consent exists.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
export function registerPublicGrowthRoutes(app) {
  // ── GET /go/:pageSlug — view a published landing page ──────────────────────────────────────
  app.get("/go/:pageSlug", async (c) => {
    c.header("cache-control", "no-store");
    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) throw notFound("not found");

    const pageSlug = c.req.param("pageSlug");
    if (!pageSlug) throw notFound("not found");

    const result = await withTenant(tenantId, async (tx) => {
      // Get the published landing page — must not be ended
      const pageResult = await run(tx, db.selectFrom("keystone.landing_page")
        .select(["id", "slug", "title", "body", "is_published", "purpose", "cta_type", "booking_service_id", "ended_at"])
        .where("tenant_id", "=", tenantId)
        .where("slug", "=", pageSlug)
        .where("is_published", "=", true)
        .where("ended_at", "is", null));

      if (pageResult.rowCount === 0) throw notFound("not found");

      const page = pageResult.rows[0];

      // Record page view event
      await tx.query(
        `INSERT INTO keystone.funnel_event
         (tenant_id, landing_page_id, event_type, created_at)
         VALUES ($1, $2, 'page_view', now())`,
        [tenantId, page.id]
      );

      return {
        id: page.id,
        slug: page.slug,
        title: page.title,
        body: page.body,
        is_published: page.is_published,
        purpose: page.purpose,
        cta_type: page.cta_type,
        booking_service_id: page.booking_service_id,
      };
    }, { userId: null });

    return c.json(result);
  });

  // ── POST /go/:pageSlug/lead — submit a lead form with consent ─────────────────────────────
  app.post("/go/:pageSlug/lead", async (c) => {
    // ★ Parse body first
    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON");
    }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");

    // ★ Consent is required before anything else is stored
    if (body.consent !== true) {
      throw invalid("consent is required to submit this form");
    }

    const ip = c.get("clientIp") ?? null;

    // ★ Rate limit FIRST, before any tenant resolution (F721 fix)
    formSubmitLimiter("public_growth_lead", ip);

    // ★ Resolve tenant after rate limit
    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) throw notFound("not found");

    // ★ Check Turnstile if enabled, same fail-open as booking routes
    const turnstileOn = await withTenant(tenantId, (tx) => flagIsOn(tx, "turnstile_enabled", tenantId), {
      userId: null,
    });
    if (turnstileOn) {
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") {
        throw invalid("We could not verify you are not a robot. Try again.");
      }
      if (outcome.reason === "unreachable") {
        formSubmitLimiter("public_growth_lead", ip);
      }
    }

    const pageSlug = c.req.param("pageSlug");
    if (!pageSlug) throw notFound("not found");

    const result = await withTenant(tenantId, async (tx) => {
      // Verify the landing page exists and is published
      const pageResult = await run(tx, db.selectFrom("keystone.landing_page")
        .select(["id"])
        .where("tenant_id", "=", tenantId)
        .where("slug", "=", pageSlug)
        .where("is_published", "=", true));

      if (pageResult.rowCount === 0) throw notFound("not found");
      const pageId = pageResult.rows[0].id;

      // ★★★ RECORD CONSENT FIRST — this is the transactional barrier. If anything after this
      //     fails, the consent_record still exists and the form is not silently accepted.
      //     Include detail field with formatted string: 'lead form ' || slug || ' — ' || email
      const consentDetail = `lead form ${pageSlug} — ${body.email}`;
      const consentResult = await tx.query(
        `INSERT INTO keystone.consent_record
         (tenant_id, consent_type, ip_address, user_agent, consent_method, is_active, detail, created_at)
         VALUES ($1, 'marketing', $2, $3, 'web_form', true, $4, now())
         RETURNING id`,
        [tenantId, ip, c.req.header("user-agent") || null, consentDetail]
      );

      const consentId = consentResult.rows[0].id;

      // ★ Find or create the lead person
      const displayName = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      // ★★★ [TY, RULED 2 Oct 2026] EMAIL AND PHONE ARE BOTH REQUIRED FOR EVERY PERSON — same
      //   convention this route already used for email/name (no separate manual check here;
      //   createPerson's own required-fields check, src/people/writes.mjs, is what enforces it).
      //   No public renderer for `/go/:pageSlug` was found anywhere in webreact (a pre-existing
      //   gap — the staff-side landing-page BUILDER exists, nothing renders the published page for
      //   a visitor) — wired for correctness against that future caller.
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";

      const possibleDuplicate = await findPossibleDuplicate(tx, {
        tenantId,
        displayName,
        email,
        mobilePhone: phone,
      });

      let personId;
      if (possibleDuplicate) {
        personId = possibleDuplicate.id;
      } else {
        const person = await createPerson(tx, {
          tenantId,
          email,
          displayName,
          firstName: displayName,
          mobilePhone: phone,
          role: "adult_client",
          lifecycleStatus: "lead",
          source: `landing:${pageSlug}`,
          actorUserId: null,
        });
        personId = person.id;
      }

      // ★ Set consent_record.person_id
      await tx.query(
        `UPDATE keystone.consent_record SET person_id = $1 WHERE id = $2`,
        [personId, consentId]
      );

      // ★ Record funnel event for the lead submission (conversion event, NO PII in metadata)
      await tx.query(
        `INSERT INTO keystone.funnel_event
         (tenant_id, landing_page_id, event_type, person_id, metadata, created_at)
         VALUES ($1, $2, 'conversion', $3, $4, now())`,
        [tenantId, pageId, personId, JSON.stringify({})]
      );

      // ★ Emit forms.form.submitted event
      await emit(tx, {
        tenantId,
        topic: "forms.form.submitted",
        emittedBy: "forms",
        subjectType: "person",
        subjectId: personId,
        actor: "system", // RUN-2: was { type: "public" } — not an actor shape emit() accepts (anonymous = "system", publicBooking.mjs:708)
        payload: { person_id: personId, landing_page_id: pageId },
      });

      // ★ Emit growth.landing_page.lead event
      await emit(tx, {
        tenantId,
        topic: "growth.landing_page.lead",
        emittedBy: "growth",
        subjectType: "landing_page",
        subjectId: pageId,
        actor: "system", // RUN-2: was { type: "public" } — not an actor shape emit() accepts (anonymous = "system", publicBooking.mjs:708)
        payload: { person_id: personId },
      });

      return {
        success: true,
        consentId,
      };
    }, { userId: null });

    return c.json(result, 201);
  });

  // ── POST /go/unsubscribe — mark consent revoked (idempotent, token-based) ─────────────────
  app.post("/go/unsubscribe", async (c) => {
    let body = {};
    try {
      body = await c.req.json();
    } catch {
      // Not JSON, continue with empty body
    }

    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) {
      // No tenant resolved — return safe response without error
      return c.json({ status: "unsubscribed" });
    }

    const ip = c.get("clientIp") ?? null;

    // ★ Rate limit (fail-closed on limit exceeded)
    formSubmitLimiter("public_growth_unsubscribe", ip);

    const token = typeof body.token === "string" ? body.token.trim() : "";

    // Import here to avoid circular dependency
    const { unsubscribeByToken } = await import("../growth/consent.mjs");

    const result = await withTenant(
      tenantId,
      (tx) => unsubscribeByToken(tx, { tenantId, token }),
      { userId: null }
    );

    return c.json(result);
  });

  // ── POST /go/unsubscribe/undo — re-enable consent (idempotent, token-based) ───────────
  app.post("/go/unsubscribe/undo", async (c) => {
    let body = {};
    try {
      body = await c.req.json();
    } catch {
      // Not JSON, continue with empty body
    }

    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) {
      // No tenant resolved — return safe response without error
      return c.json({ status: "resubscribed" });
    }

    const ip = c.get("clientIp") ?? null;

    // ★ Rate limit (fail-closed on limit exceeded)
    formSubmitLimiter("public_growth_unsubscribe", ip);

    const token = typeof body.token === "string" ? body.token.trim() : "";

    // Import here to avoid circular dependency
    const { resubscribeByToken } = await import("../growth/consent.mjs");

    const result = await withTenant(
      tenantId,
      (tx) => resubscribeByToken(tx, { tenantId, token }),
      { userId: null }
    );

    return c.json(result);
  });
}

/**
 * 13.14 — the public waitlist claim. `/api/public/waitlist/claim` (GET peek, POST claim) and
 * `/api/public/waitlist/decline`, for the link a client is emailed when a freed slot is offered to
 * them (`booking.waitlist.offered`, 13.15's job mints the token). No session, ever — the presented
 * link token IS the credential, the same idiom the four Stage 7 signer routes already use.
 *
 * ★★★ TENANT IS RESOLVED FROM THE HOST, THEN CHECKED AGAINST THE TOKEN'S OWN TENANT — NEVER THE
 *     OTHER WAY AROUND. `peekLinkToken`/`redeemLinkToken` are tenant-BLIND by design (CT-018/019:
 *     discovering the practice IS the point of the call), so a token minted for practice B presented
 *     on practice A's subdomain must be refused — the SAME generic refusal as everything else on
 *     this file, never a hint about which side was wrong.
 * ★ Every refusal on this surface is `notFound(PUBLIC_BOOKING_REFUSED)` — including the link
 *   token's OWN `forbidden` (a spent/expired/revoked/wrong-purpose/malformed token) — collapsed
 *   here into the ONE shape this whole file already uses everywhere else, never
 *   `linkToken.mjs`'s own 403 (that shape is correct for the SIGNED SIGNER routes in
 *   `src/routes/writes.mjs`, a different boundary with a different, already-established discipline;
 *   this file's own established discipline, unbroken since `registerPublicBookingRoutes` above, is
 *   ONE generic 404).
 */
export function registerPublicWaitlistRoutes(app) {
  // ── GET /api/public/waitlist/claim?t= — peek the offer, spends nothing ─────────────────────────
  app.get("/api/public/waitlist/claim", async (c) => {
    c.header("cache-control", "no-store");
    const tenantId = await resolveGatedTenantId(c);

    const presented = String(c.req.query("t") ?? "");
    let peeked;
    try {
      peeked = await peekLinkToken(presented, ["waitlist_claim"]);
    } catch {
      throw notFound(PUBLIC_BOOKING_REFUSED);
    }
    if (peeked.tenantId !== tenantId) throw notFound(PUBLIC_BOOKING_REFUSED);

    const result = await withTenant(
      tenantId, (tx) => peekOffer(tx, { tenantId, entryId: peeked.subjectId }), { userId: null });
    return c.json(result);
  });

  // ── POST /api/public/waitlist/claim {t} — Take it. First to redeem, books. ─────────────────────
  app.post("/api/public/waitlist/claim", async (c) => {
    const tenantId = await resolveGatedTenantId(c);

    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON");
    }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");

    // ── the bot check, before anything else is spent — same 3-outcome contract as
    //    POST /api/public/book, above ────────────────────────────────────────────────────────────
    const turnstileOn = await withTenant(tenantId, (tx) => flagIsOn(tx, "turnstile_enabled", tenantId), {
      userId: null,
    });
    if (turnstileOn) {
      const ip = c.get("clientIp") ?? null;
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") {
        throw invalid("We could not verify you are not a robot. Try again.");
      }
      if (outcome.reason === "unreachable") {
        formSubmitLimiter("public_waitlist_claim", ip);
      }
    }

    const presented = typeof body.t === "string" ? body.t : "";
    // ★★★ THE SPEND — single-use, in ONE SQL statement (see `waitlist.mjs`'s own file-header
    //     comment on what makes a double-click impossible to redeem twice). Any refusal —
    //     malformed, wrong pepper, wrong purpose, already spent, expired, revoked — collapses to
    //     the SAME generic 404 this whole file already uses, never `linkToken.mjs`'s own 403.
    let redeemed;
    try {
      redeemed = await redeemLinkToken(presented, ["waitlist_claim"]);
    } catch {
      throw notFound(PUBLIC_BOOKING_REFUSED);
    }
    if (redeemed.tenantId !== tenantId) throw notFound(PUBLIC_BOOKING_REFUSED);

    const result = await withTenant(
      tenantId, (tx) => claimOffer(tx, { tenantId, entryId: redeemed.subjectId }), { userId: null });

    if (result.state === "expired") return c.json({ state: "expired" }, 409);
    if (result.state === "taken") {
      return c.json(
        { state: "taken", message: "Someone beat you to it — you're still on the list." }, 409);
    }
    return c.json({ bookingId: result.bookingId, state: result.bookingState }, 201);
  });

  // ── POST /api/public/waitlist/decline {t} — "Not this one — keep me on the list." ──────────────
  app.post("/api/public/waitlist/decline", async (c) => {
    const tenantId = await resolveGatedTenantId(c);

    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON");
    }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");

    const presented = typeof body.t === "string" ? body.t : "";
    const parsed = parsePresented(presented);
    // ★ A non-spending PEEK, not a redeem — decline's own mechanism for invalidating the link is
    //   the explicit revoke inside `declineOffer`, not the single-use spend a claim uses.
    let peeked;
    try {
      peeked = await peekLinkToken(presented, ["waitlist_claim"]);
    } catch {
      throw notFound(PUBLIC_BOOKING_REFUSED);
    }
    if (!parsed || peeked.tenantId !== tenantId) throw notFound(PUBLIC_BOOKING_REFUSED);

    await withTenant(tenantId, (tx) => declineOffer(tx, {
      tenantId, entryId: peeked.subjectId, tokenId: parsed.tokenId,
    }), { userId: null });

    return c.json({ message: "Not this one — keep me on the list." });
  });

  // ── GET /go/subscribe/:tenantSlug — view the practice subscription page ────────────────────
  app.get("/go/subscribe/:tenantSlug", async (c) => {
    c.header("cache-control", "no-store");
    const tenantSlug = c.req.param("tenantSlug");
    if (!tenantSlug) throw notFound("not found");

    // Resolve tenant by slug from Host header
    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) throw notFound("not found");

    // Return practice branding and subscription form metadata
    const result = await withTenant(tenantId, async (tx) => {
      // ★ tenant has no `branding` column (this 500'd): branding lives in tenant_setting
      //   (`branding.logo_url`; the colour key was ruled out — settings/keys.mjs S8)
      const practiceResult = await run(tx, db.selectFrom("keystone.tenant")
        .select(["id", "name"])
        .where("id", "=", tenantId));
      if (practiceResult.rowCount === 0) throw notFound("not found");
      const practice = practiceResult.rows[0];
      const logoUrl = await getSetting(tx, "branding.logo_url", null);
      return {
        name: (await getSetting(tx, "practice.name", null)) ?? practice.name,
        branding: publicLogoUrl(logoUrl) ? { logoUrl: publicLogoUrl(logoUrl) } : {},
      };
    }, { userId: null });

    return c.json(result);
  });

  // ── POST /go/subscribe/:tenantSlug — submit the subscription form ───────────────────────────
  app.post("/go/subscribe/:tenantSlug", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON");
    }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");

    const ip = c.get("clientIp") ?? null;

    // ★ Rate limit FIRST, before any tenant resolution (F721 fix)
    formSubmitLimiter("public_growth_subscribe", ip);

    // ★ Resolve tenant
    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) throw notFound("not found");

    // ★ Check Turnstile if enabled
    const turnstileOn = await withTenant(tenantId, (tx) => flagIsOn(tx, "turnstile_enabled", tenantId), {
      userId: null,
    });
    if (turnstileOn) {
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") {
        throw invalid("We could not verify you are not a robot. Try again.");
      }
      if (outcome.reason === "unreachable") {
        formSubmitLimiter("public_growth_subscribe", ip);
      }
    }

    // ★★★ ENUMERATION SAFETY: Catch any error and return the generic response regardless
    let capturedError = null;
    try {
      await withTenant(tenantId, async (tx) => {
        await submitForm(tx, tenantId, "subscribe", {
          email: body.email,
          firstName: body.email.split("@")[0],
          // ★ [TY, RULED 2 Oct 2026] phone is now required by submitForm (growth/forms.mjs) — see
          //   its own header note. No frontend found anywhere that calls this route today
          //   (grepped; this subscribe widget has no real embed/render path yet — a pre-existing
          //   gap, not something this change created), so wiring body.phone through is for
          //   correctness against that future caller, not a behavior anyone can observe live now.
          phone: body.phone,
        }, body.consent === true, ip, c.req.header("user-agent") || null);
      }, { userId: null });
    } catch (err) {
      // Log the error but do NOT leak it to the response
      if (err.statusCode !== 400) {
        capturedError = err;
      }
    }

    // ★ Return byte-identical response regardless of success or failure (enumeration safety)
    return c.json(getFormSubmitResponse(), 200);
  });

  // ── POST /go/f/:formSlug — submit a standalone form ──────────────────────────────────────────
  app.post("/go/f/:formSlug", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      throw invalid("the request body is not JSON");
    }
    if (!body || typeof body !== "object") throw invalid("the request body is not an object");

    const ip = c.get("clientIp") ?? null;
    const formSlug = c.req.param("formSlug");
    if (!formSlug) throw notFound("not found");

    // ★ Rate limit FIRST
    formSubmitLimiter("public_growth_form", ip);

    // ★ Resolve tenant
    const subdomain = subdomainFromRequest(c);
    const tenantId = await resolvePublicTenantId(subdomain);
    if (!tenantId) throw notFound("not found");

    // ★ Check Turnstile if enabled
    const turnstileOn = await withTenant(tenantId, (tx) => flagIsOn(tx, "turnstile_enabled", tenantId), {
      userId: null,
    });
    if (turnstileOn) {
      const outcome = await verifyTurnstile(body.turnstileToken, ip);
      if (outcome.reason === "rejected") {
        throw invalid("We could not verify you are not a robot. Try again.");
      }
      if (outcome.reason === "unreachable") {
        formSubmitLimiter("public_growth_form", ip);
      }
    }

    // ★★★ ENUMERATION SAFETY: Catch any error and return the generic response regardless
    let capturedError = null;
    try {
      await withTenant(tenantId, async (tx) => {
        // Verify the form exists (identify by slug in a form_slug column or landing_page)
        // For now, we'll check if a landing page with this slug exists
        const formResult = await run(tx, db.selectFrom("keystone.landing_page")
          .select(["id"])
          .where("tenant_id", "=", tenantId)
          .where("slug", "=", formSlug)
          .where("is_published", "=", true));
        if (formResult.rowCount === 0) throw notFound("not found");

        await submitForm(tx, tenantId, formSlug, {
          email: body.email,
          firstName: body.firstName || body.email.split("@")[0],
          // ★ [TY, RULED 2 Oct 2026] Same note as the subscribe route just above — wired for
          //   correctness; no public renderer for this form exists yet (webreact's FormBuilder.jsx
          //   is the staff-side form BUILDER, not a public renderer).
          phone: body.phone,
        }, body.consent === true, ip, c.req.header("user-agent") || null);
      }, { userId: null });
    } catch (err) {
      // Log the error but do NOT leak it to the response
      if (err.statusCode !== 400 && err.message !== "not found") {
        capturedError = err;
      } else if (err.message === "not found") {
        throw notFound("form not found");
      }
    }

    // ★ Return byte-identical response regardless of success or failure (enumeration safety)
    return c.json(getFormSubmitResponse(), 200);
  });
}
