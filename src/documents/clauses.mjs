// @ts-check
// Stage 14 task 14.35 — CLAUSES. Write a clause once; editing it updates every LIVE agreement that
// uses it; an already-signed one never changes.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE THREE LEVELS, AND WHY A CLAUSE EDIT CANNOT REACH A SIGNED INSTRUMENT.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// type (a document_type / its axes) → template (`document_template`, the words, versioned) →
// instance (`document_instance`, one issued copy). A clause lives at the TEMPLATE layer only: it is
// a reusable SECTION of a template's body (`document_clause`), pulled into a template by
// `template_clause`. Nothing in this file ever writes `document_instance`.
//
//   ★★★ THE MECHANISM, WITH CITATIONS: `document_instance.template_body_snapshot` is copied off the
//   TEMPLATE at SEND (migration 0053; `src/documents/writes.mjs:349-350,810` — "the body frozen at
//   send") and `document_instance.template_snapshot` is built from THAT frozen copy at EXECUTE
//   (`writes.mjs:849`), never re-read from `document_template` again. So once an instance has moved
//   past `draft`, editing the TEMPLATE (or a clause feeding it) cannot touch it — there is no code
//   path from this file to `document_instance` at all, and the two columns above are the only
//   record a signer ever reads back.
//   ★ AND THE TEMPLATE ITSELF IS PROTECTED THE SAME WAY `updateTemplateBody` ALREADY IS
//   (`templates.mjs:181-216`, M): every rebuild in this file goes through `newTemplateVersion` (new
//   row, old row `active=false`, never touched) whenever the template it would edit has any
//   non-draft `document_instance` — exactly `updateTemplateBody`'s own refusal rule, reused rather
//   than re-implemented, so the two can never drift apart on what "already sent" means.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ DELETE VS ARCHIVE — ALREADY DECIDED, BY THE MIGRATION, NOT BY THIS FILE (0417:82-106,139).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `document_clause` carries `archived_at` and NO tenant_delete policy and NO DELETE grant
// (0417:106,111,273-275 self-check) — a clause that appeared in a template a signed instrument once
// used must not become unreachable in a way that rewrites history, so it is ARCHIVED, never
// deleted. This task's field 4 names no archive/unarchive route, so none is built here — the column
// and the RLS shape are ready for whichever task adds it. `insertClause` below still refuses to
// attach an already-archived clause to a template (a small, symmetric guard, not a new feature).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE VALIDATION WRAPPER — WHY IT CARRIES A SECOND, THROWAWAY SECTION.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Field 4: "blocks validated as one contract section's `blocks` by building a one-section body and
// calling `parseTemplateBody('contract', …)`." Taken completely literally that refuses EVERY
// prose-only clause — including the plan's own example, "Stopping" (field 7), and every clause in
// the mockup (`specs/mockups/DocsClauses.frame.html`), none of which carry a signature block.
// `parseTemplateBody` (`body.mjs:313-330`, unedited here — outside this task's file list) enforces,
// unconditionally for `kind:"contract"`: (a) "no section of this contract requires a signature" —
// throws if NO section has `requires_signature:true`, and (b) a section that DOES require one must
// contain a `type:"signature"` block. A lone real section with `requires_signature:false` fails (a);
// with `requires_signature:true` and no signature block in `blocks` (the ordinary case) fails (b).
// There is no value of `requires_signature` on ONE section that passes both for prose content.
//   ★ SO: the wrapper carries the caller's real section (unchanged, `requires_signature:false`) PLUS
//   one throwaway placeholder section that owns the one signature slot required by rule (a) — never
//   stored, never returned, and its key is deliberately obscure so it cannot collide with a real
//   clause's own block keys (duplicate-key checking runs across the WHOLE wrapper body). This does
//   NOT weaken anything: every check that matters for a REUSABLE CLAUSE — block shape, the
//   discriminated union, duplicate keys, and P9.1's variable-catalogue resolvability — still runs,
//   unweakened, against the caller's own `blocks`. Only the two document-level "is this whole thing
//   a signable agreement" rules — which do not describe a snippet — are neutralised. Reported to the
//   dispatcher rather than silently assumed; see the task's final report for the one-line flag.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, conflict, notFound } from "../http/errors.mjs";
import { parseTemplateBody, SECTION_OWNERS } from "./body.mjs";
import { newTemplateVersion, updateTemplateBody } from "./templates.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "documents";
const UNIQUE_VIOLATION = "23505";

const CLAUSE_KINDS = Object.freeze(["standard", "yours"]);

// ★ Arbitrary but VALID (`SECTION_OWNERS` — body.mjs). Used only inside the throwaway validation
//   wrapper above; never stored, never returned, never the owner a real template section gets.
const VALIDATION_ONLY_OWNER = `coach`;
// ★ Deliberately unlikely to collide with a real clause's own block key (`^[a-z][a-z0-9_]*$`).
const VALIDATION_ONLY_SIGNATURE_KEY = "zzz_clause_validation_placeholder_signature";

function requireNonEmpty(value, field, why) {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid(`a clause needs ${why}`, { field });
  }
  return value.trim();
}

/**
 * Validate `blocks` as one contract section's blocks — see the header for why the wrapper carries
 * a second, throwaway section. Returns the CANONICAL (zod-parsed) blocks array to store.
 */
function validateClauseBlocks(blocks) {
  const wrapper = {
    kind: "contract",
    schema_version: 1,
    sections: [
      { key: "clause", title: "clause", owner: VALIDATION_ONLY_OWNER,
        requires_signature: false, blocks },
      // ★ THROWAWAY — see header. Never stored, never returned.
      { key: "clause_validation_placeholder", title: "validation placeholder",
        owner: VALIDATION_ONLY_OWNER, requires_signature: true,
        blocks: [{ type: "signature", key: VALIDATION_ONLY_SIGNATURE_KEY,
                   label: "validation placeholder — never stored" }] },
    ],
  };
  const parsed = parseTemplateBody("contract", wrapper);
  return parsed.sections[0].blocks;
}

/** `document_template.body` comes back parsed by `pg`, but guard the string case the same way
 *  `src/documents/archive.mjs:112-114` already does for `template_snapshot` — same driver, same
 *  column type, same defensive shape. */
function asBody(value) {
  if (value == null) return null;
  return typeof value === "string" ? JSON.parse(value) : value;
}

/**
 * For every ACTIVE template a clause reaches, rebuild that template's body and either version it
 * (if it already has a non-draft instance — `updateTemplateBody`'s own rule, `templates.mjs:190-192`,
 * reused) or edit it in place. `transform(body)` returns the next body or throws.
 */
async function applyTemplateBodyChange(tx, { tenantId, templateId, actorUserId, transform }) {
  const cur = await run(tx, db
    .selectFrom("keystone.document_template")
    .select(["id", "builder", "name", "body"])
    .where("id", "=", templateId));
  if (cur.rowCount === 0) throw notFound("That template is not in this workspace.");
  const tpl = cur.rows[0];
  if (tpl.builder !== "contract") {
    throw invalid(
      `clauses attach only to contract templates — "${tpl.name}" is a ${tpl.builder} template`);
  }

  const nextBody = transform(asBody(tpl.body) ?? { kind: "contract", schema_version: 1, sections: [] });

  // ★ SAME RULE AS `updateTemplateBody` (`templates.mjs:190-192`) — "has been SENT", not "has an
  //   instance": a draft instance has never been shown to anybody and re-reads the template at send.
  const { rows: [{ n }] } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.document_instance
      WHERE template_id = $1 AND state <> 'draft'`, [templateId]);

  if (n > 0) {
    const versioned = await newTemplateVersion(tx, { tenantId, templateId, body: nextBody, actorUserId });
    // ★ Carry EVERY clause join forward onto the new version, not just the one that changed —
    //   otherwise the new version's clause list would silently lose every other attached clause.
    await tx.query(
      `INSERT INTO keystone.template_clause (tenant_id, template_id, clause_id, position)
         SELECT tenant_id, $2, clause_id, position
           FROM keystone.template_clause WHERE tenant_id = $1 AND template_id = $3`,
      [tenantId, versioned.id, templateId]);
    return { templateId: versioned.id, versioned: true };
  }

  await updateTemplateBody(tx, { tenantId, templateId, body: nextBody, actorUserId });
  return { templateId, versioned: false };
}

/** GET /api/documents/clauses — usage count via `template_clause` on ACTIVE templates only. */
/** A section key is `^[a-z][a-z0-9_]*$` (body.mjs) — a UUID's hyphens are not allowed, so they are dropped. (Found 4 Oct 2026: inserting any clause was refused by the body validator.) */
const clauseSectionKey = (id) => `clause_${String(id).replace(/-/g, "")}`;

export async function listClauses(tx, { tenantId }) {
  const { rows } = await tx.query(
    `SELECT c.id, c.name, c.gist, c.kind, c.archived_at, c.created_at, c.updated_at,
            count(tc.id) FILTER (WHERE t.active) AS usage_count
       FROM keystone.document_clause c
       LEFT JOIN keystone.template_clause tc
              ON tc.tenant_id = c.tenant_id AND tc.clause_id = c.id
       LEFT JOIN keystone.document_template t
              ON t.tenant_id = tc.tenant_id AND t.id = tc.template_id
      WHERE c.tenant_id = $1
      GROUP BY c.id
      ORDER BY lower(c.name)`,
    [tenantId]);
  return rows.map((r) => ({
    id: r.id, name: r.name, gist: r.gist, kind: r.kind,
    archivedAt: r.archived_at, createdAt: r.created_at, updatedAt: r.updated_at,
    usageCount: Number(r.usage_count),
  }));
}

export async function createClause(tx, { tenantId, name, gist, blocks, kind = "yours", actorUserId = null }) {
  const cleanName = requireNonEmpty(name, "name",
    "a name — an unnamed clause cannot be chosen from a list");
  const cleanGist = requireNonEmpty(gist, "gist",
    "a one-line gist — it is how it is told apart in the list before anyone opens it");
  if (!CLAUSE_KINDS.includes(kind)) {
    throw invalid(`kind must be one of ${CLAUSE_KINDS.join(", ")} — got ${JSON.stringify(kind)}`);
  }
  const validatedBlocks = validateClauseBlocks(blocks);

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await tx.query(
      `INSERT INTO keystone.document_clause (id, tenant_id, name, gist, body, kind)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [id, tenantId, cleanName, cleanGist, JSON.stringify(validatedBlocks), kind]);
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(
        `a clause named "${cleanName}" already exists — edit it instead of creating a second one ` +
        `with the same name`, { field: "name" });
    }
    throw e;
  }

  // ★ `documents.clause.created` is catalogued for exactly this file (`src/events/topics.mjs:80-93`
  //   names `clauses.mjs` among the Stage 14 emitters of these ten topics). `subjectType` is left
  //   `null` — see the task report: `document_clause` is not in the closed `SUBJECT_TYPES`
  //   vocabulary (`topics.mjs:455-473`) and that file is not in this task's file list to extend.
  await emit(tx, {
    tenantId, topic: "documents.clause.created", emittedBy: SECTION,
    actor: userActor(actorUserId),
    payload: { kind },
  });

  return { id, name: cleanName, gist: cleanGist, kind };
}

/**
 * Edit a clause's own row (any of name/gist/kind/blocks may be sent; omitted fields are unchanged),
 * then rebuild every ACTIVE template that carries it — versioning a template that already has a
 * non-draft instance, editing one in place otherwise. Returns `{ id, templates_touched }`.
 */
export async function updateClause(tx, { tenantId, id, name, gist, kind, blocks, actorUserId = null }) {
  const cur = await run(tx, db
    .selectFrom("keystone.document_clause")
    .select(["id", "name", "gist", "kind", "body"])
    .where("id", "=", id));
  if (cur.rowCount === 0) throw notFound("no such clause in this organisation");
  const clause = cur.rows[0];

  const nextName = name !== undefined
    ? requireNonEmpty(name, "name", "a name — an unnamed clause cannot be chosen from a list")
    : clause.name;
  const nextGist = gist !== undefined
    ? requireNonEmpty(gist, "gist", "a one-line gist — it is how it is told apart in the list before anyone opens it")
    : clause.gist;
  if (kind !== undefined && !CLAUSE_KINDS.includes(kind)) {
    throw invalid(`kind must be one of ${CLAUSE_KINDS.join(", ")} — got ${JSON.stringify(kind)}`);
  }
  const nextKind = kind !== undefined ? kind : clause.kind;
  const nextBlocks = blocks !== undefined ? validateClauseBlocks(blocks) : asBody(clause.body);

  await tx.query(
    `UPDATE keystone.document_clause
        SET name = $2, gist = $3, kind = $4, body = $5::jsonb, updated_at = now()
      WHERE id = $1`,
    [id, nextName, nextGist, nextKind, JSON.stringify(nextBlocks)]);

  const sectionKey = clauseSectionKey(id);
  const links = await tx.query(
    `SELECT tc.template_id FROM keystone.template_clause tc
       JOIN keystone.document_template t
         ON t.tenant_id = tc.tenant_id AND t.id = tc.template_id
      WHERE tc.tenant_id = $1 AND tc.clause_id = $2 AND t.active = true`,
    [tenantId, id]);

  let templatesTouched = 0;
  for (const { template_id: templateId } of links.rows) {
    await applyTemplateBodyChange(tx, {
      tenantId, templateId, actorUserId,
      transform: (body) => {
        const sections = Array.isArray(body?.sections) ? body.sections : [];
        const idx = sections.findIndex((s) => s?.key === sectionKey);
        if (idx === -1) {
          // ★ `template_clause` says this template carries the clause; its body disagrees. A data
          //   anomaly, not a normal refusal — surfaced loudly rather than silently skipped.
          throw conflict(
            `template ${templateId} is linked to this clause but its body has no section "${sectionKey}"`);
        }
        const nextSections = sections.slice();
        nextSections[idx] = { ...sections[idx], blocks: nextBlocks };
        return { ...body, sections: nextSections };
      },
    });
    templatesTouched += 1;
  }

  await emit(tx, {
    tenantId, topic: "documents.clause.updated", emittedBy: SECTION,
    actor: userActor(actorUserId),
    // ★ Exact payload field 4 names — `{templates_touched: n}`, nothing else.
    payload: { templates_touched: templatesTouched },
  });

  return { id, templates_touched: templatesTouched };
}

/**
 * Attach a clause to ONE template at `position`, adding both the join row and the template's own
 * section (`clause_<clauseId>`) — same versioning rule as `updateClause`'s per-template rebuild.
 *
 * ★ Field 4's signature omits `owner`/`requiresSignature` for the new section (`contractSection`
 *   requires both, non-optional — `body.mjs:87-100`). Defaulted here (`owner:"client"`,
 *   `requiresSignature:false` — a clause is ordinarily prose, never itself a signature slot) and
 *   overridable by an explicit caller. Flagged in the task report for confirmation.
 */
export async function insertClause(
  tx, { tenantId, templateId, clauseId, position, owner = "client", requiresSignature = false, actorUserId = null }
) {
  if (!SECTION_OWNERS.includes(owner)) {
    throw invalid(`owner must be one of ${SECTION_OWNERS.join(", ")} — got ${JSON.stringify(owner)}`);
  }
  if (typeof requiresSignature !== "boolean") {
    throw invalid("requiresSignature must be true or false");
  }
  if (!Number.isInteger(position) || position < 0) {
    throw invalid("position must be a non-negative integer");
  }

  const cur = await run(tx, db
    .selectFrom("keystone.document_clause")
    .select(["id", "name", "body", "archived_at"])
    .where("id", "=", clauseId));
  if (cur.rowCount === 0) throw notFound("no such clause in this organisation");
  const clause = cur.rows[0];
  if (clause.archived_at) {
    throw conflict(`"${clause.name}" is archived and cannot be added to a template`);
  }
  const clauseBlocks = asBody(clause.body) ?? [];
  const sectionKey = clauseSectionKey(clauseId);

  const outcome = await applyTemplateBodyChange(tx, {
    tenantId, templateId, actorUserId,
    transform: (body) => {
      const sections = Array.isArray(body?.sections) ? body.sections.slice() : [];
      if (sections.some((s) => s?.key === sectionKey)) {
        throw conflict(`this template already carries "${clause.name}" — insert it once, or remove it first`);
      }
      const clamped = Math.max(0, Math.min(position, sections.length));
      sections.splice(clamped, 0, {
        key: sectionKey, title: clause.name, owner, requires_signature: requiresSignature,
        blocks: clauseBlocks,
      });
      return { ...body, sections };
    },
  });

  await run(tx, db
    .insertInto("keystone.template_clause")
    .values({
      tenant_id: tenantId ?? null,
      template_id: outcome.templateId ?? null,
      clause_id: clauseId ?? null,
      position: position ?? null,
    }));

  return { templateId: outcome.templateId, clauseId, position, versioned: outcome.versioned };
}
