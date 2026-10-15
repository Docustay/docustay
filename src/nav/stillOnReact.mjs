// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE MIGRATION BOUNDARY. THE ROWS WHOSE SCREEN IS STILL THE REACT ONE.
//
// ★★★ THIS EXISTS BECAUSE OF A MEASUREMENT, NOT A GUESS. The Svelte app resolves a path three ways:
//     eight rows it handles explicitly, 45 it draws through the generic `ListView`, and 30 that
//     fall through to `api.view()`. Of those 30, **nine come back `SectionNotBuilt`** — and
//     [MEASURED against `web/src/App.jsx`'s `DEDICATED` map] **eight of the nine have a real,
//     working React screen behind them.**
//
// ★★★ SO WITHOUT THIS FILE, DEPLOYING THE SVELTE SHELL WOULD PUT "This section is not built yet"
//     OVER EIGHT FEATURES THAT WORK. That is not a cosmetic regression. It is the exact defect this
//     codebase has written more rules against than any other: a row that lies about what the
//     product can do. §A3 — *"never a dead link and never removed"* — and B2.3: *"a dead link is
//     indistinguishable from a bug."* Telling somebody their audit log does not exist, when it
//     does, is worse than both.
//
// ★★ AND IT IS DECLARED **ONCE**, HERE, BECAUSE TWO CONSUMERS NEED IT AND THEY MUST NOT DISAGREE:
//      · `src/http/app.mjs` serves the REACT shell for these paths, so the link actually lands on
//        the working screen;
//      · `webui/.../Screen.svelte` refuses to draw them, and says why, so the Svelte shell never
//        claims a feature is missing when it is merely unported.
//    A path in one list and not the other is a screen that either 404s or lies — the two halves of
//    the same defect. One declaration, imported by both.
//
// ★★★ EVERY ENTRY IS A DEBT WITH A NAME. This list must only ever SHRINK. An entry removed means
//     the Svelte screen was built; an entry ADDED would mean a working screen was taken away, which
//     is not something this migration is permitted to do.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ The eight, with the item that clears each. The `label` is what the person reads, so it is the
 *   row's own name and never a build reference — "Scheduled: phase 15B" on a user-facing screen is
 *   the jargon defect U3.3 is written against.
 */
// ★ `/platform/provisioning` WAS HERE AND IS GONE — S4.4 built the Svelte screen, so the debt is
//   paid and the entry is removed. **This list must only ever shrink**, and this is what shrinking
//   it looks like: one line deleted, nothing else touched.
export const STILL_ON_REACT = Object.freeze({
});

/** ★ One predicate, so neither consumer writes its own membership test. */
export const isStillOnReact = (path) =>
  Object.prototype.hasOwnProperty.call(STILL_ON_REACT, String(path ?? ""));

export const STILL_ON_REACT_PATHS = Object.freeze(Object.keys(STILL_ON_REACT));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ `/platform/health` IS DELIBERATELY **NOT** IN THIS LIST, AND THE REASON IS WORTH RECORDING.
//   It is the ninth row that falls through to `SectionNotBuilt`, but [MEASURED] it is NOT in
//   React's `DEDICATED` map either — so the React app has always rendered `SectionNotBuilt` for it
//   too. It is a pre-existing lying nav row (`buildState` says `built`; no screen exists), not a
//   regression this migration introduces. Registered separately as F374.
//   ★★ Putting it here would have been the wrong fix twice over: it would claim a React screen
//      exists to link to, and it would hide a real defect behind a migration note.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
