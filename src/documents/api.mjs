// src/documents/api.mjs — THE ONE DOOR other systems use to read or write a document table.
//
// ★★★ the maintainer's ruling, 27 Sep 2026: documents is walled off because it becomes a resellable product on
//   its own. Nothing outside src/documents/ may import kysely/pg and query a document_* table
//   directly — it calls one of these functions instead. Design each one as if it were the public
//   surface of a product someone else's code depends on, because one day it will be.
import { run, db } from "../db/kysely.mjs";
import { createDocumentCategory, createDocumentType } from "./writes.mjs";
import { SIGNER_CONFIGS } from "./vocabulary.mjs";
import { scoped } from "../records/lists/_shared.mjs";   // generic viewer-scope predicate used by every domain (declared in the wall gate; built at import time by records/lists.mjs, so it cannot wait for a port)

/** The template's own builder + name (relocated verbatim from createBooking.mjs:439-443). */
export async function templateBuilderAndName(tx, { tenantId, templateId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_template")
    .select(["builder", "name"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", templateId));
  return rows[0] ?? null;
}

/** Point an existing instance at the booking it holds (relocated verbatim from createBooking.mjs:448-452,
 *  R15's own ruling: the pointer lives on the DOCUMENT, never on the booking — I29). */
export async function pointHoldAtBooking(tx, { tenantId, instanceId, bookingId }) {
  await run(tx, db
    .updateTable("keystone.document_instance")
    .set({ booking_id: bookingId ?? null, hold_booking_id: bookingId ?? null })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", instanceId));
}

/** The booking id an EXECUTED instance holds, or null (relocated verbatim from holds.mjs:36-42). */
export async function heldBookingIdFor(tx, { tenantId, instanceId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_instance")
    .select("hold_booking_id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", instanceId)
    .where("hold_booking_id", "is not", null));
  return rows[0]?.hold_booking_id ?? null;
}

/** currentExecutedInstance — relocated verbatim from requirements.mjs:60-95, unchanged query text and
 *  unchanged doc comment (kept there in requirements.mjs as a re-export; see task D1's own field 4). */
export async function currentExecutedInstance(tx, { tenantId, templateId, personId }) {
  const { rows } = await tx.query(
    `WITH ref AS (
        SELECT builder, name, re_sign_months
          FROM keystone.document_template
         WHERE tenant_id = $1 AND id = $2
      ),
      floor AS (
        SELECT COALESCE(MAX(dt.version), 1) AS min_version
          FROM keystone.document_template dt, ref
         WHERE dt.tenant_id = $1
           AND dt.builder = ref.builder
           AND lower(dt.name) = lower(ref.name)
           AND dt.material = true
      )
      SELECT di.id
        FROM keystone.document_instance di
        JOIN keystone.document_template dt
          ON dt.tenant_id = di.tenant_id AND dt.id = di.template_id
        CROSS JOIN ref
        CROSS JOIN floor
       WHERE di.tenant_id = $1
         AND di.subject_user_id = $3
         AND di.state = 'executed'
         AND di.archived_at IS NULL
         AND dt.builder = ref.builder
         AND lower(dt.name) = lower(ref.name)
         AND dt.version >= floor.min_version
         AND (ref.re_sign_months IS NULL
              OR di.executed_at > now() - make_interval(months => ref.re_sign_months))
       ORDER BY di.executed_at DESC
       LIMIT 1`,
    [tenantId, templateId, personId]);
  if (rows.length === 0) return null;
  return { instanceId: rows[0].id };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ DOCUSTAY WALL FIX (recon+build round, 29 Sep 2026) — two more real crossings found by audit,
//   same shape as the four already fixed above: `items/agreements.mjs` and `items/editors.mjs`
//   each queried `document_instance`/`document_template` directly. Both are relocated here
//   VERBATIM (same WHERE clauses, same columns) — only the caller changes, not the query.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** The most recent EXECUTED, unarchived instance of this exact template for this subject, or null.
 *  Relocated verbatim from items/agreements.mjs's own `hasExecutedAgreement` (the query half only —
 *  that file still owns `item_agreement_requirement`, an ITEMS table, and still decides what "no
 *  instance" means for a purchase gate; this function only answers "does one exist"). */
export async function executedInstanceForTemplate(tx, { tenantId, templateId, subjectUserId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_instance")
    .select(["id"])
    .where("tenant_id", "=", tenantId)
    .where("template_id", "=", templateId)
    .where("subject_user_id", "=", subjectUserId)
    .where("state", "=", "executed")
    .where("archived_at", "is", null)
    .orderBy("executed_at", "desc")
    .limit(1));
  if (rows.length === 0) return null;
  return { instanceId: rows[0].id };
}

/** `{ [templateId]: name }` for a batch of template ids — relocated verbatim from
 *  items/editors.mjs's own agreement-display JOIN (the name lookup half only; the
 *  `item_agreement_requirement` row itself is still items/editors.mjs's own query, an ITEMS table).
 *  Ids that don't resolve (a null teen_template_id, most commonly) are simply absent from the
 *  result — the caller already treats "no name" as "no such template" either way. */
export async function templateNamesByIds(tx, { tenantId, ids }) {
  const cleanIds = (ids ?? []).filter((id) => id !== null && id !== undefined);
  if (cleanIds.length === 0) return {};
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_template")
    .select(["id", "name"])
    .where("tenant_id", "=", tenantId)
    .where("id", "in", cleanIds));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ DOCUSTAY WALL FIX, ROUND 2 (29 Sep 2026) — db/gates/documents_wall.mjs's new SQL/kysely
//   detection found 39 direct document_*/signature_record crossings across 18 files the import-only
//   version could not see. Each function below is relocated verbatim from its one real caller (named
//   in its own doc comment) — same WHERE clauses, same columns, same order, only the caller changes.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Count of distinct executed instances with at least one signature in the given period —
 *  relocated verbatim from billing/usageProviders.mjs's `esignAdapter` (the ESIGN usage metric). */
export async function esignExecutionCount(tx, { tenantId, periodStart, periodEnd }) {
  const { rows } = await tx.query(
    `SELECT COUNT(DISTINCT di.id) as count
     FROM keystone.document_instance di
     INNER JOIN keystone.signature_record sr ON sr.instance_id = di.id
     WHERE di.tenant_id = $1
       AND di.state = 'executed'
       AND sr.created_at >= $2
       AND sr.created_at < $3`,
    [tenantId, periodStart, periodEnd]);
  return parseInt(rows[0]?.count ?? 0, 10);
}

/** A brand-new Documents-only workspace has no document types, and without one nothing can be uploaded or sent. Give it ONE neutral type ("Document") once; an organisation that already has any type is left alone. */
export async function ensureDefaultDocumentType(tx, { tenantId }) {
  const { rows } = await tx.query(`SELECT 1 FROM keystone.document_type WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  if (rows.length) return { created: false };
  const cat = await createDocumentCategory(tx, { tenantId, key: "general", label: "General" });
  await createDocumentType(tx, {
    tenantId, key: "document", label: "Document", categoryId: cat.id, subCategory: "general", signerConfig: "CLIENT_ONLY",
    audience: ["staff", "adult_client", "adolescent_client", "parent"], division: "tech", appliesTo: ["adult_client", "adolescent_client", "parent", "staff"], defaultAssignedTo: ["client"],
  });
  return { created: true };
}

/** How many documents (a package counts once) this organisation SENT in the period — what a plan's monthly document limit counts. Run 8 (the maintainer): a FORM counts too, once, in the month it is
 *  first published (`document_form_publication`), and so does every SIGNED response (as before). */
export async function sendCountForPeriod(tx, { tenantId, periodStart, periodEnd }) {
  // R13-D512: the month's count is the WORKSPACE's, whoever is asking. A Member sees only their own documents through row visibility, so their count (and the price the Send step showed) was short.
  const { asPracticeOwner } = await import("../money/asPracticeOwner.mjs");
  try { return await asPracticeOwner(tx, tenantId, (otx) => sendCountForPeriodRaw(otx, { tenantId, periodStart, periodEnd })); }
  catch (e) { if (!/No practice owner found/.test(String(e?.message))) throw e; return sendCountForPeriodRaw(tx, { tenantId, periodStart, periodEnd }); }
}
async function sendCountForPeriodRaw(tx, { tenantId, periodStart, periodEnd }) {
  const { rows: [fp] } = await tx.query(`SELECT count(*)::int AS n FROM keystone.document_form_publication WHERE tenant_id = $1 AND first_published_at >= $2 AND first_published_at < $3`, [tenantId, periodStart, periodEnd]);
  const { rows } = await tx.query(
    `SELECT COUNT(*)::int AS n FROM keystone.document_instance
      WHERE tenant_id = $1 AND sent_at >= $2 AND sent_at < $3 AND (package_lead_id IS NULL OR package_lead_id = id) AND NOT is_test
        AND NOT (coalesce(source_channel, '') = 'form' AND executed_at IS NULL AND coalesce((SELECT p.status FROM keystone.document_party p WHERE p.instance_id = document_instance.id AND p.action_role = 'signer' ORDER BY p.position LIMIT 1), '') NOT IN ('signed','approved'))`, [tenantId, periodStart, periodEnd]);
  // 21 Oct 2026 (pricing integrity): a sent document that was later DELETED (deleting a Contact deletes its unsigned sent documents) still counts: a line stays when it goes (migration 0769), so deleting cannot reset the month
  const { rows: [tomb] } = await tx.query(`SELECT count(*)::int AS n FROM keystone.document_send_tombstone WHERE tenant_id = $1 AND sent_at >= $2 AND sent_at < $3 AND counted`, [tenantId, periodStart, periodEnd]);
  return (rows[0]?.n ?? 0) + (fp?.n ?? 0) + (tomb?.n ?? 0);
}
/** FREE SIGNERS (the maintainer, 21 Oct 2026): the distinct email addresses this workspace has sent a document to in the period. A practice (test) send counts nobody; a team member who is a recipient (an internal send) counts nobody;
 *  the same person on several documents counts once. Read from the parties of the documents sent in the window, so a resend to someone already counted adds nothing. No table of its own. */
export async function signersInPeriod(tx, { tenantId, periodStart, periodEnd }) {
  // R13-D512 (same class): the cap counts the WORKSPACE's signers, not the documents this viewer can see
  try { const { asPracticeOwner } = await import("../money/asPracticeOwner.mjs"); return await asPracticeOwner(tx, tenantId, (otx) => signersInPeriodRaw(otx, { tenantId, periodStart, periodEnd })); }
  catch (e) { if (!/No practice owner found/.test(String(e?.message))) throw e; return signersInPeriodRaw(tx, { tenantId, periodStart, periodEnd }); }
}
async function signersInPeriodRaw(tx, { tenantId, periodStart, periodEnd }) {
  const { rows } = await tx.query(
    `SELECT DISTINCT lower(p.email) AS email FROM keystone.document_party p JOIN keystone.document_instance i ON i.id = p.instance_id
      WHERE i.tenant_id = $1 AND i.sent_at >= $2 AND i.sent_at < $3 AND NOT i.is_test AND p.email IS NOT NULL AND p.email <> ''
        AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.tenant_id = i.tenant_id AND u.role = 'staff' AND u.lifecycle_status <> 'former' AND lower(u.email) = lower(p.email))`, [tenantId, periodStart, periodEnd]);
  // and the people of documents that were deleted after they were sent (the tombstone keeps their addresses, never a name or a file)
  const { rows: gone } = await tx.query(
    `SELECT DISTINCT e AS email FROM keystone.document_send_tombstone t, unnest(t.emails) AS e
      WHERE t.tenant_id = $1 AND t.sent_at >= $2 AND t.sent_at < $3
        AND NOT EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.tenant_id = t.tenant_id AND u.role = 'staff' AND u.lifecycle_status <> 'former' AND lower(u.email) = e)`, [tenantId, periodStart, periodEnd]);
  return [...new Set([...rows.map((r) => r.email), ...gone.map((r) => r.email)])];
}
/** Of these addresses, the ones that would be NEW signers this period: not a team member, not already counted. Lower-cased and de-duplicated. */
export async function newSignersAmong(tx, { tenantId, emails, periodStart, periodEnd }) {
  const wanted = [...new Set((emails ?? []).map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return { used: (await signersInPeriod(tx, { tenantId, periodStart, periodEnd })).length, fresh: [] };
  const counted = new Set(await signersInPeriod(tx, { tenantId, periodStart, periodEnd }));
  const { rows } = await tx.query(`SELECT lower(email) AS email FROM keystone.app_user WHERE tenant_id = $1 AND role = 'staff' AND lifecycle_status <> 'former' AND lower(email) = ANY($2::text[])`, [tenantId, wanted]);
  const team = new Set(rows.map((r) => r.email));
  return { used: counted.size, fresh: wanted.filter((e) => !counted.has(e) && !team.has(e)) };
}
/** Run 8: the Free plan's monthly template cap reads the island's insert-only ledger through this door (see templateCap.mjs). */
export { templateCreationsInPeriod } from "./templateCap.mjs";

/** Count of non-draft instances created for this subject since the given date — relocated verbatim
 *  from growth/leadScoring.mjs (the "document interaction" lead-score factor). */
export async function recentInstanceCountFor(tx, { tenantId, subjectUserId, since }) {
  const { rows } = await tx.query(
    `SELECT count(*) as cnt FROM keystone.document_instance
      WHERE tenant_id = $1 AND subject_user_id = $2 AND state != 'draft'
        AND created_at > $3`,
    [tenantId, subjectUserId, since]);
  return Number(rows[0]?.cnt ?? 0);
}

/** `{ [subjectUserId]: count }` of open (draft/sent/partially_signed) instances per subject —
 *  relocated from people/offboard.mjs's `getOffboardPreview`. The original computed this as an
 *  inline correlated subquery ADDED to a booking-open-count in one SELECT per client row; split
 *  here into its own grouped query (the caller now sums the two counts in JS) since a wall function
 *  cannot itself reach into booking's own table the way the combined subquery did. Same final
 *  per-client number, different query shape. */
export async function openInstanceCountsBySubject(tx, { subjectUserIds }) {
  if (!subjectUserIds?.length) return {};
  const { rows } = await tx.query(
    `SELECT subject_user_id, count(*)::int AS n
       FROM keystone.document_instance
      WHERE subject_user_id = ANY($1::uuid[])
        AND state IN ('draft', 'sent', 'partially_signed')
      GROUP BY subject_user_id`,
    [subjectUserIds]);
  return Object.fromEntries(rows.map((r) => [r.subject_user_id, r.n]));
}

/** Instances awaiting a countersignature (state='partially_signed') whose subject's owner is this
 *  staff member — relocated verbatim from people/offboard.mjs's `getOffboardPreview`. The
 *  `app_user` join is on the SUBJECT (a shared, not documents-owned, table) purely to filter by
 *  owner — the same shape templateNamesByIds and others already accept a caller-supplied id list
 *  for, just expressed as a join here since the original was one query, not two. */
export async function pendingCountersignaturesFor(tx, { ownerUserId }) {
  const { rows } = await tx.query(
    `SELECT d.id AS "documentId", d.title, p.display_name AS "clientName"
       FROM keystone.document_instance d
       JOIN keystone.person_directory p ON p.id = d.subject_user_id
      WHERE p.owner_user_id = $1 AND d.state = 'partially_signed'
      ORDER BY d.sent_at`,
    [ownerUserId]);
  return rows;
}

/** Count of session-note instances authored by this staff member — relocated verbatim from
 *  people/offboard.mjs's `getOffboardPreview`. */
export async function sessionNoteCountAuthoredBy(tx, { authorUserId }) {
  const { rows } = await tx.query(
    `SELECT count(*)::int AS n
       FROM keystone.document_instance d
       JOIN keystone.document_type dtp ON dtp.id = d.type_id
      WHERE d.created_by = $1 AND dtp.is_session_note = true`,
    [authorUserId]);
  return rows[0]?.n ?? 0;
}

/** Distinct executed-instance subjects whose frozen snapshot text matches any of these ILIKE
 *  patterns — relocated verbatim from settings/reach.mjs's `mismatchSigners` (a setting-change
 *  reach check: "who signed something naming the OLD value of this setting"). */
export async function executedSubjectsMatchingSnapshotText(tx, { tenantId, patterns }) {
  const { rows } = await tx.query(
    `SELECT DISTINCT subject_user_id AS id
       FROM keystone.document_instance
      WHERE tenant_id = $1 AND state = 'executed' AND subject_user_id IS NOT NULL
        AND template_snapshot::text ILIKE ANY($2::text[])`,
    [tenantId, patterns]);
  return rows.map((r) => r.id);
}

/** Total instance count for this subject — relocated verbatim from people/recordTabs.mjs's own
 *  "archived person" stats block. */
export async function totalInstanceCountFor(tx, { subjectUserId }) {
  const { rows } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.document_instance WHERE subject_user_id = $1`,
    [subjectUserId]);
  return rows[0]?.n ?? 0;
}

/** Up to 3 latest session-note instances for this subject, with the author's display name —
 *  relocated verbatim from people/recordTabs.mjs (the person record's "Documents" tab, notes
 *  preview). Relies on the SAME ambient RLS the original comment describes (document_is_visible,
 *  0194 §B, via the request's already-set keystone.user_id) rather than a hand-written predicate —
 *  unchanged from the original. */
export async function sessionNotesPreviewFor(tx, { subjectUserId }) {
  const { rows } = await tx.query(
    `SELECT d.id, d.title, d.created_at, author.display_name AS author_name
       FROM keystone.document_instance d
       LEFT JOIN keystone.person_directory author ON author.id = d.created_by
       LEFT JOIN keystone.document_type dtp ON dtp.id = d.type_id
      WHERE d.subject_user_id = $1 AND dtp.is_session_note = true
      ORDER BY d.created_at DESC
      LIMIT 3`,
    [subjectUserId]);
  return rows;
}

// the signer configs that ask a parent/guardian to sign (F127): a document about a teen with one of these also belongs on the parent's record
const PARENT_SIGNED_CONFIGS = Object.freeze(Object.entries(SIGNER_CONFIGS).filter(([, order]) => order.includes("parent")).map(([k]) => k));

/** Up to 50 most-recently-executed instances for this subject, with the template's version at read
 *  time — relocated verbatim from people/recordTabs.mjs. `parentOf` (F127): the ids of the teens this person is the parent of; a
 *  parent-signed document about one of them shows on the parent's record too. */
export async function signedInstancesFor(tx, { subjectUserId, parentOf = [] }) {
  const { rows } = await tx.query(
    `SELECT d.id, d.title, d.executed_at, dt.version
       FROM keystone.document_instance d
       LEFT JOIN keystone.document_template dt ON dt.id = d.template_id
       LEFT JOIN keystone.document_type ty ON ty.id = d.type_id
      WHERE (d.subject_user_id = $1 OR (d.subject_user_id = ANY($2::uuid[]) AND ty.signer_config = ANY($3::text[])))
        AND d.state = 'executed'
      ORDER BY d.executed_at DESC
      LIMIT 50`,
    [subjectUserId, parentOf ?? [], PARENT_SIGNED_CONFIGS]);
  return rows;
}

/** Up to 50 most-recently-sent instances still awaiting a signature for this subject — relocated
 *  verbatim from people/recordTabs.mjs. `parentOf` as in signedInstancesFor. */
export async function waitingInstancesFor(tx, { subjectUserId, parentOf = [] }) {
  const { rows } = await tx.query(
    `SELECT d.id, d.title, d.sent_at
       FROM keystone.document_instance d
       LEFT JOIN keystone.document_type ty ON ty.id = d.type_id
      WHERE (d.subject_user_id = $1 OR (d.subject_user_id = ANY($2::uuid[]) AND ty.signer_config = ANY($3::text[])))
        AND d.state IN ('sent', 'partially_signed')
      ORDER BY d.sent_at DESC
      LIMIT 50`,
    [subjectUserId, parentOf ?? [], PARENT_SIGNED_CONFIGS]);
  return rows;
}

/**
 * F124 — the teen agreement's REAL state for one teen, for the record's consent paragraph: the latest live (not voided/declined/expired)
 * parent-signed document about them, and which of its parties have actually signed. `null` when none was ever sent.
 * → { instanceId, title, state, clientSigned, parentSigned, signedBy: [{role, name, signedAt}] } | null
 */
export async function teenAgreementFor(tx, { subjectUserId }) {
  const { rows: [d] } = await tx.query(
    `SELECT d.id, d.title, d.state
       FROM keystone.document_instance d
       JOIN keystone.document_type ty ON ty.id = d.type_id
      WHERE d.subject_user_id = $1 AND ty.signer_config = ANY($2::text[])
        AND d.state IN ('sent', 'partially_signed', 'executed') AND d.archived_at IS NULL
      ORDER BY (d.state = 'executed') DESC, coalesce(d.executed_at, d.sent_at, d.created_at) DESC
      LIMIT 1`,
    [subjectUserId, PARENT_SIGNED_CONFIGS]);
  if (!d) return null;
  const { rows: sigs } = await tx.query(
    `SELECT role, signer_name, signed_at FROM keystone.signature_record WHERE instance_id = $1 ORDER BY signed_at`, [d.id]);
  const roles = new Set(sigs.map((s) => s.role));
  return {
    instanceId: d.id, title: d.title, state: d.state,
    clientSigned: roles.has("client") || roles.has("pir"), parentSigned: roles.has("parent"),
    signedBy: sigs.map((s) => ({ role: s.role, name: s.signer_name, signedAt: s.signed_at })),
  };
}

/**
 * F124 — the person an EXECUTED parent-signed document is about (the teen agreement, signed by the teen and their parent), so the host
 * can record the teen's consent the moment it completes. `null` for any other document, or one not executed.
 */
export async function parentSignedSubjectOf(tx, { instanceId }) {
  if (!instanceId) return null;
  const { rows: [d] } = await tx.query(
    `SELECT d.subject_user_id
       FROM keystone.document_instance d
       JOIN keystone.document_type ty ON ty.id = d.type_id
      WHERE d.id = $1 AND d.state = 'executed' AND ty.signer_config = ANY($2::text[])`,
    [instanceId, PARENT_SIGNED_CONFIGS]);
  return d?.subject_user_id ?? null;
}

/** Whether any instance has ever been sent — relocated verbatim from platform/practiceFacts.mjs
 *  (the "documents used" feature-adoption fact). */
export async function anyInstanceEverSent(tx) {
  const { rows } = await tx.query(`SELECT count(*) as cnt FROM keystone.document_instance WHERE sent_at IS NOT NULL`);
  return parseInt(rows[0]?.cnt ?? 0, 10) > 0;
}

/** Every unsigned (state <> 'executed', unarchived), viewer-scoped instance for any of these
 *  subjects — the document half of prompts/catalogue.mjs's `consent_unsigned_today` (the booking
 *  half stays there; booking is not walled off the way documents is). `scoped("document", alias)`
 *  is the SAME generic viewer-permission predicate every records/lists/*.mjs view already uses
 *  (records/lists/_shared.mjs) — shared infra, not a second domain's own business logic. */
export async function unsignedInstancesForSubjects(tx, { viewerId, subjectUserIds }) {
  if (!subjectUserIds?.length) return [];
  const { rows } = await tx.query(
    `SELECT d.id, d.title, d.state, d.sent_at, d.subject_user_id
       FROM keystone.document_instance d
      WHERE d.archived_at IS NULL AND d.state <> 'executed'
        AND d.subject_user_id = ANY($2::uuid[])
        AND ${scoped("document", "d")}`,
    [viewerId, subjectUserIds]);
  return rows;
}

/** One instance's id/subject/title, or null — relocated verbatim from queue/giveUpOwners.mjs (the
 *  give-up-task subject resolver). The caller still owns setting up the viewer context this relies
 *  on (`document_is_visible` fails closed on none) — that's generic session infra, not this door's
 *  job. */
export async function instanceById(tx, { instanceId }) {
  const { rows } = await tx.query(
    `SELECT id, subject_user_id, title FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  return rows[0] ?? null;
}

/** An instance's `created_by`, or null — the door `src/queue/recipientResolvers.mjs`'s "document"
 *  recipient lookup uses, instead of the raw SQL on `keystone.document_instance` that used to sit
 *  there (db/gates/documents_wall.mjs's own SQL-clause check caught it).
 *  ★★★ CALLS `keystone.document_created_by()` (migration 0570), NOT a plain SELECT, and does NOT
 *      need a viewer/`asPracticeOwner` the way `instanceById` above does. MEASURED directly against
 *      a real local document: `document_is_visible()` (the table's real RLS) denies even the
 *      practice OWNER when the document's subject has no coach assigned — `asPracticeOwner` would
 *      have silently returned null for exactly that case in production. "Who created this" is a
 *      system/notification-routing fact, not a content read, so it goes through the same narrow,
 *      named SECURITY DEFINER bypass `resolve_tenant_by_slug`/`platform_list_tenants` already use
 *      for their own system needs elsewhere — never a general document accessor. */
export async function instanceCreatedBy(tx, { tenantId, instanceId }) {
  const { rows } = await tx.query(
    `SELECT keystone.document_created_by($1, $2) AS created_by`,
    [tenantId, instanceId]);
  return rows[0]?.created_by ?? null;
}

/** id/title/created_by for a worker notification, or null — same no-viewer reasoning as
 *  `instanceCreatedBy` above, via `keystone.document_notification_facts()` (migration 0571).
 *  Found by the same sweep that produced 0570: `documents.document.declined`
 *  (src/queue/tasks.mjs) had the identical unwrapped read its sibling `documents.document.expired`
 *  has, but was NOT safe the way that one is — 'expired' happens to match the table's own
 *  `system_expiry_read` RLS carve-out; 'declined' matches none of the three carve-outs, so the
 *  plain SELECT always returned zero rows and the handler threw on every real decline. */
export async function instanceNotificationFacts(tx, { tenantId, instanceId }) {
  const { rows } = await tx.query(
    `SELECT * FROM keystone.document_notification_facts($1, $2)`,
    [tenantId, instanceId]);
  return rows[0] ?? null;
}

/** PH1 (17 Oct 2026): who created the document, when it was sent and executed, and whether it is a test — for the PostHog outbox listener.
 *  Same no-viewer reasoning as `instanceCreatedBy`, via `keystone.document_analytics_facts()` (migration 0757). No title, content or party. */
export async function instanceAnalyticsFacts(tx, { tenantId, instanceId }) {
  const { rows } = await tx.query(`SELECT * FROM keystone.document_analytics_facts($1, $2)`, [tenantId, instanceId]);
  return rows[0] ?? null;
}

/** Run 8 (R8-35): what the sender's "opened / signed / complete" notice says — the document's title, the name of the person who acted (from the island's own party
 *  snapshot, by the role the event names) and the workspace's own link to the document. Same no-viewer reasoning as `instanceNotificationFacts`. null when the document is gone. */
export async function documentNoticeFacts(tx, { tenantId, instanceId, role = null }) {
  const facts = await instanceNotificationFacts(tx, { tenantId, instanceId }).catch(() => null);
  if (!facts) return null;
  const { rows: [who] } = role ? await tx.query(`SELECT name FROM keystone.document_party WHERE tenant_id = $1 AND instance_id = $2 AND role = $3 LIMIT 1`, [tenantId, instanceId, role]).catch(() => ({ rows: [] })) : { rows: [] };
  let base = "";
  try { const { ports } = await import("./ports.mjs"); const brand = await (await ports()).brand.get(tx, { tenantId }); base = brand?.publicBase ?? ""; } catch { /* no brand: a relative link */ }
  return { title: facts.title ?? null, who: who?.name ?? null, link: `${base}/documents/${instanceId}` };
}

/** Run 9 · THE INBOX: the facts each notice is worded from, for many documents at once — the title, whether it is a form response (and the form), and the name of the person whose seat
 *  the event names. → Map(instanceId → { title, form, formName, who, test }). Read under the caller's tenant scope; an id from elsewhere is simply absent. */
export async function inboxFacts(tx, { refs }) {
  const ids = [...new Set((refs ?? []).map((r) => r.instanceId).filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))];
  const out = new Map(); if (!ids.length) return out;
  const { rows } = await tx.query(
    `SELECT i.id, i.title, i.source_channel, i.is_test, t.name AS form_name FROM keystone.document_instance i LEFT JOIN keystone.document_template t ON t.id = i.template_id WHERE i.id = ANY($1::uuid[])`, [ids]);
  const { rows: parties } = await tx.query(`SELECT instance_id, role, name, email FROM keystone.document_party WHERE instance_id = ANY($1::uuid[])`, [ids]);
  for (const r of rows) out.set(r.id, { title: r.title, form: r.source_channel === "form", formName: r.source_channel === "form" ? (r.form_name ?? r.title) : null, test: r.is_test === true, parties: parties.filter((p) => p.instance_id === r.id) });
  for (const ref of refs) { const f = out.get(ref.instanceId); if (f && ref.role && !f.who) { const p = f.parties.find((x) => x.role === ref.role); if (p) f.whoByRole = { ...(f.whoByRole ?? {}), [ref.role]: p.name || p.email }; } }
  return out;
}

/** D-077: who declined a document and the reason they gave, for the notice to the sender. Reads the
 *  island's own party snapshot under the caller's tenant scope; null when no declined party is found. */
export async function declineFacts(tx, { tenantId, instanceId }) {
  const { rows } = await tx.query(
    `SELECT name, decline_reason FROM keystone.document_party WHERE tenant_id = $1 AND status = 'declined' AND (instance_id = $2 OR completed_at > now() - interval '10 minutes') ORDER BY (instance_id = $2) DESC, completed_at DESC LIMIT 1`,
    [tenantId, instanceId]).catch(() => ({ rows: [] }));
  return rows[0] ?? null;
}

/** Does this person have any non-draft document created since the given time — a plain existence
 *  fact, no viewer required, via `keystone.person_has_recent_document()` (migration 0571). Found
 *  by the same sweep: `sweepLeadScore` (src/queue/tasks.mjs) checked this as a plain unwrapped
 *  `EXISTS` clause, which was only ever true by coincidence — for the narrow set of (state, timing)
 *  combinations that happen to match one of `document_instance`'s no-viewer RLS carve-outs. A
 *  person whose only growth-engagement signal was a real `executed`/`declined`/`void` document (the
 *  much larger remaining set of non-draft states) was silently excluded from lead scoring. */
export async function personHasRecentDocument(tx, { tenantId, subjectUserId, since }) {
  const { rows } = await tx.query(
    `SELECT keystone.person_has_recent_document($1, $2, $3) AS exists`,
    [tenantId, subjectUserId, since]);
  return rows[0]?.exists ?? false;
}

/** Every person id with a non-draft document since the given time, set-based — the actual shape
 *  `sweepLeadScore` needs (it gathers candidates across five signals in one pass; checking one
 *  person at a time would mean querying every tenant person individually). Via
 *  `keystone.people_with_recent_documents()` (migration 0571). */
export async function peopleWithRecentDocuments(tx, { tenantId, since }) {
  const { rows } = await tx.query(
    `SELECT subject_user_id FROM keystone.people_with_recent_documents($1, $2)`,
    [tenantId, since]);
  return rows.map((r) => r.subject_user_id);
}

/** One row of a UNION ALL "every object and when it last changed" report — relocated verbatim from
 *  records/lists/settings.mjs's "Data" list (5 other domains' own rows stay there; this is only the
 *  Documents one, same composition idiom as `notExecutedAnyDocumentFragment` below). */
export function documentCountRowFragment(alias) {
  return `SELECT 'Documents'::text AS id, 'Documents'::text AS object,
                 count(*)::int AS held, max(${alias}.created_at) AS newest
            FROM keystone.document_instance ${alias} WHERE ${scoped('document', alias)}`;
}

/** A full standalone "count of instances awaiting signature" query — relocated verbatim from
 *  records/lists.mjs's `documents_awaiting_signature` home tile. */
export function documentsAwaitingSignatureCountQuery(alias) {
  return `SELECT count(*)::int AS n FROM keystone.document_instance ${alias}
           WHERE ${alias}.archived_at IS NULL AND ${alias}.state IN ('sent','partially_signed')
             AND ${scoped('document', alias)}`;
}

/** One CTE arm's SELECT body (a `(kind, id, when, label, who, filterKind)` row per sent/
 *  partially-signed instance) — relocated verbatim from records/lists.mjs's "what needs attention"
 *  combined queue (the `unsigned` CTE). The caller still wraps it in its own `WITH unsigned AS (…)`
 *  alongside its other CTE arms (unattended sessions, overdue invoices, …) — this fragment is only
 *  the SELECT, not the whole statement, matching how every other arm is composed there too. */
export function unsignedInstanceQueueFragment(alias) {
  return `SELECT 'document'::text, ${alias}.id::text, ${alias}.created_at,
                 coalesce(${alias}.title, 'Document'),
                 (SELECT u.display_name FROM keystone.person_directory u WHERE u.id = ${alias}.subject_user_id),
                 'document'::text
            FROM keystone.document_instance ${alias}
           WHERE ${alias}.archived_at IS NULL AND ${alias}.state IN ('sent','partially_signed')
             AND ${scoped('document', alias)}`;
}

/** A scalar-subquery expression (no trailing alias — the caller names its own column) counting
 *  instances sent/partially-signed and created today — relocated verbatim from records/lists.mjs's
 *  `HOME_STAFF_PEOPLE_SQL`. */
export function instancesStartedTodayCountExpr(alias) {
  return `(SELECT count(distinct ${alias}.id)::int
             FROM keystone.document_instance ${alias}
            WHERE ${alias}.archived_at IS NULL
              AND ${alias}.state IN ('sent', 'partially_signed')
              AND ${alias}.created_at >= date_trunc('day', now())
              AND ${scoped('document', alias)})`;
}

/** A `NOT EXISTS` SQL fragment: "this alias's row has never had an executed document naming it as
 *  subject" — for splicing into a caller's own WHERE clause, the SAME composition pattern
 *  `scoped(object, alias)` (records/lists/_shared.mjs) already uses everywhere else in this
 *  codebase. Relocated verbatim from records/lists/people.mjs's own "Leads" list definition (used
 *  twice there, the row filter and its summary count) — the fragment's TEXT now lives here, so the
 *  string "FROM keystone.document_instance" appears in this file, not in a caller outside the wall,
 *  even though the composed query still executes as one statement in the caller's own connection. */
export function notExecutedAnyDocumentFragment(alias) {
  return `NOT EXISTS (SELECT 1 FROM keystone.document_instance d
                   WHERE d.subject_user_id = ${alias}.id AND d.state = 'executed')`;
}

/** The most recent EXECUTED instance for this subject, with its frozen snapshot content —
 *  relocated verbatim from money/disputes.mjs (dispute-evidence gathering: "did they sign an
 *  agreement"). Found only after documents_wall.mjs's kysely detection was widened to cover join
 *  methods, not only selectFrom — this one only ever reached document_instance via `.selectFrom`
 *  directly, so it wasn't a join-detection miss, but the round that added join coverage is the
 *  round that finally scanned this file's own document_instance query into the crossing list. */
export async function mostRecentExecutedInstanceFor(tx, { tenantId, subjectUserId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_instance as d")
    .select([
      "d.id", "d.executed_at as signed_at", "d.template_id",
      "d.template_body_snapshot as content",
    ])
    .where("d.tenant_id", "=", tenantId)
    .where("d.subject_user_id", "=", subjectUserId)
    .where("d.state", "=", "executed")
    .orderBy("d.executed_at", "desc")
    .limit(1));
  return rows;
}

/** The most recent EXECUTED instance whose template starts this subscription plan, for this
 *  subject — relocated verbatim from money/estimates.mjs's own plan-backed-estimate acceptance
 *  (finding the contract that justifies starting a subscription). */
export async function executedInstanceStartingPlanFor(tx, { tenantId, planId, subjectUserId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_instance as i")
    .innerJoin("keystone.document_template as t", "t.id", "i.template_id")
    .select("i.id")
    .where("i.tenant_id", "=", tenantId)
    .where("t.creates_subscription_plan_id", "=", planId)
    .where("i.subject_user_id", "=", subjectUserId)
    .where("i.state", "=", "executed")
    .orderBy("i.executed_at", "desc")
    .limit(1));
  return rows;
}

/** Sent/partially-signed instances naming one of these subjects, where the signer config still
 *  requires a parent — relocated verbatim from app/familyHome.mjs's `parentHome` (the "documents to
 *  cosign" list). `signer_config` is documents' own vocabulary (vocabulary.mjs); the ~'PARENT' match
 *  is unchanged from the original query. */
export async function pendingCosignInstancesFor(tx, { tenantId, subjectUserIds }) {
  if (!subjectUserIds?.length) return [];
  const { rows } = await tx.query(
    `SELECT i.id, i.title, i.subject_user_id, t.signer_config
       FROM keystone.document_instance i
       JOIN keystone.document_type t ON t.id = i.type_id
      WHERE i.tenant_id = $1 AND i.subject_user_id = ANY($2::uuid[])
        AND i.state IN ('sent', 'partially_signed')
        AND i.archived_at IS NULL
        AND t.signer_config ~ 'PARENT'
      ORDER BY COALESCE(i.sent_at, i.created_at) DESC`,
    [tenantId, subjectUserIds]);
  return rows;
}

/** Whether ANY party holding this role has signed this instance — relocated verbatim from
 *  app/familyHome.mjs's own parent-signed/child-signed checks (same file, two call sites, now one
 *  function). */
export async function hasSignedRole(tx, { instanceId, role }) {
  const { rows } = await tx.query(
    `SELECT signed_at FROM keystone.signature_record
      WHERE instance_id = $1 AND role = $2 AND signed_at IS NOT NULL
      LIMIT 1`,
    [instanceId, role]);
  return rows.length > 0;
}

/** The newest visible instance where this signer holds the given role, is in sent/partially_signed,
 *  and has not yet signed — relocated verbatim from app/familyHome.mjs's `teenHome` ("documents to
 *  sign"). */
export async function nextInstanceAwaitingSignature(tx, { tenantId, signerUid, role }) {
  const { rows } = await tx.query(
    `SELECT i.id, i.title
       FROM keystone.document_instance i
       LEFT JOIN keystone.signature_record sr ON sr.instance_id = i.id AND sr.role = $3
      WHERE i.tenant_id = $1
        AND sr.signer_uid = $2
        AND sr.signed_at IS NULL
        AND i.state IN ('sent', 'partially_signed')
        AND i.archived_at IS NULL
      ORDER BY COALESCE(i.sent_at, i.created_at) DESC
      LIMIT 1`,
    [tenantId, signerUid, role]);
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ISLAND-PROGRAMS §2 (2 Oct 2026) — THE INWARD CROSSINGS the wall gate's exemptions hid
//   (src/queue/tasks.mjs, src/routes/{app,appHome,index,writes}.mjs, src/records/queries.mjs).
//   Each function below is the SAME SQL that sat at its caller, moved here verbatim — same columns,
//   same predicates, same ordering. Only the caller changes. Where the original ran on the caller's
//   `db`/`tx`, the function takes it as its first argument.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ── src/queue/tasks.mjs ────────────────────────────────────────────────────────────────────────

/** The `documents.document.sent` listener's read: id/title/subject/subject's name, plus whether a
 *  sign-link was already minted for this instance (link_token purpose 'document_signature').
 *  ★ NO tenant predicate here, exactly as the original had none — the caller reads it INSIDE
 *    `asViewer(tx, sentBy, …)`, so RLS (`document_is_visible`) is what scopes it. Null when invisible. */
export async function instanceSentFacts(tx, { instanceId }) {
  const r = await tx.query(
    `SELECT i.id, i.title, i.builder, i.subject_user_id, u.display_name,
            EXISTS (SELECT 1 FROM keystone.link_token lt
                     WHERE lt.subject_id = i.id AND lt.purpose = 'document_signature') AS has_sign_link
       FROM keystone.document_instance i
       LEFT JOIN keystone.person_directory u ON u.id = i.subject_user_id
      WHERE i.id = $1`, [instanceId]);
  return r.rows[0] ?? null;
}

/** id/title/created_by for one instance in one tenant, or null — the `documents.document.expired`
 *  listener's plain (no-viewer) read, same as documents/dueFacts.mjs's own sweep. */
export async function instanceTitleAndCreator(tx, { tenantId, instanceId }) {
  const { rows } = await tx.query(
    `SELECT id, title, created_by FROM keystone.document_instance WHERE tenant_id = $1 AND id = $2`,
    [tenantId, instanceId]);
  return rows[0] ?? null;
}

/** An instance's `created_by` by id alone (no tenant predicate — the archive job runs inside
 *  `withTenant`, so RLS tenant isolation scopes it), or null. */
export async function instanceCreatorById(tx, { instanceId }) {
  const { rows } = await tx.query(
    `SELECT created_by FROM keystone.document_instance WHERE id = $1`, [instanceId]);
  return rows[0]?.created_by ?? null;
}

// ── src/routes/app.mjs (client portal) ─────────────────────────────────────────────────────────

/** The portal's document list. ★ NO visibility predicate on purpose — `document_is_visible()` (0012)
 *  is applied by the table's own RLS policy; the caller's `db` carries the client's session. */
export async function portalDocumentList(db) {
  const { rows } = await db.query(
    `SELECT i.id, i.title, i.state, i.builder, i.sent_at, i.executed_at,
            t.label AS type_label, t.is_session_note
       FROM keystone.document_instance i
       LEFT JOIN keystone.document_type t ON t.id = i.type_id
      WHERE i.archived_at IS NULL
      ORDER BY COALESCE(i.executed_at, i.sent_at, i.created_at) DESC
      LIMIT 200`);
  return rows;
}

/** One document for the portal's signing surface — rows ([] when invisible/absent, which the
 *  route answers as 404). Visibility is RLS's, same as `portalDocumentList`. */
export async function portalDocumentDetail(db, { instanceId }) {
  const { rows } = await db.query(
    `SELECT i.id, i.title, i.state, i.builder, i.template_id, i.sent_at, i.executed_at,
            i.send_mode, i.template_body_snapshot,
            t.label AS type_label, t.signer_config
       FROM keystone.document_instance i
       LEFT JOIN keystone.document_type t ON t.id = i.type_id
      WHERE i.id = $1 AND i.archived_at IS NULL`,
    [instanceId]);
  return rows;
}

/** The newest 50 `documents.%` events whose document is ABOUT this person — the client's
 *  "things I'm working on" feed. (A document event's `subject_id` is the INSTANCE id, so this
 *  joins through `document_instance.subject_user_id`.) */
export async function documentEventsAboutSubject(db, { subjectUserId }) {
  const { rows } = await db.query(
    `SELECT e.id, e.topic, e.subject_type, e.created_at FROM keystone.event e
       JOIN keystone.document_instance di ON di.id = e.subject_id
      WHERE e.subject_type = 'document' AND di.subject_user_id = $1
        AND e.topic LIKE 'documents.%'
      ORDER BY e.created_at DESC LIMIT 50`, [subjectUserId]);
  return rows;
}

/** The unarchived instance a sign-and-pay checkout is built from (state + frozen snapshot), or
 *  undefined. Tenant isolation is the caller's session RLS, as in the original. */
export async function instanceForCheckout(db, { instanceId }) {
  const { rows } = await db.query(
    `SELECT id, state, subject_user_id, template_snapshot
       FROM keystone.document_instance
      WHERE id = $1 AND archived_at IS NULL`,
    [instanceId]);
  return rows[0];
}

// ── src/routes/appHome.mjs (client home) ───────────────────────────────────────────────────────

/** Count of EXECUTED instances naming this person as subject — the client home's first-visit test. */
export async function executedCountFor(tx, { tenantId, subjectUserId }) {
  const { rows } = await tx.query(
    `SELECT COUNT(*)::int AS count FROM keystone.document_instance
      WHERE tenant_id = $1 AND subject_user_id = $2 AND state = 'executed'`,
    [tenantId, subjectUserId]);
  return rows[0]?.count;
}

/** The newest sent/partially-signed, unarchived instance about THIS person — the client home's
 *  "default agreement" (rows, 0 or 1). */
export async function newestOpenInstanceFor(tx, { tenantId, subjectUserId }) {
  const { rows } = await tx.query(
    `SELECT i.id FROM keystone.document_instance i
      WHERE i.tenant_id = $1 AND i.subject_user_id = $2 AND i.state IN ('sent', 'partially_signed')
        AND i.archived_at IS NULL
      ORDER BY COALESCE(i.sent_at, i.created_at) DESC
      LIMIT 1`,
    [tenantId, subjectUserId]);
  return rows;
}

// ── src/routes/index.mjs ───────────────────────────────────────────────────────────────────────

/** Global search over instance titles. Returns the raw query RESULT (`{ rows }`), because the caller
 *  runs it alongside two other searches and reads `.rows`. `$1` is the viewer, `$2` the LIKE
 *  pattern (wildcards already added/escaped by the caller); `scoped('document','d')` is the same
 *  viewer predicate every list uses. */
export function searchInstances(tx, { viewer, pattern, limit }) {
  const n = Number(limit);
  return tx.query(
    `SELECT d.id, d.title AS label, d.state AS detail
       FROM keystone.document_instance d
      WHERE lower(d.title) LIKE lower($2)
        AND ${scoped("document", "d")}
      ORDER BY d.created_at DESC
      LIMIT ${n}`, [viewer, pattern]);
}

/** Scalar-subquery expression (caller names the column): sent/partially-signed unarchived instances.
 *  ★ UNSCOPED, exactly as the home money band's original (RLS only) — unlike
 *    `documentsAwaitingSignatureCountQuery`, which carries `scoped('document', …)` and binds `$1`. */
export function unsignedInstanceCountExpr(alias) {
  return `(SELECT count(*)::int FROM keystone.document_instance ${alias}
            WHERE ${alias}.state IN ('sent', 'partially_signed') AND ${alias}.archived_at IS NULL)`;
}

/** Scalar-subquery expression: ACTIVE templates only (a deactivated one still exists so sent
 *  instruments keep resolving, but nothing new can be sent from it — the onboarding meter's
 *  `templates_created`). */
export function activeTemplateCountExpr(alias) {
  return `(SELECT count(*) FROM keystone.document_template ${alias}
            WHERE ${alias}.active)`;
}

/** `/api/settings/documents`: every category, and every type with its category's label. */
export async function settingsCategoriesAndTypes(db) {
  const { rows: categories } = await db.query(
    `SELECT id, key, label, sort_order
       FROM keystone.document_category
      ORDER BY sort_order, label`
  );
  const { rows: types } = await db.query(
    `SELECT t.id, t.key, t.label, t.category_id, c.label AS category_label, t.sub_category,
            t.signer_config, t.audience, t.division, t.applies_to, t.default_assigned_to,
            t.is_session_note
       FROM keystone.document_type t
       LEFT JOIN keystone.document_category c ON c.id = t.category_id
      ORDER BY c.sort_order NULLS LAST, c.label NULLS LAST, t.label`
  );
  return { categories, types };
}

// ── src/routes/writes.mjs ──────────────────────────────────────────────────────────────────────

/** Point a template at a document type (F777: an authored contract takes the practice's agreement
 *  type, in the same transaction as `createTemplate`). */
export async function setTemplateType(tx, { tenantId, templateId, typeId }) {
  await tx.query(
    `UPDATE keystone.document_template SET type_id = $1 WHERE id = $2 AND tenant_id = $3`,
    [typeId, templateId, tenantId]);
}

// ── src/records/queries.mjs (the generic record-page / History / related-list registry) ────────
// ★ These return SQL TEXT for the registry's frozen static strings. The caller's own scope helpers
//   (`scopedRecord`, `scopedRelated`, DERIVATIONS) are passed IN as already-built fragments rather
//   than duplicated here, so there is one copy of each and no circular import.

/** The registry's `table` string for the document record type (a FUNCTION, not a const, so it is
 *  hoisted and safe to call at module-evaluation time even inside an import cycle). */
export function documentInstanceTable() { return "keystone.document_instance"; }
/** The bare table name the registry's DERIVATIONS `reads` metadata declares. */
export function documentInstanceTableName() { return "document_instance"; }

/** RECORD_QUERIES.document's SQL. `$1` = record id, `$2` = viewer. `subjectExpr`/`ageExpr` are the
 *  caller's DERIVATIONS fragments for alias `d`; `scopeClause` is `scopedRecord('document', 'd')`.
 *  ★ Selects `archived_at` so the record page can offer RESTORE (P7); has NO archive predicate on
 *    purpose — the record page must still open for an archived document (lists filter, this does not).
 *  ★ `created_by` and `is_session_note` (a scalar subselect, NULL for an unresolvable type_id →
 *    "not a session note", fail-closed) are the two facts the route's private-read decision needs
 *    (STAGE 7 / 7.15, F597). */
export function documentRecordSql({ subjectExpr, ageExpr, scopeClause }) {
  return `
      SELECT d.archived_at,
             d.id, d.title, d.builder, d.state, d.sent_at, d.executed_at,
             d.created_by,
             (SELECT t.is_session_note FROM keystone.document_type t
               WHERE t.id = d.type_id)  AS is_session_note,
             ${subjectExpr} AS subject,
             ${ageExpr}  AS age
        FROM keystone.document_instance d
       WHERE d.id = $1
         AND ${scopeClause}`;
}

/** The ACTIVITY_SQL union arm: documents.document.* events for a document ABOUT this person
 *  (`$1` = record type, only fires for 'person'; `$2` = the person). */
export function documentEventsAboutPersonFragment() {
  return `SELECT e.id, e.topic, e.emitted_by, e.status, e.created_at
      FROM keystone.event e
      JOIN keystone.document_instance di ON di.id = e.subject_id
     WHERE $1 = 'person' AND e.subject_type = 'document' AND di.subject_user_id = $2`;
}

/** RELATED_QUERIES['person.documents']: `$1` = person id; `scopeClause` is
 *  `scopedRelated('document', 'd')` (archived excluded + viewer predicate). */
export function personDocumentsRelatedSql({ scopeClause }) {
  return `
    SELECT d.id, d.title AS label, d.state AS sub
      FROM keystone.document_instance d
     WHERE d.subject_user_id = $1
       AND ${scopeClause}
     ORDER BY d.created_at DESC
     LIMIT 50`;
}


/** ★ island door (used by the host's items port): repoint every item_agreement_requirement that points at an earlier version of this template's lineage
 *  (same tenant / builder / name) to the version just published. Documents names its own table; the host names only the requirement. */
export async function templateIdsInLineage(tx, { tenantId, templateId, name, builder }) {
  const { rows } = await tx.query(
    `SELECT id FROM keystone.document_template WHERE tenant_id = $1 AND name = $2 AND builder = $3 AND id <> $4`, [tenantId, name, builder, templateId]);
  return rows.map((r) => r.id);
}

/** ★ the Documents-owned aging view, named here so the Reports section does not name Documents' relation in its own SQL */
export function documentAgingRelation() { return "keystone.report_document_aging"; }

/** The client portal opened this document (first open per person) — writes the open record the certificate reads. */
export { recordPortalOpen } from "./auditTrail.mjs";


// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ F130 (23 Oct 2026) — A DOCUMENT'S ACTIVITY IN PLAIN WORDS. The record page printed raw event names ("documents.document.signed"). Each row
//   now carries a `description` a person reads: "Sent to Pat Parent and Jordan Teen", "Pat Parent signed", "Opened by Jordan Teen", "Executed by
//   the maintainer Roberts". Names come from the document's own signatures and the people port, never from a host table.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const ROLE_WORDS = Object.freeze({ client: "the client", pir: "the client", parent: "the parent or guardian", coach: "the coach", consultant: "the consultant", familyMember: "a family member", recipient: "the recipient" });
const andJoin = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
export async function describeDocumentActivity(tx, { instanceId, rows = [] }) {
  if (!rows.length) return rows;
  const { ports } = await import("./ports.mjs");
  const P = await ports();
  const { rows: evs } = await tx.query(`SELECT id, topic, actor, payload FROM keystone.event WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
  const evById = new Map(evs.map((e) => [e.id, e]));
  const { rows: sigs } = await tx.query(`SELECT id, role, signer_name FROM keystone.signature_record WHERE instance_id = $1`, [instanceId]);
  const { rows: [inst] } = await tx.query(
    `SELECT d.subject_user_id, ty.signer_config FROM keystone.document_instance d LEFT JOIN keystone.document_type ty ON ty.id = d.type_id WHERE d.id = $1`, [instanceId]);
  const { rows: parties } = await tx.query(`SELECT role, name FROM keystone.document_party WHERE instance_id = $1 ORDER BY position, created_at`, [instanceId]).catch(() => ({ rows: [] }));
  // who it was sent to: the document's own parties (an uploaded document), else the signer order resolved to people (the subject, their parent)
  let recipients = parties.map((p) => p.name).filter(Boolean);
  const nameByRole = new Map(parties.filter((p) => p.name).map((p) => [p.role, p.name]));
  if (!recipients.length && inst) {
    const order = SIGNER_CONFIGS[inst.signer_config] ?? [];
    const subject = inst.subject_user_id ? (await P.people.byIds(tx, [inst.subject_user_id]))[0] : null;
    for (const role of order) {
      if (role === "client" || role === "pir") { if (subject?.display_name) { recipients.push(subject.display_name); nameByRole.set(role, subject.display_name); } }
      else if (role === "parent" && inst.subject_user_id) { const g = await P.people.guardianOf(tx, inst.subject_user_id); if (g?.display_name) { recipients.push(g.display_name); nameByRole.set("parent", g.display_name); } }
    }
  }
  for (const s of sigs) if (s.signer_name) nameByRole.set(s.role, s.signer_name);
  const actorIds = [...new Set(evs.map((e) => /^user:(.+)$/.exec(e.actor ?? "")?.[1]).concat(evs.map((e) => e.payload?.executed_by)).filter(Boolean))];
  const actorName = new Map((actorIds.length ? await P.people.byIds(tx, actorIds) : []).map((p) => [p.id, p.display_name]));
  const who = (e) => { const id = /^user:(.+)$/.exec(e?.actor ?? "")?.[1]; return id ? actorName.get(id) ?? null : null; };
  const roleName = (role) => nameByRole.get(role) ?? ROLE_WORDS[role] ?? null;
  const say = (r) => {
    const e = evById.get(r.id) ?? { topic: r.topic, payload: {} };
    const p = e.payload ?? {};
    switch (e.topic) {
      case "documents.document.created": return who(e) ? `Created by ${who(e)}` : "Created";
      case "documents.document.sent": return recipients.length ? `Sent to ${andJoin(recipients)}` : "Sent";
      case "documents.document.opened": return roleName(p.role) ? `Opened by ${roleName(p.role)}` : "Opened";
      case "documents.document.signed": {
        const sig = sigs.find((s) => s.id === p.signature_record_id);
        const n = sig?.signer_name ?? roleName(p.role);
        return n ? `${n.charAt(0).toUpperCase()}${n.slice(1)} signed` : "Signed";
      }
      case "documents.document.executed": { const n = (p.executed_by && actorName.get(p.executed_by)) || who(e); return n ? `Executed by ${n} — final` : "Executed — final"; }
      case "documents.document.declined": return roleName(p.role) ? `Declined by ${roleName(p.role)}` : "Declined";
      case "documents.document.voided": return who(e) ? `Voided by ${who(e)}` : "Voided";
      case "documents.document.expired": return "Expired before everyone signed";
      case "documents.document.reminder_due": return "Reminder sent";
      case "documents.document.bounced": return "The email bounced";
      case "documents.document.downloaded": return "Signed copy downloaded";
      case "documents.document.changes_requested": return roleName(p.role) ? `${roleName(p.role)} asked for changes` : "Changes asked for";
      case "documents.document.delegated": return "Passed on to someone else to sign";
      case "documents.document.archived": return who(e) ? `Archived by ${who(e)}` : "Archived";
      default: return String(e.topic ?? r.topic ?? "").replace(/^documents\.(document\.)?/, "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
    }
  };
  return rows.map((r) => ({ ...r, description: say(r) }));
}
