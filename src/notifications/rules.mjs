// @ts-check
// TASK 6.3 — THE PRACTICE'S OWN DEFAULT CHANNEL MATRIX. `getEffectiveChannels()` is the ONE new
// read `fanOut()` gains (06-settings.md §11: "one new read via a new `getEffectiveChannels()`
// helper in a new file `src/notifications/rules.mjs`").
//
// TASK 20.25 — EXTEND TO INCLUDE CATALOGUE DEFAULTS AND PROVENANCE TRACKING.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE THREE-TIER FALLBACK, IN THE ORDER §10 POINT 7 AND §11 REQUIRE — AND NEVER THE OTHER WAY.
//   1. A PERSON'S OWN EXPLICIT PREFERENCE (`keystone.notification_preference`) — set by that exact
//      person, about that exact topic/channel. Wins every time it exists, because it is the one
//      fact in this whole chain that is about THEM specifically, not about a role they happen to
//      hold today.
//   2. THE PRACTICE'S OWN DEFAULT for the MATRIX ROLE this recipient collapses to
//      (`keystone.notification_rule`) — set once by an admin for `everyone who is a Coach`, not
//      for any one person.
//   3. IMPLICIT "ON" — the same default `fanOut()` already used before this task existed. Neither
//      row exists: nobody has ever decided, for this person or for their role, so the system tells
//      them, exactly as it always has.
// ★★ §10 point 7, verbatim: "notification_rule is read as a fallback BENEATH
//    notification_preference, never instead of it." `getEffectiveChannels` enforces that ORDER by
//    construction — it asks table 1 first and only reaches table 2 when table 1 has no answer.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ The three matrix roles migration 0336's own CHECK constraint admits — the closed vocabulary
 *   `notification_rule.role` and `setNotificationRule`'s validation both read from this one place. */
export const NOTIFICATION_ROLES = Object.freeze(["owner_admin", "member", "client_parent"]);

/**
 * ★★★ THE COLLAPSE FROM `app_user.role`/`staff_role` TO ONE OF THE THREE MATRIX ROLES.
 *
 * ★ NOT `effectiveRank`/`RANK` (`src/nav/authorise.mjs`) — that is a SIX-rung ladder built to answer
 *   "is this rank high enough for that screen", ordered so higher always dominates lower. This
 *   question is different in kind: "which of three GROUPS does a notification's audience column
 *   belong to` has no ordering at all — a Coach is not `between" Owner/admin and Client/parent, they
 *   are a separate column on the frame's own table
 *   (`specs/mockups/SetNotifications.frame.html:34`: `Owner / admins | Coach | Client or parent`).
 *   Reusing a ranked ladder for an unranked grouping would be the wrong tool answering the right
 *   question by accident, and the next person to read `RANK.indexOf` here would reasonably assume
 *   an ordering the frame itself does not have.
 * ★ Mirrors `keystone.app_user.role` CHECK `('staff','adult_client','adolescent_client','parent')`
 *   and `app_user_staff_role_check`'s `staff_role IN ('owner','admin','coach')`
 *   (`db/migrations/0001_platform_skeleton.sql:122-162`, `0188`).
 *
 * @returns one of `NOTIFICATION_ROLES`, or `null` if the recipient does not exist in this tenant or
 *          their role/staff_role does not collapse to a matrix column (fails closed to "no rule
 *          applies", which `getEffectiveChannels` below reads as "fall through to implicit on" —
 *          the SAME safe direction `effectiveRank` fails in for an unrecognised role).
 */
export async function matrixRoleFor(tx, { tenantId, recipientId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["role", "staff_role"])
    .where("id", "=", recipientId)
    .where("tenant_id", "=", tenantId));
  const u = rows[0];
  if (!u) return null;
  if (u.role === "staff") {
    if (u.staff_role === "owner" || u.staff_role === "admin") return "owner_admin";
    if (u.staff_role === "member") return "member";
    return null;
  }
  // ★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role` value (a guardian is an `adult_client` who
  //   happens to have a `guardian` row); both client roles already land in the same bucket here.
  if (u.role === "adult_client" || u.role === "adolescent_client") {
    return "client_parent";
  }
  return null;
}

/**
 * ★★★ THE FALLBACK ITSELF. Called once PER CHANNEL from `fanOut()` (`src/notifications/send.mjs`),
 * replacing that function's own former inline `notification_preference`-only query.
 *
 * @returns `true`/`false` — never a third state. `fanOut()` reads this exactly as it read the old
 *          inline query's `enabled === false` check: `false` suppresses the channel and is recorded
 *          as `skipped`, anything else is attempted.
 */
export async function getEffectiveChannels(tx, { tenantId, recipientId, topic, channel }) {
  // ── TIER 1 — the person's own explicit preference. ─────────────────────────────────────────
  const pref = await run(tx, db
    .selectFrom("keystone.notification_preference")
    .select("enabled")
    .where("tenant_id", "=", tenantId)
    .where("app_user_id", "=", recipientId)
    .where("topic", "=", topic)
    .where("channel", "=", channel));
  if (pref.rows[0]) return pref.rows[0].enabled;

  // ── TIER 2 — the practice's own default for this recipient's matrix role. ──────────────────
  const role = await matrixRoleFor(tx, { tenantId, recipientId });
  if (role) {
    const rule = await run(tx, db
      .selectFrom("keystone.notification_rule")
      .select("enabled")
      .where("tenant_id", "=", tenantId)
      .where("topic", "=", topic)
      .where("role", "=", role)
      .where("channel", "=", channel));
    if (rule.rows[0]) return rule.rows[0].enabled;
  }

  // ── TIER 3 — catalogue default. Materialised lazily, never migrated. ───────────────────────
  const catalogueEntry = NOTIFICATION_TOPICS.find((t) => t.topic === topic);
  return catalogueEntry ? catalogueEntry.defaultOn : true;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK 20.25 — NEW EXPORTS FOR SETTINGS MATRIX WITH PROVENANCE
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { NOTIFICATION_TOPICS } from "./topics.mjs";

/**
 * ★ Get the catalogue default and locked status for a notification topic.
 * @returns { defaultOn: boolean, locked: boolean } or null if topic not in catalogue
 */
export function getCatalogueDefaults(topic) {
  const entry = NOTIFICATION_TOPICS.find((t) => t.topic === topic);
  if (!entry) return null;
  return { defaultOn: entry.defaultOn, locked: entry.locked };
}

/**
 * ★★★ Resolve a notification rule with provenance tracking.
 * RESOLUTION ORDER (absolute): personal > practice > default
 * @returns { enabled: boolean, provenance: 'personal' | 'practice' | 'default' }
 */
export async function getEffectiveChannelsWithProvenance(tx, { tenantId, recipientId, role, topic, channel }) {
  // ── TIER 1 — the person's own explicit preference. ─────────────────────────────────────────
  const pref = await run(tx, db
    .selectFrom("keystone.notification_preference")
    .select("enabled")
    .where("tenant_id", "=", tenantId)
    .where("app_user_id", "=", recipientId)
    .where("topic", "=", topic)
    .where("channel", "=", channel));
  if (pref.rows[0]) return { enabled: pref.rows[0].enabled, provenance: "personal" };

  // ── TIER 2 — the practice's own default for this role. ─────────────────────────────────────
  if (role) {
    const rule = await run(tx, db
      .selectFrom("keystone.notification_rule")
      .select("enabled")
      .where("tenant_id", "=", tenantId)
      .where("topic", "=", topic)
      .where("role", "=", role)
      .where("channel", "=", channel));
    if (rule.rows[0]) return { enabled: rule.rows[0].enabled, provenance: "practice" };
  }

  // ── TIER 3 — catalogue default. ──────────────────────────────────────────────────────────────
  const catalogueEntry = NOTIFICATION_TOPICS.find((t) => t.topic === topic);
  const defaultOn = catalogueEntry ? catalogueEntry.defaultOn : true;
  return { enabled: defaultOn, provenance: "default" };
}
