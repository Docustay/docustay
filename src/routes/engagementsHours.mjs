// TASK 13.22 — WORKING HOURS AS ONE SAVE, AND THE G20 QUEUE. Route half — THE READ ONLY.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ★★★ CT-F51 — WHY THIS FILE HAS NO POST, AND WHY THAT IS RIGHT, NOT A GAP. `POST /api/
//     engagements/hours` is a `src/routes/writes.mjs` ROUTES-table entry (task 13.27a: `{ path: "/api/
//     engagements/hours", section: "/engagements/calendar", fn: setWeekHours, subject: null }`), wired
//     through `registerWriteRoutes` — the loop that answers `WRITE_STATUS = 201` on every one of its
//     entries (`src/routes/writes.mjs:657,907`). This file registers a route of its own, in its OWN
//     file — CT-F51's other half: "a route registered elsewhere... answers 200" — and the ONLY route
//     it registers is the GET read. 13.22's own field 9 acceptance scenario states the POST's 201
//     comes from the ROUTES table entry 13.27a adds, not from a route in this file; nothing here
//     duplicates or shadows that path.
// ★ MOUNTED BY TASK 13.27b: `registerHoursRoutes(app, { runTenantScoped })` in `src/http/app.mjs`,
//   next to `registerCalendarRoutes`. Not mounted here — `app.mjs` is not in this task's file list.
// ★ WHAT CALLS THIS: `HoursDialog` (task 13.29, `DialogHours.frame.html`) reads the current week
//   through this GET before rendering the seven rows, and its Save posts to the ROUTES-table entry
//   above. Until 13.29/13.27a/13.27b land this route exists and is mountable but nothing in the
//   product calls it yet — named here rather than left silent, per the "built and wired to nothing"
//   failure class this project has shipped before.
//
// ★★★ THE SAME "OWN ONLY / OWNER-ADMIN ANY" SHAPE `src/routes/calendar.mjs`'s `resolveHostId` uses
//     for `CalendarBusy`/the team remote-changes read — NOT a copy of that function's body. Reading it
//     while building this one found it BROKEN, on two independent axes, neither touched here (out of
//     this task's file list — reported, not fixed): (1) it reads `ctx.req.query(...)`, but
//     `runTenantScoped`'s handler receives `{ db, c, principal, body, tenantId }` — there is no `req`
//     key on that object (`src/http/app.mjs:857`; `src/routes/scheduling.mjs:43` correctly uses
//     `ctx.c.req.query(...)`), so `ctx.req` is `undefined` and `.query()` throws before permission is
//     even checked; (2) `atLeastRank` THROWS on refusal and returns nothing on success
//     (`src/nav/authorise.mjs:164-171`), so `if (!atLeastRank(...))` is backwards — a caller who DOES
//     hold the required rank still hits the `throw forbidden(...)` inside that `if`, because a
//     successful call's return value is `undefined`, and `!undefined` is `true`. `resolveHostId` below
//     calls `atLeastRank` as the bare statement its own doc says to, and reads the query param off
//     `ctx.c.req`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { atLeastRank } from "../nav/authorise.mjs";
import { readHours } from "../booking/hours.mjs";
import { explainSlot } from "../booking/read.mjs";
import { policyFor, removeDateOverride, setHostDailyCap } from "../booking/writes.mjs";
import { invalid } from "../http/errors.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function registerHoursRoutes(app, { runTenantScoped }) {
  /** ★ `?hostId=` — self by default; Owner/Admin may pass another coach`s id (plan field 4: "coach:`
   *  own only; owner/admin: any"), the same authority `atLeastRank(user,'admin')` already gives them
   *  everywhere else in this file's sibling routes. */
  function resolveHostId(ctx) {
    const requested = ctx.c.req.query("hostId");
    if (!requested || requested === ctx.principal.appUserId) return ctx.principal.appUserId;
    atLeastRank(ctx.principal.user, "admin");   // throws forbidden if the caller is not admin+
    return requested;
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/engagements/hours?hostId=  — plan field 4's one named route.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/hours", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "member");   // staff floor — a client never reaches this route
      const hostId = resolveHostId(ctx);
      return readHours(ctx.db, { tenantId: ctx.tenantId, hostId });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Stage 20 — GET /api/engagements/availability/overview?hostId=&from=&to=
  //   Everything the availability screen shows on one page: the week, the days that are different
  //   (date overrides), time off, and the limits that shape what is offered.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/availability/overview", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "member");
      const hostId = resolveHostId(ctx);
      const from = c.req.query("from");
      const to = c.req.query("to");
      if (from && !ISO_DATE.test(from)) throw invalid("from must be YYYY-MM-DD");
      if (to && !ISO_DATE.test(to)) throw invalid("to must be YYYY-MM-DD");
      const week = await readHours(ctx.db, { tenantId: ctx.tenantId, hostId });
      const { rows: overrides } = await ctx.db.query(
        `SELECT to_char(on_date, 'YYYY-MM-DD') AS "onDate", is_available AS "isAvailable",
                start_minute AS "startMinute", end_minute AS "endMinute", reason
           FROM keystone.date_override
          WHERE tenant_id = $1 AND host_id = $2
            AND on_date >= coalesce($3::date, current_date)
            AND ($4::date IS NULL OR on_date <= $4::date)
          ORDER BY on_date`,
        [ctx.tenantId, hostId, from ?? null, to ?? null]);
      const { rows: timeOff } = await ctx.db.query(
        `SELECT id, to_char(starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(ends_on, 'YYYY-MM-DD') AS "endsOn", reason
           FROM keystone.time_off
          WHERE tenant_id = $1 AND app_user_id = $2
            AND ends_on >= coalesce($3::date, current_date)
            AND ($4::date IS NULL OR starts_on <= $4::date)
          ORDER BY starts_on`,
        [ctx.tenantId, hostId, from ?? null, to ?? null]);
      const { rows: limit } = await ctx.db.query(
        `SELECT max_per_day FROM keystone.host_booking_limit WHERE tenant_id = $1 AND host_id = $2`,
        [ctx.tenantId, hostId]);
      // Practice-level limits (no service): what a service without its own rules gets.
      const p = await policyFor(ctx.db, ctx.tenantId, null);
      const { rows: tz } = await ctx.db.query(`SELECT timezone FROM keystone.tenant WHERE id = $1`, [ctx.tenantId]);
      // For the explainer's service picker — what can actually be booked.
      const { rows: services } = await ctx.db.query(
        `SELECT id, name, duration_minutes AS "durationMinutes" FROM keystone.service
          WHERE tenant_id = $1 AND active AND bookable ORDER BY name`, [ctx.tenantId]);
      // Owner/Admin may look at anyone`s week; a coach sees only their own, so gets no picker.`
      let hosts = null;
      try {
        atLeastRank(ctx.principal.user, "admin");
        const { rows } = await ctx.db.query(
          `SELECT id, display_name AS "displayName" FROM keystone.app_user
            WHERE tenant_id = $1 AND role = 'staff' AND lifecycle_status <> 'former' ORDER BY display_name`,
          [ctx.tenantId]);
        hosts = rows;
      } catch { hosts = null; }
      return {
        hostId, timeZone: tz[0]?.timezone ?? "UTC", services, hosts,
        week: week.days, overrides, timeOff,
        limits: {
          maxPerDay: limit[0]?.max_per_day ?? null,
          minimumNoticeMinutes: p.minimum_notice_minutes,
          startIntervalMinutes: p.start_interval_minutes,
          bookingWindowDays: p.booking_window_days,
        },
      };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Stage 20 — GET /api/engagements/availability/explain?hostId=&date=&time=HH:MM&serviceId=
  //   "Why isn't 2pm showing?" — answered by the same code that decides what is shown.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/availability/explain", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "member");
      const hostId = resolveHostId(ctx);
      const date = c.req.query("date");
      const time = c.req.query("time");
      const serviceId = c.req.query("serviceId") || null;
      if (!date || !ISO_DATE.test(date)) throw invalid("date must be YYYY-MM-DD");
      if (!time || !/^\d{1,2}:\d{2}$/.test(time)) throw invalid("time must be HH:MM");
      return explainSlot(ctx.db, { hostId, date, time, serviceId });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Stage 20 — POST /api/engagements/date-overrides/remove {hostId?, onDate}
  //           POST /api/engagements/availability/limit {hostId?, maxPerDay|null}
  //   Row scope is asked INSIDE the write (`assertMayEditHost`) — coach own, admin any.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/engagements/date-overrides/remove", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "member");
      const body = ctx.body ?? {};
      const hostId = body.hostId || ctx.principal.appUserId;
      return removeDateOverride(ctx.db, {
        tenantId: ctx.tenantId, hostId, onDate: body.onDate, actorUserId: ctx.principal.appUserId,
      });
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  app.post("/api/engagements/availability/limit", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "member");
      const body = ctx.body ?? {};
      const hostId = body.hostId || ctx.principal.appUserId;
      if (!("maxPerDay" in body)) throw invalid("maxPerDay is required (a number, or null for no limit)");
      return setHostDailyCap(ctx.db, {
        tenantId: ctx.tenantId, hostId, maxPerDay: body.maxPerDay, actorUserId: ctx.principal.appUserId,
      });
    }, { bucket: "write" }).then((r) => c.json(r, 200)));
}
