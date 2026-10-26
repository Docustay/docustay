// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P6.0a — ONE RULE ABOUT WHAT A BUILD STATE MEANS, READ BY EVERY SURFACE THAT NAVIGATES.
//
// ★★★ THERE WERE THREE RULES AND THEY DISAGREED, ON THE SAME SCREEN, AT THE SAME TIME (`F234`):
//       · `Sidebar.jsx:156`   `not_built || cut` are dead  →  `no_read_path` is a LIVE LINK
//       · `Breadcrumbs.jsx:66` anything that is not `built` is dead  →  `no_read_path` is PLAIN TEXT
//       · `CommandPalette`     was passed NO build state at all  →  every row is a live destination
//     [MEASURED] 25 section headers are `no_read_path`, so the first two contradicted each other on
//     **25 rows**; the breadcrumb consequently had NO WAY UP on **57 of 83 screens (69%)** while the
//     sidebar beside it linked the very same rows. And of the 23 rows the sidebar draws disabled,
//     the palette offered all 23 as live destinations, unmarked.
//
// ★★★ SO THE FIX IS NOT THREE FIXES. It is ONE predicate with three consumers — because three
//     copies of a rule is three chances to disagree, and the one that is wrong looks exactly like
//     the two that are right.
//
// ★★ THE RULE ITSELF IS THE SIDEBAR'S, PROMOTED — it was the most considered of the three and it
//    matches `buildState.mjs`'s stated philosophy: *"a row with nothing behind it renders
//    SectionNotBuilt, BY NAME. Never a dead link."*
//      · `not_built` / `cut` → NOT navigable. The capability does not exist; the row says so and
//        carries a badge. Clicking would teach nobody anything.
//      · `no_read_path`      → NAVIGABLE. The DATA exists and only this screen is unwritten, so the
//        destination is a real, honest explanation naming the phase that delivers it. ★ That is a
//        different promise from "there is no such feature", and collapsing the two is how a plan
//        stops describing reality.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** The states a row can be in. ★ Anything unrecognised is treated as `not_built` — fail CLOSED, so
 *  a new state added server-side can never accidentally become a live link to nothing. */
export const NAV_STATES = Object.freeze(["built", "no_read_path", "not_built", "cut"]);

/** ★★★ THE ONE PREDICATE. Navigable means "clicking this goes somewhere that tells you something". */
export function isNavigable(state) {
  const s = typeof state === "string" ? state : state?.state;
  if (s === undefined || s === null) return true;   // ★ no opinion supplied = the caller's default
  return s === "built" || s === "no_read_path";
}

/** ★ The badge a non-navigable row wears, or null. Kept HERE so the words cannot differ per surface. */
export function badgeFor(state) {
  const s = typeof state === "string" ? state : state?.state;
  if (s === "cut") return "Not planned";
  if (s === "not_built") return "Not built";
  return null;
}

/** ★★ `no_read_path` is navigable but is NOT finished, and a destination list should say so rather
 *  than present it identically to a working screen. Used by the palette to mark, never to hide. */
export function isFullyBuilt(state) {
  const s = typeof state === "string" ? state : state?.state;
  return s === "built";
}
