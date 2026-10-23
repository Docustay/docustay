// R13-D263: a hand-built dialog (role="dialog") behaves like one. On open, focus moves inside; Tab and Shift+Tab stay inside; Escape closes it when the
// dialog can be closed (pass the close function; pass nothing for a step that must not be dismissed); on close, focus returns to what opened it.
// Usage: <div role="dialog" aria-modal="true" {@attach modal(() => (open = false))}>
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const modal = (close = null) => (node) => {
  const before = document.activeElement;
  const items = () => [...node.querySelectorAll(FOCUSABLE)].filter((e) => e.getClientRects().length > 0);
  if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
  queueMicrotask(() => { if (!node.contains(document.activeElement)) (items()[0] ?? node).focus({ preventScroll: true }); });
  const onKey = (e) => {
    if (e.key === "Escape" && close) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const f = items(); if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  node.addEventListener("keydown", onKey);
  return () => { node.removeEventListener("keydown", onKey); if (before instanceof HTMLElement && document.contains(before)) before.focus({ preventScroll: true }); };
};
