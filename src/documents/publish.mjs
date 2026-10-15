// @ts-check
// Stage 14 task 14.36 — TEMPLATE SETTINGS, PUBLISH AND VERSIONS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE THREE LEVELS ARE NOT ONE THING: type · template (the words, versioned) · instance.
//     Merging them is how a signed instrument changes after signature. This module NEVER writes
//     `keystone.document_instance` except through `sendDocument`, which INSERTs a brand new row —
//     it never UPDATEs an existing one. Every function below writes only `document_template` rows.
//
// ★★★ WHY A PUBLISH CANNOT ALTER A SENT OR SIGNED INSTRUMENT, MEASURED, NOT ASSUMED:
//   1. `publishTemplate` (this file) touches exactly two `document_template` rows by id — the one
//      being published and its immediate predecessor version of the same name — and touches
//      nothing in `document_instance` directly, ever.
//   2. Every existing instrument's WORDS were already frozen onto ITS OWN row at the moment it was
//      sent: `sendInstance` writes `document_instance.template_body_snapshot` from the template
//      that was active AT THAT TIME (`src/documents/writes.mjs:342-356`, "IT WRITES
//      template_body_snapshot, NOT template_snapshot — migration 0053 ... The WORDS freeze here, at
//      send; the INSTRUMENT freezes at execute."). Publishing a new version later cannot reach that
//      column — nothing in this file names `template_body_snapshot` or `template_snapshot` at all.
//   3. `0053_template_body_frozen_at_send.sql:35-61` constrains that frozen column's SHAPE, not this
//      module's writes — it is the guarantee that a frozen body, once written, is a real legal body.
//   4. `askEveryoneToResign` creates FRESH instances via `sendDocument` (a new `document_instance`
//      row, new id) rather than touching the old ones. The old instrument is UNTOUCHED and its own
//      `template_body_snapshot` still reads exactly what it read the day it was signed.
//   ★ So "publishing a new version must never alter an instrument already sent or signed" holds
//     because this module's writes are scoped to `document_template` by id, and every instrument's
//     own frozen copy lives in a different table, written once, at a different moment, by different
//     code (`sendInstance`), that this module does not call for any EXISTING instance.
//
// ★★★ A PUBLISHED VERSION IS IMMUTABLE — AND THAT MEANS THE WORDS (`body`), NOT EVERY COLUMN.
//     `setTemplateSettings` below UPDATEs `document_template` in place, but only CONFIGURATION
//     columns this migration (0417) added — `requires_parent_under_18`, `re_sign_months`,
//     `creates_subscription_plan_id`, `teen_template_id`, `type_id` — never `body`. None of those
//     columns is read into `template_body_snapshot`/`template_snapshot` (0053/0009:151) and none is
//     part of what a signer was shown, so editing them after publish changes what governs FUTURE
//     sends (who must co-sign, what subscription a signature creates), not what an already-frozen
//     instrument says. `body` has its own, separate, already-guarded edit path
//     (`updateTemplateBody`, `templates.mjs:181-216`, refused once any non-draft instance exists) —
//     this module's field list does not touch `templates.mjs` and does not reopen that path.
//   ★ The one column this module DOES flip alongside settings, `active`/`published_at`
//     (`setTemplateSettings`'s `draft: true`), only ever runs on a row `newTemplateVersion` just
//     created — before any instrument has gone out against it (P15C.8: "before any instrument has
//     been sent, an edit is just authoring"). It is never applied to a row that already has a
//     non-draft instance, because that row is precisely the one `publishTemplate` is retiring, not
//     re-drafting.
//
// ★★★ THE FILL-IN-BLANK PUBLISH GUARD (this task's addition, not field 4). The starter templates
//     (`src/documents/starterTemplates.mjs`) carry author-fill blanks written as `[[FILL IN: …]]`,
//     because `document_instance` never records which item it was issued for (B-46) and no variable
//     can resolve a per-item price/date/duration. ★ MEASURED, not retyped from the dispatch message:
//     the dispatching task named five kinds of blank (start date, session length, price per session,
//     package size, package expiry); `findFillInBlanks(STARTER_TEMPLATES['coaching-agreement'].body)`
//     actually finds SIX markers in that template — the "What you're paying" section carries a sixth,
//     "package price" (`starterTemplates.mjs:119-122`, in the same prose block as "package size"),
//     distinct from "price per session". Reported here rather than silently reconciled: this guard
//     counts every marker it finds, not a fixed list of five, so the discrepancy does not weaken it
//     either way. `FILL_IN_MARKER` below is the EXACT substring taken from that file (verified
//     present at `src/documents/starterTemplates.mjs:93,106,118,120,122` — e.g. `"It begins on
//     [[FILL IN: agreement start date]]."`). `publishTemplate` refuses to publish a body that still
//     contains it: without this guard a practice could publish "the fee is [[FILL IN: price per
//     session]] per session", send it, and have a client sign it — a binding instrument with a blank
//     where the price goes, and nothing in `node --check`, the suite or the gates would ever notice.

import { ports } from "./ports.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { validateTemplateOverride } from "./settingsSchema.mjs";
import { invalid, notFound } from "../http/errors.mjs";
import { sameJson } from "../json/canonical.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ `sendDocument` IS TASK 14.31's EXPORT, `src/documents/sendDocument.mjs`, AND AS OF THIS DIFF
//     THAT FILE DOES NOT EXIST ON DISK (MEASURED — 14.31 is a `Needs` dependency of this task, not
//     yet built). A STATIC `import { sendDocument } from "./sendDocument.mjs"` at the top of this
//     file would throw `ERR_MODULE_NOT_FOUND` the instant ANYTHING loads `publish.mjs` — which would
//     take down `setTemplateSettings`, `publishPreview`, `findFillInBlanks` and `diffSentence` too,
//     none of which need it. So the import is DEFERRED to the one call site that actually needs it,
//     inside `publishTemplate`'s `askEveryoneToResign` branch, resolved fresh on every call (Node
//     does not cache a failed dynamic import as permanently broken) — the moment 14.31 lands, this
//     resolves with no further edit here. Everything else in this file is loadable and testable
//     today regardless of 14.31's status.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const SECTION = "documents";

/** The exact marker `starterTemplates.mjs` writes into a body's prose text for a value a human must
 *  type — never retyped from a description, taken verbatim from that file (see header). */
export const FILL_IN_MARKER = "[[FILL IN:";

/** Same defensive shape as `src/documents/clauses.mjs:106-109` / `archive.mjs:112-114`: `pg` hands
 *  `jsonb` back parsed, but a string is tolerated rather than trusted blindly. */
function asBody(value) {
  if (value == null) return null;
  return typeof value === "string" ? JSON.parse(value) : value;
}

/**
 * ★★★ THE PUBLISH GUARD. Walks a CONTRACT body's sections/blocks (the only shape the starter
 * templates use, and the only shape `[[FILL IN:` appears in) looking for the marker inside prose
 * text. Returns `[]` for a form body or a body with no blanks — both PUBLISH cleanly, which is
 * correct: a form has no author-fill prose to check, and an empty result is not a false refusal.
 */
export function findFillInBlanks(body) {
  const b = asBody(body);
  if (!b || b.kind !== "contract" || !Array.isArray(b.sections)) return [];
  const blanks = [];
  for (const section of b.sections) {
    if (!Array.isArray(section?.blocks)) continue;
    let count = 0;
    for (const block of section.blocks) {
      if (block?.type === "prose" && typeof block.text === "string" && block.text.includes(FILL_IN_MARKER)) {
        count += block.text.split(FILL_IN_MARKER).length - 1;
      }
    }
    if (count > 0) blanks.push({ section: section.title ?? section.key ?? "an untitled section", count });
  }
  return blanks;
}

function assertNoFillInBlanks(body) {
  const blanks = findFillInBlanks(body);
  if (blanks.length === 0) return;
  const total = blanks.reduce((n, b) => n + b.count, 0);
  const where = blanks.map((b) => `${b.count} in "${b.section}"`).join(", ");
  throw invalid(
    `this template still has ${total} unfilled blank${total === 1 ? "" : "s"} — ${where}. Fill in ` +
    `every [[FILL IN: …]] marker before publishing: a signed agreement with a blank where the price ` +
    `or date goes is a binding instrument with a blank in it.`);
}

/**
 * Word-level diff of two prose strings, used only when exactly one prose block in exactly one
 * section differs — the only case honest enough to say "everything else is word for word the
 * same". Finds the common prefix/suffix of whitespace-split words and reports the middle.
 */
function wordDiffSentence(oldText, newText) {
  const oldWords = oldText.split(/\s+/);
  const newWords = newText.split(/\s+/);
  let p = 0;
  while (p < oldWords.length && p < newWords.length && oldWords[p] === newWords[p]) p++;
  let s = 0;
  while (
    s < oldWords.length - p && s < newWords.length - p &&
    oldWords[oldWords.length - 1 - s] === newWords[newWords.length - 1 - s]
  ) s++;
  const oldMiddle = oldWords.slice(p, oldWords.length - s).join(" ");
  const newMiddle = newWords.slice(p, newWords.length - s).join(" ");
  if (oldMiddle && newMiddle) {
    return `One thing: ${oldMiddle} became ${newMiddle}. Everything else is word for word the same.`;
  }
  if (!oldMiddle && newMiddle) {
    return `One thing: "${newMiddle}" was added. Everything else is word for word the same.`;
  }
  if (oldMiddle && !newMiddle) {
    return `One thing: "${oldMiddle}" was removed. Everything else is word for word the same.`;
  }
  return null;
}

/**
 * ★★★ THE DIFF SENTENCE. Section-by-section CANONICAL comparison (`sameJson`, key-order-independent,
 * array-order-preserving — the same comparator `sendInstance` uses for `body_overridden`, so "did
 * this change" is answered the same way everywhere it is asked). Only claims "everything else is
 * the same" when that is verifiably true: exactly one section differs, and within it exactly one
 * prose block differs. Every other shape of change gets an honest, more general sentence rather
 * than a false "everything else" claim.
 */
function diffSentence(oldBody, newBody) {
  const a = asBody(oldBody);
  const b = asBody(newBody);
  if (sameJson(a, b)) return "Nothing changed.";
  if (a?.kind !== "contract" || b?.kind !== "contract") return "The wording changed.";

  const oldSections = Array.isArray(a.sections) ? a.sections : [];
  const newSections = Array.isArray(b.sections) ? b.sections : [];
  const maxLen = Math.max(oldSections.length, newSections.length);
  let diffIndex = -1;
  for (let i = 0; i < maxLen; i++) {
    if (!sameJson(oldSections[i] ?? null, newSections[i] ?? null)) { diffIndex = i; break; }
  }
  if (diffIndex === -1) return "Nothing changed.";

  let onlyOneSectionDiffers = oldSections.length === newSections.length;
  if (onlyOneSectionDiffers) {
    for (let i = 0; i < oldSections.length; i++) {
      if (i === diffIndex) continue;
      if (!sameJson(oldSections[i], newSections[i])) { onlyOneSectionDiffers = false; break; }
    }
  }

  const oldSection = oldSections[diffIndex] ?? null;
  const newSection = newSections[diffIndex] ?? null;
  if (!onlyOneSectionDiffers || !oldSection || !newSection) {
    const title = newSection?.title ?? oldSection?.title ?? "a section";
    return `The wording changed, starting with "${title}".`;
  }

  const oldBlocks = Array.isArray(oldSection.blocks) ? oldSection.blocks : [];
  const newBlocks = Array.isArray(newSection.blocks) ? newSection.blocks : [];
  if (oldBlocks.length !== newBlocks.length) {
    return `The "${newSection.title}" section changed.`;
  }
  let blockIndex = -1;
  for (let i = 0; i < oldBlocks.length; i++) {
    if (!sameJson(oldBlocks[i], newBlocks[i])) { blockIndex = i; break; }
  }
  let onlyOneBlockDiffers = true;
  for (let i = 0; i < oldBlocks.length; i++) {
    if (i === blockIndex) continue;
    if (!sameJson(oldBlocks[i], newBlocks[i])) { onlyOneBlockDiffers = false; break; }
  }
  const oldBlock = oldBlocks[blockIndex];
  const newBlock = newBlocks[blockIndex];
  if (onlyOneBlockDiffers && oldBlock?.type === "prose" && newBlock?.type === "prose") {
    const sentence = wordDiffSentence(oldBlock.text, newBlock.text);
    if (sentence) return sentence;
  }
  return `The "${newSection.title}" section changed.`;
}

/**
 * Save a template's "who signs / starts the subscription / re-sign" settings. UPDATEs only the
 * columns actually supplied (`undefined` = leave unchanged — the same "explicit override, not a
 * blind COALESCE" idiom `newTemplateVersion` uses for `sellsType`/`sellsId`, `templates.mjs:129-131`,
 * so a caller can never accidentally clear a nullable column by omitting it).
 *
 * `draft: true` additionally flips `active = false, published_at = NULL` — the flag `templates.mjs`'s
 * own field 5 note describes: a version fresh out of `newTemplateVersion` (active=true, not yet
 * published) is turned into a proper draft (0417: "active=false AND published_at IS NULL is a
 * draft") before an author finishes configuring it. Never applied to a row with any non-draft
 * instance — that is `publishTemplate`'s retirement path, not this one's.
 */
export async function setTemplateSettings(tx, {
  tenantId, templateId, requiresParentUnder18, reSignMonths, createsSubscriptionPlanId,
  teenTemplateId, typeId, draft, material = false, actorUserId = null,
  // ★ SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 (migration 0539) — edited here rather than only
  //   via newTemplateVersion, so fixing a typo in the internal note or the default client message
  //   does not require a whole new template version the way a body change does.
  description, clientDescription, message,
  // ★ QUEUE §4 (0591) — Documents' own generic "used for" labels. Opaque strings to Documents; empty = used for everyone. SET semantics.
  labels,
  // ★ QUEUE §23.2.8 — optional per-template override of the signed-copy look (an object of signed_copy.*/certificate.* keys; null clears it). SET semantics.
  signedCopy,
}) {
  const cur = await run(tx, db.selectFrom("keystone.document_template").select("id").where("id", "=", templateId).where("tenant_id", "=", tenantId));
  if (cur.rowCount === 0) throw notFound("That template is not in this workspace.");

  if (reSignMonths !== undefined && reSignMonths !== null
      && (!Number.isInteger(reSignMonths) || reSignMonths < 1 || reSignMonths > 60)) {
    throw invalid("reSignMonths must be an integer between 1 and 60, or null");
  }

  const sets = [];
  const params = [templateId, tenantId];
  const set = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`); };

  if (requiresParentUnder18 !== undefined) set("requires_parent_under_18", requiresParentUnder18);
  if (reSignMonths !== undefined) set("re_sign_months", reSignMonths);
  if (createsSubscriptionPlanId !== undefined) set("creates_subscription_plan_id", createsSubscriptionPlanId);
  if (teenTemplateId !== undefined) set("teen_template_id", teenTemplateId);
  if (typeId !== undefined) set("type_id", typeId);
  if (description !== undefined) set("description", description);
  if (clientDescription !== undefined) set("client_description", clientDescription);
  if (message !== undefined) set("message", message);
  if (labels !== undefined) {
    if (labels !== null && (!Array.isArray(labels) || labels.length > 50 || labels.some((l) => typeof l !== "string" || !l.trim() || l.length > 80))) {
      throw invalid("labels must be a list of up to 50 short non-empty strings");
    }
    set("labels", [...new Set((labels ?? []).map((l) => l.trim()))]);
  }
  if (signedCopy !== undefined) {
    const problem = validateTemplateOverride(signedCopy);
    if (problem) throw invalid(`signedCopy ${problem}`, { field: "signedCopy" });
    set("signed_copy", signedCopy === null || Object.keys(signedCopy).length === 0 ? null : JSON.stringify(signedCopy));
  }
  set("material", material);
  if (draft === true) sets.push("active = false", "published_at = NULL");

  if (sets.length === 0) {
    throw invalid("setTemplateSettings needs at least one setting to change");
  }
  sets.push("updated_at = now()");

  await tx.query(
    `UPDATE keystone.document_template SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $2`,
    params);

  await emit(tx, {
    tenantId, topic: "documents.template.updated", emittedBy: SECTION,
    subjectType: "document_template", subjectId: templateId,
    actor: userActor(actorUserId),
    payload: { draft: draft === true },
  });

  return { id: templateId };
}

/**
 * ★★★ THE PREDECESSOR IS FOUND BY VERSION, NOT BY `active = true`. [MEASURED against
 *     `templates.mjs:158-160`] `newTemplateVersion` deactivates the PREVIOUS row the moment the new
 *     version is created — before anybody has published or configured anything — so by the time
 *     either function below runs, the row being replaced is *already* `active = false`. Looking it
 *     up by `active = true` would find NOTHING for the ordinary "author a v2, configure it, publish
 *     it" flow and silently treat every real second version as a first one. The correct, and only
 *     stable, identity of "the version this one replaces" is the highest existing version below it
 *     for the same (tenant, builder, name) — independent of its current `active` flag.
 */
async function findPredecessor(tx, { tenantId, builder, name, version, excludeId }) {
  const { rows: [row] } = await tx.query(
    `SELECT id, name, body, published_at
       FROM keystone.document_template
      WHERE tenant_id = $1 AND builder = $2 AND lower(name) = lower($3)
        AND version < $4 AND id <> $5
      ORDER BY version DESC LIMIT 1`,
    [tenantId, builder, name, version, excludeId]);
  return row ?? null;
}

/**
 * `{ replaces: {name, since} | null, signed_old, unsigned_now, diff_sentence }` — the counts-first
 * modal's numbers. `templateId` is the NEW (about-to-publish) version; "the old one" is resolved
 * here as its immediate predecessor version, which is exactly what `publishTemplate` below retires.
 * Read-only: no write in this function.
 */
export async function publishPreview(tx, { tenantId, templateId }) {
  const { rows: [newTpl] } = await run(tx, db.selectFrom("keystone.document_template").select(["id", "builder", "name", "version", "body"]).where("id", "=", templateId).where("tenant_id", "=", tenantId));
  if (!newTpl) throw notFound("That template is not in this workspace.");

  const oldTpl = await findPredecessor(tx, {
    tenantId, builder: newTpl.builder, name: newTpl.name, version: newTpl.version, excludeId: templateId,
  });

  if (!oldTpl) {
    return { replaces: null, signed_old: 0, unsigned_now: 0, diff_sentence: "This is the first version." };
  }

  const { rows: [counts] } = await tx.query(
    `SELECT
        count(*) FILTER (WHERE state = 'executed')                     AS signed_old,
        count(*) FILTER (WHERE state IN ('sent', 'partially_signed'))  AS unsigned_now
       FROM keystone.document_instance WHERE tenant_id = $1 AND template_id = $2`,
    [tenantId, oldTpl.id]);

  return {
    replaces: { name: oldTpl.name, since: oldTpl.published_at },
    signed_old: Number(counts.signed_old),
    unsigned_now: Number(counts.unsigned_now),
    diff_sentence: diffSentence(oldTpl.body, newTpl.body),
  };
}

/**
 * `published_at=now(), active=true` on THIS version; `active=false, retired_at=now()` on the
 * PREVIOUS active version of the same name — retired, never deleted. Refuses when the body being
 * published still carries an author-fill blank (this task's addition — see header).
 *
 * `askEveryoneToResign`: for each person with an EXECUTED instance of the OLD version, sends them a
 * FRESH instance of the NEW one via `sendDocument` (a new `document_instance` row — see header for
 * why this cannot reach an existing instance). Unsigned `sent`/`partially_signed` instances of the
 * old version are left exactly as they are ("They keep the old version unless you resend").
 *
 * ★ `sendDocument`'s own contract (14.31 field 4) is `assertMay(tx, args.principal, {object:
 *   "person", action: "view", subject: "personId"}, args)` — the sender must be able to see the
 *   person. Inside this bulk resend there is no per-call HTTP principal; the caller of
 *   `publishTemplate` already passed `template.author` (checked by the route, a NAMED_ACTIONS
 *   grant with no owner/scope), so the minimal shape that carries the one field `assertMay` reads
 *   (`principal?.appUserId`) is passed through: `{ appUserId: actorUserId }`. Named here as an
 *   ASSUMPTION about a sibling module's not-yet-landed signature, not a guess buried in the code.
 */
export async function publishTemplate(tx, { tenantId, templateId, askEveryoneToResign = false, actorUserId = null }) {
  const { rows: [newTpl] } = await run(tx, db.selectFrom("keystone.document_template").select(["id", "builder", "name", "version", "body"]).where("id", "=", templateId).where("tenant_id", "=", tenantId));
  if (!newTpl) throw notFound("That template is not in this workspace.");

  assertNoFillInBlanks(newTpl.body);

  // ★ Found by version, not `active = true` — see `findPredecessor`'s own header above.
  const oldTpl = await findPredecessor(tx, {
    tenantId, builder: newTpl.builder, name: newTpl.name, version: newTpl.version, excludeId: templateId,
  });

  // ★★★ THE ONLY WRITES IN THIS FUNCTION TO `document_template`, BY ID — never `document_instance`.
  await run(tx, db.updateTable("keystone.document_template").set({ published_at: sql`now()`, active: true, updated_at: sql`now()` }).where("id", "=", templateId).where("tenant_id", "=", tenantId));

  if (oldTpl) {
    // ★ Retired by its OWN id, already resolved above — no need to re-qualify by version here.
    await run(tx, db.updateTable("keystone.document_template").set({ active: false, retired_at: sql`now()`, updated_at: sql`now()` }).where("id", "=", oldTpl.id).where("tenant_id", "=", tenantId));
  }

  // ★★★ B-3c — REPOINT THE REQUIREMENT. Any `item_agreement_requirement` still pointing at an
  //     earlier version of this same lineage (same tenant/builder/name) now points at the version
  //     just published, so `currentExecutedInstance` reads TODAY's `re_sign_months`/`material` floor
  //     from the current version, not whichever old version the requirement happened to be wired to
  //     (`src/booking/requirements.mjs:51-53`, "a re-sign window is a policy of the template as it
  //     stands today"). A requirement on a different lineage (different name/builder) is untouched.
  await (await ports()).items.repointAgreementRequirements(tx, { tenantId, templateId, name: newTpl.name, builder: newTpl.builder });

  let resent = 0;
  if (askEveryoneToResign && oldTpl) {
    const { rows: signers } = await tx.query(
      `SELECT DISTINCT subject_user_id
         FROM keystone.document_instance
        WHERE tenant_id = $1 AND template_id = $2 AND state = 'executed'
          AND subject_user_id IS NOT NULL`,
      [tenantId, oldTpl.id]);
    // ★ Deferred import — see header. Resolved once per publish, not once per module load.
    const { sendDocument } = await import("./sendDocument.mjs");
    for (const row of signers) {
      // ★ A fresh INSTANCE, new id — never a write to the row `row.subject_user_id` already signed.
      await sendDocument(tx, {
        tenantId, personId: row.subject_user_id, template: templateId, actorUserId,
        principal: { appUserId: actorUserId },
      });
      resent += 1;
    }
  }

  await emit(tx, {
    tenantId, topic: "documents.template.published", emittedBy: SECTION,
    subjectType: "document_template", subjectId: templateId,
    actor: userActor(actorUserId),
    payload: {
      builder: newTpl.builder, version: newTpl.version, replaced_id: oldTpl?.id ?? null,
      ask_everyone_to_resign: Boolean(askEveryoneToResign), resent,
    },
  });

  return { id: templateId, active: true, replacedId: oldTpl?.id ?? null, resent };
}
