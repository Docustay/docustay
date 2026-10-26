// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A0.2 — THE REFRESH CONTRACT. **ONE NAME, THREE TIERS.**
//
// ★★★ WHAT THIS IS DEFENDING AGAINST (F230). `setReload` was declared inside `Screen`, referenced
//     in `App`'s scope, and the resulting `ReferenceError` was swallowed by the dialog's own
//     `catch` on an already-unmounting component. **The row was written, the dialog closed, it read
//     as success, and NOTHING REFETCHED.** The gate was green, because a source-grep for a literal
//     cannot tell a call from a call that resolves.
//
// ★★★ THE SVELTE APP ALREADY FIXED THAT **STRUCTURALLY**, AND THIS FILE KEEPS IT FIXED.
//     `app.refetchSignal` is a `$state` FIELD ON THE SHARED `AppState` CLASS — so it is in scope
//     wherever `app` is and **cannot become a free identifier**. The fix moved from "spell the
//     callback correctly" to "the callback has nowhere wrong to live". Every helper here takes
//     `app` explicitly for that reason; none of them closes over anything.
//
// ★★ ONE NAME. There were SIX — `onDone`, `onBooked`, `onSaved`, `onReload`, `onCancel`, `onClose`
//    — for TWO concepts:
//        onDone   = finished a write
//        onCancel = dismissed without one
//    **A sixth name is a sixth chance to bind the wrong one.** The old names are not aliased here;
//    aliasing them would preserve the ambiguity this exists to remove.
//
// ★★★ AND THREE TIERS, BECAUSE SOME WRITES CHANGE WHAT IS *BLOCKED*, NOT JUST WHAT IS LISTED.
//     `SectionActions` already had to reach for `loadCapabilities()` on its own — because creating
//     a SERVICE unblocks ELEVEN screens. A write that unblocks a screen and only raises the signal
//     leaves the person looking at a nav full of rows the product now supports and still refuses.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * TIER 1 — the list this surface belongs to must re-read. **Always.**
 * ★★★ RE-READ, NEVER PATCH. A surface that splices its new row into local state shows a value the
 *     server may have normalised — a trimmed name, a rounded price, a coerced date — or a row that
 *     does not exist at all if a trigger rejected it after the fact.
 */
export function refetch(app) {
  app.refetchSignal += 1;
}

/**
 * TIER 2 — tier 1, plus a NAV COUNT moved.
 * ★ Most writes are this one: a person, a booking, an invoice, a document all change a number in
 *   the sidebar. Raising only the signal leaves that number stale next to a list that updated,
 *   which reads as the count being the broken thing.
 */
export function refetchWithCounts(app) {
  refetch(app);
  app.loadCounts();
}

/**
 * TIER 3 — tier 2, plus a screen UNBLOCKED.
 * ★★★ THE TIER THAT IS EASY TO MISS, BECAUSE ITS SYMPTOM IS ON A DIFFERENT SCREEN. Creating the
 *     first service, the first price, the first person or the first account changes what
 *     `/api/capabilities` says the product can do — and ELEVEN of the 45 list screens are blocked
 *     behind "a service with a price". Without this call the person creates the very thing the
 *     empty state told them to create, returns to the screen that sent them, and is still blocked.
 */
export function refetchWithCapabilities(app) {
  refetchWithCounts(app);
  app.loadCapabilities();
}

/**
 * ★★ THE TIER, DECLARED AS DATA RATHER THAN REMEMBERED PER CALL SITE.
 *
 * `tierFor(path)` answers "what does a write on this screen invalidate". It is a table rather than
 * 52 judgement calls, so a new surface inherits the right answer instead of its author guessing —
 * and so the answer can be CHECKED, which a judgement call in a closure cannot be.
 *
 * ★ Anything not named here gets tier 2. That is the safe default: a needless `loadCounts()` costs
 *   one request, a missing one shows a stale number, and only tier 3 is expensive enough to opt in.
 */
const UNBLOCKS = new Set([
  "/items/services",      // ★★★ the root blocker — a service with a price unblocks ELEVEN screens
  "/items/packages",
  "/items/plans",
  "/items/prices",
  "/items/contracted-prices",
  "/people/all",          // ★ the FIRST person is what unblocks the people-dependent screens
  "/people/clients",
  "/accounts",
  "/accounts/all",
]);

export function tierFor(path) {
  return UNBLOCKS.has(String(path ?? "")) ? 3 : 2;
}

/**
 * ★★★ THE ONE CALL A SURFACE MAKES. `onDone={() => done(app, path)}`.
 *
 * Taking `app` and `path` as ARGUMENTS — never as closed-over variables — is the F230 fix expressed
 * as a signature: there is no scope in which this can be reached and be undefined, because it is
 * not reached by scope at all.
 */
export function done(app, path) {
  if (tierFor(path) === 3) refetchWithCapabilities(app);
  else refetchWithCounts(app);
}
