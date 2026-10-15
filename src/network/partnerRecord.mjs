// @ts-check
// 12.7 — THE PARTNER RECORD. `readPartnerRecord(tx, { viewerId, partyId })` — the single read behind
// `GET /api/network/parties/:id` (src/routes/network.mjs).
//
// ★★★ SCOPE IS A SEPARATE AXIS FROM THE VERB (the maintainer). A history view that shows every referral to every
//     viewer is a scope failure, not a feature — so this read gates two things beyond the party row
//     itself: `between.spentMinor`/`currency` behind `user_may(viewer,'invoice','view',NULL)`, and
//     each `recent[]` row's `person` behind `user_may(viewer,'person','view',<that person's owner>)`.
//     A row the viewer may not name still carries its `reason`/`outcome` — the row is never dropped,
//     only the name (F150 shape).
//
// ★ `theySent`/`youSent`/`becameClients`/`spentMinor` all read the SAME "sent to us" set: every
//   `network_referral` row with `direction = 'in'` for this party, UNION every `app_user` whose
//   `referred_by_party_id` points at this party (0081's older, referral-row-less edge). The two
//   overlap on ordinary use (`recordInboundReferral` writes both in one transaction) — UNION (not
//   UNION ALL) is what keeps a person counted once.
//
// ★ `network_party` is declared `ownable:false` (`src/permissions/ownership.mjs:76-77` — "the
//   referral network is the practice's, not a caseload's"), so there is no owner to gate the party
//   row itself on beyond the route's own staff + section floor.

import { notFound } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

export async function readPartnerRecord(tx, { viewerId, partyId }) {
  const partyRows = await run(tx, db
    .selectFrom("keystone.network_party as n")
    .select([
      "n.id",
      "n.name",
      "n.kind",
      "n.what_they_do",
      "n.city",
      "n.email",
      sql`n.created_at as since`,
      "n.archived_at",
      "n.primary_contact_id",
    ])
    .where("n.id", "=", partyId));
  if (partyRows.rowCount === 0) {
    throw notFound("no such practice in your network");
  }
  const partyRow = partyRows.rows[0];

  let contact = null;
  let showsTeamRow = false;
  if (partyRow.primary_contact_id) {
    const contactRows = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(["id", "display_name", "role"])
      .where("id", "=", partyRow.primary_contact_id));
    if (contactRows.rowCount > 0) {
      const c = contactRows.rows[0];
      const isStaff = c.role === "staff";
      contact = { id: c.id, name: c.display_name, isStaff };
      // ★ F04 §2.2:50-53 — computed from the SAME role fact `isStaff` already carries, not a
      //   second lookup.
      showsTeamRow = isStaff;
    }
  }

  const betweenRows = await tx.query(
    `WITH sent AS (
       SELECT referred_person_id AS person_id
         FROM keystone.network_referral
        WHERE receiving_network_party_id = $1 AND direction = 'in'
       UNION
       SELECT id AS person_id
         FROM keystone.app_user
        WHERE referred_by_party_id = $1
     ),
     sent_out AS (
       SELECT DISTINCT referred_person_id AS person_id
         FROM keystone.network_referral
        WHERE receiving_network_party_id = $1 AND direction = 'out'
     )
     SELECT
       (SELECT count(*) FROM sent) AS they_sent,
       (SELECT count(*) FROM sent_out) AS you_sent,
       (SELECT count(*) FROM sent s JOIN keystone.app_user u ON u.id = s.person_id
         WHERE u.lifecycle_status IN ('active','paused','former')) AS became_clients`,
    [partyId]);
  const between = {
    theySent: Number(betweenRows.rows[0].they_sent),
    youSent: Number(betweenRows.rows[0].you_sent),
    becameClients: Number(betweenRows.rows[0].became_clients),
  };

  const { rows: mayInvoiceRows } = await tx.query(
    `SELECT keystone.user_may($1, 'invoice', 'view', NULL) AS allowed`,
    [viewerId]);
  if (mayInvoiceRows[0]?.allowed === true) {
    const spentRows = await tx.query(
      `WITH sent AS (
         SELECT referred_person_id AS person_id
           FROM keystone.network_referral
          WHERE receiving_network_party_id = $1 AND direction = 'in'
         UNION
         SELECT id AS person_id
           FROM keystone.app_user
          WHERE referred_by_party_id = $1
       )
       SELECT sum(i.amount_minor) AS spent_minor, min(i.currency) AS currency
         FROM keystone.invoice_effective i
         JOIN sent s ON s.person_id = i.payer_user_id
        WHERE i.status = 'paid'`,
      [partyId]);
    between.spentMinor = Number(spentRows.rows[0].spent_minor ?? 0);
    between.currency = spentRows.rows[0].currency ?? null;
  }

  const recentRows = await tx.query(
    `SELECT nr.id, nr.created_at AS date, nr.direction, nr.reason, nr.outcome, nr.outcome_note,
            u.id AS person_id, u.display_name AS person_name,
            keystone.user_may($2, 'person', 'view', u.owner_user_id) AS may_view_person
       FROM keystone.network_referral nr
       JOIN keystone.app_user u ON u.id = nr.referred_person_id
      WHERE nr.receiving_network_party_id = $1
      ORDER BY nr.created_at DESC
      LIMIT 50`,
    [partyId, viewerId]);
  const recent = recentRows.rows.map((r) => ({
    id: r.id,
    date: r.date,
    direction: r.direction,
    // ★ F150 shape — never name a person the viewer may not see; the row (reason/outcome) stays.
    person: r.may_view_person === true ? { id: r.person_id, name: r.person_name } : null,
    reason: r.reason,
    outcome: r.outcome,
    outcomeNote: r.outcome_note,
  }));

  return {
    party: {
      id: partyRow.id,
      name: partyRow.name,
      kind: partyRow.kind,
      whatTheyDo: partyRow.what_they_do,
      city: partyRow.city,
      email: partyRow.email,
      contact,
      since: partyRow.since,
      archivedAt: partyRow.archived_at,
    },
    between,
    recent,
    showsTeamRow,
  };
}
