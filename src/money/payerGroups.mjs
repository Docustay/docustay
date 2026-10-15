// @ts-check
// P1.2 — PAYER GROUPS. createPayerGroup · updatePayerGroup · addMember · removeMember · moveMember ·
// archivePayerGroup · openInvoiceFor · listPayerGroups · readPayerGroup · getGroupBalance.
//
// F03 — 12.5. A payer group IS an account: a billable entity (a Stripe customer) with a kind
// (family/employer/third_party), an optional contact person, an optional billing note, and an
// archive state. It contains one or more members (people or accounts). A person may belong to
// exactly ONE payer group at a time (enforced by the unique index
// `payer_group_member_one_group_per_person`, migration 0383) — moving them between groups goes
// through `moveMember`, never a second `addMember`.
//
// ★★★ STRIPE IS THE MONEY RECORD. This module mirrors billing identity and reads invoices/payments
//     that already exist; it never computes a balance, a charge, a refund or a payout. The blocked
//     list (DOB, sobriety date, recovery fields, notes, emergency contact, consent detail, guardian
//     relationship) never leaves the platform — none of it is read or returned here beyond the
//     ordinary person fields (name, role, age, guardian names) a staff account screen already shows.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, conflict, notFound } from "../http/errors.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same joins, same RETURNING columns, same
//   parameterization). `sql` is the escape hatch for what the builder itself does not express —
//   plpgsql function calls (`uuid_generate_v7()`, `user_may(...)`), `ANY(...)::uuid[]`, and computed
//   columns (`to_char`, `date_part`/`age`) — per the L3 per-file ruling: "SQL that calls plpgsql or
//   uses features the builder lacks stays as sql`…` through run".
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "money";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

/** The closed set of account kinds — matches `payer_group`'s `kind` CHECK (migration 0383). */
const PAYER_KINDS = Object.freeze(["family", "employer", "third_party"]);

/**
 * Create a payer group (an account).
 * ★ `kind` is required. Members named in `memberPersonIds` are added through `addMember`, in the
 *   same transaction, so a duplicate/already-covered member refuses the whole create.
 * ★★ Event payload is `{ kind }` only — never `name`, a free-text field (02 §2.4 content rule).
 */
export async function createPayerGroup(tx, {
  tenantId, name, kind, contactUserId = null, billingNote = null, memberPersonIds = [], actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (typeof name !== "string" || !name.trim()) {
    throw invalid("name is required — a payer group must have a label");
  }
  if (!PAYER_KINDS.includes(kind)) {
    throw invalid("kind must be family, employer or third_party");
  }
  if (billingNote != null && (typeof billingNote !== "string" || billingNote.length > 200)) {
    throw invalid("billingNote must be a string of 200 characters or fewer");
  }

  const id = (await run(tx, sql`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.payer_group")
      .values({
        id, tenant_id: tenantId, name: name.trim(), kind,
        contact_user_id: contactUserId, billing_note: billingNote ?? null,
      }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict("a payer group with this name already exists in this practice", { field: "name" });
    }
    if (e.code === FOREIGN_KEY_VIOLATION) {
      throw invalid("no user with this id exists in this practice", { field: "contactUserId" });
    }
    throw e;
  }

  for (const personId of memberPersonIds) {
    await addMember(tx, { tenantId, payerGroupId: id, personId, actorUserId });
  }

  await emit(tx, {
    tenantId, topic: "money.payer_group.created", emittedBy: SECTION,
    subjectType: "payer_group", subjectId: id,
    actor: userActor(actorUserId),
    payload: { kind },
  });
  return { id, name: name.trim(), kind };
}

/**
 * Update a payer group's own fields. Only fields explicitly present (not `undefined`) are changed.
 * ★ An archived group refuses every update — archive first restores it (12.32 handles the restore
 *   affordance, if any; this module does not expose one, per the section it was built from).
 */
export async function updatePayerGroup(tx, {
  tenantId, payerGroupId, name, kind, contactUserId, billingNote, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!payerGroupId) throw invalid("payerGroupId is required");

  const { rows: existingRows } = await run(tx, db
    .selectFrom("keystone.payer_group")
    .select(["id", "archived_at"])
    .where("id", "=", payerGroupId)
    .where("tenant_id", "=", tenantId));
  if (existingRows.length === 0) throw notFound("no payer group with this id exists in this practice");
  if (existingRows[0].archived_at) throw conflict("this account is archived");

  const updates = {};
  const fields = {};

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) throw invalid("name must be a non-empty string");
    updates.name = name.trim();
    fields.name = name.trim();
  }
  if (kind !== undefined) {
    if (!PAYER_KINDS.includes(kind)) throw invalid("kind must be family, employer or third_party");
    updates.kind = kind;
    fields.kind = kind;
  }
  if (contactUserId !== undefined) {
    updates.contact_user_id = contactUserId;
    fields.contactUserId = contactUserId;
  }
  if (billingNote !== undefined) {
    if (billingNote != null && (typeof billingNote !== "string" || billingNote.length > 200)) {
      throw invalid("billingNote must be a string of 200 characters or fewer");
    }
    updates.billing_note = billingNote;
    fields.billingNote = billingNote;
  }

  if (Object.keys(updates).length === 0) throw invalid("at least one field must be provided");

  try {
    await run(tx, db
      .updateTable("keystone.payer_group")
      .set({ ...updates, updated_at: sql`now()` })
      .where("id", "=", payerGroupId)
      .where("tenant_id", "=", tenantId));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict("a payer group with this name already exists in this practice", { field: "name" });
    }
    if (e.code === FOREIGN_KEY_VIOLATION) {
      throw invalid("no user with this id exists in this practice", { field: "contactUserId" });
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "money.payer_group.updated", emittedBy: SECTION,
    subjectType: "payer_group", subjectId: payerGroupId,
    actor: userActor(actorUserId),
    payload: { fields },
  });
  return { id: payerGroupId, fields };
}

/**
 * Add a member (person or account) to a payer group.
 * ★★ Exactly one of personId or accountId must be provided; the other must be null.
 *    A person or account cannot be a member of the same group twice, and — migration 0383 — a
 *    person cannot be a member of TWO DIFFERENT groups at once. `moveMember` is the path between
 *    groups; a second `addMember` for an already-covered person refuses with the move offer.
 */
export async function addMember(tx, {
  tenantId, payerGroupId, personId = null, accountId = null, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!payerGroupId) throw invalid("payerGroupId is required");

  // ★ Exactly one of personId or accountId must be provided.
  const hasPersonId = personId !== null && personId !== undefined;
  const hasAccountId = accountId !== null && accountId !== undefined;

  if (!(hasPersonId ^ hasAccountId)) {
    // XOR: one must be true, not both, not neither
    throw invalid("exactly one of personId or accountId must be provided");
  }

  const id = (await run(tx, sql`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.payer_group_member")
      .values({
        id, tenant_id: tenantId, payer_group_id: payerGroupId,
        person_id: personId, account_id: accountId,
      }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      if (e.constraint === "payer_group_member_one_group_per_person") {
        const { rows } = await run(tx, db
          .selectFrom("keystone.payer_group_member as pgm")
          .innerJoin("keystone.payer_group as pg", (join) => join
            .onRef("pg.id", "=", "pgm.payer_group_id")
            .onRef("pg.tenant_id", "=", "pgm.tenant_id"))
          .innerJoin("keystone.app_user as au", (join) => join
            .onRef("au.id", "=", "pgm.person_id")
            .onRef("au.tenant_id", "=", "pgm.tenant_id"))
          .select(["pgm.payer_group_id", "pg.name as group_name", "au.display_name as person_name"])
          .where("pgm.tenant_id", "=", tenantId)
          .where("pgm.person_id", "=", personId));
        const other = rows[0];
        throw conflict(
          `One account per person — ${other?.person_name ?? "this person"} is already covered by ` +
          `${other?.group_name ?? "another account"}; move them?`,
          {
            code: "already_covered",
            otherGroupId: other?.payer_group_id ?? null,
            otherGroupName: other?.group_name ?? null,
          });
      }
      const memberType = hasPersonId ? "person" : "account";
      throw conflict(`this ${memberType} is already a member of this payer group`, { field: memberType });
    }
    if (e.code === FOREIGN_KEY_VIOLATION) {
      if (!hasPersonId && e.message.includes("payer_group")) {
        throw invalid("no payer group with this id exists in this practice");
      }
      const memberType = hasPersonId ? "person" : "account";
      throw invalid(`no ${memberType} with this id exists in this practice`);
    }
    if (e.code === CHECK_VIOLATION) {
      throw invalid("the database refused this member: exactly one of person_id or account_id must be set");
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "money.payer_group_member.added", emittedBy: SECTION,
    subjectType: "payer_group_member", subjectId: id,
    actor: userActor(actorUserId),
    payload: {
      payer_group_id: payerGroupId,
      person_id: personId,
      account_id: accountId,
    },
  });
  return { id, payer_group_id: payerGroupId, person_id: personId, account_id: accountId };
}

/**
 * The single open invoice (if any) covering a person or their group's contact — the shared check
 * `removeMember`, `moveMember` and `archivePayerGroup` all refuse against. Runs under invoice RLS;
 * every caller here is already gated to staff holding `invoice: view` (Owner/Admin) before this
 * runs, per `src/routes/payerGroups.mjs`'s guard.
 */
export async function openInvoiceFor(tx, { personId = null, contactUserId = null }) {
  const ids = [personId, contactUserId].filter((v) => v != null);
  if (ids.length === 0) return null;

  const { rows } = await run(tx, db
    // ★ STRIPE-MIRROR §4 stage (e): "open" is Stripe's word (keystone.invoice_effective); the period
    //   /created dates are the platform's own, via LEFT JOIN (a Stripe-only invoice has no base row).
    .selectFrom("keystone.invoice_effective as ie")
    .leftJoin("keystone.invoice as i", "i.id", "ie.id")
    .select([
      "ie.id",
      sql`to_char(coalesce(i.period_start, i.created_at, ie.paid_at, now()), 'FMMonth')`.as("month"),
    ])
    .where("ie.status", "=", "open")
    .where(sql`ie.payer_user_id = ANY(${sql.val(ids)}::uuid[])`)
    .orderBy(sql`i.created_at asc nulls last`)
    .limit(1));
  if (rows.length === 0) return null;
  return { id: rows[0].id, label: rows[0].month };
}

/**
 * Remove a member from a payer group.
 * ★ Refused while an open invoice covers the member (by their own person id) or the group's
 *   contact — settle or void it first (OQ-12.3).
 */
export async function removeMember(tx, {
  tenantId, membershipId, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!membershipId) throw invalid("membershipId is required");

  const { rows: memberRows } = await run(tx, db
    .selectFrom("keystone.payer_group_member as pgm")
    .innerJoin("keystone.payer_group as pg", (join) => join
      .onRef("pg.id", "=", "pgm.payer_group_id")
      .onRef("pg.tenant_id", "=", "pgm.tenant_id"))
    .select(["pgm.id", "pgm.payer_group_id", "pgm.person_id", "pgm.account_id", "pg.contact_user_id"])
    .where("pgm.id", "=", membershipId)
    .where("pgm.tenant_id", "=", tenantId));
  if (memberRows.length === 0) throw notFound("no membership with this id exists in this practice");
  const member = memberRows[0];

  const openInvoice = await openInvoiceFor(tx, {
    personId: member.person_id, contactUserId: member.contact_user_id,
  });
  if (openInvoice) {
    throw conflict(
      `${openInvoice.label}'s invoice covers her — settle or void it first.`,
      { code: "open_invoice", invoiceId: openInvoice.id });
  }

  const r = await run(tx, db
    .deleteFrom("keystone.payer_group_member")
    .where("id", "=", membershipId)
    .where("tenant_id", "=", tenantId)
    .returning(["payer_group_id", "person_id", "account_id"]));

  if (r.rowCount === 0) throw notFound("no membership with this id exists in this practice");

  const row = r.rows[0];
  await emit(tx, {
    tenantId, topic: "money.payer_group_member.removed", emittedBy: SECTION,
    subjectType: "payer_group_member", subjectId: membershipId,
    actor: userActor(actorUserId),
    payload: {
      payer_group_id: row.payer_group_id,
      person_id: row.person_id,
      account_id: row.account_id,
    },
  });
  return { id: membershipId };
}

/**
 * Move a person from whichever payer group currently covers them to a different one.
 * ★ Refused by the SAME open-invoice check as `removeMember`, run against the OLD group — settling
 *   or voiding first is the only way through, exactly as removing them would be.
 */
export async function moveMember(tx, {
  tenantId, personId, toPayerGroupId, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!personId) throw invalid("personId is required");
  if (!toPayerGroupId) throw invalid("toPayerGroupId is required");

  const { rows: oldRows } = await run(tx, db
    .selectFrom("keystone.payer_group_member as pgm")
    .innerJoin("keystone.payer_group as pg", (join) => join
      .onRef("pg.id", "=", "pgm.payer_group_id")
      .onRef("pg.tenant_id", "=", "pgm.tenant_id"))
    .select(["pgm.id as membership_id", "pgm.payer_group_id", "pg.contact_user_id"])
    .where("pgm.tenant_id", "=", tenantId)
    .where("pgm.person_id", "=", personId));
  if (oldRows.length === 0) throw notFound("this person is not a member of any account in this practice");
  const old = oldRows[0];

  const openInvoice = await openInvoiceFor(tx, { personId, contactUserId: old.contact_user_id });
  if (openInvoice) {
    throw conflict(
      `${openInvoice.label}'s invoice covers her — settle or void it first.`,
      { code: "open_invoice", invoiceId: openInvoice.id });
  }

  await run(tx, db
    .deleteFrom("keystone.payer_group_member")
    .where("id", "=", old.membership_id)
    .where("tenant_id", "=", tenantId));

  const id = (await run(tx, sql`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.payer_group_member")
      .values({
        id, tenant_id: tenantId, payer_group_id: toPayerGroupId,
        person_id: personId, account_id: null,
      }));
  } catch (e) {
    if (e.code === FOREIGN_KEY_VIOLATION) {
      throw invalid("no payer group with this id exists in this practice");
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "money.payer_group_member.moved", emittedBy: SECTION,
    subjectType: "payer_group_member", subjectId: id,
    actor: userActor(actorUserId),
    payload: {
      person_id: personId,
      from_payer_group_id: old.payer_group_id,
      to_payer_group_id: toPayerGroupId,
    },
  });
  return { id };
}

/**
 * Archive a payer group. Refused while any member (by person id) or the group's contact has an
 * open invoice — settle or void every one of them first.
 */
export async function archivePayerGroup(tx, {
  tenantId, payerGroupId, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!payerGroupId) throw invalid("payerGroupId is required");

  const { rows: groupRows } = await run(tx, db
    .selectFrom("keystone.payer_group")
    .select(["id", "contact_user_id", "archived_at"])
    .where("id", "=", payerGroupId)
    .where("tenant_id", "=", tenantId));
  if (groupRows.length === 0) throw notFound("no payer group with this id exists in this practice");
  const group = groupRows[0];
  if (group.archived_at) throw conflict("this account is archived");

  const { rows: memberRows } = await run(tx, db
    .selectFrom("keystone.payer_group_member")
    .select("person_id")
    .where("tenant_id", "=", tenantId)
    .where("payer_group_id", "=", payerGroupId)
    .where("person_id", "is not", null));
  const payerIds = [...memberRows.map((r) => r.person_id), group.contact_user_id]
    .filter((v) => v != null);

  let count = 0;
  if (payerIds.length > 0) {
    const { rows: invoiceRows } = await run(tx, db
      .selectFrom("keystone.invoice_effective")
      .select([sql`count(*)::int`.as("n")])
      .where("status", "=", "open")
      .where(sql`payer_user_id = ANY(${sql.val(payerIds)}::uuid[])`));
    count = invoiceRows[0]?.n ?? 0;
  }
  if (count > 0) {
    throw conflict(
      `${count} open invoice(s) on this account — settle or void them first.`,
      { code: "open_invoices", count });
  }

  await run(tx, db
    .updateTable("keystone.payer_group")
    .set({ archived_at: sql`now()`, archived_by: actorUserId })
    .where("id", "=", payerGroupId)
    .where("tenant_id", "=", tenantId));

  await emit(tx, {
    tenantId, topic: "money.payer_group.archived", emittedBy: SECTION,
    subjectType: "payer_group", subjectId: payerGroupId,
    actor: userActor(actorUserId),
    payload: {},
  });
  return { id: payerGroupId };
}

/**
 * List every non-archived payer group (account) for the tenant.
 * ★ `owingMinor`/`currency`/`state` are present only when the viewer holds `invoice: view` at any
 *   scope (`keystone.user_may($1,'invoice','view',NULL)`) — the keys are OMITTED, not nulled, when
 *   they are not, so a viewer without money access cannot even learn the shape carries a balance.
 */
export async function listPayerGroups(tx, { viewerId }) {
  if (!viewerId) throw invalid("viewerId is required");

  const { rows: moneyRows } = await run(tx,
    sql`SELECT keystone.user_may(${sql.val(viewerId)}, 'invoice', 'view', NULL) AS allowed`);
  const canSeeMoney = moneyRows[0]?.allowed === true;

  const { rows: groups } = await run(tx, db
    .selectFrom("keystone.payer_group as pg")
    .leftJoin("keystone.app_user as contact", "contact.id", "pg.contact_user_id")
    .select(["pg.id", "pg.name", "pg.kind", "pg.archived_at", "contact.display_name as contact_name"])
    .where("pg.archived_at", "is", null)
    .orderBy("pg.name"));

  const { rows: memberRows } = await run(tx, db
    .selectFrom("keystone.payer_group_member as pgm")
    .innerJoin("keystone.app_user as au", "au.id", "pgm.person_id")
    .select(["pgm.payer_group_id", "au.display_name"])
    .where("pgm.person_id", "is not", null)
    .orderBy("au.display_name"));
  const coversByGroup = new Map();
  for (const m of memberRows) {
    const arr = coversByGroup.get(m.payer_group_id) ?? [];
    arr.push(m.display_name);
    coversByGroup.set(m.payer_group_id, arr);
  }

  let balanceByGroup = new Map();
  if (canSeeMoney) {
    const { rows: balances } = await run(tx, db
      .selectFrom("keystone.payer_group_balance")
      .select(["payer_group_id", "currency", "outstanding_minor"]));
    balanceByGroup = new Map(balances.map((b) => [b.payer_group_id, b]));
  }

  return groups.map((g) => {
    const row = {
      id: g.id,
      name: g.name,
      kind: g.kind,
      contactName: g.contact_name,
      covers: coversByGroup.get(g.id) ?? [],
      archivedAt: g.archived_at,
    };
    if (canSeeMoney) {
      const balance = balanceByGroup.get(g.id);
      const outstandingMinor = balance?.outstanding_minor ?? 0;
      row.owingMinor = outstandingMinor;
      row.currency = balance?.currency ?? "USD";
      row.state = outstandingMinor > 0 ? "owes" : "paid_up";
    }
    return row;
  });
}

/**
 * Read one payer group (account) with its members and — money-gated — its open invoices and
 * payment history.
 * ★★ TEEN BOUNDARY. This never selects a note, a message, or any field matching the blocked list —
 *    only name, role, age, whether the member is a minor, and their guardians' names.
 */
export async function readPayerGroup(tx, { viewerId, payerGroupId }) {
  if (!viewerId) throw invalid("viewerId is required");
  if (!payerGroupId) throw invalid("payerGroupId is required");

  const { rows: groupRows } = await run(tx, db
    .selectFrom("keystone.payer_group as pg")
    .leftJoin("keystone.app_user as contact", "contact.id", "pg.contact_user_id")
    .select([
      "pg.id", "pg.name", "pg.kind", "pg.contact_user_id", "pg.billing_note", "pg.archived_at",
      "contact.display_name as contact_name",
    ])
    .where("pg.id", "=", payerGroupId));
  if (groupRows.length === 0) throw notFound("no payer group with this id exists in this practice");
  const g = groupRows[0];

  const { rows: memberRows } = await run(tx, db
    .selectFrom("keystone.payer_group_member as pgm")
    .innerJoin("keystone.app_user as au", "au.id", "pgm.person_id")
    .select([
      "pgm.id as membership_id", "pgm.person_id", "au.display_name as name", "au.role",
      sql`date_part('year', age(au.date_of_birth))::int`.as("age"),
      sql`(au.role = 'adolescent_client')`.as("is_teen"),
    ])
    .where("pgm.payer_group_id", "=", payerGroupId)
    .where("pgm.person_id", "is not", null)
    .orderBy("au.display_name"));

  const personIds = memberRows.map((m) => m.person_id);
  const guardiansByChild = new Map();
  if (personIds.length > 0) {
    const { rows: guardianRows } = await run(tx, db
      .selectFrom("keystone.guardian as gr")
      .innerJoin("keystone.app_user as au", "au.id", "gr.guardian_user_id")
      .select(["gr.child_user_id", "au.display_name"])
      .where(sql`gr.child_user_id = ANY(${sql.val(personIds)}::uuid[])`)
      .orderBy("au.display_name"));
    for (const row of guardianRows) {
      const arr = guardiansByChild.get(row.child_user_id) ?? [];
      arr.push(row.display_name);
      guardiansByChild.set(row.child_user_id, arr);
    }
  }

  const members = memberRows.map((m) => ({
    membershipId: m.membership_id,
    personId: m.person_id,
    name: m.name,
    role: m.role,
    age: m.age,
    isTeen: m.is_teen,
    guardianNames: guardiansByChild.get(m.person_id) ?? [],
  }));

  const result = {
    group: {
      id: g.id,
      name: g.name,
      kind: g.kind,
      contactUserId: g.contact_user_id,
      contactName: g.contact_name,
      billingNote: g.billing_note,
      archivedAt: g.archived_at,
    },
    members,
  };

  const { rows: moneyRows } = await run(tx,
    sql`SELECT keystone.user_may(${sql.val(viewerId)}, 'invoice', 'view', NULL) AS allowed`);
  const canSeeMoney = moneyRows[0]?.allowed === true;

  if (canSeeMoney) {
    const payerIds = [...personIds, g.contact_user_id].filter((v) => v != null);
    let owing = [];
    let history = [];
    if (payerIds.length > 0) {
      const { rows: owingRows } = await run(tx, db
        // ★ STRIPE-MIRROR §4 stage (e): status/amount from keystone.invoice_effective; due_at/memo/
        //   created_at are the platform's own, LEFT JOINed so a Stripe-only invoice still lists.
        .selectFrom("keystone.invoice_effective as ie")
        .leftJoin("keystone.invoice as i", "i.id", "ie.id")
        .select(["ie.id as invoice_id", "ie.invoice_number", "ie.amount_minor", "ie.currency",
                 "i.due_at", "i.memo"])
        .where("ie.status", "=", "open")
        .where(sql`ie.payer_user_id = ANY(${sql.val(payerIds)}::uuid[])`)
        .orderBy(sql`i.created_at asc nulls last`));
      owing = owingRows.map((r) => ({
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        amountMinor: r.amount_minor,
        currency: r.currency,
        dueAt: r.due_at,
        memo: r.memo,
      }));

      // ★★ `method` IS DELIBERATELY NULL, AND THAT IS THE HONEST ANSWER (25 Sep 2026).
      //   The plan's payload shape names `method`, but `keystone.payment` carries no FK to
      //   `keystone.payment_method` — MEASURED — so nothing in this database records which
      //   method was charged on a given past payment.
      //   The first build of this joined the payer's CURRENT DEFAULT stored method and labelled
      //   it as the method of a past payment. Those are different facts: change your default
      //   card and every historical row silently re-brands itself. On a money surface that is
      //   not an approximation, it is a wrong statement about a completed charge.
      //   STRIPE IS THE MONEY RECORD: the method actually charged belongs to the Stripe
      //   PaymentIntent on that practice's connected account, and the platform mirrors it rather
      //   than inferring it. Until a task owns that mirror, this stays null and the surface says
      //   nothing rather than saying something false.
      const { rows: historyRows } = await run(tx, db
        // ★ STRIPE-MIRROR §4 stage (e): keystone.payment_effective (Stripe charges + the platform-only rows).
        .selectFrom("keystone.payment_effective as p")
        .select(["p.id as payment_id", "p.created_at as paid_at", "p.amount_minor", "p.currency"])
        .where("p.status", "in", ["succeeded", "partially_refunded"])
        .where(sql`p.payer_user_id = ANY(${sql.val(payerIds)}::uuid[])`)
        .orderBy("p.created_at", "desc"));
      history = historyRows.map((r) => ({
        paymentId: r.payment_id,
        paidAt: r.paid_at,
        amountMinor: r.amount_minor,
        currency: r.currency,
        method: null,
      }));
    }
    result.owing = owing;
    result.history = history;
  }

  return result;
}

/**
 * Read a payer group's outstanding balance.
 * ★ Stays for compatibility — `readPayerGroup`/`listPayerGroups` use `payer_group_balance`
 *   directly for the same figure, gated by the caller's `invoice: view` permission.
 */
async function getGroupBalance(tx, {
  tenantId, payerGroupId,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!payerGroupId) throw invalid("payerGroupId is required");

  const r = await run(tx, db
    .selectFrom("keystone.payer_group_balance")
    .select(["payer_group_id", "currency", "outstanding_minor", "open_invoices"])
    .where("payer_group_id", "=", payerGroupId));

  if (r.rows.length === 0) {
    // ★ A group with no person members (only account members) has no balance yet.
    // Return a zero balance in the practice's default currency (USD).
    return { payer_group_id: payerGroupId, outstanding_minor: 0, currency: "USD", open_invoices: 0 };
  }

  const row = r.rows[0];
  return {
    payer_group_id: row.payer_group_id,
    outstanding_minor: row.outstanding_minor ?? 0,
    currency: row.currency,
    open_invoices: row.open_invoices ?? 0,
  };
}
