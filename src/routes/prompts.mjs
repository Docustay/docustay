// src/routes/prompts.mjs — Stage 11 task 11.5: GET /api/prompts and POST /api/prompts/dismiss.
// Staff-only reads and dismissals of the prompt feed built by 11.4's engine
// (src/prompts/engine.mjs, CT-F01) on top of 11.3's catalogue. This file owns everything below
// except the query-string block noted at the GET route — that block, and the `computePrompts`
// call's argument object, belong to task 11.22 (wave 4, this stage), which adds `personId`.
//
// ★ Both routes go through the same `runTenantScoped` chain every other authenticated route does:
//   auth → tenant from the GUC → rate limit → (POST only) Idempotency-Key required and the stored
//   response replayed → savepoint → error mapping. Neither route is in `src/routes/writes.mjs`'s
//   `ROUTES` table, so `WRITE_STATUS = 201` (CT-F51) does not apply here — both answer 200.

import { forbidden, invalid } from "../http/errors.mjs";
import { computePrompts, dismissPrompt } from "../prompts/engine.mjs";
import { PROMPT_KINDS } from "../prompts/catalogue.mjs";

export function registerPromptRoutes(app, { runTenantScoped } = {}) {
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/prompts?surface=&filter= — the viewer's own prompt feed.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/prompts", (c) =>
    runTenantScoped(c, async ({ db, principal }) => {
      // ★ Staff only — a client (adult_client/minor_client) is refused, never handed an empty feed.
      if (principal?.user?.role !== "staff") throw forbidden("prompts are for staff.");
      // ★ The `/api/home` rule (routes/index.mjs's own `isOwnerOrAdmin`, M): money-kind prompts are
      //   only ever computed for an owner or admin — CT-F01 CC-2's boundary is enforced inside
      //   computePrompts by never running the money query at all, not by filtering here.
      const canSeeMoney = principal.user.staff_role === "owner" || principal.user.staff_role === "admin";

      // ★★ THE QUERY-STRING READ — ONE NAMED BLOCK, kept contiguous because task 11.22 (wave 4,
      //   this stage) owns exactly this block: it adds `personId` here and nothing else in this
      //   file. Do not split it or interleave other logic between these three lines.
      const q = c.req.query();
      const surface = q.surface ?? "feed";
      const filter = q.filter ?? "everything";
      const personId = q.personId ?? null;
      const result = await computePrompts(db, {
        viewerId: principal.appUserId, canSeeMoney, surface, filter, personId,
        viewerStaffRole: principal.user.staff_role ?? null,
      });

      let summary = null;
      if (surface === "feed") {
        const totalCount = result.prompts.length;
        const moneyCount = result.prompts.filter((p) => PROMPT_KINDS[p.kind]?.money).length;

        const numberWord = (n) => {
          const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
          return words[n] || n.toString();
        };

        const totalWord = numberWord(totalCount);
        const summaryBase = `${totalWord} ${totalCount === 1 ? "thing" : "things"}, oldest first.`;
        if (moneyCount > 0) {
          const moneyWord = numberWord(moneyCount);
          summary = `${summaryBase} ${moneyWord} ${moneyCount === 1 ? "is" : "are"} about money.`;
        } else {
          summary = summaryBase;
        }
      }

      const response = { prompts: result.prompts, total: result.total, moreCount: result.total - result.prompts.length };
      if (summary !== null) response.summary = summary;
      return response;
    }, { bucket: "home" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // POST /api/prompts/dismiss {kind, subjectId?} — dismiss one prompt for the viewer.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/prompts/dismiss", (c) =>
    runTenantScoped(c, async ({ db, principal, body, tenantId }) => {
      if (principal?.user?.role !== "staff") throw forbidden("prompts are for staff.");
      const canSeeMoney = principal.user.staff_role === "owner" || principal.user.staff_role === "admin";

      if (!body || typeof body !== "object") throw invalid("a JSON object body is required");
      if (!body.kind || typeof body.kind !== "string") throw invalid("kind is required and must be a string");

      const result = await dismissPrompt(db, {
        tenantId,
        viewerId: principal.appUserId,
        canSeeMoney,
        kind: body.kind,
        subjectId: body.subjectId ?? null,
      });

      return result;
    }, { bucket: "write" }).then((r) => c.json(r, 200)));
}
