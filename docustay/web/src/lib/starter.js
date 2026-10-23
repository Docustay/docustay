// A built-in template chosen on the website survives sign-up or sign-in. The address carries ?starter=<slug>; it is kept for the tab (sessionStorage) AND in a short-lived cookie (one hour, this site only, nothing but the slug),
// because a second tab or a link opened from an email (a password reset, a sign-in link) is a new tab with empty sessionStorage. The app opens it as soon as the person is in.
// Part 31 follow-up: in production sign-up signs the person straight in (there is no verification link to carry it through); the new-tab cases are the password-reset link and a second tab, and the cookie covers both.
import DOCS from "$lib/site/starters.index.json" with { type: "json" };
import FORMS from "$lib/site/forms.index.json" with { type: "json" };   // the thirty former form templates are ordinary templates now
const INDEX = [...DOCS, ...FORMS];   // every starter template carries through sign-up
const KEY = "docustay-starter", COOKIE = "ds_starter", HINT = "docustay-signed-in", OK = /^[a-z0-9-]{1,80}$/;
const valid = (s) => (s && OK.test(s) && INDEX.some((x) => x.slug === s) ? s : null);
const read = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const readCookie = () => { try { return document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? null; } catch { return null; } };
const writeCookie = (v) => { try { document.cookie = `${COOKIE}=${v}; path=/; max-age=${v ? 3600 : 0}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`; } catch { /* cookies may be blocked */ } };
/** Call on a page that may be opened with ?starter=… : remembers a well-formed slug of a real starter. Returns the slug now pending, or null. */
export function rememberStarter() {
  if (typeof location === "undefined") return null;
  const q = valid(new URLSearchParams(location.search).get("starter"));
  if (q) { try { sessionStorage.setItem(KEY, q); } catch { /* storage may be blocked */ } writeCookie(q); return q; }
  return valid(read()) ?? valid(readCookie());
}
export const clearStarter = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } writeCookie(""); };
/** The small facts about a starter (title, pages, seats) for the card shown while someone signs up, or null. */
export const starterInfo = (slug) => INDEX.find((x) => x.slug === slug) ?? null;
/** Where to go after signing in or signing up. */
export const afterAuthPath = (fallback = "/documents") => { try { const back = sessionStorage.getItem("ds-after-login"); if (back && (/^\/oauth\/authorize\?/.test(back) || /^\/(billing|documents|templates|people|plays|reports|settings)(\/|\?|$)/.test(back))) { sessionStorage.removeItem("ds-after-login"); return back; } } catch { /* storage blocked */ } const s = rememberStarter(); return s ? `/templates?kind=${starterInfo(s)?.kind === "form" ? "form" : "document"}&starter=${encodeURIComponent(s)}` : fallback; };   // Run 9 Part 4R: the built-in template's own row on Templates (send from it, or customize it)
/** A hint, kept only in this browser, that this person was signed in recently: the website's template page then sends them straight to the app. The app still checks the real session; a wrong hint costs one redirect to the sign-in page, which keeps the starter. */
/** R13-D261: whether this browser has been signed in before (a visitor who never was goes to the public pages, not the sign-in form). */
export const wasSignedIn = () => { try { return localStorage.getItem(HINT) !== null; } catch { return false; } };
export const markSignedIn = (on = true) => { try { if (on) localStorage.setItem(HINT, String(Date.now())); else localStorage.removeItem(HINT); } catch { /* ignore */ } };
export const probablySignedIn = () => { try { const v = Number(localStorage.getItem(HINT)); return v > Date.now() - 14 * 864e5; } catch { return false; } };
