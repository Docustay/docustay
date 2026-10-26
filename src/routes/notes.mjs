// Stage 14 task 14.39 — G29 · NOTE SHARE ROUTES.
//
// §0.4 B: `/api/notes` holds no table rows of its own — it registers its own two POSTs directly,
// the `src/routes/tasks.mjs:20-60` shape, rather than a `<NAME>_WRITES` row spread into
// `src/routes/writes.mjs`'s `ROUTES` table. Gated at the `/people` nav section, with NO static
// `assertMay(note, edit)` — `shareNote` (`../documents/noteShare.mjs`) asks its own, narrower,
// in-module permission question (writer OR the subject's assigned coach OR a real `note`/`edit`
// grant), because a coach's static `note` grant is `none` (F584) and a section-level `assertMay`
// would refuse the very writer this route exists for.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.39's
//     file list. `registerNoteRoutes` below is inert until 14.41 (`registerItemsAndDocumentsRoutes`)
//     calls it. Reported here, not silently left unwired.
//
// ★ CT-006 — both routes declare `status: 201` explicitly (never the `runTenantScoped` default of
//   200), matching this task's own field 9. `withIdempotency` stores and replays exactly this value.

import { invalid, forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { shareNote } from "../documents/frontDoor.mjs";

const SECTION = "/people";

// ★ Same guard, same regex, `src/routes/itemsEditors.mjs:26` / `src/routes/index.mjs:134` — a
//   malformed `:id` fails this shape check instead of reaching Postgres as an invalid uuid literal
//   (SQLSTATE 22P02, which `toAppError` does not map, so it would otherwise surface as a raw 500).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function registerOne(app, { path, share, runTenantScoped, tenantIsPlatform }) {
  app.post(path, (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      const e = invalid("note id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    return runTenantScoped(c, async ({ db, principal, tenantId }) => {
      // ★★★ AUTHORISE BEFORE ANY WRITE, ON THE SERVER, EVERY TIME — the section floor only.
      //     `shareNote` itself asks the real, narrower permission question; a static object/action
      //     check here would refuse the writer (F584 — a coach's `note` grant is `none`).
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);

      return shareNote(db, {
        tenantId, instanceId: id, share, actorUserId: principal?.appUserId ?? null,
      });
    }, { bucket: "documents", status: 201 }).then((r) => c.json(r, 201));
  });
}

/**
 * POST /api/notes/:id/share, POST /api/notes/:id/unshare.
 * `{ id: instanceId, shared_with_client_at }` — `shared_with_client_at` is an ISO timestamp after a
 * share and `null` after an unshare (the UPDATE's own `CASE … END` with no ELSE).
 */
export function registerNoteRoutes(app, { runTenantScoped, tenantIsPlatform } = {}) {
  registerOne(app, { path: "/api/notes/:id/share",   share: true,  runTenantScoped, tenantIsPlatform });
  registerOne(app, { path: "/api/notes/:id/unshare", share: false, runTenantScoped, tenantIsPlatform });
}
