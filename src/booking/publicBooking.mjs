// @ts-check
// src/booking/publicBooking.mjs — Spec 03b task 3b.3 · CT-117 (the public unauthenticated booking
// trust boundary, §4.2's own dedicated security review).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ READ §4.2 BEFORE TOUCHING THIS FILE. The whole property this module exists to hold is
//     narrower than "authenticate the caller" — there IS no caller to authenticate, by design.
//     The property is: **a request naming tenant A's slug in the URL can never cause a row to be
//     written under, or read from, tenant B — no matter what else the request contains.**
//
// ★★ THE TWO RULES §4.2's OWN GATE (`db/gates/p03b_public_booking_boundary.mjs`) GREPS FOR, NAMED
//    HERE SO A FUTURE EDIT DOES NOT HAVE TO GO FIND THEM AGAIN:
//      1. no read of `c.req.header(...)` other than `"host"` — that check lives in `src/routes/
//         public.mjs`, this file never touches a `Hono` context at all.
//      2. no read of `body.tenantId` / `body.tenant_id`, ANYWHERE in this file — every function
//         below takes `tenantId` as an explicit parameter, ALWAYS the value the route resolved
//         from the Host header (`subdomainFromRequest` → `resolve_tenant_by_slug`), NEVER a value
//         a caller could name. `practiceSlug` in the POST body is READ NOWHERE in this file for
//         exactly this reason — see `public.mjs`'s own comment at the call site.
//
// ★★★ WHY THIS FILE DOES NOT CALL `src/booking/createBooking.mjs`. §4.2 step 3 itself says the
//     public-create function does ITS OWN validated SELECT/INSERT (quoted verbatim in this file's
//     `createPublicBooking`, below) — and there is a second, measured reason `createBooking()`
//     could not be reused even if the spec text were silent on it: `createBooking.mjs:149-154`
//     checks `keystone.user_may($actorUserId, 'engagement', 'edit', $hostId)` before either guard,
//     and `keystone.user_may(NULL, …)` is unconditionally `false` (0192 — plain SQL NULL semantics).
//     A public booking has no actor by definition (`withTenant(tenantId, fn, { userId: null })`,
//     §4.2 step 3), so that check can never pass — not a bug to route around in JS, since
//     `keystone.booking`'s own `tenant_insert` RLS policy (0197, Stage 7 task 7.18) carries the
//     IDENTICAL `user_may` conjunct at the ROW level, and 0197's own header says explicitly "any
//     future writer … inherits the rule too, not just this one call site." **MEASURED**: no amount
//     of application-code cleverness reaches around a WITH CHECK the database itself evaluates.
//     Migration 0317 (this task) gives `tenant_insert` a SECOND, independent admission path — an
//     anonymous actor, no `created_by`, a staff host with `accepting_new_bookings`, and a service
//     with `public_bookable` — so the two opt-in columns 3b.1 already added (0311/0312) ARE the
//     authorization for a stranger, in place of RBAC a stranger cannot hold. See 0317's own header
//     for the full account, including why `h.role = 'staff'` is load-bearing there.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { publicLogoUrl } from "../branding/publicLogo.mjs";
import { withCredentialLookup } from "../db/index.mjs";
// ★ 13.20/CT-F28 — the availability CACHE, not `read.mjs`'s own `readSlots`: same read, sub-second
//   (G10). `src/booking/availabilityCache.mjs` is 13.19's own file and is NOT built yet at the time
//   this task runs — this import is syntax-only until 13.19 lands (see this task's own build report).
import { readSlotsCached } from "./availabilityCache.mjs";
import { createBooking } from "./createBooking.mjs";
import { addBookingParticipant, policyFor } from "./writes.mjs";
import { policySentence } from "./policySentence.mjs";
import { getSetting } from "../settings/writes.mjs";
import { createPerson } from "../people/writes.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { invalid, forbidden, notFound, conflict, AppError } from "../http/errors.mjs";
import { SlotTakenError } from "./createBooking.mjs";
// ★ 13.21/B-26 — a stranger may not book over a block. `expandBlock`/`addDaysISO` (13.17) and
//   `wallClockIn` (§B4 STEP 3) are read here, never edited — see `assertNoBlockOverlap` below.
import { expandBlock, addDaysISO } from "./blocks.mjs";
import { wallClockIn } from "./slots.mjs";
import { bookingPaymentStep } from "../money/bookingPayments.mjs";
import { ChargePathDisabled } from "../money/charge.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same joins, same locking, same parameterization).
//   `sql` is the escape hatch for what the builder itself does not express — JSON path operators,
//   FILTER, ANY(...), range operators, dynamic identifiers, GROUP BY/HAVING aggregates — per the
//   L3 per-file ruling: "SQL that calls plpgsql or uses features the builder lacks stays as sql`…`
//   through run". Every GUARD statement (the advisory lock, the GUARD 1 INSERT owned by task B-1)
//   stays as the original raw `tx.query`, unconverted — see this file's own FILE-OVERLAP note.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";

/** ★ Same generic message §4.2 requires everywhere on this path — one string, every cause. */
export const PUBLIC_BOOKING_REFUSED = "This page isn't available.";

const EXCLUSION_VIOLATION = "23P01";
const CHECK_VIOLATION = "23514";

/**
 * §4.2 step 1/2 — slug → tenant uuid, through the same hardened, already-granted resolver every
 * other credential lookup uses. `withCredentialLookup` (`src/db/index.mjs`) opens a connection
 * with NO tenant GUC set, so this is the one place in the whole request that is allowed to not
 * know the tenant yet — it is what discovers it.
 *
 * @param {string|null} subdomain — `subdomainFromRequest(c)`'s own output, ALREADY collapsed
 *   (no Host, wrong domain, reserved name, syntactically invalid — all `null`). Never a raw header.
 * @returns {Promise<string|null>} a tenant uuid, or `null` for anything that does not resolve to
 *   an active tenant. **The caller must not distinguish these cases** — §4.2 rule 2.
 */
export async function resolvePublicTenantId(subdomain) {
  if (!subdomain) return null;
  const { rows } = await withCredentialLookup((db) =>
    db.query(`SELECT keystone.resolve_tenant_by_slug($1) AS id`, [subdomain]));
  return rows[0]?.id ?? null;
}

/**
 * The practice page (`EngPublicPractice`, spec 03b §2.2 / 13.20). Branding read the same way
 * `resolve_login_branding_by_slug` computes it (practice-name override over the tenant's own name,
 * logo override), but done INSIDE the already-open tenant transaction rather than a second
 * credential-lookup round trip — the tenant is already known by the time this runs.
 *
 * ★★ CT-F06/0397 — `bio`/`photo_url` are real columns now (staff rows only). `bio` is returned
 *    as-is (the CHECK already bounds it to 600 chars); `photo_url`'s CHECK admits BOTH an
 *    `ks-object:` pointer and an `https://` URL (0397), but the endpoint that turns a pointer into
 *    a servable URL (`/api/public/book/photo/<id>`) is NOT built by any task yet — serving the raw
 *    `ks-object:` string to the public internet would leak an internal path, so only an
 *    already-external `https://` value is ever handed back; a pointer reads as `null` until that
 *    endpoint exists (flagged in this task's build report, R-4).
 * ★ `showStaffChoice` (`booking.show_staff_choice`, default true) is a practice's own decision,
 *   enforced HERE, server-side — when it is off, `coaches` is `[]` and no staff row (name, bio,
 *   photo — none of it) reaches the public page at all, never merely omitted client-side.
 */
export async function readPublicPractice(tx, { tenantId }) {
  // ★ 0496 (§4) — THE BARE PAGE'S DEFAULT: `booking.public_page_categories` (a list of
  //   service-category ids; unset or empty = every category shows). A practice that separates its
  //   divisions decides here what a visitor who found the PRACTICE (not a scoped link) is offered.
  //   Enforced HERE, server-side, same as every other booking switch (Group C ruling 1).
  const defaultCategories = await getSetting(tx, "booking.public_page_categories", null);
  const categoryIds = Array.isArray(defaultCategories) && defaultCategories.length > 0
    ? defaultCategories
    : null;
  return buildPracticeView(tx, { tenantId, categoryIds });
}

/**
 * 0496 (§4) — a SCOPED booking link (`keystone.booking_link`): the practice page, narrowed to the
 * link's categories / staff / locations. `GET /api/public/book/link?slug=…`. Returns `null` for a
 * slug that does not resolve to an active, unarchived link — the ROUTE collapses that to the same
 * generic 404 every other public miss gets (§4.2 rule 2), never a distinguishable error.
 */
export async function readPublicLink(tx, { tenantId, linkSlug }) {
  const slug = typeof linkSlug === "string" ? linkSlug.trim().toLowerCase() : "";
  if (!slug) return null;
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking_link")
    .select(["id", "name"])
    .where("tenant_id", "=", tenantId)
    .where(sql`lower(slug) = ${slug}`)
    .where("active", "=", true)
    .where("archived_at", "is", null));
  const link = rows[0];
  if (!link) return null;

  // No scope rows of a kind = unscoped on that axis (0496's own rule).
  const scope = async (table, col) => {
    const { rows: r } = await run(tx, db
      .selectFrom(sql.table(`keystone.${table}`).as("s"))
      .select(sql.ref(col).as("id"))
      .where("s.tenant_id", "=", tenantId)
      .where("s.link_id", "=", link.id));
    return r.length > 0 ? r.map((x) => x.id) : null;
  };
  const categoryIds = await scope("booking_link_category", "category_id");
  const staffIds = await scope("booking_link_staff", "app_user_id");
  const locationIds = await scope("booking_link_location", "location_id");

  const view = await buildPracticeView(tx, { tenantId, categoryIds, staffIds, locationIds });
  return { ...view, linkName: link.name };
}

async function buildPracticeView(tx, { tenantId, categoryIds = null, staffIds = null, locationIds = null }) {
  const { rows: brandRows } = await run(tx, db
    .selectFrom("keystone.tenant as t")
    .leftJoin("keystone.tenant_setting as pn", (join) => join
      .onRef("pn.tenant_id", "=", "t.id")
      .on("pn.key", "=", "practice.name"))
    .leftJoin("keystone.tenant_setting as lo", (join) => join
      .onRef("lo.tenant_id", "=", "t.id")
      .on("lo.key", "=", "branding.logo_url"))
    .select([
      sql`COALESCE(NULLIF(pn.value #>> '{}', ''), t.name)`.as("name"),
      sql`NULLIF(lo.value #>> '{}', '')`.as("logo_url"),
    ])
    .where("t.id", "=", tenantId));
  const brand = brandRows[0] ?? { name: null, logo_url: null };

  const services = await listPublicServices(tx, { tenantId, categoryIds, locationIds });

  // ★ Computed ONCE per request (the 7-point's own instruction) — a second `policyFor` call for
  //   the same `(tenantId, null)` answer would be a second round trip for one fact.
  const practicePolicy = await policyFor(tx, tenantId, null);
  const { sentence, short } = policySentence(practicePolicy);

  const { rows: tzRows } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select("timezone")
    .where("id", "=", tenantId));
  const timeZone = tzRows[0]?.timezone ?? "UTC";

  const showStaffChoice = (await getSetting(tx, "booking.show_staff_choice", true)) !== false;

  const coaches = [];
  if (showStaffChoice) {
    // ★ A staff scope narrows WHICH coaches show; `show_staff_choice` still decides WHETHER any do
    //   — the practice-wide switch outranks a link's list, never the other way round.
    let coachQuery = db
      .selectFrom("keystone.app_user")
      .select(["id", "display_name", "bio", "photo_url", "accepting_new_bookings", "booking_slug"])
      .where("tenant_id", "=", tenantId)
      .where("role", "=", "staff")
      .where("booking_slug", "is not", null)
      .orderBy("display_name");
    if (staffIds) {
      coachQuery = coachQuery.where(sql`id = ANY(${sql.val(staffIds)})`);
    }
    const { rows: coachRows } = await run(tx, coachQuery);

    // ★ Same "the first public service" reading `readPublicCoach` uses when no `serviceId` is
    //   given — now the first of the practice's OWN published list (ordered by name), not an
    //   arbitrary "earliest created" pick, since there can be more than one now (G12/CT-F28).
    const defaultService = services[0] ?? null;
    for (const coach of coachRows) {
      const firstAvailable = defaultService
        ? await findFirstAvailable(tx, {
            tenantId, hostId: coach.id, serviceId: defaultService.id, windowDays: defaultService.windowDays, timeZone,
          })
        : null;
      coaches.push({
        id: coach.id,
        displayName: coach.display_name,
        bio: coach.bio ?? null,
        photoUrl: typeof coach.photo_url === "string" && coach.photo_url.startsWith("https://")
          ? coach.photo_url
          : null,
        firstAvailable,
        acceptingNewBookings: coach.accepting_new_bookings === true,
        // ★ NOT in spec §2.2's own contract row — added anyway, additively, because without it the
        //   practice page's own coach cards (`EngPublicPractice.frame.html`, every card an
        //   `<a href>`) have no URL to link to: this table's own WHERE clause (above) already
        //   proves every row here HAS one.
        bookingSlug: coach.booking_slug,
      });
    }
  }

  return {
    name: brand.name,
    logoUrl: publicLogoUrl(brand.logo_url),
    services,
    policySentence: sentence,
    policyShort: short,
    showStaffChoice,
    coaches,
  };
}

/**
 * The coach page (`EngPublicCoach`, spec 03b §2.2 / 13.20). Resolves `coachSlug` WITHIN the
 * already-resolved tenant — never a second tenant guess. Three shapes back to the caller:
 *   - `{ redirect: { subjectType, coachSlug } }` — a dead slug with a live redirect target
 *     (`booking_link_redirect`, 0313); the route/frontend decides what to do with it.
 *   - `null` — no coach, no redirect either. The ROUTE throws the generic 404; this function does
 *     not, so a route can tell "genuinely nothing" apart from "redirect" without a thrown/caught
 *     control-flow for the ordinary case.
 *   - the real payload, with `bookable: false` for a coach who exists but is not currently
 *     bookable (not accepting, or the practice has no public_bookable service at all) — per §2.2's
 *     own table: "not a 404, because the practice page is still real."
 *
 * ★ `serviceId` (optional) picks that service out of the practice's OWN published list — never a
 *   bare id trusted against another tenant's row, since it is matched only against
 *   `listPublicServices`'s own tenant-scoped result, never queried directly against the id. Absent
 *   or unmatched falls back to "the first public service" (services[0], ordered by name).
 *   ★★ THE CALLER WIRING FOR THIS QUERY PARAM IS NOT BUILT BY THIS TASK — `src/routes/public.mjs`'s
 *      `GET /api/public/book/coach` handler is outside this task's file list (only
 *      `resolveGatedTenantId` is listed there), so nothing reads `c.req.query("serviceId")` yet.
 *      Flagged in the build report rather than silently edited.
 * ★ `availableTimes`' window is THAT SERVICE's own `windowDays` (policyFor's merged
 *   `booking_window_days`, practice default overridden per-service) — the old fixed 14-day cap is
 *   gone (G12), and slots come from the cache (`readSlotsCached`, 13.19), not a fresh scan.
 */
export async function readPublicCoach(tx, { tenantId, coachSlug, serviceId = null }) {
  const { rows: coachRows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["id", "display_name", "bio", "photo_url", "accepting_new_bookings"])
    .where("tenant_id", "=", tenantId)
    .where("role", "=", "staff")
    .where(sql`lower(booking_slug) = lower(${coachSlug})`));

  if (coachRows.length === 0) {
    return resolveDeadCoachSlug(tx, { tenantId, coachSlug });
  }
  const coach = coachRows[0];

  const services = await listPublicServices(tx, { tenantId });
  const requestedId = typeof serviceId === "string" ? serviceId.trim() : "";
  const requested = requestedId ? services.find((s) => s.id === requestedId) ?? null : null;
  const publicService = requested ?? services[0] ?? null;
  const bookable = coach.accepting_new_bookings === true && publicService !== null;

  const { rows: tz } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select("timezone")
    .where("id", "=", tenantId));

  let service = null;
  let availableTimes = [];
  if (publicService) {
    service = {
      id: publicService.id,
      name: publicService.name,
      durationMinutes: publicService.durationMinutes,
      priceMinor: publicService.priceMinor,
      paymentMode: publicService.paymentMode,
      windowDays: publicService.windowDays,
    };
    if (bookable) {
      availableTimes = await findUpcomingSlots(tx, {
        tenantId, hostId: coach.id, serviceId: publicService.id, windowDays: publicService.windowDays, timeZone: tz[0]?.timezone ?? "UTC",
      });
    }
  }

  return {
    coach: {
      id: coach.id,
      displayName: coach.display_name,
      bio: coach.bio ?? null,
      // ★ Same rule as the practice page's coach cards — see `readPublicPractice`'s own header.
      photoUrl: typeof coach.photo_url === "string" && coach.photo_url.startsWith("https://")
        ? coach.photo_url
        : null,
    },
    bookable,
    service,
    availableTimes,
    timezoneDefault: tz[0]?.timezone ?? "UTC",
  };
}

/**
 * §3/0313 — "old links redirect forever" (MOCKUPS §10). Reads only; `record_booking_slug_redirect`
 * (0313) is the only writer and this task never calls it (that write belongs to 3b.7, when a coach
 * edits their slug or is offboarded). `redirect_to_app_user_id IS NULL` means the redirect target
 * IS the practice page; otherwise the target is that coach`s CURRENT slug, read fresh (a coach`s
 * booking_slug can have changed again since the redirect row was written — the row names the
 * PERSON, never a slug, so it always resolves to wherever they are now).
 */
async function resolveDeadCoachSlug(tx, { tenantId, coachSlug }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking_link_redirect")
    .select("redirect_to_app_user_id")
    .where("tenant_id", "=", tenantId)
    .where("subject_type", "=", `coach`)
    .where(sql`lower(old_slug) = lower(${coachSlug})`));
  if (rows.length === 0) return null;

  const targetUserId = rows[0].redirect_to_app_user_id;
  if (!targetUserId) return { redirect: { subjectType: "practice" } };

  const { rows: current } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("booking_slug")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", targetUserId));
  const currentSlug = current[0]?.booking_slug ?? null;
  // ★ The redirect target coach may since have cleared their own slug (EngMyLink). There is
  //   nothing left to redirect TO at the person level — fall back to the practice page rather than
  //   a redirect that points at another dead slug.
  return currentSlug
    ? { redirect: { subjectType: "coach", coachSlug: currentSlug } }
    : { redirect: { subjectType: "practice" } };
}

/**
 * ★★ EVERY PUBLIC SERVICE, NOT JUST ONE (G12/CT-F05). **MEASURED**: no table links a service to a
 *    specific coach anywhere in this schema — `hostId` is a free parameter of `readSlots`, not a
 *    foreign key on `service`. Replaces the old singular `findPublicService`: a practice with more
 *    than one `public_bookable=true` service now lists ALL of them (ordered by name — "the
 *    practice's own list", not creation order), each carrying its own window/price/capacity rather
 *    than the visitor being shown one picked deterministically on their behalf.
 * ★ `priceMinor`/`currency` come from `keystone.current_price('service', id)` — the SAME
 *   effective-dating SQL 13.9 uses to resolve a booking's price snapshot, so a public quote and a
 *   staff-booked price can never disagree. `null` when no active price row exists — expected and
 *   correct when `paymentMode` is `'free'` (nothing to charge), not an error.
 * ★ `windowDays` is `policyFor`'s own merged `booking_window_days` (service override over practice
 *   default) — this is what kills the old fixed 14-day cap (G12).
 * ★ `nextClass` is computed ONLY for `default_capacity > 1` (a class, not a one-to-one session) —
 *   the next FUTURE, un-full occurrence of this service, `taken` counted from
 *   `booking_participant` live (0396's own comment: "never stored"), never another practice's rows
 *   (scoped by `tenantId` in every WHERE clause here, same as everywhere else in this file).
 */
async function listPublicServices(tx, { tenantId, categoryIds = null, locationIds = null }) {
  // ★ 0496/0497 (§4/§5) — the two scope axes, applied server-side:
  //   · categoryIds: only services IN one of the named categories. A service with no category
  //     belongs to no category, so a scoped page never shows it — scoping is an allow-list.
  //   · locationIds: a service with NO `service_location` rows is offered everywhere (0497's
  //     back-compat rule); one WITH rows must overlap the scope.
  const params = [tenantId];
  let scopeWhere = "";
  if (categoryIds) {
    params.push(categoryIds);
    scopeWhere += ` AND s.category_id = ANY($${params.length})`;
  }
  if (locationIds) {
    params.push(locationIds);
    scopeWhere += ` AND (NOT EXISTS (SELECT 1 FROM keystone.service_location sl
                                      WHERE sl.tenant_id = s.tenant_id AND sl.service_id = s.id)
                         OR EXISTS (SELECT 1 FROM keystone.service_location sl
                                     WHERE sl.tenant_id = s.tenant_id AND sl.service_id = s.id
                                       AND sl.location_id = ANY($${params.length})))`;
  }
  // ★ L3.0 — kept as the original raw `tx.query`, unconverted. `LEFT JOIN LATERAL
  //   keystone.current_price(...)` is a plpgsql set-returning function correlated to `s.id`; the
  //   builder has no join method that reproduces a LATERAL function call's row multiplicity (a
  //   correlated subquery would silently change to "at most one row, else throw" if the function
  //   ever returned more than one). Per this file's own rule: "if you have any doubt a statement
  //   converts byte-for-byte in meaning, leave it as the original raw tx.query and count it."
  const { rows } = await tx.query(
    `SELECT s.id, s.name, s.duration_minutes, s.default_capacity,
            cp.amount_minor, cp.currency
       FROM keystone.service s
       LEFT JOIN LATERAL keystone.current_price('service', s.id) cp ON true
      WHERE s.tenant_id = $1 AND s.public_bookable = true AND s.bookable = true AND s.active = true${scopeWhere}
      ORDER BY s.name`,
    params);

  const out = [];
  for (const row of rows) {
    const policy = await policyFor(tx, tenantId, row.id);
    const payment = await readPaymentMode(tx, { serviceId: row.id });
    const capacity = row.default_capacity;
    const nextClass = typeof capacity === "number" && capacity > 1
      ? await findNextClassOccurrence(tx, { tenantId, serviceId: row.id })
      : null;
    out.push({
      id: row.id,
      name: row.name,
      durationMinutes: row.duration_minutes,
      priceMinor: row.amount_minor ?? null,
      currency: row.currency ?? null,
      paymentMode: payment.payment_mode,
      windowDays: policy.booking_window_days,
      capacity,
      nextClass,
    });
  }
  return out;
}

/**
 * The next future occurrence of a class-capacity service that still has a seat. `taken` is COUNTED
 * from `booking_participant` (party `client`|`pir`) — never stored — the identical rule 0396's own
 * comment on `booking.capacity` states for every reader, this one included.
 */
async function findNextClassOccurrence(tx, { tenantId, serviceId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking as b")
    .leftJoin("keystone.booking_participant as bp", (join) => join
      .onRef("bp.tenant_id", "=", "b.tenant_id")
      .onRef("bp.booking_id", "=", "b.id"))
    .select([
      "b.id",
      "b.starts_at",
      sql`COALESCE(b.capacity, 1)`.as("capacity"),
      sql`COUNT(bp.id) FILTER (WHERE bp.party IN ('client', 'pir'))`.as("taken"),
    ])
    .where("b.tenant_id", "=", tenantId)
    .where("b.service_id", "=", serviceId)
    .where("b.state", "<>", "cancelled")
    .where("b.starts_at", ">", sql`now()`)
    .groupBy(["b.id", "b.starts_at", "b.capacity"])
    .having(sql`COUNT(bp.id) FILTER (WHERE bp.party IN ('client', 'pir')) < COALESCE(b.capacity, 1)`)
    .orderBy("b.starts_at", "asc")
    .limit(1));
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    startsAt: row.starts_at.toISOString(),
    placesLeft: row.capacity - Number(row.taken),
  };
}

async function readPaymentMode(tx, { serviceId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking_policy")
    .select("payment_mode")
    .where("service_id", "=", serviceId)
    .limit(1));
  // ★ No policy row is not an error (`read.mjs`'s own comment: "booking should work before somebody
  //   has been through settings") — 'free' is 0311's own column default, so an unset policy and an
  //   explicit 'free' policy read the same to a visitor, which is correct: neither can be charged.
  return { payment_mode: rows[0]?.payment_mode ?? "free" };
}

/**
 * ★★ G12 — THE FIXED 14-DAY CAP IS GONE. How far ahead this looks is now `windowDays`, the
 *    CALLER's own — `policyFor`'s merged `booking_window_days` for the service in question
 *    (service override over the practice's `booking.window_days` default) — never a constant
 *    baked into this module. A service configured for a 60-day window shows a slot on day 45.
 *    Slots come from the CACHE (`readSlotsCached`, 13.19/CT-F28), not a fresh scan per day.
 */
function localDates(now, timeZone, windowDays) {
  const today = new TZDate(now.getTime(), timeZone);
  return Array.from({ length: windowDays }, (_, i) => format(addDays(today, i), "yyyy-MM-dd"));
}

async function findFirstAvailable(tx, { tenantId, hostId, serviceId, windowDays, timeZone }) {
  const now = new Date();
  for (const date of localDates(now, timeZone, windowDays)) {
    const { slots } = await readSlotsCached(tx, { tenantId, hostId, date, serviceId, now });
    if (slots.length > 0) return slots[0].startsAt.toISOString();
  }
  return null;
}

/**
 * Every slot over the next `windowDays`, flattened. The frontend buckets these into the date-pill
 * row the frame shows (`EngPublicCoach.frame.html`) — no second query shape is invented here for
 * "one day's times" because the wire contract (spec 03b §2.2) names exactly one field,
 * `availableTimes: [...]`, with no date parameter alongside `coachSlug`. See `findFirstAvailable`'s
 * own header for why `windowDays` is a parameter now, not a fixed constant (G12).
 */
async function findUpcomingSlots(tx, { tenantId, hostId, serviceId, windowDays, timeZone }) {
  const now = new Date();
  const out = [];
  for (const date of localDates(now, timeZone, windowDays)) {
    const { slots } = await readSlotsCached(tx, { tenantId, hostId, date, serviceId, now });
    for (const s of slots) out.push({ startsAt: s.startsAt.toISOString() });
  }
  return out;
}

/**
 * §4.2 step 3 — the public-create function, its own validated SELECT/INSERT, quoted from the spec:
 * *"if the body's `serviceId` names a real service belonging to a different practice, the SELECT
 * … WHERE tenant_id = current_tenant_id() AND id = $serviceId … simply matches zero rows — RLS
 * makes the foreign id unreadable, not merely checked and rejected."* Every lookup below is scoped
 * to `tenantId` for exactly that reason, even though RLS would also refuse a foreign id on its own —
 * the WHERE clause is not decorative, it is the same property stated twice.
 *
 * ★ NO `actorUserId`, NO `creditForUserId` — the public door never accepts either (spec 03b §9:
 *   "package/plan credits are the portal door's, not the public door's").
 * ★ `forMinor: true` is REFUSED here, not routed into a `pending_consent` state. The guardian
 *   consent gate (CT-116) — a NEW `keystone.guardian` edge, a consent document, the hold-expiry
 *   job — is task 3b.5's own, later-wave build (`FEATURES-COMBINED-PLAN.md` "Task 3b.5 — Teen
 *   booking-consent gate"). This task's own Done criterion is the adult path end to end; refusing
 *   the minor path honestly (rather than silently booking a minor as if they were an adult, or
 *   guessing at 3b.5's not-yet-built consent shape) is the safe reading of "if the plan doesn't
 *   match the real code, STOP and report — do not guess" applied to a safety-critical branch.
 */
export async function createPublicBooking(tx, {
  tenantId, hostId, serviceId, startsAt, endsAt,
  name, email, phone = null, whatBringsYou = null, srcTag = null,
  // ★ 13.21 — the closed vocabulary this door may ever write (`booking_source_check`, 0399, admits
  //   more: 'staff'/'portal'/'rwg' are other doors' own, never this one's to claim). `bookingId`
  //   names an EXISTING class occurrence to join, rather than a new time to create.
  source = "public", bookingId = null,
}) {
  if (!hostId) throw invalid("a coach or coachSlug is required");
  if (!serviceId) throw invalid("serviceId is required");
  if (!(startsAt instanceof Date) || !(endsAt instanceof Date)) {
    throw new TypeError("startsAt and endsAt must be Date instances (UTC instants)");
  }
  if (typeof name !== "string" || !name.trim()) throw invalid("name is required");
  if (typeof email !== "string" || !email.trim()) throw invalid("email is required");
  // ★★★ [TY, RULED 2 Oct 2026] EMAIL AND PHONE ARE BOTH REQUIRED FOR EVERY PERSON, NO EXCEPTIONS —
  //   createPerson (src/people/writes.mjs) now enforces this unconditionally; this is the same
  //   check next to name/email above, not a new rule invented for this door specifically.
  if (typeof phone !== "string" || !phone.trim()) throw invalid("phone is required");
  if (source !== "public" && source !== "waitlist") {
    throw invalid(`source must be "public" or "waitlist" — got ${JSON.stringify(source)}`);
  }

  // ── the host must be a real, currently-accepting staff member of THIS tenant ──────────────────
  const { rows: hostRows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", hostId)
    .where("role", "=", "staff")
    .where("accepting_new_bookings", "=", true));
  if (hostRows.length === 0) {
    // ★ Same generic refusal as an unresolvable slug — a stranger cannot learn "that host exists
    //   but isn't accepting" from "that host doesn't exist" (§4.2's enumeration-oracle discipline,
    //   applied here the same way it applies to tenant resolution).
    throw notFound(PUBLIC_BOOKING_REFUSED);
  }

  // ── the service must be a real, currently public-bookable service of THIS tenant ──────────────
  const { rows: serviceRows } = await run(tx, db
    .selectFrom("keystone.service")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", serviceId)
    .where("public_bookable", "=", true)
    .where("bookable", "=", true)
    .where("active", "=", true));
  if (serviceRows.length === 0) {
    throw forbidden("this service isn't available to book here");
  }

  // ── 13.21 — THE SAME POLICY THE STAFF AND PORTAL DOORS ENFORCE. One merged read (13.8's
  //    `policyFor`, service buffer summed with the practice gap) — buffers, notice and window all
  //    come from HERE, never re-derived from `tenant_setting` a second time in this file. ────────
  const policy = await policyFor(tx, tenantId, serviceId);

  // ── notice — the same instant-vs-instant comparison the portal door uses (`src/routes/app.mjs`
  //    :712-722, C1.1): a DURATION in minutes, never a wall-clock rule, so no zone applies here. ──
  const nowMs = Date.now();
  const minimumNoticeMs = policy.minimum_notice_minutes * 60_000;
  if (startsAt.getTime() <= nowMs + minimumNoticeMs) {
    throw invalid("That time is too soon to book online.");
  }
  const bookingWindowMs = policy.booking_window_days * 24 * 60 * 60 * 1000;
  if (startsAt.getTime() > nowMs + bookingWindowMs) {
    throw invalid("That time is beyond how far ahead this practice takes online bookings.");
  }

  // ── who-can-book — a practice's own decision (F05), enforced HERE, server-side: an outage must
  //    not open a public booking path that should be shut. Checked against the SAME normalised
  //    email `findOrCreateLead` uses below, never a second normalisation of the same value. ──────
  const whoCanBook = await getSetting(tx, "booking.who_can_book", "anyone");
  if (whoCanBook === "existing_clients") {
    const normEmail = email.trim().toLowerCase();
    const { rows: existingClient } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where(sql`lower(email) = ${normEmail}`)
      .where("lifecycle_status", "<>", "lead"));
    if (existingClient.length === 0) {
      // ★ Never "no account with that email" — that would confirm to a stranger whether an email
      //   IS known to this practice, a disclosure §4.2's enumeration-oracle discipline forbids.
      throw forbidden("This practice only takes online bookings from people already on its books.");
    }
  }

  // ═══ CLASS JOIN — bookingId names an EXISTING occurrence; this is not a new time. ═════════════
  if (bookingId) {
    const leadId = await findOrCreateLead(tx, { tenantId, email, name, phone, srcTag });
    // ★ 13.10's own capacity guard lives INSIDE `addBookingParticipant` (src/booking/writes.mjs —
    //   NOT this task's file): it 404s an unknown/foreign bookingId, 409s a cancelled/completed/
    //   no_show booking, and 409s "That was the last place — it just went. Join the waitlist?"
    //   once `capacity` is reached, under the SAME per-host advisory lock `createBooking.mjs`'s own
    //   guard 2 uses. MEASURED at build time: that guard is NOT YET PRESENT in `writes.mjs` as of
    //   this task (13.10 is listed as a dependency, field 10, but has not landed) — flagged in this
    //   task's build report rather than guessed around or built a second time in a file outside
    //   this task's own list.
    await addBookingParticipant(tx, {
      tenantId, bookingId, party: "client",
      appUserId: leadId, displayName: name.trim(), email: email.trim().toLowerCase(),
    });
    const { rows: br } = await run(tx, db
      .selectFrom("keystone.booking")
      .select("state")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", bookingId));
    return { bookingId, state: br[0]?.state ?? null };
  }

  // ── GUARD 2 — serialise the host, then look. Same shape as createBooking.mjs's own guard 2. ───
  await tx.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    [`booking:${tenantId}:${hostId}`]);

  // ★★★ B-26 (DECISIONS-MADE-FOR-TY.md) — A STRANGER MAY NOT BOOK OVER A BLOCK. Run inside the
  //     SAME advisory-locked section as the clash check below: `booking_block` has no lock or
  //     exclusion constraint of its own (0402), so this is exactly as serialised against a
  //     concurrent request for this host as the booking-clash check itself.
  await assertNoBlockOverlap(tx, { tenantId, hostId, startsAt, endsAt });

  // ── 13.21 — the CANDIDATE's own window widened by ITS OWN buffer, checked against `occupies`
  //    (already widened by each EXISTING row's own stored buffer — the trigger at
  //    `db/migrations/0013_booking_model.sql:146-156`). Buffers ignored was the named defect. ────
  const occStart = new Date(startsAt.getTime() - policy.buffer_before_minutes * 60_000);
  const occEnd = new Date(endsAt.getTime() + policy.buffer_after_minutes * 60_000);
  const { rows: clash } = await run(tx, db
    .selectFrom("keystone.booking")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("host_id", "=", hostId)
    .where("state", "<>", "cancelled")
    .where("occupies", "&&", sql`tstzrange(${occStart}, ${occEnd}, '[)')`)
    .limit(1));
  if (clash.length > 0) {
    throw new SlotTakenError("That time was just booked. Choose another slot.", clash[0].id);
  }

  // ── the price row in force NOW — snapshotted, never re-looked-up later. Same idiom as 13.9's
  //    `createBooking.mjs`:204-218 — Stripe is the money record; this is only a record of what was
  //    agreed at booking time. ─────────────────────────────────────────────────────────────────
  const { rows: priceRows } = await run(tx, db
    .selectFrom("keystone.price")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("subject_type", "=", "service")
    .where("subject_id", "=", serviceId)
    .where("active", "=", true)
    .where("effective_from", "<=", sql`now()`)
    .where((eb) => eb.or([
      eb("effective_to", "is", null),
      eb("effective_to", ">", sql`now()`),
    ]))
    .orderBy("effective_from", "desc")
    .limit(1));
  const priceId = priceRows[0]?.id ?? null;

  // ── GUARD 1 — the index has the final word; also where the RLS policy (0317) is enforced ─────
  let booking;
  try {
    booking = await createBooking(tx, {
      tenantId, hostId, serviceId, startsAt, endsAt,
      description: typeof whatBringsYou === "string" && whatBringsYou.trim() ? whatBringsYou.trim() : null,
      source: "public", actorUserId: null,
    }, { publicBooking: true });
  } catch (e) {
    if (e.code === EXCLUSION_VIOLATION) {
      throw new SlotTakenError("That time was just booked. Choose another slot.");
    }
    if (e instanceof AppError) throw e;
    if (e.code === "42501" /* insufficient_privilege */) {
      // ★ The RLS policy itself refused — host/service passed the two SELECTs above but the row's
      //   own WITH CHECK (0317) did not admit it. This should be unreachable given the two guards
      //   above already re-check the same predicates, and is surfaced plainly rather than guessed
      //   at, per this file's own "do not guess" discipline.
      throw forbidden("this booking could not be completed");
    }
    throw e;
  }

  // ── 15.31 — PAYMENT STEP. Read payment mode/deposit from booking_policy, create lead, then call
  //    payment processing. If charges are disabled for a money-moving payment, roll back the entire
  //    transaction and return 409 with the exact message. ────────────────────────────────────────
  const { rows: policyRows } = await run(tx, db
    .selectFrom("keystone.booking_policy")
    .select(["payment_mode", "deposit_amount_minor"])
    .where("service_id", "=", serviceId)
    .limit(1));
  const paymentMode = policyRows[0]?.payment_mode ?? "free";
  const depositMinor = policyRows[0]?.deposit_amount_minor ?? null;

  // ── Get the service's current price (priceMinor) — same effective-dated logic as 13.9 ─────────
  const { rows: currentPriceRows } = await run(tx, db
    .selectFrom(sql`keystone.current_price('service', ${serviceId})`.as("cp"))
    .select("cp.amount_minor"));
  const priceMinor = currentPriceRows[0]?.amount_minor ?? null;

  // ── Find-or-create the lead; they are the payer for public bookings ─────────────────────────
  const leadId = await findOrCreateLead(tx, { tenantId, email, name, phone, srcTag });

  // ── Call the payment step. ChargePathDisabled rolls back and surfaces as 409 with a
  //    user-friendly message. ──────────────────────────────────────────────────────
  let pay = null;
  try {
    pay = await bookingPaymentStep(tx, {
      tenantId,
      bookingId: booking.id,
      payerUserId: leadId,
      paymentMode,
      depositMinor,
      priceMinor,
    });
  } catch (e) {
    if (e instanceof ChargePathDisabled) {
      // ★ Transaction rolls back because this error is thrown inside the withTenant callback.
      throw conflict("Online payment isn't switched on for this practice yet — contact them to book.");
    }
    throw e;
  }

  await emit(tx, {
    tenantId,
    topic: "booking.booking.created",
    emittedBy: "booking",
    subjectType: "booking",
    subjectId: booking.id,
    // ★ No actor — `userActor(null)` reads "system", the same shape every other actor-less writer
    //   (webhook, worker) already uses. There is no session to attribute this to.
    actor: userActor(null),
    payload: {
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      state: booking.state,
      host_id: hostId,
      service_id: serviceId,
      invitee_timezone: null,
      source,
    },
  });

  await addBookingParticipant(tx, {
    tenantId, bookingId: booking.id, party: "client",
    appUserId: leadId, displayName: name.trim(),
    email: email.trim().toLowerCase(),
  });

  return { bookingId: booking.id, state: booking.state, payment: pay };
}

/**
 * ★★★ B-26 (DECISIONS-MADE-FOR-TY.md, measured independently by two sibling tasks) — a stranger's
 *    direct POST must not be able to book straight over a block. Nothing in the schema stops it
 *    (`blocks.mjs`'s own file header: 0402 has no FK, no exclusion constraint, no trigger against
 *    `keystone.booking`); the only place a block ever kept a slot off the page was 13.18's
 *    READ-time filter (`readSlots` composing `expandBlock`, `src/booking/read.mjs:99-129`) — a
 *    direct POST bypasses that page entirely. This is the one write-time check for it here.
 * ★ Same coarse SQL bound + `expandBlock` composition 13.18's own section uses (±1 LOCAL day
 *   around the requested start, in the practice's zone — §B4 STEP 3) — re-derived rather than
 *   imported from `read.mjs`, since `readSlots` answers a different question (a whole day's slots)
 *   and importing it would pull in the whole availability-cache read path for one boolean.
 * ★ The refusal names no block, no label, no other person — the same generic shape as a booking
 *   clash: a stranger learns only that the time will not work.
 */
async function assertNoBlockOverlap(tx, { tenantId, hostId, startsAt, endsAt }) {
  const { rows: tzRows } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select("timezone")
    .where("id", "=", tenantId));
  const timeZone = tzRows[0]?.timezone ?? "UTC";

  const startWall = wallClockIn(startsAt, timeZone);
  const date = `${startWall.year}-${String(startWall.month).padStart(2, "0")}-${String(startWall.day).padStart(2, "0")}`;
  const fromDate = addDaysISO(date, -1);
  const toDate = addDaysISO(date, 1);

  const { rows: blockRows } = await run(tx, db
    .selectFrom("keystone.booking_block")
    .select(["starts_at", "ends_at", "repeat", "repeat_until", "skipped_dates"])
    .where("tenant_id", "=", tenantId)
    .where("host_id", "=", hostId)
    .where((eb) => eb.or([
      eb.and([
        eb("repeat", "=", "none"),
        eb("ends_at", ">", sql`(${date}::date - interval '1 day')`),
        eb("starts_at", "<", sql`(${date}::date + interval '2 days')`),
      ]),
      eb.and([
        eb("repeat", "<>", "none"),
        eb.or([
          eb("repeat_until", "is", null),
          eb("repeat_until", ">=", sql`(${date}::date - interval '1 day')`),
        ]),
      ]),
    ])));

  for (const block of blockRows) {
    for (const occ of expandBlock(block, fromDate, toDate, timeZone)) {
      if (occ.startsAt < endsAt && startsAt < occ.endsAt) {
        throw new SlotTakenError("That time is no longer available. Choose another slot.");
      }
    }
  }
}

/**
 * A returning visitor booking a second time must not collide with themselves as a "duplicate
 * email" 409 — `createPerson`'s own conflict path is for a STAFF member adding someone who already
 * exists, a mistake to flag; a public visitor typing the same email twice is not a mistake. So this
 * checks first and only calls `createPerson` for a genuinely new address.
 *
 * ★ `source` (0312/CT-120) is written ONLY on create, from `srcTag`. A returning visitor's ORIGINAL
 *   acquisition source is a fact about how they first arrived — a second booking under a different
 *   `?src=` tag does not rewrite history.
 * ★ `mobile_phone` is passed straight into createPerson now (below) — never overwriting a phone
 *   number already on file for a RETURNING visitor (the early `existing.length === 1` return,
 *   above, skips createPerson entirely for them). ★ [TY, RULED 2 Oct 2026] email and phone are
 *   both required for every person; `createPublicBooking`'s own top-level check (this file, near
 *   its `name`/`email` checks) already refuses before reaching here, so `phone` is guaranteed
 *   present for a genuinely NEW lead by the time this function runs.
 */
async function findOrCreateLead(tx, { tenantId, email, name, phone, srcTag }) {
  const normEmail = email.trim().toLowerCase();
  const { rows: existing } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where(sql`lower(email) = ${normEmail}`));
  if (existing.length === 1) return existing[0].id;

  const person = await createPerson(tx, {
    tenantId, email: normEmail, displayName: name.trim(), mobilePhone: typeof phone === "string" ? phone.trim() : null,
    role: "adult_client", staffRole: null, invite: false, actorUserId: null,
  });

  const sets = [];
  if (typeof srcTag === "string" && srcTag.trim()) sets.push({ col: "source", val: srcTag.trim() });
  if (sets.length > 0) {
    try {
      const setValues = {};
      for (const s of sets) setValues[s.col] = s.val ?? null;
      await run(tx, db
        .updateTable("keystone.app_user")
        .set(setValues)
        .where("tenant_id", "=", tenantId)
        .where("id", "=", person.id));
    } catch (e) {
      if (e.code === CHECK_VIOLATION) {
        throw invalid(`that phone number could not be understood: ${JSON.stringify(phone)}`);
      }
      throw e;
    }
  }
  return person.id;
}
