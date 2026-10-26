// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S2.2 — READING A DESCRIPTOR'S EMPTY STATE, WHICHEVER OF THE TWO SHAPES IT IS IN.
//
// ★★★ THE TWO SHAPES EXIST ON PURPOSE AND FOR A BOUNDED TIME. This is an EXPAND/CONTRACT, and the
//     contract half is scheduled:
//       · `view.empty`      — a STRING. What the descriptors have carried since P15.5 and what the
//                             REACT `ListView` renders as a text node. **It cannot become an object
//                             while that bundle lives**: React throws "Objects are not valid as a
//                             React child", so changing the shape in place would take the whole
//                             product down on the first empty screen.
//       · `view.emptyState` — the four-part BLOCK this spec adds: kind · icon · headline · line ·
//                             action, plus `blockedAction`/`blockedLine` for the twelve blocked
//                             screens.
//
// ★★★ AND THEY ARE NOT TWO HAND-MAINTAINED COPIES — THAT WOULD BE THE DUPLICATE-TRUTH DEFECT THIS
//     CODEBASE MEETS MOST OFTEN. `emptyOf()` in `src/records/lists/_shared.mjs` takes ONE
//     declaration and emits BOTH keys, with the string derived from the block's own `line`. A
//     descriptor author writes the empty state once.
//   ★★ THE CONTRACT STEP IS S6.2: when the React bundle is retired, `empty` is deleted and
//      `emptyState` is renamed to `empty`. Until then, **the block is the source and the string is
//      the shadow** — never the other way round.
//
// ★ This module is plain JS so a gate can assert the normalisation with no DOM at all.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * @param view  a LIST_VIEWS / RECORD_TYPES descriptor
 * @returns the four-part block, always — never null, never a bare string.
 */
export function emptyBlockOf(view) {
  const block = view?.emptyState;
  if (block && typeof block === "object") return block;

  const line = typeof view?.empty === "string" ? view.empty.trim() : "";
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ A LEGACY STRING BECOMES `first-run` WITH **NO ACTION**, AND THE MISSING ACTION IS THE
  //     HONEST PART. The spec's rule is *"never a dead end — every empty state should offer exactly
  //     one primary next step"*, but the ONE thing a bare sentence cannot tell us is WHERE that step
  //     goes. Inventing a destination here would produce precisely the failure the spec names:
  //     *"an empty invoices screen with an 'Add invoice' button that cannot work is worse than no
  //     button."*
  //   ★★ So a screen still on the old shape renders correctly and is visibly UNFINISHED — no
  //      button — rather than confidently wrong. That is what makes the remaining work findable.
  //   ★ The headline is deliberately left EMPTY rather than derived from the sentence. A headline
  //     is forward-looking ("Add your first client"); a legacy `empty` string is a status report
  //     ("No clients yet"), and promoting one into the other would put a status report in the
  //     position the spec reserves for the opposite.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  return { kind: "first-run", icon: null, headline: "", line, action: null, legacy: true };
}

/** ★ True when this descriptor has NOT yet been given its four-part block. Exported so a sweep can
 *  count how many of the 45 are still on the legacy shape — a number, not an impression. */
export const isLegacyEmpty = (view) => emptyBlockOf(view).legacy === true;
