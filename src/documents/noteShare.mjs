// @ts-check
// Stage 14 task 14.39 — G29 · SHARE AND UNSHARE A SESSION NOTE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIS IS A DISCLOSURE BOUNDARY, NOT A FEATURE FLAG. Migration 0420 gave
//     `keystone.document_instance` two nullable columns — `shared_with_client_at`, `shared_by` —
//     and made `keystone.document_is_visible`'s non-staff branch read them: the note's own SUBJECT
//     reads it if, and only if, `shared_with_client_at IS NOT NULL` (`0420:179-181`). This module is
//     the ONLY writer of those two columns. Nothing else in the codebase sets them.
//
// ★★★ WHO SUPPLIES THE CONDITION THE READ PATH CHECKS. `shareNote` below, called from a staff
//     session through `POST /api/notes/:id/share` / `.../unshare` — never a GUC, never a test-only
//     setting. The read path (`document_is_visible`, invoked by `document_instance`'s own
//     `tenant_isolation` SELECT policy, `0011`/`0420`) reads exactly the row this function wrote.
//
// ★★★ SHARING NEVER MUTATES THE NOTE'S WORDS. This function's only UPDATE touches
//     `shared_with_client_at`/`shared_by` — never `template_body_snapshot`, `title`, or any other
//     column an executed instrument's own immutability (U25, `executeInstance`) already protects.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { ports } from "./ports.mjs";
import { invalid, notFound, forbidden } from "../http/errors.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "documents";

/**
 * SHARE (or UNSHARE) one session note with its own subject.
 *
 * ★ THE FIRST SELECT IS THE VISIBILITY GATE, AND IT IS RLS, NOT A HAND-WRITTEN CHECK.
 *   `document_instance`'s SELECT policy is `tenant_id = current_tenant_id() AND
 *   document_is_visible(document_instance.*)` (0011/0194/0420) — so a row this actor cannot already
 *   see (wrong tenant, a colleague's note under a caseload they don't hold, an archived instance)
 *   simply does not come back, and a nonexistent id looks identical. Both become `notFound()`: the
 *   same enumeration-oracle discipline every other document read in this codebase already keeps.
 *
 * ★ THE SECOND CHECK IS SHARE-SPECIFIC AND NARROWER THAN "CAN SEE IT". A coach's `note` grant is
 *   `none` by default (F584) — the writer and the subject's own assigned coach (`owner_user_id`)
 *   read a note through 0388's staff-branch disjuncts (`created_by`/`owner_user_id`/team-wide),
 *   never through a `note` permission row. So SHARING is permitted for exactly three parties: the
 *   note's own writer, the subject's assigned coach, or anyone holding a real `note`/`edit` grant
 *   (the Owner, by default) — asked here, in-module, rather than at the route with a static
 *   `assertMay(note, edit)` that would refuse the writer and the assigned coach both.
 *
 * @param tx           a pg client inside the caller's tenant transaction.
 * @param tenantId     the acting tenant — used only for the emitted event's envelope.
 * @param instanceId   the document_instance id to share/unshare.
 * @param share        true to share, false to unshare (revoke).
 * @param actorUserId  the acting staff app_user id.
 * @returns {Promise<{id: string, shared_with_client_at: string|null}>}
 */
export async function shareNote(tx, { tenantId, instanceId, share, actorUserId }) {
  if (typeof share !== "boolean") {
    throw invalid("share must be true or false");
  }

  const { rows } = await tx.query(
    `SELECT di.id, di.created_by, di.subject_user_id, dt.is_session_note
       FROM keystone.document_instance di
       JOIN keystone.document_type dt ON dt.id = di.type_id
      WHERE di.id = $1`,
    [instanceId]);
  if (rows.length === 0) throw notFound();
  // the subject's assigned coach is the host's fact (people port), not a Documents table
  const inst = { ...rows[0], owner_user_id: rows[0].subject_user_id ? await (await ports()).people.ownerOf(tx, rows[0].subject_user_id) : null };

  // ★ Only a SESSION NOTE can be shared this way — an ordinary document already has its own
  //   audience/assigned_to visibility rule (0194/0420, unchanged) and never needed a per-row toggle.
  if (!inst.is_session_note) {
    throw invalid("Only a session note can be shared this way.");
  }

  // ★★ THE THREE-WAY OR, RESTATED FROM THE MODULE HEADER. `created_by`/`owner_user_id` are read
  //    straight off the row this SELECT already fetched — no second query for the common case.
  let permitted = inst.created_by !== null && inst.created_by === actorUserId;
  if (!permitted) {
    permitted = inst.owner_user_id !== null && inst.owner_user_id === actorUserId;
  }
  if (!permitted) {
    const { rows: mayRows } = await tx.query(
      `SELECT keystone.user_may($1, 'note', 'edit', NULL) AS allowed`, [actorUserId]);
    permitted = mayRows[0]?.allowed === true;
  }
  if (!permitted) throw forbidden();

  // ★ `CASE WHEN $2 THEN … END` with no ELSE is NULL on the false branch — sharing sets both
  //   columns, unsharing clears both, and `share_pair`'s CHECK (0420) keeps them paired either way.
  const { rows: updated } = await tx.query(
    `UPDATE keystone.document_instance
        SET shared_with_client_at = CASE WHEN $2 THEN now() END,
            shared_by             = CASE WHEN $2 THEN $3::uuid END
      WHERE id = $1
      RETURNING shared_with_client_at`,
    [instanceId, share, actorUserId]);

  // ★★★ THE PAYLOAD IS `{}`. NO NOTE BODY, NO EXCERPT, NOT EVEN A TITLE — the blocked list (notes
  //     among it) never leaves the platform, not even in metadata. A subscriber to this topic can
  //     say "a note was shared", never what is in it.
  await emit(tx, {
    tenantId,
    topic: share ? "documents.note.shared" : "documents.note.unshared",
    emittedBy: SECTION,
    subjectType: "document",
    subjectId: instanceId,
    actor: userActor(actorUserId),
    payload: {},
  });

  return { id: instanceId, shared_with_client_at: updated[0].shared_with_client_at };
}
