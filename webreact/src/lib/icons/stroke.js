// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE ICON STROKE WEIGHT — ONE NUMBER, ONE PROP NAME, AND THE PROP NAME IS THE WHOLE POINT.
//
// ★★★ [MEASURED 2026-09-16] SEVEN CALL SITES PASSED `stroke={1.75}` AND EVERY ICON IN THE PRODUCT
//     WENT INVISIBLE. `@lucide/svelte` v1 spreads the caller's props LAST
//     (`dist/utils/buildLucideIconNode.js`, final entry of the `attributes` object), so `stroke`
//     does not set the WEIGHT — it overwrites the PAINT `stroke="currentColor"` with the string
//     `"1.75"`. That is not a valid `<paint>`; the declaration is dropped and `stroke` falls back
//     to its initial value, `none`. Lucide already sets `fill="none"`. Neither paints, the `<svg>`
//     keeps its box, and every sidebar row and toolbar button shows a clean empty gap.
//   ★★ THE CORRECT PROP IS `strokeWidth`. The two names differ by five characters and the failure
//      is SILENT — no warning, no error, nothing in the console. That is exactly why it is a named
//      constant imported from one place rather than a literal typed at each call site: a reader
//      seeing `strokeWidth={ICON_STROKE}` cannot accidentally reintroduce the other spelling.
//
// ★★ WHY NOT `setLucideProps()` (the library's own global context) OR A CSS RULE — both were
//    considered and both are WORSE HERE, for the same reason:
//      · CONTEXT reaches only descendants of the component that sets it. Every gate in this repo
//        mounts `Sidebar`, `ListControls` and the rest DIRECTLY, with no app shell above them — so
//        a context set in `App.svelte` would give the APP 1.75 and the GATE the library default of
//        2. The check and the product would then disagree about the thing being checked, which is
//        this project's most-repeated defect class.
//      · CSS (`svg { stroke-width: … }`) is real and would work in a browser, but it is invisible
//        to a DOM-reading gate — and "a CSS grep is not proof that a thing is visible" is the exact
//        lesson this defect taught. The weight has to be an ATTRIBUTE a mounted component emits.
//
// ★ `db/gates/ui_icons_render.mjs` asserts, on the real mounted components, that `stroke` is a
//   paint and `stroke-width` is a positive number. Re-introduce `stroke={…}` anywhere and it reds.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Lucide stroke weight for every icon in the product. MOCKUPS.md §GLOBAL: "stroke 1.75". */
export const ICON_STROKE = 1.75;
