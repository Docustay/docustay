// @ts-check
/**
 * ★★★ AUTOMATION CONFIGURATION SCHEMA AND VALIDATORS.
 *
 * Each automation kind carries a schema defining its config fields, types, bounds and defaults.
 * `validateConfig()` enforces the schema; `defaultConfig()` returns defaults for a kind;
 * `readConfig()` reads the stored config for (tenantId, key) and merges it over the defaults.
 */

import { AUTOMATIONS } from "./catalogue.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★★ THE CONFIGURATION SCHEMA, KEYED BY KIND.
 * Each field declares type, constraints (bounds, allowed values), and default.
 */
export const CONFIG_SCHEMA = Object.freeze({
  reminder: {
    channel: { type: "enum", values: ["email", "text_or_email"], default: "email" },
  },
  invoice_chase: {
    offsets_days: { type: "array", default: [-7, 0, 1, 3] },
  },
  review_ask: {
    after_sessions: { type: "int", min: 1, max: 20, default: 3 },
    delay_hours: { type: "int", min: 0, max: 72, default: 2 },
    channel: { type: "enum", values: ["email", "text_or_email"], default: "email" },
    wording: { type: "string|null", default: null },
  },
  package_low: {
    threshold: { type: "int", min: 1, max: 10, default: 2 },
    min_package_minor: { type: "int|null", default: null },
    channel: { type: "enum", values: ["email", "text_or_email"], default: "email" },
    wording: { type: "string|null", default: null },
    tell_owner: { type: "bool", default: true },
    once_per: { type: "string", default: "package" },
  },
  quiet_flag: {
    days: { type: "int", min: 14, max: 180, default: 42 },
  },
  writeup_timing: {
    due: { type: "enum", values: ["same_evening", "next_morning"], default: "same_evening" },
  },
  first_agreement: {
    template_id: { type: "uuid|null", default: null },
  },
  monthly_writeup: {
    day_of_month: { type: "int", default: 1 },
  },
  // ★ [TY, 2 Oct 2026] win_back REMOVED ENTIRELY — see automations/sweeps.mjs's own header note.
  lead_task: {},
  ads_rule: {},
});

/**
 * ★★ `text_or_email` CURRENTLY SENDS EMAIL ONLY. The SMS sender is not present in this codebase;
 *    texting is expected in a future phase. `text_or_email` is here for that readiness.
 */

/**
 * DERIVE THE DEFAULT CONFIG FOR A CATALOGUE KEY.
 * Looks up the key's kind in AUTOMATIONS, finds its schema, and returns an object
 * with defaults for every field.
 */
export function defaultConfig(key) {
  const automation = AUTOMATIONS.find((a) => a.key === key);
  if (!automation) {
    throw new Error(`unknown automation key: ${key}`);
  }
  const schema = CONFIG_SCHEMA[automation.kind];
  if (!schema) {
    throw new Error(`no schema for kind: ${automation.kind}`);
  }
  const config = {};
  for (const [field, spec] of Object.entries(schema)) {
    config[field] = spec.default;
  }
  return Object.freeze(config);
}

/**
 * VALIDATE A CONFIG OBJECT AGAINST A KEY'S SCHEMA.
 *
 * ★★ SAME DISCIPLINE AS `compileFilter` (src/growth/campaigns.mjs:64-71):
 *   - Unknown field name → refused with a message.
 *   - Out-of-bounds numeric field → refused with a message.
 *   - Invalid enum value → refused with a message.
 *
 * Returns null if valid; a string error message if invalid.
 */
export function validateConfig(key, value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `config must be a JSON object (got ${typeof value === "object" ? "array" : typeof value})`;
  }

  const automation = AUTOMATIONS.find((a) => a.key === key);
  if (!automation) {
    return `unknown automation key: ${key}`;
  }

  const schema = CONFIG_SCHEMA[automation.kind];
  if (!schema) {
    return `no schema for kind: ${automation.kind}`;
  }

  const knownFields = Object.keys(schema);
  for (const field of Object.keys(value)) {
    if (!knownFields.includes(field)) {
      return `"${field}" is not a config field for ${automation.kind}. Known fields: ${knownFields.join(", ")}`;
    }
  }

  for (const [field, fieldSpec] of Object.entries(schema)) {
    const v = value[field];
    if (v === undefined) continue;

    if (fieldSpec.type === "enum") {
      if (!fieldSpec.values.includes(v)) {
        return `"${field}" does not accept ${JSON.stringify(v)}. Allowed: ${fieldSpec.values.join(", ")}`;
      }
    } else if (fieldSpec.type === "int") {
      if (typeof v !== "number" || !Number.isInteger(v)) {
        return `"${field}" must be an integer (got ${typeof v === "number" ? v : JSON.stringify(v)})`;
      }
      if (fieldSpec.min !== undefined && v < fieldSpec.min) {
        return `"${field}" must be ≥ ${fieldSpec.min} (got ${v})`;
      }
      if (fieldSpec.max !== undefined && v > fieldSpec.max) {
        return `"${field}" must be ≤ ${fieldSpec.max} (got ${v})`;
      }
    } else if (fieldSpec.type === "int|null") {
      if (v !== null && (typeof v !== "number" || !Number.isInteger(v))) {
        return `"${field}" must be an integer or null (got ${typeof v === "number" ? v : JSON.stringify(v)})`;
      }
    } else if (fieldSpec.type === "bool") {
      if (typeof v !== "boolean") {
        return `"${field}" must be a boolean (got ${JSON.stringify(v)})`;
      }
    } else if (fieldSpec.type === "string") {
      if (typeof v !== "string") {
        return `"${field}" must be a string (got ${typeof v})`;
      }
    } else if (fieldSpec.type === "string|null") {
      if (v !== null && typeof v !== "string") {
        return `"${field}" must be a string or null (got ${typeof v})`;
      }
    } else if (fieldSpec.type === "uuid|null") {
      if (v !== null) {
        if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
          return `"${field}" must be a uuid or null (got ${JSON.stringify(v)})`;
        }
      }
    } else if (fieldSpec.type === "array") {
      if (!Array.isArray(v)) {
        return `"${field}" must be an array (got ${JSON.stringify(v)})`;
      }
    }
  }

  return null;
}

/**
 * READ THE STORED CONFIG FOR (TENANTID, KEY) AND MERGE OVER DEFAULTS.
 *
 * Reads from `keystone.automation_config` (created by migration 0443) if it exists,
 * then deep-merges the stored config over `defaultConfig(key)`.
 * If no row exists, returns the defaults.
 */
export async function readConfig(tx, { tenantId, key }) {
  if (!tenantId || !key) {
    throw new Error("readConfig needs tenantId and key");
  }

  const defaults = defaultConfig(key);
  const { rows } = await run(tx, db
    .selectFrom("keystone.automation_config")
    .select(["config"])
    .where("tenant_id", "=", tenantId)
    .where("key", "=", key));

  if (rows.length === 0) {
    return defaults;
  }

  const stored = rows[0].config;
  if (!stored || typeof stored !== "object") {
    return defaults;
  }

  return Object.freeze({ ...defaults, ...stored });
}
