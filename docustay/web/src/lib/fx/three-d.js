// THE 3D KIT (Run 9 boards Motion 5 "More 3D, across the whole system" and Motion 6 "Big 3D moments"). CSS 3D first: every piece here moves only `transform` and `opacity`
// (the GPU's two cheap properties). Reduced motion and slow devices (`html[data-lite]`, Run 8 probeLite) get the still, finished picture. Svelte 5 attachments and transitions.
import { calm } from "./index.js";
const lite = () => typeof document !== "undefined" && document.documentElement.hasAttribute("data-lite");
const still = () => calm() || lite();
const fine = () => typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/** CARDS THAT TILT: the card leans towards the pointer (at most `max` degrees) and a light catches it (`--lx`/`--ly` for a sheen). Only with a fine pointer; never on touch, reduced motion or lite. */
export const tilt = (max = 6) => (el) => {
  if (still() || !fine()) return;
  let raf = 0, rx = 0, ry = 0;
  el.style.transformStyle = "preserve-3d"; el.style.willChange = "transform";
  const paint = () => { raf = 0; el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`; };
  const move = (e) => { const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    ry = (x - 0.5) * 2 * max; rx = -(y - 0.5) * 2 * max; el.style.setProperty("--lx", `${Math.round(x * 100)}%`); el.style.setProperty("--ly", `${Math.round(y * 100)}%`); el.dataset.tilting = ""; if (!raf) raf = requestAnimationFrame(paint); };
  const leave = () => { rx = 0; ry = 0; delete el.dataset.tilting; el.style.transition = "transform 420ms cubic-bezier(.2,.8,.2,1)"; paint(); setTimeout(() => (el.style.transition = ""), 430); };
  el.addEventListener("pointermove", move); el.addEventListener("pointerleave", leave);
  return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); cancelAnimationFrame(raf); el.style.transform = ""; };
};

/** SIGNING: while a signature is being drawn the page lifts slightly towards the person, then settles when it is placed. `active` is read from the element's data-drawing attribute. */
export const liftWhileDrawing = () => (el) => {
  if (still()) return;
  el.style.transition = "transform 260ms cubic-bezier(.2,.8,.2,1), box-shadow 260ms ease-out"; el.style.transformOrigin = "50% 100%";
  const on = () => { el.style.transform = "perspective(1100px) rotateX(4deg) translateY(-4px) scale(1.01)"; el.style.boxShadow = "var(--surface-shadow-lift)"; };
  const off = () => { el.style.transform = ""; el.style.boxShadow = ""; };
  el.addEventListener("pointerdown", on); addEventListener("pointerup", off); el.addEventListener("pointercancel", off);
  return () => { el.removeEventListener("pointerdown", on); removeEventListener("pointerup", off); el.removeEventListener("pointercancel", off); };
};

/** PAGE TURNS (a Svelte transition): moving between pages of a document, or between steps of the flow, turns like a real page about its left edge. `dir` = 1 forwards, -1 back. */
export function turn(node, { dir = 1, duration = 420 } = {}) {
  if (still()) return { duration: 0 };
  return { duration, css: (t, u) => `transform-origin: ${dir > 0 ? "0% 50%" : "100% 50%"}; transform: perspective(1400px) rotateY(${dir * -24 * u}deg) translateX(${dir * 18 * u}px); opacity: ${0.35 + 0.65 * t};` };
}

/** BIG MOMENTS: "one per key screen, never two at once". A piece asks before it plays; while one plays, another shows its still picture. */
let playing = null;
export function claimMoment(name, ms) {
  if (still()) return false;
  if (playing && playing.until > Date.now() && playing.name !== name) return false;
  playing = { name, until: Date.now() + ms }; return true;
}

/** A DOCUMENT OPENS FROM THE LIST: the row's card and the document page share one view-transition name, so the browser grows one into the other (no library). Where the API is missing the page simply changes. */
export const vtName = (id) => `doc-${String(id).replace(/[^a-z0-9-]/gi, "")}`;
export function withViewTransition(navigation) {
  if (still() || typeof document === "undefined" || !document.startViewTransition) return;
  return new Promise((resolve) => { document.startViewTransition(async () => { resolve(); await navigation.complete; }); });
}
