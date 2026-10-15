// Task 3b.7 — `EngMyLink` ROUTES: a coach's own persistent booking link.
// Spec: specs/03-engagements/03b-booking-and-engagements.md §2.3 (routes), §3 (data), §4.1 (perms).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NOT MOUNTED UNDER `guarded()`/`authoriseSection`, SAME REASONING AS `src/routes/calendar.mjs`
//     (its own header comment, quoted): `FEATURES-COMBINED-PLAN.md` does not list spec 03b among the
//     specs permitted to touch `src/nav/sections.mjs`/`src/nav/buildState.mjs` for this task, and
//     `EngMyLink` is reached from the avatar menu, not a nav row (same shape `/account/security`,
//     task 8.19, and `/settings/calendar`, task 3a.2, already use). So authorisation here is the
//     standalone floor `atLeastRank(user, 'coach')` (`src/nav/authorise.mjs`) plus the self-only
//     scoping inside every handler below — spec 03b §4.1`s own row: "Coach … own calendar, own`
//     `EngMyLink`" is the identical permission shape §4.1 already gives calendar.mjs, and this file
//     follows it rather than routing through `assertMay`'s `scope:'owned'` check, which resolves
//     `ownerId` from `body?.id` (`src/permissions/assertMay.mjs`) — never present on a self-only
//     write with no id in the body, so `scope_allows('owned', null, viewer)` is unconditionally
//     false (0192, plain SQL NULL semantics) for exactly this shape of route. Never a caller-chosen
//     coach id: every handler below scopes to `ctx.principal.appUserId`, always.
//
// ★ NO EVENT EMITTED HERE, DELIBERATELY. Spec 03b §5's own Events table is the closed list of what
//   this spec emits, and it names nothing for a coach editing `booking_slug`/`accepting_new_bookings`
//   — `booking.availability.changed` and `booking.policy.changed` are different facts (weekly hours,
//   `booking_policy` rows), not this one. `writeAudit` below still runs: that is the general "every
//   settings-shaped write is audited" discipline (CT-041/042), independent of the events catalogue.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { atLeastRank } from "../nav/authorise.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { invalid } from "../http/errors.mjs";
import { APP_DOMAIN_VAR } from "../auth/tenantFromHost.mjs";
import { readMyLink, updateMyLink } from "../booking/bookingLinks.mjs";

// ★ Same read, same fallback, as every other call site that builds a tenant-subdomain URL
//   (`src/routes/writes.mjs:420`, `src/routes/settings.mjs:152`) — not re-derived here.
const appDomain = () => process.env[APP_DOMAIN_VAR] || "example.com";

async function tenantSlugOf(db, tenantId) {
  const { rows } = await db.query(`SELECT slug FROM keystone.tenant WHERE id = $1`, [tenantId]);
  return rows[0]?.slug ?? null;
}

// ★ `domain` is ONE FIELD BEYOND spec 03b §2.3's minimal wire table (`{slug, url,
//   acceptingNewBookings, taggedLinks}`) — added so the frame's own "domain prefix box beside an
//   editable slug" structure (`EngMyLinkScreen.svelte`) can render the REAL domain even before a
//   slug is ever set, when `url` itself is still null and has nothing to derive a prefix from. It
//   is the same tenant-subdomain fact `url` is already built from, never a second source of truth.
//   Documented in this task's own build report, not guessed past silently.
function withUrl(view, tenantSlug) {
  const domain = tenantSlug ? `${tenantSlug}.${appDomain()}` : null;
  const url = view.slug && domain ? `https://${domain}/book/${view.slug}` : null;
  return { ...view, url, domain };
}

export function registerBookingLinksRoutes(app, { runTenantScoped }) {
  /** ★ The one floor every route here shares — see the file header. */
  const requireCoach = (ctx) => atLeastRank(ctx.principal.user, "member");

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2.3 — GET /api/engagements/my-link
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/my-link", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      const view = await readMyLink(ctx.db, { tenantId: ctx.tenantId, coachUserId: ctx.principal.appUserId });
      const tenantSlug = await tenantSlugOf(ctx.db, ctx.tenantId);
      return withUrl(view, tenantSlug);
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2.3 — POST /api/engagements/my-link  {slug?, acceptingNewBookings?}
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/engagements/my-link", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      const { slug, acceptingNewBookings } = ctx.body;
      const updated = await updateMyLink(ctx.db, {
        tenantId: ctx.tenantId, coachUserId: ctx.principal.appUserId, slug, acceptingNewBookings,
      });
      await writeAudit(ctx.db, {
        tenantId: ctx.tenantId, action: "settings.changed", object: "engagement.booking_link",
        subjectId: ctx.principal.appUserId, actorUserId: ctx.principal.appUserId, reason: null,
      });
      const tenantSlug = await tenantSlugOf(ctx.db, ctx.tenantId);
      return withUrl(updated, tenantSlug);
    }, { bucket: "write" }).then((r) => c.json(r, 200)));
}
