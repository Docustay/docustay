// @ts-check
// src/booking/teamBooking.mjs — TEAM BOOKING: A SERVICE DELIVERED BY SEVERAL PEOPLE, BOOKED BY A STRANGER (6 Oct 2026).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Specs: specs/BOOKING-TEAM-AUDIT-6OCT.md, specs/BOOKING-TEAM-PLAN-6OCT.md (decisions 1 and 2). Read the plan's §1 first.
//
// ★★★ THE MODEL: ASSIGN AT BOOKING TIME. A booking always has exactly one owning host, so the database's own guard
//     (EXCLUDE (tenant_id, host_id, occupies)) and the per-host advisory lock that every other booking writer already takes keep
//     meaning what they have always meant. "Anyone available" is resolved here, inside the booking transaction, to ONE person.
//
// ★★★ THE PROPERTY THAT MUST HOLD UNDER CONCURRENCY: two visitors can never take the same host at the same time, and the loser
//     gets a clean "taken" answer, never a 500 and never a double booking. How:
//       1. every candidate host's advisory lock is taken, IN ASCENDING HOST-ID ORDER (a fixed order makes a deadlock between two
//          team bookings impossible), under the SAME key `booking:<tenant>:<host>` that createBooking, the public door, reschedule
//          and the staff writes use — so a direct booking of one of these people serialises with this too;
//       2. only after the locks are held are the candidates evaluated and ordered by the rule, so what the rule sees (last
//          assigned, booked counts) cannot change underneath it;
//       3. the insert for each survivor runs under a SAVEPOINT; a clash (our own check, or SQLSTATE 23P01 from the exclusion
//          constraint, the guard that has the last word) rolls back to the savepoint and tries the next survivor;
//       4. none left → `SlotTakenError` → HTTP 409.
//
// ★★ "OFFERED" AND "BOOKABLE" ARE ONE QUESTION. The older public door never checked a requested time against the host's hours
//    (it checked clash, blocks, notice, window — a direct POST could book 3 a.m.). Here the requested instant must be one of the
//    slots `readSlots` returns for that host and day, which composes rules, overrides, bookings, blocks, time off, shifts, the
//    service's duration and start interval, the daily cap and the notice. The window is checked here (readSlots does not).
//
// ★★ OUTSIDE CALENDARS. Google busy time is subtracted AFTER the availability cache (the cache is invalidated by database
//    triggers only; an outside calendar changes without the database noticing, so outside time is never baked into a cached row).
//    At create, the check is fresh and runs BEFORE the locks are taken (an HTTP call must not be made while holding host locks).
//    If Google cannot be asked, the booking stands and is flagged for the host (plan §3 ruling) — it is never silently treated
//    as "free", and never allowed to block a free call from being booked by an outage.
//
// ★ TENANT: every function takes `tenantId` as a parameter — always the one the Host header resolved, never anything from a body —
//   and every statement is scoped by it as well as by row-level security.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { readSlots } from "./read.mjs";
import { readSlotsCached } from "./availabilityCache.mjs";
import { createBooking, SlotTakenError } from "./createBooking.mjs";
import { addBookingParticipant, policyFor } from "./writes.mjs";
import { getSetting } from "../settings/writes.mjs";
import { invalid, notFound, forbidden } from "../http/errors.mjs";
import { findOrCreateWebsiteLead } from "./websiteLead.mjs";
import { busyForHost, overlapsBusy } from "./googleCalendar.mjs";
import { addDaysISO } from "./blocks.mjs";
import { wallClockIn, zonedLocalToUtc } from "./slots.mjs";
import { PUBLIC_BOOKING_REFUSED } from "./publicBooking.mjs";

export const RULES = Object.freeze(["round_robin", "priority", "least_booked"]);
const MAX_RANGE_DAYS = 62;
const EXCLUSION_VIOLATION = "23P01";
const MODALITIES = ["phone", "video"];
const pad = (n) => String(n).padStart(2, "0");
const isoDate = (w) => `${w.year}-${pad(w.month)}-${pad(w.day)}`;

// ── the service ─────────────────────────────────────────────────────────────────────────────────
/**
 * The practice's public service named by its stable `booking_key` (or id). Same three flags the single-host public door checks.
 * @returns {Promise<null | { id:string, name:string, durationMinutes:number, deliveryModes:string[], programId:string|null, bookingKey:string|null, description:string|null }>}
 */
export async function loadTeamService(tx, { tenantId, serviceKey = null, serviceId = null }) {
  if (!serviceKey && !serviceId) return null;
  const { rows } = await tx.query(
    `SELECT id, name, duration_minutes, delivery_modes, program_id, booking_key, description
       FROM keystone.service
      WHERE tenant_id = $1 AND public_bookable = true AND bookable = true AND active = true AND archived_at IS NULL
        AND (($2::text IS NOT NULL AND booking_key = $2::text) OR ($3::uuid IS NOT NULL AND id = $3::uuid))
      LIMIT 1`,
    [tenantId, serviceKey, serviceId]);
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, name: r.name, durationMinutes: r.duration_minutes, deliveryModes: r.delivery_modes ?? [], programId: r.program_id ?? null, bookingKey: r.booking_key ?? null, description: r.description ?? null };
}

/** A person's first name for a visitor-facing sentence: the stored first name, else the first word of their display name (plan ruling: never blank, never the email). */
export const firstNameOf = (first, display) => (first && String(first).trim()) || String(display ?? "").trim().split(/\s+/)[0] || null;

// ── the pool ────────────────────────────────────────────────────────────────────────────────────
/**
 * The people who can take this service: its `service_host` rows (staff, accepting new bookings, not archived); when it has none,
 * "anyone on the team" (F06 §2.2) = every accepting staff member with a current availability rule.
 * @returns {Promise<Array<{ id:string, displayName:string, firstName:string|null, bookingSlug:string|null, priority:number, lastAssignedAt:Date|null }>>}
 */
export async function teamPool(tx, { tenantId, serviceId }) {
  const { rows: linked } = await tx.query(
    `SELECT u.id, u.display_name, u.first_name, u.booking_slug, sh.priority, sh.last_assigned_at
       FROM keystone.service_host sh
       JOIN keystone.app_user u ON u.id = sh.app_user_id AND u.tenant_id = sh.tenant_id
      WHERE sh.tenant_id = $1 AND sh.service_id = $2
        AND u.role = 'staff' AND u.accepting_new_bookings = true AND u.archived_at IS NULL
      ORDER BY u.id`,
    [tenantId, serviceId]);
  const { rows: any } = await tx.query(`SELECT 1 FROM keystone.service_host WHERE tenant_id = $1 AND service_id = $2 LIMIT 1`, [tenantId, serviceId]);
  let rows = linked;
  if (any.length === 0) {
    ({ rows } = await tx.query(
      `SELECT u.id, u.display_name, u.first_name, u.booking_slug, 100 AS priority, NULL::timestamptz AS last_assigned_at
         FROM keystone.app_user u
        WHERE u.tenant_id = $1 AND u.role = 'staff' AND u.accepting_new_bookings = true AND u.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM keystone.availability_rule r WHERE r.tenant_id = u.tenant_id AND r.host_id = u.id AND r.effective_to IS NULL)
        ORDER BY u.id`,
      [tenantId]));
  }
  return rows.map((r) => ({
    id: r.id, displayName: r.display_name, firstName: firstNameOf(r.first_name, r.display_name), bookingSlug: r.booking_slug ?? null,
    priority: Number(r.priority ?? 100), lastAssignedAt: r.last_assigned_at ? new Date(r.last_assigned_at) : null,
  }));
}

/** The visitor may name a person only when the practice allows staff choice. */
export async function staffChoiceAllowed(tx) {
  return (await getSetting(tx, "booking.show_staff_choice", true)) !== false;
}

function narrowPool(pool, hostKey, choiceAllowed) {
  const k = typeof hostKey === "string" ? hostKey.trim().toLowerCase() : "";
  if (!k || k === "any") return pool;
  // Choosing a person is a practice decision. When it is off the request is refused exactly like a bad slug — never a hint.
  if (!choiceAllowed) throw notFound(PUBLIC_BOOKING_REFUSED);
  const one = pool.filter((h) => h.bookingSlug && h.bookingSlug.toLowerCase() === k);
  if (one.length === 0) throw notFound(PUBLIC_BOOKING_REFUSED);
  return one;
}

// ── pooled slots ────────────────────────────────────────────────────────────────────────────────
/**
 * Slots for a team service over a date range (practice-local dates, inclusive).
 * @returns {Promise<{ timeZone:string, durationMinutes:number, slots:Array<{startsAt:string,endsAt:string,localTime:string,hosts:string[]}>, hostChoice:boolean, hosts:Array<{slug:string,name:string}>, calendarsChecked:boolean }>}
 */
export async function readTeamSlots(tx, { tenantId, service, fromDate, toDate, hostKey = null, now = new Date() }, deps = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fromDate ?? "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(toDate ?? ""))) {
    throw invalid("from and to must be dates (YYYY-MM-DD)");
  }
  if (toDate < fromDate) throw invalid("to must not be before from");
  const policy = await policyFor(tx, tenantId, service.id);
  const { rows: tzRows } = await tx.query(`SELECT timezone FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const timeZone = tzRows[0]?.timezone ?? "UTC";
  const choice = await staffChoiceAllowed(tx);
  const fullPool = await teamPool(tx, { tenantId, serviceId: service.id });
  const pool = narrowPool(fullPool, hostKey, choice);

  // practice-local calendar days, never before today, never beyond the service's booking window, at most MAX_RANGE_DAYS
  const today = isoDate(wallClockIn(now, timeZone));
  const lastAllowed = isoDate(wallClockIn(new Date(now.getTime() + policy.booking_window_days * 86_400_000), timeZone));
  const dates = [];
  for (let d = fromDate < today ? today : fromDate; d <= toDate && d <= lastAllowed && dates.length < MAX_RANGE_DAYS; d = addDaysISO(d, 1)) dates.push(d);
  const empty = { timeZone, durationMinutes: service.durationMinutes, slots: [], hostChoice: choice, hosts: choice ? fullPool.filter((h) => h.bookingSlug).map((h) => ({ slug: h.bookingSlug, name: h.displayName })) : [], calendarsChecked: true };
  if (dates.length === 0 || pool.length === 0) return empty;

  // outside busy time, once per person for the whole window (cached for two minutes inside googleCalendar.mjs)
  const winFrom = zonedLocalToUtc(...ymd(dates[0]), 0, timeZone);
  const lastNext = addDaysISO(dates[dates.length - 1], 1);
  const winTo = zonedLocalToUtc(...ymd(lastNext), 0, timeZone);
  const ext = new Map();
  let calendarsChecked = true;
  for (const h of pool) {
    const b = await busyForHost(tx, { tenantId, hostId: h.id, from: winFrom, to: winTo }, deps);
    ext.set(h.id, b);
    if (!b.ok) calendarsChecked = false;
  }

  /** @type {Map<string,{startsAt:Date,endsAt:Date,localTime:string,hosts:Set<string>}>} */
  const byInstant = new Map();
  for (const h of pool) {
    const busy = ext.get(h.id)?.busy ?? [];
    for (const date of dates) {
      const { slots } = await readSlotsCached(tx, { tenantId, hostId: h.id, date, serviceId: service.id, now });
      for (const s of slots) {
        if (busy.length && overlapsBusy(busy, s.startsAt, s.endsAt, { bufferBeforeMinutes: policy.buffer_before_minutes, bufferAfterMinutes: policy.buffer_after_minutes })) continue;
        if (s.startsAt.getTime() > now.getTime() + policy.booking_window_days * 86_400_000) continue;
        const k = s.startsAt.toISOString();
        const hit = byInstant.get(k) ?? { startsAt: s.startsAt, endsAt: s.endsAt, localTime: s.localTime, hosts: new Set() };
        hit.hosts.add(h.bookingSlug ?? "");
        byInstant.set(k, hit);
      }
    }
  }
  const slots = [...byInstant.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).map((s) => ({
    startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), localTime: s.localTime,
    // people are named only when the practice allows choosing one, and only people who have a public slug
    hosts: choice ? [...s.hosts].filter(Boolean).sort() : [],
  }));
  return { ...empty, slots, calendarsChecked };
}
const ymd = (iso) => iso.split("-").map(Number);

// ── the rule ────────────────────────────────────────────────────────────────────────────────────
async function assignmentRuleFor(tx, { tenantId, serviceId }) {
  const { rows } = await tx.query(`SELECT assignment_rule FROM keystone.booking_policy WHERE tenant_id = $1 AND service_id = $2`, [tenantId, serviceId]);
  const own = rows[0]?.assignment_rule ?? null;
  if (own && RULES.includes(own)) return own;
  const practice = await getSetting(tx, "booking.assignment_rule", "round_robin");
  return RULES.includes(practice) ? practice : "round_robin";
}

/** Pure ordering — exported so the rule is testable without a database. `counts` maps host id → bookings in the next 14 days. */
function orderByRule(candidates, rule, counts = new Map()) {
  const t = (h) => (h.lastAssignedAt ? h.lastAssignedAt.getTime() : -Infinity); // never assigned goes first
  const rr = (a, b) => t(a) - t(b) || a.priority - b.priority || (a.id < b.id ? -1 : 1);
  const list = [...candidates];
  if (rule === "priority") return list.sort((a, b) => a.priority - b.priority || t(a) - t(b) || (a.id < b.id ? -1 : 1));
  if (rule === "least_booked") return list.sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || rr(a, b));
  return list.sort(rr);
}

// ── create ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Book a team service. `lead` is the parsed lead (src/lead-contract parseLead's data): name, email, phone, message, textConsent, attribution.
 * @returns {Promise<{ bookingId:string, hostId:string, hostName:string, hostFirstName:string|null, startsAt:Date, endsAt:Date, state:string, reference:string, modality:string, serviceName:string, durationMinutes:number, timeZone:string, personId:string, replayed:boolean, calendarsChecked:boolean }>}
 */
export async function createTeamBooking(tx, input, deps = {}) {
  const { tenantId, service, startsAt, hostKey = null, lead, ip = null, userAgent = null, inviteeTimezone = null } = input;
  let { modality = null } = input;
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) throw invalid("startsAt is required and must be a valid date/time");

  const modes = (service.deliveryModes ?? []).filter((m) => MODALITIES.includes(m));
  if (modality == null || modality === "") {
    if (modes.length === 1) modality = modes[0];
    else throw invalid("choose phone or video", { fields: { modality: "Choose phone or video." } });
  }
  if (!MODALITIES.includes(modality) || !modes.includes(modality)) {
    throw invalid("that way of meeting isn't offered for this call", { fields: { modality: "Choose phone or video." } });
  }

  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
  const policy = await policyFor(tx, tenantId, service.id);
  const nowMs = Date.now();
  if (startsAt.getTime() <= nowMs + policy.minimum_notice_minutes * 60_000) throw invalid("That time is too soon to book online.");
  if (startsAt.getTime() > nowMs + policy.booking_window_days * 86_400_000) throw invalid("That time is beyond how far ahead this practice takes online bookings.");

  const whoCanBook = await getSetting(tx, "booking.who_can_book", "anyone");
  if (whoCanBook === "existing_clients") {
    const { rows } = await tx.query(
      `SELECT 1 FROM keystone.app_user WHERE tenant_id = $1 AND lower(email) = lower($2) AND lifecycle_status <> 'lead' AND archived_at IS NULL LIMIT 1`,
      [tenantId, lead.email]);
    if (rows.length === 0) throw forbidden("This practice only takes online bookings from people already on its books.");
  }

  const choice = await staffChoiceAllowed(tx);
  const pool = narrowPool(await teamPool(tx, { tenantId, serviceId: service.id }), hostKey, choice);
  if (pool.length === 0) throw new SlotTakenError("That time is no longer available. Choose another slot.");

  // ── outside calendars: fresh, in parallel-ish, BEFORE any lock is held ──────────────────────
  const pad15 = 15 * 60_000;
  const ext = new Map();
  let calendarsChecked = true;
  for (const h of pool) {
    const b = await busyForHost(tx, { tenantId, hostId: h.id, from: new Date(startsAt.getTime() - pad15 - policy.buffer_before_minutes * 60_000), to: new Date(endsAt.getTime() + pad15 + policy.buffer_after_minutes * 60_000), fresh: true }, deps);
    ext.set(h.id, b);
    if (b.connected && !b.ok) calendarsChecked = false;
  }

  // ── the host locks, in ascending id order ───────────────────────────────────────────────────
  const lockOrder = [...pool].map((h) => h.id).sort();
  for (const id of lockOrder) {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [`booking:${tenantId}:${id}`]);
  }

  // ── now (and only now) read what the rule needs, and which people are really free ──────────
  const fresh = await teamPool(tx, { tenantId, serviceId: service.id });
  const byId = new Map(fresh.map((h) => [h.id, h]));
  const candidates = [];
  const { rows: tzRows } = await tx.query(`SELECT timezone FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const timeZone = tzRows[0]?.timezone ?? "UTC";
  const localDate = isoDate(wallClockIn(startsAt, timeZone));
  for (const h of pool) {
    const live = byId.get(h.id);
    if (!live) continue; // stopped accepting between the first read and the lock
    const { slots } = await readSlots(tx, { hostId: h.id, date: localDate, serviceId: service.id, now: new Date() });
    if (!slots.some((s) => s.startsAt.getTime() === startsAt.getTime())) continue;
    const b = ext.get(h.id);
    if (b?.ok && b.busy.length && overlapsBusy(b.busy, startsAt, endsAt, { bufferBeforeMinutes: policy.buffer_before_minutes, bufferAfterMinutes: policy.buffer_after_minutes })) continue;
    candidates.push(live);
  }
  if (candidates.length === 0) throw new SlotTakenError("That time is no longer available. Choose another slot.");

  const rule = await assignmentRuleFor(tx, { tenantId, serviceId: service.id });
  const counts = new Map();
  if (rule === "least_booked") {
    const { rows } = await tx.query(
      `SELECT host_id, count(*)::int AS n FROM keystone.booking
        WHERE tenant_id = $1 AND host_id = ANY($2::uuid[]) AND state <> 'cancelled' AND starts_at >= now() AND starts_at < now() + interval '14 days'
        GROUP BY host_id`,
      [tenantId, candidates.map((c) => c.id)]);
    for (const r of rows) counts.set(r.host_id, r.n);
  }
  const ordered = orderByRule(candidates, rule, counts);

  // ── the lead, then a replay check: the same person asking for the same time again IS the same booking ──
  const noteLine = lead.message ? `[${new Date().toISOString().slice(0, 10)}] ${lead.message}` : null;
  const { personId } = await findOrCreateWebsiteLead(tx, { tenantId, lead, ip, userAgent, serviceName: service.name, programId: service.programId, noteLine });
  const { rows: prior } = await tx.query(
    `SELECT b.id, b.host_id, b.state, b.location_kind, u.display_name, u.first_name
       FROM keystone.booking b
       JOIN keystone.booking_participant bp ON bp.booking_id = b.id AND bp.tenant_id = b.tenant_id AND bp.app_user_id = $3 AND bp.party = 'client'
       JOIN keystone.app_user u ON u.id = b.host_id
      WHERE b.tenant_id = $1 AND b.service_id = $2 AND b.starts_at = $4 AND b.state <> 'cancelled' LIMIT 1`,
    [tenantId, service.id, personId, startsAt]);
  if (prior[0]) {
    const p = prior[0];
    return { bookingId: p.id, hostId: p.host_id, hostName: p.display_name, hostFirstName: firstNameOf(p.first_name, p.display_name), startsAt, endsAt, state: p.state, reference: referenceOf(p.id), modality: p.location_kind ?? modality, serviceName: service.name, durationMinutes: service.durationMinutes, timeZone, personId, replayed: true, calendarsChecked };
  }

  // ── insert for the first survivor; a clash tries the next ──────────────────────────────────
  let booking = null, chosen = null;
  let n = 0;
  for (const host of ordered) {
    const sp = `team_try_${n++}`;
    await tx.query(`SAVEPOINT ${sp}`);
    try {
      booking = await createBooking(tx, {
        tenantId, hostId: host.id, serviceId: service.id, startsAt, endsAt,
        bufferBeforeMinutes: policy.buffer_before_minutes, bufferAfterMinutes: policy.buffer_after_minutes,
        inviteeTimezone, title: `${service.name} — ${lead.name}`,
        description: lead.message ? String(lead.message).slice(0, 2000) : null,
        locationKind: modality, locationDetail: modality === "phone" ? lead.phone : null,
        source: "public", actorUserId: null, personId,
      }, { publicBooking: true });
      chosen = host;
      await tx.query(`RELEASE SAVEPOINT ${sp}`);
      break;
    } catch (e) {
      await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      await tx.query(`RELEASE SAVEPOINT ${sp}`);
      if (e instanceof SlotTakenError || e?.code === EXCLUSION_VIOLATION) continue;
      throw e;
    }
  }
  if (!booking || !chosen) throw new SlotTakenError("That time was just taken. Choose another slot.");

  // the assigned person is on the booking too, so they are told (reminders and notifications go to participants)
  await addBookingParticipant(tx, { tenantId, bookingId: booking.id, party: "coach", appUserId: chosen.id, displayName: chosen.displayName, email: null, actorUserId: null });
  await tx.query(
    `UPDATE keystone.service_host SET last_assigned_at = now(), updated_at = now() WHERE tenant_id = $1 AND service_id = $2 AND app_user_id = $3`,
    [tenantId, service.id, chosen.id]);
  if (!calendarsChecked) {
    await tx.query(`UPDATE keystone.booking SET flag = 'other', flag_note = $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, booking.id, "Google Calendar could not be checked when this was booked — please look at your calendar."]);
  }
  return {
    bookingId: booking.id, hostId: chosen.id, hostName: chosen.displayName, hostFirstName: chosen.firstName,
    startsAt, endsAt, state: booking.state, reference: referenceOf(booking.id), modality, serviceName: service.name,
    durationMinutes: service.durationMinutes, timeZone, personId, replayed: false, calendarsChecked,
  };
}

/** A short code the visitor can quote. The tail of a v7 id is the random part. */
const referenceOf = (id) => String(id).replace(/-/g, "").slice(-8).toUpperCase();
