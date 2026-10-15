// @ts-check
// P1.1 — THE TENANT SETTING WRITE AND READ PATHS. setSetting · getSettings · getSetting.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE REFUSAL IS THE FEATURE, AND IT MIRRORS `emit()` DELIBERATELY. `src/events/outbox.mjs`
//     validates a topic against the closed catalogue and throws `TopicViolation` rather than writing
//     something nobody will ever read. This does the same with `SETTING_KEYS`.
//   ★★ `BUILD-KS2 §P1.1` requires it in those words: *"an unknown key is refused, NOT silently
//      stored."* A settings table that accepts anything is a key-value bucket, and a typo in it is
//      indistinguishable from a feature that does not work — the operator sets `practice.phone`,
//      sees it save, and waits forever for it to appear.
//
// ★★★ FIX ROUND 1 — RULING R63. `settings.setting.changed` fires ONLY when the stored value
//     ACTUALLY CHANGES. Task 4's first version emitted on every successful write, including a
//     resubmit of the identical value — the review called this out directly against the slug
//     route built in the SAME task, which already has this discipline: "a resubmission of the
//     identical value is not a change." The comparison happens in ONE statement (the `old` CTE
//     below reads the pre-write row on the same MVCC snapshot the INSERT/UPDATE runs against, so
//     there is no separate SELECT-then-write race), and NULL (no row existed) `IS DISTINCT FROM`
//     any real value — so the very first time a key is ever set still counts as a change.
//
// ★★★ STAGE 4 TASK 4 — F505. THIS NOW EMITS, AND THE ARGUMENT ABOVE (P1.1's original comment here)
//     IS RETIRED, NOT JUST OVERWRITTEN, SO THE REVERSAL IS ON THE RECORD.
//   ★★ WHAT USED TO BE TRUE: "a setting change has no consumer today… the audit need is served by
//      `updated_by`". That was correct THEN and is wrong NOW — spec 02 §5 lists `settings` as its
//      own outbox section with `setting.changed` as a named topic, and §3 names "Settings" as an
//      audit-log source. `updated_by` answers "who", not "what changed and when", and the audit
//      screen (`src/audit/queries.mjs`) reads the `event` table, not `tenant_setting`. write-census
//      (F505) flagged this module's old exemption as CONTRADICTING spec 02, not merely superseded
//      by it — it was written before the spec settled where settings belong, and the spec is the
//      one that changed.
//   ★★★ EVERY CALLER OF `setSetting` GETS THIS FOR FREE, INCLUDING THE LOGO UPLOAD ROUTE
//       (`routes/settings.mjs`'s `PUT branding/logo/:kind`) — the emit lives HERE, not duplicated at
//       each of `setSetting`'s call sites, for the same reason `emit()` itself lives in one place:
//       a rule enforced at every call site is a rule that will eventually be skipped at one of them.
//   ★ subjectType/subjectId are left null (no tenant/practice entry in the closed `SUBJECT_TYPES`
//     vocabulary — see `routes/settings.mjs`'s slug emit for the same decision, recorded once).
//
// ★ UPSERT, NOT INSERT-OR-UPDATE-BY-HAND. `ON CONFLICT (tenant_id, key)` makes "set this" one
//   statement and one round trip, and makes the unique index (0065) the thing that guarantees one
//   row per key rather than a read-then-write race.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { validateSetting, SettingViolation, ALL_SETTING_KEYS, SETTING_KEYS } from "./keys.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * Determine if a value is safe to include in an audit record.
 * Numbers and booleans are always included. Strings are included only if they are
 * ≤40 chars and the key is known to use an enumeration (oneOf) validator.
 * Free-text values (policy_text, names, addresses) are never audited.
 */
function auditSafe(key, value) {
  // Numeric and boolean values are always safe
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  // Short strings from enum keys are safe
  if (typeof value === 'string' && value.length <= 40) {
    // Known enum keys that use oneOf validators
    const enumKeys = new Set([
      'booking.late_cancel_behaviour', 'booking.who_can_book', 'billing.tier',
      'email.sending_domain_default_purpose', 'items.default_unit', 'items.default_delivery',
    ]);
    if (enumKeys.has(key)) return value;
  }

  return null;
}

/**
 * Set one tenant setting.
 * @param tx  a pg client INSIDE the caller's transaction — never a pool. Same contract as `emit()`.
 */
export async function setSetting(tx, { tenantId, key, value, updatedBy = null }) {
  // ★★ VALIDATE BEFORE TOUCHING THE DATABASE. The alternative is a CHECK violation surfacing as a
  //    23514 with a constraint name in it, which is a message for an engineer and not for the person
  //    who typed the value.
  const problem = validateSetting(key, value);
  if (problem) throw new SettingViolation(problem);

  if (!tenantId) {
    // ★ Fail LOUD rather than letting RLS turn this into "zero rows written", which reads as success.
    throw new SettingViolation("setSetting requires a tenantId — call it inside withTenant()");
  }

  // ★★★ R63 — THE `old` CTE READS THE ROW AS IT STOOD BEFORE THIS STATEMENT RAN. All the
  //     sub-statements of one `WITH` query share one snapshot (Postgres's own guarantee), so `old`
  //     always sees the PRE-write value, never the one this same statement is about to write — no
  //     separate SELECT-then-INSERT round trip, and so no race with a concurrent writer either.
  //     `old.value IS DISTINCT FROM upsert.value` is a jsonb-aware comparison (normalises key
  //     order, unlike a text compare) and treats "no row existed" (NULL) as distinct from any real
  //     value, so a key's very first write is always a change.
  const { rows } = await tx.query(
    `WITH old AS (
       SELECT value FROM keystone.tenant_setting WHERE tenant_id = $1 AND key = $2
     ), upsert AS (
       INSERT INTO keystone.tenant_setting (tenant_id, key, value, updated_by)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (tenant_id, key)
         DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by
       RETURNING id, key, value
     )
     SELECT upsert.id, upsert.key, upsert.value,
            (SELECT value FROM old) IS DISTINCT FROM upsert.value AS changed,
            (SELECT value FROM old) AS old_value
       FROM upsert`,
    [tenantId, key, JSON.stringify(value), updatedBy]);

  // ★★★ ZERO ROWS IS A REFUSAL, NOT A SUCCESS. Under FORCE RLS an INSERT for another tenant returns
  //     no row rather than raising — so a caller that ignored this would report "saved" for a write
  //     that never happened. This is the shape `F52` cost eleven phases.
  if (rows.length === 0) {
    throw new SettingViolation(
      `"${key}" was not written — the row was refused by row-level security, which means the ` +
      `tenant context does not match the tenantId passed in`);
  }
  const { changed, old_value, ...row } = rows[0];
  // ★★★ STAGE 4 TASK 4 — F505, IN THE SAME TRANSACTION AS THE WRITE. `tx` is the same handle the
  //     write just used (this function's own docstring: "never a pool"), so this obeys emit()'s
  //     contract identically to every other domain writer. Payload carries the setting KEY only —
  //     never `value`, which is unbounded and would let a free-text setting (a name, an address)
  //     straight through §2.4's ban the moment one is added.
  //   ★★ FIX ROUND 1 — R63: only when `changed` is true. An unchanged resubmit still returns
  //      `saved: true` to the caller (the write itself always succeeds — the row is the same
  //      either way) but writes NOTHING new to the event log, matching the slug route's own
  //      "not a change" standard.
  if (changed) {
    await emit(tx, {
      tenantId, topic: "settings.setting.changed", emittedBy: "settings",
      actor: userActor(updatedBy),
      payload: { key },
    });
    // ★ Task 17.5 — write an audit row when the value actually changed. `updatedBy` is null
    //   only in gates/tests, where no audit row is written (documented in this function's header).
    if (updatedBy !== null) {
      await writeAudit(tx, {
        tenantId,
        action: "settings.changed",
        object: key,
        actorUserId: updatedBy,
        before: { key, value: auditSafe(key, old_value) },
        after: { key, value: auditSafe(key, value) },
      });
    }
  }
  return row;
}

/**
 * Every setting for the current tenant, as a plain object.
 * ★ Returns `{}` when nothing is set. An empty store and a missing store are the same fact here —
 *   a tenant that has configured nothing — so they are correctly indistinguishable.
 */
export async function getSettings(tx) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.tenant_setting")
    .select(["key", "value"])
    .orderBy("key"));
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/**
 * One setting, or `fallback` when it is not set.
 * ★★ THE FALLBACK IS THE CALLER'S, NOT THIS MODULE'S. A default invented here would be a second
 *    place the product's behaviour is decided, and the caller is the one that knows what "unset"
 *    should mean on its own surface.
 */
export async function getSetting(tx, key, fallback = null) {
  if (!ALL_SETTING_KEYS.includes(key)) {
    throw new SettingViolation(`"${key}" is not a known setting — reading it would always return the fallback`);
  }
  const { rows } = await run(tx, db
    .selectFrom("keystone.tenant_setting")
    .select("value")
    .where("key", "=", key));
  return rows.length ? rows[0].value : fallback;
}
