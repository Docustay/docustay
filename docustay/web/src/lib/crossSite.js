// R13-D429 (23 Oct 2026): the API's same-origin check (src/http/app.mjs §3b) never ran for browser traffic, because this server forwards neither Origin
// nor Referer, so only the session cookie's SameSite=Lax stood between another *.docustay.app name and a signed-in person's session. The rule is applied
// here, where the browser's own headers still are: a state-changing request that rides the session COOKIE (no Authorization header: an API key in a
// header is not ambient, so a customer's own code calling the API is unaffected) is refused when Origin or Referer names any other origin.
// Same rule as the API's: Origin wins when both are present; an unparseable Referer counts as a mismatch; neither header present → allowed (the session still decides).
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** → true when the request must be refused. `own` is `https://host[:port]` of the address the person is on. */
export function crossSiteRefused({ method, origin = null, referer = null, cookie = null, authorization = null, own }) {
  if (!MUTATING.has(String(method).toUpperCase())) return false;
  if (!cookie || authorization) return false;
  if (origin == null && referer == null) return false;
  let presented;
  if (origin != null) presented = String(origin).trim().toLowerCase();
  else { try { presented = new URL(referer).origin.toLowerCase(); } catch { presented = null; } }
  return presented !== String(own).toLowerCase();
}
