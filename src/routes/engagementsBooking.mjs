// TASK 13.25 — THE BOOKING SETTINGS / ONLINE / RULES / HISTORY READS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CT-F51 — WHY EVERY ROUTE HERE ANSWERS 200, NOT 201. These are GETs, registered in THIS file,
//     not entries in `src/routes/writes.mjs`'s `ROUTES` table — CT-F51's own rule: "Every route
//     registered elsewhere... answers 200. `/api/app/*` routes are correctly 200 — they use a
//     different helper." `writes.mjs:657` freezes `WRITE_STATUS = 201` for its OWN `ROUTES` loop
//     only (MEASURED); nothing here goes through that loop, and none of these five routes write
//     anything — `runTenantScoped`'s default `status` option is 200 and none of the five overrides
//     it. Same shape as the sibling read file `src/routes/engagementsHours.mjs`'s own header note.
//
// ★ MOUNTED BY TASK 13.27b: `registerBookingReadRoutes(app, { runTenantScoped })` in
//   `src/http/app.mjs`, next to `registerCalendarRoutes` — not mounted here, `app.mjs` is not in
//   this task's file list.
// ★ WHAT CALLS EACH ROUTE (named rather than left silent — "built and wired to nothing" §1):
//     `booking-settings`  → 13.39 (hub + calendar leaf + turn-off modal), 13.40 (paying/cancelling leaf)
//     `online-booking`    → 13.36 (online booking + service-rules screens)
//     `service-rules`     → 13.36 (the same screen's override matrix)
//     `sending-matrix`    → 13.41 (the "what we send" leaf)
//     `booking-history`   → 13.42 (the booking history leaf)
//   None of those five screen tasks has landed as of this task — each is named so a reader can
//   check it directly rather than assume.
//
// ★★ OWNER/ADMIN ONLY, EVERY ROUTE. `atLeastRank(user, 'admin')` throws `forbidden` (403) for a
//    coach, a client and a parent alike — there is no "owned only" branch to get wrong here,
//    because nobody below admin reaches any handler below at all. A booking history names who was
//    seen and when (the sensitive one, `src/booking/history.mjs`'s own header); refusing at the
//    floor is simpler and safer than trying to scope it per viewer.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { atLeastRank } from "../nav/authorise.mjs";
import {
  readBookingSettings, readOnlineBooking, readServiceRules, sendingMatrix,
} from "../booking/settingsSummary.mjs";
import { readBookingHistory } from "../booking/history.mjs";

export function registerBookingReadRoutes(app, { runTenantScoped }) {
  const requireAdmin = (ctx) => atLeastRank(ctx.principal.user, "admin");

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/engagements/booking-settings
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/booking-settings", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      return readBookingSettings(ctx.db, { tenantId: ctx.tenantId });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/engagements/online-booking
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/online-booking", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      return readOnlineBooking(ctx.db, { tenantId: ctx.tenantId });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/engagements/service-rules
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/service-rules", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      return readServiceRules(ctx.db, { tenantId: ctx.tenantId });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/engagements/sending-matrix — pure, no database (`sendingMatrix()`'s own header).
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/sending-matrix", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      return sendingMatrix();
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/engagements/booking-history?from&to&what&who&staff
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/booking-history", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      const q = ctx.c.req.query();
      return readBookingHistory(ctx.db, {
        tenantId: ctx.tenantId,
        from: q.from || null,
        to: q.to || null,
        what: q.what || null,
        who: q.who || null,
        staff: q.staff || null,
      });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));
}
