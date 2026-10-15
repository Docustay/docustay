// @ts-check
// P15B.6 — THE NETWORK WRITES. createNetworkParty · updateNetworkParty · the referral functions.
//
// ★★★ WHAT A NETWORK PARTY IS, AND WHAT IT IS NOT. `network_party` is a REGISTER OF ORGANISATIONS
//     THIS PRACTICE WORKS WITH: who refers to us, who we refer to, which school, which vendor. As of
//     0081/0082 it carries `email`, `phone`, `website`, an address and a PERSON contact
//     (`primary_contact_id`) — the "name and kind and nothing else" claim below was true when this
//     module was first written and has been false since 0081 (corrected here, 12.6).
//   ★★ IT IS NOT A PERSON AND MUST NOT BECOME ONE. A referral partner's individual contact is a
//      PERSON (`app_user`, `src/people/writes.mjs`) or belongs to the account that represents them.
//      Putting a human's details here would create a second, unregulated place where contact data
//      lives — outside the person record that consent, visibility and RLS are written around.
//   ★ `primary_contact_id` points AT that person; it does not duplicate their details onto the party.
//
// ★ Every function here takes `tx` (except `recordBlockedReferral`, which opens its own — see its own
//   header) and emits in the same transaction (§X4.1 / P15B.2).

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, forbidden, unprocessable } from "../http/errors.mjs";
import { withTenant } from "../db/index.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "network";

/**
 * The five kinds the CHECK admits.
 * ★ `other` exists and is NOT a licence to skip the decision — it is there so that a real
 *   relationship which is none of the four can still be recorded rather than mis-filed as a vendor.
 */
export const PARTY_KINDS = Object.freeze(["referral_partner", "vendor", "school", "provider", "other"]);

// ★ 12.8 — the pattern this checks against, shared with the same check on `updateNetworkParty`.
const NETWORK_PARTY_EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

export async function createNetworkParty(tx, {
  tenantId, name, kind, whatTheyDo = null, email = null, primaryContactId = null, city = null,
  actorUserId = null,
}) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a network party needs a name");
  if (!PARTY_KINDS.includes(kind)) {
    // ★ No default. Defaulting to `other` would silently turn "I do not know what this is" into a
    //   stored claim that it is nothing in particular, and the register's only job is to say what
    //   each relationship IS.
    throw invalid(`kind must be one of ${PARTY_KINDS.join(", ")} — got ${JSON.stringify(kind)}`);
  }
  if (whatTheyDo !== null && (typeof whatTheyDo !== "string" || whatTheyDo.length > 60)) {
    throw invalid("what they do must be 60 characters or fewer");
  }
  if (email !== null && (typeof email !== "string" || !NETWORK_PARTY_EMAIL_RE.test(email))) {
    throw invalid("invalid email");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  await run(tx, db.insertInto("keystone.network_party")
    .values({
      id: id ?? null,
      tenant_id: tenantId ?? null,
      name: name.trim() ?? null,
      kind: kind ?? null,
      what_they_do: whatTheyDo ?? null,
      email: email ?? null,
      primary_contact_id: primaryContactId ?? null,
      city: city ?? null,
    }));

  await emit(tx, {
    tenantId,
    topic: "network.party.created",
    emittedBy: SECTION,
    subjectType: "network_party",
    subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ `kind` is in the payload because it is the only thing that changes what a consumer should do:
    //   a new referral_partner is worth a task; a new vendor is not.
    payload: { kind },
  });
  return { id, name: name.trim(), kind };
}

export async function updateNetworkParty(tx, {
  tenantId, partyId, name, kind, whatTheyDo, email, primaryContactId, city, actorUserId = null,
}) {
  const sets = [];
  const args = [partyId];
  const changed = [];
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) throw invalid("a network party name cannot be blank");
    args.push(name.trim()); sets.push(`name = $${args.length}`); changed.push("name");
  }
  if (kind !== undefined) {
    if (!PARTY_KINDS.includes(kind)) {
      throw invalid(`kind must be one of ${PARTY_KINDS.join(", ")} — got ${JSON.stringify(kind)}`);
    }
    args.push(kind); sets.push(`kind = $${args.length}`); changed.push("kind");
  }
  if (whatTheyDo !== undefined) {
    if (whatTheyDo !== null && (typeof whatTheyDo !== "string" || whatTheyDo.length > 60)) {
      throw invalid("what they do must be 60 characters or fewer");
    }
    args.push(whatTheyDo); sets.push(`what_they_do = $${args.length}`); changed.push("what_they_do");
  }
  if (email !== undefined) {
    if (email !== null && (typeof email !== "string" || !NETWORK_PARTY_EMAIL_RE.test(email))) {
      throw invalid("invalid email");
    }
    args.push(email); sets.push(`email = $${args.length}`); changed.push("email");
  }
  if (primaryContactId !== undefined) {
    args.push(primaryContactId); sets.push(`primary_contact_id = $${args.length}`);
    changed.push("primary_contact_id");
  }
  if (city !== undefined) {
    args.push(city); sets.push(`city = $${args.length}`); changed.push("city");
  }
  if (sets.length === 0) throw invalid("nothing to update");

  const r = await tx.query(
    `UPDATE keystone.network_party SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, args);
  // ★ Zero rows is 404. An UPDATE matching nothing raises nothing, and under RLS another tenant's id
  //   is indistinguishable from a missing one — so this is the only place either becomes visible.
  if (r.rowCount === 0) throw notFound("no such network party in this organisation");

  await emit(tx, {
    tenantId,
    topic: "network.party.updated",
    emittedBy: SECTION,
    subjectType: "network_party",
    subjectId: partyId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ The new KIND is included when it changed, because a relationship changing category is the one
    //   update a consumer might act on; the name is not, for the reason given in people/writes.mjs.
    payload: { fields: changed, ...(kind !== undefined ? { kind } : {}) },
  });
  return { id: partyId, fields: changed };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 12.6 — THE REFERRAL FUNCTIONS. `keystone.network_referral` (0359, widened by 0384) is ONE
//     store for BOTH a referral (carries a name and a reason, releases nothing) and a release (may
//     not exist without a recorded consent, OQ-12.2). A referral RELEASES NOTHING — `data_released`
//     and `consent_record_id` stay NULL on every row these functions write; `createNetworkReferral`
//     below, unchanged in behaviour, remains the only writer of a release.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ The only body keys `POST /api/network/referrals` (12.7) accepts, plus the transport key. */
const ALLOWED_REFERRAL_KEYS = Object.freeze(["personId", "partyId", "reason", "copyPerson", "toldPerson"]);

/**
 * ★★★ THE KEYS A REFERRAL REQUEST IS REFUSED FOR. Any body key outside `ALLOWED_REFERRAL_KEYS` and
 *     outside the transport key `idempotencyKey` — most pointedly `notes`, which would smuggle case
 *     detail into a request whose entire point is "release nothing".
 */
export function refusedKeys(body) {
  const keys = Object.keys(body ?? {});
  return keys.filter((k) => k !== "idempotencyKey" && !ALLOWED_REFERRAL_KEYS.includes(k));
}

/**
 * ★★★ REFER A CLIENT OUT. A referral is a NAME AND A REASON — it releases nothing.
 *     `data_released` and `consent_record_id` stay NULL on the inserted row, which is the whole
 *     point: a release is a SEPARATE, consent-bound act (`createNetworkReferral`, below).
 *
 * ★ The owner check is done HERE, not left to `assertMay` at the route: this is a CREATE, and
 *   `assertMay`'s `resolveOwnerId` has no existing row to resolve an owner from for a create — the
 *   only way to enforce "a coach refers only her own clients" is to look up the referred PERSON's
 *   owner directly, exactly as `ownership.mjs`'s `referral` entry documents.
 */
export async function createReferral(tx, {
  tenantId, viewerId, personId, partyId, reason, copyPerson = false, toldPerson = false, actorUserId,
}) {
  if (typeof reason !== "string" || !reason.trim()) {
    throw unprocessable("Say why — the partner reads this first.", { field: "reason" });
  }

  const person = await run(tx, db.selectFrom("keystone.app_user")
    .select("owner_user_id")
    .where("id", "=", personId)
    .where("tenant_id", "=", tenantId));
  if (person.rowCount === 0) {
    throw forbidden("You can refer only your own clients.");
  }
  const { rows: mayRows } = await tx.query(
    `SELECT keystone.user_may($1, 'referral', 'edit', $2) AS allowed`,
    [viewerId, person.rows[0].owner_user_id]);
  if (mayRows[0]?.allowed !== true) {
    throw forbidden("You can refer only your own clients.");
  }

  const party = await run(tx, db.selectFrom("keystone.network_party")
    .select(["id", "name", "active", "email", "primary_contact_id"])
    .where("id", "=", partyId)
    .where("tenant_id", "=", tenantId));
  if (party.rowCount === 0 || party.rows[0].active !== true) {
    throw notFound("no such practice in your network");
  }
  const partyRow = party.rows[0];

  // ★ The address to send to: the party's PERSON contact's email, else the party's own email.
  let partyEmail = partyRow.email;
  if (partyRow.primary_contact_id) {
    const contact = await run(tx, db.selectFrom("keystone.app_user")
      .select("email")
      .where("id", "=", partyRow.primary_contact_id)
      .where("tenant_id", "=", tenantId));
    partyEmail = contact.rows[0]?.email ?? null;
  }
  if (!partyEmail) {
    throw unprocessable(`Add an email for ${partyRow.name} first.`, { field: "partyId" });
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const emailToPerson = copyPerson === true;
  await run(tx, db.insertInto("keystone.network_referral")
    .values({
      id: id ?? null,
      tenant_id: tenantId ?? null,
      referred_person_id: personId ?? null,
      receiving_network_party_id: partyId ?? null,
      direction: "out",
      reason: reason.trim() ?? null,
      told_person: (toldPerson === true) ?? null,
      copied_person: emailToPerson ?? null,
      outcome: "sent",
      partner_email_status: "queued",
      person_email_status: (emailToPerson ? "queued" : "skipped") ?? null,
      created_by: actorUserId ?? null,
    }));

  await emit(tx, {
    tenantId,
    topic: "people.referral.sent",
    emittedBy: "people",
    subjectType: "referral",
    subjectId: id,
    actor: userActor(actorUserId),
    // ★ NEVER the reason text — that is the whole point of the blocked-key discipline above.
    payload: { person_id: personId, party_id: partyId, copied: emailToPerson },
  });

  return { id, copied: emailToPerson };
}

/**
 * ★★★ RECORD AN INBOUND REFERRAL. A partner told us they are sending somebody — direction `in`,
 *     `outcome` starts `in_progress` (there is work to do: get them booked). Sets
 *     `app_user.referred_by_party_id` when it is still unset, so the PERSON→PARTY edge (0081) is
 *     filled in from the same act that records the referral.
 */
export async function recordInboundReferral(tx, { tenantId, viewerId, personId, partyId, reason = "", actorUserId }) {
  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  await run(tx, db.insertInto("keystone.network_referral")
    .values({
      id: id ?? null,
      tenant_id: tenantId ?? null,
      referred_person_id: personId ?? null,
      receiving_network_party_id: partyId ?? null,
      direction: "in",
      reason: reason ?? null,
      outcome: "in_progress",
      created_by: actorUserId ?? null,
    }));

  await run(tx, db.updateTable("keystone.app_user")
    .set({ referred_by_party_id: partyId ?? null })
    .where("id", "=", personId)
    .where("tenant_id", "=", tenantId)
    .where("referred_by_party_id", "is", null));

  await emit(tx, {
    tenantId,
    topic: "people.referral.received",
    emittedBy: "people",
    subjectType: "referral",
    subjectId: id,
    actor: userActor(actorUserId),
    payload: { person_id: personId, party_id: partyId },
  });

  return { id };
}

/** ★ The outcome vocabulary the CHECK constraint `network_referral` (0384) admits. */
export const REFERRAL_OUTCOMES = Object.freeze(
  ["sent", "taken", "in_progress", "became_client", "declined", "no_reply"]);

/**
 * ★★★ SET A REFERRAL'S OUTCOME. Same edit check as `createReferral`, through the referred person's
 *     owner — but resolved from the EXISTING referral row, since there is one to read here.
 */
export async function setReferralOutcome(tx, { tenantId, viewerId, referralId, outcome, outcomeNote = null }) {
  if (!REFERRAL_OUTCOMES.includes(outcome)) {
    throw invalid(`outcome must be one of ${REFERRAL_OUTCOMES.join(", ")} — got ${JSON.stringify(outcome)}`);
  }

  const referral = await run(tx, db
    .selectFrom("keystone.network_referral as nr")
    .innerJoin("keystone.app_user as u", "u.id", "nr.referred_person_id")
    .select("u.owner_user_id")
    .where("nr.id", "=", referralId)
    .where("nr.tenant_id", "=", tenantId));
  if (referral.rowCount === 0) {
    throw notFound("no such referral in this organisation");
  }
  const { rows: mayRows } = await tx.query(
    `SELECT keystone.user_may($1, 'referral', 'edit', $2) AS allowed`,
    [viewerId, referral.rows[0].owner_user_id]);
  if (mayRows[0]?.allowed !== true) {
    throw forbidden("You can update only your own referrals.");
  }

  await run(tx, db.updateTable("keystone.network_referral")
    .set({
      outcome: outcome ?? null,
      outcome_note: outcomeNote ?? null,
      updated_at: sql`now()`,
    })
    .where("id", "=", referralId));

  await emit(tx, {
    tenantId,
    topic: "people.referral.outcome_set",
    emittedBy: "people",
    subjectType: "referral",
    subjectId: referralId,
    actor: userActor(viewerId),
    payload: { outcome },
  });

  return { id: referralId, outcome };
}

/**
 * ★★★ RECORD A REFUSED REQUEST — "RECORD BEFORE FAILING", THE SAME DISCIPLINE
 *     `src/email/send.mjs:8-16` USES. This opens its OWN `withTenant`, separate from the caller's
 *     transaction, so the audit row survives when the caller's own request rolls back (a 403 for an
 *     extra body key never reaches an INSERT — there is nothing else to roll back with it).
 */
export async function recordBlockedReferral(tenantId, { actorUserId, personId, partyId, keys }) {
  return withTenant(tenantId, async (tx) => {
    await emit(tx, {
      tenantId,
      topic: "people.referral.blocked_no_release",
      emittedBy: "people",
      subjectType: "person",
      subjectId: personId,
      actor: userActor(actorUserId),
      payload: { party_id: partyId, refused_keys: keys },
    });
  });
}

/**
 * ★★★ COMPOSE THE REFERRAL EMAIL — PURE. Nothing beyond `personName`/`personEmail`/`reason`/
 *     `practiceName`/`senderName`/`partnerName` is ever interpolated, whatever the caller passes —
 *     this is what keeps a note title, a session date, an invoice amount or a document title out of
 *     a referral email even if a wider object is handed in by mistake.
 */
export function composeReferralEmail({ personName, personEmail, reason, practiceName, senderName, partnerName }) {
  const subject = `${practiceName} is referring ${personName} to you`;
  const text = `Hi ${partnerName},\n\n${senderName} at ${practiceName} is referring ` +
    `${personName} (${personEmail}) to you.\n\nWhy:\n${reason}\n\nThat is all we send — no notes, no ` +
    `history, no records.\n\n${senderName}\n${practiceName}`;
  return { subject, text };
}

/**
 * Create a network referral + release record.
 *
 * ★★★ CONSENT IS REQUIRED AND ENFORCED AT THE DATABASE LEVEL. A release without a recorded
 *      consent_record_id is refused by a NOT NULL foreign key constraint. This function enforces
 *      it at write time as well (defense in depth), by verifying the consent exists and is active
 *      before inserting.
 *
 * ★ Both consent verification and the insert happen in the same transaction (§X4.1 / P15B.2).
 */
export async function createNetworkReferral(tx, {
  tenantId,
  referredPersonId,
  receivingNetworkPartyId,
  dataReleased,
  consentRecordId,
  actorUserId = null,
}) {
  if (typeof dataReleased !== "string" || !dataReleased.trim()) {
    throw invalid("data_released must be a non-empty string describing what was released");
  }

  // ★ Verify that the consent record exists, belongs to this tenant, and is active.
  //   The DB constraint will also enforce this, but verifying here gives a better error message
  //   before the insert fails.
  const consentCheck = await run(tx, db.selectFrom("keystone.consent_record")
    .select(["id", "is_active"])
    .where("id", "=", consentRecordId)
    .where("tenant_id", "=", tenantId));

  if (consentCheck.rows.length === 0) {
    throw notFound("no such consent record in this organisation");
  }

  if (!consentCheck.rows[0].is_active) {
    throw invalid("the consent record has been revoked and cannot authorize a new release");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  await run(tx, db.insertInto("keystone.network_referral")
    .values({
      id: id ?? null,
      tenant_id: tenantId ?? null,
      referred_person_id: referredPersonId ?? null,
      receiving_network_party_id: receivingNetworkPartyId ?? null,
      data_released: dataReleased.trim() ?? null,
      consent_record_id: consentRecordId ?? null,
    }));

  await emit(tx, {
    tenantId,
    topic: "network.referral.created",
    emittedBy: SECTION,
    subjectType: "referral",
    subjectId: id,
    actor: userActor(actorUserId),
    payload: {
      referred_person_id: referredPersonId,
      receiving_network_party_id: receivingNetworkPartyId,
      data_released: dataReleased.trim(),
    },
  });

  return {
    id,
    referred_person_id: referredPersonId,
    receiving_network_party_id: receivingNetworkPartyId,
    data_released: dataReleased.trim(),
    consent_record_id: consentRecordId,
  };
}
