// @ts-check
// C1.9 — REQUIRED FIELDS ARE A PRACTICE SETTING.
//
// ★★★ THE ONE SOURCE OF TRUTH. `requiredFor()` reads the practice setting; `validateRequired()`
//     checks whether a create payload meets the requirements. Both functions are called by the route
//     (server enforcement) and the screen (show asterisks, validation on save).
//
// ★★★ DEFAULTS ARE THE MINIMUM THAT MAKES EACH RECORD USABLE. Person needs a name and a way to
//     reach them (email OR mobile). Account needs a name.

import { getSetting } from "../settings/writes.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE DEFAULTS. Hardcoded, NOT in the setting: when a practice has never set this key, these
//     are the values `requiredFor()` returns, via `getSetting`'s own fallback parameter.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ [TY, RULED 2 Oct 2026] BOTH EMAIL AND PHONE ARE REQUIRED, FOR EVERY PRACTICE, NO EXCEPTIONS
//   — not "one or the other." An earlier version of this comment described an email-OR-mobile
//   rule that the code never actually implemented (a real, confirmed defect — see
//   src/people/writes.mjs's own history on this exact line) and the maintainer's own ruling, once he saw it,
//   was to stop pretending there is a choice at all: a person record needs a name, an email AND a
//   phone number. Both are UNCHANGEABLE (below), not a per-practice setting.
const DEFAULT_REQUIRED_FIELDS = {
  person: ["first_name", "email", "mobile_phone"],
  account: ["name"],
  invoice: [],
  document: [],
  service: [],
  booking: [],
};

// ★ THE UNCHANGEABLE FIELDS. These are the core requirements; a practice cannot turn them off.
//   A person cannot exist without a name, an email, or a phone number (the maintainer's ruling, 2 Oct 2026 —
//   no practice-level switch for this; see the note above DEFAULT_REQUIRED_FIELDS).
const UNCHANGEABLE = {
  person: ["first_name", "email", "mobile_phone"],
  account: ["name"],
  invoice: [],
  document: [],
  service: [],
  booking: [],
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ Read the required fields for a record type, or the defaults if not set.
/**
 * @param {*} tx — database transaction handle
 * @param {string} tenantId — tenant id
 * @param {string} recordType — 'person', 'account', 'invoice', 'document', 'service', 'booking'
 * @returns {Promise<string[]>} list of required field names
 */
export async function requiredFor(tx, tenantId, recordType) {
  const all = await getSetting(tx, "fields.required", DEFAULT_REQUIRED_FIELDS);
  return all[recordType] ?? DEFAULT_REQUIRED_FIELDS[recordType] ?? [];
}

/**
 * ★ Validate that a create payload has all required fields present and non-empty.
 * @param {object} values — the payload object (e.g., { firstName: "...", email: "..." })
 * @param {string[]} required — list of required field names (snake_case)
 * @returns {object} { ok: boolean, missing: string[] }
 *   `ok` is true when all required fields are present and non-empty
 *   `missing` lists every field that is required but missing/empty
 */
export function validateRequired(values, required) {
  const missing = [];
  for (const fieldName of required) {
    // ★ Convert snake_case to camelCase for payload lookup
    const camelCase = fieldName.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
    const value = values[camelCase] ?? values[fieldName];
    // ★ Empty string, null, undefined all count as missing
    if (!value || (typeof value === "string" && value.trim() === "")) {
      missing.push(fieldName);
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * ★ Return the unchangeable fields for a record type — fields a practice cannot turn off
 *   because the record cannot exist without them.
 */
export function unchangeableFor(recordType) {
  return UNCHANGEABLE[recordType] ?? [];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ REQUIRED FIELD REASONS — THE LABEL SHOWN ON THE SETTINGS SCREEN FOR EACH REQUIRED FIELD
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const REQUIRED_FIELD_REASONS = {
  person: {
    first_name: "Always required. Can't be turned off.",
    email: "Required. Without it they can't be sent anything.",
    phone: "Not required.",
    date_of_birth: "Required.", // Modified at runtime based on adolescent_client existence
    payer: "Who pays — Required.",
    lead_source: "Not required, but it's the only way to know what's working.",
  },
  account: {
    name: "Always required. Can't be turned off.",
  },
  invoice: {},
  document: {},
  booking: {
    notes: "Not required. Turning this on stops a session being closed without them.",
    attendee: "Always required.",
  },
  service: {
    description: "Required. It's what clients read when they book.",
    photo: "Not required.",
  },
};

// ★ FIELD TO COLUMN MAPPING — Maps logical field names to database columns
// ★ Every column here was MEASURED against the catalogue (25 Sep 2026). A field with no column of its
//   own (a payer is an account link, a booking's attendee lives in booking_attendee, a booking has no
//   free-text notes column) is left OUT, so its count reads "not counted" rather than failing the screen.
const FIELD_TO_COLUMN = {
  person: {
    first_name: "first_name",
    email: "email",
    phone: "mobile_phone",
    date_of_birth: "date_of_birth",
    lead_source: "source",
  },
  account: {
    name: "name",
  },
  invoice: {},
  document: {},
  booking: {},
  service: {
    description: "description",
    photo: "image_id",
  },
};

/**
 * ★ Count how many records of a given type are missing a required field
 * @param {*} tx — database transaction handle
 * @param {string} recordType — 'person', 'account', 'invoice', 'document', 'service', 'booking'
 * @param {string} field — field name (e.g., 'first_name', 'email', etc.)
 * @returns {Promise<number|null>} count of records missing the field, or null if no column maps to this field
 */
export async function missingCounts(tx, recordType, field) {
  const columnMap = FIELD_TO_COLUMN[recordType];
  if (!columnMap || !columnMap[field]) return null;

  const column = columnMap[field];
  let query;

  if (recordType === "person") {
    // Count app_user records that are clients (role='client') and not archived, missing the field
    query = `
      SELECT COUNT(*) as count
      FROM keystone.app_user
      WHERE role = 'client'
        AND archived_at IS NULL
        AND (${column} IS NULL OR ${column}::text = '')
    `;
  } else if (recordType === "account") {
    // Count account records that are not archived, missing the field
    query = `
      SELECT COUNT(*) as count
      FROM keystone.account
      WHERE archived_at IS NULL
        AND (${column} IS NULL OR ${column}::text = '')
    `;
  } else if (recordType === "booking") {
    // Count booking records missing the field
    query = `
      SELECT COUNT(*) as count
      FROM keystone.booking
      WHERE (${column} IS NULL OR ${column}::text = '')
    `;
  } else if (recordType === "service") {
    // Count service records that are not archived, missing the field
    query = `
      SELECT COUNT(*) as count
      FROM keystone.service
      WHERE archived_at IS NULL
        AND (${column} IS NULL OR ${column}::text = '')
    `;
  } else if (recordType === "invoice" || recordType === "document") {
    // These types have no fields marked as required for missing count
    return null;
  } else {
    return null;
  }

  const { rows } = await tx.query(query, []);
  return parseInt(rows[0]?.count ?? 0, 10);
}
