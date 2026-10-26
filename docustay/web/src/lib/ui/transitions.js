// PAGE-TO-PAGE: the browser's View Transition (SvelteKit documents this, no library). 200 ms cross-fade; skipped under reduced motion and where the browser has no support.
export function viewTransition(navigation) {
  if (typeof document === "undefined" || !document.startViewTransition) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  // moving between the marketing site, the portal and the signing page changes the whole look: no fade between two different looks
  if (navigation.from?.route?.id && navigation.to?.route?.id && navigation.from.route.id.split("/")[1] !== navigation.to.route.id.split("/")[1]) return;
  // Run 8 R8-65: a click during the fade (Next, Next) aborts it; the browser then rejects the transition's promises — caught, so the console is not filled with InvalidStateError
  // Run 10 (R10-17): a tab nobody is looking at draws no frames, and the browser then never calls the transition back: the navigation waited for it (30-60 s before the page changed). No fade in a hidden tab, and never wait more than 300 ms for one.
  if (document.visibilityState !== "visible") return;
  return new Promise((resolve) => {
    const guard = setTimeout(resolve, 300);
    const vt = document.startViewTransition(async () => { clearTimeout(guard); resolve(); await navigation.complete.catch(() => {}); });
    for (const p of [vt?.ready, vt?.finished, vt?.updateCallbackDone]) p?.catch?.(() => {});
  });
}

// Run 7 part 8 — STEP TO STEP inside a flow: the new step slides in from the side it came from (forward from the right, back from the left), 220 ms, transform and opacity only. Runs on the
// step's container with the Web Animations API, so nothing is unmounted (the Prepare step keeps its editor alive while hidden). No layout shift: the element keeps its box the whole time.
const reduce = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export function stepIn(el, dir = 1) {
  if (!el?.animate || reduce()) return;
  el.animate([{ opacity: 0, transform: `translateX(${dir * 14}px)` }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
}
