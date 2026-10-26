// Stage 14 task 14.40 — STAFF DOCUMENT READS: THE CERTIFICATE, THE DECLINE FACT, AND THE PIPELINE'S
// "OPENED, NOT SIGNED" BAND (the third piece is the `/documents/pipeline` entry in
// `src/records/lists/documents.mjs`, edited beside this file — not here).
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.40's
//     file list. `registerDocumentRecordReads` below is inert until 14.41 calls it — same shape and
//     the same warning `itemsCatalogue.mjs` (14.16) states for itself.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A CERTIFICATE IS EVIDENCE ABOUT A BINDING INSTRUMENT — IT REPORTS THE FROZEN FACTS, NEVER
//     TODAY'S CATALOGUE. `version`/`published_at` below are read by joining `document_template`
//     through `document_instance.template_id` — the SPECIFIC row this instrument was sent from —
//     **never** `WHERE t.active = true`, which would answer "today's template", not "the template
//     this instrument actually carries". `template_id` is written once, at instance creation, and
//     never UPDATEd afterwards [MEASURED: no `SET template_id` anywhere in `src/documents/writes.mjs`]
//     and P15C.8's rule ("a new version is a new row, the old one is never edited") means the row
//     `template_id` points at never changes its own `version` or `published_at` after that row is
//     created — confirmed by `src/documents/writes.mjs:459`'s own comment: *"the version lives on
//     the snapshot's own `template_id` plus the template row, which is where P15C.8 already keeps
//     it."* So joining by the frozen id is reading a frozen fact, not re-rendering a live one.
//   ★ Price, terms and the disclosure's own version are ALREADY frozen into
//     `document_instance.template_snapshot` at EXECUTE (0053/executeInstance) — this route does not
//     need to unpack that JSON at all, because nothing this certificate reports lives only there.
//
// ★★★ PERMISSION: WHICH STAFF, NOT WHETHER THERE IS A PRINCIPAL.
//   · The COARSE gate is `authoriseSection(principal.user, '/documents', …)` — the same staff-floor
//     shape every other record surface in this codebase uses (`peopleRecord.mjs`, `payerGroups.mjs`).
//     A Client/Parent/adolescent-client session never has rank `staff`/`coach`/`admin`/`owner`
//     (`src/nav/authorise.mjs:47-55` `effectiveRank`) and is refused here — **403** (field 9: Client).
//   · The FINE gate is the per-row SCOPE predicate `scoped('document', 'd')`
//     (`src/records/lists/_shared.mjs:93-95`), the SAME expression the pipeline list already filters
//     by (`documents.mjs`'s own `/documents/pipeline` `sql`) — `keystone.user_may($1, 'document',
//     'view', <the subject's owner>)`, which resolves Everything/Team/Owned/None from the caller's
//     OWN `role_permission` grant (`db/migrations/0192…:30-66` `user_may`,
//     `db/migrations/0070…:173-192` `scope_allows`). A Coach holding `document.view` at `owned` or
//     `team` scope, asking for an instrument outside their caseload, gets ZERO ROWS from this SELECT
//     — reported as **404**, not 403 (field 8/9: `Coach not on the caseload → 404`), because a scope
//     miss and a nonexistent id are deliberately the same answer (no existence leak).
//   ★★★ WHO SUPPLIES THE CONDITION: `principal.appUserId` is the REAL, session-resolved viewer id
//       (`src/http/app.mjs:798-807` `loadPerson`, inside the tenant transaction, never a client-sent
//       value) — bound as `$1` to `scoped()`'s `keystone.user_may($1, …)` call below. The
//       APPLICATION supplies the id `user_may` checks, on every real request; nothing here is a
//       condition only a test ever sets.
//
// ★★★ THE BLOCKED LIST NEVER LEAVES THE PLATFORM. Neither read below returns
//     `document_instance.body`/`template_snapshot`/`template_body_snapshot` (no notes, no clause
//     text) — only who signed, when, from where, the decline reason (already staff-only by 0195),
//     and the small set of identifying facts named in the task. See the field list in each handler's
//     own comment.
//
// ★ CHAIN: mounted by 14.41 with `runTenantScoped` — the PRACTICE chain, same as every other
//   items/documents/notes route this stage adds. Nothing here is registered through
//   `handlePlatformRequest`/`withOperator` (11.19's practice-less chain) and this route calls
//   `nullNoteBodies` nowhere — it carries no note body to begin with.

import { ports } from "../documents/ports.mjs";
import { forbidden, notFound, invalid } from "../http/errors.mjs";
import { authoriseSection, effectiveRank } from "../nav/authorise.mjs";
import { scoped } from "../records/lists/_shared.mjs";
import { getDocumentSetting } from "../documents/settings.mjs";
import { variableCatalogue } from "../documents/variableCatalogue.mjs";

const SECTION = "/documents";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ★ The staff-floor gate every handler below shares — the coarse half of the two-layer check. */
function guardStaffSection(principal, isPlatform) {
  const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
  if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
}

/**
 * ★ the maintainer, 2 Oct 2026 — NO invented retention term. This used to print "at least 7 years" for every practice
 *   (a figure nobody asked for, copied from the setting's validator floor). Now: the practice's OWN
 *   documents.retention_years if it set one, otherwise the same wording as the privacy policy.
 */
async function retentionSentence(db) {
  const years = await getDocumentSetting(db, "retention_years");
  const n = Number(years);
  if (Number.isInteger(n) && n > 0) return `This practice has set this record to be kept for ${n} year${n === 1 ? "" : "s"}.`;
  return "This record is kept only as long as it is needed to provide our services and meet legal obligations.";
}

/**
 * GET /api/documents/:id/certificate →
 *   { signers:[{role, typed_name, signed_at, ip, user_agent, mark_image}], sent_to:[email],
 *     opens:[{at, ip, user_agent}], version, published_at, reference, retention_sentence }
 * Staff only (coarse: `/documents` section floor); per-row scope via `scoped('document', 'd')`.
 */
async function readCertificate(db, { viewerId, instanceId }) {
  // ★ `version`/`published_at` — the FROZEN template row, joined by the frozen `template_id` FK,
  //   never by `t.active = true`. See this file's header for why that distinction is the whole point.
  //   Fetched in the SAME scoped SELECT that decides visibility, so there is no second query that
  //   could read the row under a different (unscoped) condition.
  const { rows: [inst] } = await db.query(
    `SELECT d.id, t.version, t.published_at
       FROM keystone.document_instance d
       LEFT JOIN keystone.document_template t ON t.id = d.template_id
      WHERE d.id = $2 AND d.archived_at IS NULL AND ${scoped("document", "d")}`,
    [viewerId, instanceId]);
  if (!inst) throw notFound("no such document in this organisation");

  // ★ Signers, in signing order. `signed_at` is the SERVER's authoritative instant, rendered as
  //   local wall-clock in the PRACTICE's own zone plus the zone NAME itself appended — the same
  //   idiom `src/records/queries.mjs:279-282` (§B4 STEP 3) already uses for exactly this reason: a
  //   bare UTC instant, or a bare offset with no zone name, is how a signer misreads when they signed.
  const { rows: signers } = await db.query(
    `SELECT sr.role, sr.signer_name AS typed_name,
            to_char(sr.signed_at AT TIME ZONE t.timezone, 'YYYY-MM-DD"T"HH24:MI:SS')
              || ' (' || t.timezone || ')' AS signed_at,
            sr.signer_ip AS ip, sr.user_agent, sr.mark_image
       FROM keystone.signature_record sr
       JOIN keystone.document_instance d ON d.id = sr.instance_id
       JOIN keystone.tenant_directory t ON t.id = d.tenant_id
      WHERE sr.instance_id = $1
      ORDER BY sr.signer_order`,
    [instanceId]);

  // ★ Opens — `keystone.document_open` (0418), append-only. Plain ISO (UTC); this is a log of
  //   instants, not a wall-clock fact a signer needs read back in their own zone.
  const { rows: opens } = await db.query(
    `SELECT opened_at AS at, ip, user_agent
       FROM keystone.document_open
      WHERE instance_id = $1
      ORDER BY opened_at`,
    [instanceId]);

  // ★ `sent_to` — the real recipients this instrument was actually sent to, read from the
  //   notification this application itself created for `documents.document.sent`
  //   (`src/queue/tasks.mjs`'s `TOPIC_HANDLERS["documents.document.sent"]`, whose own comment states
  //   the recipient IS `subject_user_id`, never `assigned_to` — "emailing `assigned_to` would be
  //   emailing a word"). Evidence of what the application actually did, not a re-derivation from the
  //   party vocabulary.
  const sentTo = await (await ports()).notices.sentToEmails(db, { instanceId });

  return {
    signers,
    sent_to: sentTo,
    opens,
    version: inst.version ?? null,
    published_at: inst.published_at ?? null,
    reference: instanceId,
    retention_sentence: await retentionSentence(db),
  };
}

/**
 * GET /api/documents/:id/decline → { declined_at, reason, held_booking: null }
 * `reason` is read from `keystone.record_reason` (0195 — viewer-aware RLS already staff-only; kept
 * OUT of the `documents.document.declined` event payload by `src/documents/writes.mjs:707-717`'s own
 * ruling, restated in the test rather than re-decided here).
 * `held_booking` is ALWAYS `null` — field 4's own literal shape. Nothing in this schema or codebase
 * tracks a booking held pending a document's signature [MEASURED: no `held_booking`/`held_for` column
 * or module anywhere]; this is a stated placeholder, not a computed absence.
 */
async function readDecline(db, { viewerId, instanceId }) {
  const { rows: [inst] } = await db.query(
    `SELECT d.id, d.declined_at
       FROM keystone.document_instance d
      WHERE d.id = $2 AND d.archived_at IS NULL AND ${scoped("document", "d")}`,
    [viewerId, instanceId]);
  if (!inst) throw notFound("no such document in this organisation");

  const { rows: [reasonRow] } = await db.query(
    `SELECT reason FROM keystone.record_reason
      WHERE subject_type = 'document' AND subject_id = $1 AND kind = 'decline'
      ORDER BY created_at DESC LIMIT 1`,
    [instanceId]);

  return {
    declined_at: inst.declined_at,
    reason: reasonRow?.reason ?? null,
    held_booking: null,
  };
}

/**
 * GET /api/documents/variables →
 *   { fields: [{name, label, sample, why, domain, deprecated?}, ...] }
 * Returns the variable catalogue filtered by the caller's role. Redaction is server-side:
 * a coach receives zero `audience: 'admin'` rows — they are absent from the response,
 * not hidden in the browser. Deprecated rows are included (for saved bodies to still resolve)
 * but the FieldPicker hides them from its rendered list.
 * Callable by any authenticated role (staff/coach/client).
 */
async function readVariables(role = 'admin') {
  const catalogue = variableCatalogue(role);
  // Strip server-side implementation details: remove `read`, `fallback`, and `audience`
  // Keep: name, label, sample, why, domain, deprecated (aliasOf is internal metadata, drop it)
  return catalogue.map(field => ({
    name: field.name,
    label: field.label,
    sample: field.sample,
    why: field.why,
    domain: field.domain,
    ...(field.deprecated && { deprecated: true }),
  }));
}

/** Read routes — mounted by 14.41, same shape as `itemsCatalogue.mjs`'s `registerCatalogueReads`. */
export function registerDocumentRecordReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/documents/:id/certificate", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const instanceId = c.req.param("id");
      if (!UUID_RE.test(instanceId)) throw invalid("id must be a valid UUID");
      const isPlatform = await tenantIsPlatform(db, tenantId);
      guardStaffSection(principal, isPlatform);

      const data = await readCertificate(db, { viewerId: principal.appUserId, instanceId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));

  // ★ F130 (23 Oct 2026) — the document itself, as it reads now, for the staff record page (the same one document view the signer and the PDF read)
  app.get("/api/documents/:id/view", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const instanceId = c.req.param("id");
      if (!UUID_RE.test(instanceId)) throw invalid("id must be a valid UUID");
      const isPlatform = await tenantIsPlatform(db, tenantId);
      guardStaffSection(principal, isPlatform);
      const { instanceViewFor } = await import("../documents/preview.mjs");
      const data = await instanceViewFor(db, { tenantId, instanceId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));

  app.get("/api/documents/:id/decline", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const instanceId = c.req.param("id");
      if (!UUID_RE.test(instanceId)) throw invalid("id must be a valid UUID");
      const isPlatform = await tenantIsPlatform(db, tenantId);
      guardStaffSection(principal, isPlatform);

      const data = await readDecline(db, { viewerId: principal.appUserId, instanceId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));

  app.get("/api/documents/variables", (c) =>
    runTenantScoped(c, async ({ principal }) => {
      // ★★★ the maintainer, 1 Oct 2026 — OWNER-ACCESS AUDIT, FOUND LIVE: this passed `principal.user.role`
      //     straight into `variableCatalogue(role)`, whose own 'admin' branch is the ONLY one that
      //     returns every field. But `user.role` is the PARTY axis — 'staff', 'adult_client',
      //     'adolescent_client' — never the literal string 'admin'. `staff_role` (member/admin/
      //     owner) is the RANK axis, and it was never read here at all. So `variableCatalogue`'s
      //     'admin' branch — `if (role === 'admin') return true` — was UNREACHABLE through this
      //     caller for every staff person who has ever called this route, owner included: every
      //     staff member, regardless of rank, got the SAME narrowed 'staff' audience as a Coach.
      //     Not the 403 this audit was chasing (this route never refuses — it just under-serves),
      //     but the same root CLASS: an ad-hoc string check that has never heard of the rank axis.
      //     `effectiveRank` is the one function that already knows how to turn a principal into
      //     'owner'/'admin'/'member'/'client' correctly — reused here rather than re-deriving it.
      const rank = effectiveRank(principal.user);
      const catalogueRole = (rank === "owner" || rank === "admin") ? "admin"
        : rank === "member" ? "staff"
        : "client";
      const fields = await readVariables(catalogueRole);
      return { data: { fields } };
    }, { bucket: "records" }).then((r) => c.json(r)));
}
