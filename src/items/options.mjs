// @ts-check
// Stage 14 task 14.18 — BOOKING OPTIONS (questions asked at booking).
//
// A booking option is a `keystone.custom_field` row with `record_type = 'engagement'`. There is no
// `booking_option` table: 0079 already gives that record type a home, and 0412 (task 14.5) added the
// four columns booking needs — `required`, `show_if`, `applies_to_service_ids`, `feeds_reports` —
// with a CHECK that confines them to `engagement` rows. The ANSWERS to these questions live in
// `keystone.custom_field_value` (also 0079, untouched by 0412) with `record_id` = the booking id —
// deliberately not touched by this module either; who writes an answer is a booking-time write, not
// an options-CRUD write. This file is the question definition only: list/create/update/activate.
//
// ★★★ THE BLOCKED LIST NEVER LEAVES THE PLATFORM. A booking option's ANSWER is client data exactly
//     like any other custom field value, and this module never reads `custom_field_value.value` for
//     anything but a COUNT (`listOptions` below) — the answer content itself is never returned,
//     logged, or put in an event payload here.
//
// ★★★ "REQUIRED" IS STORED HERE, NOT ENFORCED HERE. `required`/`show_if`/`applies_to_service_ids` are
//     columns on the QUESTION (this module). The route that must REFUSE a booking submitted without a
//     required answer is the booking/answer write path — task 14.79 per the plan's own CALLERS line —
//     which is NOT in this task's file list. Reported in the task summary: this module makes the
//     setting real and readable; 14.79 owes the enforcement.
//
// ★ `src/fields/*` (the PERSON field layer) is untouched — its one INSERT names its own eight
//   columns explicitly (0412's header) and never touches the four columns this module writes.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "items";
const UNIQUE_VIOLATION = "23505";
const RECORD_TYPE = "engagement";

// ★ API-facing kind vocabulary (field 4: `kind:'choice'|'text'`), mapped to 0079's
//   `custom_field_kind_check` ('select'↔'choice' / 'text'↔'text' — the plan's own arrow notation).
const OPTION_KINDS = Object.freeze(["choice", "text"]);
const toDbKind = (kind) => (kind === "choice" ? "select" : "text");
const fromDbKind = (dbKind) => (dbKind === "select" ? "choice" : "text");

/** ★ 0079's `custom_field_key_shape` CHECK: `key ~ '^[a-z][a-z0-9_]*$'`. */
function slugifyQuestionKey(question) {
  const stripped = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!stripped) return "question";
  return /^[a-z]/.test(stripped) ? stripped : `q_${stripped}`;
}

function normaliseChoices(choices) {
  if (!Array.isArray(choices)) return [];
  return choices.map((c) => String(c).trim()).filter((c) => c.length > 0);
}

/**
 * ★ Shared by createOption and updateOption: 0079's `custom_field_options_shape` CHECK says a
 *   `select` field needs at least one option and any other kind needs none. Validated here, in JS,
 *   rather than left to the DB CHECK — `toAppError` (`src/http/errors.mjs`) has no mapping for a
 *   Postgres 23514 (check_violation), so letting the DB refuse this would surface as a 500, not the
 *   400 field 8 asks for. The sentence matches the CHECK's own meaning: "A choice needs at least one
 *   answer."
 */
function shapeOptions(dbKind, choices) {
  if (dbKind === "select") {
    const options = normaliseChoices(choices);
    if (options.length === 0) throw invalid("A choice needs at least one answer.");
    return options;
  }
  return [];
}

function normaliseServiceIds(serviceIds) {
  if (serviceIds === undefined || serviceIds === null) return null;
  if (!Array.isArray(serviceIds) || serviceIds.some((s) => typeof s !== "string" || !s)) {
    throw invalid("serviceIds must be an array of service ids");
  }
  return serviceIds.length > 0 ? serviceIds : null;
}

function normaliseShowIf(showIf) {
  if (showIf === undefined || showIf === null) return null;
  if (typeof showIf !== "object" || Array.isArray(showIf)) {
    throw invalid("showIf must be a JSON object");
  }
  return showIf;
}

/**
 * Options, with answered/skipped counts — the "a third of people skip it" honesty note (field 4).
 * `eligible` is confirmed/completed bookings in the last 90 days whose service is in scope for the
 * option (`applies_to_service_ids IS NULL` = every service); `answered` is how many of those have a
 * `custom_field_value` row (`record_id` = the booking id); `skipped` is the remainder. Only a COUNT
 * of `custom_field_value` is read — never its `value` column (the blocked-list rule, this file's
 * header).
 */
export async function listOptions(tx, { tenantId }) {
  const { rows } = await tx.query(
    `SELECT cf.id, cf.key, cf.label, cf.kind, cf.options, cf.required,
            cf.applies_to_service_ids, cf.show_if, cf.feeds_reports, cf.active, cf.position,
            count(DISTINCT b.id) AS eligible_bookings,
            count(DISTINCT cv.record_id) AS answered_bookings
       FROM keystone.custom_field cf
       LEFT JOIN keystone.booking b
         ON b.tenant_id = cf.tenant_id
        AND b.state IN ('confirmed','completed')
        AND b.starts_at >= now() - interval '90 days'
        AND (cf.applies_to_service_ids IS NULL OR b.service_id = ANY(cf.applies_to_service_ids))
       LEFT JOIN keystone.custom_field_value cv
         ON cv.tenant_id = cf.tenant_id AND cv.field_id = cf.id AND cv.record_id = b.id
      WHERE cf.tenant_id = $1 AND cf.record_type = $2
      GROUP BY cf.id, cf.key, cf.label, cf.kind, cf.options, cf.required,
               cf.applies_to_service_ids, cf.show_if, cf.feeds_reports, cf.active, cf.position
      ORDER BY cf.position, cf.label`,
    [tenantId, RECORD_TYPE]);
  return rows.map((r) => {
    const eligible = Number(r.eligible_bookings);
    const answered = Number(r.answered_bookings);
    return {
      id: r.id, key: r.key, question: r.label, kind: fromDbKind(r.kind),
      choices: r.options, required: r.required, serviceIds: r.applies_to_service_ids,
      showIf: r.show_if, feedsReports: r.feeds_reports, active: r.active, position: r.position,
      answered, skipped: Math.max(eligible - answered, 0),
    };
  });
}

/**
 * Create a booking option. `key` is derived from `question` (0079's `custom_field_key_shape`) and
 * de-duplicated per tenant with a numeric suffix (field 4: "unique per tenant; suffix `_2…` on
 * clash") — same idiom `src/items/catalogue.mjs`'s `createUnit` uses for its own key.
 */
export async function createOption(tx, {
  tenantId, question, kind, choices, required = false,
  serviceIds = null, showIf = null, feedsReports = false, actorUserId = null,
}) {
  if (typeof question !== "string" || !question.trim()) throw invalid("a question needs a question");
  if (!OPTION_KINDS.includes(kind)) {
    throw invalid(`kind must be one of ${OPTION_KINDS.join(", ")} — got ${JSON.stringify(kind)}`);
  }
  if (typeof required !== "boolean") throw invalid("required must be a boolean");
  if (typeof feedsReports !== "boolean") throw invalid("feedsReports must be a boolean");

  const label = question.trim();
  const dbKind = toDbKind(kind);
  const options = shapeOptions(dbKind, choices);
  const normalisedServiceIds = normaliseServiceIds(serviceIds);
  const normalisedShowIf = normaliseShowIf(showIf);

  const base = slugifyQuestionKey(label);
  const { rows: clashes } = await tx.query(
    `SELECT key FROM keystone.custom_field WHERE tenant_id = $1 AND record_type = $2 AND (key = $3 OR key ~ $4)`,
    [tenantId, RECORD_TYPE, base, `^${base}_[0-9]+$`]);
  const existingKeys = new Set(clashes.map((r) => r.key));
  let key = base;
  if (existingKeys.has(key)) {
    let n = 2;
    while (existingKeys.has(`${base}_${n}`)) n++;
    key = `${base}_${n}`;
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db.insertInto("keystone.custom_field").values({
      id: id ?? null,
      tenant_id: tenantId ?? null,
      record_type: RECORD_TYPE ?? null,
      key: key ?? null,
      label: label ?? null,
      kind: dbKind ?? null,
      options: options ?? null,
      required: required ?? null,
      applies_to_service_ids: normalisedServiceIds ?? null,
      show_if: normalisedShowIf ?? null,
      feeds_reports: feedsReports ?? null,
      created_by: actorUserId ?? null,
    }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(`You already have a question called ${label}.`, { field: "question" });
    }
    throw e;
  }

  // ★ 14.15 registers `items.option.created` in `src/events/topics.mjs`'s `items` array — not landed
  //   on disk as of this task (MEASURED: 0 hits for "items.option" in topics.mjs today, same gap
  //   `src/items/catalogue.mjs`'s `createCategory` already reports for `items.category.created`).
  //   Field 10 names 14.15 as a dependency; until it lands, `emit()`'s closed-catalogue check refuses
  //   this topic with a `TopicViolation`.
  await emit(tx, {
    tenantId, topic: "items.option.created", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id, key, kind, required, feedsReports },
  });

  return {
    id, key, question: label, kind, choices: options, required,
    serviceIds: normalisedServiceIds, showIf: normalisedShowIf, feedsReports, active: true,
  };
}

/**
 * Partial update. `key` never changes after creation — 0079's own split ("code and stored values key
 * on `key`; the practice renames `label` freely", `db/migrations/0079_field_layers.sql:36-37`)
 * applies here exactly as it does to `role`/`team`. Kind and choices are read-modify-write together
 * (never independently) so `custom_field_options_shape` is satisfied for any combination the caller
 * sends — e.g. sending `choices` alone while the row is already `kind:'choice'` must still pass the
 * CHECK against the MERGED row, not a half-updated one.
 */
export async function updateOption(tx, {
  tenantId, id, question, kind, choices, required, serviceIds, showIf, feedsReports,
}) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.custom_field")
    .select(["label", "kind", "options", "required", "applies_to_service_ids", "show_if", "feeds_reports"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("record_type", "=", RECORD_TYPE));
  if (rows.length === 0) throw notFound("no such option in this organisation");
  const current = rows[0];

  let nextLabel = current.label;
  if (question !== undefined) {
    if (typeof question !== "string" || !question.trim()) throw invalid("a question cannot be blank");
    nextLabel = question.trim();
  }

  let nextApiKind = fromDbKind(current.kind);
  if (kind !== undefined) {
    if (!OPTION_KINDS.includes(kind)) {
      throw invalid(`kind must be one of ${OPTION_KINDS.join(", ")} — got ${JSON.stringify(kind)}`);
    }
    nextApiKind = kind;
  }
  const nextDbKind = toDbKind(nextApiKind);
  const nextOptions = shapeOptions(nextDbKind, choices !== undefined ? choices : current.options);

  let nextRequired = current.required;
  if (required !== undefined) {
    if (typeof required !== "boolean") throw invalid("required must be a boolean");
    nextRequired = required;
  }
  let nextFeedsReports = current.feeds_reports;
  if (feedsReports !== undefined) {
    if (typeof feedsReports !== "boolean") throw invalid("feedsReports must be a boolean");
    nextFeedsReports = feedsReports;
  }
  const nextServiceIds = serviceIds !== undefined ? normaliseServiceIds(serviceIds) : current.applies_to_service_ids;
  const nextShowIf = showIf !== undefined ? normaliseShowIf(showIf) : current.show_if;

  const r = await run(tx, db
    .updateTable("keystone.custom_field")
    .set({
      label: nextLabel ?? null,
      kind: nextDbKind ?? null,
      options: nextOptions ?? null,
      required: nextRequired ?? null,
      applies_to_service_ids: nextServiceIds ?? null,
      show_if: nextShowIf ?? null,
      feeds_reports: nextFeedsReports ?? null,
      updated_at: sql`now()`,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("record_type", "=", RECORD_TYPE));
  if (r.rowCount === 0) throw notFound("no such option in this organisation");

  return {
    id, question: nextLabel, kind: nextApiKind, choices: nextOptions, required: nextRequired,
    serviceIds: nextServiceIds, showIf: nextShowIf, feedsReports: nextFeedsReports,
  };
}

/** Turn a booking option on or off. */
export async function setOptionActive(tx, { tenantId, id, active }) {
  if (typeof active !== "boolean") throw invalid("active must be a boolean");
  const r = await run(tx, db
    .updateTable("keystone.custom_field")
    .set({
      active: active ?? null,
      updated_at: sql`now()`,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("record_type", "=", RECORD_TYPE));
  if (r.rowCount === 0) throw notFound("no such option in this organisation");
  return { id, active };
}
