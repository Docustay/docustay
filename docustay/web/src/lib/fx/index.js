// Scroll and reveal helpers (Svelte 5 attachments). Tested in specs/svelte-playbook-recipes. They run in the browser only, never during server rendering,
// so the server's HTML is always the finished picture; the stylesheet hides it again only when script is on (<html class="js">) and shows it when the person has asked for reduced motion.
export const calm = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Add `data-shown` (once) when the element is first `threshold` visible. Without script, or with reduced motion, it is shown at once. */
export const shown = (threshold = 0.35, rootMargin = "0px 0px -8% 0px") => (el) => {
  if (calm() || typeof IntersectionObserver === "undefined") { el.setAttribute("data-shown", ""); return; }
  // visible until proven below the fold: content already on screen is never hidden waiting for scripts (that held the page's largest paint back by seconds in the throttled lab)
  let first = true;
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.setAttribute("data-shown", ""); io.disconnect(); } else if (first) el.setAttribute("data-pending", ""); first = false; }, { threshold, rootMargin });
  io.observe(el); return () => io.disconnect();
};

/** Words that appear one after another. The words stay in the HTML as real text; the effect only toggles a data attribute that the stylesheet reads. */
export const words = (threshold = 0.4) => (el) => {
  const text = el.textContent.trim(); if (!text) return;
  el.setAttribute("aria-label", text);
  el.replaceChildren(...text.split(/\s+/).map((w, i) => { const s = document.createElement("span"); s.className = "w"; s.textContent = w; s.style.setProperty("--i", String(i)); s.setAttribute("aria-hidden", "true"); el.append(" "); return s; }).flatMap((s) => [s, document.createTextNode(" ")]));
  return shown(threshold)(el);
};

/** Run `fn` once the page has finished loading and the browser is idle: the film's video must never compete with the poster (the largest paint) or the page scripts. */
export const whenIdle = (fn) => {
  const go = () => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 400));
  if (document.readyState === "complete") go(); else addEventListener("load", go, { once: true });
};

/** Slow devices get the lighter motion (Run 8): `<html data-lite>` when the device says it is small (≤ 2 cores, ≤ 2 GB, data saver) or when a short frame probe after load
 * averages over 28 ms a frame. Each motion piece reads the attribute and drops its 3D turn, blur or loop; the still states are the same as reduced motion's. Runs once per page load. */
export function probeLite() {
  if (typeof window === "undefined" || document.documentElement.hasAttribute("data-lite-checked")) return;
  const root = document.documentElement; root.setAttribute("data-lite-checked", "");
  const nav = navigator, small = (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) || (nav.deviceMemory && nav.deviceMemory <= 2) || nav.connection?.saveData === true;
  if (small) { root.setAttribute("data-lite", ""); return; }
  whenIdle(() => { let n = 0, t0 = 0; const step = (t) => { if (!t0) t0 = t; if (++n < 24) return requestAnimationFrame(step); if ((t - t0) / (n - 1) > 28) root.setAttribute("data-lite", ""); }; requestAnimationFrame(step); });
}
