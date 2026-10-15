// ═══════════════════════════════════════════════════════════════════════════════════════════════
// S0.6 — THE PHASE RESOLVER. PORTED VERBATIM FROM `web/src/shell/ScreenState.jsx`, AND "VERBATIM"
// IS THE POINT: every line of reasoning below was PAID FOR by a defect, and a framework change is
// not a licence to re-derive it.
//
// ★★★ IT IS PLAIN JAVASCRIPT ON PURPOSE. `phaseOf` decides precedence, which is a rule about the
//     world and not about rendering — so it lives outside any `.svelte` file, can be imported by a
//     gate with no DOM at all, and cannot be accidentally re-implemented inside a component.
//
// ★★ PHASE AND KIND ARE DIFFERENT AXES AND MUST NOT BE CONFLATED.
//       PHASE — what the SERVER said: loading · error · denied · not-built · empty · ready
//       KIND  — WHY an empty screen is empty: first-run · filtered · period · blocked · not-built
//     A screen resolves its PHASE first; only if that phase is `empty` does the KIND matter.
//     ★ `not-built` appears in both lists and that is not a duplicate: it is a phase the server
//       reports AND the treatment that phase renders. It is the one place the two axes touch.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const PHASES = Object.freeze(["loading", "error", "denied", "not-built", "empty", "ready"]);

/** ★★★ THE FIVE KINDS, AND THEY MUST LOOK DIFFERENT. A coach with 60 clients who filters to none
 *  must NEVER be told to create their first client. */
export const KINDS = Object.freeze(["first-run", "filtered", "period", "blocked", "not-built", "pitch"]);

/**
 * Derive the phase from the shape a route hands back, so every screen answers the question the
 * same way rather than each inventing its own precedence.
 *
 * ★★ THE ORDER IS THE DECISION: loading, then DENIED, then error, then not-built, then empty.
 */
export function phaseOf({ loading, error, denied, notBuilt, rows } = {}) {
  if (loading) return "loading";
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ `denied` IS TESTED BEFORE `error`, AND THE ORDER WAS ONCE THE OTHER WAY ROUND.
  //     A 403 arrives AS an Error, so any caller doing the natural thing — recording BOTH the
  //     thrown error and `denied: status === 403` — got "error", and the `denied` branch was
  //     UNREACHABLE for every real refusal in the product.
  //   ★★ A REFUSAL IS AN ERROR, BUT IT IS THE MORE SPECIFIC ONE, and the specific answer is the
  //      useful one: "you may not see this" is actionable, "something went wrong" is not.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (denied) return "denied";
  if (error) return "error";
  if (notBuilt) return "not-built";
  if (Array.isArray(rows)) return rows.length === 0 ? "empty" : "ready";

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ A NON-ARRAY `rows` IS NOT "READY". IT IS A ROUTE THAT DID NOT RETURN A LIST.
  //
  // [EXECUTED 2026-09-14] `phaseOf({rows: null})` returned **"ready"**, and `ListView` then called
  // `rows.length` on it: `TypeError: Cannot read properties of null (reading 'length')`. A default
  // parameter `rows = []` does NOT help — it fires only on `undefined`, and a JSON route returning
  // `{"rows": null}` sends null.
  //
  // ★★ Combined with the root error boundary, that TypeError took down the WHOLE APPLICATION. The
  //    precedence bug and the crash were one defect wearing two faces: "ready" is a CLAIM that
  //    there is content to render, and `null` is not content.
  //
  // ★ `undefined` is the one benign case — a caller that simply does not pass `rows` is a screen
  //   that is not a list at all (a record page, a form), and those are genuinely ready.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (rows === undefined) return "ready";
  return "error";
}

/**
 * ★★★ WHICH KIND OF EMPTY THIS IS — DERIVED, NEVER GUESSED, AND NEVER WRITTEN INTO THE COPY.
 *
 * The spec's rule is *"`kind` drives the treatment, not the copy — so filtered can never
 * accidentally read as first-run."* This is the function that keeps that true: a screen passes its
 * DESCRIPTOR and the WORLD, and gets back a kind. No screen decides for itself.
 *
 * @param descriptor  the list descriptor's `empty` block: { kind, icon, headline, line, action, blockedBy }
 * @param world       { filtered: boolean, blocked: boolean }
 */
export function kindOf(descriptor, { filtered = false, blocked = false } = {}) {
  // ★★ FILTERED WINS OVER EVERYTHING, because it is the only kind that is about what the PERSON
  //    just did rather than about the state of the practice. Somebody who has typed a filter and
  //    got nothing needs "clear filters", not a lecture about their first client — and they need it
  //    even on a screen that is also genuinely blocked.
  if (filtered) return "filtered";
  // ★★★ BLOCKED BEATS FIRST-RUN, AND THAT IS THE WHOLE POINT OF THE DEPENDENCY CHAIN. An empty
  //     invoices screen offering "Add invoice" when no service has a price is a dead end that
  //     teaches the user the product is broken. Twelve of the 45 are blocked and eleven trace to
  //     one root — a service with a price.
  if (blocked && descriptor?.kind !== "not-built") return "blocked";
  return descriptor?.kind ?? "first-run";
}
