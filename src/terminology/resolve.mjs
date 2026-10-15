// P1.5 — THE TERMINOLOGY STORE, FEEDING THE RESOLVER THAT ALREADY EXISTS.
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

import { TERM_KEYS } from "./keys.mjs";
import { getSetting } from "../settings/writes.mjs";

/**
 * This tenant's label overrides, ready to hand to `navTree(terms)`.
 * ★ Returns `{}` when nothing is set — which `navTree` already treats as "use every fallback".
 *
 * ★★ UNKNOWN KEYS ARE DROPPED, NOT THROWN ON. `setSetting` refuses them at the WRITE
 *    (`src/settings/keys.mjs`), so a stored unknown key means the vocabulary SHRANK after it was
 *    saved — a nav row was removed or renamed. Refusing to render the whole sidebar because one
 *    stale override no longer matches anything would turn a cosmetic leftover into an outage.
 */
export async function resolveTerms(tx) {
  const stored = await getSetting(tx, "terminology.overrides", null);
  if (!stored || typeof stored !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(stored)) {
    if (TERM_KEYS.includes(k) && typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}
