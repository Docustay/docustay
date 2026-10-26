// src/documents/domain.mjs — THE ISLAND'S DECLARATION (ISLAND-PROGRAMS.md §2, plan (c)).
//
// Documents (Docustay) is an island. Other domains' cross-cutting registries (delete / archive / merge /
// record shell / ownership / link-token purposes / sandbox / redaction) used to NAME Documents' tables
// themselves, which is an inward wall crossing. This file inverts that: Documents DECLARES what it
// contributes to each registry, in ONE frozen object, and each registry spreads its own slice in.
//
// ★ THE RULE. This file imports ONLY from src/documents/*. It currently imports nothing at all — it is
//   pure data. Consumers import it ONLY through src/documents/frontDoor.mjs (`DOCUMENTS_DOMAIN`).
// ★ Every value below was lifted verbatim from the consumer that used to hold it — behaviour is unchanged.

export const DOCUMENTS_DOMAIN = Object.freeze({
  // ── records/delete.mjs ────────────────────────────────────────────────────────────────────────────
  // The shared-delete entries (keys are the record TYPES the route accepts; unchanged).
  deletable: Object.freeze({
    document_template: { table: "document_template", noun: "document template" },
    document:          { table: "document_instance", noun: "document", retention: true },
    clause:            { table: "document_clause",   noun: "clause" },
  }),
  // What a document table's rows are called when the delete plan says "this will also remove …".
  tableNouns: Object.freeze({
    document_instance: Object.freeze(["document", "documents"]),
    signature_record:  Object.freeze(["signature", "signatures"]),
    document_party:    Object.freeze(["person on a document", "people on documents"]),
    document_key_date: Object.freeze(["key date", "key dates"]),          // Run 9 Part 3.4
    document_playbook_run: Object.freeze(["playbook run", "playbook runs"]),   // Run 9 Part 3.6
    document_witness:  Object.freeze(["witness signature", "witness signatures"]),   // Run 9 Part 3.3
  }),
  // These types are protected by DB guards (migration 0581: document_instance_terminal_no_delete,
  // esign_acceptance_no_delete, signature_record_is_immutable) that only yield to the audited
  // `keystone.record_delete_reason` GUC — so a delete that touches them must set it.
  deleteGuardOverride: true,
  // The tables those guards sit on. A delete of ANY record type (a person, say) whose cascade — or whose
  // ON DELETE SET NULL, e.g. signature_record.signer_uid — reaches one of these also needs the override.
  deleteGuardTables: Object.freeze(["document_instance", "signature_record", "esign_disclosure_acceptance"]),

  // ── records/archive.mjs ───────────────────────────────────────────────────────────────────────────
  archivable: Object.freeze({
    document: { table: "document_instance", section: "documents", topic: "documents.document.archived" },
  }),

  // ── records/merge.mjs — every (table, column) pair of Documents' that points at app_user ──────────
  mergeColumns: Object.freeze([
    { table: "document_instance", column: "created_by" },
    { table: "document_instance", column: "subject_user_id" },
    { table: "esign_disclosure_acceptance", column: "app_user_id" },
    { table: "signature_record", column: "signer_uid" },
  ]),

  // ── records/shell.mjs ─────────────────────────────────────────────────────────────────────────────
  // The `related` entry a PERSON record shows for Documents.
  personRelated: Object.freeze([
    { key: 'documents', kind: 'list', label: 'Documents', of: 'document' },
  ]),
  // The record-type shell for `document`.
  recordShell: Object.freeze({
    document: {
      key: 'document', label: 'Document', section: 'documents',
      notFound: { headline: 'No such document',
                  line: 'This document is not in your practice, or you may not see it. An executed instrument is never deleted, so a missing one has usually been addressed to somebody else.' },
      // ★★★ F12 — WAS 'name', AND THERE IS NO `name` COLUMN. It is `title` now, added by migration
      //     0022 as NOT NULL and frozen at creation. See that file for why neither a join to
      //     document_template nor a read of template_snapshot was acceptable.
      header: { title: 'title', status: 'state' },
      highlights: [
        { key: 'title',   label: 'Document', from: 'document_instance.title',   empty: 'Untitled', format: 'text' },
        { key: 'state',   label: 'State',    from: 'document_instance.state',   empty: 'Unknown', format: 'enum' },
        { key: 'subject', label: 'Subject',  from: 'derived:document_subject',  empty: 'Nobody named', format: 'text' },
        { key: 'age',     label: 'Out for',  from: 'derived:days_since_sent',   empty: 'Not sent', format: 'text' },
      ],
      // ★ F130 (23 Oct 2026) — "Builder: Contract" is how the code files a document, not something a person reads; it is no longer shown
      panels: [{ key: 'basics', label: 'Basics', fields: [
        { field: 'state',       label: 'State',    format: 'enum' },
        { field: 'sent_at',     label: 'Sent',     format: 'datetime' },
        { field: 'executed_at', label: 'Executed', format: 'datetime' },
      ] }],
      related: [],
      // ★★ HARD LIMIT 3, at the UI layer. An executed instrument is READ-ONLY: its words are frozen
      // and its signatures attest to those words.
      // ★★★ AND THIS IS ONLY HALF OF U25. The DATABASE half — a trigger refusing an UPDATE to an
      //     executed row — DOES NOT EXIST YET and is P15C.11. `readOnlyWhen` is a FLAG, not a
      //     refusal. Do not read this line as U25 being satisfied.
      readOnlyWhen: { state: 'executed' },
    },
  }),

  // ── permissions/ownership.mjs ─────────────────────────────────────────────────────────────────────
  ownership: Object.freeze({
    document: {
      // ★★★ CORRECTED AT P1.7, AND THE ERROR IS WORTH KEEPING VISIBLE. P1.4 wrote
      //     `ownerColumn: "assigned_to"` here, following RECON 2's description of it as
      //     "ownership-shaped". [MEASURED] `document_instance.assigned_to` is **text[]** and holds
      //     PARTY ROLE NAMES — `{pir,coach}` — not a user id. It is the list of WHICH PARTIES may
      //     have the document, which `document_is_visible()` reads; it has never been an owner.
      //   ★★ P1.4's own gate passed it, because it asserted the column EXISTS and its NULLability and
      //      never that it holds a PERSON. An ownership map is a claim about identity, so the gate now
      //      checks the type and the values too. Filed as F146.
      table: "document_instance", ownerColumn: null, nullable: true, ownable: true,
      // ★★★ INDIRECT OWNERSHIP. A document has no owner of its own — it belongs to whoever owns the
      //     person it is ABOUT. `A coach sees their caseload's paperwork` is the rule, and it is a
      //     join, not a column. Stated explicitly so P1.7 generates a subselect rather than a
      //     comparison against a column that does not mean what its name suggests.
      ownerVia: { column: "subject_user_id", joinTable: "app_user", joinOwnerColumn: "owner_user_id" },
      // Run 4 round 2: a document sent to an outside signer has no subject person, so it had NO owner and a Member ("edit own documents") could not save, send or remind on their own upload. It falls back to whoever made it.
      ownerFallbackColumn: "created_by",
      note: "no owner of its own — scoped through the SUBJECT's owner. `assigned_to` is text[] of party roles, NOT a person.",
    },
  }),

  // ── auth/linkToken.mjs — purpose -> subject type (spec 03 §7 "sign document"; the instance is
  //    keystone.document_instance, 0009) ───────────────────────────────────────────────────────────
  linkTokenPurposes: Object.freeze({
    document_signature: "document_instance",
    // QUEUE §23.4.10 — an uploaded document's signing link (issued to a document_party) and the sender's own "send me a test" link
    pdf_signature: "document_instance",
    pdf_test: "document_instance",
    // Part 30 item 5 — an expirable link to the sealed copy, issued to one document_party
    pdf_download: "document_instance",
  }),

  // ── sandbox/writes.mjs ────────────────────────────────────────────────────────────────────────────
  sandbox: Object.freeze({
    // configuration the sandbox copies, in FK order
    copyTables: Object.freeze(["document_category", "document_type", "document_template"]),
    // what it will never copy, and why
    refuseTables: Object.freeze({
      document_instance: "an executed instrument must exist ONCE — §M0 LAW 3 and U25 exist to guarantee that",
      signature_record: "a signature is evidence about a real act by a real person; there is no second copy of it",
      esign_disclosure_acceptance: "a statutory consent belongs to the person who gave it, in the tenant they gave it in",
    }),
  }),

  // ── platform/redact.mjs — result columns that carry a document's frozen body ──────────────────────
  redactColumns: Object.freeze(["template_snapshot"]),
});
