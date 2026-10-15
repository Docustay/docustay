// src/permissions/assertMay.mjs — Stage 7 task 7.12b. NEW FILE, owned outright by 7.12b.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHY THIS MODULE EXISTS, AND WHY IT IS NOT IN `writes.mjs`. `assertRank` (`src/routes/
//     writes.mjs:286-295`) is being retired (Q0-7 / Q7-21) and every caller outside `writes.mjs`
//     must stop calling it BEFORE `writes.mjs` may delete it — otherwise the delete is a
//     `SyntaxError` at module load and the application does not start (the whole reason task 7.12
//     split into 7.12b, first, and 7.12a, second). So the replacement helper cannot live in
//     `writes.mjs` either: 7.12a is the task that deletes things FROM `writes.mjs`, and a helper
//     declared there would be one more symbol the two tasks have to hand off through a file one of
//     them is mid-editing. This module is the neutral ground: 7.12b creates and owns it outright,
//     `src/routes/settings.mjs` (7.12b, this task) imports it today, and `src/routes/writes.mjs`
//     (7.12a, later) imports the SAME export once it lands — the two tasks never share a symbol in
//     a file either of them deletes from.
//
// ★★★ THE QUESTION THIS ANSWERS, PER `STAGE-7-PLAN.md` 7.12a FIELD 4: "assertMay resolves the row's
//     owner through `ownerExpr`/the handler's own subject id, asks `keystone.user_may($1, object,
//     verb, owner)` for a verb action, or `keystone.role_action` for a named action, and throws."
//   ★★ TWO DIFFERENT QUESTIONS, ONE ENTRY POINT. `keystone.role_action` (0190, CT-092, Q7-3) is a
//      FLAT (tenant_id, role_id, action) table — a role holds a NAMED ACTION or it does not; there
//      is no verb, no scope, no owner to resolve. `keystone.user_may` (0192) is the VERB question —
//      view/edit/delete against an OBJECT at a SCOPE, which requires the row's owner. Conflating
//      the two into one SQL call would mean inventing a scope for "may waive a charge", which is
//      exactly what Q7-3 ruled against for `role_permission` itself.
//   ★ `check.action` decides which question is asked: a member of the 13-word closed vocabulary the
//     `role_action_action_check` CHECK constraint carries (0190:70) is a NAMED ACTION; `"view"`,
//     `"edit"` or `"delete"` is a VERB. There is no third shape — an `action` that is neither throws
//     before any query runs, the same "a typo must not read as a quiet no" argument 0192 makes for
//     `keystone.user_may` itself (F294).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { forbidden } from "../http/errors.mjs";
import { OWNERSHIP, ownerExpr } from "./ownership.mjs";

/**
 * ★ THE CLOSED VOCABULARY, MIRRORED FROM `db/migrations/0190_every_practice_has_the_three_roles.sql`
 *   (`role_action_action_check`, `:70-72`). Kept as a JS constant rather than queried, exactly as
 *   `objects.mjs`'s `VERBS`/`SCOPES` are — a wrong or stale copy is caught by attempting to grant an
 *   action the database CHECK refuses, never by this module answering a typo `true`.
 */
export const NAMED_ACTIONS = Object.freeze([
  "person.create", "team.invite", "team.remove", "staff_role.change",
  "document.sign", "document.execute", "template.author",
  "record.archive", "record.restore",
  "booking.waive_charge", "discount.apply", "invoice.refund", "setting.billing",
  // ★ NEW at Stage 14 task 14.15 (migration 0416, task 14.9 — widened `role_action_action_check`
  //   to these exact two strings, verbatim; the CHECK is the authority this list mirrors).
  "loyalty.manage", "gift_card.manage",
]);

const VERB_ACTIONS = Object.freeze(["view", "edit", "delete"]);

/**
 * The owning user id for a specific ROW of `object`, resolved through `ownerExpr` — the same map
 * `src/permissions/ownership.mjs` uses for every scoped list predicate. `null` when the object is
 * ownerless (the question is answered by `scope = 'everything'` alone), when there is no existing
 * row to inherit an owner from (a CREATE — the new row has no owner yet to check against), or when
 * the object has no storage of its own yet (a "ceiling only" object, `ownerable:true` with
 * `table:null` — none of 7.12b's own four call sites reach this branch; it is here so a later
 * caller does not have to duplicate the map lookup to get the same answer this module already knows
 * how to give).
 */
async function resolveOwnerId(db, object, subjectId) {
  const meta = OWNERSHIP[object];
  if (!meta) {
    throw new Error(
      `assertMay: "${object}" is not in OWNERSHIP — the known ones are ${Object.keys(OWNERSHIP).join(", ")}.`);
  }
  if (!meta.ownable) return null;          // ownerless — 'everything' is the only scope that can carry it
  if (subjectId == null) return null;      // no existing row (a CREATE) — nothing to inherit an owner from
  if (!meta.table) return null;            // no storage yet (message/goal/referral/…) — ceiling only
  const expr = ownerExpr(object, "row");
  if (!expr) return null;
  const { rows } = await db.query(
    `SELECT ${expr} AS owner_id FROM keystone.${meta.table} row WHERE row.id = $1`,
    [subjectId]);
  return rows[0]?.owner_id ?? null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ WHICH BODY FIELD NAMES THE ROW BEING ACTED ON — F690, AND IT USED TO BE A GUESS.
 *
 *     This function used to be one expression: `check.subjectId ?? body?.id ?? null`. `body.id` is
 *     a field NO handler in this codebase reads as its subject — `updatePerson` reads `personId`,
 *     `updateAccount` reads `accountId`, `sendInstance` reads `instanceId`, `rescheduleBooking`
 *     reads `bookingId`. So the owner check resolved a row **the request was not about**, and the
 *     caller chose which one:
 *       · FORGERY — a Coach sets `id` to a client they DO own (owner check passes) while `personId`
 *         names a colleague`s client (the row actually written). In-tenant, cross-coach escalation.`
 *       · AND THE HONEST HALF FAILED TOO — with no `id` in the body, `ownerId` resolved to `null`,
 *         `scope_allows('owned', NULL, …)` is false (0070:181), so a Coach could not edit their own
 *         caseload either. One defect, both directions (F675 is the second half of F690).
 *
 * ★★★ SO THE FIELD IS DECLARED, NEVER GUESSED, AND "THERE ISN'T ONE" IS SAID OUT LOUD.
 *     `check.subject` is the NAME of the body field the HANDLER itself reads. `subject: null` is a
 *     real answer — a create, a bulk action, or a subject id that lives in a different table than
 *     the permission object's — and it resolves to `null`, which only `scope = 'everything'` can
 *     carry. What is NOT a real answer is silence: `src/routes/writes.mjs` refuses at module load
 *     for any verb route that declares neither, so the next route added cannot inherit the guess.
 *   ★★ THE SAME COLLAPSE `ownerExpr` ALREADY CLOSED (`ownership.mjs:199-214`): "I do not know" and
 *      "there is no owner" must not produce the same SQL, because one is a typo and the other is a
 *      decision.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★ Exported so `src/routes/writes.mjs`'s dispatcher decides `outOfScope`-vs-`forbidden` (05 §2b.5)
 *   from the SAME id this module checked against. A second, hand-copied expression there is exactly
 *   how the two answers would drift.
 */
export function subjectIdFor(check, body = null) {
  const explicit = check?.subjectId;
  if (explicit !== undefined && explicit !== null) return explicit;
  const field = check?.subject;
  if (field === undefined || field === null) return null;
  if (typeof field !== "string" || field === "") {
    throw new Error(
      `assertMay: check.subject must be the NAME of the body field carrying the row's id, or null ` +
      `— got ${JSON.stringify(field)}`);
  }
  return body?.[field] ?? null;
}

/**
 * ★★★ THE ENTRY POINT. Throws `forbidden(...)` on refusal; resolves with no value on success.
 *
 * @param db        the tenant-scoped connection (RLS already applies — same contract every other
 *                   query in this codebase runs under)
 * @param principal  `{ appUserId, user, ... }` — the resolved session, same shape every route
 *                   handler already receives. The viewer id is ALWAYS `principal.appUserId`, taken
 *                   from the session inside the transaction, never from the body (F494's rule,
 *                   restated here for the same reason `src/routes/writes.mjs:252`'s `args`
 *                   construction states it).
 * @param check      `{ object, action, subjectId?, subject? }` — `object` is a member of `OBJECTS`
 *                    (`src/permissions/objects.mjs`); `action` is a `NAMED_ACTIONS` member or one of
 *                    `view`/`edit`/`delete`; `subjectId`, when given, is the id of the EXISTING row
 *                    being acted on (an update/delete), used only to resolve its current owner —
 *                    omitted for a create, where there is no row yet. `subject`, when given, is the
 *                    NAME of the body field that carries that id (see `subjectIdFor` below).
 * @param body       the request body, consulted ONLY through `check.subject` — the field the
 *                    handler itself reads. It is never guessed. See `subjectIdFor`.
 */
export async function assertMay(db, principal, check, body = null) {
  const userId = principal?.appUserId ?? null;
  const action = check?.action;

  if (typeof action !== "string" || action === "") {
    throw new Error("assertMay: check.action is required");
  }

  // ── a NAMED ACTION: keystone.role_action, no owner, no scope ────────────────────────────────
  if (NAMED_ACTIONS.includes(action)) {
    const { rows } = await db.query(
      `SELECT 1
         FROM keystone.user_role ur
         JOIN keystone.role_action ra
           ON ra.role_id = ur.role_id AND ra.tenant_id = ur.tenant_id
        WHERE ur.user_id = $1 AND ra.action = $2
        LIMIT 1`,
      [userId, action]);
    if (rows.length === 0) throw forbidden(`refused: requires ${action}`);
    return;
  }

  // ── a VERB: keystone.user_may, against the row's owner ───────────────────────────────────────
  if (!VERB_ACTIONS.includes(action)) {
    throw new Error(
      `assertMay: "${action}" is neither a NAMED_ACTIONS member nor one of ${VERB_ACTIONS.join("/")}`);
  }
  const object = check?.object;
  if (typeof object !== "string" || object === "") {
    throw new Error(`assertMay: check.object is required for the verb action "${action}"`);
  }
  // ★★★ F690 — the row this request is ABOUT, taken from the field the handler itself reads.
  //     Never `body.id`, which no handler reads and every caller can set. See `subjectIdFor`.
  const subjectId = subjectIdFor(check, body);
  // ★ F775 — `self: true`: the write acts ONLY on the caller's own rows (its handler's own predicate names
  //   the session's user), so the owner asked about is the caller. Used by /api/notifications/read-all and /test.
  // ★ `createWhenNoSubject: true` — the route is BOTH "act on an existing row" and "create one" (POST /api/documents/send: `{instanceId}` or create-and-send `{personId, template}`). When the body names
  //   no existing row the write is a create, which has no owner yet: asking user_may about owner NULL is "false" for every role scoped to its own rows (scope_allows('owned', NULL) is false, 0070:181),
  //   so a Member could never create-and-send for their own client. The create is therefore asked as the caller's own, and the handler asks the sharper question itself (person:view on the person).
  //   An existing row (the field is present) keeps the ownership check, unchanged.
  const createdByCaller = check?.createWhenNoSubject === true && subjectId === null;
  const ownerId = (check?.self === true || createdByCaller)
    ? userId
    : check?.host
      ? await hostOwnerId(db, check.host, body)
      : await resolveOwnerId(db, object, subjectId);
  const { rows } = await db.query(
    "SELECT keystone.user_may($1, $2, $3, $4) AS allowed",
    [userId, object, action, ownerId]);
  if (rows[0]?.allowed !== true) throw forbidden(`refused: requires ${action} on ${object}`);
}

// ★★★ RUN-2 R1 (the maintainer, 26 Sep 2026): `Coaches can book and set their own hours — on their own calendar.`
//     The owner of a booking / availability rule / date override is its HOST (`ownership.mjs`:
//     engagement → booking.host_id; availability rides on engagement). These routes cannot name a
//     `booking` id (F690), so `check.host` names where the HOST comes from instead:
//       { field: "hostId" }                            — the body field IS the host's app_user id
//       { field: "ruleId", table: "availability_rule" } — the host of that existing rule
//     The resolved host id is handed to user_may as the owner, so a Coach (engagement: edit / owned)
//     passes exactly when host = self and is refused on a colleague's calendar. A missing or unknown
//     host resolves to null → only `everything` scope passes (the pre-R1 floor). The table is a fixed
//     allow-list — never a caller-chosen identifier.
//   ★ F775 adds `notification` → its `recipient_id`: a notification's "host" is the person it was sent to.
const HOST_TABLES = Object.freeze({
  availability_rule: Object.freeze({ table: "availability_rule", column: "host_id" }),
  notification: Object.freeze({ table: "notification", column: "recipient_id" }),
});
async function hostOwnerId(db, host, body) {
  const raw = body?.[host.field];
  if (raw === undefined || raw === null || raw === "") return null;
  if (!host.table) return raw;
  const table = HOST_TABLES[host.table];
  if (!table) throw new Error(`assertMay: check.host.table "${host.table}" is not a host-owned table`);
  const { rows } = await db.query(`SELECT ${table.column} AS host FROM keystone.${table.table} WHERE id = $1`, [raw]);
  return rows[0]?.host ?? null;
}
