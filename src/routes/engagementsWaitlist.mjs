// Task 13.13 — THE WAITLIST ROUTES: staff reads, client demand.
// Plan: specs/features/plans/STAGE-13-PLAN.md §13.13. Engine: src/booking/waitlist.mjs (13.12,
// NOT rebuilt or edited here). Staff WRITE routes (`POST /api/engagements/waitlist`, `/remove`,
// `/offer`) are added to `src/routes/writes.mjs`'s `ROUTES` table by 13.27a, which imports
// `addToWaitlist`/`removeFromWaitlist`/`offerTime` straight from `src/booking/waitlist.mjs` — this
// task states those three handler names (STAGE-13-PLAN.md §13.13 field 4) and does not touch
// `src/routes/writes.mjs` (field 5). `offerTime` and `removeFromWaitlist` therefore have NO CALLER
// from this file — they stay uncalled in application code until 13.27a registers those routes; see
// this task's own build report for the full accounting.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A WAITLIST IS A LIST OF NAMED PEOPLE, AND THAT IS THE DISCLOSURE RISK. The staff read below
//     (`GET /api/engagements/waitlist`) may show names because the VIEWER is staff looking at their
//     own/practice's queue. The CLIENT-facing routes in `src/routes/app.mjs` never return another
//     person's name, position or even the fact that a specific named person is waiting — only
//     COUNTS (`waitingForSamePreference`), which cross the boundary a client does not otherwise
//     hold, exactly as this task's own dispatch states: "Counts, never names, across any boundary a
//     viewer does not hold."
// ★★★ SCOPE IS DECIDED SERVER-SIDE, EVERY REQUEST. `GET /api/engagements/waitlist` restricts a
//     Coach (`staff_role = 'coach'`) to `host_id = self OR host_id IS NULL` — never another coach's
//     named rows. Owner/Admin see everything. `demand-summary` is COUNTS ONLY (no display_name, no
//     email, no client_user_id in its shape) so it is not host-scoped by viewer identity — a coach
//     asking "how many people want evenings" for the whole practice is the F14 feature itself, and a
//     count crossing a coach boundary discloses nothing a name would.
// ★ `atLeastRank` (`src/nav/authorise.mjs`) THROWS on refusal and returns `undefined` on success —
//   it is called for its throw, as a bare statement, never wrapped in `if (!atLeastRank(...))`
//   (src/routes/calendar.mjs's own header explains the bug that shape produces).
// ★ TIME: `offered_starts_at` is the real UTC instant already stored on the entry; this file does no
//   wall-clock arithmetic of its own — that lives in `preferenceMatches`/`offerTime` (13.12).
// ★ they/them throughout: `app_user` carries no reliable gender column.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { atLeastRank } from "../nav/authorise.mjs";
import { PREFERENCES } from "../booking/waitlist.mjs";
import { invalid } from "../http/errors.mjs";

/** The closed status vocabulary (0314's CHECK), so an unrecognised `?status=` is refused, not silently empty. */
const STATUSES = Object.freeze(["waiting", "offered", "claimed", "expired", "removed"]);

export function registerWaitlistRoutes(app, { runTenantScoped }) {
  /** ★ The one floor every route here shares — same idiom as bookingLinks.mjs/calendar.mjs. */
  const requireCoach = (ctx) => atLeastRank(ctx.principal.user, "member");

  /**
   * A Coach only ever sees their own host_id (or an unassigned row); Owner/Admin see everything.
   * Returned as a single nullable uuid param so the SQL stays one `OR` clause rather than two code
   * paths: `null` means "no restriction" (Owner/Admin), a uuid means "this host, or unassigned".
   */
  const scopeHostId = (ctx) =>
    ctx.principal.user.staff_role === "member" ? ctx.principal.appUserId : null;

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/engagements/waitlist?status=waiting — the Waitlist screen's list + F14's demand line.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/waitlist", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      const status = ctx.c.req.query("status") || "waiting";
      if (!STATUSES.includes(status)) {
        throw invalid(`status must be one of ${STATUSES.join(", ")}`);
      }
      const hostScope = scopeHostId(ctx);

      const { rows } = await ctx.db.query(
        // ★★★ `serviceId` AND `hostId` ARE SELECTED, AND THAT IS NOT COSMETIC (added 25 Sep 2026).
        //     This SELECT returned only the joined DISPLAY NAMES, so 13.34's "Offer a time" had no
        //     ids to post: it had to fetch the services and team lists separately and match each
        //     row back by NAME. ★★ That is wrong the moment a practice has two coaches called
        //     "Sam", or renames a service — the offer silently resolves to the wrong one, or to
        //     nothing. The ids were one line away in the row the query already had in hand.
        //   ★ 13.34 found it from the screen end and correctly did not edit this file (its task
        //     said "not to touch: server"); it documented the workaround in its own header instead.
        //     That workaround can now be retired by whoever next owns `WaitlistScreen.svelte`.
        `SELECT e.id, e.display_name AS "displayName", e.preference,
                e.preference_note AS "preferenceNote",
                e.service_id AS "serviceId", s.name AS "serviceName",
                e.host_id AS "hostId", h.display_name AS "hostName",
                e.created_at AS "createdAt",
                e.status, e.kind, e.offered_starts_at AS "offeredStartsAt"
           FROM keystone.booking_waitlist_entry e
           -- ★ Joined on TENANT as well as id, the idiom the rest of this codebase uses, rather
           --   than leaning on RLS alone to keep a join inside one practice (the same correction
           --   B-31 made in calendarRead.mjs). Behaviour is identical today; the difference is
           --   that it stays identical if a policy is ever relaxed.
           -- ★★ NO BACKTICKS IN THIS COMMENT, ON PURPOSE. It lives inside a JS template literal,
           --    so a backtick ENDS THE STRING. I broke this exact file this way, and it is the
           --    third time tonight (see B-24, B-31) -- node --check caught all three.
           JOIN keystone.service s
             ON s.tenant_id = e.tenant_id AND s.id = e.service_id
           LEFT JOIN keystone.app_user h
             ON h.tenant_id = e.tenant_id AND h.id = e.host_id
          WHERE e.tenant_id = $1 AND e.status = $2
            AND ($3::uuid IS NULL OR e.host_id = $3 OR e.host_id IS NULL)
          ORDER BY e.position ASC`,
        [ctx.tenantId, status, hostScope]);

      // ★ Summary is ALWAYS status='waiting', regardless of the `status` filter above (F14's own
      //   sentence, "three people want evenings", is about who is CURRENTLY waiting) — scoped by the
      //   SAME host boundary as the rows in this same response, never wider than what this viewer
      //   already sees named above.
      const { rows: prefRows } = await ctx.db.query(
        `SELECT preference, count(*)::int AS n
           FROM keystone.booking_waitlist_entry
          WHERE tenant_id = $1 AND status = 'waiting'
            AND ($2::uuid IS NULL OR host_id = $2 OR host_id IS NULL)
          GROUP BY preference`,
        [ctx.tenantId, hostScope]);
      const byPreference = {};
      for (const p of PREFERENCES) byPreference[p] = 0;
      let waiting = 0;
      for (const r of prefRows) { byPreference[r.preference] = r.n; waiting += r.n; }

      return { rows, summary: { waiting, byPreference } };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/engagements/waitlist/demand-summary?hostId= — COUNTS ONLY, F14 §2.4's own shape:
  // { evenings, mornings, weekends, flexible, specific }. Never a name, never a client_user_id.
  // Not host-scoped by VIEWER identity (see the file header) — `hostId` here is an optional FILTER
  // the caller chooses, not a permission boundary; the shape it returns carries no name either way.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/engagements/waitlist/demand-summary", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireCoach(ctx);
      const hostId = ctx.c.req.query("hostId") || null;

      const { rows } = await ctx.db.query(
        `SELECT preference, count(*)::int AS n
           FROM keystone.booking_waitlist_entry
          WHERE tenant_id = $1 AND status = 'waiting'
            AND ($2::uuid IS NULL OR host_id = $2)
          GROUP BY preference`,
        [ctx.tenantId, hostId]);

      const out = {};
      for (const p of PREFERENCES) out[p] = 0;
      for (const r of rows) out[r.preference] = r.n;
      return out;
    }, { bucket: "api" }).then((r) => c.json(r, 200)));
}
