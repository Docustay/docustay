// @ts-check
// D6 [TY, RULED 23 Sep 2026] — THE ONE WRITE THAT IS DELIBERATELY NOT IN `writes.mjs`.
//
// ★★★ `writes.mjs`'s own header rule is "EVERY FUNCTION HERE TAKES `tx` AND EMITS IN THE SAME
//     TRANSACTION" — a person row change is a business fact and the outbox is how the rest of the
//     system hears about it. `sidebar_collapsed` is not that: it is chrome the person left in a
//     position, the same category migration 0345's own comment puts it in ("a UI preference, not a
//     business fact"). Emitting an event for it would be a fact nobody downstream needs and a topic
//     nobody would ever subscribe to — noise in the one log an auditor reads.
// ★ Self-scoped only: the row updated is always the CALLER's own (`principal.appUserId`), never a
//   personId taken from the request body, so there is no permission question to ask beyond "is
//   somebody signed in" — the route (`POST /api/me/sidebar-collapsed`) is `crmScoped`, which already
//   answers that.

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

export async function setSidebarCollapsed(tx, { appUserId, collapsed }) {
  const { rows } = await run(tx, db
    .updateTable("keystone.app_user")
    .set({ sidebar_collapsed: Boolean(collapsed) })
    .where("id", "=", appUserId)
    .returning(["sidebar_collapsed"]));
  return { sidebarCollapsed: rows[0]?.sidebar_collapsed ?? Boolean(collapsed) };
}

// D4 [TY, RULED 23 Sep 2026] — same shape as `setSidebarCollapsed` immediately above: a UI
// preference, not a business fact, so no event is emitted and the row updated is always the
// caller's own. The CHECK constraint on `keystone.app_user.density` (migration 0346) is the
// actual guard; this only narrows the JS-side value to the same three names before it reaches SQL.
export async function setDensity(tx, { appUserId, density }) {
  if (!["compact", "comfortable", "spacious"].includes(density)) {
    throw new Error(`setDensity: "${density}" is not compact, comfortable or spacious`);
  }
  const { rows } = await run(tx, db
    .updateTable("keystone.app_user")
    .set({ density })
    .where("id", "=", appUserId)
    .returning(["density"]));
  return { density: rows[0]?.density ?? density };
}

// 13.46 [R-13.10] — same D4/D6 shape as `setDensity` immediately above: six calendar DISPLAY
// preferences, per person, no event (a display preference is not a business fact). Every field is
// optional — only the given ones are written, via one UPDATE with `COALESCE($n, column)` per field —
// and the six current values are always returned in camelCase. The CHECK constraints added by
// migration 0403 (including the cross-field `calendar_day_to_minute > calendar_day_from_minute`
// window) are the backstop; this narrows the JS-side values to the same allowed sets first, the same
// way `setDensity` narrows to its three names before either reaches SQL.
export async function setCalendarPreferences(tx, {
  appUserId,
  weekStarts,
  dayFromMinute,
  dayToMinute,
  slotMinutes,
  showCancelledDays,
  colourBy,
}) {
  if (weekStarts !== undefined && !["monday", "sunday"].includes(weekStarts)) {
    throw new Error(`setCalendarPreferences: "${weekStarts}" is not monday or sunday`);
  }
  if (slotMinutes !== undefined && ![15, 30, 60].includes(slotMinutes)) {
    throw new Error(`setCalendarPreferences: "${slotMinutes}" is not 15, 30 or 60`);
  }
  if (showCancelledDays !== undefined && ![0, 7].includes(showCancelledDays)) {
    throw new Error(`setCalendarPreferences: "${showCancelledDays}" is not 0 or 7`);
  }
  if (colourBy !== undefined && !["service", "staff", "state", "program"].includes(colourBy)) {
    throw new Error(`setCalendarPreferences: "${colourBy}" is not service, staff, state or program`);
  }
  if (dayFromMinute !== undefined &&
      !(Number.isInteger(dayFromMinute) && dayFromMinute >= 0 && dayFromMinute <= 1440)) {
    throw new Error(`setCalendarPreferences: dayFromMinute must be an integer between 0 and 1440`);
  }
  if (dayToMinute !== undefined &&
      !(Number.isInteger(dayToMinute) && dayToMinute >= 0 && dayToMinute <= 1440)) {
    throw new Error(`setCalendarPreferences: dayToMinute must be an integer between 0 and 1440`);
  }
  if (dayFromMinute !== undefined && dayToMinute !== undefined && dayToMinute <= dayFromMinute) {
    throw new Error(
      `setCalendarPreferences: dayToMinute (${dayToMinute}) must be after dayFromMinute (${dayFromMinute})`);
  }

  const { rows } = await tx.query(
    `UPDATE keystone.app_user SET
       calendar_week_starts = COALESCE($2, calendar_week_starts),
       calendar_day_from_minute = COALESCE($3, calendar_day_from_minute),
       calendar_day_to_minute = COALESCE($4, calendar_day_to_minute),
       calendar_slot_minutes = COALESCE($5, calendar_slot_minutes),
       calendar_show_cancelled_days = COALESCE($6, calendar_show_cancelled_days),
       calendar_colour_by = COALESCE($7, calendar_colour_by)
     WHERE id = $1
     RETURNING calendar_week_starts, calendar_day_from_minute, calendar_day_to_minute,
               calendar_slot_minutes, calendar_show_cancelled_days, calendar_colour_by`,
    [
      appUserId,
      weekStarts ?? null,
      dayFromMinute ?? null,
      dayToMinute ?? null,
      slotMinutes ?? null,
      showCancelledDays ?? null,
      colourBy ?? null,
    ]);
  const row = rows[0] ?? {};
  return {
    weekStarts: row.calendar_week_starts,
    dayFromMinute: row.calendar_day_from_minute,
    dayToMinute: row.calendar_day_to_minute,
    slotMinutes: row.calendar_slot_minutes,
    showCancelledDays: row.calendar_show_cancelled_days,
    colourBy: row.calendar_colour_by,
  };
}
