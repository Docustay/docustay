// @ts-check
// THE SHARED DELETE (QUEUE §3 A, the maintainer 2 Oct 2026) — ONE module, ONE route, driven by ONE list of record types.
//
// "Do it the small way: Postgres ON DELETE CASCADE rules on the foreign keys, one shared delete route driven
//  by a list of record types, one shared 'can't be undone' confirm dialog. No per-screen delete code."
//
// ★★★ WHAT DOES THE WORK IS THE DATABASE, NOT THIS FILE. Migration 0581 changed the foreign keys: deleting a
//     record now takes what it OWNS with it (ON DELETE CASCADE), leaves what merely points at it alone (SET
//     NULL), and REFUSES while something "in use" or authored still points at it (RESTRICT). This module only
//     (1) says what a record type is (DELETABLE), (2) WALKS those same foreign keys, read from the catalog, to
//     tell the person what a delete would also remove or what blocks it, (3) deletes, (4) does the Stripe half
//     for the few types that have one, and (5) writes the permanent audit row.
//
// ★★ THE PLAN AND THE DELETE READ THE SAME CATALOG. There is no hand-kept list of children to drift from the
//    database: add a table with a foreign key and the next plan counts it.
// ★ The practice's own guards still stand: `protected_real_client` (Example Client) is never bypassed; the
//   last-Owner guard stands. The three e-sign immutability guards honour `keystone.record_delete_reason`, which
//   ONLY this module sets (and only for an Owner/Admin — the route's `record.archive` gate).

import { isQaLoginUid, QA_LOGIN_REFUSAL } from "../auth/qaLogins.mjs";
import { invalid, notFound, conflict, forbidden } from "../http/errors.mjs";
import { normaliseReason } from "../events/reasons.mjs";
import { returnCreditsForBooking } from "../money/credits.mjs";
import { asPracticeOwner } from "../money/asPracticeOwner.mjs";
import { stripeConnectedRequest } from "../money/stripeConnected.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { DOCUMENTS_DOMAIN, documentDeleteBlockers, prepareDocumentsForPersonDelete, personDeleteDocumentPlan } from "../documents/frontDoor.mjs";

/**
 * ★★★ THE LIST OF RECORD TYPES. Adding a deletable type is one entry here (and the cascade rules in the
 *     database); there is no per-screen code anywhere.
 *   table  — the keystone table; `where` narrows it (person vs team member share app_user)
 *   noun   — what the confirm dialog calls it
 *   stripe — name of the Stripe half in STRIPE_HALVES, if any
 *   before — an optional hook run inside the transaction before the delete
 */
export const DELETABLE = Object.freeze({
  person:            { table: "app_user",          noun: "person",            where: "role <> 'staff'", stripe: "person" },
  team_member:       { table: "app_user",          noun: "team member",       where: "role = 'staff'" },
  account:           { table: "account",           noun: "account" },
  // ★ §13 audit: the Accounts SCREEN (/accounts/all, AccountRecord) lists PAYER GROUPS (a family, an employer), not `account` rows — Delete on those rows must
  //   name THIS type. Its members go with it (payer_group_member is ON DELETE CASCADE); the people themselves stay.
  payer_group:       { table: "payer_group",       noun: "payer account" },
  service:           { table: "service",           noun: "service",           stripe: "catalogue", subjectType: "service" },
  package:           { table: "package",           noun: "package",           stripe: "catalogue", subjectType: "package" },
  plan:              { table: "plan",              noun: "plan",              stripe: "catalogue", subjectType: "plan" },
  program:           { table: "program",           noun: "program", note: "People in this program are taken out of it (they stay as people). Services, packages and plans must be moved to another program first." },
  modifier:          { table: "modifier",          noun: "modifier" },
  coupon:            { table: "coupon",            noun: "coupon" },
  gift_card:         { table: "gift_card",         noun: "gift card" },
  unit:              { table: "unit",              noun: "unit" },
  location:          { table: "location",          noun: "location" },
  service_category:  { table: "service_category",  noun: "category" },
  booking:           { table: "booking",           noun: "session",           before: "booking" },
  booking_link:      { table: "booking_link",      noun: "booking link" },
  ...DOCUMENTS_DOMAIN.deletable,      // document_template · document · clause — declared by Documents (ISLAND-PROGRAMS §2)
  email_template:    { table: "email_template",    noun: "email template" },
  campaign:          { table: "campaign",          noun: "campaign" },
  landing_page:      { table: "landing_page",      noun: "landing page" },
  segment:           { table: "segment",           noun: "segment" },
  automation:        { table: "automation_config", noun: "automation" },
  network_party:     { table: "network_party",     noun: "network contact" },
  estimate:          { table: "estimate",          noun: "estimate" },
  // (no `invite`: app_rw holds only INSERT/SELECT/UPDATE on keystone.invite BY DESIGN — an invitation is CANCELLED (an UPDATE), never deleted; found in the §13 sandbox test)
  // ★ STRIPE'S OWN RECORDS (the maintainer's rule: "payments/refunds/payouts/disputes → remove from the platform's view only").
  //   `view` is the *_effective view the screens read (Stripe-only rows exist only there); `stripeCol` is its Stripe id.
  //   Deleting writes a tombstone (keystone.stripe_hidden, migration 0582) so the mirror's row stops showing — Stripe
  //   itself is never touched — and deletes the platform's own row, if there is one.
  payment:           { table: "payment",           noun: "payment",           view: "payment_effective",      stripeCol: "stripe_charge_id",        person: "payer_user_id" },
  refund:            { table: "refund",            noun: "refund",            view: "refund_effective",       stripeCol: "stripe_id",               viaPayment: true },
  credit_note:       { table: "credit_note",       noun: "credit note",       view: "credit_note_effective",  stripeCol: "stripe_credit_note_id",   viaInvoice: true },
  dispute:           { table: "dispute",           noun: "dispute",           view: "dispute_effective",      stripeCol: "stripe_id",               viaPayment: true },
  payout:            { table: "payout",            noun: "payout",            view: "payout_effective",       stripeCol: "stripe_id" },
  subscription:      { table: "subscription",      noun: "subscription",      view: "subscription_effective", stripeCol: "stripe_subscription_id", person: "app_user_id", mustBeInactive: true },
});
export const DELETABLE_TYPES = Object.freeze(Object.keys(DELETABLE));

/** What a table's rows are called when the plan says "this will also remove …". Fallback: the table name. */
const TABLE_NOUNS = Object.freeze({
  booking: ["session", "sessions"], booking_participant: ["session attendee", "session attendees"],
  invoice: ["invoice", "invoices"], payment: ["payment", "payments"], refund: ["refund", "refunds"],
  credit_note: ["credit note", "credit notes"], estimate: ["estimate", "estimates"],
  subscription: ["subscription", "subscriptions"], subscription_schedule: ["payment plan", "payment plans"],
  entitlement: ["credit pack", "credit packs"], entitlement_credit: ["session credit", "session credits"],
  package_balance: ["package balance", "package balances"], package_credit: ["package credit", "package credits"],
  ...DOCUMENTS_DOMAIN.tableNouns,
  message_thread: ["conversation", "conversations"], message: ["message", "messages"],
  line_item: ["line item", "line items"], loyalty_entry: ["loyalty entry", "loyalty entries"],
  gift_card_entry: ["gift card entry", "gift card entries"], network_referral: ["referral", "referrals"],
  booking_waitlist_entry: ["waitlist entry", "waitlist entries"], service: ["service", "services"],
  package: ["package", "packages"], plan: ["plan", "plans"], campaign: ["campaign", "campaigns"],
  guardian: ["guardian link", "guardian links"], person_goal: ["goal", "goals"],
  person_attachment: ["attachment", "attachments"], payer_group_member: ["account membership", "account memberships"],
  account_contact: ["account contact", "account contacts"], notification: ["notification", "notifications"],
});
const nounFor = (table, n) => {
  const t = TABLE_NOUNS[table];
  if (t) return n === 1 ? t[0] : t[1];
  const base = table.replaceAll("_", " ");
  return n === 1 ? base : /[^aeiou]y$/.test(base) ? `${base.slice(0, -1)}ies` : `${base}s`;
};

// ─── the foreign-key graph, from the catalog ─────────────────────────────────────────────────────────────────
let fkCache = null;
async function loadForeignKeys(tx) {
  if (fkCache) return fkCache;
  const { rows } = await tx.query(`
    SELECT pn.nspname || '.' || pr.relname AS parent, n.nspname || '.' || r.relname AS child, cn.confdeltype AS rule,
           has_table_privilege(cn.conrelid, 'SELECT') AS readable,
           (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(cn.conkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = cn.conrelid AND a.attnum = k.attnum) AS child_cols,
           (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(cn.confkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = cn.confrelid AND a.attnum = k.attnum) AS parent_cols
      FROM pg_constraint cn
      JOIN pg_class r ON r.oid = cn.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
      JOIN pg_class pr ON pr.oid = cn.confrelid JOIN pg_namespace pn ON pn.oid = pr.relnamespace
     WHERE cn.contype = 'f' AND n.nspname IN ('keystone', 'keystone_auth')`);
  const byParent = new Map();
  for (const r of rows) {
    const pc = r.parent_cols.filter((c) => c !== "tenant_id");
    const cc = r.child_cols.filter((c) => c !== "tenant_id");
    if (pc.length !== 1 || pc[0] !== "id" || cc.length !== 1) continue;       // every record FK points at (…, id)
    if (r.parent === "keystone.tenant") continue;
    if (!r.readable) continue;     // a table the request role cannot read cannot be counted; the database still cascades it
    const list = byParent.get(r.parent) ?? [];
    list.push({ child: r.child, col: cc[0], rule: r.rule });
    byParent.set(r.parent, list);
  }
  fkCache = byParent;
  return byParent;
}
export function __resetForeignKeyCacheForTests() { fkCache = null; }

const ROW_CAP = 20000;

// ★ ISLAND-PROGRAMS §2 — which tables sit behind the audited `keystone.record_delete_reason` guards, and which
//   record TYPES are those tables' own, is DECLARED BY DOCUMENTS (src/documents/domain.mjs), not named here.
const GUARDED_TABLES = new Set((DOCUMENTS_DOMAIN.deleteGuardTables ?? []).map((t) => `keystone.${t}`));
const GUARDED_TYPES = new Set(DOCUMENTS_DOMAIN.deleteGuardOverride ? Object.keys(DOCUMENTS_DOMAIN.deletable) : []);

/**
 * Can deleting a row of `table` reach a table behind the audited override — by CASCADE, or by the SET NULL of an
 * immutable table's own column (signature_record.signer_uid)? Answered from the foreign-key SCHEMA, not from counted
 * rows: the plan's counts only see rows the viewer may read, and the database guard fires on rows the viewer cannot.
 */
async function reachesGuardedTable(tx, table) {
  if (GUARDED_TABLES.size === 0) return false;
  const fks = await loadForeignKeys(tx);
  const seenTables = new Set([`keystone.${table}`]);
  let frontier = [`keystone.${table}`];
  for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
    const next = [];
    for (const parent of frontier) {
      for (const fk of fks.get(parent) ?? []) {
        if (fk.rule !== "c" && fk.rule !== "n") continue;
        if (GUARDED_TABLES.has(fk.child)) return true;
        if (fk.rule === "c" && !seenTables.has(fk.child)) { seenTables.add(fk.child); next.push(fk.child); }
      }
    }
    frontier = next;
  }
  return false;
}

/** Walk the CASCADE edges from one row; count what would go, and what (RESTRICT/NO ACTION) would refuse it. */
async function walk(tx, table, id) {
  const fks = await loadForeignKeys(tx);
  const cascades = new Map();          // table -> count
  const blockers = new Map();          // "child.col" -> { table, count }
  let seen = 0;
  let frontier = [{ table: `keystone.${table}`, ids: [id] }];
  for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
    const next = [];
    for (const { table: parent, ids } of frontier) {
      for (const fk of fks.get(parent) ?? []) {
        if (fk.rule === "n") continue;                                        // SET NULL: the child stays
        const isParent = fks.has(fk.child);
        if (fk.rule === "c" && isParent) {
          const { rows } = await tx.query(`SELECT id FROM ${fk.child} WHERE ${fk.col} = ANY($1::uuid[]) LIMIT ${ROW_CAP}`, [ids]);
          if (rows.length === 0) continue;
          seen += rows.length;
          cascades.set(fk.child, (cascades.get(fk.child) ?? 0) + rows.length);
          next.push({ table: fk.child, ids: rows.map((r) => r.id) });
        } else {
          const { rows } = await tx.query(`SELECT count(*)::int AS n FROM ${fk.child} WHERE ${fk.col} = ANY($1::uuid[])`, [ids]);
          const n = rows[0].n;
          if (n === 0) continue;
          if (fk.rule === "c") { cascades.set(fk.child, (cascades.get(fk.child) ?? 0) + n); seen += n; }
          else blockers.set(`${fk.child}.${fk.col}`, { table: fk.child.replace(/^keystone(_auth)?\./, ""), count: n });
        }
        if (seen > ROW_CAP) throw conflict("That record has too much attached to it to delete in one step.");
      }
    }
    frontier = next;
  }
  return {
    alsoRemoves: [...cascades.entries()].map(([t, n]) => ({ table: t.replace(/^keystone(_auth)?\./, ""), count: n })),
    blockers: [...blockers.values()],
  };
}

const LABEL_COLUMNS = ["display_name", "name", "title", "invoice_number", "code", "email", "slug"];

async function loadRow(tx, entry, id) {
  const { rows } = await tx.query(
    `SELECT * FROM keystone.${entry.view ?? entry.table} WHERE id = $1${entry.where ? ` AND ${entry.where}` : ""}`, [id]);
  return rows[0] ?? null;
}

/** Whose record is it? A real client's money is never deletable (the Example Client guard, for Stripe's own rows too). */
async function protectedOwner(tx, entry, row) {
  let personId = entry.person ? row[entry.person] : null;
  if (!personId && entry.viaPayment && row.payment_id) {
    personId = (await tx.query(`SELECT payer_user_id FROM keystone.payment_effective WHERE id = $1`, [row.payment_id])).rows[0]?.payer_user_id;
  }
  if (!personId && entry.viaInvoice && row.invoice_id) {
    personId = (await tx.query(`SELECT payer_user_id FROM keystone.invoice_effective WHERE id = $1`, [row.invoice_id])).rows[0]?.payer_user_id;
  }
  if (!personId) return false;
  const { rows } = await tx.query(`SELECT protected_real_client FROM keystone.app_user WHERE id = $1`, [personId]);
  return rows[0]?.protected_real_client === true;
}

const money = (minor, cur = "USD") => `${(Number(minor) / 100).toLocaleString("en-US", { style: "currency", currency: cur || "USD" })}`;
const labelOf = (row, entry) => {
  if (entry?.view) {
    const amt = row.amount_minor ?? row.total_minor ?? row.snapshot_amount_minor;
    if (amt != null) return `${entry.noun} of ${money(amt, row.currency)}`;
  }
  for (const c of LABEL_COLUMNS) if (typeof row?.[c] === "string" && row[c].trim()) return row[c].trim();
  return null;
};

// ─── the Stripe half, for the few record types that have one ─────────────────────────────────────────────────
// Each half has `plan` (what we will do / what blocks it — read-only, no Stripe call) and `after` (the calls, run
// AFTER the database delete succeeded inside the same transaction: if Stripe then fails the transaction rolls
// back and nothing was deleted anywhere).
const STRIPE_HALVES = {
  person: {
    async plan(tx, { tenantId, row, options }) {
      if (!row.stripe_customer_id) return { notes: [], blockers: [], context: {} };
      const open = await tx.query(
        `SELECT id, stripe_invoice_id FROM keystone.invoice_effective
          WHERE tenant_id = $1 AND payer_user_id = $2 AND status = 'open'`, [tenantId, row.id]);
      const subs = await tx.query(
        `SELECT stripe_subscription_id FROM keystone.subscription_effective
          WHERE tenant_id = $1 AND app_user_id = $2 AND state IN ('active','past_due')`, [tenantId, row.id]);
      const blockers = []; const notes = [];
      if (options.deleteStripeCustomer === true) {
        if (open.rows.length) notes.push(`${open.rows.length} open invoice${open.rows.length === 1 ? "" : "s"} will be voided in Stripe`);
        if (subs.rows.length) notes.push(`${subs.rows.length} subscription${subs.rows.length === 1 ? "" : "s"} will be cancelled in Stripe`);
        notes.push("their Stripe customer will be deleted");
      } else {
        if (open.rows.length) blockers.push({ what: "open invoices", count: open.rows.length, hint: "Void or settle them first — or choose to also delete them in Stripe." });
        if (subs.rows.length) blockers.push({ what: "active subscriptions", count: subs.rows.length, hint: "Cancel them first — or choose to also delete them in Stripe." });
        if (!blockers.length) notes.push("their Stripe customer is kept (you can choose to delete it too)");
      }
      return { notes, blockers, context: { customerId: row.stripe_customer_id, openInvoices: open.rows, subs: subs.rows } };
    },
    async after(tx, { tenantId, actorUserId, options, context }) {
      if (options.deleteStripeCustomer !== true || !context.customerId) return null;
      let voided = 0;
      for (const inv of context.openInvoices) {
        if (!inv.stripe_invoice_id) continue;
        await stripeConnectedRequest(tx, {
          tenantId, method: "POST", path: `/invoices/${inv.stripe_invoice_id}/void`,
          sdk: (s, o) => s.invoices.voidInvoice(inv.stripe_invoice_id, {}, o),
          form: {}, movesMoney: false, purpose: "delete_person_void_invoice", actorUserId,
        });
        voided += 1;
      }
      await stripeConnectedRequest(tx, {
        tenantId, method: "DELETE", path: `/customers/${context.customerId}`,
        sdk: (s, o) => s.customers.del(context.customerId, {}, o),
        movesMoney: false, purpose: "delete_person_customer", actorUserId,
      });
      return { customerDeleted: context.customerId, invoicesVoided: voided };
    },
  },
  catalogue: {
    async plan(tx, { tenantId, row, entry }) {
      const prices = await tx.query(
        `SELECT stripe_price_id FROM keystone.price
          WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND stripe_price_id IS NOT NULL AND stripe_archived_at IS NULL`,
        [tenantId, entry.subjectType, row.id]);
      const notes = [];
      if (prices.rows.length || row.stripe_product_id) notes.push("its prices are archived in Stripe and the product is deleted there if Stripe allows it, otherwise archived");
      return { notes, blockers: [], context: { prices: prices.rows.map((r) => r.stripe_price_id), productId: row.stripe_product_id ?? null } };
    },
    async after(tx, { tenantId, actorUserId, context }) {
      for (const priceId of context.prices) {
        await stripeConnectedRequest(tx, {
          tenantId, method: "POST", path: `/prices/${priceId}`,
          sdk: (s, o) => s.prices.update(priceId, { active: false }, o), form: { active: "false" },
          movesMoney: false, purpose: "delete_catalogue_archive_price", actorUserId,
        });
      }
      if (!context.productId) return { pricesArchived: context.prices.length };
      let product = "deleted";
      try {
        await stripeConnectedRequest(tx, {
          tenantId, method: "DELETE", path: `/products/${context.productId}`,
          sdk: (s, o) => s.products.del(context.productId, {}, o),
          movesMoney: false, purpose: "delete_catalogue_delete_product", actorUserId,
        });
      } catch {
        // Stripe refuses to delete a product that ever had a price — archive it instead ("delete if allowed").
        await stripeConnectedRequest(tx, {
          tenantId, method: "POST", path: `/products/${context.productId}`,
          sdk: (s, o) => s.products.update(context.productId, { active: false }, o), form: { active: "false" },
          movesMoney: false, purpose: "delete_catalogue_archive_product", actorUserId,
        });
        product = "archived";
      }
      return { pricesArchived: context.prices.length, product };
    },
  },
};

// ─── rows that point at a record WITHOUT a foreign key (polymorphic subject_type/subject_id) ─────────────────
const POLYMORPHIC = Object.freeze({
  service: [["price", "subject_type", "subject_id", "service"]],
  package: [["price", "subject_type", "subject_id", "package"]],
  plan:    [["price", "subject_type", "subject_id", "plan"]],
});

/**
 * ★ THE PLAN — read-only. Safe to call on every confirm-dialog open.
 * @returns {Promise<{object,id,noun,label,canDelete,blockers:{what,count,hint?}[],alsoRemoves:{what,count}[],notes:string[]}>}
 */
export async function planDeleteRecord(tx, { tenantId, object, id, options = {}, actorUserId = null }) {
  if (!tenantId) throw invalid("a tenantId is required");
  if (!id) throw invalid("the id of the record to delete is required");
  const entry = DELETABLE[object];
  if (!entry) throw invalid(`"${object}" cannot be deleted — the deletable record types are ${DELETABLE_TYPES.join(", ")}`);

  const row = await loadRow(tx, entry, id);
  if (!row) throw notFound(`no ${entry.noun} ${id} exists in this practice`);
  if (entry.table === "app_user" && actorUserId && actorUserId === id) throw conflict("You can't delete your own account.");

  // counted as the practice Owner, not through the actor's own row visibility — same reasoning as archive's F789
  const hasOwnRow = entry.view ? (await tx.query(`SELECT 1 FROM keystone.${entry.table} WHERE id = $1`, [id])).rowCount > 0 : true;
  const graph = hasOwnRow
    ? await asPracticeOwner(tx, tenantId, () => walk(tx, entry.table, id))
    : { alsoRemoves: [], blockers: [] };
  const blockers = graph.blockers.map((b) => ({ what: nounFor(b.table, b.count), count: b.count }));
  // a real client's own record (the Example Client guard) — say so BEFORE the confirm button, not as a DB error after it
  if (isQaLoginUid(row.firebase_uid)) blockers.push({ what: "QA sign-in account", count: 1, hint: QA_LOGIN_REFUSAL });
  if (row.protected_real_client === true) blockers.push({ what: "real client record", count: 1, hint: "A real client's record is read-only and can't be deleted." });
  if (entry.view) {
    if (await asPracticeOwner(tx, tenantId, () => protectedOwner(tx, entry, row))) {
      blockers.push({ what: "real client record", count: 1, hint: "A real client's money is read-only." });
    }
    if (entry.mustBeInactive && row.state && !["cancelled", "ended"].includes(row.state)) {
      blockers.push({ what: "live subscription", count: 1, hint: "Cancel it first." });
    }
  }
  const notes = [];
  // QUEUE §23.3.6 — a signed document inside its retention window cannot be deleted (Documents says which, and why)
  if (entry.retention === true) blockers.push(...await asPracticeOwner(tx, tenantId, () => documentDeleteBlockers(tx, { instanceId: id })));
  // …and deleting a PERSON keeps their signed documents (detached, name and email stay on the record) and removes only their unsigned ones
  const personDocs = entry.table === "app_user" ? await asPracticeOwner(tx, tenantId, () => personDeleteDocumentPlan(tx, { personId: id })) : null;
  if (personDocs?.kept) notes.push(`${personDocs.kept} signed document${personDocs.kept === 1 ? " is" : "s are"} legal records and will be KEPT — no longer linked to this person; their name and email stay on the signed record`);
  if (personDocs?.removed) graph.alsoRemoves.push({ table: "document_instance", count: personDocs.removed });
  let context = {};
  const half = entry.stripe ? STRIPE_HALVES[entry.stripe] : null;
  if (half) {
    const p = await asPracticeOwner(tx, tenantId, () => half.plan(tx, { tenantId, row, entry, options }));
    blockers.push(...p.blockers); notes.push(...p.notes); context = p.context;
  }
  if (entry.note) notes.push(entry.note);
  const hidesOnly = Boolean(entry.view && row.origin === "stripe");
  if (hidesOnly) notes.push(`Stripe keeps its own copy; it is only removed from Workbench's view`);
  const planOut = {
    object, id, noun: entry.noun, label: labelOf(row, entry) ?? `this ${entry.noun}`,
    canDelete: blockers.length === 0,
    blockers,
    alsoRemoves: graph.alsoRemoves.map((a) => ({ what: nounFor(a.table, a.count), count: a.count })),
    notes,
    _row: row, _context: context, _entry: entry,
  };
  // non-enumerable on purpose: callers that spread the plan (records/bulk.mjs) must not see it
  Object.defineProperty(planOut, "_touchesGuarded", { value: await reachesGuardedTable(tx, entry.table), enumerable: false });
  return planOut;
}

/**
 * ★ DELETE A RECORD — the route's handler. Without `confirm: true` it only returns the plan (the confirm
 *   dialog's content); with it, it deletes. Owner/Admin only (the route's `record.archive` gate).
 */
export async function deleteRecord(tx, {
  tenantId, object, id, confirm = false, reason = null, options = {}, actorUserId = null, requestId = null,
}) {
  const plan = await planDeleteRecord(tx, { tenantId, object, id, options: options ?? {}, actorUserId });
  const { _row: row, _context: context, _entry: entry, ...visible } = plan;
  const touchesGuarded = plan._touchesGuarded === true;
  if (confirm !== true) return { ...visible, deleted: false };
  if (!plan.canDelete) {
    const why = plan.blockers.map((b) => `${b.count} ${b.what}`).join(", ");
    throw conflict(`Can't delete this ${entry.noun}: ${why} still ${plan.blockers.length === 1 && plan.blockers[0].count === 1 ? "depends" : "depend"} on it.`);
  }
  const keptReason = normaliseReason(reason) ?? `${entry.noun} deleted`;

  if (entry.before === "booking") {
    // a session that held OR consumed a credit gives it back before it disappears — any state (credits defect 19: a consumed
    // credit's booking pointer is cleared by the FK rule, which its CHECK forbids unless the credit is returned first)
    await returnCreditsForBooking(tx, { tenantId, bookingId: id, reason: "the session was deleted" });
  }

  // the audited override the e-sign guards honour — transaction-local, set ONLY here, and ONLY when the record being
  // deleted is one of Documents' own types, or its cascade / SET NULL reaches a table Documents guards (a person's
  // executed documents and signatures go with them). Which types and tables those are is Documents' declaration.
  const needsGuardOverride = GUARDED_TYPES.has(object) || touchesGuarded === true;
  if (needsGuardOverride) await tx.query(`SELECT set_config('keystone.record_delete_reason', $1, true)`, [keptReason]);
  try {
    // a person's unsigned documents go with them; their signed ones stay (the database detaches them: subject_user_id → NULL) — QUEUE §23.3.6
    if (entry.table === "app_user") await prepareDocumentsForPersonDelete(tx, { tenantId, personId: id });
    for (const [tbl, typeCol, idCol, type] of POLYMORPHIC[object] ?? []) {
      await tx.query(`DELETE FROM keystone.${tbl} WHERE tenant_id = $1 AND ${typeCol} = $2 AND ${idCol} = $3`, [tenantId, type, id]);
    }
    const { rowCount } = await tx.query(
      `DELETE FROM keystone.${entry.table} WHERE id = $1${entry.where ? ` AND ${entry.where}` : ""}`, [id]);
    if (rowCount === 0 && !entry.view) throw notFound(`no ${entry.noun} ${id} is available to delete here`);
    if (entry.view && row.origin === "stripe" && row[entry.stripeCol]) {
      // Stripe's own record: hide it from the platform's view (idempotent), never touch Stripe
      await tx.query(
        `INSERT INTO keystone.stripe_hidden (tenant_id, stripe_id, kind, hidden_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [tenantId, row[entry.stripeCol], object, actorUserId]);
    }
  } catch (err) {
    if (err?.name === "AppError") throw err;
    if (err?.code === "23503") throw conflict(`Can't delete this ${entry.noun}: other records still depend on it.`);
    if (err?.code === "23514" || err?.code === "42501") throw forbidden(err.message);
    throw err;
  }
  // (on a failed DELETE the transaction is aborted and rolls back, taking the transaction-local setting with it;
  //  on success the override is switched off before anything else runs)
  if (needsGuardOverride) await tx.query(`SELECT set_config('keystone.record_delete_reason', '', true)`);

  // the Stripe half runs only now that the database delete has gone through; a Stripe failure throws, and the
  // whole transaction — the delete included — rolls back
  const half = entry.stripe ? STRIPE_HALVES[entry.stripe] : null;
  const stripeDone = half ? await half.after(tx, { tenantId, actorUserId, options: options ?? {}, context, entry, row }) : null;

  await writeAudit(tx, {
    tenantId, action: "record.deleted", object, subjectId: id, actorUserId, requestId, reason: keptReason,
    before: { label: plan.label, noun: entry.noun },
    after: { also_removed: plan.alsoRemoves.map((a) => `${a.count} ${a.what}`), stripe: stripeDone ? JSON.stringify(stripeDone) : null },
  });

  return { ...visible, deleted: true, stripe: stripeDone };
}
