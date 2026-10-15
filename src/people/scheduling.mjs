// @ts-check
// 12.3 — THE SCHEDULING OBJECT (F02 §2.5). `keystone.staff_shift`, `keystone.time_off`, the week
// read, and the one permission that governs every write here: "staff edit only their own hours."
//
// ★ Permission precedent: working hours ride the `engagement` grant with the staff member as owner
//   (`src/permissions/ownership.mjs:72-74`, the `availability_rule` note) — Owner/Admin may touch
//   everyone's hours, a Coach only their own (`engagement: edit/owned`, `src/permissions/defaults.mjs:104`).
//
// ★★ TIME. A shift is a plain calendar `date` plus integer MINUTES FROM MIDNIGHT — the PRACTICE's
//   wall clock, same convention `availability_rule`/`date_override` already use. Neither table here
//   stores a computed UTC instant; that conversion (an IANA zone, DST-safe) belongs to the READER
//   (13.18's `readSlots`, 12.4's widened `generateSlots`), never to this module.
//
// ★ Not to touch: `src/booking/slots.mjs`, `src/booking/read.mjs`, the `availability_rule`/
//   `date_override` tables — this module writes only `staff_shift` and `time_off`.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, forbidden, conflict, notFound } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "people";

const CHECK_VIOLATION = "23514";

/** ★ `YYYY-MM-DD`, and a real calendar date (rejects e.g. 2026-02-30). */
function isValidDateString(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** ★ `Date.UTC` arithmetic on a plain calendar date — no zone, no instant, just the calendar. */
function addDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}`.padStart(4, "0") + "-" +
    `${dt.getUTCMonth() + 1}`.padStart(2, "0") + "-" +
    `${dt.getUTCDate()}`.padStart(2, "0");
}

/** ★ Monday=1 … Sunday=0 via `getUTCDay()` — anchored in UTC so the server's own local zone never
 *   moves the answer, the same technique `src/booking/slots.mjs:dayOfWeekIn` uses for a real instant. */
function isMonday(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

function assertMondayWeekStart(weekStart) {
  if (!isValidDateString(weekStart) || !isMonday(weekStart)) {
    throw invalid("weekStart must be a Monday, as YYYY-MM-DD");
  }
}

/** `h:mm`, no leading zero on the hour — "9:00", "14:00". */
function minutesToLabel(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${h}:${mm}`;
}

/** Turn a Postgres CHECK violation on `staff_shift`/`time_off` into the caller-facing `invalid`. */
function checkViolationToInvalid(e) {
  if (e?.code !== CHECK_VIOLATION) return null;
  if (e.constraint === "staff_shift_video_has_no_place") {
    return invalid("A video-only shift cannot also have a location.");
  }
  if (e.constraint === "staff_shift_window" || e.constraint === "time_off_range") {
    return invalid("The end must be after the start.");
  }
  return invalid("That is not a valid shift.");
}

/**
 * ★ Owner/Admin: everything. Coach (`engagement: edit/owned`): own row only.
 */
export async function mayEditHours(tx, viewerId, appUserId) {
  const { rows } = await tx.query(
    `SELECT keystone.user_may($1, 'engagement', 'edit', $2) AS allowed`,
    [viewerId, appUserId]);
  return rows[0]?.allowed === true;
}

/**
 * The week read. `weekStart` must be a Monday `YYYY-MM-DD`. `rows` = every staff member with
 * `lifecycle_status <> 'former'` the viewer may VIEW (`engagement`, `view`) — Owner/Admin see the
 * whole team, a Coach sees whoever their `engagement` scope reaches.
 */
export async function readSchedule(tx, { viewerId, weekStart }) {
  assertMondayWeekStart(weekStart);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const { rows: staff } = await tx.query(
    `SELECT id, display_name, keystone.user_may($1, 'engagement', 'edit', id) AS can_edit
       FROM keystone.app_user
      WHERE role = 'staff' AND lifecycle_status <> 'former'
        AND keystone.user_may($1, 'engagement', 'view', id)
      ORDER BY display_name, id`,
    [viewerId]);

  if (staff.length === 0) {
    return { weekStart, days, rows: [] };
  }

  const staffIds = staff.map((r) => r.id);

  const { rows: shiftRows } = await tx.query(
    `SELECT s.id, s.app_user_id, s.on_date, s.start_minute, s.end_minute, s.location_id,
            l.name AS location_name, s.video_only, s.label
       FROM keystone.staff_shift s
       LEFT JOIN keystone.location l ON l.id = s.location_id
      WHERE s.app_user_id = ANY($1::uuid[]) AND s.on_date BETWEEN $2 AND $3
      ORDER BY s.on_date, s.start_minute`,
    [staffIds, weekStart, weekEnd]);

  const { rows: timeOffRows } = await run(tx, db
    .selectFrom("keystone.time_off")
    .select(["id", "app_user_id", "starts_on", "ends_on", "reason"])
    .where(sql`app_user_id = ANY(${sql.val(staffIds)})`)
    .where("starts_on", "<=", weekEnd)
    .where("ends_on", ">=", weekStart)
    .orderBy("starts_on"));

  const shiftsByUser = new Map();
  for (const s of shiftRows) {
    const list = shiftsByUser.get(s.app_user_id) ?? [];
    list.push({
      id: s.id,
      onDate: s.on_date,
      startMinute: s.start_minute,
      endMinute: s.end_minute,
      locationId: s.location_id,
      locationName: s.location_name,
      videoOnly: s.video_only,
      label: s.label,
    });
    shiftsByUser.set(s.app_user_id, list);
  }

  const timeOffByUser = new Map();
  for (const t of timeOffRows) {
    const list = timeOffByUser.get(t.app_user_id) ?? [];
    list.push({ id: t.id, startsOn: t.starts_on, endsOn: t.ends_on, reason: t.reason });
    timeOffByUser.set(t.app_user_id, list);
  }

  const rows = staff.map((s) => ({
    appUserId: s.id,
    displayName: s.display_name,
    shifts: shiftsByUser.get(s.id) ?? [],
    timeOff: timeOffByUser.get(s.id) ?? [],
    canEdit: s.can_edit === true,
  }));

  return { weekStart, days, rows };
}

/** ★ An overlap in `keystone.staff_shift` for one person, one day — a half-open-interval test, so
 *   an adjacent shift (12:00 ending, 12:00 starting) does NOT count as an overlap. */
async function findOverlap(tx, { appUserId, onDate, startMinute, endMinute, excludeShiftId = null }) {
  const args = [appUserId, onDate, startMinute, endMinute];
  let sql = `SELECT start_minute, end_minute FROM keystone.staff_shift
              WHERE app_user_id = $1 AND on_date = $2
                AND start_minute < $4 AND end_minute > $3`;
  if (excludeShiftId) {
    args.push(excludeShiftId);
    sql += ` AND id <> $${args.length}`;
  }
  sql += ` ORDER BY start_minute LIMIT 1`;
  const { rows } = await tx.query(sql, args);
  return rows[0] ?? null;
}

async function assertActiveStaff(tx, { tenantId, appUserId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["role", "lifecycle_status"])
    .where("id", "=", appUserId)
    .where("tenant_id", "=", tenantId));
  const row = rows[0];
  if (!row || row.role !== "staff" || row.lifecycle_status === "former") {
    throw invalid("that person is not an active staff member");
  }
}

// ★ 0497 (§5) — staff-to-location, enforced at the shift write. A member with NO
//   `staff_location` rows works everywhere (0497's back-compat rule); one WITH rows may only be
//   rostered at a listed location. Server-side, at write time — never a client-side hidden option.
async function assertWorksAtLocation(tx, { tenantId, appUserId, locationId }) {
  if (!locationId) return;
  const { rows } = await tx.query(
    `SELECT (NOT EXISTS (SELECT 1 FROM keystone.staff_location sl
                          WHERE sl.tenant_id = $1 AND sl.app_user_id = $2)
             OR EXISTS (SELECT 1 FROM keystone.staff_location sl
                         WHERE sl.tenant_id = $1 AND sl.app_user_id = $2
                           AND sl.location_id = $3)) AS ok`,
    [tenantId, appUserId, locationId]);
  if (rows[0]?.ok !== true) {
    throw invalid("that staff member does not work at that location");
  }
}

export async function createShift(tx, {
  tenantId, viewerId, appUserId, onDate, startMinute, endMinute,
  locationId = null, videoOnly = false, label = null, actorUserId,
}) {
  if (!(await mayEditHours(tx, viewerId, appUserId))) {
    throw forbidden("You can change only your own hours.");
  }
  await assertActiveStaff(tx, { tenantId, appUserId });
  await assertWorksAtLocation(tx, { tenantId, appUserId, locationId });
  if (!isValidDateString(onDate)) throw invalid("onDate must be a real calendar date, as YYYY-MM-DD");
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
    throw invalid("startMinute and endMinute must be integers");
  }

  const overlap = await findOverlap(tx, { appUserId, onDate, startMinute, endMinute });
  if (overlap) {
    throw conflict(
      `That overlaps the ${minutesToLabel(overlap.start_minute)}–${minutesToLabel(overlap.end_minute)} shift on ${onDate}.`);
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.staff_shift")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        app_user_id: appUserId ?? null,
        on_date: onDate ?? null,
        start_minute: startMinute ?? null,
        end_minute: endMinute ?? null,
        location_id: locationId ?? null,
        video_only: (videoOnly === true) ?? null,
        label: label ?? null,
        created_by: actorUserId ?? null,
      }));
  } catch (e) {
    const mapped = checkViolationToInvalid(e);
    if (mapped) throw mapped;
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "people.shift.created", emittedBy: SECTION,
    subjectType: "staff_shift", subjectId: id,
    actor: userActor(actorUserId),
    payload: { app_user_id: appUserId, on_date: onDate },
  });
  return { id };
}

export async function updateShift(tx, {
  tenantId, viewerId, shiftId, onDate, startMinute, endMinute, locationId, videoOnly, label, actorUserId,
}) {
  const { rows: existingRows } = await run(tx, db
    .selectFrom("keystone.staff_shift")
    .select(["app_user_id", "on_date", "start_minute", "end_minute"])
    .where("id", "=", shiftId)
    .where("tenant_id", "=", tenantId));
  const existing = existingRows[0];
  if (!existing) throw notFound("no such shift in this practice");

  if (!(await mayEditHours(tx, viewerId, existing.app_user_id))) {
    throw forbidden("You can change only your own hours.");
  }

  const sets = [];
  const args = [shiftId];
  const changed = [];
  const setField = (column, value, label2) => {
    args.push(value);
    sets.push(`${column} = $${args.length}`);
    changed.push(label2 ?? column);
  };

  const finalOnDate = onDate !== undefined ? onDate : existing.on_date;
  const finalStart = startMinute !== undefined ? startMinute : existing.start_minute;
  const finalEnd = endMinute !== undefined ? endMinute : existing.end_minute;

  if (onDate !== undefined) {
    if (!isValidDateString(onDate)) throw invalid("onDate must be a real calendar date, as YYYY-MM-DD");
    setField("on_date", onDate);
  }
  if (startMinute !== undefined) {
    if (!Number.isInteger(startMinute)) throw invalid("startMinute must be an integer");
    setField("start_minute", startMinute);
  }
  if (endMinute !== undefined) {
    if (!Number.isInteger(endMinute)) throw invalid("endMinute must be an integer");
    setField("end_minute", endMinute);
  }
  if (locationId !== undefined) {
    // ★ 0497 (§5) — same staff-to-location rule the create path enforces.
    await assertWorksAtLocation(tx, { tenantId, appUserId: existing.app_user_id, locationId });
    setField("location_id", locationId);
  }
  if (videoOnly !== undefined) setField("video_only", videoOnly === true);
  if (label !== undefined) setField("label", label);

  if (sets.length === 0) throw invalid("nothing to update");

  if (onDate !== undefined || startMinute !== undefined || endMinute !== undefined) {
    const overlap = await findOverlap(tx, {
      appUserId: existing.app_user_id, onDate: finalOnDate,
      startMinute: finalStart, endMinute: finalEnd, excludeShiftId: shiftId,
    });
    if (overlap) {
      throw conflict(
        `That overlaps the ${minutesToLabel(overlap.start_minute)}–${minutesToLabel(overlap.end_minute)} shift on ${finalOnDate}.`);
    }
  }

  try {
    await tx.query(`UPDATE keystone.staff_shift SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, args);
  } catch (e) {
    const mapped = checkViolationToInvalid(e);
    if (mapped) throw mapped;
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "people.shift.changed", emittedBy: SECTION,
    subjectType: "staff_shift", subjectId: shiftId,
    actor: userActor(actorUserId),
    payload: { app_user_id: existing.app_user_id, on_date: finalOnDate, change: "updated" },
  });
  return { id: shiftId, fields: changed };
}

export async function deleteShift(tx, { tenantId, viewerId, shiftId, actorUserId }) {
  const { rows: existingRows } = await run(tx, db
    .selectFrom("keystone.staff_shift")
    .select(["app_user_id", "on_date"])
    .where("id", "=", shiftId)
    .where("tenant_id", "=", tenantId));
  const existing = existingRows[0];
  if (!existing) throw notFound("no such shift in this practice");

  if (!(await mayEditHours(tx, viewerId, existing.app_user_id))) {
    throw forbidden("You can change only your own hours.");
  }

  const r = await run(tx, db
    .deleteFrom("keystone.staff_shift")
    .where("id", "=", shiftId));
  if (r.rowCount === 0) throw notFound("no such shift in this practice");

  await emit(tx, {
    tenantId, topic: "people.shift.changed", emittedBy: SECTION,
    subjectType: "staff_shift", subjectId: shiftId,
    actor: userActor(actorUserId),
    payload: { app_user_id: existing.app_user_id, on_date: existing.on_date, change: "removed" },
  });
  return { id: shiftId };
}

/**
 * Copy every shift in `[weekStart-7, weekStart-1]` the viewer may edit to the same weekday +7 days,
 * skipping any target day/person that already has an overlapping shift.
 */
export async function copyLastWeek(tx, { tenantId, viewerId, weekStart, actorUserId }) {
  assertMondayWeekStart(weekStart);
  const priorStart = addDays(weekStart, -7);
  const priorEnd = addDays(weekStart, -1);

  const { rows: sourceShifts } = await tx.query(
    `SELECT id, app_user_id, on_date, start_minute, end_minute, location_id, video_only, label
       FROM keystone.staff_shift
      WHERE tenant_id = $1 AND on_date BETWEEN $2 AND $3
        AND keystone.user_may($4, 'engagement', 'edit', app_user_id)
      ORDER BY on_date, start_minute`,
    [tenantId, priorStart, priorEnd, viewerId]);

  let copied = 0;
  let skipped = 0;
  for (const s of sourceShifts) {
    const newOnDate = addDays(s.on_date, 7);
    const overlap = await findOverlap(tx, {
      appUserId: s.app_user_id, onDate: newOnDate,
      startMinute: s.start_minute, endMinute: s.end_minute,
    });
    if (overlap) {
      skipped += 1;
      continue;
    }
    const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
    await run(tx, db
      .insertInto("keystone.staff_shift")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        app_user_id: s.app_user_id ?? null,
        on_date: newOnDate ?? null,
        start_minute: s.start_minute ?? null,
        end_minute: s.end_minute ?? null,
        location_id: s.location_id ?? null,
        video_only: s.video_only ?? null,
        label: s.label ?? null,
        created_by: actorUserId ?? null,
      }));
    await emit(tx, {
      tenantId, topic: "people.shift.created", emittedBy: SECTION,
      subjectType: "staff_shift", subjectId: id,
      actor: userActor(actorUserId),
      payload: { app_user_id: s.app_user_id, on_date: newOnDate },
    });
    copied += 1;
  }

  return { copied, skipped };
}

export async function addTimeOff(tx, { tenantId, viewerId, appUserId, startsOn, endsOn, reason = null, actorUserId }) {
  if (!(await mayEditHours(tx, viewerId, appUserId))) {
    throw forbidden("You can change only your own hours.");
  }
  if (!isValidDateString(startsOn)) throw invalid("startsOn must be a real calendar date, as YYYY-MM-DD");
  if (!isValidDateString(endsOn)) throw invalid("endsOn must be a real calendar date, as YYYY-MM-DD");

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.time_off")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        app_user_id: appUserId ?? null,
        starts_on: startsOn ?? null,
        ends_on: endsOn ?? null,
        reason: reason ?? null,
        created_by: actorUserId ?? null,
      }));
  } catch (e) {
    const mapped = checkViolationToInvalid(e);
    if (mapped) throw mapped;
    throw e;
  }

  // ★ No `reason` text in the payload — 02 §2.4's content ban.
  await emit(tx, {
    tenantId, topic: "people.time_off.added", emittedBy: SECTION,
    subjectType: "time_off", subjectId: id,
    actor: userActor(actorUserId),
    payload: { app_user_id: appUserId, starts_on: startsOn, ends_on: endsOn },
  });
  return { id };
}

export async function removeTimeOff(tx, { tenantId, viewerId, timeOffId, actorUserId }) {
  const { rows: existingRows } = await run(tx, db
    .selectFrom("keystone.time_off")
    .select(["app_user_id", "starts_on", "ends_on"])
    .where("id", "=", timeOffId)
    .where("tenant_id", "=", tenantId));
  const existing = existingRows[0];
  if (!existing) throw notFound("no such time off in this practice");

  if (!(await mayEditHours(tx, viewerId, existing.app_user_id))) {
    throw forbidden("You can change only your own hours.");
  }

  const r = await run(tx, db
    .deleteFrom("keystone.time_off")
    .where("id", "=", timeOffId));
  if (r.rowCount === 0) throw notFound("no such time off in this practice");

  await emit(tx, {
    tenantId, topic: "people.time_off.removed", emittedBy: SECTION,
    subjectType: "time_off", subjectId: timeOffId,
    actor: userActor(actorUserId),
    payload: { app_user_id: existing.app_user_id, starts_on: existing.starts_on, ends_on: existing.ends_on },
  });
  return { id: timeOffId };
}
