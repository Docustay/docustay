// @ts-check
// P1.6 — THE GUARDIAN RELATION: THE WRITE PATH, AND THE RECIPIENT LIST.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TWO CODE PATHS DECIDE WHETHER A PARENT SEES SOMETHING, AND THEY ARE NOT THE SAME CODE.
//     1. **VISIBILITY** — `keystone.document_is_visible()` (0074). Answers "may they open it?"
//     2. **NOTIFICATION** — this module's `notifiableGuardiansOf()`. Answers "do we TELL them?"
//
//   ★★★ AND THE SESSION-NOTE RULE IS ENFORCED SEPARATELY IN BOTH. It is not inherited, because
//       nothing inherits it: a notification is composed in the WORKER, far from any document read,
//       and the keystone-spec-check says exactly why that matters — *"push is composed in the
//       worker, far from any UI, which is exactly why it gets missed."*
//   ★★ The failure this prevents is concrete and is worse than a leaked read: a parent who cannot
//      OPEN a session note, receiving a push that says *"A new session note for Maya: 'discussed
//      self-harm'"*. The document stayed private and the notification published it.
//     → `notifiableGuardiansOf(tx, childId, { isSessionNote: true })` returns **[]**, always.
//
// ★★ EVERY WRITE EMITS. Linking a guardian changes who can read a child's paperwork, which is an
//    occurrence and not a state. Under `people.` — a guardian is a fact about people, and 0064
//    established that a new `emitted_by` value costs a migration.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit } from "../events/outbox.mjs";
// ★★★ TASK 8.13 — `linkGuardian`/`unlinkGuardian`'s own imports. `invalid` maps the two role
//     refusals (spec 04 §7.4) to a real 400 instead of the unexported `GuardianViolation` below,
//     which has never had a caller that could turn it into one (its own comment: "P7 gives it one
//     when a route maps it to a 400" — this task is that route, but reached through these two new
//     functions, which check role and self-linking BEFORE ever calling `addGuardian`, so that class
//     stays exactly as every other task left it). `assertMay` is the SAME entry point
//     `/api/people/update` already goes through for `person`/`edit` — see `linkGuardian`'s own
//     comment for why it is called explicitly, here, rather than relying on the WRITE_ROUTES row's
//     own coarse gate.
import { invalid } from "../http/errors.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★ NOT EXPORTED — no caller catches this type yet; P7 gives it one when a route maps it to a 400.
 *   Third time this decision has been made this phase (`OWNERLESS_OBJECTS`, `TeamViolation`): a
 *   gate-only importer makes an orphan look wired, which is `F133`.
 */
class GuardianViolation extends Error {
  constructor(message) { super(message); this.name = "GuardianViolation"; }
}

/** Link a guardian to a child. */
export async function addGuardian(tx, { tenantId, guardianUserId, childUserId, relationship = "parent", actorId = null }) {
  if (!tenantId || !guardianUserId || !childUserId) {
    throw new GuardianViolation("addGuardian requires tenantId, guardianUserId and childUserId");
  }
  if (guardianUserId === childUserId) {
    // ★ The database refuses this too (`guardian_not_self`). Refused here as well so the message is
    //   for a person rather than a constraint name — the same split as every other writer in P1.
    throw new GuardianViolation("a person cannot be their own guardian");
  }

  const { rows } = await tx.query(
    `INSERT INTO keystone.guardian (tenant_id, guardian_user_id, child_user_id, relationship, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, guardian_user_id, child_user_id) DO NOTHING
     RETURNING guardian_user_id`,
    [tenantId, guardianUserId, childUserId, relationship, actorId]);

  // ★ Already linked is not an error and not an event — same rule as grantRole/addTeamMember. An
  //   audit log full of changes that did not happen is an audit log nobody reads.
  if (rows.length === 0) return { alreadyLinked: true };

  await emit(tx, {
    tenantId,
    topic: "people.guardian.linked",
    emittedBy: "people",
    subjectType: "person",
    subjectId: childUserId,
    // ★★ STAGE 3 TASK 3 FIX 1, REVIEW M2 — `relationship` DROPPED, NOT ENUMERATED. Migration 0074 made
    //    it free text on purpose ("the legal vocabulary varies by jurisdiction, nothing BRANCHES on this
    //    value"), so an enum here would overrule a recorded decision. Free text may not ride in an event
    //    (§2.4) — "legal guardian" made emit() refuse and rolled the link back. It stays on the row.
    payload: { guardianUserId, actorId },
  });
  return { alreadyLinked: false };
}

/** Unlink a guardian. */
export async function removeGuardian(tx, { tenantId, guardianUserId, childUserId, actorId = null }) {
  if (!tenantId || !guardianUserId || !childUserId) {
    throw new GuardianViolation("removeGuardian requires tenantId, guardianUserId and childUserId");
  }
  const { rows } = await tx.query(
    `DELETE FROM keystone.guardian
      WHERE tenant_id = $1 AND guardian_user_id = $2 AND child_user_id = $3
      RETURNING guardian_user_id`,
    [tenantId, guardianUserId, childUserId]);

  if (rows.length === 0) return { wasLinked: false };

  await emit(tx, {
    tenantId,
    topic: "people.guardian.unlinked",
    emittedBy: "people",
    subjectType: "person",
    subjectId: childUserId,
    payload: { guardianUserId, actorId },
  });
  return { wasLinked: true };
}

/** Everyone linked as a guardian of this child. ★ One hop — see 0074. */
export async function guardiansOf(tx, childUserId) {
  if (!childUserId) return [];
  const { rows } = await run(tx, db
    .selectFrom("keystone.guardian as g")
    .innerJoin("keystone.app_user as u", "u.id", "g.guardian_user_id")
    .select([
      sql`g.guardian_user_id as id`,
      "g.relationship",
      "u.display_name",
      "u.email"
    ])
    .where("g.child_user_id", "=", childUserId)
    .orderBy("u.display_name"));
  return rows;
}

/** The children this person is a guardian of. */
export async function childrenOf(tx, guardianUserId) {
  if (!guardianUserId) return [];
  const { rows } = await run(tx, db
    .selectFrom("keystone.guardian as g")
    .innerJoin("keystone.app_user as u", "u.id", "g.child_user_id")
    .select([
      sql`g.child_user_id as id`,
      "g.relationship",
      "u.display_name",
      "u.email"
    ])
    .where("g.guardian_user_id", "=", guardianUserId)
    .orderBy("u.display_name"));
  return rows;
}

/**
 * ★★★ WHO MAY BE TOLD about something concerning this child.
 *
 * @param isSessionNote  is the thing being announced a session note?
 *
 * ★★★ THE SESSION-NOTE BRANCH IS THE POINT OF THIS FUNCTION AND IT IS NOT AN OPTIMISATION.
 *     `document_is_visible()` already refuses a parent a session note — but a NOTIFICATION is not a
 *     read. It carries a title, and a title is content. A parent who cannot open the note but
 *     receives *"New session note for Maya"* has been told something the document rule refused them,
 *     by a code path that never consulted the document rule.
 *   ★★ So this returns **[]**, and it does so BEFORE the query rather than filtering after —
 *      there is no arrangement of guardians for which the answer is anything else.
 *
 * ★ REQUIRED, NOT DEFAULTED. `isSessionNote` has no default value on purpose: a caller that forgets
 *   it gets a loud throw, not a silent fan-out. The alternative — defaulting to `false` — makes
 *   forgetting the safe-looking thing the dangerous one.
 */
export async function notifiableGuardiansOf(tx, childUserId, { isSessionNote } = {}) {
  if (typeof isSessionNote !== "boolean") {
    throw new GuardianViolation(
      "notifiableGuardiansOf requires isSessionNote: true|false — a notification about a session " +
      "note must never reach a guardian, and defaulting that question would make forgetting it silent");
  }
  if (isSessionNote) return [];
  return guardiansOf(tx, childUserId);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ TASK 8.13 — THE WRITE-ROUTE CALLERS. `src/routes/writes.mjs` gives these two rows in
//     `WRITE_ROUTES` — `POST /api/people/guardian`, `POST /api/people/guardian/remove` — CT-060.
//     `addGuardian`/`removeGuardian` above are UNCHANGED; these wrap them with the role checks spec
//     04 §7.4 requires, plus the scope check below.
//
// ★★★ WHY THE SCOPE CHECK IS ASKED HERE, EXPLICITLY, AND NOT LEFT TO THE ROW'S OWN `object`/`action`.
//     The wire body is `{ childUserId, guardianUserId, relationship? }` (CT-060) — it carries no
//     `id`. `src/routes/writes.mjs`'s own coarse gate resolves a row's owner ONLY from `body.id`
//     (`:467`, `assertMay.mjs:127`), so a static `object`/`action` on the ROUTES row could never see
//     WHICH child this request names, and a Coach — whose `person`/`edit` grant is `owned`, never
//     `everything` (`db/migrations/0190…:185`, mirrored `src/permissions/defaults.mjs:84`) — would
//     either be refused unconditionally (subjectId always null) or, worse, let through
//     unconditionally for every child in the tenant, if the row asked a scope-blind question
//     instead. So the ROUTES row's own gate is the NAMED ACTION `person.create` (owner, admin AND
//     coach all hold it, `db/migrations/0190…:229-231`) — "is this the kind of role that may touch a
//     person record at all" — and the REAL, per-child question is asked here, a second time, against
//     the SAME `person`/`edit` grant `/api/people/update` already enforces, with the real subject.
//     Same "coarse route gate, sharper in-module check on the SAME real permission" idiom
//     `assertMayInviteAsRole` uses for task 8.12 (`src/routes/writes.mjs:374-380`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `/api/people/guardian`'s handler (task 8.13). Refuses when the child's `role` is not
 * `'adolescent_client'` (spec 04 §7.4 — a guardian link is for a teen record), when the guardian's
 * `role` is not `'parent'`, or when the two ids are the same person (the database also refuses
 * this, `guardian_not_self` — refused here too so the message is for a person, not a constraint
 * name, the same split `addGuardian` itself already makes). Then asks whether `actorUserId` may
 * `edit` THIS `person` (the child) — Owner/Admin always clear it (`scope: everything`); a Coach
 * clears it only when the child is on their own caseload (`app_user.owner_user_id`,
 * `ownership.mjs:33`). Only then does it call `addGuardian`.
 *
 * Returns `{ linked: boolean }` — `false` when the edge already existed (`addGuardian`'s own
 * `ON CONFLICT DO NOTHING`), because reporting `true` for a no-op is a lie the screen would repeat.
 */
export async function linkGuardian(tx, { tenantId, childUserId, guardianUserId,
                                          relationship = "parent", actorUserId = null }) {
  if (!tenantId || !childUserId || !guardianUserId) {
    throw invalid("linkGuardian requires tenantId, childUserId and guardianUserId");
  }
  if (guardianUserId === childUserId) {
    throw invalid("a person cannot be their own guardian");
  }

  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["id", "role"])
    .where("tenant_id", "=", tenantId)
    .where(sql`id = ANY(${sql.val([childUserId, guardianUserId])}::uuid[])`));
  const child = rows.find((r) => r.id === childUserId);
  const guardian = rows.find((r) => r.id === guardianUserId);
  if (!child || child.role !== "adolescent_client") {
    throw invalid("a guardian link is for a teen record — the child must be an adolescent_client");
  }
  // ★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role` value; a guardian is any `adult_client`.
  //   Whether they end up with the Parent TAG is this very link existing, not a role check.
  if (!guardian || guardian.role !== "adult_client") {
    throw invalid("the guardian named must be an adult client");
  }

  await assertMay(tx, { appUserId: actorUserId }, { object: "person", action: "edit", subjectId: childUserId });

  const result = await addGuardian(tx, { tenantId, guardianUserId, childUserId, relationship, actorId: actorUserId });
  return { linked: !result.alreadyLinked };
}

/**
 * `/api/people/guardian/remove`'s handler (task 8.13) — the mirror of `linkGuardian`, over
 * `removeGuardian`. CCR-9: revoke is a real DELETE (`keystone.guardian` has no `id`, no
 * `revoked_at`); the history lives in `people.guardian.unlinked`, not a column. Same scope check as
 * `linkGuardian` — a Coach may only unlink a guardian from a child on their own caseload.
 *
 * Returns `{ unlinked: boolean }` — `false` when there was nothing to remove.
 */
export async function unlinkGuardian(tx, { tenantId, childUserId, guardianUserId, actorUserId = null }) {
  if (!tenantId || !childUserId || !guardianUserId) {
    throw invalid("unlinkGuardian requires tenantId, childUserId and guardianUserId");
  }

  await assertMay(tx, { appUserId: actorUserId }, { object: "person", action: "edit", subjectId: childUserId });

  const result = await removeGuardian(tx, { tenantId, guardianUserId, childUserId, actorId: actorUserId });
  return { unlinked: result.wasLinked };
}
