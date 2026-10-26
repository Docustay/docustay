// P15C.4 + P15C.5 + P15C.8 — THE TWO BUILDERS' WRITE PATH, AND VERSIONING.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ §A5: "THE CONTRACT BUILDER AND THE FORM BUILDER ARE SEPARATE TOOLS WITH SEPARATE TEMPLATE SETS."
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// That separation is already enforced in three places and this module is the fourth:
//   1 · `builder` is a CHECK on the table (0009:127);
//   2 · the uniqueness key is SCOPED BY IT (0009:134-135) — two disjoint namespaces;
//   3 · `template_body_kind_matches_builder` (0033/0034) refuses a body of the wrong kind;
//   4 · `createTemplate` takes the builder as an ARGUMENT and never reads it from the body.
// ★ Four layers is not belt-and-braces here. §A5 exists because the two tools produce objects that
//   are rendered by DIFFERENT PROGRAMS, and a form tree reaching the contract renderer is not a
//   validation error — it is a blank or broken legal instrument in front of a client.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P15C.8 — A NEW VERSION IS A NEW ROW. THE OLD ONE IS NEVER EDITED. SAME LAW AS §Z4's PRICES.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ AND THE REASON IS MEASURED, NOT ARCHITECTURAL TASTE: **in the system being replaced a SENT
//    instance NEVER re-picks up its template.** So editing a template in place "to fix" a live
//    agreement fixes nothing, silently — the instrument keeps the words it was sent with, while the
//    author sees their correction on screen and believes it landed.
//   ★ Which means edit-in-place is not merely risky: it is a change that CANNOT do what the person
//     doing it thinks it is doing. The refusal names the new version they actually need.

// @ts-check
import { cleanName } from "./textSafety.mjs";
import { beforeNewTemplate, afterNewTemplate } from "./templateCap.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { invalid, conflict, notFound } from "../http/errors.mjs";
import { parseTemplateBody } from "./body.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "documents";
const UNIQUE_VIOLATION = "23505";

export const BUILDERS = Object.freeze(["contract", "form"]);

/**
 * Author version 1 of a template.
 *
 * ★ `builder` comes from the ROUTE. `parseTemplateBody` then refuses a body whose `kind` disagrees —
 *   P15C.5's second red-first ("save a form body through the contract builder's route").
 */
/**
 * ★★ P9.4 — WHAT A TEMPLATE SELLS. `none` is the default and the commonest answer: a consent form, a
 *    disclosure and a session note sell nothing, and a template that HAD to name a product would
 *    make somebody invent one.
 * ★ The PRICE is deliberately not here. It resolves at SEND from the active price row and freezes at
 *   EXECUTE — a price copied onto a template would be `price_minor` again (`F76`), with the stale
 *   number on the thing a person reads.
 */
export const SELLS_TYPES = Object.freeze(["none", "service", "package", "plan"]);

function assertSells(sellsType, sellsId) {
  if (!SELLS_TYPES.includes(sellsType)) {
    throw invalid(`sellsType must be one of ${SELLS_TYPES.join(" · ")} — got ${JSON.stringify(sellsType)}`);
  }
  // ★ The same pair rule the database enforces, said here in words a caller can act on. `none` with
  //   an id is a template pointing at a product it claims not to sell.
  if (sellsType === "none" && sellsId) {
    throw invalid("a template that sells nothing cannot name a product — pass sellsType with it");
  }
  if (sellsType !== "none" && !sellsId) {
    throw invalid(`a template that sells a ${sellsType} must say WHICH ${sellsType}`);
  }
}

export async function createTemplate(
  tx, {
    tenantId, builder, name, body, sellsType = "none", sellsId = null, actorUserId = null,
    // ★ SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 (migration 0539) — `description` is INTERNAL,
    //   never shown to a client; `clientDescription`/`message` are the DEFAULTS a document made from
    //   this template starts with (client_description → document_instance.description,
    //   message → document_instance.message), independently editable per send afterwards.
    description = null, clientDescription = null, message = null,
  }
) {
  if (!BUILDERS.includes(builder)) {
    throw invalid(`builder must be one of ${BUILDERS.join(", ")} — got ${JSON.stringify(builder)}`);
  }
  assertSells(sellsType, sellsId);
  if (typeof name !== "string" || !name.trim()) {
    throw invalid("a template needs a name — an unnamed template cannot be chosen from a list (F12)");
  }
  name = cleanName(name);   // no right-to-left override or zero-width characters in what others see (BRK-003)
  if (!name) throw invalid("a template needs a name — an unnamed template cannot be chosen from a list (F12)");
  const parsed = parseTemplateBody(builder, body);
  await beforeNewTemplate(tx, { tenantId });   // Run 8: every new template (Free: 5 a month); a host with no plans checks nothing

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await tx.query(
      `INSERT INTO keystone.document_template
         (id, tenant_id, builder, name, version, active, body, sells_type, sells_id,
          description, client_description, message)
       VALUES ($1,$2,$3,$4,1,true,$5::jsonb,$6,$7,$8,$9,$10)`,
      [id, tenantId, builder, name.trim(), JSON.stringify(parsed), sellsType, sellsId,
       description, clientDescription, message]);
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      // ★ The uniqueness key is (tenant, BUILDER, lower(name), version) — so the same name may exist
      //   once in each builder, which is what "separate template sets" means in practice.
      throw conflict(
        `a ${builder} template named "${name.trim()}" already exists at version 1. Author a new ` +
        `VERSION of it rather than a second row with the same name — see newTemplateVersion.`,
        { field: "name" });
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "documents.template.created", emittedBy: SECTION,
    subjectType: "document_template", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ The COUNT of sections/fields, not the body: an outbox payload is delivered to webhook
    //   endpoints, and a contract body is the tenant's legal prose. It belongs in the row, not in
    //   every delivery attempt.
    // ★★★ STAGE 3 TASK 3 — `name` DROPPED (§2.4 bans it outright). Nothing in `src/` reads a
    //   template name back off this topic's payload; a reader wanting it reads the current
    //   `document_template.name` row by the id this event already carries.
    payload: { builder, version: 1,
               size: builder === "contract" ? parsed.sections.length : parsed.fields.length },
  });
  await afterNewTemplate(tx, { tenantId, templateId: id, kind: "document", how: "created", emitCreated: false });   // its own event is above
  return { id, builder, name: name.trim(), version: 1 };
}

/**
 * ★★★ A NEW VERSION IS A NEW ROW. The previous version stays exactly as it was, forever.
 *
 * ★★ THE OLD ROW IS DEACTIVATED, NOT DELETED AND NOT ALTERED. `active=false` means "do not offer this
 *    for new instruments"; it does NOT mean "this never existed". Instruments sent against it quote it
 *    and must keep resolving.
 */
export async function newTemplateVersion(
  tx, {
    tenantId, templateId, body, name = null, sellsType = undefined, sellsId = null, actorUserId = null,
    // ★ SQUARE CONTRACTS OVERHAUL PART 2 (migration 0539) — same carry-forward-unless-given shape as
    //   `name` above, not the six safeguarding columns' unconditional carry: these are editable
    //   authoring content, and an author revising a template is exactly who may want to change them.
    description = undefined, clientDescription = undefined, message = undefined,
  }
) {
  // ★★★ B-62 FIX — every column a version bump must PRESERVE, not only sells_type/sells_id, is read
  //     here so it can be carried forward below. See the INSERT's own comment for the full carry/
  //     don't-carry decision, column by column.
  const cur = await run(tx, db
    .selectFrom("keystone.document_template")
    .select(["id", "builder", "name", "version", "sells_type", "sells_id", "starter_key", "type_id", "requires_parent_under_18", "re_sign_months", "creates_subscription_plan_id", "teen_template_id", "description", "client_description", "message", "labels", "signed_copy"])
    .where("id", "=", templateId));
  if (cur.rowCount === 0) throw notFound("That template is not in this workspace.");
  const prev = cur.rows[0];

  const parsed = parseTemplateBody(prev.builder, body);
  const nextSellsType = sellsType ?? prev.sells_type;
  const nextSellsId = sellsType === undefined ? prev.sells_id : sellsId;
  assertSells(nextSellsType, nextSellsId);
  const nextName = (name ?? prev.name).trim();
  if (!nextName) throw invalid("a template needs a name");

  // ★ The highest existing version for this (builder, name) — not `prev.version + 1`, because a
  //   caller may hold a stale row and two authors may be working at once. Reading the MAX makes the
  //   next number a fact about the table rather than about whichever row the caller happened to load.
  const { rows: [{ max }] } = await tx.query(
    `SELECT COALESCE(max(version), 0) AS max FROM keystone.document_template
      WHERE tenant_id = $1 AND builder = $2 AND lower(name) = lower($3)`,
    [tenantId, prev.builder, nextName]);
  const nextVersion = Number(max) + 1;

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  await tx.query(
    // ★★★ P9.4 — WHAT IT SELLS CARRIES FORWARD BY DEFAULT. A new version of "Family service
    //     agreement" sells the same family service; making the author re-pick it every version is how
    //     version 4 quietly stops being priced at all. ★ An explicit `sellsType` overrides it, for
    //     the case where the product genuinely changed.
    //
    // ★★★ B-62 — EVERY OTHER SETTINGS COLUMN CARRIES FORWARD TOO, UNCONDITIONALLY, FROM `prev`. A
    //     version bump changes the body, the version, the name and the sells linkage — nothing else.
    //     There is no override parameter for any of these six, on purpose: unlike `sellsType`/
    //     `sellsId` (which name a PRODUCT the author may legitimately swap), these six are
    //     safeguarding/routing FACTS about the template's identity that a version bump must never be
    //     able to silently change. A caller who genuinely needs to change one calls
    //     `setTemplateSettings` (`publish.mjs:229`) afterwards, against this same new id — the
    //     existing, audited path for that.
    //       · `starter_key`                   — which built-in starter this was drafted from; the
    //         unique index (0417) is keyed on (tenant, starter_key, version) specifically so the SAME
    //         starter_key can repeat across versions — the schema already expects this to carry.
    //       · `type_id`                       — the document's classification/routing
    //         (`sendDocument.mjs:113` reads it for `default_assigned_to`); losing it on a bump is the
    //         same class of silent-routing-change as the five below.
    //       · `requires_parent_under_18`      — ★★★ THE NAMED SAFEGUARDING BUG. Silently dropping to
    //         `false` means an adolescent signs alone with no error, no audit line.
    //       · `re_sign_months`                — silently dropping to null turns off "sign again every
    //         N months" with no warning.
    //       · `creates_subscription_plan_id`  — silently dropping to null breaks the link between
    //         signing and billing.
    //       · `teen_template_id`              — the adolescent counterpart `sendDocument.mjs:107-108`
    //         routes to; losing it silently sends an adolescent the adult-only wording instead.
    //     NOT carried, each for its own reason:
    //       · `id`          — a new version is a NEW ROW; carrying the old id would overwrite it.
    //       · `version`     — the entire point of this function is a NEW, higher number (`nextVersion`
    //         above), not the old one.
    //       · `active`      — always `true` here; the PREVIOUS row is deactivated separately below.
    //       · `body`        — the new content being authored IS the argument to this function; that is
    //         what a version bump is for.
    //       · `created_at`/`updated_at` — timestamps of THIS row's own creation, not the old row's.
    //       · `published_at` — a version fresh out of this function has not been published yet
    //         regardless of whether its predecessor had been (`publish.mjs:223-227`); carrying the old
    //         value forward would make an unpublished draft look already published, skipping
    //         `publishTemplate`'s fill-in-blank guard.
    //       · `retired_at`  — this is a brand-new row; it cannot already be retired. (The row that
    //         gets `retired_at` is a different one, later, in `publishTemplate` — this function only
    //         flips the previous row's `active` below, not its `retired_at`.)
    //       · `sells_type`/`sells_id` — already handled above with an explicit override path; unlike
    //         the six above, the product a template sells is a legitimate per-version choice.
    `INSERT INTO keystone.document_template
       (id, tenant_id, builder, name, version, active, body, sells_type, sells_id,
        starter_key, type_id, requires_parent_under_18, re_sign_months,
        creates_subscription_plan_id, teen_template_id, description, client_description, message, labels, signed_copy)
     VALUES ($1,$2,$3,$4,$5,true,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::text[],$19::jsonb)`,
    [id, tenantId, prev.builder, nextName, nextVersion, JSON.stringify(parsed),
     nextSellsType, nextSellsId,
     prev.starter_key, prev.type_id, prev.requires_parent_under_18, prev.re_sign_months,
     prev.creates_subscription_plan_id, prev.teen_template_id,
     description === undefined ? prev.description : description,
     clientDescription === undefined ? prev.client_description : clientDescription,
     message === undefined ? prev.message : message,
     prev.labels ?? [],
     // ★ the per-template signed-copy override is carried to the new version, like labels (QUEUE §23.2.8)
     prev.signed_copy === null || prev.signed_copy === undefined ? null : JSON.stringify(prev.signed_copy)]);

  // ★★ Deactivate the PREVIOUS row only — and only if it is still the same name, because renaming
  //    while versioning would otherwise silently retire an unrelated template.
  await tx.query(
    `UPDATE keystone.document_template SET active = false, updated_at = now()
      WHERE id = $1 AND version < $2`, [prev.id, nextVersion]);

  await emit(tx, {
    tenantId, topic: "documents.template.versioned", emittedBy: SECTION,
    subjectType: "document_template", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★★★ STAGE 3 TASK 3 — `name` DROPPED, same reasoning as `createTemplate` above.
    payload: { builder: prev.builder,
               from_version: prev.version, to_version: nextVersion, superseded_id: prev.id },
  });
  return { id, builder: prev.builder, name: nextName, version: nextVersion, supersededId: prev.id };
}

/**
 * ★★★ EDITING A TEMPLATE THAT HAS BEEN SENT IS REFUSED, AND THE REFUSAL NAMES THE NEW VERSION.
 *
 * This is the ONLY mutating path on an existing row's body, and it exists so the refusal has somewhere
 * to live. Before any instrument has gone out, an edit is just authoring. After one has, an edit is a
 * change that **cannot reach the thing the author is trying to fix** — see the header.
 */
export async function updateTemplateBody(tx, { tenantId, templateId, body, actorUserId = null }) {
  const cur = await run(tx, db
    .selectFrom("keystone.document_template")
    .select(["id", "builder", "name", "version", "sells_type", "sells_id"])
    .where("id", "=", templateId));
  if (cur.rowCount === 0) throw notFound("That template is not in this workspace.");
  const tpl = cur.rows[0];

  // ★ "Has been SENT", not "has an instance". A DRAFT instance has not been in front of anybody and
  //   re-reads the template when it is sent, so editing while only drafts exist is legitimate.
  const { rows: [{ n }] } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.document_instance
      WHERE template_id = $1 AND state <> 'draft'`, [templateId]);
  if (n > 0) {
    throw conflict(
      // F148 (23 Oct 2026): a sentence a person reads in the editor, not developer copy
      `This template has been sent ${n === 1 ? "once" : `${n} times`}, so it can't be changed: a document that was sent ` +
      `never re-picks up later edits. Save your changes as version ${tpl.version + 1} instead.`,
      { field: "body", requiredVersion: tpl.version + 1, sentInstances: n });
  }

  const parsed = parseTemplateBody(tpl.builder, body);
  await tx.query(
    `UPDATE keystone.document_template SET body = $2::jsonb, updated_at = now() WHERE id = $1`,
    [templateId, JSON.stringify(parsed)]);

  await emit(tx, {
    tenantId, topic: "documents.template.updated", emittedBy: SECTION,
    subjectType: "document_template", subjectId: templateId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★★★ STAGE 3 TASK 3 — `name` DROPPED, same reasoning as `createTemplate` above.
    payload: { builder: tpl.builder, version: tpl.version, sent_instances: 0 },
  });
  return { id: templateId, builder: tpl.builder, version: tpl.version };
}
