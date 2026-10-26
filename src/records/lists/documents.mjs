// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0b — THE DOCUMENTS SECTION'S LIST DESCRIPTORS.
// ★★★ SPLIT OUT OF THE 627-LINE `lists.mjs` SO THE 13 P6 SECTION BATCHES CAN RUN CONCURRENTLY.
//     All 29 descriptors lived in ONE file, keyed by nav path. Descriptors are the BULK of P6,
//     so with four subagents building four sections at once, every one of them would have had to
//     queue on this single file — and the parallelism would have collapsed to the screens only.
// ★★ THE SHARED PIECES STAY SHARED. `scoped()` and the column groups live in `_shared.mjs` and
//    are imported, never copied: two lists over the same table must not disagree about a label,
//    and 29 hand-written scope predicates would be 29 chances to write the wrong one (`F146`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.B7 — WHAT THIS BATCH CHANGED, AND WHY EACH LIST NOW CARRIES MORE THAN IT RENDERS
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.36 requires the pipeline to MOVE A DOCUMENT'S STATE from the screen, and P6.43 requires the
// executed list to reach the PDF. Neither is decidable from the five DOCUMENT_COLUMNS alone:
//
//   · WHICH CONTROL MAY BE DRAWN is a function of `state`, and `state` alone is not enough for
//     "record a signature": `recordSignature` refuses an instrument whose TYPE declares no signer
//     configuration, in those words, because a signature accepted in an undefined order cannot
//     later be shown to have been in order. So the row carries `signer_config` and how many
//     signatures already exist, and the screen resolves WHO SIGNS NEXT through the ONE declaration
//     of the order — SIGNER_CONFIGS in src/documents/vocabulary.mjs. It is never restated.
//   · WHETHER THE PDF LINK IS A LINK AT ALL. [MEASURED 2026-09-15] keystone.document_pdf held ZERO
//     rows while one instrument was executed, and fetchArchivedPdf answers 404 when the archive row
//     is absent. An unconditional link on every executed row would therefore have been a DEAD LINK
//     on 1 of 1 rows in the reference practice. `has_pdf` is what lets the screen tell
//     "not executed yet" from "executed, not archived yet" — the two the 404 message itself
//     distinguishes.
//
// ★★★ THE EXTRA COLUMNS ARE SELECTED, NOT RENDERED, AND THAT IS DELIBERATE. `columns` governs the
//     table; the route returns whole rows. A signer configuration and a boolean are facts the SCREEN
//     needs to decide what to offer — they are not columns a person reads, and rendering them would
//     put a raw enum in front of staff to no purpose (U30's neighbourhood).
//
// ★★ AND THE INSTANCE SELECT IS A LOCAL BUILDER, NOT AN EDIT TO `documentList` IN `_shared.mjs`.
//    `_shared.mjs` is imported by all eight section modules while four agents hold this tree, and
//    this tree is not a git repository. The predicate that MATTERS — `scoped()` — is still imported
//    and never copied, which is the property `F142` and the per-section gate actually guard.
//    ★ Folding this builder back into `_shared.mjs` once the batches land is item 5 of
//      ~/example-rebuild/handoffs/p6-documents.md.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  scoped, DOCUMENT_COLUMNS, TEMPLATE_COLUMNS, emptyOf,
} from "./_shared.mjs";

// ★ the maintainer, 29 Sep 2026 — Templates' "All" and "Retired" tabs mix both builders, so (unlike the two
//   per-builder lists below, which don't need to say it) the row has to name which one it is.
const TEMPLATE_COLUMNS_WITH_BUILDER = [
  { field: 'name',       label: 'Template', format: 'text' },
  { field: 'builder',    label: 'Type',     format: 'enum' },
  { field: 'version',    label: 'Version',  format: 'number' },
  { field: 'instances',  label: 'In use',   format: 'number' },
  { field: 'active',     label: 'Active',   format: 'boolean' },
];

// ★ The columns every instance list needs, whether or not it renders them. One place, so the
//   pipeline and the two "all" lists cannot disagree about what a row knows about itself.
//   ★★ `signatures` is a COUNT over a subcollection-shaped table, not a field on the row. The
//      sibling project recorded exactly this mistake twice in one session: reading a signature
//      summary off the document returned undefined and read as "nothing has been signed".
//      Wrong place, not wrong value. Count the rows.
const instanceList = (where) => `
  SELECT d.id, d.title, d.builder, d.state, d.sent_at, d.executed_at, d.created_at, d.updated_at, d.is_test, (SELECT tm.name FROM keystone.document_team tm WHERE tm.id = d.team_id) AS team,
         d.source_channel = 'form' AS from_form, (SELECT ft.name FROM keystone.document_template ft WHERE ft.family_id = d.form_id ORDER BY ft.version DESC LIMIT 1) AS form_name,   -- Run 7: the Documents "From a form" filter
         coalesce((SELECT s.display_name FROM keystone.person_directory s WHERE s.id = d.subject_user_id), (SELECT p.name FROM keystone.document_party p WHERE p.instance_id = d.id ORDER BY p.position, p.created_at LIMIT 1)) AS subject,   -- a signed document outlives its person: the island's own snapshot names them (QUEUE §23.3.6)
         (SELECT t.signer_config FROM keystone.document_type t WHERE t.id = d.type_id) AS signer_config,
         (SELECT count(*)::int FROM keystone.signature_record sr WHERE sr.instance_id = d.id) AS signatures,
         -- the ribbon (COMBINED-STYLE-SPEC section 7) is read from these true facts: seats that must sign (a signing group is ONE seat), seats that have, people who opened it, who is next, who opened it last
         (SELECT count(DISTINCT CASE WHEN p.group_label IS NOT NULL THEN 'g:' || p.role || ':' || p.group_label ELSE p.id::text END)::int FROM keystone.document_party p WHERE p.instance_id = coalesce(d.package_lead_id, d.id) AND p.action_role IN ('signer', 'approver')) AS parties_total,
         (SELECT count(DISTINCT CASE WHEN p.group_label IS NOT NULL THEN 'g:' || p.role || ':' || p.group_label ELSE p.id::text END)::int FROM keystone.document_party p WHERE p.instance_id = coalesce(d.package_lead_id, d.id) AND p.action_role IN ('signer', 'approver') AND p.status IN ('signed', 'approved')) AS parties_signed,
         (SELECT count(*)::int FROM keystone.document_party p WHERE p.instance_id = coalesce(d.package_lead_id, d.id) AND p.viewed_at IS NOT NULL) AS parties_opened,
         (SELECT p.name FROM keystone.document_party p WHERE p.instance_id = coalesce(d.package_lead_id, d.id) AND p.action_role IN ('signer', 'approver') AND p.status NOT IN ('signed', 'approved', 'declined', 'cancelled') ORDER BY p.position, p.created_at LIMIT 1) AS next_party,
         (SELECT p.name FROM keystone.document_party p WHERE p.instance_id = coalesce(d.package_lead_id, d.id) AND p.viewed_at IS NOT NULL ORDER BY p.viewed_at DESC LIMIT 1) AS opened_by,
         (SELECT array_agg(x.name ORDER BY x.position, x.created_at) FROM (SELECT p.name, p.position, p.created_at FROM keystone.document_party p WHERE p.instance_id = coalesce(d.package_lead_id, d.id) AND p.action_role IN ('signer', 'approver') ORDER BY p.position, p.created_at LIMIT 4) x) AS party_names
    FROM keystone.document_instance d
   WHERE d.archived_at IS NULL AND (${scoped('document', 'd')} OR (d.archived_at IS NULL AND keystone.document_on_team($1::uuid, d.team_id))) AND keystone.document_team_visible($1::uuid, d.team_id, d.created_by) AND (${where})
   ORDER BY coalesce(d.sent_at, d.created_at) DESC, d.id`;

// ★ A TEMPLATE IS NOT AN INSTANCE. Templates are the practice's own library — they belong to no
//   caseload, so there is nothing to scope them BY. They still take the `$1::uuid IS NOT NULL` check
//   for the parameter-arity reason `_shared.mjs` states, and so that a request with no viewer
//   returns nothing here too.
// ★★★ AND THE ROW CARRIES ITS `body`, WHICH THE SHARED BUILDER DOES NOT. P15C.8's law is that a new
//     version is a NEW ROW and the old one is never edited — so "author version 2" means authoring a
//     WHOLE body, and the only humane way to do that is to open the existing one and change what is
//     wrong with it. Without the body on the row, the version control would be a blank builder, and
//     re-typing a legal instrument from memory to fix one clause is how clauses get lost.
//   ★★ It is SELECTED, not RENDERED: `columns` governs the table, and the prose is for the builder.
// ★ the maintainer, 29 Sep 2026 — `builder` and `activeFilter` are both optional now: the two per-builder lists
//   below pass `builder` alone (unchanged query shape, unchanged result), and Templates' All/
//   Retired tabs pass neither or `activeFilter` alone to cross both builders. Never string-built
//   from a caller's value — `builder` only ever comes from the two literal call sites in this file.
const templateRows = (builder = null, activeFilter = null) => `
  SELECT t.id, t.name, t.builder, t.version, t.active, t.updated_at, t.body,
         t.description, t.client_description, t.message,
         -- THE TEMPLATE SETTINGS. The editor opens from this row and reads these. They were not selected, so the Settings tab opened BLANK for every
         -- template and every Save wrote the blanks back (type NULL, then "this document has no document type" at send). The editor reads the
         -- name requires_parent_under18, hence the alias.
         t.type_id, t.requires_parent_under_18 AS requires_parent_under18, t.re_sign_months, t.creates_subscription_plan_id,
         t.teen_template_id, t.sells_type, t.sells_id, t.labels, t.signed_copy,
         (SELECT count(*) FROM keystone.document_instance di WHERE di.template_id = t.id) AS instances,
         (SELECT count(*) FROM keystone.document_instance di
           WHERE di.template_id = t.id AND di.state <> 'draft') AS sent_instances
    FROM keystone.document_template t
   WHERE $1::uuid IS NOT NULL AND keystone.document_team_visible($1::uuid, t.team_id, NULL)
     ${builder ? `AND t.builder = '${builder}'` : ''}
     ${activeFilter === true ? 'AND t.active = true' : activeFilter === false ? 'AND t.active = false' : ''}
   ORDER BY t.name, t.version DESC, t.id`;

export const DOCUMENTS_LISTS = Object.freeze({
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ the maintainer's ruling, 29 Sep 2026 (Square Contracts rebuild) — THREE TABS: Documents, Templates,
  //     Clauses. "Documents" is every copy made from a template for one person, Draft through
  //     Expired, both builders together — status/template/date are FILTER CHIPS the screen applies
  //     client-side over one fetch (same pattern DocsList.jsx's own Agreements/Forms/Retired chips
  //     already use), not separate nav rows or separate list descriptors. `instanceList('true')`
  //     is the SAME builder every other instance list here already uses, just with no state/builder
  //     restriction — Draft is included on purpose (it was excluded everywhere else on purpose too;
  //     this is the one list a draft belongs on, since "everything made from a template" includes
  //     the ones nobody has sent yet).
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  '/documents': {
    title: 'Documents', recordType: 'document', columns: DOCUMENT_COLUMNS,
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconFileText',
      headline: 'Nothing here yet',
      line: 'Every copy made from a template for one person — drafted, sent, signed, declined or expired.',
      action: { label: 'New document', href: '/documents?new=1' },
    }),
    sql: instanceList('true'),
  },
  // ★ Templates: both builders, active and retired, together — Agreement/Form/Retired are filter
  //   chips over this one fetch, not separate routes. Identical SQL to the old `/documents/templates/
  //   all` below (kept, unchanged, for the handful of internal callers still reading it directly).
  '/documents/templates': {
    title: 'Templates', columns: TEMPLATE_COLUMNS_WITH_BUILDER,
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconTemplate',
      headline: 'Create your first template',
      line: 'The words an agreement is made of, or the questions a form asks. Nothing can be sent until one exists.',
      action: { label: 'New template', href: '/documents/templates?new=1' },
    }),
    sql: templateRows(),
  },
  '/documents/pipeline': {
    title: 'Pipeline', recordType: 'document',
    columns: [
      ...DOCUMENT_COLUMNS,
      { field: 'age_days', label: 'Out for (days)', format: 'number' },
    ],
    // ★★ "PIPELINE" REPLACES "AWAITING SIGNATURE" — §A5: "everything in motion, contracts and
    //    forms TOGETHER, because the question is 'what is out', not 'what needs a signature'."
    // ★★★ AND A DRAFT IS NOT IN MOTION, SO **SEND CAN NEVER BE OFFERED HERE**. P6.36's row names
    //     send/sign/decline/execute together, but sendInstance moves draft to sent and this list
    //     excludes draft by its own definition — a Send control on this screen would be drawn over
    //     a set that can never contain a sendable row. The send control therefore lives on
    //     /documents/contracts/all and /documents/forms/all, which DO carry drafts. Recorded as a
    //     finding rather than resolved by widening this list: widening it would make the pipeline
    //     answer a different question from the one §A5 ruled it answers.
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconFileText',
      headline: 'Nothing waiting on a signature',
      line: 'Documents appear here once they are sent, and leave once they are executed.',
      action: { label: 'Send a document', href: '/documents/contracts/all?new=1' },
      blockedAction: { label: 'Create template', href: '/documents/contracts/templates?new=1' },
      blockedLine: 'Nothing can be sent yet: a contract or form template has to exist first.',
    }),
    stages: [
      { value: 'sent',             label: 'Sent',            hint: 'Asked to sign. Nobody has yet.' },
      { value: 'partially_signed', label: 'Partially signed', hint: 'Some parties have signed. Waiting on the rest.' },
    ],
    // ★★ TASK 14.40 — `band`/`open_count`/`reminders_sent` ADDED, SELECTED ONLY. Same discipline as
    //    `signer_config`/`signatures` above (this file's own header, P6.B7): the screen decides what
    //    to show from these facts (the "opened, not signed" band), they are not a rendered `columns`
    //    entry themselves. `band` is a TIME-STATE fact, not a wall-clock instant, so it carries no
    //    timezone question of its own — `EXISTS(open)` asks only "has anyone opened it", never when.
    sql: `
      SELECT d.id, d.title, d.builder, d.state, d.sent_at, d.executed_at,
             coalesce((SELECT s.display_name FROM keystone.person_directory s WHERE s.id = d.subject_user_id), (SELECT p.name FROM keystone.document_party p WHERE p.instance_id = d.id ORDER BY p.position, p.created_at LIMIT 1)) AS subject,   -- a signed document outlives its person: the island's own snapshot names them (QUEUE §23.3.6)
             (SELECT t.signer_config FROM keystone.document_type t WHERE t.id = d.type_id) AS signer_config,
             (SELECT count(*)::int FROM keystone.signature_record sr WHERE sr.instance_id = d.id) AS signatures,
             floor(EXTRACT(epoch FROM now() - d.sent_at) / 86400)::int AS age_days,
             CASE WHEN d.state = 'sent'
                       AND EXISTS (SELECT 1 FROM keystone.document_open o WHERE o.instance_id = d.id)
                  THEN 'opened' ELSE d.state END AS band,
             (SELECT count(*)::int FROM keystone.document_open o WHERE o.instance_id = d.id) AS open_count,
             d.reminders_sent
        FROM keystone.document_instance d
       WHERE d.archived_at IS NULL AND d.state IN ('sent','partially_signed')
         AND (${scoped('document', 'd')} OR (d.archived_at IS NULL AND keystone.document_on_team($1::uuid, d.team_id)))
         AND keystone.document_team_visible($1::uuid, d.team_id, d.created_by)
       ORDER BY d.sent_at ASC, d.id`,
  },
  '/documents/contracts/all': {
    title: 'All contracts', recordType: 'document', columns: DOCUMENT_COLUMNS,
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconFileCertificate',
      headline: 'No contracts yet',
      line: 'Every agreement sent, signed or executed.',
      action: { label: 'Send a contract', href: '/documents/contracts/all?new=1' },
      blockedAction: { label: 'Create template', href: '/documents/contracts/templates?new=1' },
      blockedLine: 'You have no contract templates, and a contract is a copy of one.',
    }),
    sql: instanceList(`d.builder = 'contract'`),
  },
  '/documents/contracts/templates': {
    title: 'Contract templates', columns: TEMPLATE_COLUMNS,
    // ★★ §A5: the contract builder and the form builder are SEPARATE TOOLS with SEPARATE TEMPLATE
    //    SETS, and [MEAS 0009:127,134-135] `builder` is a CHECK and the uniqueness key is scoped
    //    by it — two disjoint namespaces, already enforced by the database.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ GROUP A REWORK, WORKSTREAM 2, item 2.5 [TY, RULED 22 Sep 2026] — `starters` PORTED FROM
    //     `specs/mockups/EmptyDocuments.frame.html`, re-read fresh. **FLAGGED, MEASURED CONFLICT:**
    //     that frame shows ONE unified "All documents" list with a 4-card gallery mixing "Signature"
    //     and "Form" chip cards — but the LIVE nav (`src/nav/sections.mjs:92-101`) has no such route;
    //     it splits Contracts and Forms into "SEPARATE TOOLS with SEPARATE TEMPLATE SETS" (this
    //     file's own comment above, backed by a DB-level CHECK constraint) — a locked decision the
    //     frame predates or never reflected. Rather than invent a route that doesn't exist or force
    //     one builder's screen to offer the other builder's templates, the frame's 3 "Signature"
    //     cards are ported HERE (the frame's "Coaching agreement", "Release of information", "Parent
    //     consent") and its 1 "Form" card goes to `/documents/forms/templates` below — sorted by the
    //     frame's OWN chip, not invented. Flagging this rather than silently picking one route.
    //   ★ "Upload your own PDF" (the frame's alt-link) is NOT a real capability — MEASURED via
    //     `webui/src/lib/app/surfaceRegistry.js:54-55`, `?new=1` on this route mounts only
    //     `templateBuilder`, no upload surface exists — so `altHref` points at the same real
    //     from-scratch builder with the honest default label, not the frame's upload wording.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconTemplate',
      headline: 'Create your first contract template',
      line: 'The words an agreement is made of. Nothing can be sent for signature until one exists.',
      action: { label: 'Create template', href: '/documents/contracts/templates?new=1' },
    }),
    sql: templateRows('contract'),
  },
  '/documents/forms/all': {
    title: 'All forms', recordType: 'document', columns: DOCUMENT_COLUMNS,
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconForms',
      headline: 'No forms yet',
      line: 'Intake forms, questionnaires and anything else a client fills in.',
      action: { label: 'Send a form', href: '/documents/forms/all?new=1' },
      blockedAction: { label: 'Create template', href: '/documents/forms/templates?new=1' },
      blockedLine: 'You have no form templates, and a form is a copy of one.',
    }),
    sql: instanceList(`d.builder = 'form'`),
  },
  '/documents/forms/templates': {
    title: 'Form templates', columns: TEMPLATE_COLUMNS,
    // ★ GROUP A REWORK, WORKSTREAM 2, item 2.5 — the "Form"-chip half of `EmptyDocuments.frame.html`'s
    //   4-card gallery; see `/documents/contracts/templates` above for the full flagged split rationale.
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconTemplate',
      headline: 'Create your first form template',
      line: 'The questions a form asks. Nothing can be sent to be completed until one exists.',
      action: { label: 'Create template', href: '/documents/forms/templates?new=1' },
    }),
    sql: templateRows('form'),
  },
  '/documents/executed': {
    title: 'Executed', recordType: 'document',
    columns: [
      { field: 'title',       label: 'Document', format: 'text' },
      { field: 'subject',     label: 'Subject',  format: 'text' },
      { field: 'builder',     label: 'Builder',  format: 'enum' },
      { field: 'executed_at', label: 'Executed', format: 'datetime' },
    ],
    // ★★★ U25 — every row here is IMMUTABLE. The UI half is `readOnlyWhen` on the descriptor;
    //     the DATABASE half is a trigger and DOES NOT EXIST YET (P15C.11). Hard limit 3 needs
    //     both, and this list is not evidence of either.
    // ★★ THE SCREEN OFFERS NO STATE CONTROL ON THESE ROWS AT ALL, and that is not politeness: the
    //    write path already refuses — execute answers 409 "already executed and cannot be executed
    //    again (U25)", sign answers 409 "an executed or void one cannot", decline the same. The
    //    screen simply stops promising something the server will refuse.
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconFileCheck',
      headline: 'Nothing executed yet',
      line: 'Fully signed documents land here permanently. This is the legal record.',
      action: { label: 'Send a document', href: '/documents/contracts/all?new=1' },
      blockedAction: { label: 'Create template', href: '/documents/contracts/templates?new=1' },
      blockedLine: 'Nothing can be executed yet: a template has to exist before anything can be sent.',
    }),
    sql: `
      SELECT d.id, d.title, d.builder, d.state, d.sent_at, d.executed_at,
             coalesce((SELECT s.display_name FROM keystone.person_directory s WHERE s.id = d.subject_user_id), (SELECT p.name FROM keystone.document_party p WHERE p.instance_id = d.id ORDER BY p.position, p.created_at LIMIT 1)) AS subject,   -- a signed document outlives its person: the island's own snapshot names them (QUEUE §23.3.6)
             (SELECT count(*)::int FROM keystone.signature_record sr WHERE sr.instance_id = d.id) AS signatures,
             EXISTS (SELECT 1 FROM keystone.document_pdf p WHERE p.instance_id = d.id) AS has_pdf
        FROM keystone.document_instance d
       WHERE d.archived_at IS NULL AND d.state = 'executed'
         AND (${scoped('document', 'd')} OR (d.archived_at IS NULL AND keystone.document_on_team($1::uuid, d.team_id)))
         AND keystone.document_team_visible($1::uuid, d.team_id, d.created_by)
       ORDER BY d.executed_at DESC, d.id`,
  },

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ the maintainer's ruling, 29 Sep 2026 — SENT: one list, both builders, split by STATE. Reuses
  //     `instanceList()` exactly as the old per-builder "all" lists did — same columns, same scope,
  //     same ordering — just without the `builder =` restriction, and with a state filter instead.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  '/documents/sent/all': {
    title: 'Sent', recordType: 'document', columns: DOCUMENT_COLUMNS,
    ...emptyOf({
      kind: 'blocked',
      icon: 'IconFileText',
      headline: 'Nothing sent yet',
      line: 'Every agreement or form sent, opened, signed or declined.',
      action: { label: 'Send a document', href: '/documents/templates/all?new=1' },
      blockedAction: { label: 'Create template', href: '/documents/templates/all?new=1' },
      blockedLine: 'You have no templates yet, and a sent document is a copy of one.',
    }),
    sql: instanceList(`d.state <> 'draft'`),
  },
  '/documents/sent/waiting': {
    title: 'Waiting', recordType: 'document', columns: DOCUMENT_COLUMNS,
    // ★ `filtered`, not `blocked` — being empty here says nothing about whether a template exists;
    //   it means nothing is CURRENTLY sitting unsigned, which is good news, not a missing prereq.
    ...emptyOf({
      kind: 'filtered',
      icon: 'IconFileText',
      headline: 'Nothing waiting on a signature',
      line: 'Documents appear here once they are sent, and leave once they are executed, declined or expired.',
      action: { label: 'Send a document', href: '/documents/templates/all?new=1' },
    }),
    sql: instanceList(`d.state IN ('sent', 'partially_signed')`),
  },
  '/documents/sent/signed': {
    title: 'Signed', recordType: 'document', columns: DOCUMENT_COLUMNS,
    // ★★★ U25 — every row here is IMMUTABLE, same as the old `/documents/executed` list this
    //     replaces (that list's own header note applies verbatim; not restated here).
    ...emptyOf({
      kind: 'filtered',
      icon: 'IconFileCheck',
      headline: 'Nothing signed yet',
      line: 'Fully signed documents land here permanently. This is the legal record.',
      action: { label: 'Send a document', href: '/documents/templates/all?new=1' },
    }),
    sql: instanceList(`d.state = 'executed'`),
  },
  '/documents/sent/declined': {
    title: 'Declined', recordType: 'document', columns: DOCUMENT_COLUMNS,
    ...emptyOf({
      kind: 'filtered',
      icon: 'IconFileX',
      headline: 'Nothing declined',
      line: 'A document lands here if the person it was sent to declined to sign it.',
      action: { label: 'Send a document', href: '/documents/templates/all?new=1' },
    }),
    sql: instanceList(`d.state = 'declined'`),
  },
  '/documents/sent/expired': {
    title: 'Expired', recordType: 'document', columns: DOCUMENT_COLUMNS,
    ...emptyOf({
      kind: 'filtered',
      icon: 'IconFileX',
      headline: 'Nothing expired',
      line: 'A document lands here if nobody signed it before its deadline.',
      action: { label: 'Send a document', href: '/documents/templates/all?new=1' },
    }),
    sql: instanceList(`d.state = 'expired'`),
  },

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ TEMPLATES: one list, both builders, split by builder + retired. Reuses `templateRows()`.
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  '/documents/templates/all': {
    title: 'Templates', columns: TEMPLATE_COLUMNS_WITH_BUILDER,
    ...emptyOf({
      kind: 'first-run',
      icon: 'IconTemplate',
      headline: 'Create your first template',
      line: 'The words an agreement is made of, or the questions a form asks. Nothing can be sent until one exists.',
      action: { label: 'New template', href: '/documents/templates/all?new=1' },
    }),
    sql: templateRows(),
  },
  '/documents/templates/agreements': {
    title: 'Agreements', columns: TEMPLATE_COLUMNS,
    ...emptyOf({
      kind: 'filtered',
      icon: 'IconTemplate',
      headline: 'No agreement templates yet',
      line: 'The words an agreement is made of. Nothing can be sent for signature until one exists.',
      action: { label: 'New template', href: '/documents/templates/all?new=1' },
    }),
    sql: templateRows('contract', true),
  },
  '/documents/templates/forms': {
    title: 'Forms', columns: TEMPLATE_COLUMNS,
    ...emptyOf({
      kind: 'filtered',
      icon: 'IconTemplate',
      headline: 'No form templates yet',
      line: 'The questions a form asks. Nothing can be sent to be completed until one exists.',
      action: { label: 'New template', href: '/documents/templates/all?new=1' },
    }),
    sql: templateRows('form', true),
  },
  '/documents/templates/retired': {
    title: 'Retired', columns: TEMPLATE_COLUMNS_WITH_BUILDER,
    ...emptyOf({
      kind: 'filtered',
      icon: 'IconTemplate',
      headline: 'Nothing retired',
      line: 'A template lands here once it is switched off — existing signed copies are never affected.',
      action: { label: 'New template', href: '/documents/templates/all?new=1' },
    }),
    sql: templateRows(null, false),
  },

  // ══ MONEY ══════════════════════════════════════════════════════════════════
});
