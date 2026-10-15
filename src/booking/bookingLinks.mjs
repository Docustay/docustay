// @ts-check
// src/booking/bookingLinks.mjs — Task 3b.7, spec 03b §2.3/§3 (`EngMyLink`, CT-106).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A COACH'S OWN PERSISTENT LINK, NOT A `link_token`. `keystone.app_user.booking_slug` /
//     `accepting_new_bookings` (0312) are a standing, non-expiring identity — the opposite shape
//     from the single-use, expiring `keystone.link_token` rows spec 03b's other screens mint
//     (`waitlist_claim`, `invite`, `document_signature`). This module only ever reads/writes the
//     coach's own row and the redirect table (0313); it never touches `link_token` at all.
//
// ★★ EVERY FUNCTION TAKES `coachUserId` EXPLICITLY, NEVER READ FROM A CALLER-CHOSEN BODY FIELD —
//    same discipline `calendarConnect.mjs`'s `hostId` follows for the sibling "own calendar"
//    surface named in the same permissions-table row (spec 03b §4.1: `Coach … own calendar, own`
//    EngMyLink"). The caller (`src/routes/bookingLinks.mjs`) always supplies
//    `ctx.principal.appUserId`, never a value out of `ctx.body`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid, notFound, conflict } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

// ★ Same label shape family as `validateSubdomain`'s practice-slug rule (`src/provisioning/
//   subdomain.mjs`) — reused, not re-derived, per spec 03b §3's own note on migration 0312. This is
//   the identical regex the database CHECK (`app_user_booking_slug_shape`) already enforces; kept
//   here too so a bad shape is refused before a round trip to the database, not only after it.
const SLUG_SHAPE = /^[a-z0-9](-?[a-z0-9])*$/;

async function currentRow(tx, tenantId, coachUserId) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["booking_slug", "accepting_new_bookings"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", coachUserId));
  return rows[0] ?? null;
}

/**
 * §2.3 — "Where bookings came from": how many bookings THIS coach took from each tag on their own
 * link. `app_user.source` is the free-text lead tag `POST /api/public/book`'s `srcTag` writes at
 * lead-creation time (0312's F-13 correction) — never a second column invented for the same fact.
 * Scoped to `b.host_id = coachUserId` because a tag on this coach's own link is only meaningful
 * against bookings this coach actually took, not every booking in the practice.
 */
async function taggedLinksFor(tx, tenantId, coachUserId) {
  const { rows } = await tx.query(
    `SELECT au.source AS tag, COUNT(DISTINCT b.id)::int AS bookings_count
       FROM keystone.booking b
       JOIN keystone.booking_participant bp
         ON bp.tenant_id = b.tenant_id AND bp.booking_id = b.id AND bp.party = 'client'
       JOIN keystone.app_user au
         ON au.tenant_id = b.tenant_id AND au.id = bp.app_user_id
      WHERE b.tenant_id = $1 AND b.host_id = $2
        AND au.source IS NOT NULL AND au.source <> ''
      GROUP BY au.source
      ORDER BY bookings_count DESC, au.source ASC`,
    [tenantId, coachUserId]);
  return rows.map((r) => ({ tag: r.tag, bookingsCount: r.bookings_count }));
}

/** §2.3 — `GET /api/engagements/my-link`. Returns `{slug, acceptingNewBookings, taggedLinks}`; the
 *  route file adds `url` (domain construction is a route-layer concern, same split calendar.mjs
 *  keeps between itself and `calendarConnect.mjs`). */
export async function readMyLink(tx, { tenantId, coachUserId }) {
  const row = await currentRow(tx, tenantId, coachUserId);
  if (!row) throw notFound(`not this coach's link`);
  return {
    slug: row.booking_slug,
    acceptingNewBookings: row.accepting_new_bookings,
    taggedLinks: await taggedLinksFor(tx, tenantId, coachUserId),
  };
}

/**
 * §2.3 — `POST /api/engagements/my-link` `{slug?, acceptingNewBookings?}`.
 * ★★★ "OLD LINKS KEEP WORKING IF YOU CHANGE IT" (the frame's own copy). When the slug actually
 *     changes and a slug already existed, this calls `keystone.record_booking_slug_redirect`
 *     (0313) so the OLD slug keeps resolving to this SAME coach — never deleted, per that
 *     migration's own "old links redirect forever" rule (MOCKUPS §10, spec 03b §3).
 */
export async function updateMyLink(tx, { tenantId, coachUserId, slug, acceptingNewBookings }) {
  const before = await currentRow(tx, tenantId, coachUserId);
  if (!before) throw notFound(`not this coach's link`);

  let nextSlug = before.booking_slug;
  if (slug !== undefined) {
    const trimmed = typeof slug === "string" ? slug.trim().toLowerCase() : "";
    if (!trimmed) throw invalid("a booking link needs a value");
    if (!SLUG_SHAPE.test(trimmed)) {
      throw invalid("a booking link can only use lowercase letters, numbers and single hyphens");
    }
    nextSlug = trimmed;
  }

  if (nextSlug !== before.booking_slug) {
    try {
      await run(tx, db
        .updateTable("keystone.app_user")
        .set({ booking_slug: nextSlug })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", coachUserId));
    } catch (e) {
      if (e.code === UNIQUE_VIOLATION) throw conflict("that link is already taken");
      if (e.code === CHECK_VIOLATION) {
        throw invalid("a booking link can only use lowercase letters, numbers and single hyphens");
      }
      throw e;
    }
    if (before.booking_slug) {
      await tx.query(
        `SELECT keystone.record_booking_slug_redirect($1, $2, 'coach', $3)`,
        [tenantId, before.booking_slug, coachUserId]);
    }
  }

  if (acceptingNewBookings !== undefined) {
    await run(tx, db
      .updateTable("keystone.app_user")
      .set({ accepting_new_bookings: !!acceptingNewBookings })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", coachUserId));
  }

  const after = await currentRow(tx, tenantId, coachUserId);
  return { slug: after.booking_slug, acceptingNewBookings: after.accepting_new_bookings };
}
