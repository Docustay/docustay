// ═══════════════════════════════════════════════════════════════════════════════════════════════
// P5.3 — FILTERING THE 83 NAV ROWS BY LABEL.
//
// ★★★ ONE FUNCTION ANSWERS BOTH QUESTIONS — *what is visible* and *what does Enter open* — because
//     they are the same question and a product where they disagree opens a row the person cannot
//     see. That is the whole reason this is a module rather than two `filter()` calls at two call
//     sites: the second one drifts.
//
// ★★ A PARENT IS KEPT WHEN A DESCENDANT MATCHES, and it is kept as a PATH TO the match, not as a
//    match itself. Typing "invites" must show `People → Team → Invites`; showing the leaf alone
//    strips the context that tells you which Team it is under, and showing `People` as though IT
//    matched is a different lie.
//
// ★ NO ROUTE, AND NONE SHOULD BE ADDED. The tree arrives ALREADY AUTHORISED — the server filters
//   by `visibleSections()` before it is sent — so filtering here cannot reveal a row the caller
//   was not allowed to see. It is narrowing a list they already hold.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** ★ Case- and punctuation-insensitive, so "super admins" finds "Super-admins". */
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const matches = (row, q) => norm(row?.label).includes(q);

/**
 * ★★ EXPORTED so the command palette (P5.8) applies the SAME notion of "matches" to a FLAT list of
 *    destinations. The sidebar wants a pruned TREE — where a parent is kept as the path to a match;
 *    the palette wants RESULTS — where an ancestor is context, not an answer. One matcher, two
 *    shapes, rather than two matchers that drift.
 */
export const labelMatches = (row, query) => {
  const q = norm(query);
  return q ? matches(row, q) : true;
};

/**
 * @param sections  the nav tree as `/api/nav` sends it
 * @param query     raw text from the input
 * @returns {{sections, matchCount, firstMatch, openKeys, filtering}}
 */
export function filterNav(sections = [], query = "") {
  const q = norm(query);
  // ★★ AN EMPTY QUERY IS NOT "NOTHING MATCHES" — it is "not filtering". `filtering:false` is what
  //    lets the caller tell an un-searched sidebar from a search with no results, which is the
  //    distinction the item's FAILURE row turns on.
  if (!q) {
    return { sections, matchCount: null, firstMatch: null, openKeys: [], filtering: false };
  }

  const openKeys = [];
  // ★★★ ORDER IS THE TREE'S OWN ORDER, top to bottom, depth-first — because "the FIRST match" has
  //     to mean what a person reading the sidebar would point at. Collecting matches in any other
  //     order makes Enter open something arbitrary.
  const ordered = [];
  const out = [];

  for (const section of sections) {
    const sectionHit = matches(section, q);
    if (sectionHit) ordered.push(section);

    const keptChildren = [];
    for (const child of section.children ?? []) {
      const childHit = matches(child, q);
      if (childHit) ordered.push(child);

      const keptGrandkids = [];
      for (const g of child.children ?? []) {
        if (matches(g, q)) { ordered.push(g); keptGrandkids.push(g); }
      }

      // ★ A child is kept if IT matches (then all its grandchildren come with it, because the
      //   person asked for that branch) or if any grandchild matches (then only the matching ones).
      if (childHit) {
        keptChildren.push(child);
        if ((child.children ?? []).length) openKeys.push(child.key);
      } else if (keptGrandkids.length) {
        keptChildren.push({ ...child, children: keptGrandkids });
        openKeys.push(child.key);
      }
    }

    if (sectionHit) {
      // ★★ A MATCHING SECTION KEEPS ITS WHOLE SUBTREE. Typing "money" should show what is IN
      //    Money — pruning it to the section header alone answers a question nobody asked.
      out.push(section);
      if ((section.children ?? []).length) openKeys.push(section.key);
      // ★ Its descendants are already in `ordered` only if they matched too; add the rest in tree
      //   order so Enter still lands on the section itself, which is what was typed.
    } else if (keptChildren.length) {
      out.push({ ...section, children: keptChildren });
      openKeys.push(section.key);
    }
  }

  return {
    sections: out,
    matchCount: ordered.length,
    // ★★★ THE FIRST MATCH IS A ROW WITH A PATH. A section header that is only a container has no
    //     screen to open, so Enter must skip it rather than navigating to `undefined` — which is
    //     how a keyboard shortcut silently sends somebody to a blank route.
    firstMatch: ordered.find((r) => r?.path) ?? null,
    openKeys,
    filtering: true,
  };
}
