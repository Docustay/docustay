// @ts-check
// Stage 14 task 14.38 — PDF IMPORT, THE SERVER HALF.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE SPLIT, STATED ONCE, HERE. The BROWSER half (task 14.68, pdf.js in the page — NOT built by
//     this task and NOT edited here) does three things this module never does: it reads the PDF's
//     bytes, it runs pdf.js over them to find text and candidate fields, and it PUTs the original
//     bytes straight to object storage through 14.77's presigned ticket. **This module never reads,
//     receives or parses a PDF byte.** What crosses the wire INTO this module is already text the
//     browser extracted (page text and field snippets, sent as plain JSON strings) plus a SHA-256 of
//     that text and the storage key the browser's PUT used. What this module hands back is a row id,
//     a state, and — on confirm — a template id. The bytes never pass through the application in
//     either direction (R-14.12); this module only ever touches their HASH and their KEY.
//
// ★★★ AN UPLOADED PDF IS UNTRUSTED INPUT FROM OUTSIDE, AND SO IS EVERYTHING pdf.js EXTRACTED FROM
//     IT. Every string arriving here — `fileName`, every detected field's `label`/`snippet`/`variable`,
//     every confirmed paragraph's `text` — is DATA, never parsed, never executed, never treated as a
//     path or a URL. The only "interpretation" this module performs is a closed-set membership test
//     (is this `kind` one of three literals; is this `variable` one of the six catalogue names) and a
//     length/shape check. Nothing here ever `eval`s, requires, fetches, or renders anything the PDF's
//     text contains.
//
// ★★★ REVIEWED BEFORE IT CAN EVER REACH AN INSTRUMENT. `confirmImport` produces a DRAFT template
//     (`active = false, published_at = NULL`) — never an instance, never anything sent, never
//     anything signed. It cannot be reached until an owner/author has looked at each detected field
//     and explicitly kept it (`confirmedFields` is the KEPT subset the caller chose, not the raw
//     detection) — see task 14.68's "You'll check each one" confirm step. Publishing a draft so it
//     can be sent is task 14.36's own gate, not this module's, and this module never flips
//     `active`/`published_at` itself.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ SCHEMA, MEASURED, NOT ASSUMED — `db/migrations/0419_document_ai_and_pdf_import.sql` (task
//     14.12, unapplied). `keystone.document_pdf_import`: `page_count integer NOT NULL CHECK
//     (page_count > 0)`, `detected_fields jsonb NOT NULL DEFAULT '[]'`, `confirmed_fields jsonb
//     NULL`, `state text NOT NULL DEFAULT 'detected' CHECK (state IN ('detected','confirmed',
//     'abandoned'))`, `template_id uuid NULL REFERENCES document_template(id) ON DELETE SET NULL`,
//     `s3_key text NULL`, unique `(tenant_id, s3_key)` where not null. No delete path (0419's own
//     header): an import is confirmed or abandoned, never deleted.
//
// ★★★ R-14.12 / s3.mjs's OWN RULE — "a key is COMPUTED from a verified tenant id, never accepted
//     from a caller" (`src/storage/s3.mjs:213-225`, M). The browser's PUT already used a key task
//     14.77's ticket route computed: `objectKey({tenantId, kind:'pdf_import', id})` with a FRESH id
//     THAT TICKET MINTED. So the row this INSERT writes uses **that same id as its own primary key**
//     — never a second, freshly-generated one — and the caller's `s3Key` is verified by
//     RE-COMPUTING `objectKey({tenantId, kind:'pdf_import', id})` from the tenant on the GUC (never
//     from the key string) and asserting it equals what the caller sent, byte for byte. A caller who
//     hands a key naming another practice's prefix, another kind, or an id it invented fails this
//     check and is refused — "That upload ticket does not match this import." — before any row is
//     written.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict, unprocessable } from "../http/errors.mjs";
import { objectKey } from "../storage/s3.mjs";
import { createTemplate } from "./templates.mjs";
import { VARIABLES } from "./variableCatalogue.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "documents";
const UNIQUE_VIOLATION = "23505";

/** ★ The migration's own three kinds (0419's `detected_fields` shape, field 4's own quote). */
const DETECTED_FIELD_KINDS = Object.freeze(["variable", "signature", "date"]);
/** ★ Field 4's own ceiling: "≤ 200 entries". */
export const MAX_DETECTED_FIELDS = 200;
/** ★ Defensive ceilings on untrusted, pdf.js-extracted strings — not named by field 4, added here
 *   because this text arrives from outside the platform and is stored as jsonb with no length CHECK
 *   of its own. A positive control at the ceiling is asserted in the test, alongside the refusal. */
export const MAX_SNIPPET_LEN = 500;
const MAX_LABEL_LEN = 200;

// ★ Same machine-stable key shape `src/documents/body.mjs`'s `key` schema and every signature block
//   already require — reused here so a detected field's `key` can travel unchanged into a
//   `signatureBlock.key` at confirm.
const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;
const TEXT_SHA256_RE = /^[0-9a-f]{64}$/i;
// ★ The exact shape `objectKey()` produces (`src/storage/s3.mjs:223-241`, M) — tenant, then a FIXED
//   `pdf_import` kind, then an id of 1-128 chars of `[A-Za-z0-9._-]`. Parsed here (never trusted)
//   purely to recover the id the ticket minted; the tenant segment is checked against the GUC's own
//   tenantId, never against itself.
const S3_KEY_RE = /^t\/([0-9a-f-]{36})\/pdf_import\/([A-Za-z0-9._-]{1,128})$/i;

const CATALOGUE_NAMES = new Set(VARIABLES.map((v) => v.name));

function assertDetectedField(f, i, pageCount, where) {
  const path = `${where}[${i}]`;
  if (!f || typeof f !== "object" || Array.isArray(f)) throw invalid(`${path} must be an object`);
  if (typeof f.key !== "string" || !FIELD_KEY_RE.test(f.key)) {
    throw invalid(
      `${path}.key must be lower-case letters, digits and underscores, starting with a letter — got ${JSON.stringify(f.key)}`);
  }
  if (typeof f.label !== "string" || !f.label.trim() || f.label.length > MAX_LABEL_LEN) {
    throw invalid(`${path}.label must be 1-${MAX_LABEL_LEN} characters`);
  }
  if (!DETECTED_FIELD_KINDS.includes(f.kind)) {
    throw invalid(`${path}.kind must be one of ${DETECTED_FIELD_KINDS.join(", ")} — got ${JSON.stringify(f.kind)}`);
  }
  if (f.variable !== undefined && f.variable !== null && typeof f.variable !== "string") {
    throw invalid(`${path}.variable must be a string when present`);
  }
  if (!Number.isInteger(f.page) || f.page < 1 || f.page > pageCount) {
    throw invalid(`${path}.page must be an integer between 1 and ${pageCount} — got ${JSON.stringify(f.page)}`);
  }
  if (f.snippet !== undefined && f.snippet !== null) {
    if (typeof f.snippet !== "string" || f.snippet.length > MAX_SNIPPET_LEN) {
      throw invalid(`${path}.snippet must be a string of at most ${MAX_SNIPPET_LEN} characters`);
    }
  }
}

/**
 * ★★★ RECORD. `POST /api/documents/pdf-imports` — a row `detected`, never more. The bytes already
 *     landed in storage before this call (14.77/14.68); this call only records what pdf.js found.
 *
 * @returns { id, fileName, pageCount, state, detectedFieldCount }
 */
export async function recordImport(
  tx, { tenantId, fileName, pageCount, textSha256, detectedFields, s3Key, actorUserId = null }
) {
  if (typeof fileName !== "string" || !fileName.trim()) throw invalid("an import needs a file name");
  if (!Number.isInteger(pageCount) || pageCount <= 0) {
    throw invalid(`pageCount must be a positive integer — got ${JSON.stringify(pageCount)}`);
  }
  if (typeof textSha256 !== "string" || !TEXT_SHA256_RE.test(textSha256)) {
    throw invalid("textSha256 must be a 64-character hex sha256");
  }
  if (!Array.isArray(detectedFields) || detectedFields.length === 0) {
    throw invalid("no fields were detected in this PDF");
  }
  if (detectedFields.length > MAX_DETECTED_FIELDS) {
    throw invalid(`too many detected fields — ${detectedFields.length}, the ceiling is ${MAX_DETECTED_FIELDS}`);
  }
  detectedFields.forEach((f, i) => assertDetectedField(f, i, pageCount, "detectedFields"));

  // ═══ R-14.12 — THE TICKET CHECK (see the file header). ═══
  const m = typeof s3Key === "string" ? S3_KEY_RE.exec(s3Key) : null;
  if (!m || m[1].toLowerCase() !== String(tenantId).toLowerCase()) {
    throw invalid("That upload ticket does not match this import.");
  }
  const id = m[2];
  let expectedKey;
  try {
    expectedKey = objectKey({ tenantId, kind: "pdf_import", id });
  } catch {
    throw invalid("That upload ticket does not match this import.");
  }
  if (expectedKey !== s3Key) throw invalid("That upload ticket does not match this import.");

  const trimmedName = fileName.trim();
  try {
    await tx.query(
      `INSERT INTO keystone.document_pdf_import
         (id, tenant_id, file_name, page_count, text_sha256, detected_fields, s3_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [id, tenantId, trimmedName, pageCount, textSha256.toLowerCase(),
       JSON.stringify(detectedFields), s3Key, actorUserId]);
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) throw invalid("That upload ticket does not match this import.");
    throw e;
  }

  // ★ Payload carries counts and the id, never the extracted text, labels or snippets — the blocked
  //   list (DOB, sobriety date, recovery fields, notes, emergency contact, consent detail, guardian
  //   relationship) never leaves the platform, and this event goes to webhook endpoints outside it.
  // ★ subjectType/subjectId null/null — "document_pdf_import" is not a member of `SUBJECT_TYPES`
  //   (`src/events/topics.mjs:455-…`, M; 14.15's file, not this task's) — same gap and same choice
  //   `src/items/images.mjs` records for `"image"`. Reported in the build summary, not silently
  //   worked around.
  await emit(tx, {
    tenantId, topic: "documents.pdf.imported", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { import_id: id, page_count: pageCount, detected_field_count: detectedFields.length },
  });

  return { id, fileName: trimmedName, pageCount, state: "detected", detectedFieldCount: detectedFields.length };
}

function assertParagraph(p, i) {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw invalid(`paragraphs[${i}] must be an object`);
  if (typeof p.text !== "string" || !p.text.trim()) throw invalid(`paragraphs[${i}].text is required`);
  if (!Number.isInteger(p.page) || p.page < 1) {
    throw invalid(`paragraphs[${i}].page must be a positive integer — got ${JSON.stringify(p.page)}`);
  }
}

/**
 * ★ One CONFIRMED field → one contract block. `signature` fields keep their own `key` (unique per
 *   `body.mjs`'s own dupe check, across the whole body — never re-derived here). `variable`/`date`
 *   fields become a `variableBlock` naming the catalogue entry the owner picked; a `variable` outside
 *   the closed catalogue (or missing entirely — the owner never mapped one) is refused at 422, field
 *   4's own exact sentence.
 */
function fieldToBlock(f) {
  if (f.kind === "signature") {
    return { type: "signature", key: f.key, label: f.label };
  }
  if (typeof f.variable !== "string" || !f.variable || !CATALOGUE_NAMES.has(f.variable)) {
    throw unprocessable(`${f.label} isn't something we can fill in yet — leave it as text.`);
  }
  return { type: "variable", name: f.variable, label: f.label };
}

/**
 * ★★★ CONFIRM. `POST /api/documents/pdf-imports/confirm` — builds a contract body, one section per
 *     confirmed paragraph group (each `paragraphs[i]` is one section, in order), then
 *     `createTemplate` and marks the result a DRAFT (`active = false, published_at NULL`) — never
 *     active, never signable until a separate publish step (14.36) says so.
 *
 * ★ SECTION SHAPE — NOT NAMED BY FIELD 4, DOCUMENTED HERE AS THE CONTRACT 14.68's BROWSER HALF MUST
 *   FOLLOW (the client/server split, per the task's own instruction): every entry of `paragraphs` is
 *   `{ page, text }` — the page-of-origin and the prose kept for it. Every entry of `confirmedFields`
 *   is a KEPT (never skipped) detected field, same shape as `recordImport`'s `detectedFields`. A
 *   confirmed field is placed on the section whose `paragraphs[i].page` equals the field's own
 *   `page`; a confirmed field whose page matches no kept paragraph is never silently dropped — it
 *   lands in one trailing "Additional fields" section instead, so a field the owner explicitly kept
 *   is never lost because the paragraph containing its page was itself skipped. `owner` defaults to
 *   `'client'` (a legal `SECTION_OWNERS` value, `body.mjs`'s `owner` enum) — the only party a PDF
 *   import produces an agreement for; `requires_signature` is true exactly for a section holding a
 *   confirmed `signature` field, false otherwise. `title` is `"Page {n}"` / `"Additional fields"`.
 *
 * @returns { templateId }
 */
export async function confirmImport(tx, { tenantId, importId, confirmedFields, paragraphs, actorUserId = null }) {
  if (typeof importId !== "string" || !importId) throw invalid("importId is required");

  const { rows } = await run(tx, db
    .selectFrom("keystone.document_pdf_import")
    .select(["id", "file_name", "page_count", "state"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", importId));
  if (!rows[0]) throw notFound("no such import in this organisation");
  const imp = rows[0];
  if (imp.state !== "detected") {
    throw conflict(`this import is already ${imp.state} — it can only be confirmed once`);
  }

  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    throw invalid("paragraphs is required — at least one confirmed paragraph group");
  }
  paragraphs.forEach((p, i) => assertParagraph(p, i));

  if (!Array.isArray(confirmedFields)) throw invalid("confirmedFields must be an array");
  confirmedFields.forEach((f, i) => assertDetectedField(f, i, imp.page_count, "confirmedFields"));

  const usedPages = new Set(paragraphs.map((p) => p.page));
  const byPage = new Map();
  for (const f of confirmedFields) {
    const bucket = usedPages.has(f.page) ? f.page : "unmatched";
    if (!byPage.has(bucket)) byPage.set(bucket, []);
    byPage.get(bucket).push(f);
  }

  const sections = paragraphs.map((p, i) => {
    const fields = byPage.get(p.page) ?? [];
    return {
      key: `section_${i + 1}`,
      title: `Page ${p.page}`,
      owner: "client",
      requires_signature: fields.some((f) => f.kind === "signature"),
      blocks: [{ type: "prose", text: p.text }, ...fields.map(fieldToBlock)],
    };
  });

  const orphaned = byPage.get("unmatched") ?? [];
  if (orphaned.length) {
    sections.push({
      key: `section_${sections.length + 1}`,
      title: "Additional fields",
      owner: "client",
      requires_signature: orphaned.some((f) => f.kind === "signature"),
      blocks: orphaned.map(fieldToBlock),
    });
  }

  const body = { kind: "contract", schema_version: 1, sections };
  const name = imp.file_name.replace(/\.pdf$/i, "").trim() || imp.file_name;

  // ★ `createTemplate` INSERTs with `active = true` by default (`templates.mjs:81`) — so this module
  //   flips it back to the draft state field 4 requires, on the SAME row, right after.
  const created = await createTemplate(tx, { tenantId, builder: "contract", name, body, actorUserId });
  await run(tx, db
    .updateTable("keystone.document_template")
    .set({ active: false, published_at: null, updated_at: sql`now()` })
    .where("id", "=", created.id)
    .where("tenant_id", "=", tenantId));

  await tx.query(
    `UPDATE keystone.document_pdf_import
        SET confirmed_fields = $3::jsonb, state = 'confirmed', template_id = $4
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, importId, JSON.stringify(confirmedFields), created.id]);

  return { templateId: created.id };
}
