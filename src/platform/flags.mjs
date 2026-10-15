// src/platform/flags.mjs — Stage 9 task 9.3. CT-071 (the three tables, db/migrations/0213) ·
// CT-072 (flagIsOn).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A KILL SWITCH THAT SILENTLY READS "OFF" FOR A TYPO IS A KILL SWITCH THAT IS ALWAYS ON FOR
//     NOBODY AND NEVER NOTICED. `flagIsOn` therefore RAISES on a key `keystone.feature_flag` has no
//     row for — it never falls back to `false`, which is the one answer that would look correct on
//     every dashboard while doing nothing.
//
// ★★ NO CACHE, ANYWHERE IN THIS FILE, ON PURPOSE. `flagIsOn` reads inside the CALLER'S transaction,
//    every time, so a per-practice override — or a platform-wide default flip, via a migration —
//    takes effect at the very next statement, with no restart and no TTL to wait out. A cache here
//    would be the exact "who supplies the condition" defect CLAUDE.md's failure #1 names, just
//    moved from a GUC to an in-process Map.
//
// ★ `flagIsOn`/`setFlagForPractice` do NOT check `keystone.caller_is_platform()` themselves — that
//   is a route's job (task 9.13's), not this module's. This file is the read/write PRIMITIVE over
//   the three tables 0213 creates; the platform-only route around `setFlagForPractice` is what
//   actually restricts who can call it with a real session behind it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { assertTenantTx } from "../db/index.mjs";
import { internal } from "../http/errors.mjs";

function assertNonBlankString(value, name, who) {
  if (typeof value !== "string" || value.trim() === "") {
    throw internal(`${who}: ${name} must be a non-blank string (got ${JSON.stringify(value)})`);
  }
}

/**
 * Is flag `key` on for `tenantId`? A per-practice row in `keystone.feature_flag_practice` beats
 * `keystone.feature_flag.default_on`; no row means the default applies.
 *
 * ★★★ AN UNKNOWN KEY RAISES (CT-072) — never reads as `false`. The error names the key.
 *
 * @param tx        a tenant transaction — the handle `withTenant()` passes to its callback.
 * @param key       the flag's key, e.g. "n8n_send".
 * @param tenantId  the practice to resolve the override for.
 * @returns {Promise<boolean>}
 */
export async function flagIsOn(tx, key, tenantId) {
  assertTenantTx(tx, "flagIsOn()");
  assertNonBlankString(key, "key", "flagIsOn");
  assertNonBlankString(tenantId, "tenantId", "flagIsOn");

  const { rows: flagRows } = await tx.query(
    `SELECT default_on FROM keystone.feature_flag WHERE key = $1`,
    [key]);
  if (flagRows.length === 0) {
    // ★ CT-072 — a typo must not read as "off". Named, loud, and thrown before any table beyond
    //   the catalog is even queried.
    throw internal(`flagIsOn: "${key}" is not a known feature flag — add it to keystone.feature_flag first`);
  }

  const { rows: practiceRows } = await tx.query(
    `SELECT "on" FROM keystone.feature_flag_practice WHERE flag_key = $1 AND tenant_id = $2`,
    [key, tenantId]);
  if (practiceRows.length > 0) {
    return practiceRows[0].on === true;
  }
  return flagRows[0].default_on === true;
}

/**
 * Set (or flip) the override for `key` at `tenantId`, and append the matching
 * `keystone.feature_flag_change` row — `previous` is the value THIS call replaced: the prior
 * override if one existed, otherwise the flag's own `default_on`. Both writes happen in the
 * caller's transaction, so a reader can never observe one without the other.
 *
 * ★ Unknown `key` raises, same rule and same message shape as `flagIsOn`.
 *
 * @param tx
 * @param key       the flag's key.
 * @param tenantId  the practice the override applies to.
 * @param on        the new value.
 * @param setBy     who set it — a non-blank string (a uid or "system"), never omitted.
 * @param reason    optional free text for the change-log row.
 */
export async function setFlagForPractice(tx, { key, tenantId, on, setBy, reason = null } = {}) {
  assertTenantTx(tx, "setFlagForPractice()");
  assertNonBlankString(key, "key", "setFlagForPractice");
  assertNonBlankString(tenantId, "tenantId", "setFlagForPractice");
  assertNonBlankString(setBy, "setBy", "setFlagForPractice");
  if (typeof on !== "boolean") {
    throw internal(`setFlagForPractice: on must be a boolean (got ${JSON.stringify(on)})`);
  }
  if (reason !== null && typeof reason !== "string") {
    throw internal(`setFlagForPractice: reason must be a string or null (got ${JSON.stringify(reason)})`);
  }

  const { rows: flagRows } = await tx.query(
    `SELECT default_on FROM keystone.feature_flag WHERE key = $1`,
    [key]);
  if (flagRows.length === 0) {
    throw internal(`setFlagForPractice: "${key}" is not a known feature flag — add it to keystone.feature_flag first`);
  }

  // ★ FOR UPDATE — the value this call is about to replace must be read under lock, so two
  //   concurrent flips of the same (key, tenantId) cannot both compute the same "previous".
  const { rows: existingRows } = await tx.query(
    `SELECT "on" FROM keystone.feature_flag_practice WHERE flag_key = $1 AND tenant_id = $2 FOR UPDATE`,
    [key, tenantId]);
  const previous = existingRows.length > 0 ? existingRows[0].on === true : flagRows[0].default_on === true;

  await tx.query(
    `INSERT INTO keystone.feature_flag_practice (flag_key, tenant_id, "on", set_by)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (flag_key, tenant_id)
       DO UPDATE SET "on" = EXCLUDED."on", set_by = EXCLUDED.set_by, set_at = now()`,
    [key, tenantId, on, setBy]);

  await tx.query(
    `INSERT INTO keystone.feature_flag_change (flag_key, tenant_id, "on", previous, reason, set_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    [key, tenantId, on, previous, reason, setBy]);
}
