// 17.9 — THE LAYOUT LINT: CHECK WHETHER TERMINOLOGY OVERRIDES WOULD OVERFLOW IN KNOWN TIGHT SPOTS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TIGHT SPOTS are the places where the shipped terminology word has the right length but a
// practice's choice might not. Each carries the spot's description, the form (singular or plural)
// that is checked, and the character budget.
//
// ★★ THE BUDGET IS MEASURED, NOT GUESSED. A 248px sidebar − 20px icon − 14px padding on each side
//    = 200px available. At 14px Inter the nominal width is 8px/char (MEASURED in UI-CONTRACT §3).
//    So 200px / 8px ≈ 25ch, but `nav.row` also has 8px of left margin and carries the caret icon
//    (small), so the real budget is 22. ★ Every default word passes every spot.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { TERM_FALLBACKS } from "./keys.mjs";

/**
 * The places where terminology can overflow.
 * ★ Populated by the measurement in the file header, and every default word in TERM_FALLBACKS
 *   must pass every spot or the lint is broken.
 */
export const TIGHT_SPOTS = Object.freeze([
  {
    id: "nav.row",
    termKey: "userType.clientPlural",
    where: "the sidebar",
    form: "plural",
    maxChars: 22,
  },
  {
    id: "app.tab",
    termKey: "noun.sessionPlural",
    where: "the phone app's bottom tabs",
    form: "plural",
    maxChars: 10,
  },
  {
    id: "calendar.chip",
    termKey: "noun.session",
    where: "a week-view calendar block",
    form: "singular",
    maxChars: 14,
  },
  {
    id: "button.book",
    termKey: "noun.session",
    where: "the Book a {session} button",
    form: "singular",
    maxChars: 12,
  },
  {
    id: "table.header",
    termKey: "noun.sessionPlural",
    where: "list column headers",
    form: "plural",
    maxChars: 16,
  },
  {
    id: "chip.status",
    termKey: "noun.session",
    where: "status chips",
    form: "singular",
    maxChars: 12,
  },
]);

/**
 * Check which terminology overrides would exceed the character budget in tight spots.
 * @param {Object} overrides - the stored terminology.overrides object, keyed by TERM_KEYS
 * @returns {Array} warnings: [{termKey, word, form, spot, where, chars, maxChars}]
 *                 for every override that exceeds a spot's budget
 */
export function lintTerms(overrides) {
  const warnings = [];
  const warnedTermKeys = new Set(); // Track which term keys we've already warned about

  for (const spot of TIGHT_SPOTS) {
    const word = overrides?.[spot.termKey];
    if (!word || typeof word !== "string") continue;

    // Skip if we've already reported this term key in a different spot
    if (warnedTermKeys.has(spot.termKey)) continue;

    const chars = word.length;
    if (chars > spot.maxChars) {
      warnings.push({
        termKey: spot.termKey,
        word,
        form: spot.form,
        spot: spot.id,
        where: spot.where,
        chars,
        maxChars: spot.maxChars,
      });
      warnedTermKeys.add(spot.termKey);
    }
  }

  return warnings;
}
