// STAGE 13 TASK 13.23 — GET /api/engagements/calendar-range. specs/features/plans/STAGE-13-PLAN.md
// §13.23. The wire only — `src/booking/calendarRead.mjs` (this same task) does the composition.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NOT IN `src/routes/writes.mjs`'s `ROUTES` table, so CT-F51's `WRITE_STATUS = 201` does not
//     apply here — this is registered in its own file, the same shape `src/routes/scheduling.mjs`
//     documents at its own top ("Not in writes.mjs's ROUTES table … these answer the ordinary 200
//     runTenantScoped already defaults to"). This route is also a GET, so 200 is doubly expected —
//     confirmed by reading `src/routes/writes.mjs`, not assumed.
//
// ★★★ THE CONTEXT SHAPE IS `{ db, c, principal, body, tenantId }` — THERE IS NO `ctx.req`.
//     `runTenantScoped` hands handlers exactly that object (`src/http/app.mjs:857`); the Hono
//     request is reached as `ctx.c.req`, the same idiom `src/routes/scheduling.mjs:43` and
//     `src/routes/calendar.mjs:330` already use. `ctx.req.query(...)` is the live bug fixed in
//     `calendar.mjs` an hour before this task — not reproduced here.
//
// ★★★ `atLeastRank` THROWS ON REFUSAL AND RETURNS `undefined` ON SUCCESS — IT IS NOT A PREDICATE.
//     Called here for its throw, as a bare statement, never inside `if (!atLeastRank(...))` — that
//     inversion is the exact live bug `calendar.mjs`'s `resolveHostId` just shipped and was fixed
//     for (`!undefined` is `true` precisely when the caller DOES hold the rank).
//
// ★★★ TEAM READ IS OPEN TO ANY STAFF RANK, NOT ONLY OWNER/ADMIN. F05 §4: "Staff: own calendar +
//     team read." This task's own field 4 repeats it: "coach own host AND team read of others …
//     full names, never a price." So the ONE floor below is `atLeastRank(user,'coach')` — no
//     second, narrower check on `hostId` beyond it. The only thing rank narrows further is MONEY:
//     `priceMinor` is present only when the caller is admin/owner (checked separately, below, and
//     never conflated with the read floor itself).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid } from "../http/errors.mjs";
import { atLeastRank } from "../nav/authorise.mjs";
import { readCalendarRange } from "../booking/calendarRead.mjs";

export function registerCalendarRangeRoutes(app, { runTenantScoped }) {
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/engagements/calendar-range?from=YYYY-MM-DD&to=YYYY-MM-DD&hostId=<uuid|all>
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/calendar-range", (c) =>
    runTenantScoped(c, async (ctx) => {
      // ★ Staff-only registrar (this task's own field 9: "Client → 403"). Throws forbidden for a
      //   client/parent session, and for a platform principal (no `.user` on it → effectiveRank
      //   null → refused, fail-closed).
      atLeastRank(ctx.principal.user, "member");

      const from = ctx.c.req.query("from");
      const to = ctx.c.req.query("to");
      if (!from || !to) throw invalid("calendar-range needs both 'from' and 'to' (YYYY-MM-DD)");
      // ★ Missing hostId defaults to the caller's own calendar, never 'all' — a bare request should
      //   not silently pull the whole team's names/state.
      const hostIdParam = ctx.c.req.query("hostId") || ctx.principal.appUserId;

      // ★ Money gate — see file header. Caught narrowly: `atLeastRank` throws `forbidden` and
      //   nothing else, so this catch cannot swallow an unrelated failure.
      let canSeePrice = true;
      try {
        atLeastRank(ctx.principal.user, "admin");
      } catch {
        canSeePrice = false;
      }

      return readCalendarRange(ctx.db, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.principal.appUserId,
        hostIdParam,
        fromDate: from,
        toDate: to,
        canSeePrice,
      });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));
}
