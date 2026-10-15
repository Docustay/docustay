// Behaviour every in-place overlay shares (ported from ActionSurface.svelte / SideSheet.svelte):
//   · Escape calls onEscape
//   · on open, focus the first enabled field (or [data-autofocus]); on close, give focus back to the opener
// ★ Overlays render IN PLACE (no portal): the suite queries them inside the host element, as it does today.
import { useEffect, useRef } from "react";

export function useEscape(onEscape) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") ref.current?.(e); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}

export function useFocusTrapLite(panelRef) {
  useEffect(() => {
    const opener = typeof document !== "undefined" ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])");
      (first ?? panel.querySelector("[data-autofocus]"))?.focus?.();
    }
    return () => { try { opener?.focus?.(); } catch { /* the opener may be gone */ } };
  }, [panelRef]);
}
