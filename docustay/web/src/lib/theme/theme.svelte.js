// THE APPEARANCE (report §17.1). The person's preference is system | light | dark (default light). It is remembered in localStorage and in a cookie (so the server writes the right data-theme before paint); only the portal, sign-in and the docs follow it.
// The marketing site and the signing page wear their own surface whatever the preference is.
import { THEME_COOKIE, PREFERENCES, resolveTheme, surfaceOf } from "./surface.js";

const read = () => { try { const v = localStorage.getItem(THEME_COOKIE); if (PREFERENCES.includes(v)) return v; } catch { /* blocked */ } const m = typeof document === "undefined" ? null : /(?:^|;\s*)docustay-theme=(system|light|dark)\b/.exec(document.cookie); return m ? m[1] : "light"; };

class Theme {
  preference = $state("light");
  resolved = $state("light");
  #mq = null;
  init() {
    if (typeof window === "undefined") return;
    this.preference = read();
    this.#mq = window.matchMedia("(prefers-color-scheme: dark)");
    this.#mq.addEventListener("change", () => this.#paint());
    this.#paint();
  }
  set(pref) {
    if (!PREFERENCES.includes(pref)) return;
    this.preference = pref;
    try { localStorage.setItem(THEME_COOKIE, pref); } catch { /* blocked: the cookie still carries it */ }
    document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`;
    this.#paint();
  }
  /** the page changed (client-side navigation): put the right surface on <html>, and the theme only where the account's Appearance applies */
  route(routeId) {
    if (typeof document === "undefined") return;
    const r = document.documentElement, surface = surfaceOf(routeId, location.pathname);
    if (surface) r.setAttribute("data-surface", surface); else r.removeAttribute("data-surface");
    this.#paint();
  }
  #paint() {
    const r = document.documentElement;
    this.resolved = resolveTheme(this.preference, Boolean(this.#mq?.matches));
    if (!r.getAttribute("data-surface")) r.setAttribute("data-theme", this.resolved);
  }
}
export const theme = new Theme();
