// 12.3 — SCHEDULING ROUTES. The week read, shift writes, copy-last-week, time off.
//
// ★ Same guard idiom as `src/routes/locations.mjs`/`src/routes/payerGroups.mjs`: staff only, plus
//   `authoriseSection` on `/people/scheduling` — the nav row for that path is added by 12.35, so
//   until it lands every request here answers 403 `unknown_path`. That is the described dependency
//   order (STAGE-12-PLAN.md 12.3 field 10 "Needs"), not a defect in this file.
// ★ Not in `src/routes/writes.mjs`'s `ROUTES` table, so CT-F51's `WRITE_STATUS = 201` does not
//   apply here — these answer the ordinary 200 `runTenantScoped` already defaults to (matches
//   12.3's field 9 acceptance scenario, which states 200 on every write below).

import { forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import {
  readSchedule, createShift, updateShift, deleteShift, copyLastWeek, addTimeOff, removeTimeOff,
} from "../people/scheduling.mjs";

const SECTION_PATH = "/people/scheduling";

export function registerSchedulingRoutes(app, { runTenantScoped, tenantIsPlatform }) {
  /**
   * ★ Wrapper matching `locations.mjs`'s shape — runs `fn` inside the tenant transaction and
   *   answers JSON. Staff-only AND `authoriseSection` are common to EVERY route here (the plan's
   *   own words: "every route: staff only + authoriseSection(user,'/people/scheduling',…)"); the
   *   finer "own hours only" check is `mayEditHours`, inside each write in `src/people/scheduling.mjs`.
   */
  const guarded = (fn) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.user?.role || ctx.principal.user.role !== "staff") {
        throw forbidden("scheduling is for staff only");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, SECTION_PATH, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) {
        throw forbidden("access to scheduling requires access to the /people/scheduling section");
      }
      return fn(ctx);
    }).then((r) => c.json(r));

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/people/scheduling?week=YYYY-MM-DD — the week read.
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/people/scheduling", guarded(async (ctx) => {
    const weekStart = ctx.c.req.query("week");
    return readSchedule(ctx.db, { viewerId: ctx.principal.appUserId, weekStart });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/people/scheduling/shifts — create.
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/people/scheduling/shifts", guarded(async (ctx) => {
    const body = ctx.body || {};
    return createShift(ctx.db, {
      tenantId: ctx.tenantId,
      viewerId: ctx.principal.appUserId,
      appUserId: body.appUserId,
      onDate: body.onDate,
      startMinute: body.startMinute,
      endMinute: body.endMinute,
      locationId: body.locationId ?? null,
      videoOnly: body.videoOnly === true,
      label: body.label ?? null,
      actorUserId: ctx.principal.appUserId,
    });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/people/scheduling/shifts/:id — update. Every field optional.
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/people/scheduling/shifts/:id", guarded(async (ctx) => {
    const shiftId = ctx.c.req.param("id");
    const body = ctx.body || {};
    const patch = {
      tenantId: ctx.tenantId, viewerId: ctx.principal.appUserId, shiftId,
      actorUserId: ctx.principal.appUserId,
    };
    if ("onDate" in body) patch.onDate = body.onDate;
    if ("startMinute" in body) patch.startMinute = body.startMinute;
    if ("endMinute" in body) patch.endMinute = body.endMinute;
    if ("locationId" in body) patch.locationId = body.locationId;
    if ("videoOnly" in body) patch.videoOnly = body.videoOnly;
    if ("label" in body) patch.label = body.label;
    return updateShift(ctx.db, patch);
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/people/scheduling/shifts/:id/delete
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/people/scheduling/shifts/:id/delete", guarded(async (ctx) => {
    const shiftId = ctx.c.req.param("id");
    return deleteShift(ctx.db, {
      tenantId: ctx.tenantId, viewerId: ctx.principal.appUserId, shiftId,
      actorUserId: ctx.principal.appUserId,
    });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/people/scheduling/copy-last-week {weekStart}
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/people/scheduling/copy-last-week", guarded(async (ctx) => {
    const body = ctx.body || {};
    return copyLastWeek(ctx.db, {
      tenantId: ctx.tenantId, viewerId: ctx.principal.appUserId, weekStart: body.weekStart,
      actorUserId: ctx.principal.appUserId,
    });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/people/scheduling/time-off — add.
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/people/scheduling/time-off", guarded(async (ctx) => {
    const body = ctx.body || {};
    return addTimeOff(ctx.db, {
      tenantId: ctx.tenantId,
      viewerId: ctx.principal.appUserId,
      appUserId: body.appUserId,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      reason: body.reason ?? null,
      actorUserId: ctx.principal.appUserId,
    });
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/people/scheduling/time-off/:id/delete
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/people/scheduling/time-off/:id/delete", guarded(async (ctx) => {
    const timeOffId = ctx.c.req.param("id");
    return removeTimeOff(ctx.db, {
      tenantId: ctx.tenantId, viewerId: ctx.principal.appUserId, timeOffId,
      actorUserId: ctx.principal.appUserId,
    });
  }));
}
