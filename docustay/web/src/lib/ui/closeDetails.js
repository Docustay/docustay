// R13-D264: a <details> used as a drop-down list closes like one: Escape closes it (focus goes back to its summary), and so does a press anywhere outside it.
// Usage: <details {@attach closeDetails}>
export const closeDetails = (node) => {
  const onDown = (e) => { if (node.open && !node.contains(e.target)) node.open = false; };
  const onKey = (e) => { if (e.key === "Escape" && node.open) { e.stopPropagation(); node.open = false; node.querySelector("summary")?.focus(); } };
  document.addEventListener("pointerdown", onDown, true);
  node.addEventListener("keydown", onKey);
  return () => { document.removeEventListener("pointerdown", onDown, true); node.removeEventListener("keydown", onKey); };
};
