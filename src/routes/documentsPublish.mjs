// Stage 14 task 14.36 — TEMPLATE SETTINGS, STARTERS ROUTE, PUBLISH AND VERSIONS — THE WIRE.
//
// §0.4 B: `PUBLISH_WRITES` is a frozen array of `{ path, section, fn, object, action }` rows, spread
// into `src/routes/writes.mjs`'s `ROUTES` table by task 14.41 (`registerItemsAndDocumentsRoutes`) —
// CT-F51: rows spread into `writes.mjs`'s `ROUTES` answer 201. `registerPublishReads` is a GET this
// file owns and 14.41 mounts directly — registered elsewhere, so it answers 200 (`runTenantScoped`'s
// own default), matching every other read in this stage (`itemsCatalogue.mjs`'s pattern).
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.36's
//     file list. `PUBLISH_WRITES` is inert until 14.41 spreads it into `ROUTES`, and
//     `registerPublishReads` is inert until 14.41 calls it. Reported here, not silently left unwired.
//
// ★★★ R-14.2 / THE STARTERS ROUTE. `POST /api/documents/starters` calls `seedStarterTemplate`
//     DIRECTLY — that is what field 4 of this task names, so it is built exactly as named. TODAY,
//     as of this diff, it is UNREACHABLE: nothing in this file's ROUTES row list is spread into
//     `writes.mjs`'s `ROUTES` until 14.41 lands, and nothing else in this diff calls
//     `seedStarterTemplate` or adds a migration that inserts a starter row — R-14.2 ("built here,
//     NOT seeded until the maintainer has read it") holds today for exactly that reason: the route has no path
//     to being called at all yet. ★★ ONCE 14.41 MOUNTS IT, THAT STOPS BEING TRUE: any staff member
//     holding `template.author` (Owner, Admin, or a coach granted it) would be able to seed
//     "Coaching agreement" / "Teen coaching agreement" into a live practice by calling this route,
//     with no additional gate in front of it beyond that one permission — the same permission that
//     already gates authoring any other template. Stated plainly rather than silently worked around:
//     this task was told to build exactly what field 4 says, and did; whether that route should stay
//     reachable once mounted, given R-14.2, is a decision for the mount step (14.41) or the deploy
//     gate, not something this task invented a bypass for on its own initiative.

import { invalid, forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { setTemplateSettings, publishPreview, publishTemplate } from "../documents/publish.mjs";
import { seedStarterTemplate } from "../documents/starterTemplates.mjs";

const SECTION = "/documents";

// ★ Same guard, same regex, `src/routes/notes.mjs:27` / `src/routes/itemsEditors.mjs:26` — a
//   malformed `:id` fails this shape check instead of reaching Postgres as an invalid uuid literal.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ★★★ `PUBLISH_WRITES` — frozen `{ path, section, fn, object, action }` rows, exactly
 *     `src/routes/writes.mjs:443-454`'s shape for the other `template.author` rows. `template.author`
 *     is a NAMED_ACTIONS member (`src/permissions/assertMay.mjs:43`), so NO `subject`/`subject: null`
 *     is declared — declaring one on a named-action row trips `assertVerbRoutesDeclareASubject`
 *     (`writes.mjs`'s own rule, restated at its `merge`/`merge/undo` rows, `:262-267`): a named
 *     action asks a flat role question with no owner to resolve, so a `subject` field would be read
 *     by nothing.
 */
export const PUBLISH_WRITES = Object.freeze([
  { path: "/api/documents/templates/settings", section: SECTION, fn: setTemplateSettings,
    object: "document", action: "template.author" },
  { path: "/api/documents/templates/publish",  section: SECTION, fn: publishTemplate,
    object: "document", action: "template.author" },
  // ★ R-14.2 — see header. A CREATE (no existing template row), so no subject either way.
  { path: "/api/documents/starters",           section: SECTION, fn: seedStarterTemplate,
    object: "document", action: "template.author" },
]);

/** GET /api/documents/templates/:id/publish-preview — the counts-first modal's numbers. */
export function registerPublishReads(app, { runTenantScoped, tenantIsPlatform } = {}) {
  app.get("/api/documents/templates/:id/publish-preview", (c) => {
    const templateId = c.req.param("id");
    if (!UUID_RE.test(templateId)) {
      const e = invalid("template id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    return runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "document", action: "template.author" });

      const data = await publishPreview(db, { tenantId, templateId });
      return { data };
    }, { bucket: "documents" }).then((r) => c.json(r));
  });
}
