// @ts-check
// TASK 14.29 — G21 · STARTER TEMPLATES (THE SEED TEXT) — R-14.2: BUILT HERE, NOT SEEDED UNTIL TY READS IT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ R-14.2, QUOTED, GOVERNS THIS FILE AND IS UNCHANGED BY THE AMENDMENT BELOW:
//     "built here, NOT seeded until the maintainer reads it."
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Nothing in this file calls `seedStarterTemplate`. No migration inserts these rows, no provisioning
// path runs at signup, and there is no seed-on-first-use call anywhere in this diff. The function is
// exported for 14.31 (lazy seed on send), 14.36 (starters route) and 14.63 (EmptyDocuments button) —
// none of which exist yet — to call, later, once the maintainer has read the `private` paragraph below.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ AMENDMENT (the maintainer, 25 Sep 2026) — OVERRIDES 14.29 FIELD 4's VARIABLE LIST. A prior agent correctly
//     stopped: field 4 names `agreement.start_date`, `service.duration`, `service.price`,
//     `package.price`, `package.size`, `package.expiry` — NONE of which is in
//     `src/documents/variableCatalogue.mjs` (six names only), and `document_instance` never records
//     which item it was issued for, so there is no single price/duration to read at instance time
//     even if a variable existed. Per the maintainer's ruling: every item-specific term below is a VISIBLY-MARKED
//     AUTHOR-FILL BLANK, `[[FILL IN: …]]`, never a variable name and never an entry added to
//     `variableCatalogue.mjs`. Only the six real variables (`practice.name`, `client.name`) are used
//     as `{type:"variable"}` blocks in this file. See the file-level report for the full list of
//     blanks and what each is for.
//   ★ THE BLANK MARKER, CHOSEN HERE. This codebase already has ONE convention for "a value that did
//     not resolve" — `[${label} — not provided]`, single brackets with an em dash
//     (`src/documents/pdf.mjs:217`). That marker means something specific: a *variable* whose `read`
//     returned null at send. An author-fill blank is a different fact — a term nobody ever wired a
//     variable for, because none exists — and reusing the single-bracket form would make a signed
//     contract's missing-price line indistinguishable from a live variable-resolution defect. So this
//     file uses a DIFFERENT, doubled form, `[[FILL IN: what]]`, chosen for that reason and used
//     consistently below. No other precedent for author-fill text was found in `src/` or
//     `specs/mockups/` (grepped for "fill in", "insert", "author-fill", "placeholder", "TBD" — none).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE THREE LEVELS. This file writes TEMPLATES (the words, versioned) — never a type, never an
//    instance. `seedStarterTemplate` calls `createTemplate` (`templates.mjs:64`) exactly once per
//    starter key per tenant (idempotent on `starter_key`), and the row it produces is never mutated
//    afterwards by this module: publishing sets `published_at` once, on the same row that was just
//    inserted, in the same UPDATE that also sets `starter_key`/`type_id`/`requires_parent_under_18` —
//    there is no path here that edits an already-published template's `body`.
//
// ★ NO CLINICAL LANGUAGE. Coaching and recovery coaching are deliberately NOT therapy. The `private`
//   section says so in plain words ("Coaching is not therapy, counselling or medical care, and this
//   practice does not keep a medical record") and nothing below implies diagnosis, treatment or a
//   medical record.
// ★ THEY/THEM THROUGHOUT. No section below assumes a signer's gender.
// ★ NO COPYRIGHTED MATERIAL. All prose here is original, plain wording — not copied from any real
//   company's terms or a published consent form. No clause claims legal authority it does not have;
//   where one might (e.g. exactly which "law" compels disclosure), the text stays general ("the law
//   requires it") rather than naming a specific statute this practice may not actually be bound by.
//
// ★★ TERMINOLOGY. "client", "session", `coach`, "package" and "agreement" are FIXED plain English in
//    every prose block below — they are NOT resolved through any per-practice rename mechanism,
//    because no such variable exists in the six-name catalogue. The only per-instance values that DO
//    resolve are the practice's own name and the client's own name (`practice.name`, `client.name`),
//    via `{type:"variable"}` blocks. Everything else — every word and every `[[FILL IN: …]]` blank —
//    is literal text stored in the template body.

import { invalid } from "../http/errors.mjs";
import { createDocumentCategory, createDocumentType } from "./writes.mjs";
import { createTemplate } from "./templates.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE SHARED CATEGORY. Both starter templates file under the same `agreements` category — same
//   key/label pair the existing document tests already use (`test/p15b_documents_writes.test.mjs:59`,
//   `test/p15c_signatures.test.mjs:67`, `test/p15c_frozen.test.mjs:54`: `key: "agreements", label:
//   "Agreements"`), reused here rather than invented, so a practice never ends up with two categories
//   that mean the same thing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const CATEGORY_KEY = "agreements";
const CATEGORY_LABEL = "Agreements";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE TWO STARTER TEMPLATES. `body.sections` is what `parseTemplateBody("contract", …)` (called
//     inside `createTemplate`) validates and what `assertVariablesResolvable` checks the variable
//     blocks against — so any variable name here that is NOT one of the six real ones is a hard
//     refusal at build/seed time, not a silent gap. That is the amendment's own safety net, not
//     merely its justification.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ★ "Who this is between" — the two real variables (practice, client) plus the one item-specific term
//   this section needs (the start date), which is a blank: `document_instance` carries no start-date
//   column and there is no `agreement.start_date` variable to read one from.
const WHO_SECTION = {
  key: "who",
  title: "Who this is between",
  owner: `coach`,
  requires_signature: false,
  blocks: [
    // ★ F129b (23 Oct 2026) — one sentence, then its own paragraph for the start date (it read "between:an example organisation Coachingand:Pat ParentIt begins…")
    { type: "prose", text: "This coaching agreement is between" },
    { type: "variable", name: "practice.name", label: "Practice name" },
    { type: "prose", text: "and" },
    { type: "variable", name: "client.name", label: "Client name" },
    { type: "prose", text: "." },
    { type: "paragraphBreak" },
    { type: "prose", text: "It begins on [[FILL IN: agreement start date]]." },
  ],
};

// ★ "Your sessions" — session length is per-service, and there is no single service on a
//   `document_instance` to read a duration from (see the file-header amendment). Blank.
const SESSIONS_SECTION = {
  key: "sessions",
  title: "Your sessions",
  owner: `coach`,
  requires_signature: false,
  blocks: [
    // ★ F129 (23 Oct 2026) — stays a blank the practice fills in (test/s14_starter_templates.test.mjs names it); the send step refuses while it is left
    { type: "prose",
      text: "Each session is [[FILL IN: session length]] long, unless we agree otherwise in writing." },
  ],
};

// ★ "What you're paying" — price, package price, package size and package expiry are all
//   item-specific and none is readable from an instance (see the file-header amendment). Four blanks.
const PAYING_SECTION = {
  key: "paying",
  title: "What you're paying",
  owner: `coach`,
  requires_signature: false,
  blocks: [
    { type: "prose", text: "A single session costs [[FILL IN: price per session]]." },
    { type: "paragraphBreak" },
    { type: "prose",
      text: "A package of [[FILL IN: number of sessions in a package]] sessions costs " +
        "[[FILL IN: package price]]. Sessions in a package that go unused expire " +
        "[[FILL IN: how long after purchase a package expires]]." },
    { type: "prose", text: "Payment is due at the time of booking unless we agree otherwise in writing." },
  ],
};

// ★ "What stays between us" — DRAFT FOR TY (R-14.2), the exact paragraph field 4 gives, verbatim.
const PRIVATE_SECTION = {
  key: "private",
  title: "What stays between us",
  owner: `coach`,
  requires_signature: false,
  blocks: [
    { type: "prose",
      text: "I keep what you tell me private. I will only share it if you ask me to in writing, if I " +
        "believe you or someone else is in danger of serious harm, or if the law requires it — for " +
        "example, a court order. Coaching is not therapy, counselling or medical care, and this " +
        "practice does not keep a medical record. If you need that kind of care, I will help you find " +
        "someone who provides it." },
  ],
};

// ★ "Stopping" — exact text from field 4, verbatim.
const STOPPING_SECTION = {
  key: "stopping",
  title: "Stopping",
  owner: `coach`,
  requires_signature: false,
  blocks: [
    { type: "prose",
      text: "Either of us can stop at any time. Sessions you've paid for and not used are refunded." },
  ],
};

// ★ "Working with a teenager" — teen-agreement only, exact text from field 4, verbatim. Placed after
//   `private` and before `stopping`: it is the same subject (who else gets told what) continued for
//   the parent-facing case, which field 4 does not itself order — this placement is this file's own
//   choice, stated here rather than left silent.
const TEEN_SECTION = {
  key: "teen",
  title: "Working with a teenager",
  owner: `coach`,
  requires_signature: false,
  blocks: [
    { type: "prose",
      text: "I will tell your parent that sessions happened and what they cost. I will not tell them " +
        "what we talk about unless I believe you are in danger of serious harm." },
  ],
};

// ★ "Signatures" — coaching-agreement: one slot, owned by the client (division `tech`, so the
//   client's party is `client`, not `pir` — 0194:186-197). teen-agreement: two slots, client then
//   parent, matching `CLIENT_AND_PARENT`'s signing order (`vocabulary.mjs`'s own note: the client is
//   named first because a parent signs FOR a teen).
const SIGN_SECTION_COACHING = {
  key: "sign",
  title: "Signatures",
  owner: "client",
  requires_signature: true,
  blocks: [
    { type: "signature", key: "client_signature", label: "Client signature", owner: "client" },
  ],
};
const SIGN_SECTION_TEEN = {
  key: "sign",
  title: "Signatures",
  owner: "client",
  requires_signature: true,
  blocks: [
    { type: "signature", key: "client_signature", label: "Client signature", owner: "client" },
    { type: "signature", key: "parent_signature", label: "Parent/guardian signature", owner: "parent" },
  ],
};

/**
 * ★★★ THE CLOSED SET. Two keys, exactly as field 4 names them. `type` carries the seven axes
 * `createDocumentType` (`writes.mjs:174`) requires; `requiresParentUnder18` is the one boolean set on
 * `document_template` by the publishing UPDATE (0417's `requires_parent_under_18`, teen only);
 * `teenOf` is set on `coaching-agreement` only, and says which OTHER starter key must be seeded first
 * and linked as `teen_template_id`.
 */
export const STARTER_TEMPLATES = Object.freeze({
  "coaching-agreement": {
    name: "Coaching agreement",
    type: Object.freeze({
      key: "coaching_agreement", label: "Coaching agreement", sub_category: "agreements",
      signer_config: "CLIENT_ONLY", division: "tech",
      audience: Object.freeze(["staff", "adult_client", "adolescent_client", "parent"]),
      applies_to: Object.freeze(["adult_client", "adolescent_client"]),
      default_assigned_to: Object.freeze(["client"]), is_session_note: false,
    }),
    requiresParentUnder18: false,
    teenOf: "teen-agreement",
    body: Object.freeze({
      kind: "contract", schema_version: 1,
      sections: Object.freeze([
        WHO_SECTION, SESSIONS_SECTION, PAYING_SECTION, PRIVATE_SECTION, STOPPING_SECTION,
        SIGN_SECTION_COACHING,
      ]),
    }),
  },
  "teen-agreement": {
    name: "Teen coaching agreement",
    type: Object.freeze({
      key: "teen_agreement", label: "Teen coaching agreement", sub_category: "agreements",
      signer_config: "CLIENT_AND_PARENT", division: "tech",
      audience: Object.freeze(["staff", "adult_client", "adolescent_client", "parent"]),
      applies_to: Object.freeze(["adult_client", "adolescent_client"]),
      default_assigned_to: Object.freeze(["client", "parent"]), is_session_note: false,
    }),
    requiresParentUnder18: true,
    teenOf: null,
    body: Object.freeze({
      kind: "contract", schema_version: 1,
      sections: Object.freeze([
        WHO_SECTION, SESSIONS_SECTION, PAYING_SECTION, PRIVATE_SECTION, TEEN_SECTION,
        STOPPING_SECTION, SIGN_SECTION_TEEN,
      ]),
    }),
  },
});

/** Find-or-create the `agreements` category, by key, inside the caller's transaction. */
async function ensureCategory(tx, { tenantId, actorUserId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_category")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("key", "=", CATEGORY_KEY));
  if (rows.length) return rows[0].id;
  const created = await createDocumentCategory(tx, {
    tenantId, key: CATEGORY_KEY, label: CATEGORY_LABEL, actorUserId,
  });
  return created.id;
}

/** Find-or-create a starter's document type, by key, inside the caller's transaction. */
async function ensureType(tx, { tenantId, categoryId, typeDef, actorUserId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_type")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("key", "=", typeDef.key));
  if (rows.length) return rows[0].id;
  const created = await createDocumentType(tx, {
    tenantId, key: typeDef.key, label: typeDef.label, categoryId,
    subCategory: typeDef.sub_category, signerConfig: typeDef.signer_config,
    audience: typeDef.audience, division: typeDef.division, appliesTo: typeDef.applies_to,
    defaultAssignedTo: typeDef.default_assigned_to, isSessionNote: typeDef.is_session_note,
    actorUserId,
  });
  return created.id;
}

/**
 * ★★★ F777 — THE TYPE A PRACTICE-AUTHORED CONTRACT TAKES. Authoring (`POST /api/documents/contracts/templates`)
 *     has no type picker, and a document with no `document_type` is invisible to every staff viewer
 *     (`keystone.document_is_visible`: "IF NOT FOUND THEN RETURN false") — so every contract a practice wrote
 *     itself was unsendable: the draft saved, nobody could see it, and the send 500'd. It takes the practice's
 *     agreement type, found-or-created exactly as the starter agreement's is (same category, same definition).
 * @returns {Promise<string>} the document_type id
 */
export async function ensureAgreementType(tx, { tenantId, actorUserId = null }) {
  const categoryId = await ensureCategory(tx, { tenantId, actorUserId });
  return ensureType(tx, { tenantId, categoryId, typeDef: STARTER_TEMPLATES["coaching-agreement"].type, actorUserId });
}

/**
 * ★★★ SEED ONE STARTER TEMPLATE FOR A TENANT. Idempotent on `starter_key`: a second call for the
 * same `(tenantId, key)` returns the existing active row rather than creating a second one — the
 * positive control 14.29's own test names ("seed twice → one template").
 *
 * ★ NOT CALLED FROM ANYWHERE IN THIS DIFF. See the file header — R-14.2 forbids it until the maintainer reads
 *   the `private` paragraph.
 *
 * @returns {Promise<{templateId: string, typeId: string}>}
 */
export async function seedStarterTemplate(tx, { tenantId, key, actorUserId = null }) {
  const def = STARTER_TEMPLATES[key];
  if (!def) {
    throw invalid(
      `"${key}" is not a starter template — one of ${Object.keys(STARTER_TEMPLATES).join(", ")}`);
  }

  const { rows } = await run(tx, db
    .selectFrom("keystone.document_template")
    .select(["id", "type_id"])
    .where("tenant_id", "=", tenantId)
    .where("starter_key", "=", key)
    .where("active", "=", true));
  if (rows.length) {
    return { templateId: rows[0].id, typeId: rows[0].type_id };
  }

  // ★ `coaching-agreement` links to `teen-agreement`, so the teen row must exist (or be created)
  //   FIRST — the same idempotent path handles both "already seeded" and "seed it now".
  let teenTemplateId = null;
  if (def.teenOf) {
    const teen = await seedStarterTemplate(tx, { tenantId, key: def.teenOf, actorUserId });
    teenTemplateId = teen.templateId;
  }

  const categoryId = await ensureCategory(tx, { tenantId, actorUserId });
  const typeId = await ensureType(tx, { tenantId, categoryId, typeDef: def.type, actorUserId });

  const created = await createTemplate(tx, {
    tenantId, builder: "contract", name: def.name, body: def.body, actorUserId,
  });

  // ★ ONE UPDATE, as field 4 requires — `starter_key`, `type_id`, `published_at` and
  //   `requires_parent_under_18` together, plus `teen_template_id` for `coaching-agreement` only.
  const params = [key, typeId, def.requiresParentUnder18, created.id, tenantId];
  let sql = `
    UPDATE keystone.document_template
       SET starter_key = $1, type_id = $2, requires_parent_under_18 = $3, published_at = now()
     WHERE id = $4 AND tenant_id = $5`;
  if (teenTemplateId) {
    sql = `
    UPDATE keystone.document_template
       SET starter_key = $1, type_id = $2, requires_parent_under_18 = $3, published_at = now(),
           teen_template_id = $6
     WHERE id = $4 AND tenant_id = $5`;
    params.push(teenTemplateId);
  }
  await tx.query(sql, params);

  return { templateId: created.id, typeId };
}
