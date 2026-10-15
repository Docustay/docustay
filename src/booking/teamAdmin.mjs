// @ts-check
// src/booking/teamAdmin.mjs — what staff see and change about TEAM booking (6 Oct 2026).
// Specs: specs/BOOKING-TEAM-PLAN-6OCT.md. Pure data in / data out over a tenant transaction; the routes (routes/teamBookingAdmin.mjs) own
// who may call. Nothing here reads a tenant id from a request.

import { invalid, notFound, conflict } from "../http/errors.mjs";
import { getSetting, setSetting } from "./../settings/writes.mjs";
import { deriveTenantKey, MASTER_VAR } from "./s2sAuth.mjs";
import { RULES } from "./teamBooking.mjs";
import { SlotTakenError } from "./createBooking.mjs";
import { readSlots } from "./read.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { addBookingParticipant } from "./writes.mjs";

const hostLock = (tenantId, hostId) => [`booking:${tenantId}:${hostId}`];

/**
 * Everything the Team booking screen shows.
 * @param {string} appDomain  e.g. example.com
 */
export async function teamBookingOverview(tx, { tenantId, appDomain, canSeeKey }) {
  const { rows: tn } = await tx.query(`SELECT slug, timezone FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const slug = tn[0]?.slug ?? null;
  const base = slug ? `https://${slug}.${appDomain}` : null;
  const { rows: cust } = await tx.query(
    `SELECT hostname FROM keystone.custom_domain WHERE tenant_id = $1 AND live_at IS NOT NULL AND removed_at IS NULL ORDER BY created_at LIMIT 1`, [tenantId]);

  const { rows: services } = await tx.query(
    `SELECT s.id, s.name, s.booking_key, s.duration_minutes, s.public_bookable, s.bookable, s.active, s.delivery_modes, bp.assignment_rule
       FROM keystone.service s LEFT JOIN keystone.booking_policy bp ON bp.tenant_id = s.tenant_id AND bp.service_id = s.id
      WHERE s.tenant_id = $1 AND s.booking_key IS NOT NULL AND s.archived_at IS NULL ORDER BY s.name`, [tenantId]);
  const { rows: staff } = await tx.query(
    `SELECT u.id, u.display_name, u.email, u.booking_slug, u.accepting_new_bookings,
            EXISTS (SELECT 1 FROM keystone.availability_rule r WHERE r.tenant_id = u.tenant_id AND r.host_id = u.id
                     AND (r.effective_to IS NULL OR r.effective_to >= current_date)) AS has_hours,
            (SELECT CASE WHEN c.status = 'active' AND coalesce(gi.grant_state, 'usable') = 'usable' THEN 'connected' ELSE 'needs_attention' END
               FROM keystone.calendar_connection c LEFT JOIN keystone.google_identity gi ON gi.id = c.google_identity_id AND gi.tenant_id = c.tenant_id
              WHERE c.tenant_id = u.tenant_id AND c.host_id = u.id AND c.provider = 'google' ORDER BY c.created_at DESC LIMIT 1) AS calendar
       FROM keystone.app_user u WHERE u.tenant_id = $1 AND u.role = 'staff' AND u.archived_at IS NULL ORDER BY u.display_name`, [tenantId]);
  const { rows: sh } = await tx.query(`SELECT service_id, app_user_id, priority, last_assigned_at FROM keystone.service_host WHERE tenant_id = $1`, [tenantId]);

  const defaultRule = await getSetting(tx, "booking.assignment_rule", "round_robin");
  const epoch = Number(await getSetting(tx, "booking.api_key_epoch", 1)) || 1;
  const key = canSeeKey ? deriveTenantKey(tenantId, epoch) : null;
  return {
    timeZone: tn[0]?.timezone ?? null,
    urls: {
      company: base ? `${base}/book` : null,
      custom: cust[0]?.hostname ? `https://${cust[0].hostname}/book` : null,
      people: staff.filter((u) => u.booking_slug).map((u) => ({ appUserId: u.id, name: u.display_name, url: base ? `${base}/book/${u.booking_slug}` : null })),
      apiBase: base ? `${base}/api/public/s2s` : null,
    },
    onlineEnabled: (await getSetting(tx, "booking.online_enabled", true)) !== false,
    staffChoice: (await getSetting(tx, "booking.show_staff_choice", true)) !== false,
    defaultRule: RULES.includes(defaultRule) ? defaultRule : "round_robin",
    rules: RULES,
    services: services.map((s) => ({
      id: s.id, name: s.name, key: s.booking_key, durationMinutes: s.duration_minutes, publicBookable: s.public_bookable, modalities: s.delivery_modes ?? [],
      rule: s.assignment_rule ?? null,
      hosts: sh.filter((h) => h.service_id === s.id).map((h) => ({ appUserId: h.app_user_id, priority: h.priority, lastAssignedAt: h.last_assigned_at })),
    })),
    staff: staff.map((u) => ({
      id: u.id, name: u.display_name, email: u.email, bookingSlug: u.booking_slug, accepting: u.accepting_new_bookings, hasHours: u.has_hours,
      calendar: u.calendar ?? "not_connected",
      // what is missing for this person to be offered at all
      needs: [!u.accepting_new_bookings && "accepting new bookings is off", !u.has_hours && "no weekly hours", !u.booking_slug && "no booking link"].filter(Boolean),
    })),
    websiteConnection: {
      masterConfigured: Boolean(process.env[MASTER_VAR] && process.env[MASTER_VAR].length >= 32),
      epoch, key, keyVisibleToYou: Boolean(canSeeKey),
    },
  };
}

/** Who delivers a service, in what order, under which rule. `hosts` replaces the set (additions and removals are diffed, not rewritten). */
export async function setServiceTeam(tx, { tenantId, serviceId, hosts, rule }) {
  if (rule != null && !RULES.includes(rule)) throw invalid(`rule must be one of ${RULES.join(", ")}`, { fields: { rule: "invalid" } });
  if (!Array.isArray(hosts) || hosts.length > 50) throw invalid("hosts must be a list");
  const { rows: svc } = await tx.query(`SELECT id FROM keystone.service WHERE tenant_id = $1 AND id = $2 AND archived_at IS NULL`, [tenantId, serviceId]);
  if (!svc.length) throw notFound("no such service");
  const want = new Map();
  for (const h of hosts) {
    const id = typeof h === "string" ? h : h?.appUserId;
    const p = typeof h === "object" && Number.isInteger(h.priority) ? Math.min(Math.max(h.priority, 1), 1000) : 100;
    if (typeof id !== "string") throw invalid("each host needs an appUserId");
    want.set(id, p);
  }
  if (want.size) {
    const { rows } = await tx.query(`SELECT id FROM keystone.app_user WHERE tenant_id = $1 AND role = 'staff' AND archived_at IS NULL AND id = ANY($2::uuid[])`, [tenantId, [...want.keys()]]);
    if (rows.length !== want.size) throw invalid("every host must be a current staff member of this practice");
  }
  await tx.query(`DELETE FROM keystone.service_host WHERE tenant_id = $1 AND service_id = $2 AND NOT (app_user_id = ANY($3::uuid[]))`, [tenantId, serviceId, [...want.keys()]]);
  for (const [id, priority] of want) {
    await tx.query(
      `INSERT INTO keystone.service_host (tenant_id, service_id, app_user_id, priority) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, service_id, app_user_id) DO UPDATE SET priority = EXCLUDED.priority, updated_at = now()`, [tenantId, serviceId, id, priority]);
  }
  if (rule !== undefined) {
    await tx.query(
      `INSERT INTO keystone.booking_policy (tenant_id, service_id, assignment_rule) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, service_id) DO UPDATE SET assignment_rule = EXCLUDED.assignment_rule`, [tenantId, serviceId, rule]);
  }
  return { ok: true, hosts: want.size };
}

/** Rotate the website key: the old one stops working at once. */
export async function rotateWebsiteKey(tx, { tenantId, actorUserId }) {
  const epoch = (Number(await getSetting(tx, "booking.api_key_epoch", 1)) || 1) + 1;
  await setSetting(tx, { tenantId, key: "booking.api_key_epoch", value: epoch, updatedBy: actorUserId });
  return { epoch, key: deriveTenantKey(tenantId, epoch) };
}

/**
 * Move a booking to another person. The time does not change. Without `override` the new person must be free then
 * (their hours, time off and calendar); with it the person is put there regardless of hours — but NEVER over another booking of theirs
 * (the database refuses that, whatever staff want).
 */
export async function reassignBooking(tx, { tenantId, bookingId, hostId, override = false, actorUserId }) {
  const { rows } = await tx.query(
    `SELECT id, host_id, service_id, starts_at, ends_at, state FROM keystone.booking WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, bookingId]);
  if (!rows.length) throw notFound("no such booking");
  const b = rows[0];
  if (b.state === "cancelled" || b.state === "completed" || b.state === "no_show") throw conflict(`this booking is ${String(b.state).replace("_", " ")}`);
  if (b.host_id === hostId) return { ok: true, unchanged: true };
  const { rows: h } = await tx.query(`SELECT id, display_name FROM keystone.app_user WHERE tenant_id = $1 AND id = $2 AND role = 'staff' AND archived_at IS NULL`, [tenantId, hostId]);
  if (!h.length) throw invalid("the new person must be a current staff member");
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, hostLock(tenantId, hostId));
  if (!override) {
    const date = new Date(b.starts_at).toISOString().slice(0, 10);
    // a booking's own slot is offered back by readSlots only after it is gone; look one day either side for the instant
    let free = false;
    for (const d of [date]) {
      const { slots } = await readSlots(tx, { tenantId, hostId, date: d, serviceId: b.service_id, now: new Date(0) }).catch(() => ({ slots: [] }));
      if (slots.some((s) => s.startsAt.getTime() === new Date(b.starts_at).getTime())) free = true;
    }
    if (!free) throw conflict("that person is not free then — choose Override to put them on it anyway");
  }
  try {
    await tx.query("SAVEPOINT reassign");
    await tx.query(`UPDATE keystone.booking SET host_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, bookingId, hostId]);
    await tx.query("RELEASE SAVEPOINT reassign");
  } catch (e) {
    await tx.query("ROLLBACK TO SAVEPOINT reassign");
    if (e?.code === "23P01") throw new SlotTakenError("that person already has something at that time");
    throw e;
  }
  await tx.query(`UPDATE keystone.booking_participant SET app_user_id = $3, display_name = $4 WHERE tenant_id = $1 AND booking_id = $2 AND party = 'coach'`, [tenantId, bookingId, hostId, h[0].display_name]);
  const { rowCount } = await tx.query(`SELECT 1 FROM keystone.booking_participant WHERE tenant_id = $1 AND booking_id = $2 AND party = 'coach'`, [tenantId, bookingId]);
  if (!rowCount) await addBookingParticipant(tx, { tenantId, bookingId, party: "coach", appUserId: hostId, displayName: h[0].display_name, actorUserId });
  await emit(tx, {
    tenantId, topic: "booking.booking.rescheduled", emittedBy: "booking", subjectType: "booking", subjectId: bookingId, actor: userActor(actorUserId),
    payload: { starts_at: b.starts_at, ends_at: b.ends_at, state: b.state, host_id: hostId, previous_host_id: b.host_id, service_id: b.service_id, reassigned: true, override: Boolean(override), tell_client: false },
  });
  return { ok: true, hostId, hostName: h[0].display_name, override: Boolean(override) };
}

/** Add another staff member to a booking as a participant (they are told, and it appears on their calendar view). */
export async function addStaffAttendee(tx, { tenantId, bookingId, appUserId, actorUserId }) {
  const { rows: b } = await tx.query(`SELECT id, state FROM keystone.booking WHERE tenant_id = $1 AND id = $2`, [tenantId, bookingId]);
  if (!b.length) throw notFound("no such booking");
  const { rows: u } = await tx.query(`SELECT id, display_name, email FROM keystone.app_user WHERE tenant_id = $1 AND id = $2 AND role = 'staff' AND archived_at IS NULL`, [tenantId, appUserId]);
  if (!u.length) throw invalid("the attendee must be a current staff member");
  const { rows: dup } = await tx.query(`SELECT 1 FROM keystone.booking_participant WHERE tenant_id = $1 AND booking_id = $2 AND app_user_id = $3`, [tenantId, bookingId, appUserId]);
  if (dup.length) return { ok: true, unchanged: true };
  await addBookingParticipant(tx, { tenantId, bookingId, party: "coach", appUserId, displayName: u[0].display_name, email: u[0].email, actorUserId });
  return { ok: true };
}
