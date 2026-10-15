// F687 — CT-105's shared read, given an owning module. `CONTRACTS-FEATURES.md:192` specifies
// `lastChangedBy(tenantId, settingKeyOrTable)` in `src/settings/audit.mjs` (new): "one shared read
// function ... reading `keystone.audit_entry` (CT-041/CT-042, already built) filtered to
// `settings.changed` for the given key. Every spec-06 settings screen uses this component; no
// screen writes its own 'last changed' query."
//
// ★★★ MEASURED, worth recording here rather than silently duplicated over: a function with this
//     EXACT name and job already exists — `src/routes/settings.mjs:195`'s own (non-exported-to-a-
//     shared-module) `lastChangedBy(db, tenantId, object = null)`, already called from that file's
//     own SettingsHome (`:372`, tenant-wide) and SetPlans (`:583`, `"billing.plan"`) reads. F687's
//     own evidence ("file does not exist") was measured against the FILE `src/settings/audit.mjs`
//     and against `FEATURES-COMBINED-PLAN.md`, not against the wider codebase, and missed that
//     sibling. That in-file version takes an ALREADY-TENANT-SCOPED `db` handle (every caller inside
//     `settings.mjs` already has one, from `runTenantScoped`) — this module's job is different: a
//     STANDALONE function a screen OUTSIDE `settings.mjs` (spec 03a's calendar sync settings, spec
//     08's Automations page, per CT-105's own text) can import and call with nothing but a tenant id,
//     so it opens its own `withTenant` scope rather than assuming the caller already has one. This
//     file does not edit or import `settings.mjs`'s copy — consolidating the two into one is a
//     follow-up, not this item's scope (not in this item's own file list).
//
// ★ Same query shape as the sibling above, and the same reasoning for each choice:
//   - `action = 'settings.changed'` only (CT-105's own stated filter) — `role.permission_changed`
//     rows (spec 01's TeamRoles change log) are a DIFFERENT action this function does not read;
//     a caller wanting that log reads `keystone.audit_entry` itself or gets its own function later.
//   - No `tenant_id = $1` predicate in the SQL — `keystone.audit_entry` is FORCE ROW LEVEL SECURITY
//     like every other tenant table, and a predicate here would only invite a future reader to trust
//     it instead of the policy. `withTenant(tenantId, ...)` is what actually scopes the read.
//   - `object = $1` (not `IS NULL OR`) — `settingKeyOrTable` is REQUIRED here (unlike the sibling's
//     optional tenant-wide `null` case, which is SettingsHome's own special case, not CT-105's).

import { withTenant } from "../db/index.mjs";

/**
 * "Who last changed this setting/table, and when." Reads `keystone.audit_entry`, the ONE table a
 * `settings.changed` row is written to (`src/permissions/audit.mjs`'s `writeAudit`, the only writer).
 *
 * @param {string} tenantId
 * @param {string} settingKeyOrTable — the `audit_entry.object` value a write recorded, e.g.
 *   `"billing.plan"`, `"email.mailbox"`, `"settings.notifications"` (see each write site's own
 *   `writeAudit({..., object: "..."})` call for the real, closed set of values in use today).
 * @returns {Promise<{by: string, at: string} | null>} `by` is the acting staff member's
 *   `display_name`, or `"an operator"` when the row was an operator action (no `app_user` row to
 *   join) — same fallback the sibling reader already uses. `null` when nothing has ever changed it.
 */
export async function lastChangedBy(tenantId, settingKeyOrTable) {
  if (!tenantId) throw new Error("lastChangedBy requires tenantId");
  if (!settingKeyOrTable) throw new Error("lastChangedBy requires settingKeyOrTable");

  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query(
      `SELECT ae.at, u.display_name
         FROM keystone.audit_entry ae
         LEFT JOIN keystone.app_user u ON u.id = ae.actor_user_id
        WHERE ae.action = 'settings.changed'
          AND ae.object = $1
        ORDER BY ae.at DESC
        LIMIT 1`,
      [settingKeyOrTable]);
    if (!rows.length) return null;
    return { by: rows[0].display_name ?? "an operator", at: rows[0].at };
  });
}
