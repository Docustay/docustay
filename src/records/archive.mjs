// @ts-check
// P2.9 — ARCHIVE, NOT DELETE. THE WRITER.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHY THERE IS ONE WRITER AND NOT NINE. Property 5 — delete or archive, and WHICH, and WHY — was
//     decided for NONE of the six objects, and the three pieces of machinery that existed all did
//     nothing: a `people.person.archived` topic with no producer, a `document_instance.deleted`
//     column read in twelve places and written in none, and a DELETE policy no code path called.
//   ★★ Nine per-object archive functions would re-derive the same decision nine times and diverge
//      the same way the seven duplicated labels did (P4.10). **The decision is the module.**
//
// ★★★ AND ARCHIVING IS A DOMAIN EVENT, NOT A FLAG FLIP. "A write with no event is a silent state
//     change" (§X4.1). A departed client disappearing from every list with nothing in the feed to
//     say why is exactly the shape a practice cannot audit — and the topic to emit it has existed,
//     unused, since P15B.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { isQaLoginUid, QA_LOGIN_REFUSAL } from "../auth/qaLogins.mjs";
import { emit, userActor, SUBJECT_TYPE_ALIASES } from "../events/outbox.mjs";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { revokeSessionsForUser } from "../auth/session.mjs";
import { normaliseReason, keepReason } from "../events/reasons.mjs";
import { returnCreditForBooking } from "../money/credits.mjs";
import { asPracticeOwner } from "../money/asPracticeOwner.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★★★ THE OBJECTS THAT CAN BE ARCHIVED, EACH WITH THE SECTION AND TOPIC ITS EVENT BELONGS TO.
 *
 * ★★ `emit()` REFUSES A CROSS-SECTION TOPIC (P15B.3), so this map is not decoration: a booking's
 *    archival is `booking`'s fact and an invoice's is `money`'s, and getting that wrong is a refusal
 *    rather than a mislabelled row.
 * ★ The topic strings are checked against the closed catalogue at module load by the gate, in both
 *   directions — an object here with no topic, and a topic here nothing emits, are both findings.
 */
export const ARCHIVABLE = Object.freeze({
  person:        { table: "app_user",          section: "people",    topic: "people.person.archived" },
  account:       { table: "account",           section: "accounts",  topic: "accounts.account.archived" },
  network_party: { table: "network_party",     section: "network",   topic: "network.party.archived" },
  booking:       { table: "booking",           section: "booking",   topic: "booking.booking.archived" },
  invoice:       { table: "invoice",           section: "money",     topic: "money.invoice.archived" },
  service:       { table: "service",           section: "items",     topic: "items.service.archived" },
  plan:          { table: "plan",              section: "items",     topic: "items.plan.archived" },
  // ★ Programs follow-up brief (30 Sep 2026, Part 9) — package gets archived_at/archived_by in
  //   migration 0544 (pending), so it can join this registry the same way service/plan already do.
  package:       { table: "package",           section: "items",     topic: "items.package.archived" },
  subscription:  { table: "subscription",      section: "money",     topic: "money.subscription.archived" },
  document:      { table: "document_instance", section: "documents", topic: "documents.document.archived" },   // TODO(ISLAND §2): = DOCUMENTS_DOMAIN.archivable once the api.mjs -> lists/_shared.mjs -> archive.mjs import cycle is cut
});

export const ARCHIVABLE_TYPES = Object.freeze(Object.keys(ARCHIVABLE));

const entryFor = (object) => {
  const e = ARCHIVABLE[object];
  // ★★★ AN UNKNOWN OBJECT THROWS — F163, one item ago, and the same reasoning. A lookup that falls
  //     back on a name it does not recognise collapses "I do not know this" into "this is not
  //     archivable", and one of those is a typo while the other is a decision.
  if (!e) {
    throw invalid(
      `"${object}" cannot be archived — the archivable objects are ${ARCHIVABLE_TYPES.join(", ")}`);
  }
  return e;
};

/**
 * ★★★ F789 — ARCHIVE REFUSES WHILE SOMETHING DEPENDS ON THE RECORD, RATHER THAN CASCADING.
 *     Ruling: refuse, never cascade — archiving a service with sessions booked next week says how
 *     many and does nothing, rather than silently orphaning (or worse, cancelling) those bookings.
 * ★ One query per object, checked BEFORE the UPDATE so a refusal changes nothing. `account`,
 *   `network_party` and `document` have no dependents to check.
 */
async function assertNoLiveDependents(tx, { tenantId, object, id }) {
  if (object === "service") {
    const { rows } = await tx.query(
      `SELECT count(*)::int AS n
         FROM keystone.booking
        WHERE tenant_id = $1 AND service_id = $2
          AND state <> 'cancelled' AND starts_at > now()`,
      [tenantId, id]);
    const n = rows[0].n;
    if (n > 0) {
      throw conflict(`${n} upcoming sessions use this service. Move or cancel them first.`);
    }
    return;
  }

  if (object === "person") {
    // ★ Open invoices first, then subscriptions still owing, then bookings — HOST checked before
    //   CLIENT, because a host with sessions gets a different instruction (Offboard) than a client.
    const invoices = await tx.query(
      `SELECT count(*)::int AS n FROM keystone.invoice_effective
        WHERE tenant_id = $1 AND payer_user_id = $2 AND status = 'open'`,
      [tenantId, id]);
    if (invoices.rows[0].n > 0) {
      throw conflict("Void or settle this person's open invoices before archiving them.");
    }

    const subs = await tx.query(
      `SELECT count(*)::int AS n FROM keystone.subscription_effective
        WHERE tenant_id = $1 AND app_user_id = $2 AND state IN ('active','past_due')`,
      [tenantId, id]);
    if (subs.rows[0].n > 0) {
      throw conflict("Cancel this person's subscription before archiving them.");
    }

    const hostBookings = await tx.query(
      `SELECT count(*)::int AS n FROM keystone.booking
        WHERE tenant_id = $1 AND host_id = $2
          AND state <> 'cancelled' AND starts_at > now()`,
      [tenantId, id]);
    if (hostBookings.rows[0].n > 0) {
      throw conflict("Use Offboard to remove a team member with sessions.");
    }

    const clientBookings = await tx.query(
      `SELECT count(*)::int AS n
         FROM keystone.booking b
         JOIN keystone.booking_participant bp ON bp.booking_id = b.id
        WHERE b.tenant_id = $1 AND bp.app_user_id = $2 AND bp.party = 'client'
          AND b.state <> 'cancelled' AND b.starts_at > now()`,
      [tenantId, id]);
    const n = clientBookings.rows[0].n;
    if (n > 0) {
      throw conflict(`${n} upcoming sessions are booked for this person. Move or cancel them first.`);
    }
    return;
  }

  if (object === "subscription") {
    const { rows } = await tx.query(
      `SELECT state FROM keystone.subscription_effective WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]);
    if (rows.length > 0 && rows[0].state !== "cancelled") {
      throw conflict("Cancel this subscription before archiving it.");
    }
    return;
  }

  if (object === "invoice") {
    const { rows } = await tx.query(
      `SELECT status FROM keystone.invoice_effective WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]);
    if (rows.length > 0 && rows[0].status === "open") {
      throw conflict("Void or settle this invoice before archiving it.");
    }
    return;
  }

  if (object === "plan") {
    const { rows } = await tx.query(
      `SELECT count(*)::int AS n FROM keystone.subscription_effective
        WHERE tenant_id = $1 AND plan_id = $2 AND state = 'active'`,
      [tenantId, id]);
    const n = rows[0].n;
    if (n > 0) {
      throw conflict(`${n} active subscriptions use this plan. Cancel or move them first.`);
    }
    return;
  }

  if (object === "booking") {
    // ★ Not a refusal — archiving a booking releases its reserved credit (if any) and proceeds.
    await returnCreditForBooking(tx, { tenantId, bookingId: id });
    return;
  }

  // account, network_party, document — no check.
}

/**
 * Archive a record. It stays; it stops appearing in day-to-day lists.
 *
 * ★★ IDEMPOTENT BY REFUSAL, NOT BY SILENCE. Archiving something already archived is a 404-shaped
 *    refusal rather than a quiet success, because the caller believes it is changing something and
 *    a silent no-op would emit a SECOND event for one fact. `zero rows = refusal` — F52's shape.
 */
export async function archiveRecord(tx, { tenantId, object, id, actorUserId = null, reason = null }) {
  if (!tenantId) throw invalid("archiveRecord requires a tenantId");
  if (!id) throw invalid("archiveRecord requires the id of the record to archive");
  const e = entryFor(object);
  // ★ R46 — validated BEFORE the UPDATE, so a refused (over-long) reason changes nothing.
  const keptReason = normaliseReason(reason);

  // ★★★ F789 — REFUSE WHILE SOMETHING DEPENDS ON THE RECORD, BEFORE THE UPDATE.
  // ★ R18 (RECONCILE) — the dependents are counted as the practice OWNER, not through the actor's
  //   own RLS view: an actor who may archive a person but not view their invoices used to see "0 open
  //   invoices" and archive them anyway. Same tx; asViewer restores the actor's viewer afterwards.
  await asPracticeOwner(tx, tenantId, () => assertNoLiveDependents(tx, { tenantId, object, id }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ FIX ROUND 1, I5 / F494 — `archived_by` NOW COMES ONLY FROM THE SESSION.
  //     [MEASURED, review] this function used to destructure `actorId` — a name `routes/writes.mjs`
  //     never stamps (it stamps `actorUserId`, always last, from `principal.appUserId`). So the ONLY
  //     way `actorId` was ever non-null was a caller's JSON body naming it — any request could claim
  //     `archived_by` was whoever it liked, and the audit trail believed it.
  //   ★★ THE FIX RENAMES THE PARAMETER, NOT JUST ITS SOURCE. A body that still sends `actorId` is not
  //     rejected with an error naming the field (that would just tell an attacker what to rename); it
  //     is silently ignored, because this function no longer reads a key by that name at all — the
  //     only value that ever reaches `archived_by` is `actorUserId`, stamped by `routes/writes.mjs`
  //     AFTER the body is spread, which is what makes it authoritative (see that file's own comment).
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★ No `tenant_id` predicate written by hand: FORCE RLS applies it, and a second isolation
  //   mechanism is the one that drifts. The table name comes from the frozen map, never the caller.
  // ★★ `app_user` additionally returns the firebase uid, because archiving a PERSON has to reach
  //    their live sessions — see below. The column exists on no other archivable table, so it is
  //    selected only for that one rather than coalesced into a shape every table must have.
  // ★ F865 — the QA sign-in accounts are never archived (src/auth/qaLogins.mjs)
  if (e.table === "app_user") {
    const who = (await tx.query(`SELECT firebase_uid FROM keystone.app_user WHERE id = $1`, [id])).rows[0];
    if (isQaLoginUid(who?.firebase_uid)) throw conflict(QA_LOGIN_REFUSAL);
  }
  const { rows } = await tx.query(
    `UPDATE keystone.${e.table}
        SET archived_at = now(), archived_by = $2
      WHERE id = $1 AND archived_at IS NULL
      RETURNING id${e.table === "app_user" ? ", firebase_uid" : ""}`,
    [id, actorUserId]);

  if (rows.length === 0) {
    throw notFound(
      `no ${object} ${id} is available to archive here — either it does not exist in this practice, ` +
      `or it is archived already`);
  }

  const archivedEvent = await emit(tx, {
    tenantId, topic: e.topic, emittedBy: e.section,
    // ★★★ STAGE 3 TASK 2 — MAPPED THROUGH THE SAME VOCABULARY, NOT A LOCAL SPECIAL CASE. This used
    //     to be a hand-rolled `object === "document" ? "document" : object` ternary — the ONE call
    //     site that already spelled the document literal correctly, by accident, while every other
    //     document-lifecycle event in the product wrote `document_instance` (F474). `ARCHIVABLE`'s
    //     keys (`person`, `document`, …) are already every one of `SUBJECT_TYPES`'s 9 History
    //     names, so this alias lookup is a no-op today — it exists so archive/restore reads from
    //     the SAME map migration 0136 and every other writer read from, rather than re-deriving the
    //     one correction §2 rule 3 makes, a second time, by hand.
    subjectType: SUBJECT_TYPE_ALIASES[object] ?? object,
    subjectId: id,
    // ★ FIX ROUND 1, I5 — the envelope's `actor` is the same session id as `archived_by`, never a
    //   body-supplied one.
    actor: userActor(actorUserId),
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ STAGE 3 TASK 3 — `reason` DROPPED FROM THE PAYLOAD. §2.4's ruling: no free-text reasons
    //     in an event, ever. "Why was this archived" is arbitrary text a caller may supply (a
    //     departed client's own words, an operator's note) and has no closed enum — unlike
    //     `booking.entitlement.exhausted`'s `reason: "expired"`, there is no small fixed vocabulary
    //     to fold this into. It is RELOCATED, not dropped: see `keepReason` just below (R46).
    //   ★ `archived_by` stays: it is the actor's own id, already duplicated on the envelope's
    //     `actor` field, and an id is not the typed text this rule is about.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    payload: { archived_by: actorUserId },
  });
  // ★★★ FIX ROUND 1, R46 — THE REASON IS KEPT, NOT LOST. ArchiveControl asks "Why are you archiving
  //     this?" and says it is recorded; it now is — in `keystone.record_reason` (0140), same transaction,
  //     joined to this event by id. Staff History and the audit log read it back; the payload never
  //     carries it (§2.4). `createdBy` is the session actor only (F494).
  await keepReason(tx, {
    tenantId, eventId: archivedEvent.id, subjectType: SUBJECT_TYPE_ALIASES[object] ?? object,
    subjectId: id, kind: "archive", reason: keptReason, createdBy: actorUserId,
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ ARCHIVING A PERSON ENDS THEIR SESSIONS — IN THAT PRACTICE, NOT EVERYWHERE.
  //
  //   0096 stops an archived person OBTAINING a session. That is only half the door: [MEASURED,
  //   P2 CLOSE §VISUAL] a revoke has existed since P0.7 and used to be called from exactly two
  //   places — a tenancy change and an explicit logout. **Archiving called neither**, so a
  //   departed client holding a live session kept full access and nothing expired it early.
  //   ★ Without both halves, "retire this person" means "hide them from lists", which is not what
  //     the operator clicking it believes.
  //
  // ★★★ 6.15 — MOVED FROM THE BY-UID REVOKE TO THE PRACTICE-SCOPED ONE (spec 04 §3 default 5).
  //     `revokeSessionsForUid` ends every session everywhere, in every practice that person
  //     belongs to — right for a tenancy change, wrong here: archiving a person in practice A must
  //     not sign them out of practice B, where they are not archived. `revokeSessionsForUid` stays
  //     exported for that other use; this call is now `revokeSessionsForUser` (6.6), keyed on
  //     `tenant_id` and `app_user_id`, both of which the archive already has.
  // ★★ NOW INSIDE `tx`, WHERE IT USED TO BE ON ITS OWN CONNECTION — A REAL CHANGE OF TRANSACTION
  //    SEMANTICS. `revokeSessionsForUid` took its own connection precisely because it was
  //    uid-scoped and cross-practice: committing independently meant a later rollback cost only an
  //    unnecessary interruption (fail toward LESS access), never a stale live session anywhere.
  //    `revokeSessionsForUser` cannot take that shape — 6.4's function checks the tenant GUC
  //    (`current_setting('keystone.tenant_id', true)`), which is only set on the transaction
  //    `withTenant()` already opened, so it has to run on `tx`. That turns out to be the better
  //    shape anyway: the revoke is now practice-scoped rather than everywhere, so the old worst
  //    case (a session stuck open in every practice) cannot happen, and an archival that rolls
  //    back should not leave the person signed out for a change that never took effect. The revoke
  //    now commits WITH the archival, not independently.
  // ★ `reason: 'admin'` — the session table's CHECK set is logout · tenant_changed · admin ·
  //   expired_sweep · role_changed · password_changed · device_removed · operator_ended (0173),
  //   and an archival is an administrative revocation.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  let sessionsRevoked = null;
  let keysRevoked = null;
  if (e.table === "app_user") {
    if (rows[0].firebase_uid) {
      sessionsRevoked = (await revokeSessionsForUser(tx, tenantId, id, "admin")).revoked;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ CCR-7-18 / the maintainer's Q7-13, 21 Sep 2026 — "a key is revoked ... when its minter is archived."
    //     The RANK half (a key revoked when its minter's rank falls below its rank_ceiling) is old
    //     7's 7.13 (`setStaffRole`); this is the ARCHIVAL half, because nothing else opens this
    //     file (MEASURED by the old-7 planner). Without it, archiving a person leaves a standing
    //     programmatic credential they minted, at the rank they held when they minted it.
    //   ★ `keystone.revoke_api_tokens_for_minter` (migration 0179) is its own SECURITY DEFINER,
    //     not a loop over `list_api_tokens` + `revokeApiToken` — `list_api_tokens`'s RETURNS TABLE
    //     carries no `created_by`, on purpose (`created_by` never leaves the database), so the
    //     application cannot tell which rows are this person's without a definer that already
    //     knows.
    // ★★ WHY INSIDE `tx`, ON THE SAME REASONING THE SESSION HALF USED TO ARGUE THE OPPOSITE WAY.
    //    The session case's now-superseded argument was uid-scope: a revoke reaching every
    //    practice fails toward less access if committed independently. A key revoke is
    //    tenant-scoped from the start and reaches exactly the rows this transaction is already
    //    holding, so atomicity was always available here — and an archive that rolls back must not
    //    leave a practice's integrations dead while the person it was meant to accompany is not
    //    actually archived. Both choices fail toward the safer side of their own asymmetry; they
    //    differ because the two scopes differ.
    // ★ Not gated on `firebase_uid` — a minted key survives independently of whether the person
    //   still has a live identity to sign in with, so the sweep runs for every archived
    //   `app_user` row.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    keysRevoked = (await tx.query(
      `SELECT keystone.revoke_api_tokens_for_minter($1, $2) AS n`,
      [id, actorUserId],
    )).rows[0].n;
  }

  return { id, object, archived: true, sessionsRevoked, keysRevoked };
}

/**
 * Restore an archived record.
 *
 * ★★★ ARCHIVING IS NOT A ONE-WAY DOOR, AND THAT IS THE WHOLE ARGUMENT FOR IT OVER DELETION. A
 *     practice that archives the wrong client and cannot undo it has deleted them with extra steps.
 *   ★ The pair is cleared together — `archived_by` without `archived_at` is a claim about an event
 *     that did not happen, and 0088's CHECK refuses it.
 */
export async function restoreRecord(tx, { tenantId, object, id, actorUserId = null }) {
  if (!tenantId) throw invalid("restoreRecord requires a tenantId");
  if (!id) throw invalid("restoreRecord requires the id of the record to restore");
  const e = entryFor(object);

  const { rows } = await tx.query(
    `UPDATE keystone.${e.table}
        SET archived_at = NULL, archived_by = NULL
      WHERE id = $1 AND archived_at IS NOT NULL
      RETURNING id`,
    [id]);

  if (rows.length === 0) {
    throw notFound(
      `no archived ${object} ${id} is available to restore here — either it does not exist in this ` +
      `practice, or it was never archived`);
  }

  await emit(tx, {
    tenantId, topic: e.topic, emittedBy: e.section,
    // ★★★ STAGE 3 TASK 2 — MAPPED THROUGH THE SAME VOCABULARY, NOT A LOCAL SPECIAL CASE. This used
    //     to be a hand-rolled `object === "document" ? "document" : object` ternary — the ONE call
    //     site that already spelled the document literal correctly, by accident, while every other
    //     document-lifecycle event in the product wrote `document_instance` (F474). `ARCHIVABLE`'s
    //     keys (`person`, `document`, …) are already every one of `SUBJECT_TYPES`'s 9 History
    //     names, so this alias lookup is a no-op today — it exists so archive/restore reads from
    //     the SAME map migration 0136 and every other writer read from, rather than re-deriving the
    //     one correction §2 rule 3 makes, a second time, by hand.
    subjectType: SUBJECT_TYPE_ALIASES[object] ?? object,
    subjectId: id,
    // ★ FIX ROUND 1, I5 — same fix as archiveRecord: only the session id, never a body field.
    actor: userActor(actorUserId),
    // ★★ THE SAME TOPIC, WITH `restored: true`. A separate `*.restored` topic per object would be
    //    nine more entries in the closed catalogue for a fact every consumer reads the same way —
    //    "this record's availability changed". The payload says which direction.
    payload: { restored: true, restored_by: actorUserId },
  });

  return { id, object, archived: false };
}
