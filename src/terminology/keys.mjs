// P1.5 — THE TERM VOCABULARY, DERIVED FROM THE NAV.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ READ THIS BEFORE CHANGING ANYTHING HERE. THE SIBLING PROJECT DELETED ITS TERMINOLOGY LAYER
//     AND PINNED IT DELETED WITH TWO TESTS (`~/example-simple-app/CLAUDE.md §2.7`), because i18next
//     **ECHOES THE KEY ON A MISS** — a `t('userType.pir')` with no resolver behind it does not throw
//     and does not render blank, it prints the literal string `userType.pir` on screen, and two
//     PIR-portal labels were doing exactly that.
//
//   ★★★ KEYSTONE'S RESOLVER CANNOT DO THAT, AND THAT DIFFERENCE IS THE ENTIRE REASON THIS ITEM IS
//       ALLOWED TO EXIST. `src/nav/sections.mjs:277` resolves `terms[row.termKey] || row.fallback`
//       — **the fallback is the English word**, carried on the row itself
//       (`{termKey:'userType.clientPlural', fallback:'Clients'}`). A miss renders `Clients`, not
//       `userType.clientPlural`. [EXECUTED] `navTree({})` returns plain English for all four rows.
//     ★★ So the safety property is structural, not a convention, and `db/gates/p1_terminology.mjs`
//        asserts it directly: **no label a tenant can set, and no miss, can put a dotted token on
//        screen.** Keep that assertion. It is the guard the other project bought with a deletion.
//
// ★★ AND THE VOCABULARY IS DERIVED, NEVER RE-LISTED. `TERM_KEYS` below is computed by walking the
//    real nav rows. A hand-written copy of the four keys is the `DUPLICATE-TRUTH` class, and it is
//    the specific defect P4.10 measured in the PIR portal — a second copy of the section list that
//    let a guard pass against its own stale copy while the real nav drifted.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { SECTIONS, SECTION_CHILDREN } from "../nav/sections.mjs";

// ★★ THIS MODULE DELIBERATELY IMPORTS NOTHING BUT THE NAV. `src/settings/keys.mjs` validates a
//    terminology override against `TERM_KEYS`, and `resolve.mjs` reads the stored setting — so if
//    the derivation lived beside the reader, `settings/keys → terminology/resolve → settings/writes
//    → settings/keys` would be a cycle. The vocabulary has no business knowing about storage.

/** Every row in the nav, including grandchildren. ★ `SECTIONS` alone is 13 of 83. */
function everyRow() {
  const out = [];
  const walk = (rows) => {
    for (const r of rows ?? []) {
      out.push(r);
      if (r.children) walk(r.children);
    }
  };
  walk(SECTIONS);
  for (const kids of Object.values(SECTION_CHILDREN)) walk(kids);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ P10.6 — THE WORDS THE NAV HAS NO ROW FOR, AND WHY THEY LIVE HERE AND NOT IN A SECOND LIST.
//
//     [MEASURED 2026-09-15] there were **TWO VOCABULARIES**: this module derived FOUR plural keys
//     from the nav, and `src/email/templates.mjs` declared its own hardcoded EIGHT — including four
//     SINGULARS this module had never heard of. Two closed sets, each certain it was the closed set.
//   ★★★ WHICH IS THE EXACT CLASS THIS FILE'S OWN HEADER WARNS ABOUT — *"a hand-written copy of the
//       four keys is the DUPLICATE-TRUTH class"* — and P4.10 measured it in the PIR portal: the same
//       seven labels in two tables, silently diverged. **The warning was written here and the
//       duplicate was one directory away.**
//
// ★★ SO THE VOCABULARY IS STILL ONE SET, DERIVED TWO WAYS, IN ONE PLACE:
//      · the NAV rows give the plurals the sidebar renders — derived, never re-listed;
//      · `CLIENT_TERMS` gives the singulars a CLIENT reads ("your coach", "session") — declared,
//        because there is no nav row to derive them from and inventing one would put a row in the
//        sidebar to make a word configurable.
//   ★ Both carry an English FALLBACK, which is the safety property this whole layer rests on: a miss
//     renders the word, never a dotted token. See this file's header for what that bought.
const CLIENT_TERMS = Object.freeze({
  "userType.client": "Client",
  "userType.parent": "Parent",
  // ★ QUEUE §4 (the maintainer, 2 Oct 2026) — CLIENT TYPES ARE RENAMEABLE LABELS OVER FIXED ROLES. The role underneath (what a person can do) never
  //   changes; only the word does. Adult/Adolescent/Parent/Lead are the four types the People tabs, filters, forms and portal show.
  "userType.adult":           "Adult",
  "userType.adultPlural":     "Adults",
  "userType.adolescent":      "Adolescent",
  "userType.adolescentPlural": "Adolescents",
  "userType.parentPlural":    "Parents",
  "userType.lead":            "Lead",
  "userType.leadPlural":      "Leads",
  "userType.member": "Team member",
  "userType.admin":  "Admin",
  // ★★ WHAT THE PRACTICE CALLS THE THING THEY SELL. A recovery practice says "session"; a tutor says
  //    "lesson"; a consultancy says "meeting". It is the word a client reads most often in the app
  //    and in every reminder, and it had no key at all.
  "noun.session":       "Session",
  "noun.sessionPlural": "Sessions",
});

/**
 * The term keys the product actually renders.
 * ★★ An override for a key nothing renders is a setting that silently does nothing — the operator
 *    types a new word, sees it save, and waits forever. So the set is closed, and the nav half is
 *    closed against the REAL rows rather than a list somebody maintained.
 */
export const TERM_KEYS = Object.freeze([...new Set([
  ...everyRow().filter((r) => r.termKey).map((r) => r.termKey),
  ...Object.keys(CLIENT_TERMS),
])].sort());

/** The English word each key falls back to — from the row that owns it, or from CLIENT_TERMS. */
export const TERM_FALLBACKS = Object.freeze({
  ...CLIENT_TERMS,
  ...Object.fromEntries(everyRow().filter((r) => r.termKey).map((r) => [r.termKey, r.fallback])),
});
