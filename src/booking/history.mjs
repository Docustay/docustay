// @ts-check
// src/booking/history.mjs — Stage 13 task 13.25. `GET /api/engagements/booking-history`'s read.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ADMIN-ONLY, ON PURPOSE (enforced by the caller, `src/routes/engagementsBooking.mjs`). A
//     booking history names WHO was seen and WHEN — the sensitive one. This module never scopes
//     by viewer itself; the route refuses a coach or client before this function is ever called,
//     so there is no "owned only" branch to get wrong here.
//
// ★ Reads `keystone.event` for the four booking topics (subject_id = the booking id, MEASURED
//   column) rather than trusting any per-topic payload shape to carry everything — `booking`,
//   `service` and `app_user` are joined by subject_id/host_id/service_id so every row's `session`
//   and staff lookups come from the SAME join, regardless of which topic produced it.
// ★ `keystone.booking_waitlist_entry.created_at` (0314) supplies the fifth row kind, "Waitlisted" —
//   there is no event topic for a waitlist entry being created (CT-F31), so this is read directly.
// ★★ TIME: every `session` label is rendered in the TENANT'S OWN zone (§B4 STEP 3) — never a bare
//    stored UTC instant handed back as-is.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { formatDayMonth, formatMinor } from "../money/format.mjs";
import { chargesForBookings } from "../money/reads.mjs";
import { localTimeString } from "./slots.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const HISTORY_TOPICS = Object.freeze([
  "booking.booking.created",
  "booking.booking.cancelled",
  "booking.booking.rescheduled",
  "booking.booking.completed",
]);

const WHAT_BY_TOPIC = Object.freeze({
  "booking.booking.created": "Booked",
  "booking.booking.cancelled": "Cancelled",
  "booking.booking.rescheduled": "Moved",
  "booking.booking.completed": "No-show", // pre-filtered to outcome='no_show' only, see the query
});

// ★ `event.actor` (0134/0200) is a closed vocabulary: system|n8n|worker|user:<uuid>|webhook:<name>
//   |api_key:<id>. Only the `user:<uuid>` shape needs a lookup.
const USER_ACTOR = /^user:([0-9a-f-]{36})$/;

/**
 * §2.2's four-value enum: "Booking page" · "Client portal" · <staff name> · "System".
 * ★ `payload.source` is checked FIRST (plan field 4: "whereFrom from payload source then actor"),
 *   then `actor` — and the actor branch is what actually produces "Client portal": a client acting
 *   on their own booking from the portal carries `actor: user:<their own id>`, and that user's OWN
 *   `role` is never `staff` — so a `user:<id>` actor whose role is NOT staff reads as the client
 *   portal, and one whose role IS staff reads as that person's name. `worker`/`system` (a job, e.g.
 *   the hold-expiry sweep) and every other actor shape (n8n, webhook, api_key) read as "System".
 */
function whereFromFor(payloadSource, actor, staffByUserId) {
  if (typeof payloadSource === "string") {
    const v = payloadSource.toLowerCase();
    if (v.includes("public")) return "Booking page";
    if (v.includes("portal")) return "Client portal";
  }
  if (actor === "worker" || actor === "system") return "System";
  const m = USER_ACTOR.exec(actor ?? "");
  if (m) {
    const person = staffByUserId.get(m[1]);
    if (person && person.role === "staff") return person.display_name || "Staff";
    return "Client portal";
  }
  return "System";
}

function sessionLabel(serviceName, startsAt, timeZone) {
  const name = serviceName ?? "Session";
  if (!startsAt) return name;
  return `${name} — ${formatDayMonth(startsAt)} ${localTimeString(startsAt, timeZone)}`;
}

async function tenantTimeZone(tx, tenantId) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select(["timezone"])
    .where("id", "=", tenantId));
  return rows[0]?.timezone ?? "UTC";
}

export async function readBookingHistory(tx, { tenantId, from = null, to = null,
                                                 what = null, who = null, staff = null }) {
  const timeZone = await tenantTimeZone(tx, tenantId);

  const eventParams = [tenantId, HISTORY_TOPICS];
  let eventWhere =
    `e.tenant_id = $1 AND e.topic = ANY($2::text[]) ` +
    `AND (e.topic <> 'booking.booking.completed' OR e.payload->>'outcome' = 'no_show')`;
  if (from) { eventParams.push(from); eventWhere += ` AND e.created_at >= $${eventParams.length}`; }
  if (to)   { eventParams.push(to);   eventWhere += ` AND e.created_at <= $${eventParams.length}`; }
  if (staff) { eventParams.push(staff); eventWhere += ` AND b.host_id = $${eventParams.length}`; }

  const { rows: eventRows } = await tx.query(
    `SELECT e.topic, e.created_at, e.actor, e.payload,
            b.id AS booking_id, b.host_id, b.starts_at,
            s.name AS service_name,
            (SELECT string_agg(DISTINCT p.display_name, ', ' ORDER BY p.display_name)
               FROM keystone.booking_participant p
              WHERE p.tenant_id = b.tenant_id AND p.booking_id = b.id AND p.party = 'client') AS who
       FROM keystone.event e
       JOIN keystone.booking b ON b.tenant_id = e.tenant_id AND b.id = e.subject_id
       LEFT JOIN keystone.service s ON s.tenant_id = b.tenant_id AND s.id = b.service_id
      WHERE ${eventWhere}
      ORDER BY e.created_at DESC`,
    eventParams);

  // ★ B-4 (F794) — the charge read moves to money (ruling, 27 Sep): src/booking/ holds no invoice
  //   or line_item reference of its own. One extra query per history page, cost accepted.
  const charged = await chargesForBookings(tx, {
    tenantId,
    bookingIds: eventRows
      .filter((r) => WHAT_BY_TOPIC[r.topic] === "No-show")
      .map((r) => r.booking_id),
  });

  const waitlistParams = [tenantId];
  let waitlistWhere = `w.tenant_id = $1`;
  if (from) { waitlistParams.push(from); waitlistWhere += ` AND w.created_at >= $${waitlistParams.length}`; }
  if (to)   { waitlistParams.push(to);   waitlistWhere += ` AND w.created_at <= $${waitlistParams.length}`; }
  if (staff) { waitlistParams.push(staff); waitlistWhere += ` AND w.host_id = $${waitlistParams.length}`; }

  const { rows: waitlistRows } = await tx.query(
    `SELECT w.created_at, w.display_name AS who, w.host_id,
            s.name AS service_name
       FROM keystone.booking_waitlist_entry w
       LEFT JOIN keystone.service s ON s.tenant_id = w.tenant_id AND s.id = w.service_id
      WHERE ${waitlistWhere}
      ORDER BY w.created_at DESC`,
    waitlistParams);

  // ★ Batch the staff lookup — one query for every `user:<id>` actor across the whole page, never
  //   one query per row.
  const staffIds = new Set();
  for (const r of eventRows) {
    const m = USER_ACTOR.exec(r.actor ?? "");
    if (m) staffIds.add(m[1]);
  }
  let staffByUserId = new Map();
  if (staffIds.size > 0) {
    const { rows } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(["id", "display_name", "role"])
      .where("tenant_id", "=", tenantId)
      .where(sql`id = ANY(${sql.val([...staffIds])})`));
    staffByUserId = new Map(rows.map((u) => [u.id, u]));
  }

  let rows = eventRows.map((r) => {
    const rowWhat = WHAT_BY_TOPIC[r.topic];
    let note = null;
    if (r.topic === "booking.booking.cancelled" && r.payload?.inside_notice_window === true) {
      note = "Inside the free window";
    } else if (rowWhat === "No-show" && charged.get(r.booking_id) != null) {
      // ★ MONEY — never a figure this module computes. The amount comes from `chargesForBookings`
      //   (`src/money/reads.mjs`) — money's OWN read of the invoice line raised against this
      //   booking (`line_item.booking_id`, a reference, joined to `invoice.amount_minor`) — never
      //   `booking.invoice_id` (retired, F794/B-4) and never `charge.percent × price` worked out
      //   here. Until Stage 15 (15.27/15.30) raises that invoice, no line references this booking
      //   and no "Charged" note is shown — the honest state, never a guessed amount.
      note = `Charged ${formatMinor(charged.get(r.booking_id))}`;
    }
    return {
      at: r.created_at,
      what: rowWhat,
      who: r.who ?? null,
      session: sessionLabel(r.service_name, r.starts_at, timeZone),
      whereFrom: whereFromFor(r.payload?.source, r.actor, staffByUserId),
      note,
    };
  });

  const waitlistMapped = waitlistRows.map((r) => ({
    at: r.created_at,
    what: "Waitlisted",
    who: r.who ?? null,
    session: sessionLabel(r.service_name, null, timeZone),
    // ★ A waitlist entry is an automatic queue placement, not a person's own action on an existing
    //   booking — "System" is the honest default; no per-entry actor column exists to say otherwise
    //   (0314 — MEASURED).
    whereFrom: "System",
    note: null,
  }));

  rows = rows.concat(waitlistMapped);

  if (what) rows = rows.filter((r) => r.what === what);
  if (who) {
    const needle = who.toLowerCase();
    rows = rows.filter((r) => (r.who ?? "").toLowerCase().includes(needle));
  }

  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return { rows };
}
