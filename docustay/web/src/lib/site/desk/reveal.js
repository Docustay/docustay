// Attachments for the Desk look: reveal on view (rise 14 px and fade, once), and the stamp that lands once. Both stand down under prefers-reduced-motion (the stylesheet shows the end state).
const seen = (node, cls, margin = "0px 0px -8% 0px") => {
  if (typeof IntersectionObserver === "undefined") { node.classList.add(cls); return () => {}; }
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add(cls); io.unobserve(e.target); } }, { rootMargin: margin, threshold: 0.12 });
  io.observe(node); return () => io.disconnect();
};
/** {@attach reveal} on any element carrying data-reveal */
export const reveal = (node) => seen(node, "in");
/** {@attach land} on a .stamp element */
export const land = (node) => seen(node, "in", "0px");
/** runs `fn(visible)` whenever the element enters or leaves the screen (loops are paused off screen) */
export const whenVisible = (fn) => (node) => {
  if (typeof IntersectionObserver === "undefined") { fn(true); return () => {}; }
  const io = new IntersectionObserver(([e]) => fn(e.isIntersecting), { threshold: 0.1 }); io.observe(node); return () => io.disconnect();
};
