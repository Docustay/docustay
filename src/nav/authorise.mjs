// P5.10(c) — ★★★ THE SERVER-SIDE SECTION CHECK. §K3.
//
// ★★★ §K3, verbatim: "CLIENT-SIDE ROLE GATING IS NOT A SECURITY BOUNDARY. The gate is RLS,
// server-side, every request."
//
// ★★ So this module exists to be called ON THE SERVER, on every request, BEFORE a handler runs —
// not to decide what the sidebar draws. `minRole` in sections.mjs feeds both, but a renderer
// hiding a link and this refusing a request are different acts, and only one of them is a
// boundary. Hiding a menu item renders nothing unreachable: the URL is still there, and so is the
// API underneath it.
//
// ★ RLS remains the last line — even if this were bypassed entirely, a request without tenant
// context reads ZERO rows (P1.9–P1.12, mutation-checked on four separate paths). This is
// defence in depth, not a replacement for it.

import { SECTIONS, SECTION_CHILDREN, PLATFORM_SECTION_KEY, allRows } from './sections.mjs';
import { forbidden } from '../http/errors.mjs';

/**
 * ★★ THE RANKING IS AN ORDERED LIST, NOT A NUMBER ON EACH ROW.
 * [MEASURED, P1.18] the layering gate had exactly this defect: it ranked layers numerically and a
 * forbidden edge came out legal, so the mutation stayed GREEN. A rank comparison is only as good
 * as the ordering behind it, so the ordering is written once, here, and read by index.
 */
// ★★★ `staff` IS A RUNG NOTHING STANDS ON. It is the minRole a section may REQUIRE ("any staff
// member"), but no person's effective rank is ever the bare word `staff` — migration 0010's
// `staff_role_shape` guarantees every staff row carries a real rank. Leaving it out of this list
// was a genuine bug, caught by P5.10: `coach` was not on the ladder, so `effectiveRank` returned
// null and a coach was refused EVERY section. ★ It failed CLOSED, which is the right direction to
// be wrong in — but a boundary that refuses the people it is meant to admit gets loosened by the
// next person to hit it, and that is how holes are made.
// ★★★ 7.12a / Q0-7 — DEMOTED, NOT DELETED. This was a 7-rung ladder (`…, 'super_admin', 'super_admin_1'`)
//     that answered BOTH "may this person see this screen" and "may this person make this write" — the
//     second job moved to `assertMay`/`user_may` (Q7-21, `src/routes/writes.mjs`), which reads the
//     GRANT 7.1/7.9 declared, never a rank string. What is left is the FIRST job only, and its top rung
//     is renamed to match 7.7's vocabulary: migration `0188_one_owner_per_practice_not_one_per_
//     database.sql` narrowed `app_user_staff_role_check` to `staff_role IN ('owner','admin',`coach`)`
//     (MEASURED) — `super_admin`/`super_admin_1` can no longer be held as a PRACTICE `staff_role` at
//     all, so a rung neither value can ever reach is not a floor, it is dead weight.
const RANK = Object.freeze([
  'client', 'parent',
  'staff',            // ← required-only rung: "any staff member"
  'member', 'admin', 'owner',
]);

/**
 * ★ Resolve the rank a person actually holds. `role` is the PARTY, `staff_role` is the RANK —
 * migration 0010 keeps them as separate axes and constrains their shapes together.
 */
export function effectiveRank(user) {
  if (!user || typeof user !== 'object') return null;
  // ★★ FAIL CLOSED on anything unrecognised. An unknown role must not fall through to a default
  // that happens to be permissive; "I do not know who this is" means no.
  if (user.role === 'staff') {
    return RANK.includes(user.staff_role) ? user.staff_role : null;
  }
  // ★★★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role` value. A person is `adult_client` or
  //     `adolescent_client`; whether they are ALSO a parent is a computed FACT (a `guardian` row
  //     naming them), never a claim stored on their own row. `is_guardian` is that fact, joined in
  //     once at session-resolution time (src/http/app.mjs's `loadPerson`) rather than re-derived
  //     per call — same reasoning as `effectiveRank` reading `role`/`staff_role` off the row
  //     instead of re-querying them here.
  if (user.role === 'adult_client') {
    return user.is_guardian ? 'parent' : 'client';
  }
  if (user.role === 'adolescent_client') return 'client';
  return null;
}

/** ★ Index in RANK, or -1. Never a silent 0 — that would make an unknown role a client. */
const rankIndex = (r) => (r == null ? -1 : RANK.indexOf(r));

/** Every row in the nav, flattened, by path — built once from the SAME single source. */
const ROWS_BY_PATH = (() => {
  const m = new Map();
  for (const section of SECTIONS) {
    const kids = SECTION_CHILDREN[section.key] ?? [];
    // ★ A child INHERITS its section's minRole unless it states a stricter one of its own.
    // Without this, every child path would default to open — the classic "the parent route was
    // protected, the child was not" hole.
    for (const row of allRows([section, ...kids])) {
      m.set(row.path, {
        path: row.path,
        key: row.key,
        sectionKey: section.key,
        minRole: row.minRole ?? section.minRole,
        foundryOnly: row.foundryOnly === true,
      });
    }
  }
  return m;
})();

export const knownPaths = () => [...ROWS_BY_PATH.keys()];

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ RUN-2 C3 (26 Sep 2026) — SECTIONS THAT MOVED, BY NAME. Stage 20 (task 20.37) moved Growth
//     under Run in the NAV and never moved the SERVER's section keys: three LIST_VIEWS stayed keyed
//     `/growth/*` and sixteen write routes kept `section: "/growth/*"`. With no `/growth` row left,
//     every one of them answered 403 `unknown_path` — for the owner too [EXECUTED: POST
//     /api/growth/campaign-groups and GET /api/list/growth/campaigns, owner, both 403]. Nobody could
//     create a campaign, a list or a page.
//   ★ An alias resolves to the ROW IT MOVED TO, so that row's minRole — and everything after it —
//     decides. It widens nothing: a path not in this table is still refused as `unknown_path`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const SECTION_ALIASES = Object.freeze({
  "/growth/campaigns": "/run/campaigns",
  "/growth/lists": "/run/lists",
  "/growth/pages": "/run/pages",
});

/**
 * ★★★ THE DECISION. Returns { allowed, reason } — never a bare boolean, because a refusal that
 * cannot say why gets debugged by loosening it.
 *
 * @param user     { role, staff_role, tenant_id }
 * @param path     the requested path
 * @param opts     { tenantIsPlatform } — from the DATABASE (`tenant.is_platform`), never from
 *                 the client, and never matched on a slug.
 */
export function authoriseSection(user, path, opts = {}) {
  const row = ROWS_BY_PATH.get(path) ?? ROWS_BY_PATH.get(SECTION_ALIASES[path]);

  // ★★ AN UNKNOWN PATH IS A REFUSAL, NOT A PASS-THROUGH. A router that falls through to "allow"
  // for anything it does not recognise is one typo away from an open door.
  if (!row) return { allowed: false, reason: 'unknown_path' };

  const rank = effectiveRank(user);
  if (rank === null) return { allowed: false, reason: 'unknown_role' };

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ the maintainer, 1 Oct 2026 — OWNER-ACCESS AUDIT. "An owner should never see this." `rank === 'owner'`
  //     was ALREADY mathematically the top of RANK (:40-44) — no `rankIndex` comparison below this
  //     line could ever refuse an owner on RANK ALONE, and that remains true. This short-circuit
  //     does not change that outcome; it makes the GUARANTEE itself a single, explicit, auditable
  //     line instead of an emergent property of an array's ordering — so the next person who
  //     reorders RANK, adds a row with a typo'd minRole, or copies this function's shape into a
  //     new check cannot silently lose it the way `src/documents/variableCatalogue.mjs`'s own
  //     `role === 'admin'` check did (found in THIS audit — see its own fix for the real class of
  //     bug this project keeps meeting: an ad-hoc string check that knows about 'admin' and has
  //     never heard of 'owner'). The ONE exception, unchanged: the platform namespace below, which
  //     every owner of every ORDINARY practice must still be refused — being this practice's owner
  //     is not platform authority, and `tenantIsPlatform` is what the platform branch keeps asking.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (rank === 'owner' && row.sectionKey !== PLATFORM_SECTION_KEY && !row.path.startsWith('/platform')) {
    return { allowed: true, reason: 'owner_sees_everything' };
  }

  // ★★★ THE PLATFORM NAMESPACE IS CHECKED FIRST AND SEPARATELY. §A9: "NOT permission-hidden
  // inside the tenant app. Its own route namespace, checked server-side. A tenant admin must not
  // reach it by guessing a URL." Checking it first means a future change to the rank comparison
  // cannot accidentally open it.
  if (row.sectionKey === PLATFORM_SECTION_KEY || row.path.startsWith('/platform')) {
    if (!opts.tenantIsPlatform) return { allowed: false, reason: 'not_platform_tenant' };
    // ★ 7.12a — RENAMED, NOT REWRITTEN. `super_admin_1` is no longer a value `staff_role` can ever
    //   hold (migration 0188, see the RANK comment above); the rung it named is `RANK`'s new top rung,
    //   `owner`. The comparison itself stays exactly this shape — a literal string compare on this
    //   NAV/SCREEN floor is unchanged by Q7-21, which moved only the WRITE-ROUTE floor to
    //   `callerIsPlatform`/`assertMay` (`src/routes/writes.mjs`, `route.platform`/the non-platform
    //   branch). A row's minRole never reaches this comparison — the platform branch returns before
    //   `rankIndex(row.minRole)` runs — so `sections.mjs`'s own `minRole: 'super_admin_1'` on the
    //   `/platform` row (untouched, outside this task's file) is inert metadata, not a live floor.
    if (rank !== 'owner') return { allowed: false, reason: 'platform_requires_owner' };
    return { allowed: true, reason: 'platform_owner' };
  }

  // ★ A row flagged foundryOnly (Super Admin 1's own People page) is likewise tenant-gated on the
  // DATABASE flag, not on the renderer hint.
  if (row.foundryOnly && !opts.tenantIsPlatform) {
    return { allowed: false, reason: 'not_platform_tenant' };
  }

  const need = rankIndex(row.minRole);
  if (need === -1) {
    // ★ A row whose minRole is not in RANK is a CONFIGURATION BUG, and it fails CLOSED.
    return { allowed: false, reason: `unrankable_minRole:${row.minRole}` };
  }
  if (rankIndex(rank) < need) {
    return { allowed: false, reason: `requires_${row.minRole}` };
  }
  return { allowed: true, reason: 'rank_ok' };
}

/**
 * ★ What a person may SEE in the sidebar. Derived from the same decision function as the request
 * check — so the menu and the boundary can never disagree about who may reach what.
 */
export function visibleSections(user, opts = {}) {
  return SECTIONS.filter((s) => authoriseSection(user, s.path, opts).allowed);
}

/**
 * ★★★ 7.12a / F595 — THE SCREEN RANK FLOOR. Its argument is a nav row's `minRole`, NEVER an object —
 *     an object permission belongs in `assertMay`, not here (F594/F595 ruling, `STAGE-7-PLAN.md` end
 *     of task 7.12b). The one caller today is `src/routes/settings.mjs`'s `guarded()` wrapper, at the
 *     ONE site 7.12b deliberately left: `read("/tasks/automations", …)` is admin-only SOLELY because
 *     of this floor (MEASURED — its nav row inherits `minRole: 'staff'`, and `authoriseSection` alone
 *     would admit a Coach), and `/settings/sign-in` shares the same wrapper with a Coach `setting`
 *     grant seeded `none`/`none` (`0190:195`), so an object check there would lock Coaches out of
 *     their own sign-in devices — the ladder is not redundant at either site.
 * ★ THROWS on refusal, replacing `assertRank`'s exact behaviour — `guarded()` calls this as a bare
 *   statement, not an `if`-wrapped boolean, and the old `assertRank(user, minRank, path)` threw the
 *   same way. An unrecognised rank is a REFUSAL, not a pass: `RANK.indexOf` returning -1 for a rank
 *   nobody has heard of must never compare as "high enough", which is what an unguarded `>=` would do.
 */
export function atLeastRank(user, minRole) {
  if (!minRole) return;
  const rank = effectiveRank(user);
  // ★★★ the maintainer, 1 Oct 2026 — same owner-audit guarantee as `authoriseSection`, above: an explicit,
  //     named short-circuit rather than an emergent property of RANK's ordering. This function has
  //     no platform branch to protect (the platform namespace never calls it — §A9's own routes
  //     check `tenantIsPlatform`/`callerIsPlatform` instead, never a nav-row minRole), so owner is
  //     unconditional here.
  if (rank === 'owner') return;
  const have = rankIndex(rank);
  const need = rankIndex(minRole);
  if (have === -1 || need === -1 || have < need) {
    throw forbidden(`requires ${minRole} or higher`);
  }
}
