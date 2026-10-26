// WHICH LOOK A PAGE WEARS (the maintainer, 7 Oct 2026; report §17.1). Pure, no imports, so the server hook, the browser and the tests share it.
//   site     the marketing website: always dark, no switch
//   signing  the signing page, downloads and emails' landing pages: light and friendly whatever the account picked
//   ""       the portal, sign-in and the docs: they follow the account's Appearance (light by default)
export const THEME_COOKIE = "docustay-theme";
export const PREFERENCES = ["system", "light", "dark"];

/** @param {string|null|undefined} routeId SvelteKit's route id, e.g. "/(app)/documents/[id]"  @param {string} [pathname] used only when no route matched */
export function surfaceOf(routeId, pathname = "") {
  if (/^\/(sign|download|f)(\/|$)/.test(pathname)) return "signing";   // by address first: a link that does not resolve still wears the signing page's look, never the dark site
  if (!routeId) return /^\/(sign|download|f)(\/|$)/.test(pathname) ? "signing" : "site";   // an unmatched path (404) wears the look of the area it was asked for; anywhere else it is the site's own page
  if (routeId.startsWith("/(app)") || routeId.startsWith("/(auth)") || routeId === "/design-components") return "";
  if (routeId === "/sign" || routeId.startsWith("/sign/") || routeId.startsWith("/f/") || routeId === "/f" || routeId === "/download" || routeId.startsWith("/download/")) return "signing";
  if (routeId === "/(site)/docs" || routeId.startsWith("/(site)/docs/")) return "";
  return "site";
}

/** the saved preference from a Cookie header (or null) */
export function preferenceFrom(cookieHeader) {
  const m = /(?:^|;\s*)docustay-theme=(system|light|dark)\b/.exec(cookieHeader ?? "");
  return m ? m[1] : null;
}

/** the value the SERVER can write on <html data-theme>: light or dark. "system" cannot be known on the server; the inline script in app.html resolves it before paint. */
export const serverTheme = (preference) => (preference === "dark" ? "dark" : "light");

/** the value to show for a preference, given what the OS prefers */
export const resolveTheme = (preference, osDark) => (preference === "dark" ? "dark" : preference === "light" ? "light" : osDark ? "dark" : "light");
