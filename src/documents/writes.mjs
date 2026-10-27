// @ts-check
// P15B.8 — THE DOCUMENT WRITES. categories · types (the seven axes) · createInstance · send ·
//          countersign · execute.
//
// ★★★ WHAT IS **NOT** HERE, AND WHY: `createTemplate` AND BOTH BUILDERS ARE PHASE 15C. This module
//     moves INSTANCES through their states and defines the VOCABULARY (types and categories). It does
//     not author template bodies, because a template body has no storage shape yet (P15C.2 is the
//     migration that creates one) and building an author tool against a table that does not exist is
//     how the two drift.
//
// ═════════════════════════════════════════════════════════════════════════════
// ★★★ §M0 LAW 3 CANNOT BE FULLY SATISFIED YET, AND THIS FILE SAYS SO IN THE DATA
// ═════════════════════════════════════════════════════════════════════════════
// LAW 3: on execute, SNAPSHOT the price, the terms, the disclosure text AND ITS VERSION.
//   · price   — available. Taken from `keystone.price`, the time-windowed authority (§Z4).
//   · terms   — available, from the template snapshot the instance already carries.
//   · disclosure text and its version — **NOW AVAILABLE (P15C.10).** At P15B.8 there was no store and
//     this header said so; migration 0032 created `keystone.esign_disclosure_acceptance`, and
//     `acceptDisclosure` / `withdrawDisclosure` at the foot of this file are its write path.
// ★★ THE SNAPSHOT RECORDS THE DISCLOSURE STATE EXPLICITLY rather than omitting the field, and it names
//    WHICH of three states holds — `NO_CONSUMER_SIGNER`, `NOT_ACCEPTED` (a defect), or `CAPTURED`. A
//    snapshot that silently lacks a disclosure is indistinguishable from an instrument where none
//    applied, and on a signed instrument that difference is the whole question.
//    ★ Omitting it would have been the smaller diff and the bigger lie.
//    ★★ AND `NOT_ACCEPTED` IS NOT THE SAME STATEMENT AS `NO_CONSUMER_SIGNER`. The first draft of the
//       reader returned one status for both with prose explaining the ambiguity; a status that needs a
//       paragraph to disambiguate it is two statuses. See `disclosureSnapshotFromAcceptance`.

import { emit, userActor } from "../events/outbox.mjs";
import { normaliseReason, keepReason } from "../events/reasons.mjs";
import { invalid, conflict, notFound } from "../http/errors.mjs";
import { disclosureSnapshotFromAcceptance, ERSD_VERSION } from "./disclosure.mjs";
import { parseTemplateSnapshot, parseTemplateBody } from "./body.mjs";
import { recordAuditEvent } from "./auditTrail.mjs";
// ★★★ THE SIGNING ORDER HAS ONE DECLARATION AND IT IS THIS ONE. `SIGNER_CONFIGS` in vocabulary.mjs maps
//     each config to its ORDERED party list; this module reads it rather than restating it, because the
//     defect a second copy produces is a disagreement about who signs next.
import { SIGNER_CONFIGS as SIGNER_ORDERS } from "./vocabulary.mjs";
import { getDocumentSetting } from "./settings.mjs";
import { snapshotParties, markPartySigned } from "./parties.mjs";
import { resolveVariables } from "./variables.mjs";
import { ports } from "./ports.mjs";
import { createHash } from "node:crypto";
import { canonicalJson } from "../json/canonical.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★★★ P8.8 — HOW LONG THIS SIGNATURE REQUEST STAYS LIVE, RESOLVED ONCE AND STORED ON THE ROW.
 *
 * ★★ `0` AND UNSET BOTH MEAN "NEVER LAPSES", and they are returned as `null` so the column says so.
 *    A document with a null `expires_at` cannot be found by the due-sweep at all, which is why every
 *    instrument sent before P8.8 is untouched by it rather than retroactively given a deadline.
 * ★ The value is INTERPOLATED INTO THE UPDATE AS AN INTERVAL rather than computed from the Node
 *   clock, so the deadline is measured from the same `now()` that stamps `sent_at`. Two clocks
 *   deciding one instrument's dates is how "sent today, expired yesterday" happens.
 */
export const SIGNATURE_VALIDITY_KEY = "signature_validity_days";
async function signatureValidityDays(tx) {
  const v = await getDocumentSetting(tx, SIGNATURE_VALIDITY_KEY);
  return Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * ★★★ THE CHAIN LINK. sha256 over the facts that make a signature what it is, INCLUDING the previous
 *     row's hash — so the signatures on one instrument form a chain whose tail cannot be recomputed
 *     without every link.
 * ★★ WHY A CHAIN AND NOT JUST ROWS WITH TIMESTAMPS: independent rows can be reordered, back-dated, or
 *    have one silently removed, and nothing in the data disagrees. With a chain, removing row 2 leaves
 *    row 3 pointing at nothing and altering row 2 makes row 3's hash wrong. The evidence checks itself.
 * ★ The FIELD ORDER here is part of the format. Changing it changes every hash, so a future change
 *   needs a version marker, not a quiet edit.
 */
export function signatureRowHash({
  instanceId, role, signerOrder, signerUid, signerName, signedAt, markSha256, prevHash,
}) {
  const canonical = [
    "keystone.signature.v1",
    instanceId, role, String(signerOrder),
    signerUid ?? "", signerName,
    signedAt instanceof Date ? signedAt.toISOString() : String(signedAt),
    markSha256 ?? "",
    prevHash ?? "",
  ].join("\u0000");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** The digest stored beside a signature — of the MARK, so screen and record cannot drift unnoticed. */
export function markDigest(dataUri) {
  if (typeof dataUri !== "string" || !dataUri) return null;
  return createHash("sha256").update(dataUri, "utf8").digest("hex");
}

const SECTION = "documents";

export const BUILDERS = Object.freeze(["contract", "form", "pdf"]);
export const DIVISIONS = Object.freeze(["recovery", "tech"]);
// ★ `expired` added by P8.8 (migration 0110). It is reached ONLY by the due sweep, only from `sent`,
//   and only when the instrument's own deadline has passed — there is no route that sets it.
export const INSTANCE_STATES = Object.freeze(
  ["draft", "sent", "partially_signed", "executed", "declined", "void", "expired"]);
export const AUDIENCES = Object.freeze(["staff", "adult_client", "adolescent_client", "parent"]);
export const APPLIES_TO = Object.freeze(["adult_client", "adolescent_client", "parent", "staff"]);
/**
 * ★★★ THE PARTY VOCABULARY. CLAUDE.md §2.7's rule lives here: "NAME THE PARTY YOU MEAN, NEVER BORROW
 *     ANOTHER'S." The live defect it records is a GLT tech client's signature rendering under a badge
 *     reading "PIR" because a fallback let the recovery branch catch the tech party.
 * ★ `both` is in the CHECK and is deliberately last: it means "either side may act", not "we did not
 *   decide". Nothing in this module ever DEFAULTS to it.
 */
export const ASSIGNEES = Object.freeze(
  ["pir", "parent", `coach`, "client", "consultant", "familyMember", "recipient", "both"]);
// ★★ THE SECOND COPY OF THIS VOCABULARY. `src/documents/vocabulary.mjs` holds the first, as an
//    object mapping each config to its signers; this is a flat key list used for validation.
//    `db/gates/p6_vocabulary_agreement.mjs` exists because two copies drift — **both must be
//    edited together, and together with the database CHECK.** `CLIENT_AND_PARENT` added 25 Sep 2026
//    with migration 0417 (14.10, R-14.13's teen signing order); it is the twelfth.
export const SIGNER_CONFIGS = Object.freeze([
  "PIR_ONLY", "COACH_ONLY", "CO_SIGNED", "PARENT_ONLY", "PARENT_AND_COACH", "PIR_PARENT_COACH",
  "CLIENT_ONLY", "CLIENT_AND_CONSULTANT", "CLIENT_AND_PARENT", "FAMILY_MEMBER_ONLY",
  "RECIPIENT_ONLY", "RECIPIENT_AND_COACH",
]);

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

const KEY_RE = /^[a-z][a-z0-9_]*$/;

function assertSubset(label, values, allowed) {
  if (!Array.isArray(values)) throw invalid(`${label} must be an array`);
  const bad = values.filter((v) => !allowed.includes(v));
  if (bad.length) throw invalid(`${label} contains ${JSON.stringify(bad)} — allowed: ${allowed.join(", ")}`);
}

/** A category groups types for display. `key` is machine-stable, `label` is what a human reads. */
export async function createDocumentCategory(tx, { tenantId, key, label, sortOrder = 100, actorUserId = null }) {
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    throw invalid(`key must match ${KEY_RE} (lower-case, starts with a letter) — got ${JSON.stringify(key)}`);
  }
  if (typeof label !== "string" || !label.trim()) throw invalid("a category needs a label");

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db.insertInto("keystone.document_category").values({
      id: id ?? null, tenant_id: tenantId ?? null, key: key ?? null, label: label.trim() ?? null,
      sort_order: sortOrder ?? null
    }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) throw conflict(`a document category with key "${key}" already exists`, { field: "key" });
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "documents.category.created", emittedBy: SECTION,
    subjectType: "document_category", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: { key, sort_order: sortOrder },
  });
  return { id, key, label: label.trim() };
}

/**
 * ★★★ CREATE A DOCUMENT TYPE — THE SEVEN AXES. Each is stated explicitly and none is defaulted into
 *     existence, because each answers a different question and a wrong guess is invisible:
 *       1 · category_id + sub_category — where it sits for a human
 *       2 · signer_config             — WHO must sign, by name
 *       3 · audience                  — who may SEE it
 *       4 · division                  — recovery or tech (Docustay vs GLT)
 *       5 · applies_to                — which kind of person it can be issued to
 *       6 · default_assigned_to       — which party is expected to act
 *       7 · is_session_note           — the one boolean with a safety rule attached
 *
 * ★★★ THE PARENT RULE IS A DATABASE CONSTRAINT, NOT A CONVENTION:
 *       session_notes_never_to_parents CHECK (NOT (is_session_note AND 'parent' = ANY (audience)))
 *     "Parent sees money / documents / attendance, NEVER session notes" is a DO-NOT-REOPEN ruling, and
 *     it is enforced where no code path can route around it. This module refuses it first, for the
 *     message; the constraint refuses it always.
 */
export async function createDocumentType(tx, {
  tenantId, key, label, categoryId, subCategory, signerConfig,
  audience, division, appliesTo, defaultAssignedTo, isSessionNote = false, actorUserId = null,
}) {
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    throw invalid(`key must match ${KEY_RE} — got ${JSON.stringify(key)}`);
  }
  if (typeof label !== "string" || !label.trim()) throw invalid("a document type needs a label");
  if (!categoryId) throw invalid("a document type must belong to a category");
  if (typeof subCategory !== "string" || !subCategory.trim()) throw invalid("subCategory is required");
  if (!SIGNER_CONFIGS.includes(signerConfig)) {
    throw invalid(`signer_config must be one of ${SIGNER_CONFIGS.join(", ")} — got ${JSON.stringify(signerConfig)}`);
  }
  if (!DIVISIONS.includes(division)) {
    // ★ NO DEFAULT, even though the column has one. `division` decides which brand's name appears on
    //   an instrument and which party vocabulary is correct; guessing "recovery" for a GLT document is
    //   exactly the cross-division defect CLAUDE.md §2.7 records.
    throw invalid(`division must be one of ${DIVISIONS.join(", ")} — got ${JSON.stringify(division)}`);
  }
  assertSubset("audience", audience, AUDIENCES);
  assertSubset("applies_to", appliesTo, APPLIES_TO);
  assertSubset("default_assigned_to", defaultAssignedTo, ASSIGNEES);

  // ★★★ THE PARENT RULE, REFUSED HERE FOR THE MESSAGE.
  if (isSessionNote && audience.includes("parent")) {
    throw invalid(
      "a session note can never have 'parent' in its audience — a parent sees money, documents and " +
      "attendance, and never session notes. This is a standing ruling, not a default, and the " +
      "database enforces it as session_notes_never_to_parents."
    );
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db.insertInto("keystone.document_type").values({
      id: id ?? null, tenant_id: tenantId ?? null, key: key ?? null, label: label.trim() ?? null,
      category_id: categoryId ?? null,
      sub_category: subCategory.trim() ?? null, signer_config: signerConfig ?? null,
      audience: audience ?? null, division: division ?? null, applies_to: appliesTo ?? null,
      default_assigned_to: defaultAssignedTo ?? null,
      is_session_note: isSessionNote ?? null
    }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) throw conflict(`a document type with key "${key}" already exists`, { field: "key" });
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this document type: ${e.constraint ?? e.message}`);
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "documents.type.created", emittedBy: SECTION,
    subjectType: "document_type", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ The axes that change BEHAVIOUR are in the payload — who signs, who sees, which division, and
    //   whether it is a session note. A consumer deciding visibility must not have to re-read.
    payload: { key, signer_config: signerConfig, audience, division, is_session_note: isSessionNote },
  });
  return { id, key, label: label.trim() };
}

/**
 * Create an instance in `draft`.
 * ★ `title` is NOT NULL and non-blank at the database (`document_instance_title_nonblank`), which is
 *   what closed F12 — a pipeline row whose title rendered as a raw UUID. So it is required here.
 */
export async function createInstance(tx, {
  tenantId, builder, title, typeId = null, templateId = null, subjectUserId = null, assignedTo = [],
  actorUserId = null,
  // ★ SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 (migration 0539) — the client-facing facts that
  //   ride along with this one document, independently editable afterwards without touching the
  //   template — same "copied once, edited without touching the source" shape `title` (from
  //   `template.name`) already has.
  description = null, message = null,
  // ★ QUEUE §23.3.3 — this send's own `custom.<key>` merge values (from the API or a CSV): a flat object of short strings, frozen with the words at send
  customValues = null,
}) {
  if (!BUILDERS.includes(builder)) {
    throw invalid(`builder must be one of ${BUILDERS.join(", ")} — got ${JSON.stringify(builder)}`);
  }
  if (typeof title !== "string" || !title.trim()) {
    throw invalid("an instance needs a non-blank title — a document listed under a raw id is unusable (F12)");
  }
  if (title.trim().length > 250) throw invalid("A document title can be up to 250 letters. Shorten it and try again.", { field: "title" });   // BRK-001: a 10,000-letter title was accepted silently
  assertSubset("assigned_to", assignedTo, ASSIGNEES);
  if (customValues !== null && customValues !== undefined) {
    if (typeof customValues !== "object" || Array.isArray(customValues) || Object.keys(customValues).length > 100
        || Object.entries(customValues).some(([k, v]) => !/^[a-z][a-z0-9_]*$/.test(k) || typeof v !== "string" || v.length > 2000)) {
      throw invalid("customValues must be an object of up to 100 short text values, named in lower-case letters, digits and underscores (they are used as custom.<name> in the document)", { field: "customValues" });
    }
  }

  // ★★★ F777 — A DOCUMENT WITHOUT A TYPE IS INVISIBLE TO EVERY STAFF VIEWER (`document_is_visible`), so it
  //     could be created, never seen, and its send 500'd. An instance with no `typeId` inherits its
  //     template's; one that still has none is REFUSED here, with the reason, instead of saved unreachable.
  if (!typeId && templateId) {
    const { rows } = await run(tx, db.selectFrom("keystone.document_template").select("type_id")
      .where("id", "=", templateId).where("tenant_id", "=", tenantId));
    typeId = rows[0]?.type_id ?? null;
  }
  // ★★★ SENDING NEVER BLOCKS ON A MISSING TYPE (the maintainer, 2 Oct 2026). A template with no type used to refuse the send with the F777 message — and the template editor's
  //     blank-settings bug (see records/lists/documents.mjs) put exactly that state on templates. The document now takes the practice's FIRST ordinary type (never a
  //     session-note type) so it is visible and sendable; only a practice with NO types at all is refused, with the reason.
  if (!typeId) {
    const { rows } = await tx.query(
      `SELECT id FROM keystone.document_type WHERE tenant_id = $1 AND NOT is_session_note ORDER BY ('parent' = ANY(COALESCE(default_assigned_to, '{}'))), created_at, id LIMIT 1`, [tenantId]);   // a type that needs no parent first: an adult's document must not wait for a parent who is never asked (found on beta, 24 Oct)
    typeId = rows[0]?.id ?? null;
  }
  if (!typeId) {
    throw invalid(
      "this practice has no document types yet, so nobody could see or send a document — add one in Settings → Documents, " +
      "or pick a template that has one");
  }

  // ★ A document nobody was assigned to is invisible to the person it is for (`document_is_visible` returns false for an empty `assigned_to`), so a
  //   caller that names no assignee gets the TYPE's own default instead of an instrument its subject can never open.
  if (!assignedTo || assignedTo.length === 0) {
    const { rows } = await tx.query(`SELECT default_assigned_to FROM keystone.document_type WHERE tenant_id = $1 AND id = $2`, [tenantId, typeId]);
    if (rows[0]?.default_assigned_to?.length) assignedTo = rows[0].default_assigned_to;
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  // ★★★ F591 — `created_by` is `actorUserId`, which `src/routes/writes.mjs:324` stamps onto the
  //     handler's args AFTER spreading the request body (`{ ...body, actorUserId: principal?.appUserId
  //     ?? null, tenantId }`), so a caller cannot name a writer by putting `created_by` in the body —
  //     only the session's own principal ever reaches this column. A call with no session (worker,
  //     fixture, gate) writes NULL, which is honest, not a guess (0194 §A's column is nullable for it).
  await run(tx, db.insertInto("keystone.document_instance").values({
    id: id ?? null, tenant_id: tenantId ?? null, builder: builder ?? null, title: title.trim() ?? null,
    type_id: typeId ?? null,
    template_id: templateId ?? null, subject_user_id: subjectUserId ?? null, assigned_to: assignedTo ?? null,
    state: "draft", created_by: actorUserId ?? null,
    description: description ?? null, message: message ?? null,
    custom_values: customValues && Object.keys(customValues).length ? JSON.stringify(customValues) : null,
  }));

  await emit(tx, {
    tenantId, topic: "documents.document.created", emittedBy: SECTION,
    subjectType: "document", subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★★ `document.created` is NOT `document.sent`. A draft that exists and a draft that has been put
    //    in front of somebody are different facts, and the outbox catalogue has both for that reason.
    payload: { builder, state: "draft", assigned_to: assignedTo },
  });
  return { id, state: "draft", title: title.trim() };
}

/**
 * draft → sent.
 * ★★★ THE TRANSITION IS IN THE PREDICATE. `state = 'draft'` in the WHERE clause means a second send
 *     matches zero rows and is refused — so an instrument cannot be "sent" twice, and `sent_at` cannot
 *     be moved after the fact. `sent_shape` at the database additionally refuses any non-draft row
 *     with a NULL `sent_at`.
 */
// ★ `canonicalJson` MOVED to `src/json/canonical.mjs` at the P10 close — a second caller appeared
//   (the idempotency gate, which had the identical key-order defect) and two copies of "do these
//   mean the same thing" that can drift apart is the DUPLICATE-TRUTH class. Imported at the top.

export const SEND_MODES = Object.freeze(["locked", "fill", "open"]);

/**
 * ★★★ P9.3 — THE DEFAULT IS `fill`, AND IT IS A DECISION (KS-8.2, RULED). LOCKED is too rigid for
 *     most real documents — almost every agreement has a name, a date or a fee in it — and
 *     defaulting to it teaches people to reach for OPEN. OPEN lets somebody rewrite a legal
 *     instrument minutes before a client signs it, so it must be the mode somebody CHOSE.
 */
export const DEFAULT_SEND_MODE = "fill";

export async function sendInstance(
  tx, { tenantId, instanceId, actorUserId = null, sendMode = DEFAULT_SEND_MODE, overrideBody = null }
) {
  if (!SEND_MODES.includes(sendMode)) {
    throw invalid(`sendMode must be one of ${SEND_MODES.join(" · ")} — got ${JSON.stringify(sendMode)}`);
  }
  // the host's plan (a hosted workspace's monthly document limit) may refuse a send — optional port, a host with no plans has none
  await (await ports()).entitlements?.assertMaySend?.(tx, { tenantId });
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE REFUSAL THAT MAKES THE MODE MEAN ANYTHING. A body supplied under `locked` or `fill` is
  //     a departure from the template, and only `open` permits one. Refusing here — and in the
  //     database, via `open_send_is_recorded` — is what stops "send mode" from being a label the
  //     product displays and nothing enforces.
  //   ★★ AND THE MESSAGE NAMES THE MODE THAT WOULD PERMIT IT, because the person hitting this
  //      usually has a legitimate reason and needs to know the honest way to do it — which carries a
  //      permanent mark on the instrument, and should.
  if (overrideBody && sendMode !== "open") {
    throw invalid(
      `this send is \`${sendMode}\` and a replacement body was supplied. Only an \`open\` send may ` +
      `depart from its template, and an open send is RECORDED on the instrument forever — an ` +
      `instrument that differs from its template without a record is indistinguishable from a forgery.`);
  }
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE TEMPLATE BODY IS FROZEN HERE, AT SEND — AND NOTHING HAS EVER DONE THIS. §M0 LAW 3.
  //
  // [MEASURED 2026-09-14, from the deployed worker's log] the PDF archive refused, correctly:
  //     "refusing to render a PDF from a snapshot whose frozen `template` is null. ★ The result would
  //      be a titled page with signatures and NO TERMS — indistinguishable from a real agreement to
  //      anyone holding it, and impossible to argue with."
  // The instance HAD a `template_id`. What it did not have was the template's BODY.
  //
  // ★★★ `executeInstance` builds the snapshot with `template: inst.template_snapshot ?? null` and its
  //     own comment says *"whatever the instance already carried (a template body, once 15C exists) is
  //     preserved rather than replaced"*. **Nothing ever populated it.** 15C built the builders, the
  //     versioning and the validator; the one line that copies a body onto an instrument was missing,
  //     so every executed instrument in this system carried a snapshot with **no terms in it**.
  //   ★★ AND IT PRESENTED AS NOTHING AT ALL until something tried to RENDER the instrument. Execution
  //      succeeded, the state machine was correct, `executed_shape`'s CHECK was satisfied (the snapshot
  //      object is non-null — it just has a null `template` inside it). The only thing that could
  //      notice was the renderer, which is why P18.9 found it and eleven phases did not.
  //
  // ★ WHY **SEND** AND NOT EXECUTE: §M0 LAW 3 freezes at the moment the instrument goes to a person.
  //   A signer agrees to the words they were shown; freezing at execute would let an edit between send
  //   and signature change what they signed. And P15C.8's rule — "a sent instrument never re-picks up
  //   its template" — is only true if the body is copied at send.
  // ★ `active = true` and highest `version`: a new VERSION is a new row (P15C.8), so "the template" for
  //   a send means its current active version, resolved once, here.
  const tpl = await run(tx, db.selectFrom("keystone.document_template as t")
    .innerJoin("keystone.document_instance as i", "i.template_id", "t.id")
    .select(["t.id", "t.version", "t.body"])
    .where("i.id", "=", instanceId)
    .where("t.active", "=", true));

  // ★★★ IT WRITES template_body_snapshot, NOT template_snapshot — migration 0053, and the DATABASE
  //     taught me the difference: a bare body in template_snapshot is refused by
  //     snapshot_is_readable, because that column holds the whole INSTRUMENT (body + price +
  //     disclosure) frozen at EXECUTE. The WORDS freeze here, at send; the INSTRUMENT freezes at
  //     execute. Two moments, two columns.
  // ★★ COALESCE so a re-send (which cannot happen — the predicate requires 'draft') or a future path
  //    that pre-froze a body can never have it silently replaced. Freezing is a one-way door, and
  //    overwriting a frozen body is the drift LAW 3 exists to stop.
  // ★ NOTE THE COMMENTS ARE OUT HERE, NOT INSIDE THE TEMPLATE LITERAL. A backtick in an SQL comment
  //   TERMINATES the literal — it cost a parse error twice in this phase, both times in a comment
  //   that was quoting a column name.
  // ★★★ P8.8 — THE DEADLINE IS RESOLVED HERE, AT SEND, AND NEVER RE-READ. See
  //     `signatureValidityDays` above. `null` (the default) leaves `expires_at` null, which means
  //     this instrument never lapses and the due-sweep cannot see it.
  const validityDays = await signatureValidityDays(tx);

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P9.1 — THE VARIABLE VALUES FREEZE HERE TOO, WITH THE WORDS, AND FOR THE SAME REASON.
  //     [MEASURED 2026-09-15] both renderers read `values` and **nothing had ever written it**, so
  //     every variable in the system rendered "[label — not provided]", permanently.
  //   ★★ AT SEND, NOT AT RENDER. §M0 LAW 3 freezes what the signer was shown, and the values ARE part
  //      of what they were shown. Resolved at render instead, a client who changes their surname next
  //      year would silently rewrite an agreement they had already signed, and reprinting an executed
  //      instrument would produce a different document from the one in the file.
  //   ★ Resolved BEFORE the UPDATE and inside the same transaction, so the body and its values are
  //     frozen by one statement and cannot disagree.
  const frozenValues = await resolveVariables(tx, { tenantId, instanceId });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P9.3 — WHICH BODY IS FROZEN, AND WHETHER IT DEPARTED FROM THE TEMPLATE.
  //     `overrideBody` is only reachable under `open` (refused above). It is PARSED with the same
  //     validator the authoring route uses, so an open send cannot smuggle in a shape the system
  //     could not have authored — departing from the WORDS is permitted; departing from the SHAPE
  //     is how an unreadable instrument gets frozen onto somebody's signature.
  //   ★★ `bodyOverridden` is computed by COMPARING, not by trusting the caller's flag. A sender who
  //      passes `sendMode: "open"` and then supplies the template's own body unchanged has not
  //      departed from anything, and marking that instrument as a departure would put a permanent
  //      and false mark on it.
  const templateBody = tpl.rowCount === 1 ? tpl.rows[0].body : null;
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P9.4 — A TEMPLATE THAT SELLS SOMETHING MUST HAVE A LIVE PRICE, OR THIS SEND IS REFUSED.
  //
  //     [MEASURED 2026-09-15, before P9.4] `document_template` had nine columns and none of them said
  //     what the agreement was FOR, so **the price on every agreement ever sent was typed by a human
  //     and checked against nothing.**
  //
  //   ★★ REFUSED AT SEND, WHICH IS THE LAST MOMENT ANYBODY CAN ACT. §Z4 makes "sellable" a
  //      CONJUNCTION — an active definition AND a price row covering now() — so a service whose price
  //      window closed yesterday is not sellable today, and an agreement quoting it would go out with
  //      a price nobody can charge. The alternative is discovering it at execute, after somebody has
  //      signed.
  //   ★ The message names the product, because the fix is in the CATALOGUE and the person hitting
  //     this is looking at a document.
  const { rows: [sells] } = await tx.query(
    `SELECT t.sells_type, t.sells_id, cp.amount_minor, cp.currency
       FROM keystone.document_instance i
       JOIN keystone.document_template t ON t.id = i.template_id
       LEFT JOIN LATERAL keystone.current_price(t.sells_type, t.sells_id, now()) cp ON true
      WHERE i.id = $1 AND t.sells_type <> 'none'`, [instanceId]);
  if (sells && sells.amount_minor === null) {
    throw conflict(
      `this agreement sells a ${sells.sells_type} that has NO LIVE PRICE, so it cannot be sent. ` +
      `§Z4: a thing is sellable only when its definition is active AND a price row covers today — ` +
      `price the ${sells.sells_type} in the catalogue and send again. ★ Sending it would put a ` +
      `figure in front of a client that nobody can charge.`);
  }

  // ★ The builder comes from the INSTANCE, not from the caller. A caller who could name the builder
  //   could send a form body into a contract instrument — the §A5 separation, bypassed at send.
  const { rows: [instRow] } = await run(tx, db.selectFrom("keystone.document_instance")
    .select("builder").where("id", "=", instanceId));
  if (!instRow) throw notFound("That document is not in this workspace.");
  const bodyToFreeze = overrideBody ? parseTemplateBody(instRow.builder, overrideBody) : templateBody;
  // ★★★ COMPARED CANONICALLY, AND THE FIRST VERSION OF THIS LINE WAS WRONG IN THE DANGEROUS
  //     DIRECTION. It compared `JSON.stringify(parsed)` against `JSON.stringify(stored)` — and the
  //     validator returns keys in ITS declaration order while Postgres returns `jsonb` keys in its
  //     own. [MEASURED 2026-09-15] an `open` send passing the template's OWN body back verbatim came
  //     out `body_overridden = true`: **a permanent mark saying an instrument departed from its
  //     template when it had not.** A document somebody then has to defend for no reason — and if
  //     every open send is marked, the mark stops meaning anything at all.
  //   ★ `canonicalJson` sorts keys at every depth and preserves ARRAY order, because the order of
  //     sections and blocks IS the document — two contracts with the same clauses in a different
  //     order are different contracts.
  const bodyOverridden = Boolean(
    overrideBody && templateBody
    && canonicalJson(bodyToFreeze) !== canonicalJson(parseTemplateBody(instRow.builder, templateBody)));

  const r = await tx.query(
    `UPDATE keystone.document_instance
        SET state = 'sent', sent_at = now(), updated_at = now(),
            send_mode = $5,
            body_overridden = $6,
            expires_at = CASE WHEN $3::int IS NULL THEN NULL
                              ELSE now() + make_interval(days => $3::int) END,
            template_body_snapshot = COALESCE(
              template_body_snapshot,
              CASE WHEN $2::jsonb IS NULL THEN NULL
                   ELSE $2::jsonb || jsonb_build_object('values', $4::jsonb) END)
      WHERE id = $1 AND state = 'draft' AND archived_at IS NULL
      RETURNING title, builder, sent_at, expires_at, send_mode, body_overridden,
                template_body_snapshot IS NOT NULL AS body_frozen,
                template_body_snapshot -> 'values' AS frozen_values`,
    [instanceId,
     // ★★★ THE BODY ITSELF, NOT A WRAPPER AROUND IT. [MEASURED] `templateSnapshotSchema` documents
     //     `template` as *"the frozen BODY, when the instance carried one. Validated as a body when
     //     present"*, and `renderExecutedPdf` reads `parsed.template` as the body directly
     //     (`pdf.mjs:194`, whose own comment says "the frozen body is `snapshot.template`, NOT
     //     `snapshot.body`"). My first version wrapped it as `{template_id, version, body}` — which
     //     would have passed the schema (the field is `z.unknown()`) and then rendered an EMPTY
     //     agreement, because the wrapper has no `sections`. ★ A shape that validates and renders blank
     //     is worse than one that throws; the version lives on the snapshot's own `template_id` plus the
     //     template row, which is where P15C.8 already keeps it.
     bodyToFreeze ? JSON.stringify(bodyToFreeze) : null,
     validityDays,
     JSON.stringify(frozenValues),
     sendMode,
     bodyOverridden]);
  if (r.rowCount === 0) throw conflict("only a draft can be sent — this instance is not a draft, or does not exist here");

  // ★★★ AND IF THERE WAS NO TEMPLATE, SAY SO ON THE INSTRUMENT RATHER THAN LEAVING IT LOOKING FINE.
  //     An instrument with no template body is legitimate for a `form` builder whose fields live
  //     elsewhere, and illegitimate for a contract. Refusing here would break the form path; saying
  //     nothing is what produced the untitled-terms defect above. So: it is recorded in the EVENT, and
  //     the renderer's own refusal remains the hard stop for the case that actually matters.
  if (!r.rows[0].body_frozen) {
    console.warn(
      `[documents] instance ${instanceId} was SENT with NO frozen template body (template_id resolved ` +
      `to ${tpl.rowCount} active template(s)). A contract in this state CANNOT be rendered as a PDF — ` +
      `by design, see renderExecutedPdf. §M0 LAW 3.`);
  }

  await emit(tx, {
    tenantId, topic: "documents.document.sent", emittedBy: SECTION,
    subjectType: "document", subjectId: instanceId,
    // ★ STAGE 3 TASK 1 — the same `actorUserId` this function already threads into the payload's
    //   `sent_by` (below) now also carries the envelope's `actor`. The payload field stays; a later
    //   task owns payload contents (see outbox.mjs's userActor doc comment).
    actor: userActor(actorUserId),
    // ★★★ `sent_by` FOR THE SAME REASON `executed_by` EXISTS — see executeInstance's note. The email
    //     handler has to READ this instrument to find out who to write to, and `document_is_visible()`
    //     fails closed on a null viewer. Without an actor the handler sees nothing and, worse, an
    //     invisible row is indistinguishable from a row with no subject.
    payload: { builder: r.rows[0].builder, sent_at: r.rows[0].sent_at, sent_by: actorUserId,
               // ★ Whether the terms were frozen is a FACT ABOUT THIS INSTRUMENT and belongs in the
               //   audit feed. An auditor reading the feed can tell a renderable instrument from one
               //   that will refuse, without opening the snapshot.
               template_body_frozen: r.rows[0].body_frozen === true,
               // ★★★ P9.3 — THE MODE AND THE DEPARTURE ARE IN THE AUDIT FEED AS WELL AS ON THE ROW,
               //     and both are needed. The ROW is what somebody reads years later beside the
               //     signature; the EVENT is what a webhook subscriber, a task chain or an
               //     investigator scanning the feed sees WITHOUT opening every instrument. An open
               //     send that only marked the row would be invisible to everything downstream.
               send_mode: r.rows[0].send_mode,
               body_overridden: r.rows[0].body_overridden === true },
  });
  await recordAuditEvent(tx, { tenantId, instanceId, kind: "sent" });
  // ★ QUEUE §23.3.2 — copy who is on this send (name, email, role, order) into the island's own party rows, so the signed record stands alone
  await snapshotParties(tx, { tenantId, instanceId });
  return {
    id: instanceId, state: "sent", sent_at: r.rows[0].sent_at,
    send_mode: r.rows[0].send_mode, body_overridden: r.rows[0].body_overridden === true,
  };
}

/**
 * Record that a party signed — `sent` → `partially_signed`.
 *
 * ★★★ THIS IS NOT THE SIGNATURE RECORD. **THERE IS NO SIGNATURE TABLE YET** — P15C.7 is the item that
 *     builds one ("SIGNATURES: there is no table. Build one row per party"). So this function moves
 *     the instance's STATE and emits `document.signed` with the party named, and it does NOT pretend
 *     to store who signed, when, or with what hash.
 * ★★ THE ROLE IS REQUIRED AND MUST BE A REAL PARTY NAME. CLAUDE.md §2.7: "never fall back from one
 *     party to another", and "only label a party that actually signed". A default here would be the
 *     exact defect — a tech client's signature recorded under the recovery party's name.
 */
export async function recordSignature(tx, {
  tenantId, instanceId, role,
  // ★★★ P15C.7 — THE SIGNATURE IS NOW A ROW, NOT A STATE CHANGE. Everything below is what makes it
  //     evidence rather than a rumour: who, when on THEIR clock, on what device, and against which mark.
  signerName = null, signerUid = null,
  signedLocalDate = null, signerTimezone = null,
  userAgent = null, signerIp = null, markSha256 = null, actorUserId = null,
  // ★★★ markImage — ADDED 25 Sep 2026, ON THE MAIN THREAD. `0418` added
  //     `signature_record.mark_image` for "the drawn signature held with this record", and this
  //     INSERT never wrote it. So every signature stored the HASH of the mark and threw the mark
  //     itself away. ★★ `signature_record` is append-only (`0036`'s `signature_record_no_update`
  //     trigger refuses any later UPDATE), so nothing signed before this could ever be repaired —
  //     which is why it is fixed the moment it was found rather than filed. Found by task 14.40
  //     while building the certificate that has been rendering `mark_image: null` for every
  //     signature, permanently.
  markImage = null,
}) {
  if (!ASSIGNEES.includes(role)) {
    throw invalid(
      `role must name a real party — one of ${ASSIGNEES.join(", ")}. There is no default: a signature ` +
      `recorded under the wrong party's name is how a tech client ends up labelled as a person in recovery.`);
  }
  if (role === "both") {
    throw invalid("'both' describes who MAY act, not who DID — name the party that actually signed");
  }
  // ★★ A SIGNATURE ATTRIBUTABLE TO NOBODY IS NOT EVIDENCE. `signerUid` may legitimately be absent (an
  //    in-person signing on shared staff hardware, by someone with no account yet) but a NAME may not.
  if (typeof signerName !== "string" || !signerName.trim()) {
    throw invalid(
      "a signature needs the signer's NAME. `signerUid` may be null for an in-person signing on shared " +
      "hardware, but a signature attributable to nobody at all is not evidence of anything — and the " +
      "measured defect this closes is the opposite one: every client signature carried a name and every " +
      "staff signature was anonymous.");
  }
  // ★★★ AND IF IT IS PRESENT IT MUST BE THIS SYSTEM'S OWN PERSON ID, NOT A FIREBASE UID.
  //     [MEASURED 2026-09-14] a caller passed the Firebase uid and the deployed server answered
  //         500 {"kind":"internal","message":"invalid input syntax for type uuid: \"7Y4crT…\""}
  //     — **a 500, quoting a Postgres type name, for a caller's wrong field.** The column is `uuid` and
  //     it references this system's `app_user`, so a Firebase uid can never be right; but the person who
  //     sent it learns only that "we broke", and the response body leaks the storage type.
  //   ★★ The confusion is genuinely easy: both are opaque identifier strings for "the signer", and one
  //      of them is the id the CLIENT SDK hands you. So the message names BOTH the expected shape and
  //      the likely mistake, because "must be a uuid" alone does not tell you what you actually sent.
  if (signerUid !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(signerUid))) {
    throw invalid(
      `signerUid must be this system's own app_user id (a uuid) or null — got ` +
      `${JSON.stringify(signerUid)}. ★ If that looks like a FIREBASE uid, that is the mistake: the ` +
      `column references keystone.app_user, so it needs the person's id here, not their auth provider's. ` +
      `Null is legitimate (an in-person signing on shared hardware); a foreign identifier is not.`,
      { field: "signerUid" });
  }
  // ★ A local date without its zone is a date nobody can place (§B4 STEP 3). Refused as a pair.
  if ((signedLocalDate === null) !== (signerTimezone === null)) {
    throw invalid(
      "signedLocalDate and signerTimezone travel together or not at all — a wall-clock date with no " +
      "zone cannot be placed, and it is the signer's own date that goes on their agreement");
  }

  // ★★★ QUEUE §23.2.4 — THE SIGNING DATE IS NEVER BLANK. Neither signing screen used to send the signer's local date, so `signed_local_date` stayed null and the signed copy read "Signed —".
  //     When a caller sends none, the date is taken from the server's own `signedAt` (below) in the PRACTICE's timezone, and the zone is recorded with it (the pair travels together, as the
  //     table's CHECK demands). A zone the caller does send must be a real IANA zone: an unknown one is refused, not stored.
  const signedAt = new Date();
  if (signerTimezone !== null) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: signerTimezone }); } catch {
      throw invalid(`signerTimezone "${signerTimezone}" is not a time zone — send an IANA name such as America/Los_Angeles`, { field: "signerTimezone" });
    }
  } else {
    const practiceZone = (await (await ports()).brand.get(tx, { tenantId })).timezone || "UTC";
    let zone = practiceZone;
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch { zone = "UTC"; }
    signerTimezone = zone;
    signedLocalDate = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(signedAt);
  }

  // ── WHO IS EXPECTED TO SIGN, AND IN WHAT ORDER ────────────────────────────
  // ★★★ THE ORDER COMES FROM THE SERVER'S OWN VOCABULARY (`SIGNER_CONFIGS` in vocabulary.mjs), read
  //     through the instrument's TYPE. It is not passed in and not re-declared in the front end: a
  //     second declaration of a signing order is a second answer to "who signs next", and P4.10 already
  //     measured what that costs.
  const cur = await tx.query(
    `SELECT i.state, i.builder, t.signer_config, t.key AS type_key
       FROM keystone.document_instance i
       LEFT JOIN keystone.document_type t ON t.id = i.type_id
      WHERE i.id = $1 AND i.archived_at IS NULL`,
    [instanceId]);
  if (cur.rowCount === 0) throw notFound("That document is not in this workspace.");
  const inst = cur.rows[0];
  if (!["sent", "partially_signed"].includes(inst.state)) {
    throw conflict("only a sent or partially signed instance can be signed — an executed or void one cannot (U25)");
  }

  // ★★ AN INSTRUMENT WITH NO TYPE HAS NO DECLARED SIGNING ORDER, and that is refused rather than
  //    guessed. Signing "in whatever order they turn up" is precisely what the order exists to prevent.
  const order = inst.signer_config ? SIGNER_ORDERS[inst.signer_config] : null;
  if (!order) {
    throw invalid(
      `this instrument's type does not declare a signer configuration, so there is no signing order to ` +
      `check against. A signature accepted in an undefined order cannot later be shown to have been in ` +
      `order. Give the type one of: ${Object.keys(SIGNER_ORDERS).join(", ")}.`);
  }
  const position = order.indexOf(role) + 1;
  if (position === 0) {
    // ★★★ THE ROLE MUST BE ONE THE CONFIG NAMES. P15C.7's second red-first.
    throw invalid(
      `${role} is not a party to this instrument: its type "${inst.type_key}" is configured ` +
      `${inst.signer_config}, which names ${order.join(" then ")}. A signature from a party the ` +
      `instrument does not name is not a signature on it.`);
  }

  // ── THE CHAIN, AND THE ORDER, CHECKED HERE TOO ────────────────────────────
  // ★ The tail is read INSIDE this transaction, and the DB trigger re-checks it — so a concurrent
  //   signature cannot produce two rows both claiming to follow the same predecessor.
  const { rows: tail } = await run(tx, db.selectFrom("keystone.signature_record")
    .select(["row_hash", "signer_order"])
    .where("instance_id", "=", instanceId)
    .orderBy("signer_order", "desc")
    .limit(1));
  const prevHash = tail[0]?.row_hash ?? null;

  // ★★★ THE MODULE REFUSES OUT-OF-ORDER TOO, AND THIS WAS A MEASURED GAP — NOT DEFENCE IN DEPTH ADDED
  //     FOR NEATNESS. [EXECUTED] with the DB trigger disabled, a coach signing FIRST on a three-party
  //     instrument **was accepted by this function**: it computed position 3 from the config and
  //     inserted, and only `signature_record_order` stopped it.
  //   ★★ WHICH MEANT THE HTTP BEHAVIOUR WAS WRONG EVEN WITH THE TRIGGER IN PLACE. The trigger raises a
  //      raw Postgres `check_violation`, which is not an AppError — so a coach tapping Sign too early
  //      got a 500 and an error page, instead of a 409 telling them the client has to sign first.
  //      **A correct refusal delivered as a crash is a defect in its own right.**
  //   ★ So: the module owns the MESSAGE, the trigger owns the GUARANTEE. Both, separately.
  const nextPosition = (tail[0]?.signer_order ?? 0) + 1;
  if (position !== nextPosition) {
    const waitingFor = order[nextPosition - 1];
    throw conflict(
      position < nextPosition
        ? `${role} has already signed this instrument.`
        : `${role} signs at position ${position} of ${order.length}, but this instrument is waiting for ` +
          `${waitingFor} at position ${nextPosition}. Signing order is ${order.join(" then ")}. ` +
          `A countersignature before the client's signature is not a countersignature; it is a staff ` +
          `member agreeing with nobody.`,
      { expectedRole: waitingFor, expectedPosition: nextPosition, order });
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE MARK AND ITS DIGEST ARE BOUND HERE, BEFORE THE ROW HASH IS TAKEN.
  //     `row_hash` chains on `markSha256` (see `signatureRowHash`), so a mark whose digest
  //     disagreed with it would be evidence that lies about itself — and `0036`'s
  //     `signature_record_no_update` trigger means it could never be corrected afterwards.
  //   ★★ Three cases, and none of them guesses: a caller that sends only the image gets its digest
  //      DERIVED (`markDigest`, which exists for exactly this — "so screen and record cannot drift
  //      unnoticed"); a caller that sends both must have them AGREE or the signature is refused;
  //      a caller that sends neither, or only a digest, behaves exactly as it did before this
  //      change — which is what keeps every existing caller and pinned test working.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (markImage !== null) {
    if (typeof markImage !== "string"
        || !markImage.startsWith("data:image/png;base64,")
        || markImage.length > 204800) {
      // ★ The same shape `0418:102-105`'s CHECK enforces. Refused here so the person sees a
      //   sentence rather than a constraint violation.
      throw invalid(
        "That signature mark is not a PNG data URL under 200KB. The signing page should send the " +
        "drawn mark exactly as it captured it.", { field: "markImage" });
    }
    const derived = markDigest(markImage);
    if (markSha256 !== null && markSha256 !== derived) {
      throw invalid(
        "The signature mark and its digest do not match. Nothing was recorded — a mark whose " +
        "digest disagrees with it cannot be evidence of anything.", { field: "markSha256" });
    }
    markSha256 = derived;
  }

  const rowHash = signatureRowHash({
    instanceId, role, signerOrder: position, signerUid, signerName: signerName.trim(),
    signedAt, markSha256, prevHash,
  });

  let recordId;
  try {
    const ins = await run(tx, db.insertInto("keystone.signature_record").values({
      tenant_id: tenantId ?? null, instance_id: instanceId ?? null, role: role ?? null,
      signer_order: position ?? null,
      signer_uid: signerUid ?? null, signer_name: signerName.trim() ?? null,
      signed_at: signedAt ?? null, signed_local_date: signedLocalDate ?? null,
      signer_timezone: signerTimezone ?? null, user_agent: userAgent ?? null,
      signer_ip: signerIp ?? null, mark_sha256: markSha256 ?? null,
      prev_hash: prevHash ?? null, row_hash: rowHash ?? null, mark_image: markImage ?? null
    }).returning("id"));
    recordId = ins.rows[0].id;
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      // ★★ ONE SIGNATURE PER PARTY. A re-sign is refused rather than stacked: two rows disagreeing about
      //    when a party signed makes the question unanswerable, which is worse than refusing the second.
      throw conflict(
        `${role} has already signed this instrument. A signature is not re-applied — if it is wrong, ` +
        `void the instrument and issue a new one.`, { field: "role" });
    }
    throw e;
  }

  await markPartySigned(tx, { tenantId, instanceId, role, signerName: signerName.trim(), signerUid });

  // ★ The state moves AFTER the row exists, so there is no window in which the instrument claims a
  //   signature the table cannot produce.
  await run(tx, db.updateTable("keystone.document_instance")
    .set({ state: "partially_signed", updated_at: sql`now()` })
    .where("id", "=", instanceId));


  await emit(tx, {
    tenantId, topic: "documents.document.signed", emittedBy: SECTION,
    subjectType: "document", subjectId: instanceId,
    // ★ FIX ROUND 1, I1 — note this is the SESSION's actor, which may differ from `signerUid` (an
    //   in-person signing recorded by staff on shared hardware has a signer with no session at all).
    actor: userActor(actorUserId),
    // ★★ `signature_record_stored: true` — this field used to be FALSE with a pointer to P15C.7,
    //    because the table did not exist. It is now true, and the payload carries the position and how
    //    many parties are still outstanding, so a consumer need not re-derive the order.
    payload: {
      role, signature_record_stored: true, signature_record_id: recordId,
      signer_order: position, of: order.length,
      remaining_parties: order.slice(position),
      chained: prevHash !== null,
    },
  });
  // ★ QUEUE §23.2.7 — the signer's agreement to sign electronically goes on the timeline at the moment they gave it (the acceptance's own time), once per document.
  if (signerUid) {
    const acc = await tx.query(
      `SELECT accepted_at FROM keystone.esign_disclosure_acceptance WHERE app_user_id = $1 AND withdrawn_at IS NULL AND accepted_at <= $2 ORDER BY accepted_at DESC LIMIT 1`,
      [signerUid, signedAt]);
    if (acc.rowCount > 0) await recordAuditEvent(tx, { tenantId, instanceId, kind: "consented", actorRole: role, occurredAt: acc.rows[0].accepted_at });
  }
  await recordAuditEvent(tx, { tenantId, instanceId, kind: "signed", actorRole: role });
  return {
    id: instanceId, state: "partially_signed", role,
    signatureRecordId: recordId, signerOrder: position, of: order.length,
    remainingParties: order.slice(position),
  };
}

/** Decline — a terminal state that is NOT execution. */
export async function declineInstance(tx, { tenantId, instanceId, role = null, reason = null, actorUserId = null }) {
  if (role !== null && !ASSIGNEES.includes(role)) throw invalid(`role must name a real party or be omitted`);
  // ★ R46 — validated before the state changes, so a refused reason leaves the instance as it was.
  const keptReason = normaliseReason(reason);
  const r = await run(tx, db.updateTable("keystone.document_instance")
    // ★★★ declined_at — ADDED 25 Sep 2026, ON THE MAIN THREAD. `0418:84` added this column, and its
    //     own COMMENT says what it is for: "14.11 — when a signer declined the instrument". This
    //     UPDATE set `state` and nothing else, so the column stayed NULL on every declined row.
    //   ★★ IT ALREADY HAD A READER: task 14.40's `GET /api/documents/:id/decline` returns
    //      `declined_at`, which would have answered `null` for every declined instrument — a
    //      confident wrong answer, the same shape as `gift_card.opened_at` and
    //      `signature_record.mark_image`. Found by 14.34 while building the public decline route.
    //    ★ `state` and `declined_at` are set in ONE statement so they can never disagree: a row
    //      reading 'declined' with no date would be worse than either fact alone.
    .set({ state: "declined", declined_at: sql`now()`, updated_at: sql`now()` })
    .where("id", "=", instanceId)
    .where("state", "in", ["sent", "partially_signed"])
    .where("archived_at", "is", null)
    .returning("builder"));
  if (r.rowCount === 0) throw conflict("only a sent or partially signed instance can be declined");

  const declinedEvent = await emit(tx, {
    tenantId, topic: "documents.document.declined", emittedBy: SECTION,
    subjectType: "document", subjectId: instanceId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★★★ STAGE 3 TASK 3 — `reason` DROPPED. Same ruling as `records/archive.mjs`: why a party
    //   declined is arbitrary free text with no closed enum, so it cannot ride in the payload.
    //   `role` stays — it is validated against the closed `ASSIGNEES` vocabulary a few lines above,
    //   which is exactly the enum shape the payload rule allows.
    payload: { role },
  });
  await recordAuditEvent(tx, { tenantId, instanceId, kind: "declined" });
  // ★★★ FIX ROUND 1, R46 — MOCKUPS: "Declined: reason captured". Kept in `keystone.record_reason`
  //     (0140), same transaction, joined to this event; staff-only reads (F494: session actor only).
  await keepReason(tx, {
    tenantId, eventId: declinedEvent.id, subjectType: "document", subjectId: instanceId,
    kind: "decline", reason: keptReason, createdBy: actorUserId,
  });
  return { id: instanceId, state: "declined" };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ★★★ EXECUTE — §M0 LAW 3. THE SNAPSHOT IS THE POINT, NOT THE STATE CHANGE.
 * ═══════════════════════════════════════════════════════════════════════════
 * An executed instrument must answer, forever, what the customer actually agreed to — so the terms,
 * the price and the disclosure are FROZEN INTO THE ROW rather than referenced. A reference would let a
 * later catalogue edit change the past, which is the same failure §Z4's supersede law prevents one
 * layer down.
 *
 * ★ `executed_shape` CHECK refuses `state='executed'` unless BOTH `template_snapshot` and
 *   `executed_at` are present, so an unsnapshotted execution is unrepresentable.
 *
 * @param priceRef  optional { subjectType, subjectId } — the catalogue entry this instrument prices.
 *                  When given, the price IN FORCE NOW is frozen into the snapshot.
 */
export async function executeInstance(tx, { tenantId, instanceId, priceRef = null, terms = null, actorUserId = null }) {
  const cur = await tx.query(
    `SELECT i.id, i.builder, i.title, i.template_id, i.template_snapshot, i.template_body_snapshot,
            i.state, i.subject_user_id, i.created_by, tpl.creates_subscription_plan_id
       FROM keystone.document_instance i
       LEFT JOIN keystone.document_template tpl ON tpl.id = i.template_id
      WHERE i.id = $1 AND i.archived_at IS NULL`,
    [instanceId]);
  if (cur.rowCount === 0) throw notFound("That document is not in this workspace.");
  const inst = cur.rows[0];
  // ★★ U25 — AN EXECUTED INSTRUMENT IS IMMUTABLE. Re-executing would rewrite `executed_at` and the
  //    snapshot, which is precisely the thing that must never happen to a signed document.
  if (inst.state === "executed") throw conflict("this instrument is already executed and cannot be executed again (U25)");
  if (!["sent", "partially_signed"].includes(inst.state)) {
    throw conflict(`an instrument in state "${inst.state}" cannot be executed`);
  }

  // ── LAW 3 · THE PRICE, from the time-windowed authority ───────────────────
  let priceFrozen = null;
  if (priceRef) {
    // the price in force comes from the host's price authority through the price port
    const current = await (await ports()).price.current(tx, { tenantId, subjectType: priceRef.subjectType, subjectId: priceRef.subjectId });
    const rows = current ? [current] : [];
    if (!rows[0]) {
      // ★★ REFUSE RATHER THAN EXECUTE WITHOUT A PRICE. An instrument that references a catalogue entry
      //    with no price in force would be executed against nothing, and LAW 3 would be unsatisfiable
      //    after the fact — there is no way to recover what it should have said.
      throw invalid(
        `no price is in force for ${priceRef.subjectType} ${priceRef.subjectId}, so this instrument ` +
        `cannot be executed — LAW 3 requires the price to be frozen at execution and it cannot be ` +
        `reconstructed later`);
    }
    priceFrozen = {
      price_id: rows[0].id,
      amount_minor: Number(rows[0].amount_minor),
      currency: rows[0].currency,
      effective_from: rows[0].effective_from,
    };
  }

  // ── LAW 3 · THE SIGNER'S DISCLOSURE ACCEPTANCE ───────────────────────────
  // ★★ READ FROM THE STORE, NOT FROM THE CONSTANT (P15C.10). What gets frozen is what THIS PERSON
  //    accepted, at the version they saw. Quoting today's wording onto an instrument signed under
  //    older wording is the retroactive rewrite the versioning exists to prevent.
  // ★ `subject_user_id` is the consumer signer. An instrument with none — an internal document
  //   countersigned by staff only — legitimately has no acceptance, and the snapshot says so.
  let acceptance = null;
  if (inst.subject_user_id) {
    const { rows } = await run(tx, db.selectFrom("keystone.esign_disclosure_acceptance")
      .select(["version", "text_shown", "accepted_at"])
      .where("tenant_id", "=", tenantId)
      .where("app_user_id", "=", inst.subject_user_id)
      .where("withdrawn_at", "is", null)
      .orderBy("accepted_at", "desc")
      .limit(1));
    acceptance = rows[0] ?? null;
  }

  // ── LAW 3 · THE SNAPSHOT ─────────────────────────────────────────────────
  const snapshot = {
    // ★ `law3_version` so a reader can tell WHICH rules this snapshot was taken under. A snapshot
    //   format that changes silently is a snapshot nobody can interpret in five years.
    law3_version: 1,
    builder: inst.builder,
    title: inst.title,
    template_id: inst.template_id,
    // ★★★ THE BODY FROZEN AT SEND (migration 0053). This line used to read `inst.template_snapshot`,
    //     i.e. it copied the snapshot column into the snapshot's own `template` field — which is null
    //     before execute, always. So the field was ALWAYS null and every executed instrument carried
    //     no terms. [MEASURED 2026-09-14 by the PDF renderer's refusal, the only component that could
    //     notice.] ★ `?? null` is kept deliberately: a FORM instrument whose fields live elsewhere
    //     legitimately has no frozen body, and the renderer is the right place to refuse a CONTRACT
    //     that has none — not this writer, which would break the form path.
    template: inst.template_body_snapshot ?? null,
    terms: terms ?? null,
    price: priceFrozen,
    // ★★★ THE DISCLOSURE, CAPTURED — P15C.0 / P15C.10 CLOSED THIS.
    //     This field used to read `status: "NO_STORE"` because §M0 LAW 3's third element had no
    //     source at all. **The ESIGN/UETA-verified text and its version came with the esign port**
    //     (`./disclosure.mjs`, ported from shared/esign/electronicRecordsDisclosure.tsx), so the whole
    //     text and `ERSD_VERSION` are now frozen into the instrument.
    //   ★★ THE WHOLE TEXT, not a hash and not a URL: a hash cannot be read back to a person, and a
    //      URL is a promise about the future rather than a record of the past. An instrument has to be
    //      readable on its own terms years later.
    //   ★ `disclosureSnapshot()` THROWS for a tenant the wording is not verified for (D-15C.0a) — the
    //     text names one practice, and freezing another practice's name into a signed instrument would
    //     be worse than refusing to execute.
    disclosure: disclosureSnapshotFromAcceptance(acceptance, {
      // ★ The consumer signer IS `subject_user_id`. Passed explicitly because the snapshot writer has
      //   no safe default for it — see the throw in disclosure.mjs.
      hasConsumerSigner: inst.subject_user_id !== null,
    }),
  };

  // ── F07 · THE SUBSCRIPTION PLAN, IF THIS AGREEMENT CREATES ONE ─────────────
  // ★ If the template is configured to start a subscription when this instrument is executed,
  //   capture the plan id in the snapshot so the subscription can be triggered after execution.
  if (inst.creates_subscription_plan_id) {
    snapshot.creates_subscription_plan_id = inst.creates_subscription_plan_id;
  }

  // ★★★ P15C.3 — THE SNAPSHOT IS VALIDATED BEFORE IT IS FROZEN, AND THE REFUSAL STOPS THE EXECUTION.
  //     [MEASURED at 0009:159] the column's only constraint was `IS NOT NULL`, so **an empty object
  //     satisfied it** — "the snapshot is present" and "the snapshot says anything" are different
  //     claims and only the first was ever checked.
  //   ★★ A half-built snapshot cannot be completed after the fact: the price in force, the text the
  //      signer saw and the moment they saw it are all gone by the time anybody notices. **Refusing the
  //      execution is recoverable. A signed instrument with an unreadable snapshot is not.**
  parseTemplateSnapshot(snapshot);

  const r = await run(tx, db.updateTable("keystone.document_instance")
    .set({ state: "executed", executed_at: sql`now()`, template_snapshot: JSON.stringify(snapshot) ?? null, updated_at: sql`now()` })
    .where("id", "=", instanceId)
    .where("state", "in", ["sent", "partially_signed"])
    .where("archived_at", "is", null)
    .returning("executed_at"));
  // ★ Zero rows here means the state moved between the SELECT and the UPDATE — a concurrent execute.
  //   Refusing is correct; the other transaction's snapshot stands.
  if (r.rowCount === 0) throw conflict("the instrument changed state while it was being executed — nothing was written");

  // ── F07 · THE SUBSCRIPTION TRIGGER IS ANNOUNCED, NEVER CALLED DIRECTLY ────
  // ★★★ DOCUSTAY WALL FIX (recon+build round, 29 Sep 2026) — this used to import
  //   `startClientSubscription` from `../money/subscriptions.mjs` and call it right here, synchronously,
  //   inside the execute transaction: a document-package file reaching directly into the money domain,
  //   exactly the crossing the maintainer's Docustay ruling refuses. Documents now does its ONE job — state what
  //   happened — and a queue listener OUTSIDE this package decides what that means for billing.
  //   `queue/tasks.mjs` pushes `LISTENER.START_SUBSCRIPTION` onto this SAME topic (reusing its own
  //   idempotency-checked handler, written for exactly this shape) whenever the event's payload names a
  //   plan — see that file's own comment beside the push. If Stripe charges are off, the subscription
  //   row still gets created (honest state) by that listener; only the Stripe push is deferred, same as
  //   before. The one behavior change, disclosed: the subscription now starts one queue tick after
  //   execution instead of in the same transaction — the real cost of the wall holding for real.
  const startsSubscription = Boolean(snapshot.creates_subscription_plan_id && inst.subject_user_id);

  // ── 17.13 · RECORD THE ESIGN USAGE IF THIS INSTRUMENT WAS SIGNED ──────────
  // ★★ Only instruments with ≥1 signature are metered. An unsigned instrument that is executed
  //    (e.g., an internal staff agreement) is not counted.
  const signatureCount = await tx.query(
    `SELECT COUNT(*) as count FROM keystone.signature_record WHERE instance_id = $1`,
    [instanceId]);
  if (signatureCount.rows[0].count > 0) {
    await (await ports()).usage.recordEsign(tx, { tenantId, instanceId });
  }

  await emit(tx, {
    tenantId, topic: "documents.document.executed", emittedBy: SECTION,
    subjectType: "document", subjectId: instanceId,
    // ★ STAGE 3 TASK 1 — same fact as payload's `executed_by` below, now also on the envelope.
    actor: userActor(actorUserId),
    payload: {
      builder: inst.builder,
      executed_at: r.rows[0].executed_at,
      // ★★★ WHO EXECUTED IT — AND THIS IS LOAD-BEARING, NOT DECORATION. [MEASURED 2026-09-14]
      //     `keystone.event` has NO actor column, and `document_instance`'s SELECT policy is
      //     `tenant_id = current_tenant_id() AND document_is_visible(...)`, where
      //     `document_is_visible` FAILS CLOSED on a null `current_user_id()` — by design, and its own
      //     comment says so: *"No acting user means no documents — not 'all of them'."*
      //   ★★ So the outbox worker, which has a tenant but deliberately NO viewer, could not read the
      //      instrument it had just been told to archive. The archive job failed
      //      `no document instance … is visible here` five times and retried. **The guard was right and
      //      the consumer was wrong**: a background job that needs to read a document has to name the
      //      human whose act caused it, not read as nobody and not be exempted from the policy.
      //   ★ Recording it here also means the audit feed answers "who executed this instrument" without
      //     a join, which it previously could not answer at all.
      executed_by: actorUserId,
      // ★ FIX, 30 Sep 2026 (worker-failures brief) — MEASURED live: the public sign-by-email-link
      //   path (src/routes/documentsPublic.mjs) passes the SIGNER as `actorUserId` — correct for
      //   `executed_by`'s own audit purpose above, but the signer is very often a CLIENT, and
      //   `archive_document_pdf` (src/queue/tasks.mjs) refuses any non-staff actor by design (its
      //   own comment: a client actor would render the instrument through narrower filters and
      //   silently archive less than it contains). That refusal was firing on every client-signed
      //   document — exactly the missing signed-copy email the maintainer reported. `created_by` is the
      //   document's own staff author — `document_is_visible()`'s writer disjunct reads it
      //   directly (migration 0194) — so it is guaranteed both STAFF and VISIBLE, unlike
      //   `executed_by`. A separate field, not a repurposing of `executed_by`: that field's own
      //   audit meaning ("who executed this instrument") stays intact.
      archive_actor_id: inst.created_by ?? actorUserId,
      // ★ The event states the snapshot's completeness so a consumer — or an auditor reading the feed
      //   rather than the row — learns about the disclosure gap without opening the JSON.
      price_frozen: priceFrozen !== null,
      disclosure_captured: acceptance !== null,
      disclosure_version: acceptance?.version ?? null,
      // ★★ `law3_complete` is now TRUE only when all three elements are present: the terms, the
      //    disclosure, and a price when one was referenced. It is COMPUTED, not asserted — an
      //    instrument executed with no priceRef is legitimately complete without a price, and saying
      //    otherwise would make the flag meaningless. An instrument with a consumer signer and NO
      //    acceptance is NOT complete, and the flag has to say that — it is the one case a reader
      //    actually needs to find.
      law3_complete: (inst.subject_user_id === null || acceptance !== null),
      // ★ DOCUSTAY WALL FIX — the subscription-start signal, for LISTENER.START_SUBSCRIPTION
      //   (queue/tasks.mjs) to act on OUTSIDE this package. Field names match that listener's own
      //   `ev.payload` destructuring exactly (it already serves money.subscription.start_failed's
      //   retry with this same shape) so the one handler runs unchanged for either topic. `null` on
      //   every field when this instrument creates no subscription — the listener's own
      //   `if (!planId || !appUserId) return { skipped: ... }` guard makes that a safe no-op.
      planId: startsSubscription ? snapshot.creates_subscription_plan_id : null,
      appUserId: startsSubscription ? inst.subject_user_id : null,
      contractId: startsSubscription ? instanceId : null,
      createdByDocumentId: startsSubscription ? instanceId : null,
    },
  });
  await recordAuditEvent(tx, { tenantId, instanceId, kind: "executed" });
  return { id: instanceId, state: "executed", executed_at: r.rows[0].executed_at, snapshot };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ★★★ 14.33 — ONE EXECUTE PATH FOR EVERY SIGNER.
 * ═══════════════════════════════════════════════════════════════════════════
 * Whoever signs last — a real client session (the B1.1 route), a public sign-link token (14.34),
 * or staff signing on behalf — reaches `executed` through this ONE helper. The defect this
 * replaces is per-caller execute logic that drifts: `app.mjs`'s B1.1 route used to inline its own
 * count-the-signatures-and-compare arithmetic, and every new caller was one more place that same
 * arithmetic could be copied slightly wrong.
 *
 * ★★ COMPLETE MEANS EVERY REQUIRED SIGNER, NOT "AT LEAST ONE" — driven off the instrument's OWN
 *    declared `SIGNER_ORDERS[signer_config]` (the twelve-entry `SIGNER_CONFIGS` in vocabulary.mjs,
 *    the same vocabulary `recordSignature` above checks the signing ORDER against), never off a
 *    bare count. `CLIENT_AND_PARENT` needs both a client signature and a parent signature; this
 *    asks "does the signature count equal THIS instrument's own party count", never "is there at
 *    least one".
 *
 * ★★★ IDEMPOTENCY — DOUBLE-EXECUTE IS IMPOSSIBLE. This function's own count check is read outside
 *    any lock, so two signers completing the set at the same moment (or a retried/redelivered
 *    call) can both see "complete" and both call `executeInstance`. What makes only one of them
 *    actually execute is `executeInstance`'s own conditional `UPDATE … WHERE id = $1 AND state IN
 *    ('sent','partially_signed') AND archived_at IS NULL` above (`:847-850`): the loser's UPDATE
 *    affects 0 rows, and `executeInstance` reads that as a fact — "the instrument changed state
 *    while it was being executed" — and throws `conflict(...)` rather than silently re-executing
 *    or overwriting the winner's snapshot (U25 backs the same guarantee for a caller who somehow
 *    reaches this after the instrument is already `executed`). Exactly one execution, ever; the
 *    other caller's 409 is a fact to read, not an error to swallow.
 *
 * ★ LAW 3's price freeze rides through unchanged: `priceRef` is resolved here from the TEMPLATE's
 *   own `sells_type`/`sells_id` (never from the caller) and handed to `executeInstance`, which
 *   reads the price IN FORCE NOW and freezes it — see `executeInstance`'s own LAW 3 · THE PRICE
 *   section above.
 */
export async function executeIfComplete(tx, { tenantId, instanceId, actorUserId = null }) {
  const { rows: [inst] } = await tx.query(
    `SELECT i.state, dt.signer_config, tpl.sells_type, tpl.sells_id
       FROM keystone.document_instance i
       LEFT JOIN keystone.document_type dt ON dt.id = i.type_id
       LEFT JOIN keystone.document_template tpl ON tpl.id = i.template_id
      WHERE i.id = $1 AND i.archived_at IS NULL`,
    [instanceId]);
  if (!inst) throw notFound("That document is not in this workspace.");

  // ★★ NO DECLARED SIGNER CONFIGURATION MEANS NO WAY TO SAY "COMPLETE" — see `recordSignature`'s
  //    own refusal above for the same reason. `recordSignature` refuses to record a signature at
  //    all under a missing config, so in practice this is never reached without one; if it ever
  //    is, it is simply never complete, not a crash.
  const order = inst.signer_config ? SIGNER_ORDERS[inst.signer_config] : null;

  const { rows: [sig] } = await tx.query(
    `SELECT count(*)::int AS count FROM keystone.signature_record WHERE instance_id = $1`,
    [instanceId]);
  const sigCount = sig?.count ?? 0;

  if (!order || sigCount !== order.length) {
    return { id: instanceId, state: "partially_signed" };
  }

  const priceRef = (inst.sells_type && inst.sells_type !== "none")
    ? { subjectType: inst.sells_type, subjectId: inst.sells_id }
    : null;

  return executeInstance(tx, { tenantId, instanceId, priceRef, actorUserId });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P15C.10 — THE ELECTRONIC-RECORDS DISCLOSURE: ACCEPTING IT, AND WITHDRAWING IT.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★ `executeInstance` above READS an acceptance. These two are what put one there. Without them the
//    store is a table nothing writes — a feature that cannot happen, indistinguishable from a working
//    one until a client actually tries to sign. (That is exactly what `db/gates/write-census.mjs`
//    exists to refuse, and it would have failed on this table.)

/**
 * Record that a person accepted the electronic-records disclosure, AT THE VERSION THEY WERE SHOWN.
 *
 * ★★★ THE TEXT IS AN ARGUMENT, NOT A CONSTANT READ IN HERE. The caller is the surface that actually
 *     rendered it, and only the surface knows what was on the screen. A writer that substituted
 *     today's constant would record a consent to wording the person may never have seen — and since
 *     `executeInstance` freezes this row onto instruments, that error is permanent and invisible.
 *
 * ★★ RE-ACCEPTING THE SAME VERSION IS THE SAME FACT, not a second one. `ON CONFLICT DO NOTHING`
 *    against `esign_acceptance_person_version`, so a double tap cannot produce two answers to "when
 *    did they agree" — and cannot move the first `accepted_at`, which is evidence.
 *
 * @param version the disclosure version shown, e.g. the module's ERSD_VERSION
 * @param textShown the exact text object rendered to them
 */
export async function acceptDisclosure(tx, {
  tenantId, appUserId, version, textShown, userAgent = null, acceptedIp = null, actorUserId = null,
}) {
  if (!appUserId) throw invalid("an acceptance belongs to a PERSON — appUserId is required");
  if (typeof version !== "string" || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(version)) {
    throw invalid(
      `version must be a dated disclosure version like the module's own ERSD_VERSION — got ` +
      `${JSON.stringify(version)}. A boolean "accepted" with no version points at whatever the file ` +
      `says today, which is the defect versioning exists to prevent.`);
  }
  if (!textShown || typeof textShown !== "object") {
    throw invalid(
      "textShown is required and must be the text object actually rendered to this person. Recording " +
      "a version with no text would leave the consent unreadable without the code that produced it.");
  }

  const r = await tx.query(
    `INSERT INTO keystone.esign_disclosure_acceptance
       (tenant_id, app_user_id, version, text_shown, user_agent, accepted_ip)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (tenant_id, app_user_id, version) DO NOTHING
     RETURNING id, accepted_at`,
    [tenantId, appUserId, version, JSON.stringify(textShown), userAgent, acceptedIp]);

  // ★ A no-op conflict is reported as `already: true` rather than as an error. The person did accept;
  //   asking them again and calling it a failure would be wrong about the world.
  if (r.rowCount === 0) {
    const cur = await run(tx, db.selectFrom("keystone.esign_disclosure_acceptance")
      .select(["id", "accepted_at"])
      .where("tenant_id", "=", tenantId)
      .where("app_user_id", "=", appUserId)
      .where("version", "=", version));
    return { id: cur.rows[0].id, version, accepted_at: cur.rows[0].accepted_at, already: true };
  }

  await emit(tx, {
    tenantId, topic: "documents.disclosure.accepted", emittedBy: SECTION,
    subjectType: "person", subjectId: appUserId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ The VERSION goes in the payload and the text does NOT: the text is already frozen in the row
    //   and on every instrument that quotes it, and an outbox payload is not the place for a page of
    //   statutory prose that would be duplicated on every webhook delivery.
    payload: { version, is_current: version === ERSD_VERSION },
  });
  return { id: r.rows[0].id, version, accepted_at: r.rows[0].accepted_at, already: false };
}

/**
 * Withdraw a live acceptance — 15 U.S.C. 7001(c)(1) element (b), which makes this a RIGHT.
 *
 * ★★★ A WITHDRAWAL ENDS AN ACCEPTANCE AND DELETES NOTHING. Instruments executed while it was live
 *     quote it and stay correct: "withdrawing consent does not affect the validity of records
 *     provided before the withdrawal" has to be true IN THE DATA, not only in the copy. The DELETE
 *     trigger on the table refuses the other reading outright.
 * ★★ `withdrawn_at IS NULL` IS IN THE PREDICATE, so a second withdrawal matches zero rows and is
 *    refused — a withdrawal date cannot be moved after the fact.
 */
export async function withdrawDisclosure(tx, { tenantId, appUserId, version = null, actorUserId = null }) {
  if (!appUserId) throw invalid("a withdrawal belongs to a PERSON — appUserId is required");
  const r = await tx.query(
    `UPDATE keystone.esign_disclosure_acceptance
        SET withdrawn_at = now()
      WHERE tenant_id = $1 AND app_user_id = $2 AND withdrawn_at IS NULL
        AND ($3::text IS NULL OR version = $3)
      RETURNING id, version, withdrawn_at`,
    [tenantId, appUserId, version]);
  if (r.rowCount === 0) {
    throw conflict(
      "there is no live electronic-records disclosure acceptance to withdraw for this person" +
      (version ? ` at version ${version}` : "") +
      " — either none was ever recorded, or it was already withdrawn (a withdrawal cannot be moved)");
  }

  await emit(tx, {
    tenantId, topic: "documents.disclosure.withdrawn", emittedBy: SECTION,
    subjectType: "person", subjectId: appUserId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★★ `instruments_already_executed_remain_valid` is stated in the event on purpose. The next
    //    reader of this feed — a consumer building a compliance view, or a person in six months —
    //    must not infer that a withdrawal unwound anything that was already signed.
    payload: {
      versions_withdrawn: r.rows.map((x) => x.version),
      withdrawn_at: r.rows[0].withdrawn_at,
      instruments_already_executed_remain_valid: true,
    },
  });
  return { withdrawn: r.rowCount, versions: r.rows.map((x) => x.version) };
}
