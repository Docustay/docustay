// Stage 18 task 18.8 & 18.8b — CT-F14 permission boundary: note bodies never leave the server
// for an operator principal.
//
// ★★★ TWO EXPORTS, TWO JOBS, TWO REASONS FOR THE SPLIT.
// · assertNoNoteFields (18.8) THROWS if a query result carries any note column (template_snapshot,
//   body, template_body_snapshot, notes, etc.). This is the safeguard against a stray query that
//   should never have existed; it HALTS the request.
// · nullNoteBodies (18.8b) NULLS the payload keys a serialiser would produce, wrapping them with
//   NOTE_WITHHELD_SENTENCE. This is the second layer: if a query mistakenly did fetch a body, it
//   never leaves the API — but the first job is to never query it in the first place.
//
// The lists are deliberately DISJOINT (18.8b field 4, the comment at line 1785). Identical lists
// would make one of them dead code and a later editor would remove it thinking it was a dupe.

import { internal } from "../http/errors.mjs";
import { DOCUMENTS_DOMAIN } from "../documents/frontDoor.mjs";

/**
 * 18.8 HALF: Column names that should NEVER appear in a database query result for an operator.
 * If any query mistakenly selects one, assertNoNoteFields will throw and halt the request.
 * Query result columns: notes, template_snapshot, template_body_snapshot, body, etc.
 */
const NOTE_FIELD_NAMES = Object.freeze([
  "notes",
  "note",
  "body",
  "private_note",
  "template_body_snapshot",
  ...DOCUMENTS_DOMAIN.redactColumns,   // a document's frozen body — declared by Documents
  "note_body"
]);

/**
 * 18.8b HALF: Payload keys a serialiser would produce. If a JSON object at any depth carries one
 * of these keys, nullNoteBodies sets it to null and adds note_body_withheld with the sentence.
 * Payload keys: template, variables, snapshot.
 */
const NOTE_BODY_KEYS = Object.freeze(["template", "variables", "snapshot"]);

const NOTE_WITHHELD_SENTENCE =
  "Session notes are never readable on any access level. They are between a coach and a client.";

/**
 * 18.8 GUARD: Walk the payload; throw if any own key at any depth is in NOTE_FIELD_NAMES.
 * This is the query-side guard — if a SELECT mistakenly includes a note column, this throws.
 * Used by 18.8 and 18.11 and 18.16 platform routes to prove their queries never fetched bodies.
 *
 * @param {*} payload - any JSON-serializable value
 * @returns {*} the payload unchanged
 * @throws {AppError} if any key in NOTE_FIELD_NAMES is found at any depth
 */
export function assertNoNoteFields(payload) {
  function walk(obj, path = "") {
    if (obj === null || obj === undefined) return;
    if (typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        walk(obj[i], `${path}[${i}]`);
      }
    } else {
      for (const [key, value] of Object.entries(obj)) {
        if (NOTE_FIELD_NAMES.includes(key)) {
          throw internal(`a support-view payload carried a note field: ${key}`);
        }
        walk(value, `${path}.${key}`);
      }
    }
  }

  walk(payload);
  return payload;
}

/**
 * 18.8b SERIALISATION GUARD: Return a copy with every NOTE_BODY_KEYS key at any depth set to null,
 * plus one added key note_body_withheld with the F13 sentence. This is the serialisation-side
 * guard — if a body somehow made it into the payload, it does not reach the client.
 * Pure function; takes no principal argument (the predicate is the CALL SITE, supplied by the
 * application).
 *
 * @param {*} payload - any JSON-serializable value
 * @returns {*} a deep copy with NOTE_BODY_KEYS nulled and note_body_withheld added at the top level
 */
export function nullNoteBodies(payload) {
  function walk(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
      return obj.map(walk);
    } else {
      const copy = {};
      for (const [key, value] of Object.entries(obj)) {
        if (NOTE_BODY_KEYS.includes(key)) {
          copy[key] = null;
        } else {
          copy[key] = walk(value);
        }
      }
      return copy;
    }
  }

  const result = walk(payload);
  if (typeof result === "object" && !Array.isArray(result)) {
    result.note_body_withheld = NOTE_WITHHELD_SENTENCE;
  }
  return result;
}
