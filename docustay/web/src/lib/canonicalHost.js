// ONE sign-in address. A passkey is tied to the host it was made on (its relying-party id), so every sign-in page must run on app.docustay.app. The server already answers
// docustay.app/login with a redirect; a person who reaches /login by a link INSIDE the public site never makes a server request (the router just swaps the page), so the
// browser must do the same hop. Pure so it is tested: returns the address to go to, or null when the page is already on the right host.
export const SITE_HOSTS = ["docustay.app", "www.docustay.app"];
export const APP_HOST = "app.docustay.app";
export const AUTH_PATHS = /^\/(login|signup|forgot|reset|demo)(\/|$)/;
export function canonicalAuthAddress(loc) {
  const host = String(loc?.hostname ?? "").toLowerCase();
  if (!SITE_HOSTS.includes(host) || !AUTH_PATHS.test(String(loc?.pathname ?? ""))) return null;
  return `https://${APP_HOST}${loc.pathname}${loc.search ?? ""}${loc.hash ?? ""}`;
}
