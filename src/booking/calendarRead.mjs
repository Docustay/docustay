// @ts-check
// STAGE 13 TASK 13.23 — THE CALENDAR RANGE READ. One read feeds every calendar view (week / day /
// month / team) with the drawn facts. specs/features/plans/STAGE-13-PLAN.md §13.23.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EVERY SOURCE OF BUSY TIME THIS FUNCTION DRAWS FROM, NAMED ONCE, SO THE NEXT READER DOES NOT
//     HAVE TO GREP FOR WHAT WAS LEFT OUT:
//       1. `keystone.booking` — the sessions themselves (any state <> 'cancelled', plus a cancelled
//          one within the caller's own `calendar_show_cancelled_days` window).
//       2. `keystone.booking_block`, expanded via `expandBlock` (13.17, `src/booking/blocks.mjs`) —
//          drawn into `blocks[]`. ★★★ ADVISORY ON THE WRITE PATH ONLY (0402 has no FK, no exclusion
//          constraint, no trigger against `keystone.booking` — MEASURED, two sibling tasks
//          independently). A direct POST can still book over a drawn block. This function draws
//          the block as exactly that — a block row, never a claim that nothing can be written
//          under it — and does not invent a stronger guarantee than the schema gives.
//       3. `keystone.time_off` (Stage 12, 0382) — folded into each host's `status.kind = 'away'`.
//       4. `keystone.staff_shift` (Stage 12, 0382) — NOT read directly here; it reaches this
//          function through `readSlotsCached`/`readSlots`'s own composition (13.18/13.19), which is
//          the ONE place shift-vs-rule intersection is decided. A second, independent read of
//          `staff_shift` here would be a second place for that decision to drift from the booking
//          engine's own answer — so host `gaps`/`full`/`free` are asked FROM that engine, not
//          recomputed.
//     ★★ NOT READ, ON PURPOSE, NAMED HERE RATHER THAN LEFT SILENT: outside-calendar (Google/
//        Microsoft) busy time. `readSlots` itself does not subtract it yet (13.18's own composition
//        comment, OQ-13.5) — this function draws exactly what the availability engine currently
//        knows, no more. `sync{}` tells the viewer THEIR OWN sync's health so a missing outside
//        event has a visible reason, which is the honest substitute for silently drawing a
//        guarantee this function cannot back.
//
// ★★★ WHO CALLS THIS: `GET /api/engagements/calendar-range` (`src/routes/engagementsCalendar.mjs`,
//     this same task). Nothing in THIS build calls that route yet — task 13.30 (month/team views)
//     and 13.31 (week view) are its named, later consumers, per this task's own field 3 CALLERS —
//     not a guess.
//
// ★ TIME IS THE SUBJECT. Every occurrence boundary here is a real UTC instant computed from a
//   LOCAL calendar date via `zonedLocalToUtc`/`wallClockIn` (`slots.mjs`) — never a bare stored
//   UTC read back as if it were the practice's wall clock. `expandBlock` (13.17) already proved
//   this arithmetic survives a DST transition (2026-03-08 America/Los_Angeles, Fri→Mon measured as
//   2d23h, not 3d); this file reuses that same pair of primitives for its own day-boundary math
//   rather than restating a second, possibly-different version of it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid, notFound } from "../http/errors.mjs";
import { zonedLocalToUtc, wallClockIn } from "./slots.mjs";
import { expandBlock } from "./blocks.mjs";
import { BUSY_STATES } from "./read.mjs";
import { readSlotsCached } from "./availabilityCache.mjs";
import { db as kdb, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { addDays, formatISO } from "date-fns";
import { TZDate } from "@date-fns/tz";

/** ★★ A caller-supplied window past this is almost certainly a mistake — the plan's own bound. */
const MAX_RANGE_DAYS = 42;

/** ★ `calendarHealth`'s own threshold (`calendarSync.mjs:241`), restated for ONE connection rather
 *  than imported as an aggregate — `calendarHealth`/`platformCalendarHealth` answer for EVERY
 *  connection in scope, and this needs exactly one: the CALLER's own (see the file header on why
 *  `sync` is always the caller's, even in a team view). */
const SYNC_SWEEP_MAX_AGE_MS = 6 * 3600_000;

const pad2 = (n) => String(n).padStart(2, "0");

function parseISODateStrict(v, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""))) {
    throw invalid(`calendar-range needs a YYYY-MM-DD '${label}', got ${JSON.stringify(v)}`);
  }
  const [y, m, d] = String(v).split("-").map(Number);
  return { y, m, d, iso: v };
}

function dayNum(y, m, d) {
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}
function dayNumToISO(n) {
  return formatISO(addDays(new TZDate(0, "UTC"), n), { representation: "date" });
}

/** ★ Normalises either a `date`-typed pg value (a UTC-midnight `Date`) or a string to
 *  'YYYY-MM-DD' — reading UTC parts, deliberately, same fix as `blocks.mjs`'s own `toISODate`
 *  (not exported there, so restated here rather than reaching into that module's internals). */
function toISODate(v) {
  if (v == null) return null;
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * The one read every calendar view composes from.
 *
 * @param db           a tenant-scoped connection (RLS supplies the tenant; tenantId also passed
 *                      explicitly and filtered on in every query, belt-and-suspenders, matching
 *                      `blocks.mjs`'s own pattern)
 * @param tenantId     required
 * @param actorUserId  the CALLER's own `app_user.id` — whose display prefs and whose calendar_
 *                     connection this response is drawn from, regardless of whose calendar(s) are
 *                     being viewed
 * @param hostIdParam  a host's `app_user.id`, or the literal string `'all'` (team read, F05 §4)
 * @param fromDate     'YYYY-MM-DD' inclusive
 * @param toDate       'YYYY-MM-DD' inclusive
 * @param canSeePrice  true for owner/admin (decided by the route, from the caller's own rank) —
 *                      when false, `priceMinor` is ABSENT from every booking row, never null
 * @param now          injected so callers and tests can be deterministic
 */
export async function readCalendarRange(db, {
  tenantId, actorUserId, hostIdParam, fromDate, toDate, canSeePrice, now = new Date(),
}) {
  if (!tenantId) throw invalid("calendar-range needs a tenantId");
  if (!actorUserId) throw invalid("calendar-range needs the caller's own appUserId");

  const from = parseISODateStrict(fromDate, "from");
  const to = parseISODateStrict(toDate, "to");
  const fromDay = dayNum(from.y, from.m, from.d);
  const toDay = dayNum(to.y, to.m, to.d);
  if (toDay < fromDay) throw invalid("calendar-range's 'to' must not be before 'from'");
  if (toDay - fromDay + 1 > MAX_RANGE_DAYS) {
    throw invalid(`calendar-range spans ${toDay - fromDay + 1} days — the limit is ${MAX_RANGE_DAYS}`);
  }

  const { rows: tzRows } = await run(db, kdb
    .selectFrom("keystone.tenant")
    .select(["timezone"])
    .where("id", "=", tenantId));
  const timeZone = tzRows[0]?.timezone ?? "UTC";

  // ═══ THE CALLER'S OWN SIX DISPLAY PREFERENCES (R-13.10/13.46) — never tenant_setting. ═══════════
  const { rows: prefRows } = await run(db, kdb
    .selectFrom("keystone.app_user")
    .select(["calendar_week_starts", "calendar_day_from_minute", "calendar_day_to_minute",
             "calendar_slot_minutes", "calendar_show_cancelled_days", "calendar_colour_by"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", actorUserId));
  if (!prefRows.length) throw notFound("your own person row was not found");
  const pref = prefRows[0];
  const settings = {
    weekStarts: pref.calendar_week_starts,
    dayFromMinute: pref.calendar_day_from_minute,
    dayToMinute: pref.calendar_day_to_minute,
    slotMinutes: pref.calendar_slot_minutes,
    showCancelledDays: pref.calendar_show_cancelled_days,
    colourBy: pref.calendar_colour_by,
  };

  // ═══ WHICH HOST(S) — 'all' is TEAM READ (F05 §4 "own calendar + team read"). The route's own
  //     floor is `atLeastRank(user,'coach')`; nothing here narrows a coach to their own hostId —
  //     the spec`s own words grant a coach team read too, not only owner/admin. ═══════════════════`
  let hostRows;
  if (hostIdParam === "all") {
    ({ rows: hostRows } = await run(db, kdb
      .selectFrom("keystone.app_user")
      .select(["id", "display_name"])
      .where("tenant_id", "=", tenantId)
      .where("role", "=", "staff")
      .orderBy("display_name", "asc")));
  } else {
    ({ rows: hostRows } = await run(db, kdb
      .selectFrom("keystone.app_user")
      .select(["id", "display_name"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", hostIdParam)
      .where("role", "=", "staff")));
    if (!hostRows.length) throw notFound("that host does not exist, or is not on staff");
  }
  const hostIds = hostRows.map((h) => h.id);

  // ═══ SYNC — the CALLER'S OWN calendar_connection (never the viewed host's, even in team view —
  //     the plan's own words: "sync from the caller's calendar_connection"). ══════════════════════
  const { rows: connRows } = await run(db, kdb
    .selectFrom("keystone.calendar_connection")
    .select(["status", "last_swept_at", "updated_at"])
    .where("tenant_id", "=", tenantId)
    .where("host_id", "=", actorUserId)
    .orderBy("updated_at", "desc")
    .limit(1));
  let sync = { status: "none", brokenSince: null, lastSyncedAt: null };
  if (connRows.length) {
    const conn = connRows[0];
    const sweptAgeMs = conn.last_swept_at ? now.getTime() - conn.last_swept_at.getTime() : Infinity;
    const broken = conn.status !== "active" || sweptAgeMs > SYNC_SWEEP_MAX_AGE_MS;
    sync = {
      status: broken ? "broken" : "ok",
      // ★ DOCUMENTED CHOICE — 0013 carries no "went bad at" column. For a connection that has left
      //   'active' (renewal_failed/revoked/needs_full_resync), "since" is the moment it changed
      //   (updated_at, touched by every UPDATE — 0013's own `calendar_connection_touch` trigger).
      //   For one still 'active' but whose safety-net sweep has gone stale, "since" is the last
      //   moment we KNOW it was fine (last_swept_at).
      brokenSince: broken ? (conn.status !== "active" ? conn.updated_at : conn.last_swept_at) : null,
      lastSyncedAt: conn.last_swept_at,
    };
  }

  // ═══ BOOKINGS in [fromDate, toDate] for the host(s) in scope. ═══════════════════════════════════
  const fromBound = zonedLocalToUtc(from.y, from.m, from.d, 0, timeZone);
  // ★ `to.d + 1` deliberately not pre-normalised — `Date.UTC` inside `zonedLocalToUtc` rolls a
  //   day-31-plus-one into the next month correctly; a second hand-rolled "add a day" helper would
  //   be one more place for that arithmetic to disagree with itself.
  const toBound = zonedLocalToUtc(to.y, to.m, to.d + 1, 0, timeZone);

  const bookingRows = hostIds.length ? (await db.query(
    `SELECT b.id, b.host_id AS "hostId", b.starts_at AS "startsAt", b.ends_at AS "endsAt",
            b.state, s.name AS "serviceName", s.program_id AS "programId",
            (SELECT string_agg(bp.display_name, ', ' ORDER BY bp.display_name)
               FROM keystone.booking_participant bp
              WHERE bp.tenant_id = b.tenant_id AND bp.booking_id = b.id
                AND bp.party IN ('client','pir')) AS who,
            coalesce(b.capacity, 1) AS capacity,
            (SELECT count(*)::int FROM keystone.booking_participant bp2
              WHERE bp2.tenant_id = b.tenant_id AND bp2.booking_id = b.id
                AND bp2.party IN ('client','pir')) AS taken,
            b.location_kind AS "locationKind", b.location_detail AS "locationDetail",
            b.flag, b.flag_note AS "flagNote",
            -- ★★★ FIXED 25 Sep 2026 — THIS READ THE HOST'S OWN care_note, NOT THE CLIENT'S.
            --     It was h.care_note, and h is keystone.app_user joined on b.host_id — the
            --     COACH. care_note is 0399's "Be careful with this one" note, written BY a
            --     coach ABOUT a client: §13.16 sets care_note for the booking's client
            --     participant (400 if none), and §13.23's own field list calls this staff-only.
            --     So the old expression returned the coach's own note about themselves — in
            --     practice always NULL, which is exactly why it would have looked fine: the
            --     column rendered empty, and nobody calls an empty safety note a bug.
            --   ★★ A COACH WOULD SIMPLY NEVER HAVE BEEN WARNED. Found by 13.16 while reading
            --      the other end of the same field.
            --   ★ Team-visible only. 0399's own COMMENT: "Never selected by any /api/app/* or
            --     /api/public/* reader." This route is staff-side, which is why it may have it.
            --   ★★ ONE CLIENT ASSUMED, which is what §13.16's write path encodes (it refuses
            --      when there is no single client participant). For a CLASS with several
            --      flagged clients this shows one note, deterministically ordered so it is at
            --      least stable rather than arbitrary — recorded as an open question rather
            --      than silently picking and calling it settled.
            --   ★ bp4, not bp3: a different bp3 already lives in the consentOnFile EXISTS below.
            --     Separate subquery scopes, so it would be legal — but two bp3s in one SELECT is
            --     a trap for the next reader. The tenant predicate on the app_user join matches
            --     that subquery's own idiom rather than leaning on RLS alone.
            --   ★★ NO BACKTICKS IN THIS COMMENT: the SQL lives in a JS template literal and a
            --      backtick ends the string. My first draft used them and broke the parse — the
            --      second time tonight, the other being src/records/queries.mjs, whose own header
            --      carries the identical warning. Caught by node --check both times.
            (SELECT cu.care_note
               FROM keystone.booking_participant bp4
               JOIN keystone.app_user cu
                 ON cu.tenant_id = bp4.tenant_id AND cu.id = bp4.app_user_id
              WHERE bp4.tenant_id = b.tenant_id AND bp4.booking_id = b.id
                AND bp4.party IN ('client','pir')
                AND cu.care_note IS NOT NULL
              ORDER BY cu.display_name, cu.id
              LIMIT 1) AS "careNote",
            b.source, b.created_at AS "createdAt",
            p.amount_minor AS "priceAmountMinor",
            CASE WHEN b.price_id IS NOT NULL THEN (p.amount_minor = 0)
                 ELSE coalesce(
                   (SELECT bpol.payment_mode = 'free' FROM keystone.booking_policy bpol
                     WHERE bpol.tenant_id = b.tenant_id AND bpol.service_id = b.service_id),
                   true)
            END AS "isFree",
            EXISTS (
              SELECT 1 FROM keystone.booking_participant bp3
              JOIN keystone.app_user au
                ON au.tenant_id = bp3.tenant_id AND au.id = bp3.app_user_id
              WHERE bp3.tenant_id = b.tenant_id AND bp3.booking_id = b.id AND bp3.party = 'client'
                AND au.role = 'adolescent_client' AND au.consent_status = 'granted'
            ) AS "consentOnFile"
       FROM keystone.booking b
       JOIN keystone.app_user h ON h.tenant_id = b.tenant_id AND h.id = b.host_id
       LEFT JOIN keystone.service s ON s.id = b.service_id
       LEFT JOIN keystone.price p ON p.id = b.price_id
      WHERE b.tenant_id = $1 AND b.host_id = ANY($2)
        AND b.starts_at < $3 AND b.ends_at > $4
        AND (b.state <> 'cancelled'
             OR ($5::int > 0 AND b.cancelled_at IS NOT NULL
                 AND now() - b.cancelled_at <= ($5::text || ' days')::interval))
      ORDER BY b.starts_at, b.id`,
    [tenantId, hostIds, toBound, fromBound, settings.showCancelledDays])).rows : [];

  const bookings = bookingRows.map((r) => {
    const capacity = r.capacity, taken = r.taken;
    const out = {
      id: r.id, hostId: r.hostId, startsAt: r.startsAt, endsAt: r.endsAt, state: r.state,
      serviceName: r.serviceName, programId: r.programId, who: r.who, capacity, taken,
      placesLeft: Math.max(capacity - taken, 0),
      locationKind: r.locationKind, locationDetail: r.locationDetail,
      flag: r.flag, flagNote: r.flagNote, careNote: r.careNote,
      source: r.source, createdAt: r.createdAt, isFree: r.isFree,
      consentOnFile: r.consentOnFile,
    };
    // ★★★ F05 §4 "no money in any payload" (below admin) — the KEY IS ABSENT, never `null`. A
    //     `null` still tells a coach "there is a price, I just can't see it"; absence tells nothing.
    if (canSeePrice) out.priceMinor = r.priceAmountMinor ?? null;
    return out;
  });

  // ═══ BLOCKS — expandBlock (13.17). Drawn as exactly what the row is: advisory, not a barrier
  //     (see the file header). ══════════════════════════════════════════════════════════════════
  const blockRows = hostIds.length ? (await run(db, kdb
    .selectFrom("keystone.booking_block")
    .select(["id", sql`host_id AS "hostId"`, "label", "starts_at", "ends_at", "repeat", "repeat_until", "skipped_dates"])
    .where("tenant_id", "=", tenantId)
    .where(sql`host_id = ANY(${sql.val(hostIds)})`))).rows : [];
  const blocks = [];
  for (const row of blockRows) {
    for (const occ of expandBlock(row, from.iso, to.iso, timeZone)) {
      blocks.push({ id: row.id, hostId: row.hostId, label: row.label,
        startsAt: occ.startsAt, endsAt: occ.endsAt });
    }
  }

  // ═══ DAYS — one entry per calendar day in range, bucketed from the bookings already read. ══════
  const days = [];
  for (let d = fromDay; d <= toDay; d++) {
    const iso = dayNumToISO(d);
    let bookedCount = 0, newWhileSyncDown = 0;
    for (const b of bookings) {
      const w = wallClockIn(b.startsAt, timeZone);
      const bIso = `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
      if (bIso !== iso) continue;
      if (b.state !== "cancelled") bookedCount++;
      // ★ Only meaningful WHILE sync is down — a booking created moments ago through a healthy
      //   connection is not "new while sync down"; the name says what it counts.
      if (sync.status === "broken" && b.source !== "staff" &&
          b.createdAt && sync.brokenSince && b.createdAt >= sync.brokenSince) {
        newWhileSyncDown++;
      }
    }
    days.push({ date: iso, bookedCount, newWhileSyncDown });
  }

  // ═══ HOST STATUS — a snapshot for 'today' in the practice's own zone, per host (the response
  //     shape carries ONE status per host, not one per requested day — a multi-week team grid does
  //     not have a single "full/gaps/away/free" answer over 42 days; 'today' is what CalendarTeam's
  //     sidebar actually needs, and 13.30 is its consumer). Sources: keystone.time_off (away) and
  //     readSlotsCached (13.19)/readSlots's own composition (gaps, full, free) — never a second,
  //     independent shift/rule read here (see file header, source 4). ═══════════════════════════
  const todayWall = wallClockIn(now, timeZone);
  const todayISO = `${todayWall.year}-${pad2(todayWall.month)}-${pad2(todayWall.day)}`;
  const hosts = [];
  for (const h of hostRows) {
    const { rows: toRows } = await db.query(
      `SELECT ends_on FROM keystone.time_off
        WHERE tenant_id = $1 AND app_user_id = $2 AND starts_on <= $3::date AND ends_on >= $3::date
        ORDER BY ends_on DESC LIMIT 1`,
      [tenantId, h.id, todayISO]);
    if (toRows.length) {
      hosts.push({ id: h.id, displayName: h.display_name,
        status: { kind: "away", sessions: 0, gaps: 0, awayUntil: toISODate(toRows[0].ends_on) } });
      continue;
    }
    const { slots } = await readSlotsCached(db, { hostId: h.id, date: todayISO, serviceId: null, now });
    const gaps = slots.length;
    const { rows: sessRows } = await db.query(
      `SELECT count(*)::int AS n FROM keystone.booking
        WHERE tenant_id = $1 AND host_id = $2 AND state = ANY($3)
          AND starts_at < $4 AND ends_at > $5`,
      [tenantId, h.id, BUSY_STATES,
       zonedLocalToUtc(todayWall.year, todayWall.month, todayWall.day + 1, 0, timeZone),
       zonedLocalToUtc(todayWall.year, todayWall.month, todayWall.day, 0, timeZone)]);
    const sessions = sessRows[0].n;
    // ★ Two of the four kinds are the plan's own rule verbatim (full, away). 'free' vs 'gaps'
    //   completes the enum: zero sessions at all reads as wide open ('free'); at least one session
    //   with room left over reads as partially booked ('gaps') — documented choice, the plan states
    //   only the other two.
    const kind = sessions === 0 ? "free" : (gaps === 0 ? "full" : "gaps");
    hosts.push({ id: h.id, displayName: h.display_name, status: { kind, sessions, gaps, awayUntil: null } });
  }

  // ★ QUEUE §4 — the practice's programs ride with the range so the calendar can filter and colour by them without a second request.
  const programs = (await db.query(
    `SELECT id, name, colour FROM keystone.program WHERE tenant_id = $1 ORDER BY position, name`, [tenantId])).rows;
  return { timezone: timeZone, settings, hosts, days, bookings, blocks, sync, programs };
}
